const { test, after } = require('node:test');
const assert = require('node:assert');
const http2 = require('http2');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { segmentedDownload, probeRanges, TEMP_SUFFIX } = require('../segmentedDownload');
const { closeAllSessions } = require('../httpOpen');

const SIZE = 12 * 1024 * 1024 + 777;
const CHUNK = 2 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tls = { rejectUnauthorized: false };

// A throw-away self-signed certificate; the tests skip themselves when openssl is not installed.
let cert = null;
try {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'h2cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(d, 'k.pem'), '-out', path.join(d, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  cert = { key: fs.readFileSync(path.join(d, 'k.pem')), cert: fs.readFileSync(path.join(d, 'c.pem')) };
} catch (e) { cert = null; }
const skip = cert ? false : 'openssl not available';
after(() => closeAllSessions());

function range(h) { const m = /bytes=(\d+)-(\d+)?/.exec(h || ''); return m ? [+m[1], m[2] ? Math.min(+m[2], SIZE - 1) : SIZE - 1] : null; }

// h2 server: counts TCP connections and requests; opts.delayMs delays every response header.
function h2server(opts = {}) {
  const st = { connections: 0, requests: 0, bytes: 0 };
  const srv = http2.createSecureServer({ ...cert, allowHTTP1: true });
  srv.on('secureConnection', () => { st.connections++; });
  srv.on('request', (q, s) => {
    st.requests++;
    const r = range(q.headers.range);
    if (!r) { s.writeHead(200, { 'content-length': SIZE }); return s.end(); }
    const part = DATA.subarray(r[0], r[1] + 1);
    const send = () => { st.bytes += part.length; s.writeHead(206, { 'content-length': part.length, 'content-range': `bytes ${r[0]}-${r[1]}/${SIZE}` }); s.end(part); };
    if (opts.delayMs) setTimeout(send, opts.delayMs); else send();
  });
  return new Promise((res) => srv.listen(0, () => res({ srv, st, base: `https://localhost:${srv.address().port}` })));
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h2-')), 'f.bin');
const opts = (o) => ({ expectedSize: SIZE, chunkSize: CHUNK, streams: 6, retryDelayMs: 10, saveEveryMs: 20, tlsOptions: tls, ...o });

test('over HTTP/2 every stream shares one connection and the file is intact', { skip }, async () => {
  const { srv, st, base } = await h2server();
  const out = tmp();
  await segmentedDownload(opts({ url: base + '/f', outputPath: out })).promise;
  srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.strictEqual(st.connections, 1, `${st.connections} connections for ${st.requests} requests`);
  assert.ok(st.requests >= 6);
});

test('probeRanges works over HTTP/2', { skip }, async () => {
  const { srv, base } = await h2server();
  const p = await probeRanges(base + '/f', {}, 5000, tls);
  srv.close(); closeAllSessions();
  assert.deepStrictEqual(p, { ok: true, total: SIZE });
});

test('a host that only speaks HTTP/1.1 still works (fallback)', { skip }, async () => {
  const seen = [];
  const srv = https.createServer(cert, (q, s) => {
    const r = range(q.headers.range); seen.push(r);
    const part = DATA.subarray(r[0], r[1] + 1);
    s.writeHead(206, { 'content-length': part.length, 'content-range': `bytes ${r[0]}-${r[1]}/${SIZE}` }); s.end(part);
  });
  await new Promise((res) => srv.listen(0, res));
  const out = tmp();
  await segmentedDownload(opts({ url: `https://localhost:${srv.address().port}/f`, outputPath: out })).promise;
  srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(seen.length >= 6);
});

test('Pause cancels connections that are still waiting for the server, and stops at once', { skip }, async () => {
  const { srv, st, base } = await h2server({ delayMs: 1500 });
  const out = tmp();
  const c = segmentedDownload(opts({ url: base + '/f', outputPath: out }));
  await new Promise((r) => setTimeout(r, 300));          // every request is now waiting for its first response
  const t0 = Date.now();
  c.abort('paused');
  await assert.rejects(c.promise, (e) => e.kind === 'aborted');
  assert.ok(Date.now() - t0 < 700, `stopped after ${Date.now() - t0} ms`);
  await new Promise((r) => setTimeout(r, 1800));         // the delayed answers arrive; nothing may be written any more
  srv.close(); closeAllSessions();
  const size = fs.existsSync(out + TEMP_SUFFIX) ? fs.statSync(out + TEMP_SUFFIX).size : 0;
  assert.strictEqual(size, 0, `${size} bytes written after Pause`);
  assert.strictEqual(fs.existsSync(out), false);
  assert.ok(st.requests >= 1);
});

test('a Resume waits for the run it replaces: one writer, correct file', { skip }, async () => {
  const slow = await h2server({ delayMs: 400 });
  const out = tmp();
  const first = segmentedDownload(opts({ url: slow.base + '/f', outputPath: out }));
  await new Promise((r) => setTimeout(r, 700));
  // Resume without waiting for the first run to finish stopping
  const fast = await h2server();
  const second = segmentedDownload(opts({ url: fast.base + '/f', outputPath: out }));
  first.abort('paused');
  await assert.rejects(first.promise, (e) => e.kind === 'aborted');
  await second.promise;
  slow.srv.close(); fast.srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(!fs.existsSync(out + TEMP_SUFFIX));
});

// ---- through an HTTP proxy (CONNECT) ----
const httpMod = require('http');
const net = require('net');
const { proxyFor } = require('../proxy');

function connectProxy(opts = {}) {
  const st = { connects: [], auth: [] };
  const srv = httpMod.createServer((q, s) => { s.writeHead(405); s.end(); });
  srv.on('connect', (q, sock, head) => {
    st.connects.push(q.url); st.auth.push(q.headers['proxy-authorization'] || '');
    if (opts.password && q.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('user:' + opts.password).toString('base64')) { sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n'); return; }
    const [h, p] = q.url.split(':');
    const up = net.connect(+p, h, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  return new Promise((res) => srv.listen(0, () => res({ srv, st, port: srv.address().port })));
}
function withEnv(vars, fn) {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(keep)) { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; } });
}

test('proxyFor reads the proxy variables and NO_PROXY', () => {
  const env = { HTTPS_PROXY: 'user:p%40ss@proxy.lan:8080', NO_PROXY: 'internal.example, .corp.test:443' };
  const p = proxyFor('https://dl.example.com/f', env);
  assert.strictEqual(p.hostname, 'proxy.lan'); assert.strictEqual(p.port, '8080');
  assert.strictEqual(proxyFor('https://internal.example/f', env), null);
  assert.strictEqual(proxyFor('https://a.corp.test/f', env), null);
  assert.strictEqual(proxyFor('https://a.corp.test:8443/f', env).hostname, 'proxy.lan');
  assert.strictEqual(proxyFor('https://x.test/f', { https_proxy: 'socks5://p:1080' }), null);
  assert.strictEqual(proxyFor('https://x.test/f', {}), null);
  assert.strictEqual(proxyFor('https://x.test/f', { NO_PROXY: '*', HTTPS_PROXY: 'p:1' }), null);
});

test('through an HTTP proxy the file is intact and still shares one HTTP/2 connection', { skip }, async () => {
  const { srv, st, base } = await h2server();
  const px = await connectProxy();
  const out = tmp();
  await withEnv({ HTTPS_PROXY: `http://127.0.0.1:${px.port}`, NO_PROXY: null }, () => segmentedDownload(opts({ url: base + '/f', outputPath: out })).promise);
  srv.close(); px.srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.strictEqual(px.st.connects.length, 1, `${px.st.connects.length} tunnels`);
  assert.strictEqual(st.connections, 1);
});

test('through a proxy that needs a login: credentials in the proxy URL are sent', { skip }, async () => {
  const { srv, base } = await h2server();
  const px = await connectProxy({ password: 'secret' });
  const out = tmp();
  await withEnv({ HTTPS_PROXY: `http://user:secret@127.0.0.1:${px.port}`, NO_PROXY: null }, () => segmentedDownload(opts({ url: base + '/f', outputPath: out })).promise);
  srv.close(); px.srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(px.st.auth[0].startsWith('Basic '));
});

test('NO_PROXY keeps a host off the proxy', { skip }, async () => {
  const { srv, base } = await h2server();
  const px = await connectProxy();
  const out = tmp();
  await withEnv({ HTTPS_PROXY: `http://127.0.0.1:${px.port}`, NO_PROXY: 'localhost' }, () => segmentedDownload(opts({ url: base + '/f', outputPath: out })).promise);
  srv.close(); px.srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.strictEqual(px.st.connects.length, 0);
});

test('a host that only speaks HTTP/1.1 works through the proxy too', { skip }, async () => {
  const srv = https.createServer(cert, (q, s) => {
    const r = range(q.headers.range); const part = DATA.subarray(r[0], r[1] + 1);
    s.writeHead(206, { 'content-length': part.length, 'content-range': `bytes ${r[0]}-${r[1]}/${SIZE}` }); s.end(part);
  });
  await new Promise((res) => srv.listen(0, res));
  const px = await connectProxy();
  const out = tmp();
  await withEnv({ HTTPS_PROXY: `http://127.0.0.1:${px.port}`, NO_PROXY: null }, () => segmentedDownload(opts({ url: `https://localhost:${srv.address().port}/f`, outputPath: out })).promise);
  srv.close(); px.srv.close(); closeAllSessions();
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(px.st.connects.length >= 1);
});
