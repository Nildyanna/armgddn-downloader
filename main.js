const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');

// Set app name for dialogs and window titles
app.name = 'ARMGDDN Companion';

if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  try {
    app.setAppUserModelId('com.armgddn.downloader');
  } catch (e) {}
}

// Handle deep links
let protocolClientRegistered = false;
let protocolClientRegisterError = '';
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    try {
      protocolClientRegistered = app.setAsDefaultProtocolClient('armgddn', process.execPath, [path.resolve(process.argv[1])]);
    } catch (e) {
      protocolClientRegistered = false;
      protocolClientRegisterError = e && e.message ? e.message : String(e);
    }
  }
} else {
  try {
    protocolClientRegistered = app.setAsDefaultProtocolClient('armgddn');
  } catch (e) {
    protocolClientRegistered = false;
    protocolClientRegisterError = e && e.message ? e.message : String(e);
  }
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
let sessionToken = null;

const ALLOWED_SERVICE_HOSTS = new Set([
  'armgddnbrowser.com',
  'www.armgddnbrowser.com'
]);

const ALLOWED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
]);

function isAllowedServiceHost(hostname) {
  return !!hostname && ALLOWED_SERVICE_HOSTS.has(String(hostname).toLowerCase());
}

function isAllowedUpdateHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (ALLOWED_UPDATE_HOSTS.has(h)) return true;
  if (/^github-production-release-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(h)) return true;
  return false;
}

function sanitizeRelativePath(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') return null;
  if (input.includes('\0')) return null;
  let cleaned = input.replace(/\\/g, '/');

  // Some archives contain Windows drive-prefixed paths (e.g. "C:Games/file") or
  // leading slashes ("/Games/file"). Treat these as "anchored" paths and
  // normalize them back into a relative path rooted at the extraction directory.
  if (/^[a-zA-Z]:/.test(cleaned)) {
    cleaned = cleaned.slice(2);
  }
  cleaned = cleaned.replace(/^\/+/, '');

  // If it is still absolute after normalization rules, reject.
  if (path.isAbsolute(cleaned)) return null;

  const normalized = path.posix.normalize(cleaned);
  if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) return null;
  if (normalized.startsWith('/')) return null;

  // 7z listings can include "Path = ." for the root entry.
  if (normalized === '.' || normalized === './') return '';

  return normalized;
}

