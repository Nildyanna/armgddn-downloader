import { html, render, useState, useEffect, useMemo, Fragment, useRef } from '../../native/vendor/ui.mjs';
import { formatSize, releaseYear, cleanTitle, filterAndSort, autoEnter, shapeFor, crumbsFor, visibleItems, collectionCoverPath, formatSpeed, popularityLabel, trendingSets, batchEligible, batchPaths, PREFS_SNIPPET, parsePrefs, normalizePrefs, mergeMyList, homeItem, picksFrom, isActiveDownload, canDownload, downloadActions, letterOf, lettersPresent, statusInfo, shortDate, detailLines, steamLinks, dayKey, trailerSource, isPatchFolder, patchOldRepackLabel, mayHavePatchQuestion, isStarfieldTarget, MY_LIST_KEY, myListHas, myListToggle, categoryCounts, filterByCategory, wikiHtmlForApp, wikiSectionFor, searchEverywhere } from './format.mjs';

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

function Card({ item, onOpen, remote, folder, onDownload, onDetails, onPreview, inList, onToggleList, batch }) {
  const [broken, setBroken] = useState(false);
  const cover = !broken && ((item.coverArt && item.coverArt.cover && item.coverArt.cover.url) || collectionCoverPath(remote, folder, item));
  const year = releaseYear(item);
  const gameSection = ['PC Games', 'PCVR Games', 'Testing'].includes(remote);
  const coverClick = gameSection && cover && item.isDir ? () => onPreview(item) : (item.isDir ? () => onOpen(item) : null);
  return html`<div class=${'card' + (batch && batch.selected ? ' picked' : '')} data-letter=${letterOf(item.name)} title=${item.name}>
    ${batch ? html`<label class="bsel" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${batch.selected} onChange=${batch.toggle} /></label>` : ''}
    <div class=${"cover" + (coverClick ? " clickable" : "")} onClick=${coverClick || undefined}>${cover ? html`<img loading="lazy" decoding="async" src=${coverSrc(cover)} alt="" onError=${() => setBroken(true)} />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
    <div class="meta"><div class="title">${cleanTitle(item.name)}</div>
      <div class="sub">${[year, formatSize(item.size), popularityLabel(item)].filter(Boolean).join(' · ')}</div>
      <div class="cbtns">${item.isDir ? html`<button class=${'dl heart' + (inList ? ' on' : '')} title=${inList ? 'Remove from My List' : 'Add to My List'} onClick=${(e) => { e.stopPropagation(); onToggleList(item); }}>${inList ? '\u2665' : '\u2661'}</button>` : ''}
      ${item.isDir ? html`<button class="dl ghost" title="Browse" onClick=${(e) => { e.stopPropagation(); onOpen(item); }}>Browse</button>` : ''}
      ${item.isDir && canDownload(remote, folder, item) && !isPatchFolder(item.name) ? html`<button class="dl ghost" title="Details" onClick=${(e) => { e.stopPropagation(); onDetails(item); }}>Details</button>` : ''}
      ${canDownload(remote, folder, item) ? html`<button class="dl" title="Download" onClick=${(e) => { e.stopPropagation(); onDownload(item); }}>Download</button>` : ''}</div></div>
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

function PreviewModal({ item, onClose }) {
  const art = item.coverArt || {};
  const src = trailerSource(art.trailer);
  if (src) return html`<${TrailerModal} title=${cleanTitle(item.name)} src=${src} onClose=${onClose} />`;
  const cover = art.cover && art.cover.url;
  return html`<${Modal} title=${cleanTitle(item.name)} onClose=${onClose} wide=${true}>
    <div class="notice-info">No trailer is available for this game yet.</div>
    ${cover ? html`<img class="gateimg" src=${coverSrc(cover)} alt="" />` : ''}
  </${Modal}>`;
}

// "Do you already have the old repack?" - yes: only the patch; no: the full repack without the patch; cancel: nothing.
function PatchModal({ q }) {
  return html`<${Modal} title="This game has an update patch" onClose=${() => q.resolve(null)}>
    <p>Do you already have the old repack installed: <strong>${q.oldLabel || ('the version this patch updates (' + q.patch + ')')}</strong>?</p>
    <div class="patchbtns">
      <button class="primary" onClick=${() => q.resolve('yes')}><strong>Yes, I have it</strong><br /><span>Download only the patch.</span></button>
      <button class="dbtn" onClick=${() => q.resolve('no')}><strong>No, I don't</strong><br /><span>Download the full repack. You do not need the patch.</span></button>
      <button class="dbtn" onClick=${() => q.resolve(null)}><strong>Cancel</strong><br /><span>Do not download anything.</span></button>
    </div></${Modal}>`;
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

function RequestsView({ say, openId }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);       // request being read
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [form, setForm] = useState(null);       // { category, title, notes } while the new-request form is open
  const load = async () => { const r = await api.requests(); if (r.ok) { setList(r.data.requests || []); setError(null); } else { setError(r.error); setList([]); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (openId && list) { const hit = list.find((r) => r.id === openId || r.linkedTo === openId); if (hit) openThread(hit); } }, [openId, list]);
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
    ${view === 'library' && !everywhere && (remote === 'Music' || remote === 'Comics') && !noticeOff ? html`<div class="notice soft">Some albums and comic collections may be missing tracks or issues that haven't been sourced yet. If you'd like to contribute, please contact Old Man of the Hills. Some releases are left out on purpose (remixes, live versions, compilations and the like), so these lists are not a complete or official catalogue. <button class="dbtn" onClick=${() => setNoticeOff(true)}>Got it</button></div>` : ''}
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

function MyListView({ list, render }) {
  if (!list.length) return html`<div class="loading">Your list is empty. Press the heart on a game, album or comic to save it here.</div>`;
  return html`<main class="grid wide">${list.slice().reverse().map((e) => render({ ...e, isDir: true, _remote: e.remote, _folder: String(e.path || e.name).split('/').slice(0, -1).join('/') }))}</main>`;
}

function WikiView() {
  const [wiki, setWiki] = useState(null);
  const [id, setId] = useState('');
  const body = useRef(null);
  useEffect(() => { import('./wiki.json', { with: { type: 'json' } }).then((m) => { setWiki(m.default); }).catch(() => setWiki({ sections: [] })); }, []);
  const sections = wiki ? wiki.sections : [];
  const cur = wikiSectionFor(sections, id);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [cur && cur.id]);
  if (!wiki) return html`<div class="loading">Loading...</div>`;
  if (!cur) return html`<div class="loading">The Wiki is not available.</div>`;
  const click = (e) => {
    const link = e.target.closest && e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    const target = link.getAttribute('data-wiki');
    if (target) { setId(target); return; }
    const href = link.getAttribute('href') || '';
    if (/^https:\/\//i.test(href)) api.openLink(href);
  };
  return html`<div class="wiki">
    <nav class="wikitoc">${sections.map((s) => html`<button key=${s.id} class=${s.id === cur.id ? 'on' : ''} onClick=${() => setId(s.id)}>${s.title}</button>`)}</nav>
    <article class="wikibody" ref=${body} onClick=${click}><h2>${cur.title}</h2><div dangerouslySetInnerHTML=${{ __html: wikiHtmlForApp(cur.html) }}></div></article>
  </div>`;
}

function EverywhereResults({ index, query, render }) {
  const found = useMemo(() => (index ? searchEverywhere(index, query) : []), [index, query]);
  if (!index) return html`<div class="loading">Loading every section so it can be searched...</div>`;
  if (!query.trim()) return html`<div class="loading">Type to search every section (PC, PCVR, Testing, Apps, 3D, Comics, Music).</div>`;
  if (!found.length) return html`<div class="loading">Nothing matches that.</div>`;
  return html`<main class="grid wide"><div class="count" style="grid-column:1/-1">${found.length} found</div>${found.map(render)}</main>`;
}

// Settings that used to live only in the classic window: the common ones are here; the rest (history, scans, schedule) are one button away.
const SETTING_ROWS = [
  ['number', 'maxConcurrentDownloads', 'Downloads at the same time', 1, 6],
  ['select', 'connectionsPerFile', 'Connections per file', [[0, 'Automatic'], [1, '1'], [2, '2'], [4, '4'], [8, '8'], [16, '16']]],
  ['number', 'maxDownloadSpeedMBps', 'Speed limit in MB/s (0 = no limit)', 0, 10000],
  ['check', 'autoHashCheck', 'Check files after downloading'],
  ['check', 'autoExtract7z', 'Extract .7z files automatically'],
  ['check', 'showNotifications', 'Show notifications'],
  ['check', 'minimizeToTrayOnClose', 'Keep running in the tray when the window is closed'],
  ['check', 'autoUpdate', 'Update automatically'],
  ['check', 'startWithOsStartup', 'Start with the computer'],
  ['check', 'errorReporting', 'Send error reports'],
];
// Help with problems: the same four tools the classic Settings has. The codes are pasted in the ARMGDDN Games Welcome & Support chat for Tulip.
function SupportTools({ say, onApplyConnections }) {
  const [busy, setBusy] = useState('');
  const [findings, setFindings] = useState(null);
  const [note, setNote] = useState('');
  const copy = async (text, what) => { const r = await api.copy(text); setNote(r.ok ? what + ' Copied. Paste it in the ARMGDDN Games Welcome & Support chat and ask Tulip for help. It holds no names, paths or passwords.' : 'Could not copy automatically. Your code: ' + text); };
  const run = async (key, fn) => { setBusy(key); setNote(''); try { await fn(); } catch (e) { setNote('That did not work. Try again in a minute.'); } setBusy(''); };
  const check = () => run('check', async () => { const r = await api.runSetupCheck(); setFindings(r && r.ok && Array.isArray(r.findings) && r.findings.length ? r.findings : []); if (!(r && r.ok)) setNote('The check could not run. Try again, or ask in the chat.'); });
  const report = () => run('report', async () => { const r = await api.buildSetupReport(); if (!r || !r.ok || !r.code) { setNote('Could not build the report.'); return; } await copy(r.code, 'Report for Tulip.'); });
  const sendLog = () => run('log', async () => { setNote('Sending the log...'); const r = await api.sendSupportLog(); if (!r || !r.ok) { setNote((r && r.error) || 'Could not send the log.'); return; } await copy(r.code, 'Log code ' + r.code + '.'); });
  const test = () => run('test', async () => {
    api.onConnectionTestProgress((p) => setNote('Testing ' + p.streams + ' connection' + (p.streams === 1 ? '' : 's') + ' (step ' + p.phase + ' of ' + p.of + ')...'));
    const r = await api.runConnectionTest();
    if (!r || !r.ok) { setNote((r && r.error) || 'The test could not run.'); return; }
    const lines = r.results.map((x) => x.streams + ' connection' + (x.streams === 1 ? '' : 's') + ': ' + x.mbps + ' MB/s' + (x.stalls ? ', ' + x.stalls + ' pause' + (x.stalls === 1 ? '' : 's') : ''));
    const rec = r.recommendation || {};
    const advice = !rec.streams ? 'The test could not measure your speed. Try again in a few minutes.' : rec.value === 0 ? 'Your connection handled every setting well. Leave Connections per file on Automatic.' : 'Best for you: ' + rec.value + ' connection' + (rec.value === 1 ? '' : 's') + ' per file.';
    setNote(lines.join(' | ') + '. ' + advice);
    if (rec.streams && [0, 1, 2, 4, 8].includes(rec.value)) onApplyConnections(rec.value);
  });
  return html`<div class="support">
    <h3>Help with problems</h3>
    <div class="srow"><span class="slabel">Check my setup: disk space, folder location, antivirus and redistributables</span><button class="dbtn" disabled=${!!busy} onClick=${check}>${busy === 'check' ? 'Checking...' : 'Check'}</button></div>
    ${findings ? html`<div class="findings">${findings.length ? findings.map((f) => html`<div class=${'finding ' + (f.status === 'warn' || f.status === 'info' ? f.status : 'ok')}><div class="ftitle">${(f.status === 'ok' ? '\u2713 ' : f.status === 'warn' ? '\u26A0 ' : '\u2139 ') + String(f.title || '')}</div>${f.detail ? html`<div class="fdetail">${String(f.detail)}</div>` : ''}</div>`) : html`<div class="fdetail">Nothing to report.</div>`}</div>` : ''}
    <div class="srow"><span class="slabel">Copy report for Tulip: your setup check and recent problems as one code</span><button class="dbtn" disabled=${!!busy} onClick=${report}>Copy report</button></div>
    <div class="srow"><span class="slabel">Send log to staff: the cleaned log goes to the site and you get a short code</span><button class="dbtn" disabled=${!!busy} onClick=${sendLog}>Send log</button></div>
    <div class="srow"><span class="slabel">Test my connection: finds the best Connections per file for you</span><button class="dbtn" disabled=${!!busy} onClick=${test}>${busy === 'test' ? 'Testing...' : 'Test'}</button></div>
    ${note ? html`<div class="support-note">${note}</div>` : ''}
  </div>`;
}

// Moves the website's preferences over: the website keeps them in the browser, so a short snippet run on the site makes a code to paste here.
function PrefsImport({ onClose, onApply, say }) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const go = () => { const p = parsePrefs(code); if (p.error) { setProblem(p.error); return; } onApply(p); onClose(); };
  return html`<${Modal} title="Import my website preferences" onClose=${onClose} wide=${true}>
    <ol class="steps">
      <li>Open <strong>armgddnbrowser.com</strong> in your browser and sign in.</li>
      <li>Press <strong>F12</strong>, open the <strong>Console</strong> tab, paste the snippet below and press Enter. (If the browser asks you to type "allow pasting" first, do that.)</li>
      <li>It prints a long code starting <code>ARMGDDN-PREFS</code> (and copies it if it can). Paste the code in the box here.</li>
    </ol>
    <div class="srow"><span class="slabel">The snippet</span><button class="dbtn" onClick=${async () => { const r = await api.copy(PREFS_SNIPPET); say(r.ok ? 'Snippet copied' : 'Could not copy'); }}>Copy snippet</button></div>
    <textarea class="prefs-box" placeholder="Paste the ARMGDDN-PREFS code here" value=${code} onInput=${(e) => { setCode(e.target.value); setProblem(''); }}></textarea>
    ${problem ? html`<div class="derr">${problem}</div>` : ''}
    <div class="dbtns"><button class="dbtn" onClick=${go}>Import</button></div>
  </${Modal}>`;
}

function SettingsView({ say, onPrefs }) {
  const [s, setS] = useState(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => { api.getSettings().then((r) => setS(r && typeof r === 'object' ? r : {})).catch(() => setS({})); }, []);
  if (!s) return html`<div class="loading">Loading settings...</div>`;
  const save = async (patch) => { const next = { ...s, ...patch }; setS(next); try { await api.saveSettings(patch); } catch (e) { say('Could not save'); } };
  const pickFolder = async (key) => { const r = await api.browseFolder(); if (r) save({ [key]: r }); };
  const folderRow = (key, label) => html`<div class="srow"><span class="slabel">${label}</span><span class="sval">${s[key] || 'Not set'}</span><button class="dbtn" onClick=${() => pickFolder(key)}>Change</button></div>`;
  return html`<main class="settings">
    <h2>Settings</h2>
    ${folderRow('downloadPath', 'Download folder')}
    ${folderRow('comicsFolder', 'Comics folder')}
    ${folderRow('musicFolder', 'Music folder')}
    ${SETTING_ROWS.map(([kind, key, label, min, max]) => kind === 'select'
      ? html`<label class="srow"><span class="slabel">${label}</span><select value=${Number(s[key]) || 0} onChange=${(e) => save({ [key]: Number(e.target.value) })}>${min.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>`
      : kind === 'check'
      ? html`<label class="srow"><input type="checkbox" checked=${!!s[key]} onChange=${(e) => save({ [key]: e.target.checked })} /> <span class="slabel">${label}</span></label>`
      : html`<label class="srow"><span class="slabel">${label}</span><input type="number" min=${min} max=${max} value=${Number(s[key]) || 0} onChange=${(e) => { const n = Math.max(min, Math.min(max, Number(e.target.value) || 0)); save({ [key]: n }); }} /></label>`)}
    <div class="srow"><span class="slabel">Import the settings of the installed Companion (folders, speed, toggles)</span><button class="dbtn" onClick=${async () => { const r = await api.importSettings(); if (r && r.same) say('This already is the installed Companion\'s settings'); else if (r && r.imported) { say('Imported ' + r.imported + ' settings'); const g = await api.getSettings(); if (g) setS(g); } else say('No installed Companion settings were found'); }}>Import</button></div>
    <div class="srow"><span class="slabel">Import my website preferences (My List, theme, hidden sections, recent searches)</span><button class="dbtn" onClick=${() => setPrefsOpen(true)}>Import</button></div>
    ${prefsOpen ? html`<${PrefsImport} onClose=${() => setPrefsOpen(false)} onApply=${onPrefs} say=${say} />` : ''}
    <${SupportTools} say=${say} onApplyConnections=${(v) => save({ connectionsPerFile: v })} />
    <div class="srow"><span class="slabel">Download history, schedule, Komga and library scans</span><button class="dbtn" onClick=${() => api.openClassic()}>Open the classic window</button></div>
  </main>`;
}

function TrendingStrip({ windows, onOpen }) {
  const sets = useMemo(() => trendingSets(windows), [windows]);
  const [idx, setIdx] = useState(0);
  const [cycle, setCycle] = useState(0);
  const view = useRef(null); const track = useRef(null); const anim = useRef(null);
  const cur = sets.length ? sets[idx % sets.length] : null;
  useEffect(() => {
    const v = view.current, t = track.current;
    if (!cur || !v || !t || typeof t.animate !== 'function') return;
    const pad = 24, w = t.scrollWidth, vw = v.clientWidth;
    const start = -(w + pad), end = vw + pad;
    const a = t.animate([{ transform: 'translateX(' + start + 'px)' }, { transform: 'translateX(' + end + 'px)' }], { duration: Math.max(4, (end - start) / 115) * 1000, easing: 'linear', fill: 'forwards' });
    anim.current = a;
    a.onfinish = () => { setIdx((n) => (sets.length ? (n + 1) % sets.length : 0)); setCycle((n) => n + 1); };
    return () => { try { a.cancel(); } catch (e) { } };
  }, [idx, cycle, sets.length]);
  if (!cur) return html`<div class="loading">Nothing is trending yet.</div>`;
  return html`<div class="ticker" ref=${view} onMouseEnter=${() => { try { anim.current && anim.current.pause(); } catch (e) { } }} onMouseLeave=${() => { try { anim.current && anim.current.play(); } catch (e) { } }}>
    <div class="ticker-track" ref=${track} key=${idx + '-' + cycle}>${cur.items.map((e) => html`<div class="tpill" key=${e.norm + e.platform} onClick=${() => onOpen(e)}>
      <div class="tcover">${e.coverUrl ? html`<img src=${coverSrc(e.coverUrl)} alt="" />` : html`<div class="nocover small">Non-Steam Game</div>`}</div>
      <div class="ttext"><div class="ttitle">${cleanTitle(e.title)}</div>
        <div class="tmeta"><span>\u{1F525} ${Number(e.count).toLocaleString('en-US')} downloads</span>${e.sizeBytes ? html`<span>${formatSize(e.sizeBytes)}</span>` : ''}${e.lastDownloadTs ? html`<span>${shortDate(e.lastDownloadTs)}</span>` : ''}</div></div>
    </div>`)}</div>
    <span class=${'tbadge ' + cur.win} title="Which set is showing">${cur.label}</span>
  </div>`;
}

// Home: the three strips the website's landing page has.
function Strip({ id, title, sub, right, children }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('native.strip.' + id) === '1'; } catch (e) { return false; } });
  const toggle = () => { const v = !hidden; setHidden(v); try { localStorage.setItem('native.strip.' + id, v ? '1' : '0'); } catch (e) { } };
  return html`<section class="strip"><div class="strip-head"><span class="strip-title">${title}</span>${sub ? html`<span class="strip-sub">${sub}</span>` : ''}<span class="strip-right">${right || ''}<button class="dbtn" onClick=${toggle}>${hidden ? 'Show' : 'Hide'}</button></span></div>${hidden ? '' : children}</section>`;
}
function HomeView({ myList, render, onOpenTrend }) {
  const [trend, setTrend] = useState(null);
  const [gems, setGems] = useState(null);
  useEffect(() => {
    api.trending().then((r) => setTrend(r.ok && r.data && r.data.windows ? r.data.windows : {}));
    // Hidden gems arrive without art, so each one's cover comes from the same listing the library shows (one cached call per folder).
    api.gems().then(async (r) => {
      const list = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items.map((g) => homeItem({ ...g, total: g.downloads })).filter(Boolean) : [];
      setGems(list);          // show them at once; the covers fill in as the listings arrive
      const folders = [...new Set(list.map((it) => it._remote + '|' + it._folder))];
      const art = new Map();
      await Promise.all(folders.map(async (k) => { const [rem, fol] = k.split('|'); const b = await api.browse(rem, fol); if (b.ok) for (const f of (b.data.files || [])) if (f && f.coverArt) art.set(k + '|' + f.name, f); }));
      setGems(list.map((it) => { const hit = art.get(it._remote + '|' + it._folder + '|' + it.name); return hit ? { ...it, coverArt: hit.coverArt, size: it.size || hit.size, releaseDate: hit.releaseDate } : it; }));
    });
  }, []);
  const picks = trend ? picksFrom([...(trend.month || []), ...(trend.week || [])], (myList || []).map((i) => cleanTitle(i.name)), new Date().toISOString().slice(0, 10), 12).map(homeItem).filter(Boolean) : null;
  return html`<main class="home">
    <${Strip} id="trending" title="\u{1F525} Trending Downloads">
      ${trend === null ? html`<div class="loading">Loading…</div>` : html`<${TrendingStrip} windows=${trend} onOpen=${onOpenTrend} />`}
      <div class="strip-note">Download counts are from the last 7 or 30 days, not all-time totals.</div>
    </${Strip}>
    <${Strip} id="picks" title="Game Radar" sub="Personalized picks: trending titles that are not on your list yet">
      ${picks === null ? html`<div class="loading">Loading…</div>` : !picks.length ? html`<div class="loading">No picks yet.</div>` : html`<div class="hrow">${picks.map((it) => render(it, 'p'))}</div>`}
    </${Strip}>
    <${Strip} id="gems" title="Hidden Gems" sub="In the library a while, hardly downloaded. A different handful each day.">
      ${gems === null ? html`<div class="loading">Loading…</div>` : !gems.length ? html`<div class="loading">No gems today.</div>` : html`<div class="hrow">${gems.map((it) => render(it, 'g'))}</div>`}
    </${Strip}>
  </main>`;
}

