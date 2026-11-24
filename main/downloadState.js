'use strict';
// A download's state: what the page is sent, running file counts, waiting for processes to end, speed (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const driveDirectClient = require('../driveDirectClient');
const { logToFile } = require('./log');

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

// What the app will do once all of a download's files are in: check them against their checksums, and unpack them (George, Nov 24 2026:
// a .zip that is neither should not show Check and Unpack steps, or say "checked and extracted" when it is done). Before the file list is
// known, both are assumed. didCheck / didExtract record what actually happened.
function finishPlan(download) {
  const settings = require('./context').settings;
  const check = !!(settings && settings.autoHashCheck) && download.hasChecksums !== false;
  const unpack = !!(settings && settings.autoExtract7z) && !download.forceDisableAutoExtract && !download.toComics &&
    !isStarfieldAutoExtractTargetValue(download.remotePath) && !isStarfieldAutoExtractTargetValue(download.name) && download.has7z !== false;
  return { check, unpack };
}

function downloadToRenderer(download) {
  const plan = download.status === 'completed' && download.finishedPlan ? download.finishedPlan : finishPlan(download);
  return {
    planCheck: plan.check,
    planUnpack: plan.unpack,
    didCheck: !!download.didCheck,
    checkOk: download.checkOk !== false,
    didExtract: !!download.didExtract,
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

function isStarfieldAutoExtractTargetManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (manifest.autoExtractDisabled) return true;

  const candidates = [
    manifest.path,
    manifest.name,
    manifest.actualRemote,
    manifest.remote,
    manifest.manifestPath,
    manifest.manifestUrl
  ];

  if (Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      if (!file || typeof file !== 'object') continue;
      candidates.push(file.path, file.name, file.url);
    }
  }

  return candidates.some(isStarfieldAutoExtractTargetValue);
}

function getDownloadItemKey(manifest, remotePath, name) {
  try {
    const candidates = [
      remotePath,
      manifest && manifest.path,
      manifest && manifest.name,
      manifest && manifest.actualRemote,
      name
    ];
    for (const candidate of candidates) {
      const key = normalizeDownloadItemKey(candidate);
      if (key) return key;
    }
  } catch (e) { }
  return '';
}

function getHistoryItemKey(entry) {
  try {
    const candidates = [
      entry && entry.itemKey,
      entry && entry.remotePath,
      entry && entry.name
    ];
    for (const candidate of candidates) {
      const key = normalizeDownloadItemKey(candidate);
      if (key) return key;
    }
  } catch (e) { }
  return '';
}

async function stopDownloadProcesses(processes) {
  const active = (Array.isArray(processes) ? processes : []).filter((proc) =>
    proc && proc.exitCode === null && proc.signalCode === null
  );
  const closed = new Set();
  const waits = active.map((proc) => waitForChildClose(proc).then((didClose) => {
    if (didClose) closed.add(proc);
    return didClose;
  }));

  for (const proc of active) {
    try { proc.kill('SIGTERM'); } catch (e) { }
  }

  if (waits.length) {
    await Promise.race([
      Promise.all(waits),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  }

  for (const proc of active) {
    if (closed.has(proc) || proc.exitCode !== null || proc.signalCode !== null) continue;
    try { proc.kill('SIGKILL'); } catch (e) { }
  }
  if (waits.length) await Promise.all(waits);
}

function shouldFinalizeDownload(download) {
  if (!download) return false;
  const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
  const hasActive = Array.isArray(download.activeProcesses) && download.activeProcesses.length > 0;
  const fileCount = typeof download.fileCount === 'number' ? download.fileCount : 0;
  const completed = typeof download.completedFiles === 'number' ? download.completedFiles : 0;

  const totalSize = typeof download.totalSize === 'number' ? download.totalSize : 0;
  const downloadedSize = typeof download.downloadedSize === 'number' ? download.downloadedSize : 0;
  const isByteComplete = totalSize > 0 && downloadedSize >= totalSize;
  const isFileCountComplete = fileCount > 0 && completed >= fileCount;

  const result = (
    !download.cancelled &&
    !download.paused &&
    !hasErrors &&
    !hasActive &&
    (isByteComplete || isFileCountComplete)
  );

  logToFile(`[shouldFinalizeDownload] cancelled=${download.cancelled}, paused=${download.paused}, hasErrors=${hasErrors}, hasActive=${hasActive}, isByteComplete=${isByteComplete}, isFileCountComplete=${isFileCountComplete}, result=${result}`);
  logToFile(`[shouldFinalizeDownload] downloadedSize=${downloadedSize}, totalSize=${totalSize}, completedFiles=${completed}, fileCount=${fileCount}`);

  return result;
}

module.exports = { finishPlan, getActiveFileCount, isStarfieldAutoExtractTargetValue, normalizeDownloadItemKey, reportDirectGrantEnd, downloadToRenderer, waitForChildClose, waitForDownloadTasksToFinish, pruneActiveProcesses, peakOrAverageSpeedBytes, scheduleActiveStates, isStarfieldAutoExtractTargetManifest, getDownloadItemKey, getHistoryItemKey, stopDownloadProcesses, shouldFinalizeDownload };
