import { html, render, useState, useEffect, useMemo, Fragment } from '../../native/vendor/ui.mjs';
import { formatSize, releaseYear, cleanTitle, filterAndSort, autoEnter, shapeFor, crumbsFor, visibleItems, collectionCoverPath, formatSpeed, isActiveDownload, canDownload } from './format.mjs';
import { useRef } from '../../native/vendor/ui.mjs';

const api = window.nativeAPI;
const GROUPS = { 'PC Games': ['PC-1', 'PC-2', 'PC-3'], 'PCVR Games': ['PCVR-1', 'PCVR-2', 'PCVR-3'] };
const coverSrc = (url) => (url ? 'armgddn-img://c/?u=' + encodeURIComponent(url) : '');

// Library sections shown as tabs: the two game groups, then every remote that is not one of their mirrors.
function tabsFrom(remotes) {
  const mirrors = new Set(Object.values(GROUPS).flat());
  const list = Array.isArray(remotes) ? remotes : [];
  const out = [];
  for (const g of Object.keys(GROUPS)) if (GROUPS[g].some((m) => list.includes(m))) out.push(g);
  for (const r of list) if (!mirrors.has(r)) out.push(r);
  return out;
}

function Card({ item, onOpen, remote, folder, onDownload }) {
  const [broken, setBroken] = useState(false);
  const cover = !broken && ((item.coverArt && item.coverArt.cover && item.coverArt.cover.url) || collectionCoverPath(remote, folder, item));
  const year = releaseYear(item);
  return html`<div class="card" role="button" tabindex="0" onClick=${() => item.isDir && onOpen(item)} onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && item.isDir) { e.preventDefault(); onOpen(item); } }} title=${item.name}>
    <div class="cover">${cover ? html`<img loading="lazy" decoding="async" src=${coverSrc(cover)} alt="" onError=${() => setBroken(true)} />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
    <div class="meta"><div class="title">${cleanTitle(item.name)}</div>
      <div class="sub">${[year, formatSize(item.size)].filter(Boolean).join(' · ')}</div>
      ${canDownload(remote, folder, item) ? html`<button class="dl" title="Download" onClick=${(e) => { e.stopPropagation(); onDownload(item); }}>Download</button>` : ''}</div>
  </div>`;
}


function DownloadsView({ list }) {
  if (!list.length) return html`<div class="loading">No downloads yet. Press Download on any game, album or comic collection.</div>`;
  return html`<div class="dlist">${list.slice().reverse().map((d) => html`<div class="drow" key=${d.id}>
    <div class="dname">${cleanTitle(d.name || '')}<span class="dstat">${d.status || ''}</span></div>
    <div class="bar"><div class="fill" style=${'width:' + Math.max(0, Math.min(100, Number(d.progress) || 0)) + '%'}></div></div>
    <div class="dmeta">${[Math.round(Number(d.progress) || 0) + '%', formatSize(d.downloadedSize) && formatSize(d.downloadedSize) + ' of ' + formatSize(d.totalSize), formatSpeed(d.speed), d.eta ? 'ETA ' + d.eta : ''].filter(Boolean).join(' · ')}</div>
    ${d.error ? html`<div class="derr">${d.error}</div>` : ''}
  </div>`)}</div>`;
}

function App() {
  const [status, setStatus] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [remote, setRemote] = useState('');
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [view, setView] = useState('library');
  const [downloads, setDownloads] = useState([]);
  const [toast, setToast] = useState('');
  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const startDownload = async (item) => {
    const r = await api.download(remote, [folder, item.name].filter(Boolean).join('/'));
    if (r.ok) { say('Download started: ' + cleanTitle(item.name)); setView('downloads'); }
    else say(r.error.kind === 'auth' ? 'Sign in again to download.' : (r.error.message || 'Could not start the download'));
  };
  useEffect(() => {
    let live = true;
    const tick = async () => { const r = await api.downloads(); if (live && r.ok) setDownloads(r.data || []); };
    tick(); const t = setInterval(tick, 1500);
    return () => { live = false; clearInterval(t); };
  }, []);
  const activeCount = downloads.filter(isActiveDownload).length;
  const autoOk = useRef(true);   // step into the library folder when a tab is opened, but not when the member clicks back to the top

  const fail = (e) => { setError(e || { message: 'Something went wrong' }); setItems([]); };
  const boot = async () => {
    setError(null);
    const s = await api.status();
    setStatus(s.ok ? s.data : { signedIn: false });
    if (!s.ok || !s.data.signedIn) return;
    const r = await api.remotes();
    if (!r.ok) return fail(r.error);
    const t = tabsFrom(r.data.remotes); setTabs(t); if (t.length) setRemote(t[0]);
  };
  useEffect(() => { boot(); }, []);
  useEffect(() => {
    if (!remote) return;
    let live = true; setItems(null); setError(null);
    api.browse(remote, folder).then((r) => {
      if (!live) return;
      if (!r.ok) return fail(r.error);
      const files = r.data.files || [];
      const into = folder === '' && autoOk.current ? autoEnter(remote, files) : null;
      if (into) { setFolder(into); return; }
      setItems(visibleItems(remote, folder, files));
    });
    return () => { live = false; };
  }, [remote, folder]);

  const shown = useMemo(() => filterAndSort(items || [], { query, sort }), [items, query, sort]);
  const crumbs = crumbsFor(remote, folder);
  const signIn = async () => { await api.login(); boot(); };

  if (status && !status.signedIn) return html`<div class="center"><h1>ARMGDDN</h1><p>Sign in to browse the library.</p><button class="primary" onClick=${signIn}>Sign in with Telegram</button></div>`;
  return html`<div class="shell">
    <header>
      <div class="brand">ARMGDDN</div>
      <nav>${tabs.map((t) => html`<button class=${view === 'library' && t === remote ? 'tab on' : 'tab'} onClick=${() => { setView('library'); autoOk.current = true; setRemote(t); setFolder(''); setQuery(''); }}>${t}</button>`)}</nav>
      <button class=${view === 'downloads' ? 'tab on' : 'tab'} onClick=${() => setView('downloads')}>Downloads${activeCount ? html` <span class="badge">${activeCount}</span>` : ''}</button>
      <input class="search" type="search" placeholder="Search this list" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <select value=${sort} onChange=${(e) => setSort(e.target.value)}><option value="name">Name</option><option value="newest">Newest</option><option value="size">Largest</option></select>
    </header>
    ${view === 'downloads' ? html`<${DownloadsView} list=${downloads} />` : html`<${Fragment}>
    <div class="crumbs"><button onClick=${() => { autoOk.current = false; setFolder(crumbs.root); }}>${remote || ''}</button>${crumbs.items.map((c) => html`<span> / <button onClick=${() => setFolder(c.path)}>${c.label}</button></span>`)}
      <span class="count">${items ? `${shown.length}${shown.length !== items.length ? ' of ' + items.length : ''} items` : ''}</span></div>
    ${error ? html`<div class="notice">${error.message}${error.kind === 'auth' ? html` <button class="primary" onClick=${signIn}>Sign in again</button>` : ''}</div>` : ''}
    ${items === null ? html`<div class="loading">Loading…</div>` : html`<main class=${"grid " + shapeFor(remote)}>${shown.map((it) => html`<${Card} key=${it.path || it.name} item=${it} remote=${remote} folder=${folder} onDownload=${startDownload} onOpen=${(x) => { setFolder(folder ? folder + '/' + x.name : x.name); setQuery(''); }} />`)}</main>`}
    </${Fragment}>`}
    ${toast ? html`<div class="toast">${toast}</div>` : ''}
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
