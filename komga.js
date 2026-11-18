// Adds a ComicRack reading list (.cbl) to the member's own Komga server.
// Kept free of Electron so it can be tested against a stand-in Komga (test/komga.test.js).
'use strict';

const LISTS = {
  marvel: { file: 'Marvel Universe - Suggested Reading Order.cbl', title: 'Marvel Universe - Complete Collection' },
  dc: { file: 'DC Universe - Suggested Reading Order.cbl', title: 'DC Universe - Complete Collection' },
  batman: { file: 'Batman Collection - Suggested Reading Order.cbl', title: 'Batman Collection' },
  daredevil: { file: 'Daredevil Collection - Suggested Reading Order.cbl', title: 'Daredevil Collection' },
  spiderman: { file: 'Spider-Man Collection - Suggested Reading Order.cbl', title: 'Spider-Man Collection' },
  superman: { file: 'Superman - Suggested Reading Order.cbl', title: 'Superman' }
};

// "localhost:25600" -> "http://localhost:25600". Returns null for anything that is not a plain http(s) address.
function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch (e) { return null; }
}


// ---- Komga's current match answer (seen on 1.28). Older versions answered with a ready request ({ request: { bookIds } }); newer ones
// answer with the candidates for each book of the list and leave the choice to the client:
//   { readListMatch: { name }, requests: [ { request: { series: [...], number }, matches: [ { series: { seriesId, title, releaseDate }, books: [ { bookId, number, title } ] } ] } ] }
// The requests come back in the order of the <Book> entries in the file. The choice is made carefully: a book is taken only when the series is
// unambiguous, and a list is never filled with a guess.
function parseBookEntries(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<Book\b([^>]*?)\/?>/g)) {
    const attr = (n) => { const r = new RegExp('\\b' + n + '="([^"]*)"').exec(m[1]); return r ? r[1] : ''; };
    out.push({ series: attr('Series'), number: attr('Number'), volume: attr('Volume'), year: attr('Year') });
  }
  return out;
}
const yearOf = (d) => { const y = parseInt(String(d || '').slice(0, 4), 10); return Number.isFinite(y) ? y : 0; };

// -> { bookIds, missing, ambiguous, name }. missing = nothing in the library; ambiguous = several series could be meant, so it was left out.
function chooseFromRequests(xml, matched) {
  const entries = parseBookEntries(xml);
  const reqs = Array.isArray(matched && matched.requests) ? matched.requests : [];
  const hints = entries.length === reqs.length;
  const bookIds = []; let missing = 0, ambiguous = 0;
  reqs.forEach((item, i) => {
    const cands = (Array.isArray(item && item.matches) ? item.matches : []).filter((c) => c && c.series && Array.isArray(c.books) && c.books.length);
    if (!cands.length) { missing++; return; }
    const hint = hints ? (parseInt(entries[i].volume, 10) || parseInt(entries[i].year, 10) || 0) : 0;
    let pick = null;
    if (cands.length === 1) pick = cands[0];
    else if (hint) { const exact = cands.filter((c) => yearOf(c.series.releaseDate) === hint); if (exact.length === 1) pick = exact[0]; }
    if (!pick) { ambiguous++; return; }
    const num = String(item.request && item.request.number != null ? item.request.number : (hints ? entries[i].number : '')).trim();
    const isExtra = (b) => /annual|special|king[- ]size|one[- ]shot/i.test(String(b.title || ''));
    const own = pick.books.filter((b) => !isExtra(b));
    const exactTitle = own.find((b) => num !== '' && new RegExp('#\\s*' + num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])').test(String(b.title || '')));
    const book = exactTitle || own[0] || pick.books[0];
    if (book && book.bookId && !bookIds.includes(book.bookId)) bookIds.push(book.bookId);
  });
  const nm = /<Name>([^<]*)<\/Name>/.exec(String(xml || ''));
  return { bookIds, missing, ambiguous, name: (matched && matched.readListMatch && matched.readListMatch.name) || (nm ? nm[1] : '') };
}

