// Multi-stream resumable HTTP downloader for big files.
//
// rclone copyurl can fetch a file in 16 parallel streams, but when it is stopped (Pause, a crash, a dropped
// link) it throws the half-written file away, so Resume starts again from zero. This downloader keeps the
// parallel speed and remembers its place:
//   - the file is cut into fixed-size chunks; a pool of streams each downloads whole chunks with Range requests
//   - bytes are written at their own offset into "<file>.armdl" (never under the final name, so a half-done
//     file can not be mistaken for a finished one)
//   - "<file>.armseg" records how many bytes of every chunk are on disk, saved about once a second and on stop
//   - Resume (or a retry after a failure) reads that record and fetches only what is missing
//   - when every chunk is complete the temporary file is renamed to the final name
const fs = require('fs');
const { EventEmitter } = require('events');
const { ResumeError } = require('./resumeDownload');
const { openAuto } = require('./httpOpen');

const TEMP_SUFFIX = '.armdl';
const STATE_SUFFIX = '.armseg';
const DEFAULT_CHUNK = 32 * 1024 * 1024;
const WRITE_BATCH = 1024 * 1024;
const STATE_VERSION = 1;

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

// The chunk size is whatever the earlier run used, so Pause then Resume survives a change in the stream count.
function loadState(statePath, tempPath, total) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const chunk = Number(s && s.chunk);
    if (s && s.v === STATE_VERSION && s.total === total && Number.isInteger(chunk) && chunk >= 1024 * 1024 && Array.isArray(s.done)
      && s.done.length === Math.ceil(total / chunk) && fs.existsSync(tempPath)) {
      return { chunk, done: s.done.map((d, i) => Math.max(0, Math.min(Number(d) || 0, Math.min(chunk, total - i * chunk)))) };
    }
  } catch (e) { }
  return null;
}

// One long request per stream (like rclone's own multi-thread copy) instead of many short ones: the streams then do not all
// reconnect to the server at the same moment, which a busy download host answers with long stalls.
function planChunk(total, streams) {
  const mib = 1024 * 1024;
  return Math.max(DEFAULT_CHUNK, Math.ceil(total / Math.max(1, streams) / mib) * mib);
}

// Returns a controller { promise, abort(reason) } like resumeDownload().
//   url          first URL to try
//   expectedSize bytes (required: the chunk plan is built from it)
//   streams      parallel connections
//   getFreshUrl  async () => url, called when a link has expired
//   onProgress   (bytesOnDisk, total) => void
// Seconds until a signed link expires, or null when it carries no expiry.
const EXPIRY_MARGIN_S = 90;
function linkSecondsLeft(link, now = Date.now()) {
  try {
    const exp = Number(new URL(String(link)).searchParams.get('exp'));
    return Number.isFinite(exp) && exp > 1e9 ? exp - now / 1000 : null;
  } catch (e) { return null; }
}
// Expiry stated by the site (epoch seconds or milliseconds, or an ISO date) as milliseconds, or null.
function expiryMs(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : Date.parse(String(v)));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e11 ? n : n * 1000;
}
// A download source: where to ask, with which extra headers, and until when it works. A plain link string is a source with nothing extra.
function asSource(x) {
  if (!x) return null;
  if (typeof x === 'string') return { url: x, headers: {}, expiresAtMs: null, fallback: null };
  if (!x.url) return null;
  return { url: String(x.url), headers: x.headers && typeof x.headers === 'object' ? x.headers : {}, expiresAtMs: expiryMs(x.expiresAt), fallback: asSource(x.fallback) };
}
const activeByPath = new Map();     // outputPath -> controller of the run that owns that file right now

// A problem with the PC's own disk (full, read-only, no permission) is not a network problem: retrying cannot fix it. Until 6.12 these
// were wrapped as 'network', so every stream retried ~11 times (176 retries in two minutes) and the member was told the download "stalled"
// (engine reports 2026-11-18..25: 22 failed runs from 4 members, 1,861 ENOSPC retries). They now end the run at once as kind 'disk'.
const DISK_CODES = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EACCES', 'EPERM', 'EFBIG']);
function diskError(e, stage) {
  const code = e && e.code ? String(e.code) : '';
  const err = new ResumeError(`cannot ${stage === 'finish' ? 'save the finished file' : 'write file'}: ${e && e.message ? e.message : String(e)}`, 'disk');
  err.code = code; err.stage = stage;
  return err;
}
const isDiskError = (e) => !!(e && e.code && DISK_CODES.has(String(e.code)));

