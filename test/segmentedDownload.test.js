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
    seen.push({ range: q.headers.range || null, mode });
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
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')), 'f.bin');
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
