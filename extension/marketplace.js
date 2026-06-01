// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// marketplace.js — Track G (Marketplaces): Amazon + eBay product reviews.

(function () {
  'use strict';

  if (window.top !== window.self) return;
  if (window.__sfMarketplaceLoaded) return;
  window.__sfMarketplaceLoaded = true;

  const sites = typeof SF_MARKETPLACE_SITES !== 'undefined' ? SF_MARKETPLACE_SITES : null;
  if (!sites) return;

  const { getSiteConfig, isProductPage, pickFirst, pickAll } = sites;

  let site = getSiteConfig(location.hostname);
  if (!site || !isProductPage(site, location.pathname)) return;

  document.documentElement.dataset.sfMarketplace = '1';

  let REVIEW_MIN_LEN = 35;
  let productTitle = '';

  function readProductTitle() {
    const el = pickFirst(document, site.productTitle);
    productTitle = (el?.textContent || '').trim().replace(/\s+/g, ' ');
    return productTitle;
  }

  function parseStars(card) {
    const el = pickFirst(card, site.stars);
    if (!el) return null;
    const aria = el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '';
    const m = aria.match(/(\d(?:\.\d)?)\s*out of/i) || (el.textContent || '').match(/(\d(?:\.\d)?)/);
    if (m) return Math.min(5, Math.max(1, parseFloat(m[1])));
    const itemprop = card.querySelector?.('[itemprop="ratingValue"]');
    if (itemprop?.getAttribute?.('content')) return parseFloat(itemprop.getAttribute('content'));
    return null;
  }

  function isVerified(card) {
    if (pickFirst(card, site.verified)) return true;
    const t = (card.textContent || '').toLowerCase();
    return t.includes('verified purchase') || t.includes('verified buyer');
  }

  function extractReviewText(card) {
    const bodyEl = pickFirst(card, site.reviewBody);
    const text = (bodyEl?.innerText || bodyEl?.textContent || card.innerText || '').trim();
    return text.replace(/\s+/g, ' ');
  }

  function isExcluded(el) {
    if (!el) return true;
    for (const sel of site.excludeRoots || []) {
      try {
        if (el.closest(sel)) return true;
      } catch (_) {}
    }
    return false;
  }

  function collectSiblingTexts(card, listRoot) {
    const cards = pickAll(listRoot, site.reviewCard);
    const out = [];
    for (const c of cards) {
      if (c === card) continue;
      const t = extractReviewText(c);
      if (t.length >= 20) out.push(t.slice(0, 500));
      if (out.length >= 20) break;
    }
    return out;
  }

  function markReviewBody(card) {
    const body = pickFirst(card, site.reviewBody);
    if (body) {
      body.classList.add('sf-mp-review-body');
      body.setAttribute('data-sf-review-body', '1');
    }
  }

  function showWarning(card, confidence, reasons, method) {
    if (card.dataset.sfMarketplaceWarned) return;
    card.dataset.sfMarketplaceWarned = '1';
    markReviewBody(card);

    const banner = document.createElement('div');
    banner.className = 'sf-marketplace-warning';
    const reasonHtml = (reasons || []).slice(0, 3).map(r => `<li>${escapeHtml(r)}</li>`).join('');
    banner.innerHTML = `
      <strong>SlopBlock:</strong> Suspected review spam (${confidence}%${method ? ` · ${escapeHtml(method)}` : ''})
      ${reasonHtml ? `<ul class="sf-marketplace-reasons">${reasonHtml}</ul>` : ''}
      <div class="sf-marketplace-actions">
        <button type="button" class="sf-mp-show">Show review</button>
        <button type="button" class="sf-mp-dismiss">Dismiss</button>
      </div>`;

    const showBtn = banner.querySelector('.sf-mp-show');
    const dismissBtn = banner.querySelector('.sf-mp-dismiss');
    let blurred = true;
    card.classList.add('sf-marketplace-slop-border', 'sf-marketplace-body-blur');

    showBtn.addEventListener('click', () => {
      blurred = !blurred;
      card.classList.toggle('sf-marketplace-body-blur', blurred);
      showBtn.textContent = blurred ? 'Show review' : 'Hide review';
    });

    dismissBtn.addEventListener('click', () => {
      banner.remove();
      card.classList.remove('sf-marketplace-slop-border', 'sf-marketplace-body-blur');
      delete card.dataset.sfMarketplaceWarned;
    });

    card.insertBefore(banner, card.firstChild);

    chrome.storage.session.get({ reviewsBlocked: 0 }).then(s => {
      chrome.storage.session.set({ reviewsBlocked: (s.reviewsBlocked || 0) + 1 });
    }).catch(() => {});
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function classifyCard(card, listRoot) {
    if (card.dataset.sfMarketplaceChecked || isExcluded(card)) return;
    card.dataset.sfMarketplaceChecked = '1';

    const text = extractReviewText(card);
    if (text.length < REVIEW_MIN_LEN) return;

    const context = {
      stars: parseStars(card),
      verifiedPurchase: isVerified(card),
      productTitle: productTitle || readProductTitle(),
      siblingReviewTexts: collectSiblingTexts(card, listRoot),
    };

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'classifyReview',
        text,
        context,
      });
      if (!resp?.ok || !resp.data) {
        delete card.dataset.sfMarketplaceChecked;
        return;
      }
      const { isSlop, confidence, reasons, method } = resp.data;
      if (isSlop) showWarning(card, confidence, reasons, method);
    } catch (_) {
      delete card.dataset.sfMarketplaceChecked;
    }
  }

  function scanReviews(root) {
    readProductTitle();
    const listRoot = pickFirst(root, site.reviewList) || root;
    const cards = pickAll(listRoot, site.reviewCard);
    for (const card of cards) classifyCard(card, listRoot);
  }

  function attachObserver() {
    const listRoot = pickFirst(document, site.reviewList);
    const target = listRoot || document.body;
    scanReviews(document);

    const observer = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.(site.reviewCard.join(','))) {
            const list = pickFirst(document, site.reviewList) || document;
            classifyCard(node, list);
          }
          node.querySelectorAll?.(site.reviewCard.join(',')).forEach(c => {
            const list = pickFirst(document, site.reviewList) || document;
            classifyCard(c, list);
          });
        }
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  function pollConfig() {
    chrome.runtime.sendMessage({ type: 'status' }).then(resp => {
      if (resp?.ok && resp.data?.config?.reviewTextMinLength) {
        REVIEW_MIN_LEN = resp.data.config.reviewTextMinLength;
      }
    }).catch(() => {});
  }

  pollConfig();
  setInterval(pollConfig, 30000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObserver);
  } else {
    attachObserver();
  }

  const _push = history.pushState.bind(history);
  history.pushState = function (...args) {
    _push(...args);
    setTimeout(() => { site = getSiteConfig(location.hostname); scanReviews(document); }, 500);
  };
  window.addEventListener('popstate', () => setTimeout(() => scanReviews(document), 500));
})();
