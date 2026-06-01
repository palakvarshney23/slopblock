#!/usr/bin/env node
/** Pre-start checks for Electron (npm start). */

const { verifyModels } = require('./verify-models');
const { preflight } = require('./preflight');

async function main() {
  await verifyModels({ repair: true, warn: true });
  const pf = await preflight({ demo: false });
  if (pf.action === 'port-conflict') process.exit(1);
  // blocked = another SlopBlock electron likely; single-instance lock handles it — proceed
  process.exit(0);
}

main().catch((err) => {
  console.error('[SlopBlock] prestart failed:', err.message);
  process.exit(1);
});
