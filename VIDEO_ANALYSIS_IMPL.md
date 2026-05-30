# Video / Reel Analysis — Implementation Guide

**Target:** SlopBlock browser extension + Electron service  
**Status:** Signals 1–3 implemented (metadata/hashtags, captions, frame sampling). Signal 4 (Whisper) not implemented.  
**Estimated effort by tier:** see each section

---

## Overview

Four independent signals can be extracted from videos without ever downloading the video file itself. They are ordered from easiest to hardest and can be shipped independently — each one adds value on its own.

| Signal | Effort | Accuracy | New Files Needed |
|---|---|---|---|
| 1. Metadata & hashtag scan | ~2 hours | Low–Medium | None (extend `content.js`) |
| 2. Caption / subtitle text | ~6 hours | Medium–High | None (extend `content.js` + `service.js`) |
| 3. Frame sampling (canvas) | ~2 days | Medium | Add `/classify-frame` to `service.js` |
| 4. Audio transcription (Whisper) | ~1 week | High | New `transcriber.js`, new `/transcribe` endpoint |

---

## Signal 1 — Metadata & Hashtag Detection

**What it catches:** Videos where the creator's own description is AI-generated text, and videos tagged `#AIGenerated`, `#MadeWithAI`, `#AIArt`, `#SynthID`, `#AIContent`.

**Where to add it:** `extension/content.js` — no other files need changing.

### Platform selectors

```js
// Add these to a new VIDEO_META_SEL constant in content.js
const VIDEO_META_SEL = [
  // YouTube — video title and description on watch page
  'h1.ytd-watch-metadata yt-formatted-string',
  '#description-inner yt-attributed-string',
  '#above-the-fold #title',

  // TikTok — caption below video player
  '[data-e2e="browse-video-desc"]',
  '[class*="DivVideoDesc"]',
  'h1[data-e2e="video-desc"]',

  // Instagram Reels — caption under reel
  '._a9zs',                      // caption text span
  '[class*="C4VMK"] span',       // older layout
  'article div[role="button"] span',  // fallback

  // X/Twitter — tweet text attached to video card
  '[data-testid="tweetText"]',   // already in TEXT_SEL — covered

  // Facebook Reels — story caption
  '[data-ad-preview="message"]',
  '[class*="kvgmc6g5"]',         // FB uses obfuscated classes, volatile
].join(', ')
```

### AI disclosure hashtag detection

Add this helper alongside the existing `getSlopScore` call path in `content.js`:

```js
// Hashtags that platforms and creators use to disclose AI-generated content.
// Checked against the full text including description body — case-insensitive.
const AI_DISCLOSURE_TAGS = [
  '#aigenerated', '#aigeneratedcontent', '#aiart', '#aivideo',
  '#madewithAI', '#generatedbyai', '#synthai', '#synthid',
  '#artificialintelligence', '#notreal', '#deepfake',
  '#aicreated', '#aifilm', '#aianimation', '#soravideo',
  '#runwayml', '#klingai', '#pikaai', '#lumaai',
]

function hasAiDisclosureTag(text) {
  const lower = text.toLowerCase()
  return AI_DISCLOSURE_TAGS.some(tag => lower.includes(tag))
}
```

### Integration point in `content.js`

Inside the MutationObserver batch loop (around line 1326), add video metadata scanning alongside the existing `classifyText` loop:

```js
// After existing text/image scanning:
const videoEls = node.matches?.('video') ? [node] : [...node.querySelectorAll('video')]
for (const vid of videoEls) watchVideo(vid)

const metaEls = node.matches?.(VIDEO_META_SEL)
  ? [node]
  : [...node.querySelectorAll(VIDEO_META_SEL)]
for (const el of metaEls) classifyVideoMeta(el)
```

```js
async function classifyVideoMeta(el) {
  if (el.dataset.sfVideoMetaChecked) return
  el.dataset.sfVideoMetaChecked = 'true'
  const text = (el.innerText || el.textContent || '').trim()
  if (!text || text.length < 30) return

  // Fast-path: explicit AI hashtag disclosure — no model call needed
  if (hasAiDisclosureTag(text)) {
    const card = findCardBoundary(el)
    if (card) blurCard(card, 99, 'hashtag')
    return
  }

  // Normal path: send description text through text classifier
  await classifyText(el)
}
```

**No changes to `service.js`, `background.js`, or `classifier.js` are needed for this signal.**

---

## Signal 2 — Caption / Subtitle Text Extraction

