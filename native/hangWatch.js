'use strict';
// A window that stops answering (or whose page process dies) used to leave no trace in debug.log. This writes down what happened, with memory and
// processor figures, and reloads the page by itself when it has been frozen for a while, so a long-running app does not stay locked up.
const FROZEN_MS = 20000;

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
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`[Hang] ${name} page process gone: ${d && d.reason} (exit ${d && d.exitCode}). ${figures()}`);
    if (d && d.reason !== 'clean-exit' && d.reason !== 'killed' && !gone()) { try { win.webContents.reload(); } catch (e) { } }
  });
  win.on('closed', () => clearT(timer));
}

module.exports = { watchWindow, FROZEN_MS };
