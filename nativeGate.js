'use strict';
// Which window the app opens while the native window is a preview for a few people.
//
// The site says, per signed-in member, whether the native window is meant for them (its owners, plus anyone it lists): GET /api/auth-status answers
// { nativePreview: true|false }. The app keeps the last answer in its settings (nativeAllowed) so it knows at launch, before any network call,
// which window to open. After a launch (and every few minutes) it asks again; if the answer changed it relaunches into the right window, but never
// while a download is running. The member can turn the native window off for themselves (useNativeWindow = false); `--native` and `--classic` on
// the command line always win, for development.
//
// This is not a security boundary: the native window calls only what the member's own sign-in already allows.
const https = require('https');
const fs = require('fs');

// Should this launch open the native window? config = the saved settings (read before the app is ready).
function wantsNative({ argv = [], config = {} } = {}) {
  if (argv.includes('--classic')) return false;
  if (argv.includes('--native')) return true;
  return !!config && config.nativeAllowed === true && config.useNativeWindow !== false;
}

// The saved settings file, read synchronously and tolerating a BOM; {} when missing or unreadable.
function readEarlyConfig(file, fsImpl = fs) {
  try { const j = JSON.parse(String(fsImpl.readFileSync(file, 'utf8')).replace(/^﻿/, '')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}

// Asks the site. true / false, or null when it could not be told (offline, signed out, an old site that does not know the field): keep what we have.
function checkAllowed(token, { request = https.request, host = 'www.armgddnbrowser.com', timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!token) return resolve(null);
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = request({ hostname: host, port: 443, path: '/api/auth-status', method: 'GET', family: 4, timeout: timeoutMs,
        headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'ARMGDDN-Companion' } }, (res) => {
        let s = ''; res.on('data', (c) => { s += c; if (s.length > 20000) { try { res.destroy(); } catch (e) { } } });
        res.on('end', () => {
          if (res.statusCode !== 200) return finish(null);
          try { const j = JSON.parse(s); finish(j && j.authenticated === true && typeof j.nativePreview === 'boolean' ? j.nativePreview : null); } catch (e) { finish(null); }
        });
      });
      req.on('timeout', () => { try { req.destroy(); } catch (e) { } finish(null); });
      req.on('error', () => finish(null));
      req.end();
    } catch (e) { finish(null); }
  });
}

// What to do with an answer. -> { update: { nativeAllowed } | null, relaunch: boolean }
// relaunch only when the answer changes which window should be open, never when the command line chose, and never twice in a row
// (a relaunch marks itself with --gate-relaunched, so a setting that fails to save cannot make the app restart forever).
function decide({ answer, config = {}, argv = [], runningNative = false } = {}) {
  if (answer !== true && answer !== false) return { update: null, relaunch: false };
  const update = (config.nativeAllowed === true) !== answer ? { nativeAllowed: answer } : null;
  const chosenByCommandLine = argv.includes('--native') || argv.includes('--classic');
  const already = argv.includes('--gate-relaunched');
  const shouldBeNative = wantsNative({ argv, config: { ...config, nativeAllowed: answer } });
  return { update, relaunch: !chosenByCommandLine && !already && shouldBeNative !== !!runningNative };
}

module.exports = { wantsNative, readEarlyConfig, checkAllowed, decide };
