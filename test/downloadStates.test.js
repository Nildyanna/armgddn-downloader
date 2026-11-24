'use strict';
// The page's DOWNLOAD_STATES must know every status main.js can give a download (Nov 24 2026: "extracting" was missing, so a title being
// unpacked was listed under Waiting as "starts when a slot frees up").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = require('./mainSource')();

function statusesInMain() {
  const found = new Set();
  // download.status = 'x'   |   status: 'x'   |   reportStatus = 'x'
  const re = /(?:\bstatus\s*=\s*|\bstatus:\s*|reportStatus\s*=\s*)'([a-z_]+)'/g;
  for (const line of MAIN.split('\n')) {
    if (/findings|setupReport/.test(line)) continue;   // the setup report's own 'ok'/'warn' findings are not download states
    let m;
    while ((m = re.exec(line))) found.add(m[1]);
  }
  return found;
}

test('every download status main.js sets is in DOWNLOAD_STATES', async () => {
  const { DOWNLOAD_STATES } = await import('../renderer/native/format.mjs');
  const missing = [...statusesInMain()].filter((s) => !(s in DOWNLOAD_STATES));
  assert.deepStrictEqual(missing, [], 'add these to DOWNLOAD_STATES in renderer/native/format.mjs: ' + missing.join(', '));
});

test('the scan of main.js still finds the statuses it should (guards the test itself)', () => {
  const s = statusesInMain();
  for (const k of ['in_progress', 'downloading', 'paused', 'extracting', 'completed', 'failed']) assert.ok(s.has(k), k + ' not found in main.js');
});

test('every state has a group the Downloads page knows and a step on the step bar (or none)', async () => {
  const { DOWNLOAD_STATES, DOWNLOAD_STEPS } = await import('../renderer/native/format.mjs');
  const steps = DOWNLOAD_STEPS.map(([k]) => k);
  for (const [k, v] of Object.entries(DOWNLOAD_STATES)) {
    assert.ok(['running', 'waiting', 'done'].includes(v.group), k);
    assert.ok(v.step === null || steps.includes(v.step), k);
  }
});

test('step bar: where each kind of download is', async () => {
  const { downloadSteps } = await import('../renderer/native/format.mjs');
  const at = (d) => { const s = downloadSteps(d); return s && s.map((x) => x.state[0]).join(''); };   // d=done n=now t=todo s=skip
  assert.strictEqual(at({ status: 'downloading' }), 'nttt');
  assert.strictEqual(at({ status: 'paused' }), 'nttt');
  assert.strictEqual(at({ status: 'in_progress', statusMessage: 'Checking files...' }), 'dntt');
  assert.strictEqual(at({ status: 'extracting', extractPercent: 40 }), 'ddnt');
  assert.strictEqual(at({ status: 'completed' }), 'dddd');
  assert.strictEqual(at({ status: 'completed', statusMessage: '2 files did not match. Automatic extraction was skipped.' }), 'ddsd');
  assert.strictEqual(downloadSteps({ status: 'failed' }), null);
  assert.strictEqual(downloadSteps({ status: 'cancelled' }), null);
});

test('an unknown status is shown as running, never as waiting', async () => {
  const { splitDownloads } = await import('../renderer/native/format.mjs');
  const s = splitDownloads([{ id: 'x', status: 'something_new' }]);
  assert.deepStrictEqual([s.active.length, s.waiting.length, s.done.length], [1, 0, 0]);
});
