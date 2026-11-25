'use strict';
// Talks to the ARMGDDN site for the native browser (runs in the main process, never in the page).
// - Bearer token from getToken(), User-Agent with the app version (the site learns the version from it).
// - At most `maxConcurrent` requests at a time (a cover grid would otherwise open hundreds and hit the site's 200/min limit).
// - GET results cached for ttlMs, identical requests in flight at the same time share one call.
// - 429 waits for Retry-After and retries; one retry for a 5xx or a dropped connection on GET. 401 never retries.
// - Images (covers) are fetched the same way and kept in a small byte-limited memory cache.

class ApiError extends Error {
  constructor(message, kind, status, body) { super(message); this.kind = kind; this.status = status || 0; this.body = body; }
}

// A request the site never answers used to wait for ever: the page sat on "Loading..." and the request kept one of the maxConcurrent slots, so
// after a few such hangs every later call queued behind them and the whole window stopped loading anything (Nov 25 2026 review). Each try now
// gives up when no answer has started after requestTimeoutMs; a GET then gets its one retry like a dropped connection.
const REQUEST_TIMEOUT_MS = 30000;

function createApiClient({ getToken, deviceFp = '', baseUrl = 'https://www.armgddnbrowser.com', fetchImpl, version = '0.0.0', maxConcurrent = 6, imageCacheBytes = 64 * 1024 * 1024, maxCacheEntries = 200, sleep, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map();            // key -> { at, ttl, value }
  const inflight = new Map();         // key -> promise
  const images = new Map();           // path -> { buf, type }  (insertion order = recency)
  let imageBytes = 0;
  let running = 0;
  const queue = [];
  const stats = { requests: 0, cacheHits: 0, retries: 0, imageFetches: 0, imageHits: 0 };

  const slot = () => new Promise((resolve) => {
    const go = () => { running++; resolve(() => { running--; const n = queue.shift(); if (n) n(); }); };
    if (running < maxConcurrent) go(); else queue.push(go);
  });

  async function send(method, path, { body, signal, raw, headers: extra, timeoutMs } = {}) {
    const token = getToken();
    if (!token) throw new ApiError('Not signed in', 'auth', 401);
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': `ARMGDDN-Companion/${version}`, Accept: raw ? '*/*' : 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (deviceFp) headers['X-ARMGDDN-Device'] = deviceFp;      // install ID fingerprint (deviceId.js)
    if (extra) Object.assign(headers, extra);
    let attempt = 0;
    for (;;) {
      const release = await slot();
      let res;
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      let timer = null, timedOut = false;
      try {
        stats.requests++;
        const call = doFetch(baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal });
        const late = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; try { ctl.abort(); } catch (e2) { } reject(new Error('timeout')); }, timeoutMs || requestTimeoutMs); });
        if (call && typeof call.catch === 'function') call.catch(() => { });   // the losing side of the race must not surface as an unhandled rejection
        res = await Promise.race([call, late]);
      } catch (e) {
        release();
        if (timedOut) {
          if (method === 'GET' && attempt < 1) { attempt++; stats.retries++; continue; }
          throw new ApiError('The site took too long to answer. Try again in a minute.', 'timeout', 0);
        }
        if (e && e.name === 'AbortError') throw new ApiError('Cancelled', 'aborted', 0);
        if (method === 'GET' && attempt < 1) { attempt++; stats.retries++; await wait(500); continue; }
        throw new ApiError(e && e.message ? e.message : 'Network error', 'network', 0);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      release();
      if (res.status === 429 && attempt < 2) {
        attempt++; stats.retries++;
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await wait(Math.min(10000, (Number.isFinite(ra) && ra > 0 ? ra : 2) * 1000));
        continue;
      }
      if (res.status >= 500 && method === 'GET' && attempt < 1) { attempt++; stats.retries++; await wait(500); continue; }
      if (raw) {
        if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status === 401 ? 'auth' : 'http', res.status);
        return res;
      }
      let data = null;
      try { data = await res.json(); } catch (e) { }
      if (res.status === 401) throw new ApiError((data && data.error) || 'Sign in again', 'auth', 401, data);
      if (res.status === 403) throw new ApiError((data && data.error) || 'Not allowed', 'forbidden', 403, data);
      if (!res.ok) throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status === 429 ? 'rate' : 'http', res.status, data);
      return data;
    }
  }

  // Every folder, read-me and text file the member opens used to stay in memory for the whole session, long after it had expired
  // (crash reports from Nov 23-24 showed the app at 1.0-1.4 GB). Expired answers are dropped, and at most
  // maxCacheEntries are kept (oldest first out).
  function trimCache() {
    if (cache.size <= maxCacheEntries) return;
    const t = Date.now();
    for (const [k, v] of cache) if (t - v.at >= v.ttl) cache.delete(k);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  }

  function get(path, { ttlMs = 30000, signal, fresh = false, headers } = {}) {
    const key = 'GET ' + path;
    const hit = cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < hit.ttl) { stats.cacheHits++; return Promise.resolve(hit.value); }
    if (inflight.has(key)) return inflight.get(key);
    const p = send('GET', path, { signal, headers }).then((v) => { if (ttlMs > 0) { cache.delete(key); cache.set(key, { at: Date.now(), ttl: ttlMs, value: v }); trimCache(); } return v; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function write(method, path, body, { invalidate = [], timeoutMs } = {}) {
    const out = await send(method, path, { body, timeoutMs });
    for (const prefix of invalidate) for (const k of [...cache.keys()]) if (k.startsWith('GET ' + prefix)) cache.delete(k);
    return out;
  }

  async function image(path, { signal } = {}) {
    const hit = images.get(path);
    if (hit) { images.delete(path); images.set(path, hit); stats.imageHits++; return hit; }
    const key = 'IMG ' + path;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      stats.imageFetches++;
      const res = await send('GET', path, { signal, raw: true });
      const buf = Buffer.from(await res.arrayBuffer());
      const entry = { buf, type: (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/jpeg' };
      if (buf.length <= imageCacheBytes / 4) {
        images.set(path, entry); imageBytes += buf.length;
        while (imageBytes > imageCacheBytes && images.size > 1) { const [k, v] = images.entries().next().value; images.delete(k); imageBytes -= v.buf.length; }
      }
      return entry;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // A file the site builds on request (an export list): fetched whole, never cached.
  async function file(path, { signal, timeoutMs } = {}) {
    const res = await send('GET', path, { signal, raw: true, timeoutMs });
    return { buf: Buffer.from(await res.arrayBuffer()), type: (res.headers && res.headers.get && res.headers.get('content-type')) || 'application/octet-stream', disposition: (res.headers && res.headers.get && res.headers.get('content-disposition')) || '' };
  }

  return {
    get, image, file, stats, cacheSize: () => cache.size,
    post: (path, body, opts) => write('POST', path, body, opts),
    put: (path, body, opts) => write('PUT', path, body, opts),
    del: (path, body, opts) => write('DELETE', path, body, opts),
    clearCache: () => { cache.clear(); },
  };
}

// A cache of fetched files kept under a byte budget and an entry limit, least recently used out first. Covers hosted elsewhere used a
// 300-entry cache with no byte limit (each up to 2 MB, so up to about 600 MB in the main process).
function createByteCache({ maxBytes, maxEntries }) {
  const m = new Map();
  let bytes = 0;
  const sizeOf = (v) => (v && v.buf && v.buf.length) || 0;
  return {
    get(k) { const v = m.get(k); if (v) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) {
      const n = sizeOf(v);
      if (n > maxBytes) return;
      if (m.has(k)) { bytes -= sizeOf(m.get(k)); m.delete(k); }
      m.set(k, v); bytes += n;
      while (m.size && (bytes > maxBytes || m.size > maxEntries)) { const [ok, ov] = m.entries().next().value; m.delete(ok); bytes -= sizeOf(ov); }
    },
    get size() { return m.size; },
    get bytes() { return bytes; },
  };
}

module.exports = { createApiClient, createByteCache, ApiError, REQUEST_TIMEOUT_MS };
