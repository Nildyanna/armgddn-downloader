'use strict';
// The download scheduler: which file starts next, how many run at once per download and in total (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const directEndpoint = require('../directEndpoint');
const { isPinnedDownloadStatusMessage } = require('./errors');
const { getTaskRemainingBytes } = require('./files');
const { logToFile } = require('./log');

async function refreshDownloadConcurrency(download, token, manifestUrl) {
  if (!download) return;

  const requested = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
  const requestedWorkers = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3));

  let effective = null;
  let notice = '';

  try {
    const loadInfo = await Promise.race([
      ctx.getAppLoadInfo(token, manifestUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('get-app-load timeout')), 8000))
    ]);

    if (loadInfo && loadInfo.success === true && loadInfo.concurrency) {
      const eff = Number(loadInfo.concurrency.effective);
      if (Number.isFinite(eff) && eff > 0) {
        effective = Math.min(requestedWorkers, eff);
      }
      try {
        if (Number.isFinite(eff) && eff > 0) {
          ctx.globalConcurrencyPool.serverLimit = Math.floor(eff);
        } else {
          ctx.globalConcurrencyPool.serverLimit = null;
        }
        refreshGlobalPoolLimit();
      } catch (e2) { }
      notice = (loadInfo.concurrency.notice ? String(loadInfo.concurrency.notice) : '') || '';
      try { if (directEndpoint.configure(loadInfo.directDownload)) logToFile(`[Direct] endpoint ${directEndpoint.describe()}`); } catch (e2) { }
      download.serverOverhead = loadInfo;
      try {
        logToFile(`[Concurrency] app-load ok requested=${requestedWorkers} serverEffective=${eff} appliedEffective=${effective} manifestHost=${(() => { try { return manifestUrl ? new URL(String(manifestUrl)).hostname : ''; } catch (e2) { return ''; } })()}`);
      } catch (e) { }
    } else if (loadInfo && loadInfo.success === false) {
      const errMsg = loadInfo && loadInfo.error ? String(loadInfo.error) : 'Failed to fetch server load';
      logToFile(`[Concurrency] app-load failed: ${errMsg}`);
      try {
        ctx.globalConcurrencyPool.serverLimit = null;
        refreshGlobalPoolLimit();
      } catch (e2) { }
      // Provide a user-friendly message for quota exhaustion
      if (errMsg && /quota|limit|exhausted|too many/i.test(errMsg)) {
        notice = 'You are allowed 2 complete downloads per title per 24‑hour period and you have exhausted that for this title.';
      }
      // Any other failure (a DNS or connection error, a rate limit) only means the load check
      // was skipped: the download carries on at the requested setting. Showing the raw error
      // (it used to be the last fallback host's "getaddrinfo ENOTFOUND ...") made a working
      // download look broken, so it stays in the log.
    }
  } catch (e) {
    try {
      logToFile(`[Concurrency] get-app-load threw: ${e && e.message ? e.message : String(e)}`);
    } catch (e2) { }
    try {
      ctx.globalConcurrencyPool.serverLimit = null;
      refreshGlobalPoolLimit();
    } catch (e3) { }
  }

  download.effectiveConcurrency = effective;
  download.serverOverhead = download.serverOverhead || null;

  if (!notice) {
    const effNow = Number(download.effectiveConcurrency);
    if (Number.isFinite(effNow) && effNow > 0 && requestedWorkers > effNow) {
      // Only blame load when the server is actually giving less than its
      // normal per-user limit; otherwise the setting is just above that limit.
      const base = Number(download.serverOverhead && download.serverOverhead.concurrency && download.serverOverhead.concurrency.base);
      notice = (Number.isFinite(base) && base > 0 && effNow >= base)
        ? `The server allows up to ${base} parallel downloads per user (you set ${requestedWorkers}).`
        : `Server load is high. Concurrent downloads may be throttled (${effNow} / ${requestedWorkers}).`;
    }
  }

  if (notice) {
    download.statusMessage = notice;
  } else if (effective && !isPinnedDownloadStatusMessage(download.statusMessage)) {
    download.statusMessage = `Starting downloads...`;
  }

  try { ctx.updateProgress(download.id); } catch (e) { }
}

function getDownloadRunningCount(downloadId) {
  try {
    const n = ctx.adaptiveScheduler.runningByDownloadId.get(String(downloadId));
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  } catch (e) {
    return 0;
  }
}

function incDownloadRunning(downloadId) {
  const key = String(downloadId);
  const prev = getDownloadRunningCount(key);
  ctx.adaptiveScheduler.runningByDownloadId.set(key, prev + 1);
}

function decDownloadRunning(downloadId) {
  const key = String(downloadId);
  const prev = getDownloadRunningCount(key);
  const next = Math.max(0, prev - 1);
  if (next === 0) ctx.adaptiveScheduler.runningByDownloadId.delete(key);
  else ctx.adaptiveScheduler.runningByDownloadId.set(key, next);
}

