// Small pure helpers for the grid (kept apart so they can be tested without a window).
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
export function releaseYear(item) {
  const d = item && (item.releaseDate || (item.coverArt && item.coverArt.releaseDate));
  const m = /(\d{4})/.exec(String(d || ''));
  return m ? m[1] : '';
}
// "Game Name v1234 -ARMGDDN" -> "Game Name": the folder names carry the build number and the group tag.
export function cleanTitle(name) {
  return String(name || '').replace(/\s*-ARMGDDN\b.*$/i, '').replace(/\s+v\d[\w.()\-]*\s*$/i, '').trim() || String(name || '');
}
export function filterAndSort(items, { query = '', sort = 'name', reverse = false } = {}) {
  const q = String(query).trim().toLowerCase();
  let out = (items || []).filter((x) => x && (!q || String(x.name || '').toLowerCase().includes(q)));
  const by = {
    name: (a, b) => cleanTitle(a.name).localeCompare(cleanTitle(b.name), undefined, { sensitivity: 'base', numeric: true }),
    newest: (a, b) => String(b.firstSeenAt || b.modTime || '').localeCompare(String(a.firstSeenAt || a.modTime || '')) || by.name(a, b),
    size: (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || by.name(a, b),
    popularity: (a, b) => (Number(b.downloadCount) || 0) - (Number(a.downloadCount) || 0) || by.name(a, b),
    released: (a, b) => String(b.releaseDate || (b.coverArt && b.coverArt.releaseDate) || '').localeCompare(String(a.releaseDate || (a.coverArt && a.coverArt.releaseDate) || '')) || by.name(a, b),
  };
  const sorted = out.slice().sort(by[sort] || by.name);
  return reverse ? sorted.reverse() : sorted;
}

// The top level of a game group is the mirror's root folder ("PC1"), not the library. The website steps into it automatically, and so does this.
// Returns the folder to open, or null to show the list as it is.
const GROUP_ROOTS = { 'PC Games': ['PC1', 'PC2', 'PC3'], 'PCVR Games': ['PCVR1', 'PCVR2', 'PCVR3'], 'PC-1': ['PC1'], 'PC-2': ['PC2'], 'PC-3': ['PC3'], 'PCVR-1': ['PCVR1'], 'PCVR-2': ['PCVR2'], 'PCVR-3': ['PCVR3'] };
export function autoEnter(remote, items) {
  const list = Array.isArray(items) ? items : [];
  const roots = GROUP_ROOTS[remote] || [];
  const hit = list.find((f) => f && f.isDir && roots.includes(f.name));
  if (hit) return hit.name;
  if (list.length === 1 && list[0].isDir) return list[0].name;   // a single folder: nothing else to show
  return null;
}

// Game art (Steam headers) is landscape; albums are square; comics are portrait. The card shape follows the section.
export function shapeFor(remote) {
  const r = String(remote || '').toLowerCase();
  if (r === 'music') return 'square';
  if (r === 'comics') return 'tall';
  if (r.includes('3d')) return 'square';
  return 'wide';
}

// The mirror's root folder ("PC1") is plumbing, so the breadcrumb hides it: "PC Games / Some Game", and "PC Games" returns to the library, not to the mirror list.
export function crumbsFor(remote, folder) {
  const parts = folder ? String(folder).split('/') : [];
  const root = parts.length && (GROUP_ROOTS[remote] || []).includes(parts[0]) ? parts[0] : '';
  const rest = root ? parts.slice(1) : parts;
  return { root, items: rest.map((label, i) => ({ label, path: [...(root ? [root] : []), ...rest.slice(0, i + 1)].join('/') })) };
}

// What the website leaves out of a listing: the folder's own entry if the server echoes it, stray catalog files (currentserver*.json) and,
// at the top of Testing, everything except the PC and PCVR folders.
export function visibleItems(remote, folder, items) {
  const norm = (x) => String(x || '').replace(/^\/+|\/+$/g, '');
  const here = norm(folder);
  const leaf = here ? here.split('/').pop() : '';
  let out = (Array.isArray(items) ? items : []).filter((f) => {
    if (!f) return false;
    const fp = norm(f.path);
    if (here && fp && fp === here) return false;
    if (leaf && !fp && f.name === leaf) return false;
    if (!f.isDir && /\.json$/i.test(f.name || '')) return false;
    if (String(f.name || '').startsWith('.')) return false;   // hidden entries such as .trash-...
    return true;
  });
  if (remote === 'Testing' && !here) out = out.filter((f) => !f.isDir || f.name === 'PC' || f.name === 'PCVR');
  return out;
}

// Music artists and Comics series have no Steam art; the site makes a cover for each folder (and for each comic file) on request.
const COLLECTIONS = new Set(['Music', 'Comics']);
export function collectionCoverPath(remote, folder, item) {
  if (!COLLECTIONS.has(remote) || !item) return '';
  const isIssue = !item.isDir && /\.(cbz|cbr|cb7|pdf|epub)$/i.test(item.name || '');
  if (!item.isDir && !isIssue) return '';
  const rel = [folder, item.name].filter(Boolean).join('/');
  return `/api/collection-cover?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(rel)}&w=480`;
}

export function formatSpeed(bytesPerSec) {
  const n = Number(bytesPerSec);
  if (!Number.isFinite(n) || n <= 0) return '';
  return formatSize(n) + '/s';
}
// Statuses the Companion uses for a download that is still running.
export function isActiveDownload(d) { return !!d && !['completed', 'cancelled', 'error', 'failed'].includes(String(d.status || '').toLowerCase()); }

// Where a Download button belongs. Files always get one. A folder gets one only when it is something you download as a whole (a game, an
// album or artist, a comic series): the grouping folders in 3D Printer Models (Bambu / X1C ...) and the PC / PCVR buckets at the top of
// Testing only lead to the things inside them.
export function canDownload(remote, folder, item) {
  if (!item) return false;
  if (!item.isDir) return true;
  if (remote === '3D Printer Models') return false;
  if (remote === 'Testing' && !String(folder || '') && (item.name === 'PC' || item.name === 'PCVR')) return false;
  return true;
}

// Buttons for a download row, by status: running -> pause + cancel; paused -> resume + cancel; failed -> retry + cancel; done -> open folder.
export function downloadActions(d) {
  const st = String((d && d.status) || '').toLowerCase();
  if (['completed'].includes(st)) return ['openFolder'];
  if (['cancelled'].includes(st)) return [];
  if (st === 'paused') return ['resume', 'cancel'];
  if (['error', 'failed'].includes(st)) return ['retry', 'cancel'];
  return ['pause', 'cancel'];
}

// A-Z jump: the letter a title sorts under (digits and symbols share "#").
export function letterOf(name) {
  const t = cleanTitle(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m = /[A-Za-z]/.exec(t[0] || '');
  return m ? m[0].toUpperCase() : '#';
}
export function lettersPresent(items) {
  const seen = new Set((items || []).map((x) => letterOf(x.name)));
  return ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((l) => seen.has(l));
}

// Requests: status wording and chip colour, and a short date.
export function statusInfo(status) {
  const s = String(status || '').toLowerCase();
  return { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], completed: ['Completed', 'ok'], rejected: ['Rejected', 'bad'] }[s] || [s ? s[0].toUpperCase() + s.slice(1) : 'Unknown', 'dim'];
}
export function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Facts shown in the details window, in the website's order.
export function detailLines(remote, item) {
  const art = item.coverArt || {};
  const date = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v || '') : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
  const size = formatSize(item.size && Number(item.size) >= 1024 ? item.size : (item.crossRemoteSize || item.size));
  const dl = Number(item.downloadCount || 0);
  return [
    remote ? `Remote: ${remote}` : '',
    size ? `Size: ${size}` : '',
    item.modTime ? `Added/Updated: ${date(item.modTime)}` : '',
    (item.releaseDate || art.releaseDate) ? `Release: ${date(item.releaseDate || art.releaseDate)}` : '',
    dl > 0 ? `Popularity: ${dl.toLocaleString()} downloads (last 30 days)` : '',
  ].filter(Boolean);
}
export function steamLinks(item) {
  const id = item && item.coverArt && item.coverArt.steamAppId;
  return id ? [['Steam', `https://store.steampowered.com/app/${encodeURIComponent(id)}/`], ['SteamDB', `https://steamdb.info/app/${encodeURIComponent(id)}/`]] : [];
}
// The notice shown before a download, once a day unless the member ticks "don't show again today".
export function dayKey(d = new Date()) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

