'use strict';
// Turns the text of a download error into a short label that is safe to send to the site: a code or a fixed phrase, never a host, an
// address or a path. Used for the "why did this attempt retry" report.
const crypto = require('crypto');

// Error code families Node and HTTP/2 use ("ERR_HTTP2_STREAM_ERROR", "NGHTTP2_REFUSED_STREAM", "HPE_INVALID_CONSTANT", "ECONNRESET").
const CODE = /\b(ERR_[A-Z0-9_]{3,40}|NGHTTP2_[A-Z0-9_]{3,40}|HPE_[A-Z0-9_]{3,40}|E[A-Z0-9]{3,20})\b/;

const PHRASES = [
  [/connection dropped/i, 'dropped'], [/connection timed out|timed out|timeout/i, 'timed out'], [/connection closed/i, 'closed'],
  [/socket hang up/i, 'hang up'], [/too many redirects/i, 'redirects'], [/incomplete/i, 'incomplete'], [/aborted/i, 'aborted'],
  [/certificate|TLS|SSL|handshake/i, 'tls'], [/stopped/i, 'stopped'],
  [/premature close/i, 'premature close'], [/goaway|session (was )?closed|stream (was )?closed|stream reset/i, 'h2 closed'],
  [/parse error|invalid (header|response|chunk)|malformed/i, 'bad response'], [/unexpected end|ended unexpectedly|end of (file|stream)/i, 'unexpected end'],
  [/disconnected before|socket disconnected|client network socket/i, 'disconnected'], [/network (is )?unreachable|no route/i, 'unreachable'],
];

function engineReason(message) {
  const m = String(message == null ? '' : message);
  const http = /\bHTTP (\d{3})\b/.exec(m);
  if (http) return `http ${http[1]}`;
  const code = CODE.exec(m);
  if (code) return code[1].toLowerCase().replace(/_/g, ' ').slice(0, 40);
  for (const [re, label] of PHRASES) if (re.test(m)) return label;
  // Not recognised: a short fingerprint of the wording (digits removed, so ports and sizes do not split it). The text itself never leaves
  // the PC; the same wording always gives the same label, so a member's debug.log can be matched against it.
  const fp = crypto.createHash('sha1').update(m.toLowerCase().replace(/\d+/g, '#').trim()).digest('hex').slice(0, 6);
  return `other ${fp}`;
}
module.exports = { engineReason };
