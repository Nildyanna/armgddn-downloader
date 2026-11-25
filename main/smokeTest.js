'use strict';
// The built app's own start-up test (ARMGDDN_SMOKE_TEST=1): rclone, 7-Zip, the setup check and report, the low-space box (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { mainWindowAlive } = require('./dialogs');
const { extractRcloneErrorDetail, notInChannelMessage } = require('./errors');
const { resolve7zTool, run7zExtract } = require('./extract');
const { buildInstallSpaceWarning, cleanupAppImageBackup } = require('./files');
const { quoteDesktopExecArg } = require('./util');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// App ready
// Launches the real window and exercises the real download engine, then exits
// 0 (pass) or 1 (fail). CI runs this before a release can publish, since
// Companion builds otherwise only get a syntax check before reaching users.
function runSmokeTest() {
  const http = require('http');
  const { execFile } = require('child_process');
  const failures = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const ok = failures.length === 0;
    const line = `[smoke] ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ': ' + failures.join(' | ')}`;
    console.log(line);
    // Windows GUI apps don't reliably write to a redirected stdout, so CI
    // reads the result from this file instead.
    if (process.env.ARMGDDN_SMOKE_RESULT) {
      try { fs.writeFileSync(process.env.ARMGDDN_SMOKE_RESULT, line + '\n', 'utf8'); } catch (e) { }
    }
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => { failures.push('timed out after 120s'); finish(); }, 120000);
  process.on('uncaughtException', (e) => failures.push(`uncaught: ${e && e.message}`));
  process.on('unhandledRejection', (e) => failures.push(`unhandled rejection: ${e && e.message}`));

  const waitForWindow = () => new Promise((resolve) => {
    const wc = mainWindowAlive() ? ctx.mainWindow.webContents : null;
    if (!wc) { failures.push('main window was not created'); return resolve(); }
    wc.on('console-message', (...args) => {
      const d = args[0] && typeof args[0] === 'object' && 'level' in args[0] ? args[0] : { level: args[1], message: args[2] };
      if (d.level === 'error' || d.level === 3) failures.push(`renderer console error: ${d.message}`);
    });
    wc.on('render-process-gone', (_e, det) => failures.push(`renderer died: ${det && det.reason}`));
    wc.on('did-fail-load', (_e, code, desc) => failures.push(`UI failed to load: ${code} ${desc}`));
    if (!wc.isLoading()) return resolve();
    wc.once('did-finish-load', resolve);
  });

  const run = (args) => new Promise((resolve) => {
    execFile(ctx.getRclonePath(), args, { timeout: 60000 }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });

  (async () => {
    await waitForWindow();
    const v = await run(['version']);
    if (v.err) failures.push(`bundled rclone did not run: ${v.err.message}`);

    // The setup check has to flag a full temp drive and a missing runtime, and stay quiet on a healthy machine.
    try {
      const sc = require('../setupCheck');
      const GBs = 1024 ** 3;
      const bad = sc.evaluateSetup({ platform: 'win32', downloadPath: 'D:\\Games', homeDir: 'C:\\Users\\me', tempDir: 'C:\\Temp', freeDownload: 500 * GBs, freeTemp: 5 * GBs, avProducts: ['Windows Defender'], defenderExclusions: ['D:\\Games'], vcRuntime: false, d3dx: true });
      const good = sc.evaluateSetup({ platform: 'win32', downloadPath: 'D:\\Games', homeDir: 'C:\\Users\\me', tempDir: 'C:\\Temp', freeDownload: 500 * GBs, freeTemp: 200 * GBs, avProducts: ['Windows Defender'], defenderExclusions: ['D:\\Games'], vcRuntime: true, d3dx: true });
      const warns = (r) => r.filter(f => f.status === 'warn').map(f => f.id).sort().join(',');
      if (warns(bad) !== 'redists,temp-space') failures.push(`setup check flagged: ${warns(bad)}`);
      if (warns(good) !== '') failures.push(`setup check warned on a healthy machine: ${warns(good)}`);
    } catch (e) { failures.push(`setup check failed: ${e.message}`); }

    // The setup report must decode back to what was put in, and keep user names, URL queries and tokens out.
    try {
      const rep = require('../setupReport');
      const code = rep.buildReport({ appVersion: '0.0.0', platform: 'win32', release: '10', arch: 'x64', findings: [{ id: 'x', status: 'warn', title: 'C:\\Users\\Alice\\Temp is full' }], facts: { downloadPath: 'D:\\Games' },
        logText: '[ERROR] failed https://h.example/p?token=SECRETVALUE1234 for C:\\Users\\Alice\\x' });
      const back = rep.decodeReport(code);
      const flat = JSON.stringify(back);
      if (!/<user>/.test(flat) || /Alice|SECRETVALUE/.test(flat) || back.v !== 1) failures.push('setup report leaked or failed to round-trip');
    } catch (e) { failures.push(`setup report failed: ${e.message}`); }

    // The "Low Space" box has to say the download folder is fine and name the drive that needs room.
    try {
      const w = buildInstallSpaceWarning({ need: 40 * 1024 ** 3, required: 40 * 1024 ** 3, free: 12 * 1024 ** 3, sameDrive: false, driveLabel: 'C:', dlLabel: 'D:' });
      if (!/download folder \(D:\) is fine/.test(w.detail) || !/C:/.test(w.title) || !/Wiki/.test(w.detail)) failures.push('low-space box wording changed');
    } catch (e) { failures.push(`low-space box failed: ${e.message}`); }

    const payload = Buffer.alloc(2 * 1024 * 1024, 7);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
      res.end(payload);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const dest = path.join(app.getPath('userData'), 'smoke-download.bin');
    const cfg = ctx.getEmptyRcloneConfigPath();
    const dl = await run(['copyurl', `http://127.0.0.1:${server.address().port}/smoke.bin`, dest, ...(cfg ? ['--config', cfg] : [])]);
    server.close();
    if (dl.err) failures.push(`rclone copyurl failed: ${(dl.stderr || dl.err.message).toString().slice(0, 300)}`);
    else {
      let size = -1;
      try { size = fs.statSync(dest).size; } catch (e) { }
      if (size !== payload.length) failures.push(`downloaded file has ${size} bytes, expected ${payload.length}`);
    }
    // rclone's INFO lines are never the reason a download failed. 5.0.23 reported "Starting
    // bandwidth limiter" as a download's error, which hid the real cause.
    try {
      if (extractRcloneErrorDetail('2026/10/03 19:25:42 INFO  : Starting bandwidth limiter at 7.500Mi Byte/s') !== '') {
        failures.push('an INFO-only rclone log was reported as the failure reason');
      }
      const realError = extractRcloneErrorDetail('2026/10/03 19:25:42 INFO  : Starting bandwidth limiter\n2026/10/03 19:25:44 ERROR : a.7z: Failed to copy: boom');
      if (!/Failed to copy: boom/.test(realError)) failures.push(`a real rclone error was not reported: ${JSON.stringify(realError)}`);
    } catch (e) {
      failures.push(`error-detail check threw: ${e && e.message}`);
    }
    // Linux handler path quoting and AppImage backup cleanup (pure fs/string logic, runs everywhere).
    try {
      const q = quoteDesktopExecArg;
      if (q('/home/u/App.AppImage') !== '/home/u/App.AppImage') failures.push(`plain path was quoted: ${q('/home/u/App.AppImage')}`);
      if (q('/home/u/My Apps/App.AppImage') !== '"/home/u/My Apps/App.AppImage"') failures.push(`path with a space was not quoted: ${q('/home/u/My Apps/App.AppImage')}`);
      if (q('/a/b$c/App') !== '"/a/b\\\\$c/App"') failures.push(`$ was not escaped: ${q('/a/b$c/App')}`);
      if (q('/a/100%/App') !== '/a/100%%/App') failures.push(`% was not doubled: ${q('/a/100%/App')}`);
      const tmp = path.join(app.getPath('userData'), 'smoke-appimage');
      fs.mkdirSync(tmp, { recursive: true });
      const cur = path.join(tmp, 'Companion.AppImage');
      fs.writeFileSync(cur, Buffer.alloc(2 * 1024 * 1024, 1));
      fs.writeFileSync(cur + '.old', Buffer.alloc(1024, 2));
      const past = new Date(Date.now() - 3600 * 1000);
      fs.utimesSync(cur + '.old', past, past);
      const r1 = cleanupAppImageBackup(cur);
      if (!/^deleted /.test(r1) || fs.existsSync(cur + '.old')) failures.push(`backup was not cleaned up: ${r1}`);
      if (!fs.existsSync(cur)) failures.push('cleanup removed the running AppImage itself');
      if (cleanupAppImageBackup(cur) !== 'none') failures.push('cleanup with no backup was not a no-op');
      fs.writeFileSync(cur + '.old', Buffer.alloc(1024, 2));
      fs.writeFileSync(cur, Buffer.alloc(10, 1));
      if (!/^kept: the current AppImage looks wrong/.test(cleanupAppImageBackup(cur)) || !fs.existsSync(cur + '.old')) failures.push('cleanup deleted the backup although the current AppImage looks wrong');
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    } catch (e) {
      failures.push(`appimage helper check threw: ${e && e.message}`);
    }

    // A member who left the group must be told to rejoin, not shown "session expired".
    try {
      if (!/rejoin/i.test(notInChannelMessage({ code: 'NOT_IN_CHANNEL', message: 'Please rejoin the group.' }) || '')) {
        failures.push('NOT_IN_CHANNEL did not surface the server message');
      }
      if (notInChannelMessage({ code: undefined, errMsg: 'Authentication required' }) !== null) {
        failures.push('an ordinary 401 was treated as NOT_IN_CHANNEL');
      }
    } catch (e) {
      failures.push(`not-in-channel check threw: ${e && e.message}`);
    }
    // Bundled 7-Zip (auto-extract). 5.0.18 to 5.0.20 shipped without it because the build
    // tool stopped pulling it in, and nothing noticed. Round-trip a password-protected
    // archive through the app's real extraction code.
    try {
      const sevenZip = ctx.get7zPath();
      if (!sevenZip || !fs.existsSync(sevenZip)) {
        failures.push(`bundled 7z is missing: ${sevenZip}`);
      } else {
        // A real Linux/macOS install can't chmod the bundled tool, so strip its execute bit
        // and forbid chmod here too: only the private-copy fallback can make this pass.
        let sevenZipRun = sevenZip;
        if (process.platform !== 'win32') {
          process.env.ARMGDDN_TEST_NO_CHMOD = '1';
          try { fs.chmodSync(sevenZip, 0o644); } catch (e) { failures.push(`could not strip the execute bit for the test: ${e && e.message}`); }
          sevenZipRun = resolve7zTool() || sevenZip;
          // With the execute bit stripped and chmod forbidden, running it in place is impossible,
          // so a pass is only meaningful if the private copy (or a system 7-Zip) was really used.
          if (sevenZipRun === sevenZip) failures.push(`7z fallback was not used: ${ctx._resolved7zFailures.join('; ') || 'the tool was run in place without the execute bit'}`);
          else if (sevenZipRun.includes(path.sep) && !fs.existsSync(sevenZipRun)) failures.push(`7z fallback copy is missing: ${sevenZipRun}`);
        }
        const dir = path.join(app.getPath('userData'), 'smoke-7z');
        const srcDir = path.join(dir, 'src');
        const outDir = path.join(dir, 'out');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'a.txt'), 'hello 7z smoke', 'utf8');
        const archive = path.join(dir, 'test.7z');
        const made = await new Promise((resolve) => {
          execFile(sevenZipRun, ['a', '-pARMGDDNGames', '-y', archive, 'a.txt'], { cwd: srcDir, timeout: 60000 }, (err, stdout, stderr) => resolve({ err, stderr }));
        });
        if (made.err) {
          failures.push(`bundled 7z could not create an archive: ${(made.stderr || made.err.message).toString().slice(0, 200)}`);
        } else {
          await run7zExtract(archive, outDir);
          let text = '';
          try { text = fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'); } catch (e) { }
          if (text !== 'hello 7z smoke') failures.push(`7z extraction produced ${JSON.stringify(text)}`);
        }
      }
    } catch (e) {
      failures.push(`7z extraction failed: ${e && e.message}`);
    }
    // The app's own download engine end to end (Nov 24 2026, after main.js was split into modules): a three-part password .7z from a local
    // server goes through startDownload, the downloader, the file check against its checksums and unpacking, exactly as a member's
    // download does. The start-up checks above never touched this path, so a broken engine could ship. Nothing is reported to the site.
    try {
      const crypto = require('crypto');
      const root = path.join(app.getPath('userData'), 'smoke-engine');
      const srcDir = path.join(root, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const payload = crypto.randomBytes(2500 * 1024);                 // incompressible, so 1 MB volumes give three parts
      fs.writeFileSync(path.join(srcDir, 'payload.bin'), payload);
      const tool = resolve7zTool() || ctx.get7zPath();
      const made = await new Promise((resolve) => {
        execFile(tool, ['a', '-v1m', '-pARMGDDNGames', '-y', path.join(root, 'game.7z'), 'payload.bin'], { cwd: srcDir, timeout: 60000 }, (err, so, se) => resolve({ err, se }));
      });
      if (made.err) throw new Error('could not build the test archive: ' + String(made.se || made.err.message).slice(0, 200));
      const parts = {};
      for (const n of fs.readdirSync(root).filter((x) => /^game\.7z\.\d{3}$/.test(x)).sort()) parts[n] = fs.readFileSync(path.join(root, n));
      if (Object.keys(parts).length < 2) throw new Error(`expected a multi-part archive, got ${Object.keys(parts).join(', ')}`);
      const srv = http.createServer((req, res) => {
        const buf = parts[decodeURIComponent(String(req.url).split('?')[0].split('/').pop())];
        if (!buf) { res.writeHead(404); return res.end(); }
        const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ''));
        if (m) {
          const a = m[1] ? Number(m[1]) : 0, b = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
          res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' });
          return res.end(req.method === 'HEAD' ? undefined : buf.subarray(a, b + 1));
        }
        res.writeHead(200, { 'Content-Length': buf.length, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${srv.address().port}/`;
      const name = 'Smoke Test Game v1 -ARMGDDN';
      Object.assign(ctx.settings, { downloadPath: path.join(root, 'downloads'), autoExtract7z: true, autoHashCheck: true, extractFolder: '' });
      const manifest = { name, path: `PC1/${name}`, files: Object.entries(parts).map(([n, buf]) => ({ name: n, url: base + encodeURIComponent(n), size: buf.length,
        md5: crypto.createHash('md5').update(buf).digest('hex') })) };
      const id = await require('./ipcDownloads').startDownload(null, manifest, 'a'.repeat(64), '', '');
      // A finished download leaves the active list for the history; wait for either.
      const find = () => ctx.activeDownloads.get(id) || (ctx.downloadHistory || []).find((h) => h && h.id === id);
      let d = find();
      for (let i = 0; i < 240 && !(d && (d.status === 'completed' || d.status === 'error' || d.status === 'failed')); i++) {
        await new Promise((r) => setTimeout(r, 500));
        d = find();
      }
      srv.close();
      if (!d) failures.push('engine: the download never finished or was lost');
      else if (d.status !== 'completed') failures.push(`engine: download ended as ${d.status}: ${String(d.error || d.statusMessage || '').slice(0, 200)}`);
      else {
        if (!d.didCheck || d.checkOk === false) failures.push(`engine: the file check did not pass (didCheck=${d.didCheck}, ok=${d.checkOk}, skip=${d.hashSkipReason || ''})`);
        if (!d.didExtract) failures.push('engine: the archive was not unpacked');
        let out = null;
        try { out = fs.readFileSync(path.join(root, 'downloads', name, 'payload.bin')); } catch (e) { }
        if (!out || !out.equals(payload)) failures.push('engine: the unpacked file is missing or differs from the original');
      }
    } catch (e) {
      failures.push(`engine test failed: ${e && e.message}`);
    }
    // The free-space box and the speed limit, as wired in the real app (2026-11-25): a pretend drive with 1 GB free must stop a 5 GB
    // download (the box answered by the test: Cancel, then Start anyway), and a saved limit must reach the shared bucket.
    try {
      const { checkBeforeStart } = require('./startSpace');
      const dir = path.join(app.getPath('userData'), 'smoke-space');
      const fsx = { ...fs, statfsSync: () => ({ bavail: 1024 * 1024 * 1024 / 4096, bsize: 4096 }) };
      const files = [{ name: 'big.bin', size: 5 * 1024 * 1024 * 1024 }];
      const asked = [];
      const no = await checkBeforeStart({ id: 'smoke', baseDir: dir, folderFor: (d) => path.join(d, 'Game'), files, unpack: false, fsx, ask: async (r) => { asked.push(r.short && r.short.required); return 'cancel'; } });
      const yes = await checkBeforeStart({ id: 'smoke', baseDir: dir, folderFor: (d) => path.join(d, 'Game'), files, unpack: false, fsx, ask: async () => 'anyway' });
      if (no.start || asked.length !== 1) failures.push(`space: a 5 GB download on a drive with 1 GB free was not stopped (start=${no.start}, asked=${asked.length})`);
      if (!yes.start || !yes.forced) failures.push('space: "Start anyway" did not start the download');
      const before = ctx.settings.maxDownloadSpeedMBps;
      ctx.settings.maxDownloadSpeedMBps = 7;
      const mbps = require('./speedLimit').applySpeedLimit('smoke');
      const rate = require('../speedLimiter').shared.rate;
      ctx.settings.maxDownloadSpeedMBps = before;
      require('./speedLimit').applySpeedLimit('smoke');
      if (mbps !== 7 || rate !== 7 * 1024 * 1024) failures.push(`speed limit: 7 MB/s did not reach the shared bucket (got ${mbps}, ${rate})`);
    } catch (e) {
      failures.push(`space/speed check failed: ${e && e.message}`);
    }
    // Let the UI settle so late renderer errors are caught too.
    await new Promise((r) => setTimeout(r, 3000));
    finish();
  })().catch((e) => { failures.push(`smoke runner crashed: ${e && e.message}`); finish(); });
}

module.exports = { runSmokeTest };
