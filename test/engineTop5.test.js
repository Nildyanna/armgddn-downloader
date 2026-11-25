// Download engine review 2026-11-25: the failures members hit most in the week's engine reports (site data/engine-reports.jsonl).
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { segmentedDownload, renameWithRetry, TEMP_SUFFIX, STATE_SUFFIX } = require('../segmentedDownload');
const { engineFailureText } = require('../downloadErrors');

const SIZE = 9 * 1024 * 1024 + 4321;
const CHUNK = 2 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function server(opts = {}) {
  const seen = [];
  const srv = http.createServer((q, s) => {
    const n = seen.length;
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const mode = opts.mode ? opts.mode(n) : 'ok';
    seen.push({ range: q.headers.range || null, mode });
    if (mode === '401') { s.writeHead(401); return s.end(); }
    const a = +m[1]; const b = Math.min(m[2] ? +m[2] : SIZE - 1, SIZE - 1);
    const part = DATA.subarray(a, b + 1);
    s.writeHead(206, { 'Content-Length': part.length, 'Content-Range': `bytes ${a}-${b}/${SIZE}` });
    if (opts.slowMs) { const head = Math.min(part.length - 1, 1536 * 1024); s.write(part.subarray(0, head)); const t = setTimeout(() => s.end(part.subarray(head)), opts.slowMs); s.on('close', () => clearTimeout(t)); return; }
    s.end(part);
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}
const made = [];
after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sd5-')); made.push(d); return path.join(d, 'f.bin'); };
const base = (extra) => ({ expectedSize: SIZE, chunkSize: CHUNK, streams: 4, retryDelayMs: 10, saveEveryMs: 20, ...extra });
const errno = (code) => Object.assign(new Error(`${code}: simulated, write`), { code });

// Every write to the .armdl file fails with `code` once `afterBytes` have been written.
function failWritesWith(code, afterBytes = 0) {
  const realOpen = fs.promises.open;
  let written = 0;
  fs.promises.open = async (...a) => {
    const fh = await realOpen(...a);
    if (!String(a[0]).endsWith(TEMP_SUFFIX)) return fh;
    const realWrite = fh.write.bind(fh);
    fh.write = async (buf, ...rest) => { if (written >= afterBytes) throw errno(code); written += buf.length; return realWrite(buf, ...rest); };
    return fh;
  };
  return () => { fs.promises.open = realOpen; };
}

test('a full disk ends the download at once as a disk problem, without network retries', async () => {
  const { srv, base: b } = await server();
  const out = tmp(); const events = [];
  const restore = failWritesWith('ENOSPC', 3 * 1024 * 1024);
  let err;
  try { await segmentedDownload(base({ url: b + '/f', outputPath: out, onEvent: (m) => events.push(m) })).promise; } catch (e) { err = e; } finally { restore(); srv.close(); }
  assert.ok(err, 'the download must fail');
  assert.equal(err.kind, 'disk');
  assert.equal(err.code, 'ENOSPC');
  assert.equal(events.filter((m) => /retry \d+/.test(m)).length, 0, 'no retries: ' + events.join(' | '));
  assert.ok(fs.existsSync(out + STATE_SUFFIX) && fs.existsSync(out + TEMP_SUFFIX), 'what was downloaded is kept for Retry');
  assert.ok(!fs.existsSync(out));
});

test('a read-only or locked folder is a disk problem too', async () => {
  const { srv, base: b } = await server();
  const out = tmp();
  const restore = failWritesWith('EACCES');
  let err;
  try { await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1 })).promise; } catch (e) { err = e; } finally { restore(); srv.close(); }
  assert.equal(err && err.kind, 'disk');
  assert.equal(err.code, 'EACCES');
});

test('member message: disk full says so, is not "stalled", and is not auto-retried', () => {
  const t = engineFailureText({ kind: 'disk', code: 'ENOSPC', stage: 'write', message: 'cannot write file: ENOSPC: no space left on device' });
  assert.match(t.headline, /out of disk space/);
  assert.doesNotMatch(`${t.headline}\n${t.hint}`, /stalled|could not be resumed/i);
  // main.js auto-retry: the block list must match, the transient list must not win
  assert.match(`${t.headline}\n${t.hint}`, /disk space/i);
});

test('member message: a locked finished file is retried by itself; permission problems are not', () => {
  const fin = engineFailureText({ kind: 'disk', code: 'EPERM', stage: 'finish', message: 'cannot save the finished file: EPERM' });
  assert.match(fin.headline, /could not be saved yet/);
  assert.doesNotMatch(`${fin.headline}\n${fin.hint}`, /disk space|quota|date\/time|download folder|security error/i, 'must not hit AUTO_RETRY_BLOCK_RE');
  const perm = engineFailureText({ kind: 'disk', code: 'EACCES', stage: 'write', message: 'x' });
  assert.match(perm.headline, /download folder/);
  const resumeEngine = engineFailureText({ kind: 'fatal', code: 'ENOSPC', stage: 'write', message: 'cannot write file: ENOSPC: no space left on device' });
  assert.match(resumeEngine.headline, /out of disk space/, 'the single-stream engine is covered too');
  assert.match(engineFailureText({ kind: 'expired' }).headline, /link expired/);
  assert.match(engineFailureText({ kind: 'network', message: 'connection timed out' }).headline, /stalled/);
  assert.match(engineFailureText(null).headline, /stalled/);
});

