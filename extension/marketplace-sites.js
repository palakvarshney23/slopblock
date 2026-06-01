// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// marketplace-sites.js — Track G host configs (Amazon, eBay). Last verified: 2026-06.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SF_MARKETPLACE_SITES = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pickFirst(root, selectors) {
    if (!root || !selectors) return null;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function pickAll(root, selectors) {
    if (!root || !selectors) return [];
    for (const sel of selectors) {
      try {
        const list = root.querySelectorAll(sel);
        if (list.length) return [...list];
      } catch (_) {}
    }
    return [];
  }

  const SITES = [
    {
      id: 'amazon',
      hostRe: /amazon\./i,
      urlRe: /\/(dp|gp\/product|product-reviews)\//i,
      reviewList: ['#cm_cr-review_list', '[data-hook="review-list"]', '#reviewsMedley'],
      reviewCard: ['[data-hook="review"]', '.review'],
      reviewBody: ['[data-hook="review-body"] span', '.review-text-content', '[data-hook="review-body"]'],
      stars: ['[data-hook="review-star-rating"]', 'i.review-rating'],
      verified: ['[data-hook="avp-badge"]', '[data-hook="avp-badge-link"]'],
      productTitle: ['#productTitle', '#title span'],
      excludeRoots: ['#productDescription', '#feature-bullets', '#aplus', '#askATFLink', '#titleSection'],
    },
    {
      id: 'ebay',
      hostRe: /ebay\./i,
      urlRe: /\/(itm|p)\//i,
      reviewList: ['.reviews-items', '#UserReviews', '[data-testid="x-review-section"]'],
      reviewCard: ['.reviews-item', '[itemprop="review"]', '.x-review-section__review'],
      reviewBody: ['[itemprop="reviewBody"]', '.review-item-description', '.x-review-section__review-text'],
      stars: ['[itemprop="ratingValue"]', '.star-rating', '.ebay-review-section-star-rating'],
      verified: ['.verified-purchase', '[class*="verified"]'],
      productTitle: ['h1.x-item-title__mainTitle', '#itemTitle', 'h1[itemprop="name"]'],
      excludeRoots: ['#desc_ifr', '.x-item-description', '#viTabs_0_panel'],
    },
  ];

  function isMarketplaceHost(hostname) {
    return SITES.some(s => s.hostRe.test(hostname || ''));
  }

  function getSiteConfig(hostname) {
    return SITES.find(s => s.hostRe.test(hostname || '')) || null;
  }

  function isProductPage(site, pathname) {
    if (!site || !pathname) return false;
    return site.urlRe.test(pathname);
  }

  return {
    SITES,
    isMarketplaceHost,
    getSiteConfig,
    isProductPage,
    pickFirst,
    pickAll,
  };
});
