// The App's one advertisement (Nov 25 2026, design approved by George): 3D Flick Fix, DMP's 3D-movie service whose profit pays the server
// bills. The site says what to show (GET /api/app-promo, edited in the site's config/app-promo.json); the App decides whether to show it.
// A slim strip at the top of Home and a "3D Flick Fix" pill in the top bar. These are the pure parts, tested in test/nativePromo.test.js.
// No tracking: nothing here is sent anywhere.
// Members cannot hide it (George and DMP, 2026-11-27: "Let's not let them dismiss"; it is the App's only ad and pays the bills).
// The ✕ and the Settings checkbox are gone, and hides saved by older versions (promoHiddenAt / promoHiddenEdition) are ignored.

// The only place the strip and pill may send the member (the main process allows the same hosts, native/bridge.js LINK_HOSTS).
export const PROMO_HOSTS = new Set(['3dflickfix.net', 'www.3dflickfix.net']);

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// The site's answer, checked. Anything odd (disabled, failed, wrong host, missing words) is null: no strip and no pill anywhere.
export function cleanPromo(r) {
  const d = r && r.ok && r.data ? r.data : r;
  if (!d || typeof d !== 'object' || d.enabled !== true) return null;
  const edition = str(d.edition, 64);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(edition)) return null;
  let url;
  try { url = new URL(String(d.url || '')); } catch (e) { return null; }
  if (url.protocol !== 'https:' || !PROMO_HOSTS.has(url.hostname)) return null;
  const t = d.text && typeof d.text === 'object' ? d.text : {};
  const name = str(t.name, 40), button = str(d.button, 30);
  if (!name || !button) return null;
  const line = str(t.line, 90);
  return { edition, url: url.toString(), button, text: { label: str(t.label, 40), name, line, shortLine: str(t.shortLine, 40) || line } };
}


// What to show: { pill, strip, hidden, hiddenAt, clicked }.
// pill and strip: whenever the site has a promo, from the first minute (no first-day wait since 2026-11-27).
// hidden / hiddenAt / clicked stay in the answer (always false / null) so older callers keep working.
export function promoView(promo, s, now = Date.now()) {
  if (!promo) return { pill: false, strip: false, hidden: false, hiddenAt: null, clicked: false };
  const st = s || {};
  const hidden = false;
  // Shown at once, brand-new installs included (George, 2026-11-27: "no more wait, it shows instantly").
  return { pill: true, strip: true, hidden, hiddenAt: null, clicked: false };
}

// The setting saved when the member clicks through (kept for the record; it no longer hides anything).
export const clickPatch = (promo) => ({ promoClickedEdition: promo ? promo.edition : '' });
