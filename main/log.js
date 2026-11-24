'use strict';
// The debug log: debug.log in the app's data folder, rotated at start-up, with a fallback in the temp folder (moved out of main.js unchanged,
// Nov 24 2026; docs/MAIN_SPLIT.md). logToFile is used by nearly every part of the main process.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rotateLogIfNeeded } = require('./files');

const DEBUG_LOGGING = process.env.ARMGDDN_DEBUG === '1';

// Debug log file for troubleshooting
let cachedDebugLogPath = null;
function getDebugLogPath() {
  if (cachedDebugLogPath) return cachedDebugLogPath;
  try {
    const userData = app.getPath('userData');
    cachedDebugLogPath = path.join(userData, 'debug.log');
    return cachedDebugLogPath;
  } catch (e) {
    // app.getPath('userData') can fail before the app is ready in some packaged environments.
    // Fall back to a best-effort location.
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const legacyPath = path.join(appData, 'ARMGDDN Downloader', 'debug.log');
    const newPath = path.join(appData, 'ARMGDDN Companion', 'debug.log');
    cachedDebugLogPath = fs.existsSync(path.dirname(legacyPath)) ? legacyPath : newPath;
    return cachedDebugLogPath;
  }
}

// Track whether startup rotation has run to avoid checking on every write
let _logRotationDoneAtStartup = false;

function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logPath = getDebugLogPath();
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    // Rotate at startup (once) and on each write if already over limit
    if (!_logRotationDoneAtStartup) {
      _logRotationDoneAtStartup = true;
      rotateLogIfNeeded(logPath);
    }
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (e) {
    try {
      // Last-resort fallback to temp directory
      const fallbackPath = path.join(os.tmpdir(), 'armgddn-downloader-debug.log');
      fs.appendFileSync(fallbackPath, `[${new Date().toISOString()}] [logToFile fallback] ${message} (original error: ${e && e.message ? e.message : e})\n`);
    } catch (e2) { }
  }
}

function debugLog(message) {
  if (!DEBUG_LOGGING) return;
  const logPath = path.join(app.getPath('userData'), 'debug.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logPath, logLine);
}

module.exports = { getDebugLogPath, logToFile, debugLog, DEBUG_LOGGING };
