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
  
  // Display version in UI and title bar
  const version = await api.getVersion();
  document.getElementById('version-display').textContent = `Version ${version}`;
  document.title = `ARMGDDN Downloader v${version}`;
  
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
    let manifestUrl = urlObj.searchParams.get('manifest');
    const token = urlObj.searchParams.get('token');
    
    console.log('Raw manifest param:', manifestUrl);
    console.log('Token:', token ? '[present]' : '[missing]');
    
    if (!manifestUrl) {
      console.error('No manifest URL in deep link');
      alert('Invalid download link: no manifest URL');
      return;
    }
    
    // Ensure URL is properly decoded (searchParams should do this, but be safe)
    try {
      manifestUrl = decodeURIComponent(manifestUrl);
    } catch (e) {
      // Already decoded
    }
    
    console.log('Decoded manifest URL:', manifestUrl);
    
    // Parse and log the URL components for debugging
    try {
      const testUrl = new URL(manifestUrl);
      console.log('URL hostname:', testUrl.hostname);
      console.log('URL pathname:', testUrl.pathname);
      console.log('URL search:', testUrl.search);
      console.log('URL remote param:', testUrl.searchParams.get('remote'));
      console.log('URL path param:', testUrl.searchParams.get('path'));
    } catch (e) {
      console.error('Failed to parse URL:', e);
    }
    
    // Fetch the manifest via main process (bypasses CORS)
    const manifest = await api.fetchManifest(manifestUrl, token);
    console.log('Manifest received:', manifest);
    
    // Start download with token for progress reporting to website
    await api.startDownload(manifest, token);
    
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
    
    // Build active files list
    let activeFilesHtml = '';
    if (download.activeFiles && download.activeFiles.length > 0) {
      activeFilesHtml = download.activeFiles.map(f => `
        <div class="file-progress">
          <div class="file-progress-header">
            <span class="file-name">${escapeHtml(f.name)}</span>
            <span class="file-speed">${f.speed || ''}</span>
          </div>
          <div class="progress-bar small">
            <div class="progress-fill" style="width: ${f.progress || 0}%"></div>
          </div>
        </div>
      `).join('');
    }
    
    const fileCountText = download.fileCount > 1 
      ? `${download.completedFiles || 0}/${download.fileCount} files` 
      : '';
    
    // Format status for display
    const statusDisplay = {
      'starting': 'Starting',
      'in_progress': 'In Progress',
      'downloading': 'Downloading',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'error': 'Error'
    }[download.status] || download.status;
    
    item.innerHTML = `
      <div class="download-header">
        <span class="download-filename">${escapeHtml(download.name)}</span>
        <span class="download-state">${statusDisplay}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${download.progress || 0}%"></div>
      </div>
      <div class="download-info">
        <span>${download.progress || 0}% ${fileCountText}</span>
        <span class="total-speed">${download.totalSpeed ? `Total: ${download.totalSpeed}` : ''}</span>
      </div>
      <div class="active-files">
        ${activeFilesHtml}
      </div>
      <div class="download-disclaimer">
        It is normal for downloads to pause for periods of time - especially at the end. This is the server verifying the transfer in real time.
      </div>
      <div class="download-actions">
        ${download.status === 'downloading' || download.status === 'in_progress' ? `<button class="cancel-btn" onclick="cancelDownload('${id}')">Cancel</button>` : ''}
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
  try {
    const result = await api.checkUpdates();
    
    if (result.error) {
      alert(`Could not check for updates: ${result.error}`);
      return;
    }
    
    if (result.hasUpdate) {
      const shouldOpen = confirm(
        `Update available!\n\n` +
        `Current version: v${result.version}\n` +
        `Latest version: v${result.latestVersion}\n\n` +
        `Would you like to open the download page?`
      );
      
      if (shouldOpen && result.releaseUrl) {
        // Open release page in browser via main process
        await api.openExternal(result.releaseUrl);
      }
    } else {
      alert(`You're running the latest version (v${result.version})`);
    }
  } catch (error) {
    alert(`Failed to check for updates: ${error.message}`);
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
