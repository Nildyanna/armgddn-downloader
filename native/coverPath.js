'use strict';
// Which site call fetches a cover. Same hosts the website proxies (steamgriddb, steamstatic and friends); everything else is fetched directly.
const PROXIED = /(^|\.)(steamgriddb\.com|steamstatic\.com|steamcdn-a\.akamaihd\.net)$/i;

function coverRoute(rawUrl) {
  const raw = String(rawUrl == null ? '' : rawUrl).trim();
  if (!raw) return null;
  if (raw.startsWith('/api/art-proxy?') || raw.startsWith('/api/collection-cover?') || raw.startsWith('/api/item-art?')) return { kind: 'site', path: raw };
  let u;
  try { u = new URL(raw.startsWith('//') ? 'https:' + raw : raw); } catch (e) { return null; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return null;
  if (PROXIED.test(u.hostname)) return { kind: 'site', path: '/api/art-proxy?url=' + encodeURIComponent(u.toString()) };
  if (!isPublicHostName(u.hostname)) return null;
  return { kind: 'direct', url: u.toString() };
}

// Covers hosted elsewhere are fetched by this PC, so an address that points inside the member's own network (or at this PC) is refused:
// a bad cover link must not be able to probe the router, a NAS or a local service. Checked on the name, then again on every address it resolves to.
function isPrivateAddress(ip) {
  const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || p >= 224;
  }
  if (a.includes(':')) {
    if (a === '::' || a === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
  }
  return false;
}
function isPublicHostName(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home') || !h.includes('.') && !h.includes(':')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || /^\[/.test(h)) return !isPrivateAddress(h);
  return true;
}
const MAX_COVER_BYTES = 8 * 1024 * 1024;

// The private address the page puts in <img src>; the main process resolves it with the login token.
function coverSrc(rawUrl) { return rawUrl ? 'armgddn-img://c/?u=' + encodeURIComponent(String(rawUrl)) : ''; }

module.exports = { coverRoute, coverSrc, isPrivateAddress, isPublicHostName, MAX_COVER_BYTES };
