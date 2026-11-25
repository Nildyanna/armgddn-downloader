'use strict';
// Free-space check before a download starts or resumes (2026-11-25). Engine reports Nov 18-25: 22 downloads from 4 members failed on a
// full disk after downloading gigabytes. The old check compared the free space with this download alone, so two downloads to the same
// drive both "fit", and a Resume was never checked at all.
//
// THE RULE (per drive; downloads, the unpack folder and other downloads on the same drive are added up):
//   need on the download drive  = bytes of this download still to come
//                               + archive bytes again, when its .7z files will be unpacked automatically onto the same drive
//                               + bytes still to come for the other unfinished downloads on that drive (and their unpack room)
//   need on the unpack drive    = archive bytes, when the member's Extract folder is on another drive
//   required = need + margin, margin = 2% of need, at least 1 GB
// Only .7z / .7z.001 parts count as archive bytes: the app unpacks those (main/completion.js, find7zArchivesInDir) beside the download
// or into the Extract folder, and keeps the archives afterwards, so the unpacked files need the archive's size again. Zips are never
// unpacked automatically. Repacks are compressed, so a game can unpack a little bigger than its archive: the margin covers most of that.
//
// "Bytes still to come" counts what is already on disk: a finished file counts 0, a resumable partial (.armpart marker) its size, a
// segmented partial (.armseg record) the bytes its record says are done.
//
// Drives: on Windows the drive letter ("D:"); elsewhere the mount point (the highest parent folder on the same device). Two folders on
// the same device are one drive. A drive whose free space cannot be read is not checked (the download starts, as before).
const fs = require('fs');
const nodePath = require('path');

const GB = 1024 * 1024 * 1024;
const MIN_MARGIN = 1 * GB;
const MARGIN_FRACTION = 0.02;
const ARCHIVE_RE = /\.7z(\.\d{3})?$/i;

const marginFor = (bytes) => Math.max(MIN_MARGIN, Math.ceil(Math.max(0, bytes) * MARGIN_FRACTION));
const isAutoUnpackArchive = (name) => ARCHIVE_RE.test(String(name || ''));
const pathLib = (platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);

// "48 GB", "9.5 GB", "700 MB": the units Windows Explorer shows (1 GB = 1024^3 bytes).
function formatGB(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < GB) return `${Math.max(1, Math.round(b / (1024 * 1024)))} MB`;
  const g = b / GB;
  return `${g < 10 ? Math.round(g * 10) / 10 : Math.round(g)} GB`;
}

