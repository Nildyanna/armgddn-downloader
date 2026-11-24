'use strict';
// Settings: reading and saving them, and choosing a folder (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
// main.js calls register() once, at start-up, where these registrations used to be.
const ctx = require('./context');
const { withDialogFocus, getDialogParentWindow } = require('./dialogs');
const { maybeShowHashGateNotice } = require('./hashing');
const { normalizeSettings, applyStartupRegistration, saveSettings } = require('./settings');
const { ipcMain, dialog } = require('electron');

function register() {
// Get settings
ipcMain.handle('get-settings', () => {
  return ctx.settings;
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
    'installUpdatesOnQuit',
    'startWithOsStartup',
    'startWithOsMinimized',
    'errorReporting',
    'errorReportingAsked',
    'lastSeenVersion'
  ]);

  const merged = { ...ctx.settings };
  for (const k of Object.keys(incoming)) {
    if (!allowedKeys.has(k)) continue;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    merged[k] = incoming[k];
  }
  ctx.settings = merged;
  normalizeSettings();
  applyStartupRegistration();
  saveSettings();
  setTimeout(() => { maybeShowHashGateNotice().catch(() => { }); }, 300);
  return ctx.settings;
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
}

module.exports = { register };
