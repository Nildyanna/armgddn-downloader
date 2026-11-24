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

test('ARMGDDN App install screen: app-styled, opens before the app closes, starts the installer once the app is gone', () => {
  const { buildRunner } = require('../updateRunner');
  const base = { pid: 42, filePath: 'C:\\t\\Setup.exe', appExe: 'C:\\a.exe', wrapperLogPath: 'C:\\l.log', resultPath: 'C:\\r.json', silentArg: '/S --updated', shouldRelaunch: true, appName: 'ARMGDDN App' };
  const r = buildRunner({ ...base, screen: { x: -1920, y: 0, w: 2752, h: 1152, scale: 1.25, bg: 'rgb(13, 10, 18)', fg: '#f3eff8', accent: '#B6FF3B', version: '6.9.0', logo: 'C:\\Users\\me\\AppData\\Roaming\\armgddn\\update-logo.png' } });
  assert.match(r, /FormBorderStyle = 'None'/);
  assert.match(r, /Rectangle\(-1920, 0, 2752, 1152\)/);
  assert.match(r, /FromHtml\('#0d0a12'\)/);
  assert.match(r, /FromHtml\('#b6ff3b'\)/);
  assert.match(r, /Updating ARMGDDN App to v6\.9\.0/);
  assert.match(r, /SetProcessDPIAware/);
  assert.ok(r.indexOf('ShowDialog') < r.lastIndexOf('\r\nStart-InstallerOnce\r\n'), 'the screen opens first; the installer starts from its timer');
  assert.match(r, /if \(-not \$script:proc\) \{ if \(-not \(Get-Process -Id \$pid_to_wait/);
  assert.doesNotMatch(r, /Marquee/);
  // the old app keeps the small box
  const c = buildRunner({ ...base, appName: 'ARMGDDN Companion' });
  assert.match(c, /Marquee/);
  assert.ok(c.indexOf('\r\nStart-InstallerOnce\r\n') < c.indexOf('ShowDialog'));
});

test('install screen values are cleaned before they reach PowerShell', () => {
  const { screenSpec, hexColor } = require('../updateRunner');
  assert.strictEqual(hexColor("#abc'); Remove-Item C:\\ #", '#000000'), '#000000');
  assert.strictEqual(hexColor('#ABC', 'x'), '#aabbcc');
  assert.strictEqual(hexColor('rgba(1, 2, 3, 0)', '#111111'), '#111111');
  const s = screenSpec({ w: 'x', h: 10, logo: "C:\\x'.png; calc", version: "6.9.0'; calc" });
  assert.strictEqual(s.w, 1100); assert.strictEqual(s.h, 320);
  assert.strictEqual(s.version, '');
  assert.strictEqual(screenSpec(null), null);
  assert.strictEqual(screenSpec({ logo: 'D:\\a b\\logo.png' }).logo, 'D:\\a b\\logo.png');
});
