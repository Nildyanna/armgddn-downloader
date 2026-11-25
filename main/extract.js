'use strict';
// Unpacking finished downloads with 7-Zip (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { describe7zFailure } = require('../sevenZipErrors');
const { parseSltListing } = require('../setupPick');
const { logToFile } = require('./log');
const { ensureRunnable7z, probe7z, describe7zTool, snip7z } = require('./sevenZip');
const { sanitizeRelativePath, resolveInside } = require('./util');
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolve7zTool() {
  if (ctx._resolved7z) return ctx._resolved7z;
  const bundled = ctx.get7zPath();
  const candidates = [];
  if (bundled && fs.existsSync(bundled)) {
    candidates.push({ label: 'bundled', get: () => ensureRunnable7z(bundled) });
    if (process.platform !== 'win32') candidates.push({ label: 'private copy', get: () => ensureRunnable7z(bundled, true) });
  }
  if (process.platform !== 'win32') {
    for (const name of ['7zz', '7z', '7za']) candidates.push({ label: `system ${name}`, get: () => name });
  }
  const tried = new Set();
  const failures = [];
  for (const c of candidates) {
    const exe = c.get();
    if (!exe || tried.has(exe)) continue;
    tried.add(exe);
    const r = probe7z(exe);
    try { logToFile(`[7z] Tool candidate "${c.label}" (${exe}): ${r.ok ? 'works' : 'failed'} - ${r.note}`); } catch (e) { }
    if (r.ok) {
      ctx._resolved7z = exe;
      ctx._resolved7zFailures = [];
      try { if (exe.includes(path.sep)) logToFile(`[7z] Tool: ${describe7zTool(exe)}`); } catch (e) { }
      return exe;
    }
    failures.push(`${c.label}: ${r.note}`);
  }
  ctx._resolved7zFailures = failures;
  return null;
}

// Where an archive is unpacked: beside the download, or, when the member set an Extract folder that exists, into a folder of the same name there.
function extractTarget(downloadDir) {
  try {
    const f = ctx.settings && typeof ctx.settings.extractFolder === 'string' ? ctx.settings.extractFolder.trim() : '';
    if (f && path.isAbsolute(f) && fs.existsSync(f)) return path.join(f, path.basename(downloadDir));
    if (f) logToFile('[extract] Extract folder is not available; unpacking beside the download instead');
  } catch (e) { }
  return downloadDir;
}

