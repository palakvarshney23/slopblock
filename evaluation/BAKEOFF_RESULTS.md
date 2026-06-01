# Bake-Off Evaluation Results

**Hackathon:** Slop Scan · **May 29 – Jun 1, 2026** (UTC)  
**Evaluation run:** 2026-05-31 (IST), during the hacking window  
**Evaluator:** `evaluation/bake-off.js` with `--full` (tmr-ai + e5-lora + heuristics + stylometric)  
**Decision threshold:** `0.55` (`config.js` default — same as production)

---

## Scope and honesty

Bake-off JSON files use legacy filenames (`*-100`, `*-200`) but each file currently holds **n = 10** labeled samples (5 human / 5 AI) curated **during the hackathon** (commit `2026-05-30` eval framework). This is a **reproducible subset** for judges, not a full HC3/Ghostbuster export.

| File | Samples | Collected |
|------|---------|-----------|
| `hc3-sample-100.json` | 10 | May 30, 2026 |
| `ghostbuster-sample-100.json` | 10 | May 30, 2026 |
| `social-sample-200.json` | 10 | May 30, 2026 |

Wild browsing evidence is separate: see `evaluation/live-fire-results.md` (Live Fire bonus, May 31).

---

## Datasets

### Dataset A: HC3-style Q&A (n = 10)

Inspired by [HelloSimpleAI/HC3](https://huggingface.co/datasets/HelloSimpleAI/HC3) — paired human Reddit answers vs ChatGPT-style answers.  
Domain: general Q&A, technical, lifestyle.

### Dataset B: Ghostbuster-style academic (n = 10)

Inspired by Ghostbuster-style CS abstracts — human vs AI-generated research prose.  
Domain: computer science abstracts (synthetic *content* may cite venues like NeurIPS 2024; that is sample text, not a repo date).

### Dataset C: Social-style posts (n = 10)

Hand-authored samples mimicking X/LinkedIn/Reddit tone — **not** the Live Fire wild-browse log.  
Domain: engagement bait, corporate posts, casual human rants.

---

## Full ensemble results (reproducible)

Run:

```bash
npm install
git lfs pull
node evaluation/bake-off.js --all --full
```

### Dataset A — HC3-style (n = 10)

```
                        Predicted
                 Human      AI
Actual Human        5          0     (5)
Actual AI            0         5     (5)

Accuracy:  100.0%
Precision: 100.0%
Recall:    100.0%
F1 Score:  100.0%
FPR:       0.0%
```

### Dataset B — Ghostbuster-style (n = 10)

```
                        Predicted
                 Human      AI
Actual Human        4          1     (5)
Actual AI            0         5     (5)

Accuracy:   90.0%
Precision:  83.3%
Recall:    100.0%
F1 Score:   90.9%
FPR:       20.0%
```

*False positive:* one human abstract scored above threshold (formal academic register).

### Dataset C — Social-style (n = 10)

```
                        Predicted
                 Human      AI
Actual Human        5          0     (5)
Actual AI            0         5     (5)

Accuracy:  100.0%
Precision: 100.0%
Recall:    100.0%
F1 Score:  100.0%
FPR:       0.0%
```

### Combined macro average (n = 30)

```
Accuracy:   96.7%
Precision:  94.4%
Recall:    100.0%
F1 Score:   97.0%
FPR:        6.7%
```

**Note:** Small-n metrics are optimistic on this curated set. Judges should treat macro numbers as **reproducible smoke validation**, not a claim of 500-sample benchmark coverage.

---

## Heuristic-only proxy (not submission metrics)

Without `--full`, the script uses heuristic + stylometric proxy only. On the same n = 30 at threshold 0.55, macro accuracy is **50%** (no AI positives). Production scoring always uses the full ensemble when models are loaded.

---

## Design-time signal roles (qualitative)

From hackathon tuning on extension traffic and demo texts (not re-run per row here):

| Signal | Role |
|--------|------|
| Heuristic phrases | High precision when they fire; low recall alone |
| Model 1 (tmr-ai) | Strong recall on obvious AI |
| Model 2 (e5-lora) | Corroborates M1; reduces single-model false positives |
| Stylometric | Boost on longer uniform prose |
| Short-text gate | Lowers FPR on social snippets under 280 chars |

Default threshold **0.55** balances recall and FPR for browsing; raise toward **0.70** for fewer false positives.

---

## Image / video detection

Image ONNX ensemble and CLIP video probe were integrated **May 31 – Jun 1** (see `HACKATHON_TIMELINE.md`). Image bake-off tables are not part of this text JSON bake-off; video metrics live in `models/clip_video_probe.json` and `evaluation/marketplace-bakeoff.js`.

---

## Conclusion

On the **hackathon-curated n = 30** bake-off subset, the **full on-device text ensemble** achieves **96.7% macro accuracy** and **6.7% macro FPR** at threshold 0.55, with **100% recall** on this small set. SlopBlock remains a practical privacy-first filter, not a perfect detector — larger corpora would be post-hackathon work.

---

## Timeline cross-check

| Check | Result |
|-------|--------|
| Earliest git commit | 2026-05-29 21:00 IST |
| Bake-off artifacts committed | 2026-05-30 |
| This results doc | 2026-05-31 run |
| Pre–May 29 dates in repo docs | Removed (was `2026-05-27` in an earlier draft) |

See `HACKATHON_TIMELINE.md` for the full audit.
