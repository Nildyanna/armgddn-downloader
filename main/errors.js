'use strict';
// Reading download and server errors: which kind, a short line for members, the safe part of rclone output; and cleaning reports before they are sent (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const downloadErrors = require('../downloadErrors');
const { redactUrlQueryStrings } = require('./util');
const os = require('os');

function scrubForSentry(value) {
  let s = JSON.stringify(value);
  s = s.replace(/https?:\/\/[^\s"'\\]+/gi, (u) => {
    const i = u.indexOf('?');
    return i === -1 ? u : u.slice(0, i) + '?…';
  });
  try {
    const home = os.homedir();
    if (home) {
      for (const variant of [home, home.replace(/\\/g, '\\\\'), home.replace(/\\/g, '/')]) {
        s = s.split(variant).join('~');
      }
    }
  } catch (e) { }
  return JSON.parse(s);
}

// rclone log lines start with a timestamp; leaving it in gave every event its
// own issue.
function normalizeFailureLine(line) {
  return String(line).replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/g, '<time>');
}

function isNetworkStreamError(output) {
  const lower = String(output || '').toLowerCase();
  return lower.includes('stream error') ||
    lower.includes('received from peer') ||
    lower.includes('internal_error') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('unexpected eof') ||
    /(^|[":\s])eof\s*$/m.test(lower) ||
    lower.includes('broken pipe') ||
    lower.includes('rst_stream') ||
    lower.includes('http2') ||
    lower.includes('transport') ||
    lower.includes('client connection lost');
}

function extractRcloneErrorDetail(errorOutput) {
  try {
    const raw = String(errorOutput || '');
    if (!raw.trim()) return '';
    const redacted = redactUrlQueryStrings(raw);
    // rclone's INFO/DEBUG lines ("Starting bandwidth limiter...") are never the reason a
    // download failed. When they are all there is, report nothing so the caller falls back
    // to the exit-code message instead of showing one as the cause.
    const lines = redacted
      .split(/\r?\n/)
      .map(l => String(l || '').trim())
      .filter(Boolean)
      .filter(l => !/^(?:\S+\s+\S+\s+)?(?:INFO|DEBUG)\s*:/i.test(l));

    if (!lines.length) return '';

    const ignore = (l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith('transferred:')) return true;
      if (lower.startsWith('elapsed time:')) return true;
      if (lower.startsWith('errors:')) return true;
      if (lower.startsWith('checks:')) return true;
      if (lower.startsWith('transfers:')) return true;
      if (lower.startsWith('deleted:')) return true;
      if (lower.startsWith('renamed:')) return true;
      if (lower.startsWith('skipped:')) return true;
      if (lower.startsWith('server side copies:')) return true;
      if (lower.startsWith('elapsed:')) return true;
      if (lower.startsWith('eta:')) return true;
      return false;
    };

    const candidates = lines.filter(l => !ignore(l));
    const pickFrom = candidates.length ? candidates : lines;

    const interesting = pickFrom.find(l => /\berror\b|\bfatal\b|\bfailed\b|\bpanic\b/i.test(l));
    const chosen = interesting || pickFrom[pickFrom.length - 1] || '';

    const compact = chosen.replace(/\s+/g, ' ').trim();
    return compact.length > 280 ? compact.slice(0, 280) : compact;
  } catch (e) {
    return '';
  }
}

function formatRcloneExitCodeHint(code) {
  if (code === 3221225794 || code === 1073807364 || code === 3221225786) {
    return 'Windows ended the download (the PC was shutting down or signing out, or the app was closed). Start it again and it picks up where it stopped.';
  }
  if (code === 1) {
    return 'Something went wrong while downloading. This is often caused by an expired link, temporary provider limits, a network hiccup, or not being able to write the file to disk.';
  }

  return 'Something went wrong while downloading.';
}

function isPinnedDownloadStatusMessage(message) {
  const text = String(message || '').trim();
  return !!text && (
    /^starfield detected:/i.test(text) ||
    /^skipped \d+\/\d+ files already on disk\./i.test(text) ||
    /^all files already on disk\./i.test(text) ||
    /^no existing files found\./i.test(text)
  );
}

// The site answers NOT_IN_CHANNEL when the member has left the ARMGDDN group. Retrying or
// logging in again can't fix that, so show the site's rejoin steps instead of "session expired".
function notInChannelMessage(result) {
  if (!result || result.code !== 'NOT_IN_CHANNEL') return null;
  return String(result.message || 'You are no longer a member of the ARMGDDN group. Rejoin it, then retry the download.');
}

// Check if output indicates quota exceeded
function isQuotaError(output) {
  const lowerOutput = output.toLowerCase();
  // Strong upstream quota signals (Google Drive / provider throttling)
  const strongTokens = [
    'downloadquotaexceeded',
    'download quota exceeded',
    'too many users have viewed or downloaded this file',
    'exceeded your current quota',
    'bandwidth limit exceeded',
    'download limit exceeded',
    'suspicious activity',
    'suspicious downloads detected'
  ];

  for (const t of strongTokens) {
    if (lowerOutput.includes(t)) return true;
  }

  // Weak tokens can appear in unrelated errors. Only treat as quota if
  // there's evidence it's coming from the upstream provider.
  const weakTokens = [
    'quota exceeded',
    'rate limit exceeded',
    'user rate limit exceeded'
  ];

  const mentionsProvider = lowerOutput.includes('google') || lowerOutput.includes('drive') || lowerOutput.includes('gdrive');
  const mentionsHttpQuota = lowerOutput.includes(' 403') || lowerOutput.includes(' 429') || lowerOutput.includes('status code 403') || lowerOutput.includes('status code 429');

  for (const t of weakTokens) {
    if (lowerOutput.includes(t) && (mentionsProvider || mentionsHttpQuota)) return true;
  }

  return false;
}

// Check if output indicates our server is busy / concurrency-limited
function isServerBusyError(output) {
  const lowerOutput = output.toLowerCase();
  return lowerOutput.includes('too many active downloads') ||
    lowerOutput.includes('download rejected due to concurrency') ||
    lowerOutput.includes('global concurrency') ||
    lowerOutput.includes('please try again shortly');
}

function isLikelySignedExpiringUrl(urlString) {
  try {
    const u = new URL(String(urlString || ''));
    const host = (u && u.hostname) ? String(u.hostname).toLowerCase() : '';
    const pathname = (u && u.pathname) ? String(u.pathname) : '';
    const hasJd2 = !!u.searchParams.get('jd2');
    const hasWhatboxSig = !!(u.searchParams.get('exp') && u.searchParams.get('sig'));
    const isArmgddnHost = host === 'www.armgddnbrowser.com' || host === 'armgddnbrowser.com' || host.endsWith('.armgddnbrowser.com');
    return hasJd2 || hasWhatboxSig || (isArmgddnHost && (pathname === '/api/download-file' || pathname === '/dl'));
  } catch (e) {
    return false;
  }
}

// Check output for expired-token indicators.
// IMPORTANT: do not treat a generic 401 as "expired" unless the URL is actually
// a signed/expiring URL. Direct Whatbox paths should not surface as "expired".
// rclone is a Go program: when it dies with a runtime crash (memory fault,
// SIGSEGV, panic) its stderr holds a goroutine dump full of words like "lookup"
// and "not found" that used to be misread as DNS or expired-link errors.
function isRcloneCrashOutput(output) {
  return downloadErrors.isCrashOutput(output);
}

function isTokenExpiredError(output, fileUrl) {
  const lowerOutput = String(output || '').toLowerCase();
  const isExpiringUrl = isLikelySignedExpiringUrl(fileUrl);

  // Strong signals: treat as expired regardless of URL type.
  const strongIndicators = [
    'token expired',
    'token invalid',
    'expired token'
  ];
  for (const t of strongIndicators) {
    if (lowerOutput.includes(t)) return true;
  }

  // Weak signals: only treat as expired when we know we're using a signed URL.
  if (!isExpiringUrl) return false;

  const weakIndicators = [
    'unauthorized',
    'access denied',
    'forbidden',
    ' 401',
    ' 403',
    'status code 401',
    'status code 403'
  ];
  return weakIndicators.some(indicator => lowerOutput.includes(indicator));
}

module.exports = { scrubForSentry, normalizeFailureLine, isNetworkStreamError, extractRcloneErrorDetail, formatRcloneExitCodeHint, isPinnedDownloadStatusMessage, notInChannelMessage, isQuotaError, isServerBusyError, isLikelySignedExpiringUrl, isRcloneCrashOutput, isTokenExpiredError };
