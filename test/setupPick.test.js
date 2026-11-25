'use strict';
// "Open the setup when extraction finishes" (Nov 25 2026, approved by George): the picking rule (setupPick.js), the "only after a clean,
// checked extraction" gate, the Windows-only buttons (renderer/native/format.mjs) and a guard that the launcher never elevates or runs silently.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sp = require('../setupPick');

const main = (entries, extra) => sp.findSetup({ platform: 'win32', sets: [{ rel: 'Game v12345678 -ARMGDDN.7z', entries }].concat(extra || []) });

test('AGRepackInstaller.exe alone at the top is the setup', () => {
  assert.deepStrictEqual(main(['AGRepackInstaller.exe', 'Data.bin']), { status: 'one', rel: 'AGRepackInstaller.exe' });
  assert.deepStrictEqual(main(['AGRepackInstaller.exe', 'AGRepackInstaller.dll', 'DataA.bin', 'Data1.bin']), { status: 'one', rel: 'AGRepackInstaller.exe' });
});

test('the older Setup.exe + Setup.dll + Data.bin is the setup', () => {
  assert.deepStrictEqual(main(['Setup.exe', 'Setup.dll', 'Data.bin']), { status: 'one', rel: 'Setup.exe' });
});

test('names are matched in any case', () => {
  assert.strictEqual(main(['SETUP.EXE', 'data.bin']).rel, 'SETUP.EXE');
  assert.strictEqual(main(['agrepackinstaller.exe', 'Data.bin']).rel, 'agrepackinstaller.exe');
  assert.strictEqual(main(['AgRepackInstaller.EXE']).rel, 'AgRepackInstaller.EXE');
});

test('both installers at once is ambiguous: nothing is opened', () => {
  const r = main(['AGRepackInstaller.exe', 'Setup.exe', 'Data.bin']);
  assert.strictEqual(r.status, 'several');
  assert.strictEqual(r.rel, undefined);
});

test('no installer: nothing (already-playable games, loose files)', () => {
  assert.strictEqual(main(['Game.exe', 'UnityPlayer.dll', 'Game_Data/level0']).status, 'none');
  assert.strictEqual(main([]).status, 'none');
});

test('one level down only when everything sits in a single folder', () => {
  assert.deepStrictEqual(main(['Wrapped', 'Wrapped/Setup.exe', 'Wrapped/Data.bin']), { status: 'one', rel: 'Wrapped/Setup.exe' });
  assert.deepStrictEqual(main([{ path: 'Wrapped', dir: true }, 'Wrapped\\AGRepackInstaller.exe']), { status: 'one', rel: 'Wrapped/AGRepackInstaller.exe' });
  // two things at the top: no looking inside
  assert.strictEqual(main(['Wrapped/Setup.exe', 'readme.txt']).status, 'none');
  // two levels down is never looked at
  assert.strictEqual(main(['A/B/Setup.exe']).status, 'none');
});

test('.bat, .cmd, .msi, uninstallers and nested archives are never the setup', () => {
  assert.strictEqual(main(['crashfix.bat', 'VD.bat', 'RealConfig.bat', 'OFMEFIX.bat', 'install.cmd', 'Setup.msi', 'unins000.exe', 'Setup.7z', 'setup.zip']).status, 'none');
  assert.deepStrictEqual(main(['Setup.exe', 'Data.bin', 'crashfix.bat', 'unins000.exe']), { status: 'one', rel: 'Setup.exe' });
  assert.strictEqual(main(['setup_x64.exe', 'Setup.exe.bak', 'MySetup.exe']).status, 'none');
});

test('redistributable folders are not looked into', () => {
  assert.strictEqual(main(['_CommonRedist/vcredist/setup.exe']).status, 'none');
  assert.strictEqual(main(['Redist', 'Redist/setup.exe']).status, 'none');
  assert.deepStrictEqual(main(['AGRepackInstaller.exe', 'Data.bin', '_CommonRedist/DirectX/setup.exe']), { status: 'one', rel: 'AGRepackInstaller.exe' });
});

