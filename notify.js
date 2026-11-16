// Desktop notifications on Linux go through the "notify-send" program, in a separate process, instead of Electron's own Notification.
// Electron's version calls libnotify inside the app, and on some desktops (Sentry ARMGDDN-COMPANION-60 and -61: Nobara/Fedora 44 with KDE
// Plasma) libnotify aborts the whole process with SIGABRT the moment a notification is shown. A child process cannot take the app down.
const { execFile } = require('child_process');

// The AppImage points LD_LIBRARY_PATH and friends at its own libraries; notify-send must use the system's.
function cleanEnv(env = process.env) {
  const out = { ...env };
  for (const k of ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete out[k];
  return out;
}

// Returns true when a notification was handed to notify-send; never throws, never blocks.
function linuxNotify(title, body, run = execFile, env = process.env) {
  try {
    const args = ['--app-name=ARMGDDN Companion', '--expire-time=8000', '--', String(title || '').slice(0, 120), String(body || '').slice(0, 400)];
    run('notify-send', args, { env: cleanEnv(env), timeout: 5000 }, () => { /* notify-send missing or no daemon: nothing to do */ });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { linuxNotify, cleanEnv };
