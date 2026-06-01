# Slop Scan — Pre-Submission Checklist

Use this before submitting to the hackathon portal.

---

## Required deliverables (`hack.txt` §03)

- [ ] **Working tool** — `npm run demo` or `npm start` runs without errors
- [ ] **Public GitHub repo** — https://github.com/palakvarshney23/slopblock
- [ ] **README** — detection approach explained ([README.md](README.md))
- [ ] **Honest numbers** — bake-off + live-fire published
- [ ] **Demo video (2–3 min)** — URL in [SUBMISSION.md](SUBMISSION.md) and [README.md](README.md#demo-video)

---

## Single-command judge path

```bash
git lfs pull
npm install
npm test                  # 74 tests
npm run demo              # opens demo.html
```

Windows: `.\scripts\judge-demo.ps1`

---

## Bonus challenges (+16 max)

| Bonus | Points | Verify |
|-------|--------|--------|
| The Bake-Off | +5 | [evaluation/BAKEOFF_RESULTS.md](evaluation/BAKEOFF_RESULTS.md) |
| Live Fire | +5 | [evaluation/live-fire-results.md](evaluation/live-fire-results.md) |
| Cross-Track Scanner | +3 | [CROSS_TRACK.md](CROSS_TRACK.md) |
| Open Source Ready | +3 | CI badge, [CONTRIBUTING.md](CONTRIBUTING.md), 74 tests |

---

## Form fields (copy from [SUBMISSION.md](SUBMISSION.md))

- **Project name:** SlopBlock — AI Slop Filter
- **Primary track:** H — Social & News
- **Repo URL:** https://github.com/palakvarshney23/slopblock
- **Demo video URL:** *(paste from SUBMISSION.md)*
- **AI tools disclosure:** Cursor / Claude (see SUBMISSION.md)

---

## Final smoke test (fresh clone)

```bash
git clone https://github.com/palakvarshney23/slopblock.git
cd slopblock
git lfs pull
npm install
npm run verify-models
npm run demo
```

- [ ] `demo.html` shows **Service connected**
- [ ] AI sample → SLOP ≥75%
- [ ] Human sample → CLEAN &lt;50%
- [ ] `npm run test:marketplace` prints metrics

---

## Do not submit with

- [ ] Port 8083 conflict (quit tray app first)
- [ ] Missing `config.json` (run `npm run verify-models:repair`)
- [ ] Git LFS pointer instead of ONNX (run `git lfs pull`)
- [ ] Empty demo video URL placeholder in the portal form
