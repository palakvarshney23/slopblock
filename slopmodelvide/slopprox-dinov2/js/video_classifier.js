/**
 * video_classifier.js — SlopProx DINOv2 + ReStraV Classifier
 * ============================================================
 * Drop-in replacement for the CLIP-based video_classifier.js
 * Supports Phase A (linear probe) and Phase B (ReStraV MLP).
 *
 * Runs in Electron (Node.js + Transformers.js ONNX).
 * Loaded by background.js, called via IPC or HTTP on localhost:8083/classify-video
 *
 * Phase auto-detection: loads phaseB_probe.json if present, falls back to phaseA.
 *
 * Two-stage gating (Phase B only):
 *   - First pass: 5 frames → get score
 *   - If borderline (0.35–0.65): re-embed with 8-10 frames → final score
 *   - Otherwise: return first-pass result immediately (saves ~0.8s on CPU)
 */

const { pipeline, env } = require("@xenova/transformers");
const path = require("path");
const fs = require("fs");

// ─── Config ──────────────────────────────────────────────────────────────────

const MODELS_DIR = path.join(__dirname, "models");

function getLatestProbePaths() {
  // Auto-detect latest versioned probe (phaseB_probe_v2.json, v3, etc.)
  const paths = [];
  try {
    const entries = fs.readdirSync(MODELS_DIR);
    const versioned = entries
      .filter(f => f.match(/^phaseB_probe_v\d+\.json$/))
      .map(f => ({
        file: f,
        ver: parseInt(f.match(/v(\d+)/)[1], 10),
        path: path.join(MODELS_DIR, f)
      }))
      .sort((a, b) => b.ver - a.ver);
    if (versioned.length > 0) {
      paths.push(versioned[0].path);
    }
  } catch (e) {}
  paths.push(path.join(MODELS_DIR, "phaseB_probe.json"));
  paths.push(path.join(MODELS_DIR, "phaseA_probe.json"));
  return paths;
}

const PROBE_PATHS = getLatestProbePaths();

const DINOV2_MODEL = "Xenova/dinov2-small";  // matches training backbone
const FAST_FRAMES = 5;     // first-pass (always run)
const FULL_FRAMES = 8;     // second-pass (borderline only)
const BORDERLINE_LO = 0.35;
const BORDERLINE_HI = 0.65;

// ─── State ───────────────────────────────────────────────────────────────────

let extractor = null;    // DINOv2 Transformers.js pipeline
let probe = null;        // parsed probe JSON
let ready = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  if (ready) return;

  // Load probe (phase B preferred)
  for (const p of PROBE_PATHS) {
    if (fs.existsSync(p)) {
      probe = JSON.parse(fs.readFileSync(p, "utf8"));
      console.log(`[VideoClassifier] Loaded probe: ${path.basename(p)} (phase=${probe.phase})`);
      break;
    }
  }
  if (!probe) throw new Error("No probe JSON found in models/. Run training scripts first.");

  // Load DINOv2-small ONNX via Transformers.js
  console.log("[VideoClassifier] Loading DINOv2-small ONNX...");
  extractor = await pipeline("feature-extraction", DINOV2_MODEL, {
    revision: "main",
    quantized: false,   // use fp32 for accuracy
  });
  console.log("[VideoClassifier] DINOv2-small loaded.");
  ready = true;
}


// ─── Embedding ────────────────────────────────────────────────────────────────

/**
 * Embed an array of base64-encoded JPEG frames.
 * Returns (n_frames, 384) float32 array (CLS tokens, L2-normalized).
 *
 * @param {string[]} frames — base64 JPEGs from content.js captures
 * @returns {number[][]}
 */
async function embedFrames(frames) {
  // Transformers.js feature-extraction returns (1, seq_len, 384)
  // CLS token is at index 0
  // Strip data URI prefixes if present (content.js sends data:image/jpeg;base64,...)
  const cleanFrames = frames.map(f => {
    if (typeof f === 'string' && f.includes(',')) return f.split(',')[1];
    return f;
  });
  const output = await extractor(cleanFrames, {
    pooling: "none",          // we extract CLS manually
    normalize: false,
  });

  const results = [];
  for (let i = 0; i < frames.length; i++) {
    // output[i] shape: (seq_len, 384)
    const cls = Array.from(output[i].data.slice(0, 384));  // CLS token
    const norm = Math.sqrt(cls.reduce((s, v) => s + v * v, 0)) + 1e-8;
    results.push(cls.map(v => v / norm));
  }
  return results;  // (n_frames, 384)
}


// ─── ReStraV 21-d (JS port, matches extract_restrap_features.py exactly) ─────

