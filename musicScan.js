'use strict';
// "Only what I'm missing" for music: list the audio files in a member's own music folder and compare them with the site's catalog.
// Everything here runs on the member's PC. The folder's contents never leave it: only the catalog (a list of tracks) comes down.
// No file is opened: a track counts as owned when its artist folder, album folder and title match a library track by name. The audio
// format and the track number do not matter, so an MP3 copy of a FLAC album is still "owned". A zero-length or tiny file is flagged
// as damaged and never counted as owned.
const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma', '.ape', '.alac']);
const MIN_BYTES = 2048;                                       // anything smaller than this is not a whole track
const DISC_DIR = /^(?:cd|disc|disk)\s*0*(\d+)\b/i;

const strip = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Folder and title names compared as letters and digits only; a leading "the" is ignored ("The Beatles" = "Beatles").
function norm(s) { return strip(s).replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }

// "01 - Ambitionz.flac", "1-02. Title.mp3", "A1 Title.flac", "Track 07 Title.m4a" -> the title part only, normalised.
function titleKey(fileName) {
  let t = String(fileName || '').replace(/\.[^.]*$/, '');
  t = t.replace(/^\s*(?:track\s*)?(?:\d{1,2}\s*[-_.]\s*)?(?:\d{1,3}|[a-d]\d{1,2})\s*[-_.)\]]*\s+/i, '').replace(/^\s*[-_.]+\s*/, '');
  return norm(t) || norm(fileName);
}

// Artist / album / disc / title from a path under the music folder (or under the library's Music root).
// 3+ segments: artist/album/[disc folder/]file. 2 segments: album/file (no artist known). 1 segment: a loose file.
function keysOf(relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  const file = parts.pop() || '';
  let disc = '';
  if (parts.length >= 3) {
    const m = DISC_DIR.exec(parts[parts.length - 1]);
    if (m) { disc = 'd' + Number(m[1]); parts.pop(); }
  }
  const album = parts.length ? norm(parts[parts.length - 1]) : '';
  const artist = parts.length >= 2 ? norm(parts[parts.length - 2]) : '';
  return { artist, album, disc, title: titleKey(file) };
}

const key3 = (k) => k.artist + '|' + k.album + '|' + k.disc + '|' + k.title;
const key2 = (k) => k.album + '|' + k.disc + '|' + k.title;

function* walk(dir, isCancelled) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of ents) {
    if (isCancelled && isCancelled()) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!ent.name.startsWith('.') && ent.name !== '$RECYCLE.BIN' && ent.name !== 'System Volume Information') yield* walk(full, isCancelled); }
    else if (ent.isFile() && AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) yield full;
  }
}

// -> { cancelled, rows: [{ rel, size, damaged }] }. Only the file's size is read, never its contents.
function scanFolder(root, opts) {
  const o = opts || {};
  const rows = [];
  let seen = 0;
  for (const full of walk(root, o.isCancelled)) {
    if (o.isCancelled && o.isCancelled()) return { cancelled: true, rows: [] };
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    const rel = path.relative(root, full).replace(/\\/g, '/');
    rows.push({ rel, size: st.size, damaged: st.size < MIN_BYTES });
    if (o.onProgress && (++seen % 200 === 0)) o.onProgress({ scanned: seen, current: rel });
  }
  if (o.onProgress) o.onProgress({ scanned: seen, current: '', done: true });
  return { cancelled: false, rows };
}

// catalog: [[path under the Music mirror, bytes], ...]; localRows from scanFolder.
// -> { total, have, missing, damaged, albums: { complete, partial, none }, missingRows: [[path, 0, bytes]] } (missingRows keep the
// shape the download batcher uses). A library track whose only local match is damaged counts as missing, so it is downloaded again.
function compare(catalog, localRows) {
  // good3 / bad3: artist|album|disc|title of whole / damaged local files. noArtist: album|disc|title of whole files that sit directly in an album folder.
  const good3 = new Set(), bad3 = new Set(), noArtist = new Set();
  for (const r of localRows || []) {
    const k = keysOf(r.rel);
    if (!k.title) continue;
    (r.damaged ? bad3 : good3).add(key3(k));
    if (!k.artist && !r.damaged) noArtist.add(key2(k));
  }
  const missingRows = [], albums = new Map();
  let have = 0, damaged = 0;
  for (const it of catalog || []) {
    const p = String(it[0]), size = Number(it[1]) || 0;
    const segs = p.split('/');
    const k = keysOf(p);
    // Artist known on both sides: artist, album and title must agree. A local folder with no artist level (album/file) is matched on album and title.
    const owned = good3.has(key3(k)) || noArtist.has(key2(k));
    const albumKey = segs[0] + '/' + segs[1];
    const a = albums.get(albumKey) || { have: 0, want: 0 };
    a.want++;
    if (owned) { have++; a.have++; }
    else {
      if (bad3.has(key3(k))) damaged++;
      missingRows.push([p, 0, size]);
    }
    albums.set(albumKey, a);
  }
  let complete = 0, partial = 0, none = 0;
  for (const a of albums.values()) { if (a.have === a.want) complete++; else if (a.have > 0) partial++; else none++; }
  return { total: (catalog || []).length, have, missing: missingRows.length, damaged, albums: { complete, partial, none }, missingRows };
}

function planBatches(rows, maxFiles, maxBytes) {
  const batches = [];
  let cur = [], bytes = 0;
  for (const r of rows || []) {
    const size = Number(r && r[2]) || 0;
    if (cur.length && (cur.length >= maxFiles || bytes + size > maxBytes)) { batches.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

module.exports = { AUDIO_EXT, scanFolder, compare, planBatches, keysOf, titleKey, norm };
