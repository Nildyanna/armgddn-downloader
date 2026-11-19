'use strict';
// Staging only: the native browser window, started with `--native`. Connects the page (renderer/native) to the site through the main
// process. The page never sees the login token: it asks over IPC, and covers come through the private armgddn-img:// address.
const path = require('path');
const { createApiClient } = require('./apiClient');
const { coverRoute } = require('./coverPath');

// IPC replies are plain data, so errors travel as { ok: false, error: { kind, message, status } } instead of throwing across the bridge.
const wrap = (fn) => async (_event, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (e) { return { ok: false, error: { kind: e && e.kind ? e.kind : 'error', message: e && e.message ? e.message : String(e), status: e && e.status ? e.status : 0 } }; }
};

const LINK_HOSTS = new Set(['store.steampowered.com', 'steamdb.info', 'comicvine.gamespot.com', '7-zip.org', 't.me', 'telegram.me', 'github.com']);
const SAFE_REMOTE = /^[A-Za-z0-9 _.\-]{1,60}$/;
function browsePath(remote, folder) {
  if (!SAFE_REMOTE.test(String(remote || ''))) throw Object.assign(new Error('Bad remote name'), { kind: 'http', status: 400 });
  const f = String(folder || '');
  if (f.length > 600 || f.split('/').includes('..')) throw Object.assign(new Error('Bad path'), { kind: 'http', status: 400 });
  return `/api/browse/${encodeURIComponent(remote)}` + (f ? `?path=${encodeURIComponent(f)}` : '');
}

// Export list: the site builds the CSV or Excel file for a remote; the app asks where to save it.
function exportPath(remote, format) {
  if (!SAFE_REMOTE.test(String(remote || ''))) throw Object.assign(new Error('Bad remote name'), { kind: 'http', status: 400 });
  const fmt = String(format || '').toLowerCase();
  if (fmt !== 'csv' && fmt !== 'xlsx') throw Object.assign(new Error('Format must be csv or xlsx'), { kind: 'http', status: 400 });
  return { path: `/api/export/${encodeURIComponent(remote)}?format=${fmt}`, fmt };
}
function exportFileName(disposition, remote, fmt) {
  const m = /filename="([^"]+)"/.exec(String(disposition || ''));
  const raw = m ? m[1] : `ARMGDDN-${String(remote).replace(/[^A-Za-z0-9._-]+/g, '-')}.${fmt}`;
  const clean = path.basename(raw.replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 120);
  return clean && clean.toLowerCase().endsWith('.' + fmt) ? clean : `ARMGDDN-${String(remote).replace(/[^A-Za-z0-9._-]+/g, '-')}.${fmt}`;
}

function registerSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'armgddn-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function start({ BrowserWindow, ipcMain, shell, dialog, clipboard, clearSession, fs = require('fs'), protocol, getToken, openLogin, version, log = () => { }, appDir, startDeepLink, getDownloads, showClassic }) {
  const api = createApiClient({ getToken, version });
  const direct = new Map();   // small cache for covers hosted elsewhere


  // Covers hosted elsewhere (Wikimedia and friends) rate-limit a burst of requests, so they go through a small queue, one retry after a 429,
  // and a failure is remembered for five minutes instead of being asked again on every scroll.
  const failedDirect = new Map();
  let directRunning = 0;
  const directQueue = [];
  const directSlot = () => new Promise((resolve) => {
    const go = () => { directRunning++; resolve(() => { directRunning--; const n = directQueue.shift(); if (n) n(); }); };
    if (directRunning < 3) go(); else directQueue.push(go);
  });
  async function fetchDirect(url) {
    const release = await directSlot();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(url, { headers: { 'User-Agent': `ARMGDDN-Companion/${version} (https://armgddnbrowser.com)` } });
        if (r.status === 429 && attempt === 0) { await new Promise((res) => setTimeout(res, Math.min(5000, (Number(r.headers.get('retry-after')) || 2) * 1000))); continue; }
        if (!r.ok) { try { log('[Native] cover failed: direct ' + r.status + ' ' + new URL(url).hostname); } catch (e3) { } return null; }
        return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
      }
      return null;
    } catch (e) { return null; } finally { release(); }
  }

  ipcMain.handle('native:status', wrap(async () => ({ signedIn: !!getToken(), version })));
  ipcMain.handle('native:login', wrap(async () => { await openLogin(); return { signedIn: !!getToken() }; }));
  ipcMain.handle('native:remotes', wrap(() => api.get('/api/remotes', { ttlMs: 5 * 60 * 1000 })));
  ipcMain.handle('native:browse', wrap((remote, folder) => api.get(browsePath(remote, folder), { ttlMs: 2 * 60 * 1000, headers: { 'X-User-Browse': 'true' } })));
  // Download: the same path the website's "Download with App" takes (a download token from the site, then the Companion's own deep-link handler),
  // so the existing download engine, checks and progress reporting all apply.
  ipcMain.handle('native:download', wrap(async (remote, folderPath) => {
    browsePath(remote, folderPath);   // validates both
    if (!String(folderPath || '')) throw Object.assign(new Error('Nothing to download here'), { kind: 'http', status: 400 });
    const t = await api.post('/api/external-download-token', { remote, path: folderPath });
    if (!t || !t.downloadToken) throw Object.assign(new Error((t && t.error) || 'The site did not give a download token'), { kind: 'http', status: 502 });
    startDeepLink('armgddn://download?' + new URLSearchParams({ downloadToken: t.downloadToken, token: getToken() }).toString());
    return { started: true };
  }));
  ipcMain.handle('native:downloads', wrap(async () => (getDownloads ? getDownloads() : []).map((d) => ({
    id: d.id, name: d.name, status: d.status, progress: d.progress, speed: d.speed, totalSpeed: d.totalSpeed, eta: d.eta, totalSize: d.totalSize, downloadedSize: d.downloadedSize,
    fileCount: d.fileCount, completedFiles: d.completedFiles, activeFiles: d.activeFiles,
    error: d.error || '' }))));
  // Requests (My Requests, comments, a new Music/Comics request). Writes clear the cached list so it refreshes.
  const reqId = (id) => { const n = Number(id); if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error('Bad request id'), { kind: 'http', status: 400 }); return n; };
  // Watchlist ("Tell me when it is added"): the same lists the website keeps, so a title watched in either place shows in both.
  // Admin pages (read only). The site decides who may see what from the member's own role; these are the only admin addresses the app will ask for.
  const ADMIN_GET = { stats: '/api/admin/stats', system: '/api/admin/system-details', activity: '/api/admin/user-activity', queue: '/api/admin/queue', requests: '/api/admin/requests', missing: '/api/admin/missing-covers', lookup: '/api/admin/ip-bans/lookup', youtube: '/api/admin/youtube-search', ipbans: '/api/admin/ip-bans', access: '/api/admin/access-lists', report: '/api/admin/report-data', collections: '/api/admin/report-collections', reliability: '/api/admin/status-report', siteStatus: '/api/status', refetchStatus: '/api/admin/refetch-all-game-art/status' };
  ipcMain.handle('native:adminGet', wrap((kind, params) => {
    const base = ADMIN_GET[String(kind)];
    if (!base) throw Object.assign(new Error('Unknown admin page'), { kind: 'http', status: 400 });
    const q = new URLSearchParams();
    if (kind === 'lookup' && params && typeof params === 'object') {
      const id = String(params.telegramId || ''), un = String(params.username || '').replace(/^@/, '');
      if (/^\d{3,20}$/.test(id)) q.set('telegramId', id); else if (/^[A-Za-z0-9_]{3,40}$/.test(un)) q.set('username', un); else throw Object.assign(new Error('Type a Telegram id (digits) or a @username'), { kind: 'http', status: 400 });
    }
    if (kind === 'youtube') { const term = String((params && params.q) || '').trim().slice(0, 100); if (!term) throw Object.assign(new Error('Type what to search for'), { kind: 'http', status: 400 }); q.set('q', term); }
    if (kind === 'requests' && params && typeof params === 'object') for (const k of ['status', 'category']) { const v = String(params[k] || ''); if (/^[A-Za-z_ -]{1,30}$/.test(v)) q.set(k, v); }
    return api.get(base + (q.toString() ? '?' + q.toString() : ''), { ttlMs: 0, fresh: true });
  }));
  // Admin actions. Each is a fixed, validated request; the site checks the member's role again and refuses anyone who is not allowed. The app asks
  // the member to confirm every one of them before it gets here.
  const MIRRORS = ['PC-1', 'PC-2', 'PC-3', 'PCVR-1', 'PCVR-2', 'PCVR-3'];
  const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'completed', 'duplicate'];
  const bad = (m) => Object.assign(new Error(m), { kind: 'http', status: 400 });
  const text = (v, max) => String(v == null ? '' : v).slice(0, max);
  ipcMain.handle('native:adminDo', wrap(async (action, args) => {
    const a = args && typeof args === 'object' ? args : {};
    switch (String(action)) {
      case 'resetQuota': {
        const failed = [];
        for (const m of MIRRORS) { try { await api.post('/api/admin/mirror-status', { remote: m, status: 'available' }); } catch (e) { failed.push(m); } }
        if (failed.length === MIRRORS.length) throw bad('Could not reset any mirror');
        return { success: true, failed };
      }
      case 'restartServer': return api.post('/api/admin/restart-server', {});
      case 'autofixArt': { const r = await api.post('/api/admin/missing-art/autofix', {}, { invalidate: ['/api/admin/missing-covers'] }); return { ...r, message: 'Auto-fix done. Covers fixed: ' + (Number(r && r.coverFixedCount) || 0) + '.' }; }
      case 'resetApiStats': return api.post('/api/admin/reset-api-stats', {});
      case 'resetDownloadCache': return api.post('/api/admin/reset-download-cache', {});
      case 'banIp': {
        const ip = text(a.ip, 45).trim();
        if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw bad('That does not look like an IP address');
        return api.post('/api/admin/ip-bans/ban-ip', { ip, reason: text(a.reason, 200).trim() || 'Banned from the app' }, { invalidate: ['/api/admin/ip-bans'] });
      }
      case 'unbanIp': {
        const ip = text(a.ip, 45).trim();
        if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw bad('That does not look like an IP address');
        return api.post('/api/admin/ip-bans/unban-ip', { ip }, { invalidate: ['/api/admin/ip-bans'] });
      }
      case 'requestStatus': {
        const id = Number(a.id);
        if (!Number.isInteger(id) || id < 1) throw bad('Bad request id');
        if (!REQUEST_STATUSES.includes(String(a.status))) throw bad('Bad status');
        return api.post(`/api/admin/requests/${id}/status`, { status: String(a.status), adminNotes: text(a.adminNotes, 500), decisionReason: text(a.decisionReason, 500) }, { invalidate: ['/api/admin/requests'] });
      }
      case 'clearMissing': {
        const gameKey = text(a.gameKey, 300).trim();
        if (!gameKey) throw bad('Nothing chosen');
        return api.post('/api/admin/missing-covers/clear', { gameKey }, { invalidate: ['/api/admin/missing-covers'] });
      }
      case 'accessAdd':
      case 'accessRemove': {
        const list = String(a.list);
        const id = text(a.id, 20).trim();
        if (list !== 'channel' && list !== 'request') throw bad('Pick a list');
        if (!/^\d{3,20}$/.test(id)) throw bad('A Telegram id is digits only');
        return api.post(action === 'accessAdd' ? '/api/admin/access-lists/add' : '/api/admin/access-lists/remove', { list, id }, { invalidate: ['/api/admin/access-lists'] });
      }
      case 'banUser': {
        const id = text(a.telegramId, 20).trim();
        if (!/^\d{3,20}$/.test(id)) throw bad('A Telegram id is digits only');
        return api.post('/api/admin/ip-bans/ban-user', { telegramId: id, reason: text(a.reason, 200).trim() || 'Banned from the app' }, { invalidate: ['/api/admin/ip-bans'] });
      }
      case 'reloadOverrides': return api.post('/api/admin/reload-overrides', {});
      case 'refetchArt': return api.post('/api/admin/refetch-all-game-art', { force: !!a.force });
      case 'addCover': {
        const gameKey = text(a.gameKey, 300).trim(), coverUrl = text(a.coverUrl, 600).trim();
        if (!gameKey) throw bad('Nothing chosen');
        if (!/^https:\/\/[^\s]+$/i.test(coverUrl)) throw bad('The picture address must start with https://');
        return api.post('/api/admin/missing-covers/add-art', { gameKey, coverUrl }, { invalidate: ['/api/admin/missing-covers'] });
      }
      case 'addTrailer': {
        const gameKey = text(a.gameKey, 300).trim(), trailerYoutube = text(a.trailerYoutube, 300).trim();
        if (!gameKey) throw bad('Nothing chosen');
        if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]+$/i.test(trailerYoutube)) throw bad('Paste a YouTube address (https://www.youtube.com/...)');
        return api.post('/api/admin/missing-covers/add-trailer', { gameKey, trailerYoutube }, { invalidate: ['/api/admin/missing-covers'] });
      }
      default: throw bad('Unknown admin action');
    }
  }));
  // The publisher collections on the Comics page (Marvel Collection, DC Collection ...): worked out by the site, one download each.
  ipcMain.handle('native:comicBundles', wrap(() => api.get('/api/comic-bundles', { ttlMs: 5 * 60 * 1000 })));
  ipcMain.handle('native:watchlist', wrap(() => api.get('/api/watchlist', { ttlMs: 0, fresh: true })));
  ipcMain.handle('native:watchAdd', wrap((title) => {
    const t = String(title || '').trim().slice(0, 120);
    if (t.length < 2) throw Object.assign(new Error('Type a game title first'), { kind: 'http', status: 400 });
    return api.post('/api/watchlist', { title: t }, { invalidate: ['/api/watchlist'] });
  }));
  ipcMain.handle('native:watchRemove', wrap((id) => {
    const n = String(id || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(n)) throw Object.assign(new Error('Bad watchlist id'), { kind: 'http', status: 400 });
    return api.del('/api/watchlist/' + n, undefined, { invalidate: ['/api/watchlist'] });
  }));
  ipcMain.handle('native:requests', wrap(() => api.get('/api/requests/my', { ttlMs: 15000 })));
  ipcMain.handle('native:thread', wrap((id) => api.get(`/api/requests/${reqId(id)}/thread?markSeen=1`, { ttlMs: 0, fresh: true })));
  ipcMain.handle('native:comment', wrap((id, message) => {
    const m = String(message || '').trim();
    if (!m) throw Object.assign(new Error('Write a message first'), { kind: 'http', status: 400 });
    if (m.length > 500) throw Object.assign(new Error('Message too long (max 500)'), { kind: 'http', status: 400 });
    return api.post(`/api/requests/${reqId(id)}/thread`, { message: m }, { invalidate: ['/api/requests/my'] });
  }));
  ipcMain.handle('native:submitRequest', wrap((category, title, notes) => {
    if (!['Music', 'Comics'].includes(category)) throw Object.assign(new Error('Only Music and Comics requests can be made right now'), { kind: 'http', status: 400 });
    const t = String(title || '').trim();
    if (t.length < 2 || t.length > 200) throw Object.assign(new Error('Type what you want (2 to 200 characters)'), { kind: 'http', status: 400 });
    return api.post('/api/requests/submit', { gameTitle: t, category, notes: String(notes || '').trim().slice(0, 500) }, { invalidate: ['/api/requests/my'] });
  }));
  // A download of chosen folders with some names left out (the game folder without its update patches): the same batch manifest the website builds.
  ipcMain.handle('native:downloadBatch', wrap(async (remote, paths, exclude) => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 50) throw Object.assign(new Error('Nothing to download'), { kind: 'http', status: 400 });
    const cleanPaths = paths.map((x) => { const f = String(x || '').replace(/^\/+|\/+$/g, ''); browsePath(remote, f); return f; }).filter(Boolean);
    const cleanExclude = (Array.isArray(exclude) ? exclude : []).map((x) => String(x || '').trim()).filter((x) => x && x.length <= 300 && !x.includes('/')).slice(0, 20);
    const made = await api.post('/api/batch-manifest', { remote, paths: cleanPaths, exclude: cleanExclude });
    if (!made || !made.batchId) throw Object.assign(new Error((made && made.error) || 'Could not prepare the download'), { kind: 'http', status: 502 });
    const t = await api.post('/api/external-download-token', { remote, path: `__batch__/${made.batchId}` });
    if (!t || !t.downloadToken) throw Object.assign(new Error((t && t.error) || 'The site did not give a download token'), { kind: 'http', status: 502 });
    startDeepLink('armgddn://download?' + new URLSearchParams({ downloadToken: t.downloadToken, token: getToken() }).toString());
    return { started: true };
  }));
  // README of a title (the same lookup the website's Read README and the download notice use).
  ipcMain.handle('native:readme', wrap((remote, folderPath) => {
    browsePath(remote, folderPath);
    return api.get(`/api/readme-preview?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(folderPath || '')}`, { ttlMs: 5 * 60 * 1000 });
  }));
  // Home page strips: the same data the website's Trending Downloads and Hidden Gems strips show.
  ipcMain.handle('native:trending', wrap(() => api.get('/api/trending-downloads', { ttlMs: 5 * 60 * 1000 })));
  ipcMain.handle('native:gems', wrap(() => api.get('/api/hidden-gems', { ttlMs: 10 * 60 * 1000 })));
  // Copy a short code (a support report or log code) to the clipboard; the page cannot always reach the clipboard itself.
  ipcMain.handle('native:copy', wrap(async (text) => {
    const t = String(text == null ? '' : text);
    if (!t || t.length > 20000) throw Object.assign(new Error('Nothing to copy'), { kind: 'http', status: 400 });
    clipboard.writeText(t);
    return { copied: true };
  }));
  // The preferences the website copied to the server for this member (My List, theme, hidden sections, recent searches).
  ipcMain.handle('native:prefs', wrap(() => api.get('/api/user-prefs', { ttlMs: 0, fresh: true })));
  // The member's own download history and the related titles the site works out from it (Game Radar).
  ipcMain.handle('native:appProgress', wrap(() => api.get('/api/app-progress', { ttlMs: 60 * 1000 })));
  // Sign out: forget the saved sign-in on this PC (the app then offers Sign in again).
  ipcMain.handle('native:logout', wrap(async () => { if (clearSession) clearSession(); return { signedOut: true }; }));
  // Save what is on screen as a PDF (the Admin pages carry a print layout). The member picks where it goes.
  ipcMain.handle('native:savePdf', wrap(async (title) => {
    const name = String(title || 'ARMGDDN report').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'ARMGDDN report';
    const pick = await dialog.showSaveDialog(win, { title: 'Save as PDF', defaultPath: name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (pick.canceled || !pick.filePath) return { saved: false };
    const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' } });
    await fs.promises.writeFile(pick.filePath, buf);
    return { saved: true, name: path.basename(pick.filePath), bytes: buf.length };
  }));
  ipcMain.handle('native:exportList', wrap(async (remote, format) => {
    const { path: p, fmt } = exportPath(remote, format);
    const f = await api.file(p);
    const name = exportFileName(f.disposition, remote, fmt);
    const pick = await dialog.showSaveDialog(win, { title: 'Save the list', defaultPath: name, filters: [{ name: fmt === 'xlsx' ? 'Excel' : 'CSV', extensions: [fmt] }] });
    if (pick.canceled || !pick.filePath) return { saved: false };
    await fs.promises.writeFile(pick.filePath, f.buf);
    return { saved: true, name: path.basename(pick.filePath), bytes: f.buf.length };
  }));
  // Links in details and notices: https and a short list of hosts only.
  ipcMain.handle('native:openLink', wrap(async (url) => {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' || !LINK_HOSTS.has(u.hostname)) throw Object.assign(new Error('That link is not allowed'), { kind: 'http', status: 400 });
    await shell.openExternal(u.toString());
    return { opened: true };
  }));
  // Settings, history and the other tools still live in the classic window until they are moved over: this brings it to the front.
  ipcMain.handle('native:openClassic', wrap(async () => { if (showClassic) showClassic(); return { opened: true }; }));
  ipcMain.handle('native:stats', wrap(async () => api.stats));

  protocol.handle('armgddn-img', async (request) => {
    try {
      const u = new URL(request.url).searchParams.get('u');
      const route = coverRoute(u);
      if (!route) return new Response('', { status: 400 });
      if (route.kind === 'site') {
        const img = await api.image(route.path);
        return new Response(img.buf, { status: 200, headers: { 'Content-Type': img.type, 'Cache-Control': 'max-age=86400' } });
      }
      let hit = direct.get(route.url);
      if (!hit) {
        const bad = failedDirect.get(route.url);
        if (bad && Date.now() - bad < 5 * 60 * 1000) return new Response('', { status: 404 });
        hit = await fetchDirect(route.url);
        if (!hit) { failedDirect.set(route.url, Date.now()); return new Response('', { status: 404 }); }
        if (hit.buf.length < 2 * 1024 * 1024) { direct.set(route.url, hit); if (direct.size > 300) direct.delete(direct.keys().next().value); }
      }
      return new Response(hit.buf, { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': 'max-age=86400' } });
    } catch (e) {
      try { log('[Native] cover failed: ' + (e && e.kind ? e.kind : 'error') + ' ' + (e && e.status ? e.status : '') + ' ' + (e && e.message ? String(e.message).slice(0, 80) : '') + ' ' + new URL(new URL(request.url).searchParams.get('u') || 'https://x/').hostname); } catch (e2) { }
      return new Response('', { status: e && e.kind === 'auth' ? 401 : 502 });
    }
  });

  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0b1220', title: 'ARMGDDN (native preview)',
    webPreferences: { preload: path.join(appDir, 'preload-native.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required', additionalArguments: process.argv.some((x) => x.startsWith('--native-shot') || x === '--native-quiet') ? ['--native-quiet'] : [] }
  });
  win.maximize();   // opens maximized
  // Electron 44+ passes one event object ({ level: 'info' | 'warning' | 'error' | 'debug', message, lineNumber, sourceId }); older versions pass separate arguments with a number level.
  win.webContents.on('console-message', (e, ...legacy) => {
    const d = e && typeof e.message === 'string' ? e : { level: legacy[0], message: legacy[1], lineNumber: legacy[2], sourceId: legacy[3] };
    const lvl = typeof d.level === 'number' ? (d.level >= 3 ? 'error' : d.level === 2 ? 'warning' : 'info') : String(d.level || 'info');
    if (lvl === 'error' || lvl === 'warning') log('[Native] page ' + lvl + ': ' + String(d.message).slice(0, 300) + ' (' + String(d.sourceId || '').split('/').pop() + ':' + (d.lineNumber || 0) + ')');
  });
  // YouTube refuses an embed that arrives with no website address (error 153) and a local page has none, so the player request carries the
  // site's address, as it does on the website. Only YouTube's embed URLs get it.
  try {
    win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*', 'https://www.youtube.com/embed/*'] }, (details, cb) => {
      const h = { ...details.requestHeaders, Referer: 'https://www.armgddnbrowser.com/' };
      cb({ requestHeaders: h });
    });
  } catch (e) { log('[Native] could not set the YouTube referrer: ' + e.message); }
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(appDir, 'renderer', 'native', 'index.html'));
  // `--native-shot=<file.png>`: after the page has had time to load, save a screenshot (used to check the layout without watching the window).
  const shot = (process.argv.find((a) => a.startsWith('--native-shot=')) || '').slice('--native-shot='.length);
  if (shot) win.webContents.once('did-finish-load', () => setTimeout(async () => { try { const tab = (process.argv.find((a) => a.startsWith('--native-tab=')) || '').slice('--native-tab='.length); if (tab) { await win.webContents.executeJavaScript('Array.from(document.querySelectorAll(".tab")).find((b) => b.textContent.trim() === ' + JSON.stringify(tab) + ')?.click()'); await new Promise((r) => setTimeout(r, 6000)); } if (process.argv.includes('--native-scroll')) { await win.webContents.executeJavaScript('new Promise((res) => { const g = document.querySelector(".grid"); let n = 0; const t = setInterval(() => { g.scrollTop += 900; if (++n >= 40) { clearInterval(t); g.scrollTop = 0; setTimeout(res, 1500); } }, 400); })'); } { const click = (process.argv.find((a) => a.startsWith('--native-click=')) || '').slice('--native-click='.length); if (click) { for (const sel of click.split('>>>')) { await win.webContents.executeJavaScript('document.querySelector(' + JSON.stringify(sel) + ')?.click()'); await new Promise((r) => setTimeout(r, 3500)); } } } { const ev = (process.argv.find((a) => a.startsWith('--native-eval=')) || '').slice('--native-eval='.length); if (ev) { for (const code of ev.split('>>>')) { try { await win.webContents.executeJavaScript(code); } catch (e7) { log('[Native] eval failed: ' + e7.message); } await new Promise((r) => setTimeout(r, 6000)); } } } { try { require('fs').unlinkSync(shot); } catch (e5) { } let img = null; for (let i = 0; i < 4 && !img; i++) { try { img = await win.webContents.capturePage(); } catch (e6) { await new Promise((r) => setTimeout(r, 1500)); } } if (!img) throw new Error('capturePage kept failing'); require('fs').writeFileSync(shot, img.toPNG()); } log('[Native] screenshot saved'); try { log('[Native] metrics ' + JSON.stringify(await win.webContents.executeJavaScript("(() => { const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const c = getComputedStyle(el); return { w: Math.round(b.width), h: Math.round(b.height), display: c.display, cv: c.contentVisibility }; }; const card = document.querySelector('.card'); return { cards: document.querySelectorAll('.card').length, grid: r(document.querySelector('.grid')), card: r(card), cover: r(card && card.querySelector('.cover')), img: r(card && card.querySelector('img')), meta: r(card && card.querySelector('.meta')), rows: getComputedStyle(document.querySelector('.grid')).gridTemplateRows.slice(0, 80) }; })()"))); } catch (e4) { } } catch (e) { log('[Native] screenshot failed: ' + e.message); } }, Number((process.argv.find((a) => a.startsWith('--native-wait=')) || '').slice('--native-wait='.length)) || 6000));
  log('[Native] preview window opened');
  return win;
}

module.exports = { start, registerSchemes, wrap, browsePath, exportPath, exportFileName, LINK_HOSTS };
