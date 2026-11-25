'use strict';
// Finishing downloads: checking, unpacking, the notification, cleaning up cancelled files, and failure messages (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const downloadErrors = require('../downloadErrors');
const driveDirectClient = require('../driveDirectClient');
const { pruneEmptyDirs } = require('../emptyDirs');
const hashCheck = require('../hashCheck');
const { mainWindowAlive, sendToMain } = require('./dialogs');
const { finishPlan, isStarfieldAutoExtractTargetValue, peakOrAverageSpeedBytes, getDownloadItemKey, normalizeDownloadItemKey, getHistoryItemKey } = require('./downloadState');
const { extractRcloneErrorDetail, isRcloneCrashOutput, formatRcloneExitCodeHint } = require('./errors');
const { extractTarget, run7zExtract } = require('./extract');
const { clockCertMessage } = require('./failures');
const { hashingGated, reportHashUnavailableToServer, runHashCheck } = require('./hashing');
const { saveHistory } = require('./history');
const { installSpaceTip } = require('./installSpace');
const { logToFile } = require('./log');
const { updateProgress, reportProgressToServer } = require('./progress');
const { dropInflight } = require('./restore');
const { find7zArchivesInDir } = require('./sevenZip');
const { formatSpeed, isPathInside, sanitizeRelativePath, resolveInside } = require('./util');
const { app, Notification } = require('electron');
const fs = require('fs');
const path = require('path');

// Helper: show OS-level notification (tray balloon vs toast)
function showDownloadNotification(title, body) {
  try {
    // Respect user setting
    if (ctx.settings && ctx.settings.showNotifications === false) return;

    const windowHidden = !ctx.mainWindow || !ctx.mainWindow.isVisible();

    // On Windows, if app is hidden to tray, prefer tray balloon
    if (process.platform === 'win32' && ctx.tray && windowHidden && typeof ctx.tray.displayBalloon === 'function') {
      ctx.tray.displayBalloon({
        title: title,
        content: body
      });
      return;
    }

    // Linux: never call Electron's own Notification (libnotify can abort the whole app on some desktops); notify-send runs in a child process
    if (process.platform === 'linux') {
      require('../notify').linuxNotify(title, body);
      return;
    }

    // Fallback to Electron Notification (OS toast where supported)
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const notif = new Notification({ title, body });
      notif.show();
    }
  } catch (e) {
    logToFile('Notification error: ' + e.message);
  }
}

