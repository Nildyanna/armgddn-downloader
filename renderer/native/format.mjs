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
// The part of a file's name that tells the pieces of one game apart: "A Game v123 -ARMGDDN.part2.rar" -> ".part2.rar", "x.7z.001" -> ".7z.001", "Setup.exe" -> ".exe".
// cleanTitle drops it, so three archive parts would all read the same (Nov 20: a user could not tell which piece to grab).
export function fileSuffix(name) {
  const n = String(name || '').trim();
  const g = /-ARMGDDN\b(.*)$/i.exec(n);
  if (g && g[1].trim()) return g[1].trim();
  const m = /(\.part\d+\.rar|\.7z\.\d+|\.zip\.\d+|\.r\d{2}|\.[A-Za-z0-9]{1,6})$/i.exec(n);
  return m ? m[1] : '';
}
// Housekeeping files the collections carry (updatePCVR-FTP.txt and its siblings) are never listed.
export function isHiddenItem(item) { return !!item && !item.isDir && /^update.*\.(txt|ftp)$/i.test(String(item.name || '').trim()); }
// Whether the art should fill its tile (crop) or sit whole over the blurred backdrop, as on the website: game art close to the 616:353 tile fills it
// (aspect 1.4 to 1.95), Music and Comics art fills when it has the section's usual shape (square, or 2:3) within 15 percent. Anything else is shown whole.
export function coverFills(w, h, shape) {
  if (!(w > 0 && h > 0)) return false;
  const a = w / h;
  if (shape === 'square') return Math.abs(a / 1 - 1) <= 0.15;
  if (shape === 'tall') return Math.abs(a / (2 / 3) - 1) <= 0.15;
  return a >= 1.4 && a <= 1.95;
}
export function filterAndSort(items, { query = '', sort = 'name', reverse = false } = {}) {
  items = (items || []).filter((x) => !isHiddenItem(x));
  const q = String(query).trim().toLowerCase();
  let out = (items || []).filter((x) => x && (!q || String(x.name || '').toLowerCase().includes(q) || String((x.comic && x.comic.title) || '').toLowerCase().includes(q)));
  const by = {
    name: (a, b) => {
      // Comics whose details are known are listed in release order (date, then issue number), as on the website.
      const ca = a.comic, cb = b.comic;
      if (ca && cb) {
        if (ca.date && cb.date && ca.date !== cb.date) return ca.date < cb.date ? -1 : 1;
        if (ca.number != null && cb.number != null) { const x = parseFloat(ca.number), y = parseFloat(cb.number); if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y; }
      }
      return cleanTitle(a.name).localeCompare(cleanTitle(b.name), undefined, { sensitivity: 'base', numeric: true });
    },
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
  // A track inside an album shows the album's cover (Nov 24 2026); a disc folder ("CD1", "Disc 2") uses the album above it.
  const isTrack = remote === 'Music' && !item.isDir && /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac|ape|wv)$/i.test(item.name || '');
  if (isTrack) {
    const parts = String(folder || '').split('/').filter(Boolean);
    if (parts.length && /^(cd|dis[ck])\s*\d+$/i.test(parts[parts.length - 1])) parts.pop();
    if (!parts.length) return '';
    return `/api/collection-cover?remote=Music&path=${encodeURIComponent(parts.join('/'))}&w=480`;
  }
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
export function isActiveDownload(d) { return !!d && downloadState(d).group !== 'done'; }

// A download that is moving right now. A paused one is not: pausing is how a member gets out of the way of an update.
// Fetching or about to fetch (not paused, not finishing): the same states as before, now read from DOWNLOAD_STATES.
export function isRunningDownload(d) {
  const st = String((d && d.status) || '').toLowerCase();
  const s = DOWNLOAD_STATES[st];
  return !!d && !!s && s.step === 'download' && st !== 'paused';
}

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
  if (finishingStage(d)) return ['cancel'];   // nothing left to pause once every file is downloaded
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
  const out = { myList: [], theme: '', strips: {}, searches: [], komgaUrl: '', animations: null, introSeen: false };
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
  out.introSeen = raw.introSeen === true;      // seen on the website
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

// The lightning reveal is a welcome for a member's first sign-in in this app. It plays only after a real sign-in in this window, never when the window
// opens with the member already signed in (an existing Companion user is not new), never again once seen here, and never when the website's own
// preferences say they have already seen it. markSeen = remember that, so it is not offered again.
export function introDecision({ afterSignIn = false, seenHere = false, off = false, quiet = false, seenOnWebsite = false } = {}) {
  const play = !!afterSignIn && !seenHere && !off && !quiet && !seenOnWebsite;
  const markSeen = play || !afterSignIn || !!seenOnWebsite;
  return { play, markSeen };
}

// ---- Newest / Older: the same game in several places with different builds ----
export function searchTitleKey(name) {
  let t = String(name || '').replace(/^(PCVR\d*|PC\d*)\s*\/\s*/i, '');
  t = t.replace(/\s+-?\s*ARMGDDN.*$/i, '').replace(/\s+\+[A-Z0-9].*$/i, '');
  t = t.replace(/\s+v(?:er\.?\s*)?\d[\dA-Za-z.\-]*\s*$/i, '').replace(/\s+-[A-Z0-9]{2,}\s*$/i, '');
  return looseKey(t);
}
export function searchBuildNumber(name) {
  const m = String(name || '').match(/\bv(?:er\.?\s*)?(\d{4,})\b/i);
  return m ? Number(m[1]) : null;
}
// Map of item -> 'newest' | 'older' for titles that appear with two or more different builds; items without a build number get nothing.
export function versionBadges(list) {
  const by = new Map();
  for (const it of list || []) {
    const n = searchBuildNumber(it && it.name), key = searchTitleKey(it && it.name);
    if (n && key) { if (!by.has(key)) by.set(key, []); by.get(key).push(n); }
  }
  const out = new Map();
  for (const it of list || []) {
    const n = searchBuildNumber(it && it.name), all = by.get(searchTitleKey(it && it.name));
    if (!n || !all || new Set(all).size < 2) continue;
    out.set(it, n === Math.max(...all) ? 'newest' : 'older');
  }
  return out;
}

// ---- Search that forgives one typo per word (5+ letters), used when nothing matches exactly ----
export function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
export function fuzzyMatches(name, query) {
  const words = looseKey(name).split(' ').filter(Boolean);
  const q = looseKey(query).split(' ').filter(Boolean);
  return q.length > 0 && q.every((w) => words.some((x) => x.includes(w) || withinOneEdit(w, x)));
}
export function searchFuzzy(entries, query, limit = 200) {
  if (looseKey(query).replace(/ /g, '').length < 5) return [];
  const out = [];
  for (const it of entries || []) { if (fuzzyMatches(it.name, query)) { out.push(it); if (out.length >= limit) break; } }
  return out;
}
// Which other sections also have a match for the query: [{ remote, count }].
export function otherSectionMatches(index, query, currentRemote) {
  const counts = new Map();
  for (const it of index || []) {
    if (!it || !it.isDir || it._remote === currentRemote || !searchMatches(it.name, query)) continue;
    counts.set(it._remote, (counts.get(it._remote) || 0) + 1);
  }
  return [...counts.entries()].map(([remote, count]) => ({ remote, count }));
}

// ---- A folder under 1 KB in a game section is a stub that points to the other server ----
export function stubNotice(remote, folder, item) {
  const r = stubTarget(remote, folder, item);
  return r ? { ...r, name: String(item.name || '') } : null;   // name: the game to look for once the other section is open
}
function stubTarget(remote, folder, item) {
  if (!item || !item.isDir || !(Number(item.size) < 1024)) return null;
  const top = String(folder || '').replace(/^\/+/, '').split('/')[0] || '';
  const pcvrRoot = /^PCVR\d*$/i.test(top), pcRoot = /^PC\d*$/i.test(top);
  if (remote === 'PC Games') return { message: 'You must download from PCVR server', remote: 'PCVR Games', folder: '' };
  if (remote === 'PCVR Games') return { message: 'You must download from PC server', remote: 'PC Games', folder: '' };
  if (remote === 'Testing' && pcRoot) return { message: 'You must download from PCVR server', remote: 'Testing', folder: 'PCVR' };
  if (remote === 'Testing' && pcvrRoot) return { message: 'You must download from PC server', remote: 'Testing', folder: 'PC' };
  return null;
}

// ---- Sections whose download quota is used up (a game group counts only when every mirror in it is) ----
const QUOTA_GROUPS = { 'PC Games': ['PC-1', 'PC-2', 'PC-3'], 'PCVR Games': ['PCVR-1', 'PCVR-2', 'PCVR-3'] };
export function quotaTabs(remoteStatus) {
  const st = remoteStatus && typeof remoteStatus === 'object' ? remoteStatus : {};
  const out = new Set();
  for (const [g, mirrors] of Object.entries(QUOTA_GROUPS)) if (mirrors.every((m) => st[m] === 'at-quota')) out.add(g);
  const grouped = new Set(Object.values(QUOTA_GROUPS).flat());
  for (const [k, v] of Object.entries(st)) if (!grouped.has(k) && v === 'at-quota') out.add(k);
  return out;
}

// ---- Comics with checked details: proper title, issue number, release date, ComicVine page ----
export function comicTitle(item) { return item && item.comic && item.comic.title ? String(item.comic.title) : cleanTitle(item && item.name); }
export function comicParts(item) {
  const c = item && item.comic;
  if (!c) return [];
  return [c.number != null && c.number !== '' ? 'Issue #' + c.number : '', c.date || ''].filter(Boolean);
}

// ---- Publisher collections on the Comics page: which members of each bundle are in this list, the total size, and the cover to show ----
export const FALLBACK_COMIC_BUNDLES = [
  { id: 'marvel', title: 'Marvel Collection', members: ['Daredevil Collection', 'Spider-Man Collection'], art: 'Spider-Man Collection/Amazing Fantasy (1962)' },
  { id: 'dc', title: 'DC Collection', members: ['Batman Collection', 'Superman Collection'], art: 'Superman Collection/Superman Vol. 1 (1939)' },
];
export function bundlesPresent(bundles, items) {
  const have = new Map((items || []).filter((f) => f && f.isDir).map((f) => [f.name, f]));
  const list = Array.isArray(bundles) && bundles.length ? bundles : FALLBACK_COMIC_BUNDLES;
  const out = [];
  for (const b of list) {
    const present = (b.members || []).filter((m) => have.has(m));
    if (!present.length) continue;
    out.push({ id: b.id, title: b.title, present, total: present.reduce((n, m) => n + (Number(have.get(m).size) || 0), 0), cover: '/api/collection-cover?remote=Comics&path=' + encodeURIComponent(b.art || present[0]) + '&w=480' });
  }
  return out;
}

// "ETA 1990010d 0h" came from a rate of nearly nothing; an estimate of a month or more is not shown.
export function etaShown(eta) {
  const s = String(eta || '').trim();
  if (!s) return '';
  const d = /^(\d+)d\b/.exec(s);
  return d && Number(d[1]) >= 30 ? '' : s;
}

// Time elapsed for a download: "42s", "5m 12s", "1h 02m 05s". Running ones count up to now; finished ones stop at their end time; paused or restored ones show nothing
// (the clock would include the time the app was closed). '' when there is no usable start.
export function elapsedShown(d, now = Date.now()) {
  if (!d || !d.startTime) return '';
  const start = Date.parse(d.startTime);
  if (!Number.isFinite(start)) return '';
  const st = String(d.status || '').toLowerCase();
  let end;
  if (['in_progress', 'downloading', 'starting'].includes(st)) end = now;
  else if (['completed', 'complete', 'done', 'failed', 'cancelled', 'canceled', 'error'].includes(st) && d.endTime && Number.isFinite(Date.parse(d.endTime))) end = Date.parse(d.endTime);
  else return '';
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(r).padStart(2, '0') + 's';
  if (m > 0) return m + 'm ' + String(r).padStart(2, '0') + 's';
  return r + 's';
}

// Speed shown in MiB/s (an option; the default stays the Companion's bits per second): "58.6 MiB/s".
export function formatMiBps(bytesPerSec) {
  const n = Number(bytesPerSec);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = n / 1048576;
  return (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2)) + ' MiB/s';
}

