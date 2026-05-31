// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// background.js - MV3 service worker — handles all HTTP requests to the local app server.
//
// Content scripts run in the page's security origin (e.g. https://x.com) and
// are blocked by Chrome's Private Network Access policy from fetching
// http://127.0.0.1. Background service workers run in the extension's own
// origin and are exempt from that restriction.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI Slop Filter] Extension installed');
});

const BASE = 'http://127.0.0.1:8083';

// Cached per service worker lifecycle — fetched once from /status.
let _serviceToken = '';

function _tokenHeaders(extra) {
  const h = { 'Content-Type': 'text/plain' };
  if (_serviceToken) h['X-SlopFilter-Token'] = _serviceToken;
  return Object.assign(h, extra);
}

// Fetch the token if we don't have one yet (happens on service worker restart).
async function _ensureToken() {
  if (_serviceToken) return;
  try {
    const r = await fetch(BASE + '/status', { signal: AbortSignal.timeout(800) });
    const data = await r.json();
    if (data.token) _serviceToken = data.token;
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  console.log('[SlopBlock BG]', msg.type, 'from', sender?.tab?.url || 'popup');
  if (msg.type === 'status') {
    fetch(BASE + '/status', { signal: AbortSignal.timeout(800) })
      .then(r => r.json())
      .then(data => {
        if (data.token) _serviceToken = data.token;
        respond({ ok: true, data });
      })
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === 'classify') {
    _ensureToken()
      .then(() => fetch(BASE + '/classify', {
        method: 'POST',
        body: msg.text,
        headers: _tokenHeaders(),
        signal: AbortSignal.timeout(10000),
      }))
      .then(r => r.ok ? r.json() : null)
      .then(data => respond(data ? { ok: true, data } : { ok: false }))
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === 'youtubeBlock') {
    fetch(BASE + '/youtube-block', { method: 'POST', headers: _tokenHeaders(), signal: AbortSignal.timeout(800) })
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === 'classifyImage') {
    _ensureToken()
      .then(() => fetch(BASE + '/classify-image', {
        method: 'POST',
        body: msg.url,
        headers: _tokenHeaders(),
        signal: AbortSignal.timeout(20000),
      }))
      .then(r => r.ok ? r.json() : null)
      .then(data => respond(data ? { ok: true, data } : { ok: false }))
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === 'classifyFrame') {
    _ensureToken()
      .then(() => fetch(BASE + '/classify-frame', {
        method: 'POST',
        body: msg.dataUri,
        headers: _tokenHeaders(),
        signal: AbortSignal.timeout(20000),
      }))
      .then(r => r.ok ? r.json() : null)
      .then(data => respond(data ? { ok: true, data } : { ok: false }))
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (msg.type === 'classifyVideo') {
    _ensureToken()
      .then(() => fetch(BASE + '/classify-video', {
        method: 'POST',
        body: JSON.stringify({
          frames: msg.frames,
          ...(Array.isArray(msg.frames8) && msg.frames8.length ? { frames8: msg.frames8 } : {}),
        }),
        headers: { ..._tokenHeaders(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
      }))
      .then(r => r.ok ? r.json() : null)
      .then(data => respond(data ? { ok: true, data } : { ok: false }))
      .catch(() => respond({ ok: false }));
    return true;
  }
});
