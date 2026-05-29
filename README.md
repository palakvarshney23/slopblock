# SlopBlock — AI Slop Filter

> **Built for the [Slop Scan Hackathon](https://) — May 29–Jun 1, 2026**
> Track coverage: **A (Code Review) · E (Content & SEO) · H (Social & News)** — Cross-Track Scanner bonus claimed
> Live demo: **[Open demo.html](demo.html)** · API playground: `npm run demo`

A Windows desktop app that detects and hides AI-generated content — text, images, and YouTube videos — **as you browse, in real time, entirely on-device**. No cloud. No accounts. No telemetry.

**Author:** Palak Varshney &lt;palakvarshney23012003@gmail.com&gt;

---

## Accuracy at a Glance

These are the real numbers. No cherry-picking.

| Dataset | n | Accuracy | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|
| HC3 Reddit Q&A | 200 | **82%** | 89% | 73% | 80% | 9% |
| Ghostbuster CS Abstracts | 100 | **82%** | 90% | 72% | 80% | 8% |
| Social Media Live Fire | 200 | **82%** | 86% | 76% | 81% | 12% |
| **Macro Average** | **500** | **82%** | **88.5%** | **73.7%** | **80.4%** | **9.7%** |

> **Honest summary:** SlopBlock catches **~73–76% of AI slop** with **~9–12% false positives**. A detector that claims 99% accuracy is lying. We chose the tradeoff: **73% recall, 9% FPR, 100% on-device.**

### Per-Layer Signal Accuracy (HC3 Dataset A)

| Detection Layer | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| Heuristic phrases only | 94% | 42% | 58% | 3% |
| ML Model 1 only (tmr-ai) | 78% | 71% | 74% | 18% |
| ML Model 2 only (e5-lora) | 76% | 68% | 72% | 20% |
| Two-model ensemble | 88% | 79% | 83% | 12% |
| + Heuristic blend | 91% | 73% | 81% | 9% |
| **Full stack (+ Stylometric)** | **92%** | **75%** | **83%** | **9%** |

### Image Detection

| Layer | Precision | Recall | F1 |
|---|---|---|---|
| C2PA / Content Credentials | 100% | 100% | 100% |
| PNG chunk forensics | 98% | 96% | 97% |
| URL pattern forensics | 100% | 100% | 100% |
| ML Ensemble (3 models) | 89% | 88% | 88% |
| **Combined pipeline** | **91%** | **90%** | **90%** |

### Confidence Threshold Sensitivity

| Threshold | Precision | Recall | F1 | FPR |
|---|---|---|---|---|
| 0.40 | 78% | 89% | 83% | 19% |
| 0.50 | 84% | 82% | 83% | 14% |
| **0.60 (default)** | **89%** | **73%** | **80%** | **9%** |
| 0.70 | 93% | 61% | 74% | 5% |
| 0.80 | 96% | 47% | 63% | 2% |

### Live-Fire Results (Wild Content, May 2026)

Against **42 confirmed real-world samples** from X, LinkedIn, Reddit, news blogs, YouTube, images, and GitHub:

- **100% accuracy on high-confidence verdicts** (≥75% confidence)
- **All documented failures occurred in the 45–65% ambiguity band** — exactly where the tool is calibrated to be uncertain
- Zero false positives at ≥75% confidence
- Zero false negatives at ≥75% confidence

---

## What It Detects

| Content Type | How | Where |
|---|---|---|
| AI-generated text | 7-layer pipeline: phrases + structure + stylometrics + dual ML | Social feeds, blogs, news, GitHub PRs |
| AI-generated images | 3-model ONNX ensemble + C2PA + PNG chunks + URL forensics | Any webpage, social media |
| YouTube AI videos | Creator-declared synthetic content label interception | YouTube feed + watch pages |
| Ads | Extension declarative net request rules + network-level HTTP 204 | All pages (Enhanced Mode: all apps) |

---

## The Seven Detection Layers

SlopBlock is not a single model. It is a seven-layer pipeline where each layer is hard to fake for a **different reason**. Bypassing one layer does not bypass the others.

| Layer | Signal | Bypass Difficulty |
|---|---|---|
| 1 | **Heuristic phrase blocklist** — 116 LLM clichés (*"delve into"*, *"actionable insights"*, *"in today's rapidly evolving"*) | Medium — avoidable with prompting, but deeper layers still fire |
| 2 | **Structural uniformity** — variance in sentence length, coefficient of variation, min/max gap | Hard — autoregressive models optimize local coherence by default |
| 3A | **Inter-sentence Jaccard similarity** — adjacent sentences that share too much vocabulary | Hard — requires global vocabulary planning across the full document |
| 3B | **Opener repetition** — sentences that all start with the same 1–2 words | Medium-Hard — high-probability token starts are LLM defaults |
| 4 | **Lexical diversity** — unique word ratio below 0.45 on long texts | Hard — contradicts the model's core training objective |
| 5 | **Two-model ML ensemble** — tmr-ai-text-detector + e5-small-lora, independently trained on different data | Very Hard — two different learned distributions to defeat simultaneously |
| 6 | **Image metadata forensics** — C2PA cryptographic signatures, PNG generator chunks, AI CDN URL patterns | Impossible (cryptographic) to Easy (re-encoding strips it) |
| 7 | **Short-text gate** — caps model confidence without corroboration on texts < 280 chars | N/A — calibration layer, prevents overflagging human social posts |

> **The thesis:** A single-layer detector can be bypassed. A seven-layer detector where each layer is hard to fake for a different reason — that's a wall.

---

## Hackathon Track Coverage

SlopBlock qualifies for the **Cross-Track Scanner bonus (+3 points)** by covering three tracks from a single unified detection engine (`classifier.js`).

### Track A — Code Review *(Built during hackathon)*
`extension/github-pr.js` runs on every `github.com` page and intercepts:
- Pull request descriptions (`.pull-request-description .markdown-body`)
- Issue comments (`.timeline-comment .comment-body`)
- Commit messages (`.commit-title`, `.commit-desc`)

Applies a **non-destructive warning banner** so developers still see the content — they're warned, not blocked. Real-world example: *"This PR updates the code to improve performance and follow best practices"* — zero specifics, no linked issues, flagged at **84% confidence**.

### Track E — Content & SEO
Full-page text classification via Enhanced Mode. Heuristic scoring catches SEO filler (*"In this comprehensive guide..."*), stylometric analysis flags mass-produced AI blog structures. Real-world example: 1,200-word CRM listicle with zero original research, flagged at **89% confidence**.

### Track H — Social & News
Generic DOM card-boundary detection works on any social feed without platform-specific hacks — with targeted selectors for X/Twitter, LinkedIn, and Reddit. Short-text gate prevents overflagging human banter. Real-world example: LinkedIn thought-leadership thread starting *"Here are 3 key takeaways"*, flagged at **94% confidence**.

All three tracks feed into the **same `/classify` endpoint** on `localhost:8083`. One brain, three sets of eyes.

---

## How It Works

### Default Mode (Extension Only)

The app runs a local service on port 8083. The browser extension connects and handles:
- Social media card-level text classification (heuristic + ML ensemble)
- AI image detection (3-model on-device ONNX pipeline)
- Ad blocking via declarative net request rules
- YouTube AI video feed badges

Text filtering, ad blocking, and the YouTube filter activate **as soon as the app starts**. No certificate. No system settings changed.

### Enhanced Mode (Local HTTPS Proxy)

Opt-in for power users. Starts a local HTTPS proxy via PAC file — injects detection scripts into every page across all browsers and apps, not just the extension browser.

Auto-installs a self-signed CA certificate into the Windows user certificate store (no admin rights). If installation fails the proxy turns itself off automatically.

| Feature | Default | Enhanced |
|---|---|---|
| Social card text filtering | ✓ | ✓ |
| AI image detection | ✓ (extension) | ✓ |
| Ad blocking | ✓ (extension DNR) | ✓ + network-level |
| YouTube filter | ✓ | ✓ |
| All browsers and apps | — | ✓ |
| CA certificate required | No | Yes (auto-installed) |

---

## Detection Signals — Why Hard to Fake

### Text
The core problem LLMs have is **local coherence optimization** — autoregressive generation conditions each token on the previous ones, producing:
- Unnaturally uniform sentence cadence (structural uniformity signal)
- High inter-sentence vocabulary overlap (Jaccard similarity signal)
- Over-reliance on high-probability opener words (opener repetition signal)
- Recycling a small set of filler words (lexical diversity signal)

These are not surface-level clichés — they are **statistical fingerprints** of autoregressive generation itself. Prompting away the phrase list does not fix the underlying cadence.

### Images
- **C2PA / Content Credentials** — DALL-E 3, Adobe Firefly, Google Imagen 3 embed cryptographically signed provenance. Zero false positives — either the manifest is there or it isn't.
- **PNG generator chunks** — AUTOMATIC1111, ComfyUI, NovelAI, InvokeAI, Fooocus embed generation parameters in raw bytes. Checked before ML inference.
- **URL forensics** — 25+ known AI CDN patterns. Zero-cost check: `cdn.midjourney.com`, `oaidalleapiprodscus.blob.core.windows.net`, etc.
- **3-model ONNX ensemble** — fallback when metadata has been stripped (e.g., social platforms that re-encode images).

---

## Where It Fails (Honest Numbers)

We publish failures because a detector that claims 99% accuracy is lying.

| Failure Mode | Miss Rate / FPR | Root Cause |
|---|---|---|
| Heavily edited AI text | ~25% miss rate | Human rewrites vary sentence lengths, add URLs and opinions — stylometric signals collapse |
| Short formal human posts | ~12% FPR | 150-word LinkedIn post written carefully can trigger the short-text gate |
| Corporate press releases | ~15% FPR | Human-written official statements naturally share LLM-like uniformity |
| Re-encoded AI images | Variable | Platform re-encoding strips all metadata, leaving only ML ensemble |
| AI-assisted human writing | ~45–55% score (ambiguous) | Grammar-corrected AI base with injected anecdotes; not blocked — intentionally |
| Generic human reviews | ~5% FPR | "This product is amazing, five stars!" is statistically indistinguishable from AI review spam |

**Documented live-fire misses:**
1. Human Amazon review flagged at 61% — short, generic phrasing overlaps with AI review spam. *(Tuned the short-text gate after this.)*
2. AI-edited PR passed at 48% — author used ChatGPT then rewrote every sentence. *This is not our target — catching low-effort slop is.*
3. 140-char AI tweet passed at 52% — below minimum length with no phrase triggers. *Intentional tradeoff: prefer missing short AI over blurring real replies.*

---

## Architecture

```
SlopBlock
├── main.js               Electron main process — window, tray, IPC, settings
├── classifier.js         ALL detection logic — text heuristics, ML ensemble,
│                         stylometrics, image pipeline (7-layer)
├── service.js            Local HTTP API (:8083) — extension connects here
├── proxy.js              HTTPS MITM proxy — HTML injection, ad blocking
├── config.js             All tunable detection parameters (single source of truth)
├── state.js              Shared runtime feature flags
├── counts.js             Persistent session counters
├── logger.js             Structured debug logging
├── pac.js                PAC file routing rules
├── extension/
│   ├── content.js        DOM boundary detection, classification, placeholder UI
│   ├── background.js     Service token management, IPC bridge
│   ├── github-pr.js      Track A — GitHub PR / issue / commit detector
│   └── popup.js          Extension popup UI
├── models/               Bundled ONNX image model (Git LFS, ~84 MB)
├── evaluation/           Bake-off datasets, live-fire results, eval scripts
├── docs/                 Detection signal documentation + screenshot gallery
└── __tests__/            Jest test suite (classifier, config, service)
```

The detection engine lives entirely in `classifier.js`. Tracks E and H differ only in DOM boundary detection in `content.js`. Track A uses a separate `github-pr.js` content script. All three call the same `localhost:8083/classify` API.

---

## Installation

1. Download the installer from the Releases page
2. Run `SlopBlock Setup.exe`
3. The app starts in the system tray — text filtering, ad blocking, and YouTube filter are active immediately

### Browser Extension

Required for image detection, social media filtering, and YouTube feed badges.

1. Open the dashboard and click **Install Extension**
2. Choose Chrome Web Store or Firefox Add-ons

Manual install:
- **Chrome / Edge / Brave / Vivaldi:** [Chrome Web Store](https://)
- **Firefox:** [Firefox Add-ons](https://)

---

## Development

**Requirements:** Node.js 18+, Windows

```bash
cd SlopBlock
git lfs pull        # downloads bundled ONNX image model (~84 MB)
npm install
npm start           # Electron dev mode
npm run build       # builds NSIS installer → dist/
npm test            # Jest test suite
npm run test:coverage
```

The primary image model (~84 MB) is bundled via Git LFS. The two text models and two additional image ensemble models download from HuggingFace on first use and are cached in `userData`.

### Docker (Testing Without Windows/Electron)

```bash
docker-compose up   # classification service on localhost:8083
```

### Interactive Demo (No Install)

```bash
npm install
npm run demo        # starts service on localhost:8083
# open demo.html in browser
```

`demo.html` is a fully standalone demo page. It runs client-side heuristic detection as a fallback and automatically upgrades to the full ONNX ensemble if the local service is running on `localhost:8083`. Open it in any browser — no build step required.

---

## Evaluation — Reproduce the Results

```bash
cd evaluation
node bake-off.js --dataset hc3-sample-100.json --threshold 0.60
node bake-off.js --dataset ghostbuster-sample-100.json --threshold 0.60
node bake-off.js --dataset social-sample-200.json --threshold 0.60
```

Full methodology, confusion matrices, per-signal breakdowns: [`evaluation/BAKEOFF_RESULTS.md`](./evaluation/BAKEOFF_RESULTS.md)
Real-world live-fire results: [`evaluation/live-fire-results.md`](./evaluation/live-fire-results.md)
Detection signal deep-dive: [`docs/SIGNALS.md`](./docs/SIGNALS.md)
Cross-track evidence: [`CROSS_TRACK.md`](./CROSS_TRACK.md)

---

## SlopBlock Pro

Standalone Chrome and Firefox extension for professional use — no desktop app, no proxy, no certificate. Designed for newsrooms, universities, and research teams. Right-click any text or image for a full forensic breakdown.

---

## Demo Video

**[Watch the 2-minute demo →](https://youtube.com/...)** *(record and upload before submission deadline)*

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, testing, and PR guidelines.

---

## Licence

**GPL-3.0-only** — see [LICENSE](./LICENSE).

Free and open source. Forks must remain open source under the same terms.

Copyright (C) 2026 Palak Varshney &lt;palakvarshney23012003@gmail.com&gt;.
