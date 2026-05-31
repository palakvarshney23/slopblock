// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// video_classifier.js — CLIP vision encoder + linear probe for video-level AI detection.

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');
const { debugLog, logError } = require('./logger');

const DEFAULT_CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
const VIDEO_MODEL_TOTAL = 1; // CLIP vision encoder (+ trained linear probe weights)
const CLIP_SIZE = 224;

let _probe = null;
let _probePath = null;
let _clipExtractor = null;
let _clipLoadPromise = null;

function _sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function _l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm <= 1e-12) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function _resolveProbePath(modelDir) {
  const local = path.join(modelDir || path.join(__dirname, 'models'), 'clip_video_probe.json');
  if (fs.existsSync(local)) return local;
  try {
    const packaged = path.join(process.resourcesPath, 'models', 'clip_video_probe.json');
    if (fs.existsSync(packaged)) return packaged;
  } catch (_) { /* process.resourcesPath unavailable outside Electron */ }
  return local;
}

function _loadProbe(modelDir) {
  _probePath = _resolveProbePath(modelDir);
  try {
    const raw = JSON.parse(fs.readFileSync(_probePath, 'utf8'));
    if (!raw.ready) {
      _probe = null;
      debugLog('[VideoClassifier] Probe not trained yet — video CLIP detection disabled');
      return;
    }
    const dim = raw.embedding_dim || raw.weights?.length || 0;
    if (!dim || !Array.isArray(raw.weights) || raw.weights.length !== dim) {
      throw new Error('Invalid probe weights');
    }
    _probe = {
      ready: true,
      clipModel: raw.clip_model || DEFAULT_CLIP_MODEL,
      threshold: typeof raw.threshold === 'number' ? raw.threshold : 0.5,
      warnThreshold: typeof raw.warn_threshold === 'number' ? raw.warn_threshold : 0.30,
      blockThreshold: typeof raw.block_threshold === 'number' ? raw.block_threshold : 0.60,
      embeddingDim: dim,
      scalerMean: Float32Array.from(raw.scaler_mean || []),
      scalerScale: Float32Array.from(raw.scaler_scale || []),
      weights: Float32Array.from(raw.weights || []),
      bias: typeof raw.bias === 'number' ? raw.bias : 0,
    };
    if (_probe.scalerMean.length !== dim || _probe.scalerScale.length !== dim) {
      throw new Error('Scaler dimension mismatch');
    }
    debugLog(`[VideoClassifier] Loaded probe (${dim}-d) from ${_probePath}`);
  } catch (err) {
    _probe = null;
    logError(err);
    debugLog('[VideoClassifier] Failed to load probe — video CLIP detection disabled');
  }
}

async function _ensureClipExtractor() {
  if (_clipExtractor) return _clipExtractor;
  if (!_probe?.ready) return null;
  if (_clipLoadPromise) return _clipLoadPromise;

  _clipLoadPromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    debugLog(`[VideoClassifier] Loading CLIP encoder (${_probe.clipModel})…`);
    _clipExtractor = await pipeline(
      'image-feature-extraction',
      _probe.clipModel,
      { cache_dir: process.env.TRANSFORMERS_CACHE }
    );
    debugLog('[VideoClassifier] CLIP encoder ready');
    return _clipExtractor;
  })().catch(err => {
    _clipLoadPromise = null;
    _clipExtractor = null;
    logError(err);
    debugLog('[VideoClassifier] CLIP load failed');
    return null;
  });

  return _clipLoadPromise;
}

async function _bufferToRawImage(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(CLIP_SIZE, CLIP_SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { RawImage } = await import('@huggingface/transformers');
  return new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
}

function _tensorToVector(tensor) {
  const data = tensor?.data ?? tensor;
  if (data instanceof Float32Array) return data;
  if (Array.isArray(data)) return Float32Array.from(data);
  if (data && typeof data.length === 'number') return Float32Array.from(data);
  throw new Error('Unexpected CLIP tensor output');
}

async function _embedFrame(extractor, buffer) {
  const image = await _bufferToRawImage(buffer);
  const output = await extractor(image);
  const vec = _tensorToVector(output);
  const dim = _probe.embeddingDim;
  const sliced = vec.length === dim ? vec : vec.subarray(0, dim);
  return _l2Normalize(sliced);
}

function _applyProbe(embedding) {
  const dim = _probe.embeddingDim;
  let logit = _probe.bias;
  for (let i = 0; i < dim; i++) {
    const scale = _probe.scalerScale[i] || 1;
    const scaled = (embedding[i] - _probe.scalerMean[i]) / scale;
    logit += scaled * _probe.weights[i];
  }
  return _sigmoid(logit);
}

function loadVideoModel(modelDir) {
  _loadProbe(modelDir);
  return Promise.resolve(isVideoClassifierReady());
}

function isVideoClassifierReady() {
  return !!(_probe && _probe.ready);
}

function getVideoThreshold() {
  return _probe?.threshold ?? 0.5;
}

function getVideoWarnThreshold() {
  return _probe?.warnThreshold ?? 0.30;
}

function getVideoBlockThreshold() {
  return _probe?.blockThreshold ?? 0.60;
}

async function _poolEmbeddings(embeddings) {
  if (!embeddings.length) return null;
  const pooled = new Float32Array(_probe.embeddingDim);
  for (const emb of embeddings) {
    for (let i = 0; i < pooled.length; i++) pooled[i] += emb[i];
  }
  for (let i = 0; i < pooled.length; i++) pooled[i] /= embeddings.length;
  return _l2Normalize(pooled);
}

async function embedVideoBuffers(buffers) {
  if (!Array.isArray(buffers) || !buffers.length || !isVideoClassifierReady()) {
    return null;
  }
  const extractor = await _ensureClipExtractor();
  if (!extractor) return null;

  const embeddings = [];
  for (const buffer of buffers) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) continue;
    embeddings.push(await _embedFrame(extractor, buffer));
  }
  return _poolEmbeddings(embeddings);
}

async function classifyVideoFrames(buffers) {
  if (!Array.isArray(buffers) || !buffers.length) {
    return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
  }
  if (!isVideoClassifierReady()) {
    return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
  }

  const extractor = await _ensureClipExtractor();
  if (!extractor) {
    return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
  }

  try {
    const embeddings = [];
    for (const buffer of buffers) {
      if (!Buffer.isBuffer(buffer) || !buffer.length) continue;
      embeddings.push(await _embedFrame(extractor, buffer));
    }
    if (!embeddings.length) {
      return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
    }

    const normalized = await _poolEmbeddings(embeddings);
    if (!normalized) {
      return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
    }

    const score = _applyProbe(normalized);
    const confidence = Math.round(score * 100);
    debugLog(`[VideoClassifier] score=${confidence}% frames=${embeddings.length}`);
    return { score, confidence, method: 'clip-linear-probe', skipped: false };
  } catch (err) {
    logError(err);
    return { score: 0, confidence: 0, method: 'clip-linear-probe', skipped: true };
  }
}

module.exports = {
  loadVideoModel,
  isVideoClassifierReady,
  getVideoThreshold,
  getVideoWarnThreshold,
  getVideoBlockThreshold,
  embedVideoBuffers,
  classifyVideoFrames,
  VIDEO_MODEL_TOTAL,
  DEFAULT_CLIP_MODEL,
};
