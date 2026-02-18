const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { pathToFileURL } = require('url');

function getDialogParentWindow() {
  try {
    if (progressWin && !progressWin.isDestroyed()) return progressWin;
  } catch (e) { }
  return mainWindow;
}

async function withDialogFocus(fn) {
  let restoreOnTop = null;
  try {
    if (progressWin && !progressWin.isDestroyed()) {
      try {
        restoreOnTop = progressWin.isAlwaysOnTop();
      } catch (e) {
        restoreOnTop = true;
      }
      try {
        progressWin.setAlwaysOnTop(false);
      } catch (e) { }
    }

    return await fn();
  } finally {
    if (restoreOnTop != null) {
      try {
        if (progressWin && !progressWin.isDestroyed()) {
          progressWin.setAlwaysOnTop(!!restoreOnTop);
          try { progressWin.moveTop(); } catch (e) { }
        }
      } catch (e) { }
    }
  }
}

function withDialogFocusSync(fn) {
  let restoreOnTop = null;
  try {
    if (progressWin && !progressWin.isDestroyed()) {
      try {
        restoreOnTop = progressWin.isAlwaysOnTop();
      } catch (e) {
        restoreOnTop = true;
      }
      try {
        progressWin.setAlwaysOnTop(false);
      } catch (e) { }
    }

    return fn();
  } finally {
    if (restoreOnTop != null) {
      try {
        if (progressWin && !progressWin.isDestroyed()) {
          progressWin.setAlwaysOnTop(!!restoreOnTop);
          try { progressWin.moveTop(); } catch (e) { }
        }
      } catch (e) { }
    }
  }
}

function getUpdateEd25519PublicKeyPem() {
  const v = process.env.ARMGDDN_UPDATE_ED25519_PUBKEY_PEM;
  if (v && typeof v === 'string' && v.trim()) {
    return v.trim();
  }

  const candidates = [
    path.join(__dirname, 'assets', 'update-ed25519-pub.pem')
  ];

  try {
    if (app && app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'assets', 'update-ed25519-pub.pem'));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'update-ed25519-pub.pem'));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'assets', 'update-ed25519-pub.pem'));
    }
  } catch (e) { }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const pem = fs.readFileSync(p, 'utf8');
        if (pem && typeof pem === 'string' && pem.trim()) {
          return pem.trim();
        }
      }
    } catch (e) { }
  }

  return '';
}

function decodeBase64Signature(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  try {
    const buf = Buffer.from(txt, 'base64');
    if (buf.length !== 64) return null;
    return buf;
  } catch (e) {
    return null;
  }
}

const SUPPORT_TELEGRAM_URL = 'https://t.me/ARMGDDNGames';

function withSupportFooter(message, fix) {
  try {
    const msg = String(message || '').trim();
    const fixText = String(fix || '').trim();
    const fixLine = fixText ? `Most likely fix: ${fixText}` : '';
    const supportLine = `If that doesn't help, contact support on Telegram: ${SUPPORT_TELEGRAM_URL}`;
    return [msg, fixLine, supportLine].filter(Boolean).join('\n');
  } catch (e) {
    return String(message || '');
  }
}

function verifyEd25519Signature(message, signature, publicKeyPem) {
  try {
    if (!message || !Buffer.isBuffer(message)) return false;
    if (!signature || !Buffer.isBuffer(signature)) return false;
    if (!publicKeyPem || typeof publicKeyPem !== 'string') return false;

    const keyObj = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
    // For Ed25519, the digest algorithm is ignored; Node requires `null`.
    return crypto.verify(null, message, keyObj, signature);
  } catch (e) {
    return false;
  }
}

// Set app name for dialogs and window titles
app.name = 'ARMGDDN Companion';

if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  try {
    app.setAppUserModelId('com.armgddn.downloader');
  } catch (e) { }
}

// Fetch manifest but request a different mirror when the remote is a mirror group.
async function fetchManifestWithAvoidMirror(manifestUrl, token, avoidMirror, redirectCount = 0) {
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

    const postBody = { remote, path: pathParam };
    if (avoidMirror) {
      postBody.avoidMirror = String(avoidMirror);
    }
    const postData = JSON.stringify(postBody);

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

          if (json.redirect && json.newRemote && json.newPath) {
            const newManifestUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}?remote=${encodeURIComponent(json.newRemote)}&path=${encodeURIComponent(json.newPath)}`;
            try {
              const newManifest = await fetchManifestWithAvoidMirror(newManifestUrl, token, avoidMirror, redirectCount + 1);
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

function isNetworkStreamError(output) {
  const lower = String(output || '').toLowerCase();
  return lower.includes('stream error') ||
    lower.includes('received from peer') ||
    lower.includes('internal_error') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('unexpected eof') ||
    lower.includes('broken pipe') ||
    lower.includes('rst_stream') ||
    lower.includes('http2') ||
    lower.includes('transport') ||
    lower.includes('client connection lost');
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

function getActiveFileCount(download) {
  try {
    if (!download) return 0;
    const activeFiles = download.activeFiles || {};
    let fileCount = 0;
    try {
      fileCount = Object.keys(activeFiles).length;
    } catch (e) {
      fileCount = 0;
    }

    let procCount = 0;
    try {
      const procs = Array.isArray(download.activeProcesses) ? download.activeProcesses : [];
      for (const p of procs) {
        if (!p) continue;
        if (p.killed) continue;
        // Only count processes that are actually still running.
        // ChildProcess.exitCode is null while running.
        if (p.exitCode === null) procCount++;
      }
    } catch (e) {
      procCount = 0;
    }

    return Math.max(fileCount, procCount);
  } catch (e) {
    return 0;
  }
}

async function refreshDownloadConcurrency(download, token, manifestUrl) {
  if (!download) return;

  const requested = Number(settings && settings.maxConcurrentDownloads);
  const requestedWorkers = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3));

  let effective = null;
  let notice = '';

  try {
    const loadInfo = await Promise.race([
      getAppLoadInfo(token, manifestUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('get-app-load timeout')), 8000))
    ]);

    if (loadInfo && loadInfo.success === true && loadInfo.concurrency) {
      const eff = Number(loadInfo.concurrency.effective);
      if (Number.isFinite(eff) && eff > 0) {
        effective = Math.min(requestedWorkers, eff);
      }
      try {
        if (Number.isFinite(eff) && eff > 0) {
          globalConcurrencyPool.serverLimit = Math.floor(eff);
        } else {
          globalConcurrencyPool.serverLimit = null;
        }
        refreshGlobalPoolLimit();
      } catch (e2) { }
      notice = (loadInfo.concurrency.notice ? String(loadInfo.concurrency.notice) : '') || '';
      download.serverOverhead = loadInfo;
      try {
        logToFile(`[Concurrency] app-load ok requested=${requestedWorkers} serverEffective=${eff} appliedEffective=${effective} manifestHost=${(() => { try { return manifestUrl ? new URL(String(manifestUrl)).hostname : ''; } catch (e2) { return ''; } })()}`);
      } catch (e) { }
    } else if (loadInfo && loadInfo.success === false) {
      const errMsg = loadInfo && loadInfo.error ? String(loadInfo.error) : 'Failed to fetch server load';
      logToFile(`[Concurrency] app-load failed: ${errMsg}`);
      try {
        globalConcurrencyPool.serverLimit = null;
        refreshGlobalPoolLimit();
      } catch (e2) { }
      // Provide a user-friendly message for quota exhaustion
      if (errMsg && /quota|limit|exhausted|too many/i.test(errMsg)) {
        notice = 'You are allowed 2 complete downloads per title per 24‑hour period and you have exhausted that for this title.';
      } else {
        notice = errMsg;
      }
    }
  } catch (e) {
    try {
      logToFile(`[Concurrency] get-app-load threw: ${e && e.message ? e.message : String(e)}`);
    } catch (e2) { }
    try {
      globalConcurrencyPool.serverLimit = null;
      refreshGlobalPoolLimit();
    } catch (e3) { }
  }

  download.effectiveConcurrency = effective;
  download.serverOverhead = download.serverOverhead || null;

  if (!notice) {
    const effNow = Number(download.effectiveConcurrency);
    if (Number.isFinite(effNow) && effNow > 0 && requestedWorkers > effNow) {
      notice = `Server load is high. Concurrent downloads may be throttled (${effNow} / ${requestedWorkers}).`;
    }
  }

  if (notice) {
    download.statusMessage = notice;
  } else if (effective) {
    let remainingFiles = null;
    try {
      const fileCount = typeof download.fileCount === 'number' ? download.fileCount : 0;
      const completed = typeof download.completedFiles === 'number' ? download.completedFiles : 0;
      if (fileCount > 0) remainingFiles = Math.max(0, fileCount - completed);
    } catch (e) {
      remainingFiles = null;
    }

    download.statusMessage = `Starting downloads...`;
  }

  try { updateProgress(download.id); } catch (e) { }
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

async function getAppLoadInfo(token, manifestUrl) {
  try {
    const sessionToken = token || loadSession();
    if (!sessionToken) {
      logToFile(`[app-load] No session token`);
      return { success: false, error: 'Not authenticated' };
    }

    let base = 'https://www.armgddnbrowser.com';
    try {
      if (typeof manifestUrl === 'string' && manifestUrl) {
        const u = new URL(manifestUrl);
        if (u && u.protocol === 'https:' && u.hostname && isAllowedServiceHost(u.hostname)) {
          base = `https://${u.hostname}`;
        }
      }
    } catch (e) {
      // ignore
    }

    const fetchOnce = async (baseUrl) => {
      const url = `${baseUrl}/api/app-load`;
      logToFile(`[app-load] GET ${url}`);
      const { statusCode, json, text, headers } = await fetchJsonWithBearer(url, 'GET', sessionToken);
      const location = headers && (headers.location || headers.Location) ? String(headers.location || headers.Location) : '';
      logToFile(`[app-load] Response status=${statusCode} location=${location ? redactUrlQueryStrings(location) : ''} json=${JSON.stringify(json)} text=${text ? text.slice(0, 200) : ''}`);

      if (statusCode >= 300 && statusCode < 400 && location) {
        try {
          const u = new URL(location);
          if (u.protocol === 'https:' && isAllowedServiceHost(u.hostname)) {
            logToFile(`[app-load] Following redirect to ${u.hostname}`);
            const redirected = await fetchJsonWithBearer(String(u), 'GET', sessionToken);
            const sc = redirected && typeof redirected.statusCode === 'number' ? redirected.statusCode : 0;
            if (sc === 200 && redirected.json && redirected.json.success === true) {
              return { ok: true, json: redirected.json };
            }
            const msg2 = (redirected.json && (redirected.json.error || redirected.json.message)) ? (redirected.json.error || redirected.json.message) : 'Failed to fetch server load';
            const snippet2 = (redirected.text && typeof redirected.text === 'string') ? redirected.text.slice(0, 200) : '';
            return { ok: false, error: `${msg2} (HTTP ${sc})${snippet2 ? `: ${snippet2}` : ''}` };
          }
        } catch (e) {
        }
      }

      if (statusCode === 200 && json && json.success === true) {
        return { ok: true, json };
      }
      const msg = (json && (json.error || json.message)) ? (json.error || json.message) : 'Failed to fetch server load';
      const snippet = (text && typeof text === 'string') ? text.slice(0, 200) : '';
      return { ok: false, error: `${msg} (HTTP ${statusCode})${snippet ? `: ${snippet}` : ''}` };
    };

    try {
      const candidates = [];
      try { if (base) candidates.push(String(base)); } catch (e) { }
      candidates.push('https://www.armgddnbrowser.com');
      candidates.push('https://armgddnbrowser.com');
      candidates.push('https://api.armgddnbrowser.com');

      const seen = new Set();
      let lastError = '';
      for (const b of candidates) {
        const bb = String(b || '').trim();
        if (!bb || seen.has(bb)) continue;
        seen.add(bb);
        const res = await fetchOnce(bb);
        if (res && res.ok) return res.json;
        lastError = res && res.error ? String(res.error) : lastError;
        if (bb !== 'https://www.armgddnbrowser.com') {
          logToFile(`[app-load] Attempt failed, next fallback`);
        }
      }

      return { success: false, error: lastError || 'Failed to fetch server load' };
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      const code = e && e.code ? String(e.code) : '';
      const looksLikeDnsOrConnect = code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';

      if (base !== 'https://www.armgddnbrowser.com' && looksLikeDnsOrConnect) {
        try {
          const fallback = await fetchOnce('https://www.armgddnbrowser.com');
          if (fallback.ok) return fallback.json;
          return { success: false, error: fallback.error || 'Failed to fetch server load' };
        } catch (e2) {
          return { success: false, error: e2 && e2.message ? e2.message : String(e2) };
        }
      }

      return { success: false, error: msg };
    }
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function fetchJsonWithBearer(urlString, method, bearerToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') {
      reject(new Error('Security error: URL must use HTTPS'));
      return;
    }

    const options = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : 443,
      path: u.pathname + (u.search || ''),
      method: method || 'GET',
      headers: {
        'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(),
        ...(bearerToken ? { 'Authorization': 'Bearer ' + bearerToken } : {})
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          // ignore parse failure
        }
        resolve({ statusCode: res.statusCode, json, text: data, headers: res.headers || {} });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      try { req.destroy(new Error('Request timeout')); } catch (e) { }
    });
    req.end();
  });
}

let mainWindow;
let authWindow;
let progressWin = null; // Update progress window
let tray;
let activeDownloads = new Map();
let downloadHistory = [];
let sessionToken = null;

// Deep link delivery can race app startup. If we send IPC before the renderer
// is loaded, the message may be dropped and the download won't start.
let mainWindowDidFinishLoad = false;
const pendingDeepLinks = [];

function flushPendingDeepLinks() {
  try {
    if (!mainWindow || !mainWindow.webContents) return;
    if (!mainWindowDidFinishLoad) return;
    if (!pendingDeepLinks.length) return;

    const toSend = pendingDeepLinks.splice(0, pendingDeepLinks.length);
    for (const u of toSend) {
      try {
        mainWindow.webContents.send('deep-link', u);
      } catch (e) {
        // Put it back and try again on next flush.
        pendingDeepLinks.unshift(u);
        break;
      }
    }

    mainWindow.show();
    mainWindow.focus();
  } catch (e) {
    // Keep it safe; we'll try again later.
  }
}

const ALLOWED_SERVICE_HOSTS = new Set([
  'armgddnbrowser.com',
  'www.armgddnbrowser.com',
  'api.armgddnbrowser.com',
  'box.ca',
  'whatbox.ca'
]);

const ALLOWED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
]);

function isAllowedServiceHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (ALLOWED_SERVICE_HOSTS.has(h)) return true;
  // Allow any subdomain of armgddnbrowser.com
  if (h.endsWith('.armgddnbrowser.com')) return true;
  return false;
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

const POOL_ID = crypto.randomUUID();

const globalConcurrencyPool = {
  limit: 2,
  inUse: 0,
  serverLimit: null,
  waiters: []
};

const adaptiveScheduler = {
  pending: [],
  pumping: false,
  runningByDownloadId: new Map(),
  lastDecisionLogAt: 0
};

function getTaskRemainingBytes(task) {
  try {
    const file = task && task.file ? task.file : null;
    const downloadDir = task && task.downloadDir ? String(task.downloadDir) : '';
    const expected = file && typeof file.size === 'number' ? Number(file.size) : 0;
    if (!downloadDir || !(expected > 0) || !file || !file.name) return expected > 0 ? expected : 0;
    const safeRel = sanitizeRelativePath(String(file.name));
    if (!safeRel) return expected;
    const outputPath = resolveInside(downloadDir, safeRel);
    if (!outputPath) return expected;
    if (!fs.existsSync(outputPath)) return expected;
    const st = fs.statSync(outputPath);
    const have = st && st.isFile && st.isFile() ? Number(st.size) : 0;
    return Math.max(0, expected - (Number.isFinite(have) ? have : 0));
  } catch (e) {
    try {
      const file = task && task.file ? task.file : null;
      const expected = file && typeof file.size === 'number' ? Number(file.size) : 0;
      return expected > 0 ? expected : 0;
    } catch (e2) {
      return 0;
    }
  }
}