function computeReStrap21d(traj) {
  const T = traj.length;
  const D = traj[0].length;

  // Step vectors and norms
  const steps = [];
  for (let i = 0; i < T - 1; i++) {
    const s = traj[i + 1].map((v, k) => v - traj[i][k]);
    steps.push(s);
  }
  const stepNorms = steps.map(s => Math.sqrt(s.reduce((a, v) => a + v * v, 0)));

  const stats = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = arr.reduce((a, v) => a + v, 0) / n;
    const variance = arr.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const min = sorted[0];
    const max = sorted[n - 1];
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    return [mean, std, min, max, median, iqr];
  };

  // Features 0-5: step stats
  const stepStats = stats(stepNorms);

  // Features 6-11: curvature (angle at each interior point)
  const angles = [];
  for (let i = 1; i < T - 1; i++) {
    const v1 = steps[i - 1];
    const v2 = steps[i];
    const n1 = Math.sqrt(v1.reduce((a, v) => a + v * v, 0));
    const n2 = Math.sqrt(v2.reduce((a, v) => a + v * v, 0));
    if (n1 < 1e-8 || n2 < 1e-8) { angles.push(0); continue; }
    const cosA = Math.min(1, Math.max(-1,
      v1.reduce((a, v, k) => a + v * v2[k], 0) / (n1 * n2)
    ));
    angles.push(Math.acos(cosA));
  }
  const angleStats = stats(angles.length > 0 ? angles : [0]);

  // Features 12-14: path shape
  const totalLen = stepNorms.reduce((a, v) => a + v, 0);
  const diff = traj[T - 1].map((v, k) => v - traj[0][k]);
  const netDisp = Math.sqrt(diff.reduce((a, v) => a + v * v, 0));
  const tortuosity = Math.min(50, totalLen / (netDisp + 1e-8));

  // Features 15-17: temporal dynamics
  const accels = stepNorms.slice(1).map((v, i) => Math.abs(v - stepNorms[i]));
  const jerks = accels.slice(1).map((v, i) => Math.abs(v - accels[i]));
  const meanAccel = accels.length > 0 ? accels.reduce((a, v) => a + v, 0) / accels.length : 0;
  const meanJerk = jerks.length > 0 ? jerks.reduce((a, v) => a + v, 0) / jerks.length : 0;
  const meanSpeed = stepNorms.reduce((a, v) => a + v, 0) / stepNorms.length;
  const speedVar = stepNorms.reduce((a, v) => a + (v - meanSpeed) ** 2, 0) / stepNorms.length;

  // Feature 18: PCA variance ratio (first PC) — simplified via power iteration
  const centered = traj.map(row => row.map((v, k) => v - traj.reduce((a, r) => a + r[k], 0) / T));
  let vec = centered[0].map(() => Math.random());
  let vecNorm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0));
  vec = vec.map(v => v / vecNorm);
  for (let iter = 0; iter < 5; iter++) {
    const mv = centered.map(row => row.reduce((a, v, k) => a + v * vec[k], 0));
    const newVec = new Array(D).fill(0);
    centered.forEach((row, i) => row.forEach((v, k) => { newVec[k] += v * mv[i]; }));
    vecNorm = Math.sqrt(newVec.reduce((a, v) => a + v * v, 0));
    vec = newVec.map(v => v / vecNorm);
  }
  const projVar = centered.map(row => row.reduce((a, v, k) => a + v * vec[k], 0))
    .reduce((a, v) => a + v * v, 0);
  const totalVar = centered.flatMap(r => r).reduce((a, v) => a + v * v, 0);
  const f18 = totalVar > 0 ? Math.min(1, projVar / totalVar) : 1;

  // Feature 19: self-similarity (non-adjacent)
  const simScores = [];
  for (let i = 0; i < T; i++) {
    for (let j = i + 2; j < T; j++) {
      simScores.push(traj[i].reduce((a, v, k) => a + v * traj[j][k], 0));
    }
  }
  const f19 = simScores.length > 0 ? simScores.reduce((a, v) => a + v, 0) / simScores.length : 0;

  // Feature 20: reversal score
  const cosCurv = angles.map(a => Math.cos(a));
  const f20 = cosCurv.length > 0
    ? cosCurv.filter(c => c < 0).length / cosCurv.length
    : 0;

  return [
    ...stepStats,    // 0-5
    ...angleStats,   // 6-11
    totalLen, netDisp, tortuosity,  // 12-14
    meanAccel, meanJerk, speedVar,  // 15-17
    f18, f19, f20,                  // 18-20
  ];
}


// ─── Inference ────────────────────────────────────────────────────────────────

/**
 * Forward pass through the probe (Phase A or B).
 * @param {number[]} input — scaled input vector
 * @returns {number} score in [0,1] (probability of AI/fake)
 */
