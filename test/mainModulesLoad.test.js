'use strict';
// The main.js split (docs/MAIN_SPLIT.md): every module in main/ loads, and every name it takes from a sibling module is really exported
// there. A wrong or missing export only shows up at run time as "x is not a function", so it is checked here with Electron stubbed out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

test('every main/ module loads and gets every name it asks a sibling for', () => {
  const dir = path.join(__dirname, '..', 'main');
  if (!fs.existsSync(dir)) return;
  const stub = new Proxy(function () {}, { get: (t, k) => (k === 'isPackaged' ? false : stub), apply: () => stub, construct: () => stub });
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron' || request.startsWith('@sentry/')) return new Proxy({}, { get: () => stub });
    return realLoad.apply(this, arguments);
  };
  const problems = [];
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      try { require(path.join(dir, f)); } catch (e) { problems.push(`${f} does not load: ${e.message}`); continue; }
      for (const m of src.matchAll(/^const \{ ([^}]+) \} = require\('\.\/([\w-]+)'\);/gm)) {
        const sibling = require(path.join(dir, m[2] + '.js'));
        for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!(name in sibling)) problems.push(`${f} asks ${m[2]}.js for ${name}, which it does not export`);
        }
      }
    }
  } finally {
    Module._load = realLoad;
  }
  assert.deepStrictEqual(problems, []);
});

test('main.js gets every name it asks a main/ module for', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const missing = [];
  for (const m of src.matchAll(/^const \{ ([^}]+) \} = require\('\.\/main\/([\w-]+)'\);/gm)) {
    const modSrc = fs.readFileSync(path.join(__dirname, '..', 'main', m[2] + '.js'), 'utf8');
    const exp = (modSrc.match(/module\.exports = \{([^}]*)\}/) || [])[1] || '';
    const exported = new Set(exp.split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean));
    for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) if (!exported.has(name)) missing.push(`${m[2]}.${name}`);
  }
  assert.deepStrictEqual(missing, []);
});
