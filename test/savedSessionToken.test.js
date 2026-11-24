const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
// main.js is not importable in a test (Electron), so check the source: the catalog and download-missing code must use the token string,
// never the true/false that loadSession() returns.
const src = require('./mainSource')();
test('loadSession() returns a boolean, so it must not be used as a token in the library calls', () => {
  assert.match(src, /function savedSessionToken\(\)/);
  const catalog = require('./mainSource').fn('catalogTokens');
  assert.ok(catalog.includes('savedSessionToken()') && !catalog.includes('loadSession()'));
  for (const h of ["ipcMain.handle('comics-download-missing'", "ipcMain.handle('music-download-missing'"]) {
    const body = src.slice(src.indexOf(h), src.indexOf(h) + 900);
    assert.ok(body.includes('savedSessionToken()'), h);
  }
  // the native Komga calls get their sign-in through comicsGet, which tries every token the app holds (catalogTokens above)
  assert.ok(src.slice(src.indexOf("ipcMain.handle('native-komga-lists'"), src.indexOf("ipcMain.handle('native-komga-lists'") + 600).includes('comicsGet('));
  const helper = require('./mainSource').fn('komgaAddFromCatalog');
  assert.ok(helper.includes('comicsGet('));
  assert.ok(src.slice(src.indexOf("ipcMain.handle('native-komga-add'"), src.indexOf("ipcMain.handle('native-komga-add'") + 1500).includes('komgaAddFromCatalog('));
});

test('the settings loader ignores a byte-order mark (a PowerShell-written config once stopped the app from loading)', () => {
  const body = src.slice(src.indexOf('function loadSettings()'), src.indexOf('function loadSettings()') + 500);
  assert.ok(body.includes("replace(/^\\uFEFF/, '')"));
  assert.strictEqual(JSON.parse('{"a":1}'.replace(/^\uFEFF/, '')).a, 1);
  assert.strictEqual(JSON.parse('\uFEFF{"a":1}'.replace(/^\uFEFF/, '')).a, 1);
});
