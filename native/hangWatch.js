'use strict';
// A window that stops answering (or whose page process dies) used to leave no trace in debug.log. This writes down what happened, with memory and
// processor figures, and reloads the page by itself when it has been frozen for a while, so a long-running app does not stay locked up.
const FROZEN_MS = 20000;
const MAX_CRASH_RELOADS = 3;
const CRASH_RELOAD_WINDOW_MS = 2 * 60 * 1000;

function figures() {
  try {
    const m = process.getSystemMemoryInfo ? process.getSystemMemoryInfo() : {};
    const h = process.memoryUsage ? process.memoryUsage() : {};
    return `free ${Math.round((m.free || 0) / 1024)} MB of ${Math.round((m.total || 0) / 1024)} MB, main uses ${Math.round((h.rss || 0) / 1048576)} MB`;
  } catch (e) { return 'figures not available'; }
}

function watchWindow(win, log, name, opts = {}) {
  const frozenMs = opts.frozenMs || FROZEN_MS;
  const setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
  const metrics = opts.metrics || (() => { try { return require('electron').app.getAppMetrics(); } catch (e) { return []; } });
  let timer = null, since = 0;
  const gone = () => !win || (typeof win.isDestroyed === 'function' && win.isDestroyed());
  win.on('unresponsive', () => {
    since = Date.now();
    let top = '';
    try { top = metrics().map((p) => `${p.type}#${p.pid} cpu ${Math.round(p.cpu && p.cpu.percentCPUUsage || 0)}% mem ${Math.round(((p.memory && p.memory.workingSetSize) || 0) / 1024)} MB`).join('; '); } catch (e) { }
    log(`[Hang] ${name} window is not responding. ${figures()}. ${top}`);
    clearT(timer);
    timer = setT(() => {
      if (gone()) return;
      log(`[Hang] ${name} window still frozen after ${Math.round(frozenMs / 1000)} s; reloading its page`);
      try { win.webContents.reloadIgnoringCache(); } catch (e) { log('[Hang] reload failed: ' + e.message); }
    }, frozenMs);
  });
  win.on('responsive', () => {
    clearT(timer);
    if (since) log(`[Hang] ${name} window answers again after ${Math.round((Date.now() - since) / 1000)} s`);
    since = 0;
  });
  // A page process that dies is reloaded, but only a few times in a row: one that cannot start at all ('launch-failed', blocked by security
  // software; Sentry ARMGDDN-COMPANION-33) or crashes as soon as it loads would otherwise be restarted forever, burning the processor and
  // sending a crash report each time. The budget comes back once the page has stayed up for the window.
  const maxReloads = opts.maxReloads || MAX_CRASH_RELOADS;
  const reloadWindowMs = opts.reloadWindowMs || CRASH_RELOAD_WINDOW_MS;
  const now = opts.now || Date.now;
  let recentReloads = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`[Hang] ${name} page process gone: ${d && d.reason} (exit ${d && d.exitCode}). ${figures()}`);
    if (!d || d.reason === 'clean-exit' || d.reason === 'killed' || gone()) return;
    const t = now();
    recentReloads = recentReloads.filter((at) => t - at < reloadWindowMs);
    if (recentReloads.length >= maxReloads) {
      log(`[Hang] ${name} page died ${recentReloads.length + 1} times within ${Math.round(reloadWindowMs / 1000)} s; not reloading it again. Close and reopen the app.`);
      return;
    }
    recentReloads.push(t);
    try { win.webContents.reload(); } catch (e) { }
  });
  win.on('closed', () => clearT(timer));
}

module.exports = { watchWindow, FROZEN_MS, MAX_CRASH_RELOADS, CRASH_RELOAD_WINDOW_MS };