// Which trailer to play, in the website's order of preference: a direct video, then Steam's streaming format, then YouTube.
export function trailerSource(trailer) {
  const t = trailer && typeof trailer === 'object' ? trailer : null;
  if (!t) return null;
  const direct = (t.mp4 && (t.mp4.max || t.mp4['480'])) || (t.webm && (t.webm.max || t.webm['480']));
  if (direct && /^https:\/\//i.test(direct)) return { kind: 'video', url: direct };
  if (t.hls && /^https:\/\//i.test(t.hls)) return { kind: 'hls', url: t.hls };
  const yt = youtubeEmbed(t.youtube);
  return yt ? { kind: 'youtube', url: yt } : null;
}
export function youtubeEmbed(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(s) || (/^[A-Za-z0-9_-]{11}$/.test(s) ? [null, s] : null);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0` : '';
}

// An update patch folder: the name has the exact phrase "update patch" (underscores count as spaces). "update" or "patch" alone do not qualify.
export function isPatchFolder(name) {
  if (!name || typeof name !== 'string') return false;
  return name.toLowerCase().replace(/_/g, ' ').includes('update patch');
}
// "Game v1.5 -ARMGDDN" + patch "1.0-1.5 Update Patch" -> "Game v1.0 -ARMGDDN": the older repack this patch is for (null when the patch name does not say).
export function patchOldRepackLabel(gameFolderName, patchName) {
  const base = String(patchName || '').replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/_/g, ' ');
  const m = base.match(/(\d[\d.]*(?:\([^)]*\))?)\s*-\s*v?(\d[\d.]*(?:\([^)]*\))?)/);
  if (!m) return null;
  const oldTok = m[1], newTok = m[2];
  const game = String(gameFolderName || '');
  const at = game.lastIndexOf(newTok);
  if (at >= 0) return game.slice(0, at) + oldTok + game.slice(at + newTok.length);
  const lead = (newTok.match(/^\d+/) || [''])[0];
  const oldLead = (oldTok.match(/^\d+/) || [''])[0];
  if (lead && oldLead && game.includes(lead)) {
    const oldParen = (oldTok.match(/\(([^)]*)\)/) || [])[1];
    return game.replace(new RegExp(lead + '(?:\\((v?)[^)]*\\))?'), (all, v) => oldLead + (oldParen ? '(' + (v || '') + oldParen.replace(/^v/i, '') + ')' : ''));
  }
  return null;
}
// Does this game folder get the update-patch question? A repack folder (name ends with the group tag), not itself a patch.
export function mayHavePatchQuestion(name) { return /-ARMGDDN/i.test(String(name || '')) && !isPatchFolder(name); }

// Starfield cannot be auto-extracted: the website asks before sending it. Same match: a path part that starts with "starfield".
export function isStarfieldTarget(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).some((p) => /^starfield(?:[\s._-]|$)/i.test(p));
}

// My List: kept on this device, one entry per remote + path (same shape the website stores).
export const MY_LIST_KEY = 'armgddn-my-list';
export const myListKey = (remote, path) => `${remote}/${String(path || '').replace(/^\/+|\/+$/g, '')}`;
export function myListHas(list, remote, path) { return (list || []).some((i) => myListKey(i.remote, i.path || i.name) === myListKey(remote, path)); }
export function myListToggle(list, entry) {
  const key = myListKey(entry.remote, entry.path || entry.name);
  const has = (list || []).some((i) => myListKey(i.remote, i.path || i.name) === key);
  if (has) return (list || []).filter((i) => myListKey(i.remote, i.path || i.name) !== key);
  return [...(list || []), { name: entry.name, remote: entry.remote, path: entry.path || entry.name, size: entry.size || 0, downloadCount: Number(entry.downloadCount) || 0,
    releaseDate: entry.releaseDate || null, coverArt: entry.coverArt || null, dateAdded: new Date().toISOString() }];
}

// Category / genre filter: games use the Steam categories, Music uses genres; "No genre" collects untagged Music.
export const NO_GENRE = 'No genre';
export function categoriesOf(item, remote) {
  if (Array.isArray(item.genres)) return item.genres.filter(Boolean).map(String);
  const c = item.coverArt && item.coverArt.categories;
  if (Array.isArray(c)) return c.filter(Boolean).map(String);
  return remote === 'Music' ? [NO_GENRE] : [];
}
export function categoryCounts(items, remote) {
  const m = new Map();
  for (const it of items || []) { if (!it || !it.isDir) continue; for (const c of categoriesOf(it, remote)) m.set(c, (m.get(c) || 0) + 1); }
  const list = [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name === NO_GENRE) - (b.name === NO_GENRE) || b.count - a.count || a.name.localeCompare(b.name));
  return remote === 'Music' && list.length === 1 && list[0].name === NO_GENRE ? [] : list;
}
export function filterByCategory(items, cat, remote) {
  if (!cat) return items;
  return (items || []).filter((it) => !it.isDir || categoriesOf(it, remote).includes(cat));
}

// Wiki pictures live on the site; inside the app they come through the private image address (the main process fetches them).
export function wikiHtmlForApp(htmlText) {
  return String(htmlText || '').replace(/(<img\b[^>]*?\bsrc=")(https:\/\/[^"]+)(")/gi, (_m, a, url, c) => a + 'armgddn-img://c/?u=' + encodeURIComponent(url) + c);
}
export function wikiSectionFor(sections, id) {
  const list = Array.isArray(sections) ? sections : [];
  return list.find((s) => s.id === id) || list[0] || null;
}

// Search everywhere: a name matches when every word of the query appears in it, ignoring case, apostrophes and punctuation ("Assassins Creed" finds "Assassin's Creed").
export function looseKey(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019`"]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
export function searchMatches(name, query) {
  const q = looseKey(query);
  if (!q) return false;
  const k = ' ' + looseKey(name) + ' ';
  return q.split(' ').every((w) => k.includes(w));
}
export function searchEverywhere(entries, query, limit = 400) {
  const out = [];
  for (const it of entries || []) { if (searchMatches(it.name, query)) { out.push(it); if (out.length >= limit) break; } }
  return out;
}

// "123 downloads in the last 30 days", shown with a flame on the cards, as on the website.
export function popularityLabel(item) {
  const n = Number(item && item.downloadCount);
  return Number.isFinite(n) && n > 0 ? '\u{1F525} ' + n.toLocaleString('en-US') + ' (30d)' : '';
}

// A trending or hidden-gem entry from the site as the same kind of item the lists use, so the Details and Download paths work unchanged.
export function homeItem(e) {
  if (!e || !e.remote || !e.path) return null;
  const parts = String(e.path).split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  const cover = e.coverUrl ? { cover: { url: e.coverUrl } } : undefined;
  const group = /^PC-\d$/.test(e.remote) ? 'PC Games' : /^PCVR-\d$/.test(e.remote) ? 'PCVR Games' : e.remote;   // the tabs are the groups; the folder names keep PC2 / PCVR2
  return { name, size: Number(e.sizeBytes) || 0, isDir: true, _remote: group, _folder: parts.join('/'), coverArt: cover, downloadCount: Number(e.total != null ? e.total : e.downloads) || 0, _title: e.title || '' };
}
// "Picks for you": trending titles that are not already in My List, in an order that changes each day.
export function picksFrom(entries, myListNames, day, count = 12) {
  const have = new Set((myListNames || []).map((n) => String(n).toLowerCase()));
  const h = (str) => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0; return x >>> 0; };
  const seen = new Set();
  return (entries || []).filter((e) => { const t = String(e.title || '').toLowerCase(); if (!t || have.has(t) || seen.has(t)) return false; seen.add(t); return !!(e.remote && e.path); })
    .map((e) => ({ e, k: h(String(day) + (e.title || '')) })).sort((a, b) => a.k - b.k).slice(0, count).map((x) => x.e);
}

// ---- Website preferences -> the app. The website keeps them in the browser, so a short snippet run once on the site produces a code
// (ARMGDDN-PREFS:1:...) that is pasted into the app. The code is checked field by field; anything unexpected is dropped.
export const PREFS_PREFIX = 'ARMGDDN-PREFS:1:';
export const PREFS_SNIPPET = "(()=>{const g=k=>{try{return localStorage.getItem(k)}catch(e){return null}},j=k=>{try{return JSON.parse(g(k))}catch(e){return null}};const o={theme:g('armgddn-theme'),myList:j('armgddn-my-list'),searches:j('armgddn-recent-searches'),komgaUrl:g('komgaUrl'),animations:g('armgddn-animations'),collapsed:{gameRadarContainer:g('armgddn-collapsed-gameRadarContainer'),trendingPillContainer:g('armgddn-collapsed-trendingPillContainer'),hiddenGemsContainer:g('armgddn-collapsed-hiddenGemsContainer')}};const b=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const c='ARMGDDN-PREFS:1:'+b;try{copy(c)}catch(e){}console.log(c);return 'Code ready ('+c.length+' characters); it was copied if your browser allowed it.'})()";
export function parsePrefs(code) {
  const text = String(code == null ? '' : code).replace(/\s+/g, '');
  const at = text.indexOf(PREFS_PREFIX);
  if (at < 0) return { error: 'That is not a code from the website snippet.' };
  const body = text.slice(at + PREFS_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '');
  if (!body || body.length > 3 * 1024 * 1024) return { error: 'The code is empty or too long.' };
  let raw;
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((body.length + 3) % 4);
    const bin = atob(b64);
    raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch (e) { return { error: 'The code could not be read. Copy it again from the website.' }; }
  return normalizePrefs(raw);
}
// The checked form of a set of website preferences, from either the pasted code or the copy the site keeps on the server.
export function normalizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'The code could not be read.' };
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  const out = { myList: [], theme: '', strips: {}, searches: [], komgaUrl: '', animations: null };
  const list = Array.isArray(raw.myList) ? raw.myList.slice(0, 2000) : [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    const name = str(i.name, 300), remote = str(i.remote, 60);
    if (!name || !/^[A-Za-z0-9 _.\-]{1,60}$/.test(remote)) continue;
    const path = str(i.path, 600);
    if (path.split('/').includes('..')) continue;
    const cover = i.coverArt && i.coverArt.cover && typeof i.coverArt.cover.url === 'string' && i.coverArt.cover.url.length < 800 ? { cover: { url: i.coverArt.cover.url } } : null;
    out.myList.push({ name, remote, path, size: Number(i.size) || 0, downloadCount: Number(i.downloadCount) || 0, releaseDate: str(i.releaseDate, 40) || null, coverArt: cover, dateAdded: str(i.dateAdded, 40) || null });
  }
  const th = str(raw.theme, 40); out.theme = /^[a-z0-9-]+$/i.test(th) ? th : '';
  const col = raw.collapsed && typeof raw.collapsed === 'object' ? raw.collapsed : {};
  const map = { gameRadarContainer: 'picks', trendingPillContainer: 'trending', hiddenGemsContainer: 'gems' };
  for (const [k, id] of Object.entries(map)) out.strips[id] = col[k] === '1' || col[k] === true;
  out.searches = (Array.isArray(raw.searches) ? raw.searches : []).map((x) => str(x, 100)).filter(Boolean).slice(0, 30);
  const k = str(raw.komgaUrl, 200); out.komgaUrl = /^https?:\/\/[^\s]+$/.test(k) ? k : '';
  out.animations = raw.animations === '0' || raw.animations === 'off' || raw.animations === false ? false : raw.animations === '1' || raw.animations === 'on' || raw.animations === true ? true : null;
  return out;
}
// Merge imported My List entries into the current one without duplicates (same remote and path).
export function mergeMyList(current, incoming) {
  const key = (i) => i.remote + '/' + (i.path || i.name);
  const have = new Set((current || []).map(key));
  const added = (incoming || []).filter((i) => { const k = key(i); if (have.has(k)) return false; have.add(k); return true; });
  return { list: (current || []).concat(added), added: added.length };
}

