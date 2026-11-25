'use strict';
// Checking downloaded files against their checksums, and telling the site how it went (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const hashCheck = require('../hashCheck');
const { logToFile } = require('./log');
const { loadSession } = require('./session');
const { saveSettings } = require('./settings');
const { sanitizeRelativePath, resolveInside } = require('./util');
const { dialog, app } = require('electron');
const https = require('https');
const path = require('path');

// ---- File check (MD5 against the checksums the site listed) ----
// Check files is only offered when files are checked automatically before they are unpacked. With Auto extract on and automatic checking off,
// downloads are unpacked unchecked, so a later check would only report on archives that were already used.
function hashingGated() {
  return hashCheck.gated(ctx.settings);
}

async function maybeShowHashGateNotice() {
  try {
    if (!hashingGated() || ctx.settings.hashGateNoticeSeen || ctx.hashGateNoticeOpen) return;
    ctx.hashGateNoticeOpen = true;
    await ctx.withDialogFocus(() => dialog.showMessageBox(ctx.getDialogParentWindow(), {
      type: 'info',
      buttons: ['I understand'],
      defaultId: 0,
      title: 'Check files is off',
      message: 'Check files is unavailable while Auto extract is on without automatic checking.',
      detail: 'Auto extract unpacks your downloads as soon as they finish, so files would be used before anything checked them. Because of that, the Check files option is hidden.\n\nWant both? Turn on "Check files after download" in Settings. Files are then checked first, and anything that fails is reported instead of being unpacked.'
    }));
    ctx.settings.hashGateNoticeSeen = true;
    saveSettings();
  } catch (e) {
    logToFile('[hashGate] notice failed: ' + (e && e.message ? e.message : e));
  } finally {
    ctx.hashGateNoticeOpen = false;
  }
}

// Tells the site why a download attempt ended and which retries it needed: counts and kinds only, no file names (site: services/engine-reports.js).
function reportEngineToServer(download, info) {
  try { if (download && info) download.lastEngineReport = { ...info }; } catch (e) { }   // shown and sent by "Send this problem to staff"
  if (ctx.SMOKE_TEST) return;      // the built app's own test never reports to the real site or Sentry
  try {
    const token = (download && download.token) || null;
    if (!download || !token) return;
    const host = download.progressHost || 'www.armgddnbrowser.com';
    if (!ctx.isAllowedServiceHost(host)) return;
    const body = JSON.stringify({ ...info, version: app.getVersion() });
    const req = https.request({
      hostname: host, port: download.progressPort || 443, path: '/api/app-engine-report', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${token}`, 'User-Agent': `ARMGDDN-Companion/${app.getVersion()}` }
    }, (res) => { res.resume(); });
    req.on('error', () => { });
    req.setTimeout(15000, () => { try { req.destroy(); } catch (e) { } });
    req.write(body);
    req.end();
  } catch (e) { }
}

function reportHashUnavailableToServer(download) {
  if (ctx.SMOKE_TEST) return;      // the built app's own test never reports to the real site or Sentry
  try {
    const token = (download && download.token) || null;
    if (!download || !token) return;
    const host = download.progressHost || 'www.armgddnbrowser.com';
    if (!ctx.isAllowedServiceHost(host)) return;
    const body = JSON.stringify({ downloadId: download.id, remotePath: download.remotePath || '', unavailable: true });
    const req = https.request({
      hostname: host, port: download.progressPort || 443, path: '/api/app-hash-check', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${token}` }
    }, (res) => { res.resume(); });
    req.on('error', () => { });
    req.setTimeout(15000, () => { try { req.destroy(); } catch (e) { } });
    req.write(body);
    req.end();
  } catch (e) { }
}

