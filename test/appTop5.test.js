'use strict';
// The app changes of Nov 24 2026 (George: "do all 5"): install a waiting update on quit, the app window honours "Update automatically",
// why a download was not checked and the app's own timings go to the site, a pre-download failure counts as a failed file, and the
// built app's smoke test runs a real download through the engine.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('quitting with an update waiting installs it without a relaunch, only when nothing downloads and the setting is on', () => {
  const m = read('main.js');
  const i = m.indexOf("app.on('before-quit', (e) => {");
  assert.ok(i > 0);
  const hook = m.slice(i, i + 1600);
  for (const want of ['_updateAnnouncedVersion', "settings.installUpdatesOnQuit === false", 'anyDownloadRunning()', 'isTestBuild', 'e.preventDefault()',
    'relaunchAfterInstall: false', '_quitUpdateTried = true', 'SMOKE_TEST']) assert.ok(hook.includes(want), want);
  assert.ok(m.includes('installUpdatesOnQuit: true,'), 'on by default');
  assert.ok(read('main/ipcSettings.js').includes("'installUpdatesOnQuit',"), 'the setting can be saved');
  assert.ok(read('main/ipcApp.js').includes('module.exports.installUpdate = installUpdate;'));
});

test('the app window acts on "Update automatically" and shows the new setting', () => {
  const a = read('renderer/native/app.mjs');
  assert.ok(a.includes('st && st.autoUpdate && !autoUpdateTried.current'));
  assert.ok(a.includes("${settingRow('installUpdatesOnQuit')}"));
});

test('the final report carries the app timings and why no file check ran', () => {
  const p = read('main/progress.js');
  for (const want of ['appStartedAt:', 'appFinishedAt:', 'hashSkipReason:']) assert.ok(p.includes(want), want);
  const c = read('main/completion.js');
  assert.ok(c.includes("'setting off'") && c.includes("'no checksums in the list'") && c.includes("'no saved checksum list'"));
});

test('a file task that fails before the downloader takes it counts as a failed file', () => {
  const d = read('main/ipcDownloads.js');
  const i = d.indexOf('[Scheduler] file task failed');
  assert.ok(d.slice(i, i + 900).includes('download.failedFiles.push(f.name)'));
});

test('the smoke test never reports to the site and runs a real download', () => {
  for (const f of ['main/progress.js', 'main/hashing.js', 'main/failures.js']) assert.ok(read(f).includes('if (ctx.SMOKE_TEST) return;'), f);
  const s = read('main/smokeTest.js');
  assert.ok(s.includes("require('./ipcDownloads').startDownload(null, manifest"));
  assert.ok(s.includes("engine: the unpacked file is missing or differs from the original"));
  assert.ok(read('main/downloader.js').includes("mainState.SMOKE_TEST && /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\//"), 'plain http only for the local test server');
});
