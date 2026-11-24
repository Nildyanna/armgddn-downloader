'use strict';
// Comics and Music: the folder, scanning it, comparing with the catalog, and downloading what is missing (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const comicsScan = require('../comicsScan');
const musicScan = require('../musicScan');
const { handleDeepLink } = require('./deepLinks');
const { withDialogFocus, getDialogParentWindow, sendToMain } = require('./dialogs');
const { loadComicsCache, saveComicsCache, isSafeLibraryFolder } = require('./files');
const { logToFile } = require('./log');
const { savedSessionToken } = require('./session');
const { saveSettings } = require('./settings');
const { postJsonWithBearer } = require('./siteApi');
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function register() {
ipcMain.handle('comics-get-state', () => ({ folder: ctx.settings.comicsFolder || '', scanned: ctx.comicsState.rows ? ctx.comicsState.rows.length : 0, at: ctx.comicsState.at, running: ctx.comicsState.running, progress: ctx.comicsState.running ? (ctx.comicsState.progress || { scanned: 0, current: '' }) : null }));

ipcMain.handle('comics-pick-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), { properties: ['openDirectory'] }));
  if (result.canceled || !result.filePaths.length) return null;
  ctx.settings.comicsFolder = result.filePaths[0];
  saveSettings();
  ctx.comicsState.rows = null; ctx.comicsState.at = 0; ctx.comicsState.last = null;
  return ctx.settings.comicsFolder;
});

ipcMain.handle('comics-scan', async () => {
  // The library's own catalog lets the scan skip opening files it already knows by name and size (a big win on a cloud or network drive).
  if (ctx.comicsState.running || ctx.comicsState.starting) return { ok: false, error: 'A scan is already running.' };
  let known = null;
  ctx.comicsState.starting = true;
  try {
    const cat = await ctx.comicsGet('/api/comics/catalog?list=all');
    if (cat && cat.ok && cat.json && Array.isArray(cat.json.items)) known = comicsScan.buildKnown(cat.json.items);
    else logToFile('[comics] the library list could not be loaded, so the scan did not start: ' + ((cat && cat.error) || 'no answer'));
    if (!known) {
      ctx.comicsState.starting = false;
      // Without the library list the scan cannot skip the comics you already have (every file would be opened, which takes hours on a cloud or network drive)
      // and the comparison needs the list anyway, so say so now instead of crawling.
      return { ok: false, needsSignIn: true, error: 'The scan did not start: ' + ((cat && cat.error) || 'the library list could not be loaded') + ' It needs that list to skip the comics you already have; without it a cloud or network drive can take hours.' };
    }
  } catch (e) { logToFile('[comics] catalog not available for the fast scan: ' + (e && e.message)); }
  finally { ctx.comicsState.starting = false; }
  return new Promise((resolve) => {
  const root = ctx.settings.comicsFolder;
  if (!root || !fs.existsSync(root)) { resolve({ ok: false, error: 'Choose your comics folder first.' }); return; }
  if (ctx.comicsState.running) { resolve({ ok: false, error: 'A scan is already running.' }); return; }
  const { Worker } = require('worker_threads');
  ctx.comicsState.running = true; ctx.comicsState.progress = { scanned: 0, current: '' };
  let worker;
  const finish = (out) => { ctx.comicsState.running = false; ctx.comicsState.worker = null; resolve(out); };
  try {
    worker = new Worker(path.join(ctx.__dirname, 'comicsScanWorker.js'), { workerData: { root, cache: loadComicsCache(root), known } });
  } catch (e) { finish({ ok: false, error: 'Could not start the scan: ' + e.message }); return; }
  ctx.comicsState.worker = worker;
  worker.on('message', (m) => {
    if (m.type === 'progress') { ctx.comicsState.progress = { scanned: m.scanned, current: m.current }; sendToMain('comics-scan-progress', { scanned: m.scanned, current: m.current }); return; }
    if (m.type === 'done') {
      ctx.comicsState.rows = m.rows; ctx.comicsState.root = root; ctx.comicsState.at = Date.now(); ctx.comicsState.last = null;
      saveComicsCache(root, m.cache);
      logToFile(`[comics] scanned ${m.rows.length} files (${m.rows.filter((r) => r.fast).length} matched the catalog by name and size without being opened)`);
      finish({ ok: true, count: m.rows.length, damaged: m.rows.filter((r) => r.damaged).length, fast: m.rows.filter((r) => r.fast).length });
    }
  });
  worker.on('error', (e) => { logToFile('[comics] scan failed: ' + (e && e.message)); finish({ ok: false, error: 'The scan failed: ' + (e && e.message ? e.message : e) }); });
  worker.on('exit', (code) => { if (ctx.comicsState.running) finish({ ok: false, cancelled: true, error: 'The scan was stopped.' }); });
  });
});

ipcMain.handle('comics-cancel-scan', () => { const w = ctx.comicsState.worker; if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } return !!w; });

ipcMain.handle('comics-info', async () => {
  const r = await ctx.comicsGet('/api/comics/catalog-info');
  return r.ok ? { ok: true, lists: r.json.lists || [], totals: r.json.totals || null } : r;
});

