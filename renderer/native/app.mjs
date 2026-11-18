import { html, render, useState, useEffect, useMemo, Fragment, useRef } from '../../native/vendor/ui.mjs';
import { formatSize, releaseYear, cleanTitle, filterAndSort, autoEnter, shapeFor, crumbsFor, visibleItems, collectionCoverPath, formatSpeed, isActiveDownload, canDownload, downloadActions, letterOf, lettersPresent, statusInfo, shortDate, detailLines, steamLinks, dayKey, trailerSource } from './format.mjs';

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

function Card({ item, onOpen, remote, folder, onDownload, onDetails }) {
  const [broken, setBroken] = useState(false);
  const cover = !broken && ((item.coverArt && item.coverArt.cover && item.coverArt.cover.url) || collectionCoverPath(remote, folder, item));
  const year = releaseYear(item);
  return html`<div class="card" data-letter=${letterOf(item.name)} role="button" tabindex="0" onClick=${() => item.isDir && onOpen(item)} onKeyDown=${(e) => { if ((e.key === 'Enter' || e.key === ' ') && item.isDir) { e.preventDefault(); onOpen(item); } }} title=${item.name}>
    <div class="cover">${cover ? html`<img loading="lazy" decoding="async" src=${coverSrc(cover)} alt="" onError=${() => setBroken(true)} />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
    <div class="meta"><div class="title">${cleanTitle(item.name)}</div>
      <div class="sub">${[year, formatSize(item.size)].filter(Boolean).join(' · ')}</div>
      ${item.isDir && canDownload(remote, folder, item) ? html`<button class="dl ghost" title="Details" onClick=${(e) => { e.stopPropagation(); onDetails(item); }}>Details</button>` : ''}
      ${canDownload(remote, folder, item) ? html`<button class="dl" title="Download" onClick=${(e) => { e.stopPropagation(); onDownload(item); }}>Download</button>` : ''}</div>
  </div>`;
}


function AlphaBar({ letters }) {
  const jump = (l) => { const el = document.querySelector('.grid [data-letter="' + l + '"]'); if (el) el.scrollIntoView({ block: 'start' }); };
  if (letters.length < 2) return '';
  return html`<div class="alpha">${letters.map((l) => html`<button onClick=${() => jump(l)}>${l}</button>`)}</div>`;
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return html`<div class="overlay" onClick=${onClose}><div class=${'modal' + (wide ? ' wide' : '')} onClick=${(e) => e.stopPropagation()}>
    <div class="mhead"><div class="mtitle">${title}</div><button class="dbtn" onClick=${onClose}>Close</button></div>${children}</div></div>`;
}

function TrailerModal({ title, src, onClose }) {
  const ref = useRef(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const v = ref.current; if (!v || src.kind === 'youtube') return;
    let hls = null;
    if (src.kind === 'hls') {
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls(); hls.loadSource(src.url); hls.attachMedia(v);
        hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) setProblem('The trailer could not be played.'); });
      } else setProblem('This trailer format is not supported here.');
    } else { v.src = src.url; }
    v.play().catch(() => { });
    return () => { try { if (hls) hls.destroy(); v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { } };
  }, []);
  return html`<${Modal} title=${'Trailer - ' + title} onClose=${onClose} wide=${true}>
    ${src.kind === 'youtube'
      ? html`<iframe class="trailer" src=${src.url} title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : html`<video class="trailer" ref=${ref} controls playsinline onError=${() => setProblem('The trailer could not be played.')}></video>`}
    ${problem ? html`<div class="notice">${problem}</div>` : ''}
  </${Modal}>`;
}

function DetailsModal({ item, remote, folder, onClose, onDownload, onBrowse }) {
  const [playing, setPlaying] = useState(false);
  const trailer = trailerSource((item.coverArt || {}).trailer);
  const art = item.coverArt || {};
  const cover = art.cover && art.cover.url;
  const [readme, setReadme] = useState(null);   // null = checking, false = none, object = found
  const [showReadme, setShowReadme] = useState(false);
  const path = [folder, item.name].filter(Boolean).join('/');
  useEffect(() => { api.readme(remote, path).then((r) => setReadme(r.ok && r.data && r.data.found && r.data.contentHash ? r.data : false)); }, []);
  const cats = Array.isArray(art.categories) ? art.categories.filter(Boolean).slice(0, 10) : [];
  if (playing && trailer) return html`<${TrailerModal} title=${cleanTitle(item.name)} src=${trailer} onClose=${() => setPlaying(false)} />`;
  if (showReadme && readme) return html`<${Modal} title=${'README - ' + cleanTitle(item.name)} onClose=${() => setShowReadme(false)} wide=${true}><pre class="readme">${readme.content}${readme.truncated ? '\n\n[README PREVIEW TRUNCATED]' : ''}</pre></${Modal}>`;
  return html`<${Modal} title=${cleanTitle(item.name)} onClose=${onClose} wide=${true}>
    <div class="dhead">
      <div class="dcover">${cover ? html`<img src=${coverSrc(cover)} alt="" />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
      <div class="dinfo">
        <div class="dsub">${detailLines(remote, item).map((l) => html`<div>${l}</div>`)}</div>
        ${cats.length ? html`<div class="pills">${cats.map((c) => html`<span class="pill">${c}</span>`)}</div>` : ''}
        ${steamLinks(item).length ? html`<div class="links">${steamLinks(item).map(([n, u]) => html`<a href="#" onClick=${(e) => { e.preventDefault(); api.openLink(u); }}>${n}</a>`)}</div>` : ''}
        <div class="dbtns">
          <button class="primary" onClick=${() => { onClose(); onDownload(item); }}>Download</button>
          ${trailer ? html`<button class="dbtn" onClick=${() => setPlaying(true)}>Watch trailer</button>` : ''}
          <button class="dbtn" onClick=${() => { onClose(); onBrowse(item); }}>Browse files</button>
          <button class="dbtn" disabled=${!readme} onClick=${() => setShowReadme(true)}>${readme === null ? 'Checking README...' : 'Read README'}</button>
        </div>
      </div>
    </div></${Modal}>`;
}

// The notices a download goes through on the website: bandwidth reminder (once a day), then the README if there is one.
function GateModal({ gate }) {
  const g = gate.spec;
  return html`<${Modal} title=${g.title} onClose=${() => gate.resolve(false)} wide=${true}>
    ${g.image ? html`<img class="gateimg" src=${coverSrc(g.image)} alt="" />` : g.text ? html`<pre class="readme">${g.text}</pre>` : g.body}
    <div class="dbtns" style="margin-top:12px">
      <button class="primary" onClick=${() => gate.resolve(true)}>${g.ok || 'Continue'}</button>
      <button class="dbtn" onClick=${() => gate.resolve(false)}>Cancel</button>
      ${g.skipKey ? html`<label class="skip"><input type="checkbox" onChange=${(e) => { gate.skip = e.target.checked; }} /> Don't show this again today</label>` : ''}
    </div></${Modal}>`;
}

function RequestsView({ say }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);       // request being read
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [form, setForm] = useState(null);       // { category, title, notes } while the new-request form is open
  const load = async () => { const r = await api.requests(); if (r.ok) { setList(r.data.requests || []); setError(null); } else { setError(r.error); setList([]); } };
  useEffect(() => { load(); }, []);
  const openThread = async (req) => { setOpen(req); setThread(null); const r = await api.thread(req.linkedTo || req.id); setThread(r.ok ? (r.data.comments || []) : []); if (!r.ok) say(r.error.message); };
  const send = async () => {
    const r = await api.comment(open.linkedTo || open.id, text);
    if (r.ok) { setText(''); openThread(open); } else say(r.error.message || 'Could not send');
  };
  const submit = async () => {
    const r = await api.submitRequest(form.category, form.title, form.notes);
    if (r.ok) { setForm(null); say('Request sent'); load(); } else say(r.error.message || 'Could not send the request');
  };
  if (open) {
    const [label, tone] = statusInfo(open.status);
    return html`<div class="reqpane">
      <button class="dbtn" onClick=${() => { setOpen(null); load(); }}>Back</button>
      <h2>#${open.id} ${open.gameTitle} <span class=${'chip ' + tone}>${label}</span></h2>
      <div class="sub">${open.category} · ${shortDate(open.createdAt)}</div>
      ${open.decisionReason ? html`<div class="reason"><strong>Decision:</strong> ${open.decisionReason}</div>` : ''}
      <div class="thread">${thread === null ? html`<div class="loading">Loading…</div>` : thread.length ? thread.map((c) => html`<div class=${'msg' + (c.system ? ' sys' : '')} key=${c.id}><div class="who">${c.authorName || c.username || (c.role === 'staff' ? 'Staff' : 'You')} · ${shortDate(c.createdAt)}</div><div>${c.message || c.text}</div></div>`) : html`<div class="loading">No messages yet.</div>`}</div>
      <div class="compose"><input type="text" maxlength="500" placeholder="Write a message…" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} /><button class="primary" onClick=${send}>Send</button></div>
    </div>`;
  }
  return html`<div class="reqpane">
    <div class="reqhead"><h2>My requests</h2><button class="primary" onClick=${() => setForm({ category: 'Music', title: '', notes: '' })}>New request</button></div>
    ${error ? html`<div class="notice">${error.message}</div>` : ''}
    ${form ? html`<div class="reqform">
      <select value=${form.category} onChange=${(e) => setForm({ ...form, category: e.target.value })}><option>Music</option><option>Comics</option></select>
      <input type="text" maxlength="200" placeholder="Artist and album, or comic series" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} />
      <input type="text" maxlength="500" placeholder="Notes (optional)" value=${form.notes} onInput=${(e) => setForm({ ...form, notes: e.target.value })} />
      <div class="dbtns"><button class="primary" onClick=${submit}>Send request</button><button class="dbtn" onClick=${() => setForm(null)}>Cancel</button></div>
      <div class="sub">Game requests are closed for now.</div>
    </div>` : ''}
    ${list === null ? html`<div class="loading">Loading…</div>` : list.length ? html`<div class="dlist">${list.map((r) => { const [label, tone] = statusInfo(r.status); return html`<div class="drow clickable" key=${r.id} onClick=${() => openThread(r)}>
      <div class="dname">#${r.id} ${r.gameTitle}<span><span class=${'chip ' + tone}>${label}</span>${r.unreadCount ? html` <span class="badge">${r.unreadCount}</span>` : ''}</span></div>
      <div class="dmeta">${r.category} · ${shortDate(r.createdAt)}</div></div>`; })}</div>` : html`<div class="loading">You haven't made any requests.</div>`}
  </div>`;
}

function DownloadsView({ list }) {
  if (!list.length) return html`<div class="loading">No downloads yet. Press Download on any game, album or comic collection.</div>`;
  return html`<div class="dlist">${list.slice().reverse().map((d) => html`<div class="drow" key=${d.id}>
    <div class="dname">${cleanTitle(d.name || '')}<span class="dstat">${d.status || ''}</span></div>
    <div class="bar"><div class="fill" style=${'width:' + Math.max(0, Math.min(100, Number(d.progress) || 0)) + '%'}></div></div>
    <div class="dmeta">${[Math.round(Number(d.progress) || 0) + '%', formatSize(d.downloadedSize) && formatSize(d.downloadedSize) + ' of ' + formatSize(d.totalSize), formatSpeed(d.speed), d.eta ? 'ETA ' + d.eta : ''].filter(Boolean).join(' · ')}</div>
    ${d.error ? html`<div class="derr">${d.error}</div>` : ''}
    <div class="dbtns">${downloadActions(d).map((k) => html`<button class="dbtn" onClick=${() => (k === 'openFolder' ? api.openFolder(d.id) : api[k](d.id))}>${{ pause: 'Pause', resume: 'Resume', cancel: 'Cancel', retry: 'Retry', openFolder: 'Open folder' }[k]}</button>`)}</div>
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
  const [details, setDetails] = useState(null);
  const [gate, setGate] = useState(null);
  const acked = useRef(new Set());
  const ask = (spec) => new Promise((resolve) => { const g = { spec, skip: false, resolve: (v) => { setGate(null); if (v && spec.skipKey && g.skip) { try { localStorage.setItem(spec.skipKey, dayKey()); } catch (e) { } } resolve(v); } }; setGate(g); });
  // Same order as the website: bandwidth reminder, then (for apps) the PC Apps notice or (for the rest) the README, which must be accepted once per session.
  const passGates = async (path) => {
    let skipped = false; try { skipped = localStorage.getItem('bandwidthNoticeSkipDay') === dayKey(); } catch (e) { }
    if (!skipped && !(await ask({ title: 'Please read - bandwidth matters', skipKey: 'bandwidthNoticeSkipDay', ok: 'OK',
      body: html`<div class="notice-body"><h3>We pay for the bandwidth</h3><p>Downloading the same game over and over won't fix anything, and every extra copy is one that someone else now can't grab.</p><ul><li>Download the whole game, not one file at a time.</li><li>Turn on Auto-extract in Settings, or extract with 7-Zip.</li><li>If a game gives you trouble, ask for help first in the Telegram before downloading again.</li><li>Don't delete anything until you're sure the game works.</li></ul></div>` }))) return false;
    if (remote === 'Pirated PC Apps') return ask({ title: 'READ THIS BEFORE DOWNLOADING PC APPS', image: 'https://www.armgddnbrowser.com/PC_Apps_Modal.jpg' });
    const r = await api.readme(remote, path);
    const d = r.ok ? r.data : null;
    if (d && d.found && d.contentHash && !acked.current.has(d.contentHash)) {
      const yes = await ask({ title: 'READ THIS BEFORE DOWNLOADING THE GAME', text: d.content + (d.truncated ? '\n\n[README PREVIEW TRUNCATED]' : ''), ok: 'I have read it, continue' });
      if (!yes) return false;
      acked.current.add(d.contentHash);
    }
    return true;
  };
  const browseInto = (item) => { setView('library'); autoOk.current = false; setFolder(folder ? folder + '/' + item.name : item.name); setQuery(''); };
  const startDownload = async (item) => {
    const path = [folder, item.name].filter(Boolean).join('/');
    if (!(await passGates(path))) { say('Download cancelled'); return; }
    const r = await api.download(remote, path);
    if (r.ok) { say('Download started: ' + cleanTitle(item.name)); setView('downloads'); }
    else say(r.error.kind === 'auth' ? 'Sign in again to download.' : (r.error.message || 'Could not start the download'));
  };
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const [r, h] = await Promise.all([api.downloads(), api.history()]);
      if (!live) return;
      const active = r.ok ? (r.data || []) : [];
      const ids = new Set(active.map((d) => d.id));
      const done = (Array.isArray(h) ? h : []).filter((d) => d && !ids.has(d.id)).slice(0, 30)
        .map((d) => ({ id: d.id, name: d.name, status: d.status || 'completed', progress: 100, totalSize: d.totalSize, downloadedSize: d.totalSize }));
      setDownloads([...done.reverse(), ...active]);   // oldest first; the list is shown newest first
    };
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
      <button class=${view === 'requests' ? 'tab on' : 'tab'} onClick=${() => setView('requests')}>Requests</button>
      <button class=${view === 'downloads' ? 'tab on' : 'tab'} onClick=${() => setView('downloads')}>Downloads${activeCount ? html` <span class="badge">${activeCount}</span>` : ''}</button>
      <input class="search" type="search" placeholder="Search this list" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <select value=${sort} onChange=${(e) => setSort(e.target.value)}><option value="name">Name</option><option value="newest">Newest</option><option value="size">Largest</option></select>
    </header>
    ${view === 'requests' ? html`<${RequestsView} say=${say} />` : view === 'downloads' ? html`<${DownloadsView} list=${downloads} />` : html`<${Fragment}>
    <div class="crumbs"><button onClick=${() => { autoOk.current = false; setFolder(crumbs.root); }}>${remote || ''}</button>${crumbs.items.map((c) => html`<span> / <button onClick=${() => setFolder(c.path)}>${c.label}</button></span>`)}
      <span class="count">${items ? `${shown.length}${shown.length !== items.length ? ' of ' + items.length : ''} items` : ''}</span></div>
    ${error ? html`<div class="notice">${error.message}${error.kind === 'auth' ? html` <button class="primary" onClick=${signIn}>Sign in again</button>` : ''}</div>` : ''}
    ${items !== null && sort === 'name' ? html`<${AlphaBar} letters=${lettersPresent(shown)} />` : ''}
    ${items === null ? html`<div class="loading">Loading…</div>` : html`<main class=${"grid " + shapeFor(remote)}>${shown.map((it) => html`<${Card} key=${it.path || it.name} item=${it} remote=${remote} folder=${folder} onDownload=${startDownload} onDetails=${setDetails} onOpen=${(x) => { setFolder(folder ? folder + '/' + x.name : x.name); setQuery(''); }} />`)}</main>`}
    </${Fragment}>`}
    ${details ? html`<${DetailsModal} item=${details} remote=${remote} folder=${folder} onClose=${() => setDetails(null)} onDownload=${startDownload} onBrowse=${browseInto} />` : ''}
    ${gate ? html`<${GateModal} gate=${gate} />` : ''}
    ${toast ? html`<div class="toast">${toast}</div>` : ''}
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
