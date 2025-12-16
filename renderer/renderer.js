// ARMGDDN Downloader - Electron Renderer
(function() {
'use strict';

const api = window.electronAPI;

// State
let downloads = new Map();

function normalizeActiveFiles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

let settings = {};

// Initialize
async function init() {
  // Load settings
  settings = await api.getSettings();
  updateSettingsUI();
  
  // Load history
  await loadHistory();
  
  // Display version in UI and title bar
  const version = await api.getVersion();
  document.getElementById('version-display').textContent = `Version ${version}`;
  document.title = `ARMGDDN Companion v${version}`;
  
  // Check connection status
  checkConnectionStatus();
  // Re-check connection status periodically
  setInterval(checkConnectionStatus, 30000);
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup IPC listeners
  setupIPCListeners();
  
  // Auto-check for updates on startup
  // - If Auto-update is enabled, install automatically without prompting.
  // - Otherwise, keep the existing "silent check" behavior (notify only if update exists).
  if (settings && settings.autoUpdate) {
    autoInstallUpdatesOnStartup();
  } else {
    checkForUpdatesSilent();
  }
}

async function autoInstallUpdatesOnStartup() {
  try {
    const result = await api.checkUpdates();
    if (!result || result.error) {
      console.error('Auto-update check failed:', result && result.error ? result.error : 'unknown');
      return;
    }
    if (!result.hasUpdate) return;
    if (!result.installerUrl) {
      console.warn('Auto-update available but no installer URL; skipping auto-install');
      return;
    }

    // Fully automatic: do not prompt. Install silently and relaunch after install.
    await api.installUpdate(result.installerUrl, { silent: true, relaunchAfterInstall: true, source: 'auto-update' });
  } catch (e) {
    console.error('Auto-update failed:', e && e.message ? e.message : e);
  }
}

// Setup UI event listeners
function setupEventListeners() {
  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings-btn').addEventListener('click', closeSettings);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('browse-path-btn').addEventListener('click', browseDownloadPath);
  const help7zBtn = document.getElementById('help-7z-btn');
  if (help7zBtn) {
    help7zBtn.addEventListener('click', openHelp7z);
  }
  const closeHelp7zBtn = document.getElementById('close-help-7z-btn');
  if (closeHelp7zBtn) {
    closeHelp7zBtn.addEventListener('click', closeHelp7z);
  }
  const help7zVideo = document.getElementById('help-7z-video');
  if (help7zVideo) {
    help7zVideo.addEventListener('loadedmetadata', () => {
    });
    help7zVideo.addEventListener('canplay', () => {
    });
    help7zVideo.addEventListener('error', () => {
      const err = help7zVideo.error;
      if (err) {
        console.error('[7z-video] error event', { code: err.code, message: err.message });
      } else {
        console.error('[7z-video] error event with no mediaError object');
      }
    });
  } else {
    console.warn('[7z-video] element not found when initializing event listeners');
  }
  
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
    handleDeepLink(url);
  });
  
  // Download events
  api.onDownloadStarted((data) => {
    const normalized = { ...data, activeFiles: normalizeActiveFiles(data.activeFiles) };
    downloads.set(data.id, normalized);
    renderDownloads();
    checkConnectionStatus();
  });
  
  api.onDownloadProgress((data) => {
    const download = downloads.get(data.id);
    if (!download) {
      // IPC ordering can occasionally deliver progress before started; don't drop the update.
      downloads.set(data.id, { id: data.id, ...data, activeFiles: normalizeActiveFiles(data.activeFiles) });
      renderDownloads();
      return;
    }
    Object.assign(download, data);
    if ('activeFiles' in data) {
      download.activeFiles = normalizeActiveFiles(data.activeFiles);
    }
    renderDownloads();
  });
  
  api.onDownloadCompleted((data) => {
    const download = downloads.get(data.id);
    if (download) {
      if (download.status === 'extracting') {
        return;
      }
      download.status = 'completed';
      download.progress = 100;
      renderDownloads();
    } else {
      // If completion arrives before started/progress, create it so the UI reflects completion.
      downloads.set(data.id, { id: data.id, status: 'completed', progress: 100 });
      renderDownloads();
    }
  });
  
  api.onDownloadError((data) => {
    const download = downloads.get(data.id);
    if (!download) {
      downloads.set(data.id, { id: data.id, status: 'error', error: data.error, progress: 0 });
      renderDownloads();
      return;
    }
    download.status = 'error';
    download.error = data.error;
    renderDownloads();
  });
  
  api.onDownloadCancelled((data) => {
    downloads.delete(data.id);
    renderDownloads();
  });
}

