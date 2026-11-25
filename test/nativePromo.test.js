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

test('shown by default (pill and strip), but not on the member\'s first day in the App', async () => {
  const { promoView } = await import('../renderer/native/promo.mjs');
  assert.deepEqual(promoView(SITE, OLD_MEMBER, NOW), { pill: true, strip: true, hidden: false, hiddenAt: null, clicked: false });
  const fresh = promoView(SITE, { firstRunAt: iso(NOW - 3 * 60 * 60 * 1000) }, NOW);
  assert.equal(fresh.strip, false); assert.equal(fresh.pill, true); assert.equal(fresh.hidden, false);
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - DAY + 1000) }, NOW).strip, false);
  assert.equal(promoView(SITE, { firstRunAt: iso(NOW - DAY) }, NOW).strip, true);
  assert.equal(promoView(SITE, {}, NOW).strip, false);                    // not known yet: treated as the first day
  assert.equal(promoView(SITE, null, NOW).strip, false);
  assert.equal(promoView(SITE, { firstRunAt: 'garbage' }, NOW).strip, false);
});

test('the ✕ hides the strip (not the pill) for 30 days, then it comes back by itself', async () => {
  const { promoView, hidePatch } = await import('../renderer/native/promo.mjs');
  const hid = { ...OLD_MEMBER, ...hidePatch(SITE, NOW) };
  assert.deepEqual(hidePatch(SITE, NOW), { promoHiddenAt: iso(NOW), promoHiddenEdition: SITE.edition });
  const v = promoView(SITE, hid, NOW + 1000);
  assert.equal(v.strip, false); assert.equal(v.pill, true); assert.equal(v.hidden, true); assert.equal(v.hiddenAt, iso(NOW)); assert.equal(v.clicked, false);
  assert.equal(promoView(SITE, hid, NOW + 29 * DAY).strip, false);
  assert.equal(promoView(SITE, hid, NOW + 30 * DAY).strip, true);
  assert.equal(promoView(SITE, hid, NOW + 30 * DAY).hidden, false);      // the Settings box ticks itself again too
});

test('after a click-through (Visit or the pill) a hidden strip stays hidden until a new edition', async () => {
  const { promoView, hidePatch, clickPatch } = await import('../renderer/native/promo.mjs');
  assert.deepEqual(clickPatch(SITE), { promoClickedEdition: SITE.edition });
  const st = { ...OLD_MEMBER, ...clickPatch(SITE), ...hidePatch(SITE, NOW) };
  assert.equal(promoView(SITE, st, NOW + 31 * DAY).strip, false);
  assert.equal(promoView(SITE, st, NOW + 400 * DAY).strip, false);
  assert.equal(promoView(SITE, st, NOW + 400 * DAY).clicked, true);
  // a click alone does not hide anything
  assert.equal(promoView(SITE, { ...OLD_MEMBER, ...clickPatch(SITE) }, NOW).strip, true);
  // a click on an older edition does not keep this one away after 30 days
  const older = { ...OLD_MEMBER, promoClickedEdition: 'older0000000', ...hidePatch(SITE, NOW) };
  assert.equal(promoView(SITE, older, NOW + 31 * DAY).strip, true);
});

test('a new edition shows the strip again for everyone, including members who hid it and clicked through', async () => {
  const { promoView, hidePatch, clickPatch } = await import('../renderer/native/promo.mjs');
  const st = { ...OLD_MEMBER, ...clickPatch(SITE), ...hidePatch(SITE, NOW) };
  const next = { ...SITE, edition: 'ffff000011112222' };
  assert.equal(promoView(next, st, NOW + DAY).strip, true);
  assert.equal(promoView(next, st, NOW + DAY).hidden, false);
  // a new edition is still not shown on the first day
  assert.equal(promoView(next, { ...st, firstRunAt: iso(NOW) }, NOW + 1000).strip, false);
});

test('ticking the Settings box shows it again at once', async () => {
  const { promoView, hidePatch, showPatch, clickPatch } = await import('../renderer/native/promo.mjs');
  const st = { ...OLD_MEMBER, ...clickPatch(SITE), ...hidePatch(SITE, NOW) };
  assert.equal(promoView(SITE, st, NOW + 1000).strip, false);
  const back = { ...st, ...showPatch() };
  assert.deepEqual(showPatch(), { promoHiddenAt: '', promoHiddenEdition: '' });
  assert.equal(promoView(SITE, back, NOW + 2000).strip, true);
});

test('the Settings helper text', async () => {
  const { promoView, promoHelp, hidePatch, clickPatch } = await import('../renderer/native/promo.mjs');
  const fmt = () => 'December 20, 2026';
  assert.equal(promoHelp(promoView(SITE, OLD_MEMBER, NOW), fmt), "It's how we pay the server bills.");
  assert.equal(promoHelp(promoView(SITE, { ...OLD_MEMBER, ...hidePatch(SITE, NOW) }, NOW), fmt),
    "It's how we pay the server bills. Hidden on December 20, 2026 — it comes back on its own after 30 days or when there’s something new to say.");
  assert.equal(promoHelp(promoView(SITE, { ...OLD_MEMBER, ...clickPatch(SITE), ...hidePatch(SITE, NOW) }, NOW), fmt),
    "It's how we pay the server bills. Hidden on December 20, 2026 — it comes back when there’s something new to say.");
  assert.equal(promoHelp(null), "It's how we pay the server bills.");
});

test('App: the strip sits first on Home, the pill at the end of the top bar, the Settings box under Home screen', () => {
  const src = read('renderer/native/app.mjs');
  const home = src.slice(src.indexOf('function HomeView('), src.indexOf('function HomeView(') + 4000);
  const main = home.slice(home.indexOf('return html`<main class="home">'));
  assert.ok(main.indexOf('PromoStrip') > 0 && main.indexOf('PromoStrip') < main.indexOf('HarborLead'), 'the strip is the first thing on Home');
  const header = src.slice(src.indexOf('<header class="topbar">'), src.indexOf('</header>', src.indexOf('<header class="topbar">')));
  assert.ok(header.indexOf('promo-pill') > header.indexOf("setView('downloads')"), 'the pill is at the right end of the top bar');
  assert.match(header, /promoNow\.pill \?/);
  assert.match(src, /<h3>Home screen<\/h3>[\s\S]{0,400}Show the \$\{promo\.name\} strip on Home/);
  assert.match(src, /aria-label="Hide for 30 days"/);
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
  const visit = appSrc.slice(appSrc.indexOf('const visitPromo'), appSrc.indexOf('const hidePromo'));
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
  } finally { ctx.settings = before; }
});
