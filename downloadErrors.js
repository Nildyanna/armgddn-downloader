// Tells download failures apart from rclone's error output. Kept apart from main.js so the rules can be tested.

// rclone is a Go program: its own crashes print one of these.
const CRASH_RE = /fatal error: (fault|unexpected signal|runtime:)|\bsigsegv\b|panic: runtime error|\bgoroutine \d+ \[|\bmcall called on m->g0 stack|\bm->g0\b/i;

// Windows socket errors (wsarecv/wsasend), and the usual Go/Unix wording, for a connection the other side closed.
// Windows words the sentence in the PC's own language (English, Turkish, Dutch and others), so match the call name too.
const CONNECTION_DROP_RE = /(connection reset|connection was forcibly closed|forcibly closed|broken pipe|unexpected eof|received from peer|econnreset|rst_stream|http2|\bwsarecv\b|\bwsasend\b)/i;

// A web proxy, VPN or security software answering the secure request in plain HTTP.
const HTTP_ON_HTTPS_RE = /server gave http response to https client/i;

// The PC's proxy settings (HTTPS_PROXY and friends, often set by a VPN or proxy program) point at a program that is not running.
const DEAD_PROXY_RE = /proxyconnect tcp/i;
const DEAD_PROXY_REFUSED_RE = /(connectex|actively refused|connection refused|econnrefused|no connection could be made|i\/o timeout)/i;

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

function isDeadProxy(detail, output) {
  const t = `${detail || ''}\n${output || ''}`;
  return DEAD_PROXY_RE.test(t) && DEAD_PROXY_REFUSED_RE.test(t);
}

function isNotFound(detail, output) {
  if (isHttpOnHttps(detail, output) || isDeadProxy(detail, output) || isConnectionDrop(detail, '')) return false;
  return NOT_FOUND_DETAIL_RE.test(String(detail || '')) || NOT_FOUND_OUTPUT_RE.test(String(output || ''));
}

// Proxy variables rclone would pick up from the environment.
const PROXY_ENV_RE = /^(https?_proxy|all_proxy)$/i;
function withoutProxyEnv(env) {
  const out = {};
  for (const k of Object.keys(env || {})) if (!PROXY_ENV_RE.test(k)) out[k] = env[k];
  return out;
}
function hasProxyEnv(env) {
  return Object.keys(env || {}).some(k => PROXY_ENV_RE.test(k) && env[k]);
}

// What to tell the member when the in-app engines (segmentedDownload / resumeDownload) give up. Every failure used to read "Download stalled
// and could not be resumed", even a full disk, and that wording also started the automatic retry, which filled the same full disk again.
// The disk wordings contain "disk space" / "download folder", which the automatic retry skips (AUTO_RETRY_BLOCK_RE in main.js);
// "could not be saved yet" is retried, because a retry only has to rename the finished file.
const FULL_CODES = new Set(['ENOSPC', 'EDQUOT', 'EFBIG']);
const NO_WRITE_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);
function engineFailureText(failure) {
  const f = failure || {};
  const code = String(f.code || (/\b(E[A-Z]{3,10})\b/.exec(String(f.message || '')) || [])[1] || '');
  if (f.kind === 'expired') {
    return { headline: 'Download link expired.', hint: 'Go back to the website and start the download again to generate a fresh link.' };
  }
  if (FULL_CODES.has(code) || /no space left|disk full|not enough space/i.test(String(f.message || ''))) {
    return { headline: `You're out of disk space. (${code || 'disk full'})`, hint: 'Free up disk space or switch to a drive with more space, then click Retry. What is already downloaded is kept.' };
  }
  if (f.stage === 'finish' && NO_WRITE_CODES.has(code)) {
    return { headline: `The download finished but the file could not be saved yet (${code}).`, hint: 'Antivirus is usually still scanning it. The ARMGDDN App will try again by itself; if it keeps happening, add the folder you download into to your antivirus exclusions.' };
  }
  if (NO_WRITE_CODES.has(code)) {
    return { headline: `Can't write the file to your download folder. (${code})`, hint: 'Change the download folder to a writable location (e.g. inside your home folder) and retry.' };
  }
  return { headline: 'Download stalled and could not be resumed after several retries.', hint: 'Retry the download. If it keeps happening, change mirrors by starting the download again from the website, or lower concurrency to 1-2.' };
}

module.exports = { isCrashOutput, isConnectionDrop, isHttpOnHttps, isNotFound, isDeadProxy, withoutProxyEnv, hasProxyEnv, engineFailureText };