function existingDir(p, fsx, pl) {
  let cur = p;
  for (let i = 0; i < 100; i++) {
    try { if (fsx.existsSync(cur)) return cur; } catch (e) { }
    const parent = pl.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

// { key, label, probe }: key groups folders on one drive, label is what the member reads, probe is a folder that exists on it.
function driveOf(p, { platform = process.platform, fsx = fs } = {}) {
  const pl = pathLib(platform);
  const abs = pl.resolve(String(p || ''));
  const probe = existingDir(abs, fsx, pl);
  let dev = null;
  try { const st = fsx.statSync(probe); if (st && st.dev !== undefined && st.dev !== null) dev = String(st.dev); } catch (e) { }
  if (platform === 'win32') {
    const root = pl.parse(abs).root || '';
    const label = root.replace(/[\\/]+$/, '');
    return { key: 'win:' + (dev !== null ? dev : root.toLowerCase()), label: /^[A-Za-z]:$/.test(label) ? label.toUpperCase() : (label || abs), probe, windows: true };
  }
  let mount = probe;
  if (dev !== null) {
    for (let i = 0; i < 100; i++) {
      const parent = pl.dirname(mount);
      if (parent === mount) break;
      let d = null;
      try { d = String(fsx.statSync(parent).dev); } catch (e) { break; }
      if (d !== dev) break;
      mount = parent;
    }
  } else mount = pl.parse(abs).root || probe;
  return { key: 'dev:' + (dev !== null ? dev : mount), label: mount, probe, windows: false };
}

function freeBytes(probe, fsx = fs) {
  try {
    if (typeof fsx.statfsSync !== 'function') return -1;
    const st = fsx.statfsSync(probe);
    const v = Number(st.bavail) * Number(st.bsize);
    return Number.isFinite(v) && v >= 0 ? v : -1;
  } catch (e) { return -1; }
}

// Bytes of `files` (each { name, size }) still to come into `dir`, counting what is already on disk.
function remainingBytes(dir, files, { platform = process.platform, fsx = fs } = {}) {
  const pl = pathLib(platform);
  let left = 0;
  for (const f of Array.isArray(files) ? files : []) {
    const size = Math.max(0, Number(f && f.size) || 0);
    if (!size) continue;
    const rel = String((f && f.name) || '').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..');
    if (!dir || !rel.length) { left += size; continue; }
    const out = pl.join(dir, ...rel);
    let have = 0;
    try {
      if (fsx.existsSync(out + '.armseg')) {
        const s = JSON.parse(fsx.readFileSync(out + '.armseg', 'utf8'));
        if (s && Array.isArray(s.done) && Number(s.total) === size) have = s.done.reduce((a, b) => a + (Number(b) || 0), 0);
      } else if (fsx.existsSync(out)) {
        const n = Number(fsx.statSync(out).size) || 0;
        // a finished file, or one the resumable engine is appending to (.armpart); a file of another size with no marker is replaced
        if (n === size || fsx.existsSync(out + '.armpart')) have = Math.min(n, size);
      }
    } catch (e) { have = 0; }
    left += Math.max(0, size - have);
  }
  return left;
}

const archiveBytes = (files) => (Array.isArray(files) ? files : []).reduce((a, f) => a + (f && isAutoUnpackArchive(f.name) ? Math.max(0, Number(f.size) || 0) : 0), 0);

// needs: [{ dir, bytes, why }] -> { ok, drives: [{ key, label, windows, need, required, free, short, parts }], short: first short drive or null }
function checkSpace(needs, { platform = process.platform, fsx = fs } = {}) {
  const drives = new Map();
  for (const n of Array.isArray(needs) ? needs : []) {
    const bytes = Math.max(0, Number(n && n.bytes) || 0);
    if (!bytes || !n.dir) continue;
    const d = driveOf(n.dir, { platform, fsx });
    if (!drives.has(d.key)) drives.set(d.key, { ...d, need: 0, parts: [] });
    const e = drives.get(d.key);
    e.need += bytes;
    e.parts.push({ why: n.why || 'download', bytes });
  }
  const out = [];
  for (const e of drives.values()) {
    const free = freeBytes(e.probe, fsx);
    const required = e.need + marginFor(e.need);
    out.push({ key: e.key, label: e.label, windows: e.windows, need: e.need, required, free, short: free >= 0 && free < required, parts: e.parts });
  }
  const short = out.find((d) => d.short) || null;
  return { ok: !short, drives: out, short };
}

// What a starting (or resuming) download needs, as checkSpace() input.
//   downloadDir   where its files go
//   files         its files ({ name, size })
//   unpack        true when its .7z files will be unpacked automatically
//   extractDir    where they are unpacked (default: downloadDir)
//   others        other unfinished downloads: [{ dir, bytes, unpackDir, unpackBytes }]
function startNeeds({ downloadDir, files, unpack = false, extractDir = '', others = [] }, opts = {}) {
  const needs = [{ dir: downloadDir, bytes: remainingBytes(downloadDir, files, opts), why: 'download' }];
  if (unpack) {
    const a = archiveBytes(files);
    if (a > 0) needs.push({ dir: extractDir || downloadDir, bytes: a, why: 'unpack' });
  }
  for (const o of Array.isArray(others) ? others : []) {
    if (o && o.dir && o.bytes > 0) needs.push({ dir: o.dir, bytes: o.bytes, why: 'other downloads' });
    if (o && o.unpackBytes > 0) needs.push({ dir: o.unpackDir || o.dir, bytes: o.unpackBytes, why: 'other downloads' });
  }
  return needs;
}

// The words in the box: "This needs 48 GB, your D: drive has 31 GB free."
function shortMessage(drive) {
  const where = drive.windows ? `your ${drive.label} drive` : `the drive at ${drive.label}`;
  return `This needs ${formatGB(drive.required)}, ${where} has ${formatGB(drive.free)} free.`;
}
function shortDetail(drive) {
  const sum = (why) => drive.parts.filter((p) => p.why === why).reduce((a, p) => a + p.bytes, 0);
  const lines = [];
  if (sum('download')) lines.push(`${formatGB(sum('download'))} still to download`);
  if (sum('unpack')) lines.push(`${formatGB(sum('unpack'))} to unpack the .7z files`);
  if (sum('other downloads')) lines.push(`${formatGB(sum('other downloads'))} for your other downloads that are not finished yet`);
  lines.push(`${formatGB(drive.required - drive.need)} spare room`);
  return `That is ${lines.join(', ')}.\n\nIf the drive fills up, the download stops part-way. Free up some space, choose a folder on another drive, or start anyway.`;
}

// The start flow, with the box and the folder picker passed in (Electron dialogs in the app, plain functions in the tests).
//   check(baseDir)  -> checkSpace() result for the download going into baseDir
//   ask(result)     -> 'folder' | 'anyway' | 'nounpack' | 'cancel'
//   pickFolder()    -> a folder, or null when the member closed the picker
// Returns { start: boolean, baseDir, skipUnpack, forced, result }.
async function decideStart({ baseDir, check, ask, pickFolder, maxRounds = 5 }) {
  let dir = baseDir;
  let skipUnpack = false;
  for (let round = 0; round < maxRounds; round++) {
    const result = await check(dir, { skipUnpack });
    if (result.ok) return { start: true, baseDir: dir, skipUnpack, forced: false, result };
    const choice = await ask(result, { round, skipUnpack });
    if (choice === 'anyway') return { start: true, baseDir: dir, skipUnpack, forced: true, result };
    if (choice === 'nounpack') { skipUnpack = true; continue; }
    if (choice === 'folder') { const picked = pickFolder ? await pickFolder() : null; if (picked) dir = picked; continue; }
    return { start: false, baseDir: dir, skipUnpack, forced: false, result };
  }
  return { start: false, baseDir: dir, skipUnpack, forced: false, result: null };
}

module.exports = { GB, MIN_MARGIN, MARGIN_FRACTION, marginFor, isAutoUnpackArchive, formatGB, driveOf, freeBytes, remainingBytes, archiveBytes, checkSpace, startNeeds, shortMessage, shortDetail, decideStart };