function pickNextAdaptiveTask() {
  const now = Date.now();
  let best = null;
  let bestScore = Infinity;
  // Diagnostic only: records why each pending task was passed over this
  // pass, so a stall (pending.length > 0 but nothing ever gets picked) is
  // diagnosable from the log instead of looking identical to a healthy,
  // empty-queue idle state. See the stall-summary log in schedulerPump().
  const skipReasons = [];

  for (const t of ctx.adaptiveScheduler.pending) {
    if (!t) continue;
    const download = ctx.activeDownloads.get(String(t.downloadId));
    if (!download) { skipReasons.push(`${t.downloadId}/${t.file && t.file.name}: no download object`); continue; }
    if (download.cancelled) { skipReasons.push(`${t.downloadId}/${t.file && t.file.name}: cancelled`); continue; }
    if (download.paused) { skipReasons.push(`${t.downloadId}/${t.file && t.file.name}: paused`); continue; }

    const remaining = getTaskRemainingBytes(t);
    const ageMs = Math.max(0, now - (Number(t.enqueuedAt) || now));
    const running = getDownloadRunningCount(t.downloadId);

    // Enforce per-download concurrency limit (server effective limit when available).
    try {
      const requested = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
      const requestedWorkers = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3));
      const eff = Number(download && download.effectiveConcurrency);
      const limit = (Number.isFinite(eff) && eff > 0) ? Math.min(requestedWorkers, eff) : requestedWorkers;
      if (running >= limit) {
        skipReasons.push(`${t.downloadId}/${t.file && t.file.name}: running=${running} >= limit=${limit} (requested=${requestedWorkers}, effective=${eff})`);
        continue;
      }
    } catch (e) { }

    const emaSpeedTotal = Number(download && download.__emaSpeedBytesPerSec) || 0;
    const perTaskSpeed = (Number.isFinite(emaSpeedTotal) && emaSpeedTotal > 0)
      ? (emaSpeedTotal / Math.max(1, Math.max(1, running)))
      : 0;
    const secondsToFinish = (Number.isFinite(perTaskSpeed) && perTaskSpeed > 0)
      ? (remaining / Math.max(1, perTaskSpeed))
      : remaining;

    // Baseline: shortest estimated time-to-finish.
    // Fairness: strongly prefer giving a slot to a download with no running tasks.
    // Aging: small nudge so tasks don't starve.
    let score = secondsToFinish;
    if (running === 0) score *= 0.5;
    score -= Math.min(5, (ageMs / 1000) * 0.05);

    // User priority (drag-to-reprioritize): a PROPORTIONAL discount, not a
    // flat offset — secondsToFinish scales with file size (seconds for a
    // small file, hours for a large one), so a fixed constant would be
    // meaningless next to a multi-GB download's estimate. Each priority rank
    // halves the effective score, keeping the bias consistent regardless of
    // file size while still letting the existing fairness/aging act as a
    // tiebreaker between downloads of similar priority.
    const priorityRank = Number(download && download.userPriority) || 0;
    if (priorityRank > 0) {
      score *= Math.pow(0.5, priorityRank);
    }

    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  // Nothing pickable despite a non-empty queue -- exactly the signature of a
  // stalled scheduler (a real one from the field: 4 files finished, then 22
  // remaining files sat untouched for 2.5+ minutes with no visibility into
  // why). Always-on but throttled to once per 5s so a genuine stall doesn't
  // flood the log.
  if (!best && ctx.adaptiveScheduler.pending.length > 0) {
    const nowThrottle = Date.now();
    if (nowThrottle - (Number(ctx.adaptiveScheduler.lastStallLogAt) || 0) > 5000) {
      ctx.adaptiveScheduler.lastStallLogAt = nowThrottle;
      try {
        logToFile(`[Scheduler] STALL: ${ctx.adaptiveScheduler.pending.length} pending task(s), none pickable this pass:`);
        for (const reason of skipReasons) {
          logToFile(`[Scheduler] STALL reason: ${reason}`);
        }
      } catch (e) { }
    }
  }

  return best;
}

