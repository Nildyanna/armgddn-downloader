const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');

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
let authWindow;
let tray;
let activeDownloads = new Map();
let downloadHistory = [];
let sessionCookie = null;
let settings = {
  downloadPath: path.join(app.getPath('downloads'), 'ARMGDDN'),
  maxConcurrentDownloads: 3,
  showNotifications: true,
  minimizeToTrayOnMinimize: false,
  minimizeToTrayOnClose: false
};

// DevTools policy: allow in dev always, and in packaged builds only when explicitly enabled
// via environment variable on the owner's machine.
const isOwnerDevToolsAllowed = !app.isPackaged || process.env.DOWNLOADER_OWNER_DEVTOOLS === '1';

// Helper: show OS-level notification (tray balloon vs toast)
function showDownloadNotification(title, body) {
  try {
    // Respect user setting
    if (settings && settings.showNotifications === false) return;

    const windowHidden = !mainWindow || !mainWindow.isVisible();

    // On Windows, if app is hidden to tray, prefer tray balloon
    if (process.platform === 'win32' && tray && windowHidden && typeof tray.displayBalloon === 'function') {
      tray.displayBalloon({
        title: title,
        content: body
      });
      return;
    }

    // Fallback to Electron Notification (OS toast where supported)
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const notif = new Notification({ title, body });
      notif.show();
    }
  } catch (e) {
    logToFile('Notification error: ' + e.message);
  }
}

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

const getHelp7zVideoFilePath = () => {
  const resourcesPath = getResourcePath();
  if (app.isPackaged) {
    return path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'newmultipartzip.mp4');
  }
  return path.join(resourcesPath, 'assets', 'newmultipartzip.mp4');
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

const getSessionPath = () => {
  return path.join(app.getPath('userData'), 'session.json');
};

// Load session cookie from file (encrypted)
function loadSession() {
  try {
    const sessionPath = getSessionPath();
    if (fs.existsSync(sessionPath)) {
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (data.cookie && data.expiresAt && new Date(data.expiresAt) > new Date()) {
        // Decrypt if encrypted, otherwise use plain (migration)
        if (data.encrypted && safeStorage.isEncryptionAvailable()) {
          const encryptedBuffer = Buffer.from(data.cookie, 'base64');
          sessionCookie = safeStorage.decryptString(encryptedBuffer);
        } else {
          sessionCookie = data.cookie;
        }
        logToFile('Session loaded from file');
        return true;
      }
    }
  } catch (e) {
    logToFile('Failed to load session: ' + e.message);
  }
  return false;
}

// Save session cookie to file (encrypted)
function saveSession(cookie) {
  try {
    const sessionPath = getSessionPath();
    // Session expires in 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    let storedCookie = cookie;
    let encrypted = false;
    
    // Encrypt if available
    if (safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(cookie);
      storedCookie = encryptedBuffer.toString('base64');
      encrypted = true;
    }
    
    fs.writeFileSync(sessionPath, JSON.stringify({ cookie: storedCookie, expiresAt, encrypted }, null, 2));
    sessionCookie = cookie;
    logToFile('Session saved to file (encrypted: ' + encrypted + ')');
  } catch (e) {
    logToFile('Failed to save session: ' + e.message);
  }
}

// Clear session
function clearSession() {
  try {
    const sessionPath = getSessionPath();
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
    sessionCookie = null;
  } catch (e) {
    logToFile('Failed to clear session: ' + e.message);
  }
}

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

