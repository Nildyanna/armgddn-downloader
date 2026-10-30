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
const activeByPath = new Map();     // outputPath -> controller of the run that owns that file right now

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
    if (!done) {
      done = new Array(nChunks).fill(0);
      try { fs.unlinkSync(statePath); } catch (e) { }
      fs.writeFileSync(tempPath, '');
    }
    const fh = await fs.promises.open(tempPath, 'r+');

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
    const next = (() => { let i = 0; return () => { while (i < nChunks && done[i] >= lenOf(i)) i++; return i < nChunks ? i++ : -1; }; })();
    const timer = setInterval(saveState, saveEveryMs);

    const fetchChunk = async (i) => {
      let attempt = 0;
      while (done[i] < lenOf(i)) {
        if (aborted) throw aborted;
        if (failure) return;
        const start = i * chunk + done[i];
        const end = i * chunk + lenOf(i) - 1;
        const ver = urlVersion;
        attempt++;
        try {
          const openedAt = Date.now();
          const { req, res } = await openAuto(url, { ...headers, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` }, stallMs, { signal: ctl.signal, tls: tlsOptions });
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
            const flush = async () => {
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
              await fh.write(buf, 0, buf.length, pos);
              done[i] += buf.length; dirty = true; sinceReport += buf.length; report(false);
            };
            await new Promise((resolve, reject) => {
              let want = lenOf(i) - done[i];
              let got = 0; let chain = Promise.resolve(); let finished = false;
              const fail = (e) => { if (finished) return; finished = true; reject(e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network')); };
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
              const dropped = () => { chain.then(() => flush()).catch(() => { }).then(() => { if (got < want) fail(new ResumeError('connection dropped', 'network')); else if (!finished) { finished = true; resolve(); } }); };
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
          if (err.kind === 'fatal' || err.kind === 'unsupported') throw err;
          if (attempt >= maxAttempts) throw err;
          emit(`chunk ${i} retry ${attempt}: ${err.kind} ${err.message}`);
          if (err.kind === 'expired') await refreshUrl(ver);
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
      const results = await Promise.allSettled(Array.from({ length: n }, () => worker().catch((e) => { if (!failure) failure = e; throw e; })));
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
    fs.renameSync(tempPath, outputPath);
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

module.exports = { segmentedDownload, probeRanges, TEMP_SUFFIX, STATE_SUFFIX, DEFAULT_CHUNK };
