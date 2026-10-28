const { test } = require('node:test');
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
function server(plan, dropAt = 700 * 1024) {
  const seen = [];
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/dl') { s.writeHead(302, { Location: '/f' }); return s.end(); }
    const n = seen.length; const mode = plan[Math.min(n, plan.length - 1)];
    seen.push({ range: q.headers.range || null, mode });
    if (mode === '403') { s.writeHead(403); return s.end(); }
    let a = 0; const m = /bytes=(\d+)-/.exec(q.headers.range || '');
    if (m && mode !== 'norange') a = +m[1];
    const part = DATA.subarray(a);
    const hdr = { 'Content-Length': part.length };
    if (m && mode !== 'norange') hdr['Content-Range'] = `bytes ${a}-${SIZE - 1}/${SIZE}`;
    s.writeHead(m && mode !== 'norange' ? 206 : 200, hdr);
    if (mode === 'drop') { s.write(part.subarray(0, dropAt)); return setTimeout(() => q.socket.destroy(), 20); }
    s.end(part);
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), 'f.bin');

test('resumes from the last byte after a dropped connection', async () => {
  const { srv, seen, base } = await server(['drop', 'ok']);
  const out = tmp();
  const c = resumeDownload({ url: base + '/dl', outputPath: out, expectedSize: SIZE, retryDelayMs: 10 });
  await c.promise; srv.close();
  assert.ok(DATA.equals(fs.readFileSync(out)));
  assert.strictEqual(seen.length, 2);
  assert.match(seen[1].range, /^bytes=\d+-$/);
  assert.ok(+/\d+/.exec(seen[1].range)[0] >= 700 * 1024);
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
