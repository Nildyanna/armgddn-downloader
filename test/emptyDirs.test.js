const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pruneEmptyDirs } = require('../emptyDirs');

const made = [];
test.after(() => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });
const root = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-')); made.push(d); return d; };

test('cancelling leaves no empty folders: the empty game folder and its empty subfolders go, deepest first', async () => {
  const r = root();
  fs.mkdirSync(path.join(r, 'Game v1', 'disc1', 'bin'), { recursive: true });
  const gone = await pruneEmptyDirs([path.join(r, 'Game v1', 'disc1', 'bin'), path.join(r, 'Game v1')], r);
  assert.deepEqual(gone, [path.join(r, 'Game v1', 'disc1', 'bin'), path.join(r, 'Game v1', 'disc1'), path.join(r, 'Game v1')]);
  assert.equal(fs.existsSync(path.join(r, 'Game v1')), false);
  assert.equal(fs.existsSync(r), true, 'the download folder itself is never removed');
});

test('a folder that still holds anything, even one file or a non-empty subfolder, is left alone', async () => {
  const r = root();
  fs.mkdirSync(path.join(r, 'Game', 'a'), { recursive: true });
  fs.mkdirSync(path.join(r, 'Game', 'b'), { recursive: true });
  fs.writeFileSync(path.join(r, 'Game', 'b', 'keep.txt'), 'x');
  const gone = await pruneEmptyDirs([path.join(r, 'Game', 'a'), path.join(r, 'Game', 'b'), path.join(r, 'Game')], r);
  assert.deepEqual(gone, [path.join(r, 'Game', 'a')]);                       // only the empty one
  assert.ok(fs.existsSync(path.join(r, 'Game', 'b', 'keep.txt')) && fs.existsSync(path.join(r, 'Game')));
});

test('nothing outside the download folder is ever touched, and the limit itself is not removed', async () => {
  const r = root();
  const other = root();
  fs.mkdirSync(path.join(other, 'empty'));
  assert.deepEqual(await pruneEmptyDirs([path.join(other, 'empty'), other, path.join(r, '..')], r), []);
  assert.ok(fs.existsSync(path.join(other, 'empty')));
  assert.deepEqual(await pruneEmptyDirs([r], r), []);
  assert.ok(fs.existsSync(r));
  assert.deepEqual(await pruneEmptyDirs([path.join(r, 'missing'), '', null], r), []);   // a missing folder is not an error
});

test('main.js removes the empty folders after the cancelled files, but not while another running download shares the folder, and the module is packaged', () => {
  const main = require('./mainSource')();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('emptyDirs.js'));
  assert.ok(main.includes("const { pruneEmptyDirs } = require('./emptyDirs');") && main.includes('removedParents.add(path.dirname(targetPath));'));
  const i = main.indexOf('const shared = Array.from(activeDownloads.values())');
  assert.ok(i > 0 && main.slice(i, i + 900).includes('if (cleanupOk && !shared && removedParents.size)') && main.slice(i, i + 900).includes('pruneEmptyDirs('));
});
