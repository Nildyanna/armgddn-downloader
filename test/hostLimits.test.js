const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hostLimits = require('../hostLimits');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hl-'));

test('a learned limit is returned for that host only', () => {
  const h = hostLimits.create(dir());
  assert.strictEqual(h.get('https://dl.example.com/a/file.7z'), 0);
  h.learn('https://dl.example.com/a/file.7z?sig=1', 6);
  assert.strictEqual(h.get('https://dl.example.com/other/path'), 6);
  assert.strictEqual(h.get('https://elsewhere.example.com/x'), 0);
});

test('a limit expires after a week', () => {
  let t = 1000;
  const h = hostLimits.create(dir(), () => t);
  h.learn('https://a.example.com/x', 4);
  t += hostLimits.MAX_AGE_MS - 1;
  assert.strictEqual(h.get('https://a.example.com/x'), 4);
  t += 2;
  assert.strictEqual(h.get('https://a.example.com/x'), 0);
});

test('nonsense is ignored and a damaged file does not throw', () => {
  const d = dir();
  const h = hostLimits.create(d);
  h.learn('not a url', 5); h.learn('https://a.example.com/x', 0); h.learn('https://a.example.com/x', NaN);
  assert.strictEqual(h.get('https://a.example.com/x'), 0);
  fs.writeFileSync(path.join(d, 'host-limits.json'), '{ broken');
  assert.strictEqual(h.get('https://a.example.com/x'), 0);
  h.learn('https://a.example.com/x', 3);
  assert.strictEqual(h.get('https://a.example.com/x'), 3);
});
