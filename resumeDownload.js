// Resumable single-file HTTP downloader. rclone copyurl deletes its partial file
// on any error and restarts from byte 0, so a dropped connection or an expired
// link 40 GB into a file threw the whole file away. This downloader appends to
// the target and reconnects with a Range header from the last byte written.
//
// A "<file>.armpart" marker proves the bytes on disk were written contiguously
// by this downloader (rclone's multi-stream copy pre-sizes files with holes, so
// the size of an unmarked file means nothing).
const fs = require('fs');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { Transform } = require('stream');

const MARKER_SUFFIX = '.armpart';
const MAX_REDIRECTS = 5;

class ResumeError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind || 'network';
    this.status = status || 0;
  }
}

function openStream(urlString, headers, stallMs, hops = 0, tlsOptions) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(new ResumeError('bad url', 'fatal')); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers, ...(u.protocol === 'https:' ? (tlsOptions || {}) : {}) }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(new ResumeError('too many redirects', 'network'));
        let next;
        try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new ResumeError('bad redirect', 'network')); }
        return openStream(next, headers, stallMs, hops + 1, tlsOptions).then(resolve, reject);
      }
      resolve({ req, res });
    });
    req.setTimeout(stallMs, () => req.destroy(new ResumeError('connection timed out', 'network')));
    req.on('error', (e) => reject(e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network')));
  });
}

// How long a 429 "too many downloads at once" asks us to wait (Retry-After: seconds or an HTTP date), kept between 1 s and 60 s.
// The gateway sends Retry-After: 5; with no header we wait 5 s. Shared by both engines (segmentedDownload re-exports it).
function retryAfterMs(v, now = Date.now()) {
  const s = String(v == null ? '' : v).trim();
  let ms = 5000;
  if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
  else if (s) { const t = Date.parse(s); if (Number.isFinite(t)) ms = t - now; }
  return Math.max(1000, Math.min(60000, ms));
}