test('only the main archive set counts: update patches, language packs, extras, mods, DLC and fixes never do', () => {
  const only = (rel, entries) => sp.findSetup({ platform: 'win32', sets: [{ rel, entries }] });
  for (const rel of [
    'Game v1-2_Update_Patch/Game v1-2_Update_Patch.7z', 'Clair Obscur v1-2 Update Patch/Clair Obscur v1-2 Update Patch.7z.001',
    'Patch 1 v1-2 Loose Files -ARMGDDN/Patch 1 v1-2 Loose Files -ARMGDDN.7z', "Marvel's Spider-Man 2 AIO Update to b1/x.7z",
    'Language Packs/Spanish.7z', 'Languages/Russian/Russian.7z', 'Extras/HD Texture Pack/M.A.T.D.E. - HD Textures.7z.001',
    'Mods.7z', 'Paid CC Mods.7z', 'OfflineServerForDLC-Mojteam.7z', 'Intel CTD Fix.7z', 'METAPHOR fix_rev5_byRikuKH3.7z', 'OnlineFix.7z',
    'Bonus Content.7z', 'Oblivion Remastered - Digital Artbook.7z', 'dlls.7z', 'extract here.7z', 'CONTROLResonant.7z',
  ]) assert.strictEqual(only(rel, ['Setup.exe', 'Data.bin']).status, 'no-main', rel);
  // the main set, at the title folder's top or in its own subfolder; a repack without "ARMGDDN" in its name still counts by its version number
  assert.strictEqual(only('Game v1 -ARMGDDN + OFME/Game v1 -ARMGDDN + OFME.7z.001', ['Setup.exe']).status, 'one');
  assert.strictEqual(only('Deadeye Deepfake Simulacrum v9720470.7z', ['Setup.exe']).status, 'one');
});

test('main set + add-on in one download: the main game\'s setup, unless the add-on has a setup too', () => {
  const addon = { rel: 'OnlineFix.7z', entries: ['OnlineFix64.dll', 'winmm.dll'] };
  assert.deepStrictEqual(main(['AGRepackInstaller.exe', 'Data.bin'], [addon]), { status: 'one', rel: 'AGRepackInstaller.exe' });
  const patch = { rel: 'Game v1-2_Update_Patch/Game v1-2_Update_Patch.7z', entries: ['Setup.exe'] };
  assert.strictEqual(main(['AGRepackInstaller.exe', 'Data.bin'], [patch]).status, 'several');
  // two main sets (VR and non-VR editions): not sure which, nothing is opened
  const vr = { rel: 'Sky Squadron VR v14463934 -ARMGDDN.7z', entries: ['Setup.exe'] };
  assert.strictEqual(main(['Setup.exe'], [vr]).status, 'several-main');
});

test('Windows only', () => {
  for (const platform of ['linux', 'darwin', '', undefined]) {
    assert.strictEqual(sp.findSetup({ platform, sets: [{ rel: 'Game v12345678 -ARMGDDN.7z', entries: ['Setup.exe'] }] }).status, 'unsupported');
  }
});

test('7-Zip technical listings are read into entries (the archive header is not an entry)', () => {
  const slt = [
    'Listing archive: /x/Game v1 -ARMGDDN.7z', '', '--', 'Path = /x/Game v1 -ARMGDDN.7z', 'Type = 7z', '', '----------',
    'Path = AGRepackInstaller.exe', 'Size = 13743719', 'Attributes = A', '',
    'Path = Data.bin', 'Size = 1521659314', 'Attributes = A', '',
    'Path = Extras', 'Folder = +', 'Attributes = D', '',
    'Path = Extras\\readme.txt', 'Attributes = A', '',
  ].join('\r\n');
  const entries = sp.parseSltListing(slt);
  assert.deepStrictEqual(entries, [
    { path: 'AGRepackInstaller.exe', dir: false }, { path: 'Data.bin', dir: false }, { path: 'Extras', dir: true }, { path: 'Extras/readme.txt', dir: false },
  ]);
  assert.deepStrictEqual(main(entries), { status: 'one', rel: 'AGRepackInstaller.exe' });
});

