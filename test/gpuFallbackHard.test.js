'use strict';
// GPU fallback, second step (Sentry ARMGDDN-COMPANION-2Q): when the GPU process still dies with software drawing on, the next launch runs
// with no GPU process at all. main.js cannot be loaded outside Electron, so this checks the wiring in its source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = require('./mainSource')();

test('a fresh no-GPU marker turns the GPU process off before the app is ready', () => {
  const block = src.slice(src.indexOf('const GPU_HARD_MARKER'), src.indexOf('function armNoGpuProcess'));
  assert.ok(block.includes("'gpu-disabled-hard'"), 'marker file name');
  assert.ok(block.includes("appendSwitch('disable-gpu')"), 'disable-gpu switch');
  assert.ok(block.includes("appendSwitch('disable-software-rasterizer')"), 'no software rasterizer GPU process');
  assert.ok(/\(gpuHardBefore \? 30 : 7\) \* 24 \* 3600 \* 1000/.test(block), 'the marker expires after a week, a month on a PC that needed it before');
  // switches only work before the ready event: the block must come before any app.whenReady / app.on('ready')
  const ready = Math.min(...['app.whenReady(', "app.on('ready'"].map((s) => { const i = src.indexOf(s); return i < 0 ? Infinity : i; }));
  assert.ok(src.indexOf('const GPU_HARD_MARKER') < ready, 'set before ready');
});

test('a GPU process failure with software drawing already on arms the no-GPU step instead of the first one', () => {
  const handler = src.slice(src.indexOf("app.on('child-process-gone'"), src.indexOf('function sendToMain'));
  const soft = handler.indexOf('if (softwareDrawingOn || gpuHardBefore)');
  const first = handler.indexOf('fs.writeFileSync(GPU_FALLBACK_MARKER');
  assert.ok(soft > 0 && first > soft, 'checked before writing the first marker');
  assert.ok(handler.slice(soft, first).includes('armNoGpuProcess('), 'arms the second step');
});

test('Linux launches that keep dying in software mode also arm the no-GPU step', () => {
  const guard = src.slice(src.indexOf('exitGuard.begin(guardFile)'), src.indexOf("app.on('second-instance'"));
  assert.ok(/unclean >= 2 && \(softwareDrawingOn \|\| gpuHardBefore\) && armNoGpuProcess\(/.test(guard));
});

test('a PC that needed the no-GPU step before goes straight back to it (Parallels member, Nov 24 2026)', () => {
  assert.ok(src.includes("fs.renameSync(GPU_HARD_MARKER, GPU_HARD_MARKER + '.past')"), 'an expired marker is kept as history');
  assert.ok(src.includes("fs.existsSync(GPU_HARD_MARKER + '.past')"));
  const handler = src.slice(src.indexOf("app.on('child-process-gone'"), src.indexOf('function sendToMain'));
  assert.ok(handler.includes('if (softwareDrawingOn || gpuHardBefore) {'));
});
