'use strict';
// Failed downloads: telling an expected failure from a fault, reporting faults, and recovery notes (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { normalizeFailureLine } = require('./errors');
const Sentry = require('@sentry/electron/main');

function isExpectedDownloadFailure(errorText) {
  return ctx.EXPECTED_FAILURE_RE.test(String(errorText || '').split('\n')[0]);
}

function reportDownloadFailure(download, errorText) {
  if (!ctx.SENTRY_DSN || !ctx.isErrorReportingEnabled()) return;
  if (isDownloadAbandoned(download)) return;
  if (isExpectedDownloadFailure(errorText)) return;
  try {
    const firstLine = normalizeFailureLine(String(errorText || 'Unknown download error').split('\n')[0].slice(0, 200));
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setFingerprint(['download-failure', firstLine]);
      scope.setTag('mirror', (download && download.actualRemote) ? String(download.actualRemote) : 'unknown');
      scope.setContext('download', {
        name: download && download.name ? String(download.name) : '',
        mirrorSwitches: download ? Number(download.mirrorSwitches) || 0 : 0,
        failedFiles: download && Array.isArray(download.failedFiles) ? download.failedFiles.length : 0,
        triedMirrors: download && Array.isArray(download.triedMirrors) ? download.triedMirrors.join(',') : '',
        // Why each recovery attempt ended (see noteRecovery), so a failure that
        // never switched mirrors shows where failover stopped.
        recovery: download && Array.isArray(download.__recoveryNotes) ? download.__recoveryNotes.slice(-10) : [],
      });
      Sentry.captureMessage(`Download failed: ${firstLine}`);
    });
  } catch (e) { }
}

// True when the user cancelled, paused or removed the download. Recovery code
// that was mid-retry then fails with "Download not found" or a killed-process
// error; that's not a real failure, so it must not be shown or reported
// (a cancelled Half-Life Alyx download showed up in Sentry COMPANION-3).
function isDownloadAbandoned(download) {
  try {
    if (!download) return true;
    if (download.cancelled || download.paused || download.status === 'cancelled') return true;
    for (const d of ctx.activeDownloads.values()) if (d === download) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function clockCertMessage() {
  return ctx.withSupportFooter(
    "Secure connection refused: this PC's date/time looks wrong, or antivirus is scanning HTTPS traffic.",
    "Set your clock to update automatically (Windows: Settings > Time & language > Date & time > Set time automatically, then Sync now). If the time is already right, turn off your antivirus' HTTPS/web scanning for the Companion. Then click Retry."
  );
}

function noteRecovery(download, note) {
  try { if (download && ctx.CLOCK_CERT_RE.test(String(note))) download.__clockSuspect = true; } catch (e) { }
  try {
    if (!download) return;
    if (!Array.isArray(download.__recoveryNotes)) download.__recoveryNotes = [];
    download.__recoveryNotes.push(`${new Date().toISOString().slice(11, 19)} ${String(note).slice(0, 200)}`);
    if (download.__recoveryNotes.length > 20) download.__recoveryNotes.splice(0, download.__recoveryNotes.length - 20);
  } catch (e) { }
}

module.exports = { isExpectedDownloadFailure, reportDownloadFailure, isDownloadAbandoned, clockCertMessage, noteRecovery };
