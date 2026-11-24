'use strict';
// Dialogs and the window: which window a dialog belongs to, bringing the app forward, messages to the page (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');

function getDialogParentWindow() {
  try {
    if (ctx.progressWin && !ctx.progressWin.isDestroyed()) return ctx.progressWin;
  } catch (e) { }
  return ctx.mainWindow;
}

async function withDialogFocus(fn) {
  // On Linux/KDE, system dialogs appear above all windows natively on X11/Wayland
  // without needing to manipulate alwaysOnTop. Skipping the setAlwaysOnTop dance
  // also avoids KDE raising the main window as a side-effect of moveTop().
  if (process.platform === 'linux') {
    return await fn();
  }

  let restoreOnTop = null;
  try {
    if (ctx.progressWin && !ctx.progressWin.isDestroyed()) {
      try {
        restoreOnTop = ctx.progressWin.isAlwaysOnTop();
      } catch (e) {
        restoreOnTop = true;
      }
      try {
        ctx.progressWin.setAlwaysOnTop(false);
      } catch (e) { }
    }

    return await fn();
  } finally {
    if (restoreOnTop != null) {
      try {
        if (ctx.progressWin && !ctx.progressWin.isDestroyed()) {
          ctx.progressWin.setAlwaysOnTop(!!restoreOnTop);
          try { ctx.progressWin.moveTop(); } catch (e) { }
        }
      } catch (e) { }
    }
  }
}

function withDialogFocusSync(fn) {
  // On Linux/KDE, system dialogs appear above all windows natively — no alwaysOnTop
  // manipulation needed (and doing so can cause the main window to be raised on KDE).
  if (process.platform === 'linux') {
    return fn();
  }

  let restoreOnTop = null;
  try {
    if (ctx.progressWin && !ctx.progressWin.isDestroyed()) {
      try {
        restoreOnTop = ctx.progressWin.isAlwaysOnTop();
      } catch (e) {
        restoreOnTop = true;
      }
      try {
        ctx.progressWin.setAlwaysOnTop(false);
      } catch (e) { }
    }

    return fn();
  } finally {
    if (restoreOnTop != null) {
      try {
        if (ctx.progressWin && !ctx.progressWin.isDestroyed()) {
          ctx.progressWin.setAlwaysOnTop(!!restoreOnTop);
          try { ctx.progressWin.moveTop(); } catch (e) { }
        }
      } catch (e) { }
    }
  }
}

function showAppWindow() {
  try {
    if (typeof ctx.NATIVE_PREVIEW !== 'undefined' && ctx.NATIVE_PREVIEW && ctx.nativeWindow && !ctx.nativeWindow.isDestroyed()) {
      if (ctx.nativeWindow.isMinimized()) ctx.nativeWindow.restore();
      ctx.nativeWindow.show();
      if (process.platform === 'linux') { try { ctx.nativeWindow.moveTop(); } catch (e) { } } else { ctx.nativeWindow.focus(); }
      return true;
    }
  } catch (e) { }
  return false;
}

// Every message to the main window goes through here. rclone output and
// timers keep firing while the app quits (or after the window is gone), and
// webContents.send on a destroyed window throws "Object has been destroyed",
// which crashed the app (fatal TypeError in parseRcloneProgress, Sentry).
function sendToMain(channel, payload) {
  try {
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return;
    const wc = ctx.mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(channel, payload);
  } catch (e) { }
}

// Reading .webContents on a destroyed window throws "Object has been destroyed" (Sentry ARMGDDN-COMPANION-1M), so every
// "is there a window to talk to" check goes through this instead of testing mainWindow.webContents.
function mainWindowAlive() {
  try { return !!ctx.mainWindow && !ctx.mainWindow.isDestroyed(); } catch (e) { return false; }
}

module.exports = { getDialogParentWindow, withDialogFocus, withDialogFocusSync, showAppWindow, sendToMain, mainWindowAlive };
