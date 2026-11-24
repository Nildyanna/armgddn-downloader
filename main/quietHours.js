'use strict';
// Quiet hours: the ticker that pauses or slows downloads at the set times (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const scheduleLib = require('../schedule');
const { scheduleActiveStates } = require('./downloadState');
const { logToFile } = require('./log');

function pushScheduleState() {
  try {
    const w = scheduleLib.activeWindow(ctx.settings.schedule);
    const text = !w ? '' : (w.action === 'pause'
      ? `Downloads are paused by your quiet hours until ${scheduleLib.formatTime(w.endsAt)}.`
      : `Downloads are limited to ${w.limitMBps} MB/s by your quiet hours until ${scheduleLib.formatTime(w.endsAt)}.`);
    if (text !== ctx.lastScheduleBanner) {
      ctx.lastScheduleBanner = text;
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) ctx.mainWindow.webContents.send('schedule-banner', text);
    }
  } catch (e) { }
}

function scheduleTick() {
  try {
    const w = scheduleLib.activeWindow(ctx.settings.schedule);
    pushScheduleState();
    if (w && w.action === 'pause') {
      for (const [id, d] of ctx.activeDownloads) {
        if (!d.paused && scheduleActiveStates().includes(d.status)) {
          d.pausedBySchedule = true;
          logToFile(`[schedule] pausing ${id} for quiet hours until ${scheduleLib.formatTime(w.endsAt)}`);
          ctx.pauseDownloadById(id);
        }
      }
    } else {
      for (const [id, d] of ctx.activeDownloads) {
        if (!d.pausedBySchedule) continue;
        d.pausedBySchedule = false;
        if (d.paused) {
          logToFile(`[schedule] quiet hours ended: resuming ${id}`);
          ctx.resumeDownloadFiles(id).catch((e) => logToFile(`[schedule] resume of ${id} failed: ${e && e.message}`));
        }
      }
    }
    // a limit window began or ended: restart running downloads so they pick it up
    const lim = (w && w.action === 'limit') ? w.limitMBps : 0;      // only a limit window beginning or ending restarts running downloads
    if (ctx.lastScheduleLimit !== null && lim !== ctx.lastScheduleLimit && !(w && w.action === 'pause')) {
      for (const [id, d] of ctx.activeDownloads) {
        if (d.paused || !scheduleActiveStates().includes(d.status)) continue;
        logToFile(`[schedule] speed limit now ${lim || 'none'}: restarting ${id} to apply it`);
        d.pausedBySchedule = true;               // the next tick resumes it
        ctx.pauseDownloadById(id);
      }
    }
    ctx.lastScheduleLimit = lim;
  } catch (e) { logToFile(`[schedule] tick failed: ${e && e.message}`); }
}

function startScheduleTicker() { setInterval(scheduleTick, 15 * 1000); setTimeout(scheduleTick, 3000); }

module.exports = { pushScheduleState, scheduleTick, startScheduleTicker };
