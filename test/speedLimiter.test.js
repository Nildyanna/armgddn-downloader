'use strict';
// The download speed limit: one token bucket for every connection of every download (speedLimiter.js), the "only between" hours
// (schedule.js), and both engines following it live.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { TokenBucket, MB } = require('../speedLimiter');
const scheduleLib = require('../schedule');
const { segmentedDownload } = require('../segmentedDownload');
const { resumeDownload } = require('../resumeDownload');

// N readers pull `piece` bytes at a time through the bucket until `ms` has passed; returns bytes granted per second.
async function measure(bucket, { readers = 8, piece = 64 * 1024, ms = 3000 }) {
  const t0 = Date.now();
  let granted = 0;
  await Promise.all(Array.from({ length: readers }, async () => {
    while (Date.now() - t0 < ms) { await bucket.take(piece); granted += piece; }
  }));
  return granted / ((Date.now() - t0) / 1000);
}

test('5 MB/s shared by 8 connections stays within 10% over 3 seconds', async () => {
  const b = new TokenBucket({ rate: 5 * MB });
  const rate = await measure(b, { readers: 8, ms: 3000 });
  assert.ok(Math.abs(rate - 5 * MB) / (5 * MB) <= 0.10, `measured ${(rate / MB).toFixed(2)} MB/s`);
});

test('the limit is a total: two "downloads" on one bucket share it instead of getting it each', async () => {
  const b = new TokenBucket({ rate: 4 * MB });
  const [r1, r2] = await Promise.all([measure(b, { readers: 4, ms: 2000 }), measure(b, { readers: 4, ms: 2000 })]);
  assert.ok(Math.abs(r1 + r2 - 4 * MB) / (4 * MB) <= 0.10, `together ${((r1 + r2) / MB).toFixed(2)} MB/s`);
  assert.ok(Math.abs(r1 - r2) / (4 * MB) <= 0.15, 'shared fairly');
});

// Fake clock: exact checks without waiting.
function fakeClock() {
  let now = 0; const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); },
    advance: async (ms) => {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift(); now = t.at; t.fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end; await new Promise((r) => setImmediate(r));
    },
  };
}

