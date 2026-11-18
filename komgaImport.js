'use strict';
// Brings the Komga address and API key saved by the installed Companion into a separate profile (the native preview keeps its own).
// The installed app stores the key with Electron's safeStorage: on Windows that is AES-256-GCM ("v10" + 12 byte nonce + data + 16 byte tag)
// under a per-profile key kept in "Local State", itself protected by the Windows account (DPAPI). The same Windows user can unwrap that key,
// so nothing here is a way around the protection: it only works on the PC and account that saved the key. Nothing is logged or returned except
// the address and a success flag. The shipped native app uses the classic window's own profile, so it never needs this.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// "v10" + nonce(12) + ciphertext + tag(16)  ->  text
function decryptV10(buf, key) {
  if (!Buffer.isBuffer(buf) || buf.length < 3 + 12 + 16 || buf.subarray(0, 3).toString('latin1') !== 'v10') throw new Error('not a v10 value');
  const nonce = buf.subarray(3, 15), tag = buf.subarray(buf.length - 16), data = buf.subarray(15, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce); d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// The profile's AES key: Local State -> os_crypt.encrypted_key ("DPAPI" + blob), unwrapped with the Windows account.
function unwrapProfileKey(profileDir, run = execFile) {
  return new Promise((resolve, reject) => {
    let b64;
    try { b64 = JSON.parse(fs.readFileSync(path.join(profileDir, 'Local State'), 'utf8')).os_crypt.encrypted_key; } catch (e) { return reject(new Error('The installed Companion has no saved encryption key.')); }
    const raw = Buffer.from(String(b64 || ''), 'base64');
    if (raw.subarray(0, 5).toString('latin1') !== 'DPAPI') return reject(new Error('Unsupported key format.'));
    const blob = raw.subarray(5).toString('base64');
    const ps = "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('" + blob + "'), $null, 'CurrentUser'))";
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return reject(new Error('Windows would not unlock the installed Companion\'s key for this account.'));
      const k = Buffer.from(String(stdout).trim(), 'base64');
      if (k.length !== 32) return reject(new Error('Unexpected key size.'));
      resolve(k);
    });
  });
}

// The installed Companion's saved Komga settings, decrypted: { url, key } or throws with a plain message.
async function readInstalledKomga(profileDir, run) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(profileDir, 'komga.json'), 'utf8')); } catch (e) { throw new Error('The installed Companion has no saved Komga key.'); }
  if (!d || !d.url || !d.key) throw new Error('The installed Companion has no saved Komga key.');
  if (!d.enc) return { url: d.url, key: String(d.key) };
  if (process.platform !== 'win32') throw new Error('Importing the key is only supported on Windows.');
  const profileKey = await unwrapProfileKey(profileDir, run);
  try { return { url: d.url, key: decryptV10(Buffer.from(d.key, 'base64'), profileKey) }; } catch (e) { throw new Error('Could not read the installed Companion\'s key.'); }
}

module.exports = { decryptV10, unwrapProfileKey, readInstalledKomga };
