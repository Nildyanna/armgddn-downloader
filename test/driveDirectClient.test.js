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

test('a download that failed and was retried reports its later files without crediting twice, and says nothing when nothing is new', async () => {
  const g = c.grantFromManifest(manifest);
  const seen = []; const opts = { request: fakeRequest({ status: 200, json: { success: true } }, seen) };
  g.done.add('PCVR1/G/a.7z');                                       // one file finished, then the download failed
  assert.equal(await c.finish(g, 'https://www.armgddnbrowser.com/x', 's', opts), true);
  assert.equal(seen[0].body.notDownloaded, 50); assert.deepEqual(seen[0].body.completedPaths, ['PCVR1/G/a.7z']);
  assert.equal(await c.finish(g, 'https://www.armgddnbrowser.com/x', 's', opts), false);       // nothing new
  g.done.add('PCVR1/G/b.7z');                                       // a retry finishes the rest
  assert.equal(await c.finish(g, 'https://www.armgddnbrowser.com/x', 's', opts), true);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].body.notDownloaded, 0);                      // the credit is only asked for once
  assert.deepEqual(seen[1].body.completedPaths, ['PCVR1/G/b.7z']);  // and only the new file is sent
});

test('the app reports a finally failed download, not a paused one, and not while an automatic retry is waiting', () => {
  const fs = require('fs'); const path = require('path');
  const src = require('./mainSource')();
  const helper = src.slice(src.indexOf('function reportDirectGrantEnd'), src.indexOf('function scheduleAutoRetry'));
  assert.ok(helper.includes('download.paused') && helper.includes('__autoRetryPending') && helper.includes('driveDirectClient.finish'));
  assert.ok(src.includes('if (!download.paused && !download.cancelled) reportDirectGrantEnd(download);'));            // end of the first run
  assert.ok(src.includes('if (hasErrors && !download.paused && !download.cancelled) reportDirectGrantEnd(download);'));  // end of a retried run
  assert.ok(src.includes("if (download.status === 'error' || download.status === 'failed') reportDirectGrantEnd(download);"));   // after an automatic retry
  assert.ok(src.includes("download.status = 'failed';\n        reportDirectGrantEnd(download);"));                               // stuck download finalised as failed
  const pause = src.slice(src.indexOf("download.paused = true;\n  download.status = 'paused';"), src.indexOf("download.paused = true;\n  download.status = 'paused';") + 1500);
  assert.ok(!pause.includes('driveDirectClient.finish') && !pause.includes('reportDirectGrantEnd'));                        // pausing sends nothing
});

test('reportOrphan sends the estimate for a grant the app never closed, and refuses a bad id', async () => {
  const seen = [];
  const opts = { request: fakeRequest({ status: 200, json: { success: true } }, seen) };
  assert.equal(await c.reportOrphan('ab12cd34ef56ab12cd34ef56', 123456.4, 'https://www.armgddnbrowser.com', 's', opts), true);
  assert.equal(seen[0].path, '/api/drive-direct/finish'); assert.equal(seen[0].body.notDownloaded, 123456); assert.deepEqual(seen[0].body.completedPaths, []);
  assert.equal(await c.reportOrphan('../x', 1, 'https://www.armgddnbrowser.com', 's', opts), false);
  assert.equal(seen.length, 1);
});

test('main.js closes the saved grant on resume and on cancel of a restored download', () => {
  const src = require('./mainSource')();
  assert.ok(src.includes("download.directGrant ? (download.directGrant.finished ? '' : download.directGrant.grantId) : (download.grantId || '')"));
  assert.equal((src.match(/endOrphanedGrant\(/g) || []).length, 4);   // the definition, the startup pass and its two callers
});

test('graphics saver: idle pause, Lighter graphics setting in both windows, no endless progress shimmer', () => {
  const fs = require('fs'), p = (...a) => require('path').join(__dirname, '..', ...a);
  const main = require('./mainSource')();
  assert.ok(main.includes('lightGraphics: false') && main.includes("settings.lightGraphics = !!settings.lightGraphics") && main.includes("    'lightGraphics',\n"));
  for (const f of ['renderer/index.html', 'renderer/native/index.html']) assert.ok(/gpu-saver\.js/.test(fs.readFileSync(p(f), 'utf8')) && /gpu-saver\.css/.test(fs.readFileSync(p(f), 'utf8')), f);
  assert.ok(fs.readFileSync(p('renderer/gpu-saver.css'), 'utf8').includes('animation-play-state: paused'));
  assert.ok(!/animation: progress-shimmer/.test(fs.readFileSync(p('renderer/styles.css'), 'utf8')));
  assert.ok(fs.readFileSync(p('renderer/native/app.mjs'), 'utf8').includes("settingRow('lightGraphics')"));
  assert.ok(fs.readFileSync(p('renderer/renderer.js'), 'utf8').includes("getElementById('light-graphics')"));
});