**What it catches:** AI-generated voiceover scripts. AI content farms use TTS to read LLM-generated copy — the text classifier catches the script even if the video itself is real footage.

**How it works:** Captions render as DOM text nodes. The existing `/classify` endpoint handles them once they are extracted.

### New constant in `content.js`

```js
// Live caption elements — updated in real time as video plays.
// These are DIFFERENT from description text (Signal 1).
const CAPTION_SEL = [
  // YouTube — auto-generated and manual captions
  '.ytp-caption-segment',

  // TikTok — on-screen auto captions (must be enabled by user)
  '[class*="SubtitleText"]',
  '[data-e2e="video-subtitle"]',

  // Instagram — closed captions overlay on Reels
  '[class*="x1lliihq"]',     // caption container (volatile, verify against live DOM)

  // Facebook — auto-generated caption overlay
  '[class*="captionsText"]',
  '.story-inline-caption',
].join(', ')
```

### Batch captioning logic

Captions update every ~1–2 seconds during playback. Classifying every segment individually would flood the API. Buffer them first:

```js
// Map of videoElement → { buffer: string[], timer: id }
const _captionBuffers = new WeakMap()
const CAPTION_FLUSH_MS   = 8000   // flush after 8 s of silence or buffer full
const CAPTION_MIN_WORDS  = 40     // don't classify until we have enough text
const CAPTION_MAX_BUFFER = 400    // ~400 words before forced flush

async function _flushCaptionBuffer(videoEl, bufferEntry) {
  const text = bufferEntry.buffer.join(' ').trim()
  bufferEntry.buffer = []
  bufferEntry.timer  = null
  if (!text || text.split(/\s+/).length < CAPTION_MIN_WORDS) return

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'classify', text })
    if (resp?.ok && resp.data?.isSlop) {
      // Find the card containing this video and blur it
      const card = findCardBoundary(videoEl) || videoEl.closest('article, [role="article"]')
      if (card && !card.dataset.sfCardBlurred) {
        blurCard(card, resp.data.confidence, resp.data.method + '+caption')
      }
    }
  } catch (_) {}
}

function onCaptionSegment(text, videoEl) {
  if (!text || !videoEl) return
  let entry = _captionBuffers.get(videoEl)
  if (!entry) {
    entry = { buffer: [], timer: null }
    _captionBuffers.set(videoEl, entry)
  }
  entry.buffer.push(text)
  const wordCount = entry.buffer.join(' ').split(/\s+/).length

  if (entry.timer) clearTimeout(entry.timer)

  if (wordCount >= CAPTION_MAX_BUFFER) {
    _flushCaptionBuffer(videoEl, entry)
  } else {
    entry.timer = setTimeout(() => _flushCaptionBuffer(videoEl, entry), CAPTION_FLUSH_MS)
  }
}
```

### Wiring the caption observer

Add this to the startup block (around line 1366) and to `onNavigate()`:

```js
function watchCaptions() {
  const captionObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        const segs = node.matches?.(CAPTION_SEL)
          ? [node]
          : [...node.querySelectorAll(CAPTION_SEL)]
        for (const seg of segs) {
          const text = (seg.innerText || seg.textContent || '').trim()
          if (!text) continue
          // Find nearest video element to associate caption with its card
          const videoEl = document.querySelector('video') // closest heuristic
          onCaptionSegment(text, videoEl)
        }
      }
    }
  })
  captionObserver.observe(document.body, { childList: true, subtree: true })
}
```

**No changes to `service.js`, `background.js`, or `classifier.js` are needed — this reuses the existing `classify` message path.**

---

## Signal 3 — Video Frame Sampling

**What it catches:** AI-generated b-roll, slideshow videos assembled from Midjourney/DALL-E images, AI avatar videos (HeyGen, Synthesia), AI-generated landscapes used as backgrounds.

**What it does NOT catch:** Real footage + AI voiceover (use Signal 2 for that). Real-time temporal artifact detection in motion is not feasible with still-image classifiers.

### New service endpoint — `service.js`

Add a `/classify-frame` route between the existing `/classify-image` handler and the final 404:

