#!/usr/bin/env node
'use strict';
// Move IPC handler registrations out of main.js (the main.js split, Nov 24 2026; docs/MAIN_SPLIT.md).
//   node tools/split/moveipc.js --acorn <path> <module> <channel>... [--doc "..."] [--check]
// Takes the top-level ipcMain.handle('<channel>', ...) / ipcMain.on('<channel>', ...) statements for the given channels, with the comment
// lines above each, into main/<module>.js as `function register() { ... }`. The text changes the way movectx.js changes it: names that
// stay in main.js become ctx.<name> (mainState where the code already uses ctx), __dirname/__filename go through the context, inline
// require('./x') becomes '../x'; a local name that shadows one of main.js's is refused. main.js calls register() where the LAST of the
// moved statements stood: everything they read at registration exists by then, and registration still ends before any event is handled.
// Proof: undoing the rewrite gives back each statement exactly.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const acorn = require(opt('--acorn') || 'acorn');
const doc = opt('--doc') || '';
const CHECK_ONLY = argv.includes('--check');
const [moduleName, ...channels] = argv.filter((a) => a !== '--check');
const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'main.js');
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

const isIpc = (n) => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.type === 'MemberExpression' &&
  n.expression.callee.object.type === 'Identifier' && n.expression.callee.object.name === 'ipcMain' && n.expression.arguments[0] &&
  n.expression.arguments[0].type === 'Literal';
const stmts = ast.body.filter((n) => isIpc(n) && channels.includes(n.expression.arguments[0].value));
const found = new Set(stmts.map((n) => n.expression.arguments[0].value));
const missing = channels.filter((c) => !found.has(c));
if (missing.length) { console.error('no top-level ipcMain registration for: ' + missing.join(', ')); process.exit(1); }

let ALIAS = 'ctx';
for (const s of stmts) walk(s, (x) => { if (x.type === 'Identifier' && x.name === 'ctx') ALIAS = 'mainState'; });