function formatDownloadFailedMessage(code, errorOutput) {
  const detail = extractRcloneErrorDetail(errorOutput);
  const lower = String(errorOutput || '').toLowerCase();

  if (isRcloneCrashOutput(errorOutput)) {
    return ctx.withSupportFooter(
      `The download engine (rclone) crashed on this PC. (${detail || 'fatal error'})`,
      'This is not a link problem. Security software or a driver/memory issue on this PC is the usual cause: add the Companion folder to your antivirus exclusions, restart the PC, update to the latest Companion, and retry.'
    );
  }

  if (detail) {
    if (/(permission denied|access is denied|operation not permitted)/i.test(detail) || lower.includes('permission denied') || lower.includes('access is denied')) {
      return ctx.withSupportFooter(
        `Can't write the file to your download folder. (${detail})`,
        'Change the download folder to a writable location (e.g. inside your home folder) and retry.'
      );
    }
    if (/(no space left on device|disk full|not enough space)/i.test(detail) || lower.includes('no space left')) {
      return ctx.withSupportFooter(
        `You're out of disk space. (${detail})`,
        'Free up disk space or switch to a drive with more space, then retry.'
      );
    }
    if (/(file exists|already exists)/i.test(detail)) {
      return ctx.withSupportFooter(
        `A file with the same name already exists. (${detail})`,
        'Delete/rename the existing file or choose a different folder, then retry.'
      );
    }
    if (downloadErrors.isDeadProxy(detail, errorOutput)) {
      // The PC's proxy settings point at a program that is not running (a VPN or proxy tool that was closed). The automatic retry
      // (and every download after it) runs rclone without those settings.
      ctx.ignoreProxyEnv = true;
      return ctx.withSupportFooter(
        `This PC is set to use a proxy that is not running. (${detail})`,
        'The Companion will retry without the proxy. If it keeps failing, start your VPN or proxy program again, or remove its proxy setting in Windows.'
      );
    }
    if (downloadErrors.isHttpOnHttps(detail, errorOutput)) {
      return ctx.withSupportFooter(
        `Something on this PC is interfering with the secure connection to the download server. (${detail})`,
        'A VPN, proxy or security program is answering in plain HTTP. Pause the VPN or proxy, or add the Companion to the security program\'s exclusions, then retry.'
      );
    }
    if (downloadErrors.isNotFound(detail, errorOutput)) {
      return ctx.withSupportFooter(
        `The download link looks invalid or expired (file not found). (${detail})`,
        'Go back to the website and start the download again to generate a fresh link.'
      );
    }
    if (/(\b401\b|\b403\b|unauthorized|forbidden)/i.test(detail) || lower.includes('unauthorized') || lower.includes('forbidden')) {
      return ctx.withSupportFooter(
        `Authorization failed (the link may be expired). (${detail})`,
        'Go back to the website and start the download again to generate a fresh link.'
      );
    }
    if (/(\b429\b|too many requests|rate limit)/i.test(detail) || lower.includes('too many requests')) {
      return ctx.withSupportFooter(
        `The server is rate-limiting the download right now. (${detail})`,
        'Wait a few minutes and retry. Avoid running multiple downloads at once.'
      );
    }
    if (/(timeout|timed out|deadline exceeded)/i.test(detail) || lower.includes('timeout')) {
      return ctx.withSupportFooter(
        `The download timed out. (${detail})`,
        'Retry the download. If it keeps timing out, try a different network or lower concurrency.'
      );
    }
    if (downloadErrors.isConnectionDrop(detail, errorOutput)) {
      return ctx.withSupportFooter(
        `The connection dropped mid-download. (${detail})`,
        'Retry the download. If it repeats, try a different network or lower concurrency.'
      );
    }
    if (ctx.CLOCK_CERT_RE.test(detail)) {
      return clockCertMessage();
    }
    if (/(x509|certificate|ssl)/i.test(detail)) {
      return ctx.withSupportFooter(
        `SSL/Certificate error. (${detail})`,
        'On Linux, install/update ca-certificates, then retry.'
      );
    }
    if (/(no such host|name resolution|lookup)/i.test(detail)) {
      return ctx.withSupportFooter(
        `Network/DNS error. (${detail})`,
        'Check your internet connection, DNS/VPN settings, then retry.'
      );
    }
    return ctx.withSupportFooter(
      `Download failed. ${detail}`,
      'Retry the download. If it keeps failing, restart the app and try again.'
    );
  }

  const hint = formatRcloneExitCodeHint(code);
  const codeText = (typeof code === 'number') ? `code ${code}` : 'unknown error';
  return ctx.withSupportFooter(
    `Download failed (${codeText}). ${hint}`,
    'Retry the download. If it keeps failing, restart the app and try again.'
  );
}

function countRecentCompletedDownloads(itemKey, windowMs = ctx.COMPLETION_WINDOW_MS) {
  const key = normalizeDownloadItemKey(itemKey);
  if (!key) return 0;

  const cutoff = Date.now() - Math.max(0, Number(windowMs) || 0);
  let count = 0;
  for (const entry of Array.isArray(ctx.downloadHistory) ? ctx.downloadHistory : []) {
    if (!entry || entry.status !== 'completed') continue;
    const entryKey = getHistoryItemKey(entry);
    if (!entryKey || entryKey !== key) continue;
    const endTime = entry.endTime ? new Date(entry.endTime).getTime() : NaN;
    if (!Number.isFinite(endTime) || endTime < cutoff) continue;
    count++;
  }
  return count;
}

