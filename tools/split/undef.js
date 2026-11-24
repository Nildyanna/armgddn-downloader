#!/usr/bin/env node
'use strict';
// Names used but never defined, in every module of main/ (the main.js split, Nov 24 2026; docs/MAIN_SPLIT.md).
//   node tools/split/undef.js --acorn <path to acorn>
// A moved function that still uses a main.js name directly (not through ctx) throws "x is not defined" only when that line runs, which
// neither node --check nor the tests see. This lists every identifier a module uses that is not: defined at its top level (require,
// function, variable), declared anywhere inside the same function (parameter, variable, catch, inner function), or a JavaScript/Node
// global. Exit code 1 when anything is found. Run it after every move.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const i = argv.indexOf('--acorn');
const acorn = require(i >= 0 ? argv[i + 1] : 'acorn');
const ROOT = path.resolve(__dirname, '..', '..');
const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis).concat(['require', 'module', 'exports', '__dirname', '__filename',
  'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'fetch', 'structuredClone', 'queueMicrotask',
  'arguments', 'undefined', 'globalThis']));

function declNames(id, out) {
  if (!id) return;
  if (id.type === 'Identifier') out.push(id.name);
  else if (id.type === 'ObjectPattern') id.properties.forEach((p) => declNames(p.value || p.argument, out));
  else if (id.type === 'ArrayPattern') id.elements.forEach((e) => declNames(e, out));
  else if (id.type === 'AssignmentPattern') declNames(id.left, out);
  else if (id.type === 'RestElement') declNames(id.argument, out);
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

let found = 0;
const dir = path.join(ROOT, 'main');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  const defined = new Set();
  walk(ast, (x) => {                       // every declaration anywhere in the file (simple and safe: a name declared somewhere is not "undefined")
    if (x.type === 'VariableDeclarator') { const ns = []; declNames(x.id, ns); ns.forEach((n) => defined.add(n)); }
    if ((x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression' || x.type === 'ClassDeclaration' || x.type === 'ClassExpression') && x.id) defined.add(x.id.name);
    if (x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression') x.params.forEach((p) => { const ns = []; declNames(p, ns); ns.forEach((n) => defined.add(n)); });
    if (x.type === 'CatchClause' && x.param) { const ns = []; declNames(x.param, ns); ns.forEach((n) => defined.add(n)); }
    if (x.type === 'LabeledStatement') defined.add(x.label.name);
  });
  const missing = new Map();
  walk(ast, (x, parent, key) => {
    if (x.type !== 'Identifier') return;
    if (parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return;
    if (parent && (parent.type === 'BreakStatement' || parent.type === 'ContinueStatement' || parent.type === 'LabeledStatement')) return;
    if (defined.has(x.name) || GLOBALS.has(x.name)) return;
    const line = src.slice(0, x.start).split('\n').length;
    if (!missing.has(x.name)) missing.set(x.name, line);
  });
  for (const [n, line] of missing) { console.log(`main/${f}:${line}  ${n} is used but not defined`); found++; }
}
console.log(found ? `${found} undefined name(s)` : 'no undefined names in main/');
process.exit(found ? 1 : 0);
