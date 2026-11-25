'use strict';
// "Open the setup when extraction finishes" (approved by George, Nov 25 2026): which file, if any, is a finished game's installer.
// Pure functions only (facts in, answer out) so the rule can be tested over made-up listings; main/setupLaunch.js does the launching.
//
// The rule, from a survey of the library (1,879 titles, 150 archives looked inside):
// - 96% of games: the main archive unpacks to one ARMGDDN installer at its top level, AGRepackInstaller.exe (+ Data*.bin) or the older
//   Setup.exe (+ Setup.dll + Data.bin). Both are ordinary click-through installers that need their Data*.bin beside them.
// - Only the title's MAIN archive set counts. Add-on sets (DLC unlockers, fixes, mods, language packs, extras, update patches) never do.
// - Look at the top level of what the main archive unpacked, plus one level down when everything in it sits in a single folder.
// - Exactly one AGRepackInstaller.exe or setup.exe (any case) there: that is the setup. None, or more than one (both names, or another
//   archive in the same run that also has one): nothing is opened, the card offers Open folder.
// - Nothing else is ever opened: .bat/.cmd, .msi, redistributables, uninstallers, update patches and nested archives are not on the list.
// - Windows only.

const SETUP_NAMES = ['agrepackinstaller.exe', 'setup.exe'];

// A word on its own (letters or digits on neither side), so "fix" matches "fix_rev5" and "Intel CTD Fix" but not "Prefix".
const word = (w) => new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)', 'i');
// Folder or archive-set names that mark an add-on, never the main game. From the titles in the library that have more than one archive set.
const ADDON_PATTERNS = [
  /update[ _-]*patch/i, word('update'), word('patch'), /loose[ _-]*files/i, word('aio'),
  /language/i, /lang[ _-]*packs?/i, word('extras?'), word('mods?'), /mod[ _-]*tool/i, word('dlc'), /bonus/i, /artbook/i, /soundtrack/i, word('ost'),
  /texture/i, word('fix(es)?'), /crack/i, /unlocker/i, /online[ _-]*fix/i, /offline[ _-]*server/i, /redist/i, word('dlls?'),
];
// Folders never looked into for the "single folder" step (they hold redistributables or patches, not the game).
const SKIP_DIR = /(^_?commonredist$|^redist(ributables?)?$|^_redist$|^directx$|^vcredist|update[ _-]*patch)/i;

const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
const segs = (p) => norm(p).split('/').filter(Boolean);

function isAddonName(name) {
  const n = String(name || '');
  return ADDON_PATTERNS.some((re) => re.test(n));
}

// "Game v1 -ARMGDDN.7z.001" / "Game v1 -ARMGDDN.7z" -> "Game v1 -ARMGDDN"
function archiveSetName(relPath) {
  const base = segs(relPath).pop() || '';
  return base.replace(/\.7z\.\d{3}$/i, '').replace(/\.7z$/i, '');
}

// The title's main archive set: named like a repack (has "ARMGDDN", or failing that a version number such as v9720470), and neither the set
// nor any folder it sits in is an add-on.
function isMainArchiveSet(relPath) {
  const parts = segs(relPath);
  if (!parts.length) return false;
  const name = archiveSetName(relPath);
  if (!name) return false;
  for (const dir of parts.slice(0, -1)) if (isAddonName(dir)) return false;
  if (isAddonName(name)) return false;
  return /armgddn/i.test(name) || /(^|[^a-z0-9])v\d{4,}/i.test(name);
}

// 7-Zip's technical listing (`7z l -slt`): the entries after the "----------" line, each { path, dir }.
function parseSltListing(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  let started = false;
  let cur = null;
  const flush = () => { if (cur && cur.path) out.push({ path: norm(cur.path), dir: !!cur.dir }); cur = null; };
  for (const line of lines) {
    if (!started) { if (/^-{10,}\s*$/.test(line)) started = true; continue; }
    if (line.startsWith('Path = ')) { flush(); cur = { path: line.slice(7).trim(), dir: false }; continue; }
    if (!cur) continue;
    if (/^Folder = \+/.test(line)) cur.dir = true;
    else if (/^Attributes = /.test(line) && /^Attributes = [A-Z]*D/.test(line)) cur.dir = true;
  }
  flush();
  return out;
}

