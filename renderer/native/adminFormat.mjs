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
  if (typeof v === 'number' && v > 946684800000 && v < 4102444800000) return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('en-US') : '';
  if (typeof v === 'string') {
    if (ISO.test(v)) { const d = new Date(v); if (!isNaN(d)) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    return v.length > 90 ? v.slice(0, 87) + '...' : v;
  }
  if (Array.isArray(v)) return v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? v.map(formatCell).join(', ') : v.length + ' items';
  return '';
}

// Cell text that knows what the column is: sizes in bytes read as 120 GB, years and decades carry no thousands comma.
export function formatCellFor(key, v, hint) {
  const k = String(key || ''), h = String(hint || '');
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (/(bytes|size)$/i.test(k) || (k === 'value' && /(size|bytes)/i.test(h))) return fmtBytes(v);
    if (/^decades?$/i.test(k)) return v + 's';
    if (/^years?$/i.test(k)) return String(v);
  }
  return formatCell(v);
}

// The 8 weekly pass/fail counts of the testing report: entry 0 is the week ending now. Says which weeks they are.
export function weekRows(list, now = Date.now()) {
  const day = 86400000, fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (list || []).map((w, i) => ({ week: i === 0 ? 'This week' : i === 1 ? 'Last week' : i + ' weeks ago', dates: fmt(now - (i + 1) * 7 * day + day) + ' - ' + fmt(now - i * 7 * day), pass: w && w.pass || 0, fail: w && w.fail || 0 }));
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
  if (role === 'owner' || role === 'admin') tabs.push(['overview', 'Overview'], ['analytics', 'Analytics'], ['collections', 'Music and Comics'], ['reliability', 'Reliability']);
  if (role === 'owner') tabs.push(['system', 'System'], ['activity', 'Activity'], ['missing', 'Missing art'], ['ipbans', 'IP bans'], ['access', 'Access'], ['console', 'Console'], ['controls', 'Controls']);
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

export const fmtBytes = (n) => { n = Number(n) || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n >= 100 ? 0 : 1) : String(n)) + ' ' + u[i]; };

// The site panel's Usage cards: total requests, downloads and the download cache, each with its all-time figure where the site has one.
export function usageCards(s) {
  if (!s || typeof s !== 'object') return [];
  const a = s.api || {}, t = s.apiAllTime || null;
  const sum = (x) => (x.browseRequests || 0) + (x.remotesRequests || 0) + (x.downloadManifestRequests || 0);
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const out = [{ label: 'Total requests', value: n(sum(a)), hint: t ? 'all time ' + n(sum(t)) : '' }];
  out.push({ label: 'Downloads', value: n(a.uniqueDownloads), hint: (t ? 'all time ' + n(t.uniqueDownloads) + ' - ' : '') + 'tokens / direct' });
  const c = s.downloadCache;
  if (c && c.enabled) out.push({ label: 'Download cache', value: fmtBytes(c.totalBytes), hint: 'max ' + (c.maxBytes ? fmtBytes(c.maxBytes) : 'unlimited') + ', entries ' + (c.totalEntries || 0) + ', active ' + (c.activeEntries || 0) + (c.pendingReset && c.activeEntries > 0 ? ', cooling down' : '') });
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
  return rows.map((r) => ({ id: r.id, title: r.gameTitle || r.title || '', by: r.username || '', category: r.category || '', status: r.status || '', requested: r.createdAt || '', handledBy: r.processedBy || '', handledAt: r.processedAt || '', votes: r.popularity || 1, raw: r }));
}

