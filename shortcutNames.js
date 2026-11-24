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

module.exports = { COMPANION, BROWSER, OLD_BROWSER, wantedName, planShortcutRenames, syncShortcutNames, startMenuShortcutPath };
