'use strict';
// Download progress: reading rclone's output, the overall percent and speed, reports to the site and its notices (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { sendToMain, mainWindowAlive } = require('./dialogs');
const { shouldFinalizeDownload, getActiveFileCount } = require('./downloadState');
const { getFreeDiskSpace } = require('./files');
const { logToFile, debugLog } = require('./log');
const { getGlobalPoolLimit } = require('./scheduler');
const { isAllowedServiceHost } = require('./siteApi');
const { parseSpeedToBytes, formatSpeed, formatEtaSeconds, clampInt } = require('./util');
const https = require('https');

// Report file progress to server (exclude from quota counting)
async function reportFileProgressToServer(download, token, file, status, bytesDownloadedOverride) {
  try {
    if (!token || !download || !file) return;
    const fileName = file && file.name ? String(file.name) : '';
    const totalBytes = typeof file.size === 'number' ? file.size : 0;
    const bytesDownloaded = typeof bytesDownloadedOverride === 'number'
      ? bytesDownloadedOverride
      : (status === 'completed' ? totalBytes : 0);

    const isActiveStatus = (() => {
      const s = String(status || '').toLowerCase();
      return s === 'downloading' || s === 'in_progress' || s === 'starting';
    })();

    const postData = JSON.stringify({
      downloadId: download.id,
      fileName,
      remotePath: download.remotePath || '',
      activeStreams: isActiveStatus ? getActiveFileCount(download) : 0,
      poolId: ctx.POOL_ID,
      poolActiveStreams: Math.max(0, Number(ctx.globalConcurrencyPool.inUse) || 0),
      poolLimit: getGlobalPoolLimit(),
      bytesDownloaded,
      totalBytes,
      status,
      error: null,
      isFileLevel: true, // Flag to indicate this is file-level progress, not overall completion
      expectedTotalFiles: typeof download.fileCount === 'number' ? download.fileCount : null
    });

    const targetHost = download.progressHost || 'www.armgddnbrowser.com';
    if (!isAllowedServiceHost(targetHost)) {
      return;
    }

    const options = {
      hostname: targetHost,
      port: download.progressPort || 443,
      path: download.progressPath || '/api/app-progress',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => { });
      res.on('end', () => { });
    });
    req.on('error', () => { });
    req.write(postData);
    req.end();
  } catch (e) {
  }
}

