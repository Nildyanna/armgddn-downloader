#!/usr/bin/env node
'use strict';
// Builds renderer/native/i18n/<lang>.json (English -> language) from tools/i18n/src/<lang>.tsv.
// Each .tsv line is "<index in keys.json>\t<translation>", written against the keys.json of the same commit.
// Extra texts that the extractor does not see (option names, units) live in tools/i18n/src/extra.json.
//   node tools/i18n/build.js        (after node tools/i18n/extract.js; re-check indexes when keys.json changes)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, '..', '..', 'renderer', 'native', 'i18n');
const keys = JSON.parse(fs.readFileSync(path.join(SRC, 'keys.snapshot.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(SRC, 'extra.json'), 'utf8'));
const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');

fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.tsv'))) {
  const lang = file.replace(/\.tsv$/, '');
  const out = {};
  for (const line of fs.readFileSync(path.join(SRC, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const i = Number(line.slice(0, tab));
    const tr = line.slice(tab + 1);
    const en = keys[i];
    if (en == null) { console.error(`${file}: no key ${i}`); bad++; continue; }
    if (holes(en) !== holes(tr)) { console.error(`${file}:${i} placeholders differ: ${en} -> ${tr}`); bad++; continue; }
    out[en] = tr;
  }
  for (const [en, byLang] of Object.entries(extra)) if (byLang[lang]) out[en] = byLang[lang];
  fs.writeFileSync(path.join(OUT, `${lang}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(`${lang}: ${Object.keys(out).length} texts`);
}
// Wiki: tools/i18n/src/wiki.<lang>.json holds { id: { title, html } }. Each section is stamped with a fingerprint of the
// English section it was translated from; the app shows the translation only while that English section is unchanged.
const hashText = (str) => { let h = 0x811c9dc5; str = String(str || ''); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const wikiEn = JSON.parse(fs.readFileSync(path.join(OUT, '..', 'wiki.json'), 'utf8'));
for (const file of fs.readdirSync(SRC).filter((f) => /^wiki\..+\.json$/.test(f))) {
  const lang = file.slice(5, -5);
  const tr = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const sections = {};
  for (const s of wikiEn.sections) {
    const x = tr[s.id];
    if (!x) continue;
    // stamp only with the English text it was written for: when the English section changes, re-translate and update stampedFrom
    if (!x.stampedFrom) { console.error(`${file}: ${s.id} has no stampedFrom`); bad++; continue; }
    const from = x.stampedFrom;
    if (from !== hashText(s.html)) console.warn(`${file}: ${s.id} was translated from an older English text; the app shows English until it is re-translated`);
    sections[s.id] = { src: from, title: x.title, html: x.html };
  }
  fs.writeFileSync(path.join(OUT, '..', `wiki.${lang}.json`), JSON.stringify({ sections }, null, 1) + '\n');
  console.log(`wiki.${lang}: ${Object.keys(sections).length} of ${wikiEn.sections.length} sections`);
}

if (bad) { console.error(`${bad} problems`); process.exitCode = 1; }
