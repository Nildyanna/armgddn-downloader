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

test('opening the Companion again or using the tray brings up the native window when the app runs in native mode, and closing it can keep the app in the tray', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('function showAppWindow()') && main.includes('NATIVE_PREVIEW && nativeWindow && !nativeWindow.isDestroyed()'));
  const second = main.slice(main.indexOf("app.on('second-instance'"), main.indexOf("app.on('second-instance'") + 400);
  assert.ok(second.indexOf('showAppWindow()') > -1, 'a second launch shows the native window first');
  const tray = main.slice(main.indexOf('const showMainWindow = () => {'), main.indexOf('const showMainWindow = () => {') + 200);
  assert.ok(tray.includes('showAppWindow()'), 'the tray shows the native window first');
  assert.ok(main.includes("nativeWindow.on('close'") && main.includes('settings.minimizeToTrayOnClose) { event.preventDefault(); nativeWindow.hide(); }'));
});

test('the Companion checks for updates once an hour in the main process, announces each new version once, and the native window has a Check for updates button and an Update now bar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('const UPDATE_POLL_MS = 60 * 60 * 1000;') && main.includes('setInterval(pollForUpdateOnce, UPDATE_POLL_MS)'));
  assert.ok(main.includes('app.whenReady().then(() => {\n  startUpdatePoller();'), 'the poller starts with the app');
  const poll = main.slice(main.indexOf('async function pollForUpdateOnce'), main.indexOf('function startUpdatePoller'));
  assert.ok(poll.includes('_updateAnnouncedVersion === raw.latestVersion'), 'a version is announced once');
  assert.ok(poll.includes('showDownloadNotification(') && poll.includes("send('update-available'") && poll.includes("send('native:updateAvailable'"));
  assert.ok(poll.includes('!app.isPackaged') && poll.includes('SMOKE_TEST'), 'dev copies and the CI smoke run never announce');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const preN = fs.readFileSync(path.join(__dirname, '..', 'preload-native.js'), 'utf8');
  assert.ok(pre.includes("'update-available'") && preN.includes("'native:updateAvailable'") && preN.includes("checkUpdates: call('check-updates')"));
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('Check for updates') && app.includes('function UpdateRow') && app.includes('<${UpdateRow} say=${say} />'));
  assert.ok(app.includes('updatebar') && app.includes('api.checkUpdates()') && app.includes('api.onUpdateAvailable('));
  const classic = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(classic.includes('api.onUpdateAvailable') && classic.includes('showUpdateNotification(info)'));
});

test('the native window has the classic tools: schedule, game updates, .7z help video, What\'s New after an update, clear history', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  for (const piece of ['function ScheduleRow', '<${ScheduleRow} s=${s} save=${save} />', 'function GameUpdatesRow', '<${GameUpdatesRow} onOpenGame=${onOpenGame} />', 'function Help7zRow', '<${Help7zRow} />',
    'function WhatsNewBox', 'api.pendingWhatsNew()', '<${WhatsNewButton} />', 'api.clearHistory()', 'onClear=${']) assert.ok(app.includes(piece), piece);
  const preN = fs.readFileSync(path.join(__dirname, '..', 'preload-native.js'), 'utf8');
  for (const piece of ["getScheduleBanner: call('get-schedule-banner')", "checkGameUpdates: call('check-game-updates')", "clearHistory: call('clear-history')", "pendingWhatsNew: call('native-pending-whats-new')", "getHelp7zVideoSrc: call('get-help-7z-video-src')"]) assert.ok(preN.includes(piece), piece);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("ipcMain.handle('native-pending-whats-new'") && main.includes('pendingWhatsNewEntryNative = pendingWhatsNewEntry;'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'index.html'), 'utf8');
  assert.ok(html.includes("media-src 'self' blob: file:"), 'the local help video may play');
});

test('members on the native window see ARMGDDN Browser in the update window, notification and bar; everyone else keeps ARMGDDN Companion', () => {
  const u = require('../updateRunner');
  const base = { pid: 1, filePath: 'a', appExe: 'b', wrapperLogPath: 'c', resultPath: 'd', silentArg: '/S', shouldRelaunch: true };
  const nat = u.buildRunner({ ...base, appName: 'ARMGDDN Browser' });
  assert.ok(nat.includes("$form.Text = 'ARMGDDN Browser'") && nat.includes('Installing the update. ARMGDDN Browser reopens by itself'));
  const classic = u.buildRunner(base);
  assert.ok(classic.includes("$form.Text = 'ARMGDDN Companion'") && classic.includes('Installing the update. ARMGDDN Companion reopens by itself'));
  assert.ok(!u.buildRunner({ ...base, appName: "x'; Remove-Item *" }).includes("Remove-Item *'"), 'the name cannot break out of the script');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("appName: NATIVE_PREVIEW ? 'ARMGDDN Browser' : 'ARMGDDN Companion'") && main.includes("NATIVE_PREVIEW ? 'ARMGDDN Browser update available'"));
});

