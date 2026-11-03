const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const hc = require('../hashCheck');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

function setup() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-ud-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-dl-'));
  const a = Buffer.from('alpha file contents');
  const b = crypto.randomBytes(5000);
  fs.writeFileSync(path.join(dir, 'a.7z.001'), a);
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.bin'), b);
  const files = [
    { name: 'a.7z.001', size: a.length, md5: md5(a) },
    { name: 'sub/b.bin', size: b.length, md5: md5(b).toUpperCase() },      // case does not matter
    { name: 'no-hash.txt', size: 3 }
  ];
  return { userData, dir, files, a, b, resolvePath: (n) => path.join(dir, n) };
}

test('a download with no checksums stores nothing', () => {
  const { userData } = setup();
  assert.strictEqual(hc.saveManifest(userData, { id: 'x', name: 'n', downloadDir: '/d', files: [{ name: 'f', size: 1 }] }), null);
  assert.strictEqual(hc.loadManifest(userData, 'x'), null);
});

test('good files match, and files without a checksum are counted, not failed', async () => {
  const s = setup();
  const doc = hc.saveManifest(s.userData, { id: 'dl-1', name: 'Game', downloadDir: s.dir, files: s.files });
  assert.strictEqual(doc.files.length, 2);
  const r = await hc.verifyManifest(hc.loadManifest(s.userData, 'dl-1'), { resolvePath: s.resolvePath });
  assert.deepStrictEqual([r.ok, r.bad.length, r.missing.length, r.notChecked], [2, 0, 0, 1]);
  assert.match(hc.describeResult(r), /All 2 checked files match/);
});

test('a changed file, a short file and a missing file are each reported', async () => {
  const s = setup();
  hc.saveManifest(s.userData, { id: 'dl-2', name: 'Game', downloadDir: s.dir, files: [...s.files, { name: 'gone.bin', size: 10, md5: md5('x') }, { name: 'short.bin', size: 100, md5: md5('y') }] });
  fs.writeFileSync(path.join(s.dir, 'sub', 'b.bin'), crypto.randomBytes(5000));      // same size, different bytes
  fs.writeFileSync(path.join(s.dir, 'short.bin'), 'tiny');
  const r = await hc.verifyManifest(hc.loadManifest(s.userData, 'dl-2'), { resolvePath: s.resolvePath });
  assert.strictEqual(r.ok, 1);
  assert.deepStrictEqual(r.bad.map((b) => [b.name, b.reason]).sort(), [['short.bin', 'wrong size'], ['sub/b.bin', 'does not match']]);
  assert.deepStrictEqual(r.missing, ['gone.bin']);
  assert.match(hc.describeResult(r), /2 files did not match/);
});

test('a file outside the download folder is never opened, and cancelling stops the check', async () => {
  const s = setup();
  hc.saveManifest(s.userData, { id: 'dl-3', name: 'Game', downloadDir: s.dir, files: s.files });
  const doc = hc.loadManifest(s.userData, 'dl-3');
  const none = await hc.verifyManifest(doc, { resolvePath: () => null });
  assert.strictEqual(none.missing.length, 2);
  let calls = 0;
  const stopped = await hc.verifyManifest(doc, { resolvePath: s.resolvePath, isCancelled: () => (calls++ >= 1) });
  assert.strictEqual(stopped.cancelled, true);
});

test('the result is kept with the manifest', async () => {
  const s = setup();
  hc.saveManifest(s.userData, { id: 'dl-4', name: 'Game', downloadDir: s.dir, files: s.files });
  const r = await hc.verifyManifest(hc.loadManifest(s.userData, 'dl-4'), { resolvePath: s.resolvePath });
  hc.saveResult(s.userData, 'dl-4', r);
  assert.strictEqual(hc.loadManifest(s.userData, 'dl-4').lastCheck.ok, 2);
  // saving the manifest again (a resumed download) keeps the last result
  hc.saveManifest(s.userData, { id: 'dl-4', name: 'Game', downloadDir: s.dir, files: s.files });
  assert.strictEqual(hc.loadManifest(s.userData, 'dl-4').lastCheck.ok, 2);
});

test('odd ids cannot escape the manifest folder', () => {
  const p = hc.manifestPath('/ud', '../../etc/passwd');
  assert.ok(p.startsWith(path.join('/ud', hc.MANIFEST_DIR_NAME)));
  assert.ok(!p.includes('..'));
});

test('Check files is gated only when Auto extract is on and automatic checking is off', () => {
  assert.strictEqual(hc.gated({ autoExtract7z: true, autoHashCheck: false }), true);
  assert.strictEqual(hc.gated({ autoExtract7z: true, autoHashCheck: true }), false);
  assert.strictEqual(hc.gated({ autoExtract7z: false, autoHashCheck: false }), false);
  assert.strictEqual(hc.gated({ autoExtract7z: false, autoHashCheck: true }), false);
  assert.strictEqual(hc.gated(null), false);
});

test('progress is reported as a percentage of the bytes checked, ending at 100', async () => {
  const s = setup();
  hc.saveManifest(s.userData, { id: 'dl-5', name: 'Game', downloadDir: s.dir, files: s.files });
  const seen = [];
  const r = await hc.verifyManifest(hc.loadManifest(s.userData, 'dl-5'), { resolvePath: s.resolvePath, onProgress: (p) => seen.push(p.percent) });
  assert.strictEqual(r.ok, 2);
  assert.strictEqual(seen[seen.length - 1], 100);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'never goes backwards');
});
