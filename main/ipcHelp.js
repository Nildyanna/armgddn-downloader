'use strict';
// Help and checks: What's New, disk space, the setup check and report, game updates, the connection test, sending a log, message boxes (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const directEndpoint = require('../directEndpoint');
const { probeRanges } = require('../segmentedDownload');
const { supportDiagnostics } = require('./comics');
const { getDialogParentWindow, withDialogFocus } = require('./dialogs');
const { getFreeDiskSpace } = require('./files');
const { logToFile, getDebugLogPath } = require('./log');
const { loadSession } = require('./session');
const { postJsonWithBearer, getJsonWithBearer } = require('./siteApi');
const { getWhatsNewForVersion } = require('./updates');
const { formatBytes } = require('./util');
const { ipcMain, app, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const problemReport = require('../downloadProblemReport');
const { pathToFileURL } = require('url');

function register() {
ipcMain.handle('get-app-load', async (event, token, manifestUrl) => {
  return ctx.getAppLoadInfo(token, manifestUrl);
});

// Manual trigger for the What's New content (e.g. a future Help-menu entry) —
// distinct from the automatic show-whats-new push, which only fires once per
// version bump. Always returns the current version's entry (or null), regardless
// of whether it was already shown this run.
ipcMain.handle('get-whats-new', () => getWhatsNewForVersion(app.getVersion()));

// The native window's one-time "What's New" after an update (the classic window gets it pushed when it loads).
ipcMain.handle('native-pending-whats-new', () => { const e = ctx.pendingWhatsNewEntryNative; ctx.pendingWhatsNewEntryNative = null; return e || null; });

// Check free disk space at (or above) a given path, for Settings/list UI readouts.
ipcMain.handle('check-disk-space', async (event, targetPath) => {
  const p = (typeof targetPath === 'string' && targetPath.trim()) ? targetPath : ctx.settings.downloadPath;
  const freeBytes = getFreeDiskSpace(p);
  return {
    freeBytes,
    freeFormatted: freeBytes >= 0 ? formatBytes(freeBytes) : null
  };
});

// "Check my setup" (Settings): disk space, folder location, antivirus and redistributables, as plain findings.
ipcMain.handle('run-setup-check', async () => {
  try {
    const setupCheck = require('../setupCheck');
    const facts = await setupCheck.collectFacts({ downloadPath: ctx.settings.downloadPath, comicsFolder: ctx.settings.comicsFolder, getFreeDiskSpace });
    return { ok: true, findings: setupCheck.evaluateSetup(facts) };
  } catch (e) {
    logToFile(`[setup-check] failed: ${e.message}`);
    return { ok: false, findings: [] };
  }
});

// "Copy report for Tulip": the setup check results and recent log problems as one pasteable code, personal details removed.
ipcMain.handle('build-setup-report', async () => {
  try {
    const setupCheck = require('../setupCheck');
    const setupReport = require('../setupReport');
    const facts = await setupCheck.collectFacts({ downloadPath: ctx.settings.downloadPath, comicsFolder: ctx.settings.comicsFolder, getFreeDiskSpace });
    const findings = setupCheck.evaluateSetup(facts);
    let logText = '';
    try {
      const logPath = getDebugLogPath();
      const size = fs.statSync(logPath).size;
      const fd = fs.openSync(logPath, 'r');
      const len = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      logText = buf.toString('utf8');
    } catch (e) { /* no log yet */ }
    const code = setupReport.buildReport({
      appVersion: app.getVersion(), platform: process.platform, release: os.release(), arch: process.arch, findings, facts, logText,
    });
    return { ok: true, code };
  } catch (e) {
    logToFile(`[setup-report] failed: ${e.message}`);
    return { ok: false, code: '' };
  }
});

// "Check for updates": the folder names of the games in the download history go to the site, which answers the ones that have a newer
// version in the library (Steam build number, or a dotted version for other games). Nothing else is sent.
ipcMain.handle('check-game-updates', async () => {
  try {
    const token = ctx.sessionToken || loadSession();
    if (!token) return { ok: false, error: 'Sign in to the app first, then try again.' };
    const names = [...new Set((Array.isArray(ctx.downloadHistory) ? ctx.downloadHistory : []).filter((h) => h && h.status === 'completed' && h.name).map((h) => String(h.name)))].slice(0, 300);
    if (!names.length) return { ok: true, updates: [], checked: 0 };
    const res = await postJsonWithBearer('https://www.armgddnbrowser.com/api/library-updates', { names }, token);
    if (res.statusCode === 429) return { ok: false, error: 'Please wait a minute and try again.' };
    if (res.statusCode === 401) return { ok: false, error: 'Sign in to the app again, then try again.' };
    if (res.statusCode !== 200 || !res.json || !Array.isArray(res.json.updates)) return { ok: false, error: 'The site could not check right now. Try again in a few minutes.' };
    logToFile(`[updates] ${names.length} downloaded game(s) checked, ${res.json.updates.length} with a newer version`);
    return { ok: true, updates: res.json.updates, checked: names.length };
  } catch (e) {
    logToFile(`[updates] failed: ${e.message}`);
    return { ok: false, error: 'Could not check for updates. Check your connection and try again.' };
  }
});

ipcMain.handle('run-connection-test', async (event) => {
  if (ctx.connectionTestRunning) return { ok: false, error: 'A test is already running.' };
  ctx.connectionTestRunning = true;
  try {
    const token = ctx.sessionToken || loadSession();
    if (!token) return { ok: false, error: 'Sign in to the app first, then try again.' };
    const { runTest } = require('../connectionTest');
    const tlsOpts = directEndpoint.tlsOptions();
    const getTarget = async () => {
      const r = await getJsonWithBearer('https://www.armgddnbrowser.com/api/connection-test', token);
      if (r.statusCode === 429) throw new Error('Please wait a few minutes before testing again.');
      if (r.statusCode === 401) throw new Error('Sign in to the app again, then try again.');
      if (!r.json || !Array.isArray(r.json.candidates) || !r.json.candidates.length) throw new Error((r.json && r.json.error) || 'No test file is available right now.');
      for (const c of r.json.candidates) {
        const url = directEndpoint.rewrite(c);
        const probe = await probeRanges(url, {}, 8000, tlsOpts);
        if (probe.ok && probe.total > 64 * 1024 * 1024) return { url, total: probe.total };
      }
      throw new Error('The download server did not answer the test. Try again in a few minutes.');
    };
    const out = await runTest({
      getTarget, tls: tlsOpts, phaseMs: 12000,
      onProgress: (p) => { try { event.sender.send('connection-test-progress', p); } catch (e) { } },
    });
    ctx.lastConnectionTest = { at: Date.now(), results: out.results, recommendation: out.recommendation };
    logToFile(`[connection-test] ${out.results.map((r) => `${r.streams}x: ${r.mbps} MB/s, ${r.stalls} stalls, ${r.errors} errors`).join(' | ')} => ${out.recommendation.value || 'auto'}`);
    return { ok: true, ...out };
  } catch (e) {
    logToFile(`[connection-test] failed: ${e.message}`);
    return { ok: false, error: e.message || 'The test could not run.' };
  } finally {
    ctx.connectionTestRunning = false;
  }
});

// "Send log to staff": the debug log with personal details removed goes to the ARMGDDN site, which answers a short code
// (LOG-ABCD-2345). The member pastes the code in the support chat and Tulip reads the log from it.
ipcMain.handle('send-support-log', async () => {
  try {
    const token = ctx.sessionToken || loadSession();                // may be empty or expired: the site takes a cleaned log either way
    const logPath = getDebugLogPath();
    let size;
    try { size = fs.statSync(logPath).size; } catch (e) { return { ok: false, error: 'There is no log yet. Use the app for a bit and try again.' }; }
    const len = Math.min(size, 1536 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(logPath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const log = supportDiagnostics() + require('../setupReport').cleanLog(buf.toString('utf8'));
    logToFile(`[support-log] sending ${Math.round(log.length / 1024)} KB, ${token ? 'with a saved sign-in' : 'without a sign-in'}`);
    const res = await postJsonWithBearer('https://www.armgddnbrowser.com/api/support-log',
      { log, app: app.getVersion(), os: `${process.platform} ${os.release()} ${process.arch}` }, token);
    if (res.statusCode === 429) return { ok: false, error: 'You have already sent several logs today. Use the last code, or try again tomorrow.' };
    if (res.statusCode !== 200 || !res.json || !res.json.code) {
      logToFile(`[support-log] failed: HTTP ${res.statusCode}`);
      return { ok: false, error: `The site could not take the log right now (error ${res.statusCode || 'no answer'}). Try again in a minute.` };
    }
    logToFile(`[support-log] sent, code ${res.json.code}`);
    return { ok: true, code: res.json.code };
  } catch (e) {
    logToFile(`[support-log] failed: ${e.message}`);
    return { ok: false, error: 'Could not send the log. Check your connection and try again.' };
  }
});

// "Send this problem to staff" (a failed download's card): preview shows exactly what would be sent; send posts it to the site, which tells staff.
// One report per download and at most 5 a day, remembered in problem-reports.json (the site checks the same limits).
const problemStatePath = () => path.join(app.getPath('userData'), 'problem-reports.json');
const readProblemState = () => { try { return problemReport.normalizeState(JSON.parse(fs.readFileSync(problemStatePath(), 'utf8'))); } catch (e) { return problemReport.normalizeState(null); } };
const writeProblemState = (s) => { try { fs.writeFileSync(problemStatePath(), JSON.stringify(s)); } catch (e) { logToFile(`[problem-report] could not save the sent list: ${e.message}`); } };
const readLogTail = (maxBytes) => {
  try {
    const logPath = getDebugLogPath();
    const size = fs.statSync(logPath).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(logPath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    return buf.toString('utf8');
  } catch (e) { return ''; }
};
const problemPayload = (downloadId, note) => {
  const d = ctx.activeDownloads && ctx.activeDownloads.get(downloadId);
  if (!d) return null;
  return problemReport.buildPayload({ download: d, appVersion: app.getVersion(), os: `${process.platform} ${os.release()} ${process.arch}`, logText: readLogTail(2 * 1024 * 1024), note });
};
let problemSending = false;

ipcMain.handle('download-problem-sent', async () => problemReport.sentMap(readProblemState()));

ipcMain.handle('preview-download-problem', async (event, downloadId) => {
  const check = problemReport.canSend(readProblemState(), downloadId);
  const payload = problemPayload(String(downloadId || ''), '');
  if (!payload) return { ok: false, error: 'This download could not be found. Retry it once, and send the problem if it fails again.' };
  return { ok: true, payload, canSend: check.ok, reason: check.reason || '', reportId: check.reportId || 0, error: check.ok ? '' : check.error };
});

ipcMain.handle('send-download-problem', async (event, downloadId, note) => {
  if (problemSending) return { ok: false, error: 'A report is already being sent.' };
  problemSending = true;
  try {
    const id = String(downloadId || '');
    const check = problemReport.canSend(readProblemState(), id);
    if (!check.ok) return { ok: false, error: check.error, reportId: check.reportId || 0 };
    const token = ctx.sessionToken || loadSession();
    if (!token) return { ok: false, error: 'Sign in to the app first, then try again.' };
    const payload = problemPayload(id, typeof note === 'string' ? note : '');
    if (!payload) return { ok: false, error: 'This download could not be found.' };
    const res = await postJsonWithBearer('https://www.armgddnbrowser.com/api/support/download-report', payload, token);
    const reportId = res.json && Number(res.json.id);
    if (res.statusCode === 409 && reportId) { writeProblemState(problemReport.recordSent(readProblemState(), id, reportId)); return { ok: true, reportId }; }
    if (res.statusCode === 429) return { ok: false, error: (res.json && res.json.error) || 'You have sent several problems today. Try again tomorrow.' };
    if (res.statusCode === 401) return { ok: false, error: 'Sign in to the app again, then try again.' };
    if (res.statusCode !== 200 || !reportId) {
      logToFile(`[problem-report] failed: HTTP ${res.statusCode}`);
      return { ok: false, error: `The site could not take the report right now (error ${res.statusCode || 'no answer'}). Try again in a minute.` };
    }
    writeProblemState(problemReport.recordSent(readProblemState(), id, reportId));
    logToFile(`[problem-report] sent report #${reportId} for download ${id} (${payload.log.length} log lines)`);
    return { ok: true, reportId };
  } catch (e) {
    logToFile(`[problem-report] failed: ${e.message}`);
    return { ok: false, error: 'Could not send the report. Check your connection and try again.' };
  } finally {
    problemSending = false;
  }
});

// Show native message box (Yes/No)
ipcMain.handle('show-message-box', async (event, options) => {
  let parent = getDialogParentWindow();
  // While the native window is the one on screen, the classic window is hidden: a box owned by it appeared behind everything (the update prompt of the
  // hourly check, Nov 20) and, being synchronous, stopped the main process answering the native window until someone found and closed it. The box now
  // belongs to the window in use and does not block anything.
  try { if (ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed() && !ctx.progressWin) parent = ctx.nativeWindow; } catch (e) { }
  if (!parent || parent.isDestroyed()) return 0;
  // Allowlist options to prevent a compromised renderer from spoofing arbitrary dialogs
  const safeOptions = {
    type: ['none','info','error','question','warning'].includes(options && options.type) ? options.type : 'question',
    message: String((options && options.message) || ''),
    detail: options && options.detail != null ? String(options.detail) : undefined,
    buttons: Array.isArray(options && options.buttons) ? options.buttons.map(String) : undefined,
    defaultId: options && options.defaultId != null ? Number(options.defaultId) : undefined,
    cancelId: options && options.cancelId != null ? Number(options.cancelId) : undefined,
  };
  const r = await withDialogFocus(() => dialog.showMessageBox(parent, safeOptions));
  return r && Number.isInteger(r.response) ? r.response : 0;
});

// Get 7z help video file URL for renderer
ipcMain.handle('get-help-7z-video-src', () => {
  try {
    const filePath = ctx.getHelp7zVideoFilePath();
    const fileUrl = pathToFileURL(filePath).toString();
    logToFile('[7z-video] resolved help video URL: ' + fileUrl);
    return fileUrl;
  } catch (e) {
    logToFile('[7z-video] failed to resolve help video URL: ' + e.message);
    throw e;
  }
});
}

module.exports = { register };
