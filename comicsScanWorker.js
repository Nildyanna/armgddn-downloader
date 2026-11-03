'use strict';
// Runs the folder scan off the main thread so the app stays responsive while a big comics folder is read.
const { parentPort, workerData } = require('worker_threads');
const cs = require('./comicsScan');
const r = cs.scanFolder(workerData.root, {
  cache: workerData.cache,
  onProgress: (p) => parentPort.postMessage({ type: 'progress', scanned: p.scanned, current: p.current }),
});
parentPort.postMessage({ type: 'done', rows: r.rows, cache: r.cache });