// What a request card shows, the same as the website's request list: the popularity flame, NEW/UPDATE, the possible-game flag, who asked (and how many others),
// the folder it already has, the Steam link, the notes, the decision reason and the unseen-comment count. `warn` is the /warn line the Copy /warn button copies.
export function requestCard(r, { hideSystem = false } = {}) {
  r = r && typeof r === 'object' ? r : {};
  const id = r.telegramId || r.userId;
  const who = /^\d+$/.test(String(id || '')) ? String(id) : '';
  const handle = r.username ? '@' + String(r.username).replace(/^@/, '') : (id != null && id !== '' ? 'id: ' + id : 'Unknown');
  const pop = Number(r.popularity) || 1;
  const others = Array.isArray(r.allRequesters) ? r.allRequesters.map((x) => x && (x.username || x.userId) ? '@' + (x.username || x.userId) : '').filter(Boolean) : [];
  const unread = Number(hideSystem ? r.unreadNonSystemCount : r.unreadCount) || 0;
  return {
    id: r.id, title: r.gameTitle || r.title || '', category: r.category || '', status: r.status || 'pending', date: r.createdAt || '',
    isUpdate: r.requestType === 'update', pop, others: pop > 1 ? others : [], extra: Math.max(0, pop - 1), handle, who,
    possible: typeof r.possibleGame === 'string' ? r.possibleGame : '', existing: r.existingFolder || '', url: /^https:\/\//i.test(String(r.gameUrl || '')) ? String(r.gameUrl) : '',
    notes: r.notes || '', reason: r.decisionReason || '', unread,
    warn: who ? '/warn ' + who + ' Filing a game as a ' + (r.category || 'Music') + ' request to get around the closed game requests.' : '',
  };
}

// Everything the member put in the request, as label/value pairs for the first entry of its comment thread (empty fields are left out).
export function requestInfoLines(r) {
  if (!r || typeof r !== 'object') return [];
  const when = (iso) => { try { return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const names = Array.isArray(r.allRequesters) ? r.allRequesters.map((x) => x && x.username ? '@' + x.username : '').filter(Boolean) : [];
  const rows = [
    ['Title', r.gameTitle || r.title],
    ['Link', r.gameUrl],
    ['Steam app', r.steamAppId],
    ['Category', r.category],
    ['Type', r.requestType],
    ['Existing folder', r.existingFolder],
    ['Notes', r.notes],
    ['Requested by', [r.username ? '@' + r.username : '', when(r.createdAt)].filter(Boolean).join(' · ')],
    ['Status', r.status],
    ['Asked for by', names.length > 1 ? names.length + ' members: ' + names.slice(0, 20).join(', ') : ''],
    ['Possible match', typeof r.possibleGame === 'string' ? r.possibleGame : ''],
    ['Staff notes', r.adminNotes],
    ['Handled by', [r.processedBy, when(r.processedAt)].filter(Boolean).join(' · ')],
  ];
  return rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v)]);
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

// Confirmed by the app in a system dialog (see native/bridge.js), not by the page: the actions that change the site for everyone.
export const NATIVE_CONFIRMED = ['restartServer', 'resetQuota', 'resetApiStats', 'resetDownloadCache', 'refetchArt', 'autofixArt', 'banIp', 'unbanIp', 'banUser', 'accessAdd', 'accessRemove', 'requestDelete'];
export const REQUEST_STATUS_CHOICES = ['pending', 'approved', 'rejected', 'completed', 'duplicate'];

