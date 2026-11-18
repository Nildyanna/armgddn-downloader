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
