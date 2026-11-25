// The opened request panel has the same status box as the request card (2026-11-25: staff could not find it there).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('request panel and card share the status box', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'admin.mjs'), 'utf8');
  const thread = src.slice(src.indexOf('function RequestThread('), src.indexOf('function RequestCard('));
  assert.match(thread, /<\$\{StatusSelect\}/);
  assert.match(src, /<\$\{RequestThread\}[^\n]*act=\$\{act\}/);
  const card = src.slice(src.indexOf('function RequestCard('), src.indexOf('function RequestsPage('));
  assert.match(card, /<\$\{StatusSelect\}/);
});
