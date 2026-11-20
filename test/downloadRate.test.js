const { test } = require('node:test');
const assert = require('node:assert');
const { rateEstimate } = require('../downloadRate');

test('many small files: the speed and ETA come from the overall progress, not from a file that finished a moment ago', () => {
  const d = {}; const total = 100 * 1024 ** 3; let t = 1000000;
  let est;
  for (let i = 0; i <= 20; i++) { est = rateEstimate(d, i * 20 * 1024 ** 2, total, t + i * 1000); }   // 20 MB each second, files done in steps
  assert.ok(est.speed > 19 * 1024 ** 2 && est.speed < 21 * 1024 ** 2);
  const left = (total - 20 * 20 * 1024 ** 2) / est.speed;
  assert.ok(Math.abs(est.etaSec - left) < 5);
});

test('a download that is not moving, or just started, says nothing instead of an absurd ETA', () => {
  const d = {}; const total = 50 * 1024 ** 3;
  assert.equal(rateEstimate(d, 0, total, 1000).etaSec, null);                       // first sample: no rate yet
  let est; for (let i = 0; i < 10; i++) est = rateEstimate(d, 1024, total, 1000 + i * 1000);
  assert.equal(est.etaSec, null);                                                   // 1 KB in 9 s: more than 30 days left
});

test('the window forgets what happened more than a minute ago', () => {
  const d = {}; const total = 10 * 1024 ** 3;
  for (let i = 0; i < 10; i++) rateEstimate(d, i * 100 * 1024 ** 2, total, 1000 + i * 1000);      // fast
  let est; for (let i = 0; i < 90; i++) est = rateEstimate(d, 900 * 1024 ** 2 + i * 1024 ** 2, total, 20000 + i * 1000);   // then slow
  assert.ok(est.speed < 2 * 1024 ** 2);
});
