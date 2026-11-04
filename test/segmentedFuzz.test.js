// Resume-safety stress test: connections are cut at random points and the download is stopped and restarted at random moments.
// However rough the ride, the finished file must be identical to the original.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { segmentedDownload, TEMP_SUFFIX, STATE_SUFFIX } = require('../segmentedDownload');

const SIZE = 12 * 1024 * 1024 + 777;
const CHUNK = 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Small seeded generator so a failing run can be repeated.
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

function roughServer(rand) {
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const a = +m[1]; const b = Math.min(m[2] ? +m[2] : SIZE - 1, SIZE - 1);
    const part = DATA.subarray(a, b + 1);
    s.writeHead(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${a}-${b}/${SIZE}` });
    if (rand() < 0.6) {                                   // cut the connection part-way, sometimes after zero bytes
      const cut = Math.floor(rand() * part.length);
      s.write(part.subarray(0, cut));
      setTimeout(() => q.socket.destroy(), 1 + Math.floor(rand() * 10));
    } else {
      s.end(part);
    }
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  test(`random cuts and restarts leave an identical file (seed ${seed})`, async () => {
    const rand = rng(seed * 7919);
    const { srv, base } = await roughServer(rand);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdf-')), 'f.bin');
    const opts = () => ({ url: base + '/f', outputPath: out, expectedSize: SIZE, chunkSize: CHUNK, streams: 1 + Math.floor(rand() * 6), retryDelayMs: 2, saveEveryMs: 5, maxAttempts: 200 });
    let finished = false;
    for (let round = 0; round < 40 && !finished; round++) {
      const d = segmentedDownload(opts());
      const stopAfter = 5 + Math.floor(rand() * 80);
      const t = setTimeout(() => d.abort('test stop'), stopAfter);
      try { await d.promise; finished = true; } catch (e) { /* stopped or failed: start again */ }
      clearTimeout(t);
    }
    if (!finished) { const d = segmentedDownload(opts()); await d.promise; }
    srv.close();
    assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA), 'file differs from the original');
    assert.ok(!fs.existsSync(out + TEMP_SUFFIX) && !fs.existsSync(out + STATE_SUFFIX));
  });
}