// Handle deep link
async function handleDeepLink(url) {
  try {
    // Parse the URL: armgddn://download?manifest=MANIFEST_URL&token=TOKEN
    const urlObj = new URL(url);
    let manifestUrl = urlObj.searchParams.get('manifest');
    const token = urlObj.searchParams.get('token');
    
    if (!manifestUrl) {
      console.error('No manifest URL in deep link');
      alert('Invalid download link: no manifest URL');
      return;
    }
    
    // Accept either a direct https URL or a base64-encoded https URL
    let manifestUrlStr = String(manifestUrl);
    try {
      const decoded = atob(manifestUrlStr);
      if (decoded && typeof decoded === 'string' && decoded.startsWith('https://')) {
        manifestUrlStr = decoded;
      }
    } catch (e) {}
    
    // Fetch the manifest via main process (bypasses CORS)
    const manifest = await api.fetchManifest(manifestUrlStr, token);
    
    // Start download with token for progress reporting
    // Pass manifestUrl so main process can report to the same server.
    await api.startDownload(manifest, token, manifestUrlStr);
    
  } catch (error) {
    console.error('Failed to handle deep link:', error);
    alert(`Failed to start download: ${error.message}`);
  }
}

// Throttle rendering to prevent flashing
let renderScheduled = false;
let lastRenderTime = 0;
const RENDER_THROTTLE = 500; // Render at most every 500ms

let deferredStructureRender = false;

let lastStructureKey = '';

function hasHoveredActionButton() {
  try {
    return !!document.querySelector('.download-actions button:hover');
  } catch (e) {
    return false;
  }
}

function scheduleRender() {
  if (renderScheduled) return;
  
  const now = Date.now();
  const timeSinceLastRender = now - lastRenderTime;
  
  if (timeSinceLastRender >= RENDER_THROTTLE) {
    // Render immediately
    requestAnimationFrame(renderDownloadsNow);
  } else {
    // Schedule render
    renderScheduled = true;
    setTimeout(() => {
      renderScheduled = false;
      requestAnimationFrame(renderDownloadsNow);
    }, RENDER_THROTTLE - timeSinceLastRender);
  }
}

// Render downloads list - updates in place when possible
function renderDownloads() {
  scheduleRender();
}

