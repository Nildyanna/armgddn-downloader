'use strict';
// The app's windows: the main window, tray, menu, sign-in window, settings and about, and the graphics fallback (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { clearLoginTraces } = require('./auth');
const { flushPendingDeepLinks } = require('./deepLinks');
const { sendToMain, withDialogFocusSync, getDialogParentWindow, showAppWindow } = require('./dialogs');
const { getAppIcon } = require('./files');
const { debugLog, getDebugLogPath, logToFile } = require('./log');
const { saveSession } = require('./session');
const { mintAppSessionTokenFromCookies, isAllowedServiceHost } = require('./siteApi');
const { isAutostartLaunch } = require('./updateCheck');
const { checkForUpdatesFromMenu } = require('./updates');
const { denyNewWindows } = require('./windows');
const Sentry = require('@sentry/electron/main');
const { BrowserWindow, app, dialog, nativeImage, Tray, Menu, shell } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');

function armNoGpuProcess(why) {
  try {
    if (!ctx.GPU_HARD_MARKER || ctx.noGpuProcess || fs.existsSync(ctx.GPU_HARD_MARKER)) return false;
    fs.writeFileSync(ctx.GPU_HARD_MARKER, `${new Date().toISOString()} ${why}\n`);
    console.warn('[gpu] GPU process failed with software drawing on (' + why + '); no GPU process from next launch');
    return true;
  } catch (e) { return false; }
}

// Sentry tag so a GPU crash on a PC already in software mode (fallback not
// enough) can be told apart from a first crash: on / off / armed (marker
// written this session, takes effect next launch) / hard (no GPU process) / hard-armed.
function setGpuFallbackTag(value) {
  try { if (ctx.SENTRY_DSN) Sentry.setTag('gpu_fallback', value); } catch (e) { }
}

function openAuthWindow() {
  return new Promise((resolve) => {
    if (ctx.authWindow) {
      ctx.authWindow.focus();
      return resolve(false);
    }
    // No saved sign-in on this PC means the member is signing in (again): start from a clean Telegram state, so an old account's cookie cannot answer for them.
    const _ready = ctx.sessionToken ? Promise.resolve() : clearLoginTraces();
    _ready.then(() => {
    ctx.authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      // On Linux/KDE, parent + modal sets WM_TRANSIENT_FOR which causes KDE's compositor
      // to raise the parent window whenever the modal receives focus — the root cause of
      // the "background window jumps to front" bug. Remove the relationship on Linux; the
      // window still behaves functionally as a login step via app-level logic.
      ...(process.platform !== 'linux' ? { parent: ctx.mainWindow, modal: true } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      },
      icon: getAppIcon(),
      title: 'Login to ARMGDDN App'
    });
    denyNewWindows(ctx.authWindow, ['oauth.telegram.org']);

    // companionAuth=1 tells the site this is the re-auth popup, not a real visit —
    // it skips the full-site login animation/audio, which would otherwise fire as if
    // this were a first-ever visit (this popup uses its own separate Electron session,
    // isolated from any browser the user normally logs in with).
    ctx.authWindow.loadURL('https://armgddnbrowser.com/?companionAuth=1');

    // Block navigations to non-armgddnbrowser.com origins
    ctx.authWindow.webContents.on('will-navigate', (event, url) => {
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host !== 'armgddnbrowser.com' && host !== 'www.armgddnbrowser.com') {
          event.preventDefault();
        }
      } catch (e) { event.preventDefault(); }
    });

    // Check for successful login by monitoring cookies and minting an app session token
    let authChecking = false;
    const checkAuth = async () => {
      if (authChecking || !ctx.authWindow || ctx.authWindow.isDestroyed() || ctx.sessionToken) return;
      authChecking = true;
      try {
        const cookies = await ctx.authWindow.webContents.session.cookies.get({ name: '__Secure-ag_auth' });

        const agAuthCookie = cookies.find((c) => {
          const domain = String(c && c.domain ? c.domain : '').toLowerCase();
          const hasValue = !!(c && c.value);
          return hasValue && (domain === 'armgddnbrowser.com' || domain === '.armgddnbrowser.com' || domain === 'www.armgddnbrowser.com');
        });
        if (agAuthCookie) {
          const allCookies = await ctx.authWindow.webContents.session.cookies.get({});
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
            ctx.authWindow.close();
            resolve(true);
          } catch (e) {
            logToFile('Token mint error: ' + (e && e.message ? e.message : String(e)));
          }
        }
      } catch (e) {
        logToFile('Auth check error: ' + e.message);
      } finally {
        authChecking = false;
      }
    };

    // Check auth status when page finishes loading
    ctx.authWindow.webContents.on('did-finish-load', () => {
      // Give a moment for cookies to be set
      setTimeout(checkAuth, 1000);
    });

    // Also check on navigation
    ctx.authWindow.webContents.on('did-navigate', () => {
      setTimeout(checkAuth, 1000);
    });
    ctx.authWindow.webContents.on('did-navigate-in-page', () => {
      setTimeout(checkAuth, 1000);
    });

    // The site finishes a Telegram login on the page itself (no reload, no navigation), so the two checks above never run again after the member
    // confirms in Telegram and the window just stays open (Dominic, 2026-11-22). Look every 1.5 s for as long as the window is open.
    const authPoll = setInterval(() => {
      if (!ctx.authWindow || ctx.authWindow.isDestroyed()) { clearInterval(authPoll); return; }
      checkAuth();
    }, 1500);

    ctx.authWindow.on('closed', () => {
      clearInterval(authPoll);
      ctx.authWindow = null;
      resolve(!!ctx.sessionToken);
    });
    });
  });
}

