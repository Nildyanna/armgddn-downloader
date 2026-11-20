'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { watchWindow } = require('../native/hangWatch');

function fake() {
  const win = new EventEmitter();
  win.webContents = Object.assign(new EventEmitter(), { reloaded: 0, reloadIgnoringCache() { this.reloaded++; }, reload() { this.reloaded++; } });
  win.isDestroyed = () => false;
  return win;
}

test('a freeze is logged and the page is reloaded once it has lasted too long', () => {
  const win = fake(), lines = []; let fire = null, cleared = 0;
  watchWindow(win, (l) => lines.push(l), 'Browser', { frozenMs: 5000, setTimeout: (f) => { fire = f; return 1; }, clearTimeout: () => { cleared++; }, metrics: () => [] });
  win.emit('unresponsive');
  assert.match(lines[0], /not responding/);
  fire();
  assert.equal(win.webContents.reloaded, 1);
  assert.match(lines[1], /reloading its page/);
});

test('a window that answers again is not reloaded', () => {
  const win = fake(), lines = []; let fire = null;
  watchWindow(win, (l) => lines.push(l), 'Browser', { setTimeout: (f) => { fire = f; return 1; }, clearTimeout: () => { fire = null; }, metrics: () => [] });
  win.emit('unresponsive'); win.emit('responsive');
  assert.equal(fire, null);
  assert.equal(win.webContents.reloaded, 0);
  assert.match(lines[1], /answers again/);
});

test('a page process that died is logged and reloaded; a clean exit is not', () => {
  const win = fake(), lines = [];
  watchWindow(win, (l) => lines.push(l), 'Browser', { metrics: () => [] });
  win.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
  assert.equal(win.webContents.reloaded, 1);
  win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(win.webContents.reloaded, 1);
  assert.match(lines[0], /page process gone: oom/);
});