function updateItemsInPlace(items, container) {
  for (const [id, download] of items) {
    const item = container.querySelector(`.download-item[data-id="${CSS.escape(String(id))}"]`);
    if (!item) continue;

    item.className = `download-item ${download.status}`;

    const progressFill = item.querySelector('.progress-bar .progress-fill');
    if (progressFill) {
      progressFill.style.width = `${download.progress || 0}%`;
    }

    const stateEl = item.querySelector('.download-header .download-state');
    if (stateEl) {
      const statusDisplay = {
        'starting': 'Starting',
        'in_progress': 'In Progress',
        'downloading': 'Downloading',
        'extracting': 'Extracting',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
        'error': 'Error',
        'paused': 'Paused'
      }[download.status] || download.status;
      stateEl.textContent = statusDisplay;
    }

    const extractionErr = download && typeof download.extractionError === 'string' ? download.extractionError : '';
    const transferErr = download && typeof download.error === 'string' ? download.error : '';
    const showErr = (download.status === 'error' && transferErr) || extractionErr;
    const errMsg = (download.status === 'error' && transferErr) ? transferErr : extractionErr;
    const errEl = item.querySelector('.download-error-message');
    if (errEl) {
      errEl.style.display = showErr ? '' : 'none';
      if (showErr) {
        errEl.textContent = errMsg;
      }
    }

    const infoSpans = item.querySelectorAll('.download-info span');
    const leftInfo = infoSpans && infoSpans.length ? infoSpans[0] : null;
    const rightInfo = item.querySelector('.download-info .total-speed');

    const hasMultipleFiles = download.fileCount > 1;
    let completedFiles = download.completedFiles || 0;
    if (download.status === 'completed' && hasMultipleFiles && download.fileCount) {
      completedFiles = download.fileCount;
    }
    const fileCountText = hasMultipleFiles ? `${completedFiles}/${download.fileCount} files` : '';

    if (leftInfo) {
      leftInfo.textContent = `${download.progress || 0}% ${fileCountText}${download.totalSize ? ` • ${formatBytes(download.totalSize)}` : ''}`;
    }
    if (rightInfo) {
      if (download.status === 'extracting') {
        rightInfo.textContent = 'Extracting...';
      } else {
        const capMb = Number(settings && settings.maxDownloadSpeedMBps);
        const capText = (Number.isFinite(capMb) && capMb > 0 && download.totalSpeed) ? ` (cap ${capMb} MB/s)` : '';
        rightInfo.textContent = download.totalSpeed
          ? (hasMultipleFiles ? `Total: ${download.totalSpeed}${capText}` : `${download.totalSpeed}${capText}`)
          : '';
      }
    }

    const extractingEl = item.querySelector('.download-extracting-message');
    if (extractingEl) {
      extractingEl.style.display = download.status === 'extracting' ? '' : 'none';
    }

    const activeFilesEl = item.querySelector('.active-files');
    if (activeFilesEl) {
      const activeFiles = normalizeActiveFiles(download.activeFiles);
      const showActiveFiles = hasMultipleFiles && download.status !== 'completed' && activeFiles.length > 0;
      if (showActiveFiles) {
        const maxMb = Number(settings && settings.maxDownloadSpeedMBps);
        const workersSetting = Number(settings && settings.maxConcurrentDownloads);
        const workers = Math.min(6, Math.max(1, Number.isFinite(workersSetting) ? workersSetting : 3));
        const perWorker = Number.isFinite(maxMb) && maxMb > 0 ? (maxMb / workers) : 0;
        const perWorkerStr = Number.isFinite(perWorker) && perWorker > 0 ? perWorker.toFixed(1).replace(/\.0$/, '') : '';
        const perFileCapText = perWorkerStr ? ` (cap ${perWorkerStr} MB/s)` : '';
        activeFilesEl.innerHTML = activeFiles.map(f => `
          <div class="file-progress">
            <div class="file-progress-header">
              <span class="file-name">${escapeHtml(f.name)}</span>
              <span class="file-speed">${f.speed || ''}${(f.speed && perFileCapText) ? perFileCapText : ''}</span>
            </div>
            <div class="progress-bar small">
              <div class="progress-fill" style="width: ${f.progress || 0}%"></div>
            </div>
          </div>
        `).join('');
      } else {
        activeFilesEl.innerHTML = '';
      }
    }
  }
}

