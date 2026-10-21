const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { LISTS, normalizeBaseUrl, addReadList } = require('../komga');

function standIn(handlers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], type: req.headers['content-type'] || '', body: Buffer.concat(chunks).toString() });
      const h = handlers[`${req.method} ${req.url}`];
      if (!h) { res.statusCode = 404; return res.end(); }
      res.statusCode = h.status || 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(h.body || {}));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}
const XML = '<?xml version="1.0"?><ReadingList><Name>X</Name><Books><Book Series="A" Number="1" Year="2000"/></Books></ReadingList>';

test('addresses are normalised and unsafe ones refused', () => {
  assert.strictEqual(normalizeBaseUrl('localhost:25600'), 'http://localhost:25600');
  assert.strictEqual(normalizeBaseUrl('https://komga.example.com/'), 'https://komga.example.com');
  assert.strictEqual(normalizeBaseUrl('http://u:p@host'), null);
  assert.strictEqual(normalizeBaseUrl('file:///etc/passwd'), null);
  assert.strictEqual(normalizeBaseUrl(''), null);
});

test('every list names a .cbl file', () => {
  for (const [id, l] of Object.entries(LISTS)) assert.ok(/\.cbl$/.test(l.file), id);
  assert.deepStrictEqual(Object.keys(LISTS), ['marvel', 'dc', 'batman', 'daredevil', 'spiderman', 'superman']);
});

test('matches the file then creates the read list, with the key on both calls', async () => {
  const { server, seen, base } = await standIn({
    'POST /api/v1/readlists/match/comicrack': { body: { request: { name: 'X', ordered: true, bookIds: ['a', 'b', 'c'] }, errors: ['one gap'] } },
    'POST /api/v1/readlists': { status: 201, body: {} }
  });
  const r = await addReadList({ baseUrl: base, apiKey: 'k123', xml: XML, fileName: 'x.cbl' });
  server.close();
  assert.deepStrictEqual(r, { ok: true, count: 3, missing: 1 });
  assert.strictEqual(seen.length, 3);   // match, look for a list of the same name, create
  assert.ok(seen.every(s => s.key === 'k123'));
  assert.ok(seen[0].type.startsWith('multipart/form-data'));
  assert.ok(seen[0].body.includes('<ReadingList>'));
  assert.deepStrictEqual(JSON.parse(seen[2].body).bookIds, ['a', 'b', 'c']);
});

test('wrong key, empty match, existing list and a dead server each give a clear reason', async () => {
  let s = await standIn({ 'POST /api/v1/readlists/match/comicrack': { status: 401 } });
  assert.strictEqual((await addReadList({ baseUrl: s.base, apiKey: 'bad', xml: XML, fileName: 'x.cbl' })).reason, 'auth'); s.server.close();
  s = await standIn({ 'POST /api/v1/readlists/match/comicrack': { body: { request: { bookIds: [] }, errors: [] } } });
  assert.strictEqual((await addReadList({ baseUrl: s.base, apiKey: 'k', xml: XML, fileName: 'x.cbl' })).reason, 'nomatch'); s.server.close();
  s = await standIn({ 'POST /api/v1/readlists/match/comicrack': { body: { request: { bookIds: ['a'] } } }, 'POST /api/v1/readlists': { status: 400 } });
  assert.strictEqual((await addReadList({ baseUrl: s.base, apiKey: 'k', xml: XML, fileName: 'x.cbl' })).reason, 'exists'); s.server.close();
  const dead = await addReadList({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k', xml: XML, fileName: 'x.cbl', timeoutMs: 2000 });
  assert.strictEqual(dead.reason, 'unreachable');
});

test('a read list with the same name is replaced instead of failing', async () => {
  const { server, seen, base } = await standIn({
    'POST /api/v1/readlists/match/comicrack': { body: { request: { name: 'Marvel X', ordered: true, bookIds: ['n1', 'n2'] }, errors: [] } },
    'GET /api/v1/readlists?unpaged=true&search=Marvel%20X': { body: { content: [{ id: 'old1', name: 'marvel x' }, { id: 'other', name: 'Marvel X Extra' }] } },
    'PATCH /api/v1/readlists/old1': { status: 204 }
  });
  const r = await addReadList({ baseUrl: base, apiKey: 'k', xml: XML, fileName: 'x.cbl' });
  server.close();
  assert.deepStrictEqual(r, { ok: true, count: 2, missing: 0, replaced: true });
  assert.ok(!seen.some(s => s.method === 'POST' && s.url === '/api/v1/readlists'));
  assert.deepStrictEqual(JSON.parse(seen.find(s => s.method === 'PATCH').body).bookIds, ['n1', 'n2']);
});

test('a failed lookup still falls back to a normal create', async () => {
  const { server, seen, base } = await standIn({
    'POST /api/v1/readlists/match/comicrack': { body: { request: { name: 'Y', bookIds: ['a'] }, errors: [] } },
    'GET /api/v1/readlists?unpaged=true&search=Y': { status: 500 },
    'POST /api/v1/readlists': { status: 201 }
  });
  const r = await addReadList({ baseUrl: base, apiKey: 'k', xml: XML, fileName: 'x.cbl' });
  server.close();
  assert.strictEqual(r.ok, true);
  assert.ok(!r.replaced);
});
