'use strict';
// Window rules shared by every window (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).

// Best practice (Nov 24 2026, docs/BEST_PRACTICES.md): no window may open another window by itself (window.open, target=_blank).
// Links that should open go through shell.openExternal on purpose. test/bestPractices.test.js checks every window calls this.
// allowHosts: the only sites it may open a popup for (the sign-in window needs Telegram's own login popup, oauth.telegram.org).
function denyNewWindows(win, allowHosts) {
  const allow = (allowHosts || []).map((h) => String(h).toLowerCase());
  try {
    win.webContents.setWindowOpenHandler(({ url }) => {
      try { const u = new URL(url); if (u.protocol === 'https:' && allow.includes(u.hostname.toLowerCase())) return { action: 'allow' }; } catch (e) { }
      return { action: 'deny' };
    });
  } catch (e) { }
}

module.exports = { denyNewWindows };
