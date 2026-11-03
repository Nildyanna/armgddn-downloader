const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cs = require('../comicsScan');

// A minimal zip writer: entries [{ name, data, deflate }]
function makeZip(entries) {
  const locals = [], cds = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const body = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(e.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    cds.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(cds);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

const info = (cv, series, number, year) =>
  `<?xml version="1.0"?><ComicInfo><Series>${series}</Series><Number>${number}</Number><Year>${year}</Year><Web>https://comicvine.gamespot.com/thor-${number}/4000-${cv}/</Web></ComicInfo>`;
const cbz = (cv, series, number, year, deflate) =>
  makeZip([{ name: '001.jpg', data: 'x'.repeat(200) }, { name: 'ComicInfo.xml', data: info(cv, series, number, year), deflate }]);

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  for (const [rel, data] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

test('the Comic Vine id is read out of a CBZ, stored or compressed, without unpacking it', () => {
  const dir = folder({ 'a.cbz': cbz(38000, 'Thor', '407', '1989', false), 'b.cbz': cbz(38001, 'Thor', '408', '1989', true) });
  const a = cs.parseComicInfo(cs.readZipInfo(path.join(dir, 'a.cbz')).xml);
  const b = cs.parseComicInfo(cs.readZipInfo(path.join(dir, 'b.cbz')).xml);
  assert.deepStrictEqual([a.cvId, a.series, a.number, a.year], [38000, 'Thor', '407', '1989']);
  assert.strictEqual(b.cvId, 38001);
});

test('a cut-short download is reported as damaged, and a zero-byte file too', () => {
  const whole = cbz(38000, 'Thor', '407', '1989', true);
  const dir = folder({ 'good.cbz': whole, 'cut.cbz': whole.subarray(0, whole.length - 30), 'empty.cbz': Buffer.alloc(0) });
  const { rows } = cs.scanFolder(dir);
  const by = Object.fromEntries(rows.map((r) => [r.rel, r]));
  assert.strictEqual(by['good.cbz'].damaged, false);
  assert.strictEqual(by['cut.cbz'].damaged, true);
  assert.strictEqual(by['empty.cbz'].damaged, true);
});

test('file names are understood when a comic has no tags', () => {
  assert.deepStrictEqual(cs.parseFileName('Thor 407 (1989) (Digital) (Shadowcat-Empire).cbz'), { series: 'Thor', number: '407', year: '1989' });
  assert.deepStrictEqual(cs.parseFileName('Action Comics 0901 (2011).cbz'), { series: 'Action Comics', number: '901', year: '2011' });
  assert.strictEqual(cs.parseFileName('Thor 413b (Avengers West Coast #55).cbz').number, '413b');
});

test('subfolders are scanned, other files ignored, and an unchanged file is not read again', () => {
  const dir = folder({ 'Marvel/Thor/Thor 407 (1989).cbz': cbz(38000, 'Thor', '407', '1989'), 'notes.txt': 'hello', 'Marvel/Thor/cover.jpg': 'x' });
  const first = cs.scanFolder(dir);
  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(first.rows[0].rel, 'Marvel/Thor/Thor 407 (1989).cbz');
  const marked = { ...first.cache };
  marked['Marvel/Thor/Thor 407 (1989).cbz'] = { ...marked['Marvel/Thor/Thor 407 (1989).cbz'], cvId: 999 };       // a cache hit is trusted
  assert.strictEqual(cs.scanFolder(dir, { cache: marked }).rows[0].cvId, 999);
});

const CATALOG = [
  ['Thor Collection/Thor/Thor 407 (1989).cbz', 38000, 30000000, '407', '1989'],
  ['Thor Collection/Thor/Thor 408 (1989).cbz', 38001, 31000000, '408', '1989'],
  ['Thor Collection/Thor/Thor 409 (1989).cbz', 38002, 32000000, '409', '1989'],
  ['Batman Collection/Batman/Batman 001 (1940).cbz', 0, 20000000, '1', '1940'],
];

test('owned comics are matched by Comic Vine id first, then by name, and the rest are missing with their size', () => {
  const dir = folder({
    'mine/Thor 407 (1989).cbz': cbz(38000, 'Thor', '407', '1989'),                                 // by id
    'mine/The Mighty Thor 408.cbz': cbz(38001, 'Mighty', '1', '2000'),                             // by id although the name is different
    'mine/Batman #1 (1940).cbz': makeZip([{ name: '001.jpg', data: 'x' }]),                        // no tags: by name
  });
  const r = cs.compare(CATALOG, cs.scanFolder(dir).rows);
  assert.deepStrictEqual([r.total, r.have, r.haveByName, r.missing, r.bytesMissing], [4, 2, 1, 1, 32000000]);
  assert.strictEqual(r.missingRows[0][0], 'Thor Collection/Thor/Thor 409 (1989).cbz');
  assert.deepStrictEqual(r.perSeries, [{ series: 'Thor', count: 1, bytes: 32000000 }]);
});

test('a damaged copy is never counted as owned, and is listed for re-download', () => {
  const whole = cbz(38000, 'Thor', '407', '1989', true);
  const dir = folder({ 'Thor 407 (1989).cbz': whole.subarray(0, whole.length - 30) });
  const r = cs.compare(CATALOG.slice(0, 1), cs.scanFolder(dir).rows);
  assert.deepStrictEqual([r.have, r.missing, r.damagedCount], [0, 1, 1]);
});

test('same series and number with a different year is shown as a near match but still downloaded', () => {
  const dir = folder({ 'Thor 407 (1990).cbz': makeZip([{ name: '001.jpg', data: 'x' }]) });
  const r = cs.compare(CATALOG.slice(0, 1), cs.scanFolder(dir).rows);
  assert.deepStrictEqual([r.have + r.haveByName, r.missing, r.maybe], [0, 1, 1]);
});

test('numbers compare without leading zeros, and letter suffixes are kept', () => {
  assert.strictEqual(cs.normNum('0407'), '407');
  assert.strictEqual(cs.normNum('413b'), '413b');
  assert.strictEqual(cs.norm('The Mighty Thor'), 'mightythor');
});
