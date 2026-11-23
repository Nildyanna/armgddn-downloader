const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the Badges page is wired from the page to the site and back', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const bridge = read('native', 'bridge.js'), pre = read('preload-native.js'), app = read('renderer', 'native', 'app.mjs'), css = read('renderer', 'native', 'native.css');
  for (const piece of ["'native:badges'", "'native:badgeChoose'", "'/api/trophies/me'", "'/api/trophies/choice'"]) assert.ok(bridge.includes(piece), piece);
  for (const piece of ['badges: call', 'badgeChoose: call']) assert.ok(pre.includes(piece), piece);
  for (const piece of ['function BadgesView', 'function BadgeCard', "view === 'badges'", 'Badge Collector Supreme', 'HIDDEN', 'Wear this']) assert.ok(app.includes(piece), piece);
  assert.ok(css.includes('.bcard.hidden') && css.includes('.bgrid'));
});

test('a badge id from the page is checked before it goes to the site', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'native', 'bridge.js'), 'utf8');
  assert.ok(bridge.includes("/^[A-Za-z0-9_-]{1,40}$/.test(id)"));
});
