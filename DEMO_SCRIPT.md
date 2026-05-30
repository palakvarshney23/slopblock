# SlopBlock — 2-Minute Demo Video Script

**Title:** SlopBlock Catching Real AI Slop in the Wild
**Target Length:** 2:15
**Format:** Screen recording + voiceover (no face required)
**Resolution:** 1920×1080, 60fps

---

## Scene 1: Hook (0:00–0:10)

**Visual:**
- Black screen. White text appears one line at a time:
  - "The internet has a quality problem."
  - "AI-generated slop is everywhere."
  - "Nobody is asking 'was this made with AI?'"
  - "The question is: did anyone actually check it before publishing?"
- Cut to the SlopBlock logo + tagline: "Reclaim the internet from slop."

**Audio:**
> "Every day, millions of AI-generated posts, articles, and images flood the web. The question isn't whether AI was used — it's whether a human ever reviewed the output. This is SlopBlock."

---

## Scene 2: Social Feed — Track H (0:10–0:40)

**Visual:**
- Chrome window. Navigate to X/Twitter feed (prepared demo account or public feed).
- Scroll. Watch as SlopBlock placeholders replace AI-looking posts in real time.
- Highlight one placeholder: "Suspected AI Generated Post — 94% confidence · heuristic + model2"
- Click the "Show post" reveal button. The original text appears.
- Click again to hide.

**Audio:**
> "On social media, SlopBlock intercepts AI-generated engagement bait before you waste a click. It runs entirely on your machine — no text ever leaves your browser. Here, a thread that restates its own heading three different ways is flagged at ninety-four percent confidence. One click to reveal, one click to hide."

---

## Scene 3: LinkedIn + Reddit — Cross-Track H (0:40–0:60)

**Visual:**
- Tab switch to LinkedIn feed. Scroll. Another placeholder appears on a "thought leadership" post.
- Show the dashboard popup: "Text blocked: 12 · Images blocked: 3"
- Tab switch to Reddit. Scroll r/technology. Human comments pass untouched. One AI marketing post is blurred.

**Audio:**
> "It works across platforms — LinkedIn, Reddit, any site — using the same detection engine. The only thing that changes is how we find the content boundary."

---

## Scene 4: News / SEO Slop — Track E (1:00–1:20)

**Visual:**
- Open a known content-farm article (e.g., a generic "Best CRM Software 2026" listicle).
- Full-page text classification highlights paragraphs in orange/red as they score high.
- Scroll to a genuinely useful paragraph — it passes, no highlight.
- Show dashboard: stats climbing.

**Audio:**
> "For blogs and SEO content farms, SlopBlock analyses full-page text density. This article ranks on page one, says absolutely nothing, and is flagged paragraph by paragraph. But when it hits a section with real citations and specific instructions, the warning disappears."

---

## Scene 5: GitHub — Track A (New Hackathon Work) (1:20–1:35)

**Visual:**
- Navigate to a popular open-source repo on GitHub.
- Open a pull request. The description has a red dashed border and a yellow warning banner:
  "SlopBlock: AI-generated content detected (89% confidence · heuristic) — Dismiss"
- Scroll to comments. One comment is clean (no border). Another has the warning.
- Click "Dismiss" on the warning; border disappears.

**Audio:**
> "We built a new GitHub code-review scanner during the hackathon. It flags PR descriptions and comments that summarize the diff you can already read — hollow documentation that wastes reviewer time. Dismiss it if you disagree. SlopBlock surfaces the problem; you make the call."

---

## Scene 6: Image Detection + YouTube (1:35–1:55)

**Visual:**
- Open a forum thread with an AI-generated landscape image.
- Image placeholder appears: "Suspected AI Image — 97% confidence · model"
- Click reveal. Show the actual image.
- Switch to YouTube. Scroll feed. A video thumbnail is dimmed with a badge: "AI-DISCLOSED".
- Hover over the badge. Tooltip: "Creator declared altered or synthetic content."

**Audio:**
> "Images are caught by a three-model ONNX ensemble plus metadata forensics. This landscape is flagged because the raw file still contains the generator's parameters. And on YouTube, videos where the creator declared synthetic content are intercepted before you waste a click."

---

## Scene 7: Honest Numbers + Dashboard (1:55–2:10)

**Visual:**
- Open the SlopBlock dashboard window.
- Show stats: "Text blocked: 47 · Images blocked: 12 · YouTube blocked: 5"
- Switch to a terminal. Run the bake-off script:
  ```
  node evaluation/bake-off.js --dataset evaluation/hc3-sample-100.json --threshold 0.60
  ```
- Output appears: Precision 89.0%, Recall 73.0%, FPR 9.0%.
- Show README section titled "Where It Fails".

**Audio:**
> "We are honest about what we miss. Our bake-off against three labeled datasets shows eighty-nine percent precision and seventy-three percent recall. We catch most slop, but heavily edited AI output and short formal human posts still slip through. A detector that claims ninety-nine percent accuracy is lying. We chose the tradeoff: seventy-three percent recall, nine percent false positives, one hundred percent on-device."

---

## Scene 8: Closing (2:10–2:15)

**Visual:**


- Text: "Built for the Slop Scan Hackathon · May 2026"

**Audio:**
> "SlopBlock. Reclaim the internet from slop."

---

## Recording Tips

1. **Use a clean Chrome profile** with only SlopBlock installed.
2. **Prepare feeds in advance** — bookmark 3–5 URLs with known AI and human content so the demo is deterministic.
3. **Enable Slow Mouse Trails** in OBS or your recording tool so viewers can follow clicks.
4. **Voiceover can be recorded after** — script the audio, record the screen first, then dub.
5. **Keep transitions under 0.5s** — hard cuts maintain energy.
6. **Add captions** for accessibility and for judges watching without sound.

## Export Settings

- **Codec:** H.264
- **Bitrate:** 8–12 Mbps
- **Audio:** AAC, 192 kbps
- **Upload:** YouTube (unlisted) + backup to GitHub Releases
