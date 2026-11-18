const { test } = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'renderer', 'native');
const SYSTEM = new Set(['inherit', 'monospace', 'serif', 'sans-serif', 'system-ui', 'georgia', 'segoe ui', 'tahoma', 'dejavu sans', 'verdana', 'arial', 'segoe ui black', 'ui-sans-serif']);

test('every font a theme asks for is bundled, and every bundled face has its file', () => {
  const themes = fs.readFileSync(path.join(dir, 'themes.css'), 'utf8') + fs.readFileSync(path.join(dir, 'native.css'), 'utf8');
  const wanted = new Set();
  for (const m of themes.matchAll(/font-family:\s*([^;}]*)/g)) for (const part of m[1].replace(/!important/g, '').split(',')) {
    const n = part.trim().replace(/^['"]|['"]$/g, ''); if (n && !SYSTEM.has(n.toLowerCase())) wanted.add(n);
  }
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  const have = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.deepStrictEqual([...wanted].filter((f) => !have.has(f)), []);
  for (const m of css.matchAll(/url\('fonts\/([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(dir, 'fonts', m[1])), m[1]);
});
test('the page loads the font stylesheet, and the policy allows local fonts only', () => {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /href="fonts\.css"/); assert.ok(!/font-src[^;]*https/.test(html));
  assert.ok(fs.existsSync(path.join(dir, 'fonts', 'LICENSES.txt')));
});