function buildDownloadBlockedMessage(itemName, count) {
  const safeName = String(itemName || 'this item').trim() || 'this item';
  return ctx.withSupportFooter(
    `You have already completed ${safeName} ${count} times in the last 24 hours. Additional downloads are temporarily blocked.`,
    'Wait until one of those completions falls outside the 24-hour window, then try again.'
  );
}

async function cleanupCancelledDownloadFiles(download) {
  const normalizePathKey = (value) => {
    const normalized = String(value || '').replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const normalizeAbsolutePathKey = (value) => {
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const downloadDir = download && download.downloadDir ? path.resolve(download.downloadDir) : '';
  const downloadRoot = download && download.rootDir ? path.resolve(download.rootDir) : download && download.baseDir ? path.resolve(download.baseDir) : (ctx.settings && ctx.settings.downloadPath ? path.resolve(ctx.settings.downloadPath) : '');
  if (!downloadDir || !downloadRoot || !isPathInside(downloadRoot, downloadDir)) {
    logToFile('[Cancel] Skipped file cleanup: download directory is outside the configured download folder.');
    return false;
  }

  let rootReal;
  let dirReal;
  try {
    rootReal = fs.realpathSync(downloadRoot);
    dirReal = fs.realpathSync(downloadDir);
  } catch (e) {
    // The folder may not have been created yet if cancellation happened early.
    return !fs.existsSync(downloadDir);
  }
  if (!isPathInside(rootReal, dirReal)) {
    logToFile('[Cancel] Skipped file cleanup: resolved download directory escaped the configured folder.');
    return false;
  }

  const preserve = new Set();
  for (const fileName of (Array.isArray(download.preexistingFiles) ? download.preexistingFiles : [])) {
    const safeRel = sanitizeRelativePath(String(fileName || ''));
    if (safeRel) preserve.add(normalizePathKey(safeRel));
  }

  // Concurrent requests can share a title folder. Keep paths another active
  // download owns, and files it is still writing while its cancellation drains.
  const owners = new Set();
  for (const other of ctx.activeDownloads.values()) {
    if (!other || other === download || !other.downloadDir) continue;
    if (normalizeAbsolutePathKey(other.downloadDir) !== normalizeAbsolutePathKey(downloadDir)) continue;
    const ownedFiles = other.cancelled
      ? Object.values(other.activeFiles || {}).map((active) => ({ name: active && active.name }))
      : (Array.isArray(other.files) ? other.files : []);
    for (const file of ownedFiles) {
      const safeRel = sanitizeRelativePath(String(file && file.name ? file.name : ''));
      if (safeRel) owners.add(normalizePathKey(safeRel));
    }
  }

  const removedParents = new Set();
  let cleanupOk = true;
  for (const file of (Array.isArray(download.files) ? download.files : [])) {
    const safeRel = sanitizeRelativePath(String(file && file.name ? file.name : ''));
    if (!safeRel) continue;
    const key = normalizePathKey(safeRel);
    if (preserve.has(key) || owners.has(key)) continue;

    const targetPath = resolveInside(downloadDir, safeRel);
    if (!targetPath || !isPathInside(downloadDir, targetPath)) continue;

    // Refuse to traverse symlinks in the download tree while cleaning up.
    const parts = safeRel.split('/');
    let parentPath = downloadDir;
    let unsafeParent = false;
    for (const part of parts.slice(0, -1)) {
      parentPath = path.join(parentPath, part);
      try {
        const parentStat = fs.lstatSync(parentPath);
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
          unsafeParent = true;
          break;
        }
      } catch (e) {
        unsafeParent = true;
        break;
      }
    }
    if (unsafeParent) {
      cleanupOk = false;
      continue;
    }

    // The resumable downloaders keep their half-done data beside the final name; a cancelled download leaves none of it.
    for (const suffix of ['.armdl', '.armseg', '.armseg.tmp', '.armpart']) {
      try { fs.unlinkSync(targetPath + suffix); } catch (e) { }
    }

    try {
      const targetStat = fs.lstatSync(targetPath);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        if (targetStat.isSymbolicLink()) cleanupOk = false;
        continue;
      }
      await fs.promises.unlink(targetPath);
      logToFile(`[Cancel] Removed incomplete download file: ${safeRel}`);
      removedParents.add(path.dirname(targetPath));
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
        cleanupOk = false;
        logToFile(`[Cancel] Could not remove download file ${safeRel}: ${e.message || e}`);
      }
    }
  }
  // The folders this download made are empty now: remove them (only empty ones, never the download folder itself). Skipped when another running download
  // writes into the same title folder, because it may be about to create a file there.
  try {
    const shared = Array.from(ctx.activeDownloads.values()).some((other) => other && other !== download && other.downloadDir && normalizeAbsolutePathKey(other.downloadDir) === normalizeAbsolutePathKey(downloadDir));
    if (cleanupOk && !shared && removedParents.size) {
      const gone = await pruneEmptyDirs(Array.from(removedParents).concat([downloadDir]), downloadRoot);
      if (gone.length) logToFile(`[Cancel] Removed ${gone.length} empty folder${gone.length === 1 ? '' : 's'} left by the cancelled download`);
    } else if (cleanupOk && !shared && !removedParents.size) {
      // nothing was written yet: the folder this request created may still be there, empty
      const gone = await pruneEmptyDirs([downloadDir], downloadRoot);
      if (gone.length) logToFile('[Cancel] Removed the empty folder left by the cancelled download');
    }
  } catch (e) { logToFile(`[Cancel] Could not tidy empty folders: ${e && e.message ? e.message : e}`); }
  return cleanupOk;
}

