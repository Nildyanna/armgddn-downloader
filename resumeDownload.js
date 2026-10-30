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

const MARKER_SUFFIX = '.armpart';
const MAX_REDIRECTS = 5;

class ResumeError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind || 'network';
    this.status = status || 0;
  }
}

function openStream(urlString, headers, stallMs, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(new ResumeError('bad url', 'fatal')); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(new ResumeError('too many redirects', 'network'));
        let next;
        try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new ResumeError('bad redirect', 'network')); }
        return openStream(next, headers, stallMs, hops + 1).then(resolve, reject);
      }
      resolve({ req, res });
    });
    req.setTimeout(stallMs, () => req.destroy(new ResumeError('connection timed out', 'network')));
    req.on('error', (e) => reject(e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network')));
  });
}

// Returns a controller { promise, abort(reason) }.
//   url            first URL to try
//   getFreshUrl    async () => url, called before every reconnect (new signed link / mirror)
//   onProgress     (bytesOnDisk, totalOrZero) => void
//   expectedSize   bytes, 0 if unknown
function resumeDownload(opts) {
  const { outputPath, expectedSize = 0, getFreshUrl, onProgress, headers = {}, stallMs = 60 * 1000, maxAttempts = 12, retryDelayMs = 2000 } = opts;
  const markerPath = outputPath + MARKER_SUFFIX;
  let aborted = null;
  let currentReq = null;
  let currentRes = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    let attempt = 0;
    let lastErr = null;
    let freshNeeded = false;

    while (attempt < maxAttempts) {
      if (aborted) throw aborted;
      if (total > 0 && offset === total) break;
      if (freshNeeded && typeof getFreshUrl === 'function') {
        const fresh = await getFreshUrl();
        if (fresh) url = fresh;
      }
      freshNeeded = true;
      attempt++;
      try {
        const h = { ...headers, 'Accept-Encoding': 'identity' };
        if (offset > 0) h.Range = `bytes=${offset}-`;
        const { req, res } = await openStream(url, h, stallMs);
        currentReq = req; currentRes = res;
        const code = res.statusCode;
        if (code === 416 && total > 0 && offset >= total) { res.resume(); break; }
        if (code === 401 || code === 403 || code === 410) {
          res.resume();
          throw new ResumeError(`HTTP ${code}`, 'expired', code);
        }
        if (code >= 500 || code === 429 || code === 408) {
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
          let sinceReport = 0;
          res.on('data', (chunk) => {
            offset += chunk.length;
            sinceReport += chunk.length;
            if (onProgress && sinceReport >= 256 * 1024) { sinceReport = 0; try { onProgress(offset, total); } catch (e) { } }
          });
          res.on('error', (e) => { ws.destroy(); reject(new ResumeError(e && e.message ? e.message : String(e), 'network')); });
          res.on('aborted', () => { ws.end(() => reject(new ResumeError('connection dropped', 'network'))); });
          res.on('close', () => { if (!res.complete) ws.end(() => reject(new ResumeError('connection dropped', 'network'))); });
          ws.on('error', (e) => { res.destroy(); reject(new ResumeError(`cannot write file: ${e.message}`, 'fatal')); });
          ws.on('finish', () => resolve());
          res.pipe(ws);
        });
        attempt = 0; // a clean pass resets the failure budget
        freshNeeded = false;
        if (!(total > 0) || offset >= total) break;
      } catch (e) {
        if (aborted) throw aborted;
        lastErr = e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network');
        // Bytes written before the failure are kept: the next pass continues from them.
        try { offset = fs.statSync(outputPath).size; } catch (e2) { }
        if (lastErr.kind === 'fatal') throw lastErr;
        await sleep(Math.min(15000, retryDelayMs * attempt));
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

module.exports = { resumeDownload, ResumeProc, ResumeError, MARKER_SUFFIX, openStream };
