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
export function filterAndSort(items, { query = '', sort = 'name' } = {}) {
  const q = String(query).trim().toLowerCase();
  let out = (items || []).filter((x) => x && (!q || String(x.name || '').toLowerCase().includes(q)));
  const by = {
    name: (a, b) => cleanTitle(a.name).localeCompare(cleanTitle(b.name), undefined, { sensitivity: 'base', numeric: true }),
    newest: (a, b) => String(b.firstSeenAt || b.modTime || '').localeCompare(String(a.firstSeenAt || a.modTime || '')) || by.name(a, b),
    size: (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || by.name(a, b),
  };
  return out.slice().sort(by[sort] || by.name);
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
