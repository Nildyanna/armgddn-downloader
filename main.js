const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const secureStore = require('./secureStore');   // safeStorage, with the asynchronous methods Electron 46 needs (see secureStore.js)
const path = require('path');
const fs = require('fs');
const os = require('os');
// ---- split-out modules (docs/MAIN_SPLIT.md) ----
const { catalogTokens, supportDiagnostics } = require('./main/comics');
const { armNoGpuProcess, setGpuFallbackTag, openAuthWindow, verifySession, createWindow, createTray, createAppMenu, openSettingsWindow, showAboutDialog } = require('./main/appWindows');
const { downloadFile } = require('./main/downloader');
const { anyDownloadRunning, scheduleAutoRetry, retryFailedDownload, pauseDownloadById, resumeDownloadFiles } = require('./main/downloadControl');
const { showDownloadNotification, formatDownloadFailedMessage, countRecentCompletedDownloads, buildDownloadBlockedMessage, cleanupCancelledDownloadFiles, finalizeCompletedDownload, completeDownload } = require('./main/completion');
const { isNetworkDownError, fetchManifestRidingOutNetwork, fetchManifestWithAvoidMirror, fetchManifestInternal, refetchManifestAndRetryExpiredLink } = require('./main/manifest');
const { reportFileProgressToServer, reportProgressToServer, sendServerNotice, maybeClearServerNotice, updateProgressBackoffFromResponse, clampProgressUnlessFinal, parseRcloneProgress, updateProgress } = require('./main/progress');
const { preStartInstallSpaceWarning, installSpaceTip } = require('./main/installSpace');
const { resolve7zTool, extractTarget, run7zExtract } = require('./main/extract');
const { isExpectedDownloadFailure, reportDownloadFailure, isDownloadAbandoned, clockCertMessage, noteRecovery } = require('./main/failures');
const { getJsonWithBearer, postJsonWithBearer, isAllowedServiceHost, fetchJsonWithCookies, mintAppSessionTokenFromCookies } = require('./main/siteApi');
const { getDialogParentWindow, withDialogFocus, withDialogFocusSync, showAppWindow, sendToMain, mainWindowAlive } = require('./main/dialogs');
const { persistInflight, dropInflight, loadOrphanedDownloads, endOrphanedGrant, resumeRestoredDownload } = require('./main/restore');
const { pushScheduleState, scheduleTick, startScheduleTicker } = require('./main/quietHours');
const { flushPendingDeepLinks, validateDeepLink, handleDeepLink } = require('./main/deepLinks');
const { promptKomgaSettings, komgaAddFromCatalog, komgaMessage, addReadListToKomga, confirmKomgaDeepLink } = require('./main/komgaActions');
const { hashingGated, maybeShowHashGateNotice, reportEngineToServer, reportHashUnavailableToServer, reportHashProgressToServer, reportHashCheckToServer, runHashCheck } = require('./main/hashing');
const { getUpdateEd25519PublicKeyPem, isAllowedUpdateHost, checkForUpdatesFromMenu, getWhatsNewForVersion, fetchLatestReleaseInfo, pollForUpdateOnce, startUpdatePoller, installScreen, macTooOldForRelease } = require('./main/updates');
const { refreshDownloadConcurrency, getDownloadRunningCount, incDownloadRunning, decDownloadRunning, pickNextAdaptiveTask, schedulerPump, enqueueAdaptiveTask, getGlobalPoolLimit, refreshGlobalPoolLimit, acquireGlobalPoolSlot } = require('./main/scheduler');
const { pruneMirrorCooldowns, markMirrorCooldown, clearMirrorCooldown, getActiveMirrorAvoidList } = require('./main/mirrors');
const { loadHistory, saveHistory } = require('./main/history');
const { loadSession, savedSessionToken, saveSession, clearSession } = require('./main/session');
const { applyStartupRegistration, normalizeSettings, loadSettings, saveSettings } = require('./main/settings');
const { clearLoginTraces } = require('./main/auth');
const { loadKomgaConfig, saveKomgaConfig, forgetKomgaKey } = require('./main/komgaConfig');
const { ensureLinuxProtocolDesktopHandler } = require('./main/platform');
const { getDebugLogPath, logToFile, debugLog, rotateLogIfNeeded } = require('./main/log');
const { denyNewWindows } = require('./main/windows');
const { getActiveFileCount, isStarfieldAutoExtractTargetValue, normalizeDownloadItemKey, reportDirectGrantEnd, downloadToRenderer, waitForChildClose, waitForDownloadTasksToFinish, pruneActiveProcesses, peakOrAverageSpeedBytes, scheduleActiveStates, isStarfieldAutoExtractTargetManifest, getDownloadItemKey, getHistoryItemKey, stopDownloadProcesses, shouldFinalizeDownload } = require('./main/downloadState');
const { decodeBase64Signature, verifyEd25519Signature, isAutostartLaunch, safeUpdateResult } = require('./main/updateCheck');
const { waitForNetwork, fetchJsonWithBearer, isValidToken, isValidDownloadId, attemptResolveDownloadToken, getActiveFileKey, isProxyDownloadUrl, transformProxyUrlToDirectIfPossible, resolveDownloadRedirectUrl } = require('./main/net');
const { getTaskRemainingBytes, defaultDownloadsBase, cleanupAppImageBackup, writeSessionFile, komgaConfigPath, installedProfileDir, getAppIcon, isSafeLibraryFolder, comicsCacheFile, isFileCompleteOnDisk, buildInstallSpaceWarning, commonOpenDir, loadComicsCache, saveComicsCache, getFreeDiskSpace } = require('./main/files');
const { snip7z, describe7zTool, find7zArchivesInDir, ensureRunnable7z, probe7z } = require('./main/sevenZip');
const { scrubForSentry, normalizeFailureLine, isNetworkStreamError, extractRcloneErrorDetail, formatRcloneExitCodeHint, isPinnedDownloadStatusMessage, notInChannelMessage, isQuotaError, isServerBusyError, isLikelySignedExpiringUrl, isRcloneCrashOutput, isTokenExpiredError } = require('./main/errors');
const { normalizeMirrorKey, sanitizeRelativePath, resolveInside, escapePowerShellSingleQuoted, quoteDesktopExecArg, redactUrlQueryStrings, isPathInside, normalizeFileSize, formatBytes, clampInt, parseRcloneHttpStatus, parseSpeedToBytes, formatSpeed, formatEtaSeconds, compareVersions } = require('./main/util');
// Shared state for the main/ modules (main/context.js): live getters and setters onto main.js's own variables.
require('./main/context').provide({
  get __dirname() { return __dirname; },
  get ALLOWED_SERVICE_HOSTS() { return ALLOWED_SERVICE_HOSTS; },
  get ALLOWED_UPDATE_HOSTS() { return ALLOWED_UPDATE_HOSTS; },
  get AUTO_RETRY_BLOCK_RE() { return AUTO_RETRY_BLOCK_RE; },
  get AUTO_RETRY_MAX() { return AUTO_RETRY_MAX; },
  get AUTO_RETRY_TRANSIENT_RE() { return AUTO_RETRY_TRANSIENT_RE; },
  get CLOCK_CERT_RE() { return CLOCK_CERT_RE; },
  get COMPLETION_WINDOW_MS() { return COMPLETION_WINDOW_MS; },
  get EXPECTED_FAILURE_RE() { return EXPECTED_FAILURE_RE; },
  get GPU_HARD_MARKER() { return GPU_HARD_MARKER; },
  get KOMGA_LISTS() { return KOMGA_LISTS; },
  get MAC_MIN_DARWIN_FROM_VERSION() { return MAC_MIN_DARWIN_FROM_VERSION; },
  get MAC_MIN_DARWIN_MAJOR() { return MAC_MIN_DARWIN_MAJOR; },
  get MIRROR_COOLDOWN_MS() { return MIRROR_COOLDOWN_MS; },
  get MIRROR_EARLY_STALL_MS() { return MIRROR_EARLY_STALL_MS; },
  get NATIVE_PREVIEW() { return NATIVE_PREVIEW; },
  get NETWORK_DOWN_CODES() { return NETWORK_DOWN_CODES; },
  get POOL_ID() { return POOL_ID; },
  get SENTRY_DSN() { return SENTRY_DSN; },
  get SMOKE_TEST() { return SMOKE_TEST; },
  get STALL_SAME_MIRROR_RETRIES() { return STALL_SAME_MIRROR_RETRIES; },
  get UI_UPDATE_INTERVAL() { return UI_UPDATE_INTERVAL; },
  get UPDATE_ED25519_PUBLIC_KEY_PINNED() { return UPDATE_ED25519_PUBLIC_KEY_PINNED; },
  get UPDATE_POLL_MS() { return UPDATE_POLL_MS; },
  get _closeConfirmed() { return _closeConfirmed; }, set _closeConfirmed(v) { _closeConfirmed = v; },
  get _installUpdateInProgress() { return _installUpdateInProgress; }, set _installUpdateInProgress(v) { _installUpdateInProgress = v; },
  get _resolved7z() { return _resolved7z; }, set _resolved7z(v) { _resolved7z = v; },
  get _resolved7zFailures() { return _resolved7zFailures; }, set _resolved7zFailures(v) { _resolved7zFailures = v; },
  get _updateAnnouncedVersion() { return _updateAnnouncedVersion; }, set _updateAnnouncedVersion(v) { _updateAnnouncedVersion = v; },
  get activeDownloads() { return activeDownloads; }, set activeDownloads(v) { activeDownloads = v; },
  get adaptiveScheduler() { return adaptiveScheduler; },
  get authWindow() { return authWindow; }, set authWindow(v) { authWindow = v; },
  comicsGet,
  get comicsState() { return comicsState; },
  get completeDownload() { return completeDownload; },
  get downloadFile() { return downloadFile; },
  get downloadHistory() { return downloadHistory; }, set downloadHistory(v) { downloadHistory = v; },
  get get7zPath() { return get7zPath; },
  getAppLoadInfo,
  get getConfigPath() { return getConfigPath; },
  get getDialogParentWindow() { return getDialogParentWindow; },
  get getEmptyRcloneConfigPath() { return getEmptyRcloneConfigPath; },
  get getHistoryPath() { return getHistoryPath; },
  get getRclonePath() { return getRclonePath; },
  get getSessionPath() { return getSessionPath; },
  get globalConcurrencyPool() { return globalConcurrencyPool; },
  get hashChecksRunning() { return hashChecksRunning; },
  get hashGateNoticeOpen() { return hashGateNoticeOpen; }, set hashGateNoticeOpen(v) { hashGateNoticeOpen = v; },
  get ignoreProxyEnv() { return ignoreProxyEnv; }, set ignoreProxyEnv(v) { ignoreProxyEnv = v; },
  get inflightFile() { return inflightFile; },
  get isAllowedServiceHost() { return isAllowedServiceHost; },
  isErrorReportingEnabled,
  get isOwnerDevToolsAllowed() { return isOwnerDevToolsAllowed; },
  get komgaBusy() { return komgaBusy; }, set komgaBusy(v) { komgaBusy = v; },
  get komgaPromptResolve() { return komgaPromptResolve; }, set komgaPromptResolve(v) { komgaPromptResolve = v; },
  get komgaPromptWin() { return komgaPromptWin; }, set komgaPromptWin(v) { komgaPromptWin = v; },
  get lastConnectionTest() { return lastConnectionTest; }, set lastConnectionTest(v) { lastConnectionTest = v; },
  get lastProgressReport() { return lastProgressReport; }, set lastProgressReport(v) { lastProgressReport = v; },
  get lastScheduleBanner() { return lastScheduleBanner; }, set lastScheduleBanner(v) { lastScheduleBanner = v; },
  get lastScheduleLimit() { return lastScheduleLimit; }, set lastScheduleLimit(v) { lastScheduleLimit = v; },
  get lastServerNoticeText() { return lastServerNoticeText; }, set lastServerNoticeText(v) { lastServerNoticeText = v; },
  get lastServerNoticeUntilMs() { return lastServerNoticeUntilMs; }, set lastServerNoticeUntilMs(v) { lastServerNoticeUntilMs = v; },
  get lastUIUpdate() { return lastUIUpdate; },
  get mainWindow() { return mainWindow; }, set mainWindow(v) { mainWindow = v; },
  get mainWindowAlive() { return mainWindowAlive; },
  get mainWindowDidFinishLoad() { return mainWindowDidFinishLoad; }, set mainWindowDidFinishLoad(v) { mainWindowDidFinishLoad = v; },
  get mirrorCooldowns() { return mirrorCooldowns; },
  get musicState() { return musicState; },
  get nativeWindow() { return nativeWindow; }, set nativeWindow(v) { nativeWindow = v; },
  get noGpuProcess() { return noGpuProcess; }, set noGpuProcess(v) { noGpuProcess = v; },
  get pauseDownloadById() { return pauseDownloadById; },
  get pendingDeepLinks() { return pendingDeepLinks; },
  get pendingWhatsNewEntry() { return pendingWhatsNewEntry; }, set pendingWhatsNewEntry(v) { pendingWhatsNewEntry = v; },
  get postJsonWithBearer() { return postJsonWithBearer; },
  get progressReportBackoffUntilMs() { return progressReportBackoffUntilMs; }, set progressReportBackoffUntilMs(v) { progressReportBackoffUntilMs = v; },
  get progressReportMinIntervalMs() { return progressReportMinIntervalMs; }, set progressReportMinIntervalMs(v) { progressReportMinIntervalMs = v; },
  get progressWin() { return progressWin; }, set progressWin(v) { progressWin = v; },
  get refreshGlobalPoolLimit() { return refreshGlobalPoolLimit; },
  get resumeDownloadFiles() { return resumeDownloadFiles; },
  get sendToMain() { return sendToMain; },
  get sessionToken() { return sessionToken; }, set sessionToken(v) { sessionToken = v; },
  get settings() { return settings; }, set settings(v) { settings = v; },
  get settingsLoadedFromDisk() { return settingsLoadedFromDisk; }, set settingsLoadedFromDisk(v) { settingsLoadedFromDisk = v; },
  get showDownloadNotification() { return showDownloadNotification; },
  get tray() { return tray; }, set tray(v) { tray = v; },
  get updateProgress() { return updateProgress; },
  get whatsNewContentCache() { return whatsNewContentCache; }, set whatsNewContentCache(v) { whatsNewContentCache = v; },
  get withDialogFocus() { return withDialogFocus; },
  withSupportFooter,
});
// Shared state for the main/ modules (main/context.js): live getters and setters onto main.js's own variables.
const pipeGuard = require('./pipeGuard');
pipeGuard.install(process);   // a closed stdout/stderr (started from a launcher that went away) made every console call fail with EPIPE in a loop

// ── Error reporting (Sentry) ────────────────────────────────────────────────
// Must initialise before anything else so main-process crashes are caught.
// Reports uncaught errors, native crashes, and failed downloads (see
// reportDownloadFailure). Every event is scrubbed before sending: URL query
// strings (signed download links and tokens) and the user's home folder path
// are removed; no IP or other personal data is collected.
const SENTRY_DSN = 'https://44845354581cd37f9f7c13cef235aae4@o4511461480398848.ingest.us.sentry.io/4512139991187456';
const Sentry = require('@sentry/electron/main');
// The user can turn reporting off in Settings (errorReporting). Checked right
// before anything is sent; if settings haven't loaded yet (an error very early
// in startup) the saved config is read directly, so an opted-out user's
// startup crash is never sent either.
function isErrorReportingEnabled() {
  if (process.env.ARMGDDN_SMOKE_TEST === '1') return false;
  try {
    if (typeof settings === 'object' && settings && settingsLoadedFromDisk) return settings.errorReporting !== false;
  } catch (e) { /* settings not initialised yet */ }
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
    return !saved || saved.errorReporting !== false;
  } catch (e) {
    return true; // no saved settings yet: default is on
  }
}
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `armgddn-companion@${app.getVersion()}`,
    environment: app.isPackaged ? 'production' : 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (!isErrorReportingEnabled()) return null;
      if (pipeGuard.isClosedOutputError(event)) return null;   // the launcher closed our output: harmless, not a fault
      try {
        if (event.user) delete event.user.ip_address;
        return scrubForSentry(event);
      } catch (e) {
        return null; // never risk sending an unscrubbed event
      }
    },
    beforeBreadcrumb(crumb) {
      try { return scrubForSentry(crumb); } catch (e) { return null; }
    },
  });
}

