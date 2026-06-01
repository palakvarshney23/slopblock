// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// gpu_detector.js — Detect GPU and test DirectML availability for ONNX inference.
//
// On Windows we prefer DirectML because it works with NVIDIA, AMD, and Intel
// GPUs without requiring a specific CUDA toolkit version.
//
// Exported API:
//   detectGPU()          -> Promise<{ available, name, type, vram }>
//   testDirectML()       -> Promise<bool>  (quick ONNX load test)
//   getGPUStatus()       -> { available, name, type, vram }

const { execFile } = require('child_process');
const { env, AutoProcessor, AutoModel } = require('@huggingface/transformers');
const path = require('path');

let _cachedGPU = null;

/**
 * Detect NVIDIA GPU via nvidia-smi.
 * Returns null if nvidia-smi is unavailable or errors.
 */
function _detectNvidia() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (!lines.length) return resolve(null);
      // Take first GPU
      const [name, vramStr] = lines[0].split(',').map(s => s.trim());
      const vram = parseInt(vramStr, 10) || 0;
      resolve({ name, vram });
    });
  });
}

/**
 * Quick DirectML sanity test: try to load a tiny ONNX model with DML EP.
 * This proves DirectML is functional on this system (DX12 + compatible GPU).
 */
async function testDirectML() {
  const prevEP = env.backends.onnx.executionProviders;
  try {
    env.backends.onnx.executionProviders = ['dml'];
    // We do a minimal load-unload to verify DML works.
    // Use the same model ID but let it use cached files.
    const processor = await AutoProcessor.from_pretrained('Xenova/dinov2-small', { revision: 'main' });
    const model = await AutoModel.from_pretrained('Xenova/dinov2-small', {
      revision: 'main',
      quantized: false,
      dtype: 'fp32',
    });
    // Restore previous setting
    env.backends.onnx.executionProviders = prevEP;
    return true;
  } catch (err) {
    env.backends.onnx.executionProviders = prevEP;
    return false;
  }
}

/**
 * Detect available GPU and optionally test DirectML support.
 *
 * @param {{ quick?: boolean }} [opts]
 *   quick=true — nvidia-smi only (~100ms). Skips testDirectML (loads a full ONNX model).
 *   quick=false — full probe including DirectML (slow on first run).
 * @returns {Promise<{available: boolean, name: string|null, type: 'nvidia'|'directml'|null, vram: number, dmlTested?: boolean}>}
 */
async function detectGPU(opts = {}) {
  const quick = !!opts.quick;
  if (_cachedGPU) {
    if (quick) return _cachedGPU;
    if (_cachedGPU.dmlTested) return _cachedGPU;
  }

  const result = {
    available: false,
    name: null,
    type: null,
    vram: 0,
    dmlTested: !quick,
  };

  const nvidia = await _detectNvidia();
  if (nvidia) {
    result.name = nvidia.name;
    result.vram = nvidia.vram;
    result.type = 'nvidia';
    // NVIDIA present — likely DML-capable on Windows; avoid blocking startup test.
    if (quick) {
      result.available = true;
      _cachedGPU = result;
      return result;
    }
  }

  if (!quick) {
    const dmlWorks = await testDirectML();
    if (dmlWorks) {
      result.available = true;
      if (!result.name) result.name = 'DirectML-compatible GPU';
      if (!result.type) result.type = 'directml';
    }
    result.dmlTested = true;
  }

  _cachedGPU = result;
  return result;
}

/** Run the expensive DirectML load test (call after UI is up). */
async function detectDirectML() {
  const base = await detectGPU({ quick: true });
  if (base.dmlTested && base.available) return base;
  const dmlWorks = await testDirectML();
  const result = { ...base, dmlTested: true, available: base.available || dmlWorks };
  if (dmlWorks) {
    if (!result.name) result.name = 'DirectML-compatible GPU';
    if (!result.type) result.type = 'directml';
  }
  _cachedGPU = result;
  return result;
}

/**
 * Return cached GPU status without re-running detection.
 */
function getGPUStatus() {
  return _cachedGPU || { available: false, name: null, type: null, vram: 0 };
}

module.exports = {
  detectGPU,
  detectDirectML,
  testDirectML,
  getGPUStatus,
};
