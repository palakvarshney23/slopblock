// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// content.js

(function () {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__sfLoaded) return;
  window.__sfLoaded = true;

  const TEXT_SEL = [
    'p',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote',
    'li:not(nav li):not(header li):not(footer li):not(aside li)',
    '[data-testid="tweetText"]',
    '[data-testid="birdwatch-pivot"]',
    '[data-testid="post-body"]',
    '[data-testid="post-content"]',
    '.article-body p',
    'span[data-testid]',
    '#customerReviews p',
    '#cm_cr-review_list p',
    '[data-hook="review"]',
    '[data-hook="review-body"]',
    '.review-text-content',
    '#reviewsMedley [data-hook="review"]',
  ].join(', ');

  const VIDEO_META_SEL = [
    'h1.ytd-watch-metadata yt-formatted-string',
    '#description-inner yt-attributed-string',
    '#above-the-fold #title',
    '[data-e2e="browse-video-desc"]',
    '[class*="DivVideoDesc"]',
    'h1[data-e2e="video-desc"]',
    '._a9zs',
    '[class*="C4VMK"] span',
    'article div[role="button"] span',
    '[data-ad-preview="message"]',
    '[class*="kvgmc6g5"]',
  ].join(', ');

  const CAPTION_SEL = [
    '.ytp-caption-segment',
    '[class*="SubtitleText"]',
    '[data-e2e="video-subtitle"]',
    '[class*="captionsText"]',
    '.story-inline-caption',
  ].join(', ');

  const AI_DISCLOSURE_TAGS = [
    '#aigenerated', '#aigeneratedcontent', '#aivideo',
    '#madewithai', '#generatedbyai', '#synthid',
    '#aicreated', '#aifilm', '#aianimation', '#soravideo',
  ];

  const CAPTION_FLUSH_MS   = 8000;
  const CAPTION_MIN_WORDS  = 40;
  const CAPTION_MAX_BUFFER = 400;
  const VIDEO_META_MIN_CONFIDENCE = 90;
  const CAPTION_MIN_CONFIDENCE = 90;
  const FRAME_SAMPLE_COUNT = 8;
  const FRAME_SAMPLE_WINDOW_SEC = 5;
  const FRAME_SKIP_START_SEC = 1.5;
  const FRAME_SEEK_TIMEOUT_MS = 1500;
  const FRAME_WIDTH        = 320;
  const FRAME_HEIGHT       = 180;
  const FRAME_QUALITY      = 0.72;
  const VIDEO_MIN_DURATION = 3;
  const SESSION_WHITELIST_REVEALS = 2;
  let videoWarnConf  = 55;
  let videoBlockConf = 65;

  const PLATFORM_AI_LABEL_SEL = [
    '[aria-label*="Altered or synthetic"]',
    '[aria-label*="Altered content"]',
    '[aria-label*="Synthetic content"]',
    '[aria-label*="Made with AI"]',
    '[aria-label*="AI-generated"]',
    '[class*="AIGenerated"]',
    '[class*="aigc"]',
    '[data-e2e="aigc-tag"]',
    '[class*="AIInfo"]',
    '[class*="ai-info"]',
    'ytd-structured-description-content-renderer',
  ].join(', ');

  const PLATFORM_AI_LABEL_TEXT = [
    'altered or synthetic', 'synthetic content', 'made with ai', 'ai-generated',
    'generative ai', 'aigc', 'content credentials', 'ai info',
  ];

  // These are updated from the server's /status config on every poll cycle.
  let MIN_LEN         = 30;
  let IMG_MIN_PX      = 300;
  let IMG_DISP_MIN_PX = 200;
  let IMG_CONF_FORCE  = 92;

  // Hover events that trigger video previews on thumbnail containers.
  // Blocked in capture phase during classification so preview cannot start
  // before the verdict arrives. Does not include click/pointer{down,up} to
  // avoid breaking scroll and our own reveal button.
  const _HOVER_BLOCK_EVENTS = [
    'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
    'pointerenter', 'pointerleave', 'pointerover', 'pointerout',
  ];

  const _SF_DEBUG = (typeof chrome !== 'undefined' && chrome.runtime?.id)
    ? (ctx, err) => console.debug(`[sf:${ctx}]`, err?.message ?? err)
    : () => {};

  // Track G: marketplace.js sets this; skip generic paragraph/card text scan on Amazon/eBay.
  function _skipMarketplaceText() {
    return document.documentElement.dataset.sfMarketplace === '1';
  }

  let filterEnabled         = true;
  let imageDetectionEnabled = true;
  let videoDetectionEnabled = true;
  let youtubeFilterEnabled  = true;
  let _trustedPatterns      = [];
  const _videoEvidence      = new WeakMap();
  const _sessionChannelWhitelist = new Set();
  const _channelRevealCounts     = new Map();
  let currentYtInterceptor  = null; // { cleanup(), play() } for active video block
  let ytBlockedHref         = null; // href at the time the block was applied

  // ── Catch-all card boundary detection ──────────────────────────
  //
  // Works on any site without platform-specific selectors.
  // Climbs the DOM from the flagged element looking for a "card":
  //
  //   1. Feed-child: direct child of role="feed" — always a post card
  //      (LinkedIn occludable-update, X.com timeline cells, etc.)
  //   2. Semantic card: <article> / role="article" / role="listitem"
  //      with at least one peer sibling
  //   3. Custom element: hyphenated tag (shreddit-post, etc.) with peers
  //   4. Visual card: element with border/shadow + border-radius + peers
  //
  // Stops before page-frame elements (main, header, nav, body) and
  // before climbing INTO the feed container itself.
  // Returns null for single-page article context → inline paragraph mode.
  //
  function findCardBoundary(el) {
    let node = el.parentElement;
    const viewportH = window.innerHeight;
    let climbed = 0;

    while (node && node !== document.body && climbed < 16) {
      climbed++;

      if (node.dataset.sfAiFlagged || node.dataset.sfCardBlurred || node.dataset.sfRevealed) return null;

      const tag  = node.tagName;
      const role = (node.getAttribute('role') || '').toLowerCase();

      // Absolute hard stops — never these page-frame containers
      if (/^(MAIN|BODY|HTML|HEADER|FOOTER|NAV)$/.test(tag)) break;
      if (/^(main|navigation|banner|contentinfo)$/.test(role)) break;

      const rect = node.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 50) { node = node.parentElement; continue; }
      if (rect.height > viewportH * 0.85)        { node = node.parentElement; continue; }

      const parentEl   = node.parentElement;
      const parentRole = (parentEl?.getAttribute('role') || '').toLowerCase();

      // ── 1. Feed-child ───────────────────────────────────────────
      // Direct children of role="feed" ARE post cards by definition.
      // This catches LinkedIn's occludable-update divs which have no
      // visible border/shadow themselves but are children of role="feed".
      // Check this FIRST — it's the most reliable signal.
      if (parentRole === 'feed') {
        const peers = [...parentEl.children].filter(c => c !== node && c.offsetHeight > 40);
        if (peers.length >= 1) return node;
      }

      // ── 2. Semantic card ────────────────────────────────────────
      if (tag === 'ARTICLE' || role === 'article' || role === 'listitem') {
        const peers = [...(parentEl?.children || [])].filter(c => c !== node && c.offsetHeight > 40);
        if (peers.length >= 1) return node;
      }

      // ── 3. Custom element / web component (e.g., shreddit-post) ─
      // Hyphenated tag names are always custom elements. If they're
      // substantial in size, have peers, AND contain visible text content
      // (a title, description, etc.), they're feed cards.
      // The text check prevents returning image-wrapper custom elements
      // (e.g. yt-image, ytd-thumbnail) that also have hyphens and peers
      // but contain no text — those are not cards.
      if (tag.includes('-') && rect.height > 100) {
        const peers = [...(parentEl?.children || [])].filter(c => c !== node && c.offsetHeight > 40);
        if (peers.length >= 1 && (node.innerText?.trim().length > 30)) return node;
      }

      // ── 4. Visual card ──────────────────────────────────────────
      const cs            = getComputedStyle(node);
      const hasBorder     = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
      const hasShadow     = cs.boxShadow !== 'none' && cs.boxShadow !== '';
      const hasBorderRadius = parseFloat(cs.borderRadius) > 4;

      if ((hasBorder || hasShadow) && hasBorderRadius) {
        const peers = [...(parentEl?.children || [])].filter(c => c !== node && c.offsetHeight > 40);
        if (peers.length >= 1) return node;
      }

      // Soft stop: don't climb above the feed container itself.
      // This fires AFTER the checks above so a feed's direct children
      // are evaluated before we stop.
      if (role === 'feed') break;

      node = node.parentElement;
    }

    return null;
  }

  // ── Placeholder event guards ────────────────────────────────────
  // Prevents placeholder clicks from reaching ancestor link/card handlers.
  //
  // Two layers:
  //   1. mousedown capture — blocks drag-start and text-selection on background
  //   2. click bubble     — stops ALL clicks bubbling past the placeholder,
  //                         covering parent divs with onclick navigation (LinkedIn,
  //                         Reddit, Twitter card wrappers, etc.)
  //
  // The reveal button's own click handler calls stopPropagation too, but that
  // only stops propagation from the button upward — this handles the case where
  // the click lands on the placeholder background rather than the button.
  function installGuards(placeholder) {
    placeholder.addEventListener('mousedown', e => {
      if (!e.target.closest('.sf-reveal-btn')) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    // Bubble phase: runs after the button's own click handler (if the click was
    // on the button, stopPropagation there already prevents this from firing).
    // Catches background clicks and stops them from reaching any ancestor.
    placeholder.addEventListener('click', e => {
      e.stopPropagation();
      if (!e.target.closest('.sf-reveal-btn')) e.preventDefault();
    });
  }

  // ── Text classification batch queue ────────────────────────────
  // Buffers classify requests for 50 ms then sends them as a single
  // background message, cutting per-page HTTP round-trips by ~70%.
  // Each entry: { text, resolve } where resolve(result) fires on completion.
  const _textBatchQueue = [];
  const _TEXT_BATCH_MAX = 200;
  let _textBatchTimer = null;

  function _flushTextBatch() {
    _textBatchTimer = null;
    if (!_textBatchQueue.length) return;
    const batch = _textBatchQueue.splice(0);
    console.debug('[SlopBlock] flushing text batch, size=', batch.length);
    // Send all texts at once; background.js issues one /classify call per item
    // but they share a single message channel round-trip.
    Promise.allSettled(
      batch.map(({ text }) =>
        new Promise(res => {
          chrome.runtime.sendMessage({ type: 'classify', text })
            .then(r => res(r))
            .catch(() => res({ ok: false }));
        })
      )
    ).then(results => {
      results.forEach((r, i) => {
        batch[i].resolve(r.status === 'fulfilled' ? r.value : { ok: false });
      });
    });
  }

  function _batchClassifyText(text) {
    console.debug('[SlopBlock] batch classify text:', text.slice(0,60));
    return new Promise(resolve => {
      if (_textBatchQueue.length >= _TEXT_BATCH_MAX) {
        const dropped = _textBatchQueue.shift();
        dropped.resolve({ ok: false });
      }
      _textBatchQueue.push({ text, resolve });
      if (!_textBatchTimer) _textBatchTimer = setTimeout(_flushTextBatch, 50);
    });
  }

  // ── Status polling ──────────────────────────────────────────────
  async function pollStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'status' });
      console.debug('[SlopBlock] pollStatus resp:', resp?.ok, 'enabled=', resp?.data?.enabled, 'img=', resp?.data?.imageDetectionEnabled, 'vid=', resp?.data?.videoDetectionEnabled, 'yt=', resp?.data?.youtubeFilterEnabled, 'config=', resp?.data?.config);
      if (!resp?.ok) return;
      const data = resp.data;
      const patterns = data.trustedPatterns || [];
      _trustedPatterns = patterns;
      const bypassDomains = data.bypassDomains || [];
      const hostname = location.hostname;
      const isBypassed = bypassDomains.some(d => hostname === d || hostname.endsWith('.' + d));
      const isTrusted = patterns.length && patterns.some(p => location.href.startsWith(p) || hostname === p || hostname.endsWith('.' + p));
      if (isBypassed || isTrusted) {
        filterEnabled = false;
        observer.disconnect();
        imageObserver.disconnect();
        videoObserver.disconnect();
        captionObserver.disconnect();
        clearInterval(statusTimer);
        console.debug('[SlopBlock] Skipping filtering on', location.href,
          isBypassed ? '(bypass domain)' : '(trusted source)');
        return;
      }
      const wasEnabled      = filterEnabled;
      const wasImageEnabled = imageDetectionEnabled;
      const wasVideoEnabled = videoDetectionEnabled;
      filterEnabled         = data.enabled ?? true;
      imageDetectionEnabled = data.imageDetectionEnabled ?? false;
      videoDetectionEnabled = data.videoDetectionEnabled ?? false;
      youtubeFilterEnabled  = data.youtubeFilterEnabled ?? true;

      if (data.config) {
        if (data.config.textMinLength    != null) MIN_LEN         = data.config.textMinLength;
        if (data.config.imageMinNaturalPx != null) IMG_MIN_PX     = data.config.imageMinNaturalPx;
        if (data.config.imageMinDisplayPx != null) IMG_DISP_MIN_PX = data.config.imageMinDisplayPx;
        if (data.config.imageForceConfidence != null) IMG_CONF_FORCE = data.config.imageForceConfidence;
      }
      if (data.videoWarnThreshold != null)  videoWarnConf  = data.videoWarnThreshold;
      else if (data.config?.videoWarnThreshold != null) {
        videoWarnConf = Math.round(data.config.videoWarnThreshold * 100);
      }
      if (data.videoBlockThreshold != null) videoBlockConf = data.videoBlockThreshold;
      else if (data.config?.videoBlockThreshold != null) {
        videoBlockConf = Math.round(data.config.videoBlockThreshold * 100);
      }

      if (wasEnabled && !filterEnabled) {
        document.querySelectorAll('[data-sf-ai-flagged]').forEach(el => _clearAiFlag(el));
        document.querySelectorAll('.sf-card-placeholder').forEach(p => {
          if (p._sfCard) {
            p._sfCard.style.display = p._sfCardDisplay || '';
            delete p._sfCard.dataset.sfCardBlurred;
          }
          (p.parentElement?.dataset?.sfWrapper ? p.parentElement : p).remove();
        });
        document.querySelectorAll('.sf-text-placeholder').forEach(p => {
          const el = p._sfEl;
          const wrapper = p.parentElement?.dataset?.sfWrapper ? p.parentElement : p;
          if (el) { el.classList.remove('sf-content'); delete el.dataset.slopBlurred; wrapper.replaceWith(el); }
          else wrapper.remove();
        });
        document.querySelectorAll('.sf-img-placeholder').forEach(p => {
          if (p._sfTarget) {
            p._sfTarget.style.opacity       = '';
            p._sfTarget.style.pointerEvents = '';
            delete p._sfTarget.dataset.sfImgBlurred;
          }
          unblockVideosNear(p, false);
          p.remove();
        });
        // Clean up any intercept shields still active from in-flight classifications.
        document.querySelectorAll('[data-sf-shield]').forEach(s => {
          s._sfRelease?.(); // remove capture-phase hover block from container
          const img = s._sfTarget;
          if (img) {
            img.style.opacity       = '';
            img.style.pointerEvents = '';
            img.classList.remove('sf-scanning');
            delete img.dataset.sfImgBlurred;
            delete img.dataset.sfQueued;
            delete img.dataset.sfProcessing;
          }
          s.remove();
        });
        observer.disconnect();
        imageObserver.disconnect();
        videoObserver.disconnect();
        captionObserver.disconnect();
        clearInterval(statusTimer);
      }

      // Re-queue images that loaded before image detection was ready.
      // The IntersectionObserver unobserves each image before calling classifyImage,
      // so any image seen while imageDetectionEnabled=false is permanently dropped.
      // Reset their sfImgChecked marker so watchImage re-observes them.
      if (!wasImageEnabled && imageDetectionEnabled && filterEnabled) {
        document.querySelectorAll('img[src]').forEach(img => {
          if (img.dataset.sfImgChecked === 'watching' && !img.dataset.sfImgBlurred) {
            delete img.dataset.sfImgChecked;
            watchImage(img);
          }
        });
      }

      if (wasVideoEnabled && !videoDetectionEnabled) {
        videoObserver.disconnect();
        captionObserver.disconnect();
        document.querySelectorAll('[data-sf-ai-flagged]').forEach(el => _clearAiFlag(el));
      } else if (!wasVideoEnabled && videoDetectionEnabled && filterEnabled) {
        document.querySelectorAll('video').forEach(vid => {
          if (!vid.dataset.sfVideoSampled) {
            delete vid.dataset.sfVideoWatching;
            watchVideo(vid);
          }
        });
        scanVideoContent(document.body);
      }

      // Re-scan text elements whose previous classify call failed (API unavailable /
      // token not yet acquired). slopChecked is cleared on failure so they are eligible.
      if (filterEnabled && !document.documentElement.dataset.sfProxy) {
        _scanCardsIn(document.body);
        document.querySelectorAll(TEXT_SEL).forEach(el => {
          if (!el.dataset.slopChecked) classifyText(el);
        });
      }
    } catch (err) { _SF_DEBUG('poll-status', err); }
  }

  // ── Soft AI flag (content stays visible) ─────────────────────────
  function _ensureFlagHost(el) {
    if (el && getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function _clearAiFlag(el) {
    if (!el) return;
    el.querySelectorAll('.sf-ai-img-overlay').forEach(o => o.remove());
    el.querySelectorAll('img[data-sf-img-flagged]').forEach(img => delete img.dataset.sfImgFlagged);
    delete el.dataset.sfAiFlagged;
    delete el.dataset.sfCardBlurred;
    delete el.dataset.slopBlurred;
    delete el.dataset.sfImgBlurred;
    delete el.dataset.sfVideoWarned;
    el.classList.remove('sf-ai-flagged', 'sf-ai-flagged-image', 'sf-content');
    el.querySelector('.sf-ai-badge')?.remove();
  }

  function _imageOverlayStyle(img, container) {
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const fillsContainer =
      Math.abs(imgRect.width  - containerRect.width)  < 8 &&
      Math.abs(imgRect.height - containerRect.height) < 8;
    const nearOrigin =
      imgRect.top  - containerRect.top  < 4 &&
      imgRect.left - containerRect.left < 4;

    if (fillsContainer || nearOrigin) return { inset: '0' };
    return {
      top:    (imgRect.top  - containerRect.top)  + 'px',
      left:   (imgRect.left - containerRect.left) + 'px',
      width:  imgRect.width  + 'px',
      height: imgRect.height + 'px',
    };
  }

  // Image-specific flag: red wash over the actual pixels + centered banner (not just a corner badge).
  function _applyImageAiFlag(img, container, { confidence, method, onDismiss }) {
    if (!img || !container || img.dataset.sfImgFlagged) return;
    if (container.querySelector('.sf-ai-img-overlay')) return;

    img.dataset.sfImgFlagged = 'true';
    _ensureFlagHost(container);

    const card = findCardBoundary(img);
    const flagHost = card || container;
    if (!flagHost.dataset.sfAiFlagged) {
      flagHost.dataset.sfAiFlagged = 'true';
      flagHost.classList.add('sf-ai-flagged', 'sf-ai-flagged-image');
      _ensureFlagHost(flagHost);
    }

    const overlay = document.createElement('div');
    overlay.className = 'sf-ai-img-overlay';
    overlay.innerHTML = `
      <div class="sf-ai-img-banner">
        <span class="sf-ai-badge-pct">${confidence}%</span>
        <span class="sf-ai-badge-label">AI Image</span>
        ${method ? `<span class="sf-ai-badge-method">${method}</span>` : ''}
        <button type="button" class="sf-ai-badge-dismiss" aria-label="Dismiss">×</button>
      </div>`;

    Object.assign(overlay.style, _imageOverlayStyle(img, container));

    const dismiss = (e) => {
      e?.stopPropagation();
      overlay.remove();
      delete img.dataset.sfImgFlagged;
      if (flagHost) {
        flagHost.dataset.sfRevealed = 'true';
        _clearAiFlag(flagHost);
      }
      onDismiss?.();
    };

    overlay.querySelector('.sf-ai-badge-dismiss')?.addEventListener('click', dismiss);
    overlay.addEventListener('click', e => e.stopPropagation());
    container.appendChild(overlay);

    chrome.storage.session.get('imagesBlocked').then(s => {
      chrome.storage.session.set({ imagesBlocked: (s.imagesBlocked || 0) + 1 });
    }).catch(() => {});
  }

  function _applyAiFlag(el, { confidence, method, label, detailHtml, countKey, onDismiss }) {
    if (!el || el.dataset.sfAiFlagged) return;
    el.dataset.sfAiFlagged = 'true';
    _ensureFlagHost(el);
    el.classList.add('sf-ai-flagged');

    const badge = document.createElement('div');
    badge.className = 'sf-ai-badge';
    badge.innerHTML = `
      <span class="sf-ai-badge-pct">${confidence}%</span>
      <span class="sf-ai-badge-label">${label || 'AI'}</span>
      ${method ? `<span class="sf-ai-badge-method">${method}</span>` : ''}
      ${detailHtml ? `<div class="sf-ai-badge-details">${detailHtml}</div>` : ''}
      <button type="button" class="sf-ai-badge-dismiss" aria-label="Dismiss">×</button>`;

    badge.querySelector('.sf-ai-badge-dismiss')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _clearAiFlag(el);
      onDismiss?.(el);
    });

    badge.addEventListener('click', e => e.stopPropagation());
    el.appendChild(badge);

    if (countKey) {
      chrome.storage.session.get(countKey).then(s => {
        chrome.storage.session.set({ [countKey]: (s[countKey] || 0) + 1 });
      }).catch(() => {});
    }
  }

  // ── Card / text / image slop (soft flag) ────────────────────────
  function _detectRowHtml(label, confidence, method) {
    const svg = `<svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px;"><rect x="1" y="1" width="20" height="20" rx="5" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/><path d="M6 8 L11 5 L16 8 L16 14 L11 17 L6 14 Z" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" fill="none" stroke-linejoin="round"/><circle cx="11" cy="11" r="2" fill="rgba(255,255,255,0.9)"/></svg>`;
    return `<div class="sf-detect-row">
      <span class="sf-detect-icon">${svg}</span>
      <span class="sf-detect-label">${label}</span>
      <span class="sf-detect-conf">${confidence}%</span>
      ${method ? `<span class="sf-detect-method">${method}</span>` : ''}
    </div>`;
  }

  function _wireRevealBtn(placeholder, onReveal) {
    let revealed = false;
    const doReveal = (e) => {
      if (revealed) return;
      revealed = true;
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      onReveal();
    };
    const btn = placeholder.querySelector('.sf-reveal-btn');
    btn.style.pointerEvents = 'auto';
    btn.addEventListener('pointerup', doReveal);
    btn.addEventListener('click',     doReveal);
  }

  function applyCardSlop(card, confidence, type, btnText, method, detailHtml) {
    if (card.dataset.sfAiFlagged || card.dataset.sfRevealed) return;
    if (!card.parentElement) return;
    const label = type === 'image' ? 'AI Image'
      : type === 'video' ? 'AI Video'
      : 'AI Text';
    const countKey = type === 'image' ? 'imagesBlocked' : 'textBlocked';
    _applyAiFlag(card, {
      confidence,
      method,
      label,
      detailHtml,
      countKey,
      onDismiss: () => {
        card.dataset.sfRevealed = 'true';
        if (type === 'video') _trackVideoReveal(card);
      },
    });
  }

  // ── Section-context injection ───────────────────────────────────
  //
  // Instead of hard-coding rules about what content to skip, we give the
  // model the section it came from. A paragraph in a "References" section
  // will be sent as "References\n<text>" — the model understands that is
  // bibliographic data, not AI-generated prose, without us ever needing to
  // know about citations specifically.
  //
  // Works for any site, any section type (References, FAQ, Glossary,
  // About, Terms & Conditions, etc.) without per-site special-casing.
  //
  function getClassifyText(el) {
    const content = el.textContent.trim().replace(/\s+/g, ' ');

    // Climb the DOM looking for the nearest preceding sibling heading.
    // A heading that immediately precedes a block of text names the
    // section it belongs to — exactly the context the model needs.
    let node = el;
    while (node && node !== document.body) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-6]$/.test(sib.tagName)) {
          const heading = sib.textContent.trim();
          // Use headings that are reasonably short (i.e. a real section
          // title, not an article headline that is itself long prose).
          if (heading.length > 0 && heading.length < 120) {
            return heading + '\n' + content;
          }
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }

    return content;
  }

  // ── Card-level text classification (site-agnostic) ─────────────
  //
  // On modern SPAs (LinkedIn, Facebook, etc.) post text lives in <div>
  // and <span> elements with site-specific class names — never <p> or <li>.
  // Rather than hard-coding selectors per site, we detect post cards
  // structurally (same rules as findCardBoundary) and classify the card's
  // full text as one unit. No site knowledge required.

  function looksLikePostCard(el) {
    if (!el || el === document.body) return false;
    const tag    = el.tagName || '';
    const role   = (el.getAttribute('role') || '').toLowerCase();
    const parent = el.parentElement;
    if (!parent) return false;
    const parentRole = (parent.getAttribute('role') || '').toLowerCase();

    const rect = el.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 80)             return false;
    if (rect.height > window.innerHeight * 0.85)           return false;

    const hasPeers = p => [...p.children].filter(c => c !== el && c.offsetHeight > 40).length >= 1;

    if (parentRole === 'feed'                                     && hasPeers(parent)) return true;
    if ((tag === 'ARTICLE' || role === 'article' || role === 'listitem') && hasPeers(parent)) return true;
    if (tag.includes('-') && rect.height > 100                   && hasPeers(parent)) return true;
    return false;
  }

  async function classifyCardText(card) {
    if (!filterEnabled) return;
    if (document.documentElement.dataset.sfProxy === '1') return;
    if (card.dataset.sfAiFlagged || card.dataset.sfRevealed || card.dataset.sfCardTextChecked) return;
    card.dataset.sfCardTextChecked = 'true';

    // Extract only content lines from the card — filter out UI chrome:
    // names, timestamps, reaction counts, button labels, accessibility labels
    // like "Feed post", dialog instructions, etc. These are typically short lines
    // that don't form prose. Lines ≥ 45 chars are almost always actual content.
    const raw = (card.innerText || card.textContent || '');
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length >= 20);
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length < MIN_LEN) { console.debug('[SlopBlock] card text too short', text.length, '<', MIN_LEN); return; }

    try {
      const resp = await _batchClassifyText(text);
      if (!resp?.ok) {
        delete card.dataset.sfCardTextChecked; // allow retry on next poll cycle
        return;
      }
      const { isSlop, confidence, method, skipped } = resp.data;
      if (skipped) return;
      if (isSlop) applyCardSlop(card, confidence, 'text', undefined, method);
    } catch (err) { _SF_DEBUG('classify-card', err); }
  }

  // Scan root for post cards (or treat root itself as a card).
  // Called from the MutationObserver, SPA nav hooks, and startup.
  function _scanCardsIn(root) {
    if (_skipMarketplaceText()) return;
    if (looksLikePostCard(root)) { classifyCardText(root); return; }
    const candidates = root.querySelectorAll?.('article, [role="article"], [role="listitem"], [role="feed"] > *');
    if (candidates) for (const el of candidates) { if (looksLikePostCard(el)) classifyCardText(el); }
  }

  // ── Text classification ─────────────────────────────────────────
  async function classifyRawText(text, onSlop) {
    const resp = await _batchClassifyText(text);
    if (!resp?.ok) return false;
    const { isSlop, confidence, method, skipped } = resp.data;
    if (skipped) return false;
    if (isSlop) onSlop?.(confidence, method);
    return true;
  }

  async function classifyText(el) {
    if (_skipMarketplaceText()) return;
    if (!filterEnabled || el.dataset.slopChecked) return;
    if (el.dataset.sfVideoMetaChecked) return;
    if (document.documentElement.dataset.sfProxy === '1') return;
    // Skip elements already inside a card that was flagged at the card level
    if (el.closest('[data-sf-ai-flagged], [data-sf-card-blurred]')) return;
    const content = el.textContent.trim().replace(/\s+/g, ' ');
    if (content.length < MIN_LEN) { console.debug('[SlopBlock] skip text, len', content.length, '<', MIN_LEN, content.slice(0,40)); return; }
    // Skip CSS blobs injected as text nodes
    if (/^\s*\.[\w-][\w-]*\s*\{/.test(content)) return;
    // Skip elements inside dialogs, alerts, navigation, or other non-content roles
    if (el.closest('[role="dialog"],[role="alert"],[role="status"],[role="alertdialog"],dialog,nav,aside,footer,header')) return;
    el.dataset.slopChecked = 'true';

    try {
      const classified = await classifyRawText(getClassifyText(el), (confidence, method) => {
        applyTextSlop(el, confidence, method);
      });
      if (!classified) {
        delete el.dataset.slopChecked; // allow retry on next poll cycle
      }
    } catch (err) { _SF_DEBUG('classify-text', err); }
  }

  function applyTextSlop(el, confidence, method) {
    if (el.closest('[data-sf-ai-flagged], [data-sf-card-blurred]')) return;
    const card = findCardBoundary(el);
    if (card) { applyCardSlop(card, confidence, 'text', undefined, method); return; }
    if (el.dataset.sfAiFlagged || !el.parentNode) return;
    _applyAiFlag(el, {
      confidence,
      method,
      label: 'AI Text',
      countKey: 'textBlocked',
      onDismiss: () => { el.dataset.sfRevealed = 'true'; },
    });
  }

  // ── Page-level AI density prior ─────────────────────────────────
  // After 4+ completed classifications, the page AI ratio adjusts the
  // effective threshold for subsequent borderline images:
  //   ≥ 50% AI  → +8 boost  (AI-heavy page, lower threshold)
  //   ≤ 10% AI  → −8 penalty (real-photo page, raise threshold)
  //   otherwise → no adjustment
  //
  // pageCompletedCount tracks COMPLETED classifications (not pending),
  // so the ratio is always accurate when the adjustment fires.
  let pageAiCount        = 0;  // confirmed AI images this page
  let pageCompletedCount = 0;  // completed classifications this page

  // LRU page image cache — capped at 500 to bound memory on infinite-scroll pages.
  const PAGE_CACHE_MAX = 500;
  const pageImageCache = new Map(); // src → {blocked: bool, confidence}
  function _pageImageCacheSet(key, value) {
    if (pageImageCache.has(key)) pageImageCache.delete(key);
    else if (pageImageCache.size >= PAGE_CACHE_MAX) pageImageCache.delete(pageImageCache.keys().next().value);
    pageImageCache.set(key, value);
  }

function getPagePriorAdjustment() {
  if (pageCompletedCount < 4) return 0;
  const ratio = pageAiCount / pageCompletedCount;
  if (ratio >= 0.5)  return  5;   // AI-heavy page → moderate boost
  if (ratio <= 0.10) return -5;   // real-photo page → moderate suppression
  return 0;
}

  // ── Image classification ────────────────────────────────────────
  function shouldSkipImage(img) {
    const src = img.src || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('chrome-extension:') || src.startsWith('moz-extension:')) return true;
    if (/\.gif(\?|$)/i.test(src)) return true;
    if (/\.svg(\?|$)/i.test(src)) return true;
    if (img.getAttribute('aria-hidden') === 'true') return true;
    if (img.getAttribute('role') === 'presentation') return true;

    // Skip images inside interactive controls — avatars in buttons, menu icons, etc.
    if (img.closest('[role="button"],[role="menuitem"],[role="option"],[role="tab"]')) return true;

    const w = img.naturalWidth, h = img.naturalHeight;
    if (w && h) {
      const ratio = w / h;
      // Very extreme ratios → banners, strips, icons
      if (ratio > 8 || ratio < 0.12) return true;
      // Wide landscape screenshots (tweet screenshots, UI captures, panoramas) are
      // unlikely to be AI art. AI generators produce mostly square or mild portrait/
      // landscape. Allow broader ratios to catch more content.
      if (ratio > 3.5 || ratio < 0.25) return true;
    }

    // Skip images rendered at small display sizes — catches profile pictures and
    // avatars whose natural dimensions are large (e.g. 512×512) but are shown at
    // e.g. 40×40. getBoundingClientRect is reliable here because shouldSkipImage
    // is only called after the image has loaded and entered (or is near) the viewport.
    const rendered = img.getBoundingClientRect();
    if (rendered.width > 0 && rendered.height > 0 &&
        (rendered.width < IMG_DISP_MIN_PX || rendered.height < IMG_DISP_MIN_PX)) return true;

    return false;
  }

  // Smooth unblur for images confirmed as real.
  function _clearScan(el) {
    el.style.transition = 'filter 0.3s ease-out, opacity 0.3s ease-out';
    el.classList.remove('sf-scanning');
    setTimeout(() => { el.style.transition = ''; }, 350);
  }

  async function classifyImage(img) {
    if (!imageDetectionEnabled) return;
    if (img.dataset.sfQueued || img.dataset.sfProcessing || img.dataset.sfImgFlagged || shouldSkipImage(img)) return;

    const srcKey = img.src.split('?')[0];

    // Cache hit: verdict is immediate — no race window, use applyImageSlop directly.
    if (pageImageCache.has(srcKey)) {
      const cached = pageImageCache.get(srcKey);
      pageImageCache.delete(srcKey);
      pageImageCache.set(srcKey, cached); // LRU promote
      if (cached.blocked) applyImageSlop(img, cached.confidence, 'cached');
      return;
    }

    if (img.naturalWidth < IMG_MIN_PX || img.naturalHeight < IMG_MIN_PX) return;

    // Don't stack multiple shields on the same card. YouTube's moving thumbnail
    // adds several <img> preview frames when the user hovers; without this guard
    // each frame would create its own shield/placeholder at the card level.
    if (!img.closest('[data-sf-ai-flagged], [data-sf-card-blurred]')) {
      const existingCard = findCardBoundary(img);
      if (existingCard?.dataset.sfAiFlagged || existingCard?.querySelector('[data-sf-shield], .sf-ai-badge, .sf-ai-img-overlay')) return;
    }

    img.dataset.sfQueued     = 'true';
    img.dataset.sfProcessing = 'true';

    // ── EARLY INTERCEPTION ──────────────────────────────────────────
    // Find the container and create the intercept shield BEFORE the API
    // call. The shield is transparent during classification but sits at
    // max z-index and blocks all hover/pointer events that would trigger
    // the site's video-preview logic. If verdict = slop the shield is
    // promoted to the visible placeholder in-place (zero timing gap).
    // If verdict = real it is removed cleanly with _abortShield.
    let container, shieldStyle;
    try {
      ({ container, shieldStyle } = _prepareContainer(img));
    } catch (err) {
      _SF_DEBUG('prepare-container', err);
      delete img.dataset.sfQueued;
      delete img.dataset.sfProcessing;
      return;
    }

    const shield = document.createElement('div');
    shield.dataset.sfShield    = 'true';
    shield.style.position      = 'absolute';
    shield.style.zIndex        = '2147483647';
    // pointer-events:none so clicks pass through to the card's <a> link during
    // classification. Hover suppression is handled by the document-level capture
    // block — the shield itself does not need to absorb events.
    shield.style.pointerEvents = 'none';
    shield.style.cursor        = 'default';
    Object.assign(shield.style, shieldStyle);
    container.appendChild(shield);

    // Capture-phase blocker kills hover events on the container before the
    // site's own listeners can fire. Stored on the shield for pollStatus cleanup.
    const releaseHoverBlock   = _installHoverBlock(container);
    shield._sfRelease         = releaseHoverBlock;

    // Block all videos already present within the container boundary.
    // Broader than findAssociatedVideo (which only checks 4 ancestor levels)
    // because on YouTube the video preview element may be a distant sibling.
    for (const v of container.querySelectorAll('video')) {
      _killAutoplayVideo(v);
      blockVideoPlay(v);
    }

    // Apply scanning visual. pointer-events:none on the image itself prevents
    // mouseover/mouseenter from reaching the image and bubbling to site listeners
    // on ancestor elements that are not covered by the shield's capture block.
    img.style.pointerEvents = 'none';
    img.style.transition    = 'filter 0.12s, opacity 0.12s';
    img.classList.add('sf-scanning');

    try {
      console.debug('[SlopBlock] classifyImage', img.src.slice(0,80));
      const resp = await chrome.runtime.sendMessage({ type: 'classifyImage', url: img.src });
      console.debug('[SlopBlock] classifyImage resp', resp?.ok, resp?.data);

      if (!resp?.ok) { _abortShield(img, shield, releaseHoverBlock); return; }

      const { isAiImage, confidence, method, skipped } = resp.data;
      if (skipped) { _abortShield(img, shield, releaseHoverBlock); return; }

      _pageImageCacheSet(srcKey, { blocked: isAiImage, confidence });
      pageCompletedCount++;
      const adjustedConf = confidence + getPagePriorAdjustment();

      if (isAiImage || adjustedConf >= IMG_CONF_FORCE) {
        pageAiCount++;
        img.style.transition = '';
        img.classList.remove('sf-scanning');
        img.style.pointerEvents = '';
        delete img.dataset.sfProcessing;
        _promoteShield(shield, img, container, confidence, method, releaseHoverBlock);
      } else {
        _abortShield(img, shield, releaseHoverBlock);
      }
    } catch (err) {
      _SF_DEBUG('classify-image', err);
      _abortShield(img, shield, releaseHoverBlock);
    }
  }

  // Verdict = real: remove shield and restore image to normal.
  function _abortShield(img, shield, releaseHoverBlock) {
    const container = shield.parentElement; // capture before removal
    releaseHoverBlock();
    shield.remove();
    img.style.pointerEvents = '';
    delete img.dataset.sfQueued;
    delete img.dataset.sfProcessing;
    _clearScan(img);
    if (container) {
      unblockVideosNear(container, false);
      _releaseContainerPos(container);
    }
  }

  // Verdict = slop: image overlay on pixels + card tint; content stays visible.
  function _promoteShield(shield, img, container, confidence, method, releaseHoverBlock) {
    releaseHoverBlock();
    shield.remove();
    img.style.opacity       = '';
    img.style.pointerEvents = '';
    delete img.dataset.sfQueued;
    delete img.dataset.sfProcessing;
    _clearScan(img);

    _applyImageAiFlag(img, container, {
      confidence,
      method,
      onDismiss: () => {
        unblockVideosNear(container, true);
        _releaseContainerPos(container);
      },
    });
  }

  // ── Container preparation (shared by classifyImage and applyImageSlop) ──
  // Preferred container is the card boundary (e.g. ytd-rich-item-renderer on
  // YouTube). Placing our shield/placeholder there puts it ABOVE intermediate
  // custom-element stacking contexts such as yt-image or a.yt-simple-endpoint,
  // which would otherwise lose to a sibling ytd-moving-thumbnail-renderer even
  // if our element has z-index:2147483647 (stacking contexts are compared at
  // the level they share a common ancestor, not by their own z-index values).
  function _prepareContainer(img) {
    const imgRect = img.getBoundingClientRect();

    // Use card boundary when available so we outrank nested site overlays.
    const card = !img.closest('[data-sf-ai-flagged], [data-sf-card-blurred]') ? findCardBoundary(img) : null;
    let container = card;

    if (!container) {
      // No card: climb to nearest non-static, non-sticky, non-fixed ancestor.
      container = img.parentElement;
      for (let i = 0; i < 6 && container && container !== document.body; i++) {
        const pos = getComputedStyle(container).position;
        if (pos !== 'static' && pos !== 'sticky' && pos !== 'fixed') break;
        container = container.parentElement;
      }
      if (!container || container === document.body) container = img.parentElement;

      const containerRect = container.getBoundingClientRect();
      if (containerRect.width  > imgRect.width  * 3 &&
          containerRect.height > imgRect.height * 2) {
        container = img.parentElement;
      }
    }

    _acquireContainerPos(container);

    const shieldStyle = _imageOverlayStyle(img, container);

    return { container, shieldStyle };
  }

  // ── Container position management ──────────────────────────────
  // When classifyImage needs an absolutely-positioned shield it calls
  // _acquireContainerPos to make the container position:relative.
  // Every code path that removes the shield (abort or reveal) must call
  // _releaseContainerPos so the change is reverted once no placeholders
  // remain. Without this the container permanently becomes a positioning
  // ancestor, breaking tooltips and dropdowns that rely on a distant ancestor.
  function _acquireContainerPos(container) {
    const n = parseInt(container.dataset.sfPosRef || '0');
    if (n === 0 && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
      container.dataset.sfPosOwned = 'true';
    }
    container.dataset.sfPosRef = String(n + 1);
  }

  function _releaseContainerPos(container) {
    if (!container) return;
    const n = Math.max(0, parseInt(container.dataset.sfPosRef || '0') - 1);
    if (n === 0) {
      delete container.dataset.sfPosRef;
      if (container.dataset.sfPosOwned) {
        delete container.dataset.sfPosOwned;
        container.style.position = '';
      }
    } else {
      container.dataset.sfPosRef = String(n);
    }
  }

  // ── Capture-phase hover block ───────────────────────────────────
  // Registered on DOCUMENT so it fires before any site listener anywhere in
  // the tree, regardless of registration order or phase. Only blocks events
  // whose target is inside our container. stopImmediatePropagation prevents
  // further capture listeners and all bubble-phase listeners from receiving
  // the event — including on the container itself and its ancestors.
  // Note: no early return for our own elements (shield, placeholder, button).
  // Hover events should always be suppressed; our UI only needs click/pointerup.
  function _installHoverBlock(container) {
    function blocker(e) {
      if (!container.contains(e.target) && container !== e.target) return;
      e.stopImmediatePropagation();
    }
    for (const evt of _HOVER_BLOCK_EVENTS) {
      document.addEventListener(evt, blocker, true);
    }
    return function releaseHoverBlock() {
      for (const evt of _HOVER_BLOCK_EVENTS) {
        document.removeEventListener(evt, blocker, true);
      }
    };
  }

  // ── Autoplay removal ────────────────────────────────────────────
  // Strips the autoplay attribute synchronously (called from MutationObserver)
  // before the browser can act on it. Also overrides video.load() so a
  // load() → implicit-autoplay cycle cannot restart playback.
  function _killAutoplayVideo(vid) {
    vid.removeAttribute('autoplay');
    vid.autoplay = false;
    vid.preload  = 'none';
    if (!vid.paused) vid.pause();
    if (!vid.dataset.sfLoadBlocked) {
      vid.dataset.sfLoadBlocked = 'true';
      const nativeLoad = HTMLVideoElement.prototype.load.bind(vid);
      vid.load = function () {
        this.removeAttribute('autoplay');
        this.autoplay = false;
        nativeLoad();
      };
    }
  }

  function findAssociatedVideo(img) {
    let node = img.parentNode;
    for (let i = 0; i < 4; i++) {
      if (!node || node === document.body) break;
      const v = node.querySelector('video');
      if (v) return v;
      node = node.parentNode;
    }
    return null;
  }

  // Override video.play as an own property on the element.
  // Own-property overrides on DOM nodes are visible across Chrome's isolated-world
  // boundary, so page JS calling video.play() receives our no-op directly.
  // Event-based interception (addEventListener 'play') has a latency gap — the
  // browser starts playback before our handler can pause it. Overriding the method
  // prevents playback from beginning at all, with no race condition.
  function blockVideoPlay(video) {
    if (!video || video.dataset.sfVidBlocked) return;
    video.dataset.sfVidBlocked = 'true';
    if (!video.paused) video.pause();
    video.play = () => Promise.resolve();
  }

  function unblockVideoPlay(video, andPlay) {
    if (!video || !video.dataset.sfVidBlocked) return;
    delete video.dataset.sfVidBlocked;
    delete video.play; // removes own-property, restores prototype play
    if (andPlay) HTMLVideoElement.prototype.play.call(video).catch(() => {});
  }

  // Unblock every sfVidBlocked video found within 6 ancestor levels of el.
  function unblockVideosNear(el, andPlay) {
    let n = el;
    for (let i = 0; i < 6 && n && n !== document.body; i++) {
      n.querySelectorAll?.('video[data-sf-vid-blocked]').forEach(v => unblockVideoPlay(v, andPlay));
      n = n.parentElement;
    }
  }

  // Block any video near el that isn't already blocked.
  // Called synchronously from the MutationObserver so hover-autoplay cannot
  // slip through the 300 ms batch window.
  // Also checks for in-flight shields ([data-sf-shield]) so videos added
  // during classification are caught before the placeholder exists.
  function blockVideosNear(el) {
    const vids = el.tagName === 'VIDEO' ? [el] : [...(el.querySelectorAll?.('video') || [])];
    for (const vid of vids) {
      if (vid.dataset.sfVidBlocked) continue;
      let n = vid.parentElement;
      for (let i = 0; i < 6 && n && n !== document.body; i++) {
        if (n.querySelector('[data-sf-shield]')) {
          _killAutoplayVideo(vid); // strip autoplay attr before browser acts on it
          blockVideoPlay(vid);
          break;
        }
        n = n.parentElement;
      }
    }
  }

  function interceptFeedVideo(video) {
    if (!video || video.dataset.sfVidBlocked) return null;
    blockVideoPlay(video);
    return {
      release() { unblockVideoPlay(video, false); },
      play()    { unblockVideoPlay(video, true);  },
    };
  }

  // Cache-hit path only — no race window, so no shield needed.
  function applyImageSlop(img, confidence, method) {
    if (img.dataset.sfImgBlurred || img.dataset.sfProcessing || img.dataset.sfImgFlagged) return;
    delete img.dataset.sfProcessing;
    if (!img.parentNode) return;

    try {
      const { container } = _prepareContainer(img);
      _applyImageAiFlag(img, container, {
        confidence,
        method,
        onDismiss: () => _releaseContainerPos(container),
      });
    } catch (err) {
      _SF_DEBUG('apply-image-slop', err);
    }
  }

  // ── YouTube AI-label filter ─────────────────────────────────────
  // Detects YouTube's mandatory "Altered or synthetic content" disclosure
  // and warns on watch pages; dims feed/Shorts cards where the label appears.

  const YT_DISCLOSURE_TEXT = 'Altered or synthetic content';

  function reportYoutubeBlock() {
    // Proxy's injected.js handles counting when active — avoid double-counting.
    if (document.documentElement.dataset.sfProxy === '1') return;
    chrome.runtime.sendMessage({ type: 'youtubeBlock' }).catch(() => {});
    chrome.storage.session.get('youtubeBlocked').then(s => {
      chrome.storage.session.set({ youtubeBlocked: (s.youtubeBlocked || 0) + 1 });
    }).catch(() => {});
  }

  function getYtVideoCard(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = (node.tagName || '').toLowerCase();
      if (tag.startsWith('ytd-') && (
        tag.includes('grid') || tag.includes('compact') ||
        tag.includes('reel') || tag.includes('video-renderer')
      )) return node;
      node = node.parentElement;
    }
    return null;
  }

  function markYtAiCard(card) {
    if (card.dataset.sfYtAi || card.dataset.sfAiFlagged) return;
    card.dataset.sfYtAi = 'true';
    _applyAiFlag(card, {
      confidence: 99,
      method: 'youtube',
      label: 'AI Disclosed',
      onDismiss: () => { delete card.dataset.sfYtAi; },
    });
    reportYoutubeBlock();
  }

  // Navigate to the next Short.
  function navigateYtNext() {
    // Try YouTube's own next-Short button first
    const nextBtn = document.querySelector(
      '#navigation-button-down button, ytd-shorts #navigation-button-down button'
    );
    if (nextBtn) { nextBtn.click(); return; }
    // Fallback: scroll the page (desktop Shorts responds to this)
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
  }

  // Returns the positioned player container for the current page/Short.
  function getYtPlayerContainer() {
    // Watch page
    const watch = document.querySelector('#movie_player');
    if (watch && watch.offsetHeight > 50) return watch;
    // Active Short (YouTube marks the visible one with [is-active])
    const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeReel) return activeReel.querySelector('#player-container') || activeReel;
    // Fallback
    return document.querySelector('#shorts-player, ytd-shorts');
  }

  // Block a specific video element from playing until the user consents.
  // Returns { cleanup() — remove listener only, play() — remove listener + play }.
  function interceptVideoPlay(video) {
    if (video.dataset.sfYtBlocked) return { cleanup: () => {}, play: () => {} };
    video.dataset.sfYtBlocked = 'true';
    if (!video.paused) video.pause();

    const onPlay = () => { if (video.dataset.sfYtBlocked) video.pause(); };
    video.addEventListener('play', onPlay, true);

    return {
      cleanup() {
        delete video.dataset.sfYtBlocked;
        video.removeEventListener('play', onPlay, true);
      },
      play() {
        this.cleanup();
        video.play().catch(() => {});
      },
    };
  }

  // Remove any active YouTube block immediately (overlay + interceptor).
  function cleanupYtBlock() {
    ytBlockedHref = null;
    document.getElementById('sf-yt-overlay')?.remove();
    const container = getYtPlayerContainer();
    if (container?.dataset.sfAiFlagged) _clearAiFlag(container);
    if (currentYtInterceptor) {
      currentYtInterceptor.cleanup();
      currentYtInterceptor = null;
    }
  }

  function blockYtVideoPlayer() {
    const container = getYtPlayerContainer();
    if (!container || container.dataset.sfYtAllowed || container.dataset.sfAiFlagged) return;

    _applyAiFlag(container, {
      confidence: 99,
      method: 'youtube',
      label: 'AI Disclosed',
      onDismiss: () => { container.dataset.sfYtAllowed = 'true'; },
    });
    ytBlockedHref = location.href;
    reportYoutubeBlock();
  }

  function checkYtInitialData() {
    try {
      const ipr = window.ytInitialPlayerResponse;
      if (ipr && (
        ipr.videoDetails?.containsSyntheticMedia === true ||
        ipr.containsSyntheticMedia === true
      )) return true;
    } catch (err) { _SF_DEBUG('yt-synthetic-check', err); }
    return false;
  }

  function findYtDisclosureNode() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(YT_DISCLOSURE_TEXT)) return node;
    }
    return null;
  }

  function runYoutubeCheck() {
    if (!youtubeFilterEnabled) return;
    if (!location.hostname.includes('youtube.com')) return;

    const isWatchPage = /[?&]v=/.test(location.search) || location.pathname.startsWith('/shorts/');

    if (isWatchPage) {
      if (checkYtInitialData()) { blockYtVideoPlayer(); return; }
      const node = findYtDisclosureNode();
      if (node) blockYtVideoPlayer();
    } else {
      const node = findYtDisclosureNode();
      if (node) {
        const card = getYtVideoCard(node.parentElement);
        if (card) markYtAiCard(card);
      }
    }
  }

  // Debounced re-check on DOM mutations (description loads async on watch pages)
  let ytCheckQueued = false;
  const ytObserver = new MutationObserver(() => {
    if (!youtubeFilterEnabled || !location.hostname.includes('youtube.com')) return;
    // If the URL changed since we blocked, clear the overlay immediately
    if (ytBlockedHref && ytBlockedHref !== location.href) {
      cleanupYtBlock();
    }
    if (ytCheckQueued) return;
    ytCheckQueued = true;
    setTimeout(() => { ytCheckQueued = false; runYoutubeCheck(); }, 600);
  });
  ytObserver.observe(document.body, { childList: true, subtree: true });

  // ── IntersectionObserver ────────────────────────────────────────
  const imageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        imageObserver.unobserve(entry.target);
        classifyImage(entry.target);
      }
    }
  }, { rootMargin: '400px' });

  function watchImage(img) {
    if (img.dataset.sfImgChecked) return;
    img.dataset.sfImgChecked = 'watching';
    const maybeObserve = () => {
      const skip = shouldSkipImage(img);
      const sizeOk = img.naturalWidth >= IMG_MIN_PX && img.naturalHeight >= IMG_MIN_PX;
      console.debug('[SlopBlock] img check', img.src.slice(0,60), 'skip=', skip, 'size=', img.naturalWidth, 'x', img.naturalHeight, 'need>=', IMG_MIN_PX);
      if (!skip && sizeOk) {
        imageObserver.observe(img);
      }
    };
    if (img.complete) {
      maybeObserve();
    } else {
      img.addEventListener('load',  maybeObserve, { once: true });
      img.addEventListener('error', () => {},     { once: true });
    }
  }

  // ── Video analysis (signals 1–3) ───────────────────────────────

  function hasAiDisclosureTag(text) {
    const lower = text.toLowerCase();
    return AI_DISCLOSURE_TAGS.some(tag => lower.includes(tag));
  }

  function _findVideoNear(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.matches?.('video')) return node;
      const vid = node.querySelector?.('video');
      if (vid) return vid;
      node = node.parentElement;
    }
    return null;
  }

  function findVideoCard(videoEl) {
    if (!videoEl) return null;
    return findCardBoundary(videoEl) || videoEl.closest('article, [role="article"], [role="listitem"]');
  }

  function _getVideoChannelKey(videoEl) {
    const card = findVideoCard(videoEl);
    const scope = card || videoEl.closest('article, [role="article"], [role="listitem"]') || document.body;
    const link = scope.querySelector?.(
      'a[href*="/@"], a[href*="/channel/"], ytd-channel-name a, [data-e2e="video-author-uniqueid"]'
    );
    if (link?.href) {
      try { return new URL(link.href, location.origin).pathname; } catch (_) {}
    }
    return location.hostname + location.pathname.split('/').slice(0, 4).join('/');
  }

  function _isVideoChannelWhitelisted(videoEl) {
    const key = _getVideoChannelKey(videoEl);
    if (_sessionChannelWhitelist.has(key)) return true;
    return _trustedPatterns.some(p => key.startsWith(p) || location.href.startsWith(p));
  }

  function _trackVideoReveal(card) {
    const vid = card.querySelector('video');
    const key = vid ? _getVideoChannelKey(vid) : (location.hostname + location.pathname);
    const count = (_channelRevealCounts.get(key) || 0) + 1;
    _channelRevealCounts.set(key, count);
    if (count >= SESSION_WHITELIST_REVEALS) _sessionChannelWhitelist.add(key);
  }

  function _freshVideoEvidence() {
    return {
      hashtag: false,
      platformLabel: false,
      metadata: null,
      caption: null,
      frames: { isAi: false, avgConf: 0, screenshotVeto: false, details: [] },
    };
  }

  function _getVideoEvidence(videoEl) {
    if (!_videoEvidence.has(videoEl)) _videoEvidence.set(videoEl, _freshVideoEvidence());
    return _videoEvidence.get(videoEl);
  }

  function _median(nums) {
    if (!nums.length) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function _formatVideoReasons(ev) {
    const parts = [];
    if (ev.hashtag) parts.push('Explicit AI disclosure hashtag');
    if (ev.platformLabel) parts.push('Platform AI label detected');
    if (ev.metadata) parts.push(`Description ${ev.metadata.confidence}% (${ev.metadata.method})`);
    if (ev.caption) parts.push(`Captions ${ev.caption.confidence}% (${ev.caption.method})`);
    if (ev.frames.details?.length) {
      const frameSummary = ev.frames.details
        .map((d, i) => `#${i + 1}: ${d.conf}%${d.style ? ' ' + d.style : ''}${d.ai ? ' AI' : ''}`)
        .join(' · ');
      parts.push(`Frames: ${frameSummary}`);
    }
    return parts.join(' · ');
  }

  function _evaluateVideoEvidence(videoEl) {
    if (_isVideoChannelWhitelisted(videoEl)) return;
    const card = findVideoCard(videoEl);
    if (!card || card.dataset.sfAiFlagged) return;

    const ev = _getVideoEvidence(videoEl);
    const detailHtml = _formatVideoReasons(ev);

    if (ev.hashtag) {
      _applyVideoVerdict(videoEl, 'block', 99, 'hashtag', detailHtml);
      return;
    }
    if (ev.platformLabel) {
      _applyVideoVerdict(videoEl, 'block', 99, 'platform-label', detailHtml);
      return;
    }

    const hasMeta = ev.metadata && ev.metadata.confidence >= VIDEO_META_MIN_CONFIDENCE;
    const hasCaption = ev.caption && ev.caption.confidence >= CAPTION_MIN_CONFIDENCE;
    const frames = ev.frames;
    const hasFrameSignal = !frames.screenshotVeto && frames.isAi;
    const strongFrameOnly = !frames.screenshotVeto
      && frames.isAi
      && frames.avgConf >= videoBlockConf;

    if (hasFrameSignal && (hasMeta || hasCaption)) {
      const conf = Math.round(
        (frames.avgConf + (hasMeta ? ev.metadata.confidence : ev.caption.confidence)) / 2
      );
      _applyVideoVerdict(videoEl, 'block', conf, hasMeta ? 'frame+metadata' : 'frame+caption', detailHtml);
      return;
    }
    if (hasMeta && hasCaption) {
      const conf = Math.round((ev.metadata.confidence + ev.caption.confidence) / 2);
      _applyVideoVerdict(videoEl, 'block', conf, 'metadata+caption', detailHtml);
      return;
    }
    if (strongFrameOnly) {
      _applyVideoVerdict(videoEl, 'block', frames.avgConf, 'frame-model-strong', detailHtml);
      return;
    }

    if (hasFrameSignal || hasMeta || hasCaption) {
      const conf = hasFrameSignal ? frames.avgConf
        : hasMeta ? ev.metadata.confidence
        : ev.caption.confidence;
      const method = hasFrameSignal ? 'frame-model-weak'
        : hasMeta ? 'metadata-weak' : 'caption-weak';
      _applyVideoVerdict(videoEl, 'warn', conf, method, detailHtml);
    }
  }

  function _reportVideoSignal(videoEl, signal, payload) {
    if (!videoEl || _isVideoChannelWhitelisted(videoEl)) return;
    const ev = _getVideoEvidence(videoEl);
    if (signal === 'hashtag') ev.hashtag = true;
    else if (signal === 'platform') ev.platformLabel = true;
    else if (signal === 'metadata') ev.metadata = payload;
    else if (signal === 'caption') ev.caption = payload;
    else if (signal === 'frames') Object.assign(ev.frames, payload);
    _evaluateVideoEvidence(videoEl);
  }

  function _applyVideoVerdict(videoEl, tier, confidence, method, detailHtml) {
    const card = findVideoCard(videoEl);
    if (!card || card.dataset.sfAiFlagged) return;
    _applyAiFlag(card, {
      confidence,
      method,
      label: tier === 'warn' ? 'AI Video?' : 'AI Video',
      detailHtml,
      countKey: tier === 'block' ? 'textBlocked' : undefined,
      onDismiss: () => {
        card.dataset.sfRevealed = 'true';
        _trackVideoReveal(card);
      },
    });
  }

  function _hashString(str) {
    let hash = 0;
    const step = Math.max(1, Math.floor(str.length / 64));
    for (let i = 0; i < str.length; i += step) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    return hash;
  }

  function _hasPlatformAiLabelText(text) {
    const lower = text.toLowerCase();
    return PLATFORM_AI_LABEL_TEXT.some(p => lower.includes(p));
  }

  function scanPlatformAiLabels(root) {
    if (!filterEnabled || !videoDetectionEnabled) return;
    const scope = root?.querySelectorAll ? root : document;
    const els = root?.matches?.(PLATFORM_AI_LABEL_SEL)
      ? [root]
      : [...(scope.querySelectorAll?.(PLATFORM_AI_LABEL_SEL) || [])];
    for (const el of els) {
      if (el.dataset.sfPlatformAiChecked) continue;
      el.dataset.sfPlatformAiChecked = 'true';
      const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
      if (!_hasPlatformAiLabelText(text)) continue;
      const vid = _findVideoNear(el);
      if (vid) _reportVideoSignal(vid, 'platform', null);
    }
  }

  async function classifyVideoMeta(el) {
    if (!filterEnabled || !videoDetectionEnabled || el.dataset.sfVideoMetaChecked) return;
    if (el.closest('[data-sf-ai-flagged], [data-sf-card-blurred]')) return;
    el.dataset.sfVideoMetaChecked = 'true';

    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text) return;

    const videoEl = _findVideoNear(el);
    if (!videoEl || _isVideoChannelWhitelisted(videoEl)) return;

    if (hasAiDisclosureTag(text)) {
      _reportVideoSignal(videoEl, 'hashtag', null);
      return;
    }

    if (text.length < MIN_LEN) return;
    if (el.dataset.slopChecked) return;
    el.dataset.slopChecked = 'true';
    try {
      const classified = await classifyRawText(text, (confidence, method) => {
        if (confidence >= VIDEO_META_MIN_CONFIDENCE) {
          _reportVideoSignal(videoEl, 'metadata', { confidence, method: (method || 'model') + '+metadata' });
        }
      });
      if (!classified) delete el.dataset.slopChecked;
    } catch (err) {
      delete el.dataset.slopChecked;
      _SF_DEBUG('classify-video-meta', err);
    }
  }

  const _captionBuffers = new WeakMap();

  async function _flushCaptionBuffer(videoEl, bufferEntry) {
    const text = bufferEntry.buffer.join(' ').trim();
    bufferEntry.buffer = [];
    bufferEntry.timer  = null;
    if (!text || text.split(/\s+/).filter(Boolean).length < CAPTION_MIN_WORDS) return;

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'classify', text });
      if (resp?.ok && resp.data?.isSlop && (resp.data.confidence || 0) >= CAPTION_MIN_CONFIDENCE) {
        _reportVideoSignal(videoEl, 'caption', {
          confidence: resp.data.confidence,
          method: (resp.data.method || 'model') + '+caption',
        });
      }
    } catch (err) { _SF_DEBUG('caption-flush', err); }
  }

  function onCaptionSegment(text, videoEl) {
    if (!filterEnabled || !videoDetectionEnabled || !text || !videoEl) return;
    if (_isVideoChannelWhitelisted(videoEl)) return;
    const normalized = text.trim().replace(/\s+/g, ' ');
    if (!normalized) return;
    let entry = _captionBuffers.get(videoEl);
    if (!entry) {
      entry = { buffer: [], timer: null, seen: new Set() };
      _captionBuffers.set(videoEl, entry);
    }
    if (entry.seen.has(normalized)) return;
    entry.seen.add(normalized);
    if (entry.seen.size > 100) entry.seen.clear();

    entry.buffer.push(normalized);
    const wordCount = entry.buffer.join(' ').split(/\s+/).filter(Boolean).length;

    if (entry.timer) clearTimeout(entry.timer);

    if (wordCount >= CAPTION_MAX_BUFFER) {
      _flushCaptionBuffer(videoEl, entry);
    } else {
      entry.timer = setTimeout(() => _flushCaptionBuffer(videoEl, entry), CAPTION_FLUSH_MS);
    }
  }

  function findVideoForCaption(seg) {
    let node = seg.parentElement;
    while (node && node !== document.body) {
      if (node.matches?.('video')) return node;
      const vid = node.querySelector?.('video');
      if (vid) return vid;
      node = node.parentElement;
    }
    return null;
  }

  const captionObserver = new MutationObserver(muts => {
    if (!filterEnabled || !videoDetectionEnabled) return;
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const segs = node.matches?.(CAPTION_SEL)
          ? [node]
          : [...(node.querySelectorAll?.(CAPTION_SEL) || [])];
        for (const seg of segs) {
          const text = (seg.innerText || seg.textContent || '').trim();
          if (!text) continue;
          const vid = findVideoForCaption(seg);
          if (vid) onCaptionSegment(text, vid);
        }
      }
    }
  });
  captionObserver.observe(document.body, { childList: true, subtree: true });

  async function sampleVideoFrames(videoEl) {
    if (!videoDetectionEnabled || !filterEnabled) return;
    if (videoEl.dataset.sfVideoSampled) return;
    if (!videoEl.duration || videoEl.duration < VIDEO_MIN_DURATION) return;
    if (_isVideoChannelWhitelisted(videoEl)) return;
    videoEl.dataset.sfVideoSampled = 'true';

    const savedTime = videoEl.currentTime;
    const wasPaused = videoEl.paused;
    const canvas = document.createElement('canvas');
    canvas.width  = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sampleWindow = Math.min(FRAME_SAMPLE_WINDOW_SEC, Math.max(0, videoEl.duration - 0.1));
    const windowStart = Math.min(FRAME_SKIP_START_SEC, sampleWindow * 0.5);
    const effectiveWindow = Math.max(0, sampleWindow - windowStart);
    const seekTimes = Array.from(
      { length: FRAME_SAMPLE_COUNT },
      (_, i) => windowStart + ((i + 1) / (FRAME_SAMPLE_COUNT + 1)) * effectiveWindow
    );
    const frames = [];
    const seenHashes = new Set();

    try {
      for (const seekTime of seekTimes) {
        await new Promise((resolve, reject) => {
          let timeoutId;
          const cleanup = () => {
            clearTimeout(timeoutId);
            videoEl.removeEventListener('seeked', onSeeked);
            videoEl.removeEventListener('error', onError);
          };
          const onSeeked = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('video seek failed')); };
          timeoutId = setTimeout(() => { cleanup(); reject(new Error('video seek timeout')); }, FRAME_SEEK_TIMEOUT_MS);
          videoEl.addEventListener('seeked', onSeeked);
          videoEl.addEventListener('error', onError, { once: true });
          videoEl.currentTime = seekTime;
        });
        ctx.drawImage(videoEl, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        let dataUri;
        try {
          dataUri = canvas.toDataURL('image/jpeg', FRAME_QUALITY);
        } catch (e) {
          if (e.name === 'SecurityError') {
            delete videoEl.dataset.sfVideoSampled;
            return;
          }
          throw e;
        }
        const fp = _hashString(dataUri);
        if (seenHashes.has(fp)) continue;
        seenHashes.add(fp);
        frames.push(dataUri);
      }
    } catch (err) {
      _SF_DEBUG('video-frame-capture', err);
      delete videoEl.dataset.sfVideoSampled;
      return;
    } finally {
      try { videoEl.currentTime = savedTime; } catch (_) {}
      if (wasPaused) videoEl.pause();
    }

    if (!frames.length) return;

    if (!frames.length) return;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'classifyVideo',
        frames: frames.slice(0, 5),
        frames8: frames,
      });
      const data = resp?.data || {};
      const conf = data.confidence || 0;
      const isAi = !!data.isAiVideo && !data.skipped && conf >= videoWarnConf;

      _reportVideoSignal(videoEl, 'frames', {
        isAi,
        avgConf: conf,
        screenshotVeto: !!data.skipped,
        details: [{ conf, style: `dinov2-${data.phase || 'a'}`, ai: isAi, skipped: !!data.skipped, twoStage: data.twoStage }],
      });
    } catch (err) {
      _SF_DEBUG('video-frame-classify', err);
    }
  }

  const videoObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const vid = entry.target;
      videoObserver.unobserve(vid);
      if (vid.readyState >= 1) {
        sampleVideoFrames(vid);
      } else {
        vid.addEventListener('loadedmetadata', () => sampleVideoFrames(vid), { once: true });
      }
    }
  }, { rootMargin: '200px' });

  function watchVideo(vid) {
    if (!videoDetectionEnabled || !filterEnabled) return;
    if (vid.dataset.sfVideoWatching) return;
    if (_isVideoChannelWhitelisted(vid)) return;
    vid.dataset.sfVideoWatching = 'true';
    if (!vid.crossOrigin) vid.crossOrigin = 'anonymous';
    videoObserver.observe(vid);
  }

  function scanVideoContent(root) {
    if (!videoDetectionEnabled) return;
    const scope = root?.querySelectorAll ? root : document;
    const videos = root?.matches?.('video') ? [root] : [...scope.querySelectorAll('video')];
    for (const vid of videos) watchVideo(vid);

    if (!filterEnabled) return;
    scanPlatformAiLabels(root);
    const metaEls = root?.matches?.(VIDEO_META_SEL)
      ? [root]
      : [...(scope.querySelectorAll?.(VIDEO_META_SEL) || [])];
    for (const el of metaEls) classifyVideoMeta(el);
  }

  // ── MutationObserver ────────────────────────────────────────────
  let scanQueued = false;
  const pendingNodes = new Set();

  const observer = new MutationObserver(mutations => {
    if (!filterEnabled && !imageDetectionEnabled && !videoDetectionEnabled && !youtubeFilterEnabled) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Block videos near placeholders SYNCHRONOUSLY — hover-autoplay fires
        // immediately and cannot wait for the 300 ms batch window below.
        blockVideosNear(node);
        pendingNodes.add(node);
      }
    }
    if (pendingNodes.size && !scanQueued) {
      scanQueued = true;
      setTimeout(async () => {
        const nodes = [...pendingNodes];
        pendingNodes.clear();
        scanQueued = false;
        for (const node of nodes) {
          _scanCardsIn(node);
          const metaEls = node.matches?.(VIDEO_META_SEL)
            ? [node]
            : [...node.querySelectorAll(VIDEO_META_SEL)];
          for (const el of metaEls) await classifyVideoMeta(el);
          const textEls = node.matches?.(TEXT_SEL) ? [node] : [...node.querySelectorAll(TEXT_SEL)];
          for (const el of textEls) await classifyText(el);
          const imgs = node.matches?.('img[src]') ? [node] : [...node.querySelectorAll('img[src]')];
          for (const img of imgs) watchImage(img);
          scanVideoContent(node);
        }
      }, 300);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── SPA navigation hooks ────────────────────────────────────────
  function onNavigate() {
    // Reset page-level prior and cache on every navigation — new page, fresh context
    pageAiCount        = 0;
    pageCompletedCount = 0;
    pageImageCache.clear();
    document.querySelectorAll('video[data-sf-video-sampled]').forEach(v => {
      delete v.dataset.sfVideoSampled;
      delete v.dataset.sfVideoWatching;
    });
    document.querySelectorAll('[data-sf-ai-flagged]').forEach(el => _clearAiFlag(el));
    // Clean up the YouTube block immediately so flags don't linger while the next video loads.
    cleanupYtBlock();
    const prevContainer = getYtPlayerContainer();
    if (prevContainer) delete prevContainer.dataset.sfYtAllowed;
    setTimeout(() => {
      _scanCardsIn(document.body);
      document.querySelectorAll(TEXT_SEL).forEach(classifyText);
      document.querySelectorAll('img[src]').forEach(watchImage);
      scanVideoContent(document.body);
      runYoutubeCheck();
    }, 400);
  }

  for (const method of ['pushState', 'replaceState']) {
    const orig = history[method];
    history[method] = function (...args) { orig.apply(this, args); onNavigate(); };
  }
  window.addEventListener('popstate', onNavigate);

  // ── Startup ─────────────────────────────────────────────────────
  const statusTimer = setInterval(pollStatus, 2000);
  pollStatus();

  setTimeout(() => {
    const texts = document.querySelectorAll(TEXT_SEL);
    const imgs  = document.querySelectorAll('img[src]');
    console.debug('[SlopBlock] Initial scan:', texts.length, 'text elements,', imgs.length, 'images, filter=', filterEnabled, 'imgFilter=', imageDetectionEnabled, 'vidFilter=', videoDetectionEnabled, 'ytFilter=', youtubeFilterEnabled, 'MIN_LEN=', MIN_LEN);
    _scanCardsIn(document.body);
    texts.forEach(classifyText);
    imgs.forEach(watchImage);
    scanVideoContent(document.body);
    runYoutubeCheck();
  }, 300);
})();
