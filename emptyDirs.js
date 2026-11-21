'use strict';
// After a download is cancelled and its files are removed, the folders it made are empty. This removes them again, and nothing else:
// - only folders that are really empty (rmdir, never recursive: a folder that still holds anything, even one file, is left alone),
// - only inside the download folder, never the download folder itself or anything above it,
// - the folders given and their parents up to (not including) that limit, deepest first.
// The caller decides when it is safe (for example, not while another running download writes into the same folder).
const fs = require('fs');
const path = require('path');

function inside(base, p) {
  const rel = path.relative(base, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function pruneEmptyDirs(dirs, stopAt, fsp = fs.promises) {
  const limit = path.resolve(stopAt);
  const todo = new Set();
  for (const d of dirs || []) {
    let cur = path.resolve(String(d || ''));
    while (inside(limit, cur)) { todo.add(cur); cur = path.dirname(cur); }
  }
  const removed = [];
  for (const d of Array.from(todo).sort((a, b) => b.length - a.length)) {
    try { await fsp.rmdir(d); removed.push(d); } catch (e) { /* not empty, already gone, or not ours to remove: leave it */ }
  }
  return removed;
}

module.exports = { pruneEmptyDirs };
