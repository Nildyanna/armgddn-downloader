const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const s = require('../shortcutNames');

test('the shortcut name follows the native window', () => {
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN Companion.lnk', 'Notes.lnk'], true), [{ from: 'ARMGDDN Companion.lnk', to: 'ARMGDDN App.lnk' }]);
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN App.lnk'], false), [{ from: 'ARMGDDN App.lnk', to: 'ARMGDDN Companion.lnk' }]);
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN App.lnk'], true), [], 'already right');
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN Browser.lnk'], true), [{ from: 'ARMGDDN Browser.lnk', to: 'ARMGDDN App.lnk' }], 'the name used until 6.7.0 moves to the new one');
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN Browser.lnk'], false), [{ from: 'ARMGDDN Browser.lnk', to: 'ARMGDDN Companion.lnk' }]);
  assert.deepEqual(s.planShortcutRenames(['Notes.lnk'], true), [], 'no shortcut of ours');
  assert.deepEqual(s.planShortcutRenames(['ARMGDDN Companion.lnk', 'ARMGDDN App.lnk'], true), [], 'never overwrites or deletes a second one');
});

test('renaming happens on disk only for shortcuts that open this app, in every folder', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-b-')), c = path.join(a, 'missing');
  fs.writeFileSync(path.join(a, 'ARMGDDN Companion.lnk'), 'x'); fs.writeFileSync(path.join(b, 'ARMGDDN Companion.lnk'), 'y');
  const logs = [];
  const r = s.syncShortcutNames({ dirs: [a, b, c], native: true, fs, opensThisApp: (f) => f.startsWith(a), log: (m) => logs.push(m) });
  assert.equal(r.length, 1); assert.ok(fs.existsSync(path.join(a, 'ARMGDDN App.lnk')) && !fs.existsSync(path.join(a, 'ARMGDDN Companion.lnk')));
  assert.ok(fs.existsSync(path.join(b, 'ARMGDDN Companion.lnk')), 'another program\'s shortcut with that name is left alone');
  s.syncShortcutNames({ dirs: [a], native: false, fs });
  assert.ok(fs.existsSync(path.join(a, 'ARMGDDN Companion.lnk')), 'and back again');
  assert.ok(logs.length === 1);
});

test('after an update the app relaunches through whichever Start Menu shortcut exists', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-c-'));
  assert.equal(path.basename(s.startMenuShortcutPath(d, fs)), 'ARMGDDN Companion.lnk');
  fs.writeFileSync(path.join(d, 'ARMGDDN Browser.lnk'), 'x');
  assert.equal(path.basename(s.startMenuShortcutPath(d, fs)), 'ARMGDDN Browser.lnk', 'an old-name shortcut still works for the relaunch');
  fs.writeFileSync(path.join(d, 'ARMGDDN App.lnk'), 'x');
  assert.equal(path.basename(s.startMenuShortcutPath(d, fs)), 'ARMGDDN App.lnk');
});

test('main.js syncs the names only for the installed Windows app and the build ships the module', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(m.includes("process.platform === 'win32' && app.isPackaged") && m.includes('shortcutNames.syncShortcutNames') && m.includes('shortcutNames.startMenuShortcutPath'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).build.files.includes('shortcutNames.js'));
});
