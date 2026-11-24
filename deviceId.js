'use strict';
// A random ID for this PC, so the site can recognise a banned member's PC when they come back on a new Telegram account and a new IP
// (Nov 24 2026, George: "is there any way to still manage this if a user just changes their IP?"). Nothing about the PC is read: the ID is
// 32 random bytes made on first use. Only a SHA-256 fingerprint of it ever leaves the PC (header X-ARMGDDN-Device).
// Kept in two places so reinstalling the app does not reset it: the app's data folder and ~/.armgddn in the user's home folder.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ID_RE = /^[a-f0-9]{64}$/;
let cached = null;

function places(userDataDir, home = os.homedir()) {
    return [path.join(userDataDir, 'device-id'), path.join(home, '.armgddn', 'device-id')];
}

function readId(file) {
    try { const v = fs.readFileSync(file, 'utf8').trim().toLowerCase(); return ID_RE.test(v) ? v : ''; } catch (e) { return ''; }
}

function writeId(file, id) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, id + '\n', { mode: 0o600 }); return true; } catch (e) { return false; }
}

// The ID: the first copy found (and copied to any place that lacks it), or a new random one written to both.
function deviceId(userDataDir, home) {
    const list = places(userDataDir, home);
    let id = list.map(readId).find(Boolean) || '';
    if (!id) id = crypto.randomBytes(32).toString('hex');
    for (const f of list) if (readId(f) !== id) writeId(f, id);
    return id;
}

// What is sent: a fingerprint, never the ID itself.
function fingerprint(id) {
    return crypto.createHash('sha256').update('armgddn-device-v1:' + id).digest('hex');
}

function deviceFingerprint(userDataDir, home) {
    if (!cached) cached = fingerprint(deviceId(userDataDir, home));
    return cached;
}

module.exports = { deviceId, deviceFingerprint, fingerprint, places, _reset: () => { cached = null; } };
