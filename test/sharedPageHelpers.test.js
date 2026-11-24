'use strict';
// Helpers the classic pages and the Harbor theme now share (format.mjs), and the Harbor wiring that uses them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('splitDownloads: running and paused, then waiting, then finished newest first', async () => {
  const { splitDownloads } = await import('../renderer/native/format.mjs');
  const list = [{ id: 1, status: 'completed' }, { id: 2, status: 'downloading' }, { id: 3, status: 'queued' }, { id: 4, status: 'paused' }, { id: 5, status: 'error' }];
  const r = splitDownloads(list);
  assert.deepStrictEqual(r.active.map((d) => d.id), [2, 4]);
  assert.deepStrictEqual(r.waiting.map((d) => d.id), [3]);
  assert.deepStrictEqual(r.done.map((d) => d.id), [5, 1]);
  assert.deepStrictEqual(splitDownloads(null), { active: [], waiting: [], done: [] });
});

test('bytesDone matches the percent when files are fetched several at once', async () => {
  const { bytesDone, bytesLeft } = await import('../renderer/native/format.mjs');
  const GB = 1e9;
  // Nov 24: 32% of 39.6 GB with only 504 MB of finished files.
  const d = { totalSize: 39.6 * GB, downloadedSize: 504e6, progress: 32 };
  assert.strictEqual(bytesDone(d), Math.round(0.32 * 39.6 * GB));
  assert.strictEqual(bytesLeft([d]), 39.6 * GB - Math.round(0.32 * 39.6 * GB));
  assert.strictEqual(bytesDone({ totalSize: 100, downloadedSize: 60, progress: 50 }), 60);
  assert.strictEqual(bytesDone({ downloadedSize: 7 }), 7);
  assert.strictEqual(bytesDone(null), 0);
});

test('bytesLeft adds what each download still has to fetch, never below zero', async () => {
  const { bytesLeft } = await import('../renderer/native/format.mjs');
  assert.strictEqual(bytesLeft([{ totalSize: 100, downloadedSize: 40 }, { totalSize: 10, downloadedSize: 20 }, {}]), 60);
});

test('downloadPlace finds the listing for game paths and resumed downloads, and skips batches', async () => {
  const { downloadPlace } = await import('../renderer/native/format.mjs');
  assert.deepStrictEqual(downloadPlace({ remotePath: 'PCVR1/Half-Life Alyx v1 -ARMGDDN' }), { group: 'PCVR Games', folder: 'PCVR1', name: 'Half-Life Alyx v1 -ARMGDDN' });
  assert.deepStrictEqual(downloadPlace({ remotePath: 'PC2/Game v2 -ARMGDDN' }), { group: 'PC Games', folder: 'PC2', name: 'Game v2 -ARMGDDN' });
  assert.deepStrictEqual(downloadPlace({ resumeRemote: 'Music', resumePath: 'Artist/Album' }), { group: 'Music', folder: 'Artist', name: 'Album' });
  assert.strictEqual(downloadPlace({ resumeRemote: 'PC-1', resumePath: '__batch__x/y' }), null);
  assert.strictEqual(downloadPlace(null), null);
});

test('rankTrending: one row per title, counts from the window, filters for VR/PC, art and excluded titles', async () => {
  const { rankTrending } = await import('../renderer/native/format.mjs');
  const e = [
    { title: 'Alpha', pc: 0, pcvr: 5, coverUrl: 'a' },
    { title: 'Beta', pc: 9, pcvr: 0, coverUrl: '' },
    { title: 'alpha', pc: 0, pcvr: 50 },
    { title: 'Gamma', pc: 0, pcvr: 7, coverUrl: 'g' },
    { title: 'Zero', pc: 0, pcvr: 0 },
  ];
  assert.deepStrictEqual(rankTrending(e).map((x) => [x.title, x.count]), [['Beta', 9], ['Gamma', 7], ['Alpha', 5]]);
  assert.deepStrictEqual(rankTrending(e, { vr: true, needCover: true, exclude: ['Gamma'] }).map((x) => x.title), ['Alpha']);
  assert.deepStrictEqual(rankTrending(e, { limit: 1 }).map((x) => x.title), ['Beta']);
});

test('buildNumber reads the build from a folder name', async () => {
  const { buildNumber } = await import('../renderer/native/format.mjs');
  assert.strictEqual(buildNumber('Cyberpunk 2077 v19260982(v2.3) -ARMGDDN'), '19260982');
  assert.strictEqual(buildNumber('Some Album (2001)'), '');
});

test('Harbor pages use the shared helpers and the same download buttons as the classic page', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const harborDl = app.slice(app.indexOf('function HarborDownloads('), app.indexOf('function DownloadsView('));
  const classicDl = app.slice(app.indexOf('function DownloadsView('), app.indexOf('class PageGuard'));
  for (const part of [harborDl, classicDl]) assert.ok(part.includes('<${DownloadButtons}'), 'shared buttons');
  assert.ok(harborDl.includes('splitDownloads(') && harborDl.includes('useListingCovers(') && harborDl.includes('<${ActiveFiles}'));
  assert.ok(classicDl.includes('mib=${mib} onFlip=${flip}'), 'Harbor gets the Mbps / MiB/s switch');
  const lead = app.slice(app.indexOf('function HarborLead('), app.indexOf('function HomeView('));
  assert.ok(lead.includes('rankTrending(') && lead.includes('useListingCovers(') && !lead.includes('api.browse('));
  assert.ok(!app.includes('harborBuild'), 'one build-number helper');
});
