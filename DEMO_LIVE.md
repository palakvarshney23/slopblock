# Live Discord Demo — 5-Minute Runbook

For judges on the Slop Scan hackathon Discord demo slot. **Prefer live;** keep a screen-recording backup if network fails.

---

## Before you join the call

```bash
git lfs pull
npm install
npm test                    # confirm tests pass
npm run demo                # verify models + preflight + service on :8083 (opens demo.html)
```

**Run only ONE service:** either `npm run demo` **or** `npm start` (Electron tray), not both.

1. Open **`demo.html`** in a dedicated browser window (not incognito — file access is fine).
2. Confirm header: **“Service connected (localhost:8083)”** with green dot.
3. Pre-load Sample A (AI) and Sample B (human) — do not click Analyze yet.
4. *(Optional)* Second window: extension loaded, X or LinkedIn feed scrolled to a flagged-looking post.

**Do not rely on Enhanced Mode / MITM proxy live** — CA install and TLS errors waste time.

---

## Demo video (submission)

| Field | Value |
|-------|-------|
| **URL** | `PASTE_DEMO_VIDEO_URL_HERE` |
| **Script** | [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |
| **Form copy** | [`SUBMISSION.md`](SUBMISSION.md) |

Record 2–3 minutes per DEMO_SCRIPT before submitting to the portal.

---

## Minute-by-minute script

| Time | Show | Say |
|------|------|-----|
| **0:00–0:30** | `solelanding.html` or README architecture | “One engine, three tracks — social, SEO, marketplaces. All on-device.” |
| **0:30–1:30** | `demo.html` → Analyze **AI sample** → **human sample** | “Same API the extension uses. Slop above threshold, human below. Dual ML + heuristics, not GPTZero.” |
| **1:30–2:30** | Extension on feed OR second demo tab **AI LinkedIn** sample | “Card-level blur on real sites. Short-text gate stops false blocks on banter.” |
| **2:30–3:30** | **SEO Slop** sample OR Amazon `/dp/` with flagged review + **reason lines** | “Track E listicles and Track G reviews — marketplace shows *why* it flagged.” |
| **3:30–4:15** | `evaluation/JUDGE_SAMPLES.md` or live-fire table | “96.7% bake-off macro on n=30 (`--full`); 100% on high-confidence live-fire. Honest about 45–65% gray zone.” |
| **4:15–5:00** | Q&A — offer `JUDGES.md` link | “Clone, `npm run demo`, open demo.html — three minutes.” |

---

## Backup plan (if live fails)

| Failure | Backup |
|---------|--------|
| Port 8083 busy | Quit tray app or run `npm run preflight`. Re-run `npm run demo` — it reuses an existing healthy service if one is already listening. |
| `config.json` / image model error | `npm run verify-models:repair` then `git lfs pull` |
| Models slow to load | Use pre-warmed terminal; show bake-off numbers while waiting |
| Extension won't load | Stay on `demo.html` only — still valid per rules |
| No network | Offline OK — all local |

**Video backup:** Record per `DEMO_SCRIPT.md` when ready; play if Discord A/V breaks.

---

## What judges often ask

**“How is this different from GPTZero?”**  
On-device, multi-layer (stylometrics + 2 ONNX models + forensics), browser-native, no upload.

**“False positives on human LinkedIn?”**  
~12% FPR on formal short posts; short-text gate; document 45–65% band.

**“Can I run it?”**  
Yes — `git clone` → `npm run demo` → `demo.html`. Point to [JUDGES.md](JUDGES.md).

**“Primary track?”**  
**H** — social feeds. E and G are cross-track from same `classifier.js`.

---

## Files to have open in tabs

1. `demo.html`
2. `JUDGES.md` (GitHub rendered)
3. `evaluation/JUDGE_SAMPLES.md`
4. `evaluation/live-fire-results.md` (Aggregate Results)
5. *(Optional)* Amazon product page with extension

---

## After demo

Share repo: https://github.com/palakvarshney23/slopblock  
Submission text: [SUBMISSION.md](SUBMISSION.md)
