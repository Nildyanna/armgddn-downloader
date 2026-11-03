'use strict';
// Checks downloaded files against the checksums (MD5) the site lists for them.
// The site's manifest carries an md5 for every file the cloud drive reports one for; the Companion keeps those next to the download so a
// finished download can be checked at any time (right after it finishes, from the downloads list, or from the site's downloads panel).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_DIR_NAME = 'hash-manifests';
const MAX_MANIFESTS = 300;
const MD5_RE = /^[0-9a-f]{32}$/i;

function manifestPath(userDataDir, id) {
  const raw = String(id == null ? '' : id);
  const safe = /^[A-Za-z0-9._-]{1,100}$/.test(raw) ? raw : crypto.createHash('sha1').update(raw).digest('hex');
  return path.join(userDataDir, MANIFEST_DIR_NAME, safe + '.json');
}

function expectedMd5(file) {
  const v = file && file.md5 != null ? String(file.md5) : '';
  return MD5_RE.test(v) ? v.toLowerCase() : null;
}

// How many of a download's files carry a checksum.
function countHashable(files) {
  return (Array.isArray(files) ? files : []).filter((f) => f && f.name && expectedMd5(f)).length;
}

function pruneOld(dir) {
  try {
    const entries = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
      const p = path.join(dir, n);
      return { p, t: fs.statSync(p).mtimeMs };
    }).sort((a, b) => b.t - a.t);
    for (const e of entries.slice(MAX_MANIFESTS)) { try { fs.unlinkSync(e.p); } catch (e2) { /* ignore */ } }
  } catch (e) { /* ignore */ }
}

// record: { id, name, downloadDir, files: [{ name, size, md5 }] }. Returns the stored document, or null when no file has a checksum.
function saveManifest(userDataDir, record) {
  if (!record || record.id == null) return null;
  const all = Array.isArray(record.files) ? record.files : [];
  const files = all.filter((f) => f && f.name && expectedMd5(f)).map((f) => ({ name: String(f.name), size: Number(f.size) || 0, md5: expectedMd5(f) }));
  if (!files.length) return null;
  const file = manifestPath(userDataDir, record.id);
  const prev = loadManifest(userDataDir, record.id);
  const doc = {
    id: String(record.id),
    name: String(record.name || ''),
    downloadDir: String(record.downloadDir || ''),
    createdAt: prev && prev.createdAt ? prev.createdAt : Date.now(),
    totalFiles: all.length,
    files,
    lastCheck: prev && prev.lastCheck ? prev.lastCheck : null
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
    pruneOld(path.dirname(file));
  } catch (e) { return null; }
  return doc;
}

function loadManifest(userDataDir, id) {
  try {
    const doc = JSON.parse(fs.readFileSync(manifestPath(userDataDir, id), 'utf8'));
    return doc && Array.isArray(doc.files) ? doc : null;
  } catch (e) { return null; }
}

function saveResult(userDataDir, id, result) {
  const doc = loadManifest(userDataDir, id);
  if (!doc) return;
  doc.lastCheck = result;
  try {
    const file = manifestPath(userDataDir, id);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  } catch (e) { /* ignore */ }
}

function md5OfFile(filePath, isCancelled) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    const s = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    s.on('data', (chunk) => {
      h.update(chunk);
      if (isCancelled && isCancelled()) { s.destroy(); resolve(null); }
    });
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// doc: a stored manifest. opts: resolvePath(name) -> absolute path or null; onProgress({ done, total, name }); isCancelled().
// Returns { at, total, notChecked, ok, bad: [{ name, reason }], missing: [name], cancelled }.
async function verifyManifest(doc, opts) {
  const o = opts || {};
  const result = { at: Date.now(), total: doc.files.length, notChecked: Math.max(0, (Number(doc.totalFiles) || doc.files.length) - doc.files.length), ok: 0, bad: [], missing: [], cancelled: false };
  for (let i = 0; i < doc.files.length; i++) {
    if (o.isCancelled && o.isCancelled()) { result.cancelled = true; break; }
    const f = doc.files[i];
    const p = o.resolvePath ? o.resolvePath(f.name) : null;
    let st = null;
    try { st = p ? fs.statSync(p) : null; } catch (e) { st = null; }
    if (!st || !st.isFile()) {
      result.missing.push(f.name);
    } else if (f.size > 0 && st.size !== f.size) {
      result.bad.push({ name: f.name, reason: 'wrong size' });      // cut short or padded: no need to read it
    } else {
      try {
        const got = await md5OfFile(p, o.isCancelled);
        if (got === null) { result.cancelled = true; break; }
        if (got === f.md5) result.ok++; else result.bad.push({ name: f.name, reason: 'does not match' });
      } catch (e) {
        result.bad.push({ name: f.name, reason: 'could not be read' });
      }
    }
    if (o.onProgress) { try { o.onProgress({ done: i + 1, total: doc.files.length, name: f.name }); } catch (e) { /* ignore */ } }
  }
  return result;
}

// One plain sentence for the downloads list.
function describeResult(r) {
  if (!r) return '';
  if (r.cancelled) return 'File check stopped.';
  const parts = [];
  if (r.bad.length === 0 && r.missing.length === 0) {
    parts.push(`All ${r.ok} checked file${r.ok === 1 ? '' : 's'} match the originals.`);
  } else {
    if (r.bad.length) parts.push(`${r.bad.length} file${r.bad.length === 1 ? '' : 's'} did not match: ${r.bad.slice(0, 3).map((b) => b.name).join(', ')}${r.bad.length > 3 ? ', ...' : ''}.`);
    if (r.missing.length) parts.push(`${r.missing.length} file${r.missing.length === 1 ? ' was' : 's were'} not found (moved, deleted or extracted?).`);
    if (r.ok) parts.push(`${r.ok} matched.`);
  }
  if (r.notChecked) parts.push(`${r.notChecked} file${r.notChecked === 1 ? '' : 's'} had no checksum to compare.`);
  return parts.join(' ');
}

module.exports = { MANIFEST_DIR_NAME, expectedMd5, countHashable, saveManifest, loadManifest, saveResult, md5OfFile, verifyManifest, describeResult, manifestPath };
