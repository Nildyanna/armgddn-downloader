'use strict';
// The side-by-side test build (electron-builder.test.js + main/testBuild.js) must never touch the installed app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the test build config gives it its own id and name, no armgddn:// links, and is never published', () => {
  const c = require('../electron-builder.test.js');
  const tb = require('../main/testBuild');
  const base = require('../package.json').build;
  assert.notStrictEqual(c.appId, base.appId);
  assert.strictEqual(c.appId, tb.APP_ID);
  assert.strictEqual(c.productName, tb.NAME);
  assert.deepStrictEqual(c.protocols, []);
  assert.strictEqual(c.publish, null);
  assert.strictEqual(c.extraMetadata.armgddnTestBuild, true);
  assert.deepStrictEqual(c.files, base.files);
});

test('a normal build is not a test build', () => {
  assert.strictEqual(require('../main/testBuild').isTestBuild, false);
  assert.ok(!('armgddnTestBuild' in require('../package.json')));
});

test('the test build sets its own profile folder before anything reads it, and skips links, startup, shortcuts and updates', () => {
  const main = read('main.js');
  const setPath = main.indexOf('testBuild.PROFILE_FOLDER');
  const firstRead = main.indexOf("getPath('userData')", setPath + 1);
  assert.ok(setPath > -1 && setPath < main.indexOf('requestSingleInstanceLock'));
  assert.ok(main.slice(0, setPath).indexOf("getPath('userData')") === -1 && firstRead > setPath);
  assert.match(main, /if \(testBuild\.isTestBuild\) \{\n\s+protocolClientRegisterError = 'skipped \(test build\)'/);
  assert.match(main, /app\.isPackaged && !testBuild\.isTestBuild\) \{\n\s+const dirs/);
  assert.match(read('main/settings.js'), /!app\.isPackaged \|\| require\('\.\/testBuild'\)\.isTestBuild/);
  assert.match(read('main/updates.js'), /!app\.isPackaged \|\| require\('\.\/testBuild'\)\.isTestBuild/);
  assert.match(read('main/ipcApp.js'), /!app\.isPackaged \|\| require\('\.\/testBuild'\)\.isTestBuild/);
});
