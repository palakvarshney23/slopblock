#!/usr/bin/env node
/**
 * Pre-start check for port 8083 / existing SlopBlock service.
 * Usage:
 *   node scripts/preflight.js              # exit 0 if safe to start service
 *   node scripts/preflight.js --demo         # for npm run demo — reuse live service
 *   node scripts/preflight.js --open-demo    # open demo.html when reusing service
 */

const http = require('http');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.SLOPBLOCK_PORT) || 8083;
const ROOT = path.join(__dirname, '..');

function probeService() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: PORT, path: '/status', timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(res.statusCode === 200 && data.token ? data : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function isPortListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: PORT });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
}

function openDemoHtml() {
  const demo = path.join(ROOT, 'demo.html');
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', demo], { stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    spawnSync('open', [demo], { stdio: 'ignore' });
  } else {
    spawnSync('xdg-open', [demo], { stdio: 'ignore' });
  }
}

async function preflight(opts = {}) {
  const { demo = false, openDemo = false } = opts;
  const live = await probeService();

  if (live) {
    console.log(`[SlopBlock] Service already running on http://127.0.0.1:${PORT}`);
    if (demo) {
      console.log('[SlopBlock] Reusing existing service — not starting a second listener.');
      if (openDemo) openDemoHtml();
      return { action: 'reuse', port: PORT };
    }
    console.log('[SlopBlock] Another SlopBlock instance is active. Focus the tray app or quit before starting again.');
    return { action: 'blocked', port: PORT };
  }

  const busy = await isPortListening();
  if (busy) {
    console.error(`[SlopBlock] Port ${PORT} is in use but /status did not respond.`);
    console.error('           Another app may be bound to this port, or SlopBlock crashed.');
    console.error('           Windows: netstat -ano | findstr :8083  then  taskkill /PID <pid> /F');
    console.error('           Or quit SlopBlock from the system tray.');
    return { action: 'port-conflict', port: PORT };
  }

  return { action: 'proceed', port: PORT };
}

async function main() {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const openDemo = args.includes('--open-demo');
  const result = await preflight({ demo, openDemo });

  if (result.action === 'reuse') process.exit(0);
  if (result.action === 'blocked') process.exit(demo ? 0 : 1);
  if (result.action === 'port-conflict') process.exit(1);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { preflight, probeService, openDemoHtml, PORT };
