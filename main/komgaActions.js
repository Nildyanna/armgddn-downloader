'use strict';
// Komga: asking for the member's server, adding reading orders, and the confirmation for Komga links (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const komga = require('../komga');
const { getAppIcon } = require('./files');
const { loadKomgaConfig, saveKomgaConfig, forgetKomgaKey } = require('./komgaConfig');
const { logToFile } = require('./log');
const { denyNewWindows } = require('./windows');
const { BrowserWindow, dialog, app } = require('electron');
const path = require('path');

function promptKomgaSettings() {
  return new Promise((resolve) => {
    if (ctx.komgaPromptWin && !ctx.komgaPromptWin.isDestroyed()) { ctx.komgaPromptWin.focus(); return resolve(null); }
    ctx.komgaPromptResolve = resolve;
    ctx.komgaPromptWin = new BrowserWindow({
      width: 460, height: 400, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
      title: 'Add to My Komga', icon: getAppIcon(),
      webPreferences: { preload: path.join(ctx.__dirname, 'preload-komga.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try { ctx.komgaPromptWin.setMenu(null); } catch (e) { }
    denyNewWindows(ctx.komgaPromptWin);
    ctx.komgaPromptWin.loadFile(path.join(ctx.__dirname, 'renderer', 'komga.html'));
    ctx.komgaPromptWin.on('closed', () => {
      ctx.komgaPromptWin = null;
      if (ctx.komgaPromptResolve) { const r = ctx.komgaPromptResolve; ctx.komgaPromptResolve = null; r(null); }
    });
  });
}

// Builds (or replaces) a read list in the member's own Komga from the site's catalog, the way the pipeline identifies comics: by the exact file,
// then by Comic Vine id, never by series name (see komga.js). Shared by the classic window and the native window.
// -> the result of komga.addCatalogReadList plus { name }, or { ok: false, catalogMissing: true, error } when the site has no such reading order.
async function komgaAddFromCatalog(cfg, listId) {
  const cat = await ctx.comicsGet('/api/comics/catalog?list=' + encodeURIComponent(listId));
  if (!cat || !cat.ok || !cat.json || !Array.isArray(cat.json.items) || !cat.json.items.length) {
    logToFile('Komga: no catalog list for "' + listId + '": ' + ((cat && cat.error) || 'no answer'));
    return { ok: false, catalogMissing: true, error: (cat && cat.error) || 'Could not get the reading order from ARMGDDN. Try again in a moment.' };
  }
  const title = String((cat.json.list && cat.json.list.name) || (ctx.KOMGA_LISTS[listId] && ctx.KOMGA_LISTS[listId].title) || listId);
  const name = `${title} - Suggested Reading Order`;
  const r = await komga.addCatalogReadList({ baseUrl: cfg.url, apiKey: cfg.key, name, items: cat.json.items });
  if (r.ok) {
    logToFile(`Komga: ${r.replaced ? 'updated' : 'added'} "${name}" (${r.count} of ${r.total} comics: ${r.byFile} by file, ${r.byCv} by Comic Vine id; ${r.missing} not in this Komga)`);
    return { ...r, name };
  }
  logToFile('Komga: add failed (' + r.reason + (r.step ? ' at ' + r.step + ', status ' + r.status : '') + ')');
  return r;
}

async function komgaMessage(type, message, detail) {
  const opts = { type, title: 'Add to My Komga', message, detail: detail || undefined, buttons: ['OK'] };
  try { return ctx.mainWindowAlive() ? await dialog.showMessageBox(ctx.mainWindow, opts) : await dialog.showMessageBox(opts); } catch (e) { }
}

async function addReadListToKomga(listId) {
  if (!komga.isValidListId(listId)) return;
  if (ctx.komgaBusy) return;
  ctx.komgaBusy = true;
  try {
    if (!ctx.sessionToken) {
      await komgaMessage('info', 'Log in to the Companion first', 'Open the Companion, log in, then click Add to My Komga on the site again.');
      return;
    }
    let cfg = await loadKomgaConfig();
    if (!cfg) {
      cfg = await promptKomgaSettings();
      if (!cfg) return;
      await saveKomgaConfig(cfg);
    }

    // The site's catalog names every comic exactly, so the list matches the member's own files. A reading order the catalog does not know falls back
    // to the reading-order file below (which only carries series, number and year).
    const c = await komgaAddFromCatalog(cfg, listId);
    if (!c.catalogMissing) {
      if (c.ok) {
        await komgaMessage('info', `${c.replaced ? 'Updated' : 'Added'} "${c.name}" ${c.replaced ? 'in' : 'to'} your Komga`,
          `${c.count} of ${c.total} comics are in the read list, in reading order (${c.byFile} matched by file${c.byCv ? `, ${c.byCv} by Comic Vine id` : ''}).`
            + (c.missing ? ` ${c.missing} are not in your Komga library yet, so they were left out.` : ''));
        return;
      }
      if (c.reason === 'auth' || c.reason === 'unreachable') forgetKomgaKey();
      await komgaMessage('error', c.message, c.reason === 'auth' || c.reason === 'unreachable'
        ? 'Your saved Komga details were cleared. Click Add to My Komga again to enter them again.' : undefined);
      return;
    }

    let xml;
    let listName = (ctx.KOMGA_LISTS[listId] && ctx.KOMGA_LISTS[listId].title) || '';
    try {
      const resp = await fetch(`https://www.armgddnbrowser.com/api/komga-readlist?id=${encodeURIComponent(listId)}`, {  // www directly: the bare domain redirects, and a redirect drops the login header
        headers: { 'Authorization': 'Bearer ' + ctx.sessionToken, 'User-Agent': 'ARMGDDN-Companion/' + app.getVersion() },
        signal: AbortSignal.timeout(30000)
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      try { const n = decodeURIComponent(resp.headers.get('x-readlist-name') || ''); if (n) listName = n; } catch (e) { }
      xml = await resp.text();
      if (!/<ReadingList[\s>]/.test(xml)) throw new Error('reply was not a reading list');
    } catch (e) {
      logToFile('Komga: could not get read list from the site: ' + (e && e.message ? e.message : e));
      await komgaMessage('error', 'Could not get the read list from ARMGDDN', 'Try again in a moment.');
      return;
    }

    const r = await komga.addReadList({ baseUrl: cfg.url, apiKey: cfg.key, xml, fileName: `${listName || listId} - Suggested Reading Order.cbl` });
    if (r.ok) {
      logToFile(`Komga: ${r.replaced ? 'updated' : 'added'} "${listName || listId}" (${r.count} issues, ${r.missing} not in library)`);
      await komgaMessage('info', `${r.replaced ? 'Updated' : 'Added'} "${listName || listId}" ${r.replaced ? 'in' : 'to'} your Komga`,
        `${r.count} issues are in the read list.`
          + (r.ambiguous ? ` ${r.ambiguous} could belong to more than one series in your Komga, so they were left out instead of guessed.` : '')
          + ((r.missing - (r.ambiguous || 0)) > 0 ? ` ${r.missing - (r.ambiguous || 0)} are not in your Komga library yet, so they were left out.` : ''));
      return;
    }
    logToFile('Komga: add failed (' + r.reason + ')');
    if (r.reason === 'auth' || r.reason === 'unreachable') forgetKomgaKey();
    await komgaMessage('error', r.message, r.reason === 'auth' || r.reason === 'unreachable'
      ? 'Your saved Komga details were cleared. Click Add to My Komga again to enter them again.' : undefined);
  } finally {
    ctx.komgaBusy = false;
  }
}

// Handle deep link
async function confirmKomgaDeepLink(listId) {
  if (!komga.isValidListId(listId)) return false;
  const name = String((ctx.KOMGA_LISTS[listId] && ctx.KOMGA_LISTS[listId].title) || listId);
  const r = await ctx.withDialogFocus(() => dialog.showMessageBox(ctx.getDialogParentWindow(), {
    type: 'question', buttons: ['Add it', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    title: 'Add to My Komga', message: 'Add the reading order "' + name + '" to your Komga?',
    detail: 'A link asked the Companion to add this reading order. Choose Cancel if you did not click Add to My Komga on the ARMGDDN site.'
  }));
  return !!r && r.response === 0;
}

module.exports = { promptKomgaSettings, komgaAddFromCatalog, komgaMessage, addReadListToKomga, confirmKomgaDeepLink };
