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

// ---- matching by the site's catalog: exact file first, Comic Vine id second, nothing guessed
const kb = (id, url, size, cv) => ({ id, url, sizeBytes: size, metadata: { links: cv ? [{ label: 'ComicVine', url: `https://comicvine.gamespot.com/x/4000-${cv}/` }] : [] } });

test('catalog matching: the exact file beats the Comic Vine id (the same issue exists as several files), the folder path breaks ties, an id is the fallback, the rest is missing', () => {
  const { matchCatalogItems } = require('../komga');
  const books = [
    { id: 'digital', url: 'R:\\Other\\Daredevil\\Daredevil 307 (1992) (Digital).cbz', size: 500, cv: 307 },     // same issue, another edition, listed first
    { id: 'scan', url: 'R:\\Daredevil Collection\\Daredevil Vol. 1 (1964)\\Daredevil 307 (1992) (scan).cbz', size: 111, cv: 307 },
    { id: 'dupA', url: 'D:\\x\\Batman Collection\\Batman (1940)\\Batman 5.cbr', size: 70, cv: 0 },                  // the same file in two folders
    { id: 'dupB', url: 'D:\\x\\Elseworlds\\Batman 5.cbr', size: 70, cv: 0 },
    { id: 'other', url: 'D:\\x\\Other edition of 9.cbz', size: 90, cv: 9 },
  ];
  const items = [
    ['Daredevil Collection/Daredevil Vol. 1 (1964)/Daredevil 307 (1992) (scan).cbz', 307, 111, '307', '1992'],     // exact file exists -> scan, not digital
    ['Batman Collection/Batman (1940)/Batman 5.cbr', 0, 70, '5', '1940'],                                          // two folders -> the one under Batman Collection
    ['Some Collection/Series/Issue 9 (my edition).cbz', 9, 123, '9', '2001'],                                      // not that file, but the issue id exists -> other
    ['Nowhere/Missing 1.cbz', 0, 5, '1', '2000'],
    ['Daredevil Collection/Daredevil Vol. 1 (1964)/Daredevil 307 (1992) (scan).cbz', 307, 111, '307', '1992'],     // a repeat is not added twice
  ];
  const m = matchCatalogItems(items, books);
  assert.deepStrictEqual(m.bookIds, ['scan', 'dupA', 'other']);
  assert.strictEqual(m.byFile, 3); assert.strictEqual(m.byCv, 1); assert.strictEqual(m.missing, 1);
});

test('catalog matching: a Comic Vine id shared by two books picks the one in the same collection folder', () => {
  const { matchCatalogItems } = require('../komga');
  const books = [{ id: 'far', url: 'D:\\Z\\Nomad\\Nomad 5.cbz', size: 1, cv: 55 }, { id: 'near', url: 'D:\\Z\\Daredevil Collection\\Hand\\Nomad 5.cbz', size: 2, cv: 55 }];
  const m = matchCatalogItems([['Daredevil Collection/Hand/Nomad 5 (other).cbz', 55, 3, '5', '1992']], books);
  assert.deepStrictEqual(m.bookIds, ['near']);
});

test('adding from the catalog pages through every book, creates the list in catalog order, and says how each comic was found', async () => {
  const page0 = { totalPages: 2, content: [kb('a', 'R:\\C\\S\\one.cbz', 10, 0), kb('b', 'R:\\C\\S\\two.cbz', 20, 222)] };
  const page1 = { totalPages: 2, content: [kb('c', 'R:\\C\\S\\three.cbz', 30, 0)] };
  const { server, seen, base } = await standIn({
    'GET /api/v1/books?size=500&page=0': { body: page0 }, 'GET /api/v1/books?size=500&page=1': { body: page1 },
    'GET /api/v1/readlists?unpaged=true&search=My%20List': { body: { content: [] } }, 'GET /api/v1/readlists?unpaged=true': { body: { content: [] } },
    'POST /api/v1/readlists': { status: 201, body: {} }
  });
  const { addCatalogReadList } = require('../komga');
  const items = [['C/S/three.cbz', 0, 30, '3', '2000'], ['C/S/zzz-other-name.cbz', 222, 99, '2', '2000'], ['C/S/one.cbz', 0, 10, '1', '2000'], ['C/S/none.cbz', 0, 1, '4', '2000']];
  const r = await addCatalogReadList({ baseUrl: base, apiKey: 'k', name: 'My List', items });
  server.close();
  assert.deepStrictEqual(r, { ok: true, count: 3, missing: 1, ambiguous: 0, total: 4, byFile: 2, byCv: 1 });
  const body = JSON.parse(seen[seen.length - 1].body);
  assert.deepStrictEqual(body, { name: 'My List', summary: '', ordered: true, bookIds: ['c', 'b', 'a'] });
  assert.ok(seen.every((s) => s.key === 'k'));
});

test('adding from the catalog: a wrong key, no matching comics, and a dead server each give a clear reason and create nothing', async () => {
  const { addCatalogReadList } = require('../komga');
  const a = await standIn({ 'GET /api/v1/books?size=500&page=0': { status: 401, body: {} } });
  const r1 = await addCatalogReadList({ baseUrl: a.base, apiKey: 'bad', name: 'L', items: [['a/b.cbz', 1, 1, '1', '2000']] });
  a.server.close(); assert.strictEqual(r1.reason, 'auth'); assert.strictEqual(r1.step, 'books');
  const b = await standIn({ 'GET /api/v1/books?size=500&page=0': { body: { totalPages: 1, content: [kb('x', 'R:\\other.cbz', 5, 0)] } } });
  const r2 = await addCatalogReadList({ baseUrl: b.base, apiKey: 'k', name: 'L', items: [['a/b.cbz', 1, 1, '1', '2000']] });
  b.server.close(); assert.strictEqual(r2.reason, 'nomatch'); assert.ok(!b.seen.some((s) => s.method === 'POST'));
  const r3 = await addCatalogReadList({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k', name: 'L', items: [['a/b.cbz', 1, 1, '1', '2000']] });
  assert.strictEqual(r3.reason, 'unreachable');
});

test('the classic window says which issues were left out because they could mean more than one series, and which are not in the library', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const i = src.indexOf('issues are in the read list');
  const body = src.slice(i, i + 700);
  assert.ok(body.includes('r.ambiguous') && body.includes('could belong to more than one series') && body.includes('r.missing - (r.ambiguous || 0)'));
});

test('both windows build the list through the same catalog helper; the classic window falls back to the reading-order file only when the catalog has no such list', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const helper = src.slice(src.indexOf('async function komgaAddFromCatalog'), src.indexOf('// The reading orders a member can add'));
  assert.ok(helper.includes("comicsGet('/api/comics/catalog?list='") && helper.includes('komga.addCatalogReadList') && helper.includes('catalogMissing: true'));
  const native = src.slice(src.indexOf("ipcMain.handle('native-komga-add'"), src.indexOf("ipcMain.handle('native-komga-add'") + 1500);
  assert.ok(native.includes('komgaAddFromCatalog(cfg, listId)'));
  const classic = src.slice(src.indexOf('async function addReadListToKomga'), src.indexOf('// Handle deep link\nfunction handleDeepLink'));
  const via = classic.indexOf('komgaAddFromCatalog(cfg, listId)'), fallback = classic.indexOf('/api/komga-readlist?id=');
  assert.ok(via > -1 && fallback > via, 'the catalog is tried first');
  assert.ok(classic.includes('if (!c.catalogMissing) {'), 'and the file route is only used when the catalog has no such list');
  assert.ok(classic.includes("c.reason === 'auth' || c.reason === 'unreachable'"), 'a refused key is still forgotten');
});
