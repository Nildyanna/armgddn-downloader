const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'loginLightning.mjs'), 'utf8');

test('every name the intro uses is defined in the module (the port once used one the website defines elsewhere, and the intro never started)', () => {
  // identifiers written in capitals with underscores are constants; each one used must be declared here
  const used = new Set((src.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || []));
  for (const name of used) assert.ok(new RegExp('(?:const|let|var)\\s+' + name + '\\b').test(src), name + ' is used but never declared');
  assert.ok(/const LOGIN_LIGHTNING_REAL_SRC = 'login-thunder\.wav'/.test(src));
});

test('a failed intro cannot trap the screen: sound errors are contained, a thrown error removes the stage, and a loop that never draws removes it too', () => {
  assert.ok(src.includes('} catch (audioError) {'));
  const wrapper = src.slice(src.indexOf('export function mountLoginLightning()'));
  assert.ok(wrapper.includes('mountLoginLightningInner()') && wrapper.includes("getElementById('loginLightningStage')") && wrapper.includes('removeChild(st)'));
  assert.ok(src.includes('state.ticked = true') && src.includes('!state.ticked') && src.includes('}, 4000);'));
});

test('the assets the intro loads sit next to the page, so they are packaged with it', () => {
  const dir = path.join(__dirname, '..', 'renderer', 'native');
  assert.ok(fs.existsSync(path.join(dir, 'login-thunder.wav')) && fs.existsSync(path.join(dir, 'login-lightning-logo.png')));
  assert.ok(src.includes("logo.src = 'login-lightning-logo.png'"));
});

test('an unpackaged copy never runs an installer (a test copy once updated the real Companion this way)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('install-update'"), main.indexOf("ipcMain.handle('install-update'") + 900);
  const guard = handler.indexOf('!app.isPackaged && process.env.ARMGDDN_ALLOW_DEV_UPDATE');
  assert.ok(guard > -1 && guard < handler.indexOf('_installUpdateInProgress'), 'the guard comes first');
  assert.ok(handler.includes('Updates are only installed by the packaged app'));
});
