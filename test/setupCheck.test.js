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

// ---- Linux and macOS
const { parseMounts, mountFor } = require('../setupCheck');
const LINUX_MOUNTS = '/dev/nvme0n1p2 / ext4 rw,relatime 0 0\n/dev/sda1 /mnt/games ntfs3 rw,relatime 0 0\n/dev/sdb1 /mnt/usb vfat rw 0 0\n/dev/sdc1 /mnt/ro ext4 ro,relatime 0 0\n';
const MAC_MOUNT = '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n/dev/disk4s1 on /Volumes/Big Disk (ntfs, local, nodev, nosuid, read-only, noowners)\n';
const posix = (platform, dl, extra) => Object.assign({
  platform, downloadPath: dl, homeDir: platform === 'darwin' ? '/Users/someone' : '/home/someone', tempDir: '/tmp',
  freeDownload: 200 * GB, mounts: parseMounts(platform === 'darwin' ? MAC_MOUNT : LINUX_MOUNTS),
}, extra || {});
const byId = (facts, id) => evaluateSetup(facts).find(f => f.id === id);

test('mount tables from Linux and macOS are read, and the longest mount wins', () => {
  const l = mountFor('/mnt/games/ARMGDDN', parseMounts(LINUX_MOUNTS));
  assert.strictEqual(l.fs, 'ntfs3');
  assert.strictEqual(mountFor('/home/x/Games', parseMounts(LINUX_MOUNTS)).fs, 'ext4');
  assert.strictEqual(mountFor('/Volumes/Big Disk/Games', parseMounts(MAC_MOUNT)).fs, 'ntfs');
});

test('Linux: FAT and read-only drives are warned about, NTFS only noted, ext4 is fine', () => {
  assert.strictEqual(byId(posix('linux', '/mnt/usb/Games'), 'download-fs').status, 'warn');
  assert.strictEqual(byId(posix('linux', '/mnt/ro/Games'), 'download-fs').status, 'warn');
  assert.strictEqual(byId(posix('linux', '/mnt/games/Games'), 'download-fs').status, 'info');
  assert.strictEqual(byId(posix('linux', '/home/someone/Games'), 'download-fs').status, 'ok');
});

test('Linux: ~/Downloads is fine, /tmp and system folders are not, and no Windows advice appears', () => {
  assert.strictEqual(byId(posix('linux', '/home/someone/Downloads'), 'download-path').status, 'ok');
  assert.strictEqual(byId(posix('linux', '/tmp/games'), 'download-path').status, 'warn');
  assert.strictEqual(byId(posix('linux', '/opt/games'), 'download-path').status, 'warn');
  const all = evaluateSetup(posix('linux', '/tmp/games', { maxMapCount: 65530, wine: false }));
  assert.ok(!all.some(f => /Defender|redistrib|Windows temp|D:\\/i.test(f.title + f.detail)));
  assert.strictEqual(all.find(f => f.id === 'map-count').status, 'warn');
  assert.strictEqual(all.find(f => f.id === 'wine').status, 'info');
});

test('Linux: a high vm.max_map_count raises nothing', () => {
  assert.ok(!evaluateSetup(posix('linux', '/home/someone/Games', { maxMapCount: 1048576, wine: true })).some(f => f.id === 'map-count'));
});

test('macOS: iCloud/Desktop folders, NTFS drives, a misplaced app and missing Rosetta are warned about', () => {
  assert.strictEqual(byId(posix('darwin', '/Users/someone/Desktop/Games'), 'download-path').status, 'warn');
  assert.strictEqual(byId(posix('darwin', '/Users/someone/Library/Mobile Documents/x'), 'download-path').status, 'warn');
  assert.strictEqual(byId(posix('darwin', '/Users/someone/Games'), 'download-path').status, 'ok');
  assert.strictEqual(byId(posix('darwin', '/Volumes/Big Disk/Games'), 'download-fs').status, 'warn');
  const f = evaluateSetup(posix('darwin', '/Users/someone/Games', { appMisplaced: true, arch: 'arm64', rosetta: false, winLayer: false }));
  assert.strictEqual(f.find(x => x.id === 'app-location').status, 'warn');
  assert.strictEqual(f.find(x => x.id === 'rosetta').status, 'warn');
  assert.strictEqual(f.find(x => x.id === 'wine').status, 'info');
});

test('the report code carries the Linux and macOS facts without any path', () => {
  const { buildReport, decodeReport } = require('../setupReport');
  const facts = posix('linux', '/mnt/usb/Games', { maxMapCount: 65530, wine: false });
  const rep = decodeReport(buildReport({ appVersion: '5.8.0', platform: 'linux', release: '6.8', arch: 'x64', findings: evaluateSetup(facts), facts, logText: '' }));
  assert.deepStrictEqual(rep.facts.fs, { type: 'vfat', ro: false });
  assert.strictEqual(rep.facts.maxMap, 65530);
  assert.strictEqual(rep.facts.wine, false);
  assert.strictEqual(rep.facts.dlDrive, null);
  assert.ok(!JSON.stringify(rep).includes('/mnt/usb'));
});


test('the comics folder: a slow read, a network or cloud folder warn; a quick local one is fine; none chosen says nothing', () => {
  const { comicsKind, COMICS_SLOW_MS } = require('../setupCheck');
  const find = (extra) => evaluateSetup({ ...facts('D:\\Games'), ...extra }).find((f) => f.id === 'comics-folder');
  assert.strictEqual(find({}), undefined);
  assert.strictEqual(find({ comicsFolder: 'D:\\Comics', comicsReadMs: 8 }).status, 'ok');
  const slow = find({ comicsFolder: 'R:\\', comicsReadMs: COMICS_SLOW_MS + 1 });
  assert.strictEqual(slow.status, 'warn');
  assert.match(slow.detail, /name and size/);
  assert.strictEqual(find({ comicsFolder: 'R:\\', comicsReadMs: null, comicsTimedOut: true }).status, 'warn');
  assert.strictEqual(find({ comicsFolder: '\\\\nas\\comics', comicsReadMs: 5, comicsKind: 'network' }).status, 'warn');
  assert.strictEqual(find({ comicsFolder: 'D:\\Comics', comicsReadMs: null }).status, 'info');
  assert.strictEqual(comicsKind('\\\\nas\\comics', {}), 'network');
  assert.strictEqual(comicsKind('C:\\Users\\a\\OneDrive\\Comics', {}), 'cloud');
  assert.strictEqual(comicsKind('/Users/a/Library/CloudStorage/GoogleDrive-a/Comics', {}), 'cloud');
  assert.strictEqual(comicsKind('D:\\Comics', {}), null);
  assert.strictEqual(comicsKind('/mnt/nas/comics', { mounts: [{ mount: '/mnt/nas', fs: 'cifs', opts: [] }] }), 'network');
  assert.strictEqual(comicsKind('/home/a/comics', { mounts: [{ mount: '/', fs: 'ext4', opts: [] }] }), null);
});

test('the whole-log cleaner removes personal details and keeps the newest lines within the size', () => {
  const { cleanLog } = require('../setupReport');
  const text = ['old line', 'C:\\Users\\George\\AppData\\x failed for a@b.co token=abcdef123456', 'GET https://x.y/z?key=secret 10.0.0.5'].join('\n');
  const out = cleanLog(text);
  assert.ok(!/George|a@b\.co|abcdef123456|key=secret|10\.0\.0\.5/.test(out));
  assert.ok(/<user>/.test(out) && /old line/.test(out));
  assert.deepStrictEqual(cleanLog('aaaa\nbbbb\ncccc', 12).split('\n'), ['bbbb', 'cccc']);
});
