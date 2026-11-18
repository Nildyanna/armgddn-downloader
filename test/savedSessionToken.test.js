const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
// main.js is not importable in a test (Electron), so check the source: the catalog and download-missing code must use the token string,
// never the true/false that loadSession() returns.
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
test('loadSession() returns a boolean, so it must not be used as a token in the library calls', () => {
  assert.match(src, /function savedSessionToken\(\)/);
  const catalog = src.slice(src.indexOf('function catalogTokens'), src.indexOf('async function comicsGet'));
  assert.ok(catalog.includes('savedSessionToken()') && !catalog.includes('loadSession()'));
  for (const h of ["ipcMain.handle('comics-download-missing'", "ipcMain.handle('music-download-missing'"]) {
    const body = src.slice(src.indexOf(h), src.indexOf(h) + 900);
    assert.ok(body.includes('savedSessionToken()'), h);
  }
  // the native Komga calls get their sign-in through comicsGet, which tries every token the app holds (catalogTokens above)
  for (const h of ["ipcMain.handle('native-komga-lists'", "ipcMain.handle('native-komga-add'"]) {
    const body = src.slice(src.indexOf(h), src.indexOf(h) + 1400);
    assert.ok(body.includes('comicsGet('), h);
  }
});

test('the settings loader ignores a byte-order mark (a PowerShell-written config once stopped the app from loading)', () => {
  const body = src.slice(src.indexOf('function loadSettings()'), src.indexOf('function loadSettings()') + 500);
  assert.ok(body.includes("replace(/^\\uFEFF/, '')"));
  assert.strictEqual(JSON.parse('{"a":1}'.replace(/^\uFEFF/, '')).a, 1);
  assert.strictEqual(JSON.parse('\uFEFF{"a":1}'.replace(/^\uFEFF/, '')).a, 1);
});