async function schedulerPump() {
  if (ctx.adaptiveScheduler.pumping) return;
  ctx.adaptiveScheduler.pumping = true;
  try {
    while (ctx.adaptiveScheduler.pending.length > 0) {
      const task = pickNextAdaptiveTask();
      if (!task) break;

      // Remove selected task from the pending list.
      const idx = ctx.adaptiveScheduler.pending.indexOf(task);
      if (idx !== -1) ctx.adaptiveScheduler.pending.splice(idx, 1);

      const releaseGlobal = await acquireGlobalPoolSlot();

      // Slot acquired; the download may have been cancelled/paused while waiting.
      const download = ctx.activeDownloads.get(String(task.downloadId));
      if (!download || download.cancelled || download.paused) {
        try { releaseGlobal(); } catch (e) { }
        try { if (task && typeof task.reject === 'function') task.reject(new Error('Download cancelled')); } catch (e) { }
        continue;
      }

      // Start the task (non-preemptive).
      incDownloadRunning(task.downloadId);

      try {
        const now = Date.now();
        // Was DEBUG_LOGGING-gated -- that flag is off in production, so this
        // was invisible in every real-world log, including the one that
        // originally surfaced the scheduler stall this diagnostic exists to
        // catch. Always-on now, still throttled to avoid flooding the log.
        if ((now - (Number(ctx.adaptiveScheduler.lastDecisionLogAt) || 0)) > 3000) {
          ctx.adaptiveScheduler.lastDecisionLogAt = now;
          logToFile(`[Scheduler] start downloadId=${String(task.downloadId)} file=${task && task.file && task.file.name ? String(task.file.name) : ''} pending=${ctx.adaptiveScheduler.pending.length} inUse=${Number(ctx.globalConcurrencyPool.inUse) || 0} limit=${Number(ctx.globalConcurrencyPool.limit) || 0}`);
        }
      } catch (e) { }

      ctx.downloadFile(task.downloadId, task.file, task.downloadDir, releaseGlobal)
        .then(() => {
          try { decDownloadRunning(task.downloadId); } catch (e) { }
          try {
            logToFile(`[Scheduler] task done (ok) downloadId=${String(task.downloadId)} file=${task && task.file && task.file.name ? String(task.file.name) : ''} pending=${ctx.adaptiveScheduler.pending.length} -- re-pumping`);
          } catch (e) { }
          try { if (task && typeof task.resolve === 'function') task.resolve(); } catch (e) { }
          try { schedulerPump(); } catch (e) { }
        })
        .catch((err) => {
          try { decDownloadRunning(task.downloadId); } catch (e) { }
          try {
            logToFile(`[Scheduler] task done (err) downloadId=${String(task.downloadId)} file=${task && task.file && task.file.name ? String(task.file.name) : ''} pending=${ctx.adaptiveScheduler.pending.length} err=${err && err.message ? err.message : String(err)} -- re-pumping`);
          } catch (e) { }
          try { if (task && typeof task.reject === 'function') task.reject(err); } catch (e) { }
          try { schedulerPump(); } catch (e) { }
        });
    }
  } finally {
    ctx.adaptiveScheduler.pumping = false;
  }
}

function enqueueAdaptiveTask(downloadId, file, downloadDir) {
  return new Promise((resolve, reject) => {
    ctx.adaptiveScheduler.pending.push({
      downloadId: String(downloadId),
      file,
      downloadDir,
      enqueuedAt: Date.now(),
      resolve,
      reject
    });
    schedulerPump();
  });
}

function getGlobalPoolLimit() {
  try {
    const raw = Number(ctx.settings && ctx.settings.maxConcurrentDownloads);
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
    const userLimit = Math.min(20, Math.max(1, n));
    const serverRaw = Number(ctx.globalConcurrencyPool && ctx.globalConcurrencyPool.serverLimit);
    const serverLimit = Number.isFinite(serverRaw) && serverRaw > 0 ? Math.floor(serverRaw) : null;
    return serverLimit ? Math.max(1, Math.min(userLimit, serverLimit)) : userLimit;
  } catch (e) {
    return 2;
  }
}

function refreshGlobalPoolLimit() {
  try {
    ctx.globalConcurrencyPool.limit = getGlobalPoolLimit();
    while (ctx.globalConcurrencyPool.inUse < ctx.globalConcurrencyPool.limit && ctx.globalConcurrencyPool.waiters.length > 0) {
      const next = ctx.globalConcurrencyPool.waiters.shift();
      if (!next) continue;
      ctx.globalConcurrencyPool.inUse++;
      next(() => {
        try {
          ctx.globalConcurrencyPool.inUse = Math.max(0, (Number(ctx.globalConcurrencyPool.inUse) || 0) - 1);
          refreshGlobalPoolLimit();
        } catch (e) {
        }
      });
    }
  } catch (e) {
  }
}

function acquireGlobalPoolSlot() {
  refreshGlobalPoolLimit();
  return new Promise((resolve) => {
    try {
      if (ctx.globalConcurrencyPool.inUse < ctx.globalConcurrencyPool.limit) {
        ctx.globalConcurrencyPool.inUse++;
        resolve(() => {
          try {
            ctx.globalConcurrencyPool.inUse = Math.max(0, (Number(ctx.globalConcurrencyPool.inUse) || 0) - 1);
            refreshGlobalPoolLimit();
          } catch (e) {
          }
        });
        return;
      }
      ctx.globalConcurrencyPool.waiters.push(resolve);
    } catch (e) {
      resolve(() => { });
    }
  });
}

module.exports = { refreshDownloadConcurrency, getDownloadRunningCount, incDownloadRunning, decDownloadRunning, pickNextAdaptiveTask, schedulerPump, enqueueAdaptiveTask, getGlobalPoolLimit, refreshGlobalPoolLimit, acquireGlobalPoolSlot };
