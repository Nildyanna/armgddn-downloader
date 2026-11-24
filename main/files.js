'use strict';
// Files and folders: where things are kept, what is already on disk, the app icon, log rotation (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const { formatBytes, normalizeFileSize, resolveInside, sanitizeRelativePath } = require('./util');
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getTaskRemainingBytes(task) {
  try {
    const file = task && task.file ? task.file : null;
    const downloadDir = task && task.downloadDir ? String(task.downloadDir) : '';
    const expected = file && typeof file.size === 'number' ? Number(file.size) : 0;
    if (!downloadDir || !(expected > 0) || !file || !file.name) return expected > 0 ? expected : 0;
    const safeRel = sanitizeRelativePath(String(file.name));
    if (!safeRel) return expected;
    const outputPath = resolveInside(downloadDir, safeRel);
    if (!outputPath) return expected;
    if (!fs.existsSync(outputPath)) return expected;
    const st = fs.statSync(outputPath);
    const have = st && st.isFile && st.isFile() ? Number(st.size) : 0;
    return Math.max(0, expected - (Number.isFinite(have) ? have : 0));
  } catch (e) {
    try {
      const file = task && task.file ? task.file : null;
      const expected = file && typeof file.size === 'number' ? Number(file.size) : 0;
      return expected > 0 ? expected : 0;
    } catch (e2) {
      return 0;
    }
  }
}

// Electron throws "Failed to get 'downloads' path" when Windows has no Downloads folder for the account (removed or redirected to a drive that
// is not there). That error at startup stopped the app from opening at all, so fall back to Documents, then the home folder.
function defaultDownloadsBase() {
  for (const name of ['downloads', 'documents', 'home']) {
    try {
      const dir = app.getPath(name);
      if (dir) return dir;
    } catch (e) { /* try the next folder */ }
  }
  return os.homedir();
}

// In-app AppImage updates rename the old file to "<AppImage>.old" and never remove it, so the folder
// gained a leftover backup after every update. Once the new version has been running for a while it is
// no longer needed. Returns a short status string for the log; never throws.
function cleanupAppImageBackup(appImagePath) {
  try {
    const current = String(appImagePath || '');
    if (!current) return 'skipped: not running as an AppImage';
    const oldPath = current + '.old';
    let oldSt;
    try { oldSt = fs.lstatSync(oldPath); } catch (e) { return 'none'; }
    if (!oldSt.isFile()) return `kept: ${oldPath} is not a regular file`;
    const curSt = fs.statSync(current);
    if (!curSt.isFile() || curSt.size < 1024 * 1024) return 'kept: the current AppImage looks wrong';
    if (oldSt.mtimeMs > curSt.mtimeMs + 1000) return 'kept: the backup is newer than the running AppImage';
    fs.unlinkSync(oldPath);
    return `deleted ${oldPath}`;
  } catch (e) {
    return `failed: ${e && e.message ? e.message : e}`;
  }
}

// Security (M4): Rotate debug.log if it exceeds 10 MB to prevent unbounded disk growth.
// Keeps at most 2 log files: debug.log and debug.log.1.
function rotateLogIfNeeded(logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > 10 * 1024 * 1024) {
      const oldLog = logPath + '.1';
      try { fs.unlinkSync(oldLog); } catch (e) { }
      fs.renameSync(logPath, oldLog);
    }
  } catch (e) { /* file doesn't exist yet or stat failed — no rotation needed */ }
}

// The saved sign-in is readable by this user only (matters when the system has no keychain and the token is not encrypted).
function writeSessionFile(sessionPath, data) {
  fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(sessionPath, 0o600); } catch (e) { /* not supported on this system */ }
}

function komgaConfigPath() { return path.join(app.getPath('userData'), 'komga.json'); }

// The native window's Komga section: the same saved server and key as the classic dialog, answered as data instead of message boxes.
// The installed Companion's profile folder, when this is a different profile (the native preview keeps its own).
function installedProfileDir() {
  try {
    const dir = path.join(app.getPath('appData'), 'armgddn-downloader');
    if (path.resolve(dir) === path.resolve(app.getPath('userData'))) return null;
    return fs.existsSync(path.join(dir, 'komga.json')) ? dir : null;
  } catch (e) { return null; }
}

