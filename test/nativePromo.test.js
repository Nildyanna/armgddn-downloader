// The 3D Flick Fix strip and pill (Nov 25 2026, design approved by George): the show/hide rules (renderer/native/promo.mjs) and guards on
// where it is drawn, what it may open, and what it must never do (report clicks or views anywhere).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-12-20T12:00:00Z');
const iso = (t) => new Date(t).toISOString();
const SITE = { enabled: true, edition: 'abc123def4567890', text: { label: 'How we pay the bills:', name: '3D Flick Fix', line: '2,400+ 3D movies to download, stream or mount', shortLine: '2,400+ 3D movies' }, url: 'https://3dflickfix.net/', button: 'Visit 3D Flick Fix' };
const OLD_MEMBER = { firstRunAt: iso(NOW - 40 * DAY) };

test('the site answer is checked: enabled:false, a failed call, another host or missing words mean nothing at all', async () => {
  const { cleanPromo, promoView } = await import('../renderer/native/promo.mjs');
  const p = cleanPromo({ ok: true, data: { success: true, ...SITE } });
  assert.deepEqual(p, { edition: SITE.edition, url: 'https://3dflickfix.net/', button: 'Visit 3D Flick Fix', text: SITE.text });
  assert.deepEqual(cleanPromo(SITE), p);                                    // the bare body works too
  for (const bad of [null, undefined, { ok: false, error: { message: 'x' } }, { ok: true, data: { enabled: false } }, { ...SITE, enabled: 'yes' },
    { ...SITE, url: 'http://3dflickfix.net/' }, { ...SITE, url: 'https://evil.example/' }, { ...SITE, url: 'javascript:alert(1)' }, { ...SITE, edition: '' },
    { ...SITE, edition: 'a b' }, { ...SITE, button: '' }, { ...SITE, text: { ...SITE.text, name: '' } }]) {
    assert.equal(cleanPromo(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(promoView(null, OLD_MEMBER, NOW), { pill: false, strip: false, hidden: false, hiddenAt: null, clicked: false });
  assert.equal(cleanPromo({ ...SITE, text: { ...SITE.text, shortLine: '' } }).text.shortLine, SITE.text.line);
});

test('shown at once (pill and strip), brand-new installs included (George, 2026-11-27)', async () => {
  const { promoView } = await import('../renderer/native/promo.mjs');
  assert.deepEqual(promoView(SITE, OLD_MEMBER, NOW), { pill: true, strip: true, hidden: false, hiddenAt: null, clicked: false });
  const fresh = promoView(SITE, { firstRunAt: iso(NOW - 3 * 60 * 60 * 1000), firstRunFresh: true }, NOW);
  assert.equal(fresh.strip, true); assert.equal(fresh.pill, true); assert.equal(fresh.hidden, false);
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - 60 * 1000), firstRunFresh: true }, NOW).strip, true);
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - DAY), firstRunFresh: true }, NOW).strip, true);
  // an existing member who updated (6.15.0 stamped firstRunAt at the update, without firstRunFresh) sees it at once (George, 2026-11-25)
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - 60 * 1000) }, NOW).strip, true);
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - 60 * 1000), firstRunFresh: false }, NOW).strip, true);
  assert.equal(promoView(SITE, {}, NOW).strip, true);
  assert.equal(promoView(SITE, null, NOW).strip, true);
});

test('members cannot hide it: hides saved by older versions are ignored, a click-through does not hide it (George and DMP, 2026-11-27)', async () => {
  const m = await import('../renderer/native/promo.mjs');
  const oldHide = { ...OLD_MEMBER, promoHiddenAt: iso(NOW - DAY), promoHiddenEdition: SITE.edition };
  assert.deepEqual(m.promoView(SITE, oldHide, NOW), { pill: true, strip: true, hidden: false, hiddenAt: null, clicked: false });
  assert.equal(m.promoView(SITE, { ...oldHide, ...m.clickPatch(SITE) }, NOW).strip, true);
  assert.deepEqual(m.clickPatch(SITE), { promoClickedEdition: SITE.edition });
  for (const gone of ['hidePatch', 'showPatch', 'promoHelp', 'promoHidden', 'PROMO_RETURN_DAYS']) assert.equal(m[gone], undefined, gone + ' is gone');
});

test('App: the strip sits first on Home, the pill at the end of the top bar, and there is no way to hide it', () => {
  const src = read('renderer/native/app.mjs');
  const home = src.slice(src.indexOf('function HomeView('), src.indexOf('function HomeView(') + 4000);
  const main = home.slice(home.indexOf('return html`<main class="home">'));
  assert.ok(main.indexOf('PromoStrip') > 0 && main.indexOf('PromoStrip') < main.indexOf('HarborLead'), 'the strip is the first thing on Home');
  const header = src.slice(src.indexOf('<header class="topbar">'), src.indexOf('</header>', src.indexOf('<header class="topbar">')));
  assert.ok(header.indexOf('promo-pill') > header.indexOf("setView('downloads')"), 'the pill is at the right end of the top bar');
  assert.match(header, /promoNow\.pill \?/);
  assert.doesNotMatch(src, /promo-x|Hide for 30 days|strip on Home|hidePatch/, 'no close button and no Settings checkbox');
  assert.match(src, /class="promo-visit"[^>]*onClick=\$\{onVisit\}/);
  assert.match(src, /<img src="3dff-logo\.png" alt=""/);
});