test('main.js auto-retry lists agree with the new messages', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const transient = new RegExp(/const AUTO_RETRY_TRANSIENT_RE = \/(.*)\/i;/.exec(src)[1], 'i');
  const block = new RegExp(/const AUTO_RETRY_BLOCK_RE = \/(.*)\/i;/.exec(src)[1], 'i');
  const full = (t) => `${t.headline}\nMost likely fix: ${t.hint}`;
  const fin = full(engineFailureText({ kind: 'disk', code: 'EPERM', stage: 'finish' }));
  assert.ok(transient.test(fin) && !block.test(fin), 'a locked finished file is auto-retried');
  const disk = full(engineFailureText({ kind: 'disk', code: 'ENOSPC' }));
  assert.ok(block.test(disk), 'a full disk is never auto-retried');
  const expected = new RegExp(/const EXPECTED_FAILURE_RE = \/(.*)\/i;/.exec(src)[1], 'i');
  assert.ok(expected.test(disk.split('\n')[0]), 'a full disk is not sent to Sentry as a fault');
});

test('the finished file is renamed even when antivirus holds it for a moment', async () => {
  const { srv, base: b } = await server();
  const out = tmp();
  const real = fs.renameSync; let refused = 0;
  fs.renameSync = (from, to) => { if (String(from).endsWith(TEMP_SUFFIX) && refused < 3) { refused++; throw errno('EPERM'); } return real(from, to); };
  try { await segmentedDownload(base({ url: b + '/f', outputPath: out, renameDelayMs: 5 })).promise; } finally { fs.renameSync = real; srv.close(); }
  assert.equal(refused, 3);
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(!fs.existsSync(out + TEMP_SUFFIX) && !fs.existsSync(out + STATE_SUFFIX));
});

test('a rename that never succeeds fails as "finish", and Retry then only renames (no bytes fetched again)', async () => {
  const s1 = await server();
  const out = tmp();
  const real = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(from).endsWith(TEMP_SUFFIX)) throw errno('EBUSY'); return real(from, to); };
  let err;
  try { await segmentedDownload(base({ url: s1.base + '/f', outputPath: out, renameDelayMs: 1, renameTries: 3 })).promise; } catch (e) { err = e; } finally { fs.renameSync = real; s1.srv.close(); }
  assert.equal(err && err.kind, 'disk');
  assert.equal(err.stage, 'finish');
  const s2 = await server();
  await segmentedDownload(base({ url: s2.base + '/f', outputPath: out })).promise;
  s2.srv.close();
  assert.equal(s2.seen.length, 0, 'nothing downloaded twice');
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  await assert.rejects(renameWithRetry(out + '.nope', out + '.x', 2, 1), (e) => e.kind === 'disk' && e.code === 'ENOENT');
});

test('a fresh-link request that throws is one more attempt, not the end of the download', async () => {
  const { srv, base: b } = await server({ mode: (n) => (n < 2 ? '401' : 'ok') });
  const out = tmp(); let asked = 0; const events = [];
  await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1, onEvent: (m) => events.push(m),
    getFreshUrl: async () => { asked++; if (asked === 1) throw new Error('site busy (HTTP 429)'); return b + '/f'; } })).promise;
  srv.close();
  assert.equal(sha(fs.readFileSync(out)), sha(DATA));
  assert.ok(asked >= 2);
  assert.ok(events.some((m) => /fresh link failed: site busy/.test(m)));
});

test('a fresh-link request that keeps throwing ends as an expired link, with the kind set', async () => {
  const { srv, base: b } = await server({ mode: () => '401' });
  const out = tmp();
  let err;
  try { await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 1, maxAttempts: 3, getFreshUrl: async () => { throw new Error('offline'); } })).promise; } catch (e) { err = e; } finally { srv.close(); }
  assert.equal(err && err.kind, 'expired');
});

test('when one stream fails for good the other streams stop at once instead of finishing their ranges', async () => {
  // writes fail after the first MiB while every stream is mid-way through a slow 5 s response
  const { srv, base: b } = await server({ slowMs: 5000, mode: () => 'ok' });
  const out = tmp();
  const restore = failWritesWith('ENOSPC', 64 * 1024);
  const t0 = Date.now(); let err;
  try { await segmentedDownload(base({ url: b + '/f', outputPath: out, streams: 4 })).promise; } catch (e) { err = e; } finally { restore(); srv.close(); }
  assert.equal(err && err.kind, 'disk');
  assert.ok(Date.now() - t0 < 3000, `ended after ${Date.now() - t0} ms`);
});

