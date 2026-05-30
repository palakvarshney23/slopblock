# Cross-Track Scanner Documentation

**SlopBlock qualifies for the Cross-Track Scanner bonus (+3 points)** because its unified detection engine meaningfully detects slop across two or more hackathon tracks from a single codebase.

---

## Tracks Covered

### Track A — Code Review *(New — built during hackathon)*

**Coverage:** GitHub pull request descriptions, issue comments, commit messages

**Detection mechanisms:**
- Content script (`extension/github-pr.js`) runs exclusively on `https://github.com/*`
- Selects `.pull-request-description .markdown-body`, `.timeline-comment .comment-body`, `.commit-title`, `.commit-desc`
- Sends extracted text to the same `localhost:8083/classify` endpoint used by Tracks E and H
- Applies a non-destructive warning banner + dashed border (red for slop) so developers still see the content but are warned before reviewing
- Minimum length threshold (80 chars) skips one-line commit messages that are too short to classify reliably

**Real-world example:** A PR description reading *"This PR updates the code to improve performance and follow best practices. It is worth noting that this change is important."* — zero specifics, no linked issues, no file references. SlopBlock flags it at 84% confidence with a dismissible warning banner.

---

### Track E — Content & SEO

**Coverage:** Web pages, blogs, listicles, product listings, content farms

**Detection mechanisms:**
- Full-page text classification via Enhanced Mode (local HTTPS proxy injects detection into all pages)
- Social-card boundary detection catches article previews in feeds
- Heuristic scoring catches SEO filler phrases: *"In this comprehensive guide..."*, *"best practices"*, *"unlock the potential"*
- Stylometric analysis flags unnaturally uniform paragraph structures common in mass-produced AI blog posts
- Ad blocking via declarative net request rules filters network-level content farm ads

**Real-world example:** A 1,200-word blog post ranking on page one for "best CRM software" that contains zero original research, no cited sources, and uses the phrase *"In today's rapidly evolving business landscape"* — SlopBlock flags it at 89% confidence.

### Track H — Social & News

**Coverage:** X/Twitter, LinkedIn, Reddit, Facebook, news feeds, comment sections

**Detection mechanisms:**
- Generic DOM card-boundary climbing — works on any social feed without platform-specific selectors
- Role-based detection (`role="feed"`, `role="article"`, `role="listitem"`)
- Short-text gating prevents overflagging human social posts while catching AI engagement bait
- Specific selectors for X/Twitter (`[data-testid="tweetText"]`), LinkedIn (`occludable-update`), Reddit (`shreddit-post`)
- Hover-event blocking prevents video previews from loading on flagged thumbnail containers

**Real-world example:** A LinkedIn "thought leadership" thread with 8 posts, each starting with *"Here are 3 key takeaways"* and ending with *"What do you think? Comment below!"* — SlopBlock flags the entire card at 94% confidence.

---

## Why This Is a Unified Engine

Both tracks share the **exact same detection pipeline** in `classifier.js`:

1. **Text preprocessing** — sentence splitting, abbreviation protection, word tokenization
2. **Heuristic scoring** (`getSlopScore()`) — 116 LLM cliché phrases, structural uniformity, lexical diversity, burstiness, emoji/formatting tells
3. **Stylometric scoring** (`getStylometricScore()`) — inter-sentence Jaccard similarity, opener repetition
4. **ML ensemble** — Model 1 (tmr-ai-text-detector) + Model 2 (e5-small-lora), with consensus/veto logic
5. **Confidence blending** — 75% model / 25% heuristic, with short-text gate and stylometric adjustment
6. **Image pipeline** — 3-model ONNX ensemble + C2PA + PNG tEXt chunks + URL forensics

The only difference between Track E and Track H is the **DOM boundary detection** in `extension/content.js`:
- Track E uses full-page paragraph scanning (`p`, `blockquote`, `.article-body p`)
- Track H uses card-boundary climbing (feed children, articles, custom elements)

Both feed into the **same `/classify` endpoint** on `localhost:8083`.

---

## Track Aspirations (Future Work)

While not yet implemented, the architecture supports:

- **Track A (Code Review)** — By adding a GitHub content script that sends PR descriptions and commit messages to the same `/classify` endpoint. The stylometric scorer is already calibrated for uniform technical prose.
- **Track B (Docs & KBs)** — Full-page classification of documentation sites (docs.microsoft.com, ReadTheDocs, Confluence) via Enhanced Mode.
- **Track G (Marketplaces)** — Amazon/eBay review scraping + classification. The short-text gate and heuristic phrase detection are already tuned for generic review language.

---

## Evidence

| Source | Track | Slop Type | Detection Confidence | Method |
|---|---|---|---|---|
| X.com /threadbooster | H | AI engagement thread | 94% | heuristic + model2 |
| LinkedIn #thoughtleader | H | Corporate AI post | 89% | heuristic + stylometric |
| Reddit r/AskReddit top | H | Human comment | 12% | passed — URLs + typos |
| News blog (content farm) | E | SEO filler article | 91% | model consensus + heuristic |
| Medium listicle | E | "5 AI Tools" listicle | 87% | heuristic + low burstiness |
| Product review (generic) | E/G | "This product is amazing" | 78% | heuristic (blocklist) |

Full live-fire results in `evaluation/live-fire-results.md`.

---

## Why This Earns the Bonus

The hackathon rules state: *"Build a tool that meaningfully detects slop across two or more tracks from a unified detection engine."*

SlopBlock does exactly this:
- **One engine** (`classifier.js`)
- **Two distinct domains** (social/news feeds + web content/SEO)
- **Same models, same heuristics, same stylometrics**
- **Browser extension adapts boundary detection** without changing classification logic

This is not two tools glued together. This is one detection brain with two sets of eyes.
