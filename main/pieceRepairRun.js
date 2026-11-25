'use strict';
// Runs "repair instead of re-download" (main/pieceRepair.js) for the files a finished download's automatic check found damaged:
// asks the site for piece fingerprints, downloads only the damaged pieces through the segmented engine (repairRanges), and falls back
// to downloading that one file again. Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const directEndpoint = require('../directEndpoint');
const hashCheck = require('../hashCheck');
const { repairRanges } = require('../segmentedDownload');
const { repairFile } = require('./pieceRepair');
const { logToFile } = require('./log');
const { fetchManifestRidingOutNetwork } = require('./manifest');
const { transformProxyUrlToDirectIfPossible } = require('./net');
const { updateProgress } = require('./progress');
const { sanitizeRelativePath, resolveInside, normalizeFileSize } = require('./util');
const { app } = require('electron');
const https = require('https');
const path = require('path');

const MAX_FILES = 20;      // more damaged files than this points at a bad disk or folder, not a few bad pieces: just report them
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Referer': 'https://www.armgddnbrowser.com/',
  'Origin': 'https://www.armgddnbrowser.com',
  'Accept': '*/*'
};

function enabled() {
  return !(ctx.settings && ctx.settings.repairDamagedFiles === false);
}

// POST /api/app-piece-fingerprints (site: routes/app-piece-fingerprints.js). Never logs the answer's contents.
function askFingerprints(download, entry) {
  return new Promise((resolve) => {
    const host = download.progressHost || 'www.armgddnbrowser.com';
    if (!download.token || !ctx.isAllowedServiceHost(host)) return resolve({ state: 'unavailable', reason: 'no session' });
    const body = JSON.stringify({ remote: String(download.actualRemote || ''), path: String(entry.path || ''), size: entry.size, md5: entry.md5 });
    const req = https.request({
      hostname: host, port: download.progressPort || 443, path: '/api/app-piece-fingerprints', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${download.token}`, 'User-Agent': `ARMGDDN-Companion/${app.getVersion()}` }
    }, (res) => {
      let data = '';
      res.on('data', (d) => { if (data.length < 4 * 1024 * 1024) data += d; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(data); } catch (e) { }
        const code = res.statusCode || 0;
        if (code === 200 && j && j.success) return resolve({ state: 'ready', size: j.size, pieceSize: Number(j.pieceSize), sha256: j.sha256 });
        if (code === 202 || (code === 429 && j && j.retryAfter)) return resolve({ state: 'computing', retryAfter: Number(j.retryAfter || res.headers['retry-after']) || 15 });
        resolve({ state: 'unavailable', reason: `HTTP ${code}${j && j.changed ? ' (changed on the server)' : ''}${j && j.disabled ? ' (switched off)' : ''}` });
      });
    });
    req.on('error', (e) => resolve({ state: 'unavailable', reason: e && e.message ? e.message : 'error' }));
    req.setTimeout(30000, () => { try { req.destroy(new Error('timeout')); } catch (e) { } });
    req.end(body);
  });
}

// A fresh link for the file from a new download list (the list also tells the site this member was offered the file, which the
// fingerprint route checks). Returns a source for the segmented engine, or the old link when the list has no match.
async function freshSource(download, entry) {
  if (!download.manifestUrl || !download.token) return { url: String(entry.url || '') };
  const m = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, '');
  const hit = m && Array.isArray(m.files) ? m.files.find((f) => f && ((entry.path && f.path && String(f.path) === String(entry.path)) || (f.name && String(f.name) === String(entry.name)))) : null;
  if (m && m.actualRemote) download.actualRemote = String(m.actualRemote);
  if (!hit || !hit.url) return { url: String(entry.url || '') };
  let u = String(hit.url);
  try { u = transformProxyUrlToDirectIfPossible(u) || u; } catch (e) { }
  return { url: u, headers: hit.headers, expiresAt: hit.expiresAt, fallback: hit.fallback };
}

// r: { result, text } from runHashCheck. Returns the same shape, with repaired files moved from bad to ok.
async function repairDamagedFiles(downloadId, download, r) {
  const res = r && r.result;
  if (!enabled() || !res || !res.bad || !res.bad.length || !download) return r;
  if (res.bad.length > MAX_FILES) { logToFile(`[repair] ${res.bad.length} damaged files: not repairing, reporting only`); return r; }
  const id = String(downloadId);
  const doc = hashCheck.loadManifest(app.getPath('userData'), id);
  const downloadDir = (doc && doc.downloadDir) || download.rootDir || path.join(ctx.settings.downloadPath, download.name || 'Download');
  const files = Array.isArray(download.files) ? download.files : [];
  const cancelled = () => ['cancelled', 'paused'].includes(String(download.status || '')) || !!download.__repairCancel;
  const status = (text) => { download.statusMessage = text; try { updateProgress(downloadId); } catch (e) { } };
  const stillBad = [];
  let fixed = 0;
  for (const b of res.bad) {
    const entry = files.find((f) => f && String(f.name) === String(b.name));
    const md5 = entry ? hashCheck.expectedMd5(entry) : null;
    const size = entry ? normalizeFileSize(entry.size) : 0;
    const safe = entry ? sanitizeRelativePath(String(entry.name)) : null;
    const filePath = safe ? resolveInside(downloadDir, safe) : null;
    if (!entry || !md5 || !(size > 0) || !filePath || cancelled()) { stillBad.push(b); continue; }
    let source = null;
    let active = null;
    const getFreshUrl = async () => { source = await freshSource(download, entry); return source; };
    const t0 = Date.now();
    const out = await repairFile({
      filePath, size, md5,
      isCancelled: () => { const c = cancelled(); if (c && active) { try { active.abort('cancelled'); } catch (e) { } } return c; },
      getFingerprints: async () => { if (!source) { try { await getFreshUrl(); } catch (e) { source = { url: String(entry.url || '') }; } } return askFingerprints(download, entry); },
      fetchPieces: async ({ pieceSize, pieces }) => {
        if (!source) await getFreshUrl();
        const streams = Math.max(1, Math.min(8, Number(ctx.settings && ctx.settings.connectionsPerFile) || 4));
        const limit = (Number(ctx.settings && ctx.settings.maxDownloadSpeedMBps) || 0) * 1048576;
        active = repairRanges({
          outputPath: filePath, expectedSize: size, pieceSize, pieces, url: source.url, source, getFreshUrl, headers: HEADERS,
          streams, maxBytesPerSec: limit, tlsOptions: directEndpoint.tlsOptions(),
          onEvent: (m) => logToFile(`[repair] ${entry.name}: ${m}`)
        });
        try { await active.promise; } finally { active = null; }
      },
      onStatus: status
    });
    logToFile(`[repair] ${entry.name}: ${out.outcome}${out.pieces != null ? ` pieces=${out.pieces}` : ''}${out.bytes != null ? ` bytes=${out.bytes}` : ''} in ${Math.round((Date.now() - t0) / 1000)}s${out.reason ? ` (${out.reason})` : ''}`);
    if (out.outcome === 'repaired' || out.outcome === 'redownloaded') fixed++;
    else stillBad.push(b);
  }
  if (!fixed) return r;
  const result = { ...res, at: Date.now(), ok: res.ok + fixed, bad: stillBad, repaired: fixed };
  try { hashCheck.saveResult(app.getPath('userData'), id, result); } catch (e) { }
  const text = `${hashCheck.describeResult(result)} ${fixed} damaged file${fixed === 1 ? ' was' : 's were'} repaired.`;
  return { result, text };
}

module.exports = { repairDamagedFiles, askFingerprints };
