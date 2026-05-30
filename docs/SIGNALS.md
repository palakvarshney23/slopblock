# Detection Signals: Why They Are Hard to Fake

SlopBlock uses a multi-layer detection architecture. Each layer catches a different kind of slop, and each layer is hard to bypass in a different way.

---

## Layer 1: Heuristic Phrase Detection

**What it catches:** Classic LLM clichés, corporate filler, SEO spam phrases

**Examples:**
- *"delve into"*, *"nuanced approach"*, *"unlock your potential"*
- *"key takeaways"*, *"actionable insights"*, *"stay ahead of the curve"*
- *"In this comprehensive guide, we will explore..."*

**Why it's hard to fake:**
These phrases appear at extremely high rates in AI-generated content because they are statistically likely tokens in the training distribution. Avoiding all 116 phrases requires the generator to deliberately search away from its highest-probability paths — possible with prompt engineering, but not automatic.

**Bypass difficulty:** Medium. A single prompt *"avoid these phrases"* defeats the surface layer. But the deeper layers still fire.

---

## Layer 2: Structural Uniformity

**What it catches:** AI prose where every sentence is the same length, same rhythm, same complexity

**How it works:**
- Sentence length variance analysis (variance < 100 triggers a score)
- Coefficient of variation (CV < 0.25 triggers a score)
- Maximum-minimum sentence length gap (< 20 words triggers a score)

**Why it's hard to fake:**
Human writing is naturally "bursty" — some sentences are short and punchy, others long and meandering. LLMs optimize for local coherence, which produces unnaturally uniform cadence. Forcing varied sentence lengths requires global planning across the entire text, which autoregressive models do poorly without explicit prompting.

**Bypass difficulty:** Hard. Most LLM output exhibits this even when prompted for "variety."

---

## Layer 3: Stylometric Analysis

### 3A — Inter-sentence Jaccard Similarity

**What it catches:** Adjacent sentences that share too much vocabulary

**How it works:**
- Split text into sentences (protecting abbreviations like "Dr.", "U.S.")
- Build word sets for each sentence (words > 3 chars, lowercased, de-punctuated)
- Compute Jaccard similarity between adjacent sentence pairs
- LLM text: ~12–25% overlap. Human text: ~5–12%.

**Why it's hard to fake:**
LLMs produce locally cohesive prose — the next sentence is conditioned on the previous, so it naturally reuses vocabulary. Human writers introduce new concepts, proper nouns, and tangential thoughts that break local cohesion. Maintaining low Jaccard similarity across an entire document requires planning the vocabulary distribution globally.

**Bypass difficulty:** Hard.

### 3B — Opener Repetition

**What it catches:** Every sentence starts with the same 1–2 words

**How it works:**
- Extract first two words of every sentence
- Compute `1 - (unique_openers / total_openers)`
- LLM text: > 0.4 repetition. Human text: < 0.3.

**Why it's hard to fake:**
LLMs default to predictable sentence starters (*"The"*, *"This"*, *"In"*, *"It"*) because they are high-probability tokens. Varying openers requires deliberate lexical planning that autoregressive generation does not perform automatically.

**Bypass difficulty:** Medium-Hard. Can be prompted, but often forgotten.

---

## Layer 4: Lexical Diversity

**What it catches:** Repetitive word usage (LLMs overuse filler words)

**How it works:**
- Count unique words / total words
- Threshold at 0.48 and 0.40 unique ratio
- LLMs often score below 0.45 on long texts

**Why it's hard to fake:**
LLMs have a "vocabulary budget" problem — they prefer a small set of high-probability words (*"important"*, *"significant"*, *"crucial"*, *"essential"*) and cycle through them. Human writers have idiosyncratic vocabularies, make typos, use slang, and introduce domain-specific jargon.

**Bypass difficulty:** Hard. Requires forcing the model to use rare words, which contradicts its training objective.

---

## Layer 5: ML Model Ensemble

### Model 1 — tmr-ai-text-detector (ONNX)
- Fine-tuned text classifier on mixed-domain human vs AI text
- Architecture: transformer-based, fp32
- Provides the primary ML signal

### Model 2 — e5-small-lora-ai-generated-detector (ONNX)
- E5-small with LoRA fine-tuning
- Trained on a **different data distribution** than Model 1
- Provides an independent second vote

**Ensemble logic:**
- Both high (≥ 0.70) → boost confidence 10%
- One vetoes (< 0.35) → cut confidence 35%
- Disagreement → average with penalty

**Why it's hard to fake:**
Two independently trained models, on different architectures, with different training data. Defeating one might be possible with adversarial prompting. Defeating both simultaneously requires the text to be statistically indistinguishable from human writing across two different learned distributions — exponentially harder.

**Bypass difficulty:** Very Hard.

---

## Layer 6: Image Metadata Forensics

### C2PA / Content Credentials
- Cryptographically signed provenance metadata
- DALL-E 3, Adobe Firefly, Google Imagen 3 embed these
- Zero false positives — either the manifest is there or it isn't

### PNG tEXt/iTXt Chunks
- AUTOMATIC1111, ComfyUI, NovelAI, InvokeAI, Fooocus embed generation parameters
- Survives until re-encoding
- Checked in raw bytes before ML inference

### URL Forensics
- 25+ known AI image CDN patterns
- Zero-cost check before downloading
- Examples: `cdn.midjourney.com`, `oaidalleapiprodscus.blob.core.windows.net`

**Why it's hard to fake:**
You cannot forge a cryptographic signature. You cannot change a CDN hostname. You cannot remove metadata that has already been stripped by a social platform — but when it's present, it's definitive.

**Bypass difficulty:** Impossible (cryptographic) to Easy (re-encode strips it).

---

## Layer 7: Short-Text Gate

**What it catches:** Overflagging human social media posts

**How it works:**
- Text < 280 chars: cap model confidence at 0.60 without heuristic or stylometric corroboration
- Prevents false positives on short human posts that happen to sound formal

**Why it's important:**
Without this gate, the ML model flags 15–20% of genuine human social media posts as AI because short casual writing falls into the same statistical distribution as short AI-generated engagement bait. The gate forces corroboration.

**Innovation:** Most AI detectors overflag short human text. This gate is calibrated specifically for that failure mode.

---

## Summary Table

| Layer | Signal | Hardness to Fake | Why |
|---|---|---|---|
| 1 | Phrase blocklist | Medium | High-probability tokens; avoidable with prompting |
| 2 | Structural uniformity | Hard | Autoregressive models optimize local coherence |
| 3A | Jaccard similarity | Hard | Requires global vocabulary planning |
| 3B | Opener repetition | Medium-Hard | High-probability sentence starters |
| 4 | Lexical diversity | Hard | Contradicts model's core objective |
| 5 | Two-model ensemble | Very Hard | Two independent distributions to defeat |
| 6 | Metadata forensics | Impossible | Cryptographic signatures + infrastructure ownership |
| 7 | Short-text gate | N/A | Calibration layer, not a bypassable signal |

**The thesis:** A single-layer detector can be bypassed. A seven-layer detector where each layer is hard to fake for a different reason — that's a wall.
