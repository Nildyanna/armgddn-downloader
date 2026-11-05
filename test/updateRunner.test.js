const { test } = require('node:test');
const assert = require('node:assert');
const { buildRunner, installIsRunning, progressPayload } = require('../updateRunner');

test('the runner waits for the app, installs, shows a window until done and relaunches only on success', () => {
  const r = buildRunner({ pid: 123, filePath: "C:\\t\\Set'up.exe", appExe: 'C:\\a.exe', wrapperLogPath: 'C:\\l.log', resultPath: 'C:\\r.json', silentArg: '/S --updated', shouldRelaunch: true, shortcut: '' });
  assert.match(r, /\$pid_to_wait = 123/);
  assert.match(r, /Set''up\.exe/);
  assert.ok(r.indexOf('Start-Process -FilePath $installer') < r.indexOf('ShowDialog'));
  assert.ok(r.indexOf('ShowDialog') < r.indexOf('installer finished rc='));
  assert.doesNotMatch(r, /Start-Process -FilePath \$installer[^\r\n]*-Wait/);
  assert.match(r, /\$shouldRelaunch = \$true/);
});

test('an install that started a minute ago blocks a second one; an old or finished marker does not', () => {
  const now = 1_000_000_000;
  assert.strictEqual(installIsRunning('{"state":"installing"}', now - 60e3, now), true);
  assert.strictEqual(installIsRunning('{"state":"installing"}', now - 6 * 60e3, now), false);
  assert.strictEqual(installIsRunning('{"state":"success","exitCode":0}', now - 1e3, now), false);
  assert.strictEqual(installIsRunning('not json', now, now), false);
});

test('download progress uses the header size, then the listed size, then falls back to megabytes', () => {
  assert.strictEqual(progressPayload(50, 100, 0, 1).percent, 50);
  assert.strictEqual(progressPayload(50, NaN, 200, 1).percent, 25);
  const p = progressPayload(5 * 1048576, NaN, 0, 1);
  assert.strictEqual(p.percent, undefined);
  assert.match(p.status, /5\.0 MB/);
});
