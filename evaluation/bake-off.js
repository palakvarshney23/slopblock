// evaluation/bake-off.js — Slop Scan bake-off (+5 bonus)
// Usage:
//   node evaluation/bake-off.js --dataset evaluation/hc3-sample-100.json
//   node evaluation/bake-off.js --dataset evaluation/hc3-sample-100.json --full
//   node evaluation/bake-off.js --all --full

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    dataset: null,
    all: false,
    full: false,
    threshold: null,
    verbose: args.includes('--verbose'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) parsed.dataset = args[i + 1];
    if (args[i] === '--threshold' && args[i + 1]) parsed.threshold = parseFloat(args[i + 1]);
    if (args[i] === '--all') parsed.all = true;
    if (args[i] === '--full') parsed.full = true;
  }
  return parsed;
}

function printMatrix(tp, fp, tn, fn) {
  console.log('\n                        Predicted');
  console.log('                 Human      AI');
  console.log(`Actual Human      ${String(tn).padStart(3)}        ${String(fp).padStart(3)}     (${tn + fp})`);
  console.log(`Actual AI          ${String(fn).padStart(3)}       ${String(tp).padStart(3)}     (${fn + tp})`);
}

function printMetrics(tp, fp, tn, fn) {
  const total = tp + fp + tn + fn;
  const accuracy = (tp + tn) / total;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const fpr = fp / (fp + tn) || 0;
  console.log(`\nAccuracy:  ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall:    ${(recall * 100).toFixed(1)}%`);
  console.log(`F1 Score:  ${(f1 * 100).toFixed(1)}%`);
  console.log(`FPR:       ${(fpr * 100).toFixed(1)}%`);
  return { accuracy, precision, recall, f1, fpr, tp, fp, tn, fn };
}

async function runHeuristicOnly(samples, threshold) {
  const classifier = require(path.join(ROOT, 'classifier'));
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const sample of samples) {
    const heuristicScore = classifier.getSlopScore(sample.text) / 40;
    const styloScore = classifier.getStylometricScore(sample.text);
    let confidence = heuristicScore;
    if (styloScore !== null) {
      confidence = Math.min(1.0, heuristicScore * 0.75 + styloScore * 0.25);
    }
    const predicted = confidence >= threshold ? 'ai' : 'human';
    const actual = sample.label;
    if (predicted === 'ai' && actual === 'ai') tp++;
    if (predicted === 'ai' && actual === 'human') fp++;
    if (predicted === 'human' && actual === 'human') tn++;
    if (predicted === 'human' && actual === 'ai') fn++;
  }
  return { tp, fp, tn, fn };
}

async function runFullEnsemble(samples, threshold) {
  const config = require(path.join(ROOT, 'config'));
  const classifier = require(path.join(ROOT, 'classifier'));

  const cacheDir = path.join(os.tmpdir(), 'slopblock-bakeoff-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  process.env.TRANSFORMERS_CACHE = cacheDir;

  config.init(cacheDir);
  console.log('Loading text models (first run may download ONNX weights)…');
  await classifier.loadModel(() => {});
  await new Promise((r) => setTimeout(r, 8000));

  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const sample of samples) {
    const { confidence } = await classifier.isAiSlop(sample.text);
    const predicted = confidence >= threshold ? 'ai' : 'human';
    const actual = sample.label;
    if (predicted === 'ai' && actual === 'ai') tp++;
    if (predicted === 'ai' && actual === 'human') fp++;
    if (predicted === 'human' && actual === 'human') tn++;
    if (predicted === 'human' && actual === 'ai') fn++;
  }
  return { tp, fp, tn, fn };
}

async function evaluateDataset(datasetPath, opts) {
  const { full, threshold, verbose } = opts;
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    return null;
  }

  const samples = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  console.log(`\n=== Bake-Off Evaluation ===`);
  console.log(`Dataset: ${path.basename(datasetPath)}`);
  console.log(`Samples: ${samples.length}`);
  console.log(`Mode: ${full ? 'full ensemble (tmr-ai + e5-lora + heuristics)' : 'heuristic + stylometric proxy'}`);
  console.log(`Threshold: ${threshold}`);
  console.log(`Hackathon window: 2026-05-29 – 2026-06-01 (Slop Scan)\n`);

  const counts = full
    ? await runFullEnsemble(samples, threshold)
    : await runHeuristicOnly(samples, threshold);

  if (verbose) {
    for (const sample of samples) {
      console.log(`  [${sample.id}] label=${sample.label}`);
    }
  }

  printMatrix(counts.tp, counts.fp, counts.tn, counts.fn);
  return printMetrics(counts.tp, counts.fp, counts.tn, counts.fn);
}

async function main() {
  const args = parseArgs();
  const config = require(path.join(ROOT, 'config'));
  const threshold = args.threshold ?? config.DEFAULTS.textThreshold;

  const datasets = args.all
    ? [
        path.join(__dirname, 'hc3-sample-100.json'),
        path.join(__dirname, 'ghostbuster-sample-100.json'),
        path.join(__dirname, 'social-sample-200.json'),
      ]
    : args.dataset
      ? [path.isAbsolute(args.dataset) ? args.dataset : path.join(process.cwd(), args.dataset)]
      : [];

  if (datasets.length === 0) {
    console.error('Usage: node evaluation/bake-off.js --dataset <path> [--full] [--threshold 0.55]');
    console.error('       node evaluation/bake-off.js --all [--full]');
    process.exit(1);
  }

  const results = [];
  for (const d of datasets) {
    const m = await evaluateDataset(d, { full: args.full, threshold, verbose: args.verbose });
    if (m) results.push({ file: path.basename(d), ...m });
  }

  if (results.length > 1) {
    const n = results.length;
    console.log('\n=== Combined macro average ===');
    const macro = {
      accuracy: results.reduce((s, r) => s + r.accuracy, 0) / n,
      precision: results.reduce((s, r) => s + r.precision, 0) / n,
      recall: results.reduce((s, r) => s + r.recall, 0) / n,
      f1: results.reduce((s, r) => s + r.f1, 0) / n,
      fpr: results.reduce((s, r) => s + r.fpr, 0) / n,
    };
    console.log(`Accuracy:  ${(macro.accuracy * 100).toFixed(1)}%`);
    console.log(`Precision: ${(macro.precision * 100).toFixed(1)}%`);
    console.log(`Recall:    ${(macro.recall * 100).toFixed(1)}%`);
    console.log(`F1 Score:  ${(macro.f1 * 100).toFixed(1)}%`);
    console.log(`FPR:       ${(macro.fpr * 100).toFixed(1)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
