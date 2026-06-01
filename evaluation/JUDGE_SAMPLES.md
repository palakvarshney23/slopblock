# Judge Samples — Live-Fire Cheat Sheet

**Purpose:** 30-second verification during judging. Run via **`demo.html`** + `npm run demo`, or extension on live sites.

**Threshold:** 0.55 (55% confidence = slop) · **Service:** `http://127.0.0.1:8083`

---

## Copy-paste text samples (`demo.html` → Text Analysis)

### Sample A — AI slop (expect **SLOP**, ≥75%)

```
In today's rapidly evolving digital landscape, let me walk you through a comprehensive guide to unlock your full potential. Whether you are a beginner or an expert, this is why you need to delve into these best practices and game-changing strategies. Here are the key takeaways. Let me know in the comments below what you think. Stay ahead of the curve with these actionable insights.
```

### Sample B — Human social (expect **CLEAN**, &lt;50%)

```
Dude check out this repo I found https://github.com/foo/bar — @alice and I were debugging it last night lol. Here's the stack trace: Error: cannot find module 'sharp' at Function.Module._resolveFilename
```

### Sample C — AI LinkedIn (expect **SLOP**, ≥80%)

```
Thrilled to announce that I am excited to share three key takeaways from today's session. In the ever-evolving landscape of leadership, it is worth noting that fostering a culture of innovation is paramount. Follow me for more actionable insights.
```

### Sample D — Human PR (expect **CLEAN**, &lt;50%)

```
Fixes #412 — rotate CSRF tokens after password change. Benchmark: p99 latency -12% on /api/v2/auth (see attached flamegraph). Breaking: clients using cookie-only sessions must call /refresh before 2026-07-01.
```

### Sample E — SEO listicle (expect **SLOP**, ≥85%)

```
In this comprehensive guide, we will delve into the nuanced approach of content marketing in today's fast-paced world. Without further ado, let's explore the ultimate guide to maximizing your ROI. The bottom line is that best practices matter.
```

---

## Live-fire reference table (wild content)

From [`live-fire-results.md`](live-fire-results.md). Binary verdict at demo thresholds.

| # | Source | Content type | Expected | Confidence | Notes |
|---|--------|--------------|----------|------------|-------|
| 1 | X/Twitter | Engagement bait thread | **FLAG** | 94% | No URLs, generic opener |
| 2 | X/Twitter | Personal rant + @mention | **PASS** | 8% | Typos, specific place |
| 3 | LinkedIn | "Thrilled to announce" | **FLAG** | 89% | No role specifics |
| 4 | LinkedIn | K8s deep-dive + links | **PASS** | 18% | Code, versions |
| 5 | Reddit | r/AskReddit advice | **PASS** | 14% | Casual, typos |
| 6 | Reddit | SEO tips post | **FLAG** | 88% | "unlock the potential" |
| 7 | News | CRM listicle | **FLAG** | 91% | Affiliate farm |
| 8 | News | Investigative FOIA piece | **PASS** | 8% | Citations, messy |
| 9 | Image | midjourney.com URL | **FLAG** | 100% | URL forensics |
| 10 | Image | Real phone photo | **PASS** | 3% | ML low |
| 11 | Amazon | Generic 5★ review | **FLAG** | varies | `reasons[]` in UI |
| 12 | Amazon | Verified + use detail | **PASS** | &lt;62% | Product tokens |
| 13 | GitHub | Hollow PR description | **FLAG** | 84% | `github-pr.js` |
| 14 | GitHub | PR with issue + benchmarks | **PASS** | 19% | Specifics |

**High-confidence rule:** No false positive at **≥75%** in live-fire (n=42 confirmed).

---

## API quick test (curl)

After `npm run demo`, get token:

```bash
curl -s http://127.0.0.1:8083/status | jq -r .token
```

Classify (replace `TOKEN`):

```bash
curl -s -X POST http://127.0.0.1:8083/classify \
  -H "X-SlopFilter-Token: TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary @- <<'EOF'
In this comprehensive guide we will delve into best practices and key takeaways for unlocking your potential in today's rapidly evolving landscape.
EOF
```

Expect JSON with `"isSlop": true` and `"confidence"` ≥ 55.

---

## Marketplace review API (Track G)

```bash
curl -s -X POST http://127.0.0.1:8083/classify-review \
  -H "X-SlopFilter-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Amazing product! Five stars! Highly recommend! Changed my life!","context":{"stars":5,"productTitle":"USB-C Hub 7-in-1 Adapter"}}'
```

Expect `"isSlop": true` with non-empty `"reasons"` array.

Reproduce bake-off: `npm run test:marketplace`

---

## Documented intentional misses

| Case | Verdict | Why |
|------|---------|-----|
| Short AI tweet "Agreed. Solid take." | PASS ~52% | Short-text gate — prefer miss over blur |
| Heavily edited AI PR | PASS ~48% | Human actually did the work |
| Former generic Amazon FP | Fixed | `scoreReview` corroboration |

---

## Screenshots

Gallery: [`docs/screenshots/gallery.html`](../docs/screenshots/gallery.html)  
Raw captures (if present): `evaluation/live-fire/screenshots/`
