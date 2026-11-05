// Tells download failures apart from rclone's error output. Kept apart from main.js so the rules can be tested.

// rclone is a Go program: its own crashes print one of these.
const CRASH_RE = /fatal error: (fault|unexpected signal|runtime:)|\bsigsegv\b|panic: runtime error|\bgoroutine \d+ \[|\bmcall called on m->g0 stack|\bm->g0\b/i;

// Windows socket errors (wsarecv/wsasend), and the usual Go/Unix wording, for a connection the other side closed.
// Windows words the sentence in the PC's own language (English, Turkish, Dutch and others), so match the call name too.
const CONNECTION_DROP_RE = /(connection reset|connection was forcibly closed|forcibly closed|broken pipe|unexpected eof|received from peer|econnreset|rst_stream|http2|\bwsarecv\b|\bwsasend\b)/i;

// A web proxy, VPN or security software answering the secure request in plain HTTP.
const HTTP_ON_HTTPS_RE = /server gave http response to https client/i;

// A real "not found" from the server: only the error line counts, and the CopyURL wording.
// (Matching the whole output turned unrelated failures into "the link looks expired".)
const NOT_FOUND_DETAIL_RE = /(\b404\b|not found)/i;
const NOT_FOUND_OUTPUT_RE = /copyurl failed: 404|\b404 not found\b/i;

function isCrashOutput(output) {
  return CRASH_RE.test(String(output || ''));
}

function isConnectionDrop(detail, output) {
  return CONNECTION_DROP_RE.test(String(detail || '')) || /connection reset/i.test(String(output || ''));
}

function isHttpOnHttps(detail, output) {
  return HTTP_ON_HTTPS_RE.test(String(detail || '')) || HTTP_ON_HTTPS_RE.test(String(output || ''));
}

function isNotFound(detail, output) {
  if (isHttpOnHttps(detail, output) || isConnectionDrop(detail, '')) return false;
  return NOT_FOUND_DETAIL_RE.test(String(detail || '')) || NOT_FOUND_OUTPUT_RE.test(String(output || ''));
}

module.exports = { isCrashOutput, isConnectionDrop, isHttpOnHttps, isNotFound };
