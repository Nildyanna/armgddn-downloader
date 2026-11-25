'use strict';
// Downloads: starting, cancelling, pausing, resuming, retrying, reordering, history, file checks and opening the folder (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const driveDirectClient = require('../driveDirectClient');
const hashCheck = require('../hashCheck');
const { openAuthWindow } = require('./appWindows');
const { countRecentCompletedDownloads, buildDownloadBlockedMessage, showDownloadNotification, completeDownload, cleanupCancelledDownloadFiles } = require('./completion');
const { withDialogFocus, getDialogParentWindow, sendToMain, mainWindowAlive } = require('./dialogs');
const { retryFailedDownload, scheduleAutoRetry, pauseDownloadById, resumeDownloadFiles } = require('./downloadControl');
const { downloadToRenderer, isStarfieldAutoExtractTargetManifest, getDownloadItemKey, reportDirectGrantEnd, stopDownloadProcesses, waitForDownloadTasksToFinish } = require('./downloadState');
const { notInChannelMessage, isPinnedDownloadStatusMessage } = require('./errors');
const { reportDownloadFailure, isDownloadAbandoned } = require('./failures');
const { commonOpenDir, isFileCompleteOnDisk } = require('./files');
const { maybeShowHashGateNotice, runHashCheck, hashingGated } = require('./hashing');
const { saveHistory } = require('./history');
const { preStartInstallSpaceWarning } = require('./installSpace');
const { checkBeforeStart, checkBeforeResume, unpackDirFor } = require('./startSpace');
const { logToFile, debugLog } = require('./log');
const { fetchManifestInternal } = require('./manifest');
const { isValidDownloadId, isValidToken, attemptResolveDownloadToken, transformProxyUrlToDirectIfPossible } = require('./net');
const { updateProgress, reportFileProgressToServer, reportProgressToServer } = require('./progress');
const { persistInflight, endOrphanedGrant, dropInflight, resumeRestoredDownload, takeBaseDir } = require('./restore');
const { refreshDownloadConcurrency, enqueueAdaptiveTask, schedulerPump } = require('./scheduler');
const { saveSession } = require('./session');
const { isAllowedServiceHost } = require('./siteApi');
const { sanitizeRelativePath, resolveInside, normalizeFileSize } = require('./util');
const crypto = require('crypto');
const { ipcMain, dialog, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function register() {
ipcMain.handle('retry-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  return retryFailedDownload(downloadId);
});

// Get download history
ipcMain.handle('get-history', () => {
  return ctx.downloadHistory;
});

// Clear history
ipcMain.handle('clear-history', () => {
  ctx.downloadHistory = [];
  saveHistory();
  return true;
});

// Get active downloads
ipcMain.handle('get-downloads', () => {
  const downloads = [];
  for (const [id, download] of ctx.activeDownloads) {
    downloads.push(downloadToRenderer(download));
  }
  return downloads;
});

// Fetch manifest from URL (handles CORS)
ipcMain.handle('fetch-manifest', async (event, manifestUrl, token) => {
  // Use the Companion's own session token; renderer may pass null for deep-link flows.
  const effectiveToken = token || ctx.sessionToken;
  if (!isValidToken(effectiveToken)) {
    throw new Error('Invalid or missing authentication token');
  }

  return fetchManifestInternal(manifestUrl, effectiveToken);
});

ipcMain.handle('resolve-download-token', async (event, downloadToken, urlToken) => {
  if (!downloadToken || typeof downloadToken !== 'string') {
    throw new Error('Missing download token');
  }

  // Default to the production host; allowlist check is applied.
  const host = 'www.armgddnbrowser.com';
  if (!isAllowedServiceHost(host)) {
    throw new Error('Security error: Host not allowed');
  }

  // The browser mints a fresh app token and hands it to us on every download deep
  // link (it's already authenticated when the user clicks download). Try it first,
  // as a ONE-SHOT attempt only — never persisted as our saved session — so a stale or
  // malicious deep link can't silently replace what the user is actually logged in as.
  // The server independently enforces that this token's user matches the downloadToken's
  // owner (403 otherwise), so this can't be used to hijack someone else's download.
  if (isValidToken(urlToken)) {
    const attempt = await attemptResolveDownloadToken(downloadToken, urlToken);
    if (attempt.ok) {
      return attempt.json;
    }
    const leftGroup = notInChannelMessage(attempt);
    if (leftGroup) {
      logToFile('resolve-download-token: member is no longer in the ARMGDDN group');
      throw new Error(leftGroup);
    }
    logToFile('resolve-download-token: URL token attempt failed, falling back to stored session: ' + attempt.errMsg);
  }

  // Fall back to the Companion's own persisted session token.
  let token = ctx.sessionToken;
  if (!isValidToken(token)) {
    // No session — open auth window so user can log in, then retry once.
    logToFile('resolve-download-token: no session, opening auth window');
    await openAuthWindow();
    token = ctx.sessionToken;
    if (!isValidToken(token)) {
      throw new Error('Companion is not authenticated — please log in and try again');
    }
  }

  const result = await attemptResolveDownloadToken(downloadToken, token);
  if (result.ok) {
    return result.json;
  }

  const leftGroup = notInChannelMessage(result);
  if (leftGroup) {
    logToFile('resolve-download-token: member is no longer in the ARMGDDN group');
    throw new Error(leftGroup);
  }

  // Session expired on the server — clear it, open auth window, and reject so the
  // renderer can prompt the user to retry after logging in.
  if (result.statusCode === 401 || /auth/i.test(result.errMsg)) {
    logToFile('resolve-download-token: server rejected token, clearing session and opening auth window');
    ctx.sessionToken = null;
    openAuthWindow().catch(() => {});
    throw new Error('Your session expired. Please log in again and retry the download.');
  }
  throw new Error(result.errMsg);
});

// Start download
// Start a download from a download list (the site's manifest). Resolves when the download has finished. A function so the built app's own
// test can run a real download through it (smokeTest.js, Nov 24 2026).
async function startDownload(event, manifest, token, manifestUrl, dest) {
  // Use the Companion's own session token; renderer may pass null for deep-link flows.
  const effectiveToken = token || ctx.sessionToken;
  if (!isValidToken(effectiveToken)) {
    throw new Error('Invalid or missing authentication token');
  }

  debugLog(`Download started - Token: [PRESENT]`);

  // Save/update the token as session for connection status
  // Always update on new download to refresh token if server restarted
  saveSession(effectiveToken);
  logToFile('Session token saved/updated from download');

  const downloadId = crypto.randomUUID();

  // Default progress reporting target
  let progressHost = 'www.armgddnbrowser.com';
  let progressPort = 443;
  let progressPath = '/api/app-progress';
  try {
    if (typeof manifestUrl === 'string' && manifestUrl) {
      const u = new URL(manifestUrl);
      if (u && u.hostname) {
        if (u.protocol === 'https:' && isAllowedServiceHost(u.hostname)) {
          progressHost = u.hostname;
          progressPort = u.port ? Number(u.port) : 443;
        }
      }
    }
  } catch (e) {
    // ignore parse failure, fall back to default
  }

  // Handle different manifest structures
  let files = [];
  let name = 'Unknown';
  let totalSize = 0;
  let remotePath = '';  // Full path like "PC1/Game Name" for trending

  if (manifest.files && Array.isArray(manifest.files)) {
    // Standard format: { files: [...], path: "...", ... }
    files = manifest.files;

    // Check if no files were found
    if (files.length === 0) {
      throw new Error('No files found for this game. The game may not be available on any mirror.');
    }

    // Store full path for trending (e.g., "PC1/Game Name")
    remotePath = manifest.path || manifest.name || '';
    try {
      const actualRemote = (manifest && manifest.actualRemote) ? String(manifest.actualRemote) : '';
      if (actualRemote && remotePath) {
        const actualLower = actualRemote.toLowerCase();
        const rootForActual = (() => {
          const mPcvr = actualLower.match(/^pcvr-(\d)$/);
          if (mPcvr) return 'PCVR' + mPcvr[1];
          const mPc = actualLower.match(/^pc-(\d)$/);
          if (mPc) return 'PC' + mPc[1];
          return null;
        })();
        if (rootForActual) {
          const segments = String(remotePath).split('/').filter(Boolean);
          if (segments.length > 0) {
            const head = String(segments[0] || '');
            if (/^PCVR\d$/i.test(head) || /^PC\d$/i.test(head)) {
              segments[0] = rootForActual;
              remotePath = segments.join('/');
            } else {
              remotePath = rootForActual + '/' + segments.join('/');
            }
          } else {
            remotePath = rootForActual;
          }
        }
      }
    } catch (e) { }
    // Extract folder name from path (e.g., "PC1/Game Name" -> "Game Name")
    name = remotePath.split('/').pop() || 'Download';
    // A comics batch spanning several collections is named by the site ("Comics"), not after its first item.
    if (manifest.batch && typeof manifest.name === 'string' && manifest.name.trim()) name = manifest.name.trim();
    totalSize = manifest.totalSize || files.reduce((sum, f) => sum + (f.size || 0), 0);
  } else if (manifest.url) {
    // Single file format: { url: "...", name: "...", size: ... }
    files = [{ url: manifest.url, name: manifest.name || 'download', size: manifest.size || 0 }];
    name = manifest.name || 'download';
    totalSize = manifest.size || 0;
  } else if (Array.isArray(manifest)) {
    // Array of files directly
    files = manifest;
    name = manifest[0]?.name || 'download';
  } else {
    console.error('Unknown manifest format:', manifest);
    throw new Error('Unknown manifest format. Expected files array or url property.');
  }

  let forceDisableAutoExtract = isStarfieldAutoExtractTargetManifest(manifest);

  if (forceDisableAutoExtract) {
    try {
      logToFile(`[start-download] auto-extract disabled for manifest=${remotePath || name || 'unknown'}`);
    } catch (e) { }
  }

  const downloadItemKey = getDownloadItemKey(manifest, remotePath, name);
  const recentCompletedCount = countRecentCompletedDownloads(downloadItemKey);
  if (recentCompletedCount >= 2) {
    throw new Error(buildDownloadBlockedMessage(name || remotePath || 'this item', recentCompletedCount));
  }

  try {
    const canonical = String(remotePath || '').trim();
    if (canonical) {
      for (const [, d] of ctx.activeDownloads.entries()) {
        if (!d) continue;
        const rp = String(d.remotePath || '').trim();
        if (!rp || rp !== canonical) continue;
        const st = d.status ? String(d.status) : '';
        if (st === 'completed' || st === 'cancelled' || st === 'error') continue;
        throw new Error('You are already downloading this item.');
      }
    }
  } catch (e) {
    throw e;
  }

  // "Only what I'm missing" downloads go straight into the member's own comics folder, with the library's folder layout.
  // Nothing in that folder is ever unpacked or removed except the files this download itself wrote.
  const destFolder = dest === 'music' ? ctx.settings.musicFolder : dest === 'comics' ? ctx.settings.comicsFolder : '';
  const toComics = (dest === 'music' || dest === 'comics') && typeof destFolder === 'string' && destFolder.trim() !== '' && path.isAbsolute(destFolder) && fs.existsSync(destFolder);
  if ((dest === 'music' || dest === 'comics') && !toComics) throw new Error(dest === 'music' ? 'Choose your music folder in the Music panel first.' : 'Choose your comics folder in the Comics panel first.');

  // Into the member's own comics or music folder the files keep the library's layout: the site names them below the batch's shared folder
  // (baseDir, for example a collection), so that folder goes back on the front.
  if (toComics && (dest === 'comics' || dest === 'music') && typeof manifest.baseDir === 'string' && manifest.baseDir) {
    const base = sanitizeRelativePath(manifest.baseDir);
    if (base) files = files.map((f) => (f && f.name ? { ...f, name: base + '/' + f.name } : f));
  }

  const safeFolderName = sanitizeRelativePath(String(name || ''));
  if (safeFolderName) {
    name = safeFolderName;
  } else {
    name = 'Download';
  }

  // DISK SPACE CHECK (2026-11-25, ../spaceCheck.js has the rule): this download's remaining bytes, its unpack room and what the other
  // unfinished downloads still need, per drive, against the free space. Short: a box with Choose another folder / Start anyway (and
  // Download without unpacking when only the unpack room is missing). Nothing else waits on this box: other downloads keep going.
  let baseDir = toComics ? destFolder : ctx.settings.downloadPath;
  if (!toComics) { const again = takeBaseDir(name); if (again && path.isAbsolute(again) && fs.existsSync(again)) baseDir = again; }   // a restored download's own folder
  try {
    const autoUnpack = !!(ctx.settings && ctx.settings.autoExtract7z) && !forceDisableAutoExtract && !toComics;
    const decision = await checkBeforeStart({
      id: downloadId, baseDir, files, unpack: autoUnpack, canChooseFolder: !toComics,
      folderFor: (dir) => (toComics ? path.resolve(dir) : (resolveInside(dir, name) || path.resolve(dir)))
    });
    if (!decision.start) return null;
    if (decision.skipUnpack) forceDisableAutoExtract = true;
    if (decision.baseDir && decision.baseDir !== baseDir && path.isAbsolute(decision.baseDir)) baseDir = decision.baseDir;
  } catch (e) {
    logToFile(`[DiskCheck] Warning: skipped the free-space check: ${e && e.message}`);
  }

  try {
    const targetPath = path.resolve(baseDir);

    // Check 3 (Windows): setup unpacks its temp files to the drive holding the
    // Windows temp folder. Warn now, before hours of downloading, instead of
    // only when the download finishes (see installSpaceTip).
    const tempWarn = (totalSize > 0) ? preStartInstallSpaceWarning(totalSize, targetPath) : null;
    if (tempWarn) {
      const { response } = await withDialogFocus(() => dialog.showMessageBox(getDialogParentWindow(), {
        type: 'warning',
        buttons: ['Download Anyway', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: tempWarn.title,
        message: tempWarn.message,
        detail: tempWarn.detail
      }));
      if (response === 1) return null;
    }
  } catch (e) {
    logToFile(`[DiskCheck] Warning: skipped check due to error: ${e.message}`);
  }

  const download = {
    id: downloadId,
    name: name,
    itemKey: downloadItemKey,
    manifestUrl: (typeof manifestUrl === 'string' ? manifestUrl : ''),
    directGrant: driveDirectClient.grantFromManifest(manifest),   // set when the site started a direct-from-Drive grant
    remotePath: remotePath,  // Store for trending reporting
    progressHost,
    progressPort,
    progressPath,
    status: 'starting',
    progress: 0,
    speed: '',
    eta: '',
    totalSize: totalSize,
    downloadedSize: 0,
    files: files,
    preexistingFiles: [], // Completed files present before this request; cancellation must preserve them.
    fileCount: files.length,
    completedFiles: 0,
    activeFiles: {},  // Track per-file progress: { fileName: { progress, speed, eta } }
    activeProcesses: [],  // Track all active rclone processes for cancellation
    pendingTaskCount: 0, // Includes file tasks waiting on link resolution before rclone starts.
    cancelWaiters: [],
    totalSpeed: 0,
    peakSpeedBytes: 0,
    startTime: new Date().toISOString(),
    token: effectiveToken,  // Store token for progress reporting (fall back to session token for deep-link flows)
    cancelled: false,  // Flag to stop new downloads when cancelled
    paused: false,
    failedFiles: [],
    quotaNotified: false,
    forceDisableAutoExtract: forceDisableAutoExtract,
    serverOverhead: null,
    effectiveConcurrency: null,
    statusMessage: '',
    actualRemote: (manifest && manifest.actualRemote) ? String(manifest.actualRemote) : '',
    mirrorSwitches: 0,
    triedMirrors: [],
    userPriority: 0
  };

  try {
    const initial = download.actualRemote ? String(download.actualRemote) : '';
    if (initial) {
      download.triedMirrors = [initial];
    }
  } catch (e) { }

  if (forceDisableAutoExtract) {
    download.statusMessage = 'Starfield detected: auto-extract disabled for this download.';
  }

  try {
    const mu = new URL(String(download.manifestUrl || ''));
    const r = mu.searchParams.get('remote'), pth = mu.searchParams.get('path');
    const d2 = (dest === 'music' || dest === 'comics') ? dest : '';
    if (manifest && manifest.batch && Array.isArray(manifest.batchItems) && manifest.batchItems.length && Array.isArray(manifest.batchExclude)) {
      // a download of picked items: remember the items, so the same batch can be made again
      download.resume = { remote: String(manifest.batchRemote || manifest.remote || r || ''), paths: manifest.batchItems.map(String).slice(0, 500), exclude: manifest.batchExclude.map(String), dest: d2 };
    } else if (r && pth && !String(pth).startsWith('__batch__/')) {
      download.resume = { remote: r, path: pth, dest: d2 };
    }
  } catch (e) { }
  ctx.activeDownloads.set(downloadId, download);
  persistInflight(download);
  sendToMain('download-started', downloadToRenderer(download));

  download.statusMessage = 'Preparing download...';
  if (forceDisableAutoExtract) {
    download.statusMessage = `${download.statusMessage} Starfield detected: auto-extract disabled for this download.`;
  }
  try {
    if (mainWindowAlive()) {
      sendToMain('download-progress', {
        id: downloadId,
        status: download.status,
        progress: download.progress,
        eta: download.eta || '',
        statusMessage: download.statusMessage || '',
        completedFiles: download.completedFiles,
        fileCount: download.fileCount
      });
    }
  } catch (e) { }

  // Create download directory
  const downloadDir = toComics ? path.resolve(destFolder) : resolveInside(baseDir, name);
  // "Choose another folder" in the space box: this one download goes there (the Settings folder stays as it is).
  if (!toComics && path.resolve(baseDir) !== path.resolve(ctx.settings.downloadPath)) download.baseDir = path.resolve(baseDir);
  if (!downloadDir) {
    throw new Error('Security error: Invalid download folder path');
  }
  download.toComics = toComics;
  download.rootDir = toComics ? downloadDir : '';
  download.openDir = commonOpenDir(downloadDir, toComics ? files : null);   // what "Open folder" shows: the album or series folder, not the whole library
  if (toComics) download.forceDisableAutoExtract = true;
  download.downloadDir = downloadDir; // Stored for the periodic mid-download disk-space check in updateProgress()
  // What its unpacking will still need, so a download started after this one counts it (main/startSpace.js otherDownloads).
  try {
    const willUnpack = !!(ctx.settings && ctx.settings.autoExtract7z) && !download.forceDisableAutoExtract && !toComics;
    download.spaceUnpackBytes = willUnpack ? require('../spaceCheck').archiveBytes(files) : 0;
    download.spaceUnpackDir = willUnpack ? unpackDirFor(downloadDir) : '';
  } catch (e) { }
  if (download.baseDir) persistInflight(download);
  try {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
  } catch (e) {
    // Common on Windows when the target folder/drive is blocked by permissions or
    // Controlled Folder Access. If this throws, we must surface a clear error and
    // avoid leaving a stuck "in_progress" download that never spawns workers.
    const msg = (e && e.message) ? String(e.message) : String(e);
    // ENOENT even with recursive mkdir on Windows means the drive itself is gone
    // (unplugged, renamed, or a letter that no longer exists).
    let missingDrive = '';
    try {
      const root = path.parse(downloadDir).root;
      if (process.platform === 'win32' && e && e.code === 'ENOENT' && /^[A-Za-z]:\\$/.test(root) && !fs.existsSync(root)) missingDrive = root.slice(0, 2);
    } catch (eD) { }
    try {
      download.status = 'error';
      download.error = missingDrive
        ? ctx.withSupportFooter(
          `Can't create the download folder because drive ${missingDrive} isn't available right now. (${msg})`,
          `Reconnect drive ${missingDrive}, or change the download folder in settings to a drive that is connected, then retry.`
        )
        : ctx.withSupportFooter(
          `Can't create the download folder. (${msg})`,
          'Change the download folder in settings to a writable location (e.g. inside your user folder) and retry. On Windows, check Defender Controlled Folder Access / antivirus blocks.'
        );
      download.statusMessage = download.error;
      updateProgress(downloadId);
    } catch (e2) { }
    try { logToFile(`[start-download] mkdir failed path=${String(downloadDir)} err=${msg}`); } catch (e2) { }
    try { reportDownloadFailure(download, download.error || msg); } catch (e3) { }
    try { if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error || msg }); } catch (e2) { }
    try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
    try { if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error || msg}`); } catch (e2) { }
    try { ctx.activeDownloads.delete(downloadId); } catch (e2) { }
    throw new Error(download.error || msg);
  }

  download.statusMessage = 'Checking existing files...';
  try { updateProgress(downloadId); } catch (e) { }

  // Skip files that are already complete on disk
  try {
    const allFiles = Array.isArray(files) ? files : [];
    let completedFiles = 0;
    let downloadedSize = 0;
    const remainingFiles = [];
    for (const f of allFiles) {
      if (!f || !f.name) continue;
      if (isFileCompleteOnDisk(downloadDir, f)) {
        completedFiles++;
        downloadedSize += normalizeFileSize(f.size);
        download.preexistingFiles.push(String(f.name));
        try {
          reportFileProgressToServer(download, effectiveToken, f, 'completed', normalizeFileSize(f.size));
        } catch (e) { }
      } else {
        remainingFiles.push(f);
      }
    }
    download.completedFiles = completedFiles;
    download.downloadedSize = downloadedSize;
    files = remainingFiles;

    try {
      for (const f of files) {
        if (!f || !f.url) continue;
        const transformed = transformProxyUrlToDirectIfPossible(f.url);
        if (transformed && transformed !== f.url) {
          f.url = transformed;
        }
      }
    } catch (e) { }
    download.files = allFiles;
    try { maybeShowHashGateNotice().catch(() => { }); } catch (eGate) { }
    let hashList = null;
    try { hashList = hashCheck.saveManifest(app.getPath('userData'), { id: downloadId, name, downloadDir, files: allFiles }); } catch (eHash) { }
    // What finishing will involve (finishPlan): a check needs checksums, unpacking needs a .7z archive among the files.
    download.hasChecksums = !!hashList;
    download.has7z = allFiles.some((f) => f && /\.7z(\.001)?$/i.test(String(f.name || '')));
    if (allFiles.length > 0) {
      const skippedMessage = completedFiles > 0
        ? `Skipped ${completedFiles}/${allFiles.length} files already on disk.`
        : 'No existing files found. Starting download...';
      download.statusMessage = forceDisableAutoExtract
        ? `${download.statusMessage || ''} ${skippedMessage}`.trim()
        : skippedMessage;
    } else {
      download.statusMessage = forceDisableAutoExtract
        ? (download.statusMessage || 'Starfield detected: auto-extract disabled for this download.')
        : 'Starting download...';
    }
    try { updateProgress(downloadId); } catch (e) { }
  } catch (e) {
    // ignore
  }

  // Update status to in_progress
  download.status = 'in_progress';
  sendToMain('download-progress', {
    id: downloadId,
    status: 'in_progress',
    progress: 0,
    statusMessage: download.statusMessage || ''
  });

  // Report initial progress to server
  reportProgressToServer(download, effectiveToken);

  if (!isPinnedDownloadStatusMessage(download.statusMessage)) {
    download.statusMessage = 'Checking server load...';
  }
  try { updateProgress(downloadId); } catch (e) { }

  // Download files in parallel (controlled by user setting)
  const getRequestedWorkersNow = () => {
    const requestedParallelNow = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
    return Math.min(20, Math.max(1, Number.isFinite(requestedParallelNow) ? requestedParallelNow : 3));
  };

  const requestedWorkers = getRequestedWorkersNow();
  try {
    await refreshDownloadConcurrency(download, effectiveToken, manifestUrl);
  } catch (e) {
    logToFile(`[Concurrency] Initial refresh failed, proceeding with default: ${e && e.message ? e.message : e}`);
    if (!Number.isFinite(download.effectiveConcurrency) || download.effectiveConcurrency <= 0) {
      download.effectiveConcurrency = requestedWorkers;
    }
  }
  if (!isPinnedDownloadStatusMessage(download.statusMessage)) {
    download.statusMessage = download.statusMessage || 'Starting downloads...';
  }
  try { updateProgress(downloadId); } catch (e2) { }

  let concurrencyPoll = null;
  try {
    concurrencyPoll = setInterval(() => {
      try {
        if (!download || download.cancelled || download.paused || download.status === 'completed') return;
        refreshDownloadConcurrency(download, effectiveToken, manifestUrl);
      } catch (e) { }
    }, 30000);
    if (concurrencyPoll && typeof concurrencyPoll.unref === 'function') {
      concurrencyPoll.unref();
    }
  } catch (e) { }

  // Spawn at most the requested workers; concurrency is enforced dynamically by waiting
  // when active files exceed the server's effective limit.
  const activePromises = [];
  try {
    for (const f of files) {
      if (!f) continue;
      activePromises.push(enqueueAdaptiveTask(downloadId, f, downloadDir).catch((err) => {
        if (!download.cancelled) {
          try {
            logToFile(`[Scheduler] file task failed: ${err && err.message ? err.message : String(err)} file=${f && f.name ? String(f.name) : ''}`);
          } catch (e) { }
          // A task that failed before the downloader took the file (a refused link, an unexpected error) must count as a failed file.
          // It was only logged, so a download whose files all failed this way still ended as "completed" (found by the built app's own
          // download test, Nov 24 2026).
          try {
            if (!Array.isArray(download.failedFiles)) download.failedFiles = [];
            if (f && f.name && !download.failedFiles.includes(f.name)) download.failedFiles.push(f.name);
            if (!download.error) download.error = err && err.message ? String(err.message) : 'A file could not be downloaded';
          } catch (e) { }
        }
        // Continue with other files.
      }));
    }

    await Promise.all(activePromises);
  } finally {
    try {
      if (concurrencyPoll) clearInterval(concurrencyPoll);
    } catch (e) { }
  }

  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  // Only mark as completed if not cancelled, not paused, and with no failed files
  if (!download.cancelled && !download.paused && !hasErrors) {
    completeDownload(downloadId);
  } else if (hasErrors) {
    // Ensure final progress is sent for partial/error downloads
    updateProgress(downloadId);
    if (!download.paused && !download.cancelled) reportDirectGrantEnd(download);
  }

  return downloadId;
}
ipcMain.handle('start-download', startDownload);
module.exports.startDownload = startDownload;

// Cancel download
ipcMain.handle('cancel-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return true;
  if (download.cancelCleanupPromise) return await download.cancelCleanupPromise;
  if (download.restored) {          // a download brought back after a restart: nothing is running and nothing is known to delete, so it only leaves the list
    endOrphanedGrant(download);
    ctx.activeDownloads.delete(downloadId); dropInflight(downloadId);
    try { sendToMain('download-cancelled', { id: downloadId, cleanupWarning: false }); } catch (e) { }
    return { success: true, cleanupWarning: false };
  }

  download.cancelled = true;
  download.status = 'cancelled';
  dropInflight(downloadId);
  download.statusMessage = 'Cancelling and removing downloaded files...';
  try { if (download.directGrant && download.manifestUrl) driveDirectClient.finish(download.directGrant, String(download.manifestUrl), download.token); } catch (e) { }

  // Snapshot before termination; the child close handlers remove entries.
  const processes = Array.isArray(download.activeProcesses) ? [...download.activeProcesses] : [];
  download.cancelCleanupPromise = (async () => {
    let cleanupOk = false;
    try {
      await stopDownloadProcesses(processes);
      await waitForDownloadTasksToFinish(download);
      cleanupOk = await cleanupCancelledDownloadFiles(download);
    } catch (e) {
      logToFile(`[Cancel] Cleanup failed for ${downloadId}: ${e && e.message ? e.message : String(e)}`);
    } finally {
      if (ctx.activeDownloads.get(downloadId) === download) ctx.activeDownloads.delete(downloadId);
      sendToMain('download-cancelled', { id: downloadId, cleanupWarning: !cleanupOk });
    }
    return { success: true, cleanupWarning: !cleanupOk };
  })();
  return await download.cancelCleanupPromise;
});

// Reorder active downloads by drag-and-drop priority. orderedIds is the full
// list of active download ids in the user's desired order (highest priority
// first). Assigns bounded, position-based priority ranks (not a monotonically
// growing counter) so re-dragging repeatedly in a long session never produces
// runaway values — pickNextAdaptiveTask() folds this in as a proportional
// scoring discount, see there for why it's multiplicative rather than additive.
// This only affects the adaptive-scheduler path for fresh/actively-scheduled
// downloads; it does not affect resumeDownloadFiles()'s separate queue used
// by pause->resume and retry-download (documented limitation, see plan).
ipcMain.handle('reorder-downloads', (event, orderedIds) => {
  if (!Array.isArray(orderedIds)) return false;
  const n = orderedIds.length;
  orderedIds.forEach((id, index) => {
    const download = ctx.activeDownloads.get(String(id));
    if (download) {
      download.userPriority = n - index;
    }
  });
  schedulerPump();
  return true;
});

ipcMain.handle('get-schedule-banner', () => ctx.lastScheduleBanner);

ipcMain.handle('pause-download', (event, downloadId) => pauseDownloadById(downloadId));

ipcMain.handle('resume-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return false;

  if (!download.paused) {
    return false;
  }
  if (download.restored) return resumeRestoredDownload(downloadId);
  // Room for the rest of it (and its unpacking)? The box offers Resume anyway or Cancel; the files stay where they are.
  if (!(await checkBeforeResume(download))) return false;

  try {
    await resumeDownloadFiles(downloadId);
    return true;
  } catch (e) {
    console.error('Resume download error:', e);
    return false;
  }
});

ipcMain.handle('verify-download-files', (event, id) => runHashCheck(id));

ipcMain.handle('cancel-hash-check', (event, id) => { const st = ctx.hashChecksRunning.get(String(id)); if (st) st.cancelled = true; return !!st; });

ipcMain.handle('get-hash-check-info', (event, id) => {
  const doc = hashCheck.loadManifest(app.getPath('userData'), String(id));
  if (!doc) return { available: false, gated: hashingGated() };
  return { available: !hashingGated(), gated: hashingGated(), files: doc.files.length, totalFiles: doc.totalFiles, lastCheck: doc.lastCheck || null, lastCheckText: doc.lastCheck ? hashCheck.describeResult(doc.lastCheck) : '', running: ctx.hashChecksRunning.has(String(id)) };
});

// Open folder: the folder of the download whose id the window passes (its real folder: an album, a series, the unpacked game); the main
// download folder when the id is not known (older entries, the classic window).
ipcMain.handle('open-folder', async (event, arg) => {
  try {
    const id = typeof arg === 'string' ? arg : '';
    const src = id ? (ctx.activeDownloads.get(id) || (Array.isArray(ctx.downloadHistory) ? ctx.downloadHistory.find((x) => x && x.id === id) : null)) : null;
    const dir = src ? String(src.extractedTo || src.openDir || src.folder || '') : '';
    if (dir && fs.existsSync(dir)) { await shell.openPath(dir); return; }
  } catch (e) { }
  shell.openPath(ctx.settings.downloadPath);
});
}

module.exports.register = register;