// Complete download
function finalizeCompletedDownload(downloadId) {
  logToFile(`[completeDownload] Called for ${downloadId}`);
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) {
    logToFile(`[completeDownload] Download not found in activeDownloads!`);
    return;
  }

  // Guard against double-completion
  if (download.status === 'completed') {
    logToFile(`[completeDownload] Already completed, skipping`);
    return;
  }

  logToFile(`[completeDownload] Setting status to completed and sending event`);
  download.finishedPlan = finishPlan(download);   // kept as it was at the finish, so a later settings change does not rewrite it
  download.status = 'completed';
  dropInflight(downloadId);
  try { if (download.directGrant && download.manifestUrl) driveDirectClient.finish(download.directGrant, String(download.manifestUrl), download.token); } catch (e) { }
  download.progress = 100;
  download.downloadedSize = download.totalSize;
  download.endTime = new Date().toISOString();
  // Clear any stale in-progress status message so the UI doesn't show
  // "No existing files found. Starting download..." after completion.
  download.statusMessage = '';

  // Ensure no stale running state leaks into the final server report.
  try { download.activeFiles = {}; } catch (e) { }
  try { download.activeProcesses = []; } catch (e) { }

  // Send a final progress event marking completion.
  // This makes the UI update even if the dedicated 'download-completed' event is missed.
  try {
    if (mainWindowAlive()) {
      sendToMain('download-progress', {
        id: downloadId,
        status: 'completed',
        progress: 100,
        downloadedSize: download.downloadedSize,
        totalSpeed: formatSpeed(peakOrAverageSpeedBytes(download)),
        activeFiles: [],
        completedFiles: download.completedFiles,
        fileCount: download.fileCount,
        extractionError: download.extractionError || '',
        statusMessage: installSpaceTip(download) || ''
      });
      logToFile(`[completeDownload] Sent final download-progress status=completed`);
    }
  } catch (e) {
    logToFile(`[completeDownload] Failed to send final download-progress: ${e && e.message ? e.message : e}`);
  }

  // Report completion to server
  reportProgressToServer(download, download.token);

  // Add to history
  ctx.downloadHistory.unshift({
    id: download.id,
    name: download.name,
    itemKey: download.itemKey || getDownloadItemKey(null, download.remotePath, download.name),
    remotePath: download.remotePath || '',
    actualRemote: download.actualRemote || '',
    manifestUrl: download.manifestUrl || '',
    totalSize: download.totalSize,
    startTime: download.startTime,
    endTime: download.endTime,
    folder: download.extractedTo || download.openDir || download.downloadDir || '',
    status: 'completed',
    didCheck: !!download.didCheck,
    checkOk: download.checkOk !== false,
    didExtract: !!download.didExtract,
    planUnpack: !!(download.finishedPlan && download.finishedPlan.unpack)
  });
  saveHistory();

  if (mainWindowAlive()) {
    logToFile(`[completeDownload] Sending download-completed event to renderer`);
    sendToMain('download-completed', { id: downloadId });
  } else {
    logToFile(`[completeDownload] ERROR: mainWindow or webContents is null!`);
  }
  if (download.extractionError) {
    showDownloadNotification('Download completed (extraction failed)', `${download.name || 'Download finished'}: ${download.extractionError}`);
  } else {
    showDownloadNotification('Download completed', download.name || 'Download finished');
  }
  ctx.activeDownloads.delete(downloadId);
  logToFile(`[completeDownload] Done, download removed from activeDownloads`);
}