function forwardProbe(input) {
  if (probe.phase === "A") {
    // Linear: sigmoid(w·x + b)
    let logit = probe.bias;
    for (let i = 0; i < input.length; i++) logit += probe.weights[i] * input[i];
    return 1 / (1 + Math.exp(-logit));
  }

  // Phase B: MLP
  let x = input;
  for (const layer of probe.layers) {
    if (layer.type === "linear") {
      const out = new Array(layer.bias.length).fill(0);
      for (let o = 0; o < layer.bias.length; o++) {
        let acc = layer.bias[o];
        for (let i = 0; i < x.length; i++) acc += layer.weight[o][i] * x[i];
        out[o] = acc;
      }
      x = out;
    } else if (layer.type === "layernorm") {
      const mean = x.reduce((a, v) => a + v, 0) / x.length;
      const varr = x.reduce((a, v) => a + (v - mean) ** 2, 0) / x.length;
      const std = Math.sqrt(varr + layer.eps);
      x = x.map((v, i) => layer.weight[i] * ((v - mean) / std) + layer.bias[i]);
    } else if (layer.type === "gelu") {
      x = x.map(v => 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v ** 3))));
    }
    // dropout: skip at inference
  }
  return 1 / (1 + Math.exp(-x[0]));  // sigmoid on scalar output
}


function scaleInput(raw) {
  return raw.map((v, i) => (v - probe.scaler_mean[i]) / (probe.scaler_std[i] + 1e-8));
}


function buildInput(meanEmb, rstrapFeat) {
  if (probe.phase === "A") {
    return scaleInput(meanEmb);
  }
  const raw = [...meanEmb, ...rstrapFeat];
  return scaleInput(raw);
}


// ─── Public API (called by background.js or HTTP server) ─────────────────────

/**
 * Classify a video from captured frames.
 *
 * @param {string[]} frames5  — 5 base64 JPEG frames (always provided)
 * @param {string[]} [frames8] — 8 base64 JPEG frames (for two-stage; optional)
 * @returns {Promise<{score: number, label: string, phase: string, twoStage: boolean}>}
 */
async function classifyVideo(frames5, frames8 = null) {
  await init();

  const t0 = Date.now();

  // ── First pass (5 frames) ──────────────────────────────────────────────────
  const embs5 = await embedFrames(frames5);
  const mean5 = embs5[0].map((_, k) => embs5.reduce((a, e) => a + e[k], 0) / embs5.length);

  let rstrapFeat5 = null;
  if (probe.phase === "B") {
    rstrapFeat5 = computeReStrap21d(embs5);
  }

  const input5 = buildInput(mean5, rstrapFeat5);
  const score5 = forwardProbe(input5);

  // ── Two-stage: borderline check ───────────────────────────────────────────
  const isBorderline = score5 >= BORDERLINE_LO && score5 <= BORDERLINE_HI;
  let finalScore = score5;
  let twoStage = false;

  if (isBorderline && frames8 && probe.phase === "B") {
    const embs8 = await embedFrames(frames8);
    const mean8 = embs8[0].map((_, k) => embs8.reduce((a, e) => a + e[k], 0) / embs8.length);
    const rstrapFeat8 = computeReStrap21d(embs8);
    const input8 = buildInput(mean8, rstrapFeat8);
    finalScore = forwardProbe(input8);
    twoStage = true;
  }

  const latency = Date.now() - t0;
  const label = finalScore >= probe.threshold ? "AI_GENERATED" : "REAL";

  console.log(
    `[Classify] score=${finalScore.toFixed(3)} label=${label} ` +
    `two_stage=${twoStage} ms=${latency}`
  );

  return {
    score: finalScore,
    label,
    phase: probe.phase,
    twoStage,
    latencyMs: latency,
    threshold: probe.threshold,
  };
}


// ─── HTTP server (drop-in replacement for localhost:8083) ─────────────────────

function startServer(port = 8083) {
  const http = require("http");

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/classify-video") {
      res.writeHead(404);
      return res.end();
    }

    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { frames, frames8 } = JSON.parse(body);
        if (!frames || !Array.isArray(frames)) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "frames array required" }));
        }
        const result = await classifyVideo(frames, frames8 || null);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("[VideoClassifier] Error:", err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[VideoClassifier] Listening on http://127.0.0.1:${port}/classify-video`);
    console.log(`[VideoClassifier] Phase: ${probe?.phase ?? "loading..."}`);
  });

  // Warm up on start
  init().catch(console.error);
  return server;
}


module.exports = { classifyVideo, init, startServer };

// If run directly: node video_classifier.js
if (require.main === module) {
  startServer(8083);
}