// Batch mode, as on the website: only inside a folder (two levels below the section, one for Testing) that has more than one thing in it.
export function batchEligible(remote, crumbDepth, visibleCount) {
  return Number(visibleCount) > 1 && Number(crumbDepth) >= (remote === 'Testing' ? 1 : 2);
}
// The selected paths without repeats and without anything that sits inside another selected folder.
export function batchPaths(paths) {
  const clean = Array.from(new Set((paths || []).map((p) => String(p || '').replace(/^\/+|\/+$/g, '')).filter(Boolean)));
  return clean.filter((p) => !clean.some((q) => q !== p && p.startsWith(q + '/')));
}

// The website's trending ticker: for each window (7 days, 30 days) and platform (PC, PCVR) the five most downloaded titles, shown one set after another.
export const TRENDING_SETS = [['week', 'pc'], ['week', 'pcvr'], ['month', 'pc'], ['month', 'pcvr']];
export const TRENDING_WINDOW_LABELS = { week: 'LAST 7 DAYS', month: 'LAST 30 DAYS' };
export function trendingSets(windows) {
  const out = [];
  for (const [win, platform] of TRENDING_SETS) {
    const items = (Array.isArray(windows && windows[win]) ? windows[win] : [])
      .map((x) => ({ ...x, count: platform === 'pc' ? Number(x.pc) || 0 : Number(x.pcvr) || 0 }))
      .filter((x) => x.count > 0 && (x.platform == null || x.platform === platform))
      .sort((a, b) => b.count - a.count || (Number(b.lastDownloadTs) || 0) - (Number(a.lastDownloadTs) || 0))
      .slice(0, 5);
    if (items.length) out.push({ win, platform, label: (platform === 'pc' ? 'PC' : 'PCVR') + ' \u00B7 ' + TRENDING_WINDOW_LABELS[win], items });
  }
  return out;
}