// Report progress to website server
async function reportProgressToServer(download, token) {
  logToFile(`reportProgressToServer called - token: ${token ? 'present' : 'MISSING'}, download: ${download?.name}`);

  if (!token) {
    logToFile('[Progress] No token for progress reporting');
    debugLog('No token for progress reporting');
    return;
  }

  try {
    // Calculate bytes downloaded based on completed bytes plus partial progress
    // of active files, so server-side progress matches the UI.
    let bytesDownloaded = download.downloadedSize || 0;
    const activeFiles = download.activeFiles ? Object.values(download.activeFiles) : [];
    if (Array.isArray(activeFiles) && activeFiles.length > 0) {
      for (const f of activeFiles) {
        if (!f) continue;
        const size = typeof f.size === 'number' ? f.size : 0;
        const p = typeof f.progress === 'number' ? f.progress : 0;
        if (size > 0 && p > 0 && p < 100) {
          bytesDownloaded += Math.round((p / 100) * size);
        }
      }
    }
    if (download.totalSize > 0 && bytesDownloaded > download.totalSize) {
      bytesDownloaded = download.totalSize;
    }

    // IMPORTANT: Keep server-side progress consistent with the UI clamp.
    // The website derives percent from bytesDownloaded/totalBytes; if we report 100% bytes
    // while the download is still 'downloading'/'paused' (e.g. waiting on process close or
    // post-processing), the website can show 100% but still "In Progress".
    // Only allow bytesDownloaded==totalBytes when the download is truly finalized.
    const totalBytes = download.totalSize || 0;
    const isFinal = (download.status === 'completed') || shouldFinalizeDownload(download);
    if (!isFinal && totalBytes > 0 && bytesDownloaded >= totalBytes) {
      const step = Math.max(1, Math.floor(totalBytes / 100)); // subtract ~1% so Math.round() won't hit 100
      bytesDownloaded = Math.max(0, totalBytes - step);
    }

    const reportStatus = (download.status === 'in_progress' ? 'downloading' : download.status);
    const isActiveStatus = (() => {
      const s = String(reportStatus || '').toLowerCase();
      return s === 'downloading' || s === 'in_progress' || s === 'starting';
    })();

    const postData = JSON.stringify({
      downloadId: download.id,
      fileName: download.name,
      remotePath: download.remotePath || '',  // For trending (e.g., "PC1/Game Name")
      activeStreams: isActiveStatus ? getActiveFileCount(download) : 0,
      poolId: ctx.POOL_ID,
      poolActiveStreams: Math.max(0, Number(ctx.globalConcurrencyPool.inUse) || 0),
      poolLimit: getGlobalPoolLimit(),
      bytesDownloaded: bytesDownloaded,
      totalBytes: totalBytes,
      status: reportStatus,
      statusMessage: download.statusMessage || '',
      error: download.error || null,
      expectedTotalFiles: typeof download.fileCount === 'number' ? download.fileCount : null,
      completedFiles: typeof download.completedFiles === 'number' ? download.completedFiles : null,
      extractProgress: (reportStatus === 'extracting' && typeof download.extractPercent === 'number') ? download.extractPercent : null
    });

    logToFile(`[Progress] Sending: ${postData.substring(0, 150)}`);
    debugLog(`Reporting progress: ${postData.substring(0, 100)}...`);

    const targetHost = download.progressHost || 'www.armgddnbrowser.com';
    if (!isAllowedServiceHost(targetHost)) {
      logToFile(`[Progress] Blocked progress host: ${targetHost}`);
      return;
    }

    const options = {
      hostname: targetHost,
      port: download.progressPort || 443,
      path: download.progressPath || '/api/app-progress',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        logToFile(`[Progress] Server response: ${res.statusCode} - ${responseData}`);
        debugLog(`Progress response: ${res.statusCode} ${responseData}`);
        try {
          const json = responseData ? JSON.parse(responseData) : null;
          updateProgressBackoffFromResponse(res, json);
        } catch (e) {
          updateProgressBackoffFromResponse(res, null);
        }
      });
    });

    req.on('error', (err) => {
      logToFile(`[Progress] Request error: ${err.message}`);
      debugLog(`Progress report error: ${err.message}`);
    });

    req.write(postData);
    req.end();
    logToFile(`[Progress] Request sent`);
  } catch (err) {
    logToFile(`[Progress] Exception: ${err.message} - ${err.stack}`);
    console.error('[Progress] Stack:', err.stack);
    debugLog(`Progress report exception: ${err.message}`);
  }
}

function sendServerNotice(message, ttlMs) {
  try {
    if (!mainWindowAlive()) return;
    const msg = (message && typeof message === 'string') ? message.trim() : '';
    const until = Date.now() + clampInt(ttlMs, 1000, 60000);
    if (msg) {
      ctx.lastServerNoticeText = msg;
      ctx.lastServerNoticeUntilMs = until;
      sendToMain('server-notice', { message: msg, untilMs: until });
    } else {
      ctx.lastServerNoticeText = '';
      ctx.lastServerNoticeUntilMs = 0;
      sendToMain('server-notice', { message: '', untilMs: 0 });
    }
  } catch (e) {
  }
}

function maybeClearServerNotice() {
  try {
    const now = Date.now();
    if (ctx.lastServerNoticeText && ctx.lastServerNoticeUntilMs > 0 && now >= ctx.lastServerNoticeUntilMs) {
      sendServerNotice('', 0);
    }
  } catch (e) {
  }
}

