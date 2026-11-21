const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('the theme dropdown is wide enough for the longest theme name (Midnight Ocean was cut off at 150px in 6.0.0)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'native.css'), 'utf8');
  const m = /\.themesel \{[^}]*max-width:\s*(\d+)px/.exec(css);
  assert.ok(m, 'the .themesel rule has a max-width');
  assert.ok(Number(m[1]) >= 220, 'max-width is ' + m[1] + 'px');
  const labels = Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'theme_labels.json'), 'utf8'))).map((v) => v.label);
  assert.ok(labels.includes('Midnight Ocean'));
  assert.ok(Math.max(...labels.map((l) => l.length)) <= 16, 'a longer theme name needs a wider dropdown');
});