function run7zExtract(archivePath, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    const bundledExe = ctx.get7zPath();
    if (!bundledExe) {
      reject(new Error('7z extraction tool not found'));
      return;
    }
    try { logToFile(`[7z] Extract start: ${archivePath} -> ${outputDir}`); } catch (e) { }
    const exe = resolve7zTool();
    if (!exe) {
      if (!fs.existsSync(bundledExe)) {
        // Not "failed to validate": the install itself is missing the tool (this is what
        // 5.0.18 to 5.0.20 did when the build stopped bundling it), so say so.
        try { logToFile(`[7z] Bundled extraction tool is missing: ${bundledExe}`); } catch (e) { }
        reject(new Error('The extraction tool (7-Zip) is missing from this install. Please report this in the chat so we can fix it.'));
      } else {
        const detail = ctx._resolved7zFailures.join('; ');
        try { logToFile(`[7z] No working extraction tool: ${detail}`); } catch (e) { }
        const first = (ctx._resolved7zFailures[0] || '').replace(/^bundled: /, '');
        reject(new Error(`The built-in extraction tool couldn't start on this system (${snip7z(first, 120)}). Install 7-Zip from your package manager (the 7zz or p7zip package) and try again, or extract the files by hand.`));
      }
      return;
    }

    // Packaging-convenience password only — not a security control. Electron apps are
    // trivially unpackable via asar; this merely keeps archives from opening without the app.
    const password = 'ARMGDDNGames';
    const isPasswordErrorText = (text) => {
      const t = String(text || '').toLowerCase();
      return t.includes('enter password') || t.includes('wrong password') || t.includes('password is incorrect') || t.includes('encrypted');
    };

    let listedEntries = [];
    const runList = () => {
      const listArgs = ['l', '-slt', `-p${password}`, archivePath];
      return spawnSync(exe, listArgs, { encoding: 'utf8', timeout: 30000 });
    };

    try {
      const listResult = runList();

      if (!(listResult && listResult.status === 0)) {
        try {
          const code = (listResult && typeof listResult.status === 'number') ? listResult.status : null;
          const so = String((listResult && listResult.stdout) || '');
          const se = String((listResult && listResult.stderr) || '');
          const le = listResult && listResult.error ? (listResult.error.message || String(listResult.error)) : '';
          const ls = listResult && listResult.signal ? String(listResult.signal) : '';
          logToFile(`[7z] List failed: code=${code} signal=${ls} err=${le ? 'yes' : 'no'} stdoutLen=${so.length} stderrLen=${se.length}`);
          const spawnErr = listResult && listResult.error ? `${listResult.error.code || ''} ${le}`.trim() : 'none';
          let archiveInfo = '';
          try { archiveInfo = `size=${fs.statSync(archivePath).size}`; } catch (eA) { archiveInfo = `stat failed: ${eA && eA.message ? eA.message : eA}`; }
          logToFile(`[7z] List failure detail: spawnError=${spawnErr} archive=${archivePath} ${archiveInfo} stdout="${snip7z(so, 300)}" stderr="${snip7z(se, 400)}"`);
        } catch (e) { }

        if (listResult && listResult.error && listResult.error.code === 'ETIMEDOUT') {
          reject(new Error('7z extraction failed: validation timed out'));
          return;
        }
        const listText = `${String((listResult && listResult.stdout) || '')}\n${String((listResult && listResult.stderr) || '')}`;
        const listDescribed = describe7zFailure(listText, listResult && listResult.status);
        reject(new Error(listDescribed || 'Failed to validate archive contents before extraction'));
        return;
      }

      const stdout = String(listResult.stdout || '');
      // What this archive unpacks (its entries), kept so the finished card can find the game's setup (setupPick.js).
      try { listedEntries = parseSltListing(stdout); } catch (eL) { listedEntries = []; }
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('Path = ')) continue;
        const entryPath = line.slice('Path = '.length).trim();
        if (!entryPath) continue;
        const safeRel = sanitizeRelativePath(entryPath);
        if (!safeRel) {
          try { logToFile(`[7z] Unsafe entry path rejected (sanitize): ${snip7z(entryPath, 200)}`); } catch (e) { }
          reject(new Error('Unsafe archive entry path detected'));
          return;
        }
        const resolved = resolveInside(outputDir, safeRel);
        if (!resolved) {
          try { logToFile(`[7z] Unsafe entry path rejected (outside output folder): ${snip7z(entryPath, 200)}`); } catch (e) { }
          reject(new Error('Unsafe archive entry path detected'));
          return;
        }
      }
    } catch (e) {
      try { logToFile(`[7z] Validation threw: ${e && e.message ? e.message : e}`); } catch (e2) { }
      reject(new Error('Failed to validate archive contents before extraction'));
      return;
    }

    try {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(exe, 0o755);
        } catch (e) { }
      }
    } catch (e) { }

    const spawnExtract = () => {
      const args = [
        'x',
        '-bsp1',
        '-y',
        '-aos',
        `-o${outputDir}`,
        `-p${password}`,
        archivePath
      ];
      const proc = spawn(exe, args, { cwd: outputDir });
      let out = '';
      let err = '';
      let killedByTimeout = false;
      let killedByInactivity = false;
      let lastOutputAt = Date.now();
      const timeout = setTimeout(() => {
        killedByTimeout = true;
        try { proc.kill(); } catch (e) { }
      }, 60 * 60 * 1000);

      const inactivityInterval = setInterval(() => {
        if (killedByTimeout || killedByInactivity) return;
        const now = Date.now();
        if (now - lastOutputAt > 5 * 60 * 1000) {
          killedByInactivity = true;
          try { proc.kill(); } catch (e) { }
        }
      }, 15000);
      try {
        if (proc.stdin) proc.stdin.end();
      } catch (e) { }
      proc.stdout.on('data', (d) => {
        lastOutputAt = Date.now();
        const text = d.toString();
        out += text;
        if (onProgress) {                       // -bsp1 prints "  42% ..." as it goes; keep the last one in this chunk
          const all = text.match(/(\d{1,3})%/g);
          if (all && all.length) { const v = Math.min(100, parseInt(all[all.length - 1], 10)); if (Number.isFinite(v)) { try { onProgress(v); } catch (e) { /* ignore */ } } }
        }
      });
      proc.stderr.on('data', (d) => {
        lastOutputAt = Date.now();
        err += d.toString();
      });
      proc.on('error', (e) => {
        clearTimeout(timeout);
        clearInterval(inactivityInterval);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(inactivityInterval);
        if (killedByTimeout) {
          reject(new Error('7z extraction failed: extraction timed out'));
          return;
        }
        if (killedByInactivity) {
          try {
            logToFile(`[7z] Extract stalled (no output): ${archivePath}`);
          } catch (e) { }
          reject(new Error('7z extraction failed: extraction stalled'));
          return;
        }
        if (code === 0) {
          try {
            logToFile(`[7z] Extract ok: ${archivePath}`);
          } catch (e) { }
          resolve({ out, err, entries: listedEntries });
          return;
        }
        const combined = (out + '\n' + err).trim();
        const described = describe7zFailure(combined, code);
        if (described) {
          try { logToFile(`[7z] Extract failed: ${archivePath} code=${code} stderr="${snip7z(err, 400)}"`); } catch (e) { }
          reject(new Error(described));
          return;
        }
        try {
          logToFile(`[7z] Extract failed: ${archivePath} code=${code} outLen=${out.length} errLen=${err.length} stderr="${snip7z(err, 400)}" stdoutTail="${snip7z(out.slice(-300), 300)}"`);
        } catch (e) { }
        reject(new Error(`7z extraction failed (code ${code})${err ? `: ${err.trim()}` : ''}`));
      });
    };

    spawnExtract();
  });
}

module.exports = { resolve7zTool, extractTarget, run7zExtract };