function updateProgressBackoffFromResponse(res, responseData) {
  try {
    const now = Date.now();

    let recommended = null;
    if (responseData && typeof responseData === 'object') {
      const r = Number(responseData.recommendedIntervalMs);
      if (Number.isFinite(r) && r > 0) recommended = r;
    }

    if (recommended != null) {
      ctx.progressReportMinIntervalMs = clampInt(recommended, 2000, 15000);
    }

    let retryAfterMs = 0;
    if (responseData && typeof responseData === 'object') {
      const r = Number(responseData.retryAfterMs);
      if (Number.isFinite(r) && r > 0) retryAfterMs = r;
    }
    if (!(retryAfterMs > 0) && res && typeof res.headers === 'object') {
      const ra = res.headers['retry-after'];
      const sec = ra != null ? Number(ra) : NaN;
      if (Number.isFinite(sec) && sec > 0) retryAfterMs = sec * 1000;
    }

    if (retryAfterMs > 0) {
      const until = now + clampInt(retryAfterMs, 1000, 60000);
      ctx.progressReportBackoffUntilMs = Math.max(ctx.progressReportBackoffUntilMs, until);
      ctx.progressReportMinIntervalMs = Math.max(ctx.progressReportMinIntervalMs, 4000);

      const seconds = Math.max(1, Math.ceil(clampInt(retryAfterMs, 1000, 60000) / 1000));
      sendServerNotice(`Server is busy — reducing status update frequency (${seconds}s). Downloads are unaffected.`, retryAfterMs);
    }
  } catch (e) {
  }
}

function clampProgressUnlessFinal(download) {
  if (!download) return;
  if (download.progress >= 100 && !shouldFinalizeDownload(download)) {
    download.progress = 99;
  }
}

