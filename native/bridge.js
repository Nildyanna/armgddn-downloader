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

const SAFE_REMOTE = /^[A-Za-z0-9 _.\-]{1,60}$/;
function browsePath(remote, folder) {
  if (!SAFE_REMOTE.test(String(remote || ''))) throw Object.assign(new Error('Bad remote name'), { kind: 'http', status: 400 });
  const f = String(folder || '');
  if (f.length > 600 || f.split('/').includes('..')) throw Object.assign(new Error('Bad path'), { kind: 'http', status: 400 });
  return `/api/browse/${encodeURIComponent(remote)}` + (f ? `?path=${encodeURIComponent(f)}` : '');
}

function registerSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'armgddn-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function start({ BrowserWindow, ipcMain, protocol, getToken, openLogin, version, log = () => { }, appDir }) {
  const api = createApiClient({ getToken, version });
  const direct = new Map();   // small cache for covers hosted elsewhere

  ipcMain.handle('native:status', wrap(async () => ({ signedIn: !!getToken(), version })));
  ipcMain.handle('native:login', wrap(async () => { await openLogin(); return { signedIn: !!getToken() }; }));
  ipcMain.handle('native:remotes', wrap(() => api.get('/api/remotes', { ttlMs: 5 * 60 * 1000 })));
  ipcMain.handle('native:browse', wrap((remote, folder) => api.get(browsePath(remote, folder), { ttlMs: 2 * 60 * 1000, headers: { 'X-User-Browse': 'true' } })));
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
        const r = await fetch(route.url, { headers: { 'User-Agent': `ARMGDDN-Companion/${version}` } });
        if (!r.ok) return new Response('', { status: 404 });
        hit = { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
        if (hit.buf.length < 2 * 1024 * 1024) { direct.set(route.url, hit); if (direct.size > 300) direct.delete(direct.keys().next().value); }
      }
      return new Response(hit.buf, { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': 'max-age=86400' } });
    } catch (e) {
      return new Response('', { status: e && e.kind === 'auth' ? 401 : 502 });
    }
  });

  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0b1220', title: 'ARMGDDN (native preview)',
    webPreferences: { preload: path.join(appDir, 'preload-native.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(appDir, 'renderer', 'native', 'index.html'));
  log('[Native] preview window opened');
  return win;
}

module.exports = { start, registerSchemes, wrap, browsePath };
