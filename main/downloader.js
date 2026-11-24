'use strict';
// The downloader: starting and running a download, file by file (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const mainState = require('./context');
const directEndpoint = require('../directEndpoint');
const downloadErrors = require('../downloadErrors');
const driveDirectClient = require('../driveDirectClient');
const { resumeDownload, ResumeProc } = require('../resumeDownload');
const scheduleLib = require('../schedule');
const { probeRanges, segmentedDownload } = require('../segmentedDownload');
const { showDownloadNotification, formatDownloadFailedMessage } = require('./completion');
const { sendToMain } = require('./dialogs');
const { scheduleAutoRetry } = require('./downloadControl');
const { isQuotaError, isServerBusyError, isRcloneCrashOutput, isNetworkStreamError, isTokenExpiredError } = require('./errors');
const { reportDownloadFailure, isDownloadAbandoned, noteRecovery, clockCertMessage } = require('./failures');
const { isFileCompleteOnDisk } = require('./files');
const { reportEngineToServer } = require('./hashing');
const { logToFile } = require('./log');
const { fetchManifestRidingOutNetwork, refetchManifestAndRetryExpiredLink } = require('./manifest');
const { markMirrorCooldown, getActiveMirrorAvoidList } = require('./mirrors');
const { transformProxyUrlToDirectIfPossible, resolveDownloadRedirectUrl, getActiveFileKey, isProxyDownloadUrl } = require('./net');
const { updateProgress, reportFileProgressToServer, parseRcloneProgress } = require('./progress');
const { acquireGlobalPoolSlot } = require('./scheduler');
const { sanitizeRelativePath, resolveInside, normalizeFileSize, redactUrlQueryStrings, parseSpeedToBytes, parseRcloneHttpStatus } = require('./util');
const { spawn } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Download a single file using rclone
async function downloadFile(downloadId, file, downloadDir, preAcquiredRelease) {
  return new Promise((resolve, reject) => {
    (async () => {
      const releaseGlobal = (typeof preAcquiredRelease === 'function') ? preAcquiredRelease : await acquireGlobalPoolSlot();
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        try { releaseGlobal(); } catch (e) { }
      };

      let trackedDownload = null;
      let taskTracked = false;
      let taskFinished = false;
      const done = (err) => {
        try { releaseOnce(); } catch (e) { }
        if (taskTracked && !taskFinished) {
          taskFinished = true;
          trackedDownload.pendingTaskCount = Math.max(0, (Number(trackedDownload.pendingTaskCount) || 0) - 1);
          if (trackedDownload.pendingTaskCount === 0) {
            const waiters = Array.isArray(trackedDownload.cancelWaiters) ? trackedDownload.cancelWaiters.splice(0) : [];
            for (const waiter of waiters) {
              try { waiter(); } catch (e) { }
            }
          }
        }
        if (err) reject(err);
        else resolve();
      };

      const download = mainState.activeDownloads.get(downloadId);
      if (!download) {
        done(new Error('Download not found'));
        return;
      }
      trackedDownload = download;
      taskTracked = true;
      download.pendingTaskCount = (Number(download.pendingTaskCount) || 0) + 1;
      if (download.cancelled) {
        done();
        return;
      }

    // Security: Validate file URL is HTTPS
      if (!file.url || !file.url.startsWith('https://')) {
        done(new Error('Security error: File URL must use HTTPS'));
        return;
      }

    try {
      const transformed = transformProxyUrlToDirectIfPossible(file.url);
      if (transformed && transformed !== file.url) {
        file.url = transformed;
      }
    } catch (e) { }

    try {
      const u0 = new URL(String(file.url || ''));
      const isArmgddnHost0 = u0.hostname === 'www.armgddnbrowser.com' || u0.hostname === 'armgddnbrowser.com' || u0.hostname.endsWith('.armgddnbrowser.com');
      if (isArmgddnHost0 && u0.pathname === '/api/download-file') {
        const resolved = await resolveDownloadRedirectUrl(String(file.url), 5);
        if (resolved && resolved !== file.url) {
          try {
            const uh = new URL(resolved);
            logToFile(`[Route] Resolved /api/download-file redirect host=${String(uh.hostname)} path=${String(uh.pathname)}`);
          } catch (e) {
            logToFile('[Route] Resolved /api/download-file redirect');
          }
          file.url = resolved;
        }
      }
    } catch (e) {
    }

    // The hosting provider caps the managed link at about 100 connections for the whole slot. When the site has switched the direct
    // endpoint on and it answers, use it; otherwise (off, unreachable, paused after a failure) nothing changes.
    try {
      const direct = directEndpoint.rewrite(String(file.url));
      if (direct !== String(file.url) && await directEndpoint.reachable()) {
        file.managedUrl = String(file.url);
        file.url = direct;
        logToFile(`[Direct] using ${directEndpoint.describe()} for ${file && file.name ? String(file.name) : ''}`);
      } else if (direct !== String(file.url)) {
        directEndpoint.noteFailure();
        logToFile('[Direct] endpoint did not answer; using the managed link for now');
      }
    } catch (e) { }

      if (download.cancelled) {
        done();
        return;
      }

      const safeRel = sanitizeRelativePath(file.name);
      if (!safeRel) {
        done(new Error('Security error: Invalid file name'));
        return;
      }
    const outputPath = resolveInside(downloadDir, safeRel);
      if (!outputPath) {
        done(new Error('Security error: Invalid file path'));
        return;
      }

    // An empty file has nothing to download (and cannot go through the download engine): create it here. Nothing is asked of any server.
    if (typeof file.size === 'number' && file.size === 0) {
      try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, '');
        download.completedFiles++;
        updateProgress(downloadId);
        try { reportFileProgressToServer(download, download.token, file, 'completed', 0); } catch (e) { }
        done();
      } catch (e) {
        done(new Error(`Could not create the empty file ${safeRel}: ${e && e.message ? e.message : e}`));
      }
      return;
    }

    if (isFileCompleteOnDisk(downloadDir, file)) {
      download.downloadedSize += normalizeFileSize(file.size);
      download.completedFiles++;
      updateProgress(downloadId);
      try {
        reportFileProgressToServer(download, download.token, file, 'completed', normalizeFileSize(file.size));
      } catch (e) { }
      done();
      return;
    }

    download.status = 'downloading';
    download.currentFile = file.name;

    try {
      const u = new URL(String(file && file.url ? file.url : ''));
      const host = (u && u.hostname) ? String(u.hostname).toLowerCase() : '';
      const isProxyRoute = host === 'www.armgddnbrowser.com' || host === 'armgddnbrowser.com' || host.endsWith('.armgddnbrowser.com');
      logToFile(`[Route] fileRoute=${isProxyRoute ? 'proxy' : 'direct'} file=${file && file.name ? String(file.name) : ''}`);
    } catch (e) {
      // ignore
    }

    const fileKey = getActiveFileKey(file);

    // Initialize per-file tracking
    download.activeFiles[fileKey] = {
      id: fileKey,
      name: file.name,
      size: file.size || 0,
      progress: 0,
      speed: '',
      eta: '',
      status: 'downloading'
    };

    // Reset rclone parse state for this fileKey (important across retries/session restores).
    try {
      if (download.__rcloneLastLoggedPct && Object.prototype.hasOwnProperty.call(download.__rcloneLastLoggedPct, fileKey)) {
        delete download.__rcloneLastLoggedPct[fileKey];
      }
      if (download.__rcloneProgressBuf && Object.prototype.hasOwnProperty.call(download.__rcloneProgressBuf, fileKey)) {
        delete download.__rcloneProgressBuf[fileKey];
      }
      if (download.__rcloneParseDiagOnce && Object.prototype.hasOwnProperty.call(download.__rcloneParseDiagOnce, fileKey)) {
        delete download.__rcloneParseDiagOnce[fileKey];
      }
      if (download.__rcloneFirstParsedOnce && Object.prototype.hasOwnProperty.call(download.__rcloneFirstParsedOnce, fileKey)) {
        delete download.__rcloneFirstParsedOnce[fileKey];
      }
    } catch (e) { }

    if (isProxyDownloadUrl(file.url)) {
      // Some remotes cannot be direct-routed (e.g. Coming Attractions / Testing).
      // For these, allow proxy routed downloads.
      let proxyRemote = '';
      try {
        const u = new URL(String(file.url));
        proxyRemote = String(u.searchParams.get('remote') || '');
      } catch (e) { }

      const PROXY_ALLOWED_REMOTES = new Set([
        'Testing',
        '3D Printer Models',
        'Pirated PC Apps',
        'Testers'
      ]);

      if (!PROXY_ALLOWED_REMOTES.has(proxyRemote)) {
        const err = new Error(mainState.withSupportFooter(
          `Proxy routed downloads are disabled (blocked: ${file && file.name ? String(file.name) : 'unknown file'}).`,
          'Retry the download. If it keeps failing, start the download again from the website to get a fresh direct link.'
        ));
        try {
          download.status = 'error';
          if (!Array.isArray(download.failedFiles)) {
            download.failedFiles = [];
          }
          download.failedFiles.push(file.name);
          if (download.activeFiles[fileKey]) {
            download.activeFiles[fileKey].status = 'error';
            delete download.activeFiles[fileKey];
          }
          download.statusMessage = err.message;
          updateProgress(downloadId);
        } catch (e) { }
        done(err);
        return;
      }
    }

    try {
      if (file.url && file.url.includes('armgddnbrowser.com')) {
        const u = new URL(file.url);
        const remote = u.searchParams.get('remote');
        const directUrl = transformProxyUrlToDirectIfPossible(file.url);
        if (directUrl && directUrl !== file.url) {
          logToFile(`[Route] Direct Routing Engaged: remote=${remote || 'Unknown'} to=${directUrl}`);
          file.url = directUrl;
        }
      }
    } catch (e) {
      logToFile(`[Route] Failed universal transformation: ${e.message}`);
    }

    updateProgress(downloadId);

    const rclonePath = mainState.getRclonePath();

    // Ensure parent directory exists
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let globalActiveProcs = 0;
    try {
      for (const [, d] of mainState.activeDownloads) {
        if (!d || !Array.isArray(d.activeProcesses)) continue;
        for (const p of d.activeProcesses) {
          if (!p) continue;
          if (p.killed || p.exitCode !== null) continue;
          globalActiveProcs++;
        }
      }
    } catch (e) {
      globalActiveProcs = 0;
    }

    const fileSize = normalizeFileSize(file && file.size);
    let bufferSize = '16M';
    if (globalActiveProcs >= 200) bufferSize = '4M';
    else if (globalActiveProcs >= 100) bufferSize = '8M';
    else if (globalActiveProcs >= 50) bufferSize = '16M';
    else bufferSize = (fileSize >= (2 * 1024 * 1024 * 1024)) ? '128M' : '64M';

    let route = 'direct';
    try {
      const urlStr = file && file.url ? String(file.url) : '';
      const u2 = new URL(urlStr);
      const host2 = (u2 && u2.hostname) ? String(u2.hostname).toLowerCase() : '';
      const isProxyRoute2 = host2 === 'www.armgddnbrowser.com' || host2 === 'armgddnbrowser.com' || host2.endsWith('.armgddnbrowser.com');
      route = isProxyRoute2 ? 'proxy' : 'direct';
    } catch (e) { }

    let multiThreadStreams = 0;
    let multiThreadCutoff = '128M';
    if (fileSize >= (128 * 1024 * 1024) && globalActiveProcs < 50) {
      const isWhatbox = route === 'direct' || (file.url && (file.url.includes('box.ca') || file.url.includes('whatbox.ca')));
      if (route === 'proxy' && !isWhatbox) {
        // Drastically reduce streams to bypass aggressive IP-level source throttling
        multiThreadStreams = globalActiveProcs < 10 ? 2 : 1;
      } else {
        // Direct/Whatbox: High thread count for maximum throughput (targeting 2Gbps+)
        multiThreadStreams = globalActiveProcs < 20 ? 16 : 8;
      }
      // The member's own cap (Settings > Connections per file) can only lower the automatic choice.
      const cpfCap = Number(mainState.settings && mainState.settings.connectionsPerFile);
      if (cpfCap > 0 && cpfCap < multiThreadStreams) multiThreadStreams = cpfCap;
      // On Auto, a connection that froze recently means this PC or router struggles with many connections: start the next files with fewer
      // (8 after one freeze in the last hour, 4 after two, 2 after three), and go back to the full number an hour after the last freeze.
      if (!(cpfCap > 0)) {
        const adaptCap = require('../httpOpen').adaptiveStreamCap();
        if (adaptCap && adaptCap < multiThreadStreams) {
          logToFile(`[adaptive] ${require('../httpOpen').recentStalls()} frozen connection(s) in the last hour: ${(file && file.name) ? file.name : "a file"} starts with ${adaptCap} connections instead of ${multiThreadStreams}`);
          multiThreadStreams = adaptCap;
        }
      }
    }

    // Point rclone at an empty config so it never loads (or prompts for the
    // password of) the user's system rclone.conf. copyurl only needs HTTP —
    // no remote config is required. NUL/null device names are reserved on
    // Windows so we use a real empty file written to userData.
    const emptyConfigPath = mainState.getEmptyRcloneConfigPath();

    const args = [
      'copyurl',
      file.url,
      outputPath,
      ...(emptyConfigPath ? ['--config', emptyConfigPath] : []),
      '--ask-password=false',
      '--progress',
      '--stats', '1s',
      '--stats-one-line',
      '--log-level', 'INFO',
      '--buffer-size', bufferSize,
      '--contimeout', '30s',           // Connection timeout
      '--timeout', '300s',             // Overall timeout
      '--low-level-retries', '3',      // Retry on low-level errors
      '--retries', '10',
      '--retries-sleep', '2s',
      '--bind', '0.0.0.0',
      '--drive-acknowledge-abuse',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--header', 'Referer: https://www.armgddnbrowser.com/',
      '--header', 'Origin: https://www.armgddnbrowser.com',
      '--header', 'Accept: */*'
    ];

    try {
      if (directEndpoint.isDirectUrl(file.url)) {
        const caFile = directEndpoint.certFile(app.getPath('userData'));
        if (caFile) args.push('--ca-cert', caFile);
      }
    } catch (e) { }

    if (multiThreadStreams > 0) {
      args.push('--multi-thread-streams', String(multiThreadStreams));
      args.push('--multi-thread-cutoff', String(multiThreadCutoff));
    }

    const maxMb = scheduleLib.effectiveLimitMBps(mainState.settings && mainState.settings.maxDownloadSpeedMBps, mainState.settings && mainState.settings.schedule);
    let appliedBwLimit = '';
    if (Number.isFinite(maxMb) && maxMb > 0) {
      const workersSetting = Number(mainState.settings && mainState.settings.maxConcurrentDownloads);
      const workers = Math.min(20, Math.max(1, Number.isFinite(workersSetting) ? workersSetting : 3));
      const perWorker = maxMb / workers;
      const perWorkerStr = Number.isFinite(perWorker) && perWorker > 0 ? perWorker.toFixed(1).replace(/\.0$/, '') : '';
      if (perWorkerStr) {
        appliedBwLimit = `${perWorkerStr}M`;
        args.push('--bwlimit', appliedBwLimit);
      }
    }

    try {
      const name = file && file.name ? String(file.name) : '';
      const urlStr = file && file.url ? String(file.url) : '';
      let route = 'direct';
      try {
        const u2 = new URL(urlStr);
        const host2 = (u2 && u2.hostname) ? String(u2.hostname).toLowerCase() : '';
        const isProxyRoute2 = host2 === 'www.armgddnbrowser.com' || host2 === 'armgddnbrowser.com' || host2.endsWith('.armgddnbrowser.com');
        route = isProxyRoute2 ? 'proxy' : 'direct';
      } catch (e) { }
      logToFile(`[rclone-spawn] route=${route} activeProcs=${globalActiveProcs} fileSize=${fileSize} buffer=${bufferSize} mt=${multiThreadStreams > 0 ? String(multiThreadStreams) : '0'} bwlimit=${appliedBwLimit || 'none'} file=${name}`);
    } catch (e) { }

    try {
      const urlStr = file && file.url ? String(file.url) : '';
      const full = String(process.env.ARMGDDN_LOG_FULL_URLS || '').trim() === '1';
      const shown = full ? urlStr : redactUrlQueryStrings(urlStr);
      logToFile(`[rclone-copyurl] url=${shown}`);
    } catch (e) { }
    // Where this file comes from, for the file list in the new window: Google Drive directly, or the download gateway.
    try {
      const info = download && download.activeFiles && download.activeFiles[fileKey];
      if (info) info.source = /(^|\.)googleapis\.com$/i.test(new URL(file && file.url ? String(file.url) : 'https://x.invalid').hostname) ? 'drive' : 'gateway';
    } catch (e) { }

    // Retries after a failure (expired link, dropped connection, mirror change) run
    // through the resumable downloader: rclone copyurl deletes its partial file on
    // any error and starts again from byte 0, which threw away hours of progress.
    //
    // Big files that rclone would fetch in parallel streams go through the segmented downloader instead: same
    // parallel speed, but it remembers every chunk it has on disk, so Pause/Resume (and a restart) continue
    // where they stopped. A server that ignores Range, or settings.segmentedDownloads === false, keeps rclone.
    const segmentHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://www.armgddnbrowser.com/',
      'Origin': 'https://www.armgddnbrowser.com',
      'Accept': '*/*'
    };
    let useSegmented = multiThreadStreams > 0 && fileSize > 0 && !file.__noSegmented && !(mainState.settings && mainState.settings.segmentedDownloads === false);
    // A source that needs request headers (a Drive token) only works through the segmented engine, so it never drops back to rclone copyurl.
    const needsHeaders = !!(file.headers && typeof file.headers === 'object' && Object.keys(file.headers).length);
    if (needsHeaders && fileSize > 0) useSegmented = true;
    if (useSegmented) {
      // A progress record from an earlier run already proved this server honours Range: no need to ask again (and a slow
      // answer must never push a Resume onto the rclone path, which starts the file over).
      const hasRecord = fs.existsSync(outputPath + '.armseg') && fs.existsSync(outputPath + '.armdl');
      if (!hasRecord) {
        let probe = { ok: false };
        try { probe = await probeRanges(String(file.url), { ...segmentHeaders, ...(needsHeaders ? file.headers : {}) }, undefined, directEndpoint.tlsOptions()); } catch (e) { }
        if (!needsHeaders && (!probe.ok || (probe.total && probe.total !== fileSize))) {
          useSegmented = false;
          logToFile(`[Segmented] not used for ${file && file.name ? String(file.name) : ''}: server did not confirm Range for ${fileSize} bytes (status ${probe.status || 0}, total ${probe.total || 0}${probe.error ? `, ${probe.error}` : ''}); using rclone`);
        }
      }
    }
    if (!useSegmented) {
      // rclone starts the file from zero, so progress left by the segmented downloader would only waste disk space.
      for (const suffix of ['.armdl', '.armseg', '.armseg.tmp']) { try { fs.unlinkSync(outputPath + suffix); } catch (e) { } }
    }
    if (file.__resume || useSegmented) {
      const fileName = file && file.name ? String(file.name) : '';
      const expected = normalizeFileSize(file.size);
      let lastResumeBytes = 0;
      let spBytes = null; let spAt = 0; let spRate = 0;
      const getFreshUrl = async (ctx) => {
        // A Drive link is renewed through the site, which does not count as a new download. If the site will not renew it (or the engine is
        // already on the gateway), ask the manifest for the gateway link as before.
        if (download.directGrant && file.headers && !(ctx && ctx.onFallback) && download.manifestUrl && download.token) {
          const r = await driveDirectClient.renew(download.directGrant, String(download.manifestUrl), download.token);
          if (r) { logToFile(`[DriveDirect] renewed the token for ${fileName}`); return { url: String(file.url), headers: r.headers, expiresAt: r.expiresAt, fallback: file.fallback }; }
          logToFile(`[DriveDirect] renewal refused for ${fileName}; using the gateway`);
        }
        if (!download.manifestUrl || !download.token) return String(file.url);
        const m = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, '');
        const wantPath = file.path ? String(file.path) : '';
        const hit = m && Array.isArray(m.files) ? m.files.find(f => f && ((wantPath && f.path && String(f.path) === wantPath) || (fileName && f.name && String(f.name) === fileName))) : null;
        if (!hit || !hit.url) return String(file.url);
        let u = String(hit.url);
        try { u = transformProxyUrlToDirectIfPossible(u) || u; } catch (e) { }
        logToFile(`[Resume] fresh link for ${fileName}`);
        // A manifest entry may also say which headers to send, when the source expires and which source to fall back to.
        if (hit.headers || hit.expiresAt || hit.fallback) return { url: u, headers: hit.headers, expiresAt: hit.expiresAt, fallback: hit.fallback };
        return u;
      };
      const limitBytes = appliedBwLimit ? (parseFloat(appliedBwLimit) || 0) * 1048576 : 0;   // same per-worker limit rclone would get
      const engStats = { startedAt: Date.now(), retries: {}, reasons: {} };   // why this attempt ended, sent to the site (see reportEngineToServer)
      const engine = useSegmented
        ? (o) => segmentedDownload({ ...o, streams: multiThreadStreams, maxBytesPerSec: limitBytes, tlsOptions: directEndpoint.tlsOptions(), onEvent: (m) => { logToFile(`[Segmented] ${fileName}: ${m}`); const rk = /chunk \d+ retry \d+: ([a-z_]+) ?(.*)$/.exec(String(m)); if (rk) { engStats.retries[rk[1]] = (engStats.retries[rk[1]] || 0) + 1; const why = require('../engineReason').engineReason(rk[2]); if (Object.keys(engStats.reasons).length < 8 || engStats.reasons[why]) engStats.reasons[why] = (engStats.reasons[why] || 0) + 1; } } })
        : (o) => resumeDownload({ ...o, tlsOptions: directEndpoint.tlsOptions() });
      const ctl = engine({
        url: String(file.url),
        source: { url: String(file.url), headers: file.headers, expiresAt: file.expiresAt, fallback: file.fallback },
        outputPath,
        expectedSize: expected,
        getFreshUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://www.armgddnbrowser.com/',
          'Origin': 'https://www.armgddnbrowser.com',
          'Accept': '*/*'
        },
        onProgress: (bytes, total) => {
          try {
            const t = total || expected || 0;
            const pct = t > 0 ? Math.min(100, Math.floor((bytes / t) * 100)) : 0;
            const mb = (n) => `${(n / 1048576).toFixed(3)} MiB`;
            // Real speed and ETA (rclone's own stats line is not available from the in-process downloaders).
            const nowMs = Date.now();
            if (spBytes === null) { spBytes = bytes; spAt = nowMs; }
            else if (nowMs - spAt >= 1000) {
              const inst = Math.max(0, (bytes - spBytes) / ((nowMs - spAt) / 1000));
              spRate = spRate > 0 ? (0.6 * spRate + 0.4 * inst) : inst;
              spBytes = bytes; spAt = nowMs;
            }
            const rateMib = spRate / 1048576;
            const etaSec = spRate > 0 && t > bytes ? Math.ceil((t - bytes) / spRate) : 0;
            parseRcloneProgress(downloadId, fileKey, `\r${mb(bytes)} / ${mb(t)}, ${pct}%, ${rateMib.toFixed(3)} MiB/s, ETA ${etaSec > 0 ? `${etaSec}s` : '-'}\r`);
            lastResumeBytes = bytes;
          } catch (e) { }
        }
      });
      const rproc = new ResumeProc(ctl.abort);
      download.activeProcesses.push(rproc);
      logToFile(`[Resume] resumable transfer file=${fileName} engine=${useSegmented ? `segmented x${multiThreadStreams}` : 'single'}`);
      let failure = null;
      try { await ctl.promise; } catch (e) { failure = e; }
      const ridx = download.activeProcesses.indexOf(rproc);
      if (ridx !== -1) download.activeProcesses.splice(ridx, 1);
      rproc.finish(failure ? 1 : 0);
      try {
        const superseded = !!(failure && failure.kind === 'aborted' && /supersed/i.test(String(failure.message || '')));
        const outcome = download.cancelled ? 'cancelled' : superseded ? 'superseded' : (download.paused || (failure && failure.kind === 'aborted')) ? 'paused' : failure ? 'failed' : 'completed';
        const endedBy = outcome === 'completed' ? '' : (outcome === 'cancelled' || outcome === 'paused') ? 'user' : outcome === 'superseded' ? 'app' : ((engStats.retries.stall || 0) > 0 ? 'stall' : 'error');
        if (outcome !== 'completed' || Object.keys(engStats.retries).length) {
          const sec = (Date.now() - engStats.startedAt) / 1000;
          reportEngineToServer(download, {
            outcome, endedBy, failKind: failure && failure.kind ? String(failure.kind) : '', retries: engStats.retries, reasons: engStats.reasons,
            streams: useSegmented ? multiThreadStreams : 1, seconds: sec, bytes: lastResumeBytes || 0, engine: useSegmented ? 'segmented' : 'single',
            mbit: sec > 0 ? ((lastResumeBytes || 0) * 8 / sec / 1e6) : 0, direct: !!directEndpoint.isDirectUrl(file.url), sizeMb: normalizeFileSize(file.size) / 1e6
          });
        }
      } catch (eRep) { }

      if (download.cancelled) {
        if (download.activeFiles[fileKey]) { download.activeFiles[fileKey].status = 'cancelled'; delete download.activeFiles[fileKey]; }
        updateProgress(downloadId);
        done();
        return;
      }
      if (download.paused || (failure && failure.kind === 'aborted')) {
        if (download.activeFiles[fileKey]) download.activeFiles[fileKey].status = 'paused';
        updateProgress(downloadId);
        done();
        return;
      }
      if (!failure) {
        try { if (download.directGrant && file.path) download.directGrant.done.add(String(file.path)); } catch (e) { }
        download.downloadedSize += normalizeFileSize(file.size);
        download.completedFiles++;
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'completed';
          download.activeFiles[fileKey].progress = 100;
          delete download.activeFiles[fileKey];
        }
        try { reportFileProgressToServer(download, download.token, file, 'completed', normalizeFileSize(file.size)); } catch (e) { }
        updateProgress(downloadId);
        done();
        return;
      }
      try { if (directEndpoint.isDirectUrl(file.url)) { directEndpoint.noteFailure(); logToFile('[Direct] failed; the retry will use the managed link'); } } catch (e) { }
      logToFile(`[Resume] gave up on ${fileName}: ${failure && failure.message ? failure.message : String(failure)} (kept ${lastResumeBytes} bytes)`);
      download.status = 'error';
      if (!Array.isArray(download.failedFiles)) download.failedFiles = [];
      download.failedFiles.push(file.name);
      if (download.activeFiles[fileKey]) { download.activeFiles[fileKey].status = 'error'; delete download.activeFiles[fileKey]; }
      download.error = failure.kind === 'expired'
        ? mainState.withSupportFooter('Download link expired.', 'Go back to the website and start the download again to generate a fresh link.')
        : mainState.withSupportFooter(
          'Download stalled and could not be resumed after several retries.',
          'Retry the download. If it keeps happening, change mirrors by starting the download again from the website, or lower concurrency to 1-2.'
        );
      updateProgress(downloadId);
      try { reportDownloadFailure(download, download.error); } catch (e3) { }
      if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error });
      try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
      if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
      done(new Error(download.error));
      return;
    }

    let proc;
    try {
      proc = mainState.ignoreProxyEnv ? spawn(rclonePath, args, { env: downloadErrors.withoutProxyEnv(process.env) }) : spawn(rclonePath, args);
    } catch (e) {
      // spawn() can throw synchronously (e.g. ENOENT, EACCES). In that case we would
      // otherwise leak the global concurrency slot and leave the download stuck.
      download.status = 'error';
      const msg = (e && e.message) ? String(e.message) : String(e);
      download.error = mainState.withSupportFooter(
        `Failed to start downloader engine (rclone). (${msg})`,
        'Your antivirus may have quarantined or blocked the Companion\'s downloader engine. Restore it from your antivirus quarantine, add the Companion\'s install folder as an exclusion (Windows Security > Virus & threat protection > Manage settings > Exclusions), then retry. If it keeps happening, reinstall the Companion.'
      );
      try {
        if (!Array.isArray(download.failedFiles)) download.failedFiles = [];
        download.failedFiles.push(file.name);
      } catch (e2) { }
      try {
        if (download.activeFiles && download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          delete download.activeFiles[fileKey];
        }
      } catch (e2) { }
      try {
        logToFile(`[rclone] spawn threw: ${msg} rclonePath=${String(rclonePath || '')}`);
      } catch (e2) { }
      try { updateProgress(downloadId); } catch (e2) { }
      try { reportDownloadFailure(download, download.error); } catch (e3) { }
      try { if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error }); } catch (e2) { }
      try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
      try { if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`); } catch (e2) { }
      done(new Error(download.error));
      return;
    }

    download.activeProcesses.push(proc);  // Track for cancellation

    let errorOutput = '';

    // Some environments will appear to "hang" if rclone emits no progress/stderr.
    // Track output activity and fail fast with an actionable error instead of spinning forever.
    let sawAnyOutput = false;
    let lastOutputAt = Date.now();
    let lastNonZeroProgressAt = Date.now();
    let startedAt = Date.now();
    let watchdogTimer = null;
    const WATCHDOG_SILENCE_MS = 60 * 1000;
    const WATCHDOG_ZERO_PROGRESS_GRACE_MS = 25 * 1000;
    const WATCHDOG_ZERO_PROGRESS_MS = 90 * 1000;
    const kickWatchdog = () => {
      try { lastOutputAt = Date.now(); } catch (e) { }
      if (watchdogTimer) return;
      watchdogTimer = setInterval(() => {
        try {
          if (!proc || proc.killed || proc.exitCode !== null) return;
          const now = Date.now();
          const silence = Math.max(0, now - (Number(lastOutputAt) || now));
          if (silence < WATCHDOG_SILENCE_MS) return;

          // Kill and surface a clear message. This ensures the slot is freed and user can retry.
          // @ts-ignore
          proc.__armgddnStopReason = 'watchdog';
          try {
            logToFile(`[rclone] watchdog: no output for ${Math.round(silence / 1000)}s file=${file && file.name ? String(file.name) : ''} urlHost=${(() => { try { return new URL(String(file && file.url ? file.url : '')).hostname; } catch (e) { return ''; } })()}`);
          } catch (e) { }
          try { proc.kill('SIGKILL'); } catch (e) { }
        } catch (e) {
          // ignore
        }
      }, 5000);
      try { watchdogTimer.unref(); } catch (e) { }
    };
    kickWatchdog();

    // Some failures never go fully silent: rclone continues emitting stats like
    // "0 B / 0 B, -, 0 B/s, ETA -" while making no actual progress.
    // Detect a sustained zero-progress state and restart the worker so the scheduler can
    // retry (including mirror failover).
    let progressWatchdogTimer = null;
    try {
      progressWatchdogTimer = setInterval(() => {
        try {
          if (!proc || proc.killed || proc.exitCode !== null) return;
          const now = Date.now();
          if ((now - (Number(startedAt) || now)) < WATCHDOG_ZERO_PROGRESS_GRACE_MS) return;
          const stuckFor = Math.max(0, now - (Number(lastNonZeroProgressAt) || now));
          if (stuckFor < mainState.MIRROR_EARLY_STALL_MS && stuckFor < WATCHDOG_ZERO_PROGRESS_MS) return;

          if (stuckFor >= mainState.MIRROR_EARLY_STALL_MS) {
            try {
              const currentMirror = download && download.actualRemote ? String(download.actualRemote) : '';
              if (currentMirror) {
                markMirrorCooldown(currentMirror, 'zero-progress stall');
              }
            } catch (e) { }
          }
          // @ts-ignore
          proc.__armgddnStopReason = 'stall0';
          try {
            logToFile(`[rclone] watchdog: zero-progress for ${Math.round(stuckFor / 1000)}s file=${file && file.name ? String(file.name) : ''} urlHost=${(() => { try { return new URL(String(file && file.url ? file.url : '')).hostname; } catch (e) { return ''; } })()}${stuckFor >= mainState.MIRROR_EARLY_STALL_MS ? ' (early mirror failover)' : ''}`);
          } catch (e) { }
          try { proc.kill('SIGKILL'); } catch (e) { }
        } catch (e) {
          // ignore
        }
      }, 5000);
      try { progressWatchdogTimer.unref(); } catch (e) { }
    } catch (e) {
      progressWatchdogTimer = null;
    }

    const logFirstOutput = (streamName, output) => {
      try {
        if (sawAnyOutput) return;
        const trimmed = String(output || '').trim();
        if (!trimmed) return;
        sawAnyOutput = true;
        const head = trimmed.length > 600 ? trimmed.slice(0, 600) + '…' : trimmed;
        logToFile(`[rclone] first-${streamName}: ${redactUrlQueryStrings(head)}`);
      } catch (e) { }
    };

    // Progress means the transferred byte count went up. rclone's one-line stats
    // ("42.906 MiB / 4.291 GiB, 1%, 0 B/s, ETA -") keep printing a percentage
    // after a connection dies mid-file, so counting the percentage as progress
    // (as this used to) meant a stall after the first bytes was never caught.
    let lastTransferredBytes = -1;
    const noteRcloneProgress = (output) => {
      const s = String(output || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
      const now = Date.now();
      const re = /(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)\s*\/\s*\d+(?:\.\d+)?\s*(?:B|[KMGT]i?B)\s*,/gi;
      let m;
      let latest = null;
      while ((m = re.exec(s)) !== null) latest = m;
      if (latest) {
        const bytes = parseSpeedToBytes(latest[1], latest[2]);
        if (Number.isFinite(bytes) && bytes > lastTransferredBytes) {
          if (lastTransferredBytes >= 0) lastNonZeroProgressAt = now;
          lastTransferredBytes = bytes;
        }
        return;
      }
      // No byte counter in this chunk: fall back to a non-zero speed token.
      const speed = s.match(/(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)\/s/i);
      if (speed && parseSpeedToBytes(speed[1], speed[2]) > 0) lastNonZeroProgressAt = now;
    };

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      try { kickWatchdog(); } catch (e) { }
      try { logFirstOutput('stdout', output); } catch (e) { }
      try { noteRcloneProgress(output); } catch (e) { }
      parseRcloneProgress(downloadId, fileKey, output);
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      try { kickWatchdog(); } catch (e) { }
      try { logFirstOutput('stderr', output); } catch (e) { }
      try { noteRcloneProgress(output); } catch (e) { }
      parseRcloneProgress(downloadId, fileKey, output);
    });

    proc.on('close', async (code) => {
      try {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
      } catch (e) { }
      try {
        if (progressWatchdogTimer) {
          clearInterval(progressWatchdogTimer);
          progressWatchdogTimer = null;
        }
      } catch (e) { }
      const idx = download.activeProcesses.indexOf(proc);
      if (idx !== -1) {
        download.activeProcesses.splice(idx, 1);
      }

      // @ts-ignore
      const stopReason = proc.__armgddnStopReason;

      if (download.cancelled) {
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'cancelled';
          delete download.activeFiles[fileKey];
        }
        updateProgress(downloadId);
        done();
        return;
      }

      // If this process was intentionally killed due to pause, treat as paused
      // even if the pause flag has already been cleared by a resume.
      if (download.paused || stopReason === 'pause') {
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'paused';
        }
        updateProgress(downloadId);
        // Route through done() (not a bare resolve()) so the global
        // concurrency-pool slot acquired for this task actually gets
        // released. Calling resolve() directly bypassed releaseOnce(),
        // permanently leaking one global slot every time a file was paused
        // mid-transfer -- over enough pause/resume cycles this starves the
        // whole app's download capacity.
        done();
        return;
      }

      if (code === 0) {
        download.downloadedSize += normalizeFileSize(file.size);
        download.completedFiles++;
        // Mark file as completed and remove from active
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'completed';
          download.activeFiles[fileKey].progress = 100;
          delete download.activeFiles[fileKey];
        }
        try {
          reportFileProgressToServer(download, download.token, file, 'completed', normalizeFileSize(file.size));
        } catch (e) { }
        updateProgress(downloadId);
        done();
      } else {
        download.status = 'error';

        if (!Array.isArray(download.failedFiles)) {
          download.failedFiles = [];
        }
        download.failedFiles.push(file.name);
        if (download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          // Remove from active to avoid permanently consuming a concurrency slot.
          delete download.activeFiles[fileKey];
        }

        // Check for specific error types
        const quota = isQuotaError(errorOutput);
        const busy = isServerBusyError(errorOutput);
        const sslError = errorOutput.includes('x509') || errorOutput.includes('certificate') || errorOutput.includes('ssl');
        const rcloneCrashed = isRcloneCrashOutput(errorOutput);
        const dnsError = !rcloneCrashed && (errorOutput.includes('lookup') || errorOutput.includes('name resolution') || errorOutput.includes('no such host'));
        const networkStream = isNetworkStreamError(errorOutput);
        const tokenExpired = !rcloneCrashed && isTokenExpiredError(errorOutput, (file && file.url) ? String(file.url) : '');
        const httpStatus = parseRcloneHttpStatus(errorOutput);
        const is502 = !!(httpStatus && httpStatus.code === 502);
        // Genuine per-mirror host faults (that specific mirror's server is
        // erroring or refusing connections) — distinct from quota/busy (real
        // account/server states that would just fail again on any mirror) and
        // from isNetworkStreamError's TLS/stream-transport patterns. These
        // were previously only logged (is502, above) but never fed into the
        // failover decision below.
        const mirrorHostFault = !!(httpStatus && httpStatus.code >= 500 && httpStatus.code < 600) ||
          errorOutput.toLowerCase().includes('econnrefused');
        // Google quota / rate limits are per mirror account: another mirror is
        // exactly what fixes them (Sentry COMPANION-8: a 429 on PC-1 failed
        // outright instead of trying PC-2/PC-3).
        const rateLimited = !!(httpStatus && httpStatus.code === 429) ||
          /too many requests/i.test(errorOutput);

        let fileUrlHost = '';
        try {
          const uu = new URL(String(file && file.url ? file.url : ''));
          fileUrlHost = uu && uu.hostname ? String(uu.hostname) : '';
        } catch (e) {
          fileUrlHost = '';
        }

        if (is502) {
          try {
            logToFile(`[rclone] http-502 host=${fileUrlHost || 'unknown'} file=${file && file.name ? String(file.name) : ''}`);
          } catch (e) { }
        }

        if (stopReason === 'watchdog' && !errorOutput) {
          download.error = mainState.withSupportFooter(
            'Download engine stalled (no progress output).',
            `This is usually caused by a network/DNS/TLS issue, a blocked connection, or security software interfering with rclone. Try:
1) Retry once
2) Disable VPN/Proxy temporarily
3) Ensure your firewall/AV allows the Companion
4) If on Linux, install/update ca-certificates`
          );
          updateProgress(downloadId);
          try { reportDownloadFailure(download, download.error); } catch (e3) { }
          if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error });
          try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
          if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
          done(new Error(download.error));
          return;
        }

        if (stopReason === 'stall0' && !errorOutput) {
          // Treat as a recoverable upstream stall. Try mirror failover by refetching the manifest
          // and retrying the file once before surfacing an error.
          try {
            const tried = Array.isArray(download.triedMirrors) ? download.triedMirrors.map(String) : [];
            const avoidList = getActiveMirrorAvoidList(tried);
            const avoid = avoidList.join(',');
            try {
              const currentMirror = download && download.actualRemote ? String(download.actualRemote) : '';
              if (currentMirror) {
                markMirrorCooldown(currentMirror, 'stall0 retry');
              }
            } catch (e) { }
            if (!(download && download.manifestUrl && download.token)) {
              noteRecovery(download, `stall0 failover skipped: manifestUrl=${download && download.manifestUrl ? 'yes' : 'no'} token=${download && download.token ? 'yes' : 'no'}`);
            } else if ((Number(download.mirrorSwitches) || 0) >= 5) {
              noteRecovery(download, 'stall0 failover skipped: 5 mirror switches used');
            }
            if (download && download.manifestUrl && download.token && (Number(download.mirrorSwitches) || 0) < 5) {
              logToFile(`[MirrorFailover] stall0: attempting manifest refetch avoidMirror=${avoid} file=${file && file.name ? String(file.name) : ''}`);
              const newManifest = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, avoid);
              const newActual = newManifest && newManifest.actualRemote ? String(newManifest.actualRemote) : '';
              if (!newActual || tried.includes(newActual)) {
                noteRecovery(download, `stall0 failover: server offered ${newActual || 'no mirror'} (tried ${tried.join(',') || 'none'}, avoid ${avoid || 'none'})`);
              }

              if (newActual && !tried.includes(newActual) && Array.isArray(newManifest.files)) {
                const wantPath = file && file.path ? String(file.path) : '';
                const wantName = file && file.name ? String(file.name) : '';
                const match = newManifest.files.find(f => {
                  if (!f) return false;
                  if (wantPath && f.path && String(f.path) === wantPath) return true;
                  if (wantName && f.name && String(f.name) === wantName) return true;
                  return false;
                });

                if (!(match && match.url)) {
                  noteRecovery(download, `stall0 failover: ${newActual} manifest has no match for ${wantName}`);
                }
                if (match && match.url) {
                  download.actualRemote = newActual;
                  download.mirrorSwitches = (Number(download.mirrorSwitches) || 0) + 1;
                  try {
                    if (!Array.isArray(download.triedMirrors)) download.triedMirrors = [];
                    download.triedMirrors.push(newActual);
                  } catch (e) { }

                  const retryFile = { ...file, url: String(match.url), __resume: true };
                  try {
                    const transformed = transformProxyUrlToDirectIfPossible(retryFile.url);
                    if (transformed && transformed !== retryFile.url) retryFile.url = transformed;
                  } catch (e) { }

                  noteRecovery(download, `stall0 failover: switched to ${newActual} for ${wantName}`);
                  logToFile(`[MirrorFailover] stall0: retrying on new mirror actualRemote=${newActual} file=${wantName}`);
                  // Remove from failedFiles if it was marked earlier.
                  try {
                    if (Array.isArray(download.failedFiles)) {
                      download.failedFiles = download.failedFiles.filter(n => String(n) !== String(file.name));
                    }
                  } catch (e) { }
                  // Reset state.
                  download.status = 'downloading';
                  download.error = '';
                  updateProgress(downloadId);

                  // The nested downloadFile() call acquires and correctly
                  // releases its OWN global concurrency slot for the retry.
                  // done() (not a bare resolve()) releases THIS call's
                  // already-held slot too -- a bare resolve() here leaked one
                  // global slot per successful stall0 mirror-failover retry.
                  await downloadFile(downloadId, retryFile, downloadDir);
                  done();
                  return;
                }
              }
            }
          } catch (e) {
            noteRecovery(download, `stall0 failover error: ${e && e.message ? e.message : String(e)}`);
            try { logToFile(`[MirrorFailover] stall0: manifest refetch/retry failed: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
          }

          // No other mirror to switch to. A mid-file stall is usually just a dropped
          // connection, so retry the same file with a freshly signed link (gateway
          // links expire within about a minute) before failing it.
          try {
            if (!download.__stallRetries) download.__stallRetries = {};
            const retryKey = String((file && (file.path || file.name)) || '');
            const attempt = (Number(download.__stallRetries[retryKey]) || 0) + 1;
            if (download.manifestUrl && download.token && attempt <= mainState.STALL_SAME_MIRROR_RETRIES) {
              download.__stallRetries[retryKey] = attempt;
              const freshManifest = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, '');
              const wantPath = file && file.path ? String(file.path) : '';
              const wantName = file && file.name ? String(file.name) : '';
              const match = freshManifest && Array.isArray(freshManifest.files) ? freshManifest.files.find(f => {
                if (!f) return false;
                if (wantPath && f.path && String(f.path) === wantPath) return true;
                if (wantName && f.name && String(f.name) === wantName) return true;
                return false;
              }) : null;

              if (match && match.url) {
                if (freshManifest.actualRemote) download.actualRemote = String(freshManifest.actualRemote);
                const retryFile = { ...file, url: String(match.url), __resume: true };
                try {
                  const transformed = transformProxyUrlToDirectIfPossible(retryFile.url);
                  if (transformed && transformed !== retryFile.url) retryFile.url = transformed;
                } catch (e) { }
                noteRecovery(download, `stall retry ${attempt}/${mainState.STALL_SAME_MIRROR_RETRIES} on ${download.actualRemote || '?'} for ${wantName}`);
                logToFile(`[StallRetry] attempt ${attempt}/${mainState.STALL_SAME_MIRROR_RETRIES}: retrying with a fresh link actualRemote=${download.actualRemote || ''} file=${wantName}`);
                try {
                  if (Array.isArray(download.failedFiles)) {
                    download.failedFiles = download.failedFiles.filter(n => String(n) !== String(file.name));
                  }
                } catch (e) { }
                download.status = 'downloading';
                download.error = '';
                updateProgress(downloadId);
                // Same slot accounting as the mirror-failover retry above: the nested
                // call holds its own slot, done() releases this one.
                await downloadFile(downloadId, retryFile, downloadDir);
                done();
                return;
              }
            }
          } catch (e) {
            noteRecovery(download, `stall retry error: ${e && e.message ? e.message : String(e)}`);
            try { logToFile(`[StallRetry] fresh-link retry failed: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
          }

          download.error = download.__clockSuspect ? clockCertMessage() : mainState.withSupportFooter(
            'Download stalled and could not be resumed after several retries.',
            'Retry the download. If it keeps happening, change mirrors by starting the download again from the website, or lower concurrency to 1-2.'
          );
          updateProgress(downloadId);
          try { reportDownloadFailure(download, download.error); } catch (e3) { }
          if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error });
          try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
          if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
          done(new Error(download.error));
          return;
        }

        // Attempt mirror failover once for network/stream failures.
        // This only works when the manifest URL points at a mirror group remote.
        let canTryMirrorFailoverRetryStarted = false;
        try {
          const canTryMirrorFailover = !!(
            (networkStream || mirrorHostFault || quota || rateLimited) &&
            !busy &&
            !sslError &&
            !dnsError &&
            !tokenExpired &&
            download &&
            download.manifestUrl &&
            download.token &&
            (Number(download.mirrorSwitches) || 0) < 5
          );

          if (canTryMirrorFailover) {
            const tried = Array.isArray(download.triedMirrors) ? download.triedMirrors.map(String) : [];
            const avoidList = getActiveMirrorAvoidList(tried);
            const avoid = avoidList.join(',');
            try {
              const currentMirror = download && download.actualRemote ? String(download.actualRemote) : '';
              if (currentMirror) {
                markMirrorCooldown(currentMirror, 'network stream error');
              }
            } catch (e) { }
            logToFile(`[MirrorFailover] attempting manifest refetch avoidMirror=${avoid} file=${file && file.name ? String(file.name) : ''}`);
            // Same recovering guard as the token-refresh retry path — activeProcesses
            // is empty for the whole manifest refetch, so without this the poll loop
            // can finalize the download as failed while this retry is still in flight.
            download.recovering = true;
            const newManifest = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, avoid);
            const newActual = newManifest && newManifest.actualRemote ? String(newManifest.actualRemote) : '';

            if (newActual && !tried.includes(newActual) && Array.isArray(newManifest.files)) {
              const wantPath = file && file.path ? String(file.path) : '';
              const wantName = file && file.name ? String(file.name) : '';
              const match = newManifest.files.find(f => {
                if (!f) return false;
                if (wantPath && f.path && String(f.path) === wantPath) return true;
                if (wantName && f.name && String(f.name) === wantName) return true;
                return false;
              });

              if (match && match.url) {
                download.actualRemote = newActual;
                download.mirrorSwitches = (Number(download.mirrorSwitches) || 0) + 1;
                try {
                  if (!Array.isArray(download.triedMirrors)) download.triedMirrors = [];
                  download.triedMirrors.push(newActual);
                } catch (e) { }
                const retryFile = { ...file, url: String(match.url), __resume: true };
                logToFile(`[MirrorFailover] retrying on new mirror actualRemote=${newActual} file=${wantName}`);

                // Remove this file from failedFiles since we're retrying it.
                try {
                  if (Array.isArray(download.failedFiles)) {
                    download.failedFiles = download.failedFiles.filter(n => String(n) !== String(file.name));
                  }
                } catch (e) { }

                // Reset status so the UI doesn't stay in an error state if retry succeeds.
                download.status = 'downloading';
                download.error = '';
                updateProgress(downloadId);

                // Retry once with the new URL.
                canTryMirrorFailoverRetryStarted = true;
                // done() (not .then(resolve)/.catch(reject)) so THIS call's
                // already-held global slot gets released -- the nested
                // downloadFile() retry acquires and releases its own slot
                // independently, so leaving this one unresolved-via-done()
                // leaked one global slot per successful retry here too.
                downloadFile(downloadId, retryFile, downloadDir)
                  .then(() => { done(); })
                  .catch((e) => { done(e); })
                  .finally(() => { try { download.recovering = false; } catch (e) { } });
                return;
              }
            }
          }
        } catch (e) {
          try {
            logToFile(`[MirrorFailover] failed to refetch manifest/retry: ${e && e.message ? e.message : String(e)}`);
          } catch (e2) { }
        } finally {
          // Only clear here if we didn't kick off the async retry above (that path
          // clears it itself once downloadFile settles).
          if (!canTryMirrorFailoverRetryStarted) {
            try { download.recovering = false; } catch (e) { }
          }
        }

        // The user's own connection dropped mid-file: wait for it to come back
        // and retry with a fresh link instead of failing (Sentry COMPANION-6/-3).
        if (dnsError && !tokenExpired) {
          try {
            const recovered = await refetchManifestAndRetryExpiredLink(downloadId, download, file, downloadDir, 'network');
            if (recovered) {
              done();
              return;
            }
          } catch (e) { }
        }

        // If this is a signed link expiry, attempt a manifest refetch + retry before surfacing an error.
        if (tokenExpired) {
          try {
            const recovered = await refetchManifestAndRetryExpiredLink(downloadId, download, file, downloadDir);
            if (recovered) {
              // done() so THIS call's already-held global slot is released --
              // refetchManifestAndRetryExpiredLink's own nested downloadFile()
              // call acquires and releases its own slot independently.
              done();
              return;
            }
          } catch (e) {
            // ignore and fall through to user-visible error
          }
        }

        try {
          const trimmed = String(errorOutput || '').trim();
          const tail = trimmed.length > 12000 ? trimmed.slice(-12000) : trimmed;
          const redacted = redactUrlQueryStrings(tail);
          logToFile(`[rclone] copyurl failed code=${code} file=${file && file.name ? String(file.name) : ''} outputPath=${outputPath} stderr=${redacted}`);
          try { if (directEndpoint.isDirectUrl(file.url)) { directEndpoint.noteFailure(); logToFile('[Direct] failed; the retry will use the managed link'); } } catch (e3) { }
        } catch (e) {
          try {
            logToFile(`[rclone] copyurl failed code=${code} file=${file && file.name ? String(file.name) : ''} (failed to log stderr)`);
          } catch (e2) { }
        }

        if (busy) {
          download.error = mainState.withSupportFooter(
            'Server is busy due to high demand.',
            'Wait a minute and retry. If it keeps happening, lower concurrency.'
          );
        } else if (is502) {
          const hostPart = fileUrlHost ? ` (host: ${fileUrlHost})` : '';
          download.error = mainState.withSupportFooter(
            `Download gateway error (HTTP 502 Bad Gateway)${hostPart}.`,
            'Retry. If it keeps failing, this is likely a backend/upstream issue.'
          );
        } else if (quota) {
          download.error = mainState.withSupportFooter(
            'Download quota exceeded. This file is temporarily unavailable due to high demand.',
            'Wait a few hours and retry, or try a different title/mirror if available.'
          );
        } else if (tokenExpired) {
          download.error = mainState.withSupportFooter(
            'Download link expired.',
            'Go back to the website and start the download again to generate a fresh link.'
          );
        } else if (sslError && mainState.CLOCK_CERT_RE.test(errorOutput)) {
          download.error = clockCertMessage();
        } else if (sslError) {
          download.error = mainState.withSupportFooter(
            'SSL/Certificate error.',
            'On Linux, install/update ca-certificates, then retry.'
          );
        } else if (dnsError) {
          download.error = mainState.withSupportFooter(
            'Network/DNS error.',
            'Check your internet connection, DNS/VPN settings, then retry.'
          );
        } else {
          download.error = formatDownloadFailedMessage(code, errorOutput);
        }

        updateProgress(downloadId);
        try { reportDownloadFailure(download, download.error); } catch (e3) { }
        if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error });
        try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
        let shouldShowNotification = true;
        if (quota) {
          if (download.quotaNotified) {
            shouldShowNotification = false;
          } else {
            download.quotaNotified = true;
          }
        }
        if (shouldShowNotification) {
          if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
        }
        done(new Error(download.error));
      }
    });

    proc.on('error', (err) => {
      download.status = 'error';
      download.error = err.message;
      try {
        const idx = download.activeProcesses.indexOf(proc);
        if (idx !== -1) download.activeProcesses.splice(idx, 1);
      } catch (e) { }
      try {
        if (download.activeFiles && download.activeFiles[fileKey]) {
          download.activeFiles[fileKey].status = 'error';
          delete download.activeFiles[fileKey];
        }
      } catch (e) { }
      try {
        logToFile(`[rclone] spawn error: ${err && err.message ? err.message : String(err)}`);
      } catch (e) { }
      try { reportDownloadFailure(download, download.error); } catch (e3) { }
      if (!isDownloadAbandoned(download)) sendToMain('download-error', { id: downloadId, error: download.error });
      try { scheduleAutoRetry(downloadId, download); } catch (eAr) { }
      if (!isDownloadAbandoned(download)) showDownloadNotification('Download failed', `${download.name || 'Download'}: ${download.error}`);
      done(err);
    });
    })().catch((e) => {
      reject(e);
    });
  });
}

module.exports = { downloadFile };
