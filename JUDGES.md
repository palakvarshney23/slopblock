# SlopBlock — Judge Quickstart (5 minutes)

**Hackathon:** [Slop Scan](https://raptors.dev) · **Primary track:** **H (Social & News)** · **Also:** E (Content & SEO), G (Marketplaces) · **Bonuses:** Bake-Off, Live Fire, Cross-Track Scanner

> **Judges:** Start here. No Electron install required for a full text-detection demo.

[![CI](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml/badge.svg)](https://github.com/palakvarshney23/slopblock/actions/workflows/ci.yml)

---

## Fastest path (API demo — ~3 minutes)

```bash
git clone https://github.com/palakvarshney23/slopblock.git
cd slopblock
git lfs pull          # bundled image ONNX (~84 MB) — required for image detection
npm install
npm run demo          # verify models + preflight port 8083 + start service + open demo.html
```

Or one command on Windows: `.\scripts\judge-demo.ps1`

**Image model bundle** (Model A) requires these files under `models/ai-source-detector-onnx/`:

- `config.json` (bundled in repo)
- `preprocessor_config.json`
- `onnx/model_quantized.onnx` (Git LFS)

If image detection fails at startup, run:

```bash
npm run verify-models:repair   # downloads config.json if missing
git lfs pull                   # if ONNX is a tiny LFS pointer file
```

1. Open **`demo.html`** in Chrome/Edge/Firefox (file:// or drag into browser).
2. Wait for green **“Service connected”** in the header.
3. Click sample buttons or paste text → **Analyze**.

**Expected (threshold 0.55):**

| Sample | Expected verdict | Typical confidence |
|--------|----------------|-------------------|
| **AI Blog Intro** / **AI LinkedIn** / **SEO Slop** | SLOP | ≥ 75% |
| **Human Reddit** / **Human PR Desc** | CLEAN | &lt; 50% |

Full cheat sheet: [`evaluation/JUDGE_SAMPLES.md`](evaluation/JUDGE_SAMPLES.md)

---

## Full app (extension + tray — ~5 minutes)

```bash
npm start             # Electron + service :8083 + optional proxy :8081
```

1. **Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Visit **X**, **LinkedIn**, or an **Amazon product page** (`/dp/`).
3. Scroll — flagged cards blur with confidence % and method.

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → `extension/manifest.firefox.json`

---

## One-command scripts

**Windows (PowerShell):**

```powershell
.\scripts\judge-demo.ps1
```

**macOS / Linux:**

```bash
chmod +x scripts/judge-demo.sh
./scripts/judge-demo.sh
```

Opens `demo.html` after the service is listening.

---

## What to look for (by track)

| Track | Demo in 30s | Signal |
|-------|-------------|--------|
| **H — Social** | Extension on X/LinkedIn feed | Card blur, short-text gate, feed climbing |
| **E — SEO** | `demo.html` → SEO Slop sample | 116 phrases + stylometrics + dual ML |
| **G — Marketplaces** | Amazon `/dp/` + extension | `scoreReview()` + **reason lines** on flagged reviews |

---

## Detection approach (30-second version)

SlopBlock is **not** “ask another LLM if this is AI.” It uses:

1. **116-phrase heuristic blocklist** (high precision, low recall alone)
2. **Stylometrics** — Jaccard similarity + opener repetition
3. **Dual ONNX text models** — tmr-ai + e5-lora ensemble with veto/consensus
4. **Short-text gate** — caps ML-only scores on &lt;280 chars (social FPR control)
5. **Image forensics** — C2PA, PNG chunks, 25+ AI CDN URLs, then 3-model ONNX
6. **Marketplace `scoreReview()`** — product grounding + review-farm Jaccard

All inference runs on **`127.0.0.1:8083`** — no cloud, no accounts.

Deep dive: [`docs/SIGNALS.md`](docs/SIGNALS.md) · Architecture: [`README.md`](README.md#architecture)

---

## Honest numbers (trust these)

| Metric | Value |
|--------|-------|
| Macro accuracy (bake-off, n=30, `--full`) | **96.7%** |
| Bake-off FPR (same run) | **6.7%** |
| **High-confidence (≥75%) live-fire** | **100% correct** (42 wild samples) |
| Marketplace bake-off (n=26) | **84.6%** acc · **0%** FPR · `npm run test:marketplace` |

Failures cluster in the **45–65% ambiguity band** by design. See [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md).

---

## Reproduce metrics

```bash
npm test
npm run test:marketplace

node evaluation/bake-off.js --all --full
```

Results: [`evaluation/BAKEOFF_RESULTS.md`](evaluation/BAKEOFF_RESULTS.md)

---

## Live Discord demo (5 min slot)

See **[`DEMO_LIVE.md`](DEMO_LIVE.md)** — rehearsed order, backups, what **not** to show live (MITM proxy).

---

## Submission & bonuses

| Bonus | Points | Evidence |
|-------|--------|----------|
| Bake-Off | +5 | [`evaluation/BAKEOFF_RESULTS.md`](evaluation/BAKEOFF_RESULTS.md) |
| Live Fire | +5 | [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md) |
| Cross-Track Scanner | +3 | [`CROSS_TRACK.md`](CROSS_TRACK.md) |
| Open Source Ready | +3 | CI, **74 tests**, GPL, [`CONTRIBUTING.md`](CONTRIBUTING.md) |

Form copy: [`SUBMISSION.md`](SUBMISSION.md) · Checklist: [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md)

---

## Demo video

| Field | Value |
|-------|-------|
| **URL** | `PASTE_DEMO_VIDEO_URL_HERE` |
| **Script** | [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Port 8083 already in use` | Quit SlopBlock from the **system tray**, or run `npm run preflight`. Do **not** run `npm run demo` and `npm start` at the same time unless the tray app is stopped first. |
| `config.json` missing (image model) | `npm run verify-models:repair` |
| ONNX file ~130 bytes (LFS pointer) | `git lfs pull` |
| `demo.html` shows service offline | Confirm terminal prints `Service running on http://127.0.0.1:8083` |

---

| Resource | URL |
|----------|-----|
| Landing page | [`solelanding.html`](solelanding.html) |
| API playground | [`demo.html`](demo.html) |
| Cross-track evidence | [`CROSS_TRACK.md`](CROSS_TRACK.md) |
| Screenshot gallery | [`docs/screenshots/gallery.html`](docs/screenshots/gallery.html) |

**Contact:** Palak Varshney · palakvarshney23012003@gmail.com
