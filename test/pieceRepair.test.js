'use strict';
// Repair instead of re-download (2026-11-25): a damaged file gets only its damaged pieces downloaded again (main/pieceRepair.js +
// segmentedDownload.repairRanges); when that cannot work or does not fix it, the whole file is downloaded again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { repairRanges } = require('../segmentedDownload');
const pr = require('../main/pieceRepair');

const MiB = 1024 * 1024;
const PS = MiB;                       // the smallest piece size the engine accepts; production uses 64 MiB
const SIZE = 5 * MiB + 300 * 1024;    // 6 pieces, the last one short

function fixture(size, seed = 1) {
  const b = Buffer.alloc(size);
  let x = seed;
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >>> 16 & 0xff; }
  return b;
}
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fingerprints = (b, ps = PS) => { const out = []; for (let i = 0; i < b.length; i += ps) out.push(sha(b.subarray(i, i + ps))); return out; };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'piecerepair-'));
const ORIGINAL = fixture(SIZE, 42);

// Serves `content()` with Range support and records every range asked for.
function rangeServer(content) {
  const ranges = [];
  const server = http.createServer((req, res) => {
    const body = content();
    const m = /^bytes=(\d+)-(\d+)?$/.exec(String(req.headers.range || ''));
    if (!m) { res.writeHead(200, { 'Content-Length': body.length }); return res.end(body); }
    const start = Number(m[1]); const end = m[2] != null ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    ranges.push([start, end]);
    res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${body.length}` });
    res.end(body.subarray(start, end + 1));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, ranges, url: `http://127.0.0.1:${server.address().port}/f.7z` })));
}

// The original with bytes flipped at known offsets (pieces 1 and 3).
function damaged() {
  const b = Buffer.from(ORIGINAL);
  b[1 * PS + 12345] ^= 0xff;
  b[3 * PS + 7] ^= 0x01;
  b[3 * PS + 500000] ^= 0x80;
  return b;
}

test('repairRanges fetches only the listed pieces into the existing file and gives it back under its own name', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, damaged());
  const srv = await rangeServer(() => ORIGINAL);
  try {
    await repairRanges({ url: srv.url, outputPath: file, expectedSize: SIZE, pieceSize: PS, pieces: [1, 3], streams: 2, retryDelayMs: 10 }).promise;
    assert.deepStrictEqual(srv.ranges.sort((a, b) => a[0] - b[0]), [[1 * PS, 2 * PS - 1], [3 * PS, 4 * PS - 1]]);
    assert.strictEqual(md5(fs.readFileSync(file)), md5(ORIGINAL));
    assert.deepStrictEqual(fs.readdirSync(dir), ['f.7z'], 'no .armdl or .armseg left behind');
  } finally { srv.server.close(); }
});

test('repairRanges refuses a file of the wrong size, and a failed run puts the file back', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, ORIGINAL.subarray(0, SIZE - 1));
  await assert.rejects(repairRanges({ url: 'http://127.0.0.1:1/x', outputPath: file, expectedSize: SIZE, pieceSize: PS, pieces: [0] }).promise, /expected size/);
  fs.writeFileSync(file, damaged());
  const srv = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(repairRanges({ url: `http://127.0.0.1:${srv.address().port}/x`, outputPath: file, expectedSize: SIZE, pieceSize: PS, pieces: [1], retryDelayMs: 10 }).promise);
    assert.deepStrictEqual(fs.readdirSync(dir), ['f.7z']);
    assert.strictEqual(fs.statSync(file).size, SIZE);
  } finally { srv.close(); }
});

test('repairFile: injected damage in pieces 1 and 3 -> only those two pieces are downloaded, the file then matches', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, damaged());
  const srv = await rangeServer(() => ORIGINAL);
  const texts = [];
  try {
    const out = await pr.repairFile({
      filePath: file, size: SIZE, md5: md5(ORIGINAL),
      getFingerprints: async () => ({ state: 'ready', pieceSize: PS, sha256: fingerprints(ORIGINAL) }),
      fetchPieces: ({ pieceSize, pieces }) => repairRanges({ url: srv.url, outputPath: file, expectedSize: SIZE, pieceSize, pieces, streams: 4, retryDelayMs: 10 }).promise,
      onStatus: (t) => texts.push(t)
    });
    assert.deepStrictEqual(out, { outcome: 'repaired', pieces: 2, bytes: 2 * PS });
    assert.strictEqual(srv.ranges.length, 2);
    assert.ok(texts.includes('Repairing 2 damaged parts (2 MB)…'), texts.join(' | '));
    assert.strictEqual(md5(fs.readFileSync(file)), md5(ORIGINAL));
  } finally { srv.server.close(); }
});

test('repairFile: a short file (cut off) is extended and its missing pieces downloaded', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, ORIGINAL.subarray(0, 3 * PS + 10));
  const srv = await rangeServer(() => ORIGINAL);
  try {
    const out = await pr.repairFile({
      filePath: file, size: SIZE, md5: md5(ORIGINAL),
      getFingerprints: async () => ({ state: 'ready', pieceSize: PS, sha256: fingerprints(ORIGINAL) }),
      fetchPieces: ({ pieceSize, pieces }) => repairRanges({ url: srv.url, outputPath: file, expectedSize: SIZE, pieceSize, pieces, streams: 2, retryDelayMs: 10 }).promise
    });
    assert.strictEqual(out.outcome, 'repaired');
    assert.strictEqual(out.pieces, 3);       // piece 3 (partly there) and 4, 5
    assert.strictEqual(md5(fs.readFileSync(file)), md5(ORIGINAL));
  } finally { srv.server.close(); }
});