// Parse rclone progress output
function parseRcloneProgress(downloadId, fileKey, output) {
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return;

  // Get or create file tracking
  const fileInfo = download.activeFiles[fileKey];
  if (!fileInfo) return;

  // The start-up notice is only true until data is flowing; leaving it up made a running (or resumed) download read
  // "No existing files found. Starting download..." for its whole length.
  if (download.statusMessage === 'No existing files found. Starting download...' || download.statusMessage === 'Starting download...') {
    download.statusMessage = '';
  }

  // One-time diagnostic to prove the parser is running and seeing data for this file.
  try {
    if (!download.__rcloneParseDiagOnce) download.__rcloneParseDiagOnce = {};
    if (!download.__rcloneParseDiagOnce[fileKey]) {
      download.__rcloneParseDiagOnce[fileKey] = true;
      const s = String(output == null ? '' : output);
      const t = s.trim();
      const head = t.length > 220 ? (t.slice(0, 220) + '…') : t;
      logToFile(`[rclone-parse-diag] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} chunk=${head}`);
    }
  } catch (e) { }

  // Buffer partial progress output across stdout/stderr chunks.
  // rclone frequently emits carriage-return based updates and may split tokens across chunks.
  try {
    if (!download.__rcloneProgressBuf) download.__rcloneProgressBuf = {};
    const outStr = String(output == null ? '' : output);
    const prev = download.__rcloneProgressBuf[fileKey] ? String(download.__rcloneProgressBuf[fileKey]) : '';
    const isStatsLike = (s) => {
      try {
        const t = String(s == null ? '' : s);
        if (!t) return false;
        // Matches rclone one-line stats like: "X / Y, 1%, 0 B/s, ETA -" or "0 B / 0 B, -, 0 B/s, ETA -"
        return /(\bETA\b|\/s\b)/i.test(t) && /\s\/\s|\bETA\b|\bB\/s\b/i.test(t);
      } catch (e) {
        return false;
      }
    };
    // If rclone is emitting an overwrite update (common with --stats-one-line),
    // it typically begins with a carriage return. In that case, treat it as
    // replacing the current line instead of appending, otherwise the buffer
    // becomes a concatenated mess and parsing fails.
    const lastCrIdx = outStr.lastIndexOf('\r');
    const isOverwrite = lastCrIdx !== -1;
    const overwriteStr = isOverwrite ? outStr.slice(lastCrIdx + 1) : '';
    // If the '\r' got split across chunks, we may receive consecutive stats-like fragments
    // without any '\r' present in the latter chunk. In that case, treat it as overwrite.
    const isImplicitOverwrite = !isOverwrite && isStatsLike(prev) && isStatsLike(outStr);
    const next = isOverwrite ? overwriteStr : (isImplicitOverwrite ? outStr : (prev + outStr));
    download.__rcloneProgressBuf[fileKey] = next;
  } catch (e) { }

  const stripAnsiAndControl = (s) => {
    try {
      const str = String(s == null ? '' : s);
      // Strip ANSI escape sequences (including CSI, OSC) and other control chars.
      const noAnsi = str
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      return noAnsi;
    } catch (e) {
      return String(s == null ? '' : s);
    }
  };

  let buffered = '';
  try {
    buffered = download.__rcloneProgressBuf && download.__rcloneProgressBuf[fileKey]
      ? String(download.__rcloneProgressBuf[fileKey])
      : String(output == null ? '' : output);
  } catch (e) {
    buffered = String(output == null ? '' : output);
  }

  // Split into complete lines; keep the last partial segment in the buffer.
  const sanitizedBuffered = stripAnsiAndControl(buffered);
  const endedWithDelimiter = /[\r\n]$/.test(sanitizedBuffered);
  const segments = sanitizedBuffered.split(/[\r\n]+/);
  let complete = segments;
  let remainder = '';
  if (!endedWithDelimiter && segments.length > 0) {
    remainder = segments[segments.length - 1];
    complete = segments.slice(0, -1);
  }
  try {
    if (download.__rcloneProgressBuf) download.__rcloneProgressBuf[fileKey] = remainder;
  } catch (e) { }

  // Parse progress percentage.
  // NOTE: rclone emits many lines that can contain a percentage-like token.
  // We only trust percentages from either:
  // - The aggregate "Transferred:" stats line, or
  // - A line that includes this file's name.
  // Otherwise we can jump 0->100 instantly from unrelated output.
  // Always parse the current remainder segment too: rclone often emits a single
  // continually-updating progress line without a trailing delimiter.
  const lines = remainder ? complete.concat([remainder]) : complete;
  let parsedPercent = null;
  let parsedAggregatePercent = null;
  const fileName = (fileInfo && fileInfo.name) ? String(fileInfo.name) : '';
  const fileBase = (() => {
    try {
      if (!fileName) return '';
      const parts = fileName.split('/').filter(Boolean);
      return parts.length ? String(parts[parts.length - 1]) : '';
    } catch (e) {
      return '';
    }
  })();

  const lineMentionsThisFile = (line) => {
    try {
      if (!line) return false;
      if (fileName && line.includes(fileName)) return true;
      if (fileBase && line.includes(fileBase)) return true;
      return false;
    } catch (e) {
      return false;
    }
  };
  for (const line of lines) {
    if (!line) continue;
    const trimmed = line.trim();

    // copyurl sometimes emits one-line progress without the "Transferred:" prefix, e.g.
    // "18.165 MiB / 1.423 GiB, 1%, 0 B/s, ETA -"
    // Detect it by finding a % token followed shortly by a speed token.
    if (trimmed && parsedAggregatePercent == null) {
      // NOTE: rclone prints percentages like "1%," (comma immediately after %).
      // A word-boundary after '%' would fail here (non-word to non-word), so keep it simple.
      const mOneLine = trimmed.match(/(\d{1,3})%/);
      if (mOneLine) {
        // This format is per-process / per-file (copyurl per file). Do NOT treat it as
        // a global aggregate percent for the whole download.
        parsedPercent = parseInt(mOneLine[1], 10);
        continue;
      }
    }

    // Prefer aggregate stats line (works reliably even for copyurl)
    if (trimmed.startsWith('Transferred:')) {
      const m = trimmed.match(/,\s*(\d{1,3})%/);
      if (m) {
        parsedAggregatePercent = parseInt(m[1], 10);
        parsedPercent = parsedAggregatePercent;
        continue;
      }
    }

    // Fall back to file-specific line if present
    if (lineMentionsThisFile(line)) {
      const m = line.match(/(\d{1,3})%/);
      if (m) {
        parsedPercent = parseInt(m[1], 10);
        break;
      }
    }
  }

  try {
    if (typeof parsedAggregatePercent === 'number' && Number.isFinite(parsedAggregatePercent)) {
      // One-time confirmation that we actually parsed a percent for this file.
      try {
        if (!download.__rcloneFirstParsedOnce) download.__rcloneFirstParsedOnce = {};
        if (!download.__rcloneFirstParsedOnce[fileKey]) {
          download.__rcloneFirstParsedOnce[fileKey] = true;
          logToFile(`[rclone-parse-first] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} pct=${Math.max(0, Math.min(100, Math.floor(parsedAggregatePercent)))}`);
        }
      } catch (e) { }

      if (!download.__rcloneLastLoggedPct) download.__rcloneLastLoggedPct = {};
      const prevLogged = Number(download.__rcloneLastLoggedPct[fileKey]);
      const nextLogged = Math.max(0, Math.min(100, Math.floor(parsedAggregatePercent)));
      if (!Number.isFinite(prevLogged) || prevLogged !== nextLogged) {
        download.__rcloneLastLoggedPct[fileKey] = nextLogged;
        const snippet = (() => {
          try {
            for (let i = lines.length - 1; i >= 0; i--) {
              const t = String(lines[i] || '').trim();
              if (!t) continue;
              if (t.includes('%')) {
                return t.length > 220 ? (t.slice(0, 220) + '…') : t;
              }
            }
          } catch (e) { }
          return '';
        })();
        logToFile(`[rclone-parse] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} pct=${nextLogged}${snippet ? ` line=${snippet}` : ''}`);
      }
    }
  } catch (e) { }

  // When we only have a per-file percent (common for copyurl), still emit diagnostics.
  // Do NOT apply this percent to all active files.
  try {
    if ((parsedAggregatePercent == null) && (typeof parsedPercent === 'number' && Number.isFinite(parsedPercent))) {
      try {
        if (!download.__rcloneFirstParsedOnce) download.__rcloneFirstParsedOnce = {};
        if (!download.__rcloneFirstParsedOnce[fileKey]) {
          download.__rcloneFirstParsedOnce[fileKey] = true;
          logToFile(`[rclone-parse-first] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} pct=${Math.max(0, Math.min(100, Math.floor(parsedPercent)))}`);
        }
      } catch (e) { }

      if (!download.__rcloneLastLoggedPct) download.__rcloneLastLoggedPct = {};
      const prevLogged = Number(download.__rcloneLastLoggedPct[fileKey]);
      const nextLogged = Math.max(0, Math.min(100, Math.floor(parsedPercent)));
      if (!Number.isFinite(prevLogged) || prevLogged !== nextLogged) {
        download.__rcloneLastLoggedPct[fileKey] = nextLogged;
        const snippet = (() => {
          try {
            for (let i = lines.length - 1; i >= 0; i--) {
              const t = String(lines[i] || '').trim();
              if (!t) continue;
              if (t.includes('%')) {
                return t.length > 220 ? (t.slice(0, 220) + '…') : t;
              }
            }
          } catch (e) { }
          return '';
        })();
        logToFile(`[rclone-parse] file=${fileInfo && fileInfo.name ? String(fileInfo.name) : ''} pct=${nextLogged}${snippet ? ` line=${snippet}` : ''}`);
      }
    }
  } catch (e) { }

  if (typeof parsedPercent === 'number' && Number.isFinite(parsedPercent)) {
    if (parsedPercent < 0) parsedPercent = 0;
    if (parsedPercent > 100) parsedPercent = 100;
    fileInfo.progress = parsedPercent;

    // Report live per-file progress to the server (throttled per file) so the
    // website's downloads panel shows a row for every in-progress file, not
    // just ones that have fully completed.
    try {
      if (download.token) {
        if (!download.__lastFileProgressReport) download.__lastFileProgressReport = {};
        const lastReport = Number(download.__lastFileProgressReport[fileKey]) || 0;
        const nowMs = Date.now();
        if (nowMs - lastReport > ctx.progressReportMinIntervalMs) {
          download.__lastFileProgressReport[fileKey] = nowMs;
          const size = typeof fileInfo.size === 'number' ? fileInfo.size : 0;
          const bytesDownloadedEstimate = size > 0 ? Math.round((parsedPercent / 100) * size) : 0;
          reportFileProgressToServer(download, download.token, fileInfo, 'downloading', bytesDownloadedEstimate);
        }
      }
    } catch (e) { }
  }

  // Parse speed (e.g., "123.4 MiB/s" or "45 KiB/s")
  const cleanedForMatch = stripAnsiAndControl(String(output == null ? '' : output));
  const speedMatch = cleanedForMatch.match(/(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)\/s/i);
  if (speedMatch) {
    const speedBytes = parseSpeedToBytes(speedMatch[1], speedMatch[2]);
    if (Number.isFinite(speedBytes)) {
      fileInfo.speedBytes = speedBytes;
      fileInfo.speed = formatSpeed(speedBytes);
    } else {
      fileInfo.speed = `${speedMatch[1]} ${speedMatch[2]}/s`;
      fileInfo.speedBytes = 0;
    }
  }

  // Parse ETA
  const etaMatch = cleanedForMatch.match(/ETA\s+(\S+)/);
  if (etaMatch) {
    fileInfo.eta = etaMatch[1];
  }

  // Throttle UI updates to prevent flashing
  const now = Date.now();
  const lastUpdate = ctx.lastUIUpdate.get(downloadId) || 0;
  if (now - lastUpdate < ctx.UI_UPDATE_INTERVAL) {
    return; // Skip this update
  }
  ctx.lastUIUpdate.set(downloadId, now);

  // Calculate total speed from all active files
  let totalSpeedBytes = 0;
  const activeFilesList = Object.values(download.activeFiles);
  for (const f of activeFilesList) {
    totalSpeedBytes += f.speedBytes || 0;
  }
  download.totalSpeed = formatSpeed(totalSpeedBytes);
  if (totalSpeedBytes > (download.peakSpeedBytes || 0)) {
    download.peakSpeedBytes = totalSpeedBytes;
  }

  // Overall speed and ETA from the bytes done over the last minute, not from the current file's rate or an average of it: a collection of many small
  // files finishes each file in a moment, so the per-file speed reads 0 between files and the ETA came out as 1,990,010 days (Dirk's Batman Collection, Nov 20).
  try {
    const total = Number(download.totalSize) || 0;
    const doneBytes = Number(download.downloadedSize) || 0;
    let activeBytes = 0;
    for (const f of activeFilesList) {
      if (!f) continue;
      const size = typeof f.size === 'number' ? f.size : 0;
      const p2 = typeof f.progress === 'number' ? f.progress : 0;
      if (size > 0 && p2 > 0 && p2 < 100) activeBytes += Math.round((p2 / 100) * size);
    }
    const bytesSoFar = total > 0 ? Math.min(total, Math.max(0, doneBytes + activeBytes)) : doneBytes + activeBytes;
    download.bytesSoFar = bytesSoFar;     // finished files plus what the running ones have written: what the window shows (downloadedSize alone only counts finished files)
    const est = require('../downloadRate').rateEstimate(download, bytesSoFar, total, now);
    if (est.speed > totalSpeedBytes) download.totalSpeed = formatSpeed(est.speed);
    download.totalSpeedBytes = Math.max(totalSpeedBytes, est.speed || 0);     // the same speed as a number, for the MiB/s option in the new window
    download.eta = est.etaSec != null ? formatEtaSeconds(est.etaSec) : '';
  } catch (e) {
    download.eta = '';
  }

  // Track an EMA of observed throughput so the scheduler can estimate time-to-finish.
  try {
    const nowEma = Date.now();
    const sample = Number(totalSpeedBytes) || 0;
    const prevAt = Number(download.__emaSpeedLastAt) || 0;
    const prev = Number(download.__emaSpeedBytesPerSec) || 0;
    const dtMs = prevAt > 0 ? Math.max(0, nowEma - prevAt) : 0;
    // Adapt smoothing to update cadence (aiming for ~4s half-life-ish).
    const alpha = dtMs > 0 ? Math.min(0.5, Math.max(0.05, dtMs / 4000)) : 0.25;
    const next = (prev > 0) ? (prev * (1 - alpha) + sample * alpha) : sample;
    download.__emaSpeedBytesPerSec = Math.max(0, next);
    download.__emaSpeedLastAt = nowEma;
  } catch (e) { }

  // Update overall ETA for the download.
  try {
    const total = Number(download.totalSize) || 0;
    const doneBytes = Number(download.downloadedSize) || 0;
    const ema = Number(download.__emaSpeedBytesPerSec) || 0;
    if (total > 0 && ema > 0) {
      const activeBytes = (() => {
        let acc = 0;
        for (const f of activeFilesList) {
          if (!f) continue;
          const size = typeof f.size === 'number' ? f.size : 0;
          const p = typeof f.progress === 'number' ? f.progress : 0;
          if (size > 0 && p > 0 && p < 100) {
            acc += Math.round((p / 100) * size);
          }
        }
        return acc;
      })();
      const bytesSoFar = Math.min(total, Math.max(0, doneBytes + activeBytes));
      const remainingBytes = Math.max(0, total - bytesSoFar);
      const etaSec = remainingBytes / Math.max(1, ema);
      download.eta = formatEtaSeconds(etaSec);
    } else {
      download.eta = '';
    }
  } catch (e) {
    download.eta = '';
  }

  // Calculate overall progress based on bytes, not file-count averaging.
  if (download.totalSize > 0) {
    let bytesSoFar = download.downloadedSize || 0;
    for (const f of activeFilesList) {
      if (!f) continue;
      const size = typeof f.size === 'number' ? f.size : 0;
      const p = typeof f.progress === 'number' ? f.progress : 0;
      if (size > 0 && p > 0 && p < 100) {
        bytesSoFar += Math.round((p / 100) * size);
      }
    }
    if (bytesSoFar > download.totalSize) bytesSoFar = download.totalSize;
    download.progress = Math.round((bytesSoFar / download.totalSize) * 100);
  } else {
    // Fallback when totalSize is unknown
    let totalProgress = download.completedFiles * 100;
    for (const f of activeFilesList) {
      totalProgress += f.progress || 0;
    }
    download.progress = Math.round(totalProgress / download.fileCount);
  }

  clampProgressUnlessFinal(download);

  sendToMain('download-progress', {
    id: downloadId,
    progress: download.progress,
    eta: download.eta || '',
    totalSpeed: download.totalSpeed,
    activeFiles: activeFilesList,
    completedFiles: download.completedFiles,
    fileCount: download.fileCount
  });

  // Report to server (throttled, server can recommend/backoff)
  const now2 = Date.now();
  if (ctx.progressReportBackoffUntilMs > now2) {
  } else if (now2 - ctx.lastProgressReport > ctx.progressReportMinIntervalMs) {
    ctx.lastProgressReport = now2;
    reportProgressToServer(download, download.token);
  }

  maybeClearServerNotice();

  if (shouldFinalizeDownload(download)) {
    ctx.completeDownload(downloadId);
  }
}

