'use strict';
// The app: links, version, connection, signing in, and updates (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const shortcutNames = require('../shortcutNames');
const updateRunner = require('../updateRunner');
const { verifySession, openAuthWindow } = require('./appWindows');
const { anyDownloadRunning } = require('./downloadControl');
const { getAppIcon } = require('./files');
const { logToFile } = require('./log');
const { safeUpdateResult, decodeBase64Signature, verifyEd25519Signature } = require('./updateCheck');
const { fetchLatestReleaseInfo, isAllowedUpdateHost, getUpdateEd25519PublicKeyPem, installScreen } = require('./updates');
const { denyNewWindows } = require('./windows');
const { spawn } = require('child_process');
const { ipcMain, shell, app, BrowserWindow } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');

function register() {
// Open external URL in browser
ipcMain.handle('open-external', (event, url) => {
  // Security: Only allow HTTPS URLs to allowlisted hostnames
  try {
    if (typeof url !== 'string' || !url) return { success: false, error: 'Invalid URL' };
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname) return { success: false, error: 'Only HTTPS allowed' };
    if (!ctx.ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      logToFile(`open-external rejected - host not allowed: ${u.hostname}`);
      return { success: false, error: 'Host not allowed' };
    }
    shell.openExternal(u.toString());
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Invalid URL' };
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
    hasSession: !!ctx.sessionToken,
    isValid: await verifySession()
  };
});

ipcMain.handle('check-updates', async () => safeUpdateResult(await fetchLatestReleaseInfo()));

