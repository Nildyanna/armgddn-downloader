const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { segmentedDownload, probeRanges, TEMP_SUFFIX, STATE_SUFFIX } = require('../segmentedDownload');

const SIZE = 9 * 1024 * 1024 + 4321;      // 5 chunks of 2 MiB (last one short)
const CHUNK = 2 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// /f serves DATA with Range. opts.mode(n, range) -> 'ok' | 'drop' | '403' | '500' | 'norange'; opts.delayMs slows every response.
function server(opts = {}) {
  const seen = [];
  let served = 0;
  const srv = http.createServer((q, s) => {
    const n = seen.length;
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const mode = opts.mode ? opts.mode(n, m && [+m[1], m[2] ? +m[2] : SIZE - 1]) : 'ok';
    seen.push({ range: q.headers.range || null, mode, auth: q.headers.authorization || null });
    if (mode === '403') { s.writeHead(403); return s.end(); }
    if (mode === '500') { s.writeHead(500); return s.end(); }
    if (!m || mode === 'norange') { s.writeHead(200, { 'Content-Length': SIZE }); return s.end(DATA); }
    const a = +m[1]; const b = Math.min(m[2] ? +m[2] : SIZE - 1, SIZE - 1);
    const part = DATA.subarray(a, b + 1);
    s.writeHead(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${a}-${b}/${SIZE}` });
    const send = () => {
      if (mode === 'drop') { s.write(part.subarray(0, Math.min(part.length, 300 * 1024))); served += Math.min(part.length, 300 * 1024); return setTimeout(() => q.socket.destroy(), 20); }
      served += part.length;
      s.end(part);
    };
    if (opts.delayMs) setTimeout(send, opts.delayMs); else send();
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, served: () => served, base: `http://127.0.0.1:${srv.address().port}` })));
}
const { after: _after } = require('node:test');
const _made = [];
_after(() => { for (const d of _made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });   // the 13 MB files these tests write were never removed: 70 GB of /tmp in two weeks
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')); _made.push(d); return path.join(d, 'f.bin'); };
const base = (extra) => ({ expectedSize: SIZE, chunkSize: CHUNK, streams: 4, retryDelayMs: 10, saveEveryMs: 20, ...extra });

test('downloads a file in parallel chunks, byte for byte, and leaves no temp files', async () => {
  const { srv, seen, base: b } = await server();
  const out = tmp();
  await segmentedDownload(base({ url: b + '/f', outputPath: out })).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(!fs.existsSync(out + TEMP_SUFFIX) && !fs.existsSync(out + STATE_SUFFIX));
  assert.strictEqual(seen.length, 5);   // one request per chunk
});

test('a dropped connection resumes that chunk from where it stopped', async () => {
  const { srv, seen, base: b } = await server({ mode: (n) => (n === 1 ? 'drop' : 'ok') });
  const out = tmp();
  await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1 })).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  const retried = seen.find((r, i) => i > 1 && /bytes=\d+-/.test(r.range) && +/bytes=(\d+)/.exec(r.range)[1] % CHUNK !== 0);
  assert.ok(retried, 'the retry asked for the middle of a chunk, not its start');
});

test('stopping and starting again fetches only what is missing', async () => {
  const slow = await server({ delayMs: 300 });
  const out = tmp();
  const c1 = segmentedDownload(base({ url: slow.base + '/f', outputPath: out, streams: 2 }));
  await new Promise((r) => setTimeout(r, 450));          // let the first chunks land, not all of them
  c1.abort('paused');
  await assert.rejects(c1.promise, (e) => e.kind === 'aborted');
  slow.srv.close();
  assert.ok(fs.existsSync(out + TEMP_SUFFIX) && fs.existsSync(out + STATE_SUFFIX), 'progress is kept');
  assert.ok(!fs.existsSync(out), 'a half-done file never carries the final name');
  const kept = JSON.parse(fs.readFileSync(out + STATE_SUFFIX, 'utf8')).done.reduce((a, b) => a + b, 0);
  assert.ok(kept > 0 && kept < SIZE, `kept ${kept} bytes`);

  const again = await server();
  await segmentedDownload(base({ url: again.base + '/f', outputPath: out, streams: 2 })).promise;
  again.srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(again.served() <= SIZE - kept + 1024, `second run fetched ${again.served()} of ${SIZE}, kept ${kept}`);
});

test('an expired link asks for a fresh one and carries on', async () => {
  const { srv, seen, base: b } = await server({ mode: (n) => (n === 0 ? '403' : 'ok') });
  const out = tmp();
  let fresh = 0;
  await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1, getFreshUrl: async () => { fresh++; return b + '/f'; } })).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.strictEqual(fresh, 1);
  assert.ok(seen.length > 5);
});

test('server errors are retried', async () => {
  const { srv, base: b } = await server({ mode: (n) => (n < 2 ? '500' : 'ok') });
  const out = tmp();
  await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1 })).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
});

test('probeRanges tells a Range-capable server from one that ignores Range', async () => {
  const good = await server(); const bad = await server({ mode: () => 'norange' });
  assert.deepStrictEqual(await probeRanges(good.base + '/f', {}), { ok: true, total: SIZE });
  assert.strictEqual((await probeRanges(bad.base + '/f', {})).ok, false);
  good.srv.close(); bad.srv.close();
});

