// Encrypts and decrypts small secrets (the sign-in token, the Komga key) with Electron's safeStorage.
//
// Electron 45 added asynchronous methods (isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync) and deprecated the
// synchronous ones; Electron 46 removes them. This module uses the asynchronous methods when the running Electron has them and the
// synchronous ones otherwise, so the same code runs on Electron 44, 45 and 46. Data written either way can be read either way
// (Electron documents that both use the same per-platform key store).
const { safeStorage } = require('electron');

const hasAsync = typeof safeStorage.encryptStringAsync === 'function' && typeof safeStorage.decryptStringAsync === 'function'
  && typeof safeStorage.isAsyncEncryptionAvailable === 'function';
const hasSync = typeof safeStorage.encryptString === 'function' && typeof safeStorage.decryptString === 'function'
  && typeof safeStorage.isEncryptionAvailable === 'function';

async function isAvailable() {
  if (hasAsync) return !!(await safeStorage.isAsyncEncryptionAvailable());
  return hasSync ? !!safeStorage.isEncryptionAvailable() : false;
}

async function encrypt(text) {
  if (hasAsync) return await safeStorage.encryptStringAsync(String(text));
  if (hasSync) return safeStorage.encryptString(String(text));
  throw new Error('safeStorage has no encrypt method');
}

async function decrypt(buf) {
  if (hasAsync) return await safeStorage.decryptStringAsync(buf);
  if (hasSync) return safeStorage.decryptString(buf);
  throw new Error('safeStorage has no decrypt method');
}

// Synchronous versions for code that cannot wait (only exist while the running Electron still has them).
const syncAvailable = hasSync;
function isAvailableSync() { return hasSync ? !!safeStorage.isEncryptionAvailable() : false; }
function decryptSync(buf) { return safeStorage.decryptString(buf); }
function encryptSync(text) { return safeStorage.encryptString(String(text)); }

module.exports = { isAvailable, encrypt, decrypt, syncAvailable, isAvailableSync, decryptSync, encryptSync, hasAsync };
