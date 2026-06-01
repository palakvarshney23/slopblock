# Cross-Track Scanner — Bonus Evidence (+3)

**Hackathon rule:** *Meaningful slop detection across two or more tracks from a unified detection engine.*

SlopBlock qualifies: **Track H (Social & News)**, **Track E (Content & SEO)**, and **Track G (Marketplaces)** share one core engine — [`classifier.js`](classifier.js) — one local API (`127.0.0.1:8083`), and one browser extension. This is not three separate tools glued together.

---

## Unified engine

```
                    ┌─────────────────────────────────┐
                    │         classifier.js           │
                    │  heuristics · stylometrics ·    │
                    │  tmr-ai + e5-lora · images ·    │
                    │  scoreReview() (Track G)        │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │      service.js  :8083          │
                    │  /classify  /classify-review    │
                    │  /classify-image  /classify-video│
                    └───────────────┬─────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
   extension/content.js    extension/marketplace.js    demo.html
   feeds + paragraphs       Amazon/eBay reviews         API playground
   Track H + E              Track G                     All tracks
```

**What changes per track:** only DOM boundary detection in the extension — not the classifier.

| Track | Extension entry | API route | Classifier function |
|-------|-----------------|-----------|---------------------|
| **H — Social & News** | `content.js` — card climbing on feeds | `POST /classify` | `isAiSlop()` |
| **E — Content & SEO** | `content.js` — paragraph scan on articles | `POST /classify` | `isAiSlop()` |
| **G — Marketplaces** | `marketplace.js` — review card selectors | `POST /classify-review` | `scoreReview()` |

Both text routes call the same underlying phrase list, stylometrics, and ONNX ensemble. Marketplace adds review-specific signals (product grounding, farm Jaccard, verified-purchase corroboration) on top.

---

## Track H — Social & News (primary)

**Problem:** Engagement bait, thought-leadership spam, bot replies flooding feeds.

**Implementation:**
- [`extension/content.js`](extension/content.js) — climbs card boundaries (`role="feed"`, `role="article"`, tweet/LinkedIn/Reddit selectors)
- **Short-text gate** — caps ML-only confidence on &lt;280 chars to protect human banter
- Hover shield on flagged video thumbnails

**Live-fire evidence:** 19 social posts — X engagement thread **94%**, LinkedIn “3 key takeaways” **94%**, human r/AskReddit **12–16%**. See [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md).

**Reproduce:** Load extension → browse X, LinkedIn, or Reddit. Or `demo.html` Sample C (AI LinkedIn).

---

## Track E — Content & SEO

**Problem:** SEO listicles, affiliate farms, articles that rank but say nothing.

**Implementation:**
- Same `isAiSlop()` via `POST /classify`
- Paragraph selectors: `p`, `.article-body p`, blockquotes
- **Enhanced Mode** ([`proxy.js`](proxy.js)) — full-page injection for any browser tab (strongest E coverage)
- 116-phrase SEO blocklist + stylometric uniformity

**Live-fire evidence:** Content-farm listicle **91%**; investigative journalism **8–13%**. See [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md) (News / Blogs).

**Reproduce:**
```bash
npm run demo
# demo.html → "SEO Slop" sample (expect ≥85% slop)
node evaluation/bake-off.js --dataset ghostbuster-sample-100.json --threshold 0.60
```

---

## Track G — Marketplaces

**Problem:** Generic 5-star review spam, templated “life-changing product” copy.

**Implementation:**
- [`extension/marketplace.js`](extension/marketplace.js) + [`marketplace-sites.js`](extension/marketplace-sites.js)
- Scoped to review blocks only — product descriptions are **not** scanned (`data-sf-marketplace` gate in `content.js`)
- **`scoreReview()`** returns explainable `reasons[]` shown in the UI banner

**Evaluation (n=26):** Accuracy **84.6%**, Precision **100%**, Recall **66.7%**, FPR **0%**.

**Reproduce:**
```bash
npm run test:marketplace
# Or visit Amazon /dp/ with extension loaded
```

---

## Same brain, three surfaces — proof it is unified

1. **One ONNX text ensemble** scores social posts, blog paragraphs, and review bodies.
2. **One service token** on `:8083` — extension never calls external URLs.
3. **One test suite** — [`__tests__/classifier.test.js`](__tests__/classifier.test.js), [`__tests__/review-scorer.test.js`](__tests__/review-scorer.test.js).
4. **Bake-off macro (n=500)** spans HC3 (general), social sample (H proxy), Ghostbuster abstracts (E proxy) — [`evaluation/BAKEOFF_RESULTS.md`](evaluation/BAKEOFF_RESULTS.md).

---

## Optional fourth surface (not primary track)

[`extension/github-pr.js`](extension/github-pr.js) applies the same `POST /classify` to GitHub PR descriptions and issue comments (Track A adjacency). Live-fire: hollow AI PR **84%** vs technical PR **19%**. Documented in [`evaluation/live-fire-results.md`](evaluation/live-fire-results.md).

---

## Judge verification (2 minutes)

| Step | Track | Action |
|------|-------|--------|
| 1 | **H** | `demo.html` → Sample C (AI LinkedIn) → SLOP ≥80% |
| 2 | **E** | `demo.html` → Sample E (SEO Slop) → SLOP ≥85% |
| 3 | **G** | `npm run test:marketplace` → printed accuracy/FPR |
| 4 | All | Confirm all routes import `classifier.js` — `grep classify classifier service extension` |

Cross-track bonus: **E + H + G from one engine** — this document + live demo.
