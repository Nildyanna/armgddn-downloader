'use strict';
// "Send this problem to staff" (failed download card): what goes to the site, built here so it can be tested without Electron.
// The member sees exactly this object before it is sent. Everything personal is removed with setupReport's sanitize (user folders,
// query strings, signed-link parts, Bearer tokens, cookies, e-mail addresses, IPs, long token-like strings).
// Rate limit, kept on this PC: one report per download, at most MAX_PER_DAY reports in any 24 hours. The site enforces the same.

const { sanitize } = require('./setupReport');

const MAX_LOG_LINES = 200;
const MAX_LINE = 400;
const MAX_NOTE = 1000;
const MAX_PAYLOAD = 60 * 1024;        // the site refuses more than 64 KB; keep room for the JSON wrapping
const MAX_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENGINE_FIELDS = ['outcome', 'endedBy', 'failKind', 'retries', 'reasons', 'streams', 'seconds', 'bytes', 'engine', 'mbit', 'direct', 'sizeMb'];

// The words that tie a log line to this download: its id, its name and its file names (only names long enough not to match everything).
function needlesFor(download) {
  const d = download || {};
  const out = new Set();
  if (d.id) out.add(String(d.id));
  if (d.name && String(d.name).length >= 4) out.add(String(d.name));
  for (const f of Array.isArray(d.files) ? d.files.slice(0, 200) : []) {
    const n = f && (f.name || f.path);
    if (n && String(n).length >= 4) out.add(String(n).split(/[\\/]/).pop());
  }
  return [...out].filter((n) => n.length >= 4);
}

// The last MAX_LOG_LINES lines of the log that mention this download, each cleaned and cut to MAX_LINE characters.
function logLinesFor(logText, download, max = MAX_LOG_LINES) {
  const needles = needlesFor(download);
  if (!needles.length) return [];
  const lines = String(logText || '').split(/\r?\n/).filter((l) => l && needles.some((n) => l.includes(n)));
  return lines.slice(-max).map((l) => sanitize(l).slice(0, MAX_LINE));
}

function cleanEngine(info) {
  if (!info || typeof info !== 'object') return null;
  const out = {};
  for (const k of ENGINE_FIELDS) {
    const v = info[k];
    if (v == null) continue;
    if (typeof v === 'number') out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = sanitize(v).slice(0, 80);
    else if (typeof v === 'object') {
      const o = {};
      for (const [kk, vv] of Object.entries(v).slice(0, 12)) o[sanitize(kk).slice(0, 60)] = Number(vv) || 0;
      out[k] = o;
    }
  }
  return out;
}

// download: the main process's download object; engine: its last engine report (download.lastEngineReport); note: what the member typed.
function buildPayload({ download, appVersion, os, logText, note, engine }) {
  const d = download || {};
  const payload = {
    v: 1,
    downloadId: sanitize(d.id || '').slice(0, 80),
    title: sanitize(d.name || '').slice(0, 200),
    remotePath: sanitize(d.remotePath || '').slice(0, 300),
    status: sanitize(d.status || '').slice(0, 30),
    error: sanitize(d.error || d.statusMessage || '').slice(0, 1000),
    app: String(appVersion || '').slice(0, 30),
    os: String(os || '').slice(0, 80),
    files: { total: Number(d.fileCount) || 0, done: Number(d.completedFiles) || 0 },
    sizeBytes: Number(d.totalSize) || 0,
    engine: cleanEngine(engine !== undefined ? engine : d.lastEngineReport),
    note: sanitize(String(note || '').trim()).slice(0, MAX_NOTE),
    log: logLinesFor(logText, d),
  };
  while (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD && payload.log.length) {
    payload.log = payload.log.slice(Math.ceil(payload.log.length / 4));   // too big: drop the oldest quarter of the lines
  }
  return payload;
}

// state: { sent: { [downloadId]: { id, at } }, times: [ms, ...] } (the file problem-reports.json in the app's data folder).
function normalizeState(state) {
  const s = state && typeof state === 'object' ? state : {};
  return { sent: s.sent && typeof s.sent === 'object' ? s.sent : {}, times: Array.isArray(s.times) ? s.times.filter((t) => Number.isFinite(t)) : [] };
}

function canSend(state, downloadId, now = Date.now()) {
  const s = normalizeState(state);
  const key = String(downloadId || '');
  if (!key) return { ok: false, reason: 'unknown', error: 'This download could not be found.' };
  if (s.sent[key]) return { ok: false, reason: 'already', reportId: s.sent[key].id, error: 'This problem was already sent to staff.' };
  const recent = s.times.filter((t) => now - t < DAY_MS);
  if (recent.length >= MAX_PER_DAY) return { ok: false, reason: 'daily', error: `You have sent ${MAX_PER_DAY} problems today. Try again tomorrow, or ask in the support chat.` };
  return { ok: true };
}

function recordSent(state, downloadId, reportId, now = Date.now()) {
  const s = normalizeState(state);
  const sent = { ...s.sent, [String(downloadId)]: { id: reportId, at: now } };
  // Keep the file small: the last 200 downloads, the last day of send times.
  const keys = Object.keys(sent);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete sent[k];
  return { sent, times: [...s.times.filter((t) => now - t < DAY_MS), now] };
}

function sentMap(state) {
  const s = normalizeState(state);
  return Object.fromEntries(Object.entries(s.sent).map(([k, v]) => [k, v && v.id]));
}

module.exports = { buildPayload, logLinesFor, needlesFor, cleanEngine, canSend, recordSent, sentMap, normalizeState, MAX_PER_DAY, MAX_LOG_LINES, MAX_PAYLOAD };
