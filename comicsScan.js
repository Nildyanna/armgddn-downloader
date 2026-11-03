'use strict';
// "Only what I'm missing" for comics: scan a member's own comics folder and compare it with the site's catalog.
// Everything here runs on the member's PC. The folder's contents never leave it: only the catalog (a list of comics) comes down.
// A comic counts as owned when its Comic Vine issue id (read from the ComicInfo.xml inside the CBZ) is in the catalog, else when its
// series, issue number and year match by name. A near match (same series and number, different year) is reported but never skips a download.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COMIC_EXT = new Set(['.cbz', '.cbr', '.cb7', '.zip', '.rar', '.7z']);
const MAX_XML = 2 * 1024 * 1024;
const MAX_CD = 32 * 1024 * 1024;

// ---------------------------------------------------------------- reading ComicInfo.xml out of a zip without unpacking it
function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, position);
  return got === length ? buf : buf.subarray(0, got);
}

// -> { ok: boolean, xml: string|null, entries: number }. ok=false means the zip's directory could not be read (usually a cut-short download).
function readZipInfo(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return { ok: false, xml: null, entries: 0 };
    const tailLen = Math.min(size, 66000);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) { if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; } }
    if (e < 0) return { ok: false, xml: null, entries: 0 };
    let entries = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOffset = tail.readUInt32LE(e + 16);
    if (entries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {         // zip64
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return { ok: false, xml: null, entries: 0 };
      const z64At = Number(tail.readBigUInt64LE(loc + 8));
      const z = readAt(fd, z64At, 56);
      if (z.length < 56 || z.readUInt32LE(0) !== 0x06064b50) return { ok: false, xml: null, entries: 0 };
      entries = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48));
    }
    if (cdSize > MAX_CD || cdOffset + cdSize > size) return { ok: false, xml: null, entries: 0 };
    const cd = readAt(fd, cdOffset, cdSize);
    let p = 0, best = null;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const method = cd.readUInt16LE(p + 10), compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
      const lower = name.toLowerCase();
      if (lower === 'comicinfo.xml') { best = { method, compSize, localOffset }; break; }
      if (!best && lower.endsWith('/comicinfo.xml')) best = { method, compSize, localOffset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!best || best.compSize > MAX_XML || best.localOffset === 0xFFFFFFFF) return { ok: true, xml: null, entries };
    const lh = readAt(fd, best.localOffset, 30);
    if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) return { ok: false, xml: null, entries };
    const start = best.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = readAt(fd, start, best.compSize);
    if (raw.length !== best.compSize) return { ok: false, xml: null, entries };
    const data = best.method === 0 ? raw : best.method === 8 ? zlib.inflateRawSync(raw) : null;
    return { ok: true, xml: data ? data.toString('utf8') : null, entries };
  } catch (err) {
    return { ok: false, xml: null, entries: 0 };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
  }
}

// Same places the library's own tools look for the Comic Vine issue id.
function parseComicInfo(xml) {
  const text = String(xml || '');
  if (!text) return null;
  let cvId = 0;
  for (const re of [/comicvine\.gamespot\.com\/[^<>\s"']*\/4000-(\d+)/i, /(?:Comic Vine )?(?:issue )?ID\s*[:#]?\s*4000-(\d+)/i, /Issue ID\s*[:#]?\s*(\d+)/i]) {
    const m = re.exec(text);
    if (m) { cvId = parseInt(m[1], 10); break; }
  }
  const tag = (name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(text); return m ? m[1].trim() : ''; };
  const year = tag('Year');
  return { cvId, series: tag('Series'), number: tag('Number'), year: /^\d{4}$/.test(year) ? year : '' };
}

// ---------------------------------------------------------------- names
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const normNum = (n) => { const s = String(n == null ? '' : n).trim().toLowerCase(); const m = /^0*(\d+)([a-z]?)$/.exec(s); return m ? m[1] + m[2] : s.replace(/[^a-z0-9.]+/g, ''); };

// "Thor 407 (1989) (Digital) (Shadowcat-Empire).cbz" -> { series: 'Thor', number: '407', year: '1989' }; best effort, '' when unsure.
function parseFileName(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const year = (/\((\d{4})\)/.exec(base) || [])[1] || '';
  const m = /^(.*?)[\s_]+#?0*(\d{1,4}[a-z]?)(?=[\s_(\-.,]|$)/i.exec(base.replace(/\s*\([^)]*\)/g, (s) => (/^\s*\(\d{4}\)$/.test(s) ? s : ' ')).trim() + ' ');
  return m ? { series: m[1].trim(), number: m[2], year } : { series: '', number: '', year };
}

// ---------------------------------------------------------------- scanning a folder
function* walk(dir, isCancelled) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of ents) {
    if (isCancelled && isCancelled()) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!ent.name.startsWith('.') && ent.name !== '$RECYCLE.BIN' && ent.name !== 'System Volume Information') yield* walk(full, isCancelled); }
    else if (ent.isFile() && COMIC_EXT.has(path.extname(ent.name).toLowerCase())) yield full;
  }
}

