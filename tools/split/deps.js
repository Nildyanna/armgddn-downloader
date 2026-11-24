#!/usr/bin/env node
'use strict';
// What each top-level function in main.js depends on (the main.js split, Nov 24 2026; docs/MAIN_SPLIT.md).
//   node tools/split/deps.js [--acorn <path to acorn>] [--json]
// Lists every top-level function with its size and the other top-level names it uses (functions, variables, required modules), so
// moves can be planned from the real dependencies: a function whose only uses are required modules can move as is; one that uses
// shared state (settings, mainWindow, activeDownloads...) needs that state passed in or moved with it.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const acornPath = args.includes('--acorn') ? args[args.indexOf('--acorn') + 1] : 'acorn';
const acorn = require(acornPath);
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });

// Top-level names: function declarations, variable declarations (incl. destructured requires).
const top = new Map();   // name -> kind
function declNames(id, out) {
  if (!id) return;
  if (id.type === 'Identifier') out.push(id.name);
  else if (id.type === 'ObjectPattern') id.properties.forEach((p) => declNames(p.value || p.argument, out));
  else if (id.type === 'ArrayPattern') id.elements.forEach((e) => declNames(e, out));
  else if (id.type === 'AssignmentPattern') declNames(id.left, out);
  else if (id.type === 'RestElement') declNames(id.argument, out);
}
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration') top.set(n.id.name, 'function');
  if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) {
      const names = [];
      declNames(d.id, names);
      const isReq = d.init && /require\(/.test(src.slice(d.init.start, d.init.end));
      names.forEach((nm) => top.set(nm, isReq ? 'require' : 'state'));
    }
  }
}

function walk(node, visit, parent, key) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, node, k));
    else if (v && typeof v.type === 'string') walk(v, visit, node, k);
  }
}

const out = [];
for (const n of ast.body) {
  if (n.type !== 'FunctionDeclaration') continue;
  const uses = new Set();
  walk(n.body, (x, parent, key) => {
    if (x.type !== 'Identifier') return;
    if (parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed) return;
    if (top.has(x.name) && x.name !== n.id.name) uses.add(x.name);
  });
  const lines = src.slice(0, n.end).split('\n').length - src.slice(0, n.start).split('\n').length + 1;
  const deps = [...uses].map((u) => ({ name: u, kind: top.get(u) }));
  out.push({ name: n.id.name, line: src.slice(0, n.start).split('\n').length, lines,
    state: deps.filter((d) => d.kind === 'state').map((d) => d.name).sort(),
    fns: deps.filter((d) => d.kind === 'function').map((d) => d.name).sort(),
    requires: deps.filter((d) => d.kind === 'require').map((d) => d.name).sort() });
}
if (args.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
for (const f of out) {
  console.log(`${String(f.line).padStart(5)} ${f.name} (${f.lines} lines)` +
    (f.state.length ? `\n        state: ${f.state.join(', ')}` : '') +
    (f.fns.length ? `\n        calls: ${f.fns.join(', ')}` : '') +
    (f.requires.length ? `\n        modules: ${f.requires.join(', ')}` : ''));
}
