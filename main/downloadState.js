'use strict';
// A download's state: what the page is sent, running file counts, waiting for processes to end, speed (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const driveDirectClient = require('../driveDirectClient');

function getActiveFileCount(download) {
  try {
    if (!download) return 0;
    const activeFiles = download.activeFiles || {};
    let fileCount = 0;
    try {
      fileCount = Object.keys(activeFiles).length;
    } catch (e) {
      fileCount = 0;
    }

    let procCount = 0;
    try {
      const procs = Array.isArray(download.activeProcesses) ? download.activeProcesses : [];
      for (const p of procs) {
        if (!p) continue;
        if (p.killed) continue;
        // Only count processes that are actually still running.
        // ChildProcess.exitCode is null while running.
        if (p.exitCode === null) procCount++;
      }
    } catch (e) {
      procCount = 0;
    }

    return Math.max(fileCount, procCount);
  } catch (e) {
    return 0;
  }
}

function isStarfieldAutoExtractTargetValue(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!raw) return false;
  const parts = raw.split('/').filter(Boolean);
  return parts.some(part => /^starfield(?:[\s._-]|$)/i.test(part));
}

function normalizeDownloadItemKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim()
    .toLowerCase();
}

// A download that has finally failed (no automatic retry waiting) tells the site how much of its direct-from-Drive grant was not downloaded, so
// the member's daily allowance is credited back. A paused download sends nothing: it can resume, and the allowance window rolls on its own.
function reportDirectGrantEnd(download) {
  try {
    if (!download || !download.directGrant || !download.manifestUrl) return;
    if (download.paused || download.__autoRetryPending) return;
    driveDirectClient.finish(download.directGrant, String(download.manifestUrl), download.token);
  } catch (e) { }
}

function downloadToRenderer(download) {
  return {
    id: download.id,
    name: download.name,
    manifestUrl: download.manifestUrl,
    remotePath: download.remotePath,
    progressHost: download.progressHost,
    progressPort: download.progressPort,
    progressPath: download.progressPath,
    status: download.status,
    progress: download.progress,
    speed: download.speed,
    eta: download.eta,
    totalSize: download.totalSize,
    downloadedSize: download.downloadedSize,
    fileCount: download.fileCount,
    completedFiles: download.completedFiles,
    activeFiles: download.activeFiles,
    totalSpeed: download.totalSpeed,
    totalSpeedBytes: download.totalSpeedBytes || 0,
    peakSpeedBytes: download.peakSpeedBytes,
    startTime: download.startTime,
    cancelled: download.cancelled,
    paused: download.paused,
    failedFiles: download.failedFiles,
    quotaNotified: download.quotaNotified,
    forceDisableAutoExtract: download.forceDisableAutoExtract,
    serverOverhead: download.serverOverhead,
    effectiveConcurrency: download.effectiveConcurrency,
    statusMessage: download.statusMessage,
    extractPercent: typeof download.extractPercent === 'number' ? download.extractPercent : null,
    actualRemote: download.actualRemote,
    mirrorSwitches: download.mirrorSwitches,
    triedMirrors: download.triedMirrors,
    extractionError: download.extractionError,
    lowDiskSpaceWarning: !!download.lowDiskSpaceWarning,
    userPriority: download.userPriority || 0,
    resumeRemote: (download.resume && download.resume.remote) || '',
    resumePath: (download.resume && download.resume.path) || ''
  };
}

function waitForChildClose(proc, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.removeListener('close', onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { timer.unref(); } catch (e) { }
    proc.once('close', onClose);
    // Close may have fired between the first check and listener registration.
    if (proc.exitCode !== null || proc.signalCode !== null) finish(true);
  });
}

function waitForDownloadTasksToFinish(download) {
  if (!download || !(Number(download.pendingTaskCount) > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    if (!Array.isArray(download.cancelWaiters)) download.cancelWaiters = [];
    download.cancelWaiters.push(resolve);
  });
}

function pruneActiveProcesses(download) {
  if (!download || !Array.isArray(download.activeProcesses)) return;
  download.activeProcesses = download.activeProcesses.filter((p) => {
    if (!p) return false;
    if (p.exitCode === null) return true;
    return false;
  });
}

// Format bytes per second to human readable (decimal MB/s, not binary MiB/s)
// Peak speed comes from rclone progress lines. Albums of tiny files finish before any line reports a speed,
// so the peak stays 0: fall back to the average over the whole download.
function peakOrAverageSpeedBytes(download) {
  const peak = Number(download && download.peakSpeedBytes) || 0;
  if (peak > 0) return peak;
  const started = download && download.startTime ? new Date(download.startTime).getTime() : 0;
  const bytes = Number(download && (download.downloadedSize || download.totalSize)) || 0;
  const seconds = started ? (Date.now() - started) / 1000 : 0;
  return seconds > 0.5 && bytes > 0 ? bytes / seconds : 0;
}

function scheduleActiveStates() { return ['downloading', 'in_progress']; }

module.exports = { getActiveFileCount, isStarfieldAutoExtractTargetValue, normalizeDownloadItemKey, reportDirectGrantEnd, downloadToRenderer, waitForChildClose, waitForDownloadTasksToFinish, pruneActiveProcesses, peakOrAverageSpeedBytes, scheduleActiveStates };