// Speed in bits per second, written the way the main process writes a download's speed ("1 Gbp/s"), for totals the page adds up itself.
export function formatBitsps(bytesPerSec) {
  const bits = Number(bytesPerSec) * 8;
  if (!Number.isFinite(bits) || bits <= 0) return '';
  const units = ['bp/s', 'Kbp/s', 'Mbp/s', 'Gbp/s', 'Tbp/s'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bits) / Math.log(1000)));
  return (bits / Math.pow(1000, i)).toFixed(i >= 2 ? 1 : 0).replace(/\.0$/, '') + ' ' + units[i];
}
// The speed in the unit the member picked on a download card: MiB/s or bits per second.
export function speedInUnit(bytesPerSec, mib) { return mib ? formatMiBps(bytesPerSec) : formatBitsps(bytesPerSec); }

// The files a download is working on right now, each with its own percent (DMP, Nov 20: the overall percent alone does not show whether the files go one at a time
// or several at once). `activeFiles` is the Companion's map or list of per-file records; only files still downloading are listed, at most `max`.
export function activeFileRows(activeFiles, max = 8) {
  const list = Array.isArray(activeFiles) ? activeFiles : (activeFiles && typeof activeFiles === 'object' ? Object.values(activeFiles) : []);
  const rows = list.filter((x) => x && String(x.status || 'downloading').toLowerCase() === 'downloading')
    .map((x) => ({ name: String(x.name || '').split('/').pop() || String(x.name || ''), pct: Math.max(0, Math.min(100, Math.round(Number(x.progress) || 0))), speed: String(x.speed || ''), bytes: Math.max(0, Number(x.speedBytes) || 0), source: x.source === 'drive' ? 'Drive' : (x.source === 'gateway' ? 'Gateway' : '') }));
  return { rows: rows.slice(0, max), more: Math.max(0, rows.length - max), total: rows.length };
}