// Update overall progress
function updateProgress(downloadId) {
  const download = ctx.activeDownloads.get(downloadId);
  if (!download) return;

  if (download.totalSize > 0) {
    let bytesSoFar = download.downloadedSize || 0;
    const activeFilesList0 = Object.values(download.activeFiles || {});
    for (const f of activeFilesList0) {
      if (!f) continue;
      const size = typeof f.size === 'number' ? f.size : 0;
      const p = typeof f.progress === 'number' ? f.progress : 0;
      if (size > 0 && p > 0 && p < 100) {
        bytesSoFar += Math.round((p / 100) * size);
      }
    }
    if (bytesSoFar > download.totalSize) bytesSoFar = download.totalSize;
    download.progress = Math.round((bytesSoFar / download.totalSize) * 100);
  }

  clampProgressUnlessFinal(download);

  const activeFilesList = Object.values(download.activeFiles || {});
  let totalSpeedBytes = 0;
  for (const f of activeFilesList) {
    totalSpeedBytes += f.speedBytes || 0;
  }
  download.totalSpeed = formatSpeed(totalSpeedBytes);
  if (totalSpeedBytes > (download.peakSpeedBytes || 0)) {
    download.peakSpeedBytes = totalSpeedBytes;
  }

  // Periodic mid-download disk-space re-check, throttled to ~every 2 minutes
  // per download (the pre-flight check in start-download only runs once, at
  // the very beginning — this catches space that disappears mid-download
  // from other activity on the machine). Warn only, never auto-pause/cancel.
  const DISK_RECHECK_INTERVAL_MS = 2 * 60 * 1000;
  const nowForDiskCheck = Date.now();
  if (download.downloadDir && download.status !== 'paused' && download.status !== 'cancelled' &&
      (!download.__lastDiskCheckAt || (nowForDiskCheck - download.__lastDiskCheckAt) >= DISK_RECHECK_INTERVAL_MS)) {
    download.__lastDiskCheckAt = nowForDiskCheck;
    try {
      const freeBytes = getFreeDiskSpace(download.downloadDir);
      const remaining = Math.max(0, (download.totalSize || 0) - (download.downloadedSize || 0));
      const LOW_SPACE_BUFFER_BYTES = 200 * 1024 * 1024; // 200MB — smaller than the pre-flight buffer since most has already landed
      download.lowDiskSpaceWarning = freeBytes >= 0 && remaining > 0 && freeBytes < (remaining + LOW_SPACE_BUFFER_BYTES);
    } catch (e) { }
  }

  sendToMain('download-progress', {
    id: downloadId,
    status: download.status,
    progress: download.progress,
    statusMessage: download.statusMessage || '',
    downloadedSize: download.downloadedSize,
    totalSpeed: download.totalSpeed,
    activeFiles: activeFilesList,
    completedFiles: download.completedFiles,
    fileCount: download.fileCount,
    lowDiskSpaceWarning: !!download.lowDiskSpaceWarning,
    actualRemote: download.actualRemote,
    mirrorSwitches: download.mirrorSwitches,
    triedMirrors: download.triedMirrors
  });

  // Report to server (throttled, server can recommend/backoff)
  const now = Date.now();
  if (ctx.progressReportBackoffUntilMs > now) {
  } else if (now - ctx.lastProgressReport > ctx.progressReportMinIntervalMs) {
    ctx.lastProgressReport = now;
    reportProgressToServer(download, download.token);
  }

  maybeClearServerNotice();

  if (shouldFinalizeDownload(download)) {
    ctx.completeDownload(downloadId);
  }
}

module.exports = { reportFileProgressToServer, reportProgressToServer, sendServerNotice, maybeClearServerNotice, updateProgressBackoffFromResponse, clampProgressUnlessFinal, parseRcloneProgress, updateProgress };
