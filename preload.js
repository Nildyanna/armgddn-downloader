const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),

  // Downloads
  fetchManifest: (url, token) => ipcRenderer.invoke('fetch-manifest', url, token),
  startDownload: (manifest, token) => ipcRenderer.invoke('start-download', manifest, token),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
  retryDownload: (id) => ipcRenderer.invoke('retry-download', id),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Utility
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: (url) => ipcRenderer.invoke('install-update', url),
  checkConnection: () => ipcRenderer.invoke('check-connection'),
  openLogin: () => ipcRenderer.invoke('open-login'),
  getSessionStatus: () => ipcRenderer.invoke('get-session-status'),
  getHelp7zVideoSrc: () => ipcRenderer.invoke('get-help-7z-video-src'),

  // Events
  onDeepLink: (callback) => ipcRenderer.on('deep-link', (event, url) => callback(url)),
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadCompleted: (callback) => ipcRenderer.on('download-completed', (event, data) => callback(data)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (event, data) => callback(data)),
  onDownloadCancelled: (callback) => ipcRenderer.on('download-cancelled', (event, data) => callback(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
