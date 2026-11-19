// The owner status dock: the website's "System" widget, placed along the bottom of every page for owners.
// Same numbers (refreshed every 5 seconds), same 30 minute graphs, same click patterns: the title, Overhead and Loop open the analytics report,
// Status opens the site status window, and Streams, Users, Speed and Queue open their detail pages.
import { html, useState, useEffect, useRef } from '../../native/vendor/ui.mjs';
import { dockValues, statusSummary, pushSample, sparkPoints, DETAIL_TITLES, detailSections, DOCK_WINDOW_MS } from './adminFormat.mjs';
import { DataTable, useAdminData } from './admin.mjs';

const api = window.nativeAPI;

function Spark({ list }) {
  const pts = sparkPoints(list);
  return pts ? html`<svg class="dspark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><polyline points=${pts} fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" /></svg>` : html`<span class="dspark"></span>`;
}

function whenText(ms) { try { return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }

function StatusModal({ site, onClose }) {
  const sum = statusSummary(site);
  const comps = (site && site.components) || [];
  return html`<div class="overlay" onClick=${onClose}><div class="modal wide" onClick=${(e) => e.stopPropagation()}>
    <h3>Site status</h3>
    <p class=${'dstatus ' + sum.state}>${sum.bad.length ? (sum.down ? 'Outage in progress' : 'Problems detected') : 'All monitored services are working.'}</p>
    ${site && site.note ? html`<p class="sval">${site.note}</p>` : ''}
    <div class="atable"><table><thead><tr><th>Service</th><th>Status</th><th>Since</th><th>Effect</th></tr></thead><tbody>${comps.map((c) => html`<tr key=${c.id}><td>${c.label}</td><td class=${'dstatus ' + (c.status === 'ok' ? 'ok' : c.status === 'down' ? 'down' : 'issue')}>${c.status}</td><td>${c.since ? whenText(c.since) : ''}</td><td>${c.impact || ''}</td></tr>`)}</tbody></table></div>
    <div class="dbtns"><button class="dbtn" onClick=${onClose}>Close</button></div>
  </div></div>`;
}

function DetailsModal({ mode, onClose }) {
  const [st, reload] = useAdminData('system', {}, 5);
  const sections = st.data ? detailSections(mode, st.data) : [];
  return html`<div class="overlay" onClick=${onClose}><div class="modal wide" onClick=${(e) => e.stopPropagation()}>
    <h3>${DETAIL_TITLES[mode] || 'System details'}</h3>
    ${st.loading ? html`<div class="loading">Loading...</div>` : st.error ? html`<div class="notice">${st.error} <button class="dbtn" onClick=${reload}>Try again</button></div>` : sections.map((s, i) => (s.rows.length || s.empty) ? html`<div key=${i}><h4 class="asub">${s.title}</h4><${DataTable} rows=${s.rows} empty=${s.empty} /></div>` : '')}
    <div class="dbtns"><span class="sval">Refreshes every 5 seconds.</span><button class="dbtn" onClick=${onClose}>Close</button></div>
  </div></div>`;
}

export function OwnerDock({ onOpenAnalytics }) {
  // The graphs keep their last 30 minutes across restarts of the app, so they are never empty after a restart.
  const hist = useRef((() => { try { const h = JSON.parse(localStorage.getItem('native.dockHist') || 'null'); const now = Date.now(); if (h && typeof h === 'object') { const out = {}; for (const k of ['streams', 'users', 'speed', 'loop']) out[k] = (Array.isArray(h[k]) ? h[k] : []).filter((p) => p && now - p.t < DOCK_WINDOW_MS && Number.isFinite(p.v)); return out; } } catch (e) { } return { streams: [], users: [], speed: [], loop: [] }; })());
  const [vals, setVals] = useState(null);
  const [site, setSite] = useState(null);
  const [detail, setDetail] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await api.adminGet('stats', {});
      if (!alive || !(r && r.ok && r.data)) return;
      const v = dockValues(r.data), now = Date.now();
      for (const k of ['streams', 'users', 'speed', 'loop']) hist.current[k] = pushSample(hist.current[k], v.raw[k], now);
      try { localStorage.setItem('native.dockHist', JSON.stringify(hist.current)); } catch (e) { }
      setVals(v);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => {
    let alive = true;
    const poll = async () => { const r = await api.adminGet('siteStatus', {}); if (alive && r && r.ok && r.data) setSite(r.data); };
    poll();
    const id = setInterval(poll, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const sum = statusSummary(site);
  const cell = (cls, label, value, title, onClick, spark) => html`<button class=${'dcell ' + cls} title=${title || ''} onClick=${onClick}><span class="dlabel">${label}</span><span class="dvalue">${value}</span>${spark ? html`<${Spark} list=${spark} />` : ''}</button>`;
  return html`<div>
    <div class="ownerdock" role="status" aria-label="System status">
      <span></span>
      <div class="dcenter">
      <button class="dtitle" title="Open the analytics report" onClick=${onOpenAnalytics}>System</button>
      ${cell('dstate ' + sum.state, 'Status', site ? sum.text : '-', sum.bad.length ? sum.bad.map((c) => c.label + ' since ' + whenText(c.since)).join('\n') : 'Everything is working. Click for details.', () => setStatusOpen(true))}
      ${cell('', 'Overhead', vals ? vals.overhead : '-', 'Open the analytics report', onOpenAnalytics)}
      ${cell('', 'Loop (ms)', vals ? vals.loop : '-', vals ? vals.loopTitle : '', onOpenAnalytics, hist.current.loop)}
      ${cell('', 'Streams', vals ? vals.streams : '-', 'Open the active streams', () => setDetail('streams'), hist.current.streams)}
      ${cell('', 'Users', vals ? vals.users : '-', 'Open the streaming users', () => setDetail('users'), hist.current.users)}
      ${cell('', 'Speed', vals ? vals.speed : '-', vals ? vals.speedTitle : '', () => setDetail('speed'), hist.current.speed)}
      ${cell('', 'Queue', vals ? vals.queue : '-', vals ? vals.queueBreakdown : '', () => setDetail('queue'))}
      </div>
      <span class="dbreak">${vals ? vals.queueBreakdown : ''}</span>
    </div>
    ${statusOpen ? html`<${StatusModal} site=${site} onClose=${() => setStatusOpen(false)} />` : ''}
    ${detail ? html`<${DetailsModal} mode=${detail} onClose=${() => setDetail(null)} />` : ''}
  </div>`;
}