// ---- Shared by the classic pages and the Harbor theme's pages (Nov 24 2026). Harbor had its own copies of these, so a fix in one could miss the other.

// THE list of download states (Nov 24 2026). Every status main.js can give a download must be here: test/downloadStates.test.js reads main.js
// and fails on one that is missing. Before this list, the page kept its own partial lists and filed "extracting" under Waiting.
//   group: 'running' (top of Downloads), 'waiting' (not started yet), 'done' (Finished list)
//   step:  which step of Download > Check > Unpack > Ready it is on (null: the step bar is not shown)
export const DOWNLOAD_STATES = {
  starting: { group: 'running', step: 'download' },
  in_progress: { group: 'running', step: 'download' },
  downloading: { group: 'running', step: 'download' },
  paused: { group: 'running', step: 'download' },
  extracting: { group: 'running', step: 'unpack' },
  queued: { group: 'waiting', step: 'download' },
  pending: { group: 'waiting', step: 'download' },
  completed: { group: 'done', step: 'ready' },
  cancelled: { group: 'done', step: null },
  error: { group: 'done', step: null },
  failed: { group: 'done', step: null },
};
// A status this list does not know is shown as running: saying "not started" about something that is working is worse.
export function downloadState(d) {
  const st = String((d && d.status) || '').toLowerCase();
  return DOWNLOAD_STATES[st] || { group: 'running', step: null };
}
// A fully downloaded title the app is still finishing: 'checking' (every file compared with its checksum) or 'extracting' (unpacking), else ''.
// Nov 24: Bodycam sat under Waiting, "starts when a slot frees up", for the ~2 minutes it was being checked and unpacked.
// The check has no status of its own: main.js keeps the status and sets statusMessage 'Checking files...'.
export function finishingStage(d) {
  if (!d) return '';
  const st = String(d.status || '').toLowerCase();
  if (st === 'extracting') return 'extracting';
  const s = DOWNLOAD_STATES[st];
  if (s && s.group === 'running' && st !== 'paused' && /^checking files/i.test(String(d.statusMessage || ''))) return 'checking';
  return '';
}

