'use strict';
// The app window's user-interface review of Nov 25 2026: the top problems found in renderer/native, native/bridge.js and preload-native.js.
// (The request time limit has its own tests in nativeApiClient.test.js.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Check for updates never says "latest version" after a failed check or for an update it cannot install itself', async () => {
  const { updateCheckResult } = await import('../renderer/native/format.mjs');
  const failed = updateCheckResult({ error: 'GitHub did not answer' });
  assert.match(failed.text, /^Could not check: GitHub did not answer/); assert.equal(failed.install, false); assert.equal(failed.announce, false);
  assert.match(updateCheckResult(null).text, /^Could not check: no answer/);
  const manual = updateCheckResult({ hasUpdate: true, latestVersion: '6.13.0', version: '6.12.0', canAutoInstall: false });
  assert.match(manual.text, /v6\.13\.0 is available \(you have v6\.12\.0\)/); assert.doesNotMatch(manual.text, /latest version/);
  assert.equal(manual.install, false); assert.equal(manual.announce, true);
  const auto = updateCheckResult({ hasUpdate: true, latestVersion: '6.13.0', version: '6.12.0', canAutoInstall: true });
  assert.equal(auto.install, true); assert.match(auto.text, /restarts ARMGDDN App/);
  assert.equal(updateCheckResult({ hasUpdate: false, version: '6.12.0' }).text, 'You are on the latest version (v6.12.0).');
  assert.doesNotMatch(updateCheckResult({ hasUpdate: false }).text, /undefined/);
  const a = read('renderer/native/app.mjs');
  const i = a.indexOf('function UpdateRow(');
  assert.ok(a.slice(i, i + 2000).includes('updateCheckResult(r)'), 'the Settings row uses it');
});

// Loads preload-native.js against a stand-in for electron and returns what it exposes plus the fake ipcRenderer.
function loadPreload() {
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async () => null,
    on: (ch, h) => { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch).add(h); },
    removeListener: (ch, h) => { if (listeners.has(ch)) listeners.get(ch).delete(h); },
    emit: (ch, v) => { for (const h of listeners.get(ch) || []) h({}, v); },
    count: (ch) => (listeners.get(ch) ? listeners.get(ch).size : 0),
  };
  let exposed = null;
  const contextBridge = { exposeInMainWorld: (_k, v) => { exposed = v; } };
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? { contextBridge, ipcRenderer } : orig.call(this, req, ...rest); };
  const file = require.resolve('../preload-native.js');
  try { delete require.cache[file]; require(file); } finally { Module._load = orig; delete require.cache[file]; }
  return { api: exposed, ipc: ipcRenderer };
}

test('every listener the app window can add hands back a way to remove it', () => {
  const { api, ipc } = loadPreload();
  const channels = { onOpen: 'native:open', onConnectionTestProgress: 'connection-test-progress', onScheduleBanner: 'schedule-banner', onUpdateAvailable: 'native:updateAvailable', onUpdate: 'native:update' };
  for (const [fn, ch] of Object.entries(channels)) {
    const got = [];
    const off = api[fn]((m) => got.push(m));
    assert.equal(typeof off, 'function', fn + ' returns an unsubscribe');
    ipc.emit(ch, { n: 1 });
    assert.deepEqual(got, [{ n: 1 }], fn + ' passes the message through');
    off();
    assert.equal(ipc.count(ch), 0, fn + ' listener removed');
    ipc.emit(ch, { n: 2 });
    assert.equal(got.length, 1);
  }
  // every on* in the preload goes through the same helper
  const pre = read('preload-native.js');
  assert.ok(pre.includes('ipcRenderer.on(channel, h)'), 'the helper is there');
  assert.ok(!/ipcRenderer\.on\(/.test(pre.replace('ipcRenderer.on(channel, h)', '')), 'no bare ipcRenderer.on left');
});

test('Settings and the connection test take their listeners off again', () => {
  const a = read('renderer/native/app.mjs');
  const s = a.slice(a.indexOf('function ScheduleRow('), a.indexOf('function GameUpdatesRow('));
  assert.ok(s.includes('off = api.onScheduleBanner(') && s.includes("typeof off === 'function') off()"), 'the schedule banner listener goes when Settings closes');
  const t = a.slice(a.indexOf('function SupportTools('), a.indexOf('function PrefsImport('));
  assert.ok(t.includes('const off = api.onConnectionTestProgress(') && /finally \{[^}]*off\(\)/.test(t), 'the progress listener goes when the test ends');
  for (const sub of ['off = api.onUpdate(', 'const off = api.onOpen(', 'off = api.onUpdateAvailable(']) assert.ok(a.includes(sub), sub);
});

test('a late answer cannot overwrite a newer page: request threads and the Admin pages', () => {
  const a = read('renderer/native/app.mjs');
  const r = a.slice(a.indexOf('function RequestsView('), a.indexOf('function MyListView('));
  assert.ok(r.includes('const my = ++threadSeq.current;') && r.includes('if (my !== threadSeq.current) return;'), 'only the newest thread fills the page');
  assert.ok(r.includes('threadSeq.current++; setOpen(null)'), 'Back drops an answer still on its way');
  assert.ok(r.includes('(r.data && r.data.requests) || []'), 'an empty answer does not throw and leave Loading... up');
  const m = read('renderer/native/admin.mjs');
  const h = m.slice(m.indexOf('export function useAdminData('), m.indexOf('function useAdminAction('));
  assert.ok(h.includes('const asked = key;') && h.includes('if (current.current !== asked) return;'), 'an answer for an older filter is dropped');
  assert.ok(h.includes('current.current = null'), 'and so is one that arrives after the page closed');
  assert.ok(m.includes("import { html, useState, useEffect, useMemo, useRef }"), 'useRef is imported');
});