// Failed downloads are caught and shown in the app, so Sentry would never see
// them otherwise. Grouped by the first line of the error so each distinct
// failure type is one issue.
// Failures caused by a member's own connection, the mirror rate-limiting them,
// or an expired link are expected and already retried/explained in the app, so
// reporting them only spams Sentry alerts. Gateway errors (502-504), engine
// start failures and anything unrecognised are still reported. A download folder that
// can't be created (missing drive, no permission) is the member's setup and is explained
// in the app, so it isn't reported either.
// Windows ending the download process itself (PC shutting down or signing out, the app being closed): 3221225794 is
// 0xC0000142, 1073807364 is 0x40010004 and 3221225786 is 0xC000013A. They arrive together, for every running download at
// the same second, so they are the system closing things and not a fault (Sentry COMPANION-1N and 1P).
const EXPECTED_FAILURE_RE = /(rate-limiting|429 Too Many|link expired|stalled|could not be resumed|network\/dns|ssl\/certificate|500 Internal Server Error|Can't create the download folder|connection dropped mid-download|interfering with the secure connection|\(code (?:3221225794|1073807364|3221225786)\))/i;
// "certificate has expired" / "not yet valid" while our certificate is valid
// means the PC clock is wrong or security software is intercepting HTTPS
// (Sentry COMPANION-3/-C). Retrying can't fix either, so say what will.
const CLOCK_CERT_RE = /(certificate has expired|not yet valid|cert_date_invalid|certificate_expired|err_cert_date)/i;
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { resumeDownload, ResumeProc } = require('./resumeDownload');
const { segmentedDownload, probeRanges } = require('./segmentedDownload');
const scheduleLib = require('./schedule');
const directEndpoint = require('./directEndpoint');
const { pathToFileURL } = require('url');

// Security (L4): Public key is hardcoded as a constant to prevent tampering via the
// on-disk PEM file (which could be replaced if the asar is modified or the assets
// directory is writable). The env-var override is kept for development/rotation only.
const UPDATE_ED25519_PUBLIC_KEY_PINNED = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGn4Wwasnb73HzzQLzGXZt+QsfhTPnzLm6m37wAAF8RA=
-----END PUBLIC KEY-----`;

const SUPPORT_TELEGRAM_URL = 'https://t.me/+xuCOd3HqpGdmZjFh';

function withSupportFooter(message, fix) {
  try {
    const msg = String(message || '').trim();
    const fixText = String(fix || '').trim();
    const fixLine = fixText ? `Most likely fix: ${fixText}` : '';
    const supportLine = `If that doesn't help, contact support on Telegram: ${SUPPORT_TELEGRAM_URL}`;
    return [msg, fixLine, supportLine].filter(Boolean).join('\n');
  } catch (e) {
    return String(message || '');
  }
}

// Set app name for dialogs and window titles
app.name = 'ARMGDDN Companion';

if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  try {
    app.setAppUserModelId('com.armgddn.downloader');
  } catch (e) { }
}

// Fetch manifest but request a different mirror when the remote is a mirror group.
// Errors that mean the user's own connection is down (not a server/mirror
// problem): retrying immediately just fails again in the same second.
const NETWORK_DOWN_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);
const MIRROR_COOLDOWN_MS = 20 * 60 * 1000;
const MIRROR_EARLY_STALL_MS = 45 * 1000;
const STALL_SAME_MIRROR_RETRIES = 3;
const mirrorCooldowns = new Map();

// Handle deep links
let protocolClientRegistered = false;
let protocolClientRegisterError = '';
// The native preview (--native), and any unpackaged copy run with a profile of its own (--user-data-dir, as every test copy is), must never take
// over armgddn:// links from the installed Companion. A native window opened by the site's gate inside the installed app keeps them.
const isolatedDevRun = !app.isPackaged && process.argv.some((a) => String(a).startsWith('--user-data-dir'));
if (process.argv.includes('--native') || isolatedDevRun) {
  protocolClientRegisterError = 'skipped (native preview)';
} else if (process.defaultApp) {
  if (process.argv.length >= 2) {
    try {
      protocolClientRegistered = app.setAsDefaultProtocolClient('armgddn', process.execPath, [path.resolve(process.argv[1])]);
    } catch (e) {
      protocolClientRegistered = false;
      protocolClientRegisterError = e && e.message ? e.message : String(e);
    }
  }
} else {
  try {
    protocolClientRegistered = app.setAsDefaultProtocolClient('armgddn');
  } catch (e) {
    protocolClientRegistered = false;
    protocolClientRegisterError = e && e.message ? e.message : String(e);
  }
}

// Native browser preview (staging only): `--native` opens the new browse window next to the normal one. Nothing happens without the flag.
const nativeGate = require('./nativeGate');
const shortcutNames = require('./shortcutNames');
// Which window this launch opens: always the native window (version 6.0.0: every member uses it and it cannot be turned off). Only the developer
// flag --classic opens the old window (see nativeGate.js).
const NATIVE_PREVIEW = nativeGate.wantsNative({ argv: process.argv });
let nativeWindow = null;   // the native preview window, once it is open
// Bring up the app's window: the native window when the app is running in native mode, otherwise the classic one. (The tray and a second launch used
// to show the hidden classic window even in native mode, so a member who opened the Companion again saw the old window.)
let _closeConfirmed = false;   // the native window already asked about running downloads before the app quits
if (NATIVE_PREVIEW) { try { require('./native/bridge').registerSchemes(require('electron').protocol); } catch (e) { } }

// CI smoke test (ARMGDDN_SMOKE_TEST=1): run against a throwaway profile so it
// never reads or writes real settings, and never reports to Sentry.
const SMOKE_TEST = process.env.ARMGDDN_SMOKE_TEST === '1';
if (SMOKE_TEST) {
  try { app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'armgddn-smoke-'))); } catch (e) { }
}

// GPU fallback. On some PCs (broken/old graphics drivers, remote desktop, VMs)
// Chromium's GPU process keeps dying and Chromium then kills the whole app
// ("GPU process isn't usable. Goodbye." — EXCEPTION_BREAKPOINT in Sentry).
// When the GPU process dies abnormally we leave a marker, and every later
// launch runs with hardware acceleration off. A download manager's UI renders
// fine in software, so there's no reason to keep crashing.
const GPU_FALLBACK_MARKER = (() => {
  try { return path.join(app.getPath('userData'), 'gpu-disabled'); } catch (e) { return null; }
})();
try {
  if (GPU_FALLBACK_MARKER && fs.existsSync(GPU_FALLBACK_MARKER)) {
    // One crash used to switch the graphics card off for good, and software drawing made the whole app very slow (Nov 20: a GPU process crash during a
    // memory shortage on the PC, and every later launch ran on the processor). The marker now lasts 24 hours; after that the next start tries the
    // graphics card again, and a new crash writes a new marker.
    let fresh = true;
    try { fresh = Date.now() - fs.statSync(GPU_FALLBACK_MARKER).mtimeMs < 24 * 3600 * 1000; } catch (e2) { }
    if (fresh) {
      app.disableHardwareAcceleration();
      console.log('[gpu] hardware acceleration disabled (earlier GPU process failure)');
    } else {
      try { fs.unlinkSync(GPU_FALLBACK_MARKER); console.log('[gpu] the software-rendering marker was older than 24 hours: trying the graphics card again'); } catch (e2) { }
    }
  }
} catch (e) { }
// Second step. Software drawing still starts a GPU process (for its software renderer), and on some PCs that one dies too, so Chromium
// still ends the app with "GPU process isn't usable" (Sentry ARMGDDN-COMPANION-2Q: 21 of 25 crashes by Nov 24 had gpu_fallback=on).
// When the GPU process fails while software drawing is already on, the next launches run with no GPU process at all
// (--disable-gpu + --disable-software-rasterizer: Chromium draws in the main process; only WebGL is lost, which the app never uses).
// This marker lasts 7 days, then the app goes back to the first step.
const GPU_HARD_MARKER = (() => {
  try { return path.join(app.getPath('userData'), 'gpu-disabled-hard'); } catch (e) { return null; }
})();
const softwareDrawingOn = (() => {
  try { return !!GPU_FALLBACK_MARKER && fs.existsSync(GPU_FALLBACK_MARKER); } catch (e) { return false; }
})();
let noGpuProcess = false;
try {
  if (GPU_HARD_MARKER && fs.existsSync(GPU_HARD_MARKER)) {
    let fresh = true;
    try { fresh = Date.now() - fs.statSync(GPU_HARD_MARKER).mtimeMs < 7 * 24 * 3600 * 1000; } catch (e2) { }
    if (fresh) {
      try { app.disableHardwareAcceleration(); } catch (e2) { }
      app.commandLine.appendSwitch('disable-gpu');
      app.commandLine.appendSwitch('disable-software-rasterizer');
      noGpuProcess = true;
      console.log('[gpu] no GPU process (it failed even with software drawing)');
    } else {
      try { fs.unlinkSync(GPU_HARD_MARKER); } catch (e2) { }
    }
  }
} catch (e) { }
try { setGpuFallbackTag(noGpuProcess ? 'hard' : (softwareDrawingOn ? 'on' : 'off')); } catch (e) { }
app.on('child-process-gone', (event, details) => {
  try {
    if (!details || details.type !== 'GPU') return;
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    if (softwareDrawingOn) {
      if (armNoGpuProcess(details.reason + ' ' + details.exitCode)) setGpuFallbackTag('hard-armed');
      return;
    }
    if (GPU_FALLBACK_MARKER && !fs.existsSync(GPU_FALLBACK_MARKER)) {
      fs.writeFileSync(GPU_FALLBACK_MARKER, `${new Date().toISOString()} ${details.reason} ${details.exitCode}\n`);
      console.warn('[gpu] GPU process gone (' + details.reason + '); software rendering from next launch');
      setGpuFallbackTag('armed');
    }
  } catch (e) { }
});

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Linux: two launches in a row that never ended cleanly mean Chromium is killing the app, typically because its GPU process cannot start
  // (the "GPU process isn't usable" crash on some NVIDIA drivers). That can happen too fast for the marker above to be written,
  // so after two such launches the next one runs in software rendering.
  try {
    if (process.platform === 'linux' && !SMOKE_TEST) {
      const guardFile = path.join(app.getPath('userData'), 'session-state.json');
      const unclean = exitGuard.begin(guardFile);
      if (unclean >= 2 && GPU_FALLBACK_MARKER && !fs.existsSync(GPU_FALLBACK_MARKER)) {
        fs.writeFileSync(GPU_FALLBACK_MARKER, `${new Date().toISOString()} unclean-exits ${unclean}\n`);
        app.disableHardwareAcceleration();
        setGpuFallbackTag('armed');
        console.warn('[gpu] ' + unclean + ' launches in a row did not end cleanly; software rendering from now on');
      } else if (unclean >= 2 && softwareDrawingOn && armNoGpuProcess('unclean-exits ' + unclean)) {
        // already drawing in software and still dying at start: the next launch runs with no GPU process
        setGpuFallbackTag('hard-armed');
      }
      app.on('before-quit', () => { try { exitGuard.markClean(guardFile); } catch (e) { } });
    }
  } catch (e) { }
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window. The window
    // can already be destroyed while the app is quitting (Sentry COMPANION-B).
    if (showAppWindow()) {
      // the native window is up; nothing more to show
    } else if (NATIVE_PREVIEW) {
      // the native app never shows the old window; a second launch while the app is closing has nothing to show
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      // KDE Plasma enforces focus-stealing prevention; focus() is unreliable there.
      // moveTop() raises the window to the front without triggering the block.
      if (process.platform === 'linux') {
        try { mainWindow.moveTop(); } catch (e) { }
      } else {
        mainWindow.focus();
      }
    }
    // Handle deep link from second instance
    const url = commandLine.find(arg => arg.startsWith('armgddn://'));
    if (url) {
      handleDeepLink(url);
    }
  });
}

async function getAppLoadInfo(token, manifestUrl) {
  try {
    const sessionToken = token || loadSession();
    if (!sessionToken) {
      logToFile(`[app-load] No session token`);
      return { success: false, error: 'Not authenticated' };
    }

    let base = 'https://www.armgddnbrowser.com';
    try {
      if (typeof manifestUrl === 'string' && manifestUrl) {
        const u = new URL(manifestUrl);
        if (u && u.protocol === 'https:' && u.hostname && isAllowedServiceHost(u.hostname)) {
          base = `https://${u.hostname}`;
        }
      }
    } catch (e) {
      // ignore
    }

    const fetchOnce = async (baseUrl) => {
      const url = `${baseUrl}/api/app-load`;
      logToFile(`[app-load] GET ${url}`);
      const { statusCode, json, text, headers } = await fetchJsonWithBearer(url, 'GET', sessionToken);
      const location = headers && (headers.location || headers.Location) ? String(headers.location || headers.Location) : '';
      logToFile(`[app-load] Response status=${statusCode} location=${location ? redactUrlQueryStrings(location) : ''} json=${JSON.stringify(json)} text=${text ? text.slice(0, 200) : ''}`);

      if (statusCode >= 300 && statusCode < 400 && location) {
        try {
          const u = new URL(location);
          if (u.protocol === 'https:' && isAllowedServiceHost(u.hostname)) {
            logToFile(`[app-load] Following redirect to ${u.hostname}`);
            const redirected = await fetchJsonWithBearer(String(u), 'GET', sessionToken);
            const sc = redirected && typeof redirected.statusCode === 'number' ? redirected.statusCode : 0;
            if (sc === 200 && redirected.json && redirected.json.success === true) {
              return { ok: true, json: redirected.json };
            }
            const msg2 = (redirected.json && (redirected.json.error || redirected.json.message)) ? (redirected.json.error || redirected.json.message) : 'Failed to fetch server load';
            const snippet2 = (redirected.text && typeof redirected.text === 'string') ? redirected.text.slice(0, 200) : '';
            return { ok: false, error: `${msg2} (HTTP ${sc})${snippet2 ? `: ${snippet2}` : ''}` };
          }
        } catch (e) {
        }
      }

      if (statusCode === 200 && json && json.success === true) {
        return { ok: true, json };
      }
      const msg = (json && (json.error || json.message)) ? (json.error || json.message) : 'Failed to fetch server load';
      const snippet = (text && typeof text === 'string') ? text.slice(0, 200) : '';
      return { ok: false, error: `${msg} (HTTP ${statusCode})${snippet ? `: ${snippet}` : ''}` };
    };

    try {
      const candidates = [];
      try { if (base) candidates.push(String(base)); } catch (e) { }
      candidates.push('https://www.armgddnbrowser.com');
      candidates.push('https://armgddnbrowser.com');

      const seen = new Set();
      let lastError = '';
      for (const b of candidates) {
        const bb = String(b || '').trim();
        if (!bb || seen.has(bb)) continue;
        seen.add(bb);
        const res = await fetchOnce(bb);
        if (res && res.ok) return res.json;
        lastError = res && res.error ? String(res.error) : lastError;
        if (bb !== 'https://www.armgddnbrowser.com') {
          logToFile(`[app-load] Attempt failed, next fallback`);
        }
      }

      return { success: false, error: lastError || 'Failed to fetch server load' };
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      const code = e && e.code ? String(e.code) : '';
      const looksLikeDnsOrConnect = code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';

      if (base !== 'https://www.armgddnbrowser.com' && looksLikeDnsOrConnect) {
        try {
          const fallback = await fetchOnce('https://www.armgddnbrowser.com');
          if (fallback.ok) return fallback.json;
          return { success: false, error: fallback.error || 'Failed to fetch server load' };
        } catch (e2) {
          return { success: false, error: e2 && e2.message ? e2.message : String(e2) };
        }
      }

      return { success: false, error: msg };
    }
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

let mainWindow;
let authWindow;
let progressWin = null; // Update progress window
let refreshShortcutIconsAfterUpdate = false;      // set on the first start after an update (see the shortcut refresh at start-up)
let pendingWhatsNewEntryNative = null; // the same entry, held for the native window, which asks for it once at start-up
let pendingWhatsNewEntry = null; // Set once at startup if this launch is a version bump with curated content; pushed to renderer on did-finish-load
let tray;
let activeDownloads = new Map();
let downloadHistory = [];
let sessionToken = null;

// Deep link delivery can race app startup. If we send IPC before the renderer
// is loaded, the message may be dropped and the download won't start.
let mainWindowDidFinishLoad = false;
const pendingDeepLinks = [];

const ALLOWED_SERVICE_HOSTS = new Set([
  'armgddnbrowser.com',
  'www.armgddnbrowser.com',
  'api.armgddnbrowser.com',
  'box.ca',
  'whatbox.ca'
]);

const ALLOWED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
]);

