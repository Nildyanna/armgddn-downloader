'use strict';
// The free-space check before a download starts (spaceCheck.js): the arithmetic, unpack room, Windows drive letters and Linux mount
// points (statfs and stat are mocked), the blocking path and "Start anyway".
const { test } = require('node:test');
const assert = require('node:assert');
const nodePath = require('path');
const space = require('../spaceCheck');

const GB = space.GB;

// A pretend file system. drives: { key: { dev, free } } where key is a drive root ("D:\\") or mount point ("/mnt/games").
// dirs: existing folders; files: { path: size or { size, text } }.
function mockFs({ platform, drives, dirs = [], files = {} }) {
  const pl = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const norm = (p) => (platform === 'win32' ? pl.resolve(p).toLowerCase() : pl.resolve(p));
  const dirSet = new Set(dirs.map(norm));
  const fileMap = new Map(Object.entries(files).map(([k, v]) => [norm(k), typeof v === 'number' ? { size: v, text: '' } : v]));
  const mounts = Object.keys(drives).sort((a, b) => b.length - a.length);
  const driveFor = (p) => {
    const n = norm(p);
    for (const m of mounts) { const nm = norm(m); if (n === nm || n.startsWith(nm.endsWith(pl.sep) ? nm : nm + pl.sep)) return drives[m]; }
    throw Object.assign(new Error('no drive'), { code: 'ENOENT' });
  };
  const exists = (p) => dirSet.has(norm(p)) || fileMap.has(norm(p)) || Object.keys(drives).some((m) => norm(m) === norm(p));
  return {
    existsSync: exists,
    statSync: (p) => { if (!exists(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); const f = fileMap.get(norm(p)); return { dev: driveFor(p).dev, size: f ? f.size : 0 }; },
    statfsSync: (p) => { const d = driveFor(p); if (d.free < 0) throw new Error('statfs not supported'); return { bavail: Math.floor(d.free / 4096), bsize: 4096 }; },
    readFileSync: (p) => { const f = fileMap.get(norm(p)); if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return f.text; },
  };
}

test('margin: 2% of what is needed, at least 1 GB', () => {
  assert.strictEqual(space.marginFor(10 * GB), 1 * GB);
  assert.strictEqual(space.marginFor(100 * GB), 2 * GB);
  assert.strictEqual(space.marginFor(0), 1 * GB);
});

test('Windows: a 47 GB download on a D: drive with 31 GB free is blocked, with the drive letter in the message', () => {
  const fsx = mockFs({ platform: 'win32', drives: { 'D:\\': { dev: 7, free: 31 * GB } }, dirs: ['D:\\Games'] });
  const needs = space.startNeeds({ downloadDir: 'D:\\Games\\Some Game -ARMGDDN', files: [{ name: 'game.bin', size: 47 * GB }] }, { platform: 'win32', fsx });
  const r = space.checkSpace(needs, { platform: 'win32', fsx });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.short.label, 'D:');
  assert.strictEqual(r.short.required, 48 * GB);        // 47 GB + 1 GB margin
  assert.strictEqual(space.shortMessage(r.short), 'This needs 48 GB, your D: drive has 31 GB free.');
  assert.match(space.shortDetail(r.short), /47 GB still to download/);
});

test('Windows: the same download fits when the drive has room for it and the margin', () => {
  const fsx = mockFs({ platform: 'win32', drives: { 'D:\\': { dev: 7, free: 48 * GB + 1 } }, dirs: ['D:\\Games'] });
  const r = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\X', files: [{ name: 'a.bin', size: 47 * GB }] }, { platform: 'win32', fsx }), { platform: 'win32', fsx });
  assert.strictEqual(r.ok, true);
});

