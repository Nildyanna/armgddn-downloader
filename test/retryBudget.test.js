// Retry budget of the segmented engine (2026-11-25): a chunk's failures only count while the whole download makes no progress,
// an overall stall limit ends a download that gets no bytes at all, refused links and other 4xx still end the run quickly,
// and a 429 from the gateway waits for Retry-After without counting.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { segmentedDownload, retryAfterMs } = require('../segmentedDownload');

const CHUNK = 2 * 1024 * 1024;
const SIZE = 4 * CHUNK;                    // 4 chunks, one per stream
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// plan(n, start, chunkSeen) -> { status, headers, delayMs } to refuse, or { drip: [bytes, everyMs] } / {} to serve the range.
function server(plan) {
  const seen = [];
  const perChunk = new Map();
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const a = m ? +m[1] : 0; const b = Math.min(m && m[2] ? +m[2] : SIZE - 1, SIZE - 1);
    const c = Math.floor(a / CHUNK);
    const k = perChunk.get(c) || 0; perChunk.set(c, k + 1);
    const p = plan(seen.length, a, c, k) || {};
    seen.push({ chunk: c, status: p.status || 206, at: Date.now() });
    if (p.status) {
      return setTimeout(() => { s.writeHead(p.status, p.headers || {}); s.end(); }, p.delayMs || 0);
    }
    const part = DATA.subarray(a, b + 1);
    s.writeHead(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${a}-${b}/${SIZE}` });
    if (!p.drip) return s.end(part);
    const [size, every] = p.drip; let off = 0;
    const t = setInterval(() => {
      if (s.destroyed) return clearInterval(t);
      s.write(part.subarray(off, off + size)); off += size;
      if (off >= part.length) { clearInterval(t); s.end(); }
    }, every);
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/f` })));
}
const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-')); made.push(d); return path.join(d, 'f.bin'); };
const opts = (extra) => ({ expectedSize: SIZE, chunkSize: CHUNK, streams: 4, retryDelayMs: 2, saveEveryMs: 20, ...extra });

test('one chunk failing again and again while the other connections download: the download completes', async () => {
  // chunk 0 answers 500 ten times (old budget at maxAttempts 4 would end the run); the other three drip their bytes for ~1.3 s
  const s = await server((n, a, c, k) => (c === 0 && k < 10 ? { status: 500, delayMs: 30 } : c === 0 ? {} : { drip: [32 * 1024, 20] }));
  const out = tmp(); const events = [];
  try {
    await segmentedDownload(opts({ url: s.base, outputPath: out, maxAttempts: 4, onEvent: (m) => events.push(m) })).promise;
  } finally { s.srv.close(); }
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.equal(s.seen.filter((r) => r.chunk === 0 && r.status === 500).length, 10);
  const counted = events.map((m) => /chunk 0 retry (\d+)/.exec(m)).filter(Boolean).map((x) => +x[1]);
  assert.ok(Math.max(...counted) < 4, 'never reached the budget while bytes flowed: ' + counted.join(','));
});

test('when the other chunks are done, a chunk that still gets nothing uses up its budget as before', async () => {
  const s = await server((n, a, c) => (c === 0 ? { status: 500 } : {}));
  const out = tmp(); let err;
  try { await segmentedDownload(opts({ url: s.base, outputPath: out, maxAttempts: 4 })).promise; } catch (e) { err = e; } finally { s.srv.close(); }
  assert.equal(err && err.kind, 'network');
  assert.ok(s.seen.filter((r) => r.chunk === 0).length <= 5, `chunk 0 tried ${s.seen.filter((r) => r.chunk === 0).length} times`);
  assert.ok(fs.statSync(out + '.armseg').size > 0, 'the other chunks are kept for a later Retry');
});

test('everything failing with no bytes at all ends after the stall limit as a network failure', async () => {
  const s = await server(() => ({ status: 500, delayMs: 20 }));
  const out = tmp(); let err; const t0 = Date.now();
  try { await segmentedDownload(opts({ url: s.base, outputPath: out, maxAttempts: 100000, stallLimitMs: 400 })).promise; } catch (e) { err = e; } finally { s.srv.close(); }
  const took = Date.now() - t0;
  assert.equal(err && err.kind, 'network');
  assert.match(err.message, /no data from the server/);
  assert.ok(err.stalled);
  assert.ok(took >= 400 && took < 5000, `took ${took} ms`);
});

