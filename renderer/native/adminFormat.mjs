// Pure helpers for the Admin pages (no screen code, so they are tested on their own).

export function labelOf(key) {
  return String(key == null ? '' : key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatUptime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const m = Math.floor(n / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export function formatCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('en-US') : '';
  if (typeof v === 'string') {
    if (ISO.test(v)) { const d = new Date(v); if (!isNaN(d)) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    return v.length > 90 ? v.slice(0, 87) + '...' : v;
  }
  if (Array.isArray(v)) return v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? v.map(formatCell).join(', ') : v.length + ' items';
  return '';
}

// Columns for a list of records: the keys that hold plain values, in the order first seen, at most `max`.
export function tableColumns(rows, max = 8) {
  const seen = [];
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) {
      if (seen.includes(k)) continue;
      const v = r[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue;
      seen.push(k);
    }
  }
  return seen.slice(0, max);
}

// Which pages this member may open. The server decides what it really returns; this only decides which tabs to show.
export function adminTabs(role, canManage) {
  const tabs = [];
  if (role === 'owner' || role === 'admin') tabs.push(['overview', 'Overview'], ['analytics', 'Analytics'], ['collections', 'Music and Comics']);
  if (role === 'owner') tabs.push(['system', 'System'], ['activity', 'Activity'], ['missing', 'Missing art'], ['ipbans', 'IP bans'], ['access', 'Access'], ['controls', 'Controls']);
  if (canManage) tabs.push(['queue', 'Queue'], ['requests', 'Requests'], ['audit', 'Audit']);
  return tabs;
}

// The summary cards of the Overview page, from the site's /api/admin/stats answer.
export function statCards(s) {
  if (!s || typeof s !== 'object') return [];
  const o = s.overhead || {}, c = s.concurrency || {}, a = s.api || {};
  const out = [];
  const add = (label, value, hint) => { if (value !== undefined && value !== null && value !== '') out.push({ label, value: typeof value === 'number' ? value.toLocaleString('en-US') : String(value), hint: hint || '' }); };
  add('Uptime', formatUptime(s.uptimeMs), s.uptimeAllTimeMs ? 'all time ' + formatUptime(s.uptimeAllTimeMs) : '');
  add('Load', o.level, o.eventLoopMeanMs != null ? `event loop ${o.eventLoopMeanMs} ms mean, ${o.eventLoopP99Ms || 0} ms p99` : '');
  add('Memory', o.rssMb != null ? o.rssMb + ' MB' : '', '');
  add('Active streams', c.activeTotalStreams, c.maxGlobalRcloneStreams != null ? 'limit ' + c.maxGlobalRcloneStreams : '');
  add('Users streaming', c.userActiveStreamsUsers, '');
  add('Waiting in queue', c.globalStreamQueueLength, c.peaksSinceBoot ? 'peak ' + c.peaksSinceBoot.globalStreamQueueLength : '');
  add('Held redirects', c.heldRedirectCount, '');
  add('App queue', c.appQueuedDownloads, '');
  add('Unique downloads', a.uniqueDownloads, '');
  if (a.auth) add('Logins', a.auth.success, (a.auth.failure || 0) + ' failed');
  return out;
}

export function remoteRows(s) {
  return ((s && s.remotes) || []).map((r) => ({ name: r.name, status: r.status, lastChecked: r.lastStatusAt || '', lastError: r.lastError || '', failures: r.errorDetail ? r.errorDetail.failureCount : 0 }));
}

// Requests for the Requests page, or only the handled ones (with who handled them) for the Audit page.
export function requestRows(list, { audit = false, processedBy = '' } = {}) {
  let rows = (list || []).filter((r) => r && !r.linkedTo);
  if (audit) rows = rows.filter((r) => r.processedBy);
  if (processedBy) rows = rows.filter((r) => r.processedBy === processedBy);
  return rows.map((r) => ({ id: r.id, title: r.gameTitle || r.title || '', by: r.username || '', category: r.category || '', status: r.status || '', requested: r.createdAt || '', handledBy: r.processedBy || '', handledAt: r.processedAt || '', votes: r.popularity || 1 }));
}

// Games with no cover and/or no trailer (the site's missing-covers answer): the summary cards and the rows, filtered by what is missing and by a search.
export function missingCards(d) {
  if (!d || typeof d !== 'object') return [];
  return [
    { label: 'Missing a cover', value: Number(d.count || 0).toLocaleString('en-US'), hint: '' },
    { label: 'Missing a trailer', value: Number(d.trailerCount || 0).toLocaleString('en-US'), hint: Number(d.trailerUnavailableCount) ? d.trailerUnavailableCount + ' marked unavailable' : '' },
    { label: 'Games in the library', value: Number(d.totalUniqueGames || 0).toLocaleString('en-US'), hint: '' },
  ];
}
export function missingRows(d, { what = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return ((d && d.gamesWithStatus) || [])
    .filter((g) => g && (what === 'cover' ? g.missingCover : what === 'trailer' ? g.missingTrailer : true))
    .filter((g) => !q || String(g.cleanTitle || '').toLowerCase().includes(q) || String(g.gameKey || '').toLowerCase().includes(q))
    .map((g) => ({ title: g.cleanTitle || g.gameKey, folder: g.gameKey, cover: g.missingCover ? 'Missing' : 'Has one', trailer: g.missingTrailer ? 'Missing' : 'Has one' }));
}

export const REQUEST_STATUS_CHOICES = ['pending', 'approved', 'rejected', 'completed', 'duplicate'];

// What the member is asked to confirm before an admin action runs. Every action has one; the wording says what will happen and what it cannot undo.
export function confirmText(action, a = {}) {
  switch (action) {
    case 'resetQuota': return { title: 'Reset mirror quota', text: 'Mark every PC and PCVR mirror as available again, even if the storage provider is still limiting downloads. Members may hit errors if a mirror really is at its limit.', ok: 'Reset all mirrors' };
    case 'restartServer': return { title: 'Restart the server', text: 'The website restarts now. Everyone is disconnected for about a minute, and downloads in progress on the site side are interrupted. This app will show errors until it is back.', ok: 'Restart the server' };
    case 'banIp': return { title: 'Ban an IP address', text: `Ban ${a.ip || 'this address'}. Anyone on it is blocked from the site, and the other admins get a Telegram alert.`, ok: 'Ban it' };
    case 'unbanIp': return { title: 'Unban an IP address', text: `Let ${a.ip || 'this address'} use the site again.`, ok: 'Unban it' };
    case 'requestStatus': return { title: 'Change a request', text: `Set request ${a.id} (${a.title || 'untitled'}) to "${a.status}". The member who asked may be told.`, ok: 'Change it' };
    case 'clearMissing': return { title: 'Stop listing a game', text: `Mark "${a.title || a.gameKey}" as having no cover or trailer available, so it stops showing in the missing list and future checks do not add it back.`, ok: 'Mark it' };
    default: return null;
  }
}

// ---- Analytics report (the site's /api/admin/report-data) ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const DOW_LABELS = DOW;

export function analyticsCards(d) {
  const h = (d && d.headline) || {}, g = (d && d.growth) || {};
  const out = [];
  const add = (label, value, hint) => { if (value !== undefined && value !== null) out.push({ label, value: num(value).toLocaleString('en-US'), hint: hint || '' }); };
  add('Downloads, all time', h.totalEvents); add('Downloads today', h.today); add('This week', h.thisWeek); add('This month', h.thisMonth);
  add('Members who downloaded', h.totalUsers); add('Active in 7 days', h.users7d); add('Active in 30 days', h.users30d);
  add('Titles downloaded', h.catalogTotal, h.catalog30d != null ? num(h.catalog30d).toLocaleString('en-US') + ' in the last 30 days' : '');
  if (h.redownloadRate != null) out.push({ label: 'Re-download rate', value: num(h.redownloadRate) + '%', hint: '' });
  if (g.retentionBase) out.push({ label: '30-day retention', value: Math.round(100 * num(g.retentionReturned) / num(g.retentionBase)) + '%', hint: num(g.retentionReturned) + ' of ' + num(g.retentionBase) + ' came back' });
  return out;
}
export function dailySeries(rows) { const r = rows || []; return { labels: r.map((x) => String(x.day || '').slice(5)), values: r.map((x) => num(x.downloads)) }; }
export function weeklySeries(rows) { const r = rows || []; return { labels: r.map((x) => String(x.week || '')), values: r.map((x) => num(x.downloads)) }; }
export function newUsersSeries(rows, key) { const r = rows || []; return { labels: r.map((x) => String(x[key] || '')), values: r.map((x) => num(x.newUsers)) }; }
export function hourSeries(rows) { const by = new Map((rows || []).map((x) => [num(x.hour), num(x.n)])); const labels = [], values = []; for (let h = 0; h < 24; h++) { labels.push(String(h)); values.push(by.get(h) || 0); } return { labels, values }; }
export function dowSeries(rows) { const by = new Map((rows || []).map((x) => [num(x.dow), num(x.n)])); return { labels: DOW.slice(), values: DOW.map((_, i) => by.get(i) || 0) }; }
export function heatmapGrid(rows) {
  const grid = DOW.map(() => Array(24).fill(0)); let max = 0;
  for (const r of rows || []) { const d = num(r.dow), h = num(r.hour); if (d >= 0 && d < 7 && h >= 0 && h < 24) { grid[d][h] = num(r.n); if (grid[d][h] > max) max = grid[d][h]; } }
  return { grid, max };
}
export function loyaltyRows(t) {
  const x = t || {};
  return [['1 download', x.t1], ['2 to 5', x.t2], ['6 to 10', x.t3], ['11 to 25', x.t4], ['More than 25', x.t5]].map(([label, n]) => ({ label, n: num(n) }));
}
export function topRows(list, labelKey, valueKey, limit = 25) {
  const rows = (list || []).slice(0, limit).map((x) => ({ label: String(x[labelKey] || ''), value: num(x[valueKey]) }));
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return rows.map((r) => ({ ...r, pct: max ? Math.round(100 * r.value / max) : 0 }));
}
export function moverRows(list) { return (list || []).map((x) => ({ title: x.title, now: num(x.recent_n), before: num(x.prior_n), change: (num(x.pct_change) > 0 ? '+' : '') + num(x.pct_change) + '%' })); }

// ---- Music and Comics section (the site's /api/admin/report-collections) ----
export function collectionCards(o, kind) {
  if (!o || typeof o !== 'object') return [];
  const unit = kind === 'Music' ? 'albums' : 'issues';
  const out = [];
  const add = (label, v, hint) => { if (v !== undefined && v !== null) out.push({ label, value: num(v).toLocaleString('en-US'), hint: hint || '' }); };
  add('Downloaded today', o.today, unit); add('Last 7 days', o.d7, unit); add('Last 30 days', o.d30, unit); add('All time', o.allTime, unit);
  add('Members, 30 days', o.users30d); add('Members, all time', o.usersAll); add('Members who came back', o.repeatUsers);
  if (o.itemsPerAction) add('Per download', o.itemsPerAction, unit);
  if (o.tracks) add('Tracks, 30 days', o.tracks.d30, 'all time ' + num(o.tracks.allTime).toLocaleString('en-US'));
  return out;
}
export function collectionDaily(o) { const r = (o && o.daily) || []; return { labels: r.map((x) => String(x.day || '').slice(5)), values: r.map((x) => num(x.items)) }; }
export function arraySeries(arr, labels) { return { labels: labels.slice(), values: labels.map((_, i) => num((arr || [])[i])) }; }
export function requestsSummary(rows) {
  const by = {};
  for (const r of rows || []) { const c = r.category || 'Other'; (by[c] = by[c] || {})[r.status || 'unknown'] = num(r.n); }
  return Object.entries(by).flatMap(([category, st]) => Object.entries(st).map(([status, n]) => ({ category, status, requests: n })));
}
