// Multi-stream resumable HTTP downloader for big files.
//
// rclone copyurl can fetch a file in 16 parallel streams, but when it is stopped (Pause, a crash, a dropped
// link) it throws the half-written file away, so Resume starts again from zero. This downloader keeps the
// parallel speed and remembers its place:
//   - the file is cut into segments; a pool of streams each downloads whole segments with Range requests
//   - bytes are written at their own offset into "<file>.armdl" (never under the final name, so a half-done
//     file can not be mistaken for a finished one); the file is reserved at its full size up front, so a full disk
//     fails at the start and the disk is not fragmented
//   - "<file>.armseg" records every segment and how many bytes of it are on disk, saved about once a second and on stop
//   - Resume (or a retry after a failure) reads that record and fetches only what is missing
//   - a stream that runs out of work takes over the far half of the biggest segment still being downloaded, so the
//     last connection does not hold up the finish (work stealing)
//   - the record keeps the server's ETag / Last-Modified; a resume that finds a different file on the server starts
//     over instead of mixing two versions
//   - when the server refuses extra connections, the stream count drops to what it allows and is reported so the
//     caller can remember it for that host
//   - when every segment is complete the temporary file is renamed to the final name
const fs = require('fs');
const { EventEmitter } = require('events');
const { ResumeError } = require('./resumeDownload');
const { openAuto } = require('./httpOpen');

const TEMP_SUFFIX = '.armdl';
const STATE_SUFFIX = '.armseg';
const DEFAULT_CHUNK = 32 * 1024 * 1024;
const WRITE_BATCH = 1024 * 1024;
const STATE_VERSION = 2;
const MIB = 1024 * 1024;
const DEFAULT_STEAL_MIN = 16 * MIB;        // a segment with less than this left is not worth splitting (half of it must clear what is still in flight)
const REFUSAL_WINDOW_MS = 30 * 1000;       // two refused connections within this time mean "the server allows no more than what is open"

// Ask for the first byte only: 206 + a Content-Range total means the server honours Range. Two tries, so one slow
// answer does not push a resume onto the slower rclone path.
async function probeRanges(url, headers, stallMs = 15 * 1000, tls) {
  let last = { ok: false, status: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { req, res } = await openAuto(url, { ...headers, 'Accept-Encoding': 'identity', Range: 'bytes=0-0' }, stallMs, { tls });
      const code = res.statusCode || 0;
      const cr = /\/(\d+)\s*$/.exec(String(res.headers['content-range'] || ''));
      res.destroy(); req.destroy();
      if (code === 206 && cr) return { ok: true, total: Number(cr[1]) };
      last = { ok: false, status: code };
      if (code && code < 500 && code !== 429) return last;     // a clear "no" is final; timeouts and 5xx get one more try
    } catch (e) {
      last = { ok: false, status: 0, error: e && e.message ? e.message : String(e) };
    }
  }
  return last;
}

// The server's identity for the file: a strong ETag (weak ones are not allowed in If-Range) and/or Last-Modified.
function validatorFrom(headers) {
  const etag = String((headers && headers.etag) || '');
  const lm = String((headers && headers['last-modified']) || '');
  const v = {};
  if (etag && !/^W\//i.test(etag)) v.etag = etag;
  if (lm) v.lastModified = lm;
  return (v.etag || v.lastModified) ? v : null;
}
const ifRangeOf = (v) => (v ? (v.etag || v.lastModified) : '');

// A progress record from an earlier run. Version 1 (equal chunks, one counter each) is still read, so a download that was paused
// before an update continues after it. Segments must cover the whole file without gaps; anything else is ignored.
function loadState(statePath, tempPath, total) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!s || s.total !== total || !fs.existsSync(tempPath)) return null;
    let segs = null;
    if (s.v === 1) {
      const chunk = Number(s.chunk);
      if (Number.isInteger(chunk) && chunk >= MIB && Array.isArray(s.done) && s.done.length === Math.ceil(total / chunk)) {
        segs = s.done.map((d, i) => { const start = i * chunk; const end = Math.min(total, start + chunk) - 1; return { start, end, done: Math.max(0, Math.min(Number(d) || 0, end - start + 1)) }; });
      }
    } else if (s.v === STATE_VERSION && Array.isArray(s.segs) && s.segs.length) {
      segs = s.segs.map((x) => ({ start: Number(x[0]), end: Number(x[1]), done: Number(x[2]) || 0 }));
      segs.sort((a, b) => a.start - b.start);
      let at = 0;
      for (const g of segs) {
        if (!(Number.isInteger(g.start) && Number.isInteger(g.end)) || g.start !== at || g.end < g.start) { segs = null; break; }
        g.done = Math.max(0, Math.min(g.done, g.end - g.start + 1));
        at = g.end + 1;
      }
      if (segs && at !== total) segs = null;
    }
    if (!segs) return null;
    return { segs, validator: s.validator && (s.validator.etag || s.validator.lastModified) ? s.validator : null };
  } catch (e) { }
  return null;
}

