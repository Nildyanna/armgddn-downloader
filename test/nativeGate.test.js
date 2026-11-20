const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { wantsNative, readEarlyConfig, checkAllowed, decide } = require('../nativeGate');

test('which window a launch opens: only an allowed member who has not opted out, and the command line always wins', () => {
  assert.equal(wantsNative({ argv: [], config: {} }), false);                                         // nobody by default
  assert.equal(wantsNative({ argv: [], config: { nativeAllowed: false } }), false);
  assert.equal(wantsNative({ argv: [], config: { nativeAllowed: true } }), true);
  assert.equal(wantsNative({ argv: [], config: { nativeAllowed: true, useNativeWindow: true } }), true);
  assert.equal(wantsNative({ argv: [], config: { nativeAllowed: true, useNativeWindow: false } }), false);   // opted out
  assert.equal(wantsNative({ argv: [], config: { useNativeWindow: true } }), false);                         // the switch alone is not permission
  assert.equal(wantsNative({ argv: [], config: { nativeAllowed: 'true' } }), false);                         // only a real true counts
  assert.equal(wantsNative({ argv: ['--native'], config: {} }), true);                                        // development flag
  assert.equal(wantsNative({ argv: ['--classic'], config: { nativeAllowed: true } }), false);
  assert.equal(wantsNative({ argv: ['--native', '--classic'], config: { nativeAllowed: true } }), false);    // classic wins a tie
  assert.equal(wantsNative(), false);
});

test('the saved settings are read before the app is ready, with a BOM, and a missing or broken file means nobody is allowed', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-'));
  const f = path.join(d, 'config.json');
  assert.deepEqual(readEarlyConfig(f), {});
  fs.writeFileSync(f, '﻿{"nativeAllowed":true,"useNativeWindow":false}');
  assert.deepEqual(readEarlyConfig(f), { nativeAllowed: true, useNativeWindow: false });
  fs.writeFileSync(f, '{ not json'); assert.deepEqual(readEarlyConfig(f), {});
  fs.writeFileSync(f, '[1,2]'); assert.equal(wantsNative({ argv: [], config: readEarlyConfig(f) }), false);
});

function fake(status, body, { hang = false, fail = false } = {}) {
  const calls = [];
  const request = (opts, cb) => {
    calls.push(opts); const req = new EventEmitter(); req.destroy = () => { };
    req.end = () => {
      if (fail) return setImmediate(() => req.emit('error', new Error('down')));
      if (hang) return setImmediate(() => req.emit('timeout'));
      const res = new EventEmitter(); res.statusCode = status; res.destroy = () => { }; cb(res);
      res.emit('data', typeof body === 'string' ? body : JSON.stringify(body)); res.emit('end');
    };
    return req;
  };
  return { request, calls };
}

