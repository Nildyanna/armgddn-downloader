'use strict';
// The desktop and Start Menu shortcuts carry the app's name. The installer names them "ARMGDDN Companion"; when the native window is switched on for a
// member the app is the ARMGDDN App, so those two shortcuts are renamed to match (and back if the native window is turned off). The name "ARMGDDN Browser"
// (used until 6.7.0) is still recognised and moves to the new name. Windows only; only shortcuts that carry one of our names, and only ones that open
// this app, are touched. Nothing is deleted.
const path = require('path');

const COMPANION = 'ARMGDDN Companion';
const OLD_BROWSER = 'ARMGDDN Browser';
const BROWSER = 'ARMGDDN App';

// The name the shortcuts should carry now.
const wantedName = (native) => (native ? BROWSER : COMPANION);

// names = the file names in one folder. -> the renames to make there ([{ from, to }]); nothing when the right name is already there or no shortcut
// of ours is.
function planShortcutRenames(names, native) {
  const list = (names || []).map((n) => String(n));
  const want = wantedName(native);
  if (list.includes(want + '.lnk')) return [];
  // the names this shortcut may carry now instead: the other of our two, and the old Browser name
  const others = native ? [COMPANION, OLD_BROWSER] : [BROWSER, OLD_BROWSER];
  const from = others.find((o) => list.includes(o + '.lnk'));
  return from ? [{ from: from + '.lnk', to: want + '.lnk' }] : [];
}

// Applies the plan in each folder. opensThisApp(file) says whether the shortcut points at this app's own exe (so another program's shortcut that
// happens to share the name is left alone). -> [{ from, to, ok }] for what it tried.
function syncShortcutNames({ dirs = [], native, fs, opensThisApp = () => true, log = () => { } }) {
  const done = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const op of planShortcutRenames(names, native)) {
      const from = path.join(dir, op.from), to = path.join(dir, op.to);
      try {
        if (!opensThisApp(from)) continue;
        fs.renameSync(from, to);
        log('[Shortcut] ' + op.from + ' -> ' + op.to + ' in ' + dir);
        done.push({ from, to, ok: true });
      } catch (e) {
        log('[Shortcut] could not rename ' + op.from + ' in ' + dir + ': ' + (e && e.message ? e.message : e));
        done.push({ from, to, ok: false });
      }
    }
  }
  return done;
}

// Which Start Menu shortcut to relaunch through after an update: whichever of the two names exists.
function startMenuShortcutPath(dir, fs) {
  for (const n of [BROWSER, OLD_BROWSER, COMPANION]) { const p = path.join(dir, n + '.lnk'); try { if (fs.existsSync(p)) return p; } catch (e) { } }
  return path.join(dir, COMPANION + '.lnk');
}

// After an update (or a rename) Windows can keep showing a blank icon for the app's shortcuts (George's desktop, Nov 24 2026: the shortcut and
// the program's icon were both fine; the cached icon was stale, and the OneDrive-synced shortcut file was in an odd state). The cure that worked:
// write each shortcut that opens this app again, as a fresh file with the program's own icon, then ask Windows to redraw icons (ie4uinit -show).
// shell: Electron's shell (readShortcutLink / writeShortcutLink); run(file, args): starts a program without waiting. Returns the shortcuts redone.
function refreshShortcutIcons({ dirs = [], fs, shell, execPath, run = () => { }, log = () => { } }) {
  const redone = [];
  const exe = String(execPath || '').toLowerCase();
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!/\.lnk$/i.test(n) || ![COMPANION, BROWSER, OLD_BROWSER].some((w) => n.toLowerCase() === (w + '.lnk').toLowerCase())) continue;
      const file = path.join(dir, n);
      try {
        const link = shell.readShortcutLink(file);
        if (String(link.target || '').toLowerCase() !== exe) continue;
        const fresh = { ...link, target: execPath, icon: execPath, iconIndex: 0 };
        try { fs.unlinkSync(file); } catch (e) { }
        if (!shell.writeShortcutLink(file, 'create', fresh)) throw new Error('write failed');
        redone.push(file);
        log('[Shortcut] refreshed ' + file);
      } catch (e) {
        log('[Shortcut] could not refresh ' + file + ': ' + (e && e.message ? e.message : e));
      }
    }
  }
  if (redone.length) {
    try { run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe'), ['-show']); } catch (e) { }
  }
  return redone;
}

module.exports = { COMPANION, BROWSER, OLD_BROWSER, wantedName, planShortcutRenames, syncShortcutNames, startMenuShortcutPath, refreshShortcutIcons };
