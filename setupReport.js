'use strict';
// "Copy report for Tulip": the Check my setup results plus the recent warnings from the log, as one short code a
// member can paste into the chat. Everything personal is removed before it leaves the machine: user names in paths,
// URLs' query strings, e-mail addresses, IPs and anything that looks like a token. The code is
// ARMGDDN-SETUP:1:<base64url of deflated JSON>; Tulip's setup_report.py reads the same format.

const zlib = require('zlib');

const PREFIX = 'ARMGDDN-SETUP:1:';
const MAX_LOG_LINES = 20;
const MAX_LINE = 180;
const MAX_CODE = 3200;

function sanitize(text) {
  return String(text == null ? '' : text)
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1<user>')
    .replace(/(\/home\/|\/Users\/)[^/\s"']+/g, '$1<user>')
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/gi, '$1?<removed>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b(?:bearer|token|key|secret|password|pass|auth)[=:\s]+[^\s"',;]{4,}/gi, '$1=<removed>'.replace('$1', 'secret'))
    .replace(/[A-Za-z0-9_\-]{28,}/g, '<redacted>');
}

function recentProblems(logText) {
  const lines = String(logText || '').split(/\r?\n/).filter(l => /\b(error|warn|fail|failed|stall|timeout|enoent|eacces|denied)\b/i.test(l));
  return lines.slice(-MAX_LOG_LINES).map(l => sanitize(l).slice(0, MAX_LINE));
}

function buildReport({ appVersion, platform, release, arch, findings, facts, logText }) {
  const payload = {
    v: 1,
    app: String(appVersion || ''),
    os: `${platform || ''} ${release || ''} ${arch || ''}`.trim(),
    checks: (findings || []).map(f => ({ id: f.id, s: f.status, t: sanitize(f.title).slice(0, 120) })),
    facts: {
      freeDl: facts && facts.freeDownload != null ? Math.round(facts.freeDownload / 1048576) : null,    // MB
      freeTemp: facts && facts.freeTemp != null ? Math.round(facts.freeTemp / 1048576) : null,
      av: facts && Array.isArray(facts.avProducts) ? facts.avProducts.map(a => sanitize(a).slice(0, 40)) : null,
      vc: facts ? facts.vcRuntime : null,
      d3dx: facts ? facts.d3dx : null,
      dlDrive: facts && facts.downloadPath ? String(facts.downloadPath).slice(0, 3) : null,
    },
    log: recentProblems(logText),
  };
  let log = payload.log;
  for (;;) {
    payload.log = log;
    const code = PREFIX + zlib.deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }).toString('base64url');
    if (code.length <= MAX_CODE || log.length === 0) return code;
    log = log.slice(Math.ceil(log.length / 4));                  // too long: drop the oldest quarter of the log lines
  }
}

function decodeReport(code) {
  const text = String(code || '').trim();
  if (!text.startsWith(PREFIX)) throw new Error('not a setup report');
  return JSON.parse(zlib.inflateSync(Buffer.from(text.slice(PREFIX.length), 'base64url')).toString('utf8'));
}

module.exports = { buildReport, decodeReport, sanitize, recentProblems, PREFIX };
