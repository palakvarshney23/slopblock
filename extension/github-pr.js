// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// github-pr.js — Track A (Code Review) slop detection for GitHub.
// Built during the Slop Scan 72-hour hackathon window.
// Detects hollow AI-generated PR descriptions, issue comments, and commit messages.

(function () {
  'use strict'

  if (window.top !== window.self) return
  if (window.__sfGitHubLoaded) return
  window.__sfGitHubLoaded = true

  const SELECTORS = [
    '.pull-request-description .markdown-body',
    '.timeline-comment .comment-body > .markdown-body',
    '[data-testid="pr-description"] .markdown-body',
    '.commit-title',
    '.commit-desc pre',
    '.commit-group-title .commit-title'
  ].join(', ')

  const MIN_LEN = 80

  function _warn(el, confidence, method) {
    if (el.dataset.sfGithubWarned) return
    el.dataset.sfGithubWarned = 'true'

    const banner = document.createElement('div')
    banner.className = 'sf-github-warning'
    banner.innerHTML = `<span class="sf-octicon">⚠️</span> <strong>SlopBlock:</strong> AI-generated content detected (${confidence}% confidence${method ? ` · ${method}` : ''}) — <button class="sf-dismiss">Dismiss</button>`

    const btn = banner.querySelector('.sf-dismiss')
    btn.addEventListener('click', () => {
      banner.remove()
      el.classList.remove('sf-github-slop-border')
    })

    el.classList.add('sf-github-slop-border')
    el.insertBefore(banner, el.firstChild)
  }

  async function classifyElement(el) {
    const text = (el.innerText || el.textContent || '').trim()
    if (text.length < MIN_LEN) return
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'classify', text })
      if (resp?.ok && resp.data?.isSlop) {
        _warn(el, resp.data.confidence, resp.data.method)
      }
    } catch (_) {}
  }

  function scan(root) {
    root.querySelectorAll(SELECTORS).forEach(el => {
      if (!el.dataset.sfGithubWarned) classifyElement(el)
    })
  }

  scan(document.body)

  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.matches?.(SELECTORS)) classifyElement(node)
          node.querySelectorAll?.(SELECTORS).forEach(classifyElement)
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
})()
