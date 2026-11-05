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
  for (const file of ['main.js', 'setupReport.js', 'setupCheck.js', 'updateRunner.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/require\('\.\/([A-Za-z0-9_-]+)(\.js)?'\)/g)) {
      const name = m[1] + '.js';
      if (fs.existsSync(path.join(root, name)) && !listed.has(name)) missing.push(name);
    }
  }
  assert.deepStrictEqual([...new Set(missing)], []);
});
