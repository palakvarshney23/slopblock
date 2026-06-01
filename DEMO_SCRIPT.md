# SlopBlock — Demo Video Script (2–3 minutes)

Record this for the hackathon submission. Target length: **2:30–3:00**. Show real UI, not slides.

**Before recording:**
```bash
git lfs pull && npm install && npm run demo
```
Confirm green **“Service connected”** in `demo.html`. Optionally have extension loaded on X or Amazon for the live-browsing beat.

---

## Video link (fill in after upload)

| Platform | URL |
|----------|-----|
| **YouTube / Loom / Drive** | `PASTE_DEMO_VIDEO_URL_HERE` |

Also update: [`SUBMISSION.md`](SUBMISSION.md) · [`README.md`](README.md#demo-video)

---

## Scene 1 — Hook (0:00–0:20)

**Show:** `solelanding.html` or README architecture line.

**Say:**
> “SlopBlock catches AI slop before you waste time reading it — on social feeds, SEO articles, and fake marketplace reviews. Everything runs on your machine. No cloud. No accounts.”

---

## Scene 2 — Track H + E via demo.html (0:20–1:10)

**Show:** `demo.html` with service connected (green dot).

1. Click **AI LinkedIn Post** sample → **Analyze** → show **SLOP** badge and confidence ≥80%.
2. Click **Human Reddit** sample → **Analyze** → show **CLEAN** and confidence &lt;50%.
3. Click **SEO Slop** sample → **Analyze** → show high slop score.

**Say:**
> “Same API the browser extension uses — dual ONNX models plus stylometrics, not another LLM asking if this is AI. Social engagement bait and SEO listicles score high; real human posts with links and typos pass.”

---

## Scene 3 — Track G marketplace (1:10–1:45)

**Option A (extension):** Amazon product page with extension active — scroll to a flagged review, show **reason lines** in the banner.

**Option B (terminal):** Run `npm run test:marketplace` — show accuracy line on screen.

**Say:**
> “Track G uses the same classifier core but adds review-specific signals — product grounding, review-farm detection, explainable reasons. Not just a score — it tells you why.”

---

## Scene 4 — Honest numbers (1:45–2:15)

**Show:** `evaluation/BAKEOFF_RESULTS.md` or `live-fire-results.md` aggregate table — highlight:
- 82% bake-off macro accuracy
- 100% correct on high-confidence (≥75%) live-fire
- Failures in the 45–65% band documented

**Say:**
> “We publish confusion matrices and live-fire results — including where it fails. Short human banter and heavily edited AI sit in the gray zone by design.”

---

## Scene 5 — Close (2:15–2:45)

**Show:** Terminal with `git clone` + `npm run demo`, or tray app + extension icon.

**Say:**
> “Clone the repo, run npm run demo, open demo.html — three minutes. Primary track Social and News; also Content SEO and Marketplaces from one engine. SlopBlock — reclaim the internet from slop.”

**End card:** GitHub URL · `PASTE_DEMO_VIDEO_URL_HERE`

---

## Recording tips

- **1080p screen capture** — zoom browser to 125% for readability.
- **Mute notification sounds** — close unrelated apps.
- **Do not demo Enhanced Mode / MITM proxy live** — CA install wastes time; mention it verbally only.
- **Backup:** If live service fails, show pre-recorded `demo.html` analysis with terminal showing `Service running on http://127.0.0.1:8083`.

---

## Checklist before upload

- [ ] Video is 2–3 minutes
- [ ] Shows tool catching real slop (not just keywords)
- [ ] Mentions on-device / no cloud
- [ ] URL pasted into SUBMISSION.md and README
- [ ] Video set to **public** or **unlisted with link**
