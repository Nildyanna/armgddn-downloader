const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../inflightStore');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inflight-')), 'inflight-downloads.json');
const entry = (id, over = {}) => ({ id, name: 'Some Game', resume: { remote: 'PC-1', path: 'PC1/Some Game v1 -ARMGDDN', dest: '' }, totalSize: 5e9, progress: 40, fileCount: 12, startTime: '2026-11-20T08:00:00.000Z', ...over });

test('an unfinished download is saved and comes back with what is needed to ask for it again', () => {
  const f = tmp();
  assert.equal(store.upsert(f, entry('a1')), true);
  const [e] = store.load(f);
  assert.equal(e.id, 'a1');
  assert.deepEqual(e.resume, { remote: 'PC-1', path: 'PC1/Some Game v1 -ARMGDDN', dest: '' });
  assert.equal(e.progress, 40);
  assert.equal(JSON.stringify(e).includes('token'), false, 'no token or link is ever stored');
});

test('saving the same download again replaces it, and finishing or cancelling drops it', () => {
  const f = tmp();
  store.upsert(f, entry('a1', { progress: 10 }));
  store.upsert(f, entry('a1', { progress: 60 }));
  store.upsert(f, entry('b2'));
  assert.equal(store.load(f).length, 2);
  assert.equal(store.load(f).find((x) => x.id === 'a1').progress, 60);
  assert.equal(store.drop(f, 'a1'), true);
  assert.deepEqual(store.load(f).map((x) => x.id), ['b2']);
  assert.equal(store.drop(f, 'nope'), false);
});

test('a download of picked items (a batch) is not kept, since its list cannot be asked for again', () => {
  const f = tmp();
  assert.equal(store.upsert(f, entry('c3', { resume: { remote: 'Comics', path: '__batch__/abc', dest: 'comics' } })), false);
  assert.deepEqual(store.load(f), []);
});

test('Music and Comics keep their destination; anything else is dropped', () => {
  const f = tmp();
  store.upsert(f, entry('m1', { resume: { remote: 'Music', path: 'Music/Artist/Album', dest: 'music' } }));
  store.upsert(f, entry('x1', { resume: { remote: 'PC-1', path: 'PC1/G', dest: '/etc' } }));
  const l = store.load(f);
  assert.equal(l.find((x) => x.id === 'm1').resume.dest, 'music');
  assert.equal(l.find((x) => x.id === 'x1').resume.dest, '');
});

test('old entries expire and a damaged file loads as empty', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify([{ ...entry('old'), savedAt: Date.now() - store.KEEP_MS - 1000 }, { ...entry('new'), savedAt: Date.now() }]));
  assert.deepEqual(store.load(f).map((x) => x.id), ['new']);
  fs.writeFileSync(f, '{not json');
  assert.deepEqual(store.load(f), []);
  assert.deepEqual(store.load(path.join(os.tmpdir(), 'does-not-exist.json')), []);
});

test('the app saves a download when it starts or is paused, restores it as paused, and Resume asks for a fresh link', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('persistInflight(download);\n  sendToMain(\'download-started\''));
  assert.ok(main.includes("download.status = 'paused';\n  persistInflight(download);"));
  assert.ok(main.includes("dropInflight(downloadId);\n"));
  assert.ok(main.includes('if (download.restored) return resumeRestoredDownload(downloadId);'));
  assert.ok(main.includes("/api/external-download-token', { remote: d.resume.remote, path: d.resume.path }"));
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).build.files.includes('inflightStore.js'));
});