function renderDownloadsNow() {
  const now = Date.now();
  const container = document.getElementById('downloads-list');
  
  if (downloads.size === 0) {
    container.innerHTML = '<div class="empty-state">No downloads yet. Click "Download with App" on the website to get started.</div>';
    lastRenderTime = now;
    return;
  }
  
  // Create a sorted list: active/in-progress first (newest first), then completed
  const items = Array.from(downloads.entries());
  items.sort((a, b) => {
    const da = a[1];
    const db = b[1];

    const isActive = (d) => d && (d.status === 'downloading' || d.status === 'in_progress' || d.status === 'starting' || d.status === 'extracting');
    const aActive = isActive(da);
    const bActive = isActive(db);
    if (aActive !== bActive) {
      return aActive ? -1 : 1; // active first
    }

    const aTime = da && da.startTime ? new Date(da.startTime).getTime() : 0;
    const bTime = db && db.startTime ? new Date(db.startTime).getTime() : 0;
    return bTime - aTime; // newest first
  });

  // If only progress numbers are changing, update the existing DOM in-place to
  // avoid hover flicker (Pause button re-created under the cursor).
  const structureKey = items.map(([id, d]) => {
    const hasErr = d && d.error ? 1 : 0;
    const hasExtractionErr = d && d.extractionError ? 1 : 0;
    const fc = d && typeof d.fileCount === 'number' ? d.fileCount : 0;
    return `${id}:${d && d.status ? d.status : ''}:${fc}:${hasErr}:${hasExtractionErr}`;
  }).join('|');

  const prevStructureKey = lastStructureKey;
  const structureChanged = !!(prevStructureKey && structureKey !== prevStructureKey);
  const hovering = hasHoveredActionButton();

  if (hovering && structureChanged && container.children.length > 0) {
    updateItemsInPlace(items, container);
    if (!deferredStructureRender) {
      deferredStructureRender = true;
      setTimeout(() => {
        deferredStructureRender = false;
        renderDownloadsNow();
      }, 100);
    }
    lastRenderTime = now;
    return;
  }

  const canUpdateInPlace = container.children.length > 0 && prevStructureKey && structureKey === prevStructureKey;
  lastStructureKey = structureKey;

  if (canUpdateInPlace) {
    updateItemsInPlace(items, container);
    lastRenderTime = now;
    return;
  }

  // Structure changed; clear and fully rebuild list.
  container.innerHTML = '';

  // Render each download item
  for (const [id, download] of items) {
    const item = document.createElement('div');
    item.className = `download-item ${download.status}`;
    item.dataset.id = id;
    container.appendChild(item);
    
    const hasMultipleFiles = download.fileCount > 1;

    // Clamp completedFiles for completed downloads so header always shows N/N
    let completedFiles = download.completedFiles || 0;
    if (download.status === 'completed' && hasMultipleFiles && download.fileCount) {
      completedFiles = download.fileCount;
    }

    // Build active files list - only show when not fully completed
    let activeFilesHtml = '';
    const activeFiles = normalizeActiveFiles(download.activeFiles);
    const showActiveFiles = hasMultipleFiles && download.status !== 'completed' && activeFiles.length > 0;
    if (showActiveFiles) {
      const maxMb = Number(settings && settings.maxDownloadSpeedMBps);
      const workersSetting = Number(settings && settings.maxConcurrentDownloads);
      const workers = Math.min(6, Math.max(1, Number.isFinite(workersSetting) ? workersSetting : 3));
      const perWorker = Number.isFinite(maxMb) && maxMb > 0 ? (maxMb / workers) : 0;
      const perWorkerStr = Number.isFinite(perWorker) && perWorker > 0 ? perWorker.toFixed(1).replace(/\.0$/, '') : '';
      const perFileCapText = perWorkerStr ? ` (cap ${perWorkerStr} MB/s)` : '';
      activeFilesHtml = activeFiles.map(f => `
        <div class="file-progress">
          <div class="file-progress-header">
            <span class="file-name">${escapeHtml(f.name)}</span>
            <span class="file-speed">${f.speed || ''}${(f.speed && perFileCapText) ? perFileCapText : ''}</span>
          </div>
          <div class="progress-bar small">
            <div class="progress-fill" style="width: ${f.progress || 0}%"></div>
          </div>
        </div>
      `).join('');
    }
    
    const fileCountText = hasMultipleFiles 
      ? `${completedFiles}/${download.fileCount} files` 
      : '';
    
    // Format status for display
    const statusDisplay = {
      'starting': 'Starting',
      'in_progress': 'In Progress',
      'downloading': 'Downloading',
      'extracting': 'Extracting',
      'completed': 'Completed',
      'cancelled': 'Cancelled',
      'error': 'Error',
      'paused': 'Paused'
    }[download.status] || download.status;
    
    const isRunning = download.status === 'downloading' || download.status === 'in_progress' || download.status === 'starting' || download.status === 'extracting';
    const canPause = download.status === 'downloading' || download.status === 'in_progress' || download.status === 'starting';
    const isPaused = download.status === 'paused';
    const canCancel = isRunning || isPaused;
    
    const extractionErr = download && typeof download.extractionError === 'string' ? download.extractionError : '';
    const transferErr = download && typeof download.error === 'string' ? download.error : '';
    const errMsg = (download.status === 'error' && transferErr) ? transferErr : extractionErr;
    const showErrMsg = (download.status === 'error' && transferErr) || extractionErr;

    item.innerHTML = `
      <div class="download-header">
        <span class="download-filename">${escapeHtml(download.name)}</span>
        <span class="download-state">${statusDisplay}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${download.progress || 0}%"></div>
      </div>
      <div class="download-info">
        <span>${download.progress || 0}% ${fileCountText}${download.totalSize ? ` • ${formatBytes(download.totalSize)}` : ''}</span>
        <span class="total-speed">${download.status === 'extracting' ? 'Extracting...' : (download.totalSpeed ? (hasMultipleFiles ? `Total: ${download.totalSpeed}` : download.totalSpeed) : '')}</span>
      </div>
      <div class="download-extracting-message" style="display: ${download.status === 'extracting' ? 'block' : 'none'};">Extracting .7z archives...</div>
      ${showErrMsg ? `<div class="download-error-message">${escapeHtml(errMsg)}</div>` : ''}
      ${activeFilesHtml ? `<div class="active-files">${activeFilesHtml}</div>` : ''}
      <div class="download-disclaimer">
        It is normal for downloads to pause for periods of time - especially at the end. This is the server verifying the transfer in real time. If you use Pause/Resume, files that already finished will not be downloaded again, but the file that was in progress may restart from the beginning.
      </div>
      <div class="download-actions">
        ${canPause ? `<button class="pause-btn" data-download-id="${id}">Pause</button>` : ''}
        ${isPaused ? `<button class="resume-btn" data-download-id="${id}">Resume</button>` : ''}
        ${canCancel ? `<button class="cancel-btn" data-download-id="${id}">Cancel</button>` : ''}
        ${download.status === 'completed' ? `<button class="open-folder-btn">Open Folder</button>` : ''}
        ${download.status === 'error' ? `<button class="retry-btn" data-download-id="${id}">Retry</button>` : ''}
      </div>
    `;
    
    // Attach event listeners directly instead of using onclick
    const cancelBtn = item.querySelector('.cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = () => cancelDownload(id);
    }
    const pauseBtn = item.querySelector('.pause-btn');
    if (pauseBtn) {
      pauseBtn.onclick = () => pauseDownload(id);
    }
    const resumeBtn = item.querySelector('.resume-btn');
    if (resumeBtn) {
      resumeBtn.onclick = () => resumeDownload(id);
    }
    const openBtn = item.querySelector('.open-folder-btn');
    if (openBtn) {
      openBtn.onclick = () => openDownloadFolder();
    }
    const retryBtn = item.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.onclick = () => retryDownload(id);
    }
  }

  lastRenderTime = now;
}

