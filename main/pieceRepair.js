'use strict';
// Repair instead of re-download (2026-11-25). When the file check finds a file that does not match its checksum, the site is asked for
// that file's piece fingerprints (a SHA-256 for every 64 MiB piece, computed once on the server), the copy on disk is hashed the same
// way, and only the pieces that differ are downloaded again into the file. The whole file is then checked again. If the site has no
// fingerprints, the repair cannot find the bad pieces, or the file still does not match, the whole file is downloaded again instead.
// Until 6.13 a damaged file was only reported: downloading the game again skipped it (same size on disk), so the member had to find
// and delete it by hand.
// No Electron here: everything that talks to the network or the engine is passed in, so the tests can drive it with fixtures.
const fs = require('fs');
const crypto = require('crypto');
const { md5OfFile } = require('../hashCheck');

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_WAIT_MS = 20 * 60 * 1000;      // how long to wait for the site to finish reading the file (one 50 GB part at ~90 MiB/s ≈ 9 min)

function formatSize(bytes) {
  const mb = bytes / 1048576;
  if (mb < 1024) return `${Math.max(1, Math.round(mb))} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function repairingText(count, bytes) {
  return `Repairing ${count} damaged part${count === 1 ? '' : 's'} (${formatSize(bytes)})…`;
}

// SHA-256 of every pieceSize slice of a local file.
function hashLocalPieces(filePath, pieceSize, isCancelled) {
  return new Promise((resolve, reject) => {
    const out = [];
    let cur = crypto.createHash('sha256');
    let inPiece = 0;
    const s = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    s.on('data', (buf) => {
      let off = 0;
      while (off < buf.length) {
        const take = Math.min(pieceSize - inPiece, buf.length - off);
        cur.update(buf.subarray(off, off + take));
        inPiece += take; off += take;
        if (inPiece === pieceSize) { out.push(cur.digest('hex')); cur = crypto.createHash('sha256'); inPiece = 0; }
      }
      if (isCancelled && isCancelled()) { s.destroy(); resolve(null); }
    });
    s.on('error', reject);
    s.on('end', () => { if (inPiece > 0) out.push(cur.digest('hex')); resolve(out); });
  });
}

// Indexes of the pieces whose local hash differs from the server's (or is missing).
function damagedPieces(local, remote) {
  const bad = [];
  for (let i = 0; i < remote.length; i++) if (local[i] !== remote[i]) bad.push(i);
  return bad;
}

function bytesOf(pieces, pieceSize, size) {
  return pieces.reduce((n, i) => n + Math.max(0, Math.min(pieceSize, size - i * pieceSize)), 0);
}

function validFingerprints(fp, size) {
  if (!fp || !(fp.pieceSize >= 1024 * 1024) || !Array.isArray(fp.sha256)) return false;
  if (fp.size != null && Number(fp.size) !== size) return false;
  return fp.sha256.length === Math.ceil(size / fp.pieceSize) && fp.sha256.every((h) => HEX64.test(String(h)));
}

// Asks the site until it answers with fingerprints, says it cannot, or the wait runs out.
// getFingerprints() -> { state: 'ready', pieceSize, sha256 } | { state: 'computing', retryAfter } | { state: 'unavailable', reason }
async function waitForFingerprints(getFingerprints, { sleep, now = Date.now, maxWaitMs = MAX_WAIT_MS, isCancelled, onWaiting } = {}) {
  const started = now();
  for (;;) {
    if (isCancelled && isCancelled()) return { state: 'unavailable', reason: 'cancelled' };
    let r;
    try { r = await getFingerprints(); } catch (e) { return { state: 'unavailable', reason: 'request failed: ' + (e && e.message ? e.message : e) }; }
    if (!r || r.state !== 'computing') return r || { state: 'unavailable', reason: 'no answer' };
    const waitS = Math.max(2, Math.min(120, Number(r.retryAfter) || 10));
    if (now() - started + waitS * 1000 > maxWaitMs) return { state: 'unavailable', reason: 'timed out waiting for the server' };
    if (onWaiting) { try { onWaiting(waitS); } catch (e) { } }
    await sleep(waitS * 1000);
  }
}

// Ensures the file has the expected size: cut off anything extra, or extend a short file (the added bytes are zeros, so their pieces
// do not match and get downloaded).
function fitSize(filePath, size) {
  const st = fs.statSync(filePath);
  if (st.size !== size) fs.truncateSync(filePath, size);
  return st.size;
}

// Repairs one file. opts:
//   filePath, size, md5          the local file and what it should be
//   getFingerprints()            see waitForFingerprints
//   fetchPieces({ pieceSize, pieces, full })  downloads those pieces into the file (resolves when done, rejects on failure)
//   onStatus(text)               member-visible progress text
//   sleep(ms), isCancelled(), maxWaitMs, fullPieceSize (piece size for the whole-file fallback, default 64 MiB)
// Resolves { outcome: 'repaired' | 'redownloaded' | 'failed' | 'cancelled', pieces, bytes, reason }.
async function repairFile(opts) {
  const { filePath, size, md5, getFingerprints, fetchPieces, onStatus = () => { }, isCancelled = () => false } = opts;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const verify = opts.verifyMd5 || ((p) => md5OfFile(p, isCancelled));
  const fullPieceSize = opts.fullPieceSize || 64 * 1024 * 1024;
  let reason = '';

  const full = async (why) => {
    if (isCancelled()) return { outcome: 'cancelled', reason: why };
    onStatus('Downloading the damaged file again…');
    const all = Array.from({ length: Math.ceil(size / fullPieceSize) }, (_, i) => i);
    try {
      try { fitSize(filePath, size); } catch (e) { fs.writeFileSync(filePath, ''); fs.truncateSync(filePath, size); }
      await fetchPieces({ pieceSize: fullPieceSize, pieces: all, full: true });
    } catch (e) {
      return { outcome: isCancelled() ? 'cancelled' : 'failed', reason: `${why}; download again failed: ${e && e.message ? e.message : e}`, pieces: all.length, bytes: size };
    }
    const got = await verify(filePath);
    if (got === null) return { outcome: 'cancelled', reason: why };
    return got === md5
      ? { outcome: 'redownloaded', reason: why, pieces: all.length, bytes: size }
      : { outcome: 'failed', reason: `${why}; still does not match after downloading again`, pieces: all.length, bytes: size };
  };

  const fp = await waitForFingerprints(getFingerprints, { sleep, isCancelled, maxWaitMs: opts.maxWaitMs, onWaiting: () => onStatus('Finding the damaged parts…') });
  if (isCancelled()) return { outcome: 'cancelled', reason: 'cancelled' };
  if (!fp || fp.state !== 'ready') return full(`no fingerprints (${fp && fp.reason ? fp.reason : 'unavailable'})`);
  if (!validFingerprints(fp, size)) return full('fingerprints do not fit this file');

  try { fitSize(filePath, size); } catch (e) { return full('could not resize the file'); }
  onStatus('Finding the damaged parts…');
  let local;
  try { local = await hashLocalPieces(filePath, fp.pieceSize, isCancelled); } catch (e) { return full('could not read the file'); }
  if (local === null) return { outcome: 'cancelled', reason: 'cancelled' };
  const bad = damagedPieces(local, fp.sha256);
  if (!bad.length) return full('every piece matched but the whole file did not');
  const bytes = bytesOf(bad, fp.pieceSize, size);
  onStatus(repairingText(bad.length, bytes));
  try {
    await fetchPieces({ pieceSize: fp.pieceSize, pieces: bad, full: false });
  } catch (e) {
    if (isCancelled()) return { outcome: 'cancelled', reason: 'cancelled' };
    reason = `repair download failed: ${e && e.message ? e.message : e}`;
    return full(reason);
  }
  onStatus('Checking the repaired file…');
  const got = await verify(filePath);
  if (got === null) return { outcome: 'cancelled', reason: 'cancelled' };
  if (got === md5) return { outcome: 'repaired', pieces: bad.length, bytes };
  return full('still did not match after repair');
}

module.exports = { repairFile, hashLocalPieces, damagedPieces, waitForFingerprints, validFingerprints, repairingText, formatSize, bytesOf, MAX_WAIT_MS };
