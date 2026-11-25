'use strict';
// The app window's user-interface review of Nov 25 2026: the top problems found in renderer/native, native/bridge.js and preload-native.js.
// (The request time limit has its own tests in nativeApiClient.test.js.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Check for updates never says "latest version" after a failed check or for an update it cannot install itself', async () => {
  const { updateCheckResult } = await import('../renderer/native/format.mjs');
  const failed = updateCheckResult({ error: 'GitHub did not answer' });
  assert.match(failed.text, /^Could not check: GitHub did not answer/); assert.equal(failed.install, false); assert.equal(failed.announce, false);
  assert.match(updateCheckResult(null).text, /^Could not check: no answer/);
  const manual = updateCheckResult({ hasUpdate: true, latestVersion: '6.13.0', version: '6.12.0', canAutoInstall: false });
  assert.match(manual.text, /v6\.13\.0 is available \(you have v6\.12\.0\)/); assert.doesNotMatch(manual.text, /latest version/);
  assert.equal(manual.install, false); assert.equal(manual.announce, true);
  const auto = updateCheckResult({ hasUpdate: true, latestVersion: '6.13.0', version: '6.12.0', canAutoInstall: true });
  assert.equal(auto.install, true); assert.match(auto.text, /restarts ARMGDDN App/);
  assert.equal(updateCheckResult({ hasUpdate: false, version: '6.12.0' }).text, 'You are on the latest version (v6.12.0).');
  assert.doesNotMatch(updateCheckResult({ hasUpdate: false }).text, /undefined/);
  const a = read('renderer/native/app.mjs');
  const i = a.indexOf('function UpdateRow(');
  assert.ok(a.slice(i, i + 2000).includes('updateCheckResult(r)'), 'the Settings row uses it');
});
