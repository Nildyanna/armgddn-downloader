'use strict';
// Komga: the classic prompt and the built-in window's Komga panel (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const komga = require('../komga');
const { installedProfileDir } = require('./files');
const { komgaAddFromCatalog } = require('./komgaActions');
const { saveKomgaConfig, loadKomgaConfig, forgetKomgaKey } = require('./komgaConfig');
const { logToFile } = require('./log');
const { ipcMain } = require('electron');

function register() {
ipcMain.handle('komga-get-defaults', () => ({ url: 'http://localhost:25600' }));

ipcMain.handle('komga-cancel', () => { if (ctx.komgaPromptWin && !ctx.komgaPromptWin.isDestroyed()) ctx.komgaPromptWin.close(); });

ipcMain.handle('komga-submit', (event, data) => {
  const url = komga.normalizeBaseUrl(data && data.url);
  const key = String((data && data.key) || '').trim();
  if (!url) return { error: 'That address does not look right. Example: http://localhost:25600' };
  if (!key) return { error: 'Paste your Komga API key.' };
  if (ctx.komgaPromptResolve) { const r = ctx.komgaPromptResolve; ctx.komgaPromptResolve = null; r({ url, key }); }
  if (ctx.komgaPromptWin && !ctx.komgaPromptWin.isDestroyed()) ctx.komgaPromptWin.close();
  return { ok: true };
});

ipcMain.handle('native-komga-import', async () => {
  const dir = installedProfileDir();
  if (!dir) return { ok: false, error: 'There is no other Companion profile with a saved Komga key to import.' };
  try {
    const got = await require('../komgaImport').readInstalledKomga(dir);
    const url = komga.normalizeBaseUrl(got.url);
    if (!url || !got.key) return { ok: false, error: 'The saved Komga settings in the installed Companion are not usable.' };
    await saveKomgaConfig({ url, key: got.key });
    logToFile('[Komga] imported the installed Companion\'s saved server (' + url + ')');
    return { ok: true, url };
  } catch (e) { return { ok: false, error: e && e.message ? e.message : 'Could not import the key.' }; }
});

ipcMain.handle('native-komga-state', async () => {
  const cfg = await loadKomgaConfig();
  return { url: cfg ? cfg.url : '', hasKey: !!cfg, canImport: !cfg && !!installedProfileDir(), defaultUrl: 'http://localhost:25600', lists: Object.entries(ctx.KOMGA_LISTS).map(([id, l]) => ({ id, title: l.title })) };
});

ipcMain.handle('native-komga-save', async (event, data) => {
  const url = komga.normalizeBaseUrl(data && data.url);
  const key = String((data && data.key) || '').trim();
  if (!url) return { ok: false, error: 'That address does not look right. Example: http://localhost:25600' };
  const old = await loadKomgaConfig();
  const useKey = key || (old && old.url === url ? old.key : '');
  if (!useKey) return { ok: false, error: 'Paste your Komga API key.' };
  await saveKomgaConfig({ url, key: useKey });
  return { ok: true, url };
});

ipcMain.handle('native-komga-forget', () => { forgetKomgaKey(); return { ok: true }; });

// The reading orders a member can add: the site's catalog lists with more than 40 comics (the pipeline's own rule for a real reading order),
// biggest first. Without a sign-in the six classic ones are offered, so the card is never empty.
ipcMain.handle('native-komga-lists', async () => {
  try {
    const r = await ctx.comicsGet('/api/comics/catalog-info');
    if (r && r.ok && r.json && Array.isArray(r.json.lists)) {
      const lists = r.json.lists.filter((l) => l && /^[a-z0-9-]+$/.test(String(l.id || '')) && Number(l.books) > 40)
        .sort((a, b) => Number(b.books) - Number(a.books)).map((l) => ({ id: l.id, title: String(l.name || l.id), books: Number(l.books) }));
      if (lists.length) return { ok: true, lists };
    }
  } catch (e) { logToFile('Komga (native): could not load the reading orders: ' + (e && e.message ? e.message : e)); }
  return { ok: false, lists: Object.entries(ctx.KOMGA_LISTS).map(([id, l]) => ({ id, title: l.title, books: 0 })) };
});

// Adds (or replaces) a reading order in the member's own Komga. The comics are found the way the pipeline identifies them (see komga.js):
// by the exact file, then by Comic Vine id, never by series name.
ipcMain.handle('native-komga-add', async (event, listId) => {
  if (!komga.isValidListId(listId)) return { ok: false, error: 'Unknown reading list.' };
  if (ctx.komgaBusy) return { ok: false, error: 'Another list is being added. Try again in a moment.' };
  ctx.komgaBusy = true;
  try {
    const cfg = await loadKomgaConfig();
    if (!cfg) return { ok: false, needsSetup: true, error: 'Save your Komga address and API key first.' };
    const r = await komgaAddFromCatalog(cfg, listId);
    if (r.catalogMissing) return { ok: false, error: r.error };
    if (r.ok) return { ok: true, replaced: !!r.replaced, count: r.count, total: r.total, byFile: r.byFile, byCv: r.byCv, missing: r.missing, name: r.name };
    if (r.reason === 'auth' || r.reason === 'unreachable') forgetKomgaKey();
    return { ok: false, reason: r.reason, error: r.message, needsSetup: r.reason === 'auth' || r.reason === 'unreachable' };
  } finally { ctx.komgaBusy = false; }
});
}

module.exports = { register };