ipcMain.handle('comics-compare', async (event, listId) => {
  const id = String(listId || 'all');
  // "folder:<path>" compares one folder of the library (a collection or a series) instead of a reading order.
  const folder = id.startsWith('folder:') ? id.slice(7) : '';
  if (folder ? !isSafeLibraryFolder(folder) : (id !== 'all' && !ctx.COMICS_LIST_RE.test(id))) return { ok: false, error: 'Unknown list.' };
  if (!ctx.comicsState.rows) return { ok: false, error: 'Scan your folder first.' };
  const r = await ctx.comicsGet(folder ? '/api/comics/catalog?folder=' + encodeURIComponent(folder) : '/api/comics/catalog?list=' + encodeURIComponent(id));
  if (!r.ok) return r;
  const items = Array.isArray(r.json.items) ? r.json.items : [];
  const cmp = comicsScan.compare(items, ctx.comicsState.rows);
  ctx.comicsState.last = { listId: id, list: r.json.list, missingRows: cmp.missingRows };      // kept for the download step
  const { missingRows, ...summary } = cmp;
  return { ok: true, list: r.json.list, summary: { ...summary, perSeries: summary.perSeries.slice(0, 40), damaged: summary.damaged.slice(0, 20) } };
});

// Starts the downloads for what the last comparison found missing, through the same path the site's own downloads use:
// a batch manifest, a one-time download token for it, then the normal download link. Files arrive in the Companion's download
// folder with the library's own folder layout.
ipcMain.handle('comics-download-missing', async () => {
  const last = ctx.comicsState.last;
  if (!last || !Array.isArray(last.missingRows) || !last.missingRows.length) return { ok: false, error: 'Compare first. There is nothing to download.' };
  const token = ctx.comicsState.token || savedSessionToken();
  if (!token) return { ok: false, error: 'Sign in first: open the Comics page on the site and press "Only what I\'m missing".' };
  const toFolder = !!(ctx.settings.comicsFolder && fs.existsSync(ctx.settings.comicsFolder));
  const batches = comicsScan.planBatches(last.missingRows, 400, 60e9).slice(0, 40);
  const base = 'https://www.armgddnbrowser.com';
  let started = 0, files = 0, bytes = 0;
  for (const batch of batches) {
    try {
      const m = await postJsonWithBearer(base + '/api/batch-manifest', { remote: 'Comics', paths: batch.map((r) => r[0]) }, token);
      if (m.statusCode === 401) return { ok: false, started, error: 'Your sign-in expired. Open the Comics page on the site and press "Only what I\'m missing" again.' };
      if (m.statusCode !== 200 || !m.json || !m.json.batchId) return { ok: false, started, error: (m.json && m.json.error) || `The site answered ${m.statusCode} when preparing the download.` };
      const t = await postJsonWithBearer(base + '/api/external-download-token', { remote: 'Comics', path: '__batch__/' + m.json.batchId }, token);
      if (t.statusCode !== 200 || !t.json || !t.json.downloadToken) return { ok: false, started, error: (t.json && t.json.error) || `The site answered ${t.statusCode} when authorizing the download.` };
      const q = { downloadToken: t.json.downloadToken, token };
      if (toFolder) q.dest = 'comics';
      handleDeepLink('armgddn://download?' + new URLSearchParams(q).toString());
      started++; files += batch.length; bytes += batch.reduce((n, r) => n + (Number(r[2]) || 0), 0);
    } catch (e) {
      return { ok: false, started, error: 'Could not reach the site: ' + (e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 1500));          // the token endpoints allow 20 calls a minute
  }
  logToFile(`[comics] started ${started} download(s) for ${files} missing comics`);
  return { ok: true, started, files, bytes, folder: toFolder ? ctx.settings.comicsFolder : ctx.settings.downloadPath };
});

ipcMain.handle('music-get-state', () => ({ folder: ctx.settings.musicFolder || '', scanned: ctx.musicState.rows ? ctx.musicState.rows.length : 0, at: ctx.musicState.at, running: ctx.musicState.running, progress: ctx.musicState.running ? (ctx.musicState.progress || { scanned: 0, current: '' }) : null }));

ipcMain.handle('music-pick-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), { properties: ['openDirectory'] }));
  if (result.canceled || !result.filePaths.length) return null;
  ctx.settings.musicFolder = result.filePaths[0];
  saveSettings();
  ctx.musicState.rows = null; ctx.musicState.at = 0; ctx.musicState.last = null;
  return ctx.settings.musicFolder;
});