test('the automatic open needs: the option on, Windows, a clean extraction, a passed file check, one setup, not opened before', () => {
  const ok = { enabled: true, platform: 'win32', setupRel: 'Setup.exe', didExtract: true, extractionError: '', didCheck: true, checkOk: true, alreadyOpened: false };
  assert.strictEqual(sp.shouldAutoOpenSetup(ok), true);
  const no = (patch) => assert.strictEqual(sp.shouldAutoOpenSetup({ ...ok, ...patch }), false, JSON.stringify(patch));
  no({ enabled: false }); no({ enabled: undefined });
  no({ platform: 'linux' }); no({ platform: 'darwin' });
  no({ setupRel: '' }); no({ setupRel: undefined }); no({ setupRel: 'crashfix.bat' });
  no({ didExtract: false }); no({ extractionError: 'Wrong password' });
  no({ didCheck: false }); no({ checkOk: false });
  no({ alreadyOpened: true });
  assert.strictEqual(sp.shouldAutoOpenSetup(), false);
});

test('a saved setup path is only used when the rule could have picked it', () => {
  assert.ok(sp.isAllowedSetupRel('Setup.exe'));
  assert.ok(sp.isAllowedSetupRel('Wrapped/AGRepackInstaller.exe'));
  for (const bad of ['', 'crashfix.bat', 'Setup.msi', '../Setup.exe', 'a/b/Setup.exe', '_CommonRedist/setup.exe', 'unins000.exe', 'Game.exe'])
    assert.ok(!sp.isAllowedSetupRel(bad), bad);
});

test('the Settings default is off, and the setting can be saved', () => {
  const root = path.join(__dirname, '..');
  const settings = fs.readFileSync(path.join(root, 'main', 'settings.js'), 'utf8');
  assert.match(settings, /openSetupAfterExtract = ctx\.settings\.openSetupAfterExtract === true/);
  assert.match(fs.readFileSync(path.join(root, 'main', 'ipcSettings.js'), 'utf8'), /'openSetupAfterExtract'/);
});

test('Open setup and "Setup opened" show only on Windows, on a finished download with one setup', async () => {
  const { downloadActions, setupShown, setupNote } = await import('../renderer/native/format.mjs');
  const d = { status: 'completed', setupFound: true, setupOpened: true };
  assert.deepStrictEqual(downloadActions(d, 'win32'), ['openSetup', 'openFolder']);
  assert.deepStrictEqual(downloadActions(d, 'linux'), ['openFolder']);
  assert.deepStrictEqual(downloadActions(d, 'darwin'), ['openFolder']);
  assert.deepStrictEqual(downloadActions({ status: 'completed' }, 'win32'), ['openFolder']);
  assert.deepStrictEqual(downloadActions({ ...d, status: 'extracting' }, 'win32'), ['cancel']);
  assert.strictEqual(setupShown(d, 'win32'), true);
  assert.strictEqual(setupNote(d, 'win32'), 'Setup opened');
  assert.strictEqual(setupNote({ ...d, setupOpened: false }, 'win32'), '');
  assert.strictEqual(setupNote(d, 'linux'), '');
});

test('the launcher never elevates, never runs silently and never builds a command line (source guard)', () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'main', 'setupLaunch.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // comments may name what is not done
  assert.doesNotMatch(code, /runas/i);
  assert.doesNotMatch(code, /['"`]\/(S|SILENT|VERYSILENT|SUPPRESSMSGBOXES|quiet|qn|passive)['"`\s]/i);
  assert.doesNotMatch(code, /--silent|-silent|\/silent/i);
  assert.doesNotMatch(code, /shell:\s*true/);
  assert.doesNotMatch(code, /\bexec(Sync)?\(/);
  assert.doesNotMatch(code, /Start-Process|powershell|cmd(\.exe)?['" ]/i);
  assert.match(code, /spawn\(file, \[\], \{ cwd: path\.dirname\(file\)/, 'started with no arguments, in its own folder');
  assert.match(code, /shell: false/);
  // the window never passes a path: open-setup takes an id and looks it up in the history
  const ipc = fs.readFileSync(path.join(root, 'main', 'ipcDownloads.js'), 'utf8');
  assert.match(ipc, /ipcMain\.handle\('open-setup', async \(event, arg\) => \{\n  const id = typeof arg === 'string' \? arg : '';/);
  assert.match(src, /lstatSync\(file\)/, 'the file is checked again right before it is opened');
});
