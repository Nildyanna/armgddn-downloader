'use strict';
// Keeps the shared speed-limit bucket (../speedLimiter.js) at the limit that applies right now: Settings > Download speed limit, its
// "only between" hours, and the quiet-hours limit, whichever is lower (../schedule.js currentLimitMBps). Called when settings are saved
// and by the quiet-hours ticker, so a change reaches running downloads within seconds and nothing is restarted (2026-11-25).
const ctx = require('./context');
const scheduleLib = require('../schedule');
const { shared, mbpsToBytes } = require('../speedLimiter');
const { logToFile } = require('./log');

let lastMbps = null;
function applySpeedLimit(reason, date = new Date()) {
  const mbps = scheduleLib.currentLimitMBps(ctx.settings, date);
  shared.setRate(mbpsToBytes(mbps));
  if (mbps !== lastMbps) {
    if (lastMbps !== null || mbps > 0) logToFile(`[speed-limit] now ${mbps > 0 ? mbps + ' MB/s for all downloads together' : 'unlimited'} (${reason || 'tick'})`);
    lastMbps = mbps;
  }
  return mbps;
}

module.exports = { applySpeedLimit };