function sniffArchive(filePath, ext) {                         // cheap sanity check for formats we cannot open
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = readAt(fd, 0, 8);
    if (ext === '.cbr' || ext === '.rar') return b.subarray(0, 4).toString('latin1') === 'Rar!' || b.readUInt16LE(0) === 0x4B50;   // some .cbr are really zips
    if (ext === '.cb7' || ext === '.7z') return b.subarray(0, 2).toString('latin1') === '7z' || b.readUInt16LE(0) === 0x4B50;
    return true;
  } catch (e) { return false; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } } }
}

// cache: { [rel]: { size, mtimeMs, ...row } } from an earlier scan of the same folder; unchanged files are not read again.
function scanFolder(root, opts) {
  const o = opts || {};
  const cache = o.cache || {};
  const rows = [], nextCache = {};
  let seen = 0;
  for (const full of walk(root, o.isCancelled)) {
    if (o.isCancelled && o.isCancelled()) return { cancelled: true, rows: [], cache: nextCache };
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const ext = path.extname(full).toLowerCase();
    const hit = cache[rel];
    let row;
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      row = hit;
    } else {
      row = { rel, size: st.size, mtimeMs: st.mtimeMs, ext, cvId: 0, series: '', number: '', year: '', damaged: false };
      if (st.size === 0) row.damaged = true;
      else if (ext === '.cbz' || ext === '.zip') {
        const info = readZipInfo(full);
        if (!info.ok) row.damaged = true;
        const ci = parseComicInfo(info.xml);
        if (ci) Object.assign(row, { cvId: ci.cvId, series: ci.series, number: ci.number, year: ci.year });
      } else if (!sniffArchive(full, ext)) row.damaged = true;
      if (!row.series || !row.number) {
        const nm = parseFileName(path.basename(full));
        row.series = row.series || nm.series || path.basename(path.dirname(full));
        row.number = row.number || nm.number;
        row.year = row.year || nm.year;
      }
    }
    nextCache[rel] = row;
    rows.push(row);
    if (o.onProgress && (++seen % 50 === 0)) o.onProgress({ scanned: seen, current: rel });
  }
  if (o.onProgress) o.onProgress({ scanned: seen, current: '', done: true });
  return { cancelled: false, rows, cache: nextCache };
}

// ---------------------------------------------------------------- comparing with the catalog
// catalog: [[path under the mirror, comicVineId (0 = unknown), bytes, number, year], ...]
function seriesOfPath(p) { const parts = String(p).split('/'); return parts.length >= 2 ? parts[parts.length - 2] : ''; }

function compare(catalog, localRows) {
  const byCv = new Map(), byName = new Map(), bySeriesNum = new Map();
  const damaged = [];
  for (const r of localRows) {
    if (r.damaged) { damaged.push(r); continue; }          // never counted as owned
    if (r.cvId && !byCv.has(r.cvId)) byCv.set(r.cvId, r);
    const k = norm(r.series) + '|' + normNum(r.number);
    if (r.series && r.number) {
      if (!bySeriesNum.has(k)) bySeriesNum.set(k, []);
      bySeriesNum.get(k).push(r);
      byName.set(k + '|' + (r.year || ''), r);
    }
  }
  const have = [], haveByName = [], maybe = [], missing = [];
  const bySeries = new Map();
  let bytesMissing = 0;
  for (const row of catalog) {
    const [p, cv, size, number, year] = row;
    let local = cv ? byCv.get(cv) : null;
    if (local) { have.push({ path: p, local: local.rel, how: 'id' }); continue; }
    const k = norm(seriesOfPath(p)) + '|' + normNum(number);
    local = byName.get(k + '|' + (year || '')) || (year ? null : (bySeriesNum.get(k) || [])[0]);
    if (local) { haveByName.push({ path: p, local: local.rel, how: 'name' }); continue; }
    const near = (bySeriesNum.get(k) || [])[0];
    if (near && year && near.year && near.year !== year) { maybe.push({ path: p, local: near.rel, localYear: near.year, year }); }
    missing.push(row);                                      // a near match is shown to the member but never skips a download
    bytesMissing += size || 0;
    const s = seriesOfPath(p) || 'Other';
    const agg = bySeries.get(s) || { series: s, count: 0, bytes: 0 };
    agg.count++; agg.bytes += size || 0;
    bySeries.set(s, agg);
  }
  return {
    total: catalog.length, have: have.length, haveByName: haveByName.length, missing: missing.length, bytesMissing,
    maybe: maybe.length, maybeSample: maybe.slice(0, 20), damaged: damaged.map((r) => r.rel), damagedCount: damaged.length,
    missingRows: missing, perSeries: [...bySeries.values()].sort((a, b) => b.count - a.count),
  };
}

module.exports = { readZipInfo, parseComicInfo, parseFileName, scanFolder, compare, norm, normNum, COMIC_EXT };
