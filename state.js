// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

// state.js
module.exports = {
  FILTER_ENABLED: true,
  IMAGE_DETECTION_ENABLED: true,
  VIDEO_DETECTION_ENABLED: true,
  YOUTUBE_FILTER_ENABLED: true,

  PROXY_ENABLED: true,
  // Domains the app itself requires — never MITM'd, never removable by the user.
  // App-specific bypasses (IDEs, Apps etc.) are added dynamically.
  BYPASS_DOMAINS_PROTECTED: [
    'localhost',
    '127.0.0.1',
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'cdn-lfs-us-1.huggingface.co',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'api.github.com',
  ],
  BYPASS_DOMAINS: [
    'localhost',
    '127.0.0.1',
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'cdn-lfs-us-1.huggingface.co',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com',
    'api.github.com',
  ],

  TRUSTED_PATTERNS: [],

  filteredCount: 0,
  imagesBlocked: 0,
  youtubeBlocked: 0,

  textAnalyzed: 0,
  imagesAnalyzed: 0,
  youtubeAnalyzed: 0,

  reviewsAnalyzed: 0,
  reviewsFlagged: 0,
};