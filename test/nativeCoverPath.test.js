const test = require('node:test'); const assert = require('node:assert');
const { coverRoute, coverSrc } = require('../native/coverPath');
test('Steam and SteamGridDB covers go through the site proxy, others directly, junk is refused', () => {
  const a = coverRoute('http://cdn.akamai.steamstatic.com/steam/apps/1/library_600x900.jpg');
  assert.equal(a.kind, 'site'); assert.match(a.path, /^\/api\/art-proxy\?url=https%3A%2F%2Fcdn\.akamai\.steamstatic\.com/);
  assert.equal(coverRoute('https://cdn2.steamgriddb.com/grid/x.png').kind, 'site');
  assert.deepEqual(coverRoute('https://example.org/a.jpg'), { kind: 'direct', url: 'https://example.org/a.jpg' });
  assert.equal(coverRoute('/api/art-proxy?url=abc').kind, 'site');
  for (const bad of ['', null, 'javascript:alert(1)', 'file:///c:/x.png', 'ftp://x/y.png']) assert.equal(coverRoute(bad), null, String(bad));
});
test('the page-side address round-trips the original url', () => {
  const src = coverSrc('https://x.test/a b.jpg?x=1&y=2');
  assert.equal(new URL(src).searchParams.get('u'), 'https://x.test/a b.jpg?x=1&y=2');
  assert.equal(coverSrc(''), '');
});
test('collection covers are fetched from the site', () => {
  assert.equal(coverRoute('/api/collection-cover?remote=Music&path=Abba&w=480').kind, 'site');
});