test('asking the site: a yes or a no is believed, anything else means "could not tell"', async () => {
  const yes = fake(200, { authenticated: true, nativePreview: true });
  assert.equal(await checkAllowed('tok', { request: yes.request }), true);
  assert.equal(yes.calls[0].path, '/api/auth-status'); assert.equal(yes.calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(await checkAllowed('tok', { request: fake(200, { authenticated: true, nativePreview: false }).request }), false);
  assert.equal(await checkAllowed('tok', { request: fake(200, { authenticated: true }).request }), null);                 // an old site without the field
  assert.equal(await checkAllowed('tok', { request: fake(200, { authenticated: false, nativePreview: true }).request }), null);   // signed out: not a yes
  assert.equal(await checkAllowed('tok', { request: fake(200, { authenticated: true, nativePreview: 'yes' }).request }), null);
  assert.equal(await checkAllowed('tok', { request: fake(500, {}).request }), null);
  assert.equal(await checkAllowed('tok', { request: fake(200, 'not json').request }), null);
  assert.equal(await checkAllowed('tok', { request: fake(0, {}, { fail: true }).request }), null);
  assert.equal(await checkAllowed('tok', { request: fake(0, {}, { hang: true }).request }), null);
  assert.equal(await checkAllowed('', { request: yes.request }), null);
});

test('after an answer: save a change, relaunch only when the window that should be open changes, never during a relaunch chain or when the command line chose', () => {
  const run = (o) => decide({ argv: [], config: {}, runningNative: false, ...o });
  // not allowed before, allowed now, classic is open -> remember it and relaunch into native
  assert.deepEqual(run({ answer: true, config: {}, runningNative: false }), { update: { nativeAllowed: true }, relaunch: true });
  // already allowed and already native -> nothing to do
  assert.deepEqual(run({ answer: true, config: { nativeAllowed: true }, runningNative: true }), { update: null, relaunch: false });
  // removed from the list while native is open -> remember it and go back to classic
  assert.deepEqual(run({ answer: false, config: { nativeAllowed: true }, runningNative: true }), { update: { nativeAllowed: false }, relaunch: true });
  // allowed but the member turned the native window off -> remember, no relaunch (classic is what they want)
  assert.deepEqual(run({ answer: true, config: { useNativeWindow: false }, runningNative: false }), { update: { nativeAllowed: true }, relaunch: false });
  // could not tell -> nothing changes
  assert.deepEqual(run({ answer: null, config: { nativeAllowed: true }, runningNative: true }), { update: null, relaunch: false });
  // command line decides -> never relaunch
  assert.equal(run({ answer: true, argv: ['--native'], runningNative: true }).relaunch, false);
  assert.equal(run({ answer: false, argv: ['--classic'], config: { nativeAllowed: true }, runningNative: false }).relaunch, false);
  assert.equal(run({ answer: true, argv: ['--classic'], runningNative: false }).relaunch, false);
  // a relaunch marks itself, so a failed save cannot loop
  assert.equal(run({ answer: true, argv: ['--gate-relaunched'], runningNative: false }).relaunch, false);
  assert.deepEqual(decide(), { update: null, relaunch: false });
});

test('main.js: the page cannot grant itself the native window, a window switch waits for downloads, and the module is packaged', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('nativeGate.js'));
  // the launch decision comes from the gate, from the saved settings, before the app is ready
  assert.ok(src.includes("const NATIVE_PREVIEW = nativeGate.wantsNative({ argv: process.argv, config: nativeGate.readEarlyConfig("));
  // settings the page may save: the member's own switch yes, the site's answer no
  const allowed = src.slice(src.indexOf("'startWithOsStartup',\n    'startWithOsMinimized'"), src.indexOf("'lastSeenVersion'\n  ]);") + 30);
  assert.ok(allowed.includes("'useNativeWindow'") && !allowed.includes("'nativeAllowed'"));
  // defaults: nobody is allowed until the site says so
  assert.ok(/nativeAllowed: false,/.test(src) && /useNativeWindow: true,/.test(src));
  // a relaunch never happens during a download, and is marked so it cannot loop
  const gate = src.slice(src.indexOf('async function nativeGateCheck'), src.indexOf('function scheduleNativeGateCheck'));
  assert.ok(gate.indexOf('anyDownloadRunning()') > -1 && gate.indexOf('anyDownloadRunning()') < gate.indexOf('relaunchInto('));
  assert.ok(src.includes("concat(['--gate-relaunched'])"));
  // the tray switch is only offered to a member the site listed, and not when the command line chose the window
  const tray = src.slice(src.indexOf('const buildTrayMenu'), src.indexOf('tray.setToolTip'));
  assert.ok(tray.includes('settings.nativeAllowed === true') && tray.includes("--native") && tray.includes("--classic") && tray.includes('anyDownloadRunning()'));
  // the dev preview still never takes over armgddn:// links; a gated native window in the installed app keeps them
  assert.ok(src.includes("if (process.argv.includes('--native') || isolatedDevRun) {\n  protocolClientRegisterError = 'skipped (native preview)';"));
  assert.ok(src.includes("const isolatedDevRun = !app.isPackaged && process.argv.some((a) => String(a).startsWith('--user-data-dir'));"));
});

test('the sign-in check tells the site whether the member uses the native window', async () => {
  const seen = [];
  const request = (opts, cb) => {
    seen.push(opts.headers['X-Native-Window']);
    const res = new EventEmitter(); res.statusCode = 200;
    const req = new EventEmitter(); req.end = () => { cb(res); res.emit('data', JSON.stringify({ authenticated: true, nativePreview: true })); res.emit('end'); }; req.destroy = () => { };
    return req;
  };
  await checkAllowed('tok', { request });
  await checkAllowed('tok', { request, nativeWindowOn: false });
  assert.deepEqual(seen, ['on', 'off']);
});
