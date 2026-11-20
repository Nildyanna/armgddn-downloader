'use strict';
// Speed (bytes/s) over the last 60 seconds of overall progress, and the time left at that speed. etaSec is null until there is a measurable rate, and
// when the answer would be longer than 30 days (a stalled or just-started download should say nothing rather than something absurd).
function rateEstimate(download, bytesSoFar, total, now) {
  const WINDOW_MS = 60 * 1000, MIN_SPAN_MS = 4000, MAX_ETA_S = 30 * 86400;
  const s = download.__rateSamples || (download.__rateSamples = []);
  const last = s[s.length - 1];
  if (!last || now - last.t >= 1000) s.push({ t: now, b: bytesSoFar });
  while (s.length > 2 && now - s[0].t > WINDOW_MS) s.shift();
  const first = s[0], end = s[s.length - 1];
  const span = end.t - first.t;
  const speed = span >= MIN_SPAN_MS ? Math.max(0, (end.b - first.b) / (span / 1000)) : 0;
  if (!(speed > 0) || !(total > 0)) return { speed, etaSec: null };
  const eta = Math.max(0, total - bytesSoFar) / speed;
  return { speed, etaSec: eta > 0 && eta <= MAX_ETA_S ? eta : (eta === 0 ? 0 : null) };
}

module.exports = { rateEstimate };