function getDownloadRunningCount(downloadId) {
  try {
    const n = adaptiveScheduler.runningByDownloadId.get(String(downloadId));
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  } catch (e) {
    return 0;
  }
}

function incDownloadRunning(downloadId) {
  const key = String(downloadId);
  const prev = getDownloadRunningCount(key);
  adaptiveScheduler.runningByDownloadId.set(key, prev + 1);
}

function decDownloadRunning(downloadId) {
  const key = String(downloadId);
  const prev = getDownloadRunningCount(key);
  const next = Math.max(0, prev - 1);
  if (next === 0) adaptiveScheduler.runningByDownloadId.delete(key);
  else adaptiveScheduler.runningByDownloadId.set(key, next);
}

function pickNextAdaptiveTask() {
  const now = Date.now();
  let best = null;
  let bestScore = Infinity;

  for (const t of adaptiveScheduler.pending) {
    if (!t) continue;
    const download = activeDownloads.get(String(t.downloadId));
    if (!download || download.cancelled || download.paused) continue;

    const remaining = getTaskRemainingBytes(t);
    const ageMs = Math.max(0, now - (Number(t.enqueuedAt) || now));
    const running = getDownloadRunningCount(t.downloadId);

    // Enforce per-download concurrency limit (server effective limit when available).
    try {
      const requested = Number(settings && settings.maxConcurrentDownloads);
      const requestedWorkers = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3));
      const eff = Number(download && download.effectiveConcurrency);
      const limit = (Number.isFinite(eff) && eff > 0) ? Math.min(requestedWorkers, eff) : requestedWorkers;
      if (running >= limit) continue;
    } catch (e) { }

    const emaSpeedTotal = Number(download && download.__emaSpeedBytesPerSec) || 0;
    const perTaskSpeed = (Number.isFinite(emaSpeedTotal) && emaSpeedTotal > 0)
      ? (emaSpeedTotal / Math.max(1, Math.max(1, running)))
      : 0;
    const secondsToFinish = (Number.isFinite(perTaskSpeed) && perTaskSpeed > 0)
      ? (remaining / Math.max(1, perTaskSpeed))
      : remaining;

    // Baseline: shortest estimated time-to-finish.
    // Fairness: strongly prefer giving a slot to a download with no running tasks.
    // Aging: small nudge so tasks don't starve.
    let score = secondsToFinish;
    if (running === 0) score *= 0.5;
    score -= Math.min(5, (ageMs / 1000) * 0.05);

    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

async function schedulerPump() {
  if (adaptiveScheduler.pumping) return;
  adaptiveScheduler.pumping = true;
  try {
    while (adaptiveScheduler.pending.length > 0) {
      const task = pickNextAdaptiveTask();
      if (!task) break;

      // Remove selected task from the pending list.
      const idx = adaptiveScheduler.pending.indexOf(task);
      if (idx !== -1) adaptiveScheduler.pending.splice(idx, 1);

      const releaseGlobal = await acquireGlobalPoolSlot();

      // Slot acquired; the download may have been cancelled/paused while waiting.
      const download = activeDownloads.get(String(task.downloadId));
      if (!download || download.cancelled || download.paused) {
        try { releaseGlobal(); } catch (e) { }
        try { if (task && typeof task.reject === 'function') task.reject(new Error('Download cancelled')); } catch (e) { }
        continue;
      }

      // Start the task (non-preemptive).
      incDownloadRunning(task.downloadId);

      try {
        const now = Date.now();
        if (DEBUG_LOGGING && (now - (Number(adaptiveScheduler.lastDecisionLogAt) || 0)) > 3000) {
          adaptiveScheduler.lastDecisionLogAt = now;
          logToFile(`[Scheduler] start downloadId=${String(task.downloadId)} file=${task && task.file && task.file.name ? String(task.file.name) : ''} pending=${adaptiveScheduler.pending.length} inUse=${Number(globalConcurrencyPool.inUse) || 0} limit=${Number(globalConcurrencyPool.limit) || 0}`);
        }
      } catch (e) { }

      downloadFile(task.downloadId, task.file, task.downloadDir, releaseGlobal)
        .then(() => {
          try { decDownloadRunning(task.downloadId); } catch (e) { }
          try { if (task && typeof task.resolve === 'function') task.resolve(); } catch (e) { }
          try { schedulerPump(); } catch (e) { }
        })
        .catch((err) => {
          try { decDownloadRunning(task.downloadId); } catch (e) { }
          try { if (task && typeof task.reject === 'function') task.reject(err); } catch (e) { }
          try { schedulerPump(); } catch (e) { }
        });
    }
  } finally {
    adaptiveScheduler.pumping = false;
  }
}

function enqueueAdaptiveTask(downloadId, file, downloadDir) {
  return new Promise((resolve, reject) => {
    adaptiveScheduler.pending.push({
      downloadId: String(downloadId),
      file,
      downloadDir,
      enqueuedAt: Date.now(),
      resolve,
      reject
    });
    schedulerPump();
  });
}

function getGlobalPoolLimit() {
  try {
    const raw = Number(settings && settings.maxConcurrentDownloads);
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
    const userLimit = Math.min(20, Math.max(1, n));
    const serverRaw = Number(globalConcurrencyPool && globalConcurrencyPool.serverLimit);
    const serverLimit = Number.isFinite(serverRaw) && serverRaw > 0 ? Math.floor(serverRaw) : null;
    return serverLimit ? Math.max(1, Math.min(userLimit, serverLimit)) : userLimit;
  } catch (e) {
    return 2;
  }
}

function refreshGlobalPoolLimit() {
  try {
    globalConcurrencyPool.limit = getGlobalPoolLimit();
    while (globalConcurrencyPool.inUse < globalConcurrencyPool.limit && globalConcurrencyPool.waiters.length > 0) {
      const next = globalConcurrencyPool.waiters.shift();
      if (!next) continue;
      globalConcurrencyPool.inUse++;
      next(() => {
        try {
          globalConcurrencyPool.inUse = Math.max(0, (Number(globalConcurrencyPool.inUse) || 0) - 1);
          refreshGlobalPoolLimit();
        } catch (e) {
        }
      });
    }
  } catch (e) {
  }
}

function acquireGlobalPoolSlot() {
  refreshGlobalPoolLimit();
  return new Promise((resolve) => {
    try {
      if (globalConcurrencyPool.inUse < globalConcurrencyPool.limit) {
        globalConcurrencyPool.inUse++;
        resolve(() => {
          try {
            globalConcurrencyPool.inUse = Math.max(0, (Number(globalConcurrencyPool.inUse) || 0) - 1);
            refreshGlobalPoolLimit();
          } catch (e) {
          }
        });
        return;
      }
      globalConcurrencyPool.waiters.push(resolve);
    } catch (e) {
      resolve(() => { });
    }
  });
}

let settings = {
  downloadPath: path.join(app.getPath('downloads'), 'ARMGDDN'),
  maxConcurrentDownloads: 2,
  maxDownloadSpeedMBps: 0,
  autoExtract7z: false,
  showNotifications: true,
  minimizeToTrayOnMinimize: false,
  minimizeToTrayOnClose: false,
  autoUpdate: false,
  startWithOsStartup: false,
  startWithOsMinimized: false
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
          args: enabled ? ['--autostart'] : []
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
        } catch (e) { }
        return;
      }

      fs.mkdirSync(autostartDir, { recursive: true });
      const execPath = process.execPath;
      const content = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=ARMGDDN Companion',
        `Exec=${execPath} --autostart`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true'
      ].join('\n') + '\n';

      let existing = '';
      try { existing = fs.readFileSync(desktopPath, 'utf8'); } catch (e) { }
      if (existing !== content) {
        fs.writeFileSync(desktopPath, content, 'utf8');
        try { fs.chmodSync(desktopPath, 0o644); } catch (e) { }
      }
    }
  } catch (e) {
    logToFile(`[Startup] applyStartupRegistration failed: ${e && e.message ? e.message : e}`);
  }
}

function normalizeSettings() {
  try {
    if (!settings || typeof settings !== 'object') return;
    const maxConc = parseInt(String(settings.maxConcurrentDownloads), 10);
    // Enforce cap of 8 for stability
    settings.maxConcurrentDownloads = Number.isFinite(maxConc) && maxConc > 0 ? Math.min(maxConc, 8) : 2;

    const rawDownloadPath = settings.downloadPath;
    const defaultDownloadPath = path.join(app.getPath('downloads'), 'ARMGDDN');
    if (typeof rawDownloadPath !== 'string' || !rawDownloadPath.trim()) {
      settings.downloadPath = defaultDownloadPath;
    } else {
      const cleaned = rawDownloadPath.trim();
      settings.downloadPath = path.isAbsolute(cleaned) ? cleaned : defaultDownloadPath;
    }

    const speed = Number(settings.maxDownloadSpeedMBps);
    settings.maxDownloadSpeedMBps = Number.isFinite(speed) && speed > 0 ? Math.round(speed) : 0;

    settings.autoExtract7z = !!settings.autoExtract7z;
    settings.showNotifications = settings.showNotifications !== false;
    settings.minimizeToTrayOnMinimize = !!settings.minimizeToTrayOnMinimize;
    settings.minimizeToTrayOnClose = !!settings.minimizeToTrayOnClose;

    settings.autoUpdate = !!settings.autoUpdate;
    settings.startWithOsStartup = !!settings.startWithOsStartup;
    settings.startWithOsMinimized = !!settings.startWithOsMinimized;

    refreshGlobalPoolLimit();
  } catch (e) {
    logToFile(`[Settings] normalizeSettings failed: ${e && e.message ? e.message : e}`);
  }
}

function isAutostartLaunch() {
  try {
    if (Array.isArray(process.argv) && process.argv.includes('--autostart')) return true;
  } catch (e) { }

  try {
    if (typeof app.getLoginItemSettings === 'function') {
      const info = app.getLoginItemSettings();
      if (info && info.wasOpenedAtLogin) return true;
    }
  } catch (e) { }

  return false;
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
    // In AppImage builds, process.execPath can be a transient mount path under /tmp/.mount_*.
    // Prefer the stable AppImage file path when available so the protocol handler can launch
    // the app even when it's not already running.
    const appImagePath = process.env.APPIMAGE ? String(process.env.APPIMAGE) : '';
    const execPath = appImagePath || process.execPath;
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
    } catch (e) { }
    if (existing !== content) {
      fs.writeFileSync(desktopPath, content, 'utf8');
      try { fs.chmodSync(desktopPath, 0o644); } catch (e) { }
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
    } catch (e2) { }
  }
}

function redactUrlQueryStrings(text) {
  try {
    const s = String(text || '');
    if (!s) return '';
    return s.replace(/https?:\/\/\S+/gi, (u) => {
      const idx = u.indexOf('?');
      if (idx === -1) return u;
      return u.slice(0, idx) + '?…';
    });
  } catch (e) {
    return '';
  }
}

function extractRcloneErrorDetail(errorOutput) {
  try {
    const raw = String(errorOutput || '');
    if (!raw.trim()) return '';
    const redacted = redactUrlQueryStrings(raw);
    const lines = redacted
      .split(/\r?\n/)
      .map(l => String(l || '').trim())
      .filter(Boolean);

    if (!lines.length) return '';

    const ignore = (l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith('transferred:')) return true;
      if (lower.startsWith('elapsed time:')) return true;
      if (lower.startsWith('errors:')) return true;
      if (lower.startsWith('checks:')) return true;
      if (lower.startsWith('transfers:')) return true;
      if (lower.startsWith('deleted:')) return true;
      if (lower.startsWith('renamed:')) return true;
      if (lower.startsWith('skipped:')) return true;
      if (lower.startsWith('server side copies:')) return true;
      if (lower.startsWith('elapsed:')) return true;
      if (lower.startsWith('eta:')) return true;
      return false;
    };

    const candidates = lines.filter(l => !ignore(l));
    const pickFrom = candidates.length ? candidates : lines;

    const interesting = pickFrom.find(l => /\berror\b|\bfatal\b|\bfailed\b|\bpanic\b/i.test(l));
    const chosen = interesting || pickFrom[pickFrom.length - 1] || '';

    const compact = chosen.replace(/\s+/g, ' ').trim();
    return compact.length > 280 ? compact.slice(0, 280) : compact;
  } catch (e) {
    return '';
  }
}

function formatRcloneExitCodeHint(code) {
  if (code === 1) {
    return 'Something went wrong while downloading. This is often caused by an expired link, temporary provider limits, a network hiccup, or not being able to write the file to disk.';
  }

  return 'Something went wrong while downloading.';
}

function formatDownloadFailedMessage(code, errorOutput) {
  const detail = extractRcloneErrorDetail(errorOutput);
  const lower = String(errorOutput || '').toLowerCase();

  if (detail) {
    if (/(permission denied|access is denied|operation not permitted)/i.test(detail) || lower.includes('permission denied') || lower.includes('access is denied')) {
      return withSupportFooter(
        `Can't write the file to your download folder. (${detail})`,
        'Change the download folder to a writable location (e.g. inside your home folder) and retry.'
      );
    }
    if (/(no space left on device|disk full|not enough space)/i.test(detail) || lower.includes('no space left')) {
      return withSupportFooter(
        `You're out of disk space. (${detail})`,
        'Free up disk space or switch to a drive with more space, then retry.'
      );
    }
    if (/(file exists|already exists)/i.test(detail)) {
      return withSupportFooter(
        `A file with the same name already exists. (${detail})`,
        'Delete/rename the existing file or choose a different folder, then retry.'
      );
    }
    if (/(404|not found)/i.test(detail) || lower.includes('404') || lower.includes('not found')) {
      return withSupportFooter(
        `The download link looks invalid or expired (file not found). (${detail})`,
        'Go back to the website and start the download again to generate a fresh link.'
      );
    }
    if (/(401|403|unauthorized|forbidden)/i.test(detail) || lower.includes('unauthorized') || lower.includes('forbidden')) {
      return withSupportFooter(
        `Authorization failed (the link may be expired). (${detail})`,
        'Go back to the website and start the download again to generate a fresh link.'
      );
    }
    if (/(429|too many requests|rate limit)/i.test(detail) || lower.includes('too many requests')) {
      return withSupportFooter(
        `The server is rate-limiting the download right now. (${detail})`,
        'Wait a few minutes and retry. Avoid running multiple downloads at once.'
      );
    }
    if (/(timeout|timed out|deadline exceeded)/i.test(detail) || lower.includes('timeout')) {
      return withSupportFooter(
        `The download timed out. (${detail})`,
        'Retry the download. If it keeps timing out, try a different network or lower concurrency.'
      );
    }
    if (/(connection reset|broken pipe|unexpected eof|received from peer|econnreset|rst_stream|http2)/i.test(detail) || lower.includes('connection reset')) {
      return withSupportFooter(
        `The connection dropped mid-download. (${detail})`,
        'Retry the download. If it repeats, try a different network or lower concurrency.'
      );
    }
    if (/(x509|certificate|ssl)/i.test(detail)) {
      return withSupportFooter(
        `SSL/Certificate error. (${detail})`,
        'On Linux, install/update ca-certificates, then retry.'
      );
    }
    if (/(no such host|name resolution|lookup)/i.test(detail)) {
      return withSupportFooter(
        `Network/DNS error. (${detail})`,
        'Check your internet connection, DNS/VPN settings, then retry.'
      );
    }
    return withSupportFooter(
      `Download failed. ${detail}`,
      'Retry the download. If it keeps failing, restart the app and try again.'
    );
  }

  const hint = formatRcloneExitCodeHint(code);
  const codeText = (typeof code === 'number') ? `code ${code}` : 'unknown error';
  return withSupportFooter(
    `Download failed (${codeText}). ${hint}`,
    'Retry the download. If it keeps failing, restart the app and try again.'
  );
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
  } catch (e) { }

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

