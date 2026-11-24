'use strict';
// Signing in and out: clearing the sign-in window's cookies (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const { logToFile } = require('./log');

// Open auth window to login and grab session cookie
// Forget which Telegram account was used to sign in on this PC. The sign-in window shares this app's browser session, so the site's login cookie and Telegram's
// own "continue as ..." cookies survive a sign-out: the next sign-in then opened, signed itself straight back in as the OLD account and closed within a second
// (Darkheart V3, 2026-11-21: "the window pops up and disappears immediately and it shows another telegram account that I don't use").
async function clearLoginTraces() {
  try {
    const ses = require('electron').session.defaultSession;
    const mine = /(^|\.)(armgddnbrowser\.com|telegram\.org|t\.me)$/i;
    const cookies = await ses.cookies.get({});
    let removed = 0;
    for (const c of cookies) {
      const dom = String(c.domain || '').replace(/^\./, '');
      if (!mine.test(dom)) continue;
      try { await ses.cookies.remove('http' + (c.secure ? 's' : '') + '://' + dom + (c.path || '/'), c.name); removed++; } catch (e) { }
    }
    // Telegram's login page keeps the chosen account in its own storage as well; the site's own storage (themes, settings) is left alone.
    await ses.clearStorageData({ origins: ['https://oauth.telegram.org', 'https://telegram.org', 'https://web.telegram.org'] });
    logToFile('Sign-in traces cleared (' + removed + ' cookies)');
  } catch (e) {
    logToFile('Could not clear sign-in traces: ' + (e && e.message ? e.message : String(e)));
  }
}

module.exports = { clearLoginTraces };
