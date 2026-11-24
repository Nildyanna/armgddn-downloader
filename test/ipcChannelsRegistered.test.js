'use strict';
// Every IPC channel a page calls (preload scripts) has a handler registered in the main process: main.js, main/ (the main.js split moved
// the registrations into register() functions) or native/. A channel left behind would fail in the page with "No handler registered".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every channel the preloads call is registered', () => {
  const root = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const pre = ['preload.js', 'preload-update.js', 'preload-komga.js'].filter((f) => fs.existsSync(path.join(root, f))).map(read).join('\n');
  const used = new Set([...pre.matchAll(/ipcRenderer\.(?:invoke|send)\('([\w:-]+)'/g)].map((m) => m[1]));
  const dirs = ['main', 'native'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  const reg = [read('main.js'), ...dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(d, f), 'utf8')))].join('\n');
  const have = new Set([...reg.matchAll(/ipcMain\.(?:handle|on)\('([\w:-]+)'/g)].map((m) => m[1]));
  assert.deepStrictEqual([...used].filter((c) => !have.has(c)).sort(), []);
  assert.ok(used.size > 40, 'found the channels (the check is working)');
});