test('App: the logo is bundled (small), nothing is loaded from 3dflickfix.net, and nothing is reported anywhere', () => {
  const logo = path.join(root, 'renderer/native/3dff-logo.png');
  assert.ok(fs.existsSync(logo));
  assert.ok(fs.statSync(logo).size < 60 * 1024);
  const src = read('renderer/native/app.mjs') + read('renderer/native/promo.mjs') + read('renderer/native/native.css');
  assert.doesNotMatch(src, /https?:\/\/[^'"\s]*3dflickfix\.net\/assets/, 'no picture from 3dflickfix.net at runtime');
  const html = read('renderer/native/index.html');
  assert.doesNotMatch((html.match(/img-src ([^;]+)/) || [])[1] || '', /3dflickfix/);
  // the only site call for it is the read-only GET; no click/impression endpoint
  const bridge = read('native/bridge.js');
  assert.match(bridge, /ipcMain\.handle\('native:promo', wrap\(\(\) => api\.get\('\/api\/app-promo'/);
  assert.doesNotMatch(bridge + read('renderer/native/app.mjs'), /app-promo\/(click|view|impression|seen)|promo(Click|View|Impression)Report/i);
  const appSrc = read('renderer/native/app.mjs');
  const visit = appSrc.slice(appSrc.indexOf('const visitPromo'), appSrc.indexOf('};', appSrc.indexOf('const visitPromo')));
  assert.doesNotMatch(visit, /api\.(?!openLink|saveSettings)\w+\(/, 'a click only opens the link and saves the setting on this PC');
});

test('Main: the link is allowed, the choices are saved settings, and the first-run time is kept', () => {
  const { LINK_HOSTS } = require('../native/bridge.js');
  assert.ok(LINK_HOSTS.has('3dflickfix.net') && LINK_HOSTS.has('www.3dflickfix.net'));
  const ipc = read('main/ipcSettings.js');
  for (const k of ['promoHiddenAt', 'promoHiddenEdition', 'promoClickedEdition']) assert.match(ipc, new RegExp("'" + k + "'"));
  assert.doesNotMatch(ipc, /'firstRunAt'/, 'the page cannot move the first-run time');
  const st = read('main/settings.js');
  assert.match(st, /ctx\.settings\.firstRunAt = new Date\(\)\.toISOString\(\)/);
  assert.match(read('preload-native.js'), /promo: call\('native:promo'\)/);
});

test('Main: normalizeSettings records firstRunAt once and cleans the promo fields', () => {
  const ctx = require('../main/context');
  const { normalizeSettings } = require('../main/settings');
  const before = ctx.settings;
  try {
    ctx.settings = { promoHiddenAt: 'nope', promoHiddenEdition: 'bad edition!', promoClickedEdition: 'abc123' };
    normalizeSettings();
    assert.ok(Number.isFinite(Date.parse(ctx.settings.firstRunAt)));
    assert.equal(ctx.settings.promoHiddenAt, ''); assert.equal(ctx.settings.promoHiddenEdition, ''); assert.equal(ctx.settings.promoClickedEdition, 'abc123');
    const first = ctx.settings.firstRunAt;
    ctx.settings.promoHiddenAt = '2026-12-01T10:00:00.000Z';
    normalizeSettings();
    assert.equal(ctx.settings.firstRunAt, first);
    assert.equal(ctx.settings.promoHiddenAt, '2026-12-01T10:00:00.000Z');
    ctx.settings.firstRunAt = '2025-01-01T00:00:00.000Z';
    normalizeSettings();
    assert.equal(ctx.settings.firstRunAt, '2025-01-01T00:00:00.000Z');
    // a settings file that already existed = an existing member, never "fresh"; no file yet = brand-new install
    ctx.settingsFileExisted = true; ctx.settings = {}; normalizeSettings(); assert.equal(ctx.settings.firstRunFresh, false);
    ctx.settingsFileExisted = false; ctx.settings = {}; normalizeSettings(); assert.equal(ctx.settings.firstRunFresh, true);
    normalizeSettings(); assert.equal(ctx.settings.firstRunFresh, true);
    ctx.settings = { firstRunAt: '2026-11-25T11:20:00.000Z' }; normalizeSettings(); assert.equal(ctx.settings.firstRunFresh, false);
  } finally { ctx.settings = before; delete ctx.settingsFileExisted; }
});
