'use strict';
// Operating-system integration: the Linux armgddn:// link handler (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const { logToFile } = require('./log');
const { quoteDesktopExecArg } = require('./util');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureLinuxProtocolDesktopHandler() {
  try {
    if (process.platform !== 'linux') return;

    const desktopFileName = 'armgddn-downloader.desktop';
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const appsDir = path.join(dataHome, 'applications');
    fs.mkdirSync(appsDir, { recursive: true });

    const desktopPath = path.join(appsDir, desktopFileName);
    // In AppImage builds, process.execPath can be a transient mount path under /tmp/.mount_*.
    // Prefer the stable AppImage file path when available so the protocol handler can launch
    // the app even when it's not already running.
    const appImagePath = process.env.APPIMAGE ? String(process.env.APPIMAGE) : '';
    const execPath = appImagePath || process.execPath;
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ARMGDDN Companion',
      `Exec=${quoteDesktopExecArg(execPath)} %u`,
      'Terminal=false',
      'NoDisplay=true',
      'MimeType=x-scheme-handler/armgddn;',
      'Categories=Utility;'
    ].join('\n') + '\n';

    let existing = '';
    try {
      existing = fs.readFileSync(desktopPath, 'utf8');
    } catch (e) { }
    if (existing !== content) {
      const prevExec = (existing.match(/^Exec=(.*) %u$/m) || [])[1];
      if (prevExec) logToFile(`[Protocol][linux] armgddn:// handler path changed: ${prevExec} -> ${quoteDesktopExecArg(execPath)}`);
      fs.writeFileSync(desktopPath, content, 'utf8');
      try { fs.chmodSync(desktopPath, 0o644); } catch (e) { }
    }

    const tryCmd = (cmd, args) => {
      try {
        const res = spawnSync(cmd, args, { encoding: 'utf8' });
        const ok = res && typeof res.status === 'number' ? res.status === 0 : false;
        const out = (res && res.stdout) ? String(res.stdout).trim() : '';
        const err = (res && res.stderr) ? String(res.stderr).trim() : '';
        return { ok, out, err, status: res ? res.status : null };
      } catch (e) {
        return { ok: false, out: '', err: e && e.message ? e.message : String(e), status: null };
      }
    };

    let registered = false;

    const gioRes = tryCmd('gio', ['mime', 'x-scheme-handler/armgddn', desktopFileName]);
    if (gioRes.ok) {
      registered = true;
    } else {
      const xdgMimeRes = tryCmd('xdg-mime', ['default', desktopFileName, 'x-scheme-handler/armgddn']);
      if (xdgMimeRes.ok) {
        registered = true;
      } else {
        const xdgSettingsRes = tryCmd('xdg-settings', ['set', 'default-url-scheme-handler', 'armgddn', desktopFileName]);
        if (xdgSettingsRes.ok) {
          registered = true;
        }
      }
    }

    logToFile(`[Protocol][linux] desktop=${desktopPath} exec=${execPath} registered=${registered}`);
    const sysDefault = tryCmd('xdg-mime', ['query', 'default', 'x-scheme-handler/armgddn']);
    logToFile(`[Protocol][linux] system default for armgddn:// is "${sysDefault.out || '(none)'}"${sysDefault.out && sysDefault.out !== desktopFileName ? ' (NOT this app)' : ''}`);
    if (!registered) {
      logToFile(`[Protocol][linux] gio mime: ok=${gioRes.ok} status=${gioRes.status} err=${gioRes.err}`);
    }
  } catch (e) {
    logToFile(`[Protocol][linux] ensure handler failed: ${e && e.message ? e.message : e}`);
  }
}

module.exports = { ensureLinuxProtocolDesktopHandler };
