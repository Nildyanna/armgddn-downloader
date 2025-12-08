const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');

// Set app name for dialogs and window titles
app.name = 'ARMGDDN Downloader';

// Handle deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('armgddn', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('armgddn');
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Handle deep link from second instance
    const url = commandLine.find(arg => arg.startsWith('armgddn://'));
    if (url) {
      handleDeepLink(url);
    }
  });
}

let mainWindow;
let tray;
let activeDownloads = new Map();
let downloadHistory = [];
let settings = {
  downloadPath: path.join(app.getPath('downloads'), 'ARMGDDN'),
  maxConcurrentDownloads: 3,
  showNotifications: true
};

// Debug log file for troubleshooting
const getDebugLogPath = () => path.join(app.getPath('userData'), 'debug.log');
function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(getDebugLogPath(), `[${timestamp}] ${message}\n`);
  } catch (e) { /* ignore */ }
}

// Paths
const getResourcePath = () => {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return __dirname;
};

const getRclonePath = () => {
  const resourcePath = getResourcePath();
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(resourcePath, 'rclone', 'rclone.exe');
  }
  return path.join(resourcePath, 'rclone', 'rclone');
};

const getConfigPath = () => {
  return path.join(app.getPath('userData'), 'config.json');
};

const getHistoryPath = () => {
  return path.join(app.getPath('userData'), 'history.json');
};

