'use strict';
// Update checks: verifying a release's signature, the update result sent to the page, and whether the app was started by the system (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const crypto = require('crypto');
const { app } = require('electron');

function decodeBase64Signature(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  try {
    const buf = Buffer.from(txt, 'base64');
    if (buf.length !== 64) return null;
    return buf;
  } catch (e) {
    return null;
  }
}

function verifyEd25519Signature(message, signature, publicKeyPem) {
  try {
    if (!message || !Buffer.isBuffer(message)) return false;
    if (!signature || !Buffer.isBuffer(signature)) return false;
    if (!publicKeyPem || typeof publicKeyPem !== 'string') return false;

    const keyObj = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
    // For Ed25519, the digest algorithm is ignored; Node requires `null`.
    return crypto.verify(null, message, keyObj, signature);
  } catch (e) {
    return false;
  }
}

function isAutostartLaunch() {
  try {
    if (Array.isArray(process.argv) && process.argv.includes('--autostart')) return true;
  } catch (e) { }

  try {
    if (typeof app.getLoginItemSettings === 'function') {
      const info = app.getLoginItemSettings();
      if (info && info.wasOpenedAtLogin) return true;
    }
  } catch (e) { }

  return false;
}

// Check for updates via GitHub releases
// Security (C1/H1): installerUrl is NOT returned to the renderer — the install-update
// handler derives the URL internally to prevent renderer-supplied URL attacks.
function safeUpdateResult(result) {
  // Strip installerUrl — renderer must not supply it back to install-update
  const { installerUrl: _stripped, ...safeResult } = result;
  // Surface whether auto-install is available without exposing the URL
  safeResult.canAutoInstall = !!_stripped;
  return safeResult;
}

module.exports = { decodeBase64Signature, verifyEd25519Signature, isAutostartLaunch, safeUpdateResult };
