'use strict';
// 7-Zip: describing the 7-Zip tool found and finding the archives in a download to unpack (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const fs = require('fs');
const path = require('path');
const { logToFile } = require('./log');
const { spawnSync } = require('child_process');
const { app } = require('electron');

// Diagnostics for extraction failures: one-line summaries that go to debug.log so a member
// can paste the "[7z]" lines instead of us guessing why the tool would not run.
function snip7z(text, max = 400) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function describe7zTool(exe) {
  try {
    const st = fs.statSync(exe);
    let exec = 'n/a';
    if (process.platform !== 'win32') { try { fs.accessSync(exe, fs.constants.X_OK); exec = 'yes'; } catch (e) { exec = 'no'; } }
    return `path=${exe} size=${st.size} mode=${(st.mode & 0o777).toString(8)} executable=${exec} platform=${process.platform}/${process.arch}`;
  } catch (e) {
    return `path=${exe} stat failed: ${e && e.message ? e.message : e}`;
  }
}

function find7zArchivesInDir(rootDir) {
  const results = [];
  const seen = new Set();

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      if (!ent) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = String(ent.name || '').toLowerCase();
      if (lower.endsWith('.7z.001')) {
        const base = lower.slice(0, -('.001'.length));
        if (!seen.has(full)) {
          results.push(full);
          seen.add(full);
        }
        seen.add(path.join(dir, base));
        continue;
      }
      if (lower.endsWith('.7z')) {
        if (seen.has(full)) continue;
        results.push(full);
        seen.add(full);
      }
    }
  };

  walk(rootDir);
  return results;
}

// On Linux and macOS the bundled 7za can lack the execute bit, and an install under /opt
// (root-owned) or an AppImage mount (read-only) won't let the app chmod it, so running it
// fails and extraction reports "Failed to validate archive contents". When it can't be run
// in place, run a private copy from the app's own writable folder.
function ensureRunnable7z(exe, force = false) {
  if (!exe || process.platform === 'win32') return exe;
  const canExec = () => { try { fs.accessSync(exe, fs.constants.X_OK); return true; } catch (e) { return false; } };
  // force: the file looks executable but starting it still failed (seen on an AppImage), so
  // skip these checks and use a private copy.
  if (!force && canExec()) return exe;
  if (!force && process.env.ARMGDDN_TEST_NO_CHMOD !== '1') {
    try { fs.chmodSync(exe, 0o755); } catch (e) { }
    if (canExec()) return exe;
  }
  try {
    const dir = path.join(app.getPath('userData'), '7z-bin');
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, path.basename(exe));
    let current = false;
    try { current = fs.statSync(copy).size === fs.statSync(exe).size; } catch (e) { }
    if (!current) fs.copyFileSync(exe, copy);
    fs.chmodSync(copy, 0o755);
    try { logToFile(`[7z] Bundled extraction tool is not runnable in place; using a private copy: ${copy}`); } catch (e) { }
    return copy;
  } catch (e) {
    try { logToFile(`[7z] Could not prepare a runnable copy of the extraction tool: ${e && e.message ? e.message : e}`); } catch (e2) { }
    return exe;
  }
}

function probe7z(exe) {
  try {
    const r = spawnSync(exe, ['i'], { encoding: 'utf8', timeout: 10000 });
    if (!r.error && r.status === 0) {
      const first = String(r.stdout || '').split(/\r?\n/).find((l) => l.trim()) || '';
      return { ok: true, note: snip7z(first, 100) };
    }
    const why = r.error
      ? `${r.error.code || ''} ${r.error.message || r.error}`.trim()
      : `exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''} ${snip7z(r.stderr, 120)}`.trim();
    return { ok: false, note: why };
  } catch (e) {
    return { ok: false, note: e && e.message ? e.message : String(e) };
  }
}

module.exports = { snip7z, describe7zTool, find7zArchivesInDir, ensureRunnable7z, probe7z };
