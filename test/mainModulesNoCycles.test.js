'use strict';
// The main.js split (docs/MAIN_SPLIT.md): modules in main/ must not require each other in a circle. A cycle hands one of them an
// unfinished module, so a function such as logToFile is undefined at run time, which no syntax check catches (Nov 24 2026: log <-> files).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('no circular requires between the modules in main/', () => {
  const dir = path.join(__dirname, '..', 'main');
  if (!fs.existsSync(dir)) return;
  const g = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    g[f.slice(0, -3)] = [...src.matchAll(/require\('\.\/([\w-]+)'\)/g)].map((m) => m[1]);
  }
  const cycles = [];
  const visit = (n, stack) => {
    for (const m of g[n] || []) {
      if (stack.includes(m)) cycles.push([...stack.slice(stack.indexOf(m)), m].join(' -> '));
      else visit(m, [...stack, m]);
    }
  };
  Object.keys(g).forEach((n) => visit(n, [n]));
  assert.deepStrictEqual([...new Set(cycles)], []);
});