// Returns { ok: true, count, missing } or { ok: false, reason, message }.
// reason: 'unreachable' | 'auth' | 'nomatch' | 'exists' | 'komga'. replaced: true when an existing list of that name was updated.
async function addReadList({ baseUrl, apiKey, xml, fileName, fetchImpl = fetch, timeoutMs = 30000 }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, reason: 'komga', message: 'That Komga address does not look right.' };
  const headers = { 'X-API-Key': apiKey };
  const sig = () => AbortSignal.timeout(timeoutMs);

  let match;
  try {
    const form = new FormData();
    form.append('file', new Blob([xml], { type: 'application/xml' }), fileName);
    match = await fetchImpl(`${base}/api/v1/readlists/match/comicrack`, { method: 'POST', headers, body: form, signal: sig() });
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: `Could not reach Komga at ${base}. Is it running?` };
  }
  if (match.status === 401 || match.status === 403) return { ok: false, reason: 'auth', step: 'match', status: match.status, message: 'Komga did not accept that API key.' };
  if (!match.ok) return { ok: false, reason: 'komga', step: 'match', status: match.status, message: `Komga answered with an error (${match.status}) while matching.` };

  let matched;
  try { matched = await match.json(); } catch (e) { return { ok: false, reason: 'komga', message: 'Komga sent a reply this app could not read.' }; }
  let request, missing, ambiguous = 0;
  if (matched && Array.isArray(matched.requests)) {
    const c = chooseFromRequests(xml, matched);
    request = { name: c.name, summary: '', ordered: true, bookIds: c.bookIds };
    missing = c.missing + c.ambiguous; ambiguous = c.ambiguous;
  } else {
    request = matched && (matched.request || matched);
    missing = Array.isArray(matched && matched.errors) ? matched.errors.length : 0;
  }
  if (!request || !Array.isArray(request.bookIds) || !request.bookIds.length) {
    return { ok: false, reason: 'nomatch', ambiguous, message: ambiguous
      ? `Your Komga has several series that these issues could belong to (${ambiguous} issue${ambiguous === 1 ? '' : 's'}), so the app could not tell which one the list means. Nothing was added.`
      : 'None of the issues matched books in your Komga library yet. Add your comics to Komga first.' };
  }

  // A read list with the same name is replaced, so grabbing a fresh one from the site updates what the member has.
  // Komga's name search can miss a list that exists (it did for one created minutes earlier), so when the search finds nothing the whole set of
  // read lists is checked by name. Without this a second run answered "already exists" instead of updating the list.
  let existingId = null;
  const findByName = async (query) => {
    const found = await fetchImpl(`${base}/api/v1/readlists?unpaged=true${query}`, { headers, signal: sig() });
    if (!found.ok) return null;
    const page = await found.json();
    const rows = Array.isArray(page) ? page : (page && page.content) || [];
    const hit = rows.find(r => r && String(r.name || '').toLowerCase() === String(request.name || '').toLowerCase());
    return hit && hit.id ? hit.id : null;
  };
  try {
    existingId = await findByName(`&search=${encodeURIComponent(request.name || '')}`);
    if (!existingId) existingId = await findByName('');
  } catch (e) { /* fall through to a normal create */ }
  if (existingId) {
    let patched;
    try {
      patched = await fetchImpl(`${base}/api/v1/readlists/${encodeURIComponent(existingId)}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: request.name, summary: request.summary, ordered: request.ordered !== false, bookIds: request.bookIds }), signal: sig()
      });
    } catch (e) {
      return { ok: false, reason: 'unreachable', message: `Lost the connection to Komga at ${base}.` };
    }
    if (patched.status === 401 || patched.status === 403) return { ok: false, reason: 'auth', step: 'update', status: patched.status, message: 'Komga did not accept that API key.' };
    if (!patched.ok) return { ok: false, reason: 'komga', step: 'update', status: patched.status, message: `Komga could not update the existing read list (${patched.status}).` };
    return { ok: true, count: request.bookIds.length, missing, ambiguous, replaced: true };
  }

  let created;
  try {
    created = await fetchImpl(`${base}/api/v1/readlists`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: sig()
    });
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: `Lost the connection to Komga at ${base}.` };
  }
  if (created.status === 401 || created.status === 403) return { ok: false, reason: 'auth', step: 'create', status: created.status, message: 'Komga did not accept that API key.' };
  if (created.status === 400) return { ok: false, reason: 'exists', message: 'Komga already has a read list with this name. Rename or delete it in Komga, then try again.' };
  if (!created.ok) return { ok: false, reason: 'komga', step: 'create', status: created.status, message: `Komga could not create the read list (${created.status}).` };
  return { ok: true, count: request.bookIds.length, missing, ambiguous };
}

// The site decides which reading orders exist (new ones appear on their own), so any well-formed id is accepted here
// and the site answers 404 for an unknown one.
function isValidListId(id) { return typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 60; }

module.exports = { LISTS, normalizeBaseUrl, addReadList, isValidListId, parseBookEntries, chooseFromRequests };
