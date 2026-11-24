'use strict';
// The main process's source as one text: main.js plus every module split out of it into main/ (the main.js split, Nov 24 2026).
// Tests that check main-process wiring by reading source use this, so moving a function into main/ does not break them.
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

module.exports = function mainSource() {
  return [path.join(ROOT, 'main.js'), ...files(path.join(ROOT, 'main'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
};
module.exports.files = () => [path.join(ROOT, 'main.js'), ...files(path.join(ROOT, 'main'))];