// One long request per stream (like rclone's own multi-thread copy) instead of many short ones: the streams then do not all
// reconnect to the server at the same moment, which a busy download host answers with long stalls.
function planChunk(total, streams) {
  return Math.max(DEFAULT_CHUNK, Math.ceil(total / Math.max(1, streams) / MIB) * MIB);
}

// Returns a controller { promise, abort(reason) } like resumeDownload().
//   url          first URL to try
//   expectedSize bytes (required: the segment plan is built from it)
//   streams      parallel connections
//   hostLimit    connections this server is known to allow (0 = unknown); the stream count starts at or below it
//   onHostLimit  (limit) => void, called when the server turned connections away, with how many it accepted at that moment
//   getFreshUrl  async () => url, called when a link has expired
//   onProgress   (bytesOnDisk, total) => void
const activeByPath = new Map();     // outputPath -> controller of the run that owns that file right now

function segmentedDownload(opts) {
  const {
    outputPath, expectedSize = 0, streams = 4, getFreshUrl, onProgress, headers = {},
    stallMs = 60 * 1000, maxAttempts = 12, retryDelayMs = 2000, chunkSize = 0, saveEveryMs = 1000, maxBytesPerSec = 0, onEvent, tlsOptions,
    hostLimit = 0, onHostLimit, stealMinBytes = DEFAULT_STEAL_MIN
  } = opts;
  const ctl = new AbortController();      // cancels requests that are still waiting for their first response
  const emit = (m) => { if (onEvent) { try { onEvent(m); } catch (e) { } } };
  let limiterSlot = 0;     // shared by every stream: the moment the byte budget is next free (the user's speed limit)
  const tempPath = outputPath + TEMP_SUFFIX;
  const statePath = outputPath + STATE_SUFFIX;
  let aborted = null;
  const live = new Set();          // open { req, res } pairs, destroyed on abort
  let wake = null;

  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });

  const previous = activeByPath.get(outputPath);

  // useValidator=false (the restart after a "changed" verdict): ignore ETag / Last-Modified completely, so a server that sends a
  // different ETag on every request (some CDNs) cannot make a download restart in a loop; it falls back to the size check alone.
  const runOnce = async (fresh, useValidator = true) => {
    const total = expectedSize;
    const resumed = fresh ? null : loadState(statePath, tempPath, total);
    let segs;
    if (resumed) {
      segs = resumed.segs;
    } else {
      const chunk = chunkSize > 0 ? Math.max(MIB, chunkSize) : planChunk(total, streams);
      segs = [];
      for (let s = 0; s < total; s += chunk) segs.push({ start: s, end: Math.min(total, s + chunk) - 1, done: 0 });
    }
    for (const g of segs) g.owner = null;
    const len = (g) => g.end - g.start + 1;
    let validator = resumed && useValidator ? resumed.validator : null;

    if (!resumed) {
      try { fs.unlinkSync(statePath); } catch (e) { }
      fs.writeFileSync(tempPath, '');
    }
    const fh = await fs.promises.open(tempPath, 'r+');
    if (!resumed) {
      // Reserve the whole file now: a full disk fails here, not hours in, and Windows lays the file out in one piece.
      try { await fh.truncate(total); } catch (e) {
        try { await fh.close(); } catch (e2) { }
        try { fs.unlinkSync(tempPath); } catch (e2) { }
        if (e && (e.code === 'ENOSPC' || e.code === 'EDQUOT')) throw new ResumeError(`Not enough disk space to reserve ${Math.round(total / MIB)} MiB for this file`, 'fatal');
        throw e;
      }
    }

    let dirty = false;
    const saveState = () => {
      if (!dirty) return;
      dirty = false;
      try {
        const tmp = statePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ v: STATE_VERSION, total, validator, segs: segs.map((g) => [g.start, g.end, g.done]) }));
        fs.renameSync(tmp, statePath);
      } catch (e) { dirty = true; }
    };
    const onDisk = () => segs.reduce((a, g) => a + g.done, 0);
    let sinceReport = 0;
    const report = (force) => {
      if (!onProgress) return;
      if (force || sinceReport >= 256 * 1024) { sinceReport = 0; try { onProgress(onDisk(), total); } catch (e) { } }
    };

    let url = opts.url;
    let urlVersion = 0;
    let refreshing = null;
    const refreshUrl = (seenVersion) => {
      // One refresh at a time; a stream that failed on an old link just picks up the newer one.
      if (seenVersion !== urlVersion) return Promise.resolve();
      if (!refreshing) {
        refreshing = (async () => {
          try {
            if (typeof getFreshUrl === 'function') { const f = await getFreshUrl(); if (f) url = f; }
          } finally { urlVersion++; refreshing = null; }
        })();
      }
      return refreshing;
    };

    let failure = null;

    // ---- which segment a stream takes next ---------------------------------------------------------------------
    const takeUnowned = () => {
      const g = segs.find((x) => !x.owner && x.done < len(x));
      if (g) g.owner = true;
      return g || null;
    };
    // Work stealing: split the far half off the segment with the most left that another stream is still working on.
    // The owner keeps the near half (it stops at its new end); this stream takes the rest as a segment of its own.
    const steal = () => {
      let best = null; let bestLeft = 0;
      for (const g of segs) { const left = len(g) - g.done; if (g.owner && left > bestLeft) { best = g; bestLeft = left; } }
      if (!best || bestLeft < stealMinBytes) return null;
      const mid = best.start + best.done + Math.floor(bestLeft / 2);
      const taken = { start: mid, end: best.end, done: 0, owner: true };
      best.end = mid - 1;
      segs.splice(segs.indexOf(best) + 1, 0, taken);
      dirty = true;
      emit(`stream took bytes ${mid}-${taken.end} from a slower stream`);
      return taken;
    };

    // ---- how many streams the server lets us have --------------------------------------------------------------
    let cap = Math.max(1, Math.min(Number(streams) || 1, Number(hostLimit) > 0 ? Number(hostLimit) : Infinity));
    let refusals = [];
    const noteRefusal = (err, openStreams) => {
      const now = Date.now();
      refusals = refusals.filter((t) => now - t < REFUSAL_WINDOW_MS);
      refusals.push(now);
      if (refusals.length >= 2 && openStreams >= 1 && openStreams < cap) {
        cap = openStreams;
        emit(`the server turned connections away: down to ${cap} stream${cap === 1 ? '' : 's'}`);
        if (typeof onHostLimit === 'function') { try { onHostLimit(cap); } catch (e) { } }
      }
    };

    const timer = setInterval(saveState, saveEveryMs);

    const fetchSegment = async (g, workerNo) => {
      let attempt = 0;
      while (g.done < len(g)) {
        if (aborted) throw aborted;
        if (failure) return;
        if (workerNo >= cap) return;                  // the server allows fewer streams than we started with: hand the segment back
        const start = g.start + g.done;
        const end = g.end;
        const ver = urlVersion;
        attempt++;
        let gotResponse = false;
        try {
          const openedAt = Date.now();
          const reqHeaders = { ...headers, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` };
          if (validator && start > 0) reqHeaders['If-Range'] = ifRangeOf(validator);
          const { req, res } = await openAuto(url, reqHeaders, stallMs, { signal: ctl.signal, tls: tlsOptions });
          const handle = { req, res };
          live.add(handle);
          try {
            const code = res.statusCode || 0;
            if (code === 401 || code === 403 || code === 410) { res.resume(); throw new ResumeError(`HTTP ${code}`, 'expired', code); }
            if (code >= 500 || code === 429 || code === 408) { res.resume(); const e = new ResumeError(`HTTP ${code}`, 'network', code); e.refused = true; throw e; }
            if (code === 200 && start > 0) {
              res.resume();
              if (validator) throw new ResumeError('the file changed on the server', 'changed', code);   // If-Range did not match: a different version
              throw new ResumeError('server stopped honouring Range', 'fatal', code);
            }
            if (code !== 206 && code !== 200) { res.resume(); throw new ResumeError(`HTTP ${code}`, 'fatal', code); }
            gotResponse = true;
            emit(`segment at ${g.start} HTTP ${code} from byte ${start} (${Math.round((Date.now() - openedAt) / 100) / 10}s to first response)`);
            const cr = /^bytes (\d+)-(\d+)\/(\d+)/.exec(String(res.headers['content-range'] || ''));
            if (cr && (Number(cr[3]) !== total)) throw new ResumeError('file size changed on the server', 'fatal', code);
            if (cr && Number(cr[1]) !== start) throw new ResumeError('server answered a different range', 'fatal', code);
            const seen = useValidator ? validatorFrom(res.headers) : null;
            if (seen) {
              if (!validator) { validator = seen; dirty = true; }
              else if ((validator.etag && seen.etag && validator.etag !== seen.etag) || (!validator.etag && validator.lastModified && seen.lastModified && validator.lastModified !== seen.lastModified)) {
                throw new ResumeError('the file changed on the server', 'changed', code);
              }
            }

            let pending = []; let pendingBytes = 0;
            // Every flush waits for the ones before it, including a disk write that is still running. Without that, a dropped connection could
            // start the retry while the last write was in flight (a slow disk, antivirus scanning), and the retry would restart from a stale
            // position and write over the same bytes.
            let flushQueue = Promise.resolve();
            const flush = () => { const p = flushQueue.then(flushNow); flushQueue = p.catch(() => { }); return p; };
            const flushNow = async () => {
              if (!pendingBytes) return;
              let buf = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
              pending = []; pendingBytes = 0;
              const pos = g.start + g.done;
              const room = g.end + 1 - pos;          // another stream may have taken the far part of this segment meanwhile: never write there
              if (buf.length > room) buf = buf.subarray(0, Math.max(0, room));
              if (!buf.length) return;
              if (maxBytesPerSec > 0) {
                const now = Date.now();
                limiterSlot = Math.max(limiterSlot, now) + (buf.length / maxBytesPerSec) * 1000;
                const wait = limiterSlot - now - 500;     // allow a half-second burst
                if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 10000)));
              }
              await fh.write(buf, 0, buf.length, pos);
              g.done += buf.length; dirty = true; sinceReport += buf.length; report(false);
            };
            await new Promise((resolve, reject) => {
              let chain = Promise.resolve(); let finished = false;
              const room = () => g.end + 1 - (g.start + g.done + pendingBytes);     // what this stream still has to fetch (it shrinks when part is stolen)
              const fail = (e) => { if (finished) return; finished = true; reject(e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network')); };
              const complete = () => { if (finished) return; finished = true; resolve(); try { res.destroy(); } catch (e) { } };
              res.on('data', (d) => {
                if (finished) return;
                const r = room();
                if (r <= 0) { chain = chain.then(flush).then(complete, fail); return; }
                if (d.length > r) d = d.subarray(0, r);
                pending.push(d); pendingBytes += d.length;
                if (pendingBytes >= WRITE_BATCH || room() <= 0) {
                  res.pause();
                  chain = chain.then(flush).then(() => { if (finished) return; if (room() <= 0) complete(); else res.resume(); }, fail);
                }
              });
              res.on('error', (e) => { chain.then(() => flush()).catch(() => { }).then(() => fail(e)); });
              const dropped = () => { chain.then(() => flush()).catch(() => { }).then(() => { if (g.done < len(g)) fail(new ResumeError('connection dropped', 'network')); else complete(); }); };
              res.on('aborted', dropped);
              res.on('close', dropped);
              res.on('end', dropped);
            });
          } finally {
            live.delete(handle);
            try { res.destroy(); } catch (e) { } try { req.destroy(); } catch (e) { }
          }
          attempt = 0;
        } catch (e) {
          if (aborted) throw aborted;
          const err = e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network');
          if (err.kind === 'fatal' || err.kind === 'unsupported' || err.kind === 'changed') throw err;
          if (!gotResponse && (err.refused || /ECONNRESET|ECONNREFUSED|socket hang up|EPIPE/i.test(String(err.message)))) noteRefusal(err, live.size);
          if (attempt >= maxAttempts) throw err;
          emit(`segment at ${g.start} retry ${attempt}: ${err.kind} ${err.message}`);
          if (err.kind === 'expired') await refreshUrl(ver);
          await sleep(Math.min(15000, retryDelayMs * attempt));
        }
      }
    };

    const worker = async (workerNo) => {
      for (;;) {
        if (aborted) throw aborted;
        if (failure) return;
        if (workerNo >= cap) return;
        const g = takeUnowned() || steal();
        if (!g) return;
        try { await fetchSegment(g, workerNo); } finally { if (g.done < len(g)) g.owner = null; }
      }
    };

    const n = Math.max(1, Number(streams) || 1);
    try {
      const results = await Promise.allSettled(Array.from({ length: n }, (_, k) => worker(k).catch((e) => { if (!failure) failure = e; throw e; })));
      const bad = results.find((r) => r.status === 'rejected');
      if (aborted) throw aborted;
      if (bad) throw bad.reason;
      // A stream retired because the server allows fewer connections may have left a segment for the others; sweep until nothing is left.
      for (let guard = 0; guard < 8 && segs.some((g) => g.done < len(g)) && !aborted && !failure; guard++) {
        const left = await Promise.allSettled(Array.from({ length: Math.max(1, cap) }, (_, k) => worker(k).catch((e) => { if (!failure) failure = e; throw e; })));
        const bad2 = left.find((r) => r.status === 'rejected');
        if (aborted) throw aborted;
        if (bad2) throw bad2.reason;
      }
    } finally {
      clearInterval(timer);
      for (const h of live) { try { h.res.destroy(); } catch (e) { } try { h.req.destroy(); } catch (e) { } }
      dirty = true; saveState();
      try { await fh.close(); } catch (e) { }
    }
    if (aborted) throw aborted;
    if (segs.some((g) => g.done < len(g))) throw new ResumeError('incomplete', 'network');
    try { fs.unlinkSync(outputPath); } catch (e) { }
    fs.renameSync(tempPath, outputPath);
    try { fs.unlinkSync(statePath); } catch (e) { }
    if (onProgress) { try { onProgress(total, total); } catch (e) { } }
    return total;
  };

  const run = async () => {
    // A Resume must never overlap the run it replaces (two writers on one file, two progress counters): stop it and wait.
    if (previous) { try { previous.abort('superseded'); } catch (e) { } try { await previous.promise; } catch (e) { } }
    if (aborted) throw aborted;
    if (!(expectedSize > 0)) throw new ResumeError('file size unknown', 'unsupported');
    try {
      return await runOnce(false);
    } catch (e) {
      // The server's file is no longer the one the saved progress belongs to: start that file over, once.
      if (e instanceof ResumeError && e.kind === 'changed' && !aborted) {
        emit('the file changed on the server since the last run: starting it over');
        try { fs.unlinkSync(statePath); } catch (e2) { }
        try { fs.unlinkSync(tempPath); } catch (e2) { }
        return await runOnce(true, false);
      }
      throw e;
    }
  };

  const promise = run();
  const abort = (reason) => {
    aborted = reason instanceof Error ? reason : new ResumeError(String(reason || 'aborted'), 'aborted');
    try { ctl.abort(); } catch (e) { }
    for (const h of live) { try { h.res.destroy(); } catch (e) { } try { h.req.destroy(); } catch (e) { } }
    if (wake) { try { wake(); } catch (e) { } }
  };
  const me = { promise, abort };
  activeByPath.set(outputPath, me);
  promise.then(() => { }, () => { }).then(() => { if (activeByPath.get(outputPath) === me) activeByPath.delete(outputPath); });
  return me;
}

module.exports = { segmentedDownload, probeRanges, TEMP_SUFFIX, STATE_SUFFIX, DEFAULT_CHUNK };
