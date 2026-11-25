'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { folderOpenSpec, openFolderDefault } = require('../main/openFolder');

test('Windows opens folders with Start-Process (default file manager); the path only travels in an env variable', () => {
  const dir = "C:\\Games\\It's $(evil) & co; `x`";
  const s = folderOpenSpec(dir, 'win32');
  assert.equal(s.cmd, 'powershell.exe');
  assert.equal(s.env.ARMGDDN_OPEN_DIR, dir);
  assert.ok(s.args.every((a) => !a.includes('Games')));
  assert.match(s.args[s.args.length - 1], /^Start-Process -LiteralPath \$env:ARMGDDN_OPEN_DIR$/);
  assert.equal(folderOpenSpec(dir, 'linux'), null);
  assert.equal(folderOpenSpec('', 'win32'), null);
});

function fakeSpawn(code, err) {
  const calls = [];
  const fn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); const c = new EventEmitter(); setImmediate(() => (err ? c.emit('error', new Error('no ps')) : c.emit('exit', code))); return c; };
  fn.calls = calls; return fn;
}

test('Windows: success uses the default handler; a failure falls back to shell.openPath', async () => {
  const opened = [];
  const shell = { openPath: async (p) => { opened.push(p); return ''; } };
  const ok = fakeSpawn(0);
  assert.equal(await openFolderDefault('D:\\x', { platform: 'win32', shell, spawn: ok }), 'default');
  assert.equal(ok.calls[0].opts.env.ARMGDDN_OPEN_DIR, 'D:\\x'); assert.equal(ok.calls[0].opts.windowsHide, true);
  assert.deepEqual(opened, []);
  assert.equal(await openFolderDefault('D:\\y', { platform: 'win32', shell, spawn: fakeSpawn(1) }), 'shell');
  assert.equal(await openFolderDefault('D:\\z', { platform: 'win32', shell, spawn: fakeSpawn(0, true) }), 'shell');
  assert.deepEqual(opened, ['D:\\y', 'D:\\z']);
});

test('Linux and macOS keep shell.openPath', async () => {
  const opened = [];
  const r = await openFolderDefault('/home/a', { platform: 'linux', shell: { openPath: async (p) => { opened.push(p); return ''; } }, spawn: () => { throw new Error('must not spawn'); } });
  assert.equal(r, 'shell'); assert.deepEqual(opened, ['/home/a']);
});