// What the member is asked to confirm before an admin action runs. Every action has one; the wording says what will happen and what it cannot undo.
export function confirmText(action, a = {}) {
  switch (action) {
    case 'resetQuota': return { title: 'Reset mirror quota', text: 'Mark every PC and PCVR mirror as available again, even if the storage provider is still limiting downloads. Members may hit errors if a mirror really is at its limit.', ok: 'Reset all mirrors' };
    case 'restartServer': return { title: 'Restart the server', text: 'The website restarts now. Everyone is disconnected for about a minute, and downloads in progress on the site side are interrupted. This app will show errors until it is back.', ok: 'Restart the server' };
    case 'autofixArt': return { title: 'Auto-fix covers', text: 'Look up every game that is missing a cover on Steam and fill in what can be found. It can take a minute, and games where Steam has no trailer are marked as having none.', ok: 'Run it' };
    case 'resetApiStats': return { title: 'Reset the usage numbers', text: 'Set the request and download counts, current and all-time, back to zero. They fill up again with new traffic. This cannot be undone.', ok: 'Reset them' };
    case 'resetDownloadCache': return { title: 'Reset the download cache', text: 'Delete every cached file on the site. Downloads in progress finish first. Files are fetched again the next time someone asks for them.', ok: 'Reset it' };
    case 'banIp': return { title: 'Ban an IP address', text: `Ban ${a.ip || 'this address'}. Anyone on it is blocked from the site, and the other admins get a Telegram alert.`, ok: 'Ban it' };
    case 'unbanIp': return { title: 'Unban an IP address', text: `Let ${a.ip || 'this address'} use the site again.`, ok: 'Unban it' };
    case 'requestStatus': return { title: 'Change a request', text: `Set request ${a.id} (${a.title || 'untitled'}) to "${a.status}". The member who asked may be told.`, ok: 'Change it' };
    case 'requestDelete': return { title: 'Delete a request', text: `Delete request ${a.id} (${a.title || 'untitled'}) for good. This cannot be undone.`, ok: 'Delete it' };
    case 'clearMissing': return { title: 'Stop listing a game', text: `Mark "${a.title || a.gameKey}" as having no cover or trailer available, so it stops showing in the missing list and future checks do not add it back.`, ok: 'Mark it' };
    case 'accessAdd': return { title: 'Give admin access', text: `Add ${a.id} to the ${a.list === 'channel' ? 'full admin' : 'request admin'} list. They can use the admin pages (${a.list === 'channel' ? 'all of them except the owner-only ones' : 'requests only'}) from their next visit.`, ok: 'Add them' };
    case 'accessRemove': return { title: 'Remove admin access', text: `Take ${a.id} off the ${a.list === 'channel' ? 'full admin' : 'request admin'} list.`, ok: 'Remove them' };
    case 'banUser': return { title: 'Ban a member by Telegram id', text: `Ban every IP address that Telegram id ${a.telegramId} has used. Other members on those addresses are blocked too, and the admins get a Telegram alert.`, ok: 'Ban them' };
    case 'refetchArt': return { title: a.force ? 'Force re-fetch ALL game art' : 'Re-fetch all game art', text: (a.force ? 'Throws away the stored art entry of every game and fetches it again from Steam and SteamGridDB. ' : 'Looks every game up again on Steam and SteamGridDB and updates what changed. ') + 'It runs on the server for a long time (every title in the library), makes thousands of requests to those services and can briefly slow the site. Only one run at a time.', ok: a.force ? 'Force re-fetch everything' : 'Start the re-fetch' };
    case 'reloadOverrides': return { title: 'Reload the art overrides', text: 'Re-read the override list now and clear the browse cache so changes show up without restarting the site.', ok: 'Reload' };
    case 'addCover': return { title: 'Set a cover', text: `Use this picture as the cover for "${a.title || a.gameKey}": ${a.coverUrl}`, ok: 'Set the cover' };
    case 'addTrailer': return { title: 'Set a trailer', text: `Use this YouTube video as the trailer for "${a.title || a.gameKey}": ${a.trailerYoutube}`, ok: 'Set the trailer' };
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
// Members: the @name when they have one, otherwise their Telegram ID. `copy` is what a click puts on the clipboard (handy for messaging them).
export function userRows(list, valueKey, limit = 25) {
  const rows = (list || []).slice(0, limit).map((x) => {
    const handle = String(x.username || '').replace(/^@/, '').trim();
    const label = handle ? '@' + handle : String(x.userId == null ? '' : x.userId);
    return { label, copy: label, value: num(x[valueKey]) };
  });
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

// ---- Reliability (the site's /api/admin/status-report) ----
const pct = (v) => (v == null ? '-' : (Math.round(num(v) * 100) / 100) + '%');
export function uptimeRows(list) { return (list || []).map((u) => ({ service: String(u.label || '').replace(/ \(.*\)$/, ''), last24h: pct(u.d1), last7days: pct(u.d7), last30days: pct(u.d30) })); }
export function outageRows(list) { return (list || []).map((o) => ({ service: o.label, type: o.level === 'down' ? 'Down' : 'Degraded', started: o.start, length: formatUptime(o.lengthMs) + (o.ongoing ? ' (ongoing)' : '') })); }
export function dailyUptime(list) {
  const r = list || [];
  return { labels: r.map((x) => { if (typeof x.day !== 'number') return String(x.day || '').slice(5, 10); const d = new Date(x.day); return (d.getMonth() + 1) + '/' + d.getDate(); }), values: r.map((x) => (x.pct == null ? 0 : Math.round(num(x.pct) * 10) / 10)), colors: r.map((x) => (x.pct == null ? 'transparent' : x.pct >= 99.9 ? '#4ade80' : x.pct >= 90 ? '#fb923c' : '#ef4444')) };
}

// ---- The owner status dock (the website's "System" widget): same numbers, same rules ----
export const DOCK_WINDOW_MS = 30 * 60 * 1000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function dockValues(d) {
  const o = (d && d.overhead) || {}, c = (d && d.concurrency) || {}, live = (d && d.appProgressActive) || {}, rec = (d && d.appProgressRecent) || {};
  const loopMean = isNum(o.eventLoopMeanMs) ? o.eventLoopMeanMs : 0, loopMax = isNum(o.eventLoopMaxMs) ? o.eventLoopMaxMs : 0;
  const loopP99 = isNum(o.eventLoopP99Ms) ? o.eventLoopP99Ms : loopMax;
  const liveStreams = isNum(live.activeStreams) ? live.activeStreams : isNum(o.activeStreams) ? o.activeStreams : isNum(c.activeTotalStreams) ? c.activeTotalStreams : isNum(c.activeRcloneStreams) ? c.activeRcloneStreams : 0;
  const recentStreams = isNum(rec.activeStreams) ? rec.activeStreams : liveStreams;
  const liveUsers = isNum(live.activeUsers) ? live.activeUsers : isNum(c.userActiveStreamsUsers) ? c.userActiveStreamsUsers : 0;
  const recentUsers = isNum(rec.activeUsers) ? rec.activeUsers : liveUsers;
  const q = Math.max(0, Math.round(isNum(c.globalStreamQueueLength) ? c.globalStreamQueueLength : 0)), h = Math.max(0, Math.round(isNum(c.heldRedirectCount) ? c.heldRedirectCount : 0)), a = Math.max(0, Math.round(isNum(c.appQueuedDownloads) ? c.appQueuedDownloads : 0));
  const pair = (l, r) => { const lt = String(Math.max(0, Math.round(l))), rt = String(Math.max(0, Math.round(r))); return rt !== lt ? lt + '/' + rt : lt; };
  const mbps = (Number(live.totalBytesPerSec) || 0) * 8 / 1e6;
  return {
    overhead: o.level ? String(o.level) : '-',
    loop: loopMean + '/' + loopP99, loopTitle: `mean ${loopMean}ms, p99 ${loopP99}ms, worst tick ${loopMax}ms (last 60s)`,
    streams: pair(liveStreams, recentStreams), users: pair(liveUsers, recentUsers),
    speed: mbps >= 1000 ? (mbps / 1000).toFixed(2) + ' Gbit/s' : mbps.toFixed(mbps >= 100 ? 0 : 1) + ' Mbit/s', speedTitle: `combined download speed, all users (${(mbps / 8).toFixed(1)} MB/s)`,
    queue: String(q + h + a), queueBreakdown: `Global ${q} · Held ${h} · App ${a}`,
    raw: { streams: liveStreams, users: liveUsers, speed: mbps, loop: loopP99 },
  };
}
// The site's status window data (/api/status): what is down, since when.
export function statusSummary(s) {
  const bad = ((s && s.components) || []).filter((c) => c && c.status !== 'ok');
  const down = bad.some((c) => c.status === 'down');
  return { text: bad.length ? (down ? 'OUTAGE (' + bad.length + ')' : 'Issue (' + bad.length + ')') : 'OK', state: bad.length ? (down ? 'down' : 'issue') : 'ok', bad, down };
}
// A rolling 30 minute history for the little graphs.
export function pushSample(list, value, now, windowMs = DOCK_WINDOW_MS) {
  const out = (list || []).slice();
  if (Number.isFinite(Number(value))) out.push({ t: now, v: Number(value) });
  while (out.length && out[0].t < now - windowMs) out.shift();
  return out;
}
export function sparkPoints(list, w = 100, h = 20, windowMs = DOCK_WINDOW_MS) {
  const l = list || [];
  if (l.length < 2) return '';
  const tMax = l[l.length - 1].t, tMin = l[0].t;
  // The line spreads across the width over the time it actually has (at least 30 seconds, at most the 30 minute window), so a freshly opened app still shows a line.
  const span = Math.max(30000, Math.min(windowMs, tMax - tMin));
  let vMin = Infinity, vMax = -Infinity;
  for (const p of l) { if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }
  const range = vMax - vMin;
  return l.map((p) => {
    const x = Math.max(0, Math.min(w, ((p.t - tMin) / span) * w));
    const y = range === 0 ? h / 2 : h - (((p.v - vMin) / range) * (h - 2)) - 1;
    return x.toFixed(2) + ',' + Math.max(0, Math.min(h, y)).toFixed(2);
  }).join(' ');
}
// The detail pages the dock opens: which lists of system-details each mode shows.
export const DETAIL_TITLES = { streams: 'Active Streams', queue: 'Stream Queue', users: 'Streaming Users', speed: 'Download Speed by User' };
export function detailSections(mode, d) {
  const data = d || {};
  const q = data.queue || {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  const mirrorRows = Object.entries(data.mirrorLoad && typeof data.mirrorLoad === 'object' ? data.mirrorLoad : {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => ({ mirror: name, active: m && m.activeStreams, status: m && m.status, gamesAtQuota: data.mirrorGamesAtQuota && data.mirrorGamesAtQuota[name] != null ? (Array.isArray(data.mirrorGamesAtQuota[name]) ? data.mirrorGamesAtQuota[name].length : data.mirrorGamesAtQuota[name]) : '' }));
  if (mode === 'streams') return [
    { title: 'Streams', rows: arr(data.streams).map((s) => ({ user: s.user, file: s.filename, location: (s.remote || '') + (s.path ? '/' + s.path : ''), userPool: s.userStreams, thisFile: s.perFileStreams, overCap: s.capExceeded ? 'YES' : '' })), empty: 'No active streams.' },
    { title: 'Mirrors', rows: mirrorRows, empty: '' },
  ];
  if (mode === 'queue') {
    const qrows = (l) => arr(l).map((x) => ({ position: x.position, user: x.user, file: x.file, location: (x.remote || '') + (x.path ? '/' + x.path : ''), status: x.status, updated: x.updatedAt }));
    return [{ title: 'Held redirects', rows: qrows(q.held), empty: 'None held.' }, { title: 'Global queue', rows: qrows(q.global), empty: 'Nothing waiting.' }, { title: 'App queue', rows: qrows(q.app), empty: 'Nothing queued by the app.' }, { title: 'Per-user queue', rows: qrows(q.perUser), empty: 'No per-user queue.' }];
  }
  if (mode === 'users') return [{ title: 'Streaming users', rows: arr(data.users).map((u) => ({ user: u.user, activeStreams: u.activeStreams })), empty: 'No active streaming users.' }];
  if (mode === 'speed') return [{ title: 'Download speed by user', rows: arr(data.users).filter((u) => Number(u.bytesPerSec) > 0).sort((a, b) => Number(b.bytesPerSec) - Number(a.bytesPerSec)).map((u) => ({ user: u.user, speed: (Number(u.bytesPerSec) / 1048576).toFixed(1) + ' MB/s', mbit: (Number(u.bytesPerSec) * 8 / 1e6).toFixed(1) + ' Mbit/s' })), empty: 'Nobody is downloading right now.' }];
  return [];
}
