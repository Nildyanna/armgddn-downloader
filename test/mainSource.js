'use strict';
// The main process's source as one text: main.js plus every module split out of it into main/ (the main.js split, Nov 24 2026).
// Tests that check main-process wiring by reading source use this, so moving a function into main/ does not break them.
// Moved code reaches main.js's shared state as ctx.<name> (main/context.js); the text given here has that prefix undone, which
// tools/split/movectx.js proves gives back the original code exactly, so a test reads the same words wherever the code now lives.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

const undoCtx = (s) => s.replace(/(\w+): ctx\.\1\b/g, '$1').replace(/\bctx\.(\w+)/g, '$1');

function mainSource() {
  return [path.join(ROOT, 'main.js'), ...files(path.join(ROOT, 'main'))].map((f) => undoCtx(fs.readFileSync(f, 'utf8'))).join('\n');
}

// One top-level function's own text (from "function name(" or "async function name(" to its closing brace), wherever it lives.
function fn(name) {
  const src = mainSource();
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) return '';
  const end = src.indexOf('\n}\n', m.index);
  return src.slice(m.index, end < 0 ? src.length : end + 2);
}

module.exports = mainSource;
module.exports.files = () => [path.join(ROOT, 'main.js'), ...files(path.join(ROOT, 'main'))];
module.exports.fn = fn;
