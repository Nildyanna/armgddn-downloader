'use strict';
// The main.js split (docs/MAIN_SPLIT.md): a module in main/ must not use __dirname or __filename directly. Moved from main.js they would
// name main/ instead of the app folder (Nov 24 2026: the moved createWindow loaded main/preload.js and the window failed to open; the app
// icon, the Komga prompt, What's New and the install-screen logo had the same fault). They come from main.js through the context.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('no bare __dirname or __filename in main/', () => {
  const dir = path.join(__dirname, '..', 'main');
  if (!fs.existsSync(dir)) return;
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/(?<![\w.])__(dirname|filename)\b/.test(code)) bad.push(`main/${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, []);
});