const updateRunner = require('./updateRunner');
const driveDirectClient = require('./driveDirectClient');
const hashCheck = require('./hashCheck');
const exitGuard = require('./exitGuard');
const { describe7zFailure } = require('./sevenZipErrors');
const downloadErrors = require('./downloadErrors');
let ignoreProxyEnv = false;   // set when the PC's proxy settings point at a dead proxy: rclone then runs without them


const POOL_ID = crypto.randomUUID();

const globalConcurrencyPool = {
  limit: 2,
  inUse: 0,
  serverLimit: null,
  waiters: []
};

const adaptiveScheduler = {
  pending: [],
  pumping: false,
  runningByDownloadId: new Map(),
  lastDecisionLogAt: 0,
  lastStallLogAt: 0
};

let settings = {
  downloadPath: path.join(defaultDownloadsBase(), 'ARMGDDN'),
  maxConcurrentDownloads: 2,
  connectionsPerFile: 0,
  schedule: scheduleLib.normalize(null),
  maxDownloadSpeedMBps: 0,
  autoExtract7z: false,
  autoHashCheck: true,
  autoHashCheckDefaultedOn: false,
  comicsFolder: '',
  musicFolder: '',
  extractFolder: '',
  hashGateNoticeSeen: false,
  showNotifications: true,
  minimizeToTrayOnMinimize: false,
  minimizeToTrayOnClose: false,
  lightGraphics: false,
  autoUpdate: false,
  startWithOsStartup: false,
  startWithOsMinimized: false,
  errorReporting: true,
  errorReportingAsked: false,   // set once the member has answered the crash-report question (or flipped the setting); docs/BEST_PRACTICES.md
  lastSeenVersion: ''
};

// DevTools policy: allow in dev always, and in packaged builds only when explicitly enabled
// via environment variable on the owner's machine.
const isOwnerDevToolsAllowed = !app.isPackaged || process.env.DOWNLOADER_OWNER_DEVTOOLS === '1';

// Paths
const getResourcePath = () => {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return __dirname;
};

const getHelp7zVideoFilePath = () => {
  const resourcesPath = getResourcePath();
  if (app.isPackaged) {
    return path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'newmultipartzip.mp4');
  }
  return path.join(resourcesPath, 'assets', 'newmultipartzip.mp4');
};

const getRclonePath = () => {
  const resourcePath = getResourcePath();
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(resourcePath, 'rclone', 'rclone.exe');
  }
  return path.join(resourcePath, 'rclone', 'rclone');
};

// Returns the path to an empty rclone config file in userData.
// We always pass this via --config so rclone never loads (or prompts for
// the password of) the user's system rclone.conf. copyurl only needs HTTP.
// NUL/null device names are reserved on Windows so we use a real file.
let _emptyRcloneConfigPath = null;
const getEmptyRcloneConfigPath = () => {
  if (!_emptyRcloneConfigPath) {
    try {
      const p = path.join(app.getPath('userData'), 'rclone-empty.conf');
      if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
      _emptyRcloneConfigPath = p;
    } catch (e) {
      // If we can't write, fall back to --ask-password false alone
      _emptyRcloneConfigPath = '';
    }
  }
  return _emptyRcloneConfigPath;
};

const get7zPath = () => {
  const platform = process.platform;
  const arch = process.arch;

  if (app.isPackaged) {
    const resourcePath = getResourcePath();
    if (platform === 'win32') {
      const winArch = arch === 'arm64' ? 'arm64' : (arch === 'ia32' ? 'ia32' : 'x64');
      return path.join(resourcePath, '7z', 'win', winArch, '7za.exe');
    }
    if (platform === 'darwin') {
      const macArch = arch === 'arm64' ? 'arm64' : 'x64';
      return path.join(resourcePath, '7z', 'mac', macArch, '7za');
    }
    const linuxArch = arch === 'arm64' ? 'arm64' : (arch === 'arm' ? 'arm' : (arch === 'ia32' ? 'ia32' : 'x64'));
    return path.join(resourcePath, '7z', 'linux', linuxArch, '7za');
  }

  try {
    const sevenZipBin = require('7zip-bin');
    if (sevenZipBin && sevenZipBin.path7za) {
      return sevenZipBin.path7za;
    }
  } catch (e) { }

  return null;
};

// Find a 7-Zip that actually starts. A Linux member's AppImage had a bundled 7za that looked
// executable but would not spawn ("List failed: code=null err=yes"), so try the bundled tool,
// then a private copy of it, then the system's own 7-Zip, and log each result.
let _resolved7z = null;
let _resolved7zFailures = [];

const getConfigPath = () => {
  return path.join(app.getPath('userData'), 'config.json');
};

const getHistoryPath = () => {
  return path.join(app.getPath('userData'), 'history.json');
};

const getSessionPath = () => {
  return path.join(app.getPath('userData'), 'session.json');
};

const COMPLETION_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadSessionAsync() {
  try {
    const sessionPath = getSessionPath();
    if (!fs.existsSync(sessionPath)) return false;
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    if (!(data.token && data.expiresAt && new Date(data.expiresAt) > new Date())) return false;
    if (data.encrypted && await secureStore.isAvailable()) {
      sessionToken = await secureStore.decrypt(Buffer.from(data.token, 'base64'));
    } else {
      if (!(await secureStore.isAvailable())) {
        logToFile('WARNING: safeStorage unavailable — session token stored in plaintext. Upgrade OS keychain support to enable encryption.');
      }
      sessionToken = data.token;
    }
    logToFile('Session loaded from file');
    return true;
  } catch (e) {
    logToFile('Failed to load session: ' + e.message);
    return false;
  }
}

// Load settings
let settingsLoadedFromDisk = false;
// Downloads that were unfinished when the app closed (an update, a crash, a restart) come back as "Paused" in the Downloads tab. Resume asks
// the site for a fresh link to the same item, and the files already on disk are picked up as before. See inflightStore.js.
const inflightStore = require('./inflightStore');
const { pruneEmptyDirs } = require('./emptyDirs');
const inflightFile = () => path.join(path.dirname(getHistoryPath()), 'inflight-downloads.json');
// ── Add a read list to the member's own Komga ───────────────────────────────────────────────
// The site's "Add to My Komga" button opens armgddn://komga?list=<id>. The browser cannot call a Komga server
// directly (Komga refuses other websites by default), so the app does it: it gets the reading list from the site
// and sends it to the address and API key the member saved here. The key is stored encrypted when the OS allows it.
const komga = require('./komga');
const KOMGA_LISTS = komga.LISTS;
let komgaPromptWin = null;
let komgaPromptResolve = null;

ipcMain.handle('komga-get-defaults', () => ({ url: 'http://localhost:25600' }));
ipcMain.handle('komga-cancel', () => { if (komgaPromptWin && !komgaPromptWin.isDestroyed()) komgaPromptWin.close(); });
ipcMain.handle('komga-submit', (event, data) => {
  const url = komga.normalizeBaseUrl(data && data.url);
  const key = String((data && data.key) || '').trim();
  if (!url) return { error: 'That address does not look right. Example: http://localhost:25600' };
  if (!key) return { error: 'Paste your Komga API key.' };
  if (komgaPromptResolve) { const r = komgaPromptResolve; komgaPromptResolve = null; r({ url, key }); }
  if (komgaPromptWin && !komgaPromptWin.isDestroyed()) komgaPromptWin.close();
  return { ok: true };
});

ipcMain.handle('native-komga-import', async () => {
  const dir = installedProfileDir();
  if (!dir) return { ok: false, error: 'There is no other Companion profile with a saved Komga key to import.' };
  try {
    const got = await require('./komgaImport').readInstalledKomga(dir);
    const url = komga.normalizeBaseUrl(got.url);
    if (!url || !got.key) return { ok: false, error: 'The saved Komga settings in the installed Companion are not usable.' };
    await saveKomgaConfig({ url, key: got.key });
    logToFile('[Komga] imported the installed Companion\'s saved server (' + url + ')');
    return { ok: true, url };
  } catch (e) { return { ok: false, error: e && e.message ? e.message : 'Could not import the key.' }; }
});
ipcMain.handle('native-komga-state', async () => {
  const cfg = await loadKomgaConfig();
  return { url: cfg ? cfg.url : '', hasKey: !!cfg, canImport: !cfg && !!installedProfileDir(), defaultUrl: 'http://localhost:25600', lists: Object.entries(KOMGA_LISTS).map(([id, l]) => ({ id, title: l.title })) };
});
ipcMain.handle('native-komga-save', async (event, data) => {
  const url = komga.normalizeBaseUrl(data && data.url);
  const key = String((data && data.key) || '').trim();
  if (!url) return { ok: false, error: 'That address does not look right. Example: http://localhost:25600' };
  const old = await loadKomgaConfig();
  const useKey = key || (old && old.url === url ? old.key : '');
  if (!useKey) return { ok: false, error: 'Paste your Komga API key.' };
  await saveKomgaConfig({ url, key: useKey });
  return { ok: true, url };
});
ipcMain.handle('native-komga-forget', () => { forgetKomgaKey(); return { ok: true }; });
// The reading orders a member can add: the site's catalog lists with more than 40 comics (the pipeline's own rule for a real reading order),
// biggest first. Without a sign-in the six classic ones are offered, so the card is never empty.
ipcMain.handle('native-komga-lists', async () => {
  try {
    const r = await comicsGet('/api/comics/catalog-info');
    if (r && r.ok && r.json && Array.isArray(r.json.lists)) {
      const lists = r.json.lists.filter((l) => l && /^[a-z0-9-]+$/.test(String(l.id || '')) && Number(l.books) > 40)
        .sort((a, b) => Number(b.books) - Number(a.books)).map((l) => ({ id: l.id, title: String(l.name || l.id), books: Number(l.books) }));
      if (lists.length) return { ok: true, lists };
    }
  } catch (e) { logToFile('Komga (native): could not load the reading orders: ' + (e && e.message ? e.message : e)); }
  return { ok: false, lists: Object.entries(KOMGA_LISTS).map(([id, l]) => ({ id, title: l.title, books: 0 })) };
});

// Adds (or replaces) a reading order in the member's own Komga. The comics are found the way the pipeline identifies them (see komga.js):
// by the exact file, then by Comic Vine id, never by series name.
ipcMain.handle('native-komga-add', async (event, listId) => {
  if (!komga.isValidListId(listId)) return { ok: false, error: 'Unknown reading list.' };
  if (komgaBusy) return { ok: false, error: 'Another list is being added. Try again in a moment.' };
  komgaBusy = true;
  try {
    const cfg = await loadKomgaConfig();
    if (!cfg) return { ok: false, needsSetup: true, error: 'Save your Komga address and API key first.' };
    const r = await komgaAddFromCatalog(cfg, listId);
    if (r.catalogMissing) return { ok: false, error: r.error };
    if (r.ok) return { ok: true, replaced: !!r.replaced, count: r.count, total: r.total, byFile: r.byFile, byCv: r.byCv, missing: r.missing, name: r.name };
    if (r.reason === 'auth' || r.reason === 'unreachable') forgetKomgaKey();
    return { ok: false, reason: r.reason, error: r.message, needsSetup: r.reason === 'auth' || r.reason === 'unreachable' };
  } finally { komgaBusy = false; }
});