ipcMain.handle('music-scan', async () => {
  if (ctx.musicState.running) return { ok: false, error: 'A scan is already running.' };
  const root = ctx.settings.musicFolder;
  if (!root || !fs.existsSync(root)) return { ok: false, error: 'Choose your music folder first.' };
  // Check the sign-in first, like the comics scan: without the library list the comparison could not run anyway.
  const info = await ctx.musicGet('/api/music/catalog-info');
  if (!info.ok) return { ok: false, needsSignIn: true, error: 'The scan did not start: ' + info.error };
  return new Promise((resolve) => {
    const { Worker } = require('worker_threads');
    ctx.musicState.running = true; ctx.musicState.progress = { scanned: 0, current: '' };
    let worker;
    const finish = (out) => { ctx.musicState.running = false; ctx.musicState.worker = null; resolve(out); };
    try { worker = new Worker(path.join(ctx.__dirname, 'musicScanWorker.js'), { workerData: { root } }); }
    catch (e) { finish({ ok: false, error: 'Could not start the scan: ' + e.message }); return; }
    ctx.musicState.worker = worker;
    worker.on('message', (m) => {
      if (m.type === 'progress') { ctx.musicState.progress = { scanned: m.scanned, current: m.current }; sendToMain('music-scan-progress', { scanned: m.scanned, current: m.current }); return; }
      if (m.type === 'done') {
        ctx.musicState.rows = m.rows; ctx.musicState.root = root; ctx.musicState.at = Date.now(); ctx.musicState.last = null;
        logToFile(`[music] scanned ${m.rows.length} files`);
        finish({ ok: true, count: m.rows.length, damaged: m.rows.filter((r) => r.damaged).length });
      }
    });
    worker.on('error', (e) => { logToFile('[music] scan failed: ' + (e && e.message)); finish({ ok: false, error: 'The scan failed: ' + (e && e.message ? e.message : e) }); });
    worker.on('exit', () => { if (ctx.musicState.running) finish({ ok: false, cancelled: true, error: 'The scan was stopped.' }); });
  });
});

ipcMain.handle('music-cancel-scan', () => { const w = ctx.musicState.worker; if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } return !!w; });

ipcMain.handle('music-info', async () => {
  const r = await ctx.musicGet('/api/music/catalog-info');
  return r.ok ? { ok: true, totals: r.json.totals || null } : r;
});

ipcMain.handle('music-compare', async (event, folder) => {
  folder = String(folder || '');
  if (folder && !isSafeLibraryFolder(folder)) return { ok: false, error: 'Unknown folder.' };
  if (!ctx.musicState.rows) return { ok: false, error: 'Scan your folder first.' };
  const r = await ctx.musicGet('/api/music/catalog' + (folder ? '?folder=' + encodeURIComponent(folder) : ''));
  if (!r.ok) return r;
  const items = Array.isArray(r.json.items) ? r.json.items : [];
  const cmp = musicScan.compare(items, ctx.musicState.rows);
  ctx.musicState.last = { missingRows: cmp.missingRows };           // kept for the download step
  const { missingRows, ...summary } = cmp;
  summary.bytesMissing = missingRows.reduce((n, x) => n + (Number(x[2]) || 0), 0);
  return { ok: true, list: r.json.list, summary };
});

ipcMain.handle('music-download-missing', async () => {
  const last = ctx.musicState.last;
  if (!last || !Array.isArray(last.missingRows) || !last.missingRows.length) return { ok: false, error: 'Compare first. There is nothing to download.' };
  const token = ctx.musicState.token || savedSessionToken();
  if (!token) return { ok: false, error: 'Sign in first: open the Music page on the site and press "Only what I\'m missing".' };
  if (!(ctx.settings.musicFolder && fs.existsSync(ctx.settings.musicFolder))) return { ok: false, error: 'Choose your music folder first.' };
  const batches = musicScan.planBatches(last.missingRows, 400, 60e9).slice(0, 40);
  const base = 'https://www.armgddnbrowser.com';
  let started = 0, files = 0, bytes = 0;
  for (const batch of batches) {
    try {
      const m = await postJsonWithBearer(base + '/api/batch-manifest', { remote: 'Music', paths: batch.map((r) => r[0]) }, token);
      if (m.statusCode === 401) return { ok: false, started, error: 'Your sign-in expired. Open the Music page on the site and press "Only what I\'m missing" again.' };
      if (m.statusCode !== 200 || !m.json || !m.json.batchId) return { ok: false, started, error: (m.json && m.json.error) || `The site answered ${m.statusCode} when preparing the download.` };
      const t = await postJsonWithBearer(base + '/api/external-download-token', { remote: 'Music', path: '__batch__/' + m.json.batchId }, token);
      if (t.statusCode !== 200 || !t.json || !t.json.downloadToken) return { ok: false, started, error: (t.json && t.json.error) || `The site answered ${t.statusCode} when authorizing the download.` };
      handleDeepLink('armgddn://download?' + new URLSearchParams({ downloadToken: t.json.downloadToken, token, dest: 'music' }).toString());
      started++; files += batch.length; bytes += batch.reduce((n, r) => n + (Number(r[2]) || 0), 0);
    } catch (e) {
      return { ok: false, started, error: 'Could not reach the site: ' + (e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 1500));          // the token endpoints allow 20 calls a minute
  }
  logToFile(`[music] started ${started} download(s) for ${files} missing tracks`);
  return { ok: true, started, files, bytes, folder: ctx.settings.musicFolder };
});
}

module.exports = { register };
