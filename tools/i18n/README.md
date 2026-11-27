# App languages

The member screens come in English, French, Spanish, Portuguese (Brazil) and German (Settings > Language; "Same as Windows" by default).
Staff and owner screens stay English.

How it works: `renderer/native/i18n.mjs` wraps the element factory, so every plain text on screen is looked up whole in
`renderer/native/i18n/<lang>.json` (English -> language). Anything missing shows in English, never blank.
Text built from pieces uses `tr('Scanned {n} files', { n })` (imported as `t as tr`).

## After changing on-screen text

1. `ACORN=/home/armgddn/src/ArmgddnBrowser/node_modules/acorn node tools/i18n/extract.js` lists every text (`keys.json`) and any
   sentence still built from pieces (`composed.txt`; convert those to `tr()`).
2. New texts: copy `keys.json` to `src/keys.snapshot.json` only together with re-numbering the `.tsv` files, or add them to
   `src/extra.json` (English -> each language). The `.tsv` lines are `<index in keys.snapshot.json>\t<translation>`.
3. `node tools/i18n/build.js` writes the app's files and refuses a translation whose `{placeholders}` differ from the English.
4. `node --test test/nativeLanguage.test.js`.

## Wiki

`src/wiki.<lang>.json` holds translated sections with `stampedFrom`, the fingerprint of the English section they were made from.
When the English Wiki changes (scripts/extract_wiki.py), that section shows in English until it is re-translated and `stampedFrom`
is updated; the language test names the sections that need it. Sections 12 (Komga) and 13 (Linux) are not translated yet.

## What's New

An entry in `renderer/whats-new.json` can carry `"i18n": { "fr": { "title": "...", "highlights": ["..."] } }`.

## Preview

`npm run preview`, then add `&lang=fr` (or es, pt-BR, de) to the address.
