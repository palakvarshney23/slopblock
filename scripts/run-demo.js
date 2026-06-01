#!/usr/bin/env node
/**
 * Start the headless classify service for demo.html (no Electron).
 * Runs model verification + port preflight first.
 */

const { verifyModels } = require('./verify-models');
const { preflight } = require('./preflight');

async function main() {
  await verifyModels({ repair: true, warn: true });

  const pf = await preflight({ demo: true, openDemo: false });
  if (pf.action === 'reuse') {
    console.log('[SlopBlock] Demo ready — service already listening.');
    const { openDemoHtml } = require('./preflight');
    openDemoHtml();
    return;
  }
  if (pf.action === 'port-conflict') {
    process.exit(1);
  }

  const classifier = require('../classifier');
  const service = require('../service');

  await classifier.loadModel(() => {}, () => {});
  await service.start(() => {});
  console.log('[SlopBlock] Demo service running on http://127.0.0.1:8083');
  console.log('[SlopBlock] Open demo.html — Ctrl+C to stop.');
  const { openDemoHtml } = require('./preflight');
  openDemoHtml();
}

main().catch((err) => {
  console.error('[SlopBlock] Demo failed:', err.message);
  process.exit(1);
});
