'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { wantsNative } = require('../nativeGate');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the native window always opens; only the developer flag --classic opens the old window', () => {
  assert.equal(wantsNative({ argv: [] }), true);
  assert.equal(wantsNative(), true);
  assert.equal(wantsNative({ argv: ['--native'] }), true);
  assert.equal(wantsNative({ argv: ['--classic'] }), false);
});

test('nothing lets a member turn the native window off or switch back', () => {
  const main = require('./mainSource')();
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('nativeGate.js'));
  assert.ok(main.includes('const NATIVE_PREVIEW = nativeGate.wantsNative({ argv: process.argv });'));
  for (const gone of ['useNativeWindow', 'nativeAllowed', 'switchWindowMode', 'nativeGateCheck', 'Switch to the classic window', 'Switch to the new window', 'Switch to the native window']) {
    assert.ok(!main.includes(gone), 'main.js still mentions ' + gone);
  }
  const app = read('renderer/native/app.mjs');
  for (const gone of ['useNativeWindow', 'openClassic', 'Open the classic window', 'classic window is still available']) assert.ok(!app.includes(gone), 'app.mjs still mentions ' + gone);
  assert.ok(!read('preload-native.js').includes('openClassic'));
  assert.ok(!read('native/bridge.js').includes('openClassic'));
  // the dev preview still never takes over armgddn:// links
  assert.ok(main.includes("if (process.argv.includes('--native') || isolatedDevRun) {\n  protocolClientRegisterError = 'skipped (native preview)';"));
});
