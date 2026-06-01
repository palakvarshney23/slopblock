# SlopBlock — AI Slop Filter

[![CI](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml/badge.svg)](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml)

> **Judges start here → [`JUDGES.md`](JUDGES.md)** · 5-minute `npm run demo` + [`demo.html`](demo.html)

> **Built for the [Slop Scan Hackathon](https://raptors.dev) — May 29–Jun 1, 2026**
> **Primary track:** **H (Social & News)** · **Cross-track:** **E (Content & SEO) · G (Marketplaces)**
> **Cross-Track Scanner bonus** — one unified engine (`classifier.js`), three consumer-facing surfaces
>
> Live demo: **[demo.html](demo.html)** · **[SUBMISSION.md](SUBMISSION.md)** · **[SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)** · Video: `PASTE_DEMO_VIDEO_URL_HERE`

SlopBlock detects and hides low-effort AI-generated content **as you browse** — SEO listicles, social engagement bait, fake product reviews, AI images, and disclosed synthetic video — **entirely on-device**. No cloud. No accounts. No telemetry.

**Author:** Palak Varshney &lt;palakvarshney23012003@gmail.com&gt;

---

## Why E + H + G

These three tracks share the same failure mode: **content that looks published but nobody meaningfully checked it.**

| Track | Problem SlopBlock targets | Where it runs |
|---|---|---|
| **E — Content & SEO** | Mass-produced listicles, filler articles, affiliate farms | Blogs, news sites, Medium, full-page scan (Enhanced Mode) |
| **H — Social & News** | Engagement bait, thought-leadership spam, bot replies | X/Twitter, LinkedIn, Reddit, Facebook feeds |
| **G — Marketplaces** | Generic 5-star review spam, templated “life-changing product” copy | Amazon, eBay, Etsy product pages (paragraph-level scan) |

One detection brain (`classifier.js`) powers all three. Only **DOM boundary detection** in `extension/content.js` changes — card climbing for feeds, paragraph scan for articles, same selectors on marketplace review blocks.

---

## Track-by-Track Evaluation (Honest)

Scores reflect **fit to each track’s real-world pain**, not vanity accuracy. Scale: **1–10**.

| Track | Score | Strengths | Gaps |
|---|---|---|---|
| **E — Content & SEO** | **8/10** | Full-page + paragraph classification; 116-phrase SEO blocklist; stylometrics catch uniform listicles; bake-off + live-fire on content farms (~91% on flagged articles) | No site-specific rules (WordPress vs Substack); long human SEO copy can score 45–52% near threshold |
| **H — Social & News** | **8.5/10** | Card-boundary detection on X, LinkedIn, Reddit; short-text gate limits FPR on banter; 19 live-fire social samples with clear AI/human separation | Very short AI replies (&lt;140 chars) intentionally pass; formal human LinkedIn posts borderline |
| **G — Marketplaces** | **9/10** | Dedicated `marketplace.js` for Amazon/eBay; `scoreReview()` with explainable `reasons[]`; product grounding + review-farm detection; bake-off **84.6% acc, 0% FPR** (n=26) | Heavier edited AI reviews still slip; Etsy not yet in manifest; DOM selectors need periodic verification |

**Overall for E + H + G positioning: ~8.5/10** — unified consumer-slop product with dedicated marketplace review pipeline on Amazon and eBay.

### Cross-Track Scanner (+3 bonus)

Hackathon rule: *meaningful slop detection across two or more tracks from one engine.*

SlopBlock qualifies: **E + H + G** share `classifier.js`, `/classify` on `localhost:8083`, and the same 7-layer stack. Not three separate tools glued together.

---

## Accuracy at a Glance

**Built during Slop Scan (May 29 – Jun 1, 2026).** See [`HACKATHON_TIMELINE.md`](HACKATHON_TIMELINE.md).

Reproducible bake-off (`node evaluation/bake-off.js --all --full`, threshold **0.55**):

| Dataset | n | Domain | Accuracy | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|
| HC3-style Q&A | 10 | General web text (E/H proxy) | **100%** | 100% | 100% | 100% | 0% |
| Social-style posts | 10 | X, LinkedIn, Reddit (**H**) | **100%** | 100% | 100% | 100% | 0% |
| Ghostbuster-style | 10 | Long-form prose (**E** proxy) | **90%** | 83% | 100% | 91% | 20% |
| **Macro average** | **30** | — | **96.7%** | **94.4%** | **100%** | **97%** | **6.7%** |

> Small curated subset for judge reproducibility — not a 500-sample benchmark. **High-confidence (≥75%) live-fire** (May 31): **100% correct** on 42 wild samples. Judge cheat sheet: [`evaluation/JUDGE_SAMPLES.md`](evaluation/JUDGE_SAMPLES.md) · Full write-up: [`evaluation/BAKEOFF_RESULTS.md`](evaluation/BAKEOFF_RESULTS.md).

### Per-layer roles (qualitative — hackathon tuning)

| Detection layer | Role on E/H/G text |
|---|---|
| Heuristic phrases | High precision when they fire; low recall alone |
| ML Model 1 (tmr-ai) | Strong recall on obvious AI |
| ML Model 2 (e5-lora) | Corroborates M1 |
| **Full stack (+ stylometric + gates)** | Production path used in bake-off `--full` |

### Image Detection (product photos, social, marketplace listings)

| Layer | Precision | Recall | F1 |
|---|---|---|---|
| C2PA / Content Credentials | 100% | 100% | 100% |
| PNG chunk forensics | 98% | 96% | 97% |
| URL pattern forensics | 100% | 100% | 100% |
| ML Ensemble (3 models) | 89% | 88% | 88% |
| **Combined pipeline** | **91%** | **90%** | **90%** |

---

## Hackathon Track Coverage (E · H · G)

### Track E — Content & SEO

**What we detect:** AI-written listicles, “ultimate guides,” affiliate comparison pages, content-farm articles with zero original research.

**How:**
- Paragraph-level selectors: `p`, `blockquote`, `.article-body p`, title/description classes
- **Enhanced Mode** (local HTTPS proxy): injects detection into **any** browser tab — full article scan without a site-specific plugin
- Heuristic hits: *"In this comprehensive guide..."*, *"today's rapidly evolving landscape"*, *"delve into"*
- Stylometrics: uniform sentence cadence, high adjacent-sentence Jaccard overlap

**Evidence:** Live-fire content-farm listicle flagged at **91%**; investigative journalism passed at **8–13%**. See [`evaluation/live-fire-results.md`](./evaluation/live-fire-results.md) (News / Blogs).

---

### Track H — Social & News

**What we detect:** AI engagement threads, corporate thought-leadership spam, bot product plugs, hollow news-commentary.

**How:**
- **Card-boundary climbing** — `role="feed"`, `role="article"`, feed children (works across platforms without per-site rewrites)
- Targeted selectors: `[data-testid="tweetText"]`, LinkedIn `occludable-update`, Reddit `shreddit-post`
- **Short-text gate** (&lt;280 chars): caps ML-only confidence so real replies are not blurred
- Hover shield: blocks video previews on flagged thumbnails until verdict

**Evidence:** X engagement thread **94%**; LinkedIn “3 key takeaways” post **94%**; human r/AskReddit advice **12–16%**. Social live-fire: **19 posts**, binary accuracy **100%** at demo thresholds.

---

### Track G — Marketplaces (Amazon + eBay)

**What we detect:** Templated 5-star review spam, reviews with no product-specific details, on-page review farms with duplicate wording.

**How:**
- [`extension/marketplace.js`](extension/marketplace.js) + [`extension/marketplace-sites.js`](extension/marketplace-sites.js) — scoped to review cards only (`[data-hook="review"]` on Amazon, `[itemprop="review"]` on eBay)
- **`POST /classify-review`** → `scoreReview()` in [`classifier.js`](classifier.js): base ML/heuristic + review phrases + product-title grounding + verified-purchase corroboration + sibling Jaccard farm detection
- UI shows **up to 3 reason lines** per flagged review (not just a score)
- [`extension/content.js`](extension/content.js) skips generic paragraph scan on product pages (`data-sf-marketplace`) so product descriptions are not misclassified

**Evaluation (heuristic + review signals, n=26):** Accuracy **84.6%**, Precision **100%**, Recall **66.7%**, FPR **0%** — run `npm run test:marketplace`

**Selectors last verified:** June 2026 (Amazon `data-hook`, eBay `itemprop`)

---

## What It Detects

| Content Type | Tracks | How |
|---|---|---|
| AI-generated text | **E, H, G** | 7-layer pipeline (+ `scoreReview` for marketplace reviews) |
| AI-generated images | **E, H, G** | 3-model ONNX + C2PA + PNG chunks + URL forensics |
| YouTube synthetic video | **H, E** | Creator-declared altered/synthetic label interception |
| Ads / content-farm noise | **E** | Extension DNR + network-level block (Enhanced Mode) |

---

## The Seven Detection Layers

SlopBlock is not a single model. Seven layers, each hard to fake for a **different reason**:

| Layer | Signal | Bypass Difficulty |
|---|---|---|
| 1 | **Heuristic phrase blocklist** — 116 LLM clichés | Medium |
| 2 | **Structural uniformity** — sentence-length variance / CV | Hard |
| 3A | **Inter-sentence Jaccard similarity** | Hard |
| 3B | **Opener repetition** | Medium-Hard |
| 4 | **Lexical diversity** | Hard |
| 5 | **Two-model ML ensemble** (tmr-ai + e5-lora) | Very Hard |
| 6 | **Image metadata forensics** (C2PA, PNG chunks, AI CDNs) | Impossible → Easy |
| 7 | **Short-text gate** — social & review calibration | N/A (calibration) |

Full signal deep-dive: [`docs/SIGNALS.md`](./docs/SIGNALS.md)

---

## Where It Fails (E / H / G)

| Failure Mode | Tracks | Rate | Root Cause |
|---|---|---|---|
| Heavily edited AI text | E, H | ~25% miss | Human rewrites collapse stylometric signals |
| Short formal human posts | H, G | ~12% FPR | Careful LinkedIn posts / sincere short reviews |
| Corporate press releases | E | ~15% FPR | Human official prose mimics LLM uniformity |
| Generic human reviews | **G** | ~5% FPR | *"Amazing product, five stars!"* ≈ AI review spam |
| Re-encoded AI images | E, H, G | Variable | Platforms strip metadata; ML-only fallback |
| Short AI social replies | H | By design | &lt;140 chars, no phrases — prefer miss over blur |

**Documented live-fire (consumer tracks):**
1. **G** — Former Amazon FP (generic 5-star + verified) now passes via product-token + use-detail corroboration in `scoreReview()`
2. **H** — 140-char AI tweet passed at 52% *(intentional: protect human banter)*

---

## How It Works

### Default Mode (Extension)

Local service on **port 8083**. Extension handles:
- Social feed cards (**H**)
- Article paragraphs on blogs and marketplaces (**E**, **G**)
- AI images + YouTube synthetic badges
- Ad blocking (content-farm noise, **E**)

### Enhanced Mode (Local HTTPS Proxy)

Opt-in PAC + self-signed CA (Windows user store, no admin). Injects detection into **every page** in every app — strongest **Track E** coverage for sites without extension hooks.

| Feature | Default | Enhanced |
|---|---|---|
| Social feed filtering (**H**) | ✓ | ✓ |
| Full-page article scan (**E**) | partial | ✓ |
| Marketplace reviews (**G**) | partial | ✓ |
| AI images | ✓ | ✓ |
| All browsers / apps | — | ✓ |

---

## Architecture

```
SlopBlock
├── classifier.js         ALL detection — text heuristics, ML ensemble, images
├── service.js            Local HTTP API (:8083)
├── proxy.js              Enhanced Mode — full-page injection (E, G on any site)
├── extension/
│   ├── content.js        DOM boundaries — feeds (H), paragraphs (E)
│   ├── marketplace.js    Track G — Amazon/eBay review cards
│   ├── marketplace-sites.js  Host selectors (Amazon, eBay)
│   ├── background.js     Service bridge
│   └── popup.js          Extension UI
├── models/               ONNX image model (Git LFS)
├── evaluation/           Bake-off + live-fire (E/H/G evidence)
└── __tests__/            Jest — 74 tests
```

Tracks **E** and **H** use `POST /classify`; **G** uses `POST /classify-review` with review metadata — same `classifier.js` core.

---

## Installation

1. Download **SlopBlock Setup.exe** from Releases
2. Install browser extension (image + social + marketplace pages)
3. Tray app starts filtering immediately

**Extension:** Chrome / Edge / Brave / Firefox — required for **H** and on-page **E/G** without Enhanced Mode.

---

## Development

**Requirements:** Node.js 18+, Windows (desktop); extension + service work cross-platform via Docker

```bash
git lfs pull
npm install
npm start           # Electron + service
npm test            # 74 tests (CI on every push)
npm run demo        # verify models + preflight + demo.html
npm run test:marketplace   # Track G bake-off
npm run verify-models:repair  # fix missing config.json

# Judge one-liner (Windows)
.\scripts\judge-demo.ps1
```

---

## Evaluation — Reproduce E / H / G Claims

```bash
cd evaluation
node evaluation/bake-off.js --all --full   # full ensemble, threshold 0.55 (default)
npm run test:marketplace   # Track G — marketplace-sample.json
```

| Document | Contents |
|---|---|
| [`JUDGES.md`](./JUDGES.md) | **5-minute judge quickstart** |
| [`evaluation/JUDGE_SAMPLES.md`](./evaluation/JUDGE_SAMPLES.md) | Copy-paste samples + live-fire table |
| [`evaluation/BAKEOFF_RESULTS.md`](./evaluation/BAKEOFF_RESULTS.md) | Confusion matrices, per-signal breakdown |
| [`evaluation/live-fire-results.md`](./evaluation/live-fire-results.md) | Wild X, LinkedIn, Reddit, news, Amazon, images |
| [`CROSS_TRACK.md`](./CROSS_TRACK.md) | Cross-track bonus evidence (E · H · G) |
| [`DEMO_LIVE.md`](./DEMO_LIVE.md) | 5-minute Discord live demo runbook |
| [`SUBMISSION.md`](./SUBMISSION.md) | Hackathon form copy + bonus claims |
| [`SUBMISSION_CHECKLIST.md`](./SUBMISSION_CHECKLIST.md) | Pre-submit verification |
| [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) | 2–3 minute demo video script |
| [`docs/screenshots/gallery.html`](./docs/screenshots/gallery.html) | Track E/H/G UI screenshots |

---

## Hackathon bonus challenges (+16 max)

| Challenge | Points | Evidence |
|-----------|--------|----------|
| **The Bake-Off** | +5 | [`evaluation/BAKEOFF_RESULTS.md`](evaluation/BAKEOFF_RESULTS.md) — reproducible `bake-off.js --all --full`, n=30 |
| **Live Fire** | +5 | [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md) — 42 wild samples |
| **Cross-Track Scanner** | +3 | [`CROSS_TRACK.md`](CROSS_TRACK.md) — E + H + G, one `classifier.js` |
| **Open Source Ready** | +3 | CI, 74 tests, GPL-3.0, [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## Demo Video

| | |
|---|---|
| **URL** | `PASTE_DEMO_VIDEO_URL_HERE` |
| **Script** | [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (Scenes: **H**, **E**, **G** with review `reasons[]`) |
| **Live backup** | [`DEMO_LIVE.md`](DEMO_LIVE.md) — 5-minute Discord runbook |

> Upload your 2–3 minute recording to YouTube/Loom, then replace `PASTE_DEMO_VIDEO_URL_HERE` here and in [`SUBMISSION.md`](SUBMISSION.md).

Until the video is uploaded: **`npm run demo`** + [`demo.html`](demo.html) or [`JUDGES.md`](JUDGES.md).

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Licence

**GPL-3.0-only** — see [LICENSE](./LICENSE).

Copyright (C) 2026 Palak Varshney &lt;palakvarshney23012003@gmail.com&gt;.
