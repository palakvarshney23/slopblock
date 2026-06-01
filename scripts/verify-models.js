#!/usr/bin/env node
/**
 * Verify bundled ML assets (image Model A ONNX bundle).
 * Usage:
 *   node scripts/verify-models.js           # strict — exit 1 if incomplete
 *   node scripts/verify-models.js --warn    # print warnings, exit 0
 *   node scripts/verify-models.js --repair  # download missing config.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'models', 'ai-source-detector-onnx');
const CONFIG_URL = 'https://huggingface.co/yaya36095/ai-source-detector/raw/main/config.json';

const REQUIRED_FILES = [
  { rel: 'config.json', minBytes: 100, repairable: true },
  { rel: 'preprocessor_config.json', minBytes: 100, repairable: false },
  { rel: 'onnx/model_quantized.onnx', minBytes: 1_000_000, repairable: false, lfsHint: true },
];

function isGitLfsPointer(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 64);
    return head.startsWith('version https://git-lfs.github.com/spec/v1');
  } catch {
    return false;
  }
}

function checkFile(entry) {
  const abs = path.join(MODEL_DIR, entry.rel);
  if (!fs.existsSync(abs)) {
    return { ok: false, reason: 'missing', entry };
  }
  const size = fs.statSync(abs).size;
  if (size < entry.minBytes) {
    return { ok: false, reason: isGitLfsPointer(abs) ? 'git-lfs-pointer' : 'too-small', entry, size };
  }
  return { ok: true, entry };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * @param {{ repair?: boolean, warn?: boolean }} opts
 * @returns {{ ok: boolean, failures: object[] }}
 */
async function verifyModels(opts = {}) {
  const { repair = false, warn = false } = opts;
  const failures = [];

  for (const entry of REQUIRED_FILES) {
    let result = checkFile(entry);
    if (!result.ok && repair && entry.repairable && entry.rel === 'config.json') {
      console.log('[SlopBlock] Downloading missing config.json from HuggingFace…');
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      const dest = path.join(MODEL_DIR, entry.rel);
      await downloadFile(CONFIG_URL, dest);
      result = checkFile(entry);
      if (result.ok) console.log('[SlopBlock] config.json restored.');
    }
    if (!result.ok) failures.push(result);
  }

  if (failures.length === 0) {
    return { ok: true, failures: [] };
  }

  const lines = failures.map((f) => {
    if (f.reason === 'git-lfs-pointer' || f.entry.lfsHint) {
      return `  • ${f.entry.rel} — Git LFS pointer only (run: git lfs pull)`;
    }
    if (f.reason === 'missing' && f.entry.repairable) {
      return `  • ${f.entry.rel} — missing (run: npm run verify-models -- --repair)`;
    }
    return `  • ${f.entry.rel} — ${f.reason}`;
  });

  const msg = `[SlopBlock] Image model bundle incomplete:\n${lines.join('\n')}`;
  if (warn) {
    console.warn(msg);
    return { ok: false, failures };
  }
  console.error(msg);
  return { ok: false, failures };
}

async function main() {
  const args = process.argv.slice(2);
  const repair = args.includes('--repair');
  const warn = args.includes('--warn');
  const strict = !warn;

  try {
    const { ok } = await verifyModels({ repair, warn: !strict });
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('[SlopBlock] verify-models failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyModels, MODEL_DIR, REQUIRED_FILES, isGitLfsPointer, checkFile };