test('the native window has a fixed top bar (every page, the current one lit) and a page bar below it with the page controls and a Grid / List switch', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('<header class="topbar">') && app.includes('<div class="subbar">') && app.includes('<span class="subtitle">${pageLabel}</span>'));
  const top = app.slice(app.indexOf('<header class="topbar">'), app.indexOf('<div class="subbar">'));
  for (const w of ['Home', 'Tools', 'Settings', 'Wiki', 'My List', 'Requests', 'Downloads']) assert.ok(top.includes(w), w + ' is in the top bar');
  assert.ok(!top.includes('class="search"') && !top.includes('Everywhere'), 'the page controls are not in the top bar');
  const sub = app.slice(app.indexOf('<div class="subbar">'), app.indexOf('<div class="subbar">') + 6000);
  assert.ok(sub.includes('class="search"') && sub.includes('Everywhere') && sub.includes('class="viewsel"'));
  assert.ok(app.includes("localStorage.setItem('native.viewMode', m)") && app.includes("listMode=${viewMode === 'list'}") && app.includes("class=${listMode ? 'list' : 'grid wide'}"));
  assert.ok(app.includes("return html`<div class=${'lrow'"), 'a list row has no art');
});

test('an empty list says so in words; only a list that is really loading gets the spinner', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('<div class="empty">No downloads yet.') && app.includes('<div class="empty">Your list is empty.'));
  for (const m of app.matchAll(/<div class="loading">([^<]*)</g)) assert.ok(/^Loading/.test(m[1]), 'only loading messages use the spinner: ' + m[1]);
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'native.css'), 'utf8');
  assert.ok(css.includes('.empty {'));
});

test('the alphabet jump bar sits inside the list area under the two bars and works in grid and list view', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const bar = app.slice(app.indexOf('function AlphaBar'), app.indexOf('function Modal('));
  assert.ok(bar.includes("document.querySelector('main.grid, main.list')") && bar.includes('class="alphawrap"'), 'positioned from the list area');
  assert.ok(bar.includes("'main [data-letter=\"'"), 'jumps within a grid or a list');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'native.css'), 'utf8');
  assert.ok(css.includes('.alphawrap { position: fixed;') && !/\.alpha \{[^}]*top: 50%/.test(css));
});

test('a game found by "Check my games" is a link that opens it in the library (the section comes from the site)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('function GameUpdatesRow({ onOpenGame })') && app.includes('class="glink"') && app.includes("onOpenGame(u.remote || 'PC Games', u.latestFolder)"));
  assert.ok(app.includes("onOpenGame=${(rem, name) => { setCategory(''); setView('library'); autoOk.current = true; setRemote(rem); setFolder(''); setQuery(name); }}"));
});

test('every screen has a Back button (and Alt+Left / the mouse back button) that returns to the previous screen', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('const navStack = useRef([]);') && app.includes('const goBack = () => {'));
  const sub = app.slice(app.indexOf('<div class="subbar">'), app.indexOf('<div class="subbar">') + 400);
  assert.ok(sub.includes('class="tab backbtn"') && sub.indexOf('backbtn') < sub.indexOf('class="subtitle"'), 'Back is first in the page bar, on every page');
  assert.ok(app.includes("e.altKey && e.key === 'ArrowLeft'") && app.includes('e.button === 3'));
  assert.ok(app.includes('skip the app\'s own step into a game group'), 'the automatic step into the mirror root is not a screen');
});

test('the Requests page no longer throws (a notice that used the library page\'s variables sat inside it), and a page that fails to draw cannot take the whole window down', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const req = app.slice(app.indexOf('function RequestsView'), app.indexOf('function MyListView'));
  for (const name of ['noticeOff', 'everywhere', "view ===", "remote ==="]) assert.ok(!req.includes(name), 'RequestsView must not use ' + name);
  assert.equal((app.match(/Some albums and comic collections may be missing/g) || []).length, 1);
  assert.ok(app.indexOf('Some albums and comic collections may be missing') > app.indexOf('function App()'), 'the catalogue notice is in the library page');
  assert.ok(app.includes('class PageGuard extends Component') && app.includes('<${PageGuard} key=${view} onBack=${goBack}>') && app.includes('</${PageGuard}>'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'native', 'vendor', 'ui.mjs'), 'utf8').includes('Component'));
});

test('the File and Help menus reach Settings, the update check and the window switch in either window', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const menu = main.slice(main.indexOf('function createAppMenu()'), main.indexOf('Menu.setApplicationMenu(menu)'));
  for (const piece of ["label: 'Settings'", "label: 'Check for updates'", "'Switch to the classic window' : 'Switch to the new window'", 'Open the log folder']) assert.ok(menu.includes(piece), piece);
  assert.ok(main.includes("function openSettingsWindow()") && main.includes("'native:open', { view: 'settings' }") && main.includes("getElementById('settings-btn')"));
  assert.ok(main.includes("'native:open', { view: 'settings', check: true }") && main.includes("getElementById('check-updates-btn')"));
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes("m.view === 'settings'") && app.includes("'native-run-update-check'"));
});

test('File > Exit really exits: it marks the app as quitting so the keep-running-in-the-tray close handlers do not swallow it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); }"));
  assert.ok(main.includes("app.on('before-quit', () => { app.isQuitting = true; });"));
  assert.ok(!/label: 'File',\s*submenu: \[[^\]]*role: 'quit'/.test(main), 'the File menu no longer uses the plain quit role');
});

test('the themed backdrop is a single fixed layer behind the window, not a tiled background of the body', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'native.css'), 'utf8');
  assert.ok(/body::before \{[^}]*position: fixed; inset: 0; z-index: -1;[^}]*background: var\(--page, var\(--bg\)\); background-attachment: scroll;/.test(css));
  assert.ok(/body \{[^}]*background: none; background-color: var\(--page-color/.test(css), 'the body itself paints only the colour');
});