// Download and install update
// Security (C1/H1): The renderer-supplied URL is ignored entirely. The installer URL is
// derived freshly in the main process from the GitHub releases API to prevent renderer
// compromise from redirecting the update to an attacker-controlled URL.
// The update install, as a function: the update bar calls it (install-update) and so does quitting with an update waiting (main.js,
// installUpdateOnQuit, Nov 24 2026). options: { silent, relaunchAfterInstall }.
async function installUpdate(options) {
  // A copy that is not the installed app (a dev run, a test copy that imported the real app's settings, auto-update included) must never run an
  // installer: it would silently replace the member's real Companion and relaunch it (a test copy did exactly that on 2026-11-18).
  if ((!app.isPackaged || require('./testBuild').isTestBuild) && process.env.ARMGDDN_ALLOW_DEV_UPDATE !== '1') {
    logToFile('Update - not installing from an unpackaged copy');
    return { success: false, error: 'Updates are only installed by the packaged app' };
  }
  if (ctx._installUpdateInProgress) {
    logToFile('install-update: another install is already in progress — ignoring duplicate call');
    return { success: false, error: 'Another update install is already in progress' };
  }
  try {
    const rp = path.join(app.getPath('userData'), 'update-result.json');
    if (fs.existsSync(rp) && updateRunner.installIsRunning(fs.readFileSync(rp, 'utf8'), fs.statSync(rp).mtimeMs)) {
      logToFile('install-update: an installer from an earlier start is still running -- not starting another');
      return { success: false, error: 'An update is already installing' };
    }
  } catch (e) { }
  // Updating restarts the app: with a download running, say so now and change nothing (the installer must not start and then be argued with at quit time).
  if (anyDownloadRunning()) {
    logToFile('install-update: a download is running; not updating now');
    return { success: false, error: 'A download is running. Pause or finish it, then update.' };
  }
  ctx._installUpdateInProgress = true;

  const opts = (options && typeof options === 'object') ? options : {};
  const silent = !!opts.silent;
  const relaunchAfterInstall = !!opts.relaunchAfterInstall;

  // Derive the installer URL internally — never trust the renderer-supplied value
  let installerUrl;
  let installerSize = 0;
  let updateVersion = '';
  try {
    const releaseInfo = await fetchLatestReleaseInfo();
    installerUrl = releaseInfo.installerUrl || null;
    installerSize = releaseInfo.installerSize || 0;
    updateVersion = /^\d+\.\d+\.\d+$/.test(String(releaseInfo.latestVersion || '')) ? String(releaseInfo.latestVersion) : '';
    if (!installerUrl) {
      ctx._installUpdateInProgress = false;
      return { success: false, error: 'No installer available for this platform' };
    }
  } catch (e) {
    ctx._installUpdateInProgress = false;
    return { success: false, error: 'Failed to fetch installer URL: ' + (e && e.message ? e.message : String(e)) };
  }

  // Enforce HTTPS + allowlisted host + expected GitHub releases path
  try {
    const u = new URL(String(installerUrl));
    if (u.protocol !== 'https:' || !isAllowedUpdateHost(u.hostname)) {
      logToFile(`Update - installer URL not allowed: host=${u.hostname} url=${installerUrl}`);
      ctx._installUpdateInProgress = false;
      return { success: false, error: `Installer URL not allowed (${u.hostname})` };
    }
    // Enforce that the path is a GitHub releases asset path
    const p = u.pathname;
    if (u.hostname === 'github.com' && !p.startsWith('/Nildyanna/armgddn-downloader/releases/')) {
      logToFile(`Update - installer path rejected: ${p}`);
      ctx._installUpdateInProgress = false;
      return { success: false, error: 'Installer URL path not allowed' };
    }
  } catch (e) {
    ctx._installUpdateInProgress = false;
    return { success: false, error: 'Invalid installer URL' };
  }

  // The ARMGDDN App (native window) shows the update inside its own window: download, checking and "closing to install" arrive on
  // native:update, and the install screen that follows looks like the app (updateRunner.screenSpec). The old app keeps the popup window.
  const nativeAlive = () => { try { return !!ctx.nativeWindow && !ctx.nativeWindow.isDestroyed(); } catch (e) { return false; } };
  const inApp = ctx.NATIVE_PREVIEW && nativeAlive();
  // Show progress window
  let progressWinReady = false;
  const pendingUpdateEvents = [];
  const flushPendingUpdateEvents = () => {
    if (!ctx.progressWin || ctx.progressWin.isDestroyed() || !progressWinReady) return;
    while (pendingUpdateEvents.length > 0) {
      const evt = pendingUpdateEvents.shift();
      try {
        ctx.progressWin.webContents.send(evt.channel, evt.payload);
      } catch (e) { }
    }
  };
  const safeSendUpdateEvent = (channel, payload) => {
    if (inApp) { try { if (nativeAlive()) ctx.nativeWindow.webContents.send('native:update', { channel, payload, version: updateVersion }); } catch (e) { } return; }
    if (!ctx.progressWin || ctx.progressWin.isDestroyed()) return;
    if (progressWinReady) {
      try {
        ctx.progressWin.webContents.send(channel, payload);
      } catch (e) { }
      return;
    }
    pendingUpdateEvents.push({ channel, payload });
  };
  if (!inApp) try {
    ctx.progressWin = new BrowserWindow({
      width: 400,
      height: 380,
      title: 'Updating ARMGDDN App',
      // On Linux/KDE, setting parent creates a WM_TRANSIENT_FOR hint that causes KDE's
      // compositor to raise the parent (main) window whenever this window is shown or
      // receives focus. Remove the parent relationship on Linux — alwaysOnTop + skipTaskbar
      // are sufficient to keep the update overlay correctly positioned.
      ...(process.platform !== 'linux' ? { parent: ctx.mainWindow, modal: false } : {}),
      frame: false, // Remove title bar
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true, // Don't clutter the taskbar with the update overlay
      alwaysOnTop: true, // Ensure it stays on top during update
      icon: getAppIcon(),
      webPreferences: {
        preload: path.join(ctx.__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    denyNewWindows(ctx.progressWin);

    ctx.progressWin.loadFile(path.join(ctx.__dirname, 'renderer', 'update.html'));
    try { ctx.progressWin.setMenu(null); } catch (e) { }
    try {
      ctx.progressWin.webContents.on('did-finish-load', () => {
        progressWinReady = true;
        flushPendingUpdateEvents();
      });
    } catch (e) { }
    ctx.progressWin.on('closed', () => {
      ctx.progressWin = null;
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
    // Wrap resolve so _installUpdateInProgress is always cleared on failure paths.
    // On the Windows success path the process is about to quit, so we leave the
    // flag set to prevent any race-window duplicate while the quit is pending.
    // IMPORTANT: capture the original Promise resolve before shadowing it —
    // otherwise _resolve calls itself and blows the stack.
    const _originalResolve = resolve;
    const _resolve = (val) => {
      if (!val || val.success === false) {
        ctx._installUpdateInProgress = false;
      }
      _originalResolve(val);
    };
    // Shadow `resolve` so all existing raw resolve() calls below use the wrapper.
    // eslint-disable-next-line no-param-reassign
    resolve = _resolve;

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
          if (ctx.progressWin && !ctx.progressWin.isDestroyed()) {
            safeSendUpdateEvent('update-progress', updateRunner.progressPayload(receivedBytes, totalBytes, installerSize, (Date.now() - startTime) / 1000));
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
              // On failure paths, clear the in-progress flag so the user can retry.
              // On the Windows success path the process is about to quit anyway.
              if (!val || val.success === false) {
                ctx._installUpdateInProgress = false;
              }
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
                  // Security (C2/M5): Use PowerShell with single-quoted paths to prevent
                  // batch metacharacter injection. Runner scripts written to userData
                  // (user-owned) instead of temp (world-writable).
                  try {
                    const pid = process.pid;
                    const shouldRelaunch = relaunchAfterInstall;
                    const wrapperLogPath = path.join(app.getPath('userData'), 'update-wrapper.log');
                    const resultPath = path.join(app.getPath('userData'), 'update-result.json');
                    // Write runner to userData (user-owned, not world-writable) — fixes M5
                    const runnerPath = path.join(app.getPath('userData'), `armgddn-update-runner-${Date.now()}.ps1`);
                    // Prefer relaunching via the Start Menu shortcut: a shell-activated launch
                    // (same as the user double-clicking it) gives Windows the correct taskbar
                    // icon (via the shortcut's AppUserModelID) and foreground rights. Launching
                    // the bare exe from the detached runner loses both. Fall back to the exe.
                    const startMenuShortcut = (process.platform === 'win32' && process.env.APPDATA)
                      ? shortcutNames.startMenuShortcutPath(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), fs)
                      : '';

                    // Escape single quotes for PowerShell single-quoted strings by doubling them
                    function escapePsPath(p) {
                      return "'" + String(p).replace(/'/g, "''") + "'";
                    }

                    try {
                      fs.appendFileSync(wrapperLogPath, `[${new Date().toISOString()}] preparing update runner\r\n`, { encoding: 'utf8' });
                    } catch (e) { }

                    // --updated makes the NSIS installer keep the user's existing shortcuts (it
                    // only does that for updates); without it every update recreated the Start
                    // Menu shortcut, even after the user moved or deleted it.
                    const silentArg = silent ? '/S --updated' : '--updated';
                    const runner = updateRunner.buildRunner({
                      pid, filePath, appExe: process.execPath, wrapperLogPath, resultPath, silentArg, shouldRelaunch, shortcut: startMenuShortcut, appName: ctx.NATIVE_PREVIEW ? 'ARMGDDN App' : 'ARMGDDN Companion',
                      screen: inApp ? installScreen(opts.screen, updateVersion) : null
                    });
                    // Tell any app that starts while the installer works (the member opens it again) not to start a second install.
                    try { fs.writeFileSync(resultPath, JSON.stringify({ state: 'installing', ts: Date.now() })); } catch (e) { }

                    try {
                      fs.writeFileSync(runnerPath, runner, { encoding: 'utf8' });
                      logToFile(`Update - wrote ps1 runner: ${runnerPath}`);
                      logToFile(`Update - wrapper log: ${wrapperLogPath}`);
                    } catch (writeErr) {
                      logToFile(`Update - failed to write update runner: ${writeErr && writeErr.message ? writeErr.message : writeErr}`);
                      resolve({ success: false, error: 'Failed to prepare installer runner script' });
                      return;
                    }

                    logToFile(`Update - launching PowerShell runner (silent=${silent} relaunch=${relaunchAfterInstall})`);
                    // Launch PowerShell hidden and detached.
                    // Use the absolute System32 path — NEVER bare 'powershell.exe' — so a
                    // powershell.exe shim earlier in the user's PATH cannot shadow the real
                    // host (that exact case caused the updater to silently no-op).
                    // Launch via `cmd /c start` so the runner (a) gets a console — Windows
                    // PowerShell's host fails to initialize under DETACHED_PROCESS with no
                    // console — and (b) outlives this app when it quits a moment later.
                    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
                    const psChild = spawn(process.env.COMSPEC || 'cmd.exe', [
                      '/c', 'start', '/min', '""', psExe,
                      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
                      '-ExecutionPolicy', 'Bypass',
                      '-File', runnerPath
                    ], { detached: true, stdio: 'ignore', windowsHide: true });
                    psChild.unref();
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

                      // Security (H2): Escape all paths inserted into bash using single-quote
                      // wrapping to prevent shell metacharacter injection from APPIMAGE env var.
                      function escapeBashSingleQuote(p) {
                        return "'" + String(p).replace(/'/g, "'\\''") + "'";
                      }

                      // Create a script to replace the old AppImage with the new one
                      const scriptContent = [
                        '#!/bin/bash',
                        '# Wait for the main application to close',
                        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
                        '',
                        '# Move old version to backup',
                        `mv ${escapeBashSingleQuote(currentPath)} ${escapeBashSingleQuote(currentPath + '.old')}`,
                        '',
                        '# Move new version to original location',
                        `mv ${escapeBashSingleQuote(filePath)} ${escapeBashSingleQuote(currentPath)}`,
                        `chmod +x ${escapeBashSingleQuote(currentPath)}`,
                        '',
                        '# Launch new version',
                        `${escapeBashSingleQuote(currentPath)} &`,
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
          if (ctx.progressWin && !ctx.progressWin.isDestroyed()) ctx.progressWin.close();
          cleanupPartialInstaller();
          resolve({ success: false, error: 'Download stream error' });
        });

      });

      reqDl.setTimeout(300000, () => {
        try { reqDl.destroy(new Error('Update download timeout')); } catch (e) { }
      });
      reqDl.on('error', (err) => {
        logToFile(`Update - request error: ${err.message}`);
        if (ctx.progressWin && !ctx.progressWin.isDestroyed()) ctx.progressWin.close();
        cleanupPartialInstaller();
        resolve({ success: false, error: 'Update request error: ' + err.message });
      });
    };

    return downloadInstaller(installerUrl);
  });
}
ipcMain.handle('install-update', (event, _ignoredRendererUrl, options) => installUpdate(options));
module.exports.installUpdate = installUpdate;
}

module.exports.register = register;
