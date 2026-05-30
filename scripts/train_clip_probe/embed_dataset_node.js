#!/usr/bin/env node
'use strict';

/**
 * Embed training videos with Xenova CLIP (same stack as video_classifier.js).
 * Frame capture uses browser_frame_sampler.py via child_process.
 *
 * Usage:
 *   node scripts/train_clip_probe/embed_dataset_node.js \
 *     --data-root data/train \
 *     --out cache/train_embs_browser_xenova.jsonl \
 *     --resume
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  loadVideoModel,
  embedVideoBuffers,
  isVideoClassifierReady,
} = require('../../video_classifier');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.join(SCRIPT_DIR, '..', '..');
const SAMPLER = path.join(SCRIPT_DIR, 'browser_frame_sampler.py');
const DEFAULT_DATA_ROOT = path.join(REPO_ROOT, 'data', 'train');
const DEFAULT_OUT = path.join(REPO_ROOT, 'cache', 'train_embs_browser_xenova.jsonl');
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);
const AI_DIRS = new Set(['ai', 'fake', 'generated', 'slop']);

function parseArgs(argv) {
  const args = {
    dataRoot: DEFAULT_DATA_ROOT,
    out: DEFAULT_OUT,
    resume: false,
    augment: false,
    limit: 0,
    python: process.env.PYTHON || 'python',
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-root') args.dataRoot = path.resolve(argv[++i]);
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--augment') args.augment = true;
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (arg === '--python') args.python = argv[++i];
  }
  return args;
}

function* iterVideos(root) {
  if (!fs.existsSync(root)) return;
  for (const labelDir of fs.readdirSync(root).sort()) {
    const labelPath = path.join(root, labelDir);
    if (!fs.statSync(labelPath).isDirectory()) continue;
    const label = AI_DIRS.has(labelDir.toLowerCase()) ? 1 : 0;
    const stack = [labelPath];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) stack.push(full);
        else if (VIDEO_EXTS.has(path.extname(entry).toLowerCase())) {
          yield { path: full, label };
        }
      }
    }
  }
}

function loadDonePaths(outPath) {
  const done = new Set();
  if (!fs.existsSync(outPath)) return done;
  const lines = fs.readFileSync(outPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.path) done.add(row.path);
    } catch (_) { /* skip malformed */ }
  }
  return done;
}

function sampleFramesPython(python, videoPath, augment) {
  const args = [SAMPLER, videoPath];
  if (augment) args.push('--augment');
  const result = spawnSync(python, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    cwd: SCRIPT_DIR,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `sampler failed for ${videoPath}`);
  }
  const payload = JSON.parse(result.stdout.trim() || '[]');
  return payload.map(b64 => Buffer.from(b64, 'base64'));
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });

  await loadVideoModel(path.join(REPO_ROOT, 'models'));
  if (!isVideoClassifierReady()) {
    throw new Error('Video probe not ready — train/export models/clip_video_probe.json first');
  }

  const done = args.resume ? loadDonePaths(args.out) : new Set();
  const outStream = fs.createWriteStream(args.out, { flags: args.resume ? 'a' : 'w' });

  let processed = 0;
  let skipped = 0;
  for (const { path: videoPath, label } of iterVideos(args.dataRoot)) {
    if (args.limit > 0 && processed >= args.limit) break;
    if (done.has(videoPath)) continue;
    try {
      const buffers = sampleFramesPython(args.python, videoPath, args.augment);
      if (!buffers.length) {
        skipped++;
        continue;
      }
      const embedding = await embedVideoBuffers(buffers);
      if (!embedding) {
        skipped++;
        continue;
      }
      outStream.write(JSON.stringify({
        path: videoPath,
        label,
        embedding: Array.from(embedding),
      }) + '\n');
      processed++;
      if (processed % 25 === 0) {
        console.log(`Embedded ${processed} videos (${skipped} skipped)`);
      }
    } catch (err) {
      console.warn(`skip ${videoPath}: ${err.message}`);
      skipped++;
    }
  }

  await new Promise(resolve => outStream.end(resolve));
  console.log(`Done. Wrote ${processed} embeddings to ${args.out} (${skipped} skipped)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
