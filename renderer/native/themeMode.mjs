// Viewing mode and theme (George, Nov 24 2026). Dark, Light and System are modes, not themes: the mode decides which themes the theme
// menu offers, and each mode remembers its own theme. System follows the computer's light or dark setting and shows the theme chosen
// for that side. Saved on this PC as native.themeMode, native.theme.dark and native.theme.light; native.theme keeps the theme on screen
// (older copies and the website read that one).
export const THEME_MODES = [['dark', 'Dark', '\u{1F319}'], ['light', 'Light', '☀️'], ['system', 'System', '\u{1F5A5}️']];
export const DEFAULT_FOR = { dark: 'harbor', light: 'light' };
const has = (themes, id) => !!id && Object.prototype.hasOwnProperty.call(themes, id);

export function modeOf(themes, id) { return themes[id] && themes[id].mode === 'light' ? 'light' : 'dark'; }
export function effectiveMode(mode, osLight) { return mode === 'system' ? (osLight ? 'light' : 'dark') : (mode === 'light' ? 'light' : 'dark'); }
export function themeFor(choice, osLight) { return choice[effectiveMode(choice.mode, osLight)]; }

function fillDefaults(themes, c) {
  const out = { ...c };
  for (const m of ['dark', 'light']) {
    if (has(themes, out[m]) && modeOf(themes, out[m]) === m) continue;
    out[m] = has(themes, DEFAULT_FOR[m]) ? DEFAULT_FOR[m] : (Object.keys(themes).find((k) => modeOf(themes, k) === m) || null);
  }
  if (!['dark', 'light', 'system'].includes(out.mode)) out.mode = 'dark';
  return out;
}

// The saved choice. A copy from before modes saved one theme (or "system"): that becomes the mode plus that theme.
export function loadChoice(themes, get) {
  let mode = get('native.themeMode');
  const c = { mode, dark: get('native.theme.dark'), light: get('native.theme.light') };
  if (!['dark', 'light', 'system'].includes(mode)) {
    const old = get('native.theme');
    if (old === 'system') c.mode = 'system';
    else if (has(themes, old)) { c.mode = modeOf(themes, old); c[c.mode] = old; }
    else c.mode = 'dark';
  }
  return fillDefaults(themes, c);
}

// A theme brought over from the website: "system" sets the mode, any other theme sets the mode it belongs to and becomes its theme.
export function withWebsiteTheme(choice, themes, id) {
  if (id === 'system') return { ...choice, mode: 'system' };
  if (!has(themes, id)) return choice;
  const m = modeOf(themes, id);
  return { ...choice, mode: m, [m]: id };
}

export function withTheme(choice, themes, id) {
  if (!has(themes, id)) return choice;
  return { ...choice, [modeOf(themes, id)]: id };
}

// The theme menu for one mode: its default first, Classic next on the dark side, then the rest by name.
export function themesForMode(themes, mode) {
  const label = (k, v) => (k === 'harbor' ? 'Harbor (default)' : k === 'dark' ? 'Classic' : k === 'light' ? 'Light (default)' : (v.label || k));
  const icon = (k, v) => (k === 'harbor' ? '⚓' : k === 'dark' ? '\u{1F3A8}' : k === 'light' ? '☀️' : (v.icon || ''));
  const rank = (k) => (k === DEFAULT_FOR[mode] ? 0 : k === 'dark' ? 1 : 2);
  return Object.entries(themes).filter(([k]) => modeOf(themes, k) === mode)
    .map(([k, v]) => [k, label(k, v), icon(k, v)])
    .sort((x, y) => rank(x[0]) - rank(y[0]) || String(x[1]).localeCompare(String(y[1])));
}