// Load settings
function loadSettings() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      settings = { ...settings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// Save settings
function saveSettings() {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Load history
function loadHistory() {
  try {
    const historyPath = getHistoryPath();
    console.log('History path:', historyPath);
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      downloadHistory = JSON.parse(data);
      console.log('Loaded history:', downloadHistory.length, 'items');
    } else {
      console.log('No history file found');
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

// Save history
function saveHistory() {
  try {
    const historyPath = getHistoryPath();
    console.log('Saving history to:', historyPath, 'items:', downloadHistory.length);
    fs.writeFileSync(historyPath, JSON.stringify(downloadHistory, null, 2));
    console.log('History saved successfully');
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

// Handle deep link
function handleDeepLink(url) {
  console.log('Deep link received:', url);
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url);
    mainWindow.show();
    mainWindow.focus();
  }
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle close to tray
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// Create tray
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('ARMGDDN Downloader');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

// App ready
app.whenReady().then(() => {
  loadSettings();
  loadHistory();
  createWindow();
  createTray();

  // Handle deep link on macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Handle deep link from command line (Windows/Linux)
  const url = process.argv.find(arg => arg.startsWith('armgddn://'));
  if (url) {
    handleDeepLink(url);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Get settings
ipcMain.handle('get-settings', () => {
  return settings;
});

// Save settings
ipcMain.handle('save-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  return settings;
});

// Browse for folder
ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Get download history
ipcMain.handle('get-history', () => {
  return downloadHistory;
});

// Clear history
ipcMain.handle('clear-history', () => {
  downloadHistory = [];
  saveHistory();
  return true;
});

// Get active downloads
ipcMain.handle('get-downloads', () => {
  const downloads = [];
  for (const [id, download] of activeDownloads) {
    downloads.push({
      id,
      ...download,
      process: undefined // Don't send process object
    });
  }
  return downloads;
});

// Validate token format (basic check)
function isValidToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Token should be non-empty and reasonable length
  return token.length >= 10 && token.length <= 500;
}

// Internal function to fetch manifest (can be called recursively for redirects)
async function fetchManifestInternal(manifestUrl, token, redirectCount = 0) {
  // Prevent infinite redirect loops
  if (redirectCount > 3) {
    throw new Error('Too many redirects while fetching manifest');
  }
  
  return new Promise((resolve, reject) => {
    console.log('Raw manifest URL:', manifestUrl);
    
    const parsedUrl = new URL(manifestUrl);
    
    // Security: Enforce HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('Security error: Only HTTPS connections are allowed'));
      return;
    }
    
    // Parse query params using decodeURIComponent (preserves + as literal +)
    const queryString = parsedUrl.search.substring(1);
    console.log('Raw query string:', queryString);
    
    const params = {};
    for (const pair of queryString.split('&')) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        const key = decodeURIComponent(pair.substring(0, eqIndex));
        const value = decodeURIComponent(pair.substring(eqIndex + 1));
        params[key] = value;
      }
    }
    
    console.log('All parsed params:', JSON.stringify(params, null, 2));
    
    const remote = params.remote;
    const pathParam = params.path;
    
    console.log('Parsed params - remote:', JSON.stringify(remote), 'path:', JSON.stringify(pathParam));
    
    if (!remote || !pathParam) {
      const errorMsg = `Missing remote or path. Query="${queryString}", Params=${JSON.stringify(params)}, remote="${remote}", path="${pathParam}"`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }
    
    const postData = JSON.stringify({ remote, path: pathParam });
    console.log('POST body:', postData);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    
    console.log('POST request:', options.hostname + options.path, 'body:', postData);
    
    const req = https.request(options, (res) => {
      console.log('Response status:', res.statusCode, res.statusMessage);
      console.log('Response headers:', JSON.stringify(res.headers));
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        console.log('Raw response body:', data.substring(0, 500));
        try {
          const json = JSON.parse(data);
          console.log('Manifest response:', JSON.stringify(json, null, 2));
          
          // Handle game moved to new location (server returns 302 with redirect info)
          if (json.redirect && json.newRemote && json.newPath) {
            console.log(`Game moved! Retrying with new location: ${json.newRemote}:${json.newPath}`);
            
            // Build new manifest URL with updated remote and path
            const newManifestUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}?remote=${encodeURIComponent(json.newRemote)}&path=${encodeURIComponent(json.newPath)}`;
            
            try {
              // Recursively fetch from new location
              const newManifest = await fetchManifestInternal(newManifestUrl, token, redirectCount + 1);
              resolve(newManifest);
            } catch (retryErr) {
              reject(new Error(`Game was moved but failed to fetch from new location: ${retryErr.message}`));
            }
            return;
          }
          
          if (json.success === false) {
            reject(new Error(json.error || 'Server returned error'));
            return;
          }
          
          resolve(json);
        } catch (e) {
          console.error('Failed to parse manifest:', data);
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)));
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });
    
    console.log('Sending POST body:', postData);
    req.write(postData);
    req.end();
  });
}

// Fetch manifest from URL (handles CORS)
ipcMain.handle('fetch-manifest', async (event, manifestUrl, token) => {
  // Security: Validate token
  if (!isValidToken(token)) {
    throw new Error('Invalid or missing authentication token');
  }
  
  return fetchManifestInternal(manifestUrl, token);
});

// Debug log to file for troubleshooting
function debugLog(message) {
  const logPath = path.join(app.getPath('userData'), 'debug.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logPath, logLine);
  console.log(message);
}

// Report progress to website server
async function reportProgressToServer(download, token) {
  logToFile(`reportProgressToServer called - token: ${token ? 'present' : 'MISSING'}, download: ${download?.name}`);
  
  if (!token) {
    console.log('[Progress] No token for progress reporting');
    logToFile('[Progress] No token for progress reporting');
    debugLog('No token for progress reporting');
    return;
  }
  
  try {
    // Calculate bytes downloaded from progress percentage
    const bytesDownloaded = download.totalSize > 0 
      ? Math.round((download.progress / 100) * download.totalSize)
      : (download.downloadedSize || 0);
    
    const postData = JSON.stringify({
      downloadId: download.id,
      fileName: download.name,
      bytesDownloaded: bytesDownloaded,
      totalBytes: download.totalSize || 0,
      status: download.status === 'in_progress' ? 'downloading' : download.status,
      error: download.error || null
    });
    
    logToFile(`[Progress] Sending: ${postData.substring(0, 150)}`);
    console.log(`[Progress] Reporting to server: ${download.name} - ${download.status}`);
    debugLog(`Reporting progress: ${postData.substring(0, 100)}...`);
    
    const options = {
      hostname: 'www.armgddnbrowser.com',
      port: 443,
      path: '/api/app-progress',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        logToFile(`[Progress] Server response: ${res.statusCode} - ${responseData}`);
        console.log(`[Progress] Server response: ${res.statusCode}`);
        debugLog(`Progress response: ${res.statusCode} ${responseData}`);
        if (res.statusCode !== 200) {
          console.log(`[Progress] Response body: ${responseData}`);
        }
      });
    });
    
    req.on('error', (err) => {
      logToFile(`[Progress] Request error: ${err.message}`);
      console.log(`[Progress] Request error: ${err.message}`);
      debugLog(`Progress report error: ${err.message}`);
    });
    
    req.write(postData);
    req.end();
    logToFile(`[Progress] Request sent`);
  } catch (err) {
    logToFile(`[Progress] Exception: ${err.message} - ${err.stack}`);
    console.log(`[Progress] Exception: ${err.message}`);
    console.error('[Progress] Stack:', err.stack);
    debugLog(`Progress report exception: ${err.message}`);
  }
}

// Start download
ipcMain.handle('start-download', async (event, manifest, token) => {
  debugLog(`Download started - Token: ${token ? `[${token.substring(0, 8)}...]` : '[MISSING]'}`);
  console.log('Received manifest:', JSON.stringify(manifest, null, 2));
  
  const downloadId = crypto.randomUUID();
  
  // Handle different manifest structures
  let files = [];
  let name = 'Unknown';
  let totalSize = 0;
  
  if (manifest.files && Array.isArray(manifest.files)) {
    // Standard format: { files: [...], path: "...", ... }
    files = manifest.files;
    // Extract folder name from path (e.g., "PC1/Game Name" -> "Game Name")
    const folderPath = manifest.path || manifest.name || '';
    name = folderPath.split('/').pop() || 'Download';
    totalSize = manifest.totalSize || files.reduce((sum, f) => sum + (f.size || 0), 0);
  } else if (manifest.url) {
    // Single file format: { url: "...", name: "...", size: ... }
    files = [{ url: manifest.url, name: manifest.name || 'download', size: manifest.size || 0 }];
    name = manifest.name || 'download';
    totalSize = manifest.size || 0;
  } else if (Array.isArray(manifest)) {
    // Array of files directly
    files = manifest;
    name = manifest[0]?.name || 'download';
  } else {
    console.error('Unknown manifest format:', manifest);
    throw new Error('Unknown manifest format. Expected files array or url property.');
  }
  
  const download = {
    id: downloadId,
    name: name,
    status: 'starting',
    progress: 0,
    speed: '',
    eta: '',
    totalSize: totalSize,
    downloadedSize: 0,
    files: files,
    fileCount: files.length,
    completedFiles: 0,
    activeFiles: {},  // Track per-file progress: { fileName: { progress, speed, eta } }
    activeProcesses: [],  // Track all active rclone processes for cancellation
    totalSpeed: 0,
    startTime: new Date().toISOString(),
    token: token,  // Store token for progress reporting
    cancelled: false  // Flag to stop new downloads when cancelled
  };

  activeDownloads.set(downloadId, download);
  mainWindow.webContents.send('download-started', { ...download, fileCount: files.length });

  // Create download directory
  const downloadDir = path.join(settings.downloadPath, name);
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Update status to in_progress
  download.status = 'in_progress';
  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    status: 'in_progress',
    progress: 0
  });
  
  // Report initial progress to server
  reportProgressToServer(download, token);

  // Download files in parallel (up to 6 concurrent downloads for better speed)
  const PARALLEL_DOWNLOADS = 6;
  const fileQueue = [...files];
  const activePromises = [];
  
  const processNext = async () => {
    while (fileQueue.length > 0 && !download.cancelled) {
      const file = fileQueue.shift();
      if (!file) break;
      try {
        await downloadFile(downloadId, file, downloadDir);
      } catch (err) {
        if (!download.cancelled) {
          console.error('File download error:', err);
        }
        // Continue with other files even if one fails (unless cancelled)
      }
    }
  };
  
  // Start parallel download workers
  for (let i = 0; i < Math.min(PARALLEL_DOWNLOADS, files.length); i++) {
    activePromises.push(processNext());
  }
  
  await Promise.all(activePromises);
  
  // Only mark as completed if not cancelled
  if (!download.cancelled) {
    completeDownload(downloadId);
  }

  return downloadId;
});

// Check if output indicates quota exceeded
function isQuotaError(output) {
  const lowerOutput = output.toLowerCase();
  return lowerOutput.includes('quota') || 
         lowerOutput.includes('rate limit') ||
         lowerOutput.includes('too many requests') ||
         lowerOutput.includes('429');
}

// Check if URL contains expired token indicators
function isTokenExpiredError(output) {
  const expiredIndicators = [
    'token expired',
    'token invalid',
    '401',
    'unauthorized',
    'access denied'
  ];
  const lowerOutput = output.toLowerCase();
  return expiredIndicators.some(indicator => lowerOutput.includes(indicator));
}

// Download a single file using rclone
async function downloadFile(downloadId, file, downloadDir) {
  return new Promise((resolve, reject) => {
    const download = activeDownloads.get(downloadId);
    if (!download) {
      reject(new Error('Download not found'));
      return;
    }
    
    // Security: Validate file URL is HTTPS
    if (!file.url || !file.url.startsWith('https://')) {
      reject(new Error('Security error: File URL must use HTTPS'));
      return;
    }

    download.status = 'downloading';
    download.currentFile = file.name;
    
    // Initialize per-file tracking
    download.activeFiles[file.name] = {
      name: file.name,
      size: file.size || 0,
      progress: 0,
      speed: '',
      eta: '',
      status: 'downloading'
    };

    const rclonePath = getRclonePath();
    const outputPath = path.join(downloadDir, file.name);

    // Ensure parent directory exists
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const args = [
      'copyurl',
      file.url,
      outputPath,
      '--progress',
      '-v',
      '--buffer-size', '128M',         // Large buffer for better throughput
      '--no-check-certificate',        // Skip SSL verification for speed
      '--contimeout', '30s',           // Connection timeout
      '--timeout', '300s',             // Overall timeout
      '--low-level-retries', '3',      // Retry on low-level errors
      '--drive-acknowledge-abuse'      // Bypass Google Drive virus scan warnings
    ];

    const proc = spawn(rclonePath, args);
    download.activeProcesses.push(proc);  // Track for cancellation

    let errorOutput = '';
    
    proc.stdout.on('data', (data) => {
      const output = data.toString();
      parseRcloneProgress(downloadId, file.name, output);
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      parseRcloneProgress(downloadId, file.name, output);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        download.downloadedSize += file.size || 0;
        download.completedFiles++;
        // Mark file as completed and remove from active
        if (download.activeFiles[file.name]) {
          download.activeFiles[file.name].status = 'completed';
          download.activeFiles[file.name].progress = 100;
          delete download.activeFiles[file.name];
        }
        updateProgress(downloadId);
        resolve();
      } else {
        download.status = 'error';
        
        // Check for specific error types
        if (isQuotaError(errorOutput)) {
          download.error = 'Download quota exceeded. This file is temporarily unavailable due to high demand. Please try again later or try a different game.';
        } else if (isTokenExpiredError(errorOutput)) {
          download.error = 'Download link expired. Please try downloading again from the website.';
        } else {
          download.error = `Download failed (code ${code}). Please try again.`;
        }
        
        mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
        reject(new Error(download.error));
      }
    });

    proc.on('error', (err) => {
      download.status = 'error';
      download.error = err.message;
      mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
      reject(err);
    });
  });
}

// Throttle UI updates per download
const lastUIUpdate = new Map();
const UI_UPDATE_INTERVAL = 500; // Update UI every 500ms max
let lastProgressReport = 0; // Throttle server progress reports

// Parse rclone progress output
function parseRcloneProgress(downloadId, fileName, output) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  // Get or create file tracking
  const fileInfo = download.activeFiles[fileName];
  if (!fileInfo) return;

  // Parse progress percentage
  const percentMatch = output.match(/(\d+)%/);
  if (percentMatch) {
    fileInfo.progress = parseInt(percentMatch[1]);
  }

  // Parse speed (e.g., "123.4 MiB/s" or "45 KiB/s")
  const speedMatch = output.match(/(\d+\.?\d*)\s*([KMG]i?B)\/s/i);
  if (speedMatch) {
    fileInfo.speed = `${speedMatch[1]} ${speedMatch[2]}/s`;
    fileInfo.speedBytes = parseSpeedToBytes(speedMatch[1], speedMatch[2]);
  }

  // Parse ETA
  const etaMatch = output.match(/ETA\s+(\S+)/);
  if (etaMatch) {
    fileInfo.eta = etaMatch[1];
  }

  // Throttle UI updates to prevent flashing
  const now = Date.now();
  const lastUpdate = lastUIUpdate.get(downloadId) || 0;
  if (now - lastUpdate < UI_UPDATE_INTERVAL) {
    return; // Skip this update
  }
  lastUIUpdate.set(downloadId, now);

  // Calculate total speed from all active files
  let totalSpeedBytes = 0;
  const activeFilesList = Object.values(download.activeFiles);
  for (const f of activeFilesList) {
    totalSpeedBytes += f.speedBytes || 0;
  }
  download.totalSpeed = formatSpeed(totalSpeedBytes);

  // Calculate overall progress based on completed + active file progress
  let totalProgress = download.completedFiles * 100;
  for (const f of activeFilesList) {
    totalProgress += f.progress || 0;
  }
  download.progress = Math.round(totalProgress / download.fileCount);

  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    progress: download.progress,
    totalSpeed: download.totalSpeed,
    activeFiles: activeFilesList,
    completedFiles: download.completedFiles,
    fileCount: download.fileCount
  });
  
  // Report to server (throttled separately from UI updates)
  const now2 = Date.now();
  if (now2 - lastProgressReport > 2000) {
    lastProgressReport = now2;
    reportProgressToServer(download, download.token);
  }
}

// Parse speed string to bytes per second
function parseSpeedToBytes(value, unit) {
  const num = parseFloat(value);
  const unitLower = unit.toLowerCase();
  if (unitLower.startsWith('g')) return num * 1024 * 1024 * 1024;
  if (unitLower.startsWith('m')) return num * 1024 * 1024;
  if (unitLower.startsWith('k')) return num * 1024;
  return num;
}

// Format bytes per second to human readable (decimal MB/s, not binary MiB/s)
function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1000 * 1000 * 1000) {
    return (bytesPerSec / (1000 * 1000 * 1000)).toFixed(1) + ' GB/s';
  } else if (bytesPerSec >= 1000 * 1000) {
    return (bytesPerSec / (1000 * 1000)).toFixed(1) + ' MB/s';
  } else if (bytesPerSec >= 1000) {
    return (bytesPerSec / 1000).toFixed(1) + ' KB/s';
  }
  return bytesPerSec.toFixed(0) + ' B/s';
}

// Update overall progress
function updateProgress(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  if (download.totalSize > 0) {
    download.progress = Math.round((download.downloadedSize / download.totalSize) * 100);
  }

  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    progress: download.progress,
    downloadedSize: download.downloadedSize
  });
  
  // Report to server every 2 seconds (throttled)
  const now = Date.now();
  if (now - lastProgressReport > 2000) {
    lastProgressReport = now;
    reportProgressToServer(download, download.token);
  }
}

// Cancel download
ipcMain.handle('cancel-download', (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (download) {
    download.cancelled = true;
    download.status = 'cancelled';
    
    // Kill all active processes
    if (download.activeProcesses && download.activeProcesses.length > 0) {
      for (const proc of download.activeProcesses) {
        try {
          proc.kill('SIGTERM');
        } catch (e) {
          console.log('Error killing process:', e.message);
        }
      }
    }
    
    mainWindow.webContents.send('download-cancelled', { id: downloadId });
    activeDownloads.delete(downloadId);
  }
  return true;
});

// Complete download
function completeDownload(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  download.status = 'completed';
  download.progress = 100;
  download.downloadedSize = download.totalSize;
  download.endTime = new Date().toISOString();

  // Report completion to server
  reportProgressToServer(download, download.token);

  // Add to history
  downloadHistory.unshift({
    id: download.id,
    name: download.name,
    totalSize: download.totalSize,
    startTime: download.startTime,
    endTime: download.endTime,
    status: 'completed'
  });
  saveHistory();

  mainWindow.webContents.send('download-completed', { id: downloadId });
  activeDownloads.delete(downloadId);
}

// Open folder
ipcMain.handle('open-folder', (event, folderPath) => {
  shell.openPath(folderPath || settings.downloadPath);
});

// Open external URL in browser
ipcMain.handle('open-external', (event, url) => {
  // Security: Only allow HTTPS URLs
  if (url && url.startsWith('https://')) {
    shell.openExternal(url);
  }
});

// Get app version
ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// Check for updates via GitHub releases
ipcMain.handle('check-updates', async () => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/Nildyanna/armgddn-downloader/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'ARMGDDN-Downloader',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = (release.tag_name || '').replace(/^v/, '');
          const currentVersion = app.getVersion();
          
          // Compare versions
          const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
          
          resolve({
            hasUpdate,
            version: currentVersion,
            latestVersion,
            releaseUrl: release.html_url || 'https://github.com/Nildyanna/armgddn-downloader/releases',
            releaseNotes: release.body || ''
          });
        } catch (e) {
          console.error('Failed to check for updates:', e);
          resolve({ hasUpdate: false, version: app.getVersion(), error: 'Failed to check for updates' });
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('Update check failed:', err);
      resolve({ hasUpdate: false, version: app.getVersion(), error: err.message });
    });
    
    req.end();
  });
});

// Compare semantic versions (returns 1 if a > b, -1 if a < b, 0 if equal)
function compareVersions(a, b) {
  if (!a || !b) return 0;
  const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
  const partsB = b.split('.').map(n => parseInt(n, 10) || 0);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}
