'use strict';
// App updates: finding a new release, checking it is genuine, the hourly check and the install screen (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { logToFile } = require('./log');
const { safeUpdateResult } = require('./updateCheck');
const { compareVersions } = require('./util');
const { app } = require('electron');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

function getUpdateEd25519PublicKeyPem() {
  // Allow env-var override for key rotation during development/testing
  const v = process.env.ARMGDDN_UPDATE_ED25519_PUBKEY_PEM;
  if (v && typeof v === 'string' && v.trim()) {
    return v.trim();
  }

  // Use the pinned constant — do not read from disk at runtime (tamper-resistant)
  return ctx.UPDATE_ED25519_PUBLIC_KEY_PINNED;
}

function isAllowedUpdateHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (ctx.ALLOWED_UPDATE_HOSTS.has(h)) return true;
  if (/^github-production-release-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(h)) return true;
  return false;
}

function checkForUpdatesFromMenu() {
  try {
    if (ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) {
      if (ctx.nativeWindow.isMinimized()) ctx.nativeWindow.restore();
      ctx.nativeWindow.show(); ctx.nativeWindow.focus();
      ctx.nativeWindow.webContents.send('native:open', { view: 'settings', check: true });
      return;
    }
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
      ctx.mainWindow.show(); ctx.mainWindow.focus();
      ctx.mainWindow.webContents.executeJavaScript("(function(){var b=document.getElementById('check-updates-btn');if(b)b.click();})()").catch(() => { });
    }
  } catch (e) { logToFile('checkForUpdatesFromMenu failed: ' + e.message); }
}

