'use strict';
// Which site call fetches a cover. Same hosts the website proxies (steamgriddb, steamstatic and friends); everything else is fetched directly.
const PROXIED = /(^|\.)(steamgriddb\.com|steamstatic\.com|steamcdn-a\.akamaihd\.net)$/i;

function coverRoute(rawUrl) {
  const raw = String(rawUrl == null ? '' : rawUrl).trim();
  if (!raw) return null;
  if (raw.startsWith('/api/art-proxy?') || raw.startsWith('/api/collection-cover?')) return { kind: 'site', path: raw };
  let u;
  try { u = new URL(raw.startsWith('//') ? 'https:' + raw : raw); } catch (e) { return null; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return null;
  if (PROXIED.test(u.hostname)) return { kind: 'site', path: '/api/art-proxy?url=' + encodeURIComponent(u.toString()) };
  return { kind: 'direct', url: u.toString() };
}

// The private address the page puts in <img src>; the main process resolves it with the login token.
function coverSrc(rawUrl) { return rawUrl ? 'armgddn-img://c/?u=' + encodeURIComponent(String(rawUrl)) : ''; }

module.exports = { coverRoute, coverSrc };
