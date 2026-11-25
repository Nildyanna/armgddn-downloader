'use strict';
// The free-space box before a download starts or resumes (2026-11-25). The rule and the arithmetic are in ../spaceCheck.js; this file adds
// what only the app knows: the other unfinished downloads, the Extract folder, and the Electron dialogs. Shared state is reached through ctx.
const ctx = require('./context');
const space = require('../spaceCheck');
const { withDialogFocus, getDialogParentWindow } = require('./dialogs');
const { logToFile } = require('./log');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const FINISHED = new Set(['completed', 'cancelled', 'error', 'failed']);

// Room still owed to the other unfinished downloads (running, queued or paused): what they have left to download, and their unpack room.
function otherDownloads(excludeId) {
  const out = [];
  for (const [id, d] of ctx.activeDownloads || []) {
    if (!d || id === excludeId || d.cancelled || FINISHED.has(String(d.status || ''))) continue;
    if (!d.downloadDir) continue;
    const total = Math.max(0, Number(d.totalSize) || 0);
    const pct = Math.max(0, Math.min(100, Number(d.progress) || 0));
    const left = Math.max(0, Math.round(total * (100 - pct) / 100));
    out.push({ dir: d.downloadDir, bytes: left, unpackDir: d.spaceUnpackDir || d.downloadDir, unpackBytes: d.didExtract ? 0 : Math.max(0, Number(d.spaceUnpackBytes) || 0) });
  }
  return out;
}

// Where .7z files of a download into downloadDir are unpacked (as main/extract.js extractTarget does).
function unpackDirFor(downloadDir) {
  try {
    const f = ctx.settings && typeof ctx.settings.extractFolder === 'string' ? ctx.settings.extractFolder.trim() : '';
    if (f && path.isAbsolute(f) && fs.existsSync(f)) return path.join(f, path.basename(downloadDir));
  } catch (e) { }
  return downloadDir;
}

function describe(result) {
  try { return result.drives.map((d) => `${d.label}: need ${d.required} free ${d.free}${d.short ? ' SHORT' : ''}`).join('; '); } catch (e) { return ''; }
}

// The box. Buttons: Choose another folder (not for a resume or a comics/music folder), Start anyway, Download without unpacking (when
// only the unpack room is missing), Cancel.
async function askDialog(result, { canChooseFolder = true, canSkipUnpack = false, resume = false } = {}) {
  const buttons = [];
  const ids = [];
  if (canChooseFolder) { buttons.push('Choose another folder'); ids.push('folder'); }
  buttons.push(resume ? 'Resume anyway' : 'Start anyway'); ids.push('anyway');
  if (canSkipUnpack) { buttons.push('Download without unpacking'); ids.push('nounpack'); }
  buttons.push('Cancel'); ids.push('cancel');
  const d = result.short;
  const { response } = await withDialogFocus(() => dialog.showMessageBox(getDialogParentWindow(), {
    type: 'warning', buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
    title: 'Not enough free space',
    message: space.shortMessage(d),
    detail: space.shortDetail(d) + (canSkipUnpack ? '\n\n"Download without unpacking" leaves the .7z files for you to unpack later.' : '')
  }));
  return ids[response] || 'cancel';
}

async function pickFolderDialog() {
  const r = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), { title: 'Choose where to save this download', properties: ['openDirectory', 'createDirectory'] }));
  return !r.canceled && r.filePaths && r.filePaths[0] ? r.filePaths[0] : null;
}

// Before a new download: may it start, and where? The base folder may change ("Choose another folder"); skipUnpack turns auto-unpack off
// for this download. ask/pickFolder/fsx can be replaced (the smoke test does).
async function checkBeforeStart({ id, baseDir, folderFor, files, unpack, canChooseFolder = true, ask, pickFolder, fsx }) {
  const opts = fsx ? { fsx } : {};
  const check = (dir, { skipUnpack }) => {
    const downloadDir = folderFor(dir);
    const willUnpack = unpack && !skipUnpack;
    return space.checkSpace(space.startNeeds({ downloadDir, files, unpack: willUnpack, extractDir: willUnpack ? unpackDirFor(downloadDir) : '', others: otherDownloads(id) }, opts), opts);
  };
  const askFn = ask || ((result, st) => {
    // "without unpacking" only when the download itself fits and the unpack room is what is missing
    let canSkipUnpack = false;
    if (unpack && !st.skipUnpack) { try { canSkipUnpack = check(baseDir, { skipUnpack: true }).ok; } catch (e) { } }
    return askDialog(result, { canChooseFolder, canSkipUnpack });
  });
  const out = await space.decideStart({ baseDir, check, ask: askFn, pickFolder: pickFolder || pickFolderDialog });
  if (out.result && !out.result.ok) logToFile(`[space] ${out.start ? (out.forced ? 'started anyway' : 'started') : 'not started'}: ${describe(out.result)}`);
  else if (out.baseDir !== baseDir) logToFile('[space] the member chose another folder; it has room');
  return out;
}

// Before Resume on a paused download: same rule, files stay where they are, so the box only offers Resume anyway or Cancel.
async function checkBeforeResume(download, { ask, fsx } = {}) {
  try {
    if (!download || !download.downloadDir || !Array.isArray(download.files) || !download.files.length) return true;
    const opts = fsx ? { fsx } : {};
    const unpackBytes = download.didExtract ? 0 : Math.max(0, Number(download.spaceUnpackBytes) || 0);
    const needs = space.startNeeds({ downloadDir: download.downloadDir, files: download.files, unpack: false, others: otherDownloads(download.id) }, opts);
    if (unpackBytes) needs.push({ dir: download.spaceUnpackDir || download.downloadDir, bytes: unpackBytes, why: 'unpack' });
    const result = space.checkSpace(needs, opts);
    if (result.ok) return true;
    const choice = await (ask ? ask(result) : askDialog(result, { canChooseFolder: false, resume: true }));
    logToFile(`[space] resume ${choice === 'anyway' ? 'anyway' : 'not resumed'}: ${describe(result)}`);
    return choice === 'anyway';
  } catch (e) {
    logToFile(`[space] resume check skipped: ${e && e.message}`);
    return true;
  }
}

module.exports = { checkBeforeStart, checkBeforeResume, otherDownloads, unpackDirFor };
