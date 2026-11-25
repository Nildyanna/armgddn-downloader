// Retry budget of the single-connection engine (resumeDownload, 2026-11-25), the same rules as the segmented engine (retryBudget.test.js):
// failures only count while no bytes arrive, a stall limit ends a download that gets nothing, refused links end it quickly,
// and a 429 waits for Retry-After without counting.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resumeDownload, retryAfterMs, MARKER_SUFFIX } = require('../resumeDownload');
const seg = require('../segmentedDownload');

const SIZE = 2 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);

// plan(n) -> { status, headers } to refuse, { drop: bytes } to send that many bytes then cut the connection, or {} to serve the rest.
function server(plan) {
  const seen = [];
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-/.exec(q.headers.range || '');
    const a = m ? +m[1] : 0;
    const p = plan(seen.length, a) || {};
    seen.push({ start: a, status: p.status || (m ? 206 : 200), at: Date.now() });
    if (p.status) { s.writeHead(p.status, p.headers || {}); return s.end(); }
    const part = DATA.subarray(a);
    const hdr = { 'Content-Length': part.length };
    if (m) hdr['Content-Range'] = `bytes ${a}-${SIZE - 1}/${SIZE}`;
    s.writeHead(m ? 206 : 200, hdr);
    if (!p.drop) return s.end(part);
    // Write the slice, then cut the socket once it has been flushed: the client gets exactly these bytes and then a dropped connection.
    s.write(part.subarray(0, p.drop), () => q.socket.destroy());
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/f` })));
}
const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rrb-')); made.push(d); return path.join(d, 'f.bin'); };

test('single engine: a link that keeps dropping but delivers bytes each time completes, far past maxAttempts', async () => {
  // 20 drops of 64 KiB each, with only 3 tries allowed: every failure follows new bytes, so none of them counts.
  const { srv, seen, base } = await server((n) => (n < 20 ? { drop: 64 * 1024 } : {}));
  const out = tmp(); const events = [];
  try {
    await resumeDownload({ url: base, outputPath: out, expectedSize: SIZE, maxAttempts: 3, retryDelayMs: 1, onEvent: (m) => events.push(m) }).promise;
  } finally { srv.close(); }
  assert.ok(DATA.equals(fs.readFileSync(out)));
  assert.equal(seen.length, 21);
  assert.ok(events.every((m) => !/retry [2-9]/.test(m)), 'every failure followed bytes, so the count never passed 1');
  assert.ok(!fs.existsSync(out + MARKER_SUFFIX));
});

test('single engine: failures with no bytes at all still use up maxAttempts', async () => {
  const { srv, seen, base } = await server(() => ({ status: 503 }));
  const out = tmp();
  try {
    await assert.rejects(resumeDownload({ url: base, outputPath: out, expectedSize: SIZE, maxAttempts: 3, retryDelayMs: 1 }).promise, /HTTP 503/);
  } finally { srv.close(); }
  assert.equal(seen.length, 3);
});

test('single engine: no bytes for the stall limit ends the run as a network failure', async () => {
  const { srv, base } = await server(() => ({ status: 503 }));
  const out = tmp();
  const t0 = Date.now();
  let err;
  try {
    await resumeDownload({ url: base, outputPath: out, expectedSize: SIZE, maxAttempts: 1e6, retryDelayMs: 5, stallLimitMs: 300 }).promise;
  } catch (e) { err = e; } finally { srv.close(); }
  assert.ok(err, 'the run failed');
  assert.equal(err.kind, 'network');
  assert.equal(err.stalled, true);
  assert.match(err.message, /no data from the server/);
  assert.ok(Date.now() - t0 >= 300);
  assert.ok(fs.existsSync(out + MARKER_SUFFIX), 'the partial file stays resumable');
});

test('single engine: 403 without a way to renew the link fails at once', async () => {
  const { srv, seen, base } = await server(() => ({ status: 403 }));
  try {
    await assert.rejects(resumeDownload({ url: base, outputPath: tmp(), expectedSize: SIZE, retryDelayMs: 1 }).promise, (e) => e.kind === 'expired' && e.status === 403);
  } finally { srv.close(); }
  assert.equal(seen.length, 1);
});

test('single engine: 403 again and again with renewals stops after maxRefusals (4), not 12', async () => {
  const { srv, seen, base } = await server(() => ({ status: 403 }));
  let fresh = 0;
  try {
    await assert.rejects(resumeDownload({ url: base, outputPath: tmp(), expectedSize: SIZE, retryDelayMs: 1, getFreshUrl: async () => { fresh++; return base; } }).promise, (e) => e.kind === 'expired');
  } finally { srv.close(); }
  assert.equal(seen.length, 4);
  assert.equal(fresh, 3);
});

test('single engine: 404 and 416 end the run at once', async () => {
  for (const status of [404, 416]) {
    const { srv, seen, base } = await server(() => ({ status }));
    try {
      await assert.rejects(resumeDownload({ url: base, outputPath: tmp(), expectedSize: SIZE, retryDelayMs: 1, getFreshUrl: async () => base }).promise, (e) => e.kind === 'fatal' && e.status === status);
    } finally { srv.close(); }
    assert.equal(seen.length, 1, `HTTP ${status} tried once`);
  }
});

test('single engine: 429 waits for Retry-After and does not count as a failure', async () => {
  // maxAttempts 1: any counted failure would end the run, so finishing proves the 429 was not counted.
  const { srv, seen, base } = await server((n) => (n === 0 ? { status: 429, headers: { 'Retry-After': '1' } } : {}));
  const out = tmp(); const events = []; let fresh = 0;
  try {
    await resumeDownload({ url: base, outputPath: out, expectedSize: SIZE, maxAttempts: 1, retryDelayMs: 1, getFreshUrl: async () => { fresh++; return base; }, onEvent: (m) => events.push(m) }).promise;
  } finally { srv.close(); }
  assert.ok(DATA.equals(fs.readFileSync(out)));
  assert.equal(seen.length, 2);
  assert.ok(seen[1].at - seen[0].at >= 950, `waited ${seen[1].at - seen[0].at} ms for Retry-After: 1`);
  assert.deepEqual(events, ['busy: HTTP 429, waiting 1s']);
  assert.equal(fresh, 0, 'a busy gateway does not need a new link');
});

test('single engine: a gateway that answers 429 forever still ends at the stall limit', async () => {
  const { srv, base } = await server(() => ({ status: 429, headers: { 'Retry-After': '1' } }));
  let err;
  try {
    await resumeDownload({ url: base, outputPath: tmp(), expectedSize: SIZE, stallLimitMs: 500 }).promise;
  } catch (e) { err = e; } finally { srv.close(); }
  assert.ok(err && err.stalled, 'ended by the stall limit');
});

test('single engine: abort ends a retry delay at once', async () => {
  const { srv, base } = await server(() => ({ status: 503 }));
  const c = resumeDownload({ url: base, outputPath: tmp(), expectedSize: SIZE, retryDelayMs: 60000 });
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  c.abort('stopped');
  await assert.rejects(c.promise, /stopped/);
  srv.close();
  assert.ok(Date.now() - t0 < 1000);
});

test('single engine: a server that keeps ending the response early with no bytes is counted, not looped on', async () => {
  // Content-Length 0 with a 206: each answer "ends normally" but delivers nothing, so it counts like any failure with no bytes.
  let n = 0;
  const srv = http.createServer((q, s) => { n++; s.writeHead(206, { 'Content-Length': 0, 'Content-Range': `bytes 0-0/${SIZE}` }); s.end(); });
  await new Promise((r) => srv.listen(0, r));
  try {
    await assert.rejects(resumeDownload({ url: `http://127.0.0.1:${srv.address().port}/f`, outputPath: tmp(), expectedSize: SIZE, maxAttempts: 3, retryDelayMs: 1 }).promise, /no data/);
  } finally { srv.close(); }
  assert.equal(n, 3);
});

test('both engines share one Retry-After rule', () => {
  assert.equal(seg.retryAfterMs, retryAfterMs);
});