// Validate deep link URL
function validateDeepLink(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    // Must start with our protocol
    if (!url.startsWith('armgddn://')) return null;
    
    const parsed = new URL(url);
    
    // Validate protocol
    if (parsed.protocol !== 'armgddn:') return null;
    
    // Whitelist allowed actions
    const allowedHosts = ['download', 'open'];
    if (!allowedHosts.includes(parsed.hostname)) {
      logToFile(`Deep link rejected - invalid host: ${parsed.hostname}`);
      return null;
    }
    
    // Validate manifest parameter if present (should be base64)
    const manifest = parsed.searchParams.get('manifest');
    if (manifest) {
      // Check it's valid base64
      try {
        Buffer.from(manifest, 'base64');
      } catch {
        logToFile('Deep link rejected - invalid manifest encoding');
        return null;
      }
    }
    
    return url;
  } catch (e) {
    logToFile(`Deep link validation error: ${e.message}`);
    return null;
  }
}

// Handle deep link
function handleDeepLink(url) {
  console.log('Deep link received:', url);
  
  // Validate before processing
  const validatedUrl = validateDeepLink(url);
  if (!validatedUrl) {
    logToFile('Deep link rejected: ' + (url ? url.substring(0, 50) : 'null'));
    return;
  }
  
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', validatedUrl);
    mainWindow.show();
    mainWindow.focus();
  }
}

// Open auth window to login and grab session cookie
function openAuthWindow() {
  return new Promise((resolve) => {
    if (authWindow) {
      authWindow.focus();
      return resolve(false);
    }

    authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      parent: mainWindow,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      icon: path.join(__dirname, 'assets', 'icon.png'),
      title: 'Login to ARMGDDN Browser'
    });

    authWindow.loadURL('https://armgddnbrowser.com/');

    // Check for successful login by monitoring cookies
    const checkAuth = async () => {
      try {
        const cookies = await authWindow.webContents.session.cookies.get({ 
          domain: 'armgddnbrowser.com' 
        });
        
        // Look for the session cookie (usually named 'session' or similar)
        const sessionCookieObj = cookies.find(c => 
          c.name === 'tg_auth' || c.name === 'session' || c.name === 'PHPSESSID'
        );
        
        if (sessionCookieObj) {
          // Build cookie string
          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          saveSession(cookieStr);
          logToFile('Auth successful, session cookie saved');
          authWindow.close();
          resolve(true);
        }
      } catch (e) {
        logToFile('Auth check error: ' + e.message);
      }
    };

    // Check auth status when page finishes loading
    authWindow.webContents.on('did-finish-load', () => {
      // Give a moment for cookies to be set
      setTimeout(checkAuth, 1000);
    });

    // Also check on navigation
    authWindow.webContents.on('did-navigate', () => {
      setTimeout(checkAuth, 1000);
    });

    authWindow.on('closed', () => {
      authWindow = null;
      resolve(!!sessionCookie);
    });
  });
}

