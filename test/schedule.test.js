const { test } = require('node:test');
const assert = require('node:assert');
const { normalize, activeWindow, effectiveLimitMBps, formatTime } = require('../schedule');

// Local-time dates: 2026-11-16 is a Monday (getDay() = 1).
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m, 0, 0);
const night = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '07:00', action: 'pause' };

test('disabled or empty windows never apply', () => {
  assert.strictEqual(activeWindow({ ...night, enabled: false }, at(16, 23, 30)), null);
  assert.strictEqual(activeWindow({ ...night, start: '08:00', end: '08:00' }, at(16, 8, 0)), null);
  assert.strictEqual(activeWindow(undefined, at(16, 12)), null);
});

test('a window past midnight covers the late evening and the early morning', () => {
  assert.ok(activeWindow(night, at(16, 23, 0)));
  assert.ok(activeWindow(night, at(17, 2, 30)));
  assert.ok(activeWindow(night, at(17, 6, 59)));
  assert.strictEqual(activeWindow(night, at(17, 7, 0)), null);
  assert.strictEqual(activeWindow(night, at(16, 22, 59)), null);
});

test('the window ends at the right time, tomorrow when it started tonight', () => {
  const late = activeWindow(night, at(16, 23, 30));
  assert.strictEqual(late.endsAt.getDate(), 17); assert.strictEqual(formatTime(late.endsAt), '7:00 AM');
  const early = activeWindow(night, at(17, 3, 0));
  assert.strictEqual(early.endsAt.getDate(), 17); assert.strictEqual(formatTime(early.endsAt), '7:00 AM');
});

test('days are the days the window starts on', () => {
  const monOnly = { ...night, days: [1] };                      // Monday night into Tuesday morning
  assert.ok(activeWindow(monOnly, at(16, 23, 30)));             // Monday 11:30 PM
  assert.ok(activeWindow(monOnly, at(17, 2, 0)));               // Tuesday 2 AM: still Monday's window
  assert.strictEqual(activeWindow(monOnly, at(17, 23, 30)), null);   // Tuesday night: not a start day
  assert.strictEqual(activeWindow(monOnly, at(16, 2, 0)), null);     // Monday 2 AM belongs to Sunday's window
});

test('a same-day window', () => {
  const work = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', action: 'limit', limitMBps: 3 };
  assert.ok(activeWindow(work, at(16, 9, 0)));
  assert.strictEqual(activeWindow(work, at(16, 17, 0)), null);
  assert.strictEqual(activeWindow(work, at(15, 12, 0)), null);  // Sunday
});

test('the speed limit is the lower of the member\'s own and the window\'s', () => {
  const lim = { ...night, action: 'limit', limitMBps: 5 };
  assert.strictEqual(effectiveLimitMBps(0, lim, at(16, 23, 30)), 5);
  assert.strictEqual(effectiveLimitMBps(20, lim, at(16, 23, 30)), 5);
  assert.strictEqual(effectiveLimitMBps(2, lim, at(16, 23, 30)), 2);
  assert.strictEqual(effectiveLimitMBps(20, lim, at(16, 12, 0)), 20);          // outside the window
  assert.strictEqual(effectiveLimitMBps(20, night, at(16, 23, 30)), 20);       // a pause window does not change the limit
});

test('normalize repairs bad input', () => {
  const n = normalize({ enabled: 'yes', days: [9, 'x', 2, 2], start: '25:00', end: '7:5', action: 'zzz', limitMBps: -4 });
  assert.strictEqual(n.enabled, false); assert.deepStrictEqual(n.days, [2]);
  assert.strictEqual(n.start, '23:00'); assert.strictEqual(n.end, '07:00');
  assert.strictEqual(n.action, 'pause'); assert.strictEqual(n.limitMBps, 5);
});
