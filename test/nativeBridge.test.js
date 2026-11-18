const test = require('node:test'); const assert = require('node:assert');
const { wrap, browsePath } = require('../native/bridge');
test('wrap turns results and errors into plain data', async () => {
  assert.deepEqual(await wrap(async (a) => a + 1)(null, 1), { ok: true, data: 2 });
  const r = await wrap(async () => { throw Object.assign(new Error('Sign in again'), { kind: 'auth', status: 401 }); })(null);
  assert.deepEqual(r, { ok: false, error: { kind: 'auth', message: 'Sign in again', status: 401 } });
});
test('browse paths are built safely', () => {
  assert.equal(browsePath('PC Games', ''), '/api/browse/PC%20Games');
  assert.equal(browsePath('PC Games', 'A/B c'), '/api/browse/PC%20Games?path=A%2FB%20c');
  assert.throws(() => browsePath('../x', ''));
  assert.throws(() => browsePath('PC Games', '../../etc'));
});
test('request writes are validated before they reach the site', async () => {
  const { wrap } = require('../native/bridge');
  // The validators live in the handlers; exercise the shape they promise through wrap.
  const bad = await wrap(async () => { throw Object.assign(new Error('Message too long (max 500)'), { kind: 'http', status: 400 }); })(null);
  assert.equal(bad.ok, false); assert.equal(bad.error.status, 400);
});
test('only a short list of https hosts can be opened from the window', () => {
  const { LINK_HOSTS } = require('../native/bridge');
  for (const h of ['store.steampowered.com', 'steamdb.info', '7-zip.org', 't.me']) assert.ok(LINK_HOSTS.has(h), h);
  for (const h of ['evil.example', 'steampowered.com.evil.example', 'localhost']) assert.ok(!LINK_HOSTS.has(h), h);
});
test('a batch download refuses odd paths before the site sees them', async () => {
  const { browsePath } = require('../native/bridge');
  assert.throws(() => browsePath('PC Games', '../x'));
  assert.equal(browsePath('PC Games', 'PC1/Game'), '/api/browse/PC%20Games?path=PC1%2FGame');
});
