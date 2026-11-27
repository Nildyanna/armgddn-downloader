// Language for the app window (George, 2026-11-27: "let's add language selection to the App").
// English is the source: every on-screen text is its own key. A translation file maps English -> the language; anything
// missing stays English, so a new or untranslated text never shows blank.
// How text gets translated without touching every screen: the element factory (h) is wrapped. Each plain-text child and
// each title / placeholder / aria-label / alt / label prop is looked up as a whole (spaces around it kept). Text built
// from pieces ("Scanned 12 files") uses t('Scanned {n} files', { n }) instead.

export const LANGUAGES = [
  ['auto', 'Same as Windows'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt-BR', 'Português (Brasil)'],
  ['de', 'Deutsch'],
];
const CODES = new Set(['en', 'fr', 'es', 'pt-BR', 'de']);

let dict = null;          // English -> current language; null = English
let current = 'en';

// 'auto' (or anything unknown) follows the system language when it is one we have, else English.
export function resolveLanguage(choice, systemLocale) {
  if (choice && choice !== 'auto' && CODES.has(choice)) return choice;
  const loc = String(systemLocale || '').toLowerCase();
  if (loc.startsWith('fr')) return 'fr';
  if (loc.startsWith('es')) return 'es';
  if (loc.startsWith('pt')) return 'pt-BR';
  if (loc.startsWith('de')) return 'de';
  return 'en';
}

export function setDictionary(code, data) {
  current = CODES.has(code) ? code : 'en';
  dict = current === 'en' || !data ? null : new Map(Object.entries(data).filter(([, v]) => typeof v === 'string' && v));
  try { document.documentElement.lang = current; } catch (e) { }
}

export const language = () => current;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

// Translate one English text. vars fill {name} placeholders after translating.
export function t(en, vars) {
  const s = String(en == null ? '' : en);
  return fill((dict && dict.get(s)) || s, vars);
}

// A text child or prop: keep the spaces around it, translate the middle when it is a known text.
export function tx(s) {
  if (!dict || typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
  const hit = dict.get(s);
  if (hit) return hit;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m || !m[2]) return s;
  const mid = dict.get(m[2]);
  return mid ? m[1] + mid + m[3] : s;
}

const PROPS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];

export function wrapH(h) {
  return function th(type, props, ...children) {
    if (dict) {
      if (props) {
        let copy = null;
        for (const k of PROPS) {
          const v = props[k];
          if (typeof v === 'string') { const nv = tx(v); if (nv !== v) { copy = copy || { ...props }; copy[k] = nv; } }
        }
        if (copy) props = copy;
      }
      for (let i = 0; i < children.length; i++) if (typeof children[i] === 'string') children[i] = tx(children[i]);
    }
    return h(type, props, ...children);
  };
}

// Load the chosen language before the first render. getSettings: the app's settings call; systemLocale: navigator.language.
export async function initLanguage(getSettings, systemLocale) {
  let choice = 'auto';
  try { const s = await getSettings(); if (s && typeof s.language === 'string') choice = s.language; } catch (e) { }
  const code = resolveLanguage(choice, systemLocale);
  if (code === 'en') { setDictionary('en', null); return code; }
  try {
    const m = await import(`./i18n/${code}.json`, { with: { type: 'json' } });
    setDictionary(code, m.default);
  } catch (e) {
    setDictionary('en', null);
    return 'en';
  }
  return code;
}

// Short fingerprint of an English text, so a translation made for an older wording is not shown (tools/i18n/build.js uses the same).
export function hashText(s) {
  let h = 0x811c9dc5;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// The Wiki in the chosen language: a translated section is used only while its English original is unchanged;
// a section edited since (or never translated) shows in English.
export async function localWiki(wiki, load = (code) => import(`./wiki.${code}.json`, { with: { type: 'json' } }).then((m) => m.default)) {
  if (!wiki || !Array.isArray(wiki.sections) || current === 'en') return wiki;
  let tr = null;
  try { tr = await load(current); } catch (e) { return wiki; }
  const by = (tr && tr.sections) || {};
  return { ...wiki, sections: wiki.sections.map((s) => { const x = by[s.id]; return x && x.src === hashText(s.html) && x.html ? { ...s, title: x.title || s.title, html: x.html } : s; }) };
}

// A What's New entry may carry translations: { title, highlights, i18n: { fr: { title, highlights } } }.
export function localWhatsNew(entry) {
  const x = entry && entry.i18n && entry.i18n[current];
  return x && Array.isArray(x.highlights) && x.highlights.length ? { ...entry, title: x.title || entry.title, highlights: x.highlights } : entry;
}