test('unpacking onto the same drive needs the .7z archive size again; zips and other files do not count', () => {
  const files = [{ name: 'game.7z.001', size: 15 * GB }, { name: 'game.7z.002', size: 5 * GB }, { name: 'extras.zip', size: 2 * GB }, { name: 'readme.txt', size: 1000 }];
  const fsx = mockFs({ platform: 'win32', drives: { 'D:\\': { dev: 7, free: 40 * GB } }, dirs: ['D:\\Games'] });
  const o = { platform: 'win32', fsx };
  const without = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\G', files, unpack: false }, o), o);
  assert.strictEqual(without.ok, true);            // 22 GB + 1 GB margin
  const withUnpack = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\G', files, unpack: true }, o), o);
  assert.strictEqual(withUnpack.ok, false);         // 22 GB + 20 GB unpack + 1 GB margin = 43 GB > 40 GB
  assert.strictEqual(withUnpack.short.need, 42 * GB + 1000);
  assert.match(space.shortDetail(withUnpack.short), /20 GB to unpack the \.7z files/);
});

test('an Extract folder on another drive: the unpack room is checked on that drive, the download drive only needs the download', () => {
  const files = [{ name: 'g.7z.001', size: 30 * GB }];
  const fsx = mockFs({ platform: 'win32', drives: { 'D:\\': { dev: 7, free: 35 * GB }, 'E:\\': { dev: 8, free: 10 * GB } }, dirs: ['D:\\Games', 'E:\\Unpacked'] });
  const o = { platform: 'win32', fsx };
  const r = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\G', files, unpack: true, extractDir: 'E:\\Unpacked\\G' }, o), o);
  const d = r.drives.find((x) => x.label === 'D:'); const e = r.drives.find((x) => x.label === 'E:');
  assert.strictEqual(d.short, false);
  assert.strictEqual(e.short, true);
  assert.strictEqual(r.short.label, 'E:');
  assert.strictEqual(space.shortMessage(r.short), 'This needs 31 GB, your E: drive has 10 GB free.');
});

test('Linux: the drive is the mount point; a folder that does not exist yet is checked on its parent', () => {
  const fsx = mockFs({ platform: 'linux', drives: { '/': { dev: 1, free: 500 * GB }, '/mnt/games': { dev: 2, free: 12 * GB } }, dirs: ['/mnt', '/mnt/games', '/mnt/games/ARMGDDN', '/home', '/home/m'] });
  const o = { platform: 'linux', fsx };
  const drive = space.driveOf('/mnt/games/ARMGDDN/New Game', o);
  assert.strictEqual(drive.label, '/mnt/games');
  assert.strictEqual(drive.probe, '/mnt/games/ARMGDDN');
  const r = space.checkSpace(space.startNeeds({ downloadDir: '/mnt/games/ARMGDDN/New Game', files: [{ name: 'a', size: 20 * GB }] }, o), o);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(space.shortMessage(r.short), 'This needs 21 GB, the drive at /mnt/games has 12 GB free.');
  // the home folder is on / and has room
  const home = space.checkSpace(space.startNeeds({ downloadDir: '/home/m/ARMGDDN/New Game', files: [{ name: 'a', size: 20 * GB }] }, o), o);
  assert.strictEqual(home.ok, true);
  assert.strictEqual(space.driveOf('/home/m/ARMGDDN', o).label, '/');
});

test('other unfinished downloads on the same drive count; on another drive they do not', () => {
  const fsx = mockFs({ platform: 'win32', drives: { 'D:\\': { dev: 7, free: 60 * GB }, 'C:\\': { dev: 3, free: 60 * GB } }, dirs: ['D:\\Games', 'C:\\Games'] });
  const o = { platform: 'win32', fsx };
  const files = [{ name: 'a.bin', size: 30 * GB }];
  const sameDrive = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\New', files, others: [{ dir: 'D:\\Games\\Old', bytes: 25 * GB, unpackBytes: 10 * GB }] }, o), o);
  assert.strictEqual(sameDrive.ok, false);           // 30 + 25 + 10 + 1.3 margin > 60
  assert.match(space.shortDetail(sameDrive.short), /35 GB for your other downloads/);
  const otherDrive = space.checkSpace(space.startNeeds({ downloadDir: 'D:\\Games\\New', files, others: [{ dir: 'C:\\Games\\Old', bytes: 25 * GB, unpackBytes: 10 * GB }] }, o), o);
  assert.strictEqual(otherDrive.ok, true);
});

