// Game Radar, ported from the website: picks for you, from what you opened lately, saved, downloaded and what is trending.
// Pure functions only (the screen is in app.mjs), so the rules can be tested.
export const RADAR_CARDS = 3;
export const RADAR_HISTORY_MAX = 12;
const LIMITS = { history: 25, myList: 25, related: 25, trending: 100 };

export const isRadarRemote = (r) => r === 'PC Games' || r === 'PCVR Games';
export const radarPath = (p) => String(p || '').replace(/^\/+|\/+$/g, '');
// The tabs are the groups: PC-1/2/3 are PC Games, PCVR-1/2/3 are PCVR Games.
export const radarGroup = (remote) => (/^PC-\d$/i.test(remote) ? 'PC Games' : /^PCVR-\d$/i.test(remote) ? 'PCVR Games' : String(remote || ''));

export function radarFileTitle(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  t = t.replace(/^(PC\d+|PCVR\d+)\s*\/\s*/i, '');
  t = t.replace(/\s+-?\s*ARMGDDN.*$/i, '');
  t = t.replace(/\s+\+[A-Z0-9].*$/i, '');
  t = t.replace(/\s+v(?:er\.?\s*)?\d[\dA-Za-z.\-]*\s*$/i, '');
  t = t.replace(/\s+ver\.?\s*\d[\dA-Za-z.\-]*\s*$/i, '');
  t = t.replace(/\s+v[A-Za-z]+\s+Release\s+Patch[\dA-Za-z.\-\s]*\s*$/i, '');
  t = t.replace(/\s+-[A-Z0-9]{2,}\s*$/i, '');
  t = t.replace(/\s*[(\[][^(\[\])]*[)\]]\s*$/g, '');
  t = t.replace(/\s+v(?:er\.?\s*)?\d[\dA-Za-z.\-]*\s*$/i, '');
  t = t.replace(/\s+ver\.?\s*\d[\dA-Za-z.\-]*\s*$/i, '');
  t = t.replace(/\s+vPatch\d*\s*$/i, '');
  t = t.replace(/\s+shipping\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}
export function radarComparable(title) {
  const t = radarFileTitle(title);
  return (t || String(title || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function radarTitle(item) {
  if (!item) return '';
  if (item.title) return String(item.title);
  if (item.name) return String(item.name);
  const parts = radarPath(item.path).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(item.remote || '');
}
export function radarKey(remote, path, name) {
  const p = radarPath(path);
  return `${String(remote || '').trim()}/${p || String(name || '').trim()}`;
}
function tasteText(text) {
  return radarFileTitle(text).toLowerCase().replace(/[™®]/g, '').replace(/\bv\d+(?:\.\d+)*\b/gi, ' ').replace(/[-_+()[\]{}:;,.!?'"`~]/g, ' ')
    .replace(/\b(armgddn|ofme|repack|portable|complete|collection|edition|deluxe|ultimate|game|games|the|and|for|with|vr|pcvr|pc)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}
export function tasteVariants(text) {
  const tokens = tasteText(text).split(' ').filter((t) => t && t.length >= 3).slice(0, 12);
  const out = []; const seen = new Set();
  const push = (value, weight) => { const t = String(value || '').trim(); if (!t || seen.has(t)) return; seen.add(t); out.push({ token: t, weight }); };
  for (const t of tokens) {
    push(t, 1);
    if (t.length >= 4) push(t.slice(0, 4), 0.45);
    if (t.length >= 5) push(t.slice(0, 5), 0.35);
    const stem = t.replace(/(?:ing|ed|es|s)$/i, '').trim();
    if (stem && stem.length >= 3 && stem !== t) push(stem, 0.55);
  }
  return out;
}
const historyTitle = (e) => {
  if (!e) return '';
  const cleaned = radarFileTitle(e.title || e.name || e.filename || e.fileName || '');
  if (cleaned) return cleaned;
  const parts = radarPath(e.path).split('/').filter(Boolean);
  return parts.length ? radarFileTitle(parts[parts.length - 1]) : '';
};

// What the member's finished downloads say about their taste: words from the titles, weighted by how recent, and PC against PCVR.
export function downloadProfile(downloads) {
  const profile = { tokenCounts: new Map(), pc: 0, pcvr: 0, total: 0 };
  const list = (Array.isArray(downloads) ? downloads : []).slice(0, 100);
  const n = list.length || 1;
  list.forEach((e, i) => {
    if (!e || (e.status && String(e.status).toLowerCase() !== 'completed')) return;
    const variants = tasteVariants(historyTitle(e));
    if (!variants.length) return;
    const recency = 0.7 + 0.3 * ((n - i) / n);
    profile.total += 1;
    if (String(e.remote || e.group || '').toUpperCase().includes('VR')) profile.pcvr += 1; else profile.pc += 1;
    for (const v of variants) profile.tokenCounts.set(v.token, (profile.tokenCounts.get(v.token) || 0) + v.weight * recency);
  });
  return profile;
}
export function affinity(item, profile) {
  if (!item || !profile || !profile.total) return 0;
  const variants = tasteVariants(radarTitle(item));
  if (!variants.length) return 0;
  let score = 0;
  for (const v of variants) { const hits = profile.tokenCounts.get(v.token) || 0; if (hits) score += Math.min(0.18, 0.05 * hits * v.weight); }
  const remote = String(item.remote || '').toUpperCase();
  if (profile.pcvr > profile.pc && remote.includes('PCVR')) score += 0.08;
  else if (profile.pc > profile.pcvr && remote.includes('PC ')) score += 0.08;
  return Math.min(score, 0.4);
}
export function blockedTitles(downloads) {
  const blocked = new Set();
  for (const e of (Array.isArray(downloads) ? downloads : [])) {
    if (!e) continue;
    for (const v of [historyTitle(e), e.title || e.name || e.filename || e.fileName || '']) { const k = radarComparable(v); if (k) blocked.add(k); }
  }
  return blocked;
}

const entry = (o) => ({ browseRemote: o.remote, coverArt: null, releaseDate: null, downloadCount: 0, badges: [], priority: 1.5, ...o });
function fromHistory(history) {
  const out = [];
  for (const e of (Array.isArray(history) ? history : [])) {
    if (!e || !isRadarRemote(e.remote) || radarPath(e.path).split('/').filter(Boolean).length < 2) continue;
    out.push(entry({ remote: e.remote, path: e.path || '', name: e.name || e.title || '', title: radarTitle(e), downloadCount: Number(e.downloadCount) || 0, releaseDate: e.releaseDate || null, coverArt: e.coverArt || null,
      reason: out.length === 0 ? 'Continue browsing' : 'Recently visited', why: out.length === 0 ? 'Because this was your last visited game folder' : 'Because you came back to it recently', badges: ['history'], source: 'history' }));
  }
  return out.slice(0, LIMITS.history);
}
function fromMyList(list) {
  const sorted = (Array.isArray(list) ? list : []).filter((i) => i && isRadarRemote(radarGroup(i.remote))).slice().sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
  return sorted.slice(0, LIMITS.myList).map((i, idx) => entry({ remote: radarGroup(i.remote), path: i.path || '', name: i.name || '', title: i.name || '', downloadCount: Number(i.downloadCount) || 0, releaseDate: i.releaseDate || null, coverArt: i.coverArt || null,
    reason: idx === 0 ? 'Saved in My List' : 'More saved picks', why: idx === 0 ? 'Because you saved it to My List' : 'Because it is already in your saved titles', badges: ['saved'], source: 'my-list' }));
}
function fromRelated(items) {
  return (Array.isArray(items) ? items : []).filter((i) => i && i.remote && i.path).map((i) => entry({ remote: radarGroup(i.remote), browseRemote: i.browseRemote || i.remote, path: i.path, name: i.name || i.title || '', title: i.title || i.name || '',
    downloadCount: Number(i.downloadCount) || 0, releaseDate: i.releaseDate || null, coverArt: i.coverArt || null, reason: i.reason || 'Related to your recent downloads', why: i.why || 'Category tagged by Steam as something you might enjoy',
    badges: Array.isArray(i.badges) ? i.badges : ['related'], source: i.source || 'related' })).slice(0, LIMITS.related);
}
function fromTrending(windows) {
  const items = []; const seen = new Set();
  for (const win of ['week', 'month']) {
    for (const e of (windows && Array.isArray(windows[win]) ? windows[win] : [])) {
      if (!e || !e.title) continue;
      const remote = radarGroup(e.remote || e.canonical || '') || 'PC Games';
      const path = radarPath(e.path || e.folderName || e.title);
      const key = radarKey(remote, path, e.title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(entry({ remote, browseRemote: e.remote || remote, path, name: e.title, title: e.title, downloadCount: Number(e.total || (e.pc || 0) + (e.pcvr || 0)) || 0, coverArt: e.coverUrl ? { cover: { url: e.coverUrl } } : null,
        reason: win === 'week' ? 'Hot this week' : 'Hot this month', why: win === 'week' ? `Because people are downloading it in ${remote}` : `Because it is trending in ${remote}`, badges: ['trending'], priority: 0.8, source: 'trending', windowKey: win }));
    }
  }
  items.sort((a, b) => (b.downloadCount - a.downloadCount) || String(a.title).localeCompare(String(b.title)));
  return items.slice(0, LIMITS.trending);
}

// One list of suggestions from every source, each title once (a title from several sources keeps all its badges and the best cover).
export function mergeSuggestions(sources) {
  const seen = new Map(); const list = [];
  const keyOf = (i) => { const p = radarPath(i.path).toLowerCase(); const r = String(i.remote || '').trim().toLowerCase(); return p ? `${r}::${p}` : `${r}::${String(i.title || i.name || '').trim().toLowerCase()}`; };
  for (const i of sources) {
    if (!i || !i.remote) continue;
    const k = keyOf(i); const have = seen.get(k);
    if (!have) { const next = { ...i, badges: [...(i.badges || [])] }; seen.set(k, next); list.push(next); continue; }
    if (!have.coverArt && i.coverArt) have.coverArt = i.coverArt;
    if (!have.releaseDate && i.releaseDate) have.releaseDate = i.releaseDate;
    if (i.source === 'trending' && have.source !== 'trending') { have.source = 'trending'; have.reason = i.reason || have.reason; have.why = i.why || have.why; }
    have.badges = Array.from(new Set([...(have.badges || []), ...(i.badges || [])]));
    if (typeof i.priority === 'number' && (typeof have.priority !== 'number' || i.priority < have.priority)) { const badges = Array.from(new Set([...(i.badges || []), ...(have.badges || [])])); Object.assign(have, i); have.badges = badges; }
  }
  return list;
}

// The ordered, filtered picks. `noise(key, which)` gives a number from 0 to 1 (random in the app, fixed in the tests).
export function radarPicks({ trending, history, myList, related, downloads, dismissed, seen, offset = 0, noise }) {
  const trendingItems = fromTrending(trending);
  const all = mergeSuggestions([...fromHistory(history), ...fromMyList(myList), ...fromRelated(related), ...trendingItems]);
  const profile = downloadProfile(downloads);
  for (const i of all) {
    const k = radarKey(i.remote, i.path, i.name || i.title);
    const aff = profile.total > 0 ? affinity(i, profile) : 0;
    i._score = (Number.isFinite(i.priority) ? i.priority : 99) - noise(k, 1) * 0.12 - noise(k, 2) * 0.35 - aff * 0.06;
  }
  all.sort((a, b) => a._score - b._score || String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
  const blocked = blockedTitles(downloads);
  const gone = new Set(dismissed || []);
  const shown = seen || new Set();
  let visible = all.filter((i) => {
    if (i.source === 'trending') return true;
    const t = radarComparable(radarTitle(i));
    if (t && blocked.has(t)) return false;
    const k = radarKey(i.remote, i.path, i.name || i.title);
    return !gone.has(k) && !shown.has(k);
  });
  if (!visible.length) visible = trendingItems.slice();
  const n = visible.length ? ((Number(offset) || 0) % visible.length) : 0;
  return n > 0 ? visible.slice(n).concat(visible.slice(0, n)) : visible;
}
