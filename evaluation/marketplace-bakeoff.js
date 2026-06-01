// evaluation/marketplace-bakeoff.js — Track G review bake-off
// Usage: node evaluation/marketplace-bakeoff.js --dataset evaluation/marketplace-sample.json --threshold 0.62

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { dataset: null, threshold: 0.62 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) parsed.dataset = args[i + 1];
    if (args[i] === '--threshold' && args[i + 1]) parsed.threshold = parseFloat(args[i + 1]);
  }
  return parsed;
}

async function runBakeOff() {
  const { dataset, threshold } = parseArgs();
  if (!dataset) {
    console.error('Usage: node evaluation/marketplace-bakeoff.js --dataset <path> [--threshold 0.62]');
    process.exit(1);
  }
  if (!fs.existsSync(dataset)) {
    console.error(`Dataset not found: ${dataset}`);
    process.exit(1);
  }

  const samples = JSON.parse(fs.readFileSync(dataset, 'utf8'));
  const classifier = require(path.join(__dirname, '..', 'classifier'));

  console.log('\n=== Marketplace Review Bake-Off (Track G) ===');
  console.log(`Dataset: ${dataset}`);
  console.log(`Samples: ${samples.length}`);
  console.log(`Threshold: ${threshold}\n`);

  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const sample of samples) {
    const result = await classifier.scoreReview(sample.text, sample.context || {});
    const predicted = result.isSlop ? 'ai' : 'human';
    const actual = sample.label;

    if (predicted === 'ai' && actual === 'ai') tp++;
    if (predicted === 'ai' && actual === 'human') fp++;
    if (predicted === 'human' && actual === 'human') tn++;
    if (predicted === 'human' && actual === 'ai') fn++;

    if (process.argv.includes('--verbose')) {
      console.log(`[${sample.id}] actual=${actual} pred=${predicted} conf=${(result.confidence * 100).toFixed(1)}% reasons=${result.reasons.join('; ')}`);
    }
  }

  const total = tp + fp + tn + fn;
  const accuracy = (tp + tn) / total;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const fpr = fp / (fp + tn) || 0;

  console.log('\n=== Results ===');
  console.log(`Accuracy:   ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Precision:  ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall:     ${(recall * 100).toFixed(1)}%`);
  console.log(`F1:         ${(f1 * 100).toFixed(1)}%`);
  console.log(`FPR:        ${(fpr * 100).toFixed(1)}%`);
  console.log(`TP=${tp} FP=${fp} TN=${tn} FN=${fn}\n`);
}

runBakeOff().catch(err => {
  console.error(err);
  process.exit(1);
});
