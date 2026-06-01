# Slop Scan — Submission Form Copy

Use this text when submitting to the hackathon portal. Adjust links if your fork differs.

**Pre-submit checklist:** [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md)

---

## Project name

**SlopBlock — AI Slop Filter**

---

## Primary track

**H — Social & News**

*(Cross-track: also targets **E (Content & SEO)** and **G (Marketplaces)** from one engine — see [CROSS_TRACK.md](CROSS_TRACK.md).)*

---

## One-sentence pitch

SlopBlock is an on-device browser filter that blurs AI engagement bait, SEO listicles, and fake marketplace reviews before you read them — using a 7-layer detector, not another LLM judge.

---

## Description (short)

SlopBlock detects low-effort AI-generated content as you browse: social feeds, articles, product reviews, and images. Everything runs locally on `127.0.0.1` — no cloud API, no accounts, no telemetry. A Chrome/Firefox extension talks to a local Node service with dual ONNX text classifiers, stylometric signals, image forensics (C2PA, PNG chunks, CDN patterns), and a dedicated Amazon/eBay review pipeline with explainable reason lines.

---

## Detection approach

- **Not** keyword-only (116 phrases are one layer among seven).
- **Not** GPTZero / Originality wrapper.
- **Not** “ask Claude if this is AI.”

Layers: heuristic phrases → structural uniformity → Jaccard stylometrics → lexical diversity → **tmr-ai + e5-lora ensemble** → image metadata forensics → short-text calibration gate. Marketplace reviews use `scoreReview()` with product-title grounding and sibling farm detection.

Details: [README.md](README.md) · [docs/SIGNALS.md](docs/SIGNALS.md)

---

## How to run (single command)

```bash
git lfs pull && npm install && npm run demo
```

Then open `demo.html` (launches automatically on Windows via judge script). Judges: [JUDGES.md](JUDGES.md)

Full desktop app: `npm start` + load `extension/` unpacked.

**Windows one-liner:** `.\scripts\judge-demo.ps1`

---

## Honest accuracy

| Metric | Value |
|--------|-------|
| Bake-off macro (n=30, May 31 run) | 96.7% accuracy, 6.7% FPR (`bake-off.js --all --full`) |
| Live-fire high-confidence (≥75%) | **100%** correct on 42 wild samples |
| Marketplace eval (n=26) | 84.6% acc, 0% FPR |

We document failures in the 45–65% band and edited-AI misses in [evaluation/live-fire-results.md](evaluation/live-fire-results.md).

---

## Bonus challenges claimed

| Challenge | Points | Proof |
|-----------|--------|-------|
| **The Bake-Off** | +5 | `evaluation/bake-off.js`, HC3/social/ghostbuster JSON, [BAKEOFF_RESULTS.md](evaluation/BAKEOFF_RESULTS.md) |
| **Live Fire** | +5 | [live-fire-results.md](evaluation/live-fire-results.md), [JUDGE_SAMPLES.md](evaluation/JUDGE_SAMPLES.md) |
| **Cross-Track Scanner** | +3 | E + H + G via single `classifier.js` — [CROSS_TRACK.md](CROSS_TRACK.md) |
| **Open Source Ready** | +3 | GPL-3.0, CI workflow, **74** Jest tests, [CONTRIBUTING.md](CONTRIBUTING.md) |

**Maximum bonus:** +16 points

---

## Repository

https://github.com/palakvarshney23/slopblock

---

## Demo video (required — 2–3 minutes)

| Field | Value |
|-------|-------|
| **Video URL** | `PASTE_DEMO_VIDEO_URL_HERE` |

Recording script: [DEMO_SCRIPT.md](DEMO_SCRIPT.md) · Live Discord runbook: [DEMO_LIVE.md](DEMO_LIVE.md)

**Suggested platforms:** YouTube (unlisted), Loom, Google Drive (public link)

> Replace `PASTE_DEMO_VIDEO_URL_HERE` above and in [README.md](README.md#demo-video) after upload.

---

## Live demo link (optional)

| Field | Value |
|-------|-------|
| **Hosted demo** | Local executable — `npm run demo` + [demo.html](demo.html) (no cloud dependency) |
| **Landing page** | [solelanding.html](solelanding.html) (open locally or host on GitHub Pages) |

---

## AI tools disclosure

Built with assistance from Cursor / Claude (and similar). All detection logic, evaluation, and architecture decisions are documented in-repo; models are open ONNX weights from Hugging Face, not proprietary APIs for classification.

---

## Team

Palak Varshney · palakvarshney23012003@gmail.com
