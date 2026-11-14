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
  const kept = JSON.parse(fs.readFileSync(out + STATE_SUFFIX, 'utf8')).segs.reduce((a, g) => a + g[2], 0);
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
  assert.ok(before.segs.slice(0, -1).every((g) => g[1] - g[0] + 1 === CHUNK), 'every segment but the last is the recorded 2 MiB');
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

// ---- work stealing, resume safety, learned connection limit, reserved file ----------------------------------------------------------

// A server whose data, ETag and concurrency can be set. cfg.etag: sends ETag (and honours If-Range: a mismatch answers 200 with the whole
// body, as HTTP says). cfg.max: connections allowed at once (extra ones get 503). cfg.perChunkMs: pause between 64 KiB pieces.
function server2(cfg = {}) {
  const data = cfg.data || DATA;
  const seen = []; let open = 0; let peak = 0;
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    seen.push({ range: q.headers.range || null, ifRange: q.headers['if-range'] || null });
    if (cfg.max && open >= cfg.max) { s.writeHead(503); return s.end(); }
    open++; peak = Math.max(peak, open);
    const finish = () => { open--; };
    s.on('close', finish);
    const headers = {};
    if (cfg.etag) headers.ETag = cfg.etag;
    let a = 0; let b = data.length - 1; let code = 200;
    const ifRange = q.headers['if-range'];
    const honour = m && (!ifRange || ifRange === cfg.etag);
    if (honour) { a = +m[1]; b = Math.min(m[2] ? +m[2] : data.length - 1, data.length - 1); code = 206; headers['Content-Range'] = `bytes ${a}-${b}/${data.length}`; }
    const part = data.subarray(a, b + 1);
    headers['Content-Length'] = part.length;
    s.writeHead(code, headers);
    let at = 0;
    const pump = () => {
      if (s.destroyed) return;
      const piece = part.subarray(at, at + 64 * 1024); at += piece.length;
      s.write(piece);
      if (at >= part.length) return s.end();
      if (cfg.perChunkMs) setTimeout(pump, cfg.perChunkMs); else setImmediate(pump);
    };
    pump();
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, peak: () => peak, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('work stealing: streams that run out of work take over the far part of a slower segment', async () => {
  const { srv, seen, base: b } = await server2({ perChunkMs: 5 });
  const out = tmp();
  // one big segment (the default plan for a file this small), four streams: the idle ones must split it
  await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 4, retryDelayMs: 10, saveEveryMs: 20, stealMinBytes: 256 * 1024 }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(seen.length > 1, `${seen.length} requests: the one segment was never split`);
  const starts = seen.map((r) => +/bytes=(\d+)/.exec(r.range)[1]);
  assert.ok(new Set(starts).size === starts.length, 'no two requests began at the same byte');
});

test('work stealing never writes the same bytes twice or leaves a gap, even with slow, uneven streams', async () => {
  for (let round = 0; round < 3; round++) {
    const { srv, base: b } = await server2({ perChunkMs: 1 + round * 3 });
    const out = tmp();
    await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 6, chunkSize: 3 * 1024 * 1024, retryDelayMs: 10, saveEveryMs: 20, stealMinBytes: 128 * 1024 }).promise;
    srv.close();
    assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA), `round ${round}`);
  }
});

test('a resume that finds a different file on the server (new ETag) starts over instead of mixing versions', async () => {
  const out = tmp();
  const v1 = await server2({ etag: '"v1"', perChunkMs: 15 });
  const c1 = segmentedDownload({ url: v1.base + '/f', outputPath: out, expectedSize: SIZE, streams: 2, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20 });
  await new Promise((r) => setTimeout(r, 250));
  c1.abort('paused');
  await assert.rejects(c1.promise, (e) => e.kind === 'aborted');
  v1.srv.close();
  const rec = JSON.parse(fs.readFileSync(out + STATE_SUFFIX, 'utf8'));
  assert.strictEqual(rec.validator && rec.validator.etag, '"v1"', 'the record keeps the server ETag');
  assert.ok(rec.segs.some((g) => g[2] > 0), 'some of version 1 is on disk');

  const DATA2 = crypto.randomBytes(SIZE);                  // same size, different content: the dangerous case
  const v2 = await server2({ etag: '"v2"', data: DATA2 });
  await segmentedDownload({ url: v2.base + '/f', outputPath: out, expectedSize: SIZE, streams: 2, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20 }).promise;
  v2.srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA2), 'the file is version 2 from start to end');
  assert.ok(v2.seen.some((r) => r.ifRange === '"v1"'), 'the resume asked with If-Range');
});

test('a server that sends a different ETag on every request does not restart the download in a loop', async () => {
  let n = 0;
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const a = +m[1]; const b = Math.min(m[2] ? +m[2] : SIZE - 1, SIZE - 1);
    const part = DATA.subarray(a, b + 1);
    s.writeHead(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${a}-${b}/${SIZE}`, ETag: `"e${n++}"` });   // new every time, ignores If-Range
    s.end(part);
  });
  await new Promise((r) => srv.listen(0, r));
  const out = tmp();
  await segmentedDownload({ url: `http://127.0.0.1:${srv.address().port}/f`, outputPath: out, expectedSize: SIZE, streams: 3, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20 }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
});

test('a server that allows only 2 connections: the stream count drops to 2, the file is intact, and the limit is reported', async () => {
  const { srv, peak, base: b } = await server2({ max: 2, perChunkMs: 3 });
  const out = tmp();
  const learned = [];
  await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 6, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20, onHostLimit: (n) => learned.push(n) }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(learned.length >= 1 && learned.every((n) => n >= 1 && n <= 2), `reported ${JSON.stringify(learned)}`);
  assert.ok(peak() <= 2, `peak ${peak()} connections`);
});

test('a remembered host limit is used from the start', async () => {
  const { srv, peak, base: b } = await server2({ perChunkMs: 3 });
  const out = tmp();
  await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 8, hostLimit: 2, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20, stealMinBytes: 128 * 1024 }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(peak() <= 2, `peak ${peak()} connections with a limit of 2`);
});

test('the temp file is reserved at the full size right away', async () => {
  const { srv, base: b } = await server2({ perChunkMs: 20 });
  const out = tmp();
  const c = segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 1, chunkSize: CHUNK, retryDelayMs: 10, saveEveryMs: 20 });
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(fs.statSync(out + TEMP_SUFFIX).size, SIZE);
  c.abort('stop');
  await assert.rejects(c.promise);
  srv.close();
});

test('progress saved by the earlier version (equal chunks, state v1) still resumes', async () => {
  const out = tmp();
  const partial = Buffer.alloc(SIZE);
  DATA.copy(partial, 0, 0, CHUNK);                           // chunk 0 complete
  DATA.copy(partial, CHUNK, CHUNK, CHUNK + 500 * 1024);      // chunk 1 half done
  fs.writeFileSync(out + TEMP_SUFFIX, partial);
  const done = new Array(Math.ceil(SIZE / CHUNK)).fill(0); done[0] = CHUNK; done[1] = 500 * 1024;
  fs.writeFileSync(out + STATE_SUFFIX, JSON.stringify({ v: 1, total: SIZE, chunk: CHUNK, done }));
  const { srv, seen, base: b } = await server2();
  await segmentedDownload({ url: b + '/f', outputPath: out, expectedSize: SIZE, streams: 2, retryDelayMs: 10, saveEveryMs: 20 }).promise;
  srv.close();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(!seen.some((r) => +/bytes=(\d+)/.exec(r.range)[1] < CHUNK), 'nothing of chunk 0 was fetched again');
});