function getWhatsNewForVersion(version) {
  try {
    if (ctx.whatsNewContentCache === null) {
      const whatsNewPath = path.join(ctx.__dirname, 'renderer', 'whats-new.json');
      ctx.whatsNewContentCache = fs.existsSync(whatsNewPath)
        ? JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'))
        : {};
    }
    const entry = ctx.whatsNewContentCache && typeof ctx.whatsNewContentCache === 'object'
      ? ctx.whatsNewContentCache[version]
      : null;
    return entry ? { version, ...entry } : null;
  } catch (e) {
    try { logToFile(`[WhatsNew] failed to read/parse whats-new.json: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
    return null;
  }
}

// Shared update-check logic — returns full result including installerUrl (for internal use only).
// The check-updates IPC handler strips installerUrl before returning to renderer (C1/H1).
function fetchLatestReleaseInfo() {
  return new Promise((resolve) => {
    // CI smoke test: never call GitHub (shared runner IPs get rate limited, and any
    // console error fails the smoke test).
    if (ctx.SMOKE_TEST) { resolve({ hasUpdate: false, version: app.getVersion() }); return; }
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
            // GitHub answers an object like {"message":"API rate limit exceeded ..."} (403/429)
            // when an IP makes too many unauthenticated requests. Not an app error: say so.
            const msg = releases && typeof releases.message === 'string' ? releases.message : '';
            if (res.statusCode === 403 || res.statusCode === 429 || /rate limit/i.test(msg)) {
              resolve({ hasUpdate: false, version: app.getVersion(), rateLimited: true,
                error: 'GitHub is limiting update checks from your network right now. Try again in a little while.' });
              return;
            }
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
          const newerExists = compareVersions(latestVersion, currentVersion) > 0;
          const osTooOld = newerExists && macTooOldForRelease(latestVersion, process.platform, os.release());
          const hasUpdate = newerExists && !osTooOld;

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

          let installerSize = 0;
          try { const a = (release.assets || []).find(x => x && x.browser_download_url === installerUrl); installerSize = a && Number(a.size) > 0 ? Number(a.size) : 0; } catch (e) { }
          resolve({
            hasUpdate,
            version: currentVersion,
            latestVersion,
            osTooOld,
            installerSize,
            notice: osTooOld ? `Version ${latestVersion} needs macOS 13 or newer, so it isn't offered on this Mac. You can keep using v${currentVersion}.` : '',
            releaseUrl: release.html_url || 'https://github.com/Nildyanna/armgddn-downloader/releases',
            installerUrl,  // Only used internally; stripped before sending to renderer
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
}

async function pollForUpdateOnce() {
  try {
    if (ctx.SMOKE_TEST) return;
    if (!app.isPackaged && process.env.ARMGDDN_ALLOW_DEV_UPDATE !== '1') return;          // a test or dev copy never announces updates
    if (ctx._installUpdateInProgress) return;
    const raw = await fetchLatestReleaseInfo();
    if (!raw || raw.error || !raw.hasUpdate || !raw.latestVersion) return;
    if (ctx._updateAnnouncedVersion === raw.latestVersion) return;                              // already told them about this one
    ctx._updateAnnouncedVersion = raw.latestVersion;
    logToFile(`[Update] hourly check: version ${raw.latestVersion} is available (running ${app.getVersion()})`);
    ctx.showDownloadNotification(ctx.NATIVE_PREVIEW ? 'ARMGDDN App update available' : 'ARMGDDN Companion update available', `Version ${raw.latestVersion} is ready. Open ${ctx.NATIVE_PREVIEW ? 'ARMGDDN App' : 'the Companion'} to install it.`);
    const info = safeUpdateResult(raw);
    // The native window has its own update bar; the hidden classic window must not pop a prompt of its own (Nov 20).
    try { if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !(ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed())) ctx.mainWindow.webContents.send('update-available', info); } catch (e) { }
    try { if (ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) ctx.nativeWindow.webContents.send('native:updateAvailable', info); } catch (e) { }
  } catch (e) { logToFile('[Update] hourly check failed: ' + (e && e.message ? e.message : e)); }
}

function startUpdatePoller() {
  try { setInterval(pollForUpdateOnce, ctx.UPDATE_POLL_MS); } catch (e) { }
}

// Where and how the install screen draws (Windows): the app window's spot and size in real pixels, the page's colours (sent by the
// app as it starts the update; updateRunner turns them into #rrggbb or a default), and the logo copied out of the app package so
// PowerShell can read it. A minimised or hidden window uses the middle of its screen at a normal size.
function installScreen(colors, version) {
  const c = (colors && typeof colors === 'object') ? colors : {};
  const spec = { bg: c.bg, fg: c.fg, dim: c.dim, accent: c.accent, track: c.track, version };
  const win = ctx.nativeWindow;   // the ARMGDDN App's own window (mainWindow is the hidden classic one)
  try {
    const { screen } = require('electron');   // only usable once the app is ready, which it is by the time an update installs
    let b = win.getBounds();
    if (win.isMinimized() || !win.isVisible()) {
      const wa = screen.getDisplayMatching(b).workArea;
      b = { width: Math.min(1280, wa.width), height: Math.min(800, wa.height) };
      b.x = wa.x + Math.round((wa.width - b.width) / 2); b.y = wa.y + Math.round((wa.height - b.height) / 2);
    }
    const r = process.platform === 'win32' && typeof screen.dipToScreenRect === 'function' ? screen.dipToScreenRect(win, b) : b;
    Object.assign(spec, { x: r.x, y: r.y, w: r.width, h: r.height, scale: screen.getDisplayMatching(b).scaleFactor || 1 });
  } catch (e) { }
  try {
    const logo = path.join(app.getPath('userData'), 'update-logo.png');
    fs.writeFileSync(logo, fs.readFileSync(path.join(ctx.__dirname, 'renderer', 'native', 'skull-logo.png')));
    spec.logo = logo;
  } catch (e) { }
  return spec;
}

function macTooOldForRelease(latestVersion, platform, osRelease) {
  if (platform !== 'darwin') return false;
  if (compareVersions(latestVersion, ctx.MAC_MIN_DARWIN_FROM_VERSION) < 0) return false;
  const major = parseInt(String(osRelease || ''), 10);
  return Number.isFinite(major) && major < ctx.MAC_MIN_DARWIN_MAJOR;
}

module.exports = { getUpdateEd25519PublicKeyPem, isAllowedUpdateHost, checkForUpdatesFromMenu, getWhatsNewForVersion, fetchLatestReleaseInfo, pollForUpdateOnce, startUpdatePoller, installScreen, macTooOldForRelease };