const ctxNames = new Set(), requireNames = new Map(), edits = [];
for (const st of stmts) {
  const locals = new Set();
  walk(st, (x) => {
    if (x.type === 'VariableDeclarator') { const ns = []; declNames(x.id, ns); ns.forEach((v) => locals.add(v)); }
    if (x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression') {
      if (x.id) locals.add(x.id.name);
      x.params.forEach((p) => { const ns = []; declNames(p, ns); ns.forEach((v) => locals.add(v)); });
    }
    if (x.type === 'CatchClause' && x.param) { const ns = []; declNames(x.param, ns); ns.forEach((v) => locals.add(v)); }
    if (x.type === 'ClassDeclaration' && x.id) locals.add(x.id.name);
  });
  walk(st, (x, parent, key) => {
    const fileName = x.type === 'Identifier' && (x.name === '__dirname' || x.name === '__filename');
    if (x.type !== 'Identifier' || (!fileName && !top.has(x.name))) return;
    if (parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return;
    if (parent && parent.type === 'VariableDeclarator' && key === 'id') return;
    if (parent && (parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression' || parent.type === 'FunctionDeclaration') && key === 'params') return;
    if (locals.has(x.name)) { console.error(`ipc '${st.expression.arguments[0].value}': local name ${x.name} shadows main.js's ${x.name}; refusing`); process.exit(1); }
    const t = fileName ? { kind: 'const' } : top.get(x.name);
    if (t.kind === 'require') { requireNames.set(x.name, t); return; }
    ctxNames.add(x.name);
    if (parent && parent.type === 'Property' && parent.shorthand && key === 'value') edits.push([x.start, x.end, `${x.name}: ${ALIAS}.${x.name}`]);
    else edits.push([x.start, x.end, `${ALIAS}.${x.name}`]);
  });
  walk(st, (x) => {
    if (x.type === 'CallExpression' && x.callee.type === 'Identifier' && x.callee.name === 'require' && x.arguments[0] &&
        x.arguments[0].type === 'Literal' && typeof x.arguments[0].value === 'string' && x.arguments[0].value.startsWith('./')) {
      const lit = x.arguments[0];
      edits.push([lit.start, lit.end, src.slice(lit.start, lit.end).replace('./', '../')]);
    }
  });
}

const lines = src.split('\n');
const lineStart = []; { let p = 0; for (const l of lines) { lineStart.push(p); p += l.length + 1; } }
const lineOf = (pos) => { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
const blocks = [];
for (const st of stmts) {
  let first = lineOf(st.start);
  while (first > 0 && lines[first - 1].startsWith('//')) first--;
  const start = lineStart[first], end = st.end;
  let text = '', cur = start;
  for (const [a, b, t] of edits.filter(([a]) => a >= st.start && a < st.end).sort((x, y) => x[0] - y[0])) { text += src.slice(cur, a) + t; cur = b; }
  text += src.slice(cur, end);
  blocks.push({ channel: st.expression.arguments[0].value, text, original: src.slice(start, end), start, end });
}
for (const b of blocks) {
  if (b.original.includes(ALIAS + '.') || b.original.includes("require('../")) { console.error(`'${b.channel}': original contains "${ALIAS}." or require('../; refusing`); process.exit(1); }
  const back = b.text.replace(new RegExp('(\\w+): ' + ALIAS + '\\.\\1\\b', 'g'), '$1').replace(new RegExp('\\b' + ALIAS + '\\.(\\w+)', 'g'), '$1')
    .replace(/require\('\.\.\//g, "require('./");
  if (back !== b.original) { console.error(`rewrite check failed for '${b.channel}'`); process.exit(1); }
}
if (CHECK_ONLY) { console.log(`would move ${blocks.length} registration(s) | ctx: ${[...ctxNames].join(', ')}`); process.exit(0); }

const reqLines = new Map();
for (const [nm, t] of requireNames) {
  let mod = t.mod;
  if (mod.startsWith('./main/')) mod = './' + mod.slice('./main/'.length);
  else if (mod.startsWith('./')) mod = '../' + mod.slice(2);
  const k = mod + '|' + t.destructured;
  if (!reqLines.has(k)) reqLines.set(k, { mod, destructured: t.destructured, names: [] });
  reqLines.get(k).names.push(nm);
}
const reqText = [...reqLines.values()].sort((a, b) => a.mod.localeCompare(b.mod))
  .map((r) => r.destructured ? `const { ${r.names.join(', ')} } = require('${r.mod}');` : `const ${r.names[0]} = require('${r.mod}');`);
const modPath = path.join(ROOT, 'main', moduleName + '.js');
if (fs.existsSync(modPath)) { console.error(`main/${moduleName}.js exists`); process.exit(1); }
fs.writeFileSync(modPath, ["'use strict';",
  `// ${doc || moduleName} (IPC handlers moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ${ALIAS} (main/context.js).`,
  `// main.js calls register() once, at start-up, where these registrations used to be.`,
  `const ${ALIAS} = require('./context');`, ...reqText, '', 'function register() {', blocks.map((b) => b.text).join('\n\n'), '}', '',
  'module.exports = { register };', ''].join('\n'));

const lastEnd = Math.max(...blocks.map((b) => b.end));
const call = `require('./main/${moduleName}').register();      // IPC: ${blocks.map((b) => b.channel).join(', ')}`.slice(0, 400);
for (const b of blocks.slice().sort((x, y) => y.start - x.start)) {
  let e = b.end; if (src[e] === ';') e++;
  if (b.end === lastEnd) { src = src.slice(0, b.start) + call + src.slice(e); continue; }
  if (src[e] === '\n') e++; if (src[e] === '\n' && src[b.start - 1] === '\n') e++;
  src = src.slice(0, b.start) + src.slice(e);
}
const want = [...ctxNames].sort();
let have = [];
const pStart = src.indexOf(PROVIDE_START);
const pEnd = src.indexOf('\n});', pStart);
have = [...src.slice(pStart, pEnd).matchAll(/^\s+(?:get |set )?(\w+)/gm)].map((m) => m[1]);
const all = [...new Set([...have, ...want])].sort();
const entry = (nm) => {
  const t = (nm === '__dirname' || nm === '__filename') ? { kind: 'const' } : (top.get(nm) || { kind: 'function' });
  if (t.kind === 'function') return `  ${nm},`;
  if (t.kind === 'let' || t.kind === 'var') return `  get ${nm}() { return ${nm}; }, set ${nm}(v) { ${nm} = v; },`;
  return `  get ${nm}() { return ${nm}; },`;
};
src = src.slice(0, pStart) + `${PROVIDE_START}\n${all.map(entry).join('\n')}` + src.slice(pEnd);
fs.writeFileSync(MAIN, src);
console.log(`moved ${blocks.length} registration(s) to main/${moduleName}.js | ctx: ${want.join(', ') || '-'} | main.js now ${src.split('\n').length} lines | rewrite check: identical after undoing ${ALIAS}.`);
