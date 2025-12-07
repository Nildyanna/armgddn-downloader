const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

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
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      downloadHistory = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

// Save history
function saveHistory() {
  try {
    const historyPath = getHistoryPath();
    fs.writeFileSync(historyPath, JSON.stringify(downloadHistory, null, 2));
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

// Fetch manifest from URL (handles CORS)
ipcMain.handle('fetch-manifest', async (event, manifestUrl, token) => {
  const https = require('https');
  const http = require('http');
  const url = require('url');
  
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(manifestUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    // Extract query params to send as POST body
    const remote = parsedUrl.searchParams.get('remote');
    const pathParam = parsedUrl.searchParams.get('path');
    const postData = JSON.stringify({ remote, path: pathParam });
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    
    console.log('Fetching manifest:', options.hostname, options.path, { remote, path: pathParam });
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('Manifest response:', JSON.stringify(json, null, 2));
          
          if (json.success === false) {
            reject(new Error(json.error || 'Server returned error'));
            return;
          }
          
          resolve(json);
        } catch (e) {
          console.error('Failed to parse manifest:', data);
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
});

// Start download
ipcMain.handle('start-download', async (event, manifest) => {
  console.log('Received manifest:', JSON.stringify(manifest, null, 2));
  
  const downloadId = crypto.randomUUID();
  
  // Handle different manifest structures
  let files = [];
  let name = 'Unknown';
  let totalSize = 0;
  
  if (manifest.files && Array.isArray(manifest.files)) {
    // Standard format: { files: [...], name: "..." }
    files = manifest.files;
    name = manifest.name || 'Unknown';
    totalSize = manifest.totalSize || 0;
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
    startTime: new Date().toISOString()
  };

  activeDownloads.set(downloadId, download);
  mainWindow.webContents.send('download-started', download);

  // Create download directory
  const downloadDir = path.join(settings.downloadPath, name);
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Start rclone for each file
  for (const file of files) {
    await downloadFile(downloadId, file, downloadDir);
  }

  return downloadId;
});

// Download a single file using rclone
async function downloadFile(downloadId, file, downloadDir) {
  return new Promise((resolve, reject) => {
    const download = activeDownloads.get(downloadId);
    if (!download) {
      reject(new Error('Download not found'));
      return;
    }

    download.status = 'downloading';
    download.currentFile = file.name;

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
      '-v'
    ];

    const proc = spawn(rclonePath, args);
    download.process = proc;

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      parseRcloneProgress(downloadId, output);
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      parseRcloneProgress(downloadId, output);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        download.downloadedSize += file.size || 0;
        updateProgress(downloadId);
        resolve();
      } else {
        download.status = 'error';
        download.error = `rclone exited with code ${code}`;
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

// Parse rclone progress output
function parseRcloneProgress(downloadId, output) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  // Parse progress percentage
  const percentMatch = output.match(/(\d+)%/);
  if (percentMatch) {
    download.progress = parseInt(percentMatch[1]);
  }

  // Parse speed
  const speedMatch = output.match(/(\d+\.?\d*\s*[KMG]?i?B\/s)/i);
  if (speedMatch) {
    download.speed = speedMatch[1];
  }

  // Parse ETA
  const etaMatch = output.match(/ETA\s+(\S+)/);
  if (etaMatch) {
    download.eta = etaMatch[1];
  }

  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    progress: download.progress,
    speed: download.speed,
    eta: download.eta,
    currentFile: download.currentFile
  });
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
}

// Cancel download
ipcMain.handle('cancel-download', (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (download && download.process) {
    download.process.kill();
    download.status = 'cancelled';
    mainWindow.webContents.send('download-cancelled', { id: downloadId });
  }
  activeDownloads.delete(downloadId);
  return true;
});

// Complete download
function completeDownload(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  download.status = 'completed';
  download.progress = 100;
  download.endTime = new Date().toISOString();

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

// Get app version
ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// Check for updates (placeholder)
ipcMain.handle('check-updates', async () => {
  // TODO: Implement auto-updater
  return { hasUpdate: false, version: app.getVersion() };
});
