const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 5.16.1 failed its packaged-app smoke test because a new module was not in package.json's build.files.
test('every local module the main process requires is listed in the packaged files', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const listed = new Set(pkg.build.files);
  const missing = [];
  const splitOut = require('./mainSource').files().map((f) => path.relative(root, f)).filter((f) => f !== 'main.js');
  for (const file of ['main.js', 'setupReport.js', 'setupCheck.js', 'updateRunner.js', ...splitOut]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const base = path.dirname(path.join(root, file));
    for (const m of src.matchAll(/require\('(\.\.?\/[A-Za-z0-9_\/-]+?)(\.js)?'\)/g)) {
      const abs = path.resolve(base, m[1] + '.js');
      const name = path.relative(root, abs).split(path.sep).join('/');
      if (!fs.existsSync(abs) || name.startsWith('..')) continue;
      // listed by name, or inside a folder entry such as 'main/**/*' or 'native/**/*'
      const inFolder = [...listed].some((e) => e.endsWith('/**/*') && name.startsWith(e.slice(0, -4)));
      if (!listed.has(name) && !inFolder) missing.push(name);
    }
  }
  assert.deepStrictEqual([...new Set(missing)], []);
});