// Verify session is still valid
async function verifySession() {
  if (!ctx.sessionToken) return false;

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
          'Authorization': 'Bearer ' + ctx.sessionToken
        },
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        // Follow redirects — Security (M2): validate redirect host against allowlist
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            const redirectUrl = location.startsWith('http') ? location : `https://${urlObj.hostname}${location}`;
            try {
              const redirectHostname = new URL(redirectUrl).hostname;
              if (!isAllowedServiceHost(redirectHostname)) {
                logToFile(`verifySession: redirect to disallowed host blocked: ${redirectHostname}`);
                return resolve(false);
              }
            } catch (e) {
              return resolve(false);
            }
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
  const windowIcon = getAppIcon();

  ctx.mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(ctx.__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: ctx.isOwnerDevToolsAllowed
    },
    icon: windowIcon,
    show: false
  });
  denyNewWindows(ctx.mainWindow);

  try { require('../native/hangWatch').watchWindow(ctx.mainWindow, debugLog, 'Classic'); } catch (e) { }
  ctx.mainWindowDidFinishLoad = false;

  ctx.mainWindow.loadFile(path.join(ctx.__dirname, 'renderer', 'index.html'));

  // Block any navigation away from the local renderer files
  ctx.mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'file:') event.preventDefault();
    } catch (e) { event.preventDefault(); }
  });

  ctx.mainWindow.webContents.on('did-finish-load', () => {
    ctx.mainWindowDidFinishLoad = true;
    // Give the renderer a moment to register IPC listeners.
    setTimeout(() => flushPendingDeepLinks(), 50);
    if (ctx.pendingWhatsNewEntry) {
      const entry = ctx.pendingWhatsNewEntry;
      ctx.pendingWhatsNewEntry = null; // Show once per version bump, never again this run
      setTimeout(() => {
        try { sendToMain('show-whats-new', entry); } catch (e) { }
      }, 50);
    }
  });

  ctx.mainWindow.once('ready-to-show', () => {
    if (ctx.NATIVE_PREVIEW) return;   // preview run: only the native window is shown (the classic window stays hidden)
    // After an in-app update the runner relaunches us with --updated. Always bring the
    // window to the foreground in that case (ignore start-minimized), since the user
    // just initiated the update and expects the app back in front.
    const launchedFromUpdate = process.argv.includes('--updated');
    const shouldStartMinimized = !launchedFromUpdate && !!(ctx.settings && ctx.settings.startWithOsMinimized) && isAutostartLaunch();
    if (shouldStartMinimized) {
      // If user prefers tray-minimize behavior, do not show the window at all.
      if (ctx.settings && ctx.settings.minimizeToTrayOnMinimize) {
        try { ctx.mainWindow.hide(); } catch (e) { }
        return;
      }
      // Otherwise, show minimized on the taskbar.
      try { ctx.mainWindow.show(); } catch (e) { }
      try { ctx.mainWindow.minimize(); } catch (e) { }
    } else {
      if (process.platform === 'win32') {
        ctx.mainWindow.show();
        // ARMGDDN - Taskbar "nudge" to fix icon not showing up on launch
        ctx.mainWindow.setSkipTaskbar(true);
        setTimeout(() => {
          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            ctx.mainWindow.setSkipTaskbar(false);
          }
        }, 100);
      } else if (process.platform === 'linux') {
        ctx.mainWindow.show();
        // On KDE Plasma, moveTop() ensures the window lands on top of the stack
        // even when the WM applies focus-stealing prevention at startup.
        try { ctx.mainWindow.moveTop(); } catch (e) { }
      } else {
        ctx.mainWindow.show();
      }
    }
    // After an update relaunch, force the window to the foreground. A process launched
    // from the background (the detached update runner) can't normally steal focus on
    // Windows; toggling alwaysOnTop briefly bypasses the foreground lock reliably.
    if (launchedFromUpdate) {
      try {
        if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
        ctx.mainWindow.show();
        ctx.mainWindow.setAlwaysOnTop(true);
        ctx.mainWindow.focus();
        try { ctx.mainWindow.moveTop(); } catch (e) { }
        setTimeout(() => {
          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            try { ctx.mainWindow.setAlwaysOnTop(false); } catch (e) { }
          }
        }, 400);
      } catch (e) { }
    }
    // Force icon again to ensure taskbar update
    if (windowIcon && !windowIcon.isEmpty()) {
      ctx.mainWindow.setIcon(windowIcon);
    }
  });

  // Minimize / close behavior (configurable via settings)
  ctx.mainWindow.on('minimize', (event) => {
    if (ctx.settings && ctx.settings.minimizeToTrayOnMinimize) {
      event.preventDefault();
      ctx.mainWindow.hide();
    }
  });

  ctx.mainWindow.on('close', (event) => {
    // Default behavior: actually close the window / quit the app
    // Only hide to tray when explicitly enabled in settings
    if (!app.isQuitting && ctx.settings && ctx.settings.minimizeToTrayOnClose) {
      event.preventDefault();
      ctx.mainWindow.hide();
      return;
    }

    // If downloads are running, ask for confirmation before quitting. A paused download is not running (Dirk paused his and was still asked), and when the
    // app is quitting to install an update the question was asked before the installer started: asking again, and cancelling, left the old app open next to
    // an installer that went ahead (Dirk, Nov 20).
    const activeCount = Array.from(ctx.activeDownloads.values()).filter((d) => d && ['in_progress', 'downloading', 'starting'].includes(d.status)).length;
    if (activeCount > 0 && !ctx._installUpdateInProgress && !ctx._closeConfirmed) {
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
  if (!app.isPackaged && ctx.isOwnerDevToolsAllowed && !ctx.NATIVE_PREVIEW) {
    ctx.mainWindow.webContents.openDevTools();
  }
}

// Create tray
function createTray() {
  const iconPath = path.join(ctx.__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  ctx.tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const showMainWindow = () => {
    if (showAppWindow()) return;
    if (ctx.NATIVE_PREVIEW) return;          // the old window is never shown in the native app (6.0.2: the tray used to bring it up when the native window was gone)
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return;
    ctx.mainWindow.show();
    // On KDE Plasma, moveTop() is needed to raise the window above other open apps.
    // focus() is blocked by KDE's focus-stealing prevention for tray-icon activations.
    if (process.platform === 'linux') {
      try { ctx.mainWindow.moveTop(); } catch (e) { }
    }
  };

  const buildTrayMenu = () => Menu.buildFromTemplate([
    { label: 'Show', click: showMainWindow },
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

  ctx.tray.setToolTip(ctx.NATIVE_PREVIEW ? 'ARMGDDN App' : 'ARMGDDN Companion');
  ctx.tray.setContextMenu(buildTrayMenu());

  ctx.tray.on('click', showMainWindow);
  // KDE Plasma may route tray activation as double-click depending on system settings
  ctx.tray.on('double-click', showMainWindow);
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
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { label: 'Check for updates', click: () => checkForUpdatesFromMenu() },
        { type: 'separator' },
        ...(process.platform === 'darwin' ? [{ role: 'close' }] : [{ label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }])
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
            await shell.openExternal('https://t.me/+xuCOd3HqpGdmZjFh');
          }
        },
        { label: 'Open the log folder', click: () => { try { shell.openPath(path.dirname(getDebugLogPath())); } catch (e) { } } },
        { type: 'separator' },
        { label: ctx.NATIVE_PREVIEW ? 'About ARMGDDN App' : 'About ARMGDDN Companion', click: () => showAboutDialog() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Menu actions (File / Help) that work the same whichever window is open: the app's own Settings, an update check, and the switch between the
// classic and the native window. A Companion whose window had no way to reach its Settings left a member stuck in the wrong window.
function openSettingsWindow() {
  try {
    if (ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) {
      if (ctx.nativeWindow.isMinimized()) ctx.nativeWindow.restore();
      ctx.nativeWindow.show(); ctx.nativeWindow.focus();
      ctx.nativeWindow.webContents.send('native:open', { view: 'settings' });
      return;
    }
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
      ctx.mainWindow.show(); ctx.mainWindow.focus();
      ctx.mainWindow.webContents.executeJavaScript("(function(){var b=document.getElementById('settings-btn');if(b)b.click();})()").catch(() => { });
    }
  } catch (e) { logToFile('openSettingsWindow failed: ' + e.message); }
}

// Help > About: the version and what it runs on, with a button that copies those details for a support message.
function showAboutDialog() {
  try {
    const name = ctx.NATIVE_PREVIEW ? 'ARMGDDN App' : 'ARMGDDN Companion';
    const details = [name + ' v' + app.getVersion(), 'Electron ' + process.versions.electron + ', Chromium ' + process.versions.chrome, process.platform + ' ' + process.arch + (ctx.NATIVE_PREVIEW ? ', built-in window' : ', classic window')].join('\n');
    const win = (ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) ? ctx.nativeWindow : ((ctx.mainWindow && !ctx.mainWindow.isDestroyed()) ? ctx.mainWindow : null);
    const opts = { type: 'info', title: 'About ' + name, message: name, detail: 'Version ' + app.getVersion() + '\nCreated by Old Man of the Hills\n\n' + details.split('\n').slice(1).join('\n'), buttons: ['OK', 'Copy details'], defaultId: 0, cancelId: 0 };
    (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then((r) => { if (r && r.response === 1) { try { require('electron').clipboard.writeText(details); } catch (e) { } } }).catch(() => { });
  } catch (e) { logToFile('showAboutDialog failed: ' + e.message); }
}

module.exports = { armNoGpuProcess, setGpuFallbackTag, openAuthWindow, verifySession, createWindow, createTray, createAppMenu, openSettingsWindow, showAboutDialog };
