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

test('a download of picked items (a batch) is kept as its item list, never as the expired batch id', () => {
  const f = tmp();
  assert.equal(store.upsert(f, entry('c3', { resume: { remote: 'Comics', path: '__batch__/abc', dest: 'comics' } })), false, 'an old batch id alone cannot be asked for again');
  assert.equal(store.upsert(f, entry('c4', { resume: { remote: 'Comics', paths: ['Comix/Series A/Vol 1', 'Comix/Series A/Vol 2'], exclude: ['Update.7z'], dest: 'comics' } })), true);
  const [e] = store.load(f);
  assert.deepEqual(e.resume, { remote: 'Comics', paths: ['Comix/Series A/Vol 1', 'Comix/Series A/Vol 2'], exclude: ['Update.7z'], dest: 'comics' });
  const many = Array.from({ length: 800 }, (_, i) => 'Comix/S/' + i);
  store.upsert(f, entry('c5', { resume: { remote: 'Comics', paths: many, exclude: [], dest: 'comics' } }));
  assert.equal(store.load(f).find((z) => z.id === 'c5').resume.paths.length, 500, 'a very large batch is capped');
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
  assert.ok(main.includes("/api/external-download-token', { remote: d.resume.remote, path: tokenPath }"));
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).build.files.includes('inflightStore.js'));
});

test('Resume of a batch makes the batch again, then asks for a token for it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("/api/batch-manifest', { remote: d.resume.remote, paths: d.resume.paths, exclude: d.resume.exclude || [] }"));
  assert.ok(main.includes("tokenPath = '__batch__/' + b.json.batchId;"));
  assert.ok(main.includes('manifest.batchExclude'));
});

test('the direct-from-Drive grant id is kept, and a malformed one is dropped', () => {
  const f = tmp();
  store.upsert(f, entry('a', { grantId: 'ab12cd34ef56ab12cd34ef56' }));
  store.upsert(f, entry('b', { grantId: '../evil' }));
  const l = store.load(f);
  assert.equal(l.find((x) => x.id === 'a').grantId, 'ab12cd34ef56ab12cd34ef56');
  assert.equal(l.find((x) => x.id === 'b').grantId, '');
});

test('6.0.0 loads the unfinished-downloads file exactly as 5.41 to 5.43 wrote it, so downloads cut off by the update come back as Paused in the new app', () => {
  const f = tmp();
  const savedAt = Date.now() - 20 * 60 * 1000;
  // literal content of inflight-downloads.json from a 5.43 install: a game, a Music album with its destination, a batch of picked items and a Drive grant
  fs.writeFileSync(f, JSON.stringify([
    { id: 'dl_1', name: 'Some Game v1 -ARMGDDN', resume: { remote: 'PC-1', path: 'PC1/Some Game v1 -ARMGDDN', dest: '' }, grantId: '', totalSize: 21474836480, progress: 37, fileCount: 12, startTime: '2026-11-21T01:00:00.000Z', savedAt },
    { id: 'dl_2', name: 'An Album', resume: { remote: 'Music', path: 'Music/Artist/An Album', dest: 'music' }, grantId: '0123456789abcdef01234567', totalSize: 524288000, progress: 80, fileCount: 11, startTime: '2026-11-21T01:05:00.000Z', savedAt },
    { id: 'dl_3', name: '3 items', resume: { remote: 'Comics', paths: ['Comix/Marvel/A', 'Comix/Marvel/B', 'Comix/Marvel/C'], exclude: [], dest: 'comics' }, grantId: '', totalSize: 1073741824, progress: 5, fileCount: 90, startTime: '2026-11-21T01:10:00.000Z', savedAt }
  ]));
  const list = store.load(f);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0].resume, { remote: 'PC-1', path: 'PC1/Some Game v1 -ARMGDDN', dest: '' });
  assert.deepEqual(list[1].resume, { remote: 'Music', path: 'Music/Artist/An Album', dest: 'music' });
  assert.equal(list[1].grantId, '0123456789abcdef01234567');
  assert.deepEqual(list[2].resume.paths, ['Comix/Marvel/A', 'Comix/Marvel/B', 'Comix/Marvel/C']);
  assert.equal(list[0].progress, 37);
  // and the 6.0.0 app restores them at start whatever window opens, and a restored one resumes through a fresh token (so through Drive)
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/\n  loadOrphanedDownloads\(\);\n/.test(main), 'restore runs unconditionally at start');
  assert.ok(main.includes("if (download.restored) return resumeRestoredDownload(downloadId);"));
});
