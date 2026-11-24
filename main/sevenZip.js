'use strict';
// 7-Zip: describing the 7-Zip tool found and finding the archives in a download to unpack (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const fs = require('fs');
const path = require('path');

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

module.exports = { snip7z, describe7zTool, find7zArchivesInDir };
