const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateSetup } = require('../setupCheck');

const GB = 1024 ** 3;
const facts = (downloadPath) => ({
  platform: 'win32', downloadPath, homeDir: 'C:\\Users\\someone', tempDir: 'C:\\Users\\someone\\AppData\\Local\\Temp',
  freeDownload: 131 * GB, freeTemp: 39 * GB,
});
const pathFinding = (p) => evaluateSetup(facts(p)).find(f => f.id === 'download-path');

test('the root of a drive is flagged as a download folder', () => {
  for (const p of ['D:\\', 'D:', 'd:/', 'C:\\']) {
    const f = pathFinding(p);
    assert.strictEqual(f.status, 'warn', p);
    assert.match(f.title, /root of a drive/);
    assert.match(f.detail, /D:\\Games/);
  }
});

test('a short plain folder on a drive is still fine', () => {
  for (const p of ['D:\\Games', 'D:\\ARMGDDN']) {
    assert.strictEqual(pathFinding(p).status, 'ok', p);
  }
});
