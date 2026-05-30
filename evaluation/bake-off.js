// evaluation/bake-off.js
// Run this script to reproduce bake-off results against labeled datasets.
// Usage: node evaluation/bake-off.js --dataset evaluation/hc3-sample-100.json --threshold 0.60

const fs = require('fs');
const path = require('path');

// We need to run the classifier in a minimal headless mode.
// This script mocks the model loading and tests heuristic + stylometric scoring,
// then shows where the full ensemble would score if models were loaded.

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dataset: null, threshold: 0.60 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) parsed.dataset = args[i + 1];
    if (args[i] === '--threshold' && args[i + 1]) parsed.threshold = parseFloat(args[i + 1]);
  }
  return parsed;
}

async function runBakeOff() {
  const { dataset, threshold } = parseArgs();
  if (!dataset) {
    console.error('Usage: node evaluation/bake-off.js --dataset <path> --threshold <0.0-1.0>');
    console.error('Example: node evaluation/bake-off.js --dataset evaluation/hc3-sample-100.json --threshold 0.60');
    process.exit(1);
  }

  if (!fs.existsSync(dataset)) {
    console.error(`Dataset not found: ${dataset}`);
    process.exit(1);
  }

  const samples = JSON.parse(fs.readFileSync(dataset, 'utf8'));
  console.log(`\n=== Bake-Off Evaluation ===`);
  console.log(`Dataset: ${dataset}`);
  console.log(`Samples: ${samples.length}`);
  console.log(`Threshold: ${threshold}`);
  console.log(`Note: This script runs heuristic + stylometric scoring.`);
  console.log(`      Full ML ensemble results require model loading (see BAKEOFF_RESULTS.md for published numbers).\n`);

  // Dynamically require classifier for heuristic scoring
  const classifier = require(path.join(__dirname, '..', 'classifier'));

  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const sample of samples) {
    const heuristicScore = classifier.getSlopScore(sample.text) / 40; // normalize 0-40 to 0-1
    const styloScore = classifier.getStylometricScore(sample.text);

    // Approximate ensemble: heuristic is a strong proxy when models unavailable
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

    if (process.argv.includes('--verbose')) {
      console.log(`[${sample.id}] actual=${actual} pred=${predicted} conf=${(confidence*100).toFixed(1)}% text="${sample.text.slice(0, 80)}..."`);
    }
  }

  const total = tp + fp + tn + fn;
  const accuracy = (tp + tn) / total;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const fpr = fp / (fp + tn) || 0;

  console.log('\n=== Results ===');
  console.log(`\n                        Predicted`);
  console.log(`                 Human      AI`);
  console.log(`Actual Human      ${tn.toString().padStart(3)}        ${fp.toString().padStart(3)}     (${tn + fp})`);
  console.log(`Actual AI          ${fn.toString().padStart(3)}       ${tp.toString().padStart(3)}     (${fn + tp})`);
  console.log(`\nAccuracy:  ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall:    ${(recall * 100).toFixed(1)}%`);
  console.log(`F1 Score:  ${(f1 * 100).toFixed(1)}%`);
  console.log(`FPR:       ${(fpr * 100).toFixed(1)}%`);
  console.log(`\nNote: These are heuristic-only scores. Full ensemble (with ML models) achieves`);
  console.log(`      ~82% accuracy, ~89% precision, ~73% recall. See BAKEOFF_RESULTS.md.`);
}

runBakeOff().catch(err => {
  console.error(err);
  process.exit(1);
});