```js
// ── POST /classify-frame ────────────────────────────────────────
// Accepts a base64 data URI (image/jpeg or image/png) captured from
// a <video> element via canvas.drawImage(). Max payload ~200 KB
// (320×180 JPEG at quality 0.7 is typically 8–25 KB).
if (req.method === 'POST' && req.url === '/classify-frame') {
  if (!_imageBucket.take()) { res.writeHead(429); res.end(); return }
  let body = ''
  req.on('data', chunk => {
    body += chunk
    if (body.length > 300_000) { res.writeHead(413); res.end(); req.destroy(); return }
  })
  req.on('end', async () => {
    if (res.destroyed) return
    if (!state.IMAGE_DETECTION_ENABLED || !state.FILTER_ENABLED) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ isAiImage: false, confidence: 0 }))
      return
    }
    try {
      const dataUri = body.trim()
      if (!dataUri.startsWith('data:image/')) {
        res.writeHead(400); res.end(); return
      }
      // Strip the data URI prefix and decode to a Buffer
      const base64 = dataUri.split(',')[1]
      if (!base64) { res.writeHead(400); res.end(); return }
      const imageBuffer = Buffer.from(base64, 'base64')

      state.imagesAnalyzed++
      safeSend('images-analyzed', state.imagesAnalyzed)
      counts.schedule(state)

      // isAiImageFromBuffer is the new classifier.js export (see below)
      const { score, style } = await classifier.isAiImageFromBuffer(imageBuffer)
      const threshold = style === 'photo'
        ? config.get('imageThresholdPhoto')
        : config.get('imageThresholdArt')
      const isAi = score > threshold

      if (isAi) {
        state.imagesBlocked++
        safeSend('images-count', state.imagesBlocked)
        counts.schedule(state)
      }
      debugLog(`Frame [${isAi ? 'AI' : 'real'} ${Math.round(score * 100)}% style=${style}]: video frame`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ isAiImage: isAi, confidence: Math.round(score * 100), method: 'model', style }))
    } catch (err) {
      logError(err)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ isAiImage: false, confidence: 0 }))
    }
  })
  return
}
```

### New classifier function — `classifier.js`

The existing `isAiImage(url)` fetches an image via HTTP. Add a companion that accepts a `Buffer` directly (already decoded):

```js
/**
 * Classify an image already in memory as a Buffer.
 * Used by /classify-frame for video frames captured via canvas.
 * Reuses the same ONNX ensemble as isAiImage().
 */
async function isAiImageFromBuffer(buffer) {
  // sharp already handles Buffer input — same pipeline as isAiImage
  // but skips the HTTP fetch step.
  return _classifyImageBuffer(buffer)
}

module.exports = { isAiSlop, isAiImage, isAiImageFromBuffer, loadModel, loadImageModel, isImageModelReady }
```

> **Note:** Look for the internal `_classifyImageBuffer(buffer)` helper that `isAiImage` already calls after fetching. If it does not yet exist as a separate function, extract the post-fetch classification logic into one. The fetch and the classification are independent — they just need splitting.

### New message type — `background.js`

```js
if (msg.type === 'classifyFrame') {
  _ensureToken()
    .then(() => fetch(BASE + '/classify-frame', {
      method: 'POST',
      body: msg.dataUri,   // base64 data URI from canvas
      headers: _tokenHeaders(),
      signal: AbortSignal.timeout(20000),
    }))
    .then(r => r.ok ? r.json() : null)
    .then(data => respond(data ? { ok: true, data } : { ok: false }))
    .catch(() => respond({ ok: false }))
  return true
}
```

### Frame capture in `content.js`