let komgaBusy = false;
// App ready
// Launches the real window and exercises the real download engine, then exits
// 0 (pass) or 1 (fail). CI runs this before a release can publish, since
// Companion builds otherwise only get a syntax check before reaching users.
function runSmokeTest() {
  const http = require('http');
  const { execFile } = require('child_process');
  const failures = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const ok = failures.length === 0;
    const line = `[smoke] ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ': ' + failures.join(' | ')}`;
    console.log(line);
    // Windows GUI apps don't reliably write to a redirected stdout, so CI
    // reads the result from this file instead.
    if (process.env.ARMGDDN_SMOKE_RESULT) {
      try { fs.writeFileSync(process.env.ARMGDDN_SMOKE_RESULT, line + '\n', 'utf8'); } catch (e) { }
    }
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => { failures.push('timed out after 120s'); finish(); }, 120000);
  process.on('uncaughtException', (e) => failures.push(`uncaught: ${e && e.message}`));
  process.on('unhandledRejection', (e) => failures.push(`unhandled rejection: ${e && e.message}`));

  const waitForWindow = () => new Promise((resolve) => {
    const wc = mainWindowAlive() ? mainWindow.webContents : null;
    if (!wc) { failures.push('main window was not created'); return resolve(); }
    wc.on('console-message', (...args) => {
      const d = args[0] && typeof args[0] === 'object' && 'level' in args[0] ? args[0] : { level: args[1], message: args[2] };
      if (d.level === 'error' || d.level === 3) failures.push(`renderer console error: ${d.message}`);
    });
    wc.on('render-process-gone', (_e, det) => failures.push(`renderer died: ${det && det.reason}`));
    wc.on('did-fail-load', (_e, code, desc) => failures.push(`UI failed to load: ${code} ${desc}`));
    if (!wc.isLoading()) return resolve();
    wc.once('did-finish-load', resolve);
  });

  const run = (args) => new Promise((resolve) => {
    execFile(getRclonePath(), args, { timeout: 60000 }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });

  (async () => {
    await waitForWindow();
    const v = await run(['version']);
    if (v.err) failures.push(`bundled rclone did not run: ${v.err.message}`);

    // The setup check has to flag a full temp drive and a missing runtime, and stay quiet on a healthy machine.
    try {
      const sc = require('./setupCheck');
      const GBs = 1024 ** 3;
      const bad = sc.evaluateSetup({ platform: 'win32', downloadPath: 'D:\\Games', homeDir: 'C:\\Users\\me', tempDir: 'C:\\Temp', freeDownload: 500 * GBs, freeTemp: 5 * GBs, avProducts: ['Windows Defender'], defenderExclusions: ['D:\\Games'], vcRuntime: false, d3dx: true });
      const good = sc.evaluateSetup({ platform: 'win32', downloadPath: 'D:\\Games', homeDir: 'C:\\Users\\me', tempDir: 'C:\\Temp', freeDownload: 500 * GBs, freeTemp: 200 * GBs, avProducts: ['Windows Defender'], defenderExclusions: ['D:\\Games'], vcRuntime: true, d3dx: true });
      const warns = (r) => r.filter(f => f.status === 'warn').map(f => f.id).sort().join(',');
      if (warns(bad) !== 'redists,temp-space') failures.push(`setup check flagged: ${warns(bad)}`);
      if (warns(good) !== '') failures.push(`setup check warned on a healthy machine: ${warns(good)}`);
    } catch (e) { failures.push(`setup check failed: ${e.message}`); }

    // The setup report must decode back to what was put in, and keep user names, URL queries and tokens out.
    try {
      const rep = require('./setupReport');
      const code = rep.buildReport({ appVersion: '0.0.0', platform: 'win32', release: '10', arch: 'x64', findings: [{ id: 'x', status: 'warn', title: 'C:\\Users\\Alice\\Temp is full' }], facts: { downloadPath: 'D:\\Games' },
        logText: '[ERROR] failed https://h.example/p?token=SECRETVALUE1234 for C:\\Users\\Alice\\x' });
      const back = rep.decodeReport(code);
      const flat = JSON.stringify(back);
      if (!/<user>/.test(flat) || /Alice|SECRETVALUE/.test(flat) || back.v !== 1) failures.push('setup report leaked or failed to round-trip');
    } catch (e) { failures.push(`setup report failed: ${e.message}`); }

    // The "Low Space" box has to say the download folder is fine and name the drive that needs room.
    try {
      const w = buildInstallSpaceWarning({ need: 40 * 1024 ** 3, required: 40 * 1024 ** 3, free: 12 * 1024 ** 3, sameDrive: false, driveLabel: 'C:', dlLabel: 'D:' });
      if (!/download folder \(D:\) is fine/.test(w.detail) || !/C:/.test(w.title) || !/Wiki/.test(w.detail)) failures.push('low-space box wording changed');
    } catch (e) { failures.push(`low-space box failed: ${e.message}`); }

    const payload = Buffer.alloc(2 * 1024 * 1024, 7);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
      res.end(payload);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const dest = path.join(app.getPath('userData'), 'smoke-download.bin');
    const cfg = getEmptyRcloneConfigPath();
    const dl = await run(['copyurl', `http://127.0.0.1:${server.address().port}/smoke.bin`, dest, ...(cfg ? ['--config', cfg] : [])]);
    server.close();
    if (dl.err) failures.push(`rclone copyurl failed: ${(dl.stderr || dl.err.message).toString().slice(0, 300)}`);
    else {
      let size = -1;
      try { size = fs.statSync(dest).size; } catch (e) { }
      if (size !== payload.length) failures.push(`downloaded file has ${size} bytes, expected ${payload.length}`);
    }
    // rclone's INFO lines are never the reason a download failed. 5.0.23 reported "Starting
    // bandwidth limiter" as a download's error, which hid the real cause.
    try {
      if (extractRcloneErrorDetail('2026/10/03 19:25:42 INFO  : Starting bandwidth limiter at 7.500Mi Byte/s') !== '') {
        failures.push('an INFO-only rclone log was reported as the failure reason');
      }
      const realError = extractRcloneErrorDetail('2026/10/03 19:25:42 INFO  : Starting bandwidth limiter\n2026/10/03 19:25:44 ERROR : a.7z: Failed to copy: boom');
      if (!/Failed to copy: boom/.test(realError)) failures.push(`a real rclone error was not reported: ${JSON.stringify(realError)}`);
    } catch (e) {
      failures.push(`error-detail check threw: ${e && e.message}`);
    }
    // Linux handler path quoting and AppImage backup cleanup (pure fs/string logic, runs everywhere).
    try {
      const q = quoteDesktopExecArg;
      if (q('/home/u/App.AppImage') !== '/home/u/App.AppImage') failures.push(`plain path was quoted: ${q('/home/u/App.AppImage')}`);
      if (q('/home/u/My Apps/App.AppImage') !== '"/home/u/My Apps/App.AppImage"') failures.push(`path with a space was not quoted: ${q('/home/u/My Apps/App.AppImage')}`);
      if (q('/a/b$c/App') !== '"/a/b\\\\$c/App"') failures.push(`$ was not escaped: ${q('/a/b$c/App')}`);
      if (q('/a/100%/App') !== '/a/100%%/App') failures.push(`% was not doubled: ${q('/a/100%/App')}`);
      const tmp = path.join(app.getPath('userData'), 'smoke-appimage');
      fs.mkdirSync(tmp, { recursive: true });
      const cur = path.join(tmp, 'Companion.AppImage');
      fs.writeFileSync(cur, Buffer.alloc(2 * 1024 * 1024, 1));
      fs.writeFileSync(cur + '.old', Buffer.alloc(1024, 2));
      const past = new Date(Date.now() - 3600 * 1000);
      fs.utimesSync(cur + '.old', past, past);
      const r1 = cleanupAppImageBackup(cur);
      if (!/^deleted /.test(r1) || fs.existsSync(cur + '.old')) failures.push(`backup was not cleaned up: ${r1}`);
      if (!fs.existsSync(cur)) failures.push('cleanup removed the running AppImage itself');
      if (cleanupAppImageBackup(cur) !== 'none') failures.push('cleanup with no backup was not a no-op');
      fs.writeFileSync(cur + '.old', Buffer.alloc(1024, 2));
      fs.writeFileSync(cur, Buffer.alloc(10, 1));
      if (!/^kept: the current AppImage looks wrong/.test(cleanupAppImageBackup(cur)) || !fs.existsSync(cur + '.old')) failures.push('cleanup deleted the backup although the current AppImage looks wrong');
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    } catch (e) {
      failures.push(`appimage helper check threw: ${e && e.message}`);
    }

    // A member who left the group must be told to rejoin, not shown "session expired".
    try {
      if (!/rejoin/i.test(notInChannelMessage({ code: 'NOT_IN_CHANNEL', message: 'Please rejoin the group.' }) || '')) {
        failures.push('NOT_IN_CHANNEL did not surface the server message');
      }
      if (notInChannelMessage({ code: undefined, errMsg: 'Authentication required' }) !== null) {
        failures.push('an ordinary 401 was treated as NOT_IN_CHANNEL');
      }
    } catch (e) {
      failures.push(`not-in-channel check threw: ${e && e.message}`);
    }
    // Bundled 7-Zip (auto-extract). 5.0.18 to 5.0.20 shipped without it because the build
    // tool stopped pulling it in, and nothing noticed. Round-trip a password-protected
    // archive through the app's real extraction code.
    try {
      const sevenZip = get7zPath();
      if (!sevenZip || !fs.existsSync(sevenZip)) {
        failures.push(`bundled 7z is missing: ${sevenZip}`);
      } else {
        // A real Linux/macOS install can't chmod the bundled tool, so strip its execute bit
        // and forbid chmod here too: only the private-copy fallback can make this pass.
        let sevenZipRun = sevenZip;
        if (process.platform !== 'win32') {
          process.env.ARMGDDN_TEST_NO_CHMOD = '1';
          try { fs.chmodSync(sevenZip, 0o644); } catch (e) { failures.push(`could not strip the execute bit for the test: ${e && e.message}`); }
          sevenZipRun = resolve7zTool() || sevenZip;
          // With the execute bit stripped and chmod forbidden, running it in place is impossible,
          // so a pass is only meaningful if the private copy (or a system 7-Zip) was really used.
          if (sevenZipRun === sevenZip) failures.push(`7z fallback was not used: ${_resolved7zFailures.join('; ') || 'the tool was run in place without the execute bit'}`);
          else if (sevenZipRun.includes(path.sep) && !fs.existsSync(sevenZipRun)) failures.push(`7z fallback copy is missing: ${sevenZipRun}`);
        }
        const dir = path.join(app.getPath('userData'), 'smoke-7z');
        const srcDir = path.join(dir, 'src');
        const outDir = path.join(dir, 'out');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'a.txt'), 'hello 7z smoke', 'utf8');
        const archive = path.join(dir, 'test.7z');
        const made = await new Promise((resolve) => {
          execFile(sevenZipRun, ['a', '-pARMGDDNGames', '-y', archive, 'a.txt'], { cwd: srcDir, timeout: 60000 }, (err, stdout, stderr) => resolve({ err, stderr }));
        });
        if (made.err) {
          failures.push(`bundled 7z could not create an archive: ${(made.stderr || made.err.message).toString().slice(0, 200)}`);
        } else {
          await run7zExtract(archive, outDir);
          let text = '';
          try { text = fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'); } catch (e) { }
          if (text !== 'hello 7z smoke') failures.push(`7z extraction produced ${JSON.stringify(text)}`);
        }
      }
    } catch (e) {
      failures.push(`7z extraction failed: ${e && e.message}`);
    }
    // Let the UI settle so late renderer errors are caught too.
    await new Promise((r) => setTimeout(r, 3000));
    finish();
  })().catch((e) => { failures.push(`smoke runner crashed: ${e && e.message}`); finish(); });
}

// Whatever asked the app to quit (the menu, Cmd+Q, the OS), it really quits: the close handlers that keep the app in the tray step aside.
app.on('before-quit', () => { app.isQuitting = true; });

