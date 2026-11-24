'use strict';
// Pausing, resuming and retrying downloads (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { completeDownload } = require('./completion');
const { sendToMain } = require('./dialogs');
const { getActiveFileCount, reportDirectGrantEnd } = require('./downloadState');
const { noteRecovery, isDownloadAbandoned } = require('./failures');
const { logToFile } = require('./log');
const { isValidDownloadId, transformProxyUrlToDirectIfPossible, isProxyDownloadUrl, waitForNetwork } = require('./net');
const { updateProgress } = require('./progress');
const { persistInflight } = require('./restore');
const { refreshDownloadConcurrency } = require('./scheduler');
const { sanitizeRelativePath, resolveInside, normalizeFileSize } = require('./util');
const fs = require('fs');
const path = require('path');

// ---- Window helpers. The native window is the only window (version 6.0.0), so there is no switching between windows any more.
function anyDownloadRunning() {
  try { return Array.from(ctx.activeDownloads.values()).some((d) => d && ['in_progress', 'downloading', 'starting'].includes(d.status)); } catch (e) { return false; }
}

function scheduleAutoRetry(downloadId, download) {
  try {
    if (!download || download.__autoRetryPending) return;
    if ((Number(download.__autoRetries) || 0) >= ctx.AUTO_RETRY_MAX) return;
    const err = String(download.error || '');
    if (!ctx.AUTO_RETRY_TRANSIENT_RE.test(err) || ctx.AUTO_RETRY_BLOCK_RE.test(err)) return;
    download.__autoRetryPending = true;
    noteRecovery(download, 'auto-retry scheduled');
    (async () => {
      try {
        // Let the other workers finish failing so the download settles on 'error'.
        const settleDeadline = Date.now() + 30 * 60 * 1000;
        await new Promise(r => setTimeout(r, 60 * 1000 * (1 + (Number(download.__autoRetries) || 0))));
        while (Date.now() < settleDeadline) {
          if (isDownloadAbandoned(download) || ctx.activeDownloads.get(downloadId) !== download) return;
          if (download.status === 'error') break;
          if (download.status === 'completed') return;
          await new Promise(r => setTimeout(r, 15000));
        }
        if (download.status !== 'error') return;
        if (!(await waitForNetwork(30 * 60 * 1000))) {
          noteRecovery(download, 'auto-retry: network still down after 30 minutes');
          return;
        }
        if (isDownloadAbandoned(download) || download.status !== 'error') return;
        download.__autoRetries = (Number(download.__autoRetries) || 0) + 1;
        noteRecovery(download, 'auto-retry: resuming');
        logToFile(`[AutoRetry] resuming ${downloadId} after: ${err.split('\n')[0]}`);
        await retryFailedDownload(downloadId, 'Connection is back, resuming automatically...');
      } catch (e) {
        try { logToFile(`[AutoRetry] failed: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
      } finally {
        download.__autoRetryPending = false;
        if (download.status === 'error' || download.status === 'failed') reportDirectGrantEnd(download);
      }
    })();
  } catch (e) { }
}

async function retryFailedDownload(downloadId, statusMessage) {
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return false;

  if (download.status !== 'error') {
    return false;
  }

  try {
    // Treat retry as "resume remaining files" from disk state.
    // Ensure paused flag is cleared so workers run.
    download.paused = false;
    download.cancelled = false;
    download.status = 'in_progress';
    download.error = '';
    download.failedFiles = [];
    if (statusMessage) download.statusMessage = statusMessage;
    updateProgress(downloadId);

    await resumeDownloadFiles(downloadId);
    return true;
  } catch (e) {
    console.error('Retry download error:', e);
    return false;
  }
}

function pauseDownloadById(downloadId) {
  if (!isValidDownloadId(downloadId)) return false;
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return false;

  if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
    return false;
  }

  download.paused = true;
  download.status = 'paused';
  persistInflight(download);

  if (download.activeProcesses && download.activeProcesses.length > 0) {
    for (const proc of download.activeProcesses) {
      try {
        // Mark this process as intentionally stopped due to pause.
        // Its close handler may fire after resume (when download.paused is false)
        // and should not be treated as a real error.
        // @ts-ignore
        proc.__armgddnStopReason = 'pause';
        proc.kill('SIGTERM');
      } catch (e) { }
    }
  }

  updateProgress(downloadId);
  return true;
}

async function resumeDownloadFiles(downloadId) {
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) {
    throw new Error('Download not found');
  }

  const downloadDir = download.rootDir || path.join(ctx.settings.downloadPath, download.name || 'Download');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const isFileComplete = (file) => {
    try {
      const safeRel = sanitizeRelativePath(file && file.name ? String(file.name) : '');
      if (safeRel == null) {
        logToFile(`[isFileComplete] invalid file name: ${file && file.name ? String(file.name) : ''}`);
        return false;
      }
      const outputPath = resolveInside(downloadDir, safeRel);
      if (!outputPath) {
        logToFile(`[isFileComplete] unsafe file path: ${file && file.name ? String(file.name) : ''}`);
        return false;
      }
      if (!fs.existsSync(outputPath)) {
        logToFile(`[isFileComplete] ${file.name}: file does not exist`);
        return false;
      }
      const st = fs.statSync(outputPath);
      const expected = typeof file.size === 'number' ? file.size : 0;
      if (expected > 0) {
        const result = (st.size || 0) >= expected;
        logToFile(`[isFileComplete] ${file.name}: size=${st.size}, expected=${expected}, complete=${result}`);
        return result;
      }
      // If size unknown, do NOT assume partial files are complete.
      logToFile(`[isFileComplete] ${file.name}: expected size unknown, returning false`);
      return false;
    } catch (e) {
      logToFile(`[isFileComplete] ${file.name}: error - ${e.message}`);
      return false;
    }
  };

  // Figure out what still needs to be downloaded.
  const allFiles = Array.isArray(download.files) ? download.files : [];
  const remainingFiles = allFiles.filter(f => f && f.name && !isFileComplete(f));

  try {
    for (const f of remainingFiles) {
      if (!f || !f.url) continue;
      const transformed = transformProxyUrlToDirectIfPossible(f.url);
      if (transformed && transformed !== f.url) {
        f.url = transformed;
      }
    }
  } catch (e) { }

  // Reset state
  download.paused = false;
  download.statusMessage = '';
  download.status = 'in_progress';
  download.cancelled = false;
  download.error = '';
  download.quotaNotified = false;
  download.failedFiles = [];
  download.activeFiles = {};
  download.activeProcesses = [];

  // Recompute downloaded/completed counts based on disk.
  let completedFiles = 0;
  let downloadedSize = 0;
  for (const f of allFiles) {
    if (!f || !f.name) continue;
    if (!isFileComplete(f)) continue;
    completedFiles++;
    downloadedSize += normalizeFileSize(f.size);
  }
  download.completedFiles = completedFiles;
  download.downloadedSize = downloadedSize;

  logToFile(`[Resume] remainingFiles.length: ${remainingFiles.length}, allFiles.length: ${allFiles.length}`);
  logToFile(`[Resume] completedFiles: ${download.completedFiles}, downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}`);

  // Nothing left to do - complete immediately without going through updateProgress
  // to avoid race conditions with shouldFinalizeDownload.
  if (remainingFiles.length === 0) {
    logToFile(`[Resume] No remaining files - calling completeDownload directly`);
    completeDownload(downloadId);
    return;
  }

  // Notify UI that we're resuming (but don't check finalization yet since we have files to download)
  sendToMain('download-progress', {
    id: downloadId,
    status: download.status,
    progress: download.progress,
    downloadedSize: download.downloadedSize,
    totalSpeed: download.totalSpeed,
    activeFiles: [],
    completedFiles: download.completedFiles,
    fileCount: download.fileCount
  });

  const requestedParallel = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
  const getRequestedWorkersNow = () => {
    const requestedParallelNow = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
    return Math.min(20, Math.max(1, Number.isFinite(requestedParallelNow) ? requestedParallelNow : 3));
  };
  const requestedWorkers = getRequestedWorkersNow();

  let shouldApplyServerConcurrency = true;
  try {
    shouldApplyServerConcurrency = remainingFiles.some(f => isProxyDownloadUrl(f && f.url ? String(f.url) : ''));
  } catch (e) {
    shouldApplyServerConcurrency = true;
  }

  try {
    const manifestUrl = download && download.manifestUrl ? String(download.manifestUrl) : '';
    await refreshDownloadConcurrency(download, download.token, manifestUrl);
  } catch (e) {
    if (!Number.isFinite(download.effectiveConcurrency) || download.effectiveConcurrency <= 0) {
      download.effectiveConcurrency = requestedWorkers;
    }
  }

  const PARALLEL_DOWNLOADS = requestedWorkers;
  const fileQueue = [...remainingFiles];
  const activePromises = [];

  let concurrencyPoll = null;
  try {
    const manifestUrl = download && download.manifestUrl ? String(download.manifestUrl) : '';
    concurrencyPoll = setInterval(() => {
      if (!download || download.cancelled || download.paused) return;
      if (!fileQueue || fileQueue.length === 0) return;
      refreshDownloadConcurrency(download, download.token, manifestUrl);
    }, 30000);
  } catch (e) { }

  const processNext = async () => {
    while (fileQueue.length > 0 && !download.cancelled && !download.paused) {
      const eff = Number(download && download.effectiveConcurrency);
      const requestedWorkersNow = getRequestedWorkersNow();
      const limit = (Number.isFinite(eff) && eff > 0) ? Math.min(requestedWorkersNow, eff) : requestedWorkersNow;
      if (getActiveFileCount(download) >= limit) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      const file = fileQueue.shift();
      if (!file) break;
      try {
        await ctx.downloadFile(downloadId, file, downloadDir);
      } catch (err) {
        if (!download.cancelled) {
          console.error('File download error (resume):', err);
        }
      }
    }
  };

  for (let i = 0; i < Math.min(PARALLEL_DOWNLOADS, remainingFiles.length); i++) {
    activePromises.push(processNext());
  }

  // Allow increasing concurrency mid-resume by spawning additional worker loops.
  let concurrencyWorkerAdjust = null;
  try {
    concurrencyWorkerAdjust = setInterval(() => {
      try {
        if (!download || download.cancelled || download.paused) return;
        if (!fileQueue || fileQueue.length === 0) return;
        const desired = getRequestedWorkersNow();
        while (activePromises.length < Math.min(desired, fileQueue.length)) {
          activePromises.push(processNext());
        }
      } catch (e) {
      }
    }, 1000);
    if (concurrencyWorkerAdjust && typeof concurrencyWorkerAdjust.unref === 'function') {
      concurrencyWorkerAdjust.unref();
    }
  } catch (e) { }

  await Promise.all(activePromises);

  try {
    if (concurrencyPoll) clearInterval(concurrencyPoll);
  } catch (e) { }
  try {
    if (concurrencyWorkerAdjust) clearInterval(concurrencyWorkerAdjust);
  } catch (e) { }

  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  logToFile(`[Resume] After Promise.all - cancelled: ${download.cancelled}, paused: ${download.paused}, hasErrors: ${hasErrors}, failedFiles: ${JSON.stringify(download.failedFiles)}`);
  logToFile(`[Resume] downloadedSize: ${download.downloadedSize}, totalSize: ${download.totalSize}, completedFiles: ${download.completedFiles}, fileCount: ${download.fileCount}`);
  if (!download.cancelled && !download.paused && !hasErrors) {
    logToFile(`[Resume] Calling completeDownload for ${downloadId}`);
    completeDownload(downloadId);
  } else {
    logToFile(`[Resume] NOT completing - updating progress instead`);
    updateProgress(downloadId);
    if (hasErrors && !download.paused && !download.cancelled) reportDirectGrantEnd(download);
  }
}

module.exports = { anyDownloadRunning, scheduleAutoRetry, retryFailedDownload, pauseDownloadById, resumeDownloadFiles };