// Cancel download
async function cancelDownload(id) {
  await api.cancelDownload(id);
  downloads.delete(id);
  renderDownloads();
}

async function pauseDownload(id) {
  const ok = await api.pauseDownload(id);
  if (!ok) return;
  const download = downloads.get(id);
  if (download) {
    download.status = 'paused';
    renderDownloads();
  }
}

async function resumeDownload(id) {
  const download = downloads.get(id);
  const prevStatus = download ? download.status : null;
  if (download && download.status !== 'completed') {
    download.status = 'in_progress';
    renderDownloads();
  }

  const ok = await api.resumeDownload(id);
  if (!ok) {
    // If resume was rejected, restore previous status (unless it already completed via IPC).
    const d2 = downloads.get(id);
    if (d2 && d2.status !== 'completed' && prevStatus) {
      d2.status = prevStatus;
      renderDownloads();
    }
    return;
  }
}

async function retryDownload(id) {
  const download = downloads.get(id);
  const prevStatus = download ? download.status : null;
  const prevError = download ? download.error : null;

  if (download && download.status !== 'completed') {
    download.status = 'in_progress';
    download.error = '';
    renderDownloads();
  }

  const ok = await api.retryDownload(id);
  if (!ok) {
    const d2 = downloads.get(id);
    if (d2 && d2.status !== 'completed') {
      if (prevStatus) d2.status = prevStatus;
      if (typeof prevError === 'string') d2.error = prevError;
      renderDownloads();
    }
    return;
  }
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

async function openHelp7z() {
  const panel = document.getElementById('help-7z-panel');
  if (!panel) return;
  panel.style.display = 'block';
  const video = document.getElementById('help-7z-video');
  if (video) {
    try {
      const src = await api.getHelp7zVideoSrc();
      video.src = src;
      video.load();
      video.currentTime = 0;
      try {
        await video.play();
      } catch (playErr) {
        console.warn('[7z-video] autoplay failed, video will remain paused', playErr);
      }
    } catch (e) {
      console.error('[7z-video] failed to set help video src', e);
    }
  }
}

function closeHelp7z() {
  const panel = document.getElementById('help-7z-panel');
  if (!panel) return;
  panel.style.display = 'none';
  const video = document.getElementById('help-7z-video');
  if (video && typeof video.pause === 'function') {
    try {
      video.pause();
    } catch (e) {}
  }
}

function updateSettingsUI() {
  document.getElementById('download-path').value = settings.downloadPath || '';
  document.getElementById('max-concurrent').value = settings.maxConcurrentDownloads || 3;
  const maxSpeedEl = document.getElementById('max-speed-mbps');
  if (maxSpeedEl) {
    const v = Number(settings.maxDownloadSpeedMBps);
    maxSpeedEl.value = Number.isFinite(v) && v > 0 ? String(Math.round(v)) : '';
  }
  const autoExtractEl = document.getElementById('auto-extract-7z');
  if (autoExtractEl) {
    autoExtractEl.checked = !!settings.autoExtract7z;
  }
  document.getElementById('show-notifications').checked = settings.showNotifications !== false;
  document.getElementById('minimize-to-tray-on-minimize').checked = !!settings.minimizeToTrayOnMinimize;
  document.getElementById('minimize-to-tray-on-exit').checked = !!settings.minimizeToTrayOnClose;

  const autoUpdateEl = document.getElementById('auto-update');
  if (autoUpdateEl) {
    autoUpdateEl.checked = !!settings.autoUpdate;
  }
  const startupEl = document.getElementById('start-with-os-startup');
  if (startupEl) {
    startupEl.checked = !!settings.startWithOsStartup;
  }
}

async function saveSettings() {
  settings.downloadPath = document.getElementById('download-path').value;
  settings.maxConcurrentDownloads = parseInt(document.getElementById('max-concurrent').value);
  const maxSpeedEl = document.getElementById('max-speed-mbps');
  if (maxSpeedEl) {
    const raw = String(maxSpeedEl.value || '').trim();
    const v = raw === '' ? 0 : Number(raw);
    settings.maxDownloadSpeedMBps = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  const autoExtractEl = document.getElementById('auto-extract-7z');
  if (autoExtractEl) {
    settings.autoExtract7z = !!autoExtractEl.checked;
  }
  settings.showNotifications = document.getElementById('show-notifications').checked;
  settings.minimizeToTrayOnMinimize = document.getElementById('minimize-to-tray-on-minimize').checked;
  settings.minimizeToTrayOnClose = document.getElementById('minimize-to-tray-on-exit').checked;

  const autoUpdateEl = document.getElementById('auto-update');
  if (autoUpdateEl) {
    settings.autoUpdate = !!autoUpdateEl.checked;
  }
  const startupEl = document.getElementById('start-with-os-startup');
  if (startupEl) {
    settings.startWithOsStartup = !!startupEl.checked;
  }
  
  await api.saveSettings(settings);
  closeSettings();
}

async function browseDownloadPath() {
  const path = await api.browseFolder();
  if (path) {
    // Update UI field
    document.getElementById('download-path').value = path;

    // Persist immediately so this location sticks until changed again
    settings.downloadPath = path;
    await api.saveSettings(settings);
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

// Check for updates (manual - shows all results)
async function checkForUpdates() {
  try {
    const result = await api.checkUpdates();
    
    if (result.error) {
      alert(`Could not check for updates: ${result.error}`);
      return;
    }
    
    if (result.hasUpdate) {
      showUpdateNotification(result);
    } else {
      alert(`You're running the latest version (v${result.version})`);
    }
  } catch (error) {
    alert(`Failed to check for updates: ${error.message}`);
  }
}

// Check for updates silently (auto - only shows if update available)
async function checkForUpdatesSilent() {
  try {
    const result = await api.checkUpdates();
    
    if (result.error) {
      console.error('Update check failed:', result.error);
      return;
    }
    
    if (result.hasUpdate) {
      showUpdateNotification(result);
    }
  } catch (error) {
    console.error('Silent update check failed:', error.message);
  }
}

// Show update error message
function showUpdateError() {
  alert('Update check not available. Please try again later.');
}

function getFriendlyUpdateFailureMessage(errorText, releaseUrl) {
  const err = String(errorText || '').trim();
  const isHostBlocked = /host not allowed/i.test(err);
  const isInstallerBlocked = /installer url not allowed/i.test(err);
  const isOneTimeManual = isHostBlocked || isInstallerBlocked;

  if (isOneTimeManual) {
    return (
      `This version can't auto-update due to a security restriction.\n\n` +
      `We'll open the download page so you can install the latest version manually (one-time).\n\n` +
      `Download page:\n${releaseUrl || ''}`
    );
  }

  return (
    `Update couldn't be installed automatically.\n\n` +
    `We'll open the download page instead.\n\n` +
    `Details: ${err}`
  );
}

// Show update notification
async function showUpdateNotification(result) {
  const hasAutoInstall = !!result.installerUrl;
  
  const message = hasAutoInstall
    ? `Update available!\n\n` +
      `Current version: v${result.version}\n` +
      `Latest version: v${result.latestVersion}\n\n` +
      `Would you like to download and install the update now?`
    : `Update available!\n\n` +
      `Current version: v${result.version}\n` +
      `Latest version: v${result.latestVersion}\n\n` +
      `Would you like to open the download page?`;
  
  const shouldUpdate = confirm(message);
  
  if (shouldUpdate) {
    if (hasAutoInstall) {
      try {
        const installResult = await api.installUpdate(result.installerUrl, {
          silent: true,
          relaunchAfterInstall: true,
          source: 'manual-confirm'
        });
        
        if (installResult.message) {
          alert(installResult.message);
        } else if (!installResult.success) {
          alert(getFriendlyUpdateFailureMessage(installResult.error, result.releaseUrl));
          api.openExternal(result.releaseUrl);
        }
        // If success without message, app will quit and installer will run
      } catch (e) {
        alert(getFriendlyUpdateFailureMessage(e && e.message ? e.message : e, result.releaseUrl));
        api.openExternal(result.releaseUrl);
      }
    } else if (result.releaseUrl) {
      // Fallback to opening release page
      api.openExternal(result.releaseUrl);
    }
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

// Check connection status with server
async function checkConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) return;
  
  try {
    const status = await api.getSessionStatus();
    
    if (status.isValid) {
      // Session is valid - connected
      statusEl.className = 'connection-status connected';
      statusEl.querySelector('.status-text').textContent = 'Connected';
      statusEl.onclick = null;
      statusEl.style.cursor = 'default';
    } else {
      // No valid session - awaiting first download (or token expired)
      statusEl.className = 'connection-status pending';
      statusEl.querySelector('.status-text').textContent = 'Awaiting First Download';
      statusEl.onclick = null;
      statusEl.style.cursor = 'default';
    }
  } catch (e) {
    // Error checking status - show pending
    statusEl.className = 'connection-status pending';
    statusEl.querySelector('.status-text').textContent = 'Awaiting First Download';
    statusEl.onclick = null;
    statusEl.style.cursor = 'default';
  }
}

// Make functions available globally for onclick handlers
window.cancelDownload = cancelDownload;
window.retryDownload = retryDownload;
window.openDownloadFolder = openDownloadFolder;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

})();
