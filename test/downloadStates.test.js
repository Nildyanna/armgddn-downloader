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
  // Only the steps a download goes through (Nov 24 2026): from the plan while running, from what happened once finished.
  const keys = (d) => downloadSteps(d).map((x) => x.key[0]).join('');
  assert.strictEqual(keys({ status: 'downloading', planCheck: false, planUnpack: false }), 'dr');      // a .zip with Check files off
  assert.strictEqual(keys({ status: 'downloading', planCheck: true, planUnpack: false }), 'dcr');
  assert.strictEqual(keys({ status: 'downloading', planCheck: false, planUnpack: true }), 'dur');
  assert.strictEqual(keys({ status: 'completed', didCheck: true, didExtract: false, planUnpack: false }), 'dcr');
  assert.strictEqual(at({ status: 'completed', didCheck: true, checkOk: false, didExtract: false, planUnpack: true }), 'ddsd');   // damaged: unpack skipped
  assert.strictEqual(keys({ status: 'completed', didCheck: false, didExtract: true, planUnpack: true }), 'dur');
});

test('the Finished line says only what was done', async () => {
  const { finishedText, downloadSteps } = await import('../renderer/native/format.mjs');
  assert.strictEqual(finishedText({ didCheck: true, didExtract: true }), 'checked and extracted');
  assert.strictEqual(finishedText({ didCheck: true, didExtract: false }), 'checked');
  assert.strictEqual(finishedText({ didCheck: false, didExtract: true }), 'extracted');
  assert.strictEqual(finishedText({ didCheck: false, didExtract: false, planUnpack: false }), '');
  assert.strictEqual(finishedText({ didCheck: true, checkOk: false, didExtract: false, planUnpack: true }), 'check found damaged files and not extracted');
  assert.strictEqual(finishedText({ status: 'completed' }), '', 'a record from before this makes no claim');
  assert.strictEqual(downloadSteps({ status: 'failed' }), null);
  assert.strictEqual(downloadSteps({ status: 'cancelled' }), null);
});

test('an unknown status is shown as running, never as waiting', async () => {
  const { splitDownloads } = await import('../renderer/native/format.mjs');
  const s = splitDownloads([{ id: 'x', status: 'something_new' }]);
  assert.deepStrictEqual([s.active.length, s.waiting.length, s.done.length], [1, 0, 0]);
});

test('finished rows read from history keep where the title sits, so their cover art can be found', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.match(app, /downloadedSize: d\.totalSize, remotePath: d\.remotePath \|\| ''/);
});

test('a history row finds its library place for every kind of section', async () => {
  const { downloadPlace } = await import('../renderer/native/format.mjs');
  const row = (h) => ({ remotePath: h.remotePath || '', resumeRemote: h.actualRemote || '', resumePath: h.actualRemote ? (h.remotePath || '') : '' });   // as app.mjs builds it
  assert.deepStrictEqual(downloadPlace(row({ remotePath: 'PC1/AI War 2 v14806863 -ARMGDDN', actualRemote: 'PC-1' })), { group: 'PC Games', folder: 'PC1', name: 'AI War 2 v14806863 -ARMGDDN' });
  assert.deepStrictEqual(downloadPlace(row({ remotePath: 'Articulated Models/Articulated_Baby_Seal zou.zip', actualRemote: '3D Printer Models' })), { group: '3D Printer Models', folder: 'Articulated Models', name: 'Articulated_Baby_Seal zou.zip' });
  assert.deepStrictEqual(downloadPlace(row({ remotePath: 'Advanced Bat To Exe Convertor Pro v2.91 -fff', actualRemote: 'Pirated PC Apps' })), { group: 'Pirated PC Apps', folder: '', name: 'Advanced Bat To Exe Convertor Pro v2.91 -fff' });
});
