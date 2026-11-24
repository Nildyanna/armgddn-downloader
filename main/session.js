'use strict';
// The saved sign-in: loading, saving and clearing the session token (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const secureStore = require('../secureStore');
const { writeSessionFile } = require('./files');
const { logToFile } = require('./log');
const fs = require('fs');

// Load session cookie from file (encrypted)
function loadSession() {
  try {
    const sessionPath = ctx.getSessionPath();
    if (fs.existsSync(sessionPath)) {
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (data.token && data.expiresAt && new Date(data.expiresAt) > new Date()) {
        // Decrypt if encrypted, otherwise use plain (migration path for older sessions)
        if (data.encrypted && !secureStore.syncAvailable) {
          return !!ctx.sessionToken;                      // newer Electron: loadSessionAsync() decrypts it at startup
        }
        if (data.encrypted && secureStore.isAvailableSync()) {
          const encryptedBuffer = Buffer.from(data.token, 'base64');
          ctx.sessionToken = secureStore.decryptSync(encryptedBuffer);
        } else {
          if (!secureStore.isAvailableSync()) {
            logToFile('WARNING: safeStorage unavailable — session token stored in plaintext. Upgrade OS keychain support to enable encryption.');
          }
          ctx.sessionToken = data.token;
        }
        logToFile('Session loaded from file');
        return true;
      }
    }
  } catch (e) {
    logToFile('Failed to load session: ' + e.message);
  }
  return false;
}

// Same as loadSession, for Electron versions without the synchronous safeStorage methods (called once at startup).
// The saved sign-in as a token string. loadSession() only fills sessionToken and returns true or false, so using its result as a token
// sent "Bearer true" (the comics and music library calls were refused with 401 whenever no token had been handed over by the website).
function savedSessionToken() {
  if (ctx.sessionToken) return String(ctx.sessionToken);
  try { loadSession(); } catch (e) { }
  return ctx.sessionToken ? String(ctx.sessionToken) : '';
}

// Save app session token to file (encrypted)
function saveSession(token) {
  try {
    const sessionPath = ctx.getSessionPath();
    // Session expires in 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let storedToken = token;
    let encrypted = false;

    if (!secureStore.syncAvailable) {
      // Newer Electron: encrypt asynchronously. The token is usable in memory right away; the file follows a moment later.
      ctx.sessionToken = token;
      (async () => {
        try {
          let tok = token, enc = false;
          if (await secureStore.isAvailable()) { tok = (await secureStore.encrypt(token)).toString('base64'); enc = true; }
          writeSessionFile(sessionPath, { token: tok, expiresAt, encrypted: enc });
          logToFile('Session saved to file (encrypted: ' + enc + ')');
        } catch (e) { logToFile('Failed to save session: ' + e.message); }
      })();
      return;
    }

    // Encrypt if available
    if (secureStore.isAvailableSync()) {
      const encryptedBuffer = secureStore.encryptSync(token);
      storedToken = encryptedBuffer.toString('base64');
      encrypted = true;
    }

    writeSessionFile(sessionPath, { token: storedToken, expiresAt, encrypted });
    ctx.sessionToken = token;
    logToFile('Session saved to file (encrypted: ' + encrypted + ')');
  } catch (e) {
    logToFile('Failed to save session: ' + e.message);
  }
}

// Clear session
function clearSession() {
  try {
    const sessionPath = ctx.getSessionPath();
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
    ctx.sessionToken = null;
  } catch (e) {
    logToFile('Failed to clear session: ' + e.message);
  }
}

module.exports = { loadSession, savedSessionToken, saveSession, clearSession };
