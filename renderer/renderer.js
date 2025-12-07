// ARMGDDN Downloader - Electron Renderer
(function() {
'use strict';

const api = window.electronAPI;

// State
let downloads = new Map();
let settings = {};

// Initialize
async function init() {
  console.log('ARMGDDN Downloader v4.0.0 initializing...');
  
  // Load settings
  settings = await api.getSettings();
  updateSettingsUI();
  
  // Load history
  await loadHistory();
  
  // Display version
  const version = await api.getVersion();
  document.getElementById('version-display').textContent = `Version ${version}`;
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup IPC listeners
  setupIPCListeners();
  
  console.log('ARMGDDN Downloader ready!');
}

// Setup UI event listeners
function setupEventListeners() {
  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings-btn').addEventListener('click', closeSettings);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('browse-path-btn').addEventListener('click', browseDownloadPath);
  
  // History
  document.getElementById('history-btn').addEventListener('click', openHistory);
  document.getElementById('close-history-btn').addEventListener('click', closeHistory);
  document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
  
  // Updates
  document.getElementById('check-updates-btn').addEventListener('click', checkForUpdates);
}

// Setup IPC listeners from main process
function setupIPCListeners() {
  // Deep link handler
  api.onDeepLink((url) => {
    console.log('Deep link received:', url);
    handleDeepLink(url);
  });
  
  // Download events
  api.onDownloadStarted((data) => {
    console.log('Download started:', data);
    downloads.set(data.id, data);
    renderDownloads();
  });
  
  api.onDownloadProgress((data) => {
    const download = downloads.get(data.id);
    if (download) {
      Object.assign(download, data);
      renderDownloads();
    }
  });
  
  api.onDownloadCompleted((data) => {
    const download = downloads.get(data.id);
    if (download) {
      download.status = 'completed';
      download.progress = 100;
      renderDownloads();
    }
  });
  
  api.onDownloadError((data) => {
    const download = downloads.get(data.id);
    if (download) {
      download.status = 'error';
      download.error = data.error;
      renderDownloads();
    }
  });
  
  api.onDownloadCancelled((data) => {
    downloads.delete(data.id);
    renderDownloads();
  });
}

// Handle deep link
async function handleDeepLink(url) {
  try {
    console.log('Processing deep link:', url);
    
    // Parse the URL: armgddn://download?manifest=MANIFEST_URL&token=TOKEN
    const urlObj = new URL(url);
    const manifestUrl = urlObj.searchParams.get('manifest');
    const token = urlObj.searchParams.get('token');
    
    if (!manifestUrl) {
      console.error('No manifest URL in deep link');
      alert('Invalid download link: no manifest URL');
      return;
    }
    
    console.log('Fetching manifest from:', manifestUrl);
    
    // Fetch the manifest via main process (bypasses CORS)
    const manifest = await api.fetchManifest(manifestUrl, token);
    console.log('Manifest received:', manifest);
    
    // Start download
    await api.startDownload(manifest);
    
  } catch (error) {
    console.error('Failed to handle deep link:', error);
    alert(`Failed to start download: ${error.message}`);
  }
}

// Render downloads list
function renderDownloads() {
  const container = document.getElementById('downloads-list');
  
  if (downloads.size === 0) {
    container.innerHTML = '<div class="empty-state">No downloads yet. Click "Download with App" on the website to get started.</div>';
    return;
  }
  
  container.innerHTML = '';
  
  for (const [id, download] of downloads) {
    const item = document.createElement('div');
    item.className = `download-item ${download.status}`;
    
    item.innerHTML = `
      <div class="download-header">
        <span class="download-filename">${escapeHtml(download.name)}</span>
        <span class="download-state">${download.status}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${download.progress || 0}%"></div>
      </div>
      <div class="download-info">
        <span>${download.progress || 0}% ${download.currentFile ? `- ${escapeHtml(download.currentFile)}` : ''}</span>
        <span>${download.speed || ''} ${download.eta ? `ETA: ${download.eta}` : ''}</span>
      </div>
      <div class="download-actions">
        ${download.status === 'downloading' ? `<button class="cancel-btn" onclick="cancelDownload('${id}')">Cancel</button>` : ''}
        ${download.status === 'completed' ? `<button onclick="openDownloadFolder()">Open Folder</button>` : ''}
        ${download.status === 'error' ? `<button class="retry-btn" onclick="retryDownload('${id}')">Retry</button>` : ''}
      </div>
    `;
    
    container.appendChild(item);
  }
}

// Cancel download
async function cancelDownload(id) {
  await api.cancelDownload(id);
  downloads.delete(id);
  renderDownloads();
}

// Retry download (placeholder)
function retryDownload(id) {
  // TODO: Implement retry
  alert('Retry not implemented yet');
}

// Open download folder
async function openDownloadFolder() {
  await api.openFolder(settings.downloadPath);
}

// Settings
function openSettings() {
  document.getElementById('settings-panel').style.display = 'block';
}

function closeSettings() {
  document.getElementById('settings-panel').style.display = 'none';
}

function updateSettingsUI() {
  document.getElementById('download-path').value = settings.downloadPath || '';
  document.getElementById('max-concurrent').value = settings.maxConcurrentDownloads || 3;
  document.getElementById('show-notifications').checked = settings.showNotifications !== false;
}

async function saveSettings() {
  settings.downloadPath = document.getElementById('download-path').value;
  settings.maxConcurrentDownloads = parseInt(document.getElementById('max-concurrent').value);
  settings.showNotifications = document.getElementById('show-notifications').checked;
  
  await api.saveSettings(settings);
  closeSettings();
}

async function browseDownloadPath() {
  const path = await api.browseFolder();
  if (path) {
    document.getElementById('download-path').value = path;
  }
}

// History
function openHistory() {
  document.getElementById('history-panel').style.display = 'block';
  loadHistory();
}

function closeHistory() {
  document.getElementById('history-panel').style.display = 'none';
}

async function loadHistory() {
  const history = await api.getHistory();
  renderHistory(history);
}

function renderHistory(history) {
  const container = document.getElementById('history-list');
  
  if (!history || history.length === 0) {
    container.innerHTML = '<div class="empty-state">No download history yet.</div>';
    return;
  }
  
  container.innerHTML = '';
  
  for (const item of history) {
    const div = document.createElement('div');
    div.className = 'history-item';
    
    const date = new Date(item.endTime || item.startTime);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    
    div.innerHTML = `
      <div class="history-item-header">
        <span class="history-filename">${escapeHtml(item.name)}</span>
        <span class="history-size">${formatBytes(item.totalSize)}</span>
      </div>
      <div class="history-item-details">
        <span class="history-date">📅 ${dateStr}</span>
      </div>
    `;
    
    container.appendChild(div);
  }
}

async function clearHistory() {
  if (confirm('Are you sure you want to clear download history?')) {
    await api.clearHistory();
    await loadHistory();
  }
}

// Check for updates
async function checkForUpdates() {
  const result = await api.checkUpdates();
  if (result.hasUpdate) {
    alert(`Update available: ${result.latestVersion}`);
  } else {
    alert(`You're running the latest version (${result.version})`);
  }
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Make functions available globally for onclick handlers
window.cancelDownload = cancelDownload;
window.retryDownload = retryDownload;
window.openDownloadFolder = openDownloadFolder;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

})();
