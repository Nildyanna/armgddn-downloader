'use strict';
// Runs the music folder scan off the main thread so the app stays responsive while a big music folder is listed.
const { parentPort, workerData } = require('worker_threads');
const ms = require('./musicScan');
const r = ms.scanFolder(workerData.root, {
  onProgress: (p) => parentPort.postMessage({ type: 'progress', scanned: p.scanned, current: p.current }),
});
parentPort.postMessage({ type: 'done', rows: r.rows });