// Windows: antivirus or the search indexer often holds a just-written file for a moment, so renaming it fails with EPERM/EBUSY/EACCES.
// That failed the whole download at 100% (10 runs from 9 members in a week). Try again for a few seconds before giving up.
const RENAME_BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
async function renameWithRetry(from, to, tries = 8, delayMs = 250) {
  for (let i = 1; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= tries || !RENAME_BUSY.has(String(e && e.code))) throw diskError(e, 'finish');
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}

function segmentedDownload(opts) {
  const {
    outputPath, expectedSize = 0, streams = 4, getFreshUrl, onProgress, headers = {},
    stallMs = 60 * 1000, maxAttempts = 12, retryDelayMs = 2000, chunkSize = 0, saveEveryMs = 1000, maxBytesPerSec = 0, onEvent, tlsOptions
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
  const run = async () => {
    // A Resume must never overlap the run it replaces (two writers on one file, two progress counters): stop it and wait.
    if (previous) { try { previous.abort('superseded'); } catch (e) { } try { await previous.promise; } catch (e) { } }
    if (aborted) throw aborted;
    if (!(expectedSize > 0)) throw new ResumeError('file size unknown', 'unsupported');
    const total = expectedSize;
    const resumed = loadState(statePath, tempPath, total);
    const chunk = resumed ? resumed.chunk : (chunkSize > 0 ? Math.max(1024 * 1024, chunkSize) : planChunk(total, streams));
    const nChunks = Math.ceil(total / chunk);
    const lenOf = (i) => Math.min(chunk, total - i * chunk);

    let done = resumed ? resumed.done : null;
    let fh;
    try {
      if (!done) {
        done = new Array(nChunks).fill(0);
        try { fs.unlinkSync(statePath); } catch (e) { }
        fs.writeFileSync(tempPath, '');
      }
      fh = await fs.promises.open(tempPath, 'r+');
    } catch (e) {
      throw isDiskError(e) ? diskError(e, 'write') : e;
    }

    let dirty = false;
    const saveState = () => {
      if (!dirty) return;
      dirty = false;
      try {
        const tmp = statePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ v: STATE_VERSION, total, chunk, done }));
        fs.renameSync(tmp, statePath);
      } catch (e) { dirty = true; }
    };
    const onDisk = () => done.reduce((a, b) => a + b, 0);
    let sinceReport = 0;
    const report = (force) => {
      if (!onProgress) return;
      if (force || sinceReport >= 256 * 1024) { sinceReport = 0; try { onProgress(onDisk(), total); } catch (e) { } }
    };

    let src = asSource(opts.source) || asSource(opts.url);
    let url = src.url;
    let urlVersion = 0;
    let onFallback = false;
    const refusedRenewals = new Set();   // link versions that were refused straight after being renewed
    let refreshing = null;
    // Signed links carry their own expiry (exp, in seconds). Renew one shortly before it runs out instead of waiting for the server to
    // refuse it, which used to cost a burst of failed requests from every stream. A wrong PC clock cannot cause a loop: renewing is
    // skipped when the link was renewed in the last 30 seconds.
    let lastRenewAt = 0;
    const renewBeforeExpiry = async () => {
      if (typeof getFreshUrl !== 'function') return;
      if (refreshing) { await refreshing; return; }       // another stream is already renewing: wait for the new source instead of using the old one
      const left = src.expiresAtMs != null ? (src.expiresAtMs - Date.now()) / 1000 : linkSecondsLeft(url);
      if (left === null || left > EXPIRY_MARGIN_S || Date.now() - lastRenewAt < 30000) return;
      lastRenewAt = Date.now();
      emit(`link renewed ${Math.max(0, Math.round(left))}s before it expires`);
      await refreshUrl(urlVersion);
    };
    const refreshUrl = (seenVersion) => {
      // One refresh at a time; a stream that failed on an old link just picks up the newer one.
      if (seenVersion !== urlVersion) return Promise.resolve();
      if (!refreshing) {
        refreshing = (async () => {
          try {
            if (typeof getFreshUrl === 'function') {
              const f = asSource(await getFreshUrl({ onFallback }));
              if (f) {
                // A fresh answer replaces the source, except that the fallback already in use is kept if the site sends none.
                src = { ...f, fallback: f.fallback || (onFallback ? null : src.fallback) };
                url = src.url;
              }
            }
          } finally { urlVersion++; refreshing = null; }
        })();
      }
      return refreshing;
    };

    let failure = null;
    const next = (() => { let i = 0; return () => { while (i < nChunks && done[i] >= lenOf(i)) i++; return i < nChunks ? i++ : -1; }; })();
    const timer = setInterval(saveState, saveEveryMs);

    const fetchChunk = async (i) => {
      let attempt = 0;
      while (done[i] < lenOf(i)) {
        if (aborted) throw aborted;
        if (failure) return;
        const start = i * chunk + done[i];
        const end = i * chunk + lenOf(i) - 1;
        try { await renewBeforeExpiry(); } catch (e) { }
        const ver = urlVersion;
        attempt++;
        try {
          const openedAt = Date.now();
          const { req, res } = await openAuto(url, { ...headers, ...src.headers, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` }, stallMs, { signal: ctl.signal, tls: tlsOptions });
          const handle = { req, res };
          live.add(handle);
          try {
            const code = res.statusCode || 0;
            if (code === 401 || code === 403 || code === 410) { res.resume(); throw new ResumeError(`HTTP ${code}`, 'expired', code); }
            if (code >= 500 || code === 429 || code === 408) { res.resume(); throw new ResumeError(`HTTP ${code}`, 'network', code); }
            if (code === 200 && start > 0) { res.resume(); throw new ResumeError('server stopped honouring Range', 'fatal', code); }
            if (code !== 206 && code !== 200) { res.resume(); throw new ResumeError(`HTTP ${code}`, 'fatal', code); }
            emit(`chunk ${i} HTTP ${code} from byte ${start} (${Math.round((Date.now() - openedAt) / 100) / 10}s to first response)`);
            const cr = /^bytes (\d+)-(\d+)\/(\d+)/.exec(String(res.headers['content-range'] || ''));
            if (cr && (Number(cr[3]) !== total)) throw new ResumeError('file size changed on the server', 'fatal', code);
            if (cr && Number(cr[1]) !== start) throw new ResumeError('server answered a different range', 'fatal', code);

            let pending = []; let pendingBytes = 0;
            let writeErr = null;     // a disk problem seen by any flush of this request: it wins over the network error that follows it
            // Every flush waits for the ones before it, including a disk write that is still running. Without that, a dropped connection could
            // start the retry while the last write was in flight (a slow disk, antivirus scanning), and the retry would restart from a stale
            // position and write over the same bytes.
            let flushQueue = Promise.resolve();
            const flush = () => { const p = flushQueue.then(flushNow); flushQueue = p.catch(() => { }); return p; };
            const flushNow = async () => {
              if (!pendingBytes) return;
              const buf = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
              pending = []; pendingBytes = 0;
              if (maxBytesPerSec > 0) {
                const now = Date.now();
                limiterSlot = Math.max(limiterSlot, now) + (buf.length / maxBytesPerSec) * 1000;
                const wait = limiterSlot - now - 500;     // allow a half-second burst
                if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 10000)));
              }
              const pos = i * chunk + done[i];
              try { await fh.write(buf, 0, buf.length, pos); } catch (e) { const de = isDiskError(e) ? diskError(e, 'write') : e; if (de.kind === 'disk') writeErr = de; throw de; }
              done[i] += buf.length; dirty = true; sinceReport += buf.length; report(false);
            };
            await new Promise((resolve, reject) => {
              let want = lenOf(i) - done[i];
              let got = 0; let chain = Promise.resolve(); let finished = false;
              const fail = (e) => { if (finished) return; finished = true; reject(writeErr || (e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network'))); };
              res.on('data', (d) => {
                if (finished) return;
                if (got + d.length > want) d = d.subarray(0, want - got);
                got += d.length; pending.push(d); pendingBytes += d.length;
                if (pendingBytes >= WRITE_BATCH || got >= want) {
                  res.pause();
                  chain = chain.then(flush).then(() => { if (!finished) res.resume(); if (got >= want && !finished) { finished = true; resolve(); } }, fail);
                }
              });
              res.on('error', (e) => { chain.then(() => flush()).catch(() => { }).then(() => fail(e)); });
              const dropped = () => { chain.then(() => flush()).catch(() => { }).then(() => { if (writeErr) fail(writeErr); else if (got < want) fail(new ResumeError('connection dropped', 'network')); else if (!finished) { finished = true; resolve(); } }); };
              res.on('aborted', dropped);
              res.on('close', dropped);
              res.on('end', dropped);
            });
          } finally {
            live.delete(handle);
            try { res.destroy(); } catch (e) { } try { req.destroy(); } catch (e) { }
          }
          attempt = 0; refusedRenewals.clear();
        } catch (e) {
          if (aborted) throw aborted;
          if (failure) return;      // another stream already ended the run (stopOthers cut this request): not a retry of its own
          const err = e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network');
          if (err.kind === 'fatal' || err.kind === 'unsupported' || err.kind === 'disk') throw err;
          if (attempt >= maxAttempts) throw err;
          emit(`chunk ${i} retry ${attempt}: ${err.kind} ${err.message}`);
          if (err.kind === 'expired') {
            // A refusal of a link we had just renewed counts once per renewal (not once per stream). Two renewals in a row refused means the
            // source itself is refusing (a quota, a revoked account), so use the fallback source if there is one.
            if (ver > 0 && ver === urlVersion) refusedRenewals.add(ver);
            if (refusedRenewals.size >= 2 && src.fallback && !onFallback) {
              src = { ...src.fallback, fallback: null }; url = src.url; onFallback = true; urlVersion++; refusedRenewals.clear();
              emit('switched to the fallback source');
            } else {
              // Asking for a fresh link can itself fail (the site is busy, the PC is offline for a moment). That used to escape this loop as a
              // plain error and fail the whole download on the first try (17 runs from 4 members in a week). It now counts as one more
              // attempt, like any other failed request.
              try { await refreshUrl(ver); } catch (eFresh) { emit(`chunk ${i} fresh link failed: ${eFresh && eFresh.message ? eFresh.message : String(eFresh)}`); }
            }
          }
          await sleep(Math.min(15000, retryDelayMs * attempt));
        }
      }
    };

    const worker = async () => {
      for (;;) {
        if (aborted) throw aborted;
        if (failure) return;
        const i = next();
        if (i < 0) return;
        await fetchChunk(i);
      }
    };

    const n = Math.max(1, Math.min(Number(streams) || 1, nChunks));
    try {
      // Once one stream has failed for good, the others stop too: each stream holds one long request (planChunk), so waiting for them to
      // finish their ranges kept a failed download "running" for minutes. Their bytes so far are flushed and kept for the next try.
      const stopOthers = () => { for (const h of live) { try { h.res.destroy(); } catch (e) { } try { h.req.destroy(); } catch (e) { } } if (wake) { try { wake(); } catch (e) { } } };
      const results = await Promise.allSettled(Array.from({ length: n }, () => worker().catch((e) => { if (!failure) { failure = e; stopOthers(); } throw e; })));
      const bad = results.find((r) => r.status === 'rejected');
      if (aborted) throw aborted;
      if (bad) throw bad.reason;
    } finally {
      clearInterval(timer);
      for (const h of live) { try { h.res.destroy(); } catch (e) { } try { h.req.destroy(); } catch (e) { } }
      dirty = true; saveState();
      try { await fh.close(); } catch (e) { }
    }
    if (aborted) throw aborted;
    if (done.some((d, i) => d < lenOf(i))) throw new ResumeError('incomplete', 'network');
    try { fs.unlinkSync(outputPath); } catch (e) { }
    await renameWithRetry(tempPath, outputPath, opts.renameTries, opts.renameDelayMs);
    try { fs.unlinkSync(statePath); } catch (e) { }
    if (onProgress) { try { onProgress(total, total); } catch (e) { } }
    return total;
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

module.exports = { segmentedDownload, probeRanges, linkSecondsLeft, expiryMs, asSource, renameWithRetry, TEMP_SUFFIX, STATE_SUFFIX, DEFAULT_CHUNK };