function completeDownload(downloadId, afterHashCheck) {
  logToFile(`[completeDownload] Called for ${downloadId}`);
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) {
    logToFile(`[completeDownload] Download not found in activeDownloads!`);
    return;
  }

  if (download.status === 'completed') {
    logToFile(`[completeDownload] Already completed, skipping`);
    return;
  }

  if (download.__armgddnFinalizing) {
    return;
  }

  if (!afterHashCheck && hashingGated()) { reportHashUnavailableToServer(download); }

  // Why a finished download was NOT checked goes to the site with the final report (Nov 24 2026: 77% of finished downloads had no check
  // result and nothing said why). One of: setting off, no checksums in the list, no saved list.
  if (!afterHashCheck) {
    const hasList = !!hashCheck.loadManifest(app.getPath('userData'), String(downloadId));
    download.hashSkipReason = !(ctx.settings && ctx.settings.autoHashCheck) ? 'setting off'
      : hasList ? '' : (download.hasChecksums === false ? 'no checksums in the list' : 'no saved checksum list');
  }
  // "Check files automatically": compare every file with the checksums the site listed before anything is unpacked.
  if (!afterHashCheck && ctx.settings && ctx.settings.autoHashCheck && hashCheck.loadManifest(app.getPath('userData'), String(downloadId))) {
    download.__armgddnFinalizing = true;
    download.statusMessage = 'Checking files...';
    download.progress = 99;
    try { updateProgress(downloadId); } catch (e) { }
    runHashCheck(downloadId, { auto: true }).then((r) => {
      download.__armgddnFinalizing = false;
      const res = r && r.result;
      download.didCheck = !!res;
      download.checkOk = !!res && !(res.bad.length || res.missing.length);
      if (res && (res.bad.length || res.missing.length)) {
        download.forceDisableAutoExtract = true;       // unpacking a damaged archive only produces a second, more confusing error
        download.statusMessage = `${r.text} Automatic extraction was skipped.`;
      } else {
        download.statusMessage = res ? r.text : '';
      }
      completeDownload(downloadId, true);
    }).catch(() => { download.__armgddnFinalizing = false; completeDownload(downloadId, true); });
    return;
  }

  const shouldExtract = !!(ctx.settings && ctx.settings.autoExtract7z) &&
    !download.forceDisableAutoExtract && !download.toComics &&
    !isStarfieldAutoExtractTargetValue(download.remotePath) &&
    !isStarfieldAutoExtractTargetValue(download.name);
  const downloadDir = download.rootDir || download.downloadDir || path.join(download.baseDir || ctx.settings.downloadPath, download.name || 'Download');

  if (shouldExtract) {
    const archives = find7zArchivesInDir(downloadDir);
    if (archives && archives.length > 0) {
      download.__armgddnFinalizing = true;
      download.status = 'extracting';
      download.progress = 99;
      download.extractPercent = 0;
      download.totalSpeed = formatSpeed(peakOrAverageSpeedBytes(download));
      try {
        if (mainWindowAlive()) {
          sendToMain('download-progress', {
            id: downloadId,
            status: 'extracting',
            progress: download.progress,
            extractPercent: 0,
            downloadedSize: download.downloadedSize,
            totalSpeed: formatSpeed(peakOrAverageSpeedBytes(download)),
            activeFiles: [],
            completedFiles: download.completedFiles,
            fileCount: download.fileCount
          });
        }
      } catch (e) { }

      (async () => {
        try {
          let archiveIndex = 0;
          let lastTick = 0;
          for (const a of archives) {
            const archiveBase = (() => {
              try {
                const name = path.basename(String(a || ''));
                if (!name) return 'Extracted';
                if (/\.7z\.\d{3}$/i.test(name)) return name.replace(/\.7z\.\d{3}$/i, '');
                if (/\.7z$/i.test(name)) return name.replace(/\.7z$/i, '');
                return name;
              } catch (e) {
                return 'Extracted';
              }
            })();
            // "Extract here", not "extract to <archive name>": the extra
            // folder level made paths long enough (with our long folder
            // names) to hit Windows' 260-char limit, and installers then
            // "finish" instantly with every file missing.
            // Unless the member chose an Extract folder (another drive, say): then the game is unpacked into a folder of the same name there.
            const extractDir = extractTarget(downloadDir);
            try { fs.mkdirSync(extractDir, { recursive: true }); } catch (e) { }
            logToFile(`[extract] ${archiveBase} -> ${extractDir}`);
            const idx = archiveIndex;
            await run7zExtract(a, extractDir, (pct) => {
              const overall = Math.min(100, Math.floor(((idx + pct / 100) / archives.length) * 100));
              download.extractPercent = overall;
              const now = Date.now();
              if (now - lastTick < 500 && pct < 100) return;
              lastTick = now;
              try {
                if (mainWindowAlive()) {
                  sendToMain('download-progress', { id: downloadId, status: 'extracting', progress: download.progress, extractPercent: overall, downloadedSize: download.downloadedSize, totalSpeed: formatSpeed(peakOrAverageSpeedBytes(download)), activeFiles: [], completedFiles: download.completedFiles, fileCount: download.fileCount });
                }
              } catch (e) { }
              if (now - (download.__lastExtractReport || 0) >= 2000) { download.__lastExtractReport = now; try { reportProgressToServer(download, download.token); } catch (e) { } }
            });
            archiveIndex++;
          }
          if (extractTarget(downloadDir) !== downloadDir) download.extractedTo = extractTarget(downloadDir);
          download.extractPercent = 100;
          download.didExtract = archives.length > 0;
        } catch (e) {
          download.extractionError = e && e.message ? e.message : String(e);
          try {
            if (mainWindowAlive()) {
              sendToMain('download-progress', {
                id: downloadId,
                status: 'extracting',
                progress: download.progress,
                downloadedSize: download.downloadedSize,
                totalSpeed: formatSpeed(peakOrAverageSpeedBytes(download)),
                activeFiles: [],
                completedFiles: download.completedFiles,
                fileCount: download.fileCount,
                extractionError: download.extractionError
              });
            }
          } catch (e2) { }
        } finally {
          download.__armgddnFinalizing = false;
          finalizeCompletedDownload(downloadId);
        }
      })();
      return;
    }
  }

  finalizeCompletedDownload(downloadId);
}

module.exports = { showDownloadNotification, formatDownloadFailedMessage, countRecentCompletedDownloads, buildDownloadBlockedMessage, cleanupCancelledDownloadFiles, finalizeCompletedDownload, completeDownload };
