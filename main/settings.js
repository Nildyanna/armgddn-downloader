'use strict';
// Settings: loading, saving and tidying the member's settings, and start-with-the-computer registration (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const scheduleLib = require('../schedule');
const { defaultDownloadsBase } = require('./files');
const { logToFile } = require('./log');
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function applyStartupRegistration() {
  try {
    // A copy that is not the installed app (a dev run, the native preview from a test folder) must never write the Windows/macOS startup
    // entry: it shares the installed app's entry name, so it replaced it with a bare Electron path and Windows then opened an empty
    // Electron window at every boot (2026-11-18).
    if (!app.isPackaged || require('./testBuild').isTestBuild) { logToFile('[Startup] not the installed app; leaving the OS startup entry alone'); return; }
    const enabled = !!(ctx.settings && ctx.settings.startWithOsStartup);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: enabled ? ['--autostart'] : []
        });
      } catch (e) {
        logToFile(`[Startup] setLoginItemSettings failed: ${e && e.message ? e.message : e}`);
      }
      return;
    }

    if (process.platform === 'linux') {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopPath = path.join(autostartDir, 'armgddn-companion.desktop');

      if (!enabled) {
        try {
          if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
        } catch (e) { }
        return;
      }

      fs.mkdirSync(autostartDir, { recursive: true });
      const execPath = process.execPath;
      const content = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=ARMGDDN Companion',
        `Exec=${execPath} --autostart`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true'
      ].join('\n') + '\n';

      let existing = '';
      try { existing = fs.readFileSync(desktopPath, 'utf8'); } catch (e) { }
      if (existing !== content) {
        fs.writeFileSync(desktopPath, content, 'utf8');
        try { fs.chmodSync(desktopPath, 0o644); } catch (e) { }
      }
    }
  } catch (e) {
    logToFile(`[Startup] applyStartupRegistration failed: ${e && e.message ? e.message : e}`);
  }
}

function normalizeSettings() {
  try {
    if (!ctx.settings || typeof ctx.settings !== 'object') return;
    const maxConc = parseInt(String(ctx.settings.maxConcurrentDownloads), 10);
    // Enforce cap of 8 for stability
    ctx.settings.maxConcurrentDownloads = Number.isFinite(maxConc) && maxConc > 0 ? Math.min(maxConc, 6) : 2;
    // 0 = Auto (the app picks); otherwise the most connections one file may open.
    ctx.settings.schedule = scheduleLib.normalize(ctx.settings.schedule);
    const cpf = parseInt(String(ctx.settings.connectionsPerFile), 10);
    ctx.settings.connectionsPerFile = [1, 2, 4, 8, 16].includes(cpf) ? cpf : 0;

    const rawDownloadPath = ctx.settings.downloadPath;
    const defaultDownloadPath = path.join(defaultDownloadsBase(), 'ARMGDDN');
    if (typeof rawDownloadPath !== 'string' || !rawDownloadPath.trim()) {
      ctx.settings.downloadPath = defaultDownloadPath;
    } else {
      const cleaned = rawDownloadPath.trim();
      ctx.settings.downloadPath = path.isAbsolute(cleaned) ? cleaned : defaultDownloadPath;
    }

    const speed = Number(ctx.settings.maxDownloadSpeedMBps);
    ctx.settings.maxDownloadSpeedMBps = Number.isFinite(speed) && speed > 0 ? Math.round(speed) : 0;

    ctx.settings.autoExtract7z = !!ctx.settings.autoExtract7z;
    // 5.15.0 turned "Check files after download" on for everyone, once. After that the member's own choice is kept, including off.
    if (!ctx.settings.autoHashCheckDefaultedOn) { ctx.settings.autoHashCheck = true; ctx.settings.autoHashCheckDefaultedOn = true; }
    ctx.settings.autoHashCheck = !!ctx.settings.autoHashCheck;
    ctx.settings.hashGateNoticeSeen = !!ctx.settings.hashGateNoticeSeen;
    ctx.settings.comicsFolder = typeof ctx.settings.comicsFolder === 'string' ? ctx.settings.comicsFolder.slice(0, 500) : '';
    ctx.settings.musicFolder = typeof ctx.settings.musicFolder === 'string' ? ctx.settings.musicFolder.slice(0, 500) : '';
    ctx.settings.extractFolder = typeof ctx.settings.extractFolder === 'string' ? ctx.settings.extractFolder.slice(0, 500) : '';
    ctx.settings.showNotifications = ctx.settings.showNotifications !== false;
    ctx.settings.minimizeToTrayOnMinimize = !!ctx.settings.minimizeToTrayOnMinimize;
    ctx.settings.minimizeToTrayOnClose = !!ctx.settings.minimizeToTrayOnClose;
    ctx.settings.lightGraphics = !!ctx.settings.lightGraphics;

    ctx.settings.autoUpdate = !!ctx.settings.autoUpdate;
    ctx.settings.installUpdatesOnQuit = ctx.settings.installUpdatesOnQuit !== false;     // on unless switched off
    ctx.settings.startWithOsStartup = !!ctx.settings.startWithOsStartup;
    ctx.settings.startWithOsMinimized = !!ctx.settings.startWithOsMinimized;
    ctx.settings.errorReporting = ctx.settings.errorReporting !== false;
    ctx.settings.errorReportingAsked = ctx.settings.errorReportingAsked === true;

    ctx.refreshGlobalPoolLimit();
  } catch (e) {
    logToFile(`[Settings] normalizeSettings failed: ${e && e.message ? e.message : e}`);
  }
}

function loadSettings() {
  try {
    const configPath = ctx.getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');   // an editor or PowerShell may have added a byte-order mark
      ctx.settings = { ...ctx.settings, ...JSON.parse(data) };
    }
    const hadHashDefault = !!ctx.settings.autoHashCheckDefaultedOn;
    normalizeSettings();
    ctx.settingsLoadedFromDisk = true;
    if (!hadHashDefault && fs.existsSync(ctx.getConfigPath())) saveSettings();      // keep the one-time switch-on from repeating
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// Save settings
function saveSettings() {
  try {
    const configPath = ctx.getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(ctx.settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

module.exports = { applyStartupRegistration, normalizeSettings, loadSettings, saveSettings };