test('403 ends the run quickly even while other chunks are downloading, and is not retried forever', async () => {
  const s = await server((n, a, c) => (c === 0 ? { status: 403 } : { drip: [32 * 1024, 20] }));
  const out = tmp(); let err; let fresh = 0; const t0 = Date.now();
  try {
    await segmentedDownload(opts({ url: s.base, outputPath: out, retryDelayMs: 10, getFreshUrl: async () => { fresh++; return s.base; } })).promise;
  } catch (e) { err = e; } finally { s.srv.close(); }
  assert.equal(err && err.kind, 'expired');
  assert.ok(s.seen.filter((r) => r.chunk === 0).length <= 4, `chunk 0 asked ${s.seen.filter((r) => r.chunk === 0).length} times`);
  assert.ok(fresh >= 1, 'a fresh link was tried first');
  assert.ok(Date.now() - t0 < 3000);
});

test('403 with no way to renew the link ends at once; 404 and 416 end at once too', async () => {
  for (const status of [403, 404, 416]) {
    const s = await server(() => ({ status }));
    const out = tmp(); let err;
    try { await segmentedDownload(opts({ url: s.base, outputPath: out, streams: 1 })).promise; } catch (e) { err = e; } finally { s.srv.close(); }
    assert.ok(err, `HTTP ${status} failed`);
    assert.equal(err.kind, status === 403 ? 'expired' : 'fatal');
    assert.equal(s.seen.length, 1, `HTTP ${status}: one request, no retries`);
  }
});

test('429 with Retry-After waits as asked and does not count as a failure', async () => {
  // two 429s with maxAttempts 2: if they counted, the second would end the run
  const s = await server((n) => (n < 2 ? { status: 429, headers: { 'Retry-After': '1' } } : {}));
  const out = tmp(); const events = []; const t0 = Date.now();
  try {
    await segmentedDownload(opts({ url: s.base, outputPath: out, streams: 1, maxAttempts: 2, onEvent: (m) => events.push(m) })).promise;
  } finally { s.srv.close(); }
  const took = Date.now() - t0;
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(took >= 1900, `waited ${took} ms for two Retry-After: 1`);
  assert.equal(events.filter((m) => /busy: HTTP 429, waiting 1s/.test(m)).length, 2);
  assert.ok(!events.some((m) => /retry \d+:/.test(m)), 'no counted retries');
  assert.ok(s.seen[1].at - s.seen[0].at >= 950, 'the second request came after the wait');
});

test('a gateway that answers 429 forever still ends at the stall limit', async () => {
  const s = await server(() => ({ status: 429, headers: { 'Retry-After': '1' } }));
  const out = tmp(); let err;
  try { await segmentedDownload(opts({ url: s.base, outputPath: out, streams: 1, stallLimitMs: 1500 })).promise; } catch (e) { err = e; } finally { s.srv.close(); }
  assert.equal(err && err.kind, 'network');
  assert.equal(err.status, 429);
  assert.ok(s.seen.length >= 2 && s.seen.length <= 3, `${s.seen.length} requests`);
});

test('retryAfterMs reads seconds or an HTTP date and keeps the wait between 1 s and 60 s', () => {
  assert.equal(retryAfterMs('5'), 5000);
  assert.equal(retryAfterMs(undefined), 5000);
  assert.equal(retryAfterMs('0'), 1000);
  assert.equal(retryAfterMs('3600'), 60000);
  assert.equal(retryAfterMs('nonsense'), 5000);
  const now = Date.parse('2026-11-25T12:00:00Z');
  assert.equal(retryAfterMs('Wed, 25 Nov 2026 12:00:10 GMT', now), 10000);
});

test('abort wakes every stream that is waiting out a delay, not only the last one', async () => {
  const s = await server(() => ({ status: 429, headers: { 'Retry-After': '30' } }));
  const out = tmp();
  const c = segmentedDownload(opts({ url: s.base, outputPath: out }));
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  c.abort('paused');
  await assert.rejects(c.promise, (e) => e.kind === 'aborted');
  s.srv.close();
  assert.ok(Date.now() - t0 < 1000, `stopped in ${Date.now() - t0} ms`);
});
