const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const secureStore = require('./secureStore');   // safeStorage, with the asynchronous methods Electron 46 needs (see secureStore.js)
const path = require('path');
const fs = require('fs');
const os = require('os');
const testBuild = require('./main/testBuild');
// A side-by-side test build keeps its own profile folder, set before anything reads it (main/testBuild.js).
if (testBuild.isTestBuild) { try { app.setPath('userData', path.join(app.getPath('appData'), testBuild.PROFILE_FOLDER)); } catch (e) { } }
// ---- split-out modules (docs/MAIN_SPLIT.md) ----
const { withSupportFooter } = require('./main/supportText');
const { loadSessionAsync } = require('./main/sessionAsync');
const { runSmokeTest } = require('./main/smokeTest');
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
  get ALLOWED_EXTERNAL_HOSTS() { return ALLOWED_EXTERNAL_HOSTS; },
  get ALLOWED_SERVICE_HOSTS() { return ALLOWED_SERVICE_HOSTS; },
  get ALLOWED_UPDATE_HOSTS() { return ALLOWED_UPDATE_HOSTS; },
  get AUTO_RETRY_BLOCK_RE() { return AUTO_RETRY_BLOCK_RE; },
  get AUTO_RETRY_MAX() { return AUTO_RETRY_MAX; },
  get AUTO_RETRY_TRANSIENT_RE() { return AUTO_RETRY_TRANSIENT_RE; },
  get CLOCK_CERT_RE() { return CLOCK_CERT_RE; },
  get COMICS_LIST_RE() { return COMICS_LIST_RE; },
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
  get SUPPORT_TELEGRAM_URL() { return SUPPORT_TELEGRAM_URL; },
  get UI_UPDATE_INTERVAL() { return UI_UPDATE_INTERVAL; },
  get UPDATE_ED25519_PUBLIC_KEY_PINNED() { return UPDATE_ED25519_PUBLIC_KEY_PINNED; },
  get UPDATE_POLL_MS() { return UPDATE_POLL_MS; },
  get __dirname() { return __dirname; },
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
  get connectionTestRunning() { return connectionTestRunning; }, set connectionTestRunning(v) { connectionTestRunning = v; },
  get downloadFile() { return downloadFile; },
  get downloadHistory() { return downloadHistory; }, set downloadHistory(v) { downloadHistory = v; },
  get get7zPath() { return get7zPath; },
  getAppLoadInfo,
  get getConfigPath() { return getConfigPath; },
  get getDialogParentWindow() { return getDialogParentWindow; },
  get getEmptyRcloneConfigPath() { return getEmptyRcloneConfigPath; },
  get getHelp7zVideoFilePath() { return getHelp7zVideoFilePath; },
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
  get musicGet() { return musicGet; },
  get musicState() { return musicState; },
  get nativeWindow() { return nativeWindow; }, set nativeWindow(v) { nativeWindow = v; },
  get noGpuProcess() { return noGpuProcess; }, set noGpuProcess(v) { noGpuProcess = v; },
  get pauseDownloadById() { return pauseDownloadById; },
  get pendingDeepLinks() { return pendingDeepLinks; },
  get pendingWhatsNewEntry() { return pendingWhatsNewEntry; }, set pendingWhatsNewEntry(v) { pendingWhatsNewEntry = v; },
  get pendingWhatsNewEntryNative() { return pendingWhatsNewEntryNative; }, set pendingWhatsNewEntryNative(v) { pendingWhatsNewEntryNative = v; },
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

// Set app name for dialogs and window titles
app.name = testBuild.isTestBuild ? testBuild.NAME : 'ARMGDDN Companion';