// The step bar on a download card: Download > Check > Unpack > Ready, each 'done', 'now', 'todo' or 'skip'. Null when there is no bar
// (cancelled or failed). Check and Unpack are marked skipped on a finished download whose message says so; otherwise a finished one shows all done.
export const DOWNLOAD_STEPS = [['download', 'Download'], ['check', 'Check'], ['unpack', 'Unpack'], ['ready', 'Ready']];
export function downloadSteps(d) {
  if (!d) return null;
  const fin = finishingStage(d);
  const now = fin === 'checking' ? 'check' : fin === 'extracting' ? 'unpack' : downloadState(d).step;
  if (!now) return null;
  const at = DOWNLOAD_STEPS.findIndex(([k]) => k === now);
  const msg = String(d.statusMessage || '');
  return DOWNLOAD_STEPS.map(([key, label], i) => {
    let state = i < at ? 'done' : i === at ? (key === 'ready' ? 'done' : 'now') : 'todo';
    if (now === 'ready' && key === 'unpack' && /extraction was skipped/i.test(msg)) state = 'skip';
    return { key, label, state };
  });
}
// The line a finishing download shows instead of its speed and time left.
export function finishingText(d) {
  const s = finishingStage(d);
  if (s === 'checking') return 'Download done, checking every file…';
  if (s === 'extracting') { const p = Number(d.extractPercent); return 'Unpacking' + (Number.isFinite(p) && p > 0 ? ' ' + Math.round(p) + '%' : '…'); }
  return '';
}