// Live progress of a check, so the site's downloads panel can fill its bar. Sent at most every 2 seconds; the final result replaces it.
function reportHashProgressToServer(download, token, state) {
  if (ctx.SMOKE_TEST) return;      // the built app's own test never reports to the real site or Sentry
  try {
    if (!download || !token) return;
    const host = download.progressHost || 'www.armgddnbrowser.com';
    if (!ctx.isAllowedServiceHost(host)) return;
    const body = JSON.stringify({ downloadId: download.id, remotePath: download.remotePath || '', running: !state.cancelled, cancelled: !!state.cancelled, progress: state.percent, done: state.done, total: state.total });
    const req = https.request({
      hostname: host, port: download.progressPort || 443, path: '/api/app-hash-check', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${token}` }
    }, (res) => { res.resume(); });
    req.on('error', () => { });
    req.setTimeout(15000, () => { try { req.destroy(); } catch (e) { } });
    req.write(body);
    req.end();
  } catch (e) { }
}

function reportHashCheckToServer(download, token, result) {
  if (ctx.SMOKE_TEST) return;      // the built app's own test never reports to the real site or Sentry
  try {
    if (!download || !token || !result) return;
    const host = download.progressHost || 'www.armgddnbrowser.com';
    if (!ctx.isAllowedServiceHost(host)) return;
    const body = JSON.stringify({
      downloadId: download.id,
      remotePath: download.remotePath || '',
      checked: result.total, ok: result.ok, bad: result.bad.length, missing: result.missing.length, notChecked: result.notChecked,
      badNames: result.bad.slice(0, 5).map((b) => b.name),
      at: result.at
    });
    const req = https.request({
      hostname: host, port: download.progressPort || 443, path: '/api/app-hash-check', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${token}` }
    }, (res) => { res.resume(); });
    req.on('error', () => { });
    req.setTimeout(15000, () => { try { req.destroy(); } catch (e) { } });
    req.write(body);
    req.end();
  } catch (e) { }
}

// Runs the check for one download (live or finished). Progress goes to the window as 'hash-check-progress'; the result is kept and reported to the site.
async function runHashCheck(downloadId, opts) {
  const o = opts || {};
  const id = String(downloadId);
  if (hashingGated() && !o.auto) return { error: 'Check files is turned off while Auto extract is on and Check files after download is off.' };
  if (ctx.hashChecksRunning.has(id)) return { error: 'A file check is already running for this download.' };
  const doc = hashCheck.loadManifest(app.getPath('userData'), id);
  if (!doc) return { error: 'This download has no checksums to compare against.' };
  const live = ctx.activeDownloads.get(downloadId) || ctx.activeDownloads.get(id) || null;
  const downloadDir = doc.downloadDir || (live && live.name ? path.join(ctx.settings.downloadPath, live.name) : '');
  const state = { cancelled: false };
  ctx.hashChecksRunning.set(id, state);
  const siteDownload = live || { id, remotePath: '', progressHost: null };
  const siteToken = (live && live.token) || (() => { try { return loadSession(); } catch (e) { return null; } })();
  let lastSent = 0;
  let lastSite = 0;
  try {
    ctx.sendToMain('hash-check-progress', { id, done: 0, total: doc.files.length, name: '', percent: 0 });
    reportHashProgressToServer(siteDownload, siteToken, { percent: 0, done: 0, total: doc.files.length });
    const result = await hashCheck.verifyManifest(doc, {
      resolvePath: (rel) => { const safe = sanitizeRelativePath(String(rel)); return safe ? resolveInside(downloadDir, safe) : null; },
      isCancelled: () => state.cancelled,
      onProgress: (pr) => {
        const now = Date.now();
        if (live) { live.hashPercent = pr.percent; live.statusMessage = `Checking files ${pr.percent}% (${pr.done}/${pr.total})...`; }
        if (!pr.partial || now - lastSent >= 250) { lastSent = now; ctx.sendToMain('hash-check-progress', { id, done: pr.done, total: pr.total, name: pr.name, percent: pr.percent }); }
        if (now - lastSite >= 2000) { lastSite = now; reportHashProgressToServer(siteDownload, siteToken, { percent: pr.percent, done: pr.done, total: pr.total }); }
      }
    });
    if (!result.cancelled) {
      hashCheck.saveResult(app.getPath('userData'), id, result);
      reportHashCheckToServer(siteDownload, siteToken, result);
    } else {
      reportHashProgressToServer(siteDownload, siteToken, { cancelled: true });
    }
    if (live) { live.hashPercent = null; }
    const text = hashCheck.describeResult(result);
    ctx.sendToMain('hash-check-result', { id, result, text });
    logToFile(`[hashCheck] ${doc.name}: ok=${result.ok} bad=${result.bad.length} missing=${result.missing.length} notChecked=${result.notChecked}${result.cancelled ? ' (stopped)' : ''}`);
    return { result, text };
  } catch (e) {
    logToFile(`[hashCheck] failed: ${e && e.message ? e.message : e}`);
    return { error: 'The file check could not run: ' + (e && e.message ? e.message : e) };
  } finally {
    ctx.hashChecksRunning.delete(id);
  }
}

module.exports = { hashingGated, maybeShowHashGateNotice, reportEngineToServer, reportHashUnavailableToServer, reportHashProgressToServer, reportHashCheckToServer, runHashCheck };