test('a live change applies to reads that are already waiting', async () => {
  const c = fakeClock();
  const b = new TokenBucket({ rate: 1 * MB, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  let done = 0;
  for (let i = 0; i < 10; i++) b.take(512 * 1024).then(() => done++);
  await c.advance(1000);
  assert.ok(done >= 1 && done <= 3, `about 1 MB in the first second at 1 MB/s (got ${done} x 512 KB)`);
  b.setRate(10 * MB);                         // the member picks a higher limit
  await c.advance(400);
  assert.strictEqual(done, 10, 'the rest goes through at the new rate without restarting');
  b.setRate(0);                               // Unlimited
  let instant = false; b.take(100 * MB).then(() => { instant = true; });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(instant, true);
});

test('switching to Unlimited releases every waiting read at once; an aborted read is released too', async () => {
  const c = fakeClock();
  const b = new TokenBucket({ rate: 1024, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  let released = 0;
  const ac = new AbortController();
  b.take(1 * MB, ac.signal).then(() => released++);
  b.take(1 * MB).then(() => released++);
  await c.advance(10);
  assert.strictEqual(released, 0);
  ac.abort();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(released, 1);
  b.setRate(0);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(released, 2);
});

test('charge() books bytes from the rclone path: the other connections wait for them', async () => {
  const c = fakeClock();
  const b = new TokenBucket({ rate: 1 * MB, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  b.charge(2 * MB);                             // rclone took 2 MB
  let got = false; b.take(64 * 1024).then(() => { got = true; });
  await c.advance(1900);
  assert.strictEqual(got, false, 'still paying back the rclone bytes');
  await c.advance(200);
  assert.strictEqual(got, true);
});

test('"only between" hours: inside, outside, and past midnight; quiet hours limit still wins when lower', () => {
  const at = (h, m = 0) => { const d = new Date(2026, 10, 25, h, m, 0); return d; };
  const s = { maxDownloadSpeedMBps: 10, speedLimitHours: { enabled: true, start: '08:00', end: '18:00' }, schedule: { enabled: false } };
  assert.strictEqual(scheduleLib.currentLimitMBps(s, at(9)), 10);
  assert.strictEqual(scheduleLib.currentLimitMBps(s, at(18)), 0);       // the end time is not inside
  assert.strictEqual(scheduleLib.currentLimitMBps(s, at(7, 59)), 0);
  const night = { ...s, speedLimitHours: { enabled: true, start: '22:00', end: '06:30' } };
  assert.strictEqual(scheduleLib.currentLimitMBps(night, at(23)), 10);
  assert.strictEqual(scheduleLib.currentLimitMBps(night, at(6, 0)), 10);
  assert.strictEqual(scheduleLib.currentLimitMBps(night, at(12)), 0);
  const allDay = { ...s, speedLimitHours: { enabled: false, start: '08:00', end: '18:00' } };
  assert.strictEqual(scheduleLib.currentLimitMBps(allDay, at(3)), 10);
  const quiet = { ...allDay, schedule: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', action: 'limit', limitMBps: 5 } };
  assert.strictEqual(scheduleLib.currentLimitMBps(quiet, at(12)), 5);
  assert.strictEqual(scheduleLib.currentLimitMBps({ maxDownloadSpeedMBps: 0 }, at(12)), 0);
  assert.deepStrictEqual(scheduleLib.normalizeLimitHours({ enabled: 'yes', start: '25:00' }), { enabled: false, start: '08:00', end: '23:00' });
});

// The engines: a real local server, the shared bucket passed in as the app does.
const SIZE = 3 * 1024 * 1024;
const DATA = crypto.randomBytes(SIZE);
const servers = []; const dirs = [];
after(() => { for (const s of servers) { try { s.closeAllConnections(); s.close(); } catch (e) { } } for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });
function server() {
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)?/.exec(q.headers.range || '');
    const a = m ? +m[1] : 0; const b = m && m[2] ? Math.min(+m[2], SIZE - 1) : SIZE - 1;
    const part = DATA.subarray(a, b + 1);
    s.writeHead(m ? 206 : 200, { 'Content-Length': part.length, ...(m ? { 'Content-Range': `bytes ${a}-${b}/${SIZE}` } : {}) });
    s.end(part);
  });
  servers.push(srv);
  return new Promise((r) => srv.listen(0, () => r(`http://127.0.0.1:${srv.address().port}/f`)));
}
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-')); dirs.push(d); return path.join(d, 'f.bin'); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('segmented and single engines share one limit: two 3 MB files at 3 MB/s total take about 2 s, and the files are intact', async () => {
  const url = await server();
  const bucket = new TokenBucket({ rate: 3 * MB });
  const a = tmp(); const b = tmp();
  const t0 = Date.now();
  await Promise.all([
    segmentedDownload({ url, outputPath: a, expectedSize: SIZE, streams: 4, chunkSize: 1024 * 1024, retryDelayMs: 10, limiter: bucket }).promise,
    resumeDownload({ url, outputPath: b, expectedSize: SIZE, retryDelayMs: 10, limiter: bucket }).promise,
  ]);
  const secs = (Date.now() - t0) / 1000;
  assert.ok(secs >= 1.7 && secs <= 3.0, `6 MB at 3 MB/s total took ${secs}s`);
  assert.strictEqual(sha(fs.readFileSync(a)), sha(DATA));
  assert.strictEqual(sha(fs.readFileSync(b)), sha(DATA));
});

test('raising the limit mid-download speeds the running download up without a restart', async () => {
  const url = await server();
  const bucket = new TokenBucket({ rate: 512 * 1024 });          // 3 MB would take 6 s
  const out = tmp();
  const t0 = Date.now();
  setTimeout(() => bucket.setRate(0), 700);                       // the member switches to Unlimited
  await segmentedDownload({ url, outputPath: out, expectedSize: SIZE, streams: 4, chunkSize: 1024 * 1024, retryDelayMs: 10, limiter: bucket }).promise;
  const secs = (Date.now() - t0) / 1000;
  assert.ok(secs < 2.5, `finished in ${secs}s after the limit was lifted`);
  assert.strictEqual(sha(fs.readFileSync(out)), sha(DATA));
});
