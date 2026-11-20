// Downloads that were running or paused when the app closed (an update, a crash, the PC restarting), kept in a small file so the Downloads
// tab can show them again as "Paused" and Resume can ask the site for a fresh link. Only what is needed to start the same download again is
// stored: its name, the library and path it came from, where it was going, and how far it had got. No link, no token, no file list.
'use strict';
const fs = require('fs');
const path = require('path');

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;
const MAX_BATCH_ITEMS = 500;

function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const id = typeof e.id === 'string' ? e.id : '';
  const r = e.resume && typeof e.resume === 'object' ? e.resume : null;
  if (!id || id.length > 100 || !r) return null;
  const remote = typeof r.remote === 'string' ? r.remote.slice(0, 200) : '';
  const dest = r.dest === 'music' || r.dest === 'comics' ? r.dest : '';
  const strs = (a, n, len) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x && x.length <= len).slice(0, n) : []);
  const paths = strs(r.paths, MAX_BATCH_ITEMS, 1000);           // a batch of picked items: the items themselves are asked for again
  const p = typeof r.path === 'string' ? r.path.slice(0, 1000) : '';
  if (!remote || (!paths.length && (!p || p.startsWith('__batch__/')))) return null;
  return {
    id,
    name: String(e.name || 'Download').slice(0, 300),
    resume: paths.length ? { remote, paths, exclude: strs(r.exclude, 20, 300), dest } : { remote, path: p, dest },
    grantId: typeof e.grantId === 'string' && /^[a-f0-9]{8,64}$/.test(e.grantId) ? e.grantId : '',   // the site's direct-from-Drive grant, so a resume or cancel can close it
    totalSize: Math.max(0, Number(e.totalSize) || 0),
    progress: Math.max(0, Math.min(99, Math.round(Number(e.progress) || 0))),
    fileCount: Math.max(0, Math.round(Number(e.fileCount) || 0)),
    startTime: typeof e.startTime === 'string' ? e.startTime : new Date().toISOString(),
    savedAt: Number(e.savedAt) || Date.now()
  };
}

function load(file, now = Date.now()) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.map(clean).filter((e) => e && now - e.savedAt < KEEP_MS).slice(0, MAX_ENTRIES);
  } catch (e) { return []; }
}

function save(file, list) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list.slice(0, MAX_ENTRIES)));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) { return false; }
}

function upsert(file, entry) {
  const c = clean({ ...entry, savedAt: Date.now() });
  if (!c) return false;
  const list = load(file).filter((x) => x.id !== c.id);
  list.unshift(c);
  return save(file, list);
}

function drop(file, id) {
  const list = load(file);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  return save(file, next);
}

module.exports = { load, save, upsert, drop, clean, KEEP_MS };
