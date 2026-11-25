'use strict';
// Open folder through the member's default file manager (DMP, Nov 25 2026). On Windows, Electron's shell.openPath opens folders with the
// "explore" verb, which always starts File Explorer and skips a replacement such as Directory Opus or Files. Start-Process uses the
// folder's default verb, so whatever the member set as default opens it. The folder goes in through an environment variable, so no
// path is ever parsed as PowerShell. If that fails, the old shell.openPath is used. Other systems keep shell.openPath (xdg-open / Finder).
const { spawn } = require('child_process');

function folderOpenSpec(dir, platform) {
  if (platform !== 'win32' || !dir) return null;
  return {
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', 'Start-Process -LiteralPath $env:ARMGDDN_OPEN_DIR'],
    env: { ARMGDDN_OPEN_DIR: String(dir) },
  };
}

function openFolderDefault(dir, deps = {}) {
  const platform = deps.platform || process.platform;
  const shell = deps.shell || require('electron').shell;
  const run = deps.spawn || spawn;
  const spec = folderOpenSpec(dir, platform);
  if (!spec) return Promise.resolve(shell.openPath(dir)).then(() => 'shell');
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => { if (done) return; done = true; Promise.resolve(shell.openPath(dir)).catch(() => { }).then(() => resolve('shell')); };
    try {
      const child = run(spec.cmd, spec.args, { env: { ...process.env, ...spec.env }, windowsHide: true, stdio: 'ignore' });
      child.on('error', fallback);
      child.on('exit', (code) => { if (code === 0) { if (!done) { done = true; resolve('default'); } } else fallback(); });
    } catch (e) { fallback(); }
  });
}

module.exports = { folderOpenSpec, openFolderDefault };
