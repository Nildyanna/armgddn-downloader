const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { LISTS, normalizeBaseUrl, addReadList, isValidListId } = require('../komga');

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
  assert.deepStrictEqual(r, { ok: true, count: 3, missing: 1, ambiguous: 0 });
  assert.strictEqual(seen.length, 4);   // match, search for a list of the same name, check the full set, create
  assert.ok(seen.every(s => s.key === 'k123'));
  assert.ok(seen[0].type.startsWith('multipart/form-data'));
  assert.ok(seen[0].body.includes('<ReadingList>'));
  assert.deepStrictEqual(JSON.parse(seen[3].body).bookIds, ['a', 'b', 'c']);
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
  assert.deepStrictEqual(r, { ok: true, count: 2, missing: 0, ambiguous: 0, replaced: true });
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

test('list ids: any slug the site may send is fine, anything else is refused', () => {
  for (const ok of ['marvel', 'fantastic-four-collection', 'x-men-and-friends', 'a1']) assert.ok(isValidListId(ok), ok);
  for (const bad of ['', 'Marvel', '../x', 'a b', '-a', 'a-', 'a--b', 'x'.repeat(61), null, 5]) assert.ok(!isValidListId(bad), String(bad));
});

// What Komga 1.28 really answers (captured from a real server, trimmed): candidates per book, the client chooses.
const modern = (requests) => ({ readListMatch: { name: 'Probe list', errorCode: '' }, requests });
const one = (seriesId, title, releaseDate, books) => ({ series: { seriesId, title, releaseDate }, books });
const XML3 = '<?xml version="1.0"?><ReadingList><Name>Probe list</Name><Books>' +
  '<Book Series="Daredevil" Number="1" Volume="1964" Year="1964"/><Book Series="Daredevil" Number="2" Year="1964"/><Book Series="Nope" Number="1"/><Book Series="Batman" Number="5"/></Books></ReadingList>';

test('Komga 1.28 answer: the right series is chosen by year, extras are skipped, unknown and unclear books are counted, nothing is guessed', () => {
  const { chooseFromRequests } = require('../komga');
  const m = modern([
    { request: { series: ['Daredevil (1964)', 'Daredevil'], number: '1' }, matches: [
      one('s2016', 'Daredevil', '2016-03-31', [{ bookId: 'b2016', number: '1', title: 'Daredevil by Charles Soule v01' }]),
      one('s1964', 'Daredevil', '1964-04-01', [
        { bookId: 'bm1', number: '1', title: 'Daredevil #-1: A Time To Say Farewell' },
        { bookId: 'b1', number: '1', title: 'Daredevil #1: The Origin of Daredevil' },
        { bookId: 'bann', number: '1', title: 'Daredevil Annual #1: Electro' }]) ] },
    { request: { series: ['Daredevil'], number: '2' }, matches: [ one('sA', 'Daredevil', '1964-04-01', [{ bookId: 'b2', number: '2', title: 'Daredevil #2' }]), one('sB', 'Daredevil', '2016-03-31', [{ bookId: 'b2x', number: '2', title: 'x' }]) ] },
    { request: { series: ['Nope'], number: '1' }, matches: [] },
    { request: { series: ['Batman'], number: '5' }, matches: [ one('sBat', 'Batman', '1940-04-25', [{ bookId: 'bb5', number: '5', title: 'Batman #5' }]) ] }
  ]);
  const r = chooseFromRequests(XML3, m);
  // #1: two series, Volume 1964 picks the 1964 one, and "#1:" beats "#-1:" and the annual. #2: two series and only Year=1964 - one 1964 series, so also taken.
  assert.deepStrictEqual(r.bookIds, ['b1', 'b2', 'bb5']);
  assert.strictEqual(r.missing, 1); assert.strictEqual(r.ambiguous, 0); assert.strictEqual(r.name, 'Probe list');
});

test('Komga 1.28 answer: several series and no year to tell them apart is left out, never guessed', () => {
  const { chooseFromRequests } = require('../komga');
  const xml = '<ReadingList><Name>L</Name><Books><Book Series="Daredevil" Number="1" Year="2000"/></Books></ReadingList>';
  const m = modern([{ request: { series: ['Daredevil'], number: '1' }, matches: [ one('a', 'Daredevil', '2016-03-31', [{ bookId: 'x', number: '1', title: 'Daredevil #1' }]), one('b', 'Daredevil', '1964-04-01', [{ bookId: 'y', number: '1', title: 'Daredevil #1' }]) ] }]);
  const r = chooseFromRequests(xml, m);
  assert.deepStrictEqual(r.bookIds, []); assert.strictEqual(r.ambiguous, 1);
});

test('adding against a Komga 1.28 style server creates the list from the chosen books; an unclear list explains itself', async () => {
  const good = modern([{ request: { series: ['A'], number: '1' }, matches: [one('s', 'A', '2000-01-01', [{ bookId: 'bk1', number: '1', title: 'A #1' }])] }]);
  const a = await standIn({ 'POST /api/v1/readlists/match/comicrack': { body: good }, 'POST /api/v1/readlists': { status: 201, body: {} } });
  const r = await addReadList({ baseUrl: a.base, apiKey: 'k', xml: XML, fileName: 'x.cbl' });
  a.server.close();
  assert.deepStrictEqual(r, { ok: true, count: 1, missing: 0, ambiguous: 0 });
  const created = JSON.parse(a.seen[a.seen.length - 1].body);
  assert.deepStrictEqual(created, { name: 'Probe list', summary: '', ordered: true, bookIds: ['bk1'] });

  const unclear = modern([{ request: { series: ['A'], number: '1' }, matches: [one('s1', 'A', '1990-01-01', [{ bookId: 'p', number: '1', title: 'A #1' }]), one('s2', 'A', '2010-01-01', [{ bookId: 'q', number: '1', title: 'A #1' }])] }]);
  const b = await standIn({ 'POST /api/v1/readlists/match/comicrack': { body: unclear } });
  const r2 = await addReadList({ baseUrl: b.base, apiKey: 'k', xml: XML, fileName: 'x.cbl' });
  b.server.close();
  assert.strictEqual(r2.ok, false); assert.strictEqual(r2.reason, 'nomatch'); assert.strictEqual(r2.ambiguous, 1);
  assert.match(r2.message, /several series/); assert.strictEqual(b.seen.length, 1);        // nothing was created
});

test('a list that the name search misses is still found in the full set and updated, not reported as already existing', async () => {
  const { server, seen, base } = await standIn({
    'POST /api/v1/readlists/match/comicrack': { body: { request: { name: 'Same Name', ordered: true, bookIds: ['a', 'b'] }, errors: [] } },
    'GET /api/v1/readlists?unpaged=true&search=Same%20Name': { body: { content: [] } },                         // the search finds nothing
    'GET /api/v1/readlists?unpaged=true': { body: { content: [{ id: 'old1', name: 'other' }, { id: 'L7', name: 'same name' }] } },
    'PATCH /api/v1/readlists/L7': { status: 204, body: {} }
  });
  const r = await addReadList({ baseUrl: base, apiKey: 'k', xml: XML, fileName: 'x.cbl' });
  server.close();
  assert.deepStrictEqual(r, { ok: true, count: 2, missing: 0, ambiguous: 0, replaced: true });
  assert.ok(seen.some((x) => x.method === 'PATCH' && x.url === '/api/v1/readlists/L7'));
  assert.ok(!seen.some((x) => x.method === 'POST' && x.url === '/api/v1/readlists'));
});
