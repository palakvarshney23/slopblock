/**
 * background.js patch for SlopProx DINOv2 + ReStraV integration
 * ==============================================================
 * Replaces the video classification section of your existing background.js.
 *
 * KEY CHANGES vs CLIP version:
 *   1. Sends 5 frames initially (fast path), plus optional 8-frame set
 *      when two-stage gating is enabled.
 *   2. Handles the new response shape from video_classifier.js:
 *      { score, label, phase, twoStage, latencyMs, threshold }
 *   3. Adds "AI_GENERATED" label alongside the existing binary badge logic.
 *
 * HOW TO APPLY:
 *   Find the classifyVideo / handleVideoRequest section in your background.js
 *   and replace it with the code below. The rest of background.js stays the same.
 *
 * CONTENT.JS CHANGE NEEDED (see capture5And8Frames below):
 *   content.js must return BOTH 5-frame and 8-frame arrays in its message.
 *   See the drop-in sendVideoFrames() at the bottom of this file.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const VIDEO_ENDPOINT = "http://127.0.0.1:8083/classify-video";
const VIDEO_TIMEOUT_MS = 8000;   // 8s: covers two-stage 8-frame worst case

/**
 * Two-stage gating toggle.
 * When true: background.js sends both frames5 and frames8.
 * video_classifier.js decides whether to use frames8 based on borderline score.
 * When false: only frames5 sent (faster, slightly lower accuracy on borderline cases).
 */
const TWO_STAGE = true;


// ─── Request handler (replace your existing classifyVideo function) ───────────

/**
 * @param {object} message — from content.js, shape:
 *   { frames5: string[], frames8?: string[], videoSrc: string }
 * @returns {Promise<{score: number, label: string, badge: string}>}
 */
async function classifyVideoMessage(message) {
  const { frames5, frames8, videoSrc } = message;

  if (!frames5 || frames5.length === 0) {
    return { error: "No frames provided" };
  }

  const payload = {
    frames: frames5,
    ...(TWO_STAGE && frames8 ? { frames8 } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDEO_TIMEOUT_MS);

  try {
    const resp = await fetch(VIDEO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const err = await resp.text();
      console.warn("[BG] classify-video error:", err);
      return { error: `Classifier error: ${resp.status}` };
    }

    const result = await resp.json();

    // Normalise to the badge/UI shape your extension expects
    const score = result.score ?? 0;
    const badge = result.label === "AI_GENERATED" ? "AI" : "real";

    console.log(
      `[BG] Video classified: score=${score.toFixed(3)} badge=${badge}` +
      ` phase=${result.phase} twoStage=${result.twoStage} ms=${result.latencyMs}` +
      ` src=${videoSrc?.slice(0, 60)}`
    );

    return {
      score,
      label: result.label,
      badge,
      phase: result.phase,
      twoStage: result.twoStage,
    };

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      console.warn("[BG] classify-video timeout");
      return { error: "timeout" };
    }
    console.error("[BG] classify-video fetch error:", err);
    return { error: err.message };
  }
}


// ─── Message listener (patch your existing chrome.runtime.onMessage handler) ──
// Replace the video branch in your existing onMessage with:

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLASSIFY_VIDEO") {
    classifyVideoMessage(message)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;  // async response
  }
  // ... your other message handlers remain here
});


// ─── content.js: drop-in sendVideoFrames() ───────────────────────────────────
// Paste this into your content.js, replacing the existing frame-capture block.
//
// async function sendVideoFrames(videoEl) {
//   const frames5 = await captureFrames(videoEl, 5);   // your existing logic
//   const frames8 = await captureFrames(videoEl, 8);   // add 3 more
//
//   const result = await chrome.runtime.sendMessage({
//     type: "CLASSIFY_VIDEO",
//     frames5,
//     frames8,
//     videoSrc: videoEl.currentSrc,
//   });
//
//   applyBadge(videoEl, result);
// }
