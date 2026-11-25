const test = require('node:test'); const assert = require('node:assert');
const { createApiClient, ApiError } = require('../native/apiClient');

const reply = (status, data, headers = {}) => ({ status, ok: status < 400, headers: { get: (k) => headers[k.toLowerCase()] }, json: async () => data, arrayBuffer: async () => Buffer.from(data || 'x') });
const mk = (impl, extra = {}) => { const calls = []; const c = createApiClient({ getToken: () => 'tok', version: '5.23.0', sleep: async () => { }, fetchImpl: async (u, o) => { calls.push({ u, o }); return impl(u, o, calls.length); }, ...extra }); return { c, calls }; };

test('sends the Bearer token and the versioned user agent', async () => {
  const { c, calls } = mk(() => reply(200, { ok: 1 }));
  await c.get('/api/categories');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer tok');
  assert.match(calls[0].o.headers['User-Agent'], /^ARMGDDN-Companion\/5\.23\.0$/);
});
test('caches GETs and shares one call between identical requests in flight', async () => {
  const { c, calls } = mk(async () => reply(200, { n: 1 }));
  await Promise.all([c.get('/api/a'), c.get('/api/a'), c.get('/api/a')]);
  await c.get('/api/a');
  assert.equal(calls.length, 1);
  await c.get('/api/a', { fresh: true });
  assert.equal(calls.length, 2);
});
test('never has more than maxConcurrent requests open', async () => {
  let open = 0, peak = 0;
  const { c } = mk(async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open--; return reply(200, {}); }, { maxConcurrent: 3 });
  await Promise.all(Array.from({ length: 20 }, (_, i) => c.get('/api/x' + i)));
  assert.equal(peak, 3);
});
test('429 waits and retries, 401 does not retry and reports auth', async () => {
  let n = 0;
  const a = mk(() => (++n === 1 ? reply(429, {}, { 'retry-after': '1' }) : reply(200, { ok: 1 })));
  assert.deepEqual(await a.c.get('/api/r'), { ok: 1 }); assert.equal(a.calls.length, 2);
  const b = mk(() => reply(401, { error: 'Sign in again' }));
  await assert.rejects(b.c.get('/api/r'), (e) => e instanceof ApiError && e.kind === 'auth');
  assert.equal(b.calls.length, 1);
});
test('a dropped connection on GET is retried once, on POST it is not', async () => {
  let n = 0;
  const a = mk(() => { if (++n === 1) throw new Error('reset'); return reply(200, { ok: 1 }); });
  assert.deepEqual(await a.c.get('/api/r'), { ok: 1 });
  const b = mk(() => { throw new Error('reset'); });
  await assert.rejects(b.c.post('/api/w', {}), (e) => e.kind === 'network'); assert.equal(b.calls.length, 1);
});
test('a write clears the cached reads it names', async () => {
  const { c, calls } = mk(async () => reply(200, {}));
  await c.get('/api/watchlist'); await c.post('/api/watchlist', { a: 1 }, { invalidate: ['/api/watchlist'] }); await c.get('/api/watchlist');
  assert.equal(calls.filter((x) => x.o.method === 'GET').length, 2);
});
test('images are cached in memory and limited by bytes', async () => {
  const { c, calls } = mk(async () => reply(200, 'x'.repeat(40)), { imageCacheBytes: 160 });   // room for four 40-byte images
  await c.image('/api/art-proxy?i=1'); await c.image('/api/art-proxy?i=1');
  assert.equal(calls.length, 1);
  for (const i of [2, 3, 4, 5]) await c.image('/api/art-proxy?i=' + i);
  assert.equal(calls.length, 5);
  await c.image('/api/art-proxy?i=1');   // evicted once the fifth arrived
  assert.equal(calls.length, 6);
});
test('no token means an auth error without calling the site', async () => {
  const calls = []; const c = createApiClient({ getToken: () => null, fetchImpl: async () => { calls.push(1); } });
  await assert.rejects(c.get('/api/x'), (e) => e.kind === 'auth'); assert.equal(calls.length, 0);
});

// Nov 25 2026 review: a request the site never answered waited for ever and kept its slot, so a few hangs froze every page on "Loading...".
test('a request the site never answers gives up, retries a GET once, and frees its slot', async () => {
  let n = 0;
  const hang = () => new Promise(() => { });
  const a = mk(() => (++n <= 2 ? hang() : reply(200, { ok: 1 })), { requestTimeoutMs: 20, maxConcurrent: 1 });
  await assert.rejects(a.c.get('/api/slow'), (e) => e instanceof ApiError && e.kind === 'timeout' && /too long/.test(e.message));
  assert.equal(a.calls.length, 2, 'one retry for a GET');
  assert.deepEqual(await a.c.get('/api/next'), { ok: 1 }, 'the only slot was given back');
  const b = mk(() => hang(), { requestTimeoutMs: 20 });
  await assert.rejects(b.c.post('/api/w', {}), (e) => e.kind === 'timeout');
  assert.equal(b.calls.length, 1, 'a POST is never sent twice');
});
test('the time limit aborts the real fetch, and a caller cancel still reads as cancelled', async () => {
  let seen = null;
  const a = mk((u, o) => { seen = o.signal; return new Promise(() => { }); }, { requestTimeoutMs: 20 });
  await assert.rejects(a.c.post('/api/w', {}));
  assert.ok(seen && seen.aborted, 'the hung request is aborted, not left open');
  const ac = new AbortController();
  const b = mk((u, o) => new Promise((_, reject) => { const no = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }; if (o.signal.aborted) no(); else o.signal.addEventListener('abort', no); }), { requestTimeoutMs: 5000 });
  const g = b.c.get('/api/x', { signal: ac.signal });
  ac.abort();
  await assert.rejects(g, (e) => e.kind === 'aborted');
});
