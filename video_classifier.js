/**
 * video_classifier.js — picks CLIP or DINOv2 backend from models/ probes.
 *
 * Bundled repo ships models/clip_video_probe.json (CLIP).
 * After training: models/phaseA_probe.json or phaseB_probe.json (DINOv2).
 */

const fs = require('fs');
const path = require('path');

function probeBackend(modelDir) {
  const dir = modelDir || path.join(__dirname, 'models');
  try {
    const entries = fs.readdirSync(dir);
    if (entries.some((f) => /^phaseB_probe_v\d+\.json$/.test(f))) return 'dinov2';
    if (entries.includes('phaseB_probe.json') || entries.includes('phaseA_probe.json')) {
      return 'dinov2';
    }
  } catch (_) { /* missing models dir */ }

  const clipPath = path.join(dir, 'clip_video_probe.json');
  if (fs.existsSync(clipPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(clipPath, 'utf8'));
      if (raw.ready) return 'clip';
    } catch (_) { /* invalid JSON */ }
  }
  return 'dinov2';
}

let _impl = null;
let _backend = null;

function getImpl(modelDir) {
  const backend = probeBackend(modelDir);
  if (!_impl || _backend !== backend) {
    _backend = backend;
    if (backend === 'clip') {
      console.log(
        '[VideoClassifier] Using CLIP probe (clip_video_probe.json). ' +
          'Train phaseA/phaseB probes for the DINOv2 classifier.'
      );
      _impl = require('./video_classifier_clip');
    } else {
      _impl = require('./video_classifier_dinov2');
    }
  }
  return _impl;
}

async function loadVideoModel(modelDir) {
  const impl = getImpl(modelDir);
  return impl.loadVideoModel(modelDir);
}

function isVideoClassifierReady() {
  return _impl ? _impl.isVideoClassifierReady() : false;
}

function getVideoThreshold() {
  return _impl ? _impl.getVideoThreshold() : 0.5;
}

function getVideoWarnThreshold() {
  return _impl ? _impl.getVideoWarnThreshold() : 0.3;
}

function getVideoBlockThreshold() {
  return _impl ? _impl.getVideoBlockThreshold() : 0.6;
}

async function embedVideoBuffers(buffers) {
  return getImpl().embedVideoBuffers(buffers);
}

async function classifyVideoFrames(buffers) {
  return getImpl().classifyVideoFrames(buffers);
}

async function classifyVideo(frames5, frames8) {
  return getImpl().classifyVideo(frames5, frames8);
}

async function init() {
  const impl = getImpl();
  if (typeof impl.init === 'function') return impl.init();
}

function startServer(port) {
  return getImpl().startServer(port);
}

async function setGPUEnabled(enabled) {
  const impl = getImpl();
  if (typeof impl.setGPUEnabled === 'function') return impl.setGPUEnabled(enabled);
}

function isGPUEnabled() {
  const impl = getImpl();
  return typeof impl.isGPUEnabled === 'function' ? impl.isGPUEnabled() : false;
}

const VIDEO_MODEL_TOTAL = 1;
const DEFAULT_CLIP_MODEL = 'Xenova/clip-vit-base-patch32';

module.exports = {
  classifyVideo,
  init,
  startServer,
  loadVideoModel,
  isVideoClassifierReady,
  getVideoThreshold,
  getVideoWarnThreshold,
  getVideoBlockThreshold,
  embedVideoBuffers,
  classifyVideoFrames,
  setGPUEnabled,
  isGPUEnabled,
  VIDEO_MODEL_TOTAL,
  DEFAULT_CLIP_MODEL,
};