// "Only what I'm missing": the lines the Tools screen shows for a comparison. kind is 'comics' or 'music'; r is the reply of comics-compare /
// music-compare ({ list, summary }). Each line is { tone: 'ok' | 'warn' | 'info', text }; the text matches the classic window's wording.
export function compareLines(kind, r) {
  const s = r && r.summary; if (!s) return [];
  const n = (v) => Number(v || 0).toLocaleString();
  const out = [];
  if (kind === 'music') {
    out.push(s.missing ? { tone: 'warn', text: `You have ${n(s.have)} of ${n(s.total)} tracks. ${n(s.missing)} are missing (${formatSize(s.bytesMissing) || '0 B'}).` } : { tone: 'ok', text: `You already have all ${n(s.total)} tracks in the library.` });
    if (s.albums) out.push({ tone: 'info', text: `Albums: ${n(s.albums.complete)} complete, ${n(s.albums.partial)} partly there, ${n(s.albums.none)} not in your folder.` });
    if (s.damaged) out.push({ tone: 'warn', text: `${n(s.damaged)} of your files look empty or cut short and are not counted as owned; they will be downloaded again.` });
    return out;
  }
  const listName = r.list && r.list.name ? r.list.name : 'this list';
  out.push(s.missing ? { tone: 'warn', text: `You have ${n((s.have || 0) + (s.haveByName || 0))} of ${n(s.total)}. ${n(s.missing)} are missing (${formatSize(s.bytesMissing) || '0 B'}).` } : { tone: 'ok', text: `You already have all ${n(s.total)} comics in ${listName}.` });
  if (s.haveByName) out.push({ tone: 'ok', text: `${n(s.haveByName)} were matched by name because they have no Comic Vine tag.` });
  if (s.maybe) out.push({ tone: 'info', text: `${n(s.maybe)} look like the same issue from a different year; they are listed as missing so nothing is skipped by mistake.` });
  if (s.damagedCount) out.push({ tone: 'warn', text: `${n(s.damagedCount)} of your files look damaged or cut short and are not counted as owned: ${(s.damaged || []).slice(0, 3).join(', ')}${s.damagedCount > 3 ? ', ...' : ''}` });
  if (Array.isArray(s.perSeries) && s.perSeries.length) out.push({ tone: 'info', title: 'Missing by series', text: s.perSeries.slice(0, 15).map((x) => `${x.series}: ${n(x.count)} (${formatSize(x.bytes) || '0 B'})`).join(' \u2022 ') });
  return out;
}

// What the download step reported: "Started 2 downloads (120 comics, 3.4 GB). They arrive in <folder>."
export function startedLine(kind, r) {
  const n = (v) => Number(v || 0).toLocaleString();
  const unit = kind === 'music' ? 'tracks' : 'comics';
  return `Started ${n(r.started)} download${r.started === 1 ? '' : 's'} (${n(r.files)} ${unit}, ${formatSize(r.bytes) || '0 B'}). They are in the Downloads tab, and arrive in ${r.folder}. Scan again afterwards.`;
}