// Load orphaned downloads from history that were in-progress when the app quit
function loadOrphanedDownloads() {
  try {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return;
    const data = fs.readFileSync(historyPath, 'utf8');
    const history = JSON.parse(data);
    if (!Array.isArray(history)) return;

    const now = Date.now();
    for (const entry of history) {
      if (!entry || !entry.id || typeof entry.id !== 'string') continue;
      // Only rehydrate entries that look like in-progress (no endTime, or recent startTime)
      if (entry.endTime) continue;
      const ageMs = now - (entry.startTime ? new Date(entry.startTime).getTime() : 0);
      // Ignore entries older than 24 hours to avoid rehydrating stale state
      if (ageMs > 24 * 60 * 60 * 1000) continue;
      // Rehydrate as a minimal download object so UI can show it and user can resume
      const orphaned = {
        id: entry.id,
        name: entry.name || 'Unknown',
        totalSize: entry.totalSize || 0,
        bytesDownloaded: entry.bytesDownloaded || 0,
        status: 'paused',
        paused: true,
        error: null,
        cancelled: false,
        startTime: entry.startTime,
        endTime: null,
        files: entry.files || [],
        activeFiles: entry.activeFiles || {},
        activeProcesses: [],
        token: entry.token || null,
        manifestUrl: entry.manifestUrl || null,
        remote: entry.remote || null,
        targetDir: entry.targetDir || null,
        statusMessage: 'Download was interrupted. Click Resume to continue.'
      };
      activeDownloads.set(entry.id, orphaned);
      logToFile(`[orphan] Rehydrated orphaned download ${entry.id} (${orphaned.name})`);
    }
  } catch (e) {
    logToFile(`[orphan] Failed to load orphaned downloads: ${e && e.message ? e.message : e}`);
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
      } catch (e) { }

      try {
        const u = new URL(manifestStr);
        if (u.protocol !== 'https:') {
          logToFile('Deep link rejected - manifest not https');
          return null;
        }
        if (!isAllowedServiceHost(u.hostname)) {
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

  // Queue and flush when the renderer is ready.
  pendingDeepLinks.push(validatedUrl);
  // Keep queue bounded to avoid unbounded growth.
  if (pendingDeepLinks.length > 10) pendingDeepLinks.splice(0, pendingDeepLinks.length - 10);
  flushPendingDeepLinks();
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
      icon: getAppIcon(),
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

// Helper to get consistent app icon
function getAppIcon() {
  let iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  if (!fs.existsSync(iconPath)) {
    const resourcePath = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'assets', 'icon.ico')
      : path.join(process.resourcesPath, 'assets', 'icon.png');
    if (fs.existsSync(resourcePath)) {
      iconPath = resourcePath;
    }
  }
  return nativeImage.createFromPath(iconPath);
}

// Create main window
function createWindow() {
  const windowIcon = getAppIcon();

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
    icon: windowIcon,
    show: false
  });

  mainWindowDidFinishLoad = false;

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindowDidFinishLoad = true;
    // Give the renderer a moment to register IPC listeners.
    setTimeout(() => flushPendingDeepLinks(), 50);
  });

  mainWindow.once('ready-to-show', () => {
    const shouldStartMinimized = !!(settings && settings.startWithOsMinimized) && isAutostartLaunch();
    if (shouldStartMinimized) {
      // If user prefers tray-minimize behavior, do not show the window at all.
      if (settings && settings.minimizeToTrayOnMinimize) {
        try { mainWindow.hide(); } catch (e) { }
        return;
      }
      // Otherwise, show minimized on the taskbar.
      try { mainWindow.show(); } catch (e) { }
      try { mainWindow.minimize(); } catch (e) { }
    } else {
      if (process.platform === 'win32') {
        mainWindow.show();
        // ARMGDDN - Taskbar "nudge" to fix icon not showing up on launch
        mainWindow.setSkipTaskbar(true);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(false);
          }
        }, 100);
      } else {
        mainWindow.show();
      }
    }
    // Force icon again to ensure taskbar update
    if (windowIcon && !windowIcon.isEmpty()) {
      mainWindow.setIcon(windowIcon);
    }
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
      return;
    }

    // If there are active downloads, ask for confirmation before quitting
    const activeCount = activeDownloads.size;
    if (activeCount > 0) {
      const result = withDialogFocusSync(() => dialog.showMessageBoxSync(getDialogParentWindow(), {
        type: 'question',
        buttons: ['Cancel', 'Quit Anyway'],
        defaultId: 0,
        title: 'Active Downloads',
        message: `There ${activeCount === 1 ? 'is' : 'are'} ${activeCount} active download${activeCount === 1 ? '' : 's'}.`,
        detail: 'Quitting now will interrupt the downloads. Are you sure you want to quit?'
      }));
      if (result === 0) {
        // User chose Cancel; prevent quit
        event.preventDefault();
        return;
      }
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
    {
      label: 'Open Log Folder', click: () => {
        try {
          const folder = path.dirname(getDebugLogPath());
          shell.openPath(folder);
        } catch (e) { }
      }
    },
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
  loadOrphanedDownloads();
  loadSession();
  (async () => {
    try {
      const resultPath = path.join(app.getPath('userData'), 'update-result.json');
      if (!fs.existsSync(resultPath)) return;
      const raw = fs.readFileSync(resultPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      const state = String(parsed.state || '').toLowerCase();
      const exitCode = Number.isFinite(Number(parsed.exitCode)) ? Number(parsed.exitCode) : null;
      const logPath = parsed.logPath ? String(parsed.logPath) : '';

      // Clean up successful results silently.
      if (state === 'success' || exitCode === 0) {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      // Only show failure messages for recent results (avoid old stale files lingering).
      const ts = parsed.ts ? Number(parsed.ts) : null;
      const ageMs = (ts && Number.isFinite(ts)) ? (Date.now() - ts) : null;
      if (ageMs != null && ageMs > (24 * 60 * 60 * 1000)) {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      const msg = exitCode != null
        ? `The update installer failed (exit code ${exitCode}).\n\nYou can open the update log for details.`
        : 'The update installer failed.\n\nYou can open the update log for details.';

      const buttons = logPath ? ['Open Update Log', 'OK'] : ['OK'];
      const openIdx = 0;
      const { response } = await withDialogFocus(() => dialog.showMessageBox({
        type: 'error',
        buttons,
        defaultId: 0,
        title: 'Update Failed',
        message: 'ARMGDDN Companion update failed',
        detail: msg
      }));
      if (logPath && response === openIdx) {
        try {
          await shell.openPath(logPath);
        } catch (e) {
          try { shell.showItemInFolder(logPath); } catch (e2) { }
        }
      }

      try { fs.unlinkSync(resultPath); } catch (e) { }
    } catch (e) {
      try { logToFile(`Update result check error: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
    }
  })();
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
  if (!isValidDownloadId(downloadId)) return false;
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
  const incoming = (newSettings && typeof newSettings === 'object') ? newSettings : {};
  const allowedKeys = new Set([
    'downloadPath',
    'maxConcurrentDownloads',
    'maxDownloadSpeedMBps',
    'autoExtract7z',
    'showNotifications',
    'minimizeToTrayOnMinimize',
    'minimizeToTrayOnClose',
    'autoUpdate',
    'startWithOsStartup',
    'startWithOsMinimized'
  ]);

  const merged = { ...settings };
  for (const k of Object.keys(incoming)) {
    if (!allowedKeys.has(k)) continue;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    merged[k] = incoming[k];
  }
  settings = merged;
  normalizeSettings();
  applyStartupRegistration();
  saveSettings();
  return settings;
});

// Browse for folder
ipcMain.handle('browse-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), {
    properties: ['openDirectory']
  }));
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-app-load', async (event, token, manifestUrl) => {
  return getAppLoadInfo(token, manifestUrl);
});

// Show native message box (Yes/No)
ipcMain.handle('show-message-box', async (event, options) => {
  let parent = getDialogParentWindow();
  if (!parent || parent.isDestroyed()) return 0;
  const result = withDialogFocusSync(() => dialog.showMessageBoxSync(parent, options));
  return result;
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
    downloads.push(downloadToRenderer(download));
  }
  return downloads;
});

function downloadToRenderer(download) {
  return {
    id: download.id,
    name: download.name,
    manifestUrl: download.manifestUrl,
    remotePath: download.remotePath,
    progressHost: download.progressHost,
    progressPort: download.progressPort,
    progressPath: download.progressPath,
    status: download.status,
    progress: download.progress,
    speed: download.speed,
    eta: download.eta,
    totalSize: download.totalSize,
    downloadedSize: download.downloadedSize,
    fileCount: download.fileCount,
    completedFiles: download.completedFiles,
    activeFiles: download.activeFiles,
    totalSpeed: download.totalSpeed,
    peakSpeedBytes: download.peakSpeedBytes,
    startTime: download.startTime,
    cancelled: download.cancelled,
    paused: download.paused,
    failedFiles: download.failedFiles,
    quotaNotified: download.quotaNotified,
    forceDisableAutoExtract: download.forceDisableAutoExtract,
    serverOverhead: download.serverOverhead,
    effectiveConcurrency: download.effectiveConcurrency,
    statusMessage: download.statusMessage,
    actualRemote: download.actualRemote,
    mirrorSwitches: download.mirrorSwitches,
    triedMirrors: download.triedMirrors,
    extractionError: download.extractionError
  };
}

// Validate token format (basic check)
function isValidToken(token) {
  if (!token || typeof token !== 'string') return false;
  // Token should be non-empty and reasonable length
  return token.length >= 10 && token.length <= 500;
}

function isValidDownloadId(downloadId) {
  if (typeof downloadId !== 'string' || !downloadId) return false;
  // crypto.randomUUID() format
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(downloadId);
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

// Resolve short-lived browser download token into a manifest URL
ipcMain.handle('resolve-download-token', async (event, downloadToken, token) => {
  if (!isValidToken(token)) {
    throw new Error('Invalid or missing authentication token');
  }

  if (!downloadToken || typeof downloadToken !== 'string') {
    throw new Error('Missing download token');
  }

  // Default to the production host; allowlist check is applied.
  const host = 'www.armgddnbrowser.com';
  if (!isAllowedServiceHost(host)) {
    throw new Error('Security error: Host not allowed');
  }

  const pathWithQuery = `/api/external-download-token/resolve?downloadToken=${encodeURIComponent(downloadToken)}`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: 443,
      path: pathWithQuery,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          if (!json || json.success !== true || !json.manifestUrl) {
            reject(new Error((json && json.error) ? String(json.error) : 'Failed to resolve download token'));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
});

// Debug log to file for troubleshooting
function debugLog(message) {
  if (!DEBUG_LOGGING) return;
  const logPath = path.join(app.getPath('userData'), 'debug.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logPath, logLine);
}

// Report file progress to server (exclude from quota counting)
async function reportFileProgressToServer(download, token, file, status, bytesDownloadedOverride) {
  try {
    if (!token || !download || !file) return;
    const fileName = file && file.name ? String(file.name) : '';
    const totalBytes = typeof file.size === 'number' ? file.size : 0;
    const bytesDownloaded = typeof bytesDownloadedOverride === 'number'
      ? bytesDownloadedOverride
      : (status === 'completed' ? totalBytes : 0);

    const isActiveStatus = (() => {
      const s = String(status || '').toLowerCase();
      return s === 'downloading' || s === 'in_progress' || s === 'starting';
    })();

    const postData = JSON.stringify({
      downloadId: download.id,
      fileName,
      remotePath: download.remotePath || '',
      activeStreams: isActiveStatus ? getActiveFileCount(download) : 0,
      poolId: POOL_ID,
      poolActiveStreams: Math.max(0, Number(globalConcurrencyPool.inUse) || 0),
      poolLimit: getGlobalPoolLimit(),
      bytesDownloaded,
      totalBytes,
      status,
      error: null,
      isFileLevel: true // Flag to indicate this is file-level progress, not overall completion
    });

    const targetHost = download.progressHost || 'www.armgddnbrowser.com';
    if (!isAllowedServiceHost(targetHost)) {
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
      res.on('data', () => { });
      res.on('end', () => { });
    });
    req.on('error', () => { });
    req.write(postData);
    req.end();
  } catch (e) {
    // ignore
  }
}

function isFileCompleteOnDisk(downloadDir, file) {
  try {
    if (!downloadDir || !file || !file.name) return false;
    const expected = normalizeFileSize(file.size);
    if (!(expected > 0)) return false;
    const safeRel = sanitizeRelativePath(String(file.name));
    if (!safeRel) return false;
    const outputPath = resolveInside(downloadDir, safeRel);
    if (!outputPath) return false;
    if (!fs.existsSync(outputPath)) return false;
    const st = fs.statSync(outputPath);
    return st && st.isFile && st.isFile() && st.size === expected;
  } catch (e) {
    return false;
  }
}

function normalizeFileSize(size) {
  const n = Number(size);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

    const reportStatus = (download.status === 'in_progress' ? 'downloading' : download.status);
    const isActiveStatus = (() => {
      const s = String(reportStatus || '').toLowerCase();
      return s === 'downloading' || s === 'in_progress' || s === 'starting';
    })();

    const postData = JSON.stringify({
      downloadId: download.id,
      fileName: download.name,
      remotePath: download.remotePath || '',  // For trending (e.g., "PC1/Game Name")
      activeStreams: isActiveStatus ? getActiveFileCount(download) : 0,
      poolId: POOL_ID,
      poolActiveStreams: Math.max(0, Number(globalConcurrencyPool.inUse) || 0),
      poolLimit: getGlobalPoolLimit(),
      bytesDownloaded: bytesDownloaded,
      totalBytes: totalBytes,
      status: reportStatus,
      statusMessage: download.statusMessage || '',
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

// Format bytes
function formatBytes(bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Check free disk space
function getFreeDiskSpace(targetPath) {
  try {
    // If path doesn't exist, check parent until we find one that exists
    let current = targetPath;
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break; // Root reached
      current = parent;
    }

    if (fs.statfsSync) {
      const stats = fs.statfsSync(current);
      return stats.bavail * stats.bsize; // Available blocks * block size
    }
  } catch (e) {
    logToFile(`[DiskCheck] Failed to check space for ${targetPath}: ${e.message}`);
  }
  return -1; // Unknown
}

// Start download
ipcMain.handle('start-download', async (event, manifest, token, manifestUrl) => {
  // Security: Validate token (required)
  if (!isValidToken(token)) {
    throw new Error('Invalid or missing authentication token');
  }

  debugLog(`Download started - Token: [PRESENT]`);

  // Save/update the token as session for connection status
  // Always update on new download to refresh token if server restarted
  saveSession(token);
  logToFile('Session token saved/updated from download');

  const downloadId = crypto.randomUUID();

  // Default progress reporting target
  let progressHost = 'www.armgddnbrowser.com';
  let progressPort = 443;
  let progressPath = '/api/app-progress';
  try {
    if (typeof manifestUrl === 'string' && manifestUrl) {
      const u = new URL(manifestUrl);
      if (u && u.hostname) {
        if (u.protocol === 'https:' && isAllowedServiceHost(u.hostname)) {
          progressHost = u.hostname;
          progressPort = u.port ? Number(u.port) : 443;
        }
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
    try {
      const actualRemote = (manifest && manifest.actualRemote) ? String(manifest.actualRemote) : '';
      if (actualRemote && remotePath) {
        const actualLower = actualRemote.toLowerCase();
        const rootForActual = (() => {
          const mPcvr = actualLower.match(/^pcvr-(\d)$/);
          if (mPcvr) return 'PCVR' + mPcvr[1];
          const mPc = actualLower.match(/^pc-(\d)$/);
          if (mPc) return 'PC' + mPc[1];
          return null;
        })();
        if (rootForActual) {
          const segments = String(remotePath).split('/').filter(Boolean);
          if (segments.length > 0) {
            const head = String(segments[0] || '');
            if (/^PCVR\d$/i.test(head) || /^PC\d$/i.test(head)) {
              segments[0] = rootForActual;
              remotePath = segments.join('/');
            } else {
              remotePath = rootForActual + '/' + segments.join('/');
            }
          } else {
            remotePath = rootForActual;
          }
        }
      }
    } catch (e) { }
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

  try {
    const canonical = String(remotePath || '').trim();
    if (canonical) {
      for (const [, d] of activeDownloads.entries()) {
        if (!d) continue;
        const rp = String(d.remotePath || '').trim();
        if (!rp || rp !== canonical) continue;
        const st = d.status ? String(d.status) : '';
        if (st === 'completed' || st === 'cancelled' || st === 'error') continue;
        throw new Error('You are already downloading this item.');
      }
    }
  } catch (e) {
    throw e;
  }

  const safeFolderName = sanitizeRelativePath(String(name || ''));
  if (safeFolderName) {
    name = safeFolderName;
  } else {
    name = 'Download';
  }

  // DISK SPACE CHECK
  let forceDisableAutoExtract = false;
  try {
    const targetPath = path.resolve(settings.downloadPath);
    const freeBytes = getFreeDiskSpace(targetPath);

    if (freeBytes !== -1 && totalSize > 0) {
      const SAFETY_BUFFER = 500 * 1024 * 1024; // 500 MB
      const requiredForDownload = totalSize + SAFETY_BUFFER;

      // Check 1: Enough space for download?
      if (freeBytes < requiredForDownload) {
        const msg = `Not enough disk space to download this game.\n\nRequired: ${formatBytes(requiredForDownload)}\nAvailable: ${formatBytes(freeBytes)}\n\nPlease free up some space and try again.`;
        throw new Error(msg);
      }

      // Check 2: If auto-extract is on, do we have enough for download + extract?
      // Heuristic: Extraction needs roughly same size again (total * 2).
      const autoExtractOn = !!(settings && settings.autoExtract7z);
      if (autoExtractOn) {
        const requiredForExtract = (totalSize * 2) + SAFETY_BUFFER;
        if (freeBytes < requiredForExtract) {
          // We have enough to download (passed Check 1) but not enough to extract.
          // Ask user what to do.
          const { response } = await withDialogFocus(() => dialog.showMessageBox(getDialogParentWindow(), {
            type: 'question',
            buttons: ['Download Only (Disable Auto-Extract)', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Insufficient Disk Space for Extraction',
            message: 'Not enough disk space for automatic extraction.',
            detail: `You have enough space to download the files, but not enough to extract them automatically.\n\nSpace Available: ${formatBytes(freeBytes)}\nRequired for Download + Extraction: ~${formatBytes(requiredForExtract)}\n\nDo you want to proceed with the download only? You will need to extract the files manually later or free up space.`
          }));

          if (response === 1) {
            // User cancelled
            return null; // Return null to indicate cancellation without error to renderer (or handle appropriately)
          } else {
            // User chose Download Only
            forceDisableAutoExtract = true;
          }
        }
      }
    }
  } catch (e) {
    // Pass through explicit errors (like "Not enough space"), ignore others
    if (e.message && e.message.startsWith('Not enough disk space')) {
      throw e;
    }
    logToFile(`[DiskCheck] Warning: skipped check due to error: ${e.message}`);
  }

  const download = {
    id: downloadId,
    name: name,
    manifestUrl: (typeof manifestUrl === 'string' ? manifestUrl : ''),
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
    peakSpeedBytes: 0,
    startTime: new Date().toISOString(),
    token: token,  // Store token for progress reporting
    cancelled: false,  // Flag to stop new downloads when cancelled
    paused: false,
    failedFiles: [],
    quotaNotified: false,
    forceDisableAutoExtract: forceDisableAutoExtract,
    serverOverhead: null,
    effectiveConcurrency: null,
    statusMessage: '',
    actualRemote: (manifest && manifest.actualRemote) ? String(manifest.actualRemote) : '',
    mirrorSwitches: 0,
    triedMirrors: []
  };

  try {
    const initial = download.actualRemote ? String(download.actualRemote) : '';
    if (initial) {
      download.triedMirrors = [initial];
    }
  } catch (e) { }

  activeDownloads.set(downloadId, download);
  mainWindow.webContents.send('download-started', downloadToRenderer(download));

  download.statusMessage = 'Preparing download...';
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        status: download.status,
        progress: download.progress,
        eta: download.eta || '',
        statusMessage: download.statusMessage || '',
        completedFiles: download.completedFiles,
        fileCount: download.fileCount
      });
    }
  } catch (e) { }

  // Create download directory
  const downloadDir = resolveInside(settings.downloadPath, name);
  if (!downloadDir) {
    throw new Error('Security error: Invalid download folder path');
  }
  try {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
  } catch (e) {
    // Common on Windows when the target folder/drive is blocked by permissions or
    // Controlled Folder Access. If this throws, we must surface a clear error and
    // avoid leaving a stuck "in_progress" download that never spawns workers.
    const msg = (e && e.message) ? String(e.message) : String(e);
    try {
      download.status = 'error';
      download.error = withSupportFooter(
        `Can't create the download folder. (${msg})`,
        'Change the download folder in settings to a writable location (e.g. inside your user folder) and retry. On Windows, check Defender Controlled Folder Access / antivirus blocks.'
      );
      download.statusMessage = download.error;
      updateProgress(downloadId);
    } catch (e2) { }
    try { logToFile(`[start-download] mkdir failed path=${String(downloadDir)} err=${msg}`); } catch (e2) { }
    try { mainWindow.webContents.send('download-error', { id: downloadId, error: download.error || msg }); } catch (e2) { }
    try { showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error || msg}`); } catch (e2) { }
    try { activeDownloads.delete(downloadId); } catch (e2) { }
    throw new Error(download.error || msg);
  }

  download.statusMessage = 'Checking existing files...';
  try { updateProgress(downloadId); } catch (e) { }

  // Skip files that are already complete on disk
  try {
    const allFiles = Array.isArray(files) ? files : [];
    let completedFiles = 0;
    let downloadedSize = 0;
    const remainingFiles = [];
    for (const f of allFiles) {
      if (!f || !f.name) continue;
      if (isFileCompleteOnDisk(downloadDir, f)) {
        completedFiles++;
        downloadedSize += normalizeFileSize(f.size);
        try {
          reportFileProgressToServer(download, token, f, 'completed', normalizeFileSize(f.size));
        } catch (e) { }
      } else {
        remainingFiles.push(f);
      }
    }
    download.completedFiles = completedFiles;
    download.downloadedSize = downloadedSize;
    files = remainingFiles;

    try {
      for (const f of files) {
        if (!f || !f.url) continue;
        const transformed = transformProxyUrlToDirectIfPossible(f.url);
        if (transformed && transformed !== f.url) {
          f.url = transformed;
        }
      }
    } catch (e) { }
    download.files = allFiles;
    if (allFiles.length > 0) {
      download.statusMessage = completedFiles > 0
        ? `Skipped ${completedFiles}/${allFiles.length} files already on disk.`
        : 'No existing files found. Starting download...';
    } else {
      download.statusMessage = 'Starting download...';
    }
    try { updateProgress(downloadId); } catch (e) { }
  } catch (e) {
    // ignore
  }

  // Update status to in_progress
  download.status = 'in_progress';
  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    status: 'in_progress',
    progress: 0,
    statusMessage: download.statusMessage || ''
  });

  // Report initial progress to server
  reportProgressToServer(download, token);

  download.statusMessage = 'Checking server load...';
  try { updateProgress(downloadId); } catch (e) { }

  // Download files in parallel (controlled by user setting)
  const getRequestedWorkersNow = () => {
    const requestedParallelNow = Number(settings && settings.maxConcurrentDownloads);
    return Math.min(20, Math.max(1, Number.isFinite(requestedParallelNow) ? requestedParallelNow : 3));
  };

  const requestedWorkers = getRequestedWorkersNow();
  try {
    await refreshDownloadConcurrency(download, token, manifestUrl);
  } catch (e) {
    logToFile(`[Concurrency] Initial refresh failed, proceeding with default: ${e && e.message ? e.message : e}`);
    if (!Number.isFinite(download.effectiveConcurrency) || download.effectiveConcurrency <= 0) {
      download.effectiveConcurrency = requestedWorkers;
    }
  }
  download.statusMessage = download.statusMessage || 'Starting downloads...';
  try { updateProgress(downloadId); } catch (e2) { }

  // Spawn at most the requested workers; concurrency is enforced dynamically by waiting
  // when active files exceed the server's effective limit.
  const activePromises = [];
  for (const f of files) {
    if (!f) continue;
    activePromises.push(enqueueAdaptiveTask(downloadId, f, downloadDir).catch((err) => {
      if (!download.cancelled) {
        try {
          logToFile(`[Scheduler] file task failed: ${err && err.message ? err.message : String(err)} file=${f && f.name ? String(f.name) : ''}`);
        } catch (e) { }
      }
      // Continue with other files.
    }));
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

function isLikelySignedExpiringUrl(urlString) {
  try {
    const u = new URL(String(urlString || ''));
    const host = (u && u.hostname) ? String(u.hostname).toLowerCase() : '';
    const pathname = (u && u.pathname) ? String(u.pathname) : '';
    const hasJd2 = !!u.searchParams.get('jd2');
    const hasWhatboxSig = !!(u.searchParams.get('exp') && u.searchParams.get('sig'));
    const isArmgddnHost = host === 'www.armgddnbrowser.com' || host === 'armgddnbrowser.com' || host.endsWith('.armgddnbrowser.com');
    return hasJd2 || hasWhatboxSig || (isArmgddnHost && (pathname === '/api/download-file' || pathname === '/dl'));
  } catch (e) {
    return false;
  }
}

// Check output for expired-token indicators.
// IMPORTANT: do not treat a generic 401 as "expired" unless the URL is actually
// a signed/expiring URL. Direct Whatbox paths should not surface as "expired".
function isTokenExpiredError(output, fileUrl) {
  const lowerOutput = String(output || '').toLowerCase();
  const isExpiringUrl = isLikelySignedExpiringUrl(fileUrl);

  // Strong signals: treat as expired regardless of URL type.
  const strongIndicators = [
    'token expired',
    'token invalid',
    'expired token'
  ];
  for (const t of strongIndicators) {
    if (lowerOutput.includes(t)) return true;
  }

  // Weak signals: only treat as expired when we know we're using a signed URL.
  if (!isExpiringUrl) return false;

  const weakIndicators = [
    'unauthorized',
    'access denied',
    'forbidden',
    ' 401',
    ' 403',
    'status code 401',
    'status code 403'
  ];
  return weakIndicators.some(indicator => lowerOutput.includes(indicator));
}

async function refetchManifestAndRetryExpiredLink(downloadId, download, file, downloadDir) {
  try {
    if (!download || !download.manifestUrl || !download.token) return false;
    download.tokenRefreshes = (Number(download.tokenRefreshes) || 0) + 1;
    if (download.tokenRefreshes > 2) return false;

    logToFile(`[TokenRefresh] refetching manifest for expired link refreshCount=${download.tokenRefreshes} file=${file && file.name ? String(file.name) : ''}`);
    const newManifest = await fetchManifestInternal(String(download.manifestUrl), download.token);
    if (!newManifest || !Array.isArray(newManifest.files)) return false;

    const wantPath = file && file.path ? String(file.path) : '';
    const wantName = file && file.name ? String(file.name) : '';
    const match = newManifest.files.find(f => {
      if (!f) return false;
      if (wantPath && f.path && String(f.path) === wantPath) return true;
      if (wantName && f.name && String(f.name) === wantName) return true;
      return false;
    });

    if (!match || !match.url) return false;

    const retryFile = { ...file, url: String(match.url) };
    try {
      const transformed = transformProxyUrlToDirectIfPossible(retryFile.url);
      if (transformed && transformed !== retryFile.url) {
        retryFile.url = transformed;
      }
    } catch (e) { }

    // Clear stale error state before retrying.
    try {
      download.status = 'downloading';
      download.error = '';
      download.statusMessage = '';
      updateProgress(downloadId);
    } catch (e) { }

    logToFile(`[TokenRefresh] retrying file with refreshed url file=${wantName}`);
    await downloadFile(downloadId, retryFile, downloadDir);
    return true;
  } catch (e) {
    try {
      logToFile(`[TokenRefresh] manifest refetch/retry failed: ${e && e.message ? e.message : String(e)}`);
    } catch (e2) { }
    return false;
  }
}

function getActiveFileKey(file) {
  try {
    const url = file && file.url ? String(file.url) : '';
    const name = file && file.name ? String(file.name) : '';
    const seed = `${url}::${name}`;
    if (!seed || seed === '::') return crypto.randomUUID();
    return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  } catch (e) {
    try {
      return crypto.randomUUID();
    } catch (e2) {
      return String(Date.now());
    }
  }
}

function isProxyDownloadUrl(urlString) {
  try {
    const u = new URL(String(urlString || ''));
    const host = (u && u.hostname) ? String(u.hostname).toLowerCase() : '';
    const isArmgddnHost = host === 'www.armgddnbrowser.com' || host === 'armgddnbrowser.com' || host.endsWith('.armgddnbrowser.com');
    if (!isArmgddnHost) return false;
    const pathname = (u && u.pathname) ? String(u.pathname) : '';
    // /api/download-file is a redirect endpoint to the direct file host.
    // Do not treat it as a proxy-routed download.
    if (pathname === '/api/download-file') return false;
    return true;
  } catch (e) {
    return false;
  }
}

function transformProxyUrlToDirectIfPossible(urlString) {
  try {
    const s = String(urlString || '');
    if (!s || !s.includes('armgddnbrowser.com')) return s;
    const u = new URL(s);

    // Legacy/alternate proxy URL format: https://www.armgddnbrowser.com/?path=...
    // or similar routes that include a `path` query param.
    const rpath = u.searchParams.get('path');
    if (rpath) {
      return `https://dl.neatbarb.box.ca/${rpath}`;
    }

    // Signed /api/download-file URLs (JD2/app manifests) should never be used as
    // a proxy route by the Companion. When possible, transform them into the
    // same direct Whatbox URL that the server would 302 to.
    // Example: /api/download-file?remote=PC-2&file=PC2/Game/Foo.7z&jd2=...
    const pathname = (u && u.pathname) ? String(u.pathname) : '';
    if (pathname === '/api/download-file') {
      const remote = (u.searchParams.get('remote') || '').trim();
      const file = (u.searchParams.get('file') || '').trim();
      if (!remote || !file) return s;

      const REDIRECT_BASE_URL = 'https://dl.neatbarb.box.ca';

      let boxCategory = '';
      let relPath = file;

      if (remote.startsWith('PC-') || remote === 'PC-FTP') {
        boxCategory = 'Games/PC';
        if (remote.startsWith('PC-') && remote !== 'PC-FTP') {
          const parts = relPath.split('/');
          if (parts.length > 0) parts.shift();
          relPath = parts.join('/');
        }
      } else if (remote.startsWith('PCVR-') || remote === 'PCVR-FTP') {
        boxCategory = 'Games/PCVR';
        if (remote.startsWith('PCVR-') && remote !== 'PCVR-FTP') {
          const parts = relPath.split('/');
          if (parts.length > 0) parts.shift();
          relPath = parts.join('/');
        }
      } else {
        return s;
      }

      if (!boxCategory || !relPath) return s;

      const safePath = relPath.split('/').map(c => encodeURIComponent(c)).join('/');
      return `${REDIRECT_BASE_URL}/${boxCategory}/${safePath}`;
    }

    return s;
  } catch (e) {
    return String(urlString || '');
  }
}

// Download a single file using rclone
async function downloadFile(downloadId, file, downloadDir, preAcquiredRelease) {
  return new Promise((resolve, reject) => {
    (async () => {
      const releaseGlobal = (typeof preAcquiredRelease === 'function') ? preAcquiredRelease : await acquireGlobalPoolSlot();
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        try { releaseGlobal(); } catch (e) { }
      };

      const done = (err) => {
        try { releaseOnce(); } catch (e) { }
        if (err) reject(err);
        else resolve();
      };

      const download = activeDownloads.get(downloadId);
      if (!download) {
        done(new Error('Download not found'));
        return;
      }

    // Security: Validate file URL is HTTPS
      if (!file.url || !file.url.startsWith('https://')) {
        done(new Error('Security error: File URL must use HTTPS'));
        return;
      }

    try {
      const transformed = transformProxyUrlToDirectIfPossible(file.url);
      if (transformed && transformed !== file.url) {
        file.url = transformed;
      }
    } catch (e) { }

      const safeRel = sanitizeRelativePath(file.name);
      if (!safeRel) {
        done(new Error('Security error: Invalid file name'));
        return;
      }
    const outputPath = resolveInside(downloadDir, safeRel);
      if (!outputPath) {
        done(new Error('Security error: Invalid file path'));
        return;
      }

    if (isFileCompleteOnDisk(downloadDir, file)) {
      download.downloadedSize += normalizeFileSize(file.size);
      download.completedFiles++;
      updateProgress(downloadId);
      try {
        reportFileProgressToServer(download, download.token, file, 'completed', normalizeFileSize(file.size));
      } catch (e) { }
      done();
      return;
    }

    download.status = 'downloading';
    download.currentFile = file.name;

    try {
      const u = new URL(String(file && file.url ? file.url : ''));
      const host = (u && u.hostname) ? String(u.hostname).toLowerCase() : '';
      const isProxyRoute = host === 'www.armgddnbrowser.com' || host === 'armgddnbrowser.com' || host.endsWith('.armgddnbrowser.com');
      logToFile(`[Route] fileRoute=${isProxyRoute ? 'proxy' : 'direct'} file=${file && file.name ? String(file.name) : ''}`);
    } catch (e) {
      // ignore
    }

    const fileKey = getActiveFileKey(file);

    // Initialize per-file tracking
    download.activeFiles[fileKey] = {
      id: fileKey,
      name: file.name,
      size: file.size || 0,
      progress: 0,
      speed: '',
      eta: '',
      status: 'downloading'
    };

    if (isProxyDownloadUrl(file.url)) {
      // Some remotes cannot be direct-routed (e.g. Coming Attractions / Testing).
      // For these, allow proxy routed downloads.
      let proxyRemote = '';
      try {
        const u = new URL(String(file.url));
        proxyRemote = String(u.searchParams.get('remote') || '');
      } catch (e) { }

      const PROXY_ALLOWED_REMOTES = new Set([
        'Testing',
        '3D Printer Models',
        'Pirated PC Apps',
        'Testers'
      ]);

      if (!PROXY_ALLOWED_REMOTES.has(proxyRemote)) {
        const err = new Error(withSupportFooter(
          `Proxy routed downloads are disabled (blocked: ${file && file.name ? String(file.name) : 'unknown file'}).`,
          'Retry the download. If it keeps failing, start the download again from the website to get a fresh direct link.'
        ));
        try {
          download.status = 'error';
          if (!Array.isArray(download.failedFiles)) {
            download.failedFiles = [];
          }
          download.failedFiles.push(file.name);
          if (download.activeFiles[fileKey]) {
            download.activeFiles[fileKey].status = 'error';
            delete download.activeFiles[fileKey];
          }
          download.statusMessage = err.message;
          updateProgress(downloadId);
        } catch (e) { }
        done(err);
        return;
      }
    }

    try {
      if (file.url && file.url.includes('armgddnbrowser.com')) {
        const u = new URL(file.url);
        const remote = u.searchParams.get('remote');
        const directUrl = transformProxyUrlToDirectIfPossible(file.url);
        if (directUrl && directUrl !== file.url) {
          logToFile(`[Route] Direct Routing Engaged: remote=${remote || 'Unknown'} to=${directUrl}`);
          file.url = directUrl;
        }
      }
    } catch (e) {
      logToFile(`[Route] Failed universal transformation: ${e.message}`);
    }

    updateProgress(downloadId);

    const rclonePath = getRclonePath();

    // Ensure parent directory exists
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let globalActiveProcs = 0;
    try {
      for (const [, d] of activeDownloads) {
        if (!d || !Array.isArray(d.activeProcesses)) continue;
        for (const p of d.activeProcesses) {
          if (!p) continue;
          if (p.killed || p.exitCode !== null) continue;
          globalActiveProcs++;
        }
      }
    } catch (e) {
      globalActiveProcs = 0;
    }

    const fileSize = normalizeFileSize(file && file.size);
    let bufferSize = '16M';
    if (globalActiveProcs >= 200) bufferSize = '4M';
    else if (globalActiveProcs >= 100) bufferSize = '8M';
    else if (globalActiveProcs >= 50) bufferSize = '16M';
    else bufferSize = (fileSize >= (2 * 1024 * 1024 * 1024)) ? '128M' : '64M';

    let route = 'direct';
    try {
      const urlStr = file && file.url ? String(file.url) : '';
      const u2 = new URL(urlStr);
      const host2 = (u2 && u2.hostname) ? String(u2.hostname).toLowerCase() : '';
      const isProxyRoute2 = host2 === 'www.armgddnbrowser.com' || host2 === 'armgddnbrowser.com' || host2.endsWith('.armgddnbrowser.com');
      route = isProxyRoute2 ? 'proxy' : 'direct';
    } catch (e) { }

    let multiThreadStreams = 0;
    let multiThreadCutoff = '128M';
    if (fileSize >= (128 * 1024 * 1024) && globalActiveProcs < 50) {
      const isWhatbox = route === 'direct' || (file.url && (file.url.includes('box.ca') || file.url.includes('whatbox.ca')));
      if (route === 'proxy' && !isWhatbox) {
        // Drastically reduce streams to bypass aggressive IP-level source throttling
        multiThreadStreams = globalActiveProcs < 10 ? 2 : 1;
      } else {
        // Direct/Whatbox: High thread count for maximum throughput (targeting 2Gbps+)
        multiThreadStreams = globalActiveProcs < 20 ? 16 : 8;
      }
    }

    const args = [
      'copyurl',
      file.url,
      outputPath,
      '--progress',
      '--stats', '1s',
      '--stats-one-line',
      '--log-level', 'INFO',
      '--buffer-size', bufferSize,
      '--contimeout', '30s',           // Connection timeout
      '--timeout', '300s',             // Overall timeout
      '--low-level-retries', '3',      // Retry on low-level errors
      '--retries', '10',
      '--retries-sleep', '2s',
      '--drive-acknowledge-abuse'      // Bypass Google Drive virus scan warnings
    ];

    if (multiThreadStreams > 0) {
      args.push('--multi-thread-streams', String(multiThreadStreams));
      args.push('--multi-thread-cutoff', String(multiThreadCutoff));
    }

    const maxMb = Number(settings && settings.maxDownloadSpeedMBps);
    let appliedBwLimit = '';
    if (Number.isFinite(maxMb) && maxMb > 0) {
      const workersSetting = Number(settings && settings.maxConcurrentDownloads);
      const workers = Math.min(20, Math.max(1, Number.isFinite(workersSetting) ? workersSetting : 3));
      const perWorker = maxMb / workers;
      const perWorkerStr = Number.isFinite(perWorker) && perWorker > 0 ? perWorker.toFixed(1).replace(/\.0$/, '') : '';
      if (perWorkerStr) {
        appliedBwLimit = `${perWorkerStr}M`;
        args.push('--bwlimit', appliedBwLimit);
      }
    }

    try {
      const name = file && file.name ? String(file.name) : '';
      const urlStr = file && file.url ? String(file.url) : '';
      let route = 'direct';
      try {
        const u2 = new URL(urlStr);
        const host2 = (u2 && u2.hostname) ? String(u2.hostname).toLowerCase() : '';
        const isProxyRoute2 = host2 === 'www.armgddnbrowser.com' || host2 === 'armgddnbrowser.com' || host2.endsWith('.armgddnbrowser.com');
        route = isProxyRoute2 ? 'proxy' : 'direct';
      } catch (e) { }
      logToFile(`[rclone-spawn] route=${route} activeProcs=${globalActiveProcs} fileSize=${fileSize} buffer=${bufferSize} mt=${multiThreadStreams > 0 ? String(multiThreadStreams) : '0'} bwlimit=${appliedBwLimit || 'none'} file=${name}`);
    } catch (e) { }

    try {
      const urlStr = file && file.url ? String(file.url) : '';
      const full = String(process.env.ARMGDDN_LOG_FULL_URLS || '').trim() === '1';
      const shown = full ? urlStr : redactUrlQueryStrings(urlStr);
      logToFile(`[rclone-copyurl] url=${shown}`);
    } catch (e) { }

    let proc;
    try {
      proc = spawn(rclonePath, args);
    } catch (e) {
      // spawn() can throw synchronously (e.g. ENOENT, EACCES). In that case we would
      // otherwise leak the global concurrency slot and leave the download stuck.
      download.status = 'error';
      const msg = (e && e.message) ? String(e.message) : String(e);
      download.error = withSupportFooter(
        `Failed to start downloader engine (rclone). (${msg})`,
        'Try reinstalling/updating the Companion, or temporarily disable antivirus/quarantine and retry.'
      );
      try {
        if (!Array.isArray(download.failedFiles)) download.failedFiles = [];
        download.failedFiles.push(file.name);
      } catch (e2) { }
      try {
        if (download.activeFiles && download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          delete download.activeFiles[fileKey];
        }
      } catch (e2) { }
      try {
        logToFile(`[rclone] spawn threw: ${msg} rclonePath=${String(rclonePath || '')}`);
      } catch (e2) { }
      try { updateProgress(downloadId); } catch (e2) { }
      try { mainWindow.webContents.send('download-error', { id: downloadId, error: download.error }); } catch (e2) { }
      try { showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`); } catch (e2) { }
      done(new Error(download.error));
      return;
    }

    download.activeProcesses.push(proc);  // Track for cancellation

    let errorOutput = '';

    // Some environments will appear to "hang" if rclone emits no progress/stderr.
    // Track output activity and fail fast with an actionable error instead of spinning forever.
    let sawAnyOutput = false;
    let lastOutputAt = Date.now();
    let watchdogTimer = null;
    const WATCHDOG_SILENCE_MS = 60 * 1000;
    const kickWatchdog = () => {
      try { lastOutputAt = Date.now(); } catch (e) { }
      if (watchdogTimer) return;
      watchdogTimer = setInterval(() => {
        try {
          if (!proc || proc.killed || proc.exitCode !== null) return;
          const now = Date.now();
          const silence = Math.max(0, now - (Number(lastOutputAt) || now));
          if (silence < WATCHDOG_SILENCE_MS) return;

          // Kill and surface a clear message. This ensures the slot is freed and user can retry.
          // @ts-ignore
          proc.__armgddnStopReason = 'watchdog';
          try {
            logToFile(`[rclone] watchdog: no output for ${Math.round(silence / 1000)}s file=${file && file.name ? String(file.name) : ''} urlHost=${(() => { try { return new URL(String(file && file.url ? file.url : '')).hostname; } catch (e) { return ''; } })()}`);
          } catch (e) { }
          try { proc.kill('SIGKILL'); } catch (e) { }
        } catch (e) {
          // ignore
        }
      }, 5000);
      try { watchdogTimer.unref(); } catch (e) { }
    };
    kickWatchdog();

    const logFirstOutput = (streamName, output) => {
      try {
        if (sawAnyOutput) return;
        const trimmed = String(output || '').trim();
        if (!trimmed) return;
        sawAnyOutput = true;
        const head = trimmed.length > 600 ? trimmed.slice(0, 600) + '…' : trimmed;
        logToFile(`[rclone] first-${streamName}: ${redactUrlQueryStrings(head)}`);
      } catch (e) { }
    };

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      try { kickWatchdog(); } catch (e) { }
      try { logFirstOutput('stdout', output); } catch (e) { }
      parseRcloneProgress(downloadId, fileKey, output);
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      try { kickWatchdog(); } catch (e) { }
      try { logFirstOutput('stderr', output); } catch (e) { }
      parseRcloneProgress(downloadId, fileKey, output);
    });

    proc.on('close', async (code) => {
      try {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
      } catch (e) { }
      const idx = download.activeProcesses.indexOf(proc);
      if (idx !== -1) {
        download.activeProcesses.splice(idx, 1);
      }

      // @ts-ignore
      const stopReason = proc.__armgddnStopReason;

      if (download.cancelled) {
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'cancelled';
          delete download.activeFiles[fileKey];
        }
        updateProgress(downloadId);
        done();
        return;
      }

      // If this process was intentionally killed due to pause, treat as paused
      // even if the pause flag has already been cleared by a resume.
      if (download.paused || stopReason === 'pause') {
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'paused';
        }
        updateProgress(downloadId);
        resolve();
        return;
      }

      if (code === 0) {
        download.downloadedSize += normalizeFileSize(file.size);
        download.completedFiles++;
        // Mark file as completed and remove from active
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'completed';
          download.activeFiles[fileKey].progress = 100;
          delete download.activeFiles[fileKey];
        }
        try {
          reportFileProgressToServer(download, download.token, file, 'completed', normalizeFileSize(file.size));
        } catch (e) { }
        updateProgress(downloadId);
        done();
      } else {
        download.status = 'error';

        if (!Array.isArray(download.failedFiles)) {
          download.failedFiles = [];
        }
        download.failedFiles.push(file.name);
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          // Remove from active to avoid permanently consuming a concurrency slot.
          delete download.activeFiles[fileKey];
        }

        // Check for specific error types
        const quota = isQuotaError(errorOutput);
        const busy = isServerBusyError(errorOutput);
        const sslError = errorOutput.includes('x509') || errorOutput.includes('certificate') || errorOutput.includes('ssl');
        const dnsError = errorOutput.includes('lookup') || errorOutput.includes('name resolution') || errorOutput.includes('no such host');
        const networkStream = isNetworkStreamError(errorOutput);
        const tokenExpired = isTokenExpiredError(errorOutput, (file && file.url) ? String(file.url) : '');

        if (stopReason === 'watchdog' && !errorOutput) {
          download.error = withSupportFooter(
            'Download engine stalled (no progress output).',
            `This is usually caused by a network/DNS/TLS issue, a blocked connection, or security software interfering with rclone. Try:
1) Retry once
2) Disable VPN/Proxy temporarily
3) Ensure your firewall/AV allows the Companion
4) If on Linux, install/update ca-certificates`
          );
          updateProgress(downloadId);
          mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
          showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
          done(new Error(download.error));
          return;
        }

        // Attempt mirror failover once for network/stream failures.
        // This only works when the manifest URL points at a mirror group remote.
        try {
          const canTryMirrorFailover = !!(
            networkStream &&
            !quota &&
            !busy &&
            !sslError &&
            !dnsError &&
            !tokenExpired &&
            download &&
            download.manifestUrl &&
            download.token &&
            (Number(download.mirrorSwitches) || 0) < 5
          );

          if (canTryMirrorFailover) {
            const tried = Array.isArray(download.triedMirrors) ? download.triedMirrors.map(String) : [];
            const avoid = tried.filter(Boolean).join(',');
            logToFile(`[MirrorFailover] attempting manifest refetch avoidMirror=${avoid} file=${file && file.name ? String(file.name) : ''}`);
            const newManifest = await fetchManifestWithAvoidMirror(String(download.manifestUrl), download.token, avoid);
            const newActual = newManifest && newManifest.actualRemote ? String(newManifest.actualRemote) : '';

            if (newActual && !tried.includes(newActual) && Array.isArray(newManifest.files)) {
              const wantPath = file && file.path ? String(file.path) : '';
              const wantName = file && file.name ? String(file.name) : '';
              const match = newManifest.files.find(f => {
                if (!f) return false;
                if (wantPath && f.path && String(f.path) === wantPath) return true;
                if (wantName && f.name && String(f.name) === wantName) return true;
                return false;
              });

              if (match && match.url) {
                download.actualRemote = newActual;
                download.mirrorSwitches = (Number(download.mirrorSwitches) || 0) + 1;
                try {
                  if (!Array.isArray(download.triedMirrors)) download.triedMirrors = [];
                  download.triedMirrors.push(newActual);
                } catch (e) { }
                const retryFile = { ...file, url: String(match.url) };
                logToFile(`[MirrorFailover] retrying on new mirror actualRemote=${newActual} file=${wantName}`);

                // Remove this file from failedFiles since we're retrying it.
                try {
                  if (Array.isArray(download.failedFiles)) {
                    download.failedFiles = download.failedFiles.filter(n => String(n) !== String(file.name));
                  }
                } catch (e) { }

                // Reset status so the UI doesn't stay in an error state if retry succeeds.
                download.status = 'downloading';
                download.error = '';
                updateProgress(downloadId);

                // Retry once with the new URL.
                downloadFile(downloadId, retryFile, downloadDir).then(resolve).catch((e) => {
                  reject(e);
                });
                return;
              }
            }
          }
        } catch (e) {
          try {
            logToFile(`[MirrorFailover] failed to refetch manifest/retry: ${e && e.message ? e.message : String(e)}`);
          } catch (e2) { }
        }

        // If this is a signed link expiry, attempt a manifest refetch + retry before surfacing an error.
        if (tokenExpired) {
          try {
            const recovered = await refetchManifestAndRetryExpiredLink(downloadId, download, file, downloadDir);
            if (recovered) {
              resolve();
              return;
            }
          } catch (e) {
            // ignore and fall through to user-visible error
          }
        }

        try {
          const trimmed = String(errorOutput || '').trim();
          const tail = trimmed.length > 12000 ? trimmed.slice(-12000) : trimmed;
          const redacted = redactUrlQueryStrings(tail);
          logToFile(`[rclone] copyurl failed code=${code} file=${file && file.name ? String(file.name) : ''} outputPath=${outputPath} stderr=${redacted}`);
        } catch (e) {
          try {
            logToFile(`[rclone] copyurl failed code=${code} file=${file && file.name ? String(file.name) : ''} (failed to log stderr)`);
          } catch (e2) { }
        }

        if (busy) {
          download.error = withSupportFooter(
            'Server is busy due to high demand.',
            'Wait a minute and retry. If it keeps happening, lower concurrency.'
          );
        } else if (quota) {
          download.error = withSupportFooter(
            'Download quota exceeded. This file is temporarily unavailable due to high demand.',
            'Wait a few hours and retry, or try a different title/mirror if available.'
          );
        } else if (tokenExpired) {
          download.error = withSupportFooter(
            'Download link expired.',
            'Go back to the website and start the download again to generate a fresh link.'
          );
        } else if (sslError) {
          download.error = withSupportFooter(
            'SSL/Certificate error.',
            'On Linux, install/update ca-certificates, then retry.'
          );
        } else if (dnsError) {
          download.error = withSupportFooter(
            'Network/DNS error.',
            'Check your internet connection, DNS/VPN settings, then retry.'
          );
        } else {
          download.error = formatDownloadFailedMessage(code, errorOutput);
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
        done(new Error(download.error));
      }
    });

    proc.on('error', (err) => {
      download.status = 'error';
      download.error = err.message;
      try {
        const idx = download.activeProcesses.indexOf(proc);
        if (idx !== -1) download.activeProcesses.splice(idx, 1);
      } catch (e) { }
      try {
        if (download.activeFiles && download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          delete download.activeFiles[fileKey];
        }
      } catch (e) { }
      try {
        logToFile(`[rclone] spawn error: ${err && err.message ? err.message : String(err)}`);
      } catch (e) { }
      mainWindow.webContents.send('download-error', { id: downloadId, error: download.error });
      showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
      done(err);
    });
    })().catch((e) => {
      reject(e);
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
          } catch (e) { }
        }
      }
    }
  } catch (e) { }
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

    try {
      logToFile(`[7z] Extract start: ${archivePath} -> ${outputDir}`);
    } catch (e) { }

    const password = 'ARMGDDNGames';
    const isPasswordErrorText = (text) => {
      const t = String(text || '').toLowerCase();
      return t.includes('enter password') || t.includes('wrong password') || t.includes('password is incorrect') || t.includes('encrypted');
    };

    const runList = () => {
      const listArgs = ['l', '-slt', `-p${password}`, archivePath];
      return spawnSync(exe, listArgs, { encoding: 'utf8', timeout: 30000 });
    };

    try {
      const listResult = runList();

      if (!(listResult && listResult.status === 0)) {
        try {
          const code = (listResult && typeof listResult.status === 'number') ? listResult.status : null;
          const so = String((listResult && listResult.stdout) || '');
          const se = String((listResult && listResult.stderr) || '');
          const le = listResult && listResult.error ? (listResult.error.message || String(listResult.error)) : '';
          const ls = listResult && listResult.signal ? String(listResult.signal) : '';
          logToFile(`[7z] List failed: code=${code} signal=${ls} err=${le ? 'yes' : 'no'} stdoutLen=${so.length} stderrLen=${se.length}`);
        } catch (e) { }

        if (listResult && listResult.error && listResult.error.code === 'ETIMEDOUT') {
          reject(new Error('7z extraction failed: validation timed out'));
          return;
        }
        reject(new Error('Failed to validate archive contents before extraction'));
        return;
      }

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
    } catch (e) {
      reject(new Error('Failed to validate archive contents before extraction'));
      return;
    }

    try {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(exe, 0o755);
        } catch (e) { }
      }
    } catch (e) { }

    const spawnExtract = () => {
      const args = [
        'x',
        '-bsp1',
        '-y',
        '-aos',
        `-o${outputDir}`,
        `-p${password}`,
        archivePath
      ];
      const proc = spawn(exe, args, { cwd: outputDir });
      let out = '';
      let err = '';
      let killedByTimeout = false;
      let killedByInactivity = false;
      let lastOutputAt = Date.now();
      const timeout = setTimeout(() => {
        killedByTimeout = true;
        try { proc.kill(); } catch (e) { }
      }, 60 * 60 * 1000);

      const inactivityInterval = setInterval(() => {
        if (killedByTimeout || killedByInactivity) return;
        const now = Date.now();
        if (now - lastOutputAt > 5 * 60 * 1000) {
          killedByInactivity = true;
          try { proc.kill(); } catch (e) { }
        }
      }, 15000);
      try {
        if (proc.stdin) proc.stdin.end();
      } catch (e) { }
      proc.stdout.on('data', (d) => {
        lastOutputAt = Date.now();
        out += d.toString();
      });
      proc.stderr.on('data', (d) => {
        lastOutputAt = Date.now();
        err += d.toString();
      });
      proc.on('error', (e) => {
        clearTimeout(timeout);
        clearInterval(inactivityInterval);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(inactivityInterval);
        if (killedByTimeout) {
          reject(new Error('7z extraction failed: extraction timed out'));
          return;
        }
        if (killedByInactivity) {
          try {
            logToFile(`[7z] Extract stalled (no output): ${archivePath}`);
          } catch (e) { }
          reject(new Error('7z extraction failed: extraction stalled'));
          return;
        }
        if (code === 0) {
          try {
            logToFile(`[7z] Extract ok: ${archivePath}`);
          } catch (e) { }
          resolve({ out, err });
          return;
        }
        const combined = (out + '\n' + err).trim();
        if (isPasswordErrorText(combined)) {
          reject(new Error('7z extraction failed: wrong password or encrypted archive'));
          return;
        }
        try {
          logToFile(`[7z] Extract failed: ${archivePath} code=${code} outLen=${out.length} errLen=${err.length}`);
        } catch (e) { }
        reject(new Error(`7z extraction failed (code ${code})${err ? `: ${err.trim()}` : ''}`));
      });
    };

    spawnExtract();
  });
}

// Parse rclone progress output
function parseRcloneProgress(downloadId, fileKey, output) {
  const download = activeDownloads.get(downloadId);
  if (!download) return;

  // Get or create file tracking
  const fileInfo = download.activeFiles[fileKey];
  if (!fileInfo) return;

  // Buffer partial progress output across stdout/stderr chunks.
  // rclone frequently emits carriage-return based updates and may split tokens across chunks.
  try {
    if (!download.__rcloneProgressBuf) download.__rcloneProgressBuf = {};
    const prev = download.__rcloneProgressBuf[fileKey] ? String(download.__rcloneProgressBuf[fileKey]) : '';
    const next = prev + String(output == null ? '' : output);
    download.__rcloneProgressBuf[fileKey] = next;
  } catch (e) { }

  const stripAnsiAndControl = (s) => {
    try {
      const str = String(s == null ? '' : s);
      // Strip ANSI escape sequences (including CSI, OSC) and other control chars.
      const noAnsi = str
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      return noAnsi;
    } catch (e) {
      return String(s == null ? '' : s);
    }
  };

  let buffered = '';
  try {
    buffered = download.__rcloneProgressBuf && download.__rcloneProgressBuf[fileKey]
      ? String(download.__rcloneProgressBuf[fileKey])
      : String(output == null ? '' : output);
  } catch (e) {
    buffered = String(output == null ? '' : output);
  }

  // Split into complete lines; keep the last partial segment in the buffer.
  const sanitizedBuffered = stripAnsiAndControl(buffered);
  const endedWithDelimiter = /[\r\n]$/.test(sanitizedBuffered);
  const segments = sanitizedBuffered.split(/[\r\n]+/);
  let complete = segments;
  let remainder = '';
  if (!endedWithDelimiter && segments.length > 0) {
    remainder = segments[segments.length - 1];
    complete = segments.slice(0, -1);
    // If rclone is emitting a single constantly-updating line with no delimiter yet,
    // we still want to parse that line for progress while keeping it buffered.
    if (complete.length === 0 && remainder) {
      complete = [remainder];
    }
  }
  try {
    if (download.__rcloneProgressBuf) download.__rcloneProgressBuf[fileKey] = remainder;
  } catch (e) { }

  // Parse progress percentage.
  // NOTE: rclone emits many lines that can contain a percentage-like token.
  // We only trust percentages from either:
  // - The aggregate "Transferred:" stats line, or
  // - A line that includes this file's name.
  // Otherwise we can jump 0->100 instantly from unrelated output.
  const lines = complete;
  let parsedPercent = null;
  let parsedAggregatePercent = null;
  const fileName = (fileInfo && fileInfo.name) ? String(fileInfo.name) : '';
  const fileBase = (() => {
    try {
      if (!fileName) return '';
      const parts = fileName.split('/').filter(Boolean);
      return parts.length ? String(parts[parts.length - 1]) : '';
    } catch (e) {
      return '';
    }
  })();

  const lineMentionsThisFile = (line) => {
    try {
      if (!line) return false;
      if (fileName && line.includes(fileName)) return true;
      if (fileBase && line.includes(fileBase)) return true;
      return false;
    } catch (e) {
      return false;
    }
  };
  for (const line of lines) {
    if (!line) continue;
    const trimmed = line.trim();

    // copyurl sometimes emits one-line progress without the "Transferred:" prefix, e.g.
    // "18.165 MiB / 1.423 GiB, 1%, 0 B/s, ETA -"
    // Detect it by finding a % token followed shortly by a speed token.
    if (trimmed && parsedAggregatePercent == null) {
      const mOneLine = trimmed.match(/\b(\d{1,3})%\b/);
      if (mOneLine) {
        const looksLikeStats = /\s\/\s|\bETA\b|\/(?:s|sec)\b/i.test(trimmed);
        if (looksLikeStats) {
          parsedAggregatePercent = parseInt(mOneLine[1], 10);
          parsedPercent = parsedAggregatePercent;
          continue;
        }
      }
    }

    // Prefer aggregate stats line (works reliably even for copyurl)
    if (trimmed.startsWith('Transferred:')) {
      const m = trimmed.match(/,\s*(\d{1,3})%/);
      if (m) {
        parsedAggregatePercent = parseInt(m[1], 10);
        parsedPercent = parsedAggregatePercent;
        continue;
      }
    }

    // Fall back to file-specific line if present
    if (lineMentionsThisFile(line)) {
      const m = line.match(/(\d{1,3})%/);
      if (m) {
        parsedPercent = parseInt(m[1], 10);
        break;
      }
    }
  }

  try {
    if (typeof parsedAggregatePercent === 'number' && Number.isFinite(parsedAggregatePercent)) {
      if (!download.__rcloneLastLoggedPct) download.__rcloneLastLoggedPct = {};
      const prevLogged = Number(download.__rcloneLastLoggedPct[fileKey]);
      const nextLogged = Math.max(0, Math.min(100, Math.floor(parsedAggregatePercent)));
      if (!Number.isFinite(prevLogged) || prevLogged !== nextLogged) {
        download.__rcloneLastLoggedPct[fileKey] = nextLogged;
        const snippet = (() => {
          try {
            for (let i = lines.length - 1; i >= 0; i--) {
              const t = String(lines[i] || '').trim();
              if (!t) continue;
              if (t.includes('%')) {
                return t.length > 220 ? (t.slice(0, 220) + '…') : t;
              }
            }
          } catch (e) { }
          return '';
        })();
        logToFile(`[rclone-parse] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} pct=${nextLogged}${snippet ? ` line=${snippet}` : ''}`);
      }
    }
  } catch (e) { }

  if (typeof parsedAggregatePercent === 'number' && Number.isFinite(parsedAggregatePercent)) {
    try {
      download.__lastAggregatePercent = parsedAggregatePercent;
      download.__lastAggregatePercentAt = Date.now();
    } catch (e) { }

    try {
      const pct = Math.max(0, Math.min(100, parsedAggregatePercent));
      const activeFilesObj = download.activeFiles || {};
      for (const k of Object.keys(activeFilesObj)) {
        const f = activeFilesObj[k];
        if (!f || typeof f !== 'object') continue;
        const cur = Number(f.progress);
        if (!Number.isFinite(cur) || cur < pct) {
          f.progress = pct;
        }
      }
    } catch (e) { }
  }
  if (typeof parsedPercent === 'number' && Number.isFinite(parsedPercent)) {
    if (parsedPercent < 0) parsedPercent = 0;
    if (parsedPercent > 100) parsedPercent = 100;
    fileInfo.progress = parsedPercent;
  }

  // Parse speed (e.g., "123.4 MiB/s" or "45 KiB/s")
  const cleanedForMatch = stripAnsiAndControl(String(output == null ? '' : output));
  const speedMatch = cleanedForMatch.match(/(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)\/s/i);
  if (speedMatch) {
    const speedBytes = parseSpeedToBytes(speedMatch[1], speedMatch[2]);
    if (Number.isFinite(speedBytes)) {
      fileInfo.speedBytes = speedBytes;
      fileInfo.speed = formatSpeed(speedBytes);
    } else {
      fileInfo.speed = `${speedMatch[1]} ${speedMatch[2]}/s`;
      fileInfo.speedBytes = 0;
    }
  }

  // Parse ETA
  const etaMatch = cleanedForMatch.match(/ETA\s+(\S+)/);
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
  if (totalSpeedBytes > (download.peakSpeedBytes || 0)) {
    download.peakSpeedBytes = totalSpeedBytes;
  }

  // Update overall ETA for the download.
  try {
    const total = Number(download.totalSize) || 0;
    const doneBytes = Number(download.downloadedSize) || 0;
    const ema = Number(download.__emaSpeedBytesPerSec) || 0;
    if (total > 0 && ema > 0) {
      let activeBytes = 0;
      for (const f of activeFilesList) {
        if (!f) continue;
        const size = typeof f.size === 'number' ? f.size : 0;
        const p = typeof f.progress === 'number' ? f.progress : 0;
        if (size > 0 && p > 0 && p < 100) {
          activeBytes += Math.round((p / 100) * size);
        }
      }
      const bytesSoFar = Math.min(total, Math.max(0, doneBytes + activeBytes));
      const remainingBytes = Math.max(0, total - bytesSoFar);
      const etaSec = remainingBytes / Math.max(1, ema);
      download.eta = formatEtaSeconds(etaSec);
    } else {
      download.eta = '';
    }
  } catch (e) {
    download.eta = '';
  }

  // Track an EMA of observed throughput so the scheduler can estimate time-to-finish.
  try {
    const nowEma = Date.now();
    const sample = Number(totalSpeedBytes) || 0;
    const prevAt = Number(download.__emaSpeedLastAt) || 0;
    const prev = Number(download.__emaSpeedBytesPerSec) || 0;
    const dtMs = prevAt > 0 ? Math.max(0, nowEma - prevAt) : 0;
    // Adapt smoothing to update cadence (aiming for ~4s half-life-ish).
    const alpha = dtMs > 0 ? Math.min(0.5, Math.max(0.05, dtMs / 4000)) : 0.25;
    const next = (prev > 0) ? (prev * (1 - alpha) + sample * alpha) : sample;
    download.__emaSpeedBytesPerSec = Math.max(0, next);
    download.__emaSpeedLastAt = nowEma;
  } catch (e) { }

  // Update overall ETA for the download.
  try {
    const total = Number(download.totalSize) || 0;
    const doneBytes = Number(download.downloadedSize) || 0;
    const ema = Number(download.__emaSpeedBytesPerSec) || 0;
    if (total > 0 && ema > 0) {
      const activeBytes = (() => {
        let acc = 0;
        for (const f of activeFilesList) {
          if (!f) continue;
          const size = typeof f.size === 'number' ? f.size : 0;
          const p = typeof f.progress === 'number' ? f.progress : 0;
          if (size > 0 && p > 0 && p < 100) {
            acc += Math.round((p / 100) * size);
          }
        }
        return acc;
      })();
      const bytesSoFar = Math.min(total, Math.max(0, doneBytes + activeBytes));
      const remainingBytes = Math.max(0, total - bytesSoFar);
      const etaSec = remainingBytes / Math.max(1, ema);
      download.eta = formatEtaSeconds(etaSec);
    } else {
      download.eta = '';
    }
  } catch (e) {
    download.eta = '';
  }

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
    eta: download.eta || '',
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
  if (!Number.isFinite(num)) return NaN;

  const isBinary = unitLower.includes('ib');
  const k = isBinary ? 1024 : 1000;

  if (unitLower.startsWith('t')) return num * k * k * k * k;
  if (unitLower.startsWith('g')) return num * k * k * k;
  if (unitLower.startsWith('m')) return num * k * k;
  if (unitLower.startsWith('k')) return num * k;
  return num;
}

// Format bytes per second to human readable (decimal MB/s, not binary MiB/s)
function formatSpeed(bytesPerSec) {
  const bitsPerSec = (Number.isFinite(bytesPerSec) ? bytesPerSec : 0) * 8;
  const units = ['bp/s', 'Kbp/s', 'Mbp/s', 'Gbp/s', 'Tbp/s'];
  if (bitsPerSec <= 0) return '0 bp/s';
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bitsPerSec) / Math.log(1000))
  );
  const value = bitsPerSec / Math.pow(1000, i);
  const decimals = i >= 2 ? 1 : 0;
  const s = value.toFixed(decimals).replace(/\.0$/, '');
  return s + ' ' + units[i];
}

// Format seconds to human readable ETA
function formatEtaSeconds(totalSeconds) {
  try {
    const s = Math.floor(Number(totalSeconds));
    if (!Number.isFinite(s) || s <= 0) return '';
    const sec = s % 60;
    const min = Math.floor(s / 60) % 60;
    const hr = Math.floor(s / 3600) % 24;
    const day = Math.floor(s / 86400);
    if (day > 0) return `${day}d ${hr}h`;
    if (hr > 0) return `${hr}h ${min}m`;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
  } catch (e) {
    return '';
  }
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
  if (totalSpeedBytes > (download.peakSpeedBytes || 0)) {
    download.peakSpeedBytes = totalSpeedBytes;
  }

  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    status: download.status,
    progress: download.progress,
    statusMessage: download.statusMessage || '',
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
  if (!isValidDownloadId(downloadId)) return false;
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
  if (!isValidDownloadId(downloadId)) return false;
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
      } catch (e) { }
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
      const safeRel = sanitizeRelativePath(file && file.name ? String(file.name) : '');
      if (safeRel == null) {
        logToFile(`[isFileComplete] invalid file name: ${file && file.name ? String(file.name) : ''}`);
        return false;
      }
      const outputPath = resolveInside(downloadDir, safeRel);
      if (!outputPath) {
        logToFile(`[isFileComplete] unsafe file path: ${file && file.name ? String(file.name) : ''}`);
        return false;
      }
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

  try {
    for (const f of remainingFiles) {
      if (!f || !f.url) continue;
      const transformed = transformProxyUrlToDirectIfPossible(f.url);
      if (transformed && transformed !== f.url) {
        f.url = transformed;
      }
    }
  } catch (e) { }

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
    downloadedSize += normalizeFileSize(f.size);
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
  const getRequestedWorkersNow = () => {
    const requestedParallelNow = Number(settings && settings.maxConcurrentDownloads);
    return Math.min(20, Math.max(1, Number.isFinite(requestedParallelNow) ? requestedParallelNow : 3));
  };
  const requestedWorkers = getRequestedWorkersNow();

  let shouldApplyServerConcurrency = true;
  try {
    shouldApplyServerConcurrency = remainingFiles.some(f => isProxyDownloadUrl(f && f.url ? String(f.url) : ''));
  } catch (e) {
    shouldApplyServerConcurrency = true;
  }

  try {
    const manifestUrl = download && download.manifestUrl ? String(download.manifestUrl) : '';
    await refreshDownloadConcurrency(download, download.token, manifestUrl);
  } catch (e) {
    if (!Number.isFinite(download.effectiveConcurrency) || download.effectiveConcurrency <= 0) {
      download.effectiveConcurrency = requestedWorkers;
    }
  }

  const PARALLEL_DOWNLOADS = requestedWorkers;
  const fileQueue = [...remainingFiles];
  const activePromises = [];

  let concurrencyPoll = null;
  try {
    const manifestUrl = download && download.manifestUrl ? String(download.manifestUrl) : '';
    concurrencyPoll = setInterval(() => {
      if (!download || download.cancelled || download.paused) return;
      if (!fileQueue || fileQueue.length === 0) return;
      refreshDownloadConcurrency(download, download.token, manifestUrl);
    }, 30000);
  } catch (e) { }

  const processNext = async () => {
    while (fileQueue.length > 0 && !download.cancelled && !download.paused) {
      const eff = Number(download && download.effectiveConcurrency);
      const requestedWorkersNow = getRequestedWorkersNow();
      const limit = (Number.isFinite(eff) && eff > 0) ? Math.min(requestedWorkersNow, eff) : requestedWorkersNow;
      if (getActiveFileCount(download) >= limit) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

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

  // Allow increasing concurrency mid-resume by spawning additional worker loops.
  let concurrencyWorkerAdjust = null;
  try {
    concurrencyWorkerAdjust = setInterval(() => {
      try {
        if (!download || download.cancelled || download.paused) return;
        if (!fileQueue || fileQueue.length === 0) return;
        const desired = getRequestedWorkersNow();
        while (activePromises.length < Math.min(desired, fileQueue.length)) {
          activePromises.push(processNext());
        }
      } catch (e) {
      }
    }, 1000);
    if (concurrencyWorkerAdjust && typeof concurrencyWorkerAdjust.unref === 'function') {
      concurrencyWorkerAdjust.unref();
    }
  } catch (e) { }

  await Promise.all(activePromises);

  try {
    if (concurrencyPoll) clearInterval(concurrencyPoll);
  } catch (e) { }
  try {
    if (concurrencyWorkerAdjust) clearInterval(concurrencyWorkerAdjust);
  } catch (e) { }

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
  if (!isValidDownloadId(downloadId)) return false;
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

  // Ensure no stale running state leaks into the final server report.
  try { download.activeFiles = {}; } catch (e) { }
  try { download.activeProcesses = []; } catch (e) { }

  // Send a final progress event marking completion.
  // This makes the UI update even if the dedicated 'download-completed' event is missed.
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        status: 'completed',
        progress: 100,
        downloadedSize: download.downloadedSize,
        totalSpeed: formatSpeed(download.peakSpeedBytes || 0),
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

  const shouldExtract = !!(settings && settings.autoExtract7z) && !download.forceDisableAutoExtract;
  const downloadDir = path.join(settings.downloadPath, download.name || 'Download');

  if (shouldExtract) {
    const archives = find7zArchivesInDir(downloadDir);
    if (archives && archives.length > 0) {
      download.__armgddnFinalizing = true;
      download.status = 'extracting';
      download.progress = 99;
      download.totalSpeed = formatSpeed(download.peakSpeedBytes || 0);
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            status: 'extracting',
            progress: download.progress,
            downloadedSize: download.downloadedSize,
            totalSpeed: formatSpeed(download.peakSpeedBytes || 0),
            activeFiles: [],
            completedFiles: download.completedFiles,
            fileCount: download.fileCount
          });
        }
      } catch (e) { }

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
                totalSpeed: formatSpeed(download.peakSpeedBytes || 0),
                activeFiles: [],
                completedFiles: download.completedFiles,
                fileCount: download.fileCount,
                extractionError: download.extractionError
              });
            }
          } catch (e2) { }
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
  shell.openPath(settings.downloadPath);
});

// Open external URL in browser
ipcMain.handle('open-external', (event, url) => {
  // Security: Only allow HTTPS URLs
  try {
    if (typeof url !== 'string' || !url) return;
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname) return;
    shell.openExternal(u.toString());
  } catch (e) {
    return;
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
      path: '/repos/Nildyanna/armgddn-downloader/releases', // Fetch all releases to include prereleases for testing
      method: 'GET',
      headers: {
        'User-Agent': 'ARMGDDN-Companion',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      let bytes = 0;
      res.on('data', chunk => data += chunk);
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          try { res.destroy(new Error('Response too large')); } catch (e) { }
        }
      });
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          if (!Array.isArray(releases)) {
            resolve({ error: 'Invalid releases response' });
            return;
          }
          // Pick the most recent release by creation date (including prereleases for testing)
          const latestRelease = releases.reduce((latest, current) => {
            const latestDate = new Date(latest.created_at);
            const currentDate = new Date(current.created_at);
            return currentDate > latestDate ? current : latest;
          }, releases[0]);
          const release = latestRelease;
          const latestVersion = (release.tag_name || '').replace(/^v/, '');
          const currentVersion = app.getVersion();

          // Compare versions
          const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

          // Find the appropriate installer asset
          let installerUrl = null;
          let installerName = null;
          const assets = release.assets || [];
          const platform = process.platform;

          if (platform === 'win32') {
            // Look for .exe installer
            const exeAsset = assets.find(a => a.name.endsWith('.exe'));
            if (exeAsset) {
              installerUrl = exeAsset.browser_download_url;
              installerName = exeAsset.name;
            }
          } else if (platform === 'linux') {
            // Look for .AppImage or .deb
            const appImageAsset = assets.find(a => a.name.endsWith('.AppImage'));
            const debAsset = assets.find(a => a.name.endsWith('.deb'));
            if (appImageAsset) {
              installerUrl = appImageAsset.browser_download_url;
              installerName = appImageAsset.name;
            } else if (debAsset) {
              installerUrl = debAsset.browser_download_url;
              installerName = debAsset.name;
            }
          } else if (platform === 'darwin') {
            // Look for .dmg
            const dmgAsset = assets.find(a => a.name.endsWith('.dmg'));
            if (dmgAsset) {
              installerUrl = dmgAsset.browser_download_url;
              installerName = dmgAsset.name;
            }
          }

          // Require a matching signature asset for auto-install.
          // This avoids failing later with "Update signature missing" if the release is still
          // being published/signed or if a signature upload was skipped.
          if (installerUrl && installerName) {
            const sigName = `${installerName}.sig`;
            const sigAsset = assets.find(a => a && a.name === sigName);
            if (!sigAsset) {
              installerUrl = null;
            }
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

    req.setTimeout(10000, () => {
      try { req.destroy(new Error('Update check timeout')); } catch (e) { }
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

  // Show progress window
  let progressWinReady = false;
  const pendingUpdateEvents = [];
  const flushPendingUpdateEvents = () => {
    if (!progressWin || progressWin.isDestroyed() || !progressWinReady) return;
    while (pendingUpdateEvents.length > 0) {
      const evt = pendingUpdateEvents.shift();
      try {
        progressWin.webContents.send(evt.channel, evt.payload);
      } catch (e) { }
    }
  };
  const safeSendUpdateEvent = (channel, payload) => {
    if (!progressWin || progressWin.isDestroyed()) return;
    if (progressWinReady) {
      try {
        progressWin.webContents.send(channel, payload);
      } catch (e) { }
      return;
    }
    pendingUpdateEvents.push({ channel, payload });
  };
  try {
    progressWin = new BrowserWindow({
      width: 400,
      height: 380,
      title: 'Updating ARMGDDN Companion',
      parent: mainWindow, // Set parent so dialogs appear on top
      modal: false, // Keep non-modal to allow interaction
      frame: false, // Remove title bar
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true, // Ensure it stays on top during update
      icon: getAppIcon(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    progressWin.loadFile(path.join(__dirname, 'renderer', 'update.html'));
    try { progressWin.setMenu(null); } catch (e) { }
    try {
      progressWin.webContents.on('did-finish-load', () => {
        progressWinReady = true;
        flushPendingUpdateEvents();
      });
    } catch (e) { }
    progressWin.on('closed', () => {
      progressWin = null;
    });
  } catch (e) {
    logToFile('Failed to create update progress window: ' + e.message);
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

  const cleanupPartialInstaller = () => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) { }
  };
  const MAX_INSTALLER_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB safety cap
  // Signature assets live alongside the original GitHub release asset URL.
  // After redirects, the installer download URL often becomes a time-limited
  // objects.githubusercontent.com URL with query params; appending .sig to that
  // will fail. Always derive the signature URL from the original installerUrl.
  const signatureUrlBase = (() => {
    try {
      const u = new URL(installerUrl);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (e) {
      return (installerUrl || '').split('#')[0].split('?')[0];
    }
  })();

  return new Promise((resolve) => {
    const downloadSignature = (url, redirectCount = 0) => {
      return new Promise((resolveSig) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          resolveSig(result);
        };

        if (redirectCount > 5) {
          finish({ ok: false, error: 'Too many redirects' });
          return;
        }

        let parsed;
        try {
          parsed = new URL(url);
        } catch (e) {
          finish({ ok: false, error: 'Invalid signature URL' });
          return;
        }

        if (parsed.protocol !== 'https:') {
          finish({ ok: false, error: 'Only HTTPS update downloads are allowed' });
          return;
        }

        if (!isAllowedUpdateHost(parsed.hostname)) {
          finish({ ok: false, error: `Update download host not allowed (${parsed.hostname})` });
          return;
        }

        const reqSig = https.get(url, { headers: { 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
          let ended = false;
          res.on('aborted', () => {
            finish({ ok: false, error: 'Signature download aborted' });
          });
          res.on('close', () => {
            // Only treat close as a failure if it happens before the response ends.
            if (!ended) finish({ ok: false, error: 'Signature download closed early' });
          });

          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (!location) {
              finish({ ok: false, error: 'Redirect with no location' });
              return;
            }
            const nextUrl = location.startsWith('http') ? location : new URL(location, parsed).toString();
            downloadSignature(nextUrl, redirectCount + 1).then(finish);
            return;
          }

          if (res.statusCode !== 200) {
            finish({ ok: false, error: `Download failed with status ${res.statusCode}` });
            return;
          }

          let data = '';
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 65536) {
              try { res.destroy(new Error('Signature too large')); } catch (e) { }
              return;
            }
            data += chunk.toString('utf8');
          });
          res.on('end', () => {
            ended = true;
            finish({ ok: true, text: data });
          });
          res.on('error', (err) => {
            finish({ ok: false, error: err && err.message ? err.message : 'Signature download error' });
          });
        });

        reqSig.setTimeout(15000, () => {
          try { reqSig.destroy(new Error('Signature request timeout')); } catch (e) { }
        });
        reqSig.on('error', (err) => {
          finish({ ok: false, error: err && err.message ? err.message : 'Signature request error' });
        });
      });
    };

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

      const reqDl = https.get(url, { headers: { 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (!location) {
            cleanupPartialInstaller();
            resolve({ success: false, error: 'Redirect with no location' });
            return;
          }
          logToFile(`Update - redirect: from=${url} to=${location}`);
          const nextUrl = location.startsWith('http') ? location : new URL(location, parsed).toString();
          return downloadInstaller(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          cleanupPartialInstaller();
          resolve({ success: false, error: `Download failed with status ${res.statusCode}` });
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'], 10);
        if (Number.isFinite(totalBytes) && totalBytes > MAX_INSTALLER_BYTES) {
          cleanupPartialInstaller();
          resolve({ success: false, error: 'Installer too large' });
          try { res.destroy(new Error('Installer too large')); } catch (e) { }
          return;
        }

        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
        } catch (e) { }

        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);

        let receivedBytes = 0;
        let startTime = Date.now();

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_INSTALLER_BYTES) {
            try { res.destroy(new Error('Installer too large')); } catch (e) { }
            try { fileStream.destroy(new Error('Installer too large')); } catch (e) { }
            cleanupPartialInstaller();
            resolve({ success: false, error: 'Installer too large' });
            return;
          }
          if (progressWin && !progressWin.isDestroyed()) {
            const percent = totalBytes ? (receivedBytes / totalBytes) * 100 : 0;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? (receivedBytes / elapsed) : 0; // bytes/sec

            // Simple formatting for speed
            let speedStr = '';
            if (speed > 1024 * 1024) speedStr = (speed / (1024 * 1024)).toFixed(1) + ' MB/s';
            else speedStr = (speed / 1024).toFixed(1) + ' KB/s';

            safeSendUpdateEvent('update-progress', {
              percent,
              transferred: receivedBytes,
              total: totalBytes,
              speed: speedStr,
              status: 'Downloading update...'
            });
          }
        });

        fileStream.on('finish', () => {
          fileStream.close(() => {
            safeSendUpdateEvent('update-status', 'Verifying update...');

            let verifyResolved = false;
            const resolveOnce = (val) => {
              if (verifyResolved) return;
              verifyResolved = true;
              try {
                if (verifyTimeout) clearTimeout(verifyTimeout);
              } catch (e) { }
              resolve(val);
            };

            const VERIFY_TIMEOUT_MS = 20000;
            const verifyTimeout = setTimeout(() => {
              try {
                logToFile('Update - verification timed out');
              } catch (e) { }
              try { safeSendUpdateEvent('update-status', 'Manual update required: verification timed out.'); } catch (e) { }
              resolveOnce({ success: false, error: 'Update verification timed out' });
            }, VERIFY_TIMEOUT_MS);

            const failUpdate = (publicMsg, internalErr) => {
              try {
                logToFile(`Update - verification failed: ${internalErr || publicMsg}`);
              } catch (e) { }

              try { safeSendUpdateEvent('update-status', `Manual update required: ${publicMsg}`); } catch (e) { }
            };

            try {
              const pubKeyPem = getUpdateEd25519PublicKeyPem();
              if (!pubKeyPem) {
                failUpdate('Update verification unavailable (missing public key).', 'Missing Ed25519 public key');
                resolveOnce({ success: false, error: 'Update signature verification unavailable (missing public key)' });
                return;
              }
            } catch (e) {
              failUpdate('Update verification unavailable.', e && e.message ? e.message : 'Public key load error');
              resolveOnce({ success: false, error: 'Update signature verification unavailable' });
              return;
            }

            const sigUrl = `${signatureUrlBase}.sig`;
            try { safeSendUpdateEvent('update-status', 'Downloading signature...'); } catch (e) { }
            logToFile(`Update - verifying: downloading signature: ${sigUrl}`);
            const withTimeout = (p, ms, label) => {
              let t = null;
              const timeoutPromise = new Promise((_, reject) => {
                t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
              });
              return Promise.race([p, timeoutPromise]).finally(() => {
                try { if (t) clearTimeout(t); } catch (e) { }
              });
            };

            withTimeout(downloadSignature(sigUrl), 30000, 'signature download').then(async (sigRes) => {
              if (!sigRes || sigRes.ok !== true || !sigRes.text) {
                try {
                  logToFile(`Update - signature download failed: url=${sigUrl} err=${sigRes && sigRes.error ? sigRes.error : 'unknown'}`);
                } catch (e) { }
                failUpdate('Update signature missing.', sigRes && sigRes.error ? sigRes.error : 'Signature download failed');
                resolveOnce({ success: false, error: 'Update signature missing or could not be downloaded' });
                return;
              }

              const sigBuf = decodeBase64Signature(sigRes.text);
              if (!sigBuf) {
                failUpdate('Update signature invalid.', 'Invalid base64 signature');
                resolveOnce({ success: false, error: 'Update signature invalid' });
                return;
              }

              logToFile(`Update - verifying: reading installer: ${filePath}`);
              try { safeSendUpdateEvent('update-status', 'Reading installer...'); } catch (e) { }
              let installerBytes = null;
              try {
                installerBytes = await fs.promises.readFile(filePath);
              } catch (e) {
                failUpdate('Failed to read downloaded installer.', e && e.message ? e.message : 'Read error');
                resolveOnce({ success: false, error: 'Failed to read downloaded installer for verification' });
                return;
              }

              // Yield the event loop so the update window stays responsive even on large installers.
              await new Promise((r) => setImmediate(r));

              const pubKeyPem = getUpdateEd25519PublicKeyPem();
              try { safeSendUpdateEvent('update-status', 'Checking signature...'); } catch (e) { }
              logToFile('Update - verifying: checking Ed25519 signature');
              const ok = verifyEd25519Signature(installerBytes, sigBuf, pubKeyPem);
              if (!ok) {
                failUpdate('Update verification failed.', 'Ed25519 signature check failed');
                resolveOnce({ success: false, error: 'Update signature verification failed' });
                return;
              }

              safeSendUpdateEvent('update-status', 'Installing update... The app will restart shortly.');

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
                    const resultPath = path.join(app.getPath('userData'), 'update-result.json');
                    const runnerPath = path.join(tempDir, `armgddn-update-runner-${Date.now()}.cmd`);
                    const vbsPath = path.join(tempDir, `armgddn-update-runner-${Date.now()}.vbs`);

                    try {
                      fs.appendFileSync(wrapperLogPath, `[${new Date().toISOString()}] preparing update runner\r\n`, { encoding: 'utf8' });
                    } catch (e) { }

                    const installerQuoted = `"${filePath}"`;
                    const appQuoted = `"${process.execPath}"`;
                    const logQuoted = `"${wrapperLogPath}"`;
                    const resultQuoted = `"${resultPath}"`;
                    const silentArg = silent ? '/S' : '';
                    const runner = [
                      '@echo off',
                      `set "RESULT=${resultPath}"`,
                      `echo {^"ts^":${Date.now()},^"state^":^"starting^",^"logPath^":^"${wrapperLogPath.replace(/\\/g, '\\\\')}^"} > ${resultQuoted}`,
                      `echo [%DATE% %TIME%] runner start>>${logQuoted}`,
                      `echo [%DATE% %TIME%] pid=${pid}>>${logQuoted}`,
                      `echo [%DATE% %TIME%] installer=${installerQuoted}>>${logQuoted}`,
                      `echo [%DATE% %TIME%] silent=${silent ? 1 : 0} relaunch=${shouldRelaunch}>>${logQuoted}`,
                      ':wait',
                      `tasklist /FI "PID eq ${pid}" 2>NUL | find "${pid}" >NUL`,
                      'if "%ERRORLEVEL%"=="0" (timeout /t 1 /nobreak >NUL & goto wait)',
                      `echo [%DATE% %TIME%] parent exited>>${logQuoted}`,
                      `echo {^"ts^":${Date.now()},^"state^":^"installing^",^"logPath^":^"${wrapperLogPath.replace(/\\/g, '\\\\')}^"} > ${resultQuoted}`,
                      `start "" /wait ${installerQuoted} ${silentArg}`,
                      `echo [%DATE% %TIME%] installer finished rc=%ERRORLEVEL%>>${logQuoted}`,
                      `if "%ERRORLEVEL%"=="0" (echo {^"ts^":${Date.now()},^"state^":^"success^",^"exitCode^":0,^"logPath^":^"${wrapperLogPath.replace(/\\/g, '\\\\')}^"} > ${resultQuoted}) else (echo {^"ts^":${Date.now()},^"state^":^"failed^",^"exitCode^":%ERRORLEVEL%,^"logPath^":^"${wrapperLogPath.replace(/\\/g, '\\\\')}^"} > ${resultQuoted})`,
                      // Only relaunch if installer succeeded (exit code 0)
                      `if "%ERRORLEVEL%"=="0" (`,
                      shouldRelaunch ? `  start "" ${appQuoted}` : '  rem',
                      `) else (`,
                      `  echo [%DATE% %TIME%] installer failed with rc=%ERRORLEVEL%, cancelling relaunch>>${logQuoted}`,
                      `  rem installer failed; details are in update-wrapper.log`,
                      `)`,
                      `echo [%DATE% %TIME%] runner done>>${logQuoted}`,
                      'del "%~f0" >NUL 2>&1',
                      'exit /b 0'
                    ].join("\r\n");

                    const vbs = [
                      'On Error Resume Next',
                      'Dim sh',
                      'Set sh = CreateObject("WScript.Shell")',
                      // Run the cmd runner hidden (windowStyle=0) so we keep UX inside the Electron update window.
                      `sh.Run "cmd.exe /c """ & "${runnerPath}" & """", 0, False`,
                      'Set sh = Nothing'
                    ].join("\r\n");

                    try {
                      fs.writeFileSync(runnerPath, runner, { encoding: 'utf8' });
                      fs.writeFileSync(vbsPath, vbs, { encoding: 'utf8' });
                      logToFile(`Update - wrote cmd runner: ${runnerPath}`);
                      logToFile(`Update - wrote vbs runner: ${vbsPath}`);
                      logToFile(`Update - wrapper log: ${wrapperLogPath}`);
                    } catch (writeErr) {
                      logToFile(`Update - failed to write update runner: ${writeErr && writeErr.message ? writeErr.message : writeErr}`);
                      resolve({ success: false, error: 'Failed to prepare installer runner script' });
                      return;
                    }

                    logToFile(`Update - launching installer runner via shell.openPath (hidden vbs) (silent=${silent} relaunch=${relaunchAfterInstall})`);
                    shell.openPath(vbsPath);
                    setTimeout(() => {
                      app.isQuitting = true;
                      app.quit();
                      resolveOnce({ success: true });
                    }, 3000); // Increased delay to let user read the "Installing..." message
                    return;
                  } catch (spawnErr) {
                    logToFile(`Update - failed to spawn installer wrapper: ${spawnErr && spawnErr.message ? spawnErr.message : spawnErr}`);
                    resolveOnce({ success: false, error: 'Failed to launch installer process' });
                    return;
                  }

                  // Windows branch returns from the setTimeout above.
                } else if (platform === 'linux') {
                  logToFile(`Update - filePath: ${filePath}`);
                  logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);

                  if (filePath.endsWith('.AppImage')) {
                    // Make executable
                    fs.chmodSync(filePath, '755');

                    // Handle AppImage replacement if running as an AppImage
                    if (process.env.APPIMAGE) {
                      logToFile(`Update - Running as AppImage at ${process.env.APPIMAGE}`);
                      const currentPath = process.env.APPIMAGE;
                      const updateScriptPath = path.join(path.dirname(filePath), `update-armgddn-${Date.now()}.sh`);

                      // Create a script to replace the old AppImage with the new one
                      const scriptContent = [
                        '#!/bin/bash',
                        '# Wait for the main application to close',
                        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
                        '',
                        '# Move old version to backup',
                        `mv "${currentPath}" "${currentPath}.old"`,
                        '',
                        '# Move new version to original location',
                        `mv "${filePath}" "${currentPath}"`,
                        `chmod +x "${currentPath}"`,
                        '',
                        '# Launch new version',
                        `"${currentPath}" &`,
                        'exit 0'
                      ].join('\n');

                      try {
                        fs.writeFileSync(updateScriptPath, scriptContent, { mode: 0o755 });
                        logToFile(`Update - Created replacement script at ${updateScriptPath}`);

                        const child = spawn(updateScriptPath, [], {
                          detached: true,
                          stdio: 'ignore'
                        });
                        child.unref();

                        safeSendUpdateEvent('update-status', 'Restarting updated version...');

                        setTimeout(() => {
                          app.isQuitting = true;
                          app.quit();
                          resolve({ success: true, installerPath: filePath });
                        }, 3000); // Increased delay to allow installer to fully start
                        return;
                      } catch (err) {
                        logToFile(`Update - Failed to create/run replacement script: ${err.message}`);
                        // Fallback to simple launch if replacement fails
                      }
                    }

                    logToFile('Update - launching AppImage (no replacement)');

                    safeSendUpdateEvent('update-status', 'Restarting into new version...');

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
                      resolve({ success: true, installerPath: filePath });
                    }, 2000); // Increased delay for AppImage

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
                resolveOnce({ success: false, error: e.message });
              }
            }).catch((e) => {
              failUpdate('Update verification failed.', e && e.message ? e.message : 'Verification error');
              resolveOnce({ success: false, error: 'Update verification failed' });
            });
          });
        });

        fileStream.on('error', (err) => {
          cleanupPartialInstaller();
          resolve({ success: false, error: err.message });
        });
        res.on('error', (err) => {
          logToFile(`Update - download stream error: ${err.message}`);
          if (progressWin && !progressWin.isDestroyed()) progressWin.close();
          cleanupPartialInstaller();
          resolve({ success: false, error: 'Download stream error' });
        });

      });

      reqDl.setTimeout(300000, () => {
        try { reqDl.destroy(new Error('Update download timeout')); } catch (e) { }
      });
      reqDl.on('error', (err) => {
        logToFile(`Update - request error: ${err.message}`);
        if (progressWin && !progressWin.isDestroyed()) progressWin.close();
        cleanupPartialInstaller();
        resolve({ success: false, error: 'Update request error: ' + err.message });
      });
    };

    return downloadInstaller(installerUrl);
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
