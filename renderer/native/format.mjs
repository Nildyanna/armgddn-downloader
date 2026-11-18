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