// Returns a controller { promise, abort(reason) }.
//   url            first URL to try
//   getFreshUrl    async () => url, called before every reconnect (new signed link / mirror)
//   onProgress     (bytesOnDisk, totalOrZero) => void
//   expectedSize   bytes, 0 if unknown
//   onEvent        (message) => void, optional: one line per retry / wait (same wording as the segmented engine)
//
// Retry budget (2026-11-25, same rules as segmentedDownload for one connection). Until now there were 12 tries in a row, reset only by a
// pass that finished cleanly, so a link that kept dropping every few hundred MB failed the download even though it was moving. Now:
//   - a network failure only counts (maxAttempts) when no bytes arrived since the previous failure; while bytes flow it keeps retrying
//     (its delay still grows up to 15 s while it gets nothing, and starts again when bytes arrive)
//   - stall limit: no bytes for stallLimitMs ends the run as a network failure ("no data from the server for ...")
//   - a refused link (401/403/410) counts every time: after maxRefusals the run ends; without getFreshUrl it ends at once
//   - 404, 416 (unless the file is already complete) and other 4xx end the run at once
//   - 429 waits for Retry-After (1-60 s, default 5) and does not count; the stall limit still applies
function resumeDownload(opts) {
  const {
    outputPath, expectedSize = 0, getFreshUrl, onProgress, onEvent, headers = {}, stallMs = 60 * 1000, maxAttempts = 12, retryDelayMs = 2000, tlsOptions,
    stallLimitMs = 5 * 60 * 1000, maxRefusals = 4, limiter = null
  } = opts;
  const limitAbort = new AbortController();     // ends a wait for the speed limit when the download is stopped
  const markerPath = outputPath + MARKER_SUFFIX;
  let aborted = null;
  let currentReq = null;
  let currentRes = null;
  const emit = (m) => { if (onEvent) { try { onEvent(m); } catch (e) { } } };

  let wakeSleep = null;     // abort ends a retry delay at once
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(() => { wakeSleep = null; r(); }, ms); wakeSleep = () => { clearTimeout(t); wakeSleep = null; r(); }; });

  const run = async () => {
    let offset = 0;
    try {
      if (fs.existsSync(markerPath) && fs.existsSync(outputPath)) offset = fs.statSync(outputPath).size;
    } catch (e) { offset = 0; }
    if (!offset) {
      fs.writeFileSync(outputPath, '');
    }
    fs.writeFileSync(markerPath, String(Date.now()));

    let total = expectedSize > 0 ? expectedSize : 0;
    let url = opts.url;
    let attempt = 0;        // failures in a row with no bytes in between (ends the run at maxAttempts)
    let refusals = 0;       // refused links (401/403/410) since bytes last arrived (ends the run at maxRefusals)
    let backoff = 0;        // failures since bytes last arrived: only sets the delay before the next try
    let received = 0;       // bytes received in this run
    let seenReceived = 0;   // `received` at the previous failure
    let lastBytesAt = Date.now();
    let lastErr = null;
    let freshNeeded = false;

    for (;;) {
      if (aborted) throw aborted;
      if (total > 0 && offset === total) break;
      try {
        // Asking for a fresh link can fail too (the site is busy, the PC is offline for a moment): that is one more failed try, not the end.
        if (freshNeeded && typeof getFreshUrl === 'function') {
          const fresh = await getFreshUrl();
          if (fresh) url = fresh;
        }
        freshNeeded = true;
        const h = { ...headers, 'Accept-Encoding': 'identity' };
        if (offset > 0) h.Range = `bytes=${offset}-`;
        const { req, res } = await openStream(url, h, stallMs, 0, tlsOptions);
        currentReq = req; currentRes = res;
        const code = res.statusCode;
        if (code === 416 && total > 0 && offset >= total) { res.resume(); break; }
        if (code === 401 || code === 403 || code === 410) {
          res.resume();
          throw new ResumeError(`HTTP ${code}`, 'expired', code);
        }
        if (code === 429) {
          res.resume();
          const busy = new ResumeError('HTTP 429', 'busy', code);
          busy.waitMs = retryAfterMs(res.headers['retry-after']);
          throw busy;
        }
        if (code >= 500 || code === 408) {
          res.resume();
          throw new ResumeError(`HTTP ${code}`, 'network', code);
        }
        if (code !== 200 && code !== 206) {
          res.resume();
          throw new ResumeError(`HTTP ${code}`, 'fatal', code);
        }
        let flags = 'a';
        if (code === 200 && offset > 0) {
          // Server ignored Range: it is sending the whole file again.
          offset = 0;
          flags = 'w';
        }
        const cr = /\/(\d+)\s*$/.exec(String(res.headers['content-range'] || ''));
        if (cr) total = Number(cr[1]);
        else if (code === 200 && res.headers['content-length']) total = total || Number(res.headers['content-length']);

        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(outputPath, { flags });
          // The shared speed limit (speedLimiter.js): each network read waits for its bytes before it goes on to the file; pipe()'s own
          // back-pressure then slows the connection. Checked per read, so a limit switched on or off mid-file applies at once.
          const throttle = limiter ? new Transform({
            transform(chunk, enc, cb) { if (!limiter.limited) return cb(null, chunk); limiter.take(chunk.length, limitAbort.signal).then(() => cb(null, chunk)); }
          }) : null;
          const sink = throttle || ws;
          const endAll = (cb) => { if (throttle) { ws.once('finish', cb); ws.once('error', cb); throttle.end(); } else ws.end(cb); };
          let sinceReport = 0;
          res.on('data', (chunk) => {
            offset += chunk.length;
            received += chunk.length;
            lastBytesAt = Date.now();
            sinceReport += chunk.length;
            if (onProgress && sinceReport >= 256 * 1024) { sinceReport = 0; try { onProgress(offset, total); } catch (e) { } }
          });
          // Every network failure waits for the write stream to finish what it already accepted. A reset used to destroy the stream with a
          // write still in flight; the next pass then read the file size before that write landed and appended the same bytes twice
          // (found 2026-11-25 by the repeated-drop test under load: the file came out corrupted).
          let failed = false;
          const dropped = (msg) => { if (failed) return; failed = true; res.unpipe(sink); endAll(() => reject(new ResumeError(msg, 'network'))); };
          res.on('error', (e) => dropped(e && e.message ? e.message : String(e)));
          res.on('aborted', () => dropped('connection dropped'));
          res.on('close', () => { if (!res.complete) dropped('connection dropped'); });
          ws.on('error', (e) => { failed = true; res.destroy(); reject(Object.assign(new ResumeError(`cannot write file: ${e.message}`, 'fatal'), { code: e && e.code ? String(e.code) : '', stage: 'write' })); });
          // Only a response that ended normally is a clean pass. ('finish' also fires after dropped() ends the stream, before its reject:
          // that used to count every dropped connection as a clean pass, so drops reset the budget and retried without any delay.)
          ws.on('finish', () => { if (!failed) resolve(); });
          if (throttle) throttle.pipe(ws);
          res.pipe(sink);
        });
        // A response that ends normally with no bytes while the file is still short would otherwise loop at once, forever: count it.
        if (received === seenReceived && total > 0 && offset < total) throw new ResumeError('server sent no data', 'network');
        attempt = 0; refusals = 0; backoff = 0; // a clean pass resets the failure budget
        seenReceived = received;
        freshNeeded = false;
        if (!(total > 0) || offset >= total) break;
      } catch (e) {
        if (aborted) throw aborted;
        const err = e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network');
        lastErr = err;
        // Bytes written before the failure are kept: the next pass continues from them.
        try { offset = fs.statSync(outputPath).size; } catch (e2) { }
        if (err.kind === 'fatal') throw err;
        const stalledFor = Date.now() - lastBytesAt;
        const stallErr = () => { const s = new ResumeError(`no data from the server for ${Math.round(stalledFor / 1000)}s (last error: ${err.message})`, 'network', err.status); s.stalled = true; return s; };
        if (err.kind === 'busy') {
          // The gateway is at its connection cap: wait as asked, without counting a failure. Not forever: the stall limit still applies.
          if (stalledFor >= stallLimitMs) throw stallErr();
          emit(`busy: HTTP 429, waiting ${Math.round(err.waitMs / 100) / 10}s`);
          freshNeeded = false;      // the link is fine, the gateway is only full
          await sleep(err.waitMs);
          continue;
        }
        const moved = received !== seenReceived;
        seenReceived = received;
        if (moved) { backoff = 0; refusals = 0; }
        backoff++;
        if (err.kind === 'expired') {
          refusals++;
          attempt++;
          if (refusals >= Math.min(maxRefusals, maxAttempts) || typeof getFreshUrl !== 'function') throw err;
        } else {
          // Bytes arrived since the previous failure: the download is moving, so this failure is not counted.
          attempt = moved ? 1 : attempt + 1;
          if (attempt >= maxAttempts) throw err;
          if (stalledFor >= stallLimitMs) throw stallErr();
        }
        emit(`retry ${attempt}: ${err.kind} ${err.message}`);
        await sleep(Math.min(15000, retryDelayMs * backoff));
      }
    }

    if (aborted) throw aborted;
    let size = 0;
    try { size = fs.statSync(outputPath).size; } catch (e) { }
    if (total > 0 && size !== total) {
      throw lastErr || new ResumeError(`incomplete (${size} of ${total} bytes)`, 'network');
    }
    try { fs.unlinkSync(markerPath); } catch (e) { }
    if (onProgress) { try { onProgress(size, total || size); } catch (e) { } }
    return size;
  };

  const promise = run();
  const abort = (reason) => {
    aborted = reason instanceof Error ? reason : Object.assign(new ResumeError(String(reason || 'aborted'), 'aborted'), {});
    try { if (currentRes) currentRes.destroy(); } catch (e) { }
    try { if (currentReq) currentReq.destroy(); } catch (e) { }
    try { if (wakeSleep) wakeSleep(); } catch (e) { }
    try { limitAbort.abort(); } catch (e) { }
  };
  return { promise, abort };
}

// Stand-in for a ChildProcess so pause/cancel code that kills activeProcesses
// entries (kill, killed, exitCode, signalCode, 'close') works unchanged.
class ResumeProc extends EventEmitter {
  constructor(abortFn) {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this._abort = abortFn;
  }
  kill(signal) {
    if (this.killed) return true;
    this.killed = true;
    try { this._abort(new ResumeError('stopped', 'aborted')); } catch (e) { }
    return true;
  }
  finish(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

module.exports = { resumeDownload, ResumeProc, ResumeError, MARKER_SUFFIX, openStream, retryAfterMs };
