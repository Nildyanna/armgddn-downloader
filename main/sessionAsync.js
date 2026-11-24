'use strict';
// Loading the saved sign-in when the system keychain is only available asynchronously (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const secureStore = require('../secureStore');
const { logToFile } = require('./log');
const fs = require('fs');

async function loadSessionAsync() {
  try {
    const sessionPath = ctx.getSessionPath();
    if (!fs.existsSync(sessionPath)) return false;
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    if (!(data.token && data.expiresAt && new Date(data.expiresAt) > new Date())) return false;
    if (data.encrypted && await secureStore.isAvailable()) {
      ctx.sessionToken = await secureStore.decrypt(Buffer.from(data.token, 'base64'));
    } else {
      if (!(await secureStore.isAvailable())) {
        logToFile('WARNING: safeStorage unavailable — session token stored in plaintext. Upgrade OS keychain support to enable encryption.');
      }
      ctx.sessionToken = data.token;
    }
    logToFile('Session loaded from file');
    return true;
  } catch (e) {
    logToFile('Failed to load session: ' + e.message);
    return false;
  }
}

module.exports = { loadSessionAsync };
