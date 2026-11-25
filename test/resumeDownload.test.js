const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resumeDownload, MARKER_SUFFIX } = require('../resumeDownload');

const SIZE = 3 * 1024 * 1024 + 123;
const DATA = crypto.randomBytes(SIZE);

// /dl -> 302 /f?v=<n>. /f serves DATA with Range. `plan` decides per /f request:
// 'ok', 'drop' (cut after dropAt bytes), '403', or 'norange' (ignores Range).
function server(plan, dropAt = 700 * 1024, onRequest) {
  const seen = [];
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/dl') { s.writeHead(302, { Location: '/f' }); return s.end(); }
    const n = seen.length; const mode = plan[Math.min(n, plan.length - 1)];
    seen.push({ range: q.headers.range || null, mode, ...(onRequest ? onRequest() : {}) });
    if (mode === '403') { s.writeHead(403); return s.end(); }
    let a = 0; const m = /bytes=(\d+)-/.exec(q.headers.range || '');
    if (m && mode !== 'norange') a = +m[1];
    const part = DATA.subarray(a);
    const hdr = { 'Content-Length': part.length };
    if (m && mode !== 'norange') hdr['Content-Range'] = `bytes ${a}-${SIZE - 1}/${SIZE}`;
    s.writeHead(m && mode !== 'norange' ? 206 : 200, hdr);
    // Cut the connection once the slice has been handed to the OS (it used to be a 20 ms timer, which under load cut it earlier).
    if (mode === 'drop') { return s.write(part.subarray(0, dropAt), () => q.socket.destroy()); }
    s.end(part);
  });
  // Every server is closed at the end even if a test fails before its own srv.close(): a server left listening kept this file
  // running until the test runner gave up (seen 2026-11-25 when the dropped-connection test failed under load).
  servers.push(srv);
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
const servers = [];
after(() => { for (const s of servers) { try { s.closeAllConnections(); s.close(); } catch (e) { } } });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), 'f.bin');

test('resumes from the last byte after a dropped connection', async () => {
  // The resume must start exactly at the bytes on disk (no gap, no overlap: the content check below proves both). How many of the
  // 700 KiB arrive before the cut is up to the OS and Node: this test used to require at least 700 KiB, which failed under CPU load
  // (a full parallel test run, about 1 run in 4 on 2026-11-25) because Node drops what is still buffered when a connection resets.
  const out = tmp();
  const { srv, seen, base } = await server(['drop', 'ok'], 700 * 1024, () => ({ onDisk: fs.existsSync(out) ? fs.statSync(out).size : -1 }));
  const c = resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, retryDelayMs: 10 });
  await c.promise; srv.close();
  assert.ok(DATA.equals(fs.readFileSync(out)));
  assert.strictEqual(seen.length, 2);
  assert.match(seen[1].range, /^bytes=\d+-$/);
  assert.ok(seen[1].onDisk > 0, 'some bytes were kept from the dropped connection');
  assert.strictEqual(seen[1].range, `bytes=${seen[1].onDisk}-`, 'resumed exactly from the bytes on disk');
  assert.ok(!fs.existsSync(out + MARKER_SUFFIX));
});

test('an expired link (403) asks for a fresh link and continues', async () => {
  const { srv, seen, base } = await server(['drop', '403', 'ok']);
  let fresh = 0;
  const out = tmp();
  const c = resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, retryDelayMs: 10, getFreshUrl: async () => { fresh++; return base + '/dl'; } });
  await c.promise; srv.close();
  assert.ok(DATA.equals(fs.readFileSync(out)));
  assert.strictEqual(fresh, 2);
});

test('a server that ignores Range restarts cleanly instead of corrupting', async () => {
  const { srv, base } = await server(['drop', 'norange']);
  const out = tmp();
  await resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, retryDelayMs: 10 }).promise;
  srv.close();
  assert.ok(DATA.equals(fs.readFileSync(out)));
});

test('a partial file without our marker is not trusted', async () => {
  const { srv, seen, base } = await server(['ok']);
  const out = tmp();
  fs.writeFileSync(out, Buffer.alloc(SIZE, 7)); // rclone-style sparse/pre-sized file
  await resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE }).promise;
  srv.close();
  assert.strictEqual(seen[0].range, null);
  assert.ok(DATA.equals(fs.readFileSync(out)));
});

test('gives up after maxAttempts and keeps the bytes for a later resume', async () => {
  const { srv, base } = await server(['403']);
  const out = tmp();
  await assert.rejects(resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, maxAttempts: 3, retryDelayMs: 5, getFreshUrl: async () => base + '/dl' }).promise);
  srv.close();
  assert.ok(fs.existsSync(out + MARKER_SUFFIX));
});

test('abort stops a transfer', async () => {
  const { srv, base } = await server(['drop'], 1024);
  const out = tmp();
  const c = resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, retryDelayMs: 500 });
  setTimeout(() => c.abort('stopped'), 100);
  await assert.rejects(c.promise);
  srv.close();
});
