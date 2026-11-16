const { test } = require('node:test');
const assert = require('node:assert');
const { linuxNotify, cleanEnv } = require('../notify');

test('a notification is handed to notify-send with the title and text after the -- marker', () => {
  const calls = [];
  const ok = linuxNotify('Download complete', 'Some Game is done', (cmd, args, opts, cb) => { calls.push({ cmd, args, opts }); cb(null); });
  assert.strictEqual(ok, true);
  assert.strictEqual(calls[0].cmd, 'notify-send');
  assert.deepStrictEqual(calls[0].args.slice(-3), ['--', 'Download complete', 'Some Game is done']);
  assert.ok(calls[0].opts.timeout > 0);
});

test('text that looks like an option cannot be taken for one', () => {
  const calls = [];
  linuxNotify('--urgency=critical', '-t 1', (cmd, args) => { calls.push(args); });
  const a = calls[0];
  assert.ok(a.indexOf('--') < a.indexOf('--urgency=critical'));
});

test('a missing notify-send or a throwing launcher never throws', () => {
  assert.strictEqual(linuxNotify('a', 'b', (cmd, args, opts, cb) => cb(new Error('ENOENT'))), true);
  assert.strictEqual(linuxNotify('a', 'b', () => { throw new Error('spawn failed'); }), false);
});

test('the AppImage library paths are not passed to the system program', () => {
  const env = cleanEnv({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib', LD_PRELOAD: 'x', APPDIR: '/tmp/.mount_x', HOME: '/home/a' });
  assert.deepStrictEqual(env, { PATH: '/usr/bin', HOME: '/home/a' });
});

test('long text is cut', () => {
  const calls = [];
  linuxNotify('t'.repeat(500), 'b'.repeat(2000), (cmd, args) => { calls.push(args); });
  assert.ok(calls[0][calls[0].length - 2].length <= 120 && calls[0][calls[0].length - 1].length <= 400);
});
