'use strict';
// Dark / Light / System are viewing modes; the theme menu lists only that side's themes (renderer/native/themeMode.mjs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const THEMES = { ...require('../renderer/native/themes.json'), ...require('../renderer/native/themes-custom.json') };
const load = () => import('../renderer/native/themeMode.mjs');
const getter = (o) => (k) => (k in o ? o[k] : null);

test('the theme menu for each mode holds only that mode\'s themes, default first', async () => {
  const m = await load();
  const dark = m.themesForMode(THEMES, 'dark'), light = m.themesForMode(THEMES, 'light');
  assert.ok(dark.every(([k]) => m.modeOf(THEMES, k) === 'dark') && light.every(([k]) => m.modeOf(THEMES, k) === 'light'));
  assert.deepStrictEqual(dark.slice(0, 2).map((x) => x[1]), ['Harbor (default)', 'Classic']);
  assert.strictEqual(light[0][1], 'Light (default)');
  assert.ok(light.some(([k]) => k === 'parchment') && !dark.some(([k]) => k === 'parchment'));
  assert.strictEqual(dark.length + light.length, Object.keys(THEMES).length);
  assert.deepStrictEqual(m.THEME_MODES.map((x) => x[1]), ['Dark', 'Light', 'System']);
});

test('an older saved single theme becomes a mode plus that theme', async () => {
  const m = await load();
  assert.deepStrictEqual(m.loadChoice(THEMES, getter({ 'native.theme': 'parchment' })), { mode: 'light', dark: 'harbor', light: 'parchment' });
  assert.deepStrictEqual(m.loadChoice(THEMES, getter({ 'native.theme': 'void' })), { mode: 'dark', dark: 'void', light: 'light' });
  assert.deepStrictEqual(m.loadChoice(THEMES, getter({ 'native.theme': 'system' })), { mode: 'system', dark: 'harbor', light: 'light' });
  assert.deepStrictEqual(m.loadChoice(THEMES, getter({})), { mode: 'dark', dark: 'harbor', light: 'light' });
  // a saved theme on the wrong side is replaced by that side's default
  assert.deepStrictEqual(m.loadChoice(THEMES, getter({ 'native.themeMode': 'light', 'native.theme.light': 'void', 'native.theme.dark': 'aurora' })), { mode: 'light', dark: 'aurora', light: 'light' });
});

test('System shows the theme picked for whichever side the computer is on', async () => {
  const m = await load();
  const c = { mode: 'system', dark: 'void', light: 'sage' };
  assert.strictEqual(m.themeFor(c, true), 'sage');
  assert.strictEqual(m.themeFor(c, false), 'void');
  assert.strictEqual(m.themeFor({ ...c, mode: 'dark' }, true), 'void');
  assert.deepStrictEqual(m.withTheme(c, THEMES, 'glacier'), { mode: 'system', dark: 'void', light: 'glacier' });
  assert.deepStrictEqual(m.withWebsiteTheme(c, THEMES, 'glacier'), { mode: 'light', dark: 'void', light: 'glacier' });
  assert.deepStrictEqual(m.withWebsiteTheme(c, THEMES, 'nope'), c);
});

test('the app shows a mode picker and a theme menu filtered to the side on screen', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('class="themesel modesel"') && app.includes('themesForMode(THEMES, shownMode)'));
  assert.ok(!app.includes("['system', 'System'"), 'System is no longer an entry in the theme menu');
});

test('every page module of the app window parses (a duplicate name breaks the whole window, and only a parse finds it)', () => {
  const { execFileSync } = require('child_process');
  const dir = path.join(__dirname, '..', 'renderer', 'native');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
});

test('the .7z help video plays as soon as it is opened and sits centred in its row', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'native.css'), 'utf8');
  assert.match(app, /<video class="help7z" controls autoplay /);
  assert.match(css, /\.help7z \{ display: block;[^}]*margin: 6px auto 12px;/);
});
