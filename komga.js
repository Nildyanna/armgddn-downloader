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
  if (match.status === 401 || match.status === 403) return { ok: false, reason: 'auth', message: 'Komga did not accept that API key.' };
  if (!match.ok) return { ok: false, reason: 'komga', message: `Komga answered with an error (${match.status}) while matching.` };

  let matched;
  try { matched = await match.json(); } catch (e) { return { ok: false, reason: 'komga', message: 'Komga sent a reply this app could not read.' }; }
  const request = matched && (matched.request || matched);
  const missing = Array.isArray(matched && matched.errors) ? matched.errors.length : 0;
  if (!request || !Array.isArray(request.bookIds) || !request.bookIds.length) {
    return { ok: false, reason: 'nomatch', message: 'None of the issues matched books in your Komga library yet. Add your comics to Komga first.' };
  }

  // A read list with the same name is replaced, so grabbing a fresh one from the site updates what the member has.
  let existingId = null;
  try {
    const found = await fetchImpl(`${base}/api/v1/readlists?unpaged=true&search=${encodeURIComponent(request.name || '')}`, { headers, signal: sig() });
    if (found.ok) {
      const page = await found.json();
      const rows = Array.isArray(page) ? page : (page && page.content) || [];
      const hit = rows.find(r => r && String(r.name || '').toLowerCase() === String(request.name || '').toLowerCase());
      if (hit && hit.id) existingId = hit.id;
    }
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
    if (patched.status === 401 || patched.status === 403) return { ok: false, reason: 'auth', message: 'Komga did not accept that API key.' };
    if (!patched.ok) return { ok: false, reason: 'komga', message: `Komga could not update the existing read list (${patched.status}).` };
    return { ok: true, count: request.bookIds.length, missing, replaced: true };
  }

  let created;
  try {
    created = await fetchImpl(`${base}/api/v1/readlists`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: sig()
    });
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: `Lost the connection to Komga at ${base}.` };
  }
  if (created.status === 401 || created.status === 403) return { ok: false, reason: 'auth', message: 'Komga did not accept that API key.' };
  if (created.status === 400) return { ok: false, reason: 'exists', message: 'Komga already has a read list with this name. Rename or delete it in Komga, then try again.' };
  if (!created.ok) return { ok: false, reason: 'komga', message: `Komga could not create the read list (${created.status}).` };
  return { ok: true, count: request.bookIds.length, missing };
}

module.exports = { LISTS, normalizeBaseUrl, addReadList };
