// SPDX-FileCopyrightText: 2026 Palak Varshney <palakvarshney23012003@gmail.com>
// SPDX-License-Identifier: GPL-3.0-only

const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = [
  'window-minimize', 'window-close',
  'toggle-filter', 'toggle-image-detection', 'toggle-video-detection', 'toggle-youtube-filter',
  'toggle-proxy', 'toggle-gpu',
  'reset-all', 'open-debug-log', 'reinstall-cert',
  'install-extension', 'install-extension-firefox', 'mark-extension-installed', 'open-extension-folder', 'open-external',
  'set-setting',
  'install-update',
  'check-for-updates',
  'add-bypass', 'remove-bypass',
  'add-trusted-pattern', 'remove-trusted-pattern',
  'set-config',
];

const INVOKE_CHANNELS = [
  'get-version',
  'get-config',
];

const RECEIVE_CHANNELS = [
  'filter-status', 'image-detection-status', 'video-detection-status', 'youtube-filter-status',
  'proxy-status',
  'filter-count', 'images-count', 'youtube-count',
  'status-update',
  'cert-ready',
  'extension-install-ready',
  'extension-installed',
  'browser-detected',
  'image-model-progress',
  'settings-loaded',
  'update-available', 'update-progress', 'update-ready',
  'update-check-start', 'update-check-complete', 'update-check-error',
  'suggest-bypass',
  'bypass-domains',
  'trusted-patterns',
  'classification-entry',
  'proxy-start-failed',
  'video-probe-ready',
  'config-loaded',
  'model-counts',
  'gpu-status',
];

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, ...args) => {
    if (SEND_CHANNELS.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) => {
    if (INVOKE_CHANNELS.includes(channel)) return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
});
