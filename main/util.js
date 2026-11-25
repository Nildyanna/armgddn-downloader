'use strict';
// Small helpers with no app state: sizes, speeds, times, versions, safe paths, quoting (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const path = require('path');

function normalizeMirrorKey(mirror) {
  try {
    const key = String(mirror == null ? '' : mirror).trim();
    return key;
  } catch (e) {
    return '';
  }
}

function sanitizeRelativePath(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') return null;
  if (input.includes('\0')) return null;
  let cleaned = input.replace(/\\/g, '/');

  // Some archives contain Windows drive-prefixed paths (e.g. "C:Games/file") or
  // leading slashes ("/Games/file"). Treat these as "anchored" paths and
  // normalize them back into a relative path rooted at the extraction directory.
  if (/^[a-zA-Z]:/.test(cleaned)) {
    cleaned = cleaned.slice(2);
  }
  cleaned = cleaned.replace(/^\/+/, '');

  // If it is still absolute after normalization rules, reject.
  if (path.isAbsolute(cleaned)) return null;

  const normalized = path.posix.normalize(cleaned);
  if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) return null;
  if (normalized.startsWith('/')) return null;

  // 7z listings can include "Path = ." for the root entry.
  if (normalized === '.' || normalized === './') return '';

  return normalized;
}

// A folder at the top of a drive ("D:\" or "/") already ends with the separator, so adding another one made every path inside it look
// outside: a download, music or comics folder set to a whole drive failed every file with "Security error: Invalid file path".
// `p` is the path module (path.win32 in tests).
function resolveInside(baseDir, relPath, p = path) {
  const full = p.resolve(baseDir, relPath);
  const base = p.resolve(baseDir);
  if (full === base) return full;
  const prefix = base.endsWith(p.sep) ? base : base + p.sep;
  if (!full.startsWith(prefix)) return null;
  return full;
}

// Bring a window to the front. KDE Plasma's focus-stealing prevention drops focus() and can raise the wrong window, so Linux uses moveTop()
// only (CLAUDE.md: never focus() on Linux).
function raiseWindow(win, platform = process.platform) {
  try {
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
    if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
    win.show();
    if (platform === 'linux') { try { win.moveTop(); } catch (e) { } } else { win.focus(); }
    return true;
  } catch (e) { return false; }
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

// Desktop Entry spec: an Exec argument containing spaces or shell-special characters must be
// double-quoted, with " ` $ and \ backslash-escaped, and then every backslash doubled again by the
// general string-escape rule. An unquoted path with a space (e.g. "~/My Apps/Companion.AppImage")
// made the armgddn:// handler silently do nothing. Also "%" is a field code, so it becomes "%%".
function quoteDesktopExecArg(arg) {
  const raw = String(arg == null ? '' : arg).replace(/%/g, '%%');
  if (!/[\s"'\\<>~|&;$*?#()`=]/.test(raw)) return raw;
  const quoted = '"' + raw.replace(/(["`$\\])/g, '\\$1') + '"';
  return quoted.replace(/\\/g, '\\\\');
}

function redactUrlQueryStrings(text) {
  try {
    const s = String(text || '');
    if (!s) return '';
    return s.replace(/https?:\/\/\S+/gi, (u) => {
      const idx = u.indexOf('?');
      if (idx === -1) return u;
      return u.slice(0, idx) + '?…';
    });
  } catch (e) {
    return '';
  }
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function normalizeFileSize(size) {
  const n = Number(size);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Format bytes
function formatBytes(bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function clampInt(n, min, max) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function parseRcloneHttpStatus(errorOutput) {
  try {
    const s = String(errorOutput || '');
    if (!s) return null;

    const m = s.match(/\b(\d{3})\b\s+([A-Za-z][A-Za-z\s-]{1,50})/);
    if (!m) return null;
    const code = Number(m[1]);
    if (!Number.isFinite(code)) return null;
    if (code < 100 || code > 599) return null;
    const text = String(m[2] || '').trim();
    return { code, text };
  } catch (e) {
    return null;
  }
}

// Parse speed string to bytes per second
function parseSpeedToBytes(value, unit) {
  const num = parseFloat(value);
  const unitLower = unit.toLowerCase();
  if (!Number.isFinite(num)) return NaN;

  const isBinary = unitLower.includes('ib');
  const k = isBinary ? 1024 : 1000;

  if (unitLower.startsWith('t')) return num * k * k * k * k;
  if (unitLower.startsWith('g')) return num * k * k * k;
  if (unitLower.startsWith('m')) return num * k * k;
  if (unitLower.startsWith('k')) return num * k;
  return num;
}

function formatSpeed(bytesPerSec) {
  const bitsPerSec = (Number.isFinite(bytesPerSec) ? bytesPerSec : 0) * 8;
  const units = ['bp/s', 'Kbp/s', 'Mbp/s', 'Gbp/s', 'Tbp/s'];
  if (bitsPerSec <= 0) return '0 bp/s';
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bitsPerSec) / Math.log(1000))
  );
  const value = bitsPerSec / Math.pow(1000, i);
  const decimals = i >= 2 ? 1 : 0;
  const s = value.toFixed(decimals).replace(/\.0$/, '');
  return s + ' ' + units[i];
}

// Format seconds to human readable ETA
function formatEtaSeconds(totalSeconds) {
  try {
    const s = Math.floor(Number(totalSeconds));
    if (!Number.isFinite(s) || s <= 0) return '';
    const sec = s % 60;
    const min = Math.floor(s / 60) % 60;
    const hr = Math.floor(s / 3600) % 24;
    const day = Math.floor(s / 86400);
    if (day > 0) return `${day}d ${hr}h`;
    if (hr > 0) return `${hr}h ${min}m`;
    if (min > 0) return `${min}m ${sec}s`;
    return `${sec}s`;
  } catch (e) {
    return '';
  }
}

function compareVersions(a, b) {
  if (!a || !b) return 0;
  const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
  const partsB = b.split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

module.exports = { normalizeMirrorKey, sanitizeRelativePath, resolveInside, raiseWindow, escapePowerShellSingleQuoted, quoteDesktopExecArg, redactUrlQueryStrings, isPathInside, normalizeFileSize, formatBytes, clampInt, parseRcloneHttpStatus, parseSpeedToBytes, formatSpeed, formatEtaSeconds, compareVersions };