```js
// Track which video elements have already been sampled.
const _sampledVideos = new WeakSet()

// Sample up to FRAME_SAMPLE_COUNT evenly-spaced frames from a video.
// Called once per video when it first becomes visible (IntersectionObserver).
const FRAME_SAMPLE_COUNT = 3  // 3 frames: 10%, 50%, 90% through duration
const FRAME_WIDTH        = 320
const FRAME_HEIGHT       = 180
const FRAME_QUALITY      = 0.72

async function sampleVideoFrames(videoEl) {
  if (_sampledVideos.has(videoEl)) return
  if (!videoEl.duration || videoEl.duration < 2) return  // skip clips < 2 s
  _sampledVideos.add(videoEl)

  const canvas = document.createElement('canvas')
  canvas.width  = FRAME_WIDTH
  canvas.height = FRAME_HEIGHT
  const ctx = canvas.getContext('2d')

  const positions = [0.1, 0.5, 0.9]  // 10%, 50%, 90% of duration
  const frames = []

  for (const pos of positions) {
    await new Promise(resolve => {
      videoEl.currentTime = videoEl.duration * pos
      videoEl.addEventListener('seeked', resolve, { once: true })
    })
    ctx.drawImage(videoEl, 0, 0, FRAME_WIDTH, FRAME_HEIGHT)
    frames.push(canvas.toDataURL('image/jpeg', FRAME_QUALITY))
  }

  // Classify each frame; stop early on first AI detection
  let aiVotes = 0
  let totalConfidence = 0
  for (const dataUri of frames) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'classifyFrame', dataUri })
      if (resp?.ok && resp.data?.isAiImage) {
        aiVotes++
        totalConfidence += resp.data.confidence
      }
    } catch (_) {}
  }

  // Require majority vote across frames to avoid false positives from a single frame
  if (aiVotes >= 2) {
    const avgConf = Math.round(totalConfidence / aiVotes)
    const card = findCardBoundary(videoEl) || videoEl.closest('article, [role="article"]')
    if (card && !card.dataset.sfCardBlurred) {
      blurCard(card, avgConf, 'frame-model')
    }
  }
}

// IntersectionObserver for videos — fires once when video enters viewport
const videoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const vid = entry.target
    videoObserver.unobserve(vid)
    // Wait for metadata (duration) to be available
    if (vid.readyState >= 1) {
      sampleVideoFrames(vid)
    } else {
      vid.addEventListener('loadedmetadata', () => sampleVideoFrames(vid), { once: true })
    }
  }
}, { rootMargin: '200px' })

function watchVideo(vid) {
  if (_sampledVideos.has(vid)) return
  if (vid.dataset.sfVideoWatching) return
  vid.dataset.sfVideoWatching = 'true'
  videoObserver.observe(vid)
}
```

Add `watchVideo` calls in the existing startup block and MutationObserver alongside `watchImage`:

```js
// In MutationObserver batch (line ~1329):
const vids = node.matches?.('video') ? [node] : [...node.querySelectorAll('video')]
for (const vid of vids) watchVideo(vid)

// In startup setTimeout (line ~1372):
document.querySelectorAll('video').forEach(watchVideo)
```

### Manifest update — `extension/manifest.json`

No new permissions needed. The frame data never leaves the local machine; it goes to `http://127.0.0.1:8083` which is already covered by `host_permissions`.

---

## Signal 4 — Audio Transcription via Whisper (Advanced)

**What it catches:** Any AI-generated speech content, regardless of whether captions exist. The most powerful signal — covers voiceover farms that disable captions.

**Prerequisites:** This is the most involved change. Read all of it before starting.

### Model choice

| Model | Size | Speed (CPU) | Language |
|---|---|---|---|
| `xenova/whisper-tiny.en` | ~75 MB | ~3× realtime | English only |
| `xenova/whisper-tiny` | ~150 MB | ~3× realtime | Multilingual |
| `xenova/whisper-base.en` | ~140 MB | ~7× realtime | English only |

**Recommendation:** `xenova/whisper-tiny.en` — already available on HuggingFace as an ONNX model, loads with the same `@huggingface/transformers` library already used for text and image models.

### New file — `transcriber.js`

```js
// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// transcriber.js — on-device audio transcription using Whisper tiny.en (ONNX).
// Loaded lazily; the pipeline is not created until the first /transcribe request.

const { pipeline, env } = require('@huggingface/transformers')
const { debugLog, logError } = require('./logger')

const WHISPER_MODEL = 'xenova/whisper-tiny.en'
let _pipe = null
let _loading = false
let _loadCallbacks = []

/**
 * Load the Whisper pipeline. Safe to call multiple times — returns immediately
 * if already loaded. Callers await the returned promise.
 */
async function loadTranscriber(onStatus) {
  if (_pipe) return
  if (_loading) {
    return new Promise(resolve => _loadCallbacks.push(resolve))
  }
  _loading = true
  onStatus?.('Loading speech recognition model (Whisper tiny, ~75 MB)…')
  try {
    _pipe = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      progress_callback: prog => {
        if (prog.status === 'downloading') {
          const pct = Math.round((prog.loaded / prog.total) * 100)
          onStatus?.(`Downloading Whisper model… ${pct}%`)
        }
      },
    })
    debugLog('Whisper model loaded')
    onStatus?.('Speech recognition ready')
  } catch (err) {
    logError(err)
    _loading = false
    throw err
  }
  _loading = false
  _loadCallbacks.forEach(cb => cb())
  _loadCallbacks = []
}

/**
 * Transcribe raw PCM audio.
 * @param {Float32Array} pcmData — 16 kHz mono float32 samples
 * @returns {string} transcription text
 */
async function transcribe(pcmData) {
  if (!_pipe) throw new Error('Whisper not loaded — call loadTranscriber first')
  const result = await _pipe(pcmData, {
    sampling_rate: 16000,
    return_timestamps: false,
  })
  return result.text?.trim() || ''
}

function isReady() { return !!_pipe }

module.exports = { loadTranscriber, transcribe, isReady }
```

