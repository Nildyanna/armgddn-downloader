'use strict';
// Downloads interrupted by a restart: remembering them, bringing them back as Paused, and resuming them (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const driveDirectClient = require('../driveDirectClient');
const inflightStore = require('../inflightStore');
const { handleDeepLink } = require('./deepLinks');
const { logToFile } = require('./log');
const { savedSessionToken } = require('./session');

function persistInflight(download) {
  try {
    if (!download || !download.id || !download.resume) return;
    inflightStore.upsert(ctx.inflightFile(), {
      id: download.id, name: download.name, resume: download.resume, totalSize: download.totalSize,
      grantId: download.directGrant ? (download.directGrant.finished ? '' : download.directGrant.grantId) : (download.grantId || ''),
      progress: Math.min(99, Math.round(Number(download.progress) || 0)), fileCount: download.fileCount, startTime: download.startTime, baseDir: download.baseDir || ''
    });
  } catch (e) { }
}

// A restored download that was going to a folder chosen in the free-space box: its Resume starts it again through the deep link, which
// does not carry a folder, so the folder waits here for startDownload (takeBaseDir) for a few minutes.
const pendingBaseDirs = new Map();     // download name -> { dir, until }
function rememberBaseDir(name, dir) { if (name && dir) pendingBaseDirs.set(String(name), { dir: String(dir), until: Date.now() + 10 * 60 * 1000 }); }
function takeBaseDir(name) {
  const e = pendingBaseDirs.get(String(name || ''));
  if (!e) return '';
  pendingBaseDirs.delete(String(name || ''));
  return e.until > Date.now() ? e.dir : '';
}

function dropInflight(id) { try { inflightStore.drop(ctx.inflightFile(), id); } catch (e) { } }

function loadOrphanedDownloads() {
  try {
    for (const e of inflightStore.load(ctx.inflightFile())) {
      if (ctx.activeDownloads.has(e.id)) continue;
      ctx.activeDownloads.set(e.id, {
        id: e.id, name: e.name, itemKey: '', manifestUrl: '', remotePath: '', actualRemote: '', status: 'paused', paused: true, restored: true,
        progress: e.progress, speed: '', eta: '', totalSize: e.totalSize, downloadedSize: Math.round(e.totalSize * e.progress / 100), files: [],
        fileCount: e.fileCount, completedFiles: 0, activeFiles: {}, activeProcesses: [], pendingTaskCount: 0, cancelWaiters: [], totalSpeed: 0,
        peakSpeedBytes: 0, startTime: e.startTime, endTime: null, token: null, cancelled: false, failedFiles: [], resume: e.resume, grantId: e.grantId || '', baseDir: e.baseDir || '',
        statusMessage: 'Paused when the app closed. Press Resume to continue; files already downloaded are kept.'
      });
      logToFile(`[restore] ${e.name} is back in the list as paused`);
      if (e.grantId) endOrphanedGrant(ctx.activeDownloads.get(e.id));
    }
  } catch (e) {
    logToFile(`[restore] Failed to restore unfinished downloads: ${e && e.message ? e.message : e}`);
  }
}

// A download that was cut off by the app closing never told the site how much of its direct-from-Drive grant it did not use. Resume and cancel
// of a restored download say so now, so the member's daily allowance is credited (the estimate is the part that was not reached, from the saved progress).
// It also runs for every restored download when the app starts, so a crash that is never followed by Resume or Cancel is credited as soon as the app
// is opened again. The id is forgotten only once the site has accepted the report; offline or signed out, it is kept and tried again later.
async function endOrphanedGrant(d) {
  try {
    if (!d || !d.grantId || d.__endingGrant) return;
    const token = savedSessionToken();
    if (!token) return;
    d.__endingGrant = true;
    const grantId = d.grantId;
    const remaining = Math.max(0, Math.round((Number(d.totalSize) || 0) * (100 - (Number(d.progress) || 0)) / 100));
    const ok = await driveDirectClient.reportOrphan(grantId, remaining, 'https://www.armgddnbrowser.com', token);
    d.__endingGrant = false;
    if (ok) { d.grantId = ''; if (ctx.activeDownloads.has(d.id)) persistInflight(d); }
  } catch (e) { try { d.__endingGrant = false; } catch (e2) { } }
}

// Resume of a restored download: ask the site for a fresh download token for the same item, then start it the way a click on Download does.
async function resumeRestoredDownload(downloadId) {
  const d = ctx.activeDownloads.get(downloadId);
  if (!d || !d.restored) return false;
  const say = (m) => { d.statusMessage = m; try { if (ctx.mainWindowAlive()) ctx.sendToMain('download-progress', { id: downloadId, status: 'paused', progress: d.progress, statusMessage: m }); } catch (e) { } };
  const token = savedSessionToken();
  if (!token) { say('Sign in first, then press Resume.'); return false; }
  const isBatch = !!(d.resume && Array.isArray(d.resume.paths) && d.resume.paths.length);
  if (!d.resume || !d.resume.remote || (!isBatch && !d.resume.path)) { say('This one cannot be resumed. Press Download on the game again.'); return false; }
  try {
    let tokenPath = d.resume.path;
    if (isBatch) {           // the picked items are put together again as a new batch on the site
      const b = await ctx.postJsonWithBearer('https://www.armgddnbrowser.com/api/batch-manifest', { remote: d.resume.remote, paths: d.resume.paths, exclude: d.resume.exclude || [] }, token);
      if (b.statusCode !== 200 || !b.json || !b.json.batchId) {
        say(b.statusCode === 401 ? 'Your sign-in expired. Sign in again, then press Resume.' : ((b.json && b.json.error) || `The site answered ${b.statusCode}. Try again in a moment.`));
        return false;
      }
      tokenPath = '__batch__/' + b.json.batchId;
    }
    const t = await ctx.postJsonWithBearer('https://www.armgddnbrowser.com/api/external-download-token', { remote: d.resume.remote, path: tokenPath }, token);
    if (t.statusCode !== 200 || !t.json || !t.json.downloadToken) {
      say(t.statusCode === 401 ? 'Your sign-in expired. Sign in again, then press Resume.' : ((t.json && t.json.error) || `The site answered ${t.statusCode}. Try again in a moment, or press Download on the game again.`));
      return false;
    }
    const q = { downloadToken: t.json.downloadToken, token };
    if (d.resume.dest) q.dest = d.resume.dest;
    endOrphanedGrant(d);
    if (d.baseDir) rememberBaseDir(d.name, d.baseDir);
    ctx.activeDownloads.delete(downloadId);
    dropInflight(downloadId);
    try { ctx.sendToMain('download-cancelled', { id: downloadId, cleanupWarning: false }); } catch (e) { }
    logToFile(`[restore] resuming ${d.name} with a fresh link`);
    handleDeepLink('armgddn://download?' + new URLSearchParams(q).toString());
    return true;
  } catch (e) {
    say('Could not reach the site: ' + (e && e.message ? e.message : e));
    return false;
  }
}

module.exports = { persistInflight, dropInflight, loadOrphanedDownloads, endOrphanedGrant, resumeRestoredDownload, rememberBaseDir, takeBaseDir };
