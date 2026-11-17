'use strict';
// Turns the text of a download error into a short label that is safe to send to the site: a code or a fixed phrase, never a host, an
// address or a path. Used for the "why did this attempt retry" report.
const PHRASES = [
  [/connection dropped/i, 'dropped'], [/connection timed out|timed out|ETIMEDOUT/i, 'timed out'], [/connection closed/i, 'closed'],
  [/socket hang up/i, 'hang up'], [/too many redirects/i, 'redirects'], [/incomplete/i, 'incomplete'], [/aborted/i, 'aborted'],
  [/certificate|TLS|SSL|handshake/i, 'tls'], [/stopped/i, 'stopped']
];
function engineReason(message) {
  const m = String(message == null ? '' : message);
  const http = /\bHTTP (\d{3})\b/.exec(m);
  if (http) return `http ${http[1]}`;
  const code = /\b(E[A-Z0-9]{3,20})\b/.exec(m);
  if (code) return code[1].toLowerCase();
  for (const [re, label] of PHRASES) if (re.test(m)) return label;
  return 'other';
}
module.exports = { engineReason };