### New service endpoint — `service.js`

```js
const transcriber = require('./transcriber')

// ── POST /transcribe ────────────────────────────────────────────
// Accepts a JSON body: { pcm: Float32Array as plain Array, sampleRate: 16000 }
// Max payload: ~6 MB (30 seconds × 16000 samples × 4 bytes = 1.92 MB base64)
if (req.method === 'POST' && req.url === '/transcribe') {
  let body = ''
  req.on('data', chunk => {
    body += chunk
    if (body.length > 8_000_000) { res.writeHead(413); res.end(); req.destroy(); return }
  })
  req.on('end', async () => {
    if (res.destroyed) return
    try {
      const { pcm } = JSON.parse(body)
      if (!Array.isArray(pcm) || pcm.length < 1600) {
        res.writeHead(400); res.end(); return
      }
      const samples = new Float32Array(pcm)
      const text = await transcriber.transcribe(samples)
      debugLog(`Transcription (${pcm.length} samples): "${text.slice(0, 80)}"`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ text }))
    } catch (err) {
      logError(err)
      res.writeHead(500); res.end()
    }
  })
  return
}
```

### Audio capture in `content.js` — AudioWorklet approach

> **Why AudioWorklet and not MediaRecorder?** MediaRecorder produces compressed audio (webm/opus). Whisper needs raw 16 kHz PCM. AudioWorklet gives direct access to the raw float32 samples at the source sample rate, which we then downsample before sending.

**Step 1 — Create `extension/audio-processor.js`** (loaded as AudioWorklet module):

```js
// audio-processor.js — AudioWorkletProcessor for PCM capture.
// Runs in a dedicated audio rendering thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = []
    this._port = this.port
    this._port.onmessage = e => { if (e.data === 'flush') this._flush() }
  }

  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) this._buf.push(...ch)
    // Auto-flush every 30 s of audio (30 × 44100 ≈ 1.3 M samples)
    if (this._buf.length > 1_400_000) this._flush()
    return true
  }

  _flush() {
    if (this._buf.length === 0) return
    this._port.postMessage({ pcm: this._buf.slice() })
    this._buf = []
  }
}
registerProcessor('pcm-capture', PcmCapture)
```

**Step 2 — `content.js` audio tap:**

```js
// Map of videoElement → AudioContext (one per video)
const _audioContexts = new WeakMap()

async function tapVideoAudio(videoEl) {
  if (_audioContexts.has(videoEl)) return
  try {
    const ctx = new AudioContext({ sampleRate: 44100 })
    _audioContexts.set(videoEl, ctx)

    // Load the worklet from the extension bundle
    await ctx.audioWorklet.addModule(chrome.runtime.getURL('audio-processor.js'))

    const source    = ctx.createMediaElementSource(videoEl)
    const worklet   = new AudioWorkletNode(ctx, 'pcm-capture')
    const analyser  = ctx.createAnalyser()

    // source → worklet (capture) + analyser → destination (audible)
    source.connect(worklet)
    source.connect(analyser)
    analyser.connect(ctx.destination)

    worklet.port.onmessage = async e => {
      const rawPcm = e.data.pcm  // Float32 at 44100 Hz
      // Downsample to 16000 Hz (Whisper requirement)
      const pcm16k = _downsample(rawPcm, 44100, 16000)
      // Send to background → /transcribe → Whisper
      const resp = await chrome.runtime.sendMessage({ type: 'transcribe', pcm: Array.from(pcm16k) })
      if (resp?.ok && resp.data?.text) {
        const resp2 = await chrome.runtime.sendMessage({ type: 'classify', text: resp.data.text })
        if (resp2?.ok && resp2.data?.isSlop) {
          const card = findCardBoundary(videoEl) || videoEl.closest('article, [role="article"]')
          if (card && !card.dataset.sfCardBlurred) {
            blurCard(card, resp2.data.confidence, resp2.data.method + '+whisper')
          }
        }
      }
    }

    // Flush the buffer when video ends or pauses for > 5 s
    videoEl.addEventListener('ended', () => worklet.port.postMessage('flush'))
    videoEl.addEventListener('pause', () => setTimeout(() => {
      if (videoEl.paused) worklet.port.postMessage('flush')
    }, 5000))

  } catch (err) {
    _SF_DEBUG('audioTap', err)
  }
}

// Naive linear downsampler — sufficient for speech (not music)
function _downsample(pcm, fromRate, toRate) {
  const ratio  = fromRate / toRate
  const length = Math.floor(pcm.length / ratio)
  const out    = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = pcm[Math.floor(i * ratio)]
  }
  return out
}
```

