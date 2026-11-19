// The Admin pages of the built-in window (phase 1: read only). Shown only to owners and admins; the site decides what each role may see.
import { html, useState, useEffect, useMemo, useRef } from '../../native/vendor/ui.mjs';
import './ownerRouting.js';
import { usageCards, labelOf, formatCell, tableColumns, adminTabs, statCards, remoteRows, requestRows, missingCards, missingRows, confirmText, REQUEST_STATUS_CHOICES, analyticsCards, dailySeries, weeklySeries, newUsersSeries, hourSeries, dowSeries, heatmapGrid, loyaltyRows, topRows, moverRows, collectionCards, collectionDaily, arraySeries, requestsSummary, uptimeRows, outageRows, dailyUptime, DOW_LABELS } from './adminFormat.mjs';

const api = window.nativeAPI;

// Loads one admin page and refreshes it every `every` seconds (0 = once).
export function useAdminData(kind, params, every) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const key = kind + JSON.stringify(params || {});
  const load = async () => {
    const r = await api.adminGet(kind, params || {});
    if (r && r.ok && r.data && r.data.success !== false) setState({ loading: false, data: r.data, error: '' });
    else setState({ loading: false, data: null, error: (r && r.error && r.error.message) || (r && r.data && r.data.error) || 'Could not load this page' });
  };
  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: '' });
    load();
    const id = every ? setInterval(() => { if (live) load(); }, every * 1000) : null;
    return () => { live = false; if (id) clearInterval(id); };
  }, [key]);
  return [state, load];
}

// Every admin action asks first, says what it will do, and reports what the site answered.
function useAdminAction(after) {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = (action, args) => { setMsg(''); setPending({ action, args, c: confirmText(action, args) }); };
  const go = async () => {
    const p = pending; if (!p) return;
    setBusy(true);
    const r = await api.adminDo(p.action, p.args);
    setBusy(false); setPending(null);
    if (r && r.ok && r.data && r.data.success !== false) {
      const failed = r.data.failed && r.data.failed.length ? ' (not reset: ' + r.data.failed.join(', ') + ')' : '';
      setMsg((r.data.message || 'Done.') + failed);
      if (after) after();
    } else setMsg('Did not work: ' + ((r && r.error && r.error.message) || (r && r.data && r.data.error) || 'no answer'));
  };
  const ui = html`<div>
    ${msg ? html`<div class="notice soft">${msg}</div>` : ''}
    ${pending ? html`<div class="overlay" onClick=${() => !busy && setPending(null)}><div class="modal" onClick=${(e) => e.stopPropagation()}>
      <h3>${pending.c.title}</h3><p>${pending.c.text}</p>
      <div class="dbtns"><button class="primary danger" disabled=${busy} onClick=${go}>${busy ? 'Working...' : pending.c.ok}</button><button class="dbtn" disabled=${busy} onClick=${() => setPending(null)}>Cancel</button></div>
    </div></div>` : ''}
  </div>`;
  return [ui, run];
}

function Cards({ items }) {
  return html`<div class="acards">${items.map((c) => html`<div class="acard" key=${c.label}><div class="alabel">${c.label}</div><div class="avalue">${c.value}</div>${c.hint ? html`<div class="ahint">${c.hint}</div>` : ''}</div>`)}</div>`;
}

const MAX_ROWS = 200;
export function DataTable({ rows, columns, empty, extra, extraLabel }) {
  const all = Array.isArray(rows) ? rows : [];
  const list = all.slice(0, MAX_ROWS);
  if (!list.length) return html`<div class="empty">${empty || 'Nothing to show.'}</div>`;
  const cols = columns || tableColumns(list);
  return html`<div><div class="atable"><table><thead><tr>${cols.map((c) => html`<th key=${c}>${labelOf(c)}</th>`)}${extra ? html`<th>${extraLabel || 'Action'}</th>` : ''}</tr></thead><tbody>${list.map((r, i) => html`<tr key=${i}>${cols.map((c) => html`<td key=${c}>${formatCell(r[c])}</td>`)}${extra ? html`<td>${extra(r)}</td>` : ''}</tr>`)}</tbody></table></div>${all.length > MAX_ROWS ? html`<div class="sval">Showing the first ${MAX_ROWS} of ${all.length}. Filter by status to narrow it.</div>` : ''}</div>`;
}

