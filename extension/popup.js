// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// popup.js

(async () => {
  const dot        = document.getElementById('dot');
  const statusLabel = document.getElementById('statusLabel');
  const mainEl     = document.getElementById('main');
  const offlineEl  = document.getElementById('offline');
  const footerText = document.getElementById('footerText');
  const textCount  = document.getElementById('textCount');
  const imgCount   = document.getElementById('imgCount');
  const ytCount    = document.getElementById('ytCount');

  textCount.textContent = '—';
  imgCount.textContent  = '—';
  ytCount.textContent   = '—';

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'status' });
    if (!resp?.ok) throw new Error('no response');
    const data = resp.data;

    const anyActive = data.enabled || data.imageDetectionEnabled || data.videoDetectionEnabled || data.youtubeFilterEnabled;
    dot.className   = 'status-dot ' + (anyActive ? 'on' : 'off');
    statusLabel.textContent = anyActive ? 'LIVE' : 'PAUSED';

    if (typeof data.textAnalyzed    === 'number') textCount.textContent = data.textAnalyzed.toLocaleString();
    if (typeof data.imagesAnalyzed  === 'number') imgCount.textContent  = data.imagesAnalyzed.toLocaleString();
    if (typeof data.youtubeAnalyzed === 'number') ytCount.textContent   = data.youtubeAnalyzed.toLocaleString();

    if (!data.enabled) {
      footerText.textContent = 'Text filtering paused';
    }
  } catch (_) {
    dot.className          = 'status-dot off';
    statusLabel.textContent = 'OFFLINE';
    mainEl.style.display   = 'none';
    offlineEl.style.display = 'block';
  }
})();
