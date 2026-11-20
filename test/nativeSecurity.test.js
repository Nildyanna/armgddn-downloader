const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('covers fetched from other sites are refused when they point inside the member\'s own network', () => {
  const c = require('../native/coverPath');
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.9.9', '100.64.0.1', '[::1]', 'fd12::1', 'router', 'nas.local', 'x.internal']) assert.equal(c.isPublicHostName(h), false, h);
  for (const h of ['upload.wikimedia.org', 'images.example.com', '8.8.8.8']) assert.equal(c.isPublicHostName(h), true, h);
  assert.equal(c.coverRoute('https://192.168.1.1/a.jpg'), null);
  assert.equal(c.coverRoute('http://localhost:8080/a.jpg'), null);
  assert.equal(c.coverRoute('https://upload.wikimedia.org/a.jpg').kind, 'direct');
  assert.equal(c.isPrivateAddress('::ffff:10.0.0.1'), true); assert.equal(c.isPrivateAddress('93.184.216.34'), false);
});

test('direct cover fetches check every hop, resolve the name, and limit time, type and size', () => {
  const b = read('native', 'bridge.js');
  for (const k of ["redirect: 'manual'", 'dns.promises.lookup', 'isPrivateAddress(x.address)', 'AbortSignal.timeout', 'MAX_COVER_BYTES', 'hop < 4', 'image\\/']) assert.ok(b.includes(k), k);
});

test('a link on a web page cannot replace the saved sign-in, and cannot add to Komga without asking', () => {
  const m = read('main.js');
  const comics = m.slice(m.indexOf("if (u.hostname === 'comics')"), m.indexOf("if (u.hostname === 'komga')"));
  assert.ok(!comics.includes('saveSession('), 'comics and music links keep the token in memory only');
  assert.ok(m.includes('confirmKomgaDeepLink(listId).then'));
  assert.ok(m.includes('function writeSessionFile') && m.includes('mode: 0o600'));
});

test('Electron features the app never uses are turned off before packing, and the page policy is tighter', () => {
  const a = require('../scripts/afterPack.js'); const { FuseV1Options } = require('@electron/fuses');
  assert.equal(a.FUSES[FuseV1Options.RunAsNode], false); assert.equal(a.FUSES[FuseV1Options.EnableNodeCliInspectArguments], false); assert.equal(a.FUSES[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
  assert.equal(JSON.parse(read('package.json')).build.afterPack, 'scripts/afterPack.js');
  const html = read('renderer', 'native', 'index.html');
  for (const k of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(html.includes(k), k);
});

test('the actions that change the site for everyone are confirmed by the app, not by the page', async () => {
  const f = await import('../renderer/native/adminFormat.mjs');
  const bridge = read('native', 'bridge.js');
  for (const a of f.NATIVE_CONFIRMED) assert.ok(bridge.includes('    ' + a + ': ['), a);
  assert.ok(bridge.includes('confirmAdminAction(String(action), a)'));
  assert.ok(f.NATIVE_CONFIRMED.includes('restartServer') && f.NATIVE_CONFIRMED.includes('accessAdd') && f.NATIVE_CONFIRMED.includes('banUser'));
  assert.ok(!f.NATIVE_CONFIRMED.includes('requestStatus'), 'frequent request changes keep their quick in-page confirmation');
});

test('a message box asked for by the hidden classic window belongs to the native window and does not block the main process', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
  const h = main.slice(main.indexOf("ipcMain.handle('show-message-box'"), main.indexOf("ipcMain.handle('show-message-box'") + 1800);
  assert.ok(h.includes('parent = nativeWindow'));
  assert.ok(h.includes('dialog.showMessageBox(parent, safeOptions)') && !h.includes('showMessageBoxSync'));
  assert.ok(main.includes("!(NATIVE_PREVIEW && nativeWindow && !nativeWindow.isDestroyed())) mainWindow.webContents.send('update-available'"));
});

test('the software-rendering marker expires after 24 hours so one GPU crash does not leave the app slow for good', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('24 * 3600 * 1000') && main.includes('trying the graphics card again'));
});

test('Music and Comics downloads from the native window go to the folder chosen in Settings, and a big collection is not refused', () => {
  const fs = require('fs'), path = require('path');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'native', 'bridge.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(bridge.includes('new URLSearchParams(downloadParams(t.downloadToken, remote))'));
  assert.equal((bridge.match(/downloadParams\(t\.downloadToken, remote\)/g) || []).length, 2);     // the single download and the batch
  assert.ok(bridge.includes("if (dest === 'music' || dest === 'comics') q.dest = dest;"));
  assert.ok(main.includes('destFor: (remote) =>') && main.includes("remote === 'Music' ? settings.musicFolder : remote === 'Comics' ? settings.comicsFolder"));
  assert.ok(bridge.includes('const MAX_BATCH_PATHS = 500;') && !bridge.includes('paths.length > 50'));
});
