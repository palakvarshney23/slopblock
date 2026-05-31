// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// service.js — POST /classify, POST /classify-image, GET /status · port 8083, localhost only.

const http   = require('http');
const crypto = require('crypto');
const { isAiSlop, isAiImage, isAiImageFromBuffer } = require('./classifier');
const { classifyVideoFrames, isVideoClassifierReady, classifyVideo } = require('./video_classifier');
const { debugLog, logError } = require('./logger');
const state  = require('./state');
const counts = require('./counts');
const config = require('./config');

const PORT = Number(process.env.SLOPBLOCK_PORT) || 8083;
let server = null;

// ── Startup request token ──────────────────────────────────────────
// Generated once at process start. The extension reads it from the shared
// state and must send it as X-SlopFilter-Token on every request.
// Prevents arbitrary web pages from calling the local API even if they
// discover the port — they cannot read the token from the extension's context.
const SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');

// Exposed so main.js can pass it to the extension via IPC / injected config.
function getServiceToken() { return SERVICE_TOKEN; }

// ── Token-bucket rate limiter ──────────────────────────────────────
// Protects model inference from being flooded. Two independent buckets:
//   text:  20 requests/s — fast model, higher throughput
//   image:  5 requests/s — slow model + network fetch
// Buckets refill continuously; burst up to the full capacity is allowed.
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity     = capacity;
    this.tokens       = capacity;
    this.refillPerMs  = refillPerSec / 1000;
    this.lastRefill   = Date.now();
  }
  take() {
    const now  = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

let _textBucket  = null;
let _imageBucket = null;

function start(safeSend) {
  if (server) return;
  _textBucket  = new TokenBucket(config.get('textRateLimitPerSec'),  config.get('textRateLimitPerSec'));
  _imageBucket = new TokenBucket(config.get('imageRateLimitPerSec'), config.get('imageRateLimitPerSec'));

  server = http.createServer(async (req, res) => {
    // ── CORS — only allow the extension's own origin ───────────────
    // Chrome enforces Origin headers on cross-origin fetches, so web pages
    // cannot spoof a chrome-extension:// origin. Requests with no Origin
    // (e.g. same-origin, curl during dev) are allowed through.
    const origin = req.headers['origin'] || '';
    const originOk = !origin || origin.startsWith('chrome-extension://');
    if (!originOk) {
      res.writeHead(403); res.end(); return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SlopFilter-Token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    // ── GET /status ────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/status') {
      const data = {
        enabled: state.FILTER_ENABLED,
        imageDetectionEnabled: state.IMAGE_DETECTION_ENABLED,
        videoDetectionEnabled: state.VIDEO_DETECTION_ENABLED,
        youtubeFilterEnabled: state.YOUTUBE_FILTER_ENABLED,
        textBlocked: state.filteredCount || 0,
        imagesBlocked: state.imagesBlocked || 0,
        youtubeBlocked: state.youtubeBlocked || 0,
        textAnalyzed: state.textAnalyzed || 0,
        imagesAnalyzed: state.imagesAnalyzed || 0,
        youtubeAnalyzed: state.youtubeAnalyzed || 0,
        trustedPatterns: state.TRUSTED_PATTERNS || [],
        bypassDomains: state.BYPASS_DOMAINS || [],
        // Extension-relevant config subset — applied by content.js on next poll.
        config: {
          textThreshold:        config.get('textThreshold'),
          textMinLength:        config.get('textMinLength'),
          imageThresholdPhoto:  config.get('imageThresholdPhoto'),
          imageThresholdArt:    config.get('imageThresholdArt'),
          imageMinNaturalPx:    config.get('imageMinNaturalPx'),
          imageMinDisplayPx:    config.get('imageMinDisplayPx'),
          imageForceConfidence: config.get('imageForceConfidence'),
          videoWarnThreshold:   config.get('videoWarnThreshold'),
          videoBlockThreshold:  config.get('videoBlockThreshold'),
        },
        videoWarnThreshold:  Math.round(config.get('videoWarnThreshold') * 100),
        videoBlockThreshold: Math.round(config.get('videoBlockThreshold') * 100),
      };
      // Always return the bootstrap token — the service only listens on 127.0.0.1 so
      // all callers are local. Cross-origin POST routes are still protected by the
      // CORS origin check above, so web pages cannot call /classify even with the token.
      data.token = SERVICE_TOKEN;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // ── Token validation ───────────────────────────────────────────
    const incomingToken = req.headers['x-slopfilter-token'] || '';
    const tokenRequired = req.method === 'POST' && (
      req.url === '/classify' || req.url === '/classify-image' || req.url === '/classify-frame'
        || req.url === '/classify-video' || req.url === '/youtube-block'
    );
    if (tokenRequired && incomingToken !== SERVICE_TOKEN) {
      res.writeHead(401); res.end(); return;
    }

    // ── POST /youtube-block ────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/youtube-block') {
      state.youtubeBlocked++;
      state.youtubeAnalyzed++;
      safeSend('youtube-count', state.youtubeBlocked);
      safeSend('youtube-analyzed', state.youtubeAnalyzed);
      counts.schedule(state);
      safeSend('classification-entry', { ts: Date.now(), type: 'youtube', outcome: 'blocked', target: 'youtube.com', confidence: null });
      debugLog(`YouTube AI-disclosed video blocked (#${state.youtubeBlocked})`);
      res.writeHead(204); res.end();
      return;
    }

    // ── POST /classify ─────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/classify') {
      if (!_textBucket.take()) { res.writeHead(429); res.end(); return; }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50_000) { res.writeHead(413); res.end(); req.destroy(); return; }
      });
      req.on('end', async () => {
        if (res.destroyed) return;
        const text = body.trim();

        if (text.length < config.get('textMinLength') || !state.FILTER_ENABLED) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isSlop: false, confidence: 0 }));
          return;
        }

        try {
          state.textAnalyzed++;
          safeSend('text-analyzed', state.textAnalyzed);
          counts.schedule(state);
          const { confidence, method } = await isAiSlop(text);
          const isSlop = confidence > config.get('textThreshold');
          debugLog(`Text [${isSlop ? 'SLOP' : 'real'} ${Math.round(confidence * 100)}% ${method}]: "${text.slice(0, 80).replace(/\n/g, ' ')}"`);
          if (isSlop) {
            state.filteredCount++;
            safeSend('filter-count', state.filteredCount);
            counts.schedule(state);
          }
          if (isSlop || Math.random() < 0.15) safeSend('classification-entry', { ts: Date.now(), type: 'text', outcome: isSlop ? 'blocked' : 'passed', target: 'social feed', confidence: Math.round(confidence * 100) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isSlop, confidence: Math.round(confidence * 100), method }));
        } catch (err) {
          logError(err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isSlop: false, confidence: 0 }));
        }
      });
      return;
    }

    // ── POST /classify-image ───────────────────────────────────────
    if (req.method === 'POST' && req.url === '/classify-image') {
      if (!_imageBucket.take()) { res.writeHead(429); res.end(); return; }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 4096) { res.writeHead(413); res.end(); req.destroy(); return; }
      });
      req.on('end', async () => {
        if (res.destroyed) return;

        const imageUrl = body.trim();
        const ok = (u) => u.startsWith('http://') || u.startsWith('https://');

        if (!imageUrl || !ok(imageUrl) || !state.FILTER_ENABLED || !state.IMAGE_DETECTION_ENABLED) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiImage: false, confidence: 0 }));
          return;
        }

        try {
          state.imagesAnalyzed++;
          safeSend('images-analyzed', state.imagesAnalyzed);
          counts.schedule(state);
          const { score, style } = await isAiImage(imageUrl);
          const threshold = style === 'photo'
            ? config.get('imageThresholdPhoto')
            : config.get('imageThresholdArt');
          const isAi = score > threshold;
          if (isAi) {
            state.imagesBlocked++;
            safeSend('images-count', state.imagesBlocked);
            counts.schedule(state);
          }
          let _imgHost = imageUrl; try { _imgHost = new URL(imageUrl).hostname; } catch (_) {}
          safeSend('classification-entry', { ts: Date.now(), type: 'image', outcome: isAi ? 'blocked' : 'passed', target: _imgHost, confidence: Math.round(score * 100) });
          debugLog(`Image [${isAi ? 'AI' : 'real'} ${Math.round(score * 100)}% style=${style} thresh=${threshold}]: ${imageUrl.slice(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiImage: isAi, confidence: Math.round(score * 100), method: 'model', style }));
        } catch (err) {
          logError(err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiImage: false, confidence: 0 }));
        }
      });
      return;
    }

    // ── POST /classify-frame ───────────────────────────────────────
    // Accepts a base64 data URI captured from a <video> canvas snapshot.
    if (req.method === 'POST' && req.url === '/classify-frame') {
      if (!_imageBucket.take()) { res.writeHead(429); res.end(); return; }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 300_000) { res.writeHead(413); res.end(); req.destroy(); return; }
      });
      req.on('end', async () => {
        if (res.destroyed) return;

        if (!state.FILTER_ENABLED || !state.IMAGE_DETECTION_ENABLED) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiImage: false, confidence: 0 }));
          return;
        }

        try {
          const dataUri = body.trim();
          if (!dataUri.startsWith('data:image/')) {
            res.writeHead(400); res.end(); return;
          }
          const base64 = dataUri.split(',')[1];
          if (!base64) { res.writeHead(400); res.end(); return; }
          const imageBuffer = Buffer.from(base64, 'base64');

          state.imagesAnalyzed++;
          safeSend('images-analyzed', state.imagesAnalyzed);
          counts.schedule(state);

          const { score, style, skipped } = await isAiImageFromBuffer(imageBuffer);
          const frameBoost = 0.05;
          const artThresh  = config.get('imageThresholdArt') + frameBoost;
          const photoThresh = config.get('imageThresholdPhoto') + frameBoost;
          const threshold = style === 'photo' ? photoThresh : Math.max(artThresh, photoThresh);
          const isAi = !skipped && style !== 'screenshot' && style !== 'flat' && score > threshold;
          if (isAi) {
            state.imagesBlocked++;
            safeSend('images-count', state.imagesBlocked);
            counts.schedule(state);
          }
          safeSend('classification-entry', { ts: Date.now(), type: 'image', outcome: isAi ? 'blocked' : 'passed', target: 'video frame', confidence: Math.round(score * 100) });
          debugLog(`Frame [${isAi ? 'AI' : 'real'} ${Math.round(score * 100)}% style=${style} thresh=${threshold}]`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            isAiImage: isAi,
            confidence: Math.round(score * 100),
            method: 'model',
            style,
            skipped: !!skipped,
          }));
        } catch (err) {
          logError(err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiImage: false, confidence: 0, skipped: false }));
        }
      });
      return;
    }

    // ── POST /classify-video ───────────────────────────────────────
    // Accepts JSON { frames: ["data:image/jpeg;base64,...", ...] } from the extension.
    if (req.method === 'POST' && req.url === '/classify-video') {
      if (!_imageBucket.take()) { res.writeHead(429); res.end(); return; }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1_500_000) { res.writeHead(413); res.end(); req.destroy(); return; }
      });
      req.on('end', async () => {
        if (res.destroyed) return;

        if (!state.FILTER_ENABLED || !state.VIDEO_DETECTION_ENABLED) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiVideo: false, confidence: 0, method: 'clip-linear-probe', framesAnalyzed: 0, skipped: true }));
          return;
        }

        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_) {
          res.writeHead(400); res.end(); return;
        }

        if (!payload || !Array.isArray(payload.frames) || !payload.frames.length) {
          res.writeHead(400); res.end(); return;
        }

        try {
          const frames5 = [];
          for (const frame of payload.frames) {
            if (typeof frame !== 'string' || !frame.startsWith('data:image/')) continue;
            frames5.push(frame);
          }
          if (!frames5.length) {
            res.writeHead(400); res.end(); return;
          }

          const frames8 = [];
          if (Array.isArray(payload.frames8)) {
            for (const frame of payload.frames8) {
              if (typeof frame !== 'string' || !frame.startsWith('data:image/')) continue;
              frames8.push(frame);
            }
          }

          state.imagesAnalyzed++;
          safeSend('images-analyzed', state.imagesAnalyzed);
          counts.schedule(state);

          const result = await classifyVideo(frames5, frames8.length ? frames8 : null);
          const skipped = !isVideoClassifierReady();
          const score = result.score ?? 0;
          const confidence = Math.round(score * 100);
          const threshold = config.get('videoWarnThreshold');
          const isAiVideo = !skipped && score >= threshold;
          const method = `dinov2-${result.phase?.toLowerCase() || 'unknown'}`;
          const framesAnalyzed = result.twoStage ? frames8.length : frames5.length;

          if (isAiVideo) {
            state.imagesBlocked++;
            safeSend('images-count', state.imagesBlocked);
            counts.schedule(state);
          }
          safeSend('classification-entry', {
            ts: Date.now(),
            type: 'image',
            outcome: isAiVideo ? 'blocked' : 'passed',
            target: 'video clip',
            confidence,
          });
          debugLog(`Video [${isAiVideo ? 'AI' : 'real'} ${confidence}% method=${method} frames=${framesAnalyzed} twoStage=${result.twoStage} phase=${result.phase} skipped=${skipped}]`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            isAiVideo,
            confidence,
            method,
            framesAnalyzed,
            skipped,
            phase: result.phase,
            twoStage: result.twoStage,
            latencyMs: result.latencyMs,
          }));
        } catch (err) {
          logError(err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isAiVideo: false, confidence: 0, method: 'clip-linear-probe', framesAnalyzed: 0, skipped: true }));
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') logError(new Error(`Port ${PORT} already in use — service failed to start`));
    else logError(err);
  });

  server.listen(PORT, '127.0.0.1', () => debugLog(`Service running on http://127.0.0.1:${PORT}`));
}

function stop() {
  server?.close();
  server = null;
}

module.exports = { start, stop, PORT, getServiceToken };
