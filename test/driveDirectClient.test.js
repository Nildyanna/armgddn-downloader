const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const c = require('../driveDirectClient');
const { headersForRedirect } = require('../httpOpen');

const manifest = {
  directDrive: { used: true, grantId: 'ab12cd34ef56ab12cd34ef56', renewPath: '/api/drive-direct/renew' },
  files: [{ path: 'PCVR1/G/a.7z', size: 100, headers: { Authorization: 'Bearer x' } }, { path: 'PCVR1/G/b.7z', size: 50, headers: { Authorization: 'Bearer x' } }, { path: 'PCVR1/G/c.txt', size: 5 }]
};

function fakeRequest(reply, seen) {
  return (opts, cb) => {
    const req = new EventEmitter(); req.destroy = () => { };
    req.end = (data) => { seen.push({ path: opts.path, auth: opts.headers.Authorization, body: JSON.parse(data) }); const res = new EventEmitter(); res.statusCode = reply.status; cb(res); res.emit('data', JSON.stringify(reply.json)); res.emit('end'); };
    return req;
  };
}

test('a grant exists only when the site started one, and only counts the files given a Drive link', () => {
  const g = c.grantFromManifest(manifest);
  assert.equal(g.files.size, 2); assert.equal(c.notDownloaded(g), 150);
  assert.equal(c.grantFromManifest({ files: manifest.files }), null);
  assert.equal(c.grantFromManifest({ directDrive: { used: false, limited: true }, files: manifest.files }), null);
  assert.equal(c.grantFromManifest({ directDrive: { used: true, grantId: '../x' }, files: manifest.files }), null);
});

test('renew returns the new header, and null (use the gateway) when the site refuses', async () => {
  const g = c.grantFromManifest(manifest);
  const seen = [];
  const ok = await c.renew(g, 'https://www.armgddnbrowser.com/api/download-manifest', 'sess', { request: fakeRequest({ status: 200, json: { success: true, headers: { Authorization: 'Bearer y' }, expiresAt: '2026-11-18T09:00:00Z' } }, seen) });
  assert.deepEqual(ok, { headers: { Authorization: 'Bearer y' }, expiresAt: '2026-11-18T09:00:00Z' });
  assert.equal(seen[0].path, '/api/drive-direct/renew'); assert.equal(seen[0].auth, 'Bearer sess'); assert.equal(seen[0].body.grantId, g.grantId);
  assert.equal(await c.renew(g, 'https://www.armgddnbrowser.com/x', 's', { request: fakeRequest({ status: 404, json: { success: false } }, []) }), null);
  assert.equal(await c.renew(g, 'https://www.armgddnbrowser.com/x', 's', { request: () => { throw new Error('down'); } }), null);
});

test('finish reports what was not downloaded, once', async () => {
  const g = c.grantFromManifest(manifest);
  g.done.add('PCVR1/G/a.7z');
  const seen = [];
  const opts = { request: fakeRequest({ status: 200, json: { success: true } }, seen) };
  assert.equal(await c.finish(g, 'https://www.armgddnbrowser.com/x', 's', opts), true);
  assert.equal(await c.finish(g, 'https://www.armgddnbrowser.com/x', 's', opts), false);
  assert.equal(seen.length, 1); assert.equal(seen[0].body.notDownloaded, 50); assert.deepEqual(seen[0].body.completedPaths, ['PCVR1/G/a.7z']);
});

test('a redirect to another site never carries the token, a same-site one keeps it', () => {
  const h = { Authorization: 'Bearer x', authorization: 'y', Cookie: 'c', Range: 'bytes=0-1', Accept: '*/*' };
  assert.deepEqual(headersForRedirect(h, new URL('https://www.googleapis.com/drive/v3/files/1?alt=media'), 'https://doc-0g.googleusercontent.com/x'), { Range: 'bytes=0-1', Accept: '*/*' });
  assert.strictEqual(headersForRedirect(h, new URL('https://www.googleapis.com/a'), 'https://www.googleapis.com/b'), h);
});
