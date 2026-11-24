'use strict';
// The main.js split (docs/MAIN_SPLIT.md): every relative require in main/ points at a file that exists. A require('./notify') written
// inside a function moved from main.js would look in main/ and fail when that line runs, silently inside a try (Nov 24 2026: Linux
// download notifications and the window freeze watch would have stopped).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every relative require in main/ resolves to a real file', () => {
  const dir = path.join(__dirname, '..', 'main');
  if (!fs.existsSync(dir)) return;
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/require\('(\.\.?\/[^']+)'\)/g)) {
      const p = path.resolve(dir, m[1]);
      if (!['', '.js', '/index.js'].some((ext) => fs.existsSync(p + ext) && fs.statSync(p + ext).isFile())) bad.push(`main/${f}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});