app.whenReady().then(() => {
  startUpdatePoller();
  try { startScheduleTicker(); } catch (e) { }
  try {
    logToFile(`[Startup] version: ${app.getVersion()}`);
  } catch (e) { }
  logToFile(`[Startup] debug.log path: ${getDebugLogPath()}`);
  logToFile(`[Protocol] setAsDefaultProtocolClient ok=${protocolClientRegistered}${protocolClientRegisterError ? ` err=${protocolClientRegisterError}` : ''}`);
  loadSettings();
  if (NATIVE_PREVIEW) {
    try {
      loadSession();
      // The preview keeps its own profile so it cannot disturb the installed Companion, which means it starts with default settings. Bring over
      // the installed Companion's settings once (and on request). The shipped app uses the same settings file, so nothing needs importing then.
      const importClassicSettings = (force) => {
        const keys = ['downloadPath', 'maxConcurrentDownloads', 'connectionsPerFile', 'schedule', 'maxDownloadSpeedMBps', 'autoExtract7z', 'autoHashCheck', 'comicsFolder', 'musicFolder', 'showNotifications', 'minimizeToTrayOnMinimize', 'minimizeToTrayOnClose', 'autoUpdate', 'errorReporting'];
        const src = path.join(app.getPath('appData'), 'armgddn-downloader', 'config.json');
        if (path.resolve(src) === path.resolve(path.join(app.getPath('userData'), 'config.json'))) return { imported: 0, same: true };
        if (!force && settings && settings.nativeSettingsImported) return { imported: 0, already: true };
        let theirs; try { theirs = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { return { imported: 0, missing: true }; }
        let n = 0;
        for (const k of keys) if (theirs && Object.prototype.hasOwnProperty.call(theirs, k) && theirs[k] !== undefined) { settings[k] = theirs[k]; n++; }
        settings.nativeSettingsImported = true;
        normalizeSettings(); saveSettings();
        logToFile('[Native] imported ' + n + ' settings from the installed Companion');
        return { imported: n };
      };
      importClassicSettings(false);
      ipcMain.handle('native-import-settings', () => importClassicSettings(true));
      nativeWindow = require('./native/bridge').start({
        BrowserWindow, ipcMain, shell, dialog, clipboard: require('electron').clipboard, clearSession, clearLoginTraces, protocol: require('electron').protocol, getToken: () => sessionToken, version: app.getVersion(), appDir: __dirname,
        openLogin: () => openAuthWindow(), log: logToFile,
        startDeepLink: (u) => handleDeepLink(u), getDownloads: () => Array.from(activeDownloads.values()).map(downloadToRenderer),
        // A Music or Comics download goes to the folder chosen for it in Settings (the website's links carry dest=music|comics for the same reason);
        // with no folder chosen it goes to the download folder as before.
        destFor: (remote) => {
          const f = remote === 'Music' ? settings.musicFolder : remote === 'Comics' ? settings.comicsFolder : '';
          try { return (typeof f === 'string' && f.trim() && path.isAbsolute(f) && fs.existsSync(f)) ? remote.toLowerCase() : ''; } catch (e) { return ''; }
        }
      });
      // Closing the native window keeps the app in the tray when that setting is on (like the classic window), so opening the Companion again
      // or clicking the tray icon brings this window back instead of the hidden classic one.
      try {
        if (nativeWindow && !nativeWindow.isDestroyed()) {
          nativeWindow.on('close', (event) => {
            if (app.isQuitting) return;
            if (settings && settings.minimizeToTrayOnClose) { event.preventDefault(); nativeWindow.hide(); return; }
            // A real close (Keep running in the tray is off) ends the app, so ask first when downloads are running, as the old window did.
            const activeCount = Array.from(activeDownloads.values()).filter((d) => d && ['in_progress', 'downloading', 'starting'].includes(d.status)).length;
            if (activeCount > 0 && !_installUpdateInProgress) {
              const result = withDialogFocusSync(() => dialog.showMessageBoxSync(nativeWindow, {
                type: 'question', buttons: ['Cancel', 'Quit Anyway'], defaultId: 0, title: 'Active Downloads',
                message: `There ${activeCount === 1 ? 'is' : 'are'} ${activeCount} active download${activeCount === 1 ? '' : 's'}.`,
                detail: 'Quitting now will interrupt the downloads. Are you sure you want to quit?'
              }));
              if (result === 0) { event.preventDefault(); return; }
              _closeConfirmed = true;
            }
          });
          // The Minimize button hides the window to the tray when that setting is on (the old window did this; the native window had no handler, so the setting did nothing).
          nativeWindow.on('minimize', (event) => {
            if (settings && settings.minimizeToTrayOnMinimize) { try { event.preventDefault(); } catch (e) { } nativeWindow.hide(); }
          });
          // Started by the computer at login with "Start minimized" on: go to the tray (or the taskbar) instead of opening in front, as the old window did.
          try {
            if (!process.argv.includes('--updated') && settings && settings.startWithOsMinimized && isAutostartLaunch()) {
              if (settings.minimizeToTrayOnMinimize) nativeWindow.hide(); else nativeWindow.minimize();
            }
          } catch (e) { }
          // The hidden classic window keeps the process alive, so closing the only visible window must end the app itself (6.0.2: it used to stay in the
          // tray with no window, and clicking the tray then showed the old Companion window).
          nativeWindow.on('closed', () => { if (!app.isQuitting) { app.isQuitting = true; app.quit(); } });
        }
      } catch (e) { }
    } catch (e) { logToFile('[Native] preview failed to start: ' + e.message); }
  }

  // "What's New" popup detection — version-diffing rather than the platform
  // update-relaunch flag (that flag is Windows-only and inconsistent even
  // there; Linux AppImage relaunch and manual Linux .deb/macOS installs never
  // set it at all, but they DO always launch under the new app.getVersion()).
  try {
    const currentVersion = app.getVersion();
    if (settings.lastSeenVersion && settings.lastSeenVersion !== currentVersion) {
      pendingWhatsNewEntry = getWhatsNewForVersion(currentVersion);
      pendingWhatsNewEntryNative = pendingWhatsNewEntry;
    }
    if (settings.lastSeenVersion !== currentVersion) {
      if (settings.lastSeenVersion) refreshShortcutIconsAfterUpdate = true;      // first start after an update: redraw the shortcut icons below
      settings.lastSeenVersion = currentVersion;
      saveSettings();
    }
  } catch (e) {
    try { logToFile(`[WhatsNew] version-diff check failed: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
  }

  applyStartupRegistration();
  // The desktop and Start Menu shortcuts say ARMGDDN App while the native window is on for this member, ARMGDDN Companion otherwise (installed Windows app only).
  try {
    if (process.platform === 'win32' && app.isPackaged) {
      const dirs = [app.getPath('desktop'), process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : ''].filter(Boolean);
      const renamed = shortcutNames.syncShortcutNames({
        dirs, native: !!NATIVE_PREVIEW, fs, log: logToFile,
        opensThisApp: (file) => { try { return String(shell.readShortcutLink(file).target || '').toLowerCase() === String(process.execPath).toLowerCase(); } catch (e) { return false; } }
      });
      // After an update or a rename Windows can show a blank shortcut icon: write the shortcuts again and have Windows redraw icons.
      if (refreshShortcutIconsAfterUpdate || renamed.some((r) => r.ok)) {
        shortcutNames.refreshShortcutIcons({
          dirs, fs, shell, execPath: process.execPath, log: logToFile,
          run: (file, args) => { try { spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { } }
        });
      }
    }
  } catch (e) { logToFile('[Shortcut] sync failed: ' + (e && e.message ? e.message : e)); }
  loadHistory();
  loadOrphanedDownloads();
  loadSession();
  if (!secureStore.syncAvailable) loadSessionAsync().catch(() => { });
  (async () => {
    try {
      const resultPath = path.join(app.getPath('userData'), 'update-result.json');
      if (!fs.existsSync(resultPath)) return;
      const raw = fs.readFileSync(resultPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      const state = String(parsed.state || '').toLowerCase();
      if (state === 'installing') {
        if (updateRunner.installIsRunning(raw, fs.statSync(resultPath).mtimeMs)) {
          // The member opened the app again while the update is still being installed. Starting now would collide with it.
          logToFile('Startup: an update is still installing; closing this copy so the installer can finish');
          await withDialogFocus(() => dialog.showMessageBox({ type: 'info', buttons: ['OK'], title: 'Updating', message: 'ARMGDDN Companion is installing an update', detail: 'It will reopen by itself in a minute. There is nothing you need to do.' }));
          app.exit(0);
          return;
        }
        try { fs.unlinkSync(resultPath); } catch (e) { }       // stale marker from an install that never reported back
        return;
      }
      const exitCode = Number.isFinite(Number(parsed.exitCode)) ? Number(parsed.exitCode) : null;
      const logPath = parsed.logPath ? String(parsed.logPath) : '';

      // Clean up successful results silently.
      // Exit code 2 from NSIS means the installer self-elevated via UAC — the
      // initial low-privilege process exits with 2 while the elevated copy
      // continues and completes the install successfully. Treat it as success.
      if (state === 'success' || exitCode === 0 || exitCode === 2) {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      // Only show failure messages for recent results (avoid old stale files lingering).
      const ts = parsed.ts ? Number(parsed.ts) : null;
      const ageMs = (ts && Number.isFinite(ts)) ? (Date.now() - ts) : null;
      if (ageMs != null && ageMs > (24 * 60 * 60 * 1000)) {
        try { fs.unlinkSync(resultPath); } catch (e) { }
        return;
      }

      const msg = exitCode != null
        ? `The update installer failed (exit code ${exitCode}).\n\nYou can open the update log for details.`
        : 'The update installer failed.\n\nYou can open the update log for details.';

      const buttons = logPath ? ['Open Update Log', 'OK'] : ['OK'];
      const openIdx = 0;
      const { response } = await withDialogFocus(() => dialog.showMessageBox({
        type: 'error',
        buttons,
        defaultId: 0,
        title: 'Update Failed',
        message: 'ARMGDDN Companion update failed',
        detail: msg
      }));
      if (logPath && response === openIdx) {
        try {
          await shell.openPath(logPath);
        } catch (e) {
          try { shell.showItemInFolder(logPath); } catch (e2) { }
        }
      }

      try { fs.unlinkSync(resultPath); } catch (e) { }
    } catch (e) {
      try { logToFile(`Update result check error: ${e && e.message ? e.message : String(e)}`); } catch (e2) { }
    }
  })();
  createWindow();
  if (SMOKE_TEST) { runSmokeTest(); return; }
  createTray();
  createAppMenu();

  ensureLinuxProtocolDesktopHandler();

  // An AppImage that has stayed up for two minutes updated fine: drop the "<AppImage>.old" backup.
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    const t = setTimeout(() => {
      const res = cleanupAppImageBackup(process.env.APPIMAGE);
      if (res !== 'none') logToFile(`[Update] AppImage backup cleanup: ${res}`);
    }, 2 * 60 * 1000);
    if (t && typeof t.unref === 'function') t.unref();
  }

  // Handle deep link on macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Handle deep link from command line (Windows/Linux)
  const url = process.argv.find(arg => arg.startsWith('armgddn://'));
  if (url) {
    handleDeepLink(url);
  }
});

ipcMain.handle('retry-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  return retryFailedDownload(downloadId);
});

// Auto-retry: most failures are the member's connection dropping (Sentry
// COMPANION-2/-3/-5/-6). Once a download has failed on one of those, wait for
// the network and resume it by itself, as if they'd clicked Retry. A connection that keeps dropping
// (satellite internet) gets up to AUTO_RETRY_MAX resumes, each after a longer pause.
// Errors a retry can't fix (disk space, quota, clock, folder) are left alone.
const AUTO_RETRY_TRANSIENT_RE = /(stalled|link expired|network\/dns|timed out|connection dropped|gateway error|could not be resumed|download failed\.)/i;
const AUTO_RETRY_BLOCK_RE = /(disk space|quota|date\/time|download folder|security error)/i;
const AUTO_RETRY_MAX = 5;
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS this can fire before the app is ready (a relaunch from a deep link), and creating a window then throws.
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Get settings
ipcMain.handle('get-settings', () => {
  return settings;
});

// Save settings
ipcMain.handle('save-settings', (event, newSettings) => {
  const incoming = (newSettings && typeof newSettings === 'object') ? newSettings : {};
  const allowedKeys = new Set([
    'downloadPath',
    'maxConcurrentDownloads',
    'connectionsPerFile',
    'schedule',
    'maxDownloadSpeedMBps',
    'autoExtract7z',
    'autoHashCheck',
    'hashGateNoticeSeen',
    'comicsFolder',
    'musicFolder',
    'extractFolder',
    'showNotifications',
    'minimizeToTrayOnMinimize',
    'minimizeToTrayOnClose',
    'lightGraphics',
    'autoUpdate',
    'startWithOsStartup',
    'startWithOsMinimized',
    'errorReporting',
    'errorReportingAsked',
    'lastSeenVersion'
  ]);

  const merged = { ...settings };
  for (const k of Object.keys(incoming)) {
    if (!allowedKeys.has(k)) continue;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    merged[k] = incoming[k];
  }
  settings = merged;
  normalizeSettings();
  applyStartupRegistration();
  saveSettings();
  setTimeout(() => { maybeShowHashGateNotice().catch(() => { }); }, 300);
  return settings;
});

// Browse for folder
ipcMain.handle('browse-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), {
    properties: ['openDirectory']
  }));
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// ---- Comics: "only what I'm missing". The member's own folder is scanned here, on their PC, and compared with the site's catalog;
// only the catalog comes down. Nothing about the folder is sent to the site.
const comicsScan = require('./comicsScan');
const comicsState = { running: false, worker: null, rows: null, root: '', at: 0, last: null, token: '' };
const COMICS_LIST_RE = /^[a-z0-9-]{1,80}$/;

async function comicsGet(pathAndQuery, page, sessionToken) {
  page = page || 'Comics';
  const tokens = catalogTokens(sessionToken);
  if (!tokens.length) return { ok: false, error: `Sign in first: open the ${page} page on the site and press "Only what I'm missing".` };
  try {
    let r = null;
    for (const token of tokens) {
      r = await fetchJsonWithBearer(`https://www.armgddnbrowser.com${pathAndQuery}`, 'GET', token);
      if (r.statusCode !== 401) {
        if (token !== tokens[0]) logToFile(`[catalog] ${page}: sign-in #${tokens.indexOf(token) + 1} of ${tokens.length} was accepted`);
        comicsState.token = token; musicState.token = token;     // downloads for this session use the one that works
        break;
      }
    }
    if (r.statusCode === 401) {
      logToFile(`[catalog] ${page} request refused (401) with all ${tokens.length} sign-in(s) held`);
      return { ok: false, error: `Your sign-in expired. Open the ${page} page on the site and press "Only what I'm missing" again.` };
    }
    if (r.statusCode !== 200 || !r.json || r.json.success === false) return { ok: false, error: (r.json && r.json.error) || `The site answered ${r.statusCode}.` };
    return { ok: true, json: r.json };
  } catch (e) {
    return { ok: false, error: 'Could not reach the site: ' + (e && e.message ? e.message : e) };
  }
}

ipcMain.handle('comics-get-state', () => ({ folder: settings.comicsFolder || '', scanned: comicsState.rows ? comicsState.rows.length : 0, at: comicsState.at, running: comicsState.running, progress: comicsState.running ? (comicsState.progress || { scanned: 0, current: '' }) : null }));

ipcMain.handle('comics-pick-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), { properties: ['openDirectory'] }));
  if (result.canceled || !result.filePaths.length) return null;
  settings.comicsFolder = result.filePaths[0];
  saveSettings();
  comicsState.rows = null; comicsState.at = 0; comicsState.last = null;
  return settings.comicsFolder;
});

ipcMain.handle('comics-scan', async () => {
  // The library's own catalog lets the scan skip opening files it already knows by name and size (a big win on a cloud or network drive).
  if (comicsState.running || comicsState.starting) return { ok: false, error: 'A scan is already running.' };
  let known = null;
  comicsState.starting = true;
  try {
    const cat = await comicsGet('/api/comics/catalog?list=all');
    if (cat && cat.ok && cat.json && Array.isArray(cat.json.items)) known = comicsScan.buildKnown(cat.json.items);
    else logToFile('[comics] the library list could not be loaded, so the scan did not start: ' + ((cat && cat.error) || 'no answer'));
    if (!known) {
      comicsState.starting = false;
      // Without the library list the scan cannot skip the comics you already have (every file would be opened, which takes hours on a cloud or network drive)
      // and the comparison needs the list anyway, so say so now instead of crawling.
      return { ok: false, needsSignIn: true, error: 'The scan did not start: ' + ((cat && cat.error) || 'the library list could not be loaded') + ' It needs that list to skip the comics you already have; without it a cloud or network drive can take hours.' };
    }
  } catch (e) { logToFile('[comics] catalog not available for the fast scan: ' + (e && e.message)); }
  finally { comicsState.starting = false; }
  return new Promise((resolve) => {
  const root = settings.comicsFolder;
  if (!root || !fs.existsSync(root)) { resolve({ ok: false, error: 'Choose your comics folder first.' }); return; }
  if (comicsState.running) { resolve({ ok: false, error: 'A scan is already running.' }); return; }
  const { Worker } = require('worker_threads');
  comicsState.running = true; comicsState.progress = { scanned: 0, current: '' };
  let worker;
  const finish = (out) => { comicsState.running = false; comicsState.worker = null; resolve(out); };
  try {
    worker = new Worker(path.join(__dirname, 'comicsScanWorker.js'), { workerData: { root, cache: loadComicsCache(root), known } });
  } catch (e) { finish({ ok: false, error: 'Could not start the scan: ' + e.message }); return; }
  comicsState.worker = worker;
  worker.on('message', (m) => {
    if (m.type === 'progress') { comicsState.progress = { scanned: m.scanned, current: m.current }; sendToMain('comics-scan-progress', { scanned: m.scanned, current: m.current }); return; }
    if (m.type === 'done') {
      comicsState.rows = m.rows; comicsState.root = root; comicsState.at = Date.now(); comicsState.last = null;
      saveComicsCache(root, m.cache);
      logToFile(`[comics] scanned ${m.rows.length} files (${m.rows.filter((r) => r.fast).length} matched the catalog by name and size without being opened)`);
      finish({ ok: true, count: m.rows.length, damaged: m.rows.filter((r) => r.damaged).length, fast: m.rows.filter((r) => r.fast).length });
    }
  });
  worker.on('error', (e) => { logToFile('[comics] scan failed: ' + (e && e.message)); finish({ ok: false, error: 'The scan failed: ' + (e && e.message ? e.message : e) }); });
  worker.on('exit', (code) => { if (comicsState.running) finish({ ok: false, cancelled: true, error: 'The scan was stopped.' }); });
  });
});

ipcMain.handle('comics-cancel-scan', () => { const w = comicsState.worker; if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } return !!w; });

ipcMain.handle('comics-info', async () => {
  const r = await comicsGet('/api/comics/catalog-info');
  return r.ok ? { ok: true, lists: r.json.lists || [], totals: r.json.totals || null } : r;
});

ipcMain.handle('comics-compare', async (event, listId) => {
  const id = String(listId || 'all');
  // "folder:<path>" compares one folder of the library (a collection or a series) instead of a reading order.
  const folder = id.startsWith('folder:') ? id.slice(7) : '';
  if (folder ? !isSafeLibraryFolder(folder) : (id !== 'all' && !COMICS_LIST_RE.test(id))) return { ok: false, error: 'Unknown list.' };
  if (!comicsState.rows) return { ok: false, error: 'Scan your folder first.' };
  const r = await comicsGet(folder ? '/api/comics/catalog?folder=' + encodeURIComponent(folder) : '/api/comics/catalog?list=' + encodeURIComponent(id));
  if (!r.ok) return r;
  const items = Array.isArray(r.json.items) ? r.json.items : [];
  const cmp = comicsScan.compare(items, comicsState.rows);
  comicsState.last = { listId: id, list: r.json.list, missingRows: cmp.missingRows };      // kept for the download step
  const { missingRows, ...summary } = cmp;
  return { ok: true, list: r.json.list, summary: { ...summary, perSeries: summary.perSeries.slice(0, 40), damaged: summary.damaged.slice(0, 20) } };
});

// Starts the downloads for what the last comparison found missing, through the same path the site's own downloads use:
// a batch manifest, a one-time download token for it, then the normal download link. Files arrive in the Companion's download
// folder with the library's own folder layout.
ipcMain.handle('comics-download-missing', async () => {
  const last = comicsState.last;
  if (!last || !Array.isArray(last.missingRows) || !last.missingRows.length) return { ok: false, error: 'Compare first. There is nothing to download.' };
  const token = comicsState.token || savedSessionToken();
  if (!token) return { ok: false, error: 'Sign in first: open the Comics page on the site and press "Only what I\'m missing".' };
  const toFolder = !!(settings.comicsFolder && fs.existsSync(settings.comicsFolder));
  const batches = comicsScan.planBatches(last.missingRows, 400, 60e9).slice(0, 40);
  const base = 'https://www.armgddnbrowser.com';
  let started = 0, files = 0, bytes = 0;
  for (const batch of batches) {
    try {
      const m = await postJsonWithBearer(base + '/api/batch-manifest', { remote: 'Comics', paths: batch.map((r) => r[0]) }, token);
      if (m.statusCode === 401) return { ok: false, started, error: 'Your sign-in expired. Open the Comics page on the site and press "Only what I\'m missing" again.' };
      if (m.statusCode !== 200 || !m.json || !m.json.batchId) return { ok: false, started, error: (m.json && m.json.error) || `The site answered ${m.statusCode} when preparing the download.` };
      const t = await postJsonWithBearer(base + '/api/external-download-token', { remote: 'Comics', path: '__batch__/' + m.json.batchId }, token);
      if (t.statusCode !== 200 || !t.json || !t.json.downloadToken) return { ok: false, started, error: (t.json && t.json.error) || `The site answered ${t.statusCode} when authorizing the download.` };
      const q = { downloadToken: t.json.downloadToken, token };
      if (toFolder) q.dest = 'comics';
      handleDeepLink('armgddn://download?' + new URLSearchParams(q).toString());
      started++; files += batch.length; bytes += batch.reduce((n, r) => n + (Number(r[2]) || 0), 0);
    } catch (e) {
      return { ok: false, started, error: 'Could not reach the site: ' + (e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 1500));          // the token endpoints allow 20 calls a minute
  }
  logToFile(`[comics] started ${started} download(s) for ${files} missing comics`);
  return { ok: true, started, files, bytes, folder: toFolder ? settings.comicsFolder : settings.downloadPath };
});

// ---- Music: only what I'm missing (same flow as comics: pick the folder, scan, compare with the library, download the rest into it)
const musicScan = require('./musicScan');
const musicState = { running: false, worker: null, rows: null, root: '', at: 0, last: null, token: '' };
const musicGet = (pathAndQuery) => comicsGet(pathAndQuery, 'Music', musicState.token);

ipcMain.handle('music-get-state', () => ({ folder: settings.musicFolder || '', scanned: musicState.rows ? musicState.rows.length : 0, at: musicState.at, running: musicState.running, progress: musicState.running ? (musicState.progress || { scanned: 0, current: '' }) : null }));

ipcMain.handle('music-pick-folder', async () => {
  const result = await withDialogFocus(() => dialog.showOpenDialog(getDialogParentWindow(), { properties: ['openDirectory'] }));
  if (result.canceled || !result.filePaths.length) return null;
  settings.musicFolder = result.filePaths[0];
  saveSettings();
  musicState.rows = null; musicState.at = 0; musicState.last = null;
  return settings.musicFolder;
});

ipcMain.handle('music-scan', async () => {
  if (musicState.running) return { ok: false, error: 'A scan is already running.' };
  const root = settings.musicFolder;
  if (!root || !fs.existsSync(root)) return { ok: false, error: 'Choose your music folder first.' };
  // Check the sign-in first, like the comics scan: without the library list the comparison could not run anyway.
  const info = await musicGet('/api/music/catalog-info');
  if (!info.ok) return { ok: false, needsSignIn: true, error: 'The scan did not start: ' + info.error };
  return new Promise((resolve) => {
    const { Worker } = require('worker_threads');
    musicState.running = true; musicState.progress = { scanned: 0, current: '' };
    let worker;
    const finish = (out) => { musicState.running = false; musicState.worker = null; resolve(out); };
    try { worker = new Worker(path.join(__dirname, 'musicScanWorker.js'), { workerData: { root } }); }
    catch (e) { finish({ ok: false, error: 'Could not start the scan: ' + e.message }); return; }
    musicState.worker = worker;
    worker.on('message', (m) => {
      if (m.type === 'progress') { musicState.progress = { scanned: m.scanned, current: m.current }; sendToMain('music-scan-progress', { scanned: m.scanned, current: m.current }); return; }
      if (m.type === 'done') {
        musicState.rows = m.rows; musicState.root = root; musicState.at = Date.now(); musicState.last = null;
        logToFile(`[music] scanned ${m.rows.length} files`);
        finish({ ok: true, count: m.rows.length, damaged: m.rows.filter((r) => r.damaged).length });
      }
    });
    worker.on('error', (e) => { logToFile('[music] scan failed: ' + (e && e.message)); finish({ ok: false, error: 'The scan failed: ' + (e && e.message ? e.message : e) }); });
    worker.on('exit', () => { if (musicState.running) finish({ ok: false, cancelled: true, error: 'The scan was stopped.' }); });
  });
});

ipcMain.handle('music-cancel-scan', () => { const w = musicState.worker; if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } return !!w; });

ipcMain.handle('music-info', async () => {
  const r = await musicGet('/api/music/catalog-info');
  return r.ok ? { ok: true, totals: r.json.totals || null } : r;
});

ipcMain.handle('music-compare', async (event, folder) => {
  folder = String(folder || '');
  if (folder && !isSafeLibraryFolder(folder)) return { ok: false, error: 'Unknown folder.' };
  if (!musicState.rows) return { ok: false, error: 'Scan your folder first.' };
  const r = await musicGet('/api/music/catalog' + (folder ? '?folder=' + encodeURIComponent(folder) : ''));
  if (!r.ok) return r;
  const items = Array.isArray(r.json.items) ? r.json.items : [];
  const cmp = musicScan.compare(items, musicState.rows);
  musicState.last = { missingRows: cmp.missingRows };           // kept for the download step
  const { missingRows, ...summary } = cmp;
  summary.bytesMissing = missingRows.reduce((n, x) => n + (Number(x[2]) || 0), 0);
  return { ok: true, list: r.json.list, summary };
});

ipcMain.handle('music-download-missing', async () => {
  const last = musicState.last;
  if (!last || !Array.isArray(last.missingRows) || !last.missingRows.length) return { ok: false, error: 'Compare first. There is nothing to download.' };
  const token = musicState.token || savedSessionToken();
  if (!token) return { ok: false, error: 'Sign in first: open the Music page on the site and press "Only what I\'m missing".' };
  if (!(settings.musicFolder && fs.existsSync(settings.musicFolder))) return { ok: false, error: 'Choose your music folder first.' };
  const batches = musicScan.planBatches(last.missingRows, 400, 60e9).slice(0, 40);
  const base = 'https://www.armgddnbrowser.com';
  let started = 0, files = 0, bytes = 0;
  for (const batch of batches) {
    try {
      const m = await postJsonWithBearer(base + '/api/batch-manifest', { remote: 'Music', paths: batch.map((r) => r[0]) }, token);
      if (m.statusCode === 401) return { ok: false, started, error: 'Your sign-in expired. Open the Music page on the site and press "Only what I\'m missing" again.' };
      if (m.statusCode !== 200 || !m.json || !m.json.batchId) return { ok: false, started, error: (m.json && m.json.error) || `The site answered ${m.statusCode} when preparing the download.` };
      const t = await postJsonWithBearer(base + '/api/external-download-token', { remote: 'Music', path: '__batch__/' + m.json.batchId }, token);
      if (t.statusCode !== 200 || !t.json || !t.json.downloadToken) return { ok: false, started, error: (t.json && t.json.error) || `The site answered ${t.statusCode} when authorizing the download.` };
      handleDeepLink('armgddn://download?' + new URLSearchParams({ downloadToken: t.json.downloadToken, token, dest: 'music' }).toString());
      started++; files += batch.length; bytes += batch.reduce((n, r) => n + (Number(r[2]) || 0), 0);
    } catch (e) {
      return { ok: false, started, error: 'Could not reach the site: ' + (e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 1500));          // the token endpoints allow 20 calls a minute
  }
  logToFile(`[music] started ${started} download(s) for ${files} missing tracks`);
  return { ok: true, started, files, bytes, folder: settings.musicFolder };
});

ipcMain.handle('get-app-load', async (event, token, manifestUrl) => {
  return getAppLoadInfo(token, manifestUrl);
});

// Manual trigger for the What's New content (e.g. a future Help-menu entry) —
// distinct from the automatic show-whats-new push, which only fires once per
// version bump. Always returns the current version's entry (or null), regardless
// of whether it was already shown this run.
ipcMain.handle('get-whats-new', () => getWhatsNewForVersion(app.getVersion()));
// The native window's one-time "What's New" after an update (the classic window gets it pushed when it loads).
ipcMain.handle('native-pending-whats-new', () => { const e = pendingWhatsNewEntryNative; pendingWhatsNewEntryNative = null; return e || null; });

// Check free disk space at (or above) a given path, for Settings/list UI readouts.
ipcMain.handle('check-disk-space', async (event, targetPath) => {
  const p = (typeof targetPath === 'string' && targetPath.trim()) ? targetPath : settings.downloadPath;
  const freeBytes = getFreeDiskSpace(p);
  return {
    freeBytes,
    freeFormatted: freeBytes >= 0 ? formatBytes(freeBytes) : null
  };
});

// "Check my setup" (Settings): disk space, folder location, antivirus and redistributables, as plain findings.
ipcMain.handle('run-setup-check', async () => {
  try {
    const setupCheck = require('./setupCheck');
    const facts = await setupCheck.collectFacts({ downloadPath: settings.downloadPath, comicsFolder: settings.comicsFolder, getFreeDiskSpace });
    return { ok: true, findings: setupCheck.evaluateSetup(facts) };
  } catch (e) {
    logToFile(`[setup-check] failed: ${e.message}`);
    return { ok: false, findings: [] };
  }
});

// "Copy report for Tulip": the setup check results and recent log problems as one pasteable code, personal details removed.
ipcMain.handle('build-setup-report', async () => {
  try {
    const setupCheck = require('./setupCheck');
    const setupReport = require('./setupReport');
    const facts = await setupCheck.collectFacts({ downloadPath: settings.downloadPath, comicsFolder: settings.comicsFolder, getFreeDiskSpace });
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
    const token = sessionToken || loadSession();
    if (!token) return { ok: false, error: 'Sign in to the app first, then try again.' };
    const names = [...new Set((Array.isArray(downloadHistory) ? downloadHistory : []).filter((h) => h && h.status === 'completed' && h.name).map((h) => String(h.name)))].slice(0, 300);
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

// "Test my connection": reads ranges of one big file from the download server with 16, 8, 4 and 1 connections for a few seconds each
// (nothing is saved), and recommends a "Connections per file" value. The result is also remembered for the support log.
let lastConnectionTest = null;
let connectionTestRunning = false;
ipcMain.handle('run-connection-test', async (event) => {
  if (connectionTestRunning) return { ok: false, error: 'A test is already running.' };
  connectionTestRunning = true;
  try {
    const token = sessionToken || loadSession();
    if (!token) return { ok: false, error: 'Sign in to the app first, then try again.' };
    const { runTest } = require('./connectionTest');
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
    lastConnectionTest = { at: Date.now(), results: out.results, recommendation: out.recommendation };
    logToFile(`[connection-test] ${out.results.map((r) => `${r.streams}x: ${r.mbps} MB/s, ${r.stalls} stalls, ${r.errors} errors`).join(' | ')} => ${out.recommendation.value || 'auto'}`);
    return { ok: true, ...out };
  } catch (e) {
    logToFile(`[connection-test] failed: ${e.message}`);
    return { ok: false, error: e.message || 'The test could not run.' };
  } finally {
    connectionTestRunning = false;
  }
});

// "Send log to staff": the debug log with personal details removed goes to the ARMGDDN site, which answers a short code
// (LOG-ABCD-2345). The member pastes the code in the support chat and Tulip reads the log from it.
ipcMain.handle('send-support-log', async () => {
  try {
    const token = sessionToken || loadSession();                // may be empty or expired: the site takes a cleaned log either way
    const logPath = getDebugLogPath();
    let size;
    try { size = fs.statSync(logPath).size; } catch (e) { return { ok: false, error: 'There is no log yet. Use the app for a bit and try again.' }; }
    const len = Math.min(size, 1536 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(logPath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const log = supportDiagnostics() + require('./setupReport').cleanLog(buf.toString('utf8'));
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

// Show native message box (Yes/No)
ipcMain.handle('show-message-box', async (event, options) => {
  let parent = getDialogParentWindow();
  // While the native window is the one on screen, the classic window is hidden: a box owned by it appeared behind everything (the update prompt of the
  // hourly check, Nov 20) and, being synchronous, stopped the main process answering the native window until someone found and closed it. The box now
  // belongs to the window in use and does not block anything.
  try { if (NATIVE_PREVIEW && nativeWindow && !nativeWindow.isDestroyed() && !progressWin) parent = nativeWindow; } catch (e) { }
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
    const filePath = getHelp7zVideoFilePath();
    const fileUrl = pathToFileURL(filePath).toString();
    logToFile('[7z-video] resolved help video URL: ' + fileUrl);
    return fileUrl;
  } catch (e) {
    logToFile('[7z-video] failed to resolve help video URL: ' + e.message);
    throw e;
  }
});

// Get download history
ipcMain.handle('get-history', () => {
  return downloadHistory;
});

// Clear history
ipcMain.handle('clear-history', () => {
  downloadHistory = [];
  saveHistory();
  return true;
});

// Get active downloads
ipcMain.handle('get-downloads', () => {
  const downloads = [];
  for (const [id, download] of activeDownloads) {
    downloads.push(downloadToRenderer(download));
  }
  return downloads;
});

// Fetch manifest from URL (handles CORS)
ipcMain.handle('fetch-manifest', async (event, manifestUrl, token) => {
  // Use the Companion's own session token; renderer may pass null for deep-link flows.
  const effectiveToken = token || sessionToken;
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
  let token = sessionToken;
  if (!isValidToken(token)) {
    // No session — open auth window so user can log in, then retry once.
    logToFile('resolve-download-token: no session, opening auth window');
    await openAuthWindow();
    token = sessionToken;
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
    sessionToken = null;
    openAuthWindow().catch(() => {});
    throw new Error('Your session expired. Please log in again and retry the download.');
  }
  throw new Error(result.errMsg);
});

// Debug log to file for troubleshooting

// Start download
ipcMain.handle('start-download', async (event, manifest, token, manifestUrl, dest) => {
  // Use the Companion's own session token; renderer may pass null for deep-link flows.
  const effectiveToken = token || sessionToken;
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
      for (const [, d] of activeDownloads.entries()) {
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
  const destFolder = dest === 'music' ? settings.musicFolder : dest === 'comics' ? settings.comicsFolder : '';
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

  // DISK SPACE CHECK
  try {
    const targetPath = path.resolve(toComics ? destFolder : settings.downloadPath);
    const freeBytes = getFreeDiskSpace(targetPath);

    if (freeBytes !== -1 && totalSize > 0) {
      const SAFETY_BUFFER = 500 * 1024 * 1024; // 500 MB
      const requiredForDownload = totalSize + SAFETY_BUFFER;

      // Check 1: Enough space for download?
      if (freeBytes < requiredForDownload) {
        const msg = `Not enough disk space to download this game.\n\nRequired: ${formatBytes(requiredForDownload)}\nAvailable: ${formatBytes(freeBytes)}\n\nPlease free up some space and try again.`;
        throw new Error(msg);
      }

      // Check 2: If auto-extract is on, do we have enough for download + extract?
      // Heuristic: Extraction needs roughly same size again (total * 2).
      const autoExtractOn = !!(settings && settings.autoExtract7z);
      const extractElsewhere = autoExtractOn && settings.extractFolder && path.isAbsolute(settings.extractFolder) && fs.existsSync(settings.extractFolder) && !toComics;
      let extractFree = freeBytes;
      if (extractElsewhere) { try { const ef = getFreeDiskSpace(path.resolve(settings.extractFolder)); if (ef !== -1) extractFree = ef; } catch (e) { } }
      if (autoExtractOn) {
        // Extracting to another drive: the unpacked game needs room there; the download drive only needs the archives.
        const requiredForExtract = extractElsewhere ? (totalSize + SAFETY_BUFFER) : (totalSize * 2) + SAFETY_BUFFER;
        if ((extractElsewhere ? extractFree : freeBytes) < requiredForExtract) {
          // We have enough to download (passed Check 1) but not enough to extract.
          // Ask user what to do.
          const { response } = await withDialogFocus(() => dialog.showMessageBox(getDialogParentWindow(), {
            type: 'question',
            buttons: ['Download Only (Disable Auto-Extract)', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Insufficient Disk Space for Extraction',
            message: 'Not enough disk space for automatic extraction.',
            detail: `You have enough space to download the files, but not enough to extract them automatically.\n\nSpace Available: ${formatBytes(extractElsewhere ? extractFree : freeBytes)}\nRequired for ${extractElsewhere ? 'Extraction' : 'Download + Extraction'}: ~${formatBytes(requiredForExtract)}\n\nDo you want to proceed with the download only? You will need to extract the files manually later or free up space.`
          }));

          if (response === 1) {
            // User cancelled
            return null; // Return null to indicate cancellation without error to renderer (or handle appropriately)
          } else {
            // User chose Download Only
            forceDisableAutoExtract = true;
          }
        }
      }
    }

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
    // Pass through explicit errors (like "Not enough space"), ignore others
    if (e.message && e.message.startsWith('Not enough disk space')) {
      throw e;
    }
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
  activeDownloads.set(downloadId, download);
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
  const downloadDir = toComics ? path.resolve(destFolder) : resolveInside(settings.downloadPath, name);
  if (!downloadDir) {
    throw new Error('Security error: Invalid download folder path');
  }
  download.toComics = toComics;
  download.rootDir = toComics ? downloadDir : '';
  download.openDir = commonOpenDir(downloadDir, toComics ? files : null);   // what "Open folder" shows: the album or series folder, not the whole library
  if (toComics) download.forceDisableAutoExtract = true;
  download.downloadDir = downloadDir; // Stored for the periodic mid-download disk-space check in updateProgress()
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
        ? withSupportFooter(
          `Can't create the download folder because drive ${missingDrive} isn't available right now. (${msg})`,
          `Reconnect drive ${missingDrive}, or change the download folder in settings to a drive that is connected, then retry.`
        )
        : withSupportFooter(
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
    try { activeDownloads.delete(downloadId); } catch (e2) { }
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
    try { hashCheck.saveManifest(app.getPath('userData'), { id: downloadId, name, downloadDir, files: allFiles }); } catch (eHash) { }
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
    const requestedParallelNow = Number(settings && settings.maxConcurrentDownloads);
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
});

// Throttle UI updates per download
const lastUIUpdate = new Map();
const UI_UPDATE_INTERVAL = 500; // Update UI every 500ms max
let lastProgressReport = 0; // Throttle server progress reports
let progressReportMinIntervalMs = 2000;
let progressReportBackoffUntilMs = 0;
let lastServerNoticeText = '';
let lastServerNoticeUntilMs = 0;

// Periodically re-check downloads to ensure completion isn't missed when rclone
// stops emitting progress lines near the end.
setInterval(() => {
  try {
    for (const [id, download] of activeDownloads.entries()) {
      if (!download) continue;
      if (download.status !== 'in_progress' && download.status !== 'downloading' && download.status !== 'starting') continue;

      pruneActiveProcesses(download);

      clampProgressUnlessFinal(download);

      const hasErrors = Array.isArray(download.failedFiles) && download.failedFiles.length > 0;
      const hasActive = Array.isArray(download.activeProcesses) && download.activeProcesses.length > 0;
      const isHardComplete = !!(
        !download.cancelled &&
        !download.paused &&
        !hasErrors &&
        !hasActive &&
        typeof download.progress === 'number' &&
        download.progress >= 100
      );

      if (isHardComplete) {
        completeDownload(id);
        continue;
      }

      // If there are errors and nothing is active, the download is stuck — finalize it as failed.
      // Skip while a recovery retry (token refresh / mirror failover) is in flight —
      // activeProcesses is legitimately empty during that window (manifest refetch,
      // between the old rclone process closing and the new one spawning).
      if (hasErrors && !hasActive && !download.recovering) {
        logToFile(`[Poll] Download ${id} has errors and no active processes — finalizing as failed`);
        updateProgress(id);
        download.status = 'failed';
        reportDirectGrantEnd(download);
        activeDownloads.delete(id);
        continue;
      }

      if (shouldFinalizeDownload(download)) {
        completeDownload(id);
      } else {
        if (download.progress >= 100) {
          download.progress = 99;
          try {
            if (mainWindowAlive()) {
              sendToMain('download-progress', {
                id,
                status: download.status,
                progress: download.progress,
                downloadedSize: download.downloadedSize,
                totalSpeed: download.totalSpeed,
                activeFiles: Object.values(download.activeFiles || {}),
                completedFiles: download.completedFiles,
                fileCount: download.fileCount
              });
            }
          } catch (e) { }
        }
      }
    }
  } catch (e) { }
}, 2000);

// Cancel download
ipcMain.handle('cancel-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  const download = activeDownloads.get(downloadId);
  if (!download) return true;
  if (download.cancelCleanupPromise) return await download.cancelCleanupPromise;
  if (download.restored) {          // a download brought back after a restart: nothing is running and nothing is known to delete, so it only leaves the list
    endOrphanedGrant(download);
    activeDownloads.delete(downloadId); dropInflight(downloadId);
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
      if (activeDownloads.get(downloadId) === download) activeDownloads.delete(downloadId);
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
    const download = activeDownloads.get(String(id));
    if (download) {
      download.userPriority = n - index;
    }
  });
  schedulerPump();
  return true;
});

// ---- Quiet hours (Settings): downloads pause or slow down inside a weekly window. A tick every 15 s applies the change; downloads that
// the schedule paused are resumed when the window ends, downloads the member paused themselves are left alone.
let lastScheduleLimit = null;
let lastScheduleBanner = '';
ipcMain.handle('get-schedule-banner', () => lastScheduleBanner);

ipcMain.handle('pause-download', (event, downloadId) => pauseDownloadById(downloadId));

ipcMain.handle('resume-download', async (event, downloadId) => {
  if (!isValidDownloadId(downloadId)) return false;
  const download = activeDownloads.get(downloadId);
  if (!download) return false;

  if (!download.paused) {
    return false;
  }
  if (download.restored) return resumeRestoredDownload(downloadId);

  try {
    await resumeDownloadFiles(downloadId);
    return true;
  } catch (e) {
    console.error('Resume download error:', e);
    return false;
  }
});

// Told once, with an "I understand" button, the first time that combination is in force.
let hashGateNoticeOpen = false;
const hashChecksRunning = new Map();      // download id -> { cancelled }

ipcMain.handle('verify-download-files', (event, id) => runHashCheck(id));
ipcMain.handle('cancel-hash-check', (event, id) => { const st = hashChecksRunning.get(String(id)); if (st) st.cancelled = true; return !!st; });
ipcMain.handle('get-hash-check-info', (event, id) => {
  const doc = hashCheck.loadManifest(app.getPath('userData'), String(id));
  if (!doc) return { available: false, gated: hashingGated() };
  return { available: !hashingGated(), gated: hashingGated(), files: doc.files.length, totalFiles: doc.totalFiles, lastCheck: doc.lastCheck || null, lastCheckText: doc.lastCheck ? hashCheck.describeResult(doc.lastCheck) : '', running: hashChecksRunning.has(String(id)) };
});

// Open folder: the folder of the download whose id the window passes (its real folder: an album, a series, the unpacked game); the main
// download folder when the id is not known (older entries, the classic window).
ipcMain.handle('open-folder', async (event, arg) => {
  try {
    const id = typeof arg === 'string' ? arg : '';
    const src = id ? (activeDownloads.get(id) || (Array.isArray(downloadHistory) ? downloadHistory.find((x) => x && x.id === id) : null)) : null;
    const dir = src ? String(src.extractedTo || src.openDir || src.folder || '') : '';
    if (dir && fs.existsSync(dir)) { await shell.openPath(dir); return; }
  } catch (e) { }
  shell.openPath(settings.downloadPath);
});

// Security (M1): Hostname allowlist for open-external — protocol check alone is insufficient.
const ALLOWED_EXTERNAL_HOSTS = new Set([
  't.me',
  'telegram.me',
  'github.com',
  'armgddnbrowser.com',
  'www.armgddnbrowser.com',
  'komga.org',
]);

// Open external URL in browser
ipcMain.handle('open-external', (event, url) => {
  // Security: Only allow HTTPS URLs to allowlisted hostnames
  try {
    if (typeof url !== 'string' || !url) return { success: false, error: 'Invalid URL' };
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname) return { success: false, error: 'Only HTTPS allowed' };
    if (!ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      logToFile(`open-external rejected - host not allowed: ${u.hostname}`);
      return { success: false, error: 'Host not allowed' };
    }
    shell.openExternal(u.toString());
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Invalid URL' };
  }
});

// Get app version
ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// Check connection to server (verifies session is valid)
ipcMain.handle('check-connection', async () => {
  return verifySession();
});

// Open login window
ipcMain.handle('open-login', async () => {
  return openAuthWindow();
});

// Get session status
ipcMain.handle('get-session-status', async () => {
  return {
    hasSession: !!sessionToken,
    isValid: await verifySession()
  };
});

// Reads the bundled curated "What's New" content for a given (unpadded semver)
// version string, e.g. "5.1.0" — must match app.getVersion()/package.json's
// version field exactly, NOT the zero-padded tag format used for git tags.
// Returns null if the file is missing/unparseable or has no entry for that version.
let whatsNewContentCache = null;
ipcMain.handle('check-updates', async () => safeUpdateResult(await fetchLatestReleaseInfo()));

// A Companion left running (a PC that stays on, the app in the tray) never saw a new release: the check ran only at start-up. This checks once an
// hour in the main process, so it works with every window closed. A new version is announced once: an OS notification (when notifications are on)
// and a message to whichever windows are open, which show their own update prompt.
const UPDATE_POLL_MS = 60 * 60 * 1000;
let _updateAnnouncedVersion = '';
// Guard against concurrent install-update calls (e.g. the double-runner loop caused by
// a relaunch-on-failure bug in older runners).  Once an install is in flight, any
// subsequent call is silently rejected until the process exits or the install fails.
let _installUpdateInProgress = false;

// Download and install update
// Security (C1/H1): The renderer-supplied URL is ignored entirely. The installer URL is
// derived freshly in the main process from the GitHub releases API to prevent renderer
// compromise from redirecting the update to an attacker-controlled URL.
ipcMain.handle('install-update', async (event, _ignoredRendererUrl, options) => {
  // A copy that is not the installed app (a dev run, a test copy that imported the real app's settings, auto-update included) must never run an
  // installer: it would silently replace the member's real Companion and relaunch it (a test copy did exactly that on 2026-11-18).
  if (!app.isPackaged && process.env.ARMGDDN_ALLOW_DEV_UPDATE !== '1') {
    logToFile('Update - not installing from an unpackaged copy');
    return { success: false, error: 'Updates are only installed by the packaged app' };
  }
  if (_installUpdateInProgress) {
    logToFile('install-update: another install is already in progress — ignoring duplicate call');
    return { success: false, error: 'Another update install is already in progress' };
  }
  try {
    const rp = path.join(app.getPath('userData'), 'update-result.json');
    if (fs.existsSync(rp) && updateRunner.installIsRunning(fs.readFileSync(rp, 'utf8'), fs.statSync(rp).mtimeMs)) {
      logToFile('install-update: an installer from an earlier start is still running -- not starting another');
      return { success: false, error: 'An update is already installing' };
    }
  } catch (e) { }
  // Updating restarts the app: with a download running, say so now and change nothing (the installer must not start and then be argued with at quit time).
  if (anyDownloadRunning()) {
    logToFile('install-update: a download is running; not updating now');
    return { success: false, error: 'A download is running. Pause or finish it, then update.' };
  }
  _installUpdateInProgress = true;

  const opts = (options && typeof options === 'object') ? options : {};
  const silent = !!opts.silent;
  const relaunchAfterInstall = !!opts.relaunchAfterInstall;

  // Derive the installer URL internally — never trust the renderer-supplied value
  let installerUrl;
  let installerSize = 0;
  let updateVersion = '';
  try {
    const releaseInfo = await fetchLatestReleaseInfo();
    installerUrl = releaseInfo.installerUrl || null;
    installerSize = releaseInfo.installerSize || 0;
    updateVersion = /^\d+\.\d+\.\d+$/.test(String(releaseInfo.latestVersion || '')) ? String(releaseInfo.latestVersion) : '';
    if (!installerUrl) {
      _installUpdateInProgress = false;
      return { success: false, error: 'No installer available for this platform' };
    }
  } catch (e) {
    _installUpdateInProgress = false;
    return { success: false, error: 'Failed to fetch installer URL: ' + (e && e.message ? e.message : String(e)) };
  }

  // Enforce HTTPS + allowlisted host + expected GitHub releases path
  try {
    const u = new URL(String(installerUrl));
    if (u.protocol !== 'https:' || !isAllowedUpdateHost(u.hostname)) {
      logToFile(`Update - installer URL not allowed: host=${u.hostname} url=${installerUrl}`);
      _installUpdateInProgress = false;
      return { success: false, error: `Installer URL not allowed (${u.hostname})` };
    }
    // Enforce that the path is a GitHub releases asset path
    const p = u.pathname;
    if (u.hostname === 'github.com' && !p.startsWith('/Nildyanna/armgddn-downloader/releases/')) {
      logToFile(`Update - installer path rejected: ${p}`);
      _installUpdateInProgress = false;
      return { success: false, error: 'Installer URL path not allowed' };
    }
  } catch (e) {
    _installUpdateInProgress = false;
    return { success: false, error: 'Invalid installer URL' };
  }

  // The ARMGDDN App (native window) shows the update inside its own window: download, checking and "closing to install" arrive on
  // native:update, and the install screen that follows looks like the app (updateRunner.screenSpec). The old app keeps the popup window.
  const nativeAlive = () => { try { return !!nativeWindow && !nativeWindow.isDestroyed(); } catch (e) { return false; } };
  const inApp = NATIVE_PREVIEW && nativeAlive();
  // Show progress window
  let progressWinReady = false;
  const pendingUpdateEvents = [];
  const flushPendingUpdateEvents = () => {
    if (!progressWin || progressWin.isDestroyed() || !progressWinReady) return;
    while (pendingUpdateEvents.length > 0) {
      const evt = pendingUpdateEvents.shift();
      try {
        progressWin.webContents.send(evt.channel, evt.payload);
      } catch (e) { }
    }
  };
  const safeSendUpdateEvent = (channel, payload) => {
    if (inApp) { try { if (nativeAlive()) nativeWindow.webContents.send('native:update', { channel, payload, version: updateVersion }); } catch (e) { } return; }
    if (!progressWin || progressWin.isDestroyed()) return;
    if (progressWinReady) {
      try {
        progressWin.webContents.send(channel, payload);
      } catch (e) { }
      return;
    }
    pendingUpdateEvents.push({ channel, payload });
  };
  if (!inApp) try {
    progressWin = new BrowserWindow({
      width: 400,
      height: 380,
      title: 'Updating ARMGDDN App',
      // On Linux/KDE, setting parent creates a WM_TRANSIENT_FOR hint that causes KDE's
      // compositor to raise the parent (main) window whenever this window is shown or
      // receives focus. Remove the parent relationship on Linux — alwaysOnTop + skipTaskbar
      // are sufficient to keep the update overlay correctly positioned.
      ...(process.platform !== 'linux' ? { parent: mainWindow, modal: false } : {}),
      frame: false, // Remove title bar
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true, // Don't clutter the taskbar with the update overlay
      alwaysOnTop: true, // Ensure it stays on top during update
      icon: getAppIcon(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    denyNewWindows(progressWin);

    progressWin.loadFile(path.join(__dirname, 'renderer', 'update.html'));
    try { progressWin.setMenu(null); } catch (e) { }
    try {
      progressWin.webContents.on('did-finish-load', () => {
        progressWinReady = true;
        flushPendingUpdateEvents();
      });
    } catch (e) { }
    progressWin.on('closed', () => {
      progressWin = null;
    });
  } catch (e) {
    logToFile('Failed to create update progress window: ' + e.message);
  }

  const tempDir = app.getPath('temp');
  const updatesDir = path.join(app.getPath('userData'), 'updates');
  const platform = process.platform;
  const timestamp = Date.now();
  let fileName;

  if (platform === 'win32') {
    // Use unique filename to avoid EBUSY errors
    fileName = `ARMGDDN-Companion-Setup-${timestamp}.exe`;
  } else if (platform === 'linux') {
    fileName = installerUrl.endsWith('.deb')
      ? `armgddn-companion-${timestamp}.deb`
      : `ARMGDDN-Companion-${timestamp}.AppImage`;
  } else {
    fileName = `ARMGDDN-Companion-${timestamp}.dmg`;
  }

  const downloadDir = (platform === 'linux') ? updatesDir : tempDir;
  const filePath = path.join(downloadDir, fileName);

  const cleanupPartialInstaller = () => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) { }
  };
  const MAX_INSTALLER_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB safety cap
  // Signature assets live alongside the original GitHub release asset URL.
  // After redirects, the installer download URL often becomes a time-limited
  // objects.githubusercontent.com URL with query params; appending .sig to that
  // will fail. Always derive the signature URL from the original installerUrl.
  const signatureUrlBase = (() => {
    try {
      const u = new URL(installerUrl);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (e) {
      return (installerUrl || '').split('#')[0].split('?')[0];
    }
  })();

  return new Promise((resolve) => {
    // Wrap resolve so _installUpdateInProgress is always cleared on failure paths.
    // On the Windows success path the process is about to quit, so we leave the
    // flag set to prevent any race-window duplicate while the quit is pending.
    // IMPORTANT: capture the original Promise resolve before shadowing it —
    // otherwise _resolve calls itself and blows the stack.
    const _originalResolve = resolve;
    const _resolve = (val) => {
      if (!val || val.success === false) {
        _installUpdateInProgress = false;
      }
      _originalResolve(val);
    };
    // Shadow `resolve` so all existing raw resolve() calls below use the wrapper.
    // eslint-disable-next-line no-param-reassign
    resolve = _resolve;

    const downloadSignature = (url, redirectCount = 0) => {
      return new Promise((resolveSig) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          resolveSig(result);
        };

        if (redirectCount > 5) {
          finish({ ok: false, error: 'Too many redirects' });
          return;
        }

        let parsed;
        try {
          parsed = new URL(url);
        } catch (e) {
          finish({ ok: false, error: 'Invalid signature URL' });
          return;
        }

        if (parsed.protocol !== 'https:') {
          finish({ ok: false, error: 'Only HTTPS update downloads are allowed' });
          return;
        }

        if (!isAllowedUpdateHost(parsed.hostname)) {
          finish({ ok: false, error: `Update download host not allowed (${parsed.hostname})` });
          return;
        }

        const reqSig = https.get(url, { headers: { 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
          let ended = false;
          res.on('aborted', () => {
            finish({ ok: false, error: 'Signature download aborted' });
          });
          res.on('close', () => {
            // Only treat close as a failure if it happens before the response ends.
            if (!ended) finish({ ok: false, error: 'Signature download closed early' });
          });

          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (!location) {
              finish({ ok: false, error: 'Redirect with no location' });
              return;
            }
            const nextUrl = location.startsWith('http') ? location : new URL(location, parsed).toString();
            downloadSignature(nextUrl, redirectCount + 1).then(finish);
            return;
          }

          if (res.statusCode !== 200) {
            finish({ ok: false, error: `Download failed with status ${res.statusCode}` });
            return;
          }

          let data = '';
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 65536) {
              try { res.destroy(new Error('Signature too large')); } catch (e) { }
              return;
            }
            data += chunk.toString('utf8');
          });
          res.on('end', () => {
            ended = true;
            finish({ ok: true, text: data });
          });
          res.on('error', (err) => {
            finish({ ok: false, error: err && err.message ? err.message : 'Signature download error' });
          });
        });

        reqSig.setTimeout(15000, () => {
          try { reqSig.destroy(new Error('Signature request timeout')); } catch (e) { }
        });
        reqSig.on('error', (err) => {
          finish({ ok: false, error: err && err.message ? err.message : 'Signature request error' });
        });
      });
    };

    // Download the installer
    const downloadInstaller = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      let parsed;
      try {
        parsed = new URL(url);
      } catch (e) {
        resolve({ success: false, error: 'Invalid download URL' });
        return;
      }

      if (parsed.protocol !== 'https:') {
        resolve({ success: false, error: 'Only HTTPS update downloads are allowed' });
        return;
      }

      if (!isAllowedUpdateHost(parsed.hostname)) {
        logToFile(`Update - blocked download host: host=${parsed.hostname} url=${url}`);
        resolve({ success: false, error: `Update download host not allowed (${parsed.hostname})` });
        return;
      }

      const reqDl = https.get(url, { headers: { 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (!location) {
            cleanupPartialInstaller();
            resolve({ success: false, error: 'Redirect with no location' });
            return;
          }
          logToFile(`Update - redirect: from=${url} to=${location}`);
          const nextUrl = location.startsWith('http') ? location : new URL(location, parsed).toString();
          return downloadInstaller(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          cleanupPartialInstaller();
          resolve({ success: false, error: `Download failed with status ${res.statusCode}` });
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'], 10);
        if (Number.isFinite(totalBytes) && totalBytes > MAX_INSTALLER_BYTES) {
          cleanupPartialInstaller();
          resolve({ success: false, error: 'Installer too large' });
          try { res.destroy(new Error('Installer too large')); } catch (e) { }
          return;
        }

        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
        } catch (e) { }

        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);

        let receivedBytes = 0;
        let startTime = Date.now();

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_INSTALLER_BYTES) {
            try { res.destroy(new Error('Installer too large')); } catch (e) { }
            try { fileStream.destroy(new Error('Installer too large')); } catch (e) { }
            cleanupPartialInstaller();
            resolve({ success: false, error: 'Installer too large' });
            return;
          }
          if (progressWin && !progressWin.isDestroyed()) {
            safeSendUpdateEvent('update-progress', updateRunner.progressPayload(receivedBytes, totalBytes, installerSize, (Date.now() - startTime) / 1000));
          }
        });

        fileStream.on('finish', () => {
          fileStream.close(() => {
            safeSendUpdateEvent('update-status', 'Verifying update...');

            let verifyResolved = false;
            const resolveOnce = (val) => {
              if (verifyResolved) return;
              verifyResolved = true;
              try {
                if (verifyTimeout) clearTimeout(verifyTimeout);
              } catch (e) { }
              // On failure paths, clear the in-progress flag so the user can retry.
              // On the Windows success path the process is about to quit anyway.
              if (!val || val.success === false) {
                _installUpdateInProgress = false;
              }
              resolve(val);
            };

            const VERIFY_TIMEOUT_MS = 20000;
            const verifyTimeout = setTimeout(() => {
              try {
                logToFile('Update - verification timed out');
              } catch (e) { }
              try { safeSendUpdateEvent('update-status', 'Manual update required: verification timed out.'); } catch (e) { }
              resolveOnce({ success: false, error: 'Update verification timed out' });
            }, VERIFY_TIMEOUT_MS);

            const failUpdate = (publicMsg, internalErr) => {
              try {
                logToFile(`Update - verification failed: ${internalErr || publicMsg}`);
              } catch (e) { }

              try { safeSendUpdateEvent('update-status', `Manual update required: ${publicMsg}`); } catch (e) { }
            };

            try {
              const pubKeyPem = getUpdateEd25519PublicKeyPem();
              if (!pubKeyPem) {
                failUpdate('Update verification unavailable (missing public key).', 'Missing Ed25519 public key');
                resolveOnce({ success: false, error: 'Update signature verification unavailable (missing public key)' });
                return;
              }
            } catch (e) {
              failUpdate('Update verification unavailable.', e && e.message ? e.message : 'Public key load error');
              resolveOnce({ success: false, error: 'Update signature verification unavailable' });
              return;
            }

            const sigUrl = `${signatureUrlBase}.sig`;
            try { safeSendUpdateEvent('update-status', 'Downloading signature...'); } catch (e) { }
            logToFile(`Update - verifying: downloading signature: ${sigUrl}`);
            const withTimeout = (p, ms, label) => {
              let t = null;
              const timeoutPromise = new Promise((_, reject) => {
                t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
              });
              return Promise.race([p, timeoutPromise]).finally(() => {
                try { if (t) clearTimeout(t); } catch (e) { }
              });
            };

            withTimeout(downloadSignature(sigUrl), 30000, 'signature download').then(async (sigRes) => {
              if (!sigRes || sigRes.ok !== true || !sigRes.text) {
                try {
                  logToFile(`Update - signature download failed: url=${sigUrl} err=${sigRes && sigRes.error ? sigRes.error : 'unknown'}`);
                } catch (e) { }
                failUpdate('Update signature missing.', sigRes && sigRes.error ? sigRes.error : 'Signature download failed');
                resolveOnce({ success: false, error: 'Update signature missing or could not be downloaded' });
                return;
              }

              const sigBuf = decodeBase64Signature(sigRes.text);
              if (!sigBuf) {
                failUpdate('Update signature invalid.', 'Invalid base64 signature');
                resolveOnce({ success: false, error: 'Update signature invalid' });
                return;
              }

              logToFile(`Update - verifying: reading installer: ${filePath}`);
              try { safeSendUpdateEvent('update-status', 'Reading installer...'); } catch (e) { }
              let installerBytes = null;
              try {
                installerBytes = await fs.promises.readFile(filePath);
              } catch (e) {
                failUpdate('Failed to read downloaded installer.', e && e.message ? e.message : 'Read error');
                resolveOnce({ success: false, error: 'Failed to read downloaded installer for verification' });
                return;
              }

              // Yield the event loop so the update window stays responsive even on large installers.
              await new Promise((r) => setImmediate(r));

              const pubKeyPem = getUpdateEd25519PublicKeyPem();
              try { safeSendUpdateEvent('update-status', 'Checking signature...'); } catch (e) { }
              logToFile('Update - verifying: checking Ed25519 signature');
              const ok = verifyEd25519Signature(installerBytes, sigBuf, pubKeyPem);
              if (!ok) {
                failUpdate('Update verification failed.', 'Ed25519 signature check failed');
                resolveOnce({ success: false, error: 'Update signature verification failed' });
                return;
              }

              safeSendUpdateEvent('update-status', 'Installing update... The app will restart shortly.');

              // Run the installer after app exits
              try {
                if (platform === 'win32') {
                  // Log paths for debugging
                  logToFile(`Update - tempDir: ${tempDir}`);
                  logToFile(`Update - filePath: ${filePath}`);
                  logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);

                  const installerArgs = [];
                  if (silent) installerArgs.push('/S');

                  // We want the app to be closed before the installer replaces files.
                  // On Windows, run a detached PowerShell wrapper that:
                  // 1) waits for this app PID to exit
                  // 2) runs the installer (optionally /S)
                  // 3) if requested, relaunches the app
                  // Security (C2/M5): Use PowerShell with single-quoted paths to prevent
                  // batch metacharacter injection. Runner scripts written to userData
                  // (user-owned) instead of temp (world-writable).
                  try {
                    const pid = process.pid;
                    const shouldRelaunch = relaunchAfterInstall;
                    const wrapperLogPath = path.join(app.getPath('userData'), 'update-wrapper.log');
                    const resultPath = path.join(app.getPath('userData'), 'update-result.json');
                    // Write runner to userData (user-owned, not world-writable) — fixes M5
                    const runnerPath = path.join(app.getPath('userData'), `armgddn-update-runner-${Date.now()}.ps1`);
                    // Prefer relaunching via the Start Menu shortcut: a shell-activated launch
                    // (same as the user double-clicking it) gives Windows the correct taskbar
                    // icon (via the shortcut's AppUserModelID) and foreground rights. Launching
                    // the bare exe from the detached runner loses both. Fall back to the exe.
                    const startMenuShortcut = (process.platform === 'win32' && process.env.APPDATA)
                      ? shortcutNames.startMenuShortcutPath(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), fs)
                      : '';

                    // Escape single quotes for PowerShell single-quoted strings by doubling them
                    function escapePsPath(p) {
                      return "'" + String(p).replace(/'/g, "''") + "'";
                    }

                    try {
                      fs.appendFileSync(wrapperLogPath, `[${new Date().toISOString()}] preparing update runner\r\n`, { encoding: 'utf8' });
                    } catch (e) { }

                    // --updated makes the NSIS installer keep the user's existing shortcuts (it
                    // only does that for updates); without it every update recreated the Start
                    // Menu shortcut, even after the user moved or deleted it.
                    const silentArg = silent ? '/S --updated' : '--updated';
                    const runner = updateRunner.buildRunner({
                      pid, filePath, appExe: process.execPath, wrapperLogPath, resultPath, silentArg, shouldRelaunch, shortcut: startMenuShortcut, appName: NATIVE_PREVIEW ? 'ARMGDDN App' : 'ARMGDDN Companion',
                      screen: inApp ? installScreen(opts.screen, updateVersion) : null
                    });
                    // Tell any app that starts while the installer works (the member opens it again) not to start a second install.
                    try { fs.writeFileSync(resultPath, JSON.stringify({ state: 'installing', ts: Date.now() })); } catch (e) { }

                    try {
                      fs.writeFileSync(runnerPath, runner, { encoding: 'utf8' });
                      logToFile(`Update - wrote ps1 runner: ${runnerPath}`);
                      logToFile(`Update - wrapper log: ${wrapperLogPath}`);
                    } catch (writeErr) {
                      logToFile(`Update - failed to write update runner: ${writeErr && writeErr.message ? writeErr.message : writeErr}`);
                      resolve({ success: false, error: 'Failed to prepare installer runner script' });
                      return;
                    }

                    logToFile(`Update - launching PowerShell runner (silent=${silent} relaunch=${relaunchAfterInstall})`);
                    // Launch PowerShell hidden and detached.
                    // Use the absolute System32 path — NEVER bare 'powershell.exe' — so a
                    // powershell.exe shim earlier in the user's PATH cannot shadow the real
                    // host (that exact case caused the updater to silently no-op).
                    // Launch via `cmd /c start` so the runner (a) gets a console — Windows
                    // PowerShell's host fails to initialize under DETACHED_PROCESS with no
                    // console — and (b) outlives this app when it quits a moment later.
                    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
                    const psChild = spawn(process.env.COMSPEC || 'cmd.exe', [
                      '/c', 'start', '/min', '""', psExe,
                      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
                      '-ExecutionPolicy', 'Bypass',
                      '-File', runnerPath
                    ], { detached: true, stdio: 'ignore', windowsHide: true });
                    psChild.unref();
                    setTimeout(() => {
                      app.isQuitting = true;
                      app.quit();
                      resolveOnce({ success: true });
                    }, 3000); // Increased delay to let user read the "Installing..." message
                    return;
                  } catch (spawnErr) {
                    logToFile(`Update - failed to spawn installer wrapper: ${spawnErr && spawnErr.message ? spawnErr.message : spawnErr}`);
                    resolveOnce({ success: false, error: 'Failed to launch installer process' });
                    return;
                  }

                  // Windows branch returns from the setTimeout above.
                } else if (platform === 'linux') {
                  logToFile(`Update - filePath: ${filePath}`);
                  logToFile(`Update - file exists: ${fs.existsSync(filePath)}`);

                  if (filePath.endsWith('.AppImage')) {
                    // Make executable
                    fs.chmodSync(filePath, '755');

                    // Handle AppImage replacement if running as an AppImage
                    if (process.env.APPIMAGE) {
                      logToFile(`Update - Running as AppImage at ${process.env.APPIMAGE}`);
                      const currentPath = process.env.APPIMAGE;
                      const updateScriptPath = path.join(path.dirname(filePath), `update-armgddn-${Date.now()}.sh`);

                      // Security (H2): Escape all paths inserted into bash using single-quote
                      // wrapping to prevent shell metacharacter injection from APPIMAGE env var.
                      function escapeBashSingleQuote(p) {
                        return "'" + String(p).replace(/'/g, "'\\''") + "'";
                      }

                      // Create a script to replace the old AppImage with the new one
                      const scriptContent = [
                        '#!/bin/bash',
                        '# Wait for the main application to close',
                        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
                        '',
                        '# Move old version to backup',
                        `mv ${escapeBashSingleQuote(currentPath)} ${escapeBashSingleQuote(currentPath + '.old')}`,
                        '',
                        '# Move new version to original location',
                        `mv ${escapeBashSingleQuote(filePath)} ${escapeBashSingleQuote(currentPath)}`,
                        `chmod +x ${escapeBashSingleQuote(currentPath)}`,
                        '',
                        '# Launch new version',
                        `${escapeBashSingleQuote(currentPath)} &`,
                        'exit 0'
                      ].join('\n');

                      try {
                        fs.writeFileSync(updateScriptPath, scriptContent, { mode: 0o755 });
                        logToFile(`Update - Created replacement script at ${updateScriptPath}`);

                        const child = spawn(updateScriptPath, [], {
                          detached: true,
                          stdio: 'ignore'
                        });
                        child.unref();

                        safeSendUpdateEvent('update-status', 'Restarting updated version...');

                        setTimeout(() => {
                          app.isQuitting = true;
                          app.quit();
                          resolve({ success: true, installerPath: filePath });
                        }, 3000); // Increased delay to allow installer to fully start
                        return;
                      } catch (err) {
                        logToFile(`Update - Failed to create/run replacement script: ${err.message}`);
                        // Fallback to simple launch if replacement fails
                      }
                    }

                    logToFile('Update - launching AppImage (no replacement)');

                    safeSendUpdateEvent('update-status', 'Restarting into new version...');

                    let spawnFailed = false;
                    let resolved = false;
                    const child = spawn(filePath, [], {
                      detached: true,
                      stdio: 'ignore'
                    });
                    child.on('error', (err) => {
                      spawnFailed = true;
                      logToFile(`Update - AppImage spawn error: ${err && err.message ? err.message : err}`);
                    });
                    child.unref();

                    setTimeout(() => {
                      if (resolved) return;
                      resolved = true;

                      if (spawnFailed) {
                        shell.showItemInFolder(filePath);
                        resolve({ success: true, message: 'Update downloaded but could not be launched automatically. Please install manually.' });
                        return;
                      }

                      app.isQuitting = true;
                      app.quit();
                      resolve({ success: true, installerPath: filePath });
                    }, 2000); // Increased delay for AppImage

                    return;
                  } else {
                    // For .deb, open file manager or show location
                    shell.showItemInFolder(filePath);
                    resolve({ success: true, message: 'Installer downloaded. Please install manually.' });
                    return;
                  }
                } else {
                  // macOS - open the DMG
                  shell.openPath(filePath);
                  resolve({ success: true, message: 'Installer opened. Please complete installation.' });
                  return;
                }
              } catch (e) {
                resolveOnce({ success: false, error: e.message });
              }
            }).catch((e) => {
              failUpdate('Update verification failed.', e && e.message ? e.message : 'Verification error');
              resolveOnce({ success: false, error: 'Update verification failed' });
            });
          });
        });

        fileStream.on('error', (err) => {
          cleanupPartialInstaller();
          resolve({ success: false, error: err.message });
        });
        res.on('error', (err) => {
          logToFile(`Update - download stream error: ${err.message}`);
          if (progressWin && !progressWin.isDestroyed()) progressWin.close();
          cleanupPartialInstaller();
          resolve({ success: false, error: 'Download stream error' });
        });

      });

      reqDl.setTimeout(300000, () => {
        try { reqDl.destroy(new Error('Update download timeout')); } catch (e) { }
      });
      reqDl.on('error', (err) => {
        logToFile(`Update - request error: ${err.message}`);
        if (progressWin && !progressWin.isDestroyed()) progressWin.close();
        cleanupPartialInstaller();
        resolve({ success: false, error: 'Update request error: ' + err.message });
      });
    };

    return downloadInstaller(installerUrl);
  });
});

// Compare semantic versions (returns 1 if a > b, -1 if a < b, 0 if equal)
// Electron 44 (Companion 5.0.20 and newer) needs macOS 13, which is Darwin 22.
// Older Macs stay on the version they have instead of being offered one that won't open.
const MAC_MIN_DARWIN_MAJOR = 22;
const MAC_MIN_DARWIN_FROM_VERSION = '5.0.20';