// Verify session is still valid
async function verifySession() {
  if (!sessionCookie) return false;
  
  return new Promise((resolve) => {
    const makeRequest = (url) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
          'User-Agent': 'ARMGDDN-Downloader/' + app.getVersion(),
          'Authorization': 'Bearer ' + sessionCookie
        },
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            const redirectUrl = location.startsWith('http') ? location : `https://${urlObj.hostname}${location}`;
            return makeRequest(redirectUrl);
          }
        }
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result.authenticated === true);
          } catch (e) {
            resolve(false);
          }
        });
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    };
    
    makeRequest('https://www.armgddnbrowser.com/api/auth-status');
  });
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
      nodeIntegration: false,
      devTools: isOwnerDevToolsAllowed
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize / close behavior (configurable via settings)
  mainWindow.on('minimize', (event) => {
    if (settings && settings.minimizeToTrayOnMinimize) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('close', (event) => {
    // Default behavior: actually close the window / quit the app
    // Only hide to tray when explicitly enabled in settings
    if (!app.isQuitting && settings && settings.minimizeToTrayOnClose) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools automatically only in development builds
  if (!app.isPackaged && isOwnerDevToolsAllowed) {
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
  loadSession();
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

ipcMain.handle('retry-download', async (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (!download) return false;

  if (download.status !== 'error') {
    return false;
  }

  try {
    // Treat retry as "resume remaining files" from disk state.
    // Ensure paused flag is cleared so workers run.
    download.paused = false;
    download.cancelled = false;
    download.status = 'in_progress';
    download.error = '';
    download.failedFiles = [];
    updateProgress(downloadId);

    await resumeDownloadFiles(downloadId);
    return true;
  } catch (e) {
    console.error('Retry download error:', e);
    return false;
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

// Get 7z help video file URL for renderer
ipcMain.handle('get-help-7z-video-src', () => {
  try {
    const filePath = getHelp7zVideoFilePath();
    const fileUrl = pathToFileURL(filePath).toString();
    logToFile('[7z-video] resolved help video URL: ' + fileUrl);
    return fileUrl;
  } catch (e) {
    logToFile('[7z-video] failed to resolve help video URL: ' + e.message);
    throw e;
  }
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
    // Calculate bytes downloaded based on completed bytes plus partial progress
    // of active files, so server-side progress matches the UI.
    let bytesDownloaded = download.downloadedSize || 0;
    const activeFiles = download.activeFiles ? Object.values(download.activeFiles) : [];
    if (Array.isArray(activeFiles) && activeFiles.length > 0) {
      for (const f of activeFiles) {
        if (!f) continue;
        const size = typeof f.size === 'number' ? f.size : 0;
        const p = typeof f.progress === 'number' ? f.progress : 0;
        if (size > 0 && p > 0 && p < 100) {
          bytesDownloaded += Math.round((p / 100) * size);
        }
      }
    }
    if (download.totalSize > 0 && bytesDownloaded > download.totalSize) {
      bytesDownloaded = download.totalSize;
    }
    
    const postData = JSON.stringify({
      downloadId: download.id,
      fileName: download.name,
      remotePath: download.remotePath || '',  // For trending (e.g., "PC1/Game Name")
      bytesDownloaded: bytesDownloaded,
      totalBytes: download.totalSize || 0,
      status: download.status === 'in_progress' ? 'downloading' : download.status,
      error: download.error || null
    });
    
    logToFile(`[Progress] Sending: ${postData.substring(0, 150)}`);
    console.log(`[Progress] Reporting to server: ${download.name} - ${download.status}`);
    debugLog(`Reporting progress: ${postData.substring(0, 100)}...`);
    
    const options = {
      hostname: download.progressHost || 'www.armgddnbrowser.com',
      port: download.progressPort || 443,
      path: download.progressPath || '/api/app-progress',
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
ipcMain.handle('start-download', async (event, manifest, token, manifestUrl) => {
  debugLog(`Download started - Token: ${token ? '[PRESENT]' : '[MISSING]'}`);
  console.log('Received manifest:', JSON.stringify(manifest, null, 2));
  
  // Save/update the token as session for connection status
  // Always update on new download to refresh token if server restarted
  if (token) {
    saveSession(token);
    logToFile('Session token saved/updated from download');
  }
  
  const downloadId = crypto.randomUUID();

  // Default progress reporting target
  let progressHost = 'www.armgddnbrowser.com';
  let progressPort = 443;
  let progressPath = '/api/app-progress';
  try {
    if (typeof manifestUrl === 'string' && manifestUrl) {
      const u = new URL(manifestUrl);
      if (u && u.hostname) {
        progressHost = u.hostname;
        progressPort = u.port ? Number(u.port) : (u.protocol === 'http:' ? 80 : 443);
      }
    }
  } catch (e) {
    // ignore parse failure, fall back to default
  }
  
  // Handle different manifest structures
  let files = [];
  let name = 'Unknown';
  let totalSize = 0;
  let remotePath = '';  // Full path like "PC1/Game Name" for trending
  
  if (manifest.files && Array.isArray(manifest.files)) {
    // Standard format: { files: [...], path: "...", ... }
    files = manifest.files;
    
    // Check if no files were found
    if (files.length === 0) {
      throw new Error('No files found for this game. The game may not be available on any mirror.');
    }
    
    // Store full path for trending (e.g., "PC1/Game Name")
    remotePath = manifest.path || manifest.name || '';
    // Extract folder name from path (e.g., "PC1/Game Name" -> "Game Name")
    name = remotePath.split('/').pop() || 'Download';
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
    remotePath: remotePath,  // Store for trending reporting
    progressHost,
    progressPort,
    progressPath,
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
    cancelled: false,  // Flag to stop new downloads when cancelled
    paused: false,
    failedFiles: [],
    quotaNotified: false
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
    while (fileQueue.length > 0 && !download.cancelled && !download.paused) {
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
  
  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  // Only mark as completed if not cancelled, not paused, and with no failed files
  if (!download.cancelled && !download.paused && !hasErrors) {
    completeDownload(downloadId);
  } else if (hasErrors) {
    // Ensure final progress is sent for partial/error downloads
    updateProgress(downloadId);
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
      const idx = download.activeProcesses.indexOf(proc);
      if (idx !== -1) {
        download.activeProcesses.splice(idx, 1);
      }

      // @ts-ignore
      const stopReason = proc.__armgddnStopReason;

      if (download.cancelled) {
        if (download.activeFiles[file.name]) {
          download.activeFiles[file.name].status = 'cancelled';
          delete download.activeFiles[file.name];
        }
        updateProgress(downloadId);
        resolve();
        return;
      }

      // If this process was intentionally killed due to pause, treat as paused
      // even if the pause flag has already been cleared by a resume.
      if (download.paused || stopReason === 'pause') {
        if (download.activeFiles[file.name]) {
          download.activeFiles[file.name].status = 'paused';
        }
        updateProgress(downloadId);
        resolve();
        return;
      }

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

        if (!Array.isArray(download.failedFiles)) {
          download.failedFiles = [];
        }
        download.failedFiles.push(file.name);
        if (download.activeFiles[file.name]) {
          download.activeFiles[file.name].status = 'error';
        }
        
        // Check for specific error types
        const quota = isQuotaError(errorOutput);
        if (quota) {
          download.error = 'Download quota exceeded. This file is temporarily unavailable due to high demand. Please try again later or try a different game.';
        } else if (isTokenExpiredError(errorOutput)) {
          download.error = 'Download link expired. Please try downloading again from the website.';
        } else {
          download.error = `Download failed (code ${code}). Please try again.`;
        }
        
        updateProgress(downloadId);
        mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
        let shouldShowNotification = true;
        if (quota) {
          if (download.quotaNotified) {
            shouldShowNotification = false;
          } else {
            download.quotaNotified = true;
          }
        }
        if (shouldShowNotification) {
          showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
        }
        reject(new Error(download.error));
      }
    });

    proc.on('error', (err) => {
      download.status = 'error';
      download.error = err.message;
      mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
      showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
      reject(err);
    });
  });
}

// Throttle UI updates per download
const lastUIUpdate = new Map();
const UI_UPDATE_INTERVAL = 500; // Update UI every 500ms max
let lastProgressReport = 0; // Throttle server progress reports

function shouldFinalizeDownload(download) {
  if (!download) return false;
  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  const hasActive = Array.isArray(download.activeProcesses) && download.activeProcesses.length > 0;
  const fileCount = typeof download.fileCount === 'number' ? download.fileCount : 0;
  const completed = typeof download.completedFiles === 'number' ? download.completedFiles : 0;

  const totalSize = typeof download.totalSize === 'number' ? download.totalSize : 0;
  const downloadedSize = typeof download.downloadedSize === 'number' ? download.downloadedSize : 0;
  const isByteComplete = totalSize > 0 && downloadedSize >= totalSize;
  const isFileCountComplete = fileCount > 0 && completed >= fileCount;

  const result = (
    !download.cancelled &&
    !download.paused &&
    !hasErrors &&
    !hasActive &&
    (isByteComplete || isFileCountComplete)
  );

  console.log(`[shouldFinalizeDownload] cancelled=${download.cancelled}, paused=${download.paused}, hasErrors=${hasErrors}, hasActive=${hasActive}, isByteComplete=${isByteComplete}, isFileCountComplete=${isFileCountComplete}, result=${result}`);
  console.log(`[shouldFinalizeDownload] downloadedSize=${downloadedSize}, totalSize=${totalSize}, completedFiles=${completed}, fileCount=${fileCount}`);

  return result;
}

function clampProgressUnlessFinal(download) {
  if (!download) return;
  if (download.progress >= 100 && !shouldFinalizeDownload(download)) {
    download.progress = 99;
  }
}

// Parse rclone progress output
function parseRcloneProgress(downloadId, fileName, output) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  // Get or create file tracking
  const fileInfo = download.activeFiles[fileName];
  if (!fileInfo) return;

  // Parse progress percentage.
  // NOTE: rclone emits many lines that can contain a percentage-like token.
  // We only trust percentages from either:
  // - The aggregate "Transferred:" stats line, or
  // - A line that includes this file's name.
  // Otherwise we can jump 0->100 instantly from unrelated output.
  const lines = String(output).split(/\r?\n/);
  let parsedPercent = null;
  for (const line of lines) {
    if (!line) continue;
    const trimmed = line.trim();

    // Prefer aggregate stats line (works reliably even for copyurl)
    if (trimmed.startsWith('Transferred:')) {
      const m = trimmed.match(/,\s*(\d{1,3})%/);
      if (m) {
        parsedPercent = parseInt(m[1], 10);
        break;
      }
    }

    // Fall back to file-specific line if present
    if (line.includes(fileName)) {
      const m = line.match(/(\d{1,3})%/);
      if (m) {
        parsedPercent = parseInt(m[1], 10);
        break;
      }
    }
  }
  if (typeof parsedPercent === 'number' && Number.isFinite(parsedPercent)) {
    if (parsedPercent < 0) parsedPercent = 0;
    if (parsedPercent > 100) parsedPercent = 100;
    fileInfo.progress = parsedPercent;
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

  // Calculate overall progress based on bytes, not file-count averaging.
  if (download.totalSize > 0) {
    let bytesSoFar = download.downloadedSize || 0;
    for (const f of activeFilesList) {
      if (!f) continue;
      const size = typeof f.size === 'number' ? f.size : 0;
      const p = typeof f.progress === 'number' ? f.progress : 0;
      if (size > 0 && p > 0 && p < 100) {
        bytesSoFar += Math.round((p / 100) * size);
      }
    }
    if (bytesSoFar > download.totalSize) bytesSoFar = download.totalSize;
    download.progress = Math.round((bytesSoFar / download.totalSize) * 100);
  } else {
    // Fallback when totalSize is unknown
    let totalProgress = download.completedFiles * 100;
    for (const f of activeFilesList) {
      totalProgress += f.progress || 0;
    }
    download.progress = Math.round(totalProgress / download.fileCount);
  }

  clampProgressUnlessFinal(download);

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

  if (shouldFinalizeDownload(download)) {
    completeDownload(downloadId);
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
    let bytesSoFar = download.downloadedSize || 0;
    const activeFilesList0 = Object.values(download.activeFiles || {});
    for (const f of activeFilesList0) {
      if (!f) continue;
      const size = typeof f.size === 'number' ? f.size : 0;
      const p = typeof f.progress === 'number' ? f.progress : 0;
      if (size > 0 && p > 0 && p < 100) {
        bytesSoFar += Math.round((p / 100) * size);
      }
    }
    if (bytesSoFar > download.totalSize) bytesSoFar = download.totalSize;
    download.progress = Math.round((bytesSoFar / download.totalSize) * 100);
  }

  clampProgressUnlessFinal(download);

  const activeFilesList = Object.values(download.activeFiles || {});
  let totalSpeedBytes = 0;
  for (const f of activeFilesList) {
    totalSpeedBytes += f.speedBytes || 0;
  }
  download.totalSpeed = formatSpeed(totalSpeedBytes);

  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    status: download.status,
    progress: download.progress,
    downloadedSize: download.downloadedSize,
    totalSpeed: download.totalSpeed,
    activeFiles: activeFilesList,
    completedFiles: download.completedFiles,
    fileCount: download.fileCount
  });
  
  // Report to server every 2 seconds (throttled)
  const now = Date.now();
  if (now - lastProgressReport > 2000) {
    lastProgressReport = now;
    reportProgressToServer(download, download.token);
  }

  if (shouldFinalizeDownload(download)) {
    completeDownload(downloadId);
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

ipcMain.handle('pause-download', (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (!download) return false;

  if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
    return false;
  }

  download.paused = true;
  download.status = 'paused';

  if (download.activeProcesses && download.activeProcesses.length > 0) {
    for (const proc of download.activeProcesses) {
      try {
        // Mark this process as intentionally stopped due to pause.
        // Its close handler may fire after resume (when download.paused is false)
        // and should not be treated as a real error.
        // @ts-ignore
        proc.__armgddnStopReason = 'pause';
        proc.kill('SIGTERM');
      } catch (e) {}
    }
  }

  updateProgress(downloadId);
  return true;
});

async function resumeDownloadFiles(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (!download) {
    throw new Error('Download not found');
  }

  const downloadDir = path.join(settings.downloadPath, download.name || 'Download');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const isFileComplete = (file) => {
    try {
      const outputPath = path.join(downloadDir, file.name);
      if (!fs.existsSync(outputPath)) {
        console.log(`[isFileComplete] ${file.name}: file does not exist`);
        return false;
      }
      const st = fs.statSync(outputPath);
      const expected = typeof file.size === 'number' ? file.size : 0;
      if (expected > 0) {
        const result = (st.size || 0) >= expected;
        console.log(`[isFileComplete] ${file.name}: size=${st.size}, expected=${expected}, complete=${result}`);
        return result;
      }
      // If size unknown, do NOT assume partial files are complete.
      console.log(`[isFileComplete] ${file.name}: expected size unknown, returning false`);
      return false;
    } catch (e) {
      console.log(`[isFileComplete] ${file.name}: error - ${e.message}`);
      return false;
    }
  };

  // Figure out what still needs to be downloaded.
  const allFiles = Array.isArray(download.files) ? download.files : [];
  const remainingFiles = allFiles.filter(f => f && f.name && !isFileComplete(f));

  // Reset state
  download.paused = false;
  download.status = 'in_progress';
  download.cancelled = false;
  download.error = '';
  download.quotaNotified = false;
  download.failedFiles = [];
  download.activeFiles = {};
  download.activeProcesses = [];

  // Recompute downloaded/completed counts based on disk.
  let completedFiles = 0;
  let downloadedSize = 0;
  for (const f of allFiles) {
    if (!f || !f.name) continue;
    if (!isFileComplete(f)) continue;
    completedFiles++;
    downloadedSize += (typeof f.size === 'number' ? f.size : 0);
  }
  download.completedFiles = completedFiles;
  download.downloadedSize = downloadedSize;

  console.log(`[Resume] remainingFiles.length: ${remainingFiles.length}, allFiles.length: ${allFiles.length}`);
  console.log(`[Resume] completedFiles: ${download.completedFiles}, downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}`);

  // Nothing left to do - complete immediately without going through updateProgress
  // to avoid race conditions with shouldFinalizeDownload.
  if (remainingFiles.length === 0) {
    console.log(`[Resume] No remaining files - calling completeDownload directly`);
    completeDownload(downloadId);
    return;
  }

  // Notify UI that we're resuming (but don't check finalization yet since we have files to download)
  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    status: download.status,
    progress: download.progress,
    downloadedSize: download.downloadedSize,
    totalSpeed: download.totalSpeed,
    activeFiles: [],
    completedFiles: download.completedFiles,
    fileCount: download.fileCount
  });

  const PARALLEL_DOWNLOADS = 6;
  const fileQueue = [...remainingFiles];
  const activePromises = [];

  const processNext = async () => {
    while (fileQueue.length > 0 && !download.cancelled && !download.paused) {
      const file = fileQueue.shift();
      if (!file) break;
      try {
        await downloadFile(downloadId, file, downloadDir);
      } catch (err) {
        if (!download.cancelled) {
          console.error('File download error (resume):', err);
        }
      }
    }
  };

  for (let i = 0; i < Math.min(PARALLEL_DOWNLOADS, remainingFiles.length); i++) {
    activePromises.push(processNext());
  }

  await Promise.all(activePromises);

  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  console.log(`[Resume] After Promise.all - cancelled: ${download.cancelled}, paused: ${download.paused}, hasErrors: ${hasErrors}, failedFiles: ${JSON.stringify(download.failedFiles)}`);
  console.log(`[Resume] downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}, completedFiles: ${download.completedFiles}, fileCount: ${download.fileCount}`);
  if (!download.cancelled && !download.paused && !hasErrors) {
    console.log(`[Resume] Calling completeDownload for ${downloadId}`);
    completeDownload(downloadId);
  } else {
    console.log(`[Resume] NOT completing - updating progress instead`);
    updateProgress(downloadId);
  }
}

ipcMain.handle('resume-download', async (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (!download) return false;

  if (!download.paused) {
    return false;
  }

  try {
    await resumeDownloadFiles(downloadId);
    return true;
  } catch (e) {
    console.error('Resume download error:', e);
    return false;
  }
});

// Complete download
function completeDownload(downloadId) {
  console.log(`[completeDownload] Called for ${downloadId}`);
  const download = activeDownloads.get(downloadId);
  if (!download) {
    console.log(`[completeDownload] Download not found in activeDownloads!`);
    return;
  }

  // Guard against double-completion
  if (download.status === 'completed') {
    console.log(`[completeDownload] Already completed, skipping`);
    return;
  }

  console.log(`[completeDownload] Setting status to completed and sending event`);
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

  if (mainWindow && mainWindow.webContents) {
    console.log(`[completeDownload] Sending download-completed event to renderer`);
    mainWindow.webContents.send('download-completed', { id: downloadId });
  } else {
    console.log(`[completeDownload] ERROR: mainWindow or webContents is null!`);
  }
  showDownloadNotification('Download completed', download.name || 'Download finished');
  activeDownloads.delete(downloadId);
  console.log(`[completeDownload] Done, download removed from activeDownloads`);
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

// Check connection to server (verifies session is valid)
ipcMain.handle('check-connection', async () => {
  return verifySession();
});

// Open login window
ipcMain.handle('open-login', async () => {
  return openAuthWindow();
});

// Get session status
ipcMain.handle('get-session-status', async () => {
  return {
    hasSession: !!sessionCookie,
    isValid: await verifySession()
  };
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
          
          // Find the appropriate installer asset
          let installerUrl = null;
          const assets = release.assets || [];
          const platform = process.platform;
          
          if (platform === 'win32') {
            // Look for .exe installer
            const exeAsset = assets.find(a => a.name.endsWith('.exe'));
            if (exeAsset) installerUrl = exeAsset.browser_download_url;
          } else if (platform === 'linux') {
            // Look for .AppImage or .deb
            const appImageAsset = assets.find(a => a.name.endsWith('.AppImage'));
            const debAsset = assets.find(a => a.name.endsWith('.deb'));
            if (appImageAsset) installerUrl = appImageAsset.browser_download_url;
            else if (debAsset) installerUrl = debAsset.browser_download_url;
          } else if (platform === 'darwin') {
            // Look for .dmg
            const dmgAsset = assets.find(a => a.name.endsWith('.dmg'));
            if (dmgAsset) installerUrl = dmgAsset.browser_download_url;
          }
          
          resolve({
            hasUpdate,
            version: currentVersion,
            latestVersion,
            releaseUrl: release.html_url || 'https://github.com/Nildyanna/armgddn-downloader/releases',
            installerUrl,
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

// Download and install update
ipcMain.handle('install-update', async (event, installerUrl) => {
  if (!installerUrl) {
    return { success: false, error: 'No installer URL provided' };
  }
  
  const tempDir = app.getPath('temp');
  const platform = process.platform;
  const timestamp = Date.now();
  let fileName;
  
  if (platform === 'win32') {
    // Use unique filename to avoid EBUSY errors
    fileName = `ARMGDDN-Downloader-Setup-${timestamp}.exe`;
  } else if (platform === 'linux') {
    fileName = installerUrl.endsWith('.deb') 
      ? `armgddn-downloader-${timestamp}.deb` 
      : `ARMGDDN-Downloader-${timestamp}.AppImage`;
  } else {
    fileName = `ARMGDDN-Downloader-${timestamp}.dmg`;
  }
  
  const filePath = path.join(tempDir, fileName);
  
  return new Promise((resolve) => {
    // Download the installer
    const downloadInstaller = (url) => {
      const protocol = url.startsWith('https') ? https : require('http');
      
      protocol.get(url, { headers: { 'User-Agent': 'ARMGDDN-Downloader' } }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          return downloadInstaller(res.headers.location);
        }
        
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `Download failed with status ${res.statusCode}` });
          return;
        }
        
        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close(() => {
            // Run the installer after app exits
            try {
              if (platform === 'win32') {
                // Log paths for debugging
                logToFile(`Update - tempDir: ${tempDir}`);
                logToFile(`Update - filePath: ${filePath}`);
                logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);

                // Spawn the installer as a detached process so it keeps running
                // after this Electron app exits.
                try {
                  const child = spawn(filePath, [], {
                    detached: true,
                    stdio: 'ignore'
                  });
                  child.unref();
                  logToFile('Update - spawned installer process successfully');
                } catch (spawnErr) {
                  logToFile(`Update - failed to spawn installer: ${spawnErr && spawnErr.message ? spawnErr.message : spawnErr}`);
                  resolve({ success: false, error: 'Failed to launch installer process' });
                  return;
                }

                // Immediately mark app as quitting and exit, so the installer
                // can safely replace files without the app still running.
                setTimeout(() => {
                  app.isQuitting = true;
                  app.quit();
                }, 500);

                resolve({ success: true });
                return;
              } else if (platform === 'linux') {
                logToFile(`Update - filePath: ${filePath}`);
                logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);
                
                if (filePath.endsWith('.AppImage')) {
                  // Make executable and run directly
                  fs.chmodSync(filePath, '755');
                  logToFile('Update - launching AppImage');
                  
                  spawn(filePath, [], {
                    detached: true,
                    stdio: 'ignore'
                  }).unref();
                  
                  setTimeout(() => {
                    app.isQuitting = true;
                    app.quit();
                  }, 1000);
                  
                  resolve({ success: true });
                  return;
                } else {
                  // For .deb, open file manager or show location
                  shell.showItemInFolder(filePath);
                  resolve({ success: true, message: 'Installer downloaded. Please install manually.' });
                  return;
                }
              } else {
                // macOS - open the DMG
                shell.openPath(filePath);
                resolve({ success: true, message: 'Installer opened. Please complete installation.' });
                return;
              }
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          });
        });
        
        fileStream.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    };
    
    downloadInstaller(installerUrl);
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
