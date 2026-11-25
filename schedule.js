// Quiet hours: one weekly window during which downloads are paused or limited in speed.
// schedule = { enabled, days: [0..6] (0 = Sunday, the days the window STARTS on), start: 'HH:MM', end: 'HH:MM', action: 'pause' | 'limit', limitMBps }
// A window whose end is earlier than its start runs past midnight into the next day. Times are the PC's local time.

const DEFAULTS = { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '07:00', action: 'pause', limitMBps: 5 };

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? h * 60 + mi : null;
}

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULTS.days.slice();
  const start = parseHM(r.start) != null ? String(r.start).trim() : DEFAULTS.start;
  const end = parseHM(r.end) != null ? String(r.end).trim() : DEFAULTS.end;
  const limit = Math.round(Number(r.limitMBps));
  return {
    enabled: r.enabled === true,
    days: days.length ? days : DEFAULTS.days.slice(),
    start, end,
    action: r.action === 'limit' ? 'limit' : 'pause',
    limitMBps: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10000) : DEFAULTS.limitMBps,
  };
}

// The window that applies at `date`: { action, limitMBps, endsAt (Date) } or null.
function activeWindow(raw, date = new Date()) {
  const s = normalize(raw);
  if (!s.enabled) return null;
  const a = parseHM(s.start), b = parseHM(s.end);
  if (a === b) return null;                                     // an empty window
  const now = date.getHours() * 60 + date.getMinutes();
  const today = date.getDay();
  const yesterday = (today + 6) % 7;
  let inWindow = false, endsAt = null;
  if (a < b) {                                                  // same-day window
    if (s.days.includes(today) && now >= a && now < b) { inWindow = true; endsAt = new Date(date); endsAt.setHours(Math.floor(b / 60), b % 60, 0, 0); }
  } else {                                                      // past midnight
    if (s.days.includes(today) && now >= a) { inWindow = true; endsAt = new Date(date); endsAt.setDate(endsAt.getDate() + 1); endsAt.setHours(Math.floor(b / 60), b % 60, 0, 0); }
    else if (s.days.includes(yesterday) && now < b) { inWindow = true; endsAt = new Date(date); endsAt.setHours(Math.floor(b / 60), b % 60, 0, 0); }
  }
  return inWindow ? { action: s.action, limitMBps: s.limitMBps, endsAt } : null;
}

// The speed limit that applies now: the member's own limit and the window's limit, whichever is lower (0 = no limit).
function effectiveLimitMBps(userLimit, raw, date = new Date()) {
  const own = Number(userLimit) > 0 ? Number(userLimit) : 0;
  const w = activeWindow(raw, date);
  if (!w || w.action !== 'limit') return own;
  return own > 0 ? Math.min(own, w.limitMBps) : w.limitMBps;
}

// The member's own limit can be set to apply only between two times, every day (Settings > Download speed limit, "only between").
// limitHours = { enabled, start: 'HH:MM', end: 'HH:MM' }; an end earlier than the start runs past midnight. Off (or start = end) = all day.
const LIMIT_HOURS_DEFAULTS = { enabled: false, start: '08:00', end: '23:00' };
function normalizeLimitHours(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    start: parseHM(r.start) != null ? String(r.start).trim() : LIMIT_HOURS_DEFAULTS.start,
    end: parseHM(r.end) != null ? String(r.end).trim() : LIMIT_HOURS_DEFAULTS.end,
  };
}
function ownLimitApplies(limitHours, date = new Date()) {
  const h = normalizeLimitHours(limitHours);
  if (!h.enabled) return true;
  const a = parseHM(h.start), b = parseHM(h.end);
  if (a === b) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  return a < b ? (now >= a && now < b) : (now >= a || now < b);
}

// Everything together, as the download engines use it: the member's limit (inside its hours) and the quiet-hours limit, lower wins.
function currentLimitMBps(settings, date = new Date()) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const own = ownLimitApplies(s.speedLimitHours, date) ? s.maxDownloadSpeedMBps : 0;
  return effectiveLimitMBps(own, s.schedule, date);
}

// "7:00 AM" in the PC's local format.
function formatTime(date) {
  let h = date.getHours(); const m = date.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

module.exports = { DEFAULTS, normalize, activeWindow, effectiveLimitMBps, formatTime, parseHM, LIMIT_HOURS_DEFAULTS, normalizeLimitHours, ownLimitApplies, currentLimitMBps };
