'use strict';
// "Open the setup when extraction finishes" (Nov 25 2026): opening a finished game's installer, by hand (the card's Open setup button) or once
// automatically after a clean, checked extraction (Settings > Downloads). Which file is the setup is decided by setupPick.js.
// The installer is started as the member would by double-clicking it: their own rights, no switches, its own folder as the working folder
// (so it finds its Data*.bin). Nothing here ever asks for administrator rights; an installer that needs them asks Windows itself.
const ctx = require('./context');
const { logToFile } = require('./log');
const { saveHistory } = require('./history');
const setupPick = require('../setupPick');
const { shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// The setup a history entry (or running download) points at, re-checked: an allowed name, inside the unpacked folder, a real file (no link).
function resolveSetupFile(entry) {
  if (process.platform !== 'win32') return { ok: false, why: 'not Windows' };
  if (!entry || !entry.setupRel || !entry.setupBase) return { ok: false, why: 'no setup was found for this download' };
  if (!setupPick.isAllowedSetupRel(entry.setupRel)) return { ok: false, why: 'the saved setup name is not allowed' };
  const base = path.resolve(String(entry.setupBase));
  const file = path.resolve(base, String(entry.setupRel));
  const rel = path.relative(base, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, why: 'the setup is outside the game folder' };
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, why: 'the setup is not a plain file' };
  } catch (e) { return { ok: false, why: 'the setup file is gone' }; }
  return { ok: true, file };
}

// Start the program directly (no shell, no command line built from text). If Windows refuses because the installer asks for administrator
// rights (a direct start cannot show that question), open it the way Explorer does, which lets the installer ask the member.
function startInstaller(file) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try {
      child = spawn(file, [], { cwd: path.dirname(file), detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    } catch (e) { child = null; fallback(e); return; }
    child.once('spawn', () => { try { child.unref(); } catch (e) { } finish({ ok: true, how: 'started' }); });
    child.once('error', (e) => fallback(e));
    function fallback(e) {
      if (done) return;
      const code = e && (e.code || e.errno);
      logToFile(`[setup] direct start failed (${code || (e && e.message) || 'error'}); opening it the way Explorer does`);
      shell.openPath(file).then((err) => finish(err ? { ok: false, why: err } : { ok: true, how: 'opened' })).catch((e2) => finish({ ok: false, why: (e2 && e2.message) || 'could not open it' }));
    }
  });
}

// entry: a history entry (or an active download) with setupRel/setupBase. auto: the automatic open after extraction.
async function openSetup(entry, { auto } = {}) {
  const r = resolveSetupFile(entry);
  if (!r.ok) { logToFile(`[setup] ${auto ? 'auto-open' : 'Open setup'} skipped for ${entry && entry.name ? entry.name : 'download'}: ${r.why}`); return { ok: false, error: r.why }; }
  logToFile(`[setup] ${auto ? 'Opening the setup automatically' : 'Open setup pressed'}: ${r.file}`);
  const res = await startInstaller(r.file);
  if (res.ok) {
    logToFile(`[setup] setup ${res.how}: ${r.file}`);
    if (auto) { entry.setupOpened = true; try { saveHistory(); } catch (e) { } }
    return { ok: true };
  }
  logToFile(`[setup] could not open ${r.file}: ${res.why}`);
  return { ok: false, error: 'The setup could not be opened. Use Open folder and double-click it.' };
}

// The download's setup, found from what its extraction unpacked (Windows only); stored on the download for the history entry.
function noteSetupFound(download, sets, extractDir) {
  try {
    const pick = setupPick.findSetup({ platform: process.platform, sets });
    if (pick.status === 'one') {
      download.setupRel = pick.rel;
      download.setupBase = extractDir;
      logToFile(`[setup] setup found for ${download.name || download.id}: ${pick.rel}`);
    } else if (pick.status !== 'unsupported') {
      logToFile(`[setup] no single setup for ${download.name || download.id}: ${pick.status} (${pick.why || ''})${pick.names ? ' ' + pick.names.join(', ') : ''}`);
    }
  } catch (e) { logToFile(`[setup] could not look for the setup: ${e && e.message ? e.message : e}`); }
}

// After the download is in the history: open the setup once, when the member asked for it and everything went right.
function maybeAutoOpenSetup(download, entry) {
  try {
    const go = setupPick.shouldAutoOpenSetup({
      enabled: !!(ctx.settings && ctx.settings.openSetupAfterExtract), platform: process.platform,
      setupRel: download.setupRel || '',
      didExtract: !!download.didExtract, extractionError: download.extractionError || '',
      didCheck: !!download.didCheck, checkOk: download.checkOk === true, alreadyOpened: !!entry.setupOpened,
    });
    if (!go) {
      if (download.setupRel && ctx.settings && ctx.settings.openSetupAfterExtract) logToFile(`[setup] not opened automatically: ${download.didCheck ? (download.checkOk ? '' : 'the file check found problems') : 'the files were not checked'}${download.extractionError ? ' extraction failed' : ''}`);
      return;
    }
    openSetup(entry, { auto: true }).catch(() => { });
  } catch (e) { logToFile(`[setup] auto-open failed: ${e && e.message ? e.message : e}`); }
}

module.exports = { resolveSetupFile, startInstaller, openSetup, noteSetupFound, maybeAutoOpenSetup };