function resolveInside(baseDir, relPath) {
  const full = path.resolve(baseDir, relPath);
  const base = path.resolve(baseDir);
  if (full === base) return full;
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

function fetchJsonWithCookies(urlString, method, cookieHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') {
      reject(new Error('Security error: HTTPS required'));
      return;
    }
    if (!isAllowedServiceHost(u.hostname)) {
      reject(new Error('Security error: Host not allowed'));
      return;
    }
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: method,
      headers: {
        'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(),
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        'Accept': 'application/json'
      },
      timeout: 7000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 0, json: JSON.parse(data), text: data });
        } catch (e) {
          resolve({ statusCode: res.statusCode || 0, json: null, text: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function mintAppSessionTokenFromCookies(cookieHeader) {
  const { statusCode, json, text } = await fetchJsonWithCookies('https://www.armgddnbrowser.com/api/generate-app-token', 'POST', cookieHeader);
  if (statusCode !== 200 || !json || json.success !== true || !json.token) {
    const msg = (json && (json.error || json.message)) ? (json.error || json.message) : 'Failed to mint app token';
    const snippet = (text && typeof text === 'string') ? text.slice(0, 300) : '';
    throw new Error(`${msg} (HTTP ${statusCode})${snippet ? `: ${snippet}` : ''}`);
  }
  return String(json.token);
}

const DEBUG_LOGGING = process.env.ARMGDDN_DEBUG === '1';

let settings = {
  downloadPath: path.join(app.getPath('downloads'), 'ARMGDDN'),
  maxConcurrentDownloads: 3,
  maxDownloadSpeedMBps: 0,
  autoExtract7z: false,
  showNotifications: true,
  minimizeToTrayOnMinimize: false,
  minimizeToTrayOnClose: false,
  autoUpdate: false,
  startWithOsStartup: false
};

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function applyStartupRegistration() {
  try {
    const enabled = !!(settings && settings.startWithOsStartup);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: []
        });
      } catch (e) {
        logToFile(`[Startup] setLoginItemSettings failed: ${e && e.message ? e.message : e}`);
      }
      return;
    }

    if (process.platform === 'linux') {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopPath = path.join(autostartDir, 'armgddn-companion.desktop');

      if (!enabled) {
        try {
          if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
        } catch (e) {}
        return;
      }

      fs.mkdirSync(autostartDir, { recursive: true });
      const execPath = process.execPath;
      const content = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=ARMGDDN Companion',
        `Exec=${execPath}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true'
      ].join('\n') + '\n';

      let existing = '';
      try { existing = fs.readFileSync(desktopPath, 'utf8'); } catch (e) {}
      if (existing !== content) {
        fs.writeFileSync(desktopPath, content, 'utf8');
        try { fs.chmodSync(desktopPath, 0o644); } catch (e) {}
      }
    }
  } catch (e) {
    logToFile(`[Startup] applyStartupRegistration failed: ${e && e.message ? e.message : e}`);
  }
}

 function normalizeSettings() {
   try {
     if (!settings || typeof settings !== 'object') return;

     if (typeof settings.downloadPath !== 'string') {
       settings.downloadPath = path.join(app.getPath('downloads'), 'ARMGDDN');
     }

     const maxConc = parseInt(String(settings.maxConcurrentDownloads), 10);
     settings.maxConcurrentDownloads = Number.isFinite(maxConc) && maxConc > 0 ? maxConc : 3;

     const speed = Number(settings.maxDownloadSpeedMBps);
     settings.maxDownloadSpeedMBps = Number.isFinite(speed) && speed > 0 ? Math.round(speed) : 0;

     settings.autoExtract7z = !!settings.autoExtract7z;
     settings.showNotifications = settings.showNotifications !== false;
     settings.minimizeToTrayOnMinimize = !!settings.minimizeToTrayOnMinimize;
     settings.minimizeToTrayOnClose = !!settings.minimizeToTrayOnClose;

     settings.autoUpdate = !!settings.autoUpdate;
     settings.startWithOsStartup = !!settings.startWithOsStartup;
   } catch (e) {
     logToFile(`[Settings] normalizeSettings failed: ${e && e.message ? e.message : e}`);
   }
 }

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

function ensureLinuxProtocolDesktopHandler() {
  try {
    if (process.platform !== 'linux') return;

    const desktopFileName = 'armgddn-downloader.desktop';
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const appsDir = path.join(dataHome, 'applications');
    fs.mkdirSync(appsDir, { recursive: true });

    const desktopPath = path.join(appsDir, desktopFileName);
    const execPath = process.execPath;
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ARMGDDN Companion',
      `Exec=${execPath} %u`,
      'Terminal=false',
      'NoDisplay=true',
      'MimeType=x-scheme-handler/armgddn;',
      'Categories=Utility;'
    ].join('\n') + '\n';

    let existing = '';
    try {
      existing = fs.readFileSync(desktopPath, 'utf8');
    } catch (e) {}
    if (existing !== content) {
      fs.writeFileSync(desktopPath, content, 'utf8');
      try { fs.chmodSync(desktopPath, 0o644); } catch (e) {}
    }

    const tryCmd = (cmd, args) => {
      try {
        const res = spawnSync(cmd, args, { encoding: 'utf8' });
        const ok = res && typeof res.status === 'number' ? res.status === 0 : false;
        const out = (res && res.stdout) ? String(res.stdout).trim() : '';
        const err = (res && res.stderr) ? String(res.stderr).trim() : '';
        return { ok, out, err, status: res ? res.status : null };
      } catch (e) {
        return { ok: false, out: '', err: e && e.message ? e.message : String(e), status: null };
      }
    };

    let registered = false;

    const gioRes = tryCmd('gio', ['mime', 'x-scheme-handler/armgddn', desktopFileName]);
    if (gioRes.ok) {
      registered = true;
    } else {
      const xdgMimeRes = tryCmd('xdg-mime', ['default', desktopFileName, 'x-scheme-handler/armgddn']);
      if (xdgMimeRes.ok) {
        registered = true;
      } else {
        const xdgSettingsRes = tryCmd('xdg-settings', ['set', 'default-url-scheme-handler', 'armgddn', desktopFileName]);
        if (xdgSettingsRes.ok) {
          registered = true;
        }
      }
    }

    logToFile(`[Protocol][linux] desktop=${desktopPath} exec=${execPath} registered=${registered}`);
    if (!registered) {
      logToFile(`[Protocol][linux] gio mime: ok=${gioRes.ok} status=${gioRes.status} err=${gioRes.err}`);
    }
  } catch (e) {
    logToFile(`[Protocol][linux] ensure handler failed: ${e && e.message ? e.message : e}`);
  }
}

// Debug log file for troubleshooting
let cachedDebugLogPath = null;
function getDebugLogPath() {
  if (cachedDebugLogPath) return cachedDebugLogPath;
  try {
    const userData = app.getPath('userData');
    cachedDebugLogPath = path.join(userData, 'debug.log');
    return cachedDebugLogPath;
  } catch (e) {
    // app.getPath('userData') can fail before the app is ready in some packaged environments.
    // Fall back to a best-effort location.
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const legacyPath = path.join(appData, 'ARMGDDN Downloader', 'debug.log');
    const newPath = path.join(appData, 'ARMGDDN Companion', 'debug.log');
    cachedDebugLogPath = fs.existsSync(path.dirname(legacyPath)) ? legacyPath : newPath;
    return cachedDebugLogPath;
  }
}
function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logPath = getDebugLogPath();
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (e) {
    try {
      // Last-resort fallback to temp directory
      const fallbackPath = path.join(os.tmpdir(), 'armgddn-downloader-debug.log');
      fs.appendFileSync(fallbackPath, `[${new Date().toISOString()}] [logToFile fallback] ${message} (original error: ${e && e.message ? e.message : e})\n`);
    } catch (e2) {}
  }
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

const get7zPath = () => {
  const platform = process.platform;
  const arch = process.arch;

  if (app.isPackaged) {
    const resourcePath = getResourcePath();
    if (platform === 'win32') {
      const winArch = arch === 'arm64' ? 'arm64' : (arch === 'ia32' ? 'ia32' : 'x64');
      return path.join(resourcePath, '7z', 'win', winArch, '7za.exe');
    }
    if (platform === 'darwin') {
      const macArch = arch === 'arm64' ? 'arm64' : 'x64';
      return path.join(resourcePath, '7z', 'mac', macArch, '7za');
    }
    const linuxArch = arch === 'arm64' ? 'arm64' : (arch === 'arm' ? 'arm' : (arch === 'ia32' ? 'ia32' : 'x64'));
    return path.join(resourcePath, '7z', 'linux', linuxArch, '7za');
  }

  try {
    const sevenZipBin = require('7zip-bin');
    if (sevenZipBin && sevenZipBin.path7za) {
      return sevenZipBin.path7za;
    }
  } catch (e) {}

  return null;
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
      if (data.token && data.expiresAt && new Date(data.expiresAt) > new Date()) {
        // Decrypt if encrypted, otherwise use plain (migration)
        if (data.encrypted && safeStorage.isEncryptionAvailable()) {
          const encryptedBuffer = Buffer.from(data.token, 'base64');
          sessionToken = safeStorage.decryptString(encryptedBuffer);
        } else {
          sessionToken = data.token;
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

// Save app session token to file (encrypted)
function saveSession(token) {
  try {
    const sessionPath = getSessionPath();
    // Session expires in 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    let storedToken = token;
    let encrypted = false;
    
    // Encrypt if available
    if (safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(token);
      storedToken = encryptedBuffer.toString('base64');
      encrypted = true;
    }
    
    fs.writeFileSync(sessionPath, JSON.stringify({ token: storedToken, expiresAt, encrypted }, null, 2));
    sessionToken = token;
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
    sessionToken = null;
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
    normalizeSettings();
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
    } else {
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
    
    // Validate manifest parameter if present (URL or base64-encoded URL)
    const manifest = parsed.searchParams.get('manifest');
    if (manifest) {
      let manifestStr = manifest;
      // Attempt base64 decode; if it becomes a plausible https URL, accept that.
      try {
        const decoded = Buffer.from(manifest, 'base64').toString('utf8');
        if (decoded && typeof decoded === 'string' && decoded.startsWith('https://')) {
          manifestStr = decoded;
        }
      } catch (e) {}

      try {
        const u = new URL(manifestStr);
        if (u.protocol !== 'https:') {
          logToFile('Deep link rejected - manifest not https');
          return null;
        }
        if (!ALLOWED_SERVICE_HOSTS.has(u.hostname)) {
          logToFile('Deep link rejected - manifest host not allowed: ' + u.hostname);
          return null;
        }
      } catch (e) {
        logToFile('Deep link rejected - invalid manifest URL');
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

    // Check for successful login by monitoring cookies and minting an app session token
    const checkAuth = async () => {
      try {
        const cookies = await authWindow.webContents.session.cookies.get({ name: 'ag_auth' });

        const agAuthCookie = cookies.find((c) => {
          const domain = String(c && c.domain ? c.domain : '').toLowerCase();
          const hasValue = !!(c && c.value);
          return hasValue && (domain === 'armgddnbrowser.com' || domain === '.armgddnbrowser.com' || domain === 'www.armgddnbrowser.com');
        });
        if (agAuthCookie) {
          const allCookies = await authWindow.webContents.session.cookies.get({});
          const cookieStr = (allCookies || [])
            .filter((c) => {
              const domain = String(c && c.domain ? c.domain : '').toLowerCase();
              return (domain === 'armgddnbrowser.com' || domain === '.armgddnbrowser.com' || domain === 'www.armgddnbrowser.com');
            })
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');

          try {
            const token = await mintAppSessionTokenFromCookies(cookieStr);
            saveSession(token);
            logToFile('Auth successful, app session token saved');
            authWindow.close();
            resolve(true);
          } catch (e) {
            logToFile('Token mint error: ' + (e && e.message ? e.message : String(e)));
          }
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
      resolve(!!sessionToken);
    });
  });
}

// Verify session is still valid
async function verifySession() {
  if (!sessionToken) return false;
  
  return new Promise((resolve) => {
    const makeRequest = (url) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
          'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(),
          'Authorization': 'Bearer ' + sessionToken
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
        res.on('data', (chunk) => data += chunk);
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
    { label: 'Open Log Folder', click: () => {
      try {
        const folder = path.dirname(getDebugLogPath());
        shell.openPath(folder);
      } catch (e) {}
    } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('ARMGDDN Companion');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

 function createAppMenu() {
   const template = [
     ...(process.platform === 'darwin'
       ? [
           {
             label: app.name,
             submenu: [
               { role: 'about' },
               { type: 'separator' },
               { role: 'services' },
               { type: 'separator' },
               { role: 'hide' },
               { role: 'hideOthers' },
               { role: 'unhide' },
               { type: 'separator' },
               { role: 'quit' }
             ]
           }
         ]
       : []),
     {
       label: 'File',
       submenu: [
         ...(process.platform === 'darwin' ? [{ role: 'close' }] : [{ role: 'quit' }])
       ]
     },
     {
       label: 'View',
       submenu: [
         { role: 'reload' },
         { role: 'forceReload' },
         { type: 'separator' },
         { role: 'resetZoom' },
         { role: 'zoomIn' },
         { role: 'zoomOut' },
         { type: 'separator' },
         { role: 'togglefullscreen' }
       ]
     },
     {
       role: 'help',
       submenu: [
         {
           label: 'Telegram',
           click: async () => {
             await shell.openExternal('https://t.me/ARMGDDNGames');
           }
         }
       ]
     }
   ];

   const menu = Menu.buildFromTemplate(template);
   Menu.setApplicationMenu(menu);
 }

// App ready
app.whenReady().then(() => {
  logToFile(`[Startup] debug.log path: ${getDebugLogPath()}`);
  logToFile(`[Protocol] setAsDefaultProtocolClient ok=${protocolClientRegistered}${protocolClientRegisterError ? ` err=${protocolClientRegisterError}` : ''}`);
  loadSettings();
  applyStartupRegistration();
  loadHistory();
  loadSession();
  createWindow();
  createTray();
  createAppMenu();

  ensureLinuxProtocolDesktopHandler();

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
  normalizeSettings();
  applyStartupRegistration();
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
    const parsedUrl = new URL(manifestUrl);
    
    // Security: Enforce HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('Security error: Only HTTPS connections are allowed'));
      return;
    }

    if (!isAllowedServiceHost(parsedUrl.hostname)) {
      reject(new Error('Security error: Host not allowed'));
      return;
    }
    
    // Parse query params using decodeURIComponent (preserves + as literal +)
    const queryString = parsedUrl.search.substring(1);
    const params = {};
    for (const pair of queryString.split('&')) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        const key = decodeURIComponent(pair.substring(0, eqIndex));
        const value = decodeURIComponent(pair.substring(eqIndex + 1));
        params[key] = value;
      }
    }
    
    const remote = params.remote;
    const pathParam = params.path;
    
    if (!remote || !pathParam) {
      const errorMsg = `Missing remote or path. Query="${queryString}", Params=${JSON.stringify(params)}, remote="${remote}", path="${pathParam}"`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }
    
    const postData = JSON.stringify({ remote, path: pathParam });
    
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
    
    const req = https.request(options, (res) => {
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          
          // Handle game moved to new location (server returns 302 with redirect info)
          if (json.redirect && json.newRemote && json.newPath) {
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
  if (!DEBUG_LOGGING) return;
  const logPath = path.join(app.getPath('userData'), 'debug.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logPath, logLine);
}

// Report progress to website server
async function reportProgressToServer(download, token) {
  logToFile(`reportProgressToServer called - token: ${token ? 'present' : 'MISSING'}, download: ${download?.name}`);
  
  if (!token) {
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

    // IMPORTANT: Keep server-side progress consistent with the UI clamp.
    // The website derives percent from bytesDownloaded/totalBytes; if we report 100% bytes
    // while the download is still 'downloading'/'paused' (e.g. waiting on process close or
    // post-processing), the website can show 100% but still "In Progress".
    // Only allow bytesDownloaded==totalBytes when the download is truly finalized.
    const totalBytes = download.totalSize || 0;
    const isFinal = (download.status === 'completed') || shouldFinalizeDownload(download);
    if (!isFinal && totalBytes > 0 && bytesDownloaded >= totalBytes) {
      const step = Math.max(1, Math.floor(totalBytes / 100)); // subtract ~1% so Math.round() won't hit 100
      bytesDownloaded = Math.max(0, totalBytes - step);
    }
    
    const postData = JSON.stringify({
      downloadId: download.id,
      fileName: download.name,
      remotePath: download.remotePath || '',  // For trending (e.g., "PC1/Game Name")
      bytesDownloaded: bytesDownloaded,
      totalBytes: totalBytes,
      status: download.status === 'in_progress' ? 'downloading' : download.status,
      error: download.error || null
    });
    
    logToFile(`[Progress] Sending: ${postData.substring(0, 150)}`);
    debugLog(`Reporting progress: ${postData.substring(0, 100)}...`);
    
    const targetHost = download.progressHost || 'www.armgddnbrowser.com';
    if (!isAllowedServiceHost(targetHost)) {
      logToFile(`[Progress] Blocked progress host: ${targetHost}`);
      return;
    }

    const options = {
      hostname: targetHost,
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
        debugLog(`Progress response: ${res.statusCode} ${responseData}`);
      });
    });
    
    req.on('error', (err) => {
      logToFile(`[Progress] Request error: ${err.message}`);
      debugLog(`Progress report error: ${err.message}`);
    });
    
    req.write(postData);
    req.end();
    logToFile(`[Progress] Request sent`);
  } catch (err) {
    logToFile(`[Progress] Exception: ${err.message} - ${err.stack}`);
    console.error('[Progress] Stack:', err.stack);
    debugLog(`Progress report exception: ${err.message}`);
  }
}

// Start download
ipcMain.handle('start-download', async (event, manifest, token, manifestUrl) => {
  debugLog(`Download started - Token: ${token ? '[PRESENT]' : '[MISSING]'}`);
  
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
        if (isAllowedServiceHost(u.hostname)) {
          progressHost = u.hostname;
        }
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

  const safeFolderName = sanitizeRelativePath(String(name || ''));
  if (safeFolderName) {
    name = safeFolderName;
  } else {
    name = 'Download';
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
  const downloadDir = resolveInside(settings.downloadPath, name);
  if (!downloadDir) {
    throw new Error('Security error: Invalid download folder path');
  }
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

  // Download files in parallel (controlled by user setting)
  const requestedParallel = Number(settings && settings.maxConcurrentDownloads);
  const PARALLEL_DOWNLOADS = Math.min(6, Math.max(1, Number.isFinite(requestedParallel) ? requestedParallel : 3));
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
  // Strong upstream quota signals (Google Drive / provider throttling)
  const strongTokens = [
    'downloadquotaexceeded',
    'download quota exceeded',
    'too many users have viewed or downloaded this file',
    'exceeded your current quota',
    'bandwidth limit exceeded',
    'download limit exceeded',
    'suspicious activity',
    'suspicious downloads detected'
  ];

  for (const t of strongTokens) {
    if (lowerOutput.includes(t)) return true;
  }

  // Weak tokens can appear in unrelated errors. Only treat as quota if
  // there's evidence it's coming from the upstream provider.
  const weakTokens = [
    'quota exceeded',
    'rate limit exceeded',
    'user rate limit exceeded'
  ];

  const mentionsProvider = lowerOutput.includes('google') || lowerOutput.includes('drive') || lowerOutput.includes('gdrive');
  const mentionsHttpQuota = lowerOutput.includes(' 403') || lowerOutput.includes(' 429') || lowerOutput.includes('status code 403') || lowerOutput.includes('status code 429');

  for (const t of weakTokens) {
    if (lowerOutput.includes(t) && (mentionsProvider || mentionsHttpQuota)) return true;
  }

  return false;
}

// Check if output indicates our server is busy / concurrency-limited
function isServerBusyError(output) {
  const lowerOutput = output.toLowerCase();
  return lowerOutput.includes('too many active downloads') ||
         lowerOutput.includes('download rejected due to concurrency') ||
         lowerOutput.includes('global concurrency') ||
         lowerOutput.includes('please try again shortly');
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
    const safeRel = sanitizeRelativePath(file.name);
    if (!safeRel) {
      reject(new Error('Security error: Invalid file name'));
      return;
    }
    const outputPath = resolveInside(downloadDir, safeRel);
    if (!outputPath) {
      reject(new Error('Security error: Invalid file path'));
      return;
    }

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
      '--contimeout', '30s',           // Connection timeout
      '--timeout', '300s',             // Overall timeout
      '--low-level-retries', '3',      // Retry on low-level errors
      '--drive-acknowledge-abuse'      // Bypass Google Drive virus scan warnings
    ];

    const maxMb = Number(settings && settings.maxDownloadSpeedMBps);
    if (Number.isFinite(maxMb) && maxMb > 0) {
      const workersSetting = Number(settings && settings.maxConcurrentDownloads);
      const workers = Math.min(6, Math.max(1, Number.isFinite(workersSetting) ? workersSetting : 3));
      const perWorker = maxMb / workers;
      const perWorkerStr = Number.isFinite(perWorker) && perWorker > 0 ? perWorker.toFixed(1).replace(/\.0$/, '') : '';
      if (perWorkerStr) {
        args.push('--bwlimit', `${perWorkerStr}M`);
      }
    }

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
        const busy = isServerBusyError(errorOutput);
        if (busy) {
          download.error = 'Server is busy due to high demand. Please wait a moment and try again.';
        } else if (quota) {
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

function pruneActiveProcesses(download) {
  if (!download || !Array.isArray(download.activeProcesses)) return;
  download.activeProcesses = download.activeProcesses.filter((p) => {
    if (!p) return false;
    // ChildProcess.exitCode is null while running.
    if (p.exitCode === null) return true;
    return false;
  });
}

// Periodically re-check downloads to ensure completion isn't missed when rclone
// stops emitting progress lines near the end.
setInterval(() => {
  try {
    for (const [id, download] of activeDownloads.entries()) {
      if (!download) continue;
      if (download.status !== 'in_progress' && download.status !== 'downloading' && download.status !== 'starting') continue;

      pruneActiveProcesses(download);

      clampProgressUnlessFinal(download);

      const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
      const hasActive = Array.isArray(download.activeProcesses) && download.activeProcesses.length > 0;
      const isHardComplete = !!(
        !download.cancelled &&
        !download.paused &&
        !hasErrors &&
        !hasActive &&
        typeof download.progress === 'number' &&
        download.progress >= 100
      );

      if (isHardComplete) {
        completeDownload(id);
        continue;
      }

      if (shouldFinalizeDownload(download)) {
        completeDownload(id);
      } else {
        if (download.progress >= 100) {
          download.progress = 99;
          try {
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('download-progress', {
                id,
                status: download.status,
                progress: download.progress,
                downloadedSize: download.downloadedSize,
                totalSpeed: download.totalSpeed,
                activeFiles: Object.values(download.activeFiles || {}),
                completedFiles: download.completedFiles,
                fileCount: download.fileCount
              });
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
}, 2000);

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

  logToFile(`[shouldFinalizeDownload] cancelled=${download.cancelled}, paused=${download.paused}, hasErrors=${hasErrors}, hasActive=${hasActive}, isByteComplete=${isByteComplete}, isFileCountComplete=${isFileCountComplete}, result=${result}`);
  logToFile(`[shouldFinalizeDownload] downloadedSize=${downloadedSize}, totalSize=${totalSize}, completedFiles=${completed}, fileCount=${fileCount}`);

  return result;
}

function clampProgressUnlessFinal(download) {
  if (!download) return;
  if (download.progress >= 100 && !shouldFinalizeDownload(download)) {
    download.progress = 99;
  }
}

function find7zArchivesInDir(rootDir) {
  const results = [];
  const seen = new Set();

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      if (!ent) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = String(ent.name || '').toLowerCase();
      if (lower.endsWith('.7z.001')) {
        const base = lower.slice(0, -('.001'.length));
        if (!seen.has(full)) {
          results.push(full);
          seen.add(full);
        }
        seen.add(path.join(dir, base));
        continue;
      }
      if (lower.endsWith('.7z')) {
        if (seen.has(full)) continue;
        results.push(full);
        seen.add(full);
      }
    }
  };

  walk(rootDir);
  return results;
}

function run7zExtract(archivePath, outputDir) {
  return new Promise((resolve, reject) => {
    const exe = get7zPath();
    if (!exe) {
      reject(new Error('7z extraction tool not found'));
      return;
    }

    const listArgs = ['l', '-slt', archivePath];
    try {
      const listResult = spawnSync(exe, listArgs, { encoding: 'utf8' });
      if (listResult && listResult.status === 0) {
        const stdout = String(listResult.stdout || '');
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith('Path = ')) continue;
          const entryPath = line.slice('Path = '.length).trim();
          if (!entryPath) continue;
          const safeRel = sanitizeRelativePath(entryPath);
          if (!safeRel) {
            reject(new Error('Unsafe archive entry path detected'));
            return;
          }
          const resolved = resolveInside(outputDir, safeRel);
          if (!resolved) {
            reject(new Error('Unsafe archive entry path detected'));
            return;
          }
        }
      } else {
        reject(new Error('Failed to validate archive contents before extraction'));
        return;
      }
    } catch (e) {
      reject(new Error('Failed to validate archive contents before extraction'));
      return;
    }

    try {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(exe, 0o755);
        } catch (e) {}
      }
    } catch (e) {}

    const args = [
      'x',
      '-y',
      '-aos',
      `-o${outputDir}`,
      archivePath
    ];

    const proc = spawn(exe, args, { cwd: outputDir });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ out, err });
        return;
      }
      reject(new Error(`7z extraction failed (code ${code})${err ? `: ${err.trim()}` : ''}`));
    });
  });
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
          logToFile('Error killing process: ' + e.message);
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
        logToFile(`[isFileComplete] ${file.name}: file does not exist`);
        return false;
      }
      const st = fs.statSync(outputPath);
      const expected = typeof file.size === 'number' ? file.size : 0;
      if (expected > 0) {
        const result = (st.size || 0) >= expected;
        logToFile(`[isFileComplete] ${file.name}: size=${st.size}, expected=${expected}, complete=${result}`);
        return result;
      }
      // If size unknown, do NOT assume partial files are complete.
      logToFile(`[isFileComplete] ${file.name}: expected size unknown, returning false`);
      return false;
    } catch (e) {
      logToFile(`[isFileComplete] ${file.name}: error - ${e.message}`);
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

  logToFile(`[Resume] remainingFiles.length: ${remainingFiles.length}, allFiles.length: ${allFiles.length}`);
  logToFile(`[Resume] completedFiles: ${download.completedFiles}, downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}`);

  // Nothing left to do - complete immediately without going through updateProgress
  // to avoid race conditions with shouldFinalizeDownload.
  if (remainingFiles.length === 0) {
    logToFile(`[Resume] No remaining files - calling completeDownload directly`);
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

  const requestedParallel = Number(settings && settings.maxConcurrentDownloads);
  const PARALLEL_DOWNLOADS = Math.min(6, Math.max(1, Number.isFinite(requestedParallel) ? requestedParallel : 3));
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
  logToFile(`[Resume] After Promise.all - cancelled: ${download.cancelled}, paused: ${download.paused}, hasErrors: ${hasErrors}, failedFiles: ${JSON.stringify(download.failedFiles)}`);
  logToFile(`[Resume] downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}, completedFiles: ${download.completedFiles}, fileCount: ${download.fileCount}`);
  if (!download.cancelled && !download.paused && !hasErrors) {
    logToFile(`[Resume] Calling completeDownload for ${downloadId}`);
    completeDownload(downloadId);
  } else {
    logToFile(`[Resume] NOT completing - updating progress instead`);
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
function finalizeCompletedDownload(downloadId) {
  logToFile(`[completeDownload] Called for ${downloadId}`);
  const download = activeDownloads.get(downloadId);
  if (!download) {
    logToFile(`[completeDownload] Download not found in activeDownloads!`);
    return;
  }

  // Guard against double-completion
  if (download.status === 'completed') {
    logToFile(`[completeDownload] Already completed, skipping`);
    return;
  }

  logToFile(`[completeDownload] Setting status to completed and sending event`);
  download.status = 'completed';
  download.progress = 100;
  download.downloadedSize = download.totalSize;
  download.endTime = new Date().toISOString();

  // Send a final progress event marking completion.
  // This makes the UI update even if the dedicated 'download-completed' event is missed.
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        status: 'completed',
        progress: 100,
        downloadedSize: download.downloadedSize,
        totalSpeed: '0 B/s',
        activeFiles: [],
        completedFiles: download.completedFiles,
        fileCount: download.fileCount,
        extractionError: download.extractionError || ''
      });
      logToFile(`[completeDownload] Sent final download-progress status=completed`);
    }
  } catch (e) {
    logToFile(`[completeDownload] Failed to send final download-progress: ${e && e.message ? e.message : e}`);
  }

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
    logToFile(`[completeDownload] Sending download-completed event to renderer`);
    mainWindow.webContents.send('download-completed', { id: downloadId });
  } else {
    logToFile(`[completeDownload] ERROR: mainWindow or webContents is null!`);
  }
  if (download.extractionError) {
    showDownloadNotification('Download completed (extraction failed)', `${download.name || 'Download finished'}: ${download.extractionError}`);
  } else {
    showDownloadNotification('Download completed', download.name || 'Download finished');
  }
  activeDownloads.delete(downloadId);
  logToFile(`[completeDownload] Done, download removed from activeDownloads`);
}

function completeDownload(downloadId) {
  logToFile(`[completeDownload] Called for ${downloadId}`);
  const download = activeDownloads.get(downloadId);
  if (!download) {
    logToFile(`[completeDownload] Download not found in activeDownloads!`);
    return;
  }

  if (download.status === 'completed') {
    logToFile(`[completeDownload] Already completed, skipping`);
    return;
  }

  if (download.__armgddnFinalizing) {
    return;
  }

  const shouldExtract = !!(settings && settings.autoExtract7z);
  const downloadDir = path.join(settings.downloadPath, download.name || 'Download');

  if (shouldExtract) {
    const archives = find7zArchivesInDir(downloadDir);
    if (archives && archives.length > 0) {
      download.__armgddnFinalizing = true;
      download.status = 'extracting';
      download.progress = 99;
      download.totalSpeed = '0 B/s';
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            status: 'extracting',
            progress: download.progress,
            downloadedSize: download.downloadedSize,
            totalSpeed: '0 B/s',
            activeFiles: [],
            completedFiles: download.completedFiles,
            fileCount: download.fileCount
          });
        }
      } catch (e) {}

      (async () => {
        try {
          for (const a of archives) {
            await run7zExtract(a, downloadDir);
          }
        } catch (e) {
          download.extractionError = e && e.message ? e.message : String(e);
          try {
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('download-progress', {
                id: downloadId,
                status: 'extracting',
                progress: download.progress,
                downloadedSize: download.downloadedSize,
                totalSpeed: '0 B/s',
                activeFiles: [],
                completedFiles: download.completedFiles,
                fileCount: download.fileCount,
                extractionError: download.extractionError
              });
            }
          } catch (e2) {}
        } finally {
          download.__armgddnFinalizing = false;
          finalizeCompletedDownload(downloadId);
        }
      })();
      return;
    }
  }

  finalizeCompletedDownload(downloadId);
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
    hasSession: !!sessionToken,
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
        'User-Agent': 'ARMGDDN-Companion',
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

          // Security: only allow HTTPS installer URLs from allowlisted update hosts
          if (installerUrl) {
            try {
              const u = new URL(installerUrl);
              if (u.protocol !== 'https:' || !isAllowedUpdateHost(u.hostname)) {
                installerUrl = null;
              }
            } catch (e) {
              installerUrl = null;
            }
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
ipcMain.handle('install-update', async (event, installerUrl, options) => {
  if (!installerUrl) {
    return { success: false, error: 'No installer URL provided' };
  }

  const opts = (options && typeof options === 'object') ? options : {};
  const silent = !!opts.silent;
  const relaunchAfterInstall = !!opts.relaunchAfterInstall;

  try {
    const u = new URL(String(installerUrl));
    if (u.protocol !== 'https:' || !isAllowedUpdateHost(u.hostname)) {
      logToFile(`Update - installer URL not allowed: host=${u.hostname} url=${installerUrl}`);
      return { success: false, error: `Installer URL not allowed (${u.hostname})` };
    }
  } catch (e) {
    return { success: false, error: 'Invalid installer URL' };
  }
  
  const tempDir = app.getPath('temp');
  const updatesDir = path.join(app.getPath('userData'), 'updates');
  const platform = process.platform;
  const timestamp = Date.now();
  let fileName;
  
  if (platform === 'win32') {
    // Use unique filename to avoid EBUSY errors
    fileName = `ARMGDDN-Companion-Setup-${timestamp}.exe`;
  } else if (platform === 'linux') {
    fileName = installerUrl.endsWith('.deb') 
      ? `armgddn-companion-${timestamp}.deb` 
      : `ARMGDDN-Companion-${timestamp}.AppImage`;
  } else {
    fileName = `ARMGDDN-Companion-${timestamp}.dmg`;
  }
  
  const downloadDir = (platform === 'linux') ? updatesDir : tempDir;
  const filePath = path.join(downloadDir, fileName);
  
  return new Promise((resolve) => {
    // Download the installer
    const downloadInstaller = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      let parsed;
      try {
        parsed = new URL(url);
      } catch (e) {
        resolve({ success: false, error: 'Invalid download URL' });
        return;
      }

      if (parsed.protocol !== 'https:') {
        resolve({ success: false, error: 'Only HTTPS update downloads are allowed' });
        return;
      }

      if (!isAllowedUpdateHost(parsed.hostname)) {
        logToFile(`Update - blocked download host: host=${parsed.hostname} url=${url}`);
        resolve({ success: false, error: `Update download host not allowed (${parsed.hostname})` });
        return;
      }

      https.get(url, { headers: { 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (!location) {
            resolve({ success: false, error: 'Redirect with no location' });
            return;
          }
          logToFile(`Update - redirect: from=${url} to=${location}`);
          const nextUrl = location.startsWith('http') ? location : new URL(location, parsed).toString();
          return downloadInstaller(nextUrl, redirectCount + 1);
        }
        
        if (res.statusCode !== 200) {
          resolve({ success: false, error: `Download failed with status ${res.statusCode}` });
          return;
        }
        
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
        } catch (e) {}

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

                const installerArgs = [];
                if (silent) installerArgs.push('/S');

                // We want the app to be closed before the installer replaces files.
                // On Windows, run a detached PowerShell wrapper that:
                // 1) waits for this app PID to exit
                // 2) runs the installer (optionally /S)
                // 3) if requested, relaunches the app
                try {
                  const pid = process.pid;
                  const shouldRelaunch = relaunchAfterInstall ? 1 : 0;
                  const wrapperLogPath = path.join(app.getPath('userData'), 'update-wrapper.log');
                  const runnerPath = path.join(tempDir, `armgddn-update-runner-${Date.now()}.cmd`);

                  try {
                    fs.appendFileSync(wrapperLogPath, `[${new Date().toISOString()}] preparing update runner\r\n`, { encoding: 'utf8' });
                  } catch (e) {}

                  const installerQuoted = `"${filePath}"`;
                  const appQuoted = `"${process.execPath}"`;
                  const logQuoted = `"${wrapperLogPath}"`;
                  const silentArg = silent ? '/S' : '';
                  const runner = [
                    '@echo off',
                    `echo [%DATE% %TIME%] runner start>>${logQuoted}`,
                    `echo [%DATE% %TIME%] pid=${pid}>>${logQuoted}`,
                    `echo [%DATE% %TIME%] installer=${installerQuoted}>>${logQuoted}`,
                    `echo [%DATE% %TIME%] silent=${silent ? 1 : 0} relaunch=${shouldRelaunch}>>${logQuoted}`,
                    ':wait',
                    `tasklist /FI "PID eq ${pid}" 2>NUL | find "${pid}" >NUL`,
                    'if "%ERRORLEVEL%"=="0" (timeout /t 1 /nobreak >NUL & goto wait)',
                    `echo [%DATE% %TIME%] parent exited>>${logQuoted}`,
                    `start "" /wait ${installerQuoted} ${silentArg}`,
                    `echo [%DATE% %TIME%] installer finished rc=%ERRORLEVEL%>>${logQuoted}`,
                    shouldRelaunch ? `start "" ${appQuoted}` : 'rem',
                    `echo [%DATE% %TIME%] runner done>>${logQuoted}`,
                    'del "%~f0" >NUL 2>&1',
                    'exit /b 0'
                  ].join("\r\n");

                  try {
                    fs.writeFileSync(runnerPath, runner, { encoding: 'utf8' });
                    logToFile(`Update - wrote cmd runner: ${runnerPath}`);
                    logToFile(`Update - wrapper log: ${wrapperLogPath}`);
                  } catch (writeErr) {
                    logToFile(`Update - failed to write update runner: ${writeErr && writeErr.message ? writeErr.message : writeErr}`);
                    resolve({ success: false, error: 'Failed to prepare installer runner script' });
                    return;
                  }

                  logToFile(`Update - launching installer runner via shell.openPath (silent=${silent} relaunch=${relaunchAfterInstall})`);
                  shell.openPath(runnerPath);
                  setTimeout(() => {
                    app.isQuitting = true;
                    app.quit();
                    resolve({ success: true });
                  }, 250);
                  return;
                } catch (spawnErr) {
                  logToFile(`Update - failed to spawn installer wrapper: ${spawnErr && spawnErr.message ? spawnErr.message : spawnErr}`);
                  resolve({ success: false, error: 'Failed to launch installer process' });
                  return;
                }

                // Windows branch returns from the setTimeout above.
              } else if (platform === 'linux') {
                logToFile(`Update - filePath: ${filePath}`);
                logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);
                
                if (filePath.endsWith('.AppImage')) {
                  // Make executable and run directly
                  fs.chmodSync(filePath, '755');
                  logToFile('Update - launching AppImage');

                  let spawnFailed = false;
                  let resolved = false;
                  const child = spawn(filePath, [], {
                    detached: true,
                    stdio: 'ignore'
                  });
                  child.on('error', (err) => {
                    spawnFailed = true;
                    logToFile(`Update - AppImage spawn error: ${err && err.message ? err.message : err}`);
                  });
                  child.unref();

                  setTimeout(() => {
                    if (resolved) return;
                    resolved = true;

                    if (spawnFailed) {
                      shell.showItemInFolder(filePath);
                      resolve({ success: true, message: 'Update downloaded but could not be launched automatically. Please install manually.' });
                      return;
                    }

                    app.isQuitting = true;
                    app.quit();
                    resolve({ success: true });
                  }, 500);

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