function DownloadsView({ list }) {
  if (!list.length) return html`<div class="loading">No downloads yet. Press Download on any game, album or comic collection.</div>`;
  return html`<div class="dlist">${list.slice().reverse().map((d) => html`<div class="drow" key=${d.id}>
    <div class="dname">${cleanTitle(d.name || '')}<span class="dstat">${d.status || ''}</span></div>
    <div class="bar"><div class="fill" style=${'width:' + Math.max(0, Math.min(100, Number(d.progress) || 0)) + '%'}></div></div>
    <div class="dmeta">${[Math.round(Number(d.progress) || 0) + '%', formatSize(d.downloadedSize) && formatSize(d.downloadedSize) + ' of ' + formatSize(d.totalSize), (d.totalSpeed || formatSpeed(d.speed)), d.eta ? 'ETA ' + d.eta : '', d.fileCount > 1 ? (d.completedFiles || 0) + ' of ' + d.fileCount + ' files' : ''].filter(Boolean).join(' · ')}</div>
    ${d.error ? html`<div class="derr">${d.error}</div>` : ''}
    <div class="dbtns">${downloadActions(d).map((k) => html`<button class="dbtn" onClick=${() => (k === 'openFolder' ? api.openFolder(d.id) : api[k](d.id))}>${{ pause: 'Pause', resume: 'Resume', cancel: 'Cancel', retry: 'Retry', openFolder: 'Open folder' }[k]}</button>`)}</div>
  </div>`)}</div>`;
}