// Helper to get consistent app icon
function getAppIcon() {
  let iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  if (!fs.existsSync(iconPath)) {
    const resourcePath = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'assets', 'icon.ico')
      : path.join(process.resourcesPath, 'assets', 'icon.png');
    if (fs.existsSync(resourcePath)) {
      iconPath = resourcePath;
    }
  }
  return nativeImage.createFromPath(iconPath);
}

// A folder inside the library ("Artist", "Artist/Album", "Thor Collection/Thor"): relative, no "." or ".." parts, no backslash or control characters.
function isSafeLibraryFolder(f) {
  return typeof f === 'string' && f.length > 0 && f.length <= 400 && !/[\\\u0000-\u001f]/.test(f) && f.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function comicsCacheFile() { return path.join(app.getPath('userData'), 'comics-scan-cache.json'); }

function isFileCompleteOnDisk(downloadDir, file) {
  try {
    if (!downloadDir || !file || !file.name) return false;
    const expected = normalizeFileSize(file.size);
    if (!(expected > 0)) return false;
    const safeRel = sanitizeRelativePath(String(file.name));
    if (!safeRel) return false;
    const outputPath = resolveInside(downloadDir, safeRel);
    if (!outputPath) return false;
    if (!fs.existsSync(outputPath)) return false;
    const st = fs.statSync(outputPath);
    return st && st.isFile && st.isFile() && st.size === expected;
  } catch (e) {
    return false;
  }
}

// The words of the "Low Space" box, kept apart from the disk checks so they can be tested. The point to get across:
// the download folder is fine, but setup always unpacks its temp files into the Windows temp folder (C: by default).
function buildInstallSpaceWarning({ need, required, free, sameDrive, driveLabel, dlLabel }) {
  const needed = formatBytes(need);
  const lead = sameDrive
    ? `Your download folder is on ${driveLabel}, so the downloaded files and setup's temporary files both need room there. Setup unpacks about ${needed} of temporary files into your Windows temp folder, even if you install the game to another drive.`
    : `Your download folder (${dlLabel}) is fine. Setup unpacks about ${needed} of temporary files into your Windows temp folder, which is on ${driveLabel}, no matter where you save or install the game.`;
  return {
    title: sameDrive ? `Low space on ${driveLabel}` : `Your download folder is fine - ${driveLabel} needs room for setup`,
    message: sameDrive
      ? `${driveLabel} may not have enough room to download and install this game.`
      : `Downloads will go to ${dlLabel}. ${driveLabel} needs free space for setup.`,
    detail: `${lead}\n\nSpace needed: about ${formatBytes(required)}\nAvailable on ${driveLabel} now: ${formatBytes(free)}\n\n` +
      `You can still download now. Before running setup, free up space on ${driveLabel} or move your Windows temp folder to another drive. ` +
      `Steps are in the ARMGDDN App Wiki (Companion troubleshooting): "Low space on my temp drive even though I save to another drive".`
  };
}

// The folder that holds what a download wrote. For Music and Comics the files go below the library folder (Artist/Album, Series/Volume), so
// it is the deepest folder they all share; anything else (or no shared folder) is the base folder itself.
function commonOpenDir(baseDir, files) {
  try {
    if (!Array.isArray(files) || !files.length) return baseDir;
    let common = null;
    for (const f of files) {
      const parts = String((f && f.name) || '').split('/').filter(Boolean).slice(0, -1);
      if (common === null) common = parts;
      else { let i = 0; while (i < common.length && i < parts.length && common[i] === parts[i]) i++; common = common.slice(0, i); }
      if (!common.length) break;
    }
    if (!common || !common.length) return baseDir;
    return resolveInside(baseDir, common.join('/')) || baseDir;
  } catch (e) { return baseDir; }
}

module.exports = { getTaskRemainingBytes, defaultDownloadsBase, cleanupAppImageBackup, rotateLogIfNeeded, writeSessionFile, komgaConfigPath, installedProfileDir, getAppIcon, isSafeLibraryFolder, comicsCacheFile, isFileCompleteOnDisk, buildInstallSpaceWarning, commonOpenDir };
