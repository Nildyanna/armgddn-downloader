#!/usr/bin/env node
'use strict';
// Move functions that use main.js's shared state (the main.js split, Nov 24 2026; docs/MAIN_SPLIT.md).
//   node tools/split/movectx.js --acorn <path> <module> <function>... [--doc "..."] [--check]
// Each reference a moved function makes to a top-level name that stays in main.js (a variable, or a function not moved with it) becomes
// ctx.<name>, served live by main/context.js. Nothing else in the text changes. Refuses a function where a local name shadows one of those
// names (the rewrite would be wrong). Required modules and functions already in main/ are required by the new module as usual.
// Proof printed at the end: undoing the ctx. prefix gives back each original function exactly.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const acorn = require(opt('--acorn') || 'acorn');
const doc = opt('--doc') || '';
const CHECK_ONLY = argv.includes('--check');
const [moduleName, ...names] = argv.filter((a) => a !== '--check');
const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'main.js');
const ANCHOR = '// ---- split-out modules (docs/MAIN_SPLIT.md) ----';
const PROVIDE_START = "require('./main/context').provide({";

let src = fs.readFileSync(MAIN, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });

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

// Top-level names: kind 'function' | 'let' | 'const' | 'require' (with the module it comes from)
const top = new Map();
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration') top.set(n.id.name, { kind: 'function' });
  if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) {
      const ns = []; declNames(d.id, ns);
      const init = d.init ? src.slice(d.init.start, d.init.end) : '';
      const m = init.match(/^require\('([^']+)'\)/);
      ns.forEach((nm) => top.set(nm, m ? { kind: 'require', mod: m[1], destructured: d.id.type === 'ObjectPattern' } : { kind: n.kind }));
    }
  }
}

const fnNodes = new Map(ast.body.filter((n) => n.type === 'FunctionDeclaration').map((n) => [n.id.name, n]));
for (const n of names) if (!fnNodes.has(n)) { console.error('no top-level function ' + n); process.exit(1); }