function App() {
  const [status, setStatus] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [remote, setRemote] = useState('');
  const [folder, setFolder] = useState('');
  // The list belongs to the section and folder it was loaded for. Without that tag, the first draw after opening a folder shows the old
  // list under the new folder name and asks the site for covers that do not exist, which holds up the real ones.
  const [itemsState, setItemsState] = useState({ key: '', list: null });
  const itemsKeyNow = remote + '|' + folder;
  const items = itemsState.key === itemsKeyNow ? itemsState.list : null;
  const setItems = (list, key) => setItemsState({ key: key == null ? itemsKeyNow : key, list });
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [reverse, setReverse] = useState(false);
  const [noticeOff, setNoticeOff] = useState(false);
  const [view, setView] = useState('home');
  const [openRequest, setOpenRequest] = useState(null);
  useEffect(() => { api.onOpen((m) => { if (m && m.view === 'requests') { setView('requests'); setOpenRequest(m.id); } }); }, []);
  const [downloads, setDownloads] = useState([]);
  const [toast, setToast] = useState('');
  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const [details, setDetails] = useState(null);
  const [preview, setPreview] = useState(null);
  const [myList, setMyList] = useState(() => { try { return JSON.parse(localStorage.getItem(MY_LIST_KEY) || '[]'); } catch (e) { return []; } });
  const [category, setCategory] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const [index, setIndex] = useState(null);     // every section's library list, loaded once when searching everywhere
  useEffect(() => {
    if (!everywhere || index || !tabs.length) return;
    let live = true;
    (async () => {
      const all = [];
      for (const t of tabs) {
        const top = await api.browse(t, '');
        if (!top.ok) continue;
        let folder = '';
        let files = visibleItems(t, '', top.data.files || []);
        const into = autoEnter(t, top.data.files || []);
        if (into) { const inner = await api.browse(t, into); if (inner.ok) { files = visibleItems(t, into, inner.data.files || []); folder = into; } }
        for (const f of files) all.push({ ...f, _remote: t, _folder: folder });
      }
      if (live) setIndex(all);
    })();
    return () => { live = false; };
  }, [everywhere, tabs]);
  const ctxRemote = (it) => (it && it._remote != null ? it._remote : remote);
  const ctxFolder = (it) => (it && it._folder != null ? it._folder : folder);
  const itemPath = (it) => [ctxFolder(it), it.name].filter(Boolean).join('/');
  const applyPrefs = (p, quiet, listOnly) => {
    const m = mergeMyList(myList, p.myList);
    setMyList(m.list); try { localStorage.setItem(MY_LIST_KEY, JSON.stringify(m.list)); } catch (e) { }
    if (listOnly) { if (m.added) say('Added ' + m.added + ' new My List item' + (m.added === 1 ? '' : 's') + ' from the website.'); return; }
    try {
      for (const [id, on] of Object.entries(p.strips)) localStorage.setItem('native.strip.' + id, on ? '1' : '0');
      if (p.theme) localStorage.setItem('native.theme', p.theme);
      if (p.searches.length) localStorage.setItem('native.recentSearches', JSON.stringify(p.searches));
      if (p.komgaUrl) localStorage.setItem('native.komgaUrl', p.komgaUrl);
      if (p.animations !== null) localStorage.setItem('native.animations', p.animations ? '1' : '0');
    } catch (e) { }
    if (!quiet || m.added || p.theme) say((quiet ? 'Brought over your website preferences: ' : 'Imported ') + m.added + ' My List item' + (m.added === 1 ? '' : 's') + (p.theme ? ', your theme' : '') + (p.searches.length ? ', recent searches' : '') + '.');
  };
  const toggleList = (it) => {
    const next = myListToggle(myList, { name: it.name, remote: ctxRemote(it), path: itemPath(it), size: it.size, downloadCount: it.downloadCount, releaseDate: it.releaseDate, coverArt: it.coverArt });
    setMyList(next); try { localStorage.setItem(MY_LIST_KEY, JSON.stringify(next)); } catch (e) { }
    say(myListHas(next, ctxRemote(it), itemPath(it)) ? 'Added to My List' : 'Removed from My List');
  };
  const inMyList = (it) => myListHas(myList, ctxRemote(it), itemPath(it));
  const pendingScroll = useRef('');
  const openTrend = (e) => { const it = homeItem(e); if (!it) return; pendingScroll.current = it.name; goTo(it._remote, it._folder); };
  const goTo = (rem, path) => { setView('library'); autoOk.current = false; setQuery(''); setCategory(''); setRemote(rem); setFolder(path); };
  const [patchQ, setPatchQ] = useState(null);
  const askPatch = (oldLabel, patch) => new Promise((resolve) => setPatchQ({ oldLabel, patch, resolve: (v) => { setPatchQ(null); resolve(v); } }));
  const [gate, setGate] = useState(null);
  const acked = useRef(new Set());
  const ask = (spec) => new Promise((resolve) => { const g = { spec, skip: false, resolve: (v) => { setGate(null); if (v && spec.skipKey && g.skip) { try { localStorage.setItem(spec.skipKey, dayKey()); } catch (e) { } } resolve(v); } }; setGate(g); });
  // Same order as the website: bandwidth reminder, then (for apps) the PC Apps notice or (for the rest) the README, which must be accepted once per session.
  const passGates = async (path, remote, noBandwidth) => {
    let skipped = false; try { skipped = localStorage.getItem('bandwidthNoticeSkipDay') === dayKey(); } catch (e) { }
    if (!noBandwidth && !skipped && !(await ask({ title: 'Please read - bandwidth matters', skipKey: 'bandwidthNoticeSkipDay', ok: 'OK',
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
  const browseInto = (item) => goTo(ctxRemote(item), itemPath(item));
  const startDownload = async (item) => {
    const remote = ctxRemote(item);
    const path = itemPath(item);
    if (isStarfieldTarget(path) && !(await ask({ title: 'Starfield', text: `${item.name} is not available for auto extraction.\n\nContinue without auto-extract?`, ok: 'Continue' }))) { say('Download cancelled'); return; }
    let patchSkip = null;
    if (item.isDir && mayHavePatchQuestion(item.name)) {
      const kids = await api.browse(remote, path);
      const patches = kids.ok ? (kids.data.files || []).map((f) => String(f.name || '')).filter(isPatchFolder) : [];
      for (const patch of patches) {
        const answer = await askPatch(patchOldRepackLabel(item.name, patch), patch);
        if (answer === null) { say('Download cancelled'); return; }
        if (answer === 'yes') {
          const pp = path + '/' + patch;
          if (!(await passGates(pp, remote))) { say('Download cancelled'); return; }
          const r2 = await api.download(remote, pp);
          if (r2.ok) { say('Download started: ' + cleanTitle(patch)); setView('downloads'); } else say(r2.error.message || 'Could not start the download');
          return;
        }
      }
      if (patches.length) patchSkip = patches;   // "no" to every patch: the whole game folder, minus the patches
    }
    if (!(await passGates(path, remote))) { say('Download cancelled'); return; }
    const r = patchSkip ? await api.downloadBatch(remote, [path], patchSkip) : await api.download(remote, path);
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
    // The website copies each member's preferences to the server; the first time here they come over by themselves, and later visits only add
    // new My List entries. Nothing for the member to do.
    try {
      const pr = await api.prefs();
      if (pr.ok && pr.data && pr.data.prefs) {
        const seen = Number(localStorage.getItem('native.prefsPulled') || 0);
        const stamp = Number(pr.data.updatedAt) || 1;
        if (stamp > seen) {
          const n = normalizePrefs(pr.data.prefs);
          if (!n.error) { applyPrefs(n, true, seen > 0); localStorage.setItem('native.prefsPulled', String(stamp)); }
        }
      }
    } catch (e) { }
  };
  useEffect(() => { boot(); }, []);
  useEffect(() => {
    if (!remote) return;
    let live = true; const myKey = remote + '|' + folder; setError(null);
    api.browse(remote, folder).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(r.error || { message: 'Something went wrong' }); setItems([], myKey); return; }
      const files = r.data.files || [];
      const into = folder === '' && autoOk.current ? autoEnter(remote, files) : null;
      if (into) { setFolder(into); return; }
      setItems(visibleItems(remote, folder, files), myKey);
      if (pendingScroll.current) { const n = pendingScroll.current; pendingScroll.current = ''; setTimeout(() => { const el = [...document.querySelectorAll('.card')].find((c) => c.getAttribute('title') === n); if (el) el.scrollIntoView({ block: 'center' }); }, 400); }
    });
    return () => { live = false; };
  }, [remote, folder]);

  const cats = useMemo(() => categoryCounts(items || [], remote), [items, remote]);
  const [batchOn, setBatchOn] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setBatchOn(false); setPicked(new Set()); }, [remote, folder]);
  const shown = useMemo(() => filterAndSort(filterByCategory(items || [], category, remote), { query, sort, reverse }), [items, query, sort, reverse, category, remote]);
  const crumbs = crumbsFor(remote, folder);
  const batchOk = !everywhere && view === 'library' && items !== null && batchEligible(remote, crumbs.items.length, shown.length);
  const batchActive = batchOk && batchOn;
  const itemKeyOf = (it) => itemPath(it);
  const setBatch = (on) => { setBatchOn(on); setPicked(on ? new Set(shown.filter((it) => !isPatchFolder(it.name)).map(itemKeyOf)) : new Set()); };
  const togglePick = (it) => { const k = itemKeyOf(it); const n = new Set(picked); if (n.has(k)) n.delete(k); else n.add(k); setPicked(n); };
  const allPicked = shown.length > 0 && shown.every((it) => picked.has(itemKeyOf(it)));
  const startBatch = async () => {
    const rem = remote;
    const paths = batchPaths([...picked]);
    if (!paths.length) { say('Nothing selected'); return; }
    if (paths.length > 50) { say('Select 50 items or fewer at a time'); return; }
    const star = paths.find((p) => isStarfieldTarget(p));
    if (star && !(await ask({ title: 'Starfield', text: `${star.split('/').pop()} is not available for auto extraction.\n\nContinue without auto-extract?`, ok: 'Continue' }))) { say('Download cancelled'); return; }
    for (let i = 0; i < paths.length; i++) { if (!(await passGates(paths[i], rem, i > 0))) { say('Download cancelled'); return; } }
    const r = await api.downloadBatch(rem, paths, []);
    if (r.ok) { say('Started ' + paths.length + ' item' + (paths.length === 1 ? '' : 's')); setBatch(false); setView('downloads'); } else say(r.error.message || 'Could not start the batch download');
  };
  const signIn = async () => { await api.login(); boot(); };

  if (status && !status.signedIn) return html`<div class="center"><h1>ARMGDDN</h1><p>Sign in to browse the library.</p><button class="primary" onClick=${signIn}>Sign in with Telegram</button></div>`;
  return html`<div class="shell">
    <header>
      <div class="brand">ARMGDDN</div>
      <button class=${view === 'home' ? 'tab on' : 'tab'} onClick=${() => setView('home')}>Home</button>
      <nav>${tabs.map((t) => html`<button class=${view === 'library' && t === remote ? 'tab on' : 'tab'} onClick=${() => { setCategory(''); setView('library'); autoOk.current = true; setRemote(t); setFolder(''); setQuery(''); }}>${t}</button>`)}</nav>
      <button class=${view === 'settings' ? 'tab on' : 'tab'} title="Settings" onClick=${() => setView('settings')}>Settings</button>
      <button class=${view === 'wiki' ? 'tab on' : 'tab'} onClick=${() => setView('wiki')}>Wiki</button>
      <button class=${view === 'mylist' ? 'tab on' : 'tab'} onClick=${() => setView('mylist')}>My List${myList.length ? html` <span class="badge">${myList.length}</span>` : ''}</button>
      <button class=${view === 'requests' ? 'tab on' : 'tab'} onClick=${() => setView('requests')}>Requests</button>
      <button class=${view === 'downloads' ? 'tab on' : 'tab'} onClick=${() => setView('downloads')}>Downloads${activeCount ? html` <span class="badge">${activeCount}</span>` : ''}</button>
      ${view === 'library' ? html`<${Fragment}>
      <label class="everywhere" title="Search every section, not just this list"><input type="checkbox" checked=${everywhere} onChange=${(e) => { setEverywhere(e.target.checked); setView('library'); }} /> Everywhere</label>
      <input class="search" type="search" placeholder=${everywhere ? "Search every section" : "Search this list"} value=${query} onInput=${(e) => setQuery(e.target.value)} />
      ${cats.length ? html`<select value=${category} onChange=${(e) => setCategory(e.target.value)}><option value="">All categories</option>${cats.slice(0, 80).map((c) => html`<option value=${c.name}>${c.name} (${c.count})</option>`)}</select>` : ''}
      <select value=${sort} onChange=${(e) => setSort(e.target.value)}><option value="name">Name</option><option value="popularity">Popularity</option><option value="newest">Added</option><option value="released">Released</option><option value="size">Size</option></select>
      <button class="tab" title="Reverse the order" onClick=${() => setReverse(!reverse)}>${reverse ? '\u2191' : '\u2193'}</button>
      ${batchOk ? html`<label class="everywhere" title="Pick several items and download them together"><input type="checkbox" checked=${batchOn} onChange=${(e) => setBatch(e.target.checked)} /> Batch</label>` : ''}
      ${batchActive ? html`<label class="everywhere"><input type="checkbox" checked=${allPicked} onChange=${(e) => setPicked(e.target.checked ? new Set(shown.map(itemKeyOf)) : new Set())} /> Select all</label><button class="primary" disabled=${!picked.size} onClick=${startBatch}>Download ${picked.size || ''} selected</button>` : ''}
      ${!everywhere && remote ? html`<select value="" title="Save this section's titles and sizes as a file" onChange=${async (e) => { const fmt = e.target.value; e.target.value = ''; if (!fmt) return; say('Preparing the list...'); const r = await api.exportList(remote, fmt); say(r.ok ? (r.data.saved ? 'Saved ' + r.data.name : 'Cancelled') : (r.error.message || 'Could not export this list')); }}><option value="">Export list</option><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option></select>` : ''}
      </${Fragment}>` : ''}
    </header>
    ${view === 'home' ? html`<${HomeView} myList=${myList} onOpenTrend=${openTrend} render=${(it, tag) => html`<${Card} key=${tag + (it._remote || '') + '/' + it._folder + '/' + it.name} item=${it} remote=${it._remote} folder=${it._folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${myList.some((m) => m.remote === it._remote && m.path === itemPath(it))} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : view === 'settings' ? html`<${SettingsView} say=${say} onPrefs=${applyPrefs} />` : view === 'wiki' ? html`<${WikiView} />` : view === 'mylist' ? html`<${MyListView} list=${myList} render=${(it) => html`<${Card} key=${it.remote + '/' + it.path} item=${it} remote=${it._remote} folder=${it._folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${true} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : view === 'requests' ? html`<${RequestsView} say=${say} openId=${openRequest} />` : view === 'downloads' ? html`<${DownloadsView} list=${downloads} />` : html`<${Fragment}>
    <div class="crumbs" style=${everywhere ? "display:none" : ""}><button onClick=${() => { autoOk.current = false; setFolder(crumbs.root); }}>${remote || ''}</button>${crumbs.items.map((c) => html`<span> / <button onClick=${() => setFolder(c.path)}>${c.label}</button></span>`)}
      <span class="credit">Created by Old Man of the Hills v${(status && status.version) || ''}</span><span class="count">${items ? `${shown.length}${shown.length !== items.length ? ' of ' + items.length : ''} items` : ''}</span></div>
    ${error ? html`<div class="notice">${error.message}${error.kind === 'auth' ? html` <button class="primary" onClick=${signIn}>Sign in again</button>` : ''}</div>` : ''}
    ${items !== null && sort === 'name' ? html`<${AlphaBar} letters=${lettersPresent(shown)} />` : ''}
    ${everywhere && view === 'library' ? html`<${EverywhereResults} index=${index} query=${query} render=${(it) => html`<${Card} key=${it._remote + '/' + it.path} item=${it} remote=${it._remote} folder=${it._folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${inMyList(it)} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : ''}
    ${everywhere && view === 'library' ? '' : items === null ? html`<div class="loading">Loading…</div>` : html`<main class=${"grid " + shapeFor(remote)}>${shown.map((it) => html`<${Card} key=${it.path || it.name} item=${it} remote=${remote} folder=${folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${inMyList(it)} onToggleList=${toggleList} batch=${batchActive ? { selected: picked.has(itemKeyOf(it)), toggle: () => togglePick(it) } : null} onOpen=${(x) => { setFolder(folder ? folder + '/' + x.name : x.name); setQuery(''); }} />`)}</main>`}
    </${Fragment}>`}
    ${details ? html`<${DetailsModal} item=${details} remote=${ctxRemote(details)} folder=${ctxFolder(details)} onClose=${() => setDetails(null)} onDownload=${startDownload} onBrowse=${browseInto} />` : ''}
    ${preview ? html`<${PreviewModal} item=${preview} onClose=${() => setPreview(null)} />` : ''}
    ${patchQ ? html`<${PatchModal} q=${patchQ} />` : ''}
    ${gate ? html`<${GateModal} gate=${gate} />` : ''}
    ${toast ? html`<div class="toast">${toast}</div>` : ''}
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
