// The Admin pages of the built-in window (phase 1: read only). Shown only to owners and admins; the site decides what each role may see.
import { html, useState, useEffect, useMemo } from '../../native/vendor/ui.mjs';
import { labelOf, formatCell, tableColumns, adminTabs, statCards, remoteRows, requestRows, missingCards, missingRows, confirmText, REQUEST_STATUS_CHOICES } from './adminFormat.mjs';

const api = window.nativeAPI;

// Loads one admin page and refreshes it every `every` seconds (0 = once).
function useAdminData(kind, params, every) {
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
function DataTable({ rows, columns, empty, extra, extraLabel }) {
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

function Overview() {
  const [st, reload] = useAdminData('stats', {}, 15);
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const s = st.data;
  return html`<div>
    <${Cards} items=${statCards(s)} />
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
    <${DataTable} rows=${rows} columns=${['title', 'cover', 'trailer', 'folder']} empty="Nothing is missing." extra=${(r) => html`<button class="dbtn" onClick=${() => act('clearMissing', { gameKey: r.folder, title: r.title })}>Stop listing</button>`} extraLabel="Action" />
  </div>`;
}

function IpBansPage() {
  const [st, reload] = useAdminData('ipbans', {}, 0);
  const [actionUi, act] = useAdminAction(() => reload());
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;
  const rows = Object.entries(st.data.bannedIps || {}).map(([addr, v]) => ({ ip: addr, reason: (v && v.reason) || '', bannedAt: (v && v.bannedAt) || '', bannedBy: (v && v.bannedBy) || '' }));
  return html`<div>
    <${Cards} items=${[{ label: 'Banned addresses', value: String(st.data.totalBanned || 0), hint: '' }, { label: 'Members tracked', value: String(st.data.totalUsersTracked || 0), hint: '' }]} />
    ${actionUi}
    <div class="afilters"><input class="search" type="text" placeholder="IP address" value=${ip} onInput=${(e) => setIp(e.target.value)} /><input class="search" type="text" placeholder="Reason" value=${reason} onInput=${(e) => setReason(e.target.value)} /><button class="dbtn" disabled=${!ip.trim()} onClick=${() => { act('banIp', { ip: ip.trim(), reason }); setIp(''); setReason(''); }}>Ban this address</button></div>
    <${DataTable} rows=${rows} columns=${['ip', 'reason', 'bannedAt', 'bannedBy']} empty="No banned addresses." extra=${(r) => html`<button class="dbtn" onClick=${() => act('unbanIp', { ip: r.ip })}>Unban</button>`} />
  </div>`;
}

function AccessPage() {
  const [st, reload] = useAdminData('access', {}, 0);
  return st.data ? html`<div><p class="sval">Who counts as an admin. Changing these lists stays on the website for now.</p><${Tree} value=${st.data.effective || st.data} /></div>` : html`<${Status} state=${st} onRetry=${reload} />`;
}

function ControlsPage() {
  const [actionUi, act] = useAdminAction(null);
  return html`<div>
    ${actionUi}
    <div class="acontrols">
      <div class="acard"><div class="alabel">Mirror quota</div><div class="ahint">Mark every PC and PCVR mirror as available again after the storage provider's limit resets.</div><button class="dbtn" onClick=${() => act('resetQuota', {})}>Reset mirror quota</button></div>
      <div class="acard"><div class="alabel">Server</div><div class="ahint">Restart the website. Everyone is disconnected for about a minute.</div><button class="primary danger" onClick=${() => act('restartServer', {})}>Restart the server</button></div>
    </div>
  </div>`;
}

export function AdminView({ admin }) {
  const tabs = useMemo(() => adminTabs(admin && admin.role, admin && admin.canManage), [admin]);
  const [tab, setTab] = useState(() => (tabs[0] ? tabs[0][0] : ''));
  if (!tabs.length) return html`<div class="empty">The admin pages are for owners and admins.</div>`;
  const cur = tabs.some((t) => t[0] === tab) ? tab : tabs[0][0];
  return html`<main class="adminpage">
    <h2>Admin</h2>
    <nav class="atabs">${tabs.map(([id, label]) => html`<button key=${id} class=${id === cur ? 'tab on' : 'tab'} onClick=${() => setTab(id)}>${label}</button>`)}</nav>
    ${cur === 'overview' ? html`<${Overview} />` : cur === 'system' ? html`<${SystemPage} />` : cur === 'activity' ? html`<${ActivityPage} />` : cur === 'missing' ? html`<${MissingPage} />` : cur === 'ipbans' ? html`<${IpBansPage} />` : cur === 'access' ? html`<${AccessPage} />` : cur === 'controls' ? html`<${ControlsPage} />` : cur === 'queue' ? html`<${QueuePage} />` : cur === 'requests' ? html`<${RequestsPage} />` : html`<${RequestsPage} audit=${true} />`}
  </main>`;
}