test('a stale progress record for a different file size is ignored', async () => {
  const out = tmp();
  fs.writeFileSync(out + TEMP_SUFFIX, Buffer.alloc(1000, 1));
  fs.writeFileSync(out + STATE_SUFFIX, JSON.stringify({ v: 1, total: SIZE + 1, chunk: CHUNK, done: [CHUNK, CHUNK, CHUNK, CHUNK, CHUNK] }));
  const { srv, base: b } = await server();
  await segmentedDownload(base({ url: b + '/f', outputPath: out })).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
});

test('the speed limit is honoured', async () => {
  const { srv, base: b } = await server();
  const out = tmp();
  const t0 = Date.now();
  await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 4, maxBytesPerSec: 4 * 1024 * 1024 })).promise;
  const secs = (Date.now() - t0) / 1000;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(secs >= 1.4, `9.4 MB at 4 MB/s took ${secs}s`);
});

test('a resume keeps the chunk plan of the earlier run even when the stream count changes', async () => {
  const slow = await server({ delayMs: 300 });
  const out = tmp();
  const c1 = segmentedDownload(base({ url: slow.base + '/f', outputPath: out, streams: 2 }));
  await new Promise((r) => setTimeout(r, 450));
  c1.abort('paused');
  await assert.rejects(c1.promise, (e) => e.kind === 'aborted');
  slow.srv.close();
  const before = JSON.parse(fs.readFileSync(out + STATE_SUFFIX, 'utf8'));
  const again = await server();
  // no chunkSize this time and a different stream count: the recorded 2 MiB plan must still be used
  await segmentedDownload({ url: again.base + '/f', outputPath: out, expectedSize: SIZE, streams: 3, retryDelayMs: 10 }).promise;
  again.srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.strictEqual(before.chunk, CHUNK);
  assert.ok(again.served() < SIZE, 'only the missing part was fetched');
});

test('by default each stream gets one long request instead of many short ones', async () => {
  const { srv, seen, base: b } = await server();
  const out = tmp();
  await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 4, retryDelayMs: 10 }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(seen.length <= 4, `${seen.length} requests`);
});

test('a link close to its expiry is renewed before any request is refused', async () => {
  const { linkSecondsLeft } = require('../segmentedDownload');
  const now = Math.floor(Date.now() / 1000);
  assert.equal(linkSecondsLeft('https://x/f?remote=a&exp=' + (now + 600) + '&sig=z') > 500, true);
  assert.equal(linkSecondsLeft('https://x/f?file=a'), null);
  assert.equal(linkSecondsLeft('not a url'), null);
  const s = await server();
  const out = tmp(); let fresh = 0; const events = [];
  const soon = `${s.base}/f?exp=${now + 20}&sig=a`;
  await segmentedDownload(base({ url: soon, outputPath: out, onEvent: (m) => events.push(m), getFreshUrl: async () => { fresh++; return `${s.base}/f?exp=${now + 600}&sig=b`; } })).promise;
  s.srv.close();
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.equal(fresh, 1, 'renewed once, up front');
  assert.equal(s.seen.filter((r) => r.mode === '403').length, 0);
  assert.ok(events.some((m) => /link renewed/.test(m)));
});

test('a source can carry its own headers and its own expiry time', async () => {
  const s = await server();
  const out = tmp(); let fresh = 0; const events = [];
  const soon = Date.now() + 20000;      // stated expiry in the manifest, not in the link
  await segmentedDownload(base({ outputPath: out, onEvent: (m) => events.push(m),
    source: { url: `${s.base}/f`, headers: { Authorization: 'Bearer one' }, expiresAt: soon },
    getFreshUrl: async () => { fresh++; return { url: `${s.base}/f`, headers: { Authorization: 'Bearer two' }, expiresAt: Date.now() + 600000 }; } })).promise;
  s.srv.close();
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.equal(fresh, 1);
  assert.ok(s.seen.every((r) => r.auth === 'Bearer two'), 'renewed before the first request, so every request used the new token: ' + JSON.stringify(s.seen.map((r) => r.auth)));
  assert.ok(events.some((m) => /link renewed/.test(m)));
});

test('when two renewals in a row are refused the download moves to its fallback source', async () => {
  const primary = await server({ mode: () => '403' });
  const backup = await server();
  const out = tmp(); const events = [];
  await segmentedDownload(base({ outputPath: out, onEvent: (m) => events.push(m), maxAttempts: 8,
    source: { url: `${primary.base}/f`, fallback: { url: `${backup.base}/f`, headers: { 'X-Source': 'backup' } } },
    getFreshUrl: async () => ({ url: `${primary.base}/f` }) })).promise;
  primary.srv.close(); backup.srv.close();
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(events.some((m) => /fallback source/.test(m)));
  assert.ok(backup.seen.length > 0);
});

test('a plain link string still works as before', async () => {
  const { asSource, expiryMs } = require('../segmentedDownload');
  assert.deepEqual(asSource('https://x/f'), { url: 'https://x/f', headers: {}, expiresAtMs: null, fallback: null });
  assert.equal(asSource(null), null);
  assert.equal(expiryMs(1800000000), 1800000000000);
  assert.equal(expiryMs('2027-01-01T00:00:00Z'), 1798761600000);
  assert.equal(expiryMs('nonsense'), null);
});