// Any answer the site gives, drawn as it comes: plain values as rows, lists of records as tables, nested objects as their own groups.
function Tree({ value, depth = 0 }) {
  if (value === null || typeof value !== 'object') return html`<span>${formatCell(value)}</span>`;
  if (Array.isArray(value)) {
    if (value.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return html`<${DataTable} rows=${value} />`;
    return html`<span>${formatCell(value) || 'None'}</span>`;
  }
  const entries = Object.entries(value).filter(([k]) => k !== 'success');
  const plain = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const nested = entries.filter(([, v]) => v !== null && typeof v === 'object');
  return html`<div class=${'atree d' + Math.min(depth, 2)}>
    ${plain.length ? html`<div class="akv">${plain.map(([k, v]) => html`<div class="arow" key=${k}><span class="ak">${labelOf(k)}</span><span class="av">${formatCell(v)}</span></div>`)}</div>` : ''}
    ${nested.map(([k, v]) => (Array.isArray(v) && !v.length) || (!Array.isArray(v) && !Object.keys(v).length) ? '' : html`<section class="agroup" key=${k}><h4>${labelOf(k)}</h4><${Tree} value=${v} depth=${depth + 1} /></section>`)}
  </div>`;
}

function Status({ state, onRetry }) {
  if (state.loading) return html`<div class="loading">Loading...</div>`;
  if (state.error) return html`<div class="notice">${state.error} <button class="dbtn" onClick=${onRetry}>Try again</button></div>`;
  return null;
}


// The website's live maps (routing, services, request flow), drawn by the same code and patched on every refresh.
function LiveMap({ kind, data, onOpen }) {
  const ref = useRef(null);
  useEffect(() => {
    const R = self.OwnerRouting;
    if (!R || !ref.current || !data) return;
    R.onOpen = (k, key, act) => (onOpen ? onOpen(k, key, act) : false);
    try {
      if (kind === 'routing') R.update(ref.current, R.buildModel(data));
      else if (kind === 'services') R.updateServices(ref.current, data, (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      else R.updateRequests(ref.current, data);
    } catch (e) { console.warn('live map failed:', e && e.message); }
  }, [kind, data]);
  return html`<div class="livemap" ref=${ref}></div>`;
}

function Overview() {
  const [st, reload] = useAdminData('stats', {}, 15);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const s = st.data;
  const [site] = useAdminData('siteStatus', {}, 30);
  const [actionUi, act] = useAdminAction(() => reload());
  const owner = s.role === 'owner';
  const cache = s.downloadCache;
  return html`<div>
    ${actionUi}
    <${LiveMap} kind="routing" data=${s} />
    ${site.data ? html`<${LiveMap} kind="services" data=${site.data} />` : ''}
    <${Cards} items=${statCards(s)} />
    <${Cards} items=${usageCards(s)} />
    ${owner ? html`<div class="dbtns"><button class="dbtn" onClick=${() => act('resetApiStats', {})}>Reset usage numbers</button>${cache && cache.enabled ? html`<button class="dbtn" disabled=${!!(cache.pendingReset && cache.activeEntries > 0)} onClick=${() => act('resetDownloadCache', {})}>${cache.pendingReset && cache.activeEntries > 0 ? 'Cache cooling down...' : 'Reset download cache'}</button>` : ''}</div>` : ''}
    <h4 class="asub">Sections</h4>
    <${DataTable} rows=${remoteRows(s)} columns=${['name', 'status', 'lastChecked', 'failures', 'lastError']} />
    ${s.appDownloadsByRemote && Object.keys(s.appDownloadsByRemote).length ? html`<h4 class="asub">App downloads by section</h4><${Tree} value=${s.appDownloadsByRemote} />` : ''}
    <h4 class="asub">Requests to the site</h4>
    <${Tree} value=${(s.api && { browse: s.api.browseRequests, downloadManifests: s.api.downloadManifestRequests, downloadFiles: s.api.downloadFileRequests, zipJobs: s.api.zipJobsCreated, uniqueDownloads: s.api.uniqueDownloads }) || {}} />
    ${s.ownerExtra ? html`<h4 class="asub">Owner details</h4><${Tree} value=${s.ownerExtra} />` : ''}
  </div>`;
}

function SystemPage() {
  const [st, reload] = useAdminData('system', {}, 30);
  return st.data ? html`<${Tree} value=${st.data} />` : html`<${Status} state=${st} onRetry=${reload} />`;
}

function ActivityPage() {
  const [st, reload] = useAdminData('activity', {}, 15);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const d = st.data;
  return html`<div>
    <${Cards} items=${Object.entries(d.stats || {}).map(([k, v]) => ({ label: labelOf(k), value: formatCell(v), hint: '' }))} />
    <h4 class="asub">Active sessions (last 5 minutes)</h4><${DataTable} rows=${d.activeSessions} empty="Nobody is active right now." />
    <h4 class="asub">Recent activity</h4><${DataTable} rows=${d.recentActivity} empty="No recent activity." />
  </div>`;
}

function QueuePage() {
  const [st, reload] = useAdminData('queue', {}, 60);
  return st.data ? html`<${Tree} value=${st.data} />` : html`<${Status} state=${st} onRetry=${reload} />`;
}

const REQUEST_STATUSES = ['', 'pending', 'approved', 'completed', 'rejected'];
function RequestsPage({ audit }) {
  const [status, setStatus] = useState('');
  const [by, setBy] = useState('');
  const [st, reload] = useAdminData('requests', status ? { status } : {}, 60);
  const [actionUi, act] = useAdminAction(() => reload());
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const all = requestRows(st.data.requests, { audit });
  const people = [...new Set(all.map((r) => r.handledBy).filter(Boolean))];
  const rows = audit && by ? all.filter((r) => r.handledBy === by) : all;
  const stats = st.data.stats || {};
  return html`<div>
    ${!audit ? html`<${LiveMap} kind="requests" data=${stats} />` : ''}
    ${!audit ? html`<${Cards} items=${['pending', 'approved', 'completed', 'rejected'].map((k) => ({ label: labelOf(k), value: String(stats[k] || 0), hint: '' })).concat([{ label: 'New in 7 days', value: String(stats.arrivals7 || 0), hint: '' }])} />` : ''}
    <div class="afilters">
      <label>Status <select value=${status} onChange=${(e) => setStatus(e.target.value)}>${REQUEST_STATUSES.map((s) => html`<option value=${s}>${s ? labelOf(s) : 'All'}</option>`)}</select></label>
      ${audit ? html`<label>Handled by <select value=${by} onChange=${(e) => setBy(e.target.value)}><option value="">All</option>${people.map((p) => html`<option value=${p}>@${p}</option>`)}</select></label>` : ''}
      <span class="sval">${rows.length} shown</span>
    </div>
    ${actionUi}
    <${DataTable} rows=${rows} columns=${audit ? ['id', 'title', 'status', 'handledBy', 'handledAt', 'by', 'category'] : ['id', 'title', 'by', 'category', 'status', 'votes', 'requested']} empty=${audit ? 'No handled requests.' : 'No requests.'}
      extra=${audit ? null : (r) => html`<select value="" onChange=${(e) => { const v = e.target.value; e.target.value = ''; if (v) act('requestStatus', { id: r.id, title: r.title, status: v }); }}><option value="">Set to...</option>${REQUEST_STATUS_CHOICES.filter((x) => x !== r.status).map((x) => html`<option value=${x}>${x}</option>`)}</select>`} extraLabel="Change" />
  </div>`;
}

function MissingPage() {
  const [st, reload] = useAdminData('missing', {}, 0);
  const [actionUi, act] = useAdminAction(() => reload());
  const [fix, setFix] = useState(null);
  const [coverUrl, setCoverUrl] = useState('');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [what, setWhat] = useState('all');
  const [query, setQuery] = useState('');
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const rows = missingRows(st.data, { what, query });
  return html`<div>
    <${Cards} items=${missingCards(st.data)} />
    <div class="afilters">
      <label>Show <select value=${what} onChange=${(e) => setWhat(e.target.value)}><option value="all">Everything missing</option><option value="cover">Missing a cover</option><option value="trailer">Missing a trailer</option></select></label>
      <input class="search" type="search" placeholder="Search titles" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <span class="sval">${rows.length} shown</span><button class="dbtn" onClick=${reload}>Refresh</button>
    </div>
    ${actionUi}
    ${fix ? html`<div class="apanel"><h4>Fix: ${fix.title}</h4>
      <div class="afilters"><input class="search wide" type="url" placeholder="Picture address (https://...)" value=${coverUrl} onInput=${(e) => setCoverUrl(e.target.value)} /><button class="dbtn" disabled=${!/^https:\/\//i.test(coverUrl.trim())} onClick=${() => act('addCover', { gameKey: fix.folder, title: fix.title, coverUrl: coverUrl.trim() })}>Set cover</button></div>
      <div class="afilters"><input class="search wide" type="url" placeholder="YouTube address (https://www.youtube.com/...)" value=${trailerUrl} onInput=${(e) => setTrailerUrl(e.target.value)} /><button class="dbtn" disabled=${!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trailerUrl.trim())} onClick=${() => act('addTrailer', { gameKey: fix.folder, title: fix.title, trailerYoutube: trailerUrl.trim() })}>Set trailer</button><button class="dbtn" onClick=${() => setFix(null)}>Close</button></div></div>` : ''}
    <${DataTable} rows=${rows} columns=${['title', 'cover', 'trailer', 'folder']} empty="Nothing is missing." extra=${(r) => html`<span><button class="dbtn" onClick=${() => { setFix(r); setCoverUrl(''); setTrailerUrl(''); }}>Fix</button> <button class="dbtn" onClick=${() => act('clearMissing', { gameKey: r.folder, title: r.title })}>Stop listing</button></span>`} extraLabel="Action" />
  </div>`;
}

// Charts are drawn here as plain SVG (no chart library): bars with a hover note, a heat grid, and ranked lists with inline bars.
function BarChart({ labels, values, height = 150, every, colors }) {
  const W = 640, H = height, pad = 22, n = values.length || 1;
  const max = Math.max(1, ...values);
  const bw = (W - pad) / n;
  const step = every || Math.max(1, Math.ceil(n / 12));
  return html`<svg class="achart" viewBox=${'0 0 ' + W + ' ' + (H + 18)} role="img" preserveAspectRatio="none">
    ${values.map((v, i) => { const h = Math.max(v ? 1 : 0, Math.round((H - 6) * v / max)); return html`<rect key=${i} x=${pad + i * bw + 1} y=${H - h} width=${Math.max(1, bw - 2)} height=${h} rx="1.5" class="abar" style=${colors && colors[i] ? 'fill:' + colors[i] + ';opacity:.9' : ''}><title>${labels[i]}: ${v.toLocaleString('en-US')}</title></rect>`; })}
    ${labels.map((l, i) => (i % step === 0 ? html`<text key=${'t' + i} x=${pad + i * bw + bw / 2} y=${H + 13} text-anchor="middle" class="atick">${l}</text>` : ''))}
    <text x="0" y="10" class="atick">${max.toLocaleString('en-US')}</text>
  </svg>`;
}
function Heatmap({ rows }) {
  const { grid, max } = heatmapGrid(rows);
  const cell = 24, W = 30 + 24 * cell, H = 8 * cell + 14;
  return html`<svg class="achart" viewBox=${'0 0 ' + W + ' ' + H} role="img">
    ${grid.map((r, d) => html`<g key=${d}><text x="0" y=${14 + d * cell + 14} class="atick">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}</text>${r.map((n, h) => html`<rect key=${h} x=${30 + h * cell} y=${14 + d * cell} width=${cell - 2} height=${cell - 2} rx="3" class="aheat" style=${'opacity:' + (n ? 0.12 + 0.88 * n / max : 0.05)}><title>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]} ${h}:00: ${n.toLocaleString('en-US')}</title></rect>`)}</g>`)}
    ${[0, 3, 6, 9, 12, 15, 18, 21].map((h) => html`<text key=${'h' + h} x=${30 + h * cell + cell / 2} y="10" text-anchor="middle" class="atick">${h}</text>`)}
  </svg>`;
}
function RankList({ rows, unit }) {
  if (!rows.length) return html`<div class="empty">Nothing to show.</div>`;
  return html`<div class="arank">${rows.map((r, i) => html`<div class="arankrow" key=${i}><span class="arankn">${i + 1}</span><span class="aranklabel" title=${r.label}>${r.label}</span><span class="arankbar"><i style=${'width:' + r.pct + '%'}></i></span><span class="arankval">${r.value.toLocaleString('en-US')}${unit ? ' ' + unit : ''}</span></div>`)}</div>`;
}
function Panel({ title, children, wide }) { return html`<section class=${'apanel' + (wide ? ' wide' : '')}><h4>${title}</h4>${children}</section>`; }

function AnalyticsPage() {
  const [st, reload] = useAdminData('report', {}, 120);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const d = st.data;
  const daily = dailySeries(d.daily), weekly = weeklySeries(d.weekly), hours = hourSeries(d.peakHour), dows = dowSeries(d.peakDow);
  const nuw = newUsersSeries(d.newUsersWeekly, 'week'), num = newUsersSeries(d.newUsersMonthly, 'month');
  const beh = d.behavior || {};
  return html`<div>
    <${Cards} items=${analyticsCards(d)} />
    <div class="agrid">
      <${Panel} title="Daily downloads, last 60 days" wide=${true}><${BarChart} labels=${daily.labels} values=${daily.values} /><//>
      <${Panel} title="Weekly downloads, last 12 weeks"><${BarChart} labels=${weekly.labels} values=${weekly.values} every=${2} /><//>
      <${Panel} title="New members per week (first download)"><${BarChart} labels=${nuw.labels} values=${nuw.values} every=${3} /><//>
      <${Panel} title="New members per month"><${BarChart} labels=${num.labels} values=${num.values} every=${2} /><//>
      <${Panel} title="Downloads by hour of day (Eastern)"><${BarChart} labels=${hours.labels} values=${hours.values} every=${3} /><//>
      <${Panel} title="Downloads by day of week"><${BarChart} labels=${dows.labels} values=${dows.values} every=${1} /><//>
      <${Panel} title="Hour of day by day of week (Eastern, all time)" wide=${true}><${Heatmap} rows=${d.heatmapRaw} /><//>
      <${Panel} title="Top genres"><${RankList} rows=${topRows(d.genres, 'name', 'count', 8)} /><//>
      <${Panel} title="Top 10 games, last 30 days"><${RankList} rows=${topRows(d.topGames30d, 'title', 'total', 10)} /><//>
      <${Panel} title="Member loyalty (downloads per member, all time)"><${RankList} rows=${(() => { const l = loyaltyRows(d.loyaltyTiers); const m = Math.max(1, ...l.map((x) => x.n)); return l.map((x) => ({ label: x.label, value: x.n, pct: Math.round(100 * x.n / m) })); })()} unit="members" /><//>
      <${Panel} title="Returning and power members">
        <div class="akv"><div class="arow"><span class="ak">Came back at least once</span><span class="av">${Number(beh.returningUsers || 0).toLocaleString('en-US')}</span></div><div class="arow"><span class="ak">Power members (10+ downloads)</span><span class="av">${Number(beh.powerUsers || 0).toLocaleString('en-US')}</span></div></div>
      <//>
    </div>
    <h4 class="asub">Biggest movers: last 30 days against the 30 before</h4>
    <${DataTable} rows=${moverRows(d.biggestMovers)} columns=${['title', 'now', 'before', 'change']} empty="No movers yet." />
    <h4 class="asub">Top 25 games, all time</h4>
    <${RankList} rows=${topRows(d.topGames, 'title', 'total', 25)} />
    <h4 class="asub">Top 25 members, all time</h4>
    <${RankList} rows=${topRows(d.topUsers, 'username', 'downloads', 25)} />
  </div>`;
}

function CollectionKind({ kind, o }) {
  const daily = collectionDaily(o);
  const hours = arraySeries(o.hours, Array.from({ length: 24 }, (_, i) => String(i)));
  const dows = arraySeries(o.dows, DOW_LABELS);
  const names = (list, n) => topRows(list, 'name', 'value', n);
  return html`<div>
    <h4 class="asub">${kind}</h4>
    <${Cards} items=${collectionCards(o, kind)} />
    <div class="agrid">
      <${Panel} title=${'Downloaded per day, last 30 days (' + (kind === 'Music' ? 'albums' : 'issues') + ')'} wide=${true}><${BarChart} labels=${daily.labels} values=${daily.values} every=${3} /><//>
      <${Panel} title="By hour of day (Eastern)"><${BarChart} labels=${hours.labels} values=${hours.values} every=${3} /><//>
      <${Panel} title="By day of week"><${BarChart} labels=${dows.labels} values=${dows.values} every=${1} /><//>
      <${Panel} title=${kind === 'Music' ? 'Most downloaded artists, 30 days' : 'Most downloaded series, 30 days'}><${RankList} rows=${names(kind === 'Music' ? o.topArtists : o.topSeries, 10)} /><//>
      <${Panel} title=${kind === 'Music' ? 'Most downloaded albums, 30 days' : 'Most downloaded volumes, 30 days'}><${RankList} rows=${names(o.topUnits, 10)} /><//>
      <${Panel} title=${'Top ' + kind + ' collectors, 30 days'}><${RankList} rows=${topRows(o.topUsers, 'username', 'items', 10)} /><//>
    </div>
  </div>`;
}

function CollectionsPage() {
  const [st, reload] = useAdminData('collections', {}, 300);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const d = st.data, dl = d.downloads || {};
  return html`<div>
    <p class="sval">Download numbers are counted from 2026-10-20, so they start small and grow.</p>
    ${dl.Music ? html`<${CollectionKind} kind="Music" o=${dl.Music} />` : ''}
    ${dl.Comics ? html`<${CollectionKind} kind="Comics" o=${dl.Comics} />` : ''}
    <h4 class="asub">Music and Comics requests</h4>
    <${DataTable} rows=${requestsSummary(d.requests)} columns=${['category', 'status', 'requests']} empty="No requests." />
    <h4 class="asub">What is in the library</h4>
    <${Tree} value=${d.catalog || {}} />
  </div>`;
}

function ReliabilityPage() {
  const [st, reload] = useAdminData('reliability', {}, 120);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const d = st.data, daily = dailyUptime(d.daily);
  return html`<div>
    <p class="sval">Monitoring since ${d.monitoringSince ? new Date(d.monitoringSince).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown'}. Each service is checked every minute.</p>
    <h4 class="asub">Uptime by service</h4>
    <${DataTable} rows=${uptimeRows(d.uptime)} columns=${['service', 'last24h', 'last7days', 'last30days']} empty="No data yet." />
    <div class="agrid"><${Panel} title="Percent of each day with every service up" wide=${true}><${BarChart} labels=${daily.labels} values=${daily.values} colors=${daily.colors} every=${3} /><//></div>
    <h4 class="asub">Outages</h4>
    <${DataTable} rows=${outageRows(d.outages)} columns=${['service', 'type', 'started', 'length']} empty="No outages recorded since monitoring began." />
  </div>`;
}

function IpBansPage() {
  const [st, reload] = useAdminData('ipbans', {}, 0);
  const [actionUi, act] = useAdminAction(() => reload());
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [uid, setUid] = useState('');
  const [who, setWho] = useState('');
  const [found, setFound] = useState(null);
  const lookup = async () => {
    const w = who.trim(); const r = await api.adminGet('lookup', /^\d+$/.test(w) ? { telegramId: w } : { username: w });
    setFound(r && r.ok && r.data ? r.data : { error: (r && r.error && r.error.message) || 'Not found' });
  };
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const rows = Object.entries(st.data.bannedIps || {}).map(([addr, v]) => ({ ip: addr, reason: (v && v.reason) || '', bannedAt: (v && v.bannedAt) || '', bannedBy: (v && v.bannedBy) || '' }));
  return html`<div>
    <${Cards} items=${[{ label: 'Banned addresses', value: String(st.data.totalBanned || 0), hint: '' }, { label: 'Members tracked', value: String(st.data.totalUsersTracked || 0), hint: '' }]} />
    ${actionUi}
    <div class="afilters"><input class="search" type="text" placeholder="IP address" value=${ip} onInput=${(e) => setIp(e.target.value)} /><input class="search" type="text" placeholder="Reason" value=${reason} onInput=${(e) => setReason(e.target.value)} /><button class="dbtn" disabled=${!ip.trim()} onClick=${() => { act('banIp', { ip: ip.trim(), reason }); setIp(''); setReason(''); }}>Ban this address</button></div>
    <div class="afilters"><input class="search" type="text" placeholder="Telegram id to ban (digits)" value=${uid} onInput=${(e) => setUid(e.target.value)} /><button class="dbtn" disabled=${!/^\d{3,20}$/.test(uid.trim())} onClick=${() => { act('banUser', { telegramId: uid.trim(), reason }); setUid(''); }}>Ban this member's addresses</button>
      <input class="search" type="text" placeholder="Look up: @username or Telegram id" value=${who} onInput=${(e) => setWho(e.target.value)} /><button class="dbtn" disabled=${!who.trim()} onClick=${lookup}>Look up</button></div>
    ${found ? html`<div class="apanel"><h4>Member lookup</h4>${found.error ? html`<div class="notice">${found.error}</div>` : html`<${Tree} value=${found} />`}</div>` : ''}
    <${DataTable} rows=${rows} columns=${['ip', 'reason', 'bannedAt', 'bannedBy']} empty="No banned addresses." extra=${(r) => html`<button class="dbtn" onClick=${() => act('unbanIp', { ip: r.ip })}>Unban</button>`} />
  </div>`;
}

function AccessPage() {
  const [st, reload] = useAdminData('access', {}, 0);
  const [actionUi, act] = useAdminAction(() => reload());
  const [list, setList] = useState('request');
  const [id, setId] = useState('');
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const eff = st.data.effective || {};
  const rows = [].concat((eff.channelAdminIds || []).map((x) => ({ id: String(x), list: 'channel', role: 'Full admin' })), (eff.requestAdminIds || []).map((x) => ({ id: String(x), list: 'request', role: 'Request admin' })));
  return html`<div>
    <p class="sval">Who counts as an admin. Owners are set in the site's own settings and are not changed here.</p>
    ${actionUi}
    <div class="afilters"><label>List <select value=${list} onChange=${(e) => setList(e.target.value)}><option value="request">Request admin (requests only)</option><option value="channel">Full admin</option></select></label><input class="search" type="text" placeholder="Telegram id (digits)" value=${id} onInput=${(e) => setId(e.target.value)} /><button class="dbtn" disabled=${!/^\d{3,20}$/.test(id.trim())} onClick=${() => { act('accessAdd', { list, id: id.trim() }); setId(''); }}>Add</button></div>
    <${DataTable} rows=${rows} columns=${['id', 'role']} empty="Nobody is on the lists." extra=${(r) => html`<button class="dbtn" onClick=${() => act('accessRemove', { list: r.list, id: r.id })}>Remove</button>`} />
  </div>`;
}

function ControlsPage() {
  const [actionUi, act] = useAdminAction(null);
  const [job, reloadJob] = useAdminData('refetchStatus', {}, 4);
  const j = job.data && job.data.status ? job.data.status : null;
  return html`<div>
    ${actionUi}
    <div class="acontrols">
      <div class="acard"><div class="alabel">Mirror quota</div><div class="ahint">Mark every PC and PCVR mirror as available again after the storage provider's limit resets.</div><button class="dbtn" onClick=${() => act('resetQuota', {})}>Reset mirror quota</button></div>
      <div class="acard"><div class="alabel">Game art</div><div class="ahint">Look every game up again on Steam and SteamGridDB. A long job on the server: one run at a time.</div>
        ${j && j.running ? html`<div class="ahint">Running: ${Number(j.processed || 0).toLocaleString('en-US')} of ${Number(j.total || 0).toLocaleString('en-US')} done, ${Number(j.updated || 0).toLocaleString('en-US')} updated, ${Number(j.failures || 0).toLocaleString('en-US')} failed.</div>` : j && j.finishedAt ? html`<div class="ahint">Last run finished: ${Number(j.processed || 0).toLocaleString('en-US')} checked, ${Number(j.updated || 0).toLocaleString('en-US')} updated, ${Number(j.failures || 0).toLocaleString('en-US')} failed${j.error ? '. Error: ' + j.error : ''}.</div>` : ''}
        <div class="dbtns"><button class="dbtn" disabled=${!!(j && j.running)} onClick=${() => { act('refetchArt', { force: false }); setTimeout(reloadJob, 1500); }}>Re-fetch all art</button><button class="dbtn" disabled=${!!(j && j.running)} onClick=${() => { act('refetchArt', { force: true }); setTimeout(reloadJob, 1500); }}>Force re-fetch everything</button></div></div>
      <div class="acard"><div class="alabel">Art overrides</div><div class="ahint">Re-read the override list and clear the browse cache, so art changes show up without a restart.</div><button class="dbtn" onClick=${() => act('reloadOverrides', {})}>Reload overrides</button></div>
      <div class="acard"><div class="alabel">Server</div><div class="ahint">Restart the website. Everyone is disconnected for about a minute.</div><button class="primary danger" onClick=${() => act('restartServer', {})}>Restart the server</button></div>
    </div>
  </div>`;
}

export function AdminView({ admin, initialTab }) {
  const tabs = useMemo(() => adminTabs(admin && admin.role, admin && admin.canManage), [admin]);
  const [tab, setTab] = useState(() => (initialTab && tabs.some((t) => t[0] === initialTab) ? initialTab : (tabs[0] ? tabs[0][0] : '')));
  if (!tabs.length) return html`<div class="empty">The admin pages are for owners and admins.</div>`;
  const cur = tabs.some((t) => t[0] === tab) ? tab : tabs[0][0];
  return html`<main class="adminpage">
    <h2>Admin</h2>
    <nav class="atabs">${tabs.map(([id, label]) => html`<button key=${id} class=${id === cur ? 'tab on' : 'tab'} onClick=${() => setTab(id)}>${label}</button>`)}</nav>
    ${cur === 'overview' ? html`<${Overview} />` : cur === 'analytics' ? html`<${AnalyticsPage} />` : cur === 'collections' ? html`<${CollectionsPage} />` : cur === 'reliability' ? html`<${ReliabilityPage} />` : cur === 'system' ? html`<${SystemPage} />` : cur === 'activity' ? html`<${ActivityPage} />` : cur === 'missing' ? html`<${MissingPage} />` : cur === 'ipbans' ? html`<${IpBansPage} />` : cur === 'access' ? html`<${AccessPage} />` : cur === 'controls' ? html`<${ControlsPage} />` : cur === 'queue' ? html`<${QueuePage} />` : cur === 'requests' ? html`<${RequestsPage} />` : html`<${RequestsPage} audit=${true} />`}
  </main>`;
}