test('repairFile: still wrong after the repair -> the whole file is downloaded again', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, damaged());
  // The server's first answers carry other damage (as if the repair download were also bad); the full download gets good bytes.
  let calls = 0;
  const srv = await rangeServer(() => (calls === 0 ? damaged() : ORIGINAL));
  const seen = [];
  try {
    const out = await pr.repairFile({
      filePath: file, size: SIZE, md5: md5(ORIGINAL),
      getFingerprints: async () => ({ state: 'ready', pieceSize: PS, sha256: fingerprints(ORIGINAL) }),
      fetchPieces: async (o) => { seen.push(o); await repairRanges({ url: srv.url, outputPath: file, expectedSize: SIZE, pieceSize: o.pieceSize, pieces: o.pieces, streams: 2, retryDelayMs: 10 }).promise; calls++; },
      fullPieceSize: PS
    });
    assert.strictEqual(out.outcome, 'redownloaded');
    assert.match(out.reason, /still did not match after repair/);
    assert.deepStrictEqual(seen.map((o) => [o.full, o.pieces.length]), [[false, 2], [true, 6]]);
    assert.strictEqual(md5(fs.readFileSync(file)), md5(ORIGINAL));
  } finally { srv.server.close(); }
});

test('repairFile: no fingerprints (switched off, old site, error) -> whole file again; still bad -> failed', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, damaged());
  const calls = [];
  const out = await pr.repairFile({
    filePath: file, size: SIZE, md5: md5(ORIGINAL),
    getFingerprints: async () => ({ state: 'unavailable', reason: 'HTTP 503 (switched off)' }),
    fetchPieces: async (o) => { calls.push(o); fs.writeFileSync(file, ORIGINAL); },
    fullPieceSize: PS
  });
  assert.strictEqual(out.outcome, 'redownloaded');
  assert.deepStrictEqual(calls.map((c) => c.full), [true]);

  fs.writeFileSync(file, damaged());
  const bad = await pr.repairFile({
    filePath: file, size: SIZE, md5: md5(ORIGINAL),
    getFingerprints: async () => { throw new Error('offline'); },
    fetchPieces: async () => { },
    fullPieceSize: PS
  });
  assert.strictEqual(bad.outcome, 'failed');
});

test('repairFile: fingerprints that do not fit the file (wrong count or size) are not trusted', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'f.7z');
  fs.writeFileSync(file, damaged());
  for (const fp of [{ pieceSize: PS, sha256: fingerprints(ORIGINAL).slice(1) }, { pieceSize: PS, size: SIZE + 1, sha256: fingerprints(ORIGINAL) }, { pieceSize: 10, sha256: [] }]) {
    const calls = [];
    const out = await pr.repairFile({ filePath: file, size: SIZE, md5: md5(ORIGINAL), getFingerprints: async () => ({ state: 'ready', ...fp }), fetchPieces: async (o) => { calls.push(o); }, fullPieceSize: PS });
    assert.match(out.reason, /fingerprints do not fit/);
    assert.deepStrictEqual(calls.map((c) => c.full), [true]);
  }
});

test('waitForFingerprints: waits while the server computes, gives up after the limit', async () => {
  let n = 0; const slept = [];
  const r = await pr.waitForFingerprints(async () => (++n < 3 ? { state: 'computing', retryAfter: 30 } : { state: 'ready', pieceSize: PS, sha256: [] }), { sleep: async (ms) => { slept.push(ms); } });
  assert.strictEqual(r.state, 'ready');
  assert.deepStrictEqual(slept, [30000, 30000]);
  let t = 0;
  const late = await pr.waitForFingerprints(async () => ({ state: 'computing', retryAfter: 120 }), { sleep: async (ms) => { t += ms; }, now: () => t, maxWaitMs: 5 * 60 * 1000 });
  assert.strictEqual(late.state, 'unavailable');
  assert.match(late.reason, /timed out/);
});

test('wording and sizes', () => {
  assert.strictEqual(pr.repairingText(2, 128 * MiB), 'Repairing 2 damaged parts (128 MB)…');
  assert.strictEqual(pr.repairingText(1, 64 * MiB), 'Repairing 1 damaged part (64 MB)…');
  assert.strictEqual(pr.formatSize(3 * 1024 * MiB), '3.0 GB');
  assert.deepStrictEqual(pr.damagedPieces(['a', 'b', 'c'], ['a', 'x', 'c', 'd']), [1, 3]);
  assert.strictEqual(pr.bytesOf([0, 5], PS, SIZE), PS + 300 * 1024);
});

test('the automatic check runs the repair before deciding about extraction', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'completion.js'), 'utf8');
  const i = src.indexOf('runHashCheck(downloadId, { auto: true })');
  const j = src.indexOf('repairDamagedFiles(downloadId, download, r0)');
  const k = src.indexOf('download.forceDisableAutoExtract = true;', i);
  assert.ok(i > 0 && j > i && k > j);
});
