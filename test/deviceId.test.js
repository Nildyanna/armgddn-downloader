'use strict';
// The install ID (Nov 24 2026): random, kept in two places so a reinstall keeps it, and only its fingerprint is sent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../deviceId');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devid-'));

test('a new PC gets one random ID, written to both places', () => {
    const ud = tmp(), home = tmp();
    const id = d.deviceId(ud, home);
    assert.match(id, /^[a-f0-9]{64}$/);
    for (const f of d.places(ud, home)) assert.strictEqual(fs.readFileSync(f, 'utf8').trim(), id);
    assert.strictEqual(d.deviceId(ud, home), id);
});

test('a reinstall (app data folder wiped) keeps the ID from the home-folder copy, and puts it back', () => {
    const ud = tmp(), home = tmp();
    const id = d.deviceId(ud, home);
    fs.rmSync(ud, { recursive: true, force: true });
    assert.strictEqual(d.deviceId(ud, home), id);
    assert.strictEqual(fs.readFileSync(d.places(ud, home)[0], 'utf8').trim(), id);
});

test('only a fingerprint is sent, and it is not the ID', () => {
    const id = 'a'.repeat(64);
    const fp = d.fingerprint(id);
    assert.match(fp, /^[a-f0-9]{64}$/);
    assert.notStrictEqual(fp, id);
    assert.strictEqual(d.fingerprint(id), fp);
});

test('the API client sends the fingerprint header on every call', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'apiClient.js'), 'utf8');
    assert.ok(src.includes("'X-ARMGDDN-Device'"));
    const bridge = fs.readFileSync(path.join(__dirname, '..', 'native', 'bridge.js'), 'utf8');
    assert.ok(bridge.includes("deviceFingerprint(require('electron').app.getPath('userData'))"), 'the bridge has no app in scope; it must ask electron for it');
});