// entries: what one archive unpacks, as paths ("a/b.exe", "a\\b.exe", or { path, dir }). Folders are known from deeper paths too.
// -> { status: 'one', rel } | { status: 'none' } | { status: 'several', names }
function pickSetup(entries) {
  const files = new Set();
  const dirs = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    const isObj = e && typeof e === 'object';
    const p = norm(isObj ? e.path : e);
    if (!p) continue;
    const parts = p.split('/');
    if (parts.some((s) => s === '..' || s === '.')) continue;
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    if (isObj && e.dir) dirs.add(p); else files.add(p);
  }
  for (const d of dirs) files.delete(d);
  const top = new Set([...files, ...dirs].map((p) => p.split('/')[0]));
  let base = '';
  // Everything sits in a single folder: look one level down too.
  if (top.size === 1) {
    const only = [...top][0];
    if (dirs.has(only) && !SKIP_DIR.test(only)) base = only;
  }
  const levels = base ? ['', base] : [''];
  const found = [];
  for (const f of files) {
    const parts = f.split('/');
    const dir = parts.slice(0, -1).join('/');
    if (!levels.includes(dir)) continue;
    if (SETUP_NAMES.includes(parts[parts.length - 1].toLowerCase())) found.push(f);
  }
  if (found.length === 1) return { status: 'one', rel: found[0] };
  if (found.length > 1) return { status: 'several', names: found.sort() };
  return { status: 'none' };
}

// What this download's extraction left: sets = [{ rel: archive path relative to the download folder, entries }] (every archive unpacked in this run).
// -> { status: 'one', rel } (rel is relative to the folder the archives were unpacked into), or 'none' / 'several' / 'no-main' / 'several-main' /
// 'unsupported' (not Windows), each with why.
function findSetup({ platform, sets } = {}) {
  if (platform !== 'win32') return { status: 'unsupported', why: 'not Windows' };
  const list = Array.isArray(sets) ? sets.filter((s) => s && s.rel) : [];
  const main = list.filter((s) => isMainArchiveSet(s.rel));
  if (!main.length) return { status: 'no-main', why: 'no main archive set in this download' };
  if (main.length > 1) return { status: 'several-main', why: 'more than one main archive set', names: main.map((s) => archiveSetName(s.rel)) };
  const pick = pickSetup(main[0].entries);
  if (pick.status !== 'one') return { ...pick, why: pick.status === 'several' ? 'more than one setup' : 'no setup at the top level' };
  // Another archive unpacked into the same folder in this run with a setup of its own at its top level: two installers, so neither is sure.
  for (const other of list) {
    if (other === main[0]) continue;
    const o = pickSetup(other.entries);
    if (o.status !== 'none') return { status: 'several', why: 'another archive in this download also has a setup', names: [pick.rel].concat(o.rel ? [o.rel] : o.names || []) };
  }
  return { status: 'one', rel: pick.rel };
}

// The automatic open: the option is on, Windows, a clean extraction this run, the file check ran and passed, one setup was found, not opened before.
// setupRel: the one setup findSetup() chose ('' when it chose none).
function shouldAutoOpenSetup({ enabled, platform, setupRel, didExtract, extractionError, didCheck, checkOk, alreadyOpened } = {}) {
  return enabled === true && platform === 'win32' && typeof setupRel === 'string' && isAllowedSetupRel(setupRel) &&
    didExtract === true && !extractionError && didCheck === true && checkOk === true && !alreadyOpened;
}

// A saved setup path is only used when it still looks like one the rule could have picked: a setup name, at most one folder down, no "..".
function isAllowedSetupRel(rel) {
  const parts = segs(rel);
  if (!parts.length || parts.length > 2) return false;
  if (parts.some((s) => s === '..' || s === '.')) return false;
  if (parts.length === 2 && SKIP_DIR.test(parts[0])) return false;
  return SETUP_NAMES.includes(parts[parts.length - 1].toLowerCase());
}

module.exports = { SETUP_NAMES, isAddonName, archiveSetName, isMainArchiveSet, parseSltListing, pickSetup, findSetup, shouldAutoOpenSetup, isAllowedSetupRel };