**Step 3 — Add `audio-processor.js` to `extension/manifest.json`**

The worklet file must be accessible as a web accessible resource:

```json
"web_accessible_resources": [
  {
    "resources": ["audio-processor.js"],
    "matches": ["https://*/*", "http://*/*"]
  }
]
```

**Step 4 — Add `transcribe` message handler to `background.js`**

```js
if (msg.type === 'transcribe') {
  _ensureToken()
    .then(() => fetch(BASE + '/transcribe', {
      method: 'POST',
      body: JSON.stringify({ pcm: msg.pcm }),
      headers: { ..._tokenHeaders(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),  // Whisper can take up to 30 s for long clips
    }))
    .then(r => r.ok ? r.json() : null)
    .then(data => respond(data ? { ok: true, data } : { ok: false }))
    .catch(() => respond({ ok: false }))
  return true
}
```

**Step 5 — Lazy load Whisper in `main.js`**

Only load Whisper when the user explicitly enables it (same pattern as image models):

```js
function _startWhisperLoad() {
  const transcriber = require('./transcriber')
  transcriber.loadTranscriber(
    msg => safeSend('status-update', msg)
  ).catch(err => logger.logError(err))
}

// In IPC handlers:
ipcMain.on('toggle-video-transcription', () => {
  state.VIDEO_TRANSCRIPTION_ENABLED = !state.VIDEO_TRANSCRIPTION_ENABLED
  _saveSettings({ defaultVideoTranscription: state.VIDEO_TRANSCRIPTION_ENABLED })
  safeSend('video-transcription-status', state.VIDEO_TRANSCRIPTION_ENABLED)
  if (state.VIDEO_TRANSCRIPTION_ENABLED && !transcriber.isReady())
    _startWhisperLoad()
})
```

---

## State & UI additions

### `state.js` — add two new flags

```js
VIDEO_FRAME_DETECTION_ENABLED: false,   // frame sampling (Signal 3)
VIDEO_TRANSCRIPTION_ENABLED:   false,   // Whisper (Signal 4)
videosAnalyzed:  0,
videosBlocked:   0,
```

### `config.js` — add two new thresholds

```js
// Minimum video duration in seconds before frame sampling is attempted.
videoMinDurationSec: 3,

// Minimum caption buffer word count before sending to /classify.
videoCaptionMinWords: 40,
```

### Dashboard toggle (optional)

Add a "Video Detection" toggle to `index.html` alongside the existing Text / Image / YouTube toggles. The IPC pattern is identical to `toggle-image-detection`.

---

## Implementation order (recommended)

Ship in this order — each step is independently useful:

1. **Signal 1 (metadata/hashtags)** — 2 hours, zero risk, immediately catches declared AI content
2. **Signal 2 (captions)** — 6 hours, catches TTS voiceover farms on YouTube/TikTok
3. **Signal 3 (frame sampling)** — 2 days, requires new service endpoint and classifier function
4. **Signal 4 (Whisper)** — 1 week, heavy but catches everything Signals 1–3 miss

---

## Known Limitations

| Limitation | Affects | Mitigation |
|---|---|---|
| `createMediaElementSource` requires user gesture on some browsers | Signal 4 | Tap audio only on user-initiated play, not autoplay |
| TikTok / Instagram obfuscate CSS class names — selectors rot | Signals 1, 2 | Use `data-e2e` attributes where available; add a periodic selector health check |
| Frame seek interrupts playback briefly | Signal 3 | Only seek on paused video or when `readyState === 4`; restore `currentTime` after sampling |
| Whisper tiny has ~15% WER on accented speech | Signal 4 | Use `whisper-base.en` for better accuracy at 2× model size |
| Canvas CORS — `<video>` from a different origin marks canvas tainted | Signal 3 | `crossOrigin = 'anonymous'` on the video element; works if server sends `Access-Control-Allow-Origin: *` (most CDNs do) |
| Audio worklet not available in Firefox MV2 | Signal 4 | Gate on `typeof AudioWorkletNode !== 'undefined'`; fall back to caption-only |

---

*Last updated: 2026-05-28*