if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  try {
    app.setAppUserModelId(testBuild.isTestBuild ? testBuild.APP_ID : 'com.armgddn.downloader');
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
if (testBuild.isTestBuild) {
  protocolClientRegisterError = 'skipped (test build)';
} else if (process.argv.includes('--native') || isolatedDevRun) {
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
  installUpdatesOnQuit: true,      // install a waiting update when the app is quit (nothing downloading); see before-quit
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

require('./main/ipcKomga').register();      // IPC: komga-get-defaults, komga-cancel, komga-submit, native-komga-import, native-komga-state, native-komga-save, native-komga-forget, native-komga-lists, native-komga-add

let komgaBusy = false;
// Whatever asked the app to quit (the menu, Cmd+Q, the OS), it really quits: the close handlers that keep the app in the tray step aside.
app.on('before-quit', () => { app.isQuitting = true; });

// Quitting with an update waiting installs it on the way out, without reopening the app (Nov 24 2026: of 12 installs seen that day,
// 7 ran an older version). Only when nothing is downloading, only for the installed app, and never twice; off with the setting
// installUpdatesOnQuit. A failure just lets the app close as before.
let _quitUpdateTried = false;
app.on('before-quit', (e) => {
  try {
    if (_quitUpdateTried || _installUpdateInProgress || !_updateAnnouncedVersion || SMOKE_TEST) return;
    if (!settings || settings.installUpdatesOnQuit === false || !app.isPackaged) return;
    if (require('./main/testBuild').isTestBuild || require('./main/downloadControl').anyDownloadRunning()) return;
    const ipcApp = require('./main/ipcApp');
    if (typeof ipcApp.installUpdate !== 'function') return;
    _quitUpdateTried = true;
    e.preventDefault();
    logToFile(`[Update] quitting with ${_updateAnnouncedVersion} waiting: installing it now (no relaunch)`);
    Promise.resolve(ipcApp.installUpdate({ silent: true, relaunchAfterInstall: false }))
      .then((r) => { if (!r || r.success === false) { logToFile('[Update] install on quit did not start: ' + (r && r.error)); app.quit(); } })
      .catch((err) => { logToFile('[Update] install on quit failed: ' + (err && err.message)); app.quit(); });
  } catch (err) {
    logToFile('[Update] install on quit skipped: ' + (err && err.message));
  }
});

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
    if (process.platform === 'win32' && app.isPackaged && !testBuild.isTestBuild) {
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

require('./main/ipcSettings').register();      // IPC: get-settings, save-settings, browse-folder

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

// ---- Music: only what I'm missing (same flow as comics: pick the folder, scan, compare with the library, download the rest into it)
const musicScan = require('./musicScan');
const musicState = { running: false, worker: null, rows: null, root: '', at: 0, last: null, token: '' };
const musicGet = (pathAndQuery) => comicsGet(pathAndQuery, 'Music', musicState.token);

require('./main/ipcCollections').register();      // IPC: comics-get-state, comics-pick-folder, comics-scan, comics-cancel-scan, comics-info, comics-compare, comics-download-missing, music-get-state, music-pick-folder, music-scan, music-cancel-scan, music-info, music-compare, music-download-missing

// "Test my connection": reads ranges of one big file from the download server with 16, 8, 4 and 1 connections for a few seconds each
// (nothing is saved), and recommends a "Connections per file" value. The result is also remembered for the support log.
let lastConnectionTest = null;
let connectionTestRunning = false;
require('./main/ipcHelp').register();      // IPC: get-app-load, get-whats-new, native-pending-whats-new, check-disk-space, run-setup-check, build-setup-report, check-game-updates, run-connection-test, send-support-log, show-message-box, get-help-7z-video-src

// Debug log to file for troubleshooting

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

// ---- Quiet hours (Settings): downloads pause or slow down inside a weekly window. A tick every 15 s applies the change; downloads that
// the schedule paused are resumed when the window ends, downloads the member paused themselves are left alone.
let lastScheduleLimit = null;
let lastScheduleBanner = '';
// Told once, with an "I understand" button, the first time that combination is in force.
let hashGateNoticeOpen = false;
const hashChecksRunning = new Map();      // download id -> { cancelled }

require('./main/ipcDownloads').register();      // IPC: retry-download, get-history, clear-history, get-downloads, fetch-manifest, resolve-download-token, start-download, cancel-download, reorder-downloads, get-schedule-banner, pause-download, resume-download, verify-download-files, cancel-hash-check, get-hash-check-info, open-folder

// Security (M1): Hostname allowlist for open-external — protocol check alone is insufficient.
const ALLOWED_EXTERNAL_HOSTS = new Set([
  't.me',
  'telegram.me',
  'github.com',
  'armgddnbrowser.com',
  'www.armgddnbrowser.com',
  'komga.org',
]);

// Reads the bundled curated "What's New" content for a given (unpadded semver)
// version string, e.g. "5.1.0" — must match app.getVersion()/package.json's
// version field exactly, NOT the zero-padded tag format used for git tags.
// Returns null if the file is missing/unparseable or has no entry for that version.
let whatsNewContentCache = null;
// A Companion left running (a PC that stays on, the app in the tray) never saw a new release: the check ran only at start-up. This checks once an
// hour in the main process, so it works with every window closed. A new version is announced once: an OS notification (when notifications are on)
// and a message to whichever windows are open, which show their own update prompt.
const UPDATE_POLL_MS = 60 * 60 * 1000;
let _updateAnnouncedVersion = '';
// Guard against concurrent install-update calls (e.g. the double-runner loop caused by
// a relaunch-on-failure bug in older runners).  Once an install is in flight, any
// subsequent call is silently rejected until the process exits or the install fails.
let _installUpdateInProgress = false;

require('./main/ipcApp').register();      // IPC: open-external, get-version, check-connection, open-login, get-session-status, check-updates, install-update

// Compare semantic versions (returns 1 if a > b, -1 if a < b, 0 if equal)
// Electron 44 (Companion 5.0.20 and newer) needs macOS 13, which is Darwin 22.
// Older Macs stay on the version they have instead of being offered one that won't open.
const MAC_MIN_DARWIN_MAJOR = 22;
const MAC_MIN_DARWIN_FROM_VERSION = '5.0.20';