test('what is already on disk is not asked for again: finished files, resumable and segmented partials', () => {
  const dir = '/data/ARMGDDN/G';
  const fsx = mockFs({
    platform: 'linux', drives: { '/': { dev: 1, free: 1 } }, dirs: ['/data', '/data/ARMGDDN', dir],
    files: {
      [dir + '/done.bin']: 100,                                              // finished
      [dir + '/single.bin']: 40, [dir + '/single.bin.armpart']: 5,            // resumable engine: 40 of 100 bytes
      [dir + '/seg.bin.armseg']: { size: 10, text: JSON.stringify({ v: 1, total: 100, chunk: 50, done: [50, 20] }) },   // 70 of 100
      [dir + '/foreign.bin']: 30,                                            // another size, no marker: downloaded again
    }
  });
  const files = ['done.bin', 'single.bin', 'seg.bin', 'foreign.bin', 'new.bin'].map((name) => ({ name, size: 100 }));
  assert.strictEqual(space.remainingBytes(dir, files, { platform: 'linux', fsx }), 0 + 60 + 30 + 100 + 100);
});

test('free space that cannot be read does not block the download', () => {
  const fsx = mockFs({ platform: 'win32', drives: { 'Z:\\': { dev: 9, free: -1 } }, dirs: ['Z:\\'] });
  const r = space.checkSpace([{ dir: 'Z:\\Games\\G', bytes: 999 * GB }], { platform: 'win32', fsx });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.drives[0].free, -1);
});

test('formatGB rounds like Explorer', () => {
  assert.strictEqual(space.formatGB(48 * GB), '48 GB');
  assert.strictEqual(space.formatGB(9.54 * GB), '9.5 GB');
  assert.strictEqual(space.formatGB(700 * 1024 * 1024), '700 MB');
});

// The start flow: check -> box -> choice.
const short = { ok: false, short: { label: 'D:' }, drives: [] };
const fine = { ok: true, short: null, drives: [] };

test('blocking path: short of space and the member cancels -> the download does not start', async () => {
  const asked = [];
  const out = await space.decideStart({ baseDir: 'D:\\Games', check: async () => short, ask: async (r) => { asked.push(r); return 'cancel'; } });
  assert.strictEqual(out.start, false);
  assert.strictEqual(asked.length, 1);
});

test('"Start anyway" starts it in the same folder and says it was forced', async () => {
  const out = await space.decideStart({ baseDir: 'D:\\Games', check: async () => short, ask: async () => 'anyway' });
  assert.deepStrictEqual([out.start, out.forced, out.baseDir, out.skipUnpack], [true, true, 'D:\\Games', false]);
});

test('"Choose another folder": the new folder is checked again and used when it has room', async () => {
  const checked = [];
  const out = await space.decideStart({
    baseDir: 'D:\\Games',
    check: async (dir) => { checked.push(dir); return dir.startsWith('E:') ? fine : short; },
    ask: async () => 'folder',
    pickFolder: async () => 'E:\\More Games',
  });
  assert.deepStrictEqual(checked, ['D:\\Games', 'E:\\More Games']);
  assert.deepStrictEqual([out.start, out.forced, out.baseDir], [true, false, 'E:\\More Games']);
});

test('closing the folder picker asks again; "Download without unpacking" re-checks without the unpack room', async () => {
  const answers = ['folder', 'nounpack'];
  const seen = [];
  const out = await space.decideStart({
    baseDir: 'D:\\Games',
    check: async (dir, st) => { seen.push(st.skipUnpack); return st.skipUnpack ? fine : short; },
    ask: async () => answers.shift(),
    pickFolder: async () => null,
  });
  assert.deepStrictEqual(seen, [false, false, true]);
  assert.deepStrictEqual([out.start, out.skipUnpack, out.baseDir], [true, true, 'D:\\Games']);
});

test('enough room: no box at all', async () => {
  let asked = 0;
  const out = await space.decideStart({ baseDir: '/x', check: async () => fine, ask: async () => { asked++; return 'cancel'; } });
  assert.deepStrictEqual([out.start, asked], [true, 0]);
});
