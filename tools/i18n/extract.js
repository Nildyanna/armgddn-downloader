#!/usr/bin/env node
'use strict';
// Lists every English text the member screens can show, for the translation files in renderer/native/i18n/.
//   node tools/i18n/extract.js            -> tools/i18n/keys.json (sorted) and tools/i18n/composed.txt (texts built from pieces)
// Needs acorn: ACORN=/path/to/acorn (a copy from any node_modules) when this repo has none.
const fs = require('fs');
const path = require('path');
const acorn = require(process.env.ACORN || 'acorn');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'renderer', 'native');
// Staff and owner screens stay English.
const SKIP = new Set(['admin.mjs', 'adminFormat.mjs', 'ownerConsole.mjs', 'ownerDock.mjs', 'ownerRouting.js', 'i18n.mjs']);
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];

const keys = new Map();      // text -> first place seen
const composed = [];
const mixed = [];          // template text nodes with a ${} in the middle: convert to t('... {x} ...', { x })

const looksUi = (s) => {
  const t = s.trim();
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|\/|\.|#|--|@)/.test(t) || /\/api\/|\$\{|=>|\.(mjs|json|js|css|png|jpg|svg)\b|^[\w-]+:\s|[{};]$/.test(t)) return false;
  if (/^[a-z0-9_-]+(\s+[a-z0-9_-]+)*$/.test(t) && !/\s/.test(t)) return false;            // ids, keys, single class names
  if (/^[a-z0-9-]+(\s+[a-z0-9-]+)+$/.test(t) && !/[.?!,']/.test(t) && t.split(/\s+/).every((w) => /-|^[a-z]+$/.test(w)) && t.split(/\s+/).some((w) => w.includes('-'))) return false;   // class lists
  return /^[A-Z0-9À-ɏ←-⯿\u{1F300}-\u{1FAFF}"'(«…]/u.test(t) || /[.?!…:]$/.test(t) || /\s/.test(t);
};
const add = (s, where) => { const t = s.replace(/\s+/g, ' ').trim(); if (looksUi(t) && !keys.has(t)) keys.set(t, where); };

function walk(node, fn, parent) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn, node));
    else if (v && typeof v.type === 'string') walk(v, fn, node);
  }
}

function templateText(quasis, where) {
  let inTag = false;
  let prevOpenText = '';          // text before the last ${} that was not closed by a tag
  for (let qi = 0; qi < quasis.length; qi++) {
    const q = quasis[qi];
    const s = q.value.cooked || '';
    let buf = '';
    const startsInText = !inTag;
    let sawTag = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (!inTag && c === '<') {
        if (!sawTag && startsInText && qi > 0 && (/[A-Za-z]{2}/.test(buf) || /[A-Za-z]{2}/.test(prevOpenText))) mixed.push(`${where}  …${prevOpenText.trim().slice(-50)} {x} ${buf.trim().slice(0, 50)}…`);
        sawTag = true;
        if (!(startsInText && !sawTag && qi > 0)) add(buf, where);
        buf = ''; inTag = true; continue;
      }
      if (inTag) {
        if (c === '>') { inTag = false; continue; }
        // attribute values written literally: title="..."
        for (const a of ATTRS) {
          if (s.startsWith(a + '="', i)) { const end = s.indexOf('"', i + a.length + 2); if (end > 0) add(s.slice(i + a.length + 2, end), where); }
        }
        continue;
      }
      buf += c;
    }
    if (!inTag) { if (qi < quasis.length - 1 && /[A-Za-z]{2}/.test(buf) && buf.trim()) { prevOpenText = buf; } else { add(buf, where); prevOpenText = ''; } }
    else prevOpenText = '';
  }
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !SKIP.has(f))) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, locations: true }); }
  catch (e) { console.error(file, 'parse error', e.message); process.exitCode = 1; continue; }
  walk(ast, (n, parent) => {
    const where = `${file}:${n.loc ? n.loc.start.line : '?'}`;
    if (n.type === 'TaggedTemplateExpression' && n.tag.name === 'html') { templateText(n.quasi.quasis, where); return; }
    if (n.type === 'CallExpression' && (n.callee.name === 't' || n.callee.name === 'tr') && n.arguments[0] && n.arguments[0].type === 'Literal') { keys.set(String(n.arguments[0].value), where); return; }
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (parent && parent.type === 'CallExpression' && parent.callee && ((parent.callee.object && parent.callee.object.name === 'console') || /^(matchMedia|getItem|setItem|removeItem|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|createElement|setAttribute|getAttribute|classList)$/.test((parent.callee.property && parent.callee.property.name) || parent.callee.name || ''))) return;
      if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ImportExpression')) return;
      if (parent && parent.type === 'Property' && parent.key === n) return;
      if (parent && parent.type === 'MemberExpression') return;
      if (parent && parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) return;
      add(n.value, where);
      return;
    }
    if (n.type === 'TemplateLiteral' && parent && parent.type !== 'TaggedTemplateExpression') {
      if (n.expressions.length === 0) { add(n.quasis[0].value.cooked || '', where); return; }
      const first = (n.quasis[0].value.cooked || '').trim();
      const text = n.quasis.map((q) => q.value.cooked).join('{…}');
      if (/[A-Za-z]{3}/.test(text) && /^[A-Z]/.test(first) && !/\/api\/|https?:|\.(json|mjs)|^[\w-]+:/.test(text)) composed.push(`${where}  ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  });
}

const out = path.join(__dirname, 'keys.json');
fs.writeFileSync(out, JSON.stringify([...keys.keys()].sort((a, b) => a.localeCompare(b)), null, 1) + '\n');
fs.writeFileSync(path.join(__dirname, 'composed.txt'), composed.concat(['', '# template text with a value in the middle'], mixed).join('\n') + '\n');
console.log(`keys: ${keys.size}  composed (to convert to t()): ${composed.length}  mixed template text: ${mixed.length}`);
