'use strict';
// Nov 25 2026 review: a folder at the top of a drive, crash-reload loops in the window, the window caches' memory, and raising windows on Linux.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('node:events');
const { sanitizeRelativePath, resolveInside, raiseWindow } = require('../main/util');
const { watchWindow } = require('../native/hangWatch');
const { createApiClient, createByteCache } = require('../native/apiClient');

test('sanitizeRelativePath: keeps normal names, strips anchors, refuses climbing out', () => {
  assert.equal(sanitizeRelativePath('Game/Part1.7z'), 'Game/Part1.7z');
  assert.equal(sanitizeRelativePath('Game\\Sub\\a.bin'), 'Game/Sub/a.bin');
  assert.equal(sanitizeRelativePath('C:Games/a'), 'Games/a');
  assert.equal(sanitizeRelativePath('/Games/a'), 'Games/a');
  assert.equal(sanitizeRelativePath('.'), '');
  for (const bad of ['../x', '..', 'a/../../x', '..\\..\\Windows\\x', 'a\0b', '', null, 42]) assert.equal(sanitizeRelativePath(bad), null, String(bad));
});

test('resolveInside: a folder at the top of a drive works (it refused every file before)', () => {
  assert.equal(resolveInside('D:\\', 'Game\\a.7z', path.win32), 'D:\\Game\\a.7z');
  assert.equal(resolveInside('D:\\', '', path.win32), 'D:\\');
  assert.equal(resolveInside('/', 'Game/a.7z', path.posix), '/Game/a.7z');
  assert.equal(resolveInside('D:\\Games', 'x\\a.7z', path.win32), 'D:\\Games\\x\\a.7z');
});

test('resolveInside: still refuses anything outside the folder', () => {
  assert.equal(resolveInside('D:\\Games', '..\\Other\\a', path.win32), null);
  assert.equal(resolveInside('D:\\Games', 'C:\\Windows\\a', path.win32), null);
  assert.equal(resolveInside('D:\\Games', '..\\GamesX\\a', path.win32), null, 'a sibling whose name starts the same');
  assert.equal(resolveInside('/home/m/Games', '../GamesX/a', path.posix), null);
  assert.equal(resolveInside('/', '../etc', path.posix), '/etc', 'at the root there is nothing above to escape to');
});

function fakeWin() {
  const win = new EventEmitter();
  win.webContents = Object.assign(new EventEmitter(), { reloaded: 0, reloadIgnoringCache() { this.reloaded++; }, reload() { this.reloaded++; } });
  win.isDestroyed = () => false;
  return win;
}

test('a page that keeps dying is reloaded only a few times, then left alone', () => {
  const win = fakeWin(), lines = []; let t = 1000;
  watchWindow(win, (l) => lines.push(l), 'Browser', { metrics: () => [], now: () => t, maxReloads: 3, reloadWindowMs: 60000 });
  for (let i = 0; i < 6; i++) { win.webContents.emit('render-process-gone', {}, { reason: 'launch-failed', exitCode: 0 }); t += 1000; }
  assert.equal(win.webContents.reloaded, 3);
  assert.ok(lines.some((l) => /not reloading it again/.test(l)));
});

test('the reload budget comes back once the page has stayed up', () => {
  const win = fakeWin(); let t = 0;
  watchWindow(win, () => { }, 'Browser', { metrics: () => [], now: () => t, maxReloads: 2, reloadWindowMs: 60000 });
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); t += 1000;
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); t += 1000;
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.webContents.reloaded, 2);
  t += 120000;
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(win.webContents.reloaded, 3);
});

test('byte cache: keeps under its byte budget and entry limit, least recently used out first', () => {
  const c = createByteCache({ maxBytes: 100, maxEntries: 3 });
  const v = (n) => ({ buf: Buffer.alloc(n) });
  c.set('a', v(40)); c.set('b', v(40));
  c.get('a');                       // a is now the most recent
  c.set('c', v(40));                // 120 bytes: b goes
  assert.equal(c.get('b'), undefined);
  assert.ok(c.get('a') && c.get('c'));
  assert.ok(c.bytes <= 100);
  c.set('d', v(1)); c.set('e', v(1)); c.set('f', v(1));
  assert.ok(c.size <= 3);
  c.set('huge', v(500));
  assert.equal(c.get('huge'), undefined, 'bigger than the whole budget: not kept');
  c.set('d', v(10)); assert.ok(c.bytes <= 100, 'replacing an entry counts its old size out');
});

test('API answer cache: expired answers and the oldest go once the limit is reached', async () => {
  const fetchImpl = async (url) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ url }) });
  const api = createApiClient({ getToken: () => 'x'.repeat(40), fetchImpl, maxCacheEntries: 5, sleep: async () => { } });
  for (let i = 0; i < 20; i++) await api.get('/api/browse?f=' + i, { ttlMs: 60000 });
  assert.ok(api.cacheSize() <= 5, 'size ' + api.cacheSize());
  const again = await api.get('/api/browse?f=19', { ttlMs: 60000 });
  assert.equal(again.url.endsWith('f=19'), true);
});

test('raiseWindow: moveTop on Linux, never focus(); focus elsewhere', () => {
  const mk = () => { const calls = []; return { calls, isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'), moveTop: () => calls.push('moveTop') }; };
  const l = mk(); raiseWindow(l, 'linux');
  assert.deepEqual(l.calls, ['restore', 'show', 'moveTop']);
  const w = mk(); raiseWindow(w, 'win32');
  assert.deepEqual(w.calls, ['restore', 'show', 'focus']);
  assert.equal(raiseWindow(null, 'linux'), false);
});

test('no window is raised with focus() on Linux (CLAUDE.md rule)', () => {
  const root = path.join(__dirname, '..');
  const files = ['main.js', ...fs.readdirSync(path.join(root, 'main')).filter((f) => f.endsWith('.js')).map((f) => 'main/' + f),
    ...fs.readdirSync(path.join(root, 'native')).filter((f) => f.endsWith('.js')).map((f) => 'native/' + f)];
  const bad = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\.focus\(\)/.test(line) || /^\s*\/\//.test(line)) return;
      const near = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!/platform\s*(===|!==)\s*'linux'|platform === 'linux'/.test(near)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'focus() without a Linux guard');
});