export function splitDownloads(list) {
  const all = Array.isArray(list) ? list : [];
  const active = all.filter((d) => downloadState(d).group === 'running');
  const waiting = all.filter((d) => downloadState(d).group === 'waiting');
  const done = all.filter((d) => downloadState(d).group === 'done').slice().reverse();
  return { active, waiting, done };
}

// Bytes still to fetch across downloads.
export function bytesLeft(list) {
  return (Array.isArray(list) ? list : []).reduce((n, d) => n + Math.max(0, (Number(d && d.totalSize) || 0) - bytesDone(d)), 0);
}

// How much of a download is on disk, matching its percent. `downloadedSize` counts finished files only, while the percent also counts the parts of the
// files fetched at once (6 at a time: 32% showed "504 MB of 39.6 GB", Nov 24), so the larger of the two is used.
export function bytesDone(d) {
  if (!d) return 0;
  const total = Number(d.totalSize) || 0;
  const fromPct = total > 0 ? Math.round(Math.max(0, Math.min(100, Number(d.progress) || 0)) / 100 * total) : 0;
  return Math.max(Number(d.downloadedSize) || 0, fromPct);
}

// Which library listing a download's title sits in: {group, folder, name}, or null (batches, unknown sections).
export function downloadPlace(d) {
  if (!d) return null;
  const parts = String(d.remotePath || '').split('/').filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const group = /^PCVR\d*$/.test(first) ? 'PCVR Games' : /^PC\d*$/.test(first) ? 'PC Games' : null;
    if (group) { const name = parts.pop(); return { group, folder: parts.join('/'), name }; }
  }
  const rp = String(d.resumePath || '').split('/').filter(Boolean);
  if (d.resumeRemote && rp.length && !rp[0].startsWith('__batch__')) {
    const name = rp.pop();
    const rem = /^PCVR-\d$/.test(d.resumeRemote) ? 'PCVR Games' : /^PC-\d$/.test(d.resumeRemote) ? 'PC Games' : d.resumeRemote;
    return { group: rem, folder: rp.join('/'), name };
  }
  return null;
}

// A trending window's entries, one per title, with count = that window's PC + PCVR downloads, most first.
// vr: true/false keeps only VR/PC titles; exclude: lower-case titles to skip; needCover: only entries with art; limit.
export function rankTrending(entries, { vr = null, exclude = [], needCover = false, limit = 9 } = {}) {
  const seen = new Set(exclude.map((t) => String(t).toLowerCase()));
  const out = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e) continue;
    const count = (Number(e.pc) || 0) + (Number(e.pcvr) || 0);
    const isVr = (Number(e.pcvr) || 0) > (Number(e.pc) || 0);
    const key = cleanTitle(e.title || e.path || '').toLowerCase();
    if (!count || !key || seen.has(key)) continue;
    if (vr !== null && isVr !== vr) continue;
    if (needCover && !e.coverUrl) continue;
    seen.add(key);
    out.push({ ...e, count, isVr });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

// The build number in a folder name ("Game v19260982 -ARMGDDN" -> "19260982"), or ''.
export function buildNumber(name) { const m = String(name || '').match(/\bv(\d{4,})\b/i); return m ? m[1] : ''; }

// Arrow keys between cards (Nov 24 2026): the card nearest in that direction, from the centre points of the cards on screen.
// A card counts as "in that direction" when it is further that way than sideways off (a 45-degree cone); the closest one wins, with
// the sideways distance counted double so Down picks the card straight below rather than one diagonally nearer. Null when there is none.
export function nearestCard(from, boxes, dir) {
  if (!from || !Array.isArray(boxes)) return null;
  let best = null, bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (!b) return;
    const dx = b.x - from.x, dy = b.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : dir === 'up' ? -dy : 0;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1 || side > along) return;
    const score = along + side * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
