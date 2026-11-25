// The App's one advertisement (Nov 25 2026, design approved by George): 3D Flick Fix, DMP's 3D-movie service whose profit pays the server
// bills. The site says what to show (GET /api/app-promo, edited in the site's config/app-promo.json); the App decides whether to show it.
// A slim strip at the top of Home and a "3D Flick Fix" pill in the top bar. These are the pure parts, tested in test/nativePromo.test.js.
// No tracking: nothing here is sent anywhere. The member's choices are kept in the App's settings (main/settings.js):
//   promoHiddenAt (ISO time the ✕ was pressed), promoHiddenEdition (the edition hidden), promoClickedEdition (the edition clicked through).

export const PROMO_RETURN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
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

const timeOf = (iso) => { const n = Date.parse(iso || ''); return Number.isFinite(n) ? n : null; };

// Is the member's own choice keeping the strip away right now? (The Settings checkbox is the opposite of this.)
// Hidden this edition and clicked through: hidden until a new edition. Hidden this edition: hidden for 30 days. A new edition: not hidden.
export function promoHidden(promo, s, now = Date.now()) {
  if (!promo || !s) return false;
  const at = timeOf(s.promoHiddenAt);
  if (at == null || s.promoHiddenEdition !== promo.edition) return false;
  if (s.promoClickedEdition === promo.edition) return true;
  return now - at < PROMO_RETURN_DAYS * DAY_MS;
}

// What to show: { pill, strip, hidden, hiddenAt, clicked }.
// pill: whenever the site has a promo. strip: also not hidden, and not on the member's first day in the App (settings.firstRunAt).
export function promoView(promo, s, now = Date.now()) {
  if (!promo) return { pill: false, strip: false, hidden: false, hiddenAt: null, clicked: false };
  const st = s || {};
  const hidden = promoHidden(promo, st, now);
  const first = timeOf(st.firstRunAt);
  const firstDay = first == null || now - first < DAY_MS;      // unknown counts as the first day (the App records it at start)
  return { pill: true, strip: !hidden && !firstDay, hidden, hiddenAt: hidden ? st.promoHiddenAt : null, clicked: hidden && st.promoClickedEdition === promo.edition };
}

// The settings to save for each thing the member does.
export const hidePatch = (promo, now = Date.now()) => ({ promoHiddenAt: new Date(now).toISOString(), promoHiddenEdition: promo ? promo.edition : '' });
export const showPatch = () => ({ promoHiddenAt: '', promoHiddenEdition: '' });
export const clickPatch = (promo) => ({ promoClickedEdition: promo ? promo.edition : '' });

// The Settings helper line under the checkbox.
export function promoHelp(view, fmtDate = (d) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })) {
  const base = "It's how we pay the server bills.";
  if (!view || !view.hidden || !view.hiddenAt) return base;
  const d = new Date(view.hiddenAt);
  if (Number.isNaN(d.getTime())) return base;
  // After a click-through it only comes back with a new edition, so the 30 days are not promised then.
  return base + ' Hidden on ' + fmtDate(d) + (view.clicked ? ' — it comes back when there’s something new to say.' : ' — it comes back on its own after 30 days or when there’s something new to say.');
}
