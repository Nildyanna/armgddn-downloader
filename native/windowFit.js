'use strict';
// The window opens maximized (bridge.js). DMP, 2026-11-27, very wide screen: right after an update the window sometimes opened
// "full screen but way to the right", its right side cut off, until the app was closed and opened again. Whatever the cause
// (the screen's size or scaling not settled yet when the updater starts the app), the fix is the same: shortly after the window
// appears, a window that sticks out past its screen is put back to fill that screen. Every check is logged with the numbers.

const SLACK = 16;   // a maximized window on Windows hangs a few pixels past each edge; that is normal

// Does the window stick out past the usable part of its screen?
function sticksOut(b, wa, slack = SLACK) {
  if (!b || !wa) return false;
  return b.x < wa.x - slack || b.y < wa.y - slack
    || b.x + b.width > wa.x + wa.width + slack
    || b.y + b.height > wa.y + wa.height + slack;
}

const fmt = (r) => (r ? `${r.x},${r.y} ${r.width}x${r.height}` : '?');

// Checks the window once; fixes it when it sticks out. Returns true when it moved it.
function fitOnce(win, screen, log = () => { }, why = '') {
  try {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return false;
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    const wa = d.workArea;
    if (!sticksOut(b, wa)) return false;
    log(`[Window] ${why}: window ${fmt(b)} sticks out of its screen ${fmt(wa)} (scale ${d.scaleFactor}); fitting it`);
    const was = win.isMaximized();
    if (was) win.unmaximize();
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
    if (was) win.maximize();
    log(`[Window] now ${fmt(win.getBounds())}`);
    return true;
  } catch (e) {
    try { log('[Window] fit check failed: ' + (e && e.message)); } catch (e2) { }
    return false;
  }
}

// Watches a newly opened window: when it is first shown, twice more while the screen settles, and whenever a screen changes.
function watchFit(win, screen, log = () => { }, timers = { setTimeout }) {
  const check = (why) => () => fitOnce(win, screen, log, why);
  win.once('show', () => {
    try { const b = win.getBounds(); log(`[Window] shown at ${fmt(b)} on screen ${fmt(screen.getDisplayMatching(b).workArea)}`); } catch (e) { }
    check('shown')();
    timers.setTimeout(check('1.5 s after showing'), 1500);
    timers.setTimeout(check('5 s after showing'), 5000);
  });
  const onScreen = check('screen changed');
  try { screen.on('display-metrics-changed', onScreen); } catch (e) { }
  win.once('closed', () => { try { screen.removeListener('display-metrics-changed', onScreen); } catch (e) { } });
}

module.exports = { sticksOut, fitOnce, watchFit, SLACK };
