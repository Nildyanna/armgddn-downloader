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
  if (role === 'owner' || role === 'admin') tabs.push(['overview', 'Overview']);
  if (role === 'owner') tabs.push(['system', 'System'], ['activity', 'Activity']);
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
