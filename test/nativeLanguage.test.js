'use strict';
// App language (2026-11-27): the picker, the lookup, and the translation files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N = path.join(ROOT, 'renderer', 'native', 'i18n');
const LANGS = ['fr', 'es', 'pt-BR', 'de'];
const load = () => import(path.join(ROOT, 'renderer', 'native', 'i18n.mjs'));
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

test('"Same as Windows" follows the system language, and falls back to English', async () => {
  const { resolveLanguage } = await load();
  assert.equal(resolveLanguage('auto', 'fr-CA'), 'fr');
  assert.equal(resolveLanguage('auto', 'es-MX'), 'es');
  assert.equal(resolveLanguage('auto', 'pt-PT'), 'pt-BR');
  assert.equal(resolveLanguage('auto', 'de-AT'), 'de');
  assert.equal(resolveLanguage('auto', 'ja-JP'), 'en');
  assert.equal(resolveLanguage(undefined, ''), 'en');
  assert.equal(resolveLanguage('de', 'fr-FR'), 'de', 'a chosen language wins over the system');
  assert.equal(resolveLanguage('xx', 'es-ES'), 'es', 'an unknown choice acts like auto');
});

test('lookup: whole texts, spaces kept, placeholders filled, English when missing', async () => {
  const i = await load();
  i.setDictionary('fr', { Settings: 'Paramètres', '{n} downloads': '{n} téléchargements' });
  assert.equal(i.t('Settings'), 'Paramètres');
  assert.equal(i.t('{n} downloads', { n: 3 }), '3 téléchargements');
  assert.equal(i.t('Not translated {x}', { x: 1 }), 'Not translated 1');
  assert.equal(i.tx('  Settings '), '  Paramètres ');
  assert.equal(i.tx('Something else'), 'Something else');
  const seen = [];
  const h = i.wrapH((type, props, ...kids) => { seen.push({ props, kids }); });
  h('button', { title: 'Settings', class: 'Settings' }, 'Settings', 5);
  assert.deepEqual(seen[0].kids, ['Paramètres', 5]);
  assert.equal(seen[0].props.title, 'Paramètres');
  assert.equal(seen[0].props.class, 'Settings', 'class names are never translated');
  i.setDictionary('en', null);
  assert.equal(i.t('Settings'), 'Settings');
});

for (const lang of LANGS) {
  test(`${lang}: every translation is filled in and keeps its placeholders`, () => {
    const dict = JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
    assert.ok(Object.keys(dict).length > 500, 'the file covers the screens');
    for (const [en, tr] of Object.entries(dict)) {
      assert.ok(typeof tr === 'string' && tr.trim(), `${lang}: empty translation for "${en}"`);
      assert.equal(holes(tr), holes(en), `${lang}: placeholders differ for "${en}"`);
    }
    for (const must of ['Settings', 'Download', 'Language', 'Same as Windows', 'Wiki']) assert.ok(dict[must], `${lang}: "${must}"`);
  });
}

test('the translated Wiki is used only for English sections it was made from', async () => {
  const i = await load();
  const wiki = { sections: [{ id: 'a', title: 'A', html: '<p>one</p>' }, { id: 'b', title: 'B', html: '<p>changed</p>' }, { id: 'c', title: 'C', html: '<p>x</p>' }] };
  const tr = { sections: { a: { src: i.hashText('<p>one</p>'), title: 'A fr', html: '<p>un</p>' }, b: { src: i.hashText('<p>old</p>'), title: 'B fr', html: '<p>vieux</p>' } } };
  i.setDictionary('fr', {});
  const out = await i.localWiki(wiki, async () => tr);
  assert.deepEqual(out.sections.map((s) => s.html), ['<p>un</p>', '<p>changed</p>', '<p>x</p>']);
  i.setDictionary('en', null);
  assert.equal(await i.localWiki(wiki, async () => tr), wiki, 'English never loads a translation');
});

test('the shipped Wiki translations match today\'s English Wiki', async () => {
  const { hashText } = await load();
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'renderer', 'native', 'wiki.json'), 'utf8'));
  const byId = new Map(en.sections.map((s) => [s.id, s.html]));
  for (const lang of LANGS) {
    const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'renderer', 'native', `wiki.${lang}.json`), 'utf8'));
    for (const [id, s] of Object.entries(w.sections)) {
      assert.ok(byId.has(id), `${lang}: Wiki section ${id} no longer exists`);
      // A failure here is a reminder, not a crash: members then see that section in English until it is re-translated.
      assert.equal(s.src, hashText(byId.get(id)), `${lang}: Wiki section ${id} changed in English; re-translate tools/i18n/src/wiki.${lang}.json and update stampedFrom`);
    }
  }
});

test('What\'s New uses the entry\'s translation when it has one', async () => {
  const i = await load();
  const entry = { title: 'Languages', highlights: ['One'], i18n: { de: { title: 'Sprachen', highlights: ['Eins'] } } };
  i.setDictionary('de', {});
  assert.deepEqual(i.localWhatsNew(entry).highlights, ['Eins']);
  i.setDictionary('fr', {});
  assert.deepEqual(i.localWhatsNew(entry).highlights, ['One'], 'no French: English');
  i.setDictionary('en', null);
});

test('the language setting is saved, checked, and offered in Settings', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'main', 'ipcSettings.js'), 'utf8');
  assert.match(ipc, /'language'/);
  const settings = fs.readFileSync(path.join(ROOT, 'main', 'settings.js'), 'utf8');
  assert.match(settings, /ctx\.settings\.language = 'auto'/);
  const app = fs.readFileSync(path.join(ROOT, 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.match(app, /await initLanguage\(/, 'the language loads before the first screen');
  assert.match(app, /save\(\{ language: e\.target\.value \}\)/);
  const ui = fs.readFileSync(path.join(ROOT, 'native', 'vendor', 'ui.mjs'), 'utf8');
  assert.match(ui, /htm\.bind\(wrapH\(h\)\)/, 'every screen goes through the translating factory');
});
