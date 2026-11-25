'use strict';
// armgddn:// links: checking them, handling them, and the ones that arrive before the app is ready (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const komga = require('../komga');
const { isSafeLibraryFolder } = require('./files');
const { runHashCheck } = require('./hashing');
const { confirmKomgaDeepLink, addReadListToKomga } = require('./komgaActions');
const { logToFile } = require('./log');
const { raiseWindow } = require('./util');

function flushPendingDeepLinks() {
  try {
    if (!ctx.mainWindowAlive()) return;
    if (!ctx.mainWindowDidFinishLoad) return;
    if (!ctx.pendingDeepLinks.length) return;

    const toSend = ctx.pendingDeepLinks.splice(0, ctx.pendingDeepLinks.length);
    for (const u of toSend) {
      try {
        ctx.sendToMain('deep-link', u);
      } catch (e) {
        // Put it back and try again on next flush.
        ctx.pendingDeepLinks.unshift(u);
        break;
      }
    }

    if (ctx.NATIVE_PREVIEW) return;   // preview run: progress shows in the native window, the classic window stays hidden
    ctx.mainWindow.show();
    // KDE Plasma's focus-stealing prevention silently drops focus() calls from
    // background processes. Use moveTop() instead to raise the window reliably.
    if (process.platform === 'linux') {
      try { ctx.mainWindow.moveTop(); } catch (e) { }
    } else {
      ctx.mainWindow.focus();
    }
  } catch (e) {
    // Keep it safe; we'll try again later.
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
    const allowedHosts = ['download', 'open', 'komga', 'verify', 'comics', 'music', 'request'];
    if (!allowedHosts.includes(parsed.hostname)) {
      logToFile(`Deep link rejected - invalid host: ${parsed.hostname}`);
      return null;
    }

    // The 'token' param in the deep link IS a real app-session bearer token — the
    // browser mints it fresh (via /api/generate-app-token) right before building the
    // link, since it's already authenticated. resolve-download-token uses it as a
    // one-shot attempt only; it is never persisted as the Companion's saved session,
    // so a stale/crafted deep link can't silently replace what the user is logged in as.
    // Validate the one-time download token format: alphanumeric + dashes/underscores, under 200 chars.
    const downloadToken = parsed.searchParams.get('downloadToken');
    if (downloadToken !== null) {
      if (typeof downloadToken !== 'string' ||
          downloadToken.length < 8 ||
          downloadToken.length > 200 ||
          !/^[A-Za-z0-9_-]+$/.test(downloadToken)) {
        logToFile('Deep link rejected - invalid downloadToken format');
        return null;
      }
    }

    if (parsed.hostname === 'download' && parsed.searchParams.has('dest') && !['comics', 'music'].includes(parsed.searchParams.get('dest'))) {
      logToFile('Deep link rejected - unknown download destination');
      return null;
    }

    if (parsed.hostname === 'comics') {
      const list = String(parsed.searchParams.get('list') || 'all');
      const tok = String(parsed.searchParams.get('token') || '');
      const folder = parsed.searchParams.get('folder');
      if (!/^[a-z0-9-]{1,80}$/.test(list) || (tok && !/^[A-Za-z0-9._-]{8,400}$/.test(tok)) || (folder !== null && !isSafeLibraryFolder(folder))) {
        logToFile('Deep link rejected - bad comics list, folder or token');
        return null;
      }
    }

    if (parsed.hostname === 'music') {
      const tok = String(parsed.searchParams.get('token') || '');
      const folder = parsed.searchParams.get('folder');
      if ((tok && !/^[A-Za-z0-9._-]{8,400}$/.test(tok)) || (folder !== null && !isSafeLibraryFolder(folder))) {
        logToFile('Deep link rejected - bad music folder or token');
        return null;
      }
    }

    if (parsed.hostname === 'verify' && !/^[A-Za-z0-9._-]{1,100}$/.test(String(parsed.searchParams.get('id') || ''))) {
      logToFile('Deep link rejected - bad verify id');
      return null;
    }

    if (parsed.hostname === 'komga' && !komga.isValidListId(String(parsed.searchParams.get('list') || ''))) {
      logToFile('Deep link rejected - bad komga list id');
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
        if (!ctx.isAllowedServiceHost(u.hostname)) {
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

function openRequestWhenReady(rid, until) {
  const w = ctx.nativeWindow;
  if (!w || w.isDestroyed() || w.webContents.isLoading()) {
    if (Date.now() < until) setTimeout(() => openRequestWhenReady(rid, until), 500);
    else logToFile('[deeplink] request ' + rid + ': the window never got ready');
    return;
  }
  try {
    if (w.isMinimized()) w.restore();
    w.show();
    if (process.platform === 'linux') { try { w.moveTop(); } catch (e2) { } } else { w.focus(); }
    w.webContents.send('native:open', { view: 'requests', id: rid });
    logToFile('[deeplink] request ' + rid + ' opened');
  } catch (e) { }
}

function handleDeepLink(url) {
  // Validate before processing
  const validatedUrl = validateDeepLink(url);
  if (!validatedUrl) {
    logToFile('Deep link rejected: ' + (url ? url.substring(0, 50) : 'null'));
    return;
  }

  // Adding a read list to the member's Komga is handled here in the main process (no renderer round trip).
  try {
    const u = new URL(validatedUrl);
    if (u.hostname === 'verify') {
      const vid = String(u.searchParams.get('id') || '');
      try { if (ctx.mainWindowAlive()) { if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore(); ctx.mainWindow.show(); if (process.platform === 'linux') { try { ctx.mainWindow.moveTop(); } catch (e2) { } } else { ctx.mainWindow.focus(); } ctx.sendToMain('hash-check-requested', { id: vid }); } } catch (e) { }
      runHashCheck(vid).catch(() => { });
      return;
    }
    if (u.hostname === 'open') {
      // armgddn://open: the website's "Open ARMGDDN App" button. Brings the window forward (the native one when it is on); nothing is changed.
      try {
        const w = (ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) ? ctx.nativeWindow : (ctx.mainWindowAlive() ? ctx.mainWindow : null);
        if (w) raiseWindow(w);
      } catch (e) { }
      return;
    }
    if (u.hostname === 'request') {
      // armgddn://request/<id>: the link in a Telegram request notice. Opens that request in the native window.
      // The window decides where it goes: staff get Admin > Requests, members their own Requests tab. When the link started the app,
      // the window is not there or still loading yet, so this waits for it (up to 30 s).
      const rid = Number(String(u.pathname || '').replace(/^\/+/, ''));
      if (Number.isInteger(rid) && rid > 0) openRequestWhenReady(rid, Date.now() + 30000);
      return;
    }
    if (u.hostname === 'comics') {
      // Opens the "only what I'm missing" panel for a reading order. The token minted by the site is kept in memory only (never saved
      // as the Companion's own sign-in) and is used for the catalog and the downloads of this session.
      const tok = String(u.searchParams.get('token') || '');
      if (tok) { ctx.comicsState.token = tok; }   // memory only: a link on a web page must never replace the member's saved sign-in
      logToFile(`[deeplink] comics opened, site token ${tok ? 'received' : 'missing'}`);
      try { if (ctx.mainWindowAlive()) { if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore(); ctx.mainWindow.show(); if (process.platform === 'linux') { try { ctx.mainWindow.moveTop(); } catch (e2) { } } } } catch (e) { }
      const open = () => ctx.sendToMain('comics-open', { listId: String(u.searchParams.get('list') || 'all'), folder: String(u.searchParams.get('folder') || '') });
      if (ctx.mainWindowDidFinishLoad) open(); else setTimeout(open, 2500);
      return;
    }
    if (u.hostname === 'music') {
      // Same as comics: opens the "only what I'm missing" panel; the site's token is kept in memory for this session only.
      const tok = String(u.searchParams.get('token') || '');
      if (tok) { ctx.musicState.token = tok; }   // memory only, same reason
      logToFile(`[deeplink] music opened, site token ${tok ? 'received' : 'missing'}`);
      try { if (ctx.mainWindowAlive()) { if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore(); ctx.mainWindow.show(); if (process.platform === 'linux') { try { ctx.mainWindow.moveTop(); } catch (e2) { } } } } catch (e) { }
      const open = () => ctx.sendToMain('music-open', { folder: String(u.searchParams.get('folder') || '') });
      if (ctx.mainWindowDidFinishLoad) open(); else setTimeout(open, 2500);
      return;
    }
    if (u.hostname === 'komga') {
      // A link on any web page can open this, so the member is asked before anything is added to their Komga.
      const listId = u.searchParams.get('list');
      confirmKomgaDeepLink(listId).then((ok) => ok && addReadListToKomga(listId)).catch(e => logToFile('Komga add failed: ' + (e && e.message ? e.message : e)));
      return;
    }
  } catch (e) { }

  // Queue and flush when the renderer is ready.
  ctx.pendingDeepLinks.push(validatedUrl);
  // Keep queue bounded to avoid unbounded growth.
  if (ctx.pendingDeepLinks.length > 10) ctx.pendingDeepLinks.splice(0, ctx.pendingDeepLinks.length - 10);
  flushPendingDeepLinks();
}

module.exports = { flushPendingDeepLinks, validateDeepLink, handleDeepLink };