const ctxNames = new Set(), requireNames = new Map();
const edits = [];   // [start, end, text] in src
for (const name of names) {
  const fn = fnNodes.get(name);
  const locals = new Set();
  walk(fn, (x) => {
    if (x.type === 'VariableDeclarator') { const ns = []; declNames(x.id, ns); ns.forEach((v) => locals.add(v)); }
    if ((x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression') && x !== fn) {
      if (x.id) locals.add(x.id.name);
      x.params.forEach((p) => { const ns = []; declNames(p, ns); ns.forEach((v) => locals.add(v)); });
    }
    if (x.type === 'CatchClause' && x.param) { const ns = []; declNames(x.param, ns); ns.forEach((v) => locals.add(v)); }
    if (x.type === 'ClassDeclaration' && x.id) locals.add(x.id.name);
  });
  fn.params.forEach((p) => { const ns = []; declNames(p, ns); ns.forEach((v) => locals.add(v)); });
  // Default parameter values (ttlMs = MIRROR_COOLDOWN_MS) are code too: rewrite them like the body. The names the parameters bind are not.
  const defaults = [];
  walk({ type: 'Params', list: fn.params }, (x) => { if (x.type === 'AssignmentPattern') defaults.push(x.right); });
  const visitRef = (x, parent, key) => {
    if (x.type !== 'Identifier' || !top.has(x.name) || names.includes(x.name)) return;
    if (parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return;
    if (parent && parent.type === 'VariableDeclarator' && key === 'id') return;
    if (locals.has(x.name)) { console.error(`${name}: local name ${x.name} shadows main.js's ${x.name}; refusing`); process.exit(1); }
    const t = top.get(x.name);
    if (t.kind === 'require') { requireNames.set(x.name, t); return; }
    ctxNames.add(x.name);
    if (parent && parent.type === 'Property' && parent.shorthand && key === 'value') edits.push([x.start, x.end, `${x.name}: ctx.${x.name}`]);
    else edits.push([x.start, x.end, `ctx.${x.name}`]);
  };
  walk(fn.body, visitRef);
  defaults.forEach((d) => walk(d, visitRef));
}

// Module text: each function with the comment lines above it, rewritten.
const lines = src.split('\n');
const lineStart = []; { let p = 0; for (const l of lines) { lineStart.push(p); p += l.length + 1; } }
const lineOf = (pos) => { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
const blocks = [], spans = [];
for (const name of names.slice().sort((a, b) => fnNodes.get(a).start - fnNodes.get(b).start)) {
  const fn = fnNodes.get(name);
  let first = lineOf(fn.start);
  while (first > 0 && lines[first - 1].startsWith('//')) first--;
  const start = lineStart[first];
  const end = fn.end;
  let text = '';
  let cur = start;
  for (const [a, b, t] of edits.filter(([a]) => a >= fn.start && a < fn.end).sort((x, y) => x[0] - y[0])) { text += src.slice(cur, a) + t; cur = b; }
  text += src.slice(cur, end);
  blocks.push({ name, text, original: src.slice(start, end) });
  spans.push([start, end]);
}

// Proof: undoing the rewrite gives the original text.
for (const b of blocks) {
  const back = b.text.replace(/(\w+): ctx\.\1\b/g, '$1').replace(/\bctx\.(\w+)/g, '$1');
  if (back !== b.original) { console.error('rewrite check failed for ' + b.name); process.exit(1); }
}
if (CHECK_ONLY) { console.log('would move', names.join(', '), '| ctx:', [...ctxNames].join(', ')); process.exit(0); }

// Requires for the module.
const reqLines = new Map();
for (const [nm, t] of requireNames) {
  let mod = t.mod;
  if (mod === './main/' + moduleName) continue;
  if (mod.startsWith('./main/')) mod = './' + mod.slice('./main/'.length);
  else if (mod.startsWith('./')) mod = '../' + mod.slice(2);
  const k = mod + '|' + t.destructured;
  if (!reqLines.has(k)) reqLines.set(k, { mod, destructured: t.destructured, names: [] });
  reqLines.get(k).names.push(nm);
}
const reqText = [...reqLines.values()].sort((a, b) => a.mod.localeCompare(b.mod))
  .map((r) => r.destructured ? `const { ${r.names.join(', ')} } = require('${r.mod}');` : `const ${r.names[0]} = require('${r.mod}');`);
const modPath = path.join(ROOT, 'main', moduleName + '.js');
if (fs.existsSync(modPath)) { console.error(`main/${moduleName}.js exists; movectx makes new modules only`); process.exit(1); }
fs.writeFileSync(modPath, ["'use strict';",
  `// ${doc || moduleName} (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).`,
  "const ctx = require('./context');", ...reqText, '', blocks.map((b) => b.text).join('\n\n'), '',
  `module.exports = { ${blocks.map((b) => b.name).join(', ')} };`, ''].join('\n'));

// main.js: drop the functions, require the module, and offer the ctx names.
for (const [a, b] of spans.sort((x, y) => y[0] - x[0])) {
  let e = b; if (src[e] === '\n') e++; if (src[e] === '\n' && src[a - 1] === '\n') e++;
  src = src.slice(0, a) + src.slice(e);
}
src = src.replace(ANCHOR, ANCHOR + `\nconst { ${blocks.map((b) => b.name).join(', ')} } = require('./main/${moduleName}');`);
const want = [...ctxNames].sort();
let have = [];
const pStart = src.indexOf(PROVIDE_START);
if (pStart >= 0) {
  const pEnd = src.indexOf('\n});', pStart);
  have = [...src.slice(pStart, pEnd).matchAll(/^\s+(?:get |set )?(\w+)/gm)].map((m) => m[1]);
  src = src.slice(0, pStart) + src.slice(pEnd + 5);
}
const all = [...new Set([...have, ...want])].sort();
const entry = (nm) => {
  const t = top.get(nm) || { kind: 'function' };
  if (t.kind === 'function') return `  ${nm},`;
  if (t.kind === 'let' || t.kind === 'var') return `  get ${nm}() { return ${nm}; }, set ${nm}(v) { ${nm} = v; },`;
  return `  get ${nm}() { return ${nm}; },`;
};
const block = `${PROVIDE_START}\n${all.map(entry).join('\n')}\n});\n`;
// After the last top-level function or variable it names would be ideal, but getters are only read when called, so right after the module
// requires at the top is safe; function names are hoisted.
const anchorEnd = src.indexOf('\n', src.indexOf(ANCHOR)) + 1;
let afterRequires = anchorEnd;
while (/^const \{[^}]*\} = require\('\.\/main\//.test(src.slice(afterRequires, src.indexOf('\n', afterRequires)))) afterRequires = src.indexOf('\n', afterRequires) + 1;
src = src.slice(0, afterRequires) + '// Shared state for the main/ modules (main/context.js): live getters and setters onto main.js\'s own variables.\n' + block + src.slice(afterRequires);
src = src.replace(/\/\/ Shared state for the main\/ modules \(main\/context\.js\): live getters and setters onto main\.js's own variables\.\n(\/\/ Shared state for the main\/ modules \(main\/context\.js\): live getters and setters onto main\.js's own variables\.\n)+/, '$1');
fs.writeFileSync(MAIN, src);
console.log(`moved ${names.length} function(s) to main/${moduleName}.js | ctx: ${want.join(', ') || '-'} | main.js now ${src.split('\n').length} lines | rewrite check: identical after undoing ctx.`);
