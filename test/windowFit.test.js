'use strict';
// The window is put back on its screen when it opens sticking out (DMP, 2026-11-27: after updates on a very wide screen).
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { sticksOut, fitOnce, watchFit } = require('../native/windowFit');

const WA = { x: 0, y: 0, width: 5120, height: 1400 };

function fakeWin(bounds, maximized = true) {
  const w = new EventEmitter();
  let b = { ...bounds }, max = maximized;
  const calls = [];
  Object.assign(w, {
    isDestroyed: () => false, isMinimized: () => false, isFullScreen: () => false, isMaximized: () => max,
    getBounds: () => ({ ...b }),
    unmaximize: () => { calls.push('unmaximize'); max = false; },
    maximize: () => { calls.push('maximize'); max = true; b = { x: WA.x - 8, y: WA.y - 8, width: WA.width + 16, height: WA.height + 16 }; },
    setBounds: (nb) => { calls.push('setBounds'); b = { ...nb }; },
    calls,
  });
  return w;
}
const fakeScreen = () => Object.assign(new EventEmitter(), { getDisplayMatching: () => ({ workArea: WA, scaleFactor: 1.5 }) });

test('a normal maximized window (a few pixels past each edge) is left alone', () => {
  assert.equal(sticksOut({ x: -8, y: -8, width: 5136, height: 1416 }, WA), false);
  const win = fakeWin({ x: -8, y: -8, width: 5136, height: 1416 });
  assert.equal(fitOnce(win, fakeScreen()), false);
  assert.deepEqual(win.calls, []);
});

test('a window pushed to the right with its right side cut off is put back to fill the screen, still maximized', () => {
  const win = fakeWin({ x: 1700, y: -8, width: 5136, height: 1416 });
  const logs = [];
  assert.equal(fitOnce(win, fakeScreen(), (l) => logs.push(l), 'test'), true);
  assert.deepEqual(win.calls, ['unmaximize', 'setBounds', 'maximize']);
  assert.equal(sticksOut(win.getBounds(), WA), false);
  assert.ok(logs[0].includes('sticks out') && logs[0].includes('1700,-8'), 'the numbers are logged');
});

test('it checks when shown, twice more as the screen settles, and when the screen changes', () => {
  const win = fakeWin({ x: 1700, y: -8, width: 5136, height: 1416 });
  const screen = fakeScreen();
  const later = [];
  watchFit(win, screen, () => { }, { setTimeout: (fn, ms) => later.push(ms) });
  win.emit('show');
  assert.deepEqual(later, [1500, 5000]);
  assert.equal(win.calls.filter((c) => c === 'setBounds').length, 1);
  win.setBounds({ x: 3000, y: 0, width: 5120, height: 1400 });
  screen.emit('display-metrics-changed');
  assert.equal(win.calls.filter((c) => c === 'setBounds').length, 3, 'fixed again after the screen changed');
  win.emit('closed');
  assert.equal(screen.listenerCount('display-metrics-changed'), 0, 'stops listening when the window closes');
});
