import './toTop.mjs';
import { html, render, useState, useEffect, useMemo, Fragment, useRef, Component } from '../../native/vendor/ui.mjs';
import { isHiddenItem, formatSize, releaseYear, cleanTitle, filterAndSort, autoEnter, shapeFor, crumbsFor, visibleItems, collectionCoverPath, coverFills, formatSpeed, elapsedShown, popularityLabel, trendingSets, batchEligible, batchPaths, PREFS_SNIPPET, parsePrefs, normalizePrefs, mergeMyList, homeItem, picksFrom, isActiveDownload, canDownload, downloadActions, letterOf, lettersPresent, statusInfo, shortDate, detailLines, steamLinks, dayKey, trailerSource, isPatchFolder, patchOldRepackLabel, mayHavePatchQuestion, isStarfieldTarget, MY_LIST_KEY, myListHas, myListToggle, categoryCounts, filterByCategory, wikiHtmlForApp, wikiSectionFor, searchEverywhere, compareLines, startedLine, introDecision, versionBadges, bundlesPresent, searchFuzzy, otherSectionMatches, stubNotice, quotaTabs, comicTitle, comicParts, fileSuffix, etaShown, isRunningDownload, formatMiBps, activeFileRows, splitDownloads, bytesLeft, downloadPlace, rankTrending, buildNumber, speedInUnit, bytesDone, finishingStage, finishingText, downloadSteps, nearestCard, downloadAnnouncement , finishedText } from './format.mjs';

import { mountLoginLightning } from './loginLightning.mjs';
import { RADAR_CARDS, RADAR_HISTORY_MAX, isRadarRemote, radarGroup, radarPath, radarKey, radarTitle, radarPicks } from './radar.mjs';

import { AdminView } from './admin.mjs';
import { THEME_MODES, effectiveMode, themeFor, loadChoice, withWebsiteTheme, withTheme, themesForMode } from './themeMode.mjs';
import { OwnerDock } from './ownerDock.mjs';
const api = window.nativeAPI;
try { api.getSettings().then((r) => { if (r && window.setLiteGraphics) window.setLiteGraphics(!!r.lightGraphics); }).catch(() => { }); } catch (e) { }   // the Lighter graphics setting, applied as the window opens

// Themes: the website's palettes (renderer/native/themes.json, made by scripts/extract_themes.py). The choice is remembered on this PC; "System" follows the computer's light or dark setting.
let THEMES = {};
try { THEMES = (await import('./themes.json', { with: { type: 'json' } })).default || {}; } catch (e) { THEMES = {}; }
// Hand-made themes live in their own files (themes-custom.json and themes-custom.css), so the script that rewrites themes.json and themes.css never touches them.
try { THEMES = { ...THEMES, ...((await import('./themes-custom.json', { with: { type: 'json' } })).default || {}) }; } catch (e) { }
const themeKeyOk = (id) => id === 'system' || Object.prototype.hasOwnProperty.call(THEMES, id);
function applyTheme(choice) {
  const id = themeKeyOk(choice) ? choice : 'dark';
  let useId = id;
  if (id === 'system') { let light = false; try { light = window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { } useId = light && THEMES.light ? 'light' : 'dark'; }
  const t = THEMES[useId] || THEMES.dark;
  if (!t) return;
  const root = document.documentElement.style;
  const set = (k, v) => { if (v) root.setProperty(k, v); else root.removeProperty(k); };
  set('--bg', t.bg); set('--panel', t.panel); set('--fg', t.fg); set('--dim', t.dim); set('--line', t.line); set('--accent', t.accent); set('--accent2', t.accent2);
  set('--on-accent', t.onAccent); set('--rc', t.radius || '10px'); set('--page', t.page); set('--page-color', t.pageColor);
  // The theme's own variables (the website's names, used by its rules) and its name, so the translated theme rules in themes.css apply.
  for (const k of (applyTheme.lastVars || [])) root.removeProperty(k);
  applyTheme.lastVars = Object.keys(t.vars || {});
  for (const [k, v] of Object.entries(t.vars || {})) root.setProperty(k, v);
  document.documentElement.dataset.theme = useId;
  root.setProperty('color-scheme', t.mode === 'light' ? 'light' : 'dark');
}
// Harbor is the default for everyone from 6.9.0 (George, Nov 24 2026; it was a staff test before). Anyone still on the old default ("dark",
// now called Classic) moves to Harbor once; any other choice (Light, System, a website theme) stays. Classic is one click away in the menu.
const DEFAULT_THEME = 'harbor';
try {
  if (!localStorage.getItem('native.harborDefault')) {
    const t = localStorage.getItem('native.theme');
    if (!t || t === 'dark') localStorage.setItem('native.theme', DEFAULT_THEME);
    localStorage.setItem('native.harborDefault', '1');
  }
} catch (e) { }
const osLight = () => { try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { return false; } };
const lsRaw = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
// Saves the mode, each mode's theme, and the theme on screen (themeMode.mjs); returns the choice so it can be handed to setState.
function persistChoice(c) {
  try { localStorage.setItem('native.themeMode', c.mode); localStorage.setItem('native.theme.dark', c.dark); localStorage.setItem('native.theme.light', c.light); localStorage.setItem('native.theme', themeFor(c, osLight())); } catch (e) { }
  return c;
}
applyTheme(themeFor(loadChoice(THEMES, lsRaw), osLight()));
// A hidden or minimised window draws nothing anyone sees: CSS animations pause until it is shown again (native.css, html[data-hidden]).
try {
  const markHidden = () => { if (document.hidden) document.documentElement.dataset.hidden = '1'; else delete document.documentElement.dataset.hidden; };
  document.addEventListener('visibilitychange', markHidden); markHidden();
} catch (e) { }
const GROUPS = { 'PC Games': ['PC-1', 'PC-2', 'PC-3'], 'PCVR Games': ['PCVR-1', 'PCVR-2', 'PCVR-3'] };
// Something clicked that is not a button (a row, a pill, a picture) also answers Enter and Space, so the keyboard reaches it (docs/BEST_PRACTICES.md).
const kbdClick = (fn) => (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(e); } };
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

const TEXT_FILE_RE = /\.(txt|md|nfo|log|ini|cfg|conf|diz)$/i;
function isReadableText(item) { return !item.isDir && TEXT_FILE_RE.test(String(item.name || '')) && item.size !== 0; }   // a 0 KB file has nothing to read

function TextFileModal({ remote, path, name, onClose }) {
  const [r, setR] = useState(null);
  useEffect(() => { api.textFile(remote, path).then((x) => setR(x && x.ok && x.data && x.data.success ? x.data : { error: (x && x.data && x.data.error) || 'This file could not be read.' })).catch(() => setR({ error: 'This file could not be read.' })); }, []);
  return html`<${Modal} title=${name} onClose=${onClose} wide=${true}>${r === null ? html`<div class="loading">Loading…</div>` : r.error ? html`<div class="notice">${r.error}</div>` : html`<pre class="readme">${r.content}${r.truncated ? '\n\n[SHOWING THE FIRST 1 MB ONLY]' : ''}</pre>`}</${Modal}>`;
}

function Card({ item, onOpen, remote, folder, onDownload, onDetails, onPreview, inList, onToggleList, batch, listMode, badge, onStub, platform }) {
  const [broken, setBroken] = useState(false);
  const [reading, setReading] = useState(false);
  const canRead = isReadableText(item);
  const readEl = canRead ? html`<button class="dl" title="Read this file" onClick=${(e) => { e.stopPropagation(); setReading(true); }}>Read</button>` : '';
  const readModal = reading ? html`<${TextFileModal} remote=${remote} path=${[folder, item.name].filter(Boolean).join('/')} name=${item.name} onClose=${() => setReading(false)} />` : '';
  const stub = onStub ? stubNotice(remote, folder, item) : null;   // a folder under 1 KB points to the other server
  const canDl = canDownload(remote, folder, item) && !stub;
  const shownTitle = comicTitle(item);
  const suffix = !item.isDir && !item.comic ? fileSuffix(item.name) : '';   // a file inside a game folder says which piece it is
  const suffixEl = suffix ? html`<span class="fext">${suffix}</span>` : '';
  const cv = item.comic && item.comic.comicvine;
  const badgeEl = badge ? html`<span class=${'vbadge ' + badge}>${badge === 'newest' ? 'Newest' : 'Older'}</span>` : '';
  // On the Home strips a card does not sit under a PC Games or PCVR Games tab, so it says which one it is.
  const platformEl = platform ? html`<span class=${'pbadge ' + platform.toLowerCase()} title=${platform === 'PCVR' ? 'In the PCVR Games section' : 'In the PC Games section'}>${platform}</span>` : '';
  const cvEl = cv ? html`<a class="cvbadge" href="#" title="Details on ComicVine" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); api.openLink(cv); }}>ComicVine</a>` : '';
  const stubEl = stub ? html`<div class="stubnote">${stub.message} <button class="dl ghost" onClick=${(e) => { e.stopPropagation(); onStub(stub); }}>Go there</button></div>` : '';
  const cover = !broken && ((item.coverArt && item.coverArt.cover && item.coverArt.cover.url) || collectionCoverPath(remote, folder, item));
  const year = releaseYear(item);
  const gameSection = ['PC Games', 'PCVR Games', 'Testing'].includes(remote);
  const coverClick = gameSection && cover && item.isDir ? () => onPreview(item) : (item.isDir ? () => onOpen(item) : null);
  // Keyboard (Nov 24 2026): a card can be focused with Tab or the arrow keys; Enter opens it the way a click on its art does (a file you can read opens to read).
  const cardKey = (e) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    const go = item.isDir ? (coverClick || (() => onOpen(item))) : (canRead ? () => setReading(true) : null);
    if (go) { e.preventDefault(); go(); }
  };
  if (listMode) {
    // The list view: one line per title, no art, like the legacy browser.
    return html`<div class=${'lrow' + (batch && batch.selected ? ' picked' : '')} data-letter=${letterOf(item.name)} title=${item.name} tabIndex="0" aria-label=${shownTitle} onKeyDown=${cardKey}>
      ${batch ? html`<label class="bsel" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${batch.selected} onChange=${batch.toggle} /></label>` : ''}
      <span class="ltitle" data-kbd="card" onClick=${item.isDir ? () => onOpen(item) : undefined}>${shownTitle}${badgeEl}</span>${suffixEl}${platformEl}
      <span class="lsub">${[year, ...comicParts(item), formatSize(item.size), popularityLabel(item)].filter(Boolean).join(' · ')}${cvEl}</span>
      ${stub ? html`<span class="stubnote inline">${stub.message} <button class="dl ghost" onClick=${(e) => { e.stopPropagation(); onStub(stub); }}>Go there</button></span>` : ''}
      <span class="lbtns">${item.isDir ? html`<button class=${'dl heart' + (inList ? ' on' : '')} title=${inList ? 'Remove from My List' : 'Add to My List'} aria-label=${inList ? 'Remove from My List' : 'Add to My List'} onClick=${(e) => { e.stopPropagation(); onToggleList(item); }}>${inList ? '\u2665' : '\u2661'}</button>` : ''}
      ${item.isDir ? html`<button class="dl ghost" title="Browse" onClick=${(e) => { e.stopPropagation(); onOpen(item); }}>Browse</button>` : ''}
      ${item.isDir && canDl && !isPatchFolder(item.name) ? html`<button class="dl ghost" title="Details" onClick=${(e) => { e.stopPropagation(); onDetails(item); }}>Details</button>` : ''}
      ${canRead ? readEl : canDl ? html`<button class="dl" title="Download" onClick=${(e) => { e.stopPropagation(); onDownload(item); }}>Download</button>` : ''}</span>${readModal}
    </div>`;
  }
  return html`<div class=${'card' + (batch && batch.selected ? ' picked' : '')} data-letter=${letterOf(item.name)} title=${item.name} tabIndex="0" aria-label=${shownTitle} onKeyDown=${cardKey}>
    ${batch ? html`<label class="bsel" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${batch.selected} onChange=${batch.toggle} /></label>` : ''}
    <div class=${"cover" + (coverClick ? " clickable" : "")} data-kbd="card" onClick=${coverClick || undefined}>${cover ? html`<img class="cbg" aria-hidden="true" loading="lazy" decoding="async" src=${coverSrc(cover)} alt="" /><img class="cfg" loading="lazy" decoding="async" src=${coverSrc(cover)} alt="" onLoad=${(e) => { const im = e.target; im.classList.toggle('fill', coverFills(im.naturalWidth, im.naturalHeight, shapeFor(remote))); }} onError=${() => setBroken(true)} />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
    <div class="meta"><div class=${'title' + (platform ? ' withp' : '') + (item.isDir ? ' clickable' : '')} data-kbd="card" onClick=${item.isDir ? () => onOpen(item) : undefined}>${platform ? html`<span class="ttext">${shownTitle}${badgeEl}</span>${platformEl}` : html`${shownTitle}${badgeEl}`}</div>
      ${suffixEl ? html`<div class="fextrow">${suffixEl}</div>` : ''}
      <div class="sub">${[year, ...comicParts(item), formatSize(item.size), popularityLabel(item)].filter(Boolean).join(' · ')}${cvEl}</div>${stubEl}
      <div class="cbtns">${item.isDir ? html`<button class=${'dl heart' + (inList ? ' on' : '')} title=${inList ? 'Remove from My List' : 'Add to My List'} aria-label=${inList ? 'Remove from My List' : 'Add to My List'} onClick=${(e) => { e.stopPropagation(); onToggleList(item); }}>${inList ? '\u2665' : '\u2661'}</button>` : ''}
      ${item.isDir ? html`<button class="dl ghost" title="Browse" onClick=${(e) => { e.stopPropagation(); onOpen(item); }}>Browse</button>` : ''}
      ${item.isDir && canDl && !isPatchFolder(item.name) ? html`<button class="dl ghost" title="Details" onClick=${(e) => { e.stopPropagation(); onDetails(item); }}>Details</button>` : ''}
      ${canRead ? readEl : canDl ? html`<button class="dl" title="Download" onClick=${(e) => { e.stopPropagation(); onDownload(item); }}>Download</button>` : ''}</div></div>${readModal}
  </div>`;
}


function AlphaBar({ letters }) {
  // The bar sits inside the list's own area (below the two top bars, above the update bar), whatever size the window is, in grid or list view.
  const [box, setBox] = useState(null);
  const measure = () => {
    const el = document.querySelector('main.grid, main.list');
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox((old) => (old && Math.abs(old.top - r.top) < 1 && Math.abs(old.height - r.height) < 1 ? old : { top: r.top, height: r.height }));
  };
  useEffect(() => {
    measure();
    const t = setInterval(measure, 500);
    window.addEventListener('resize', measure);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); };
  }, [letters.length]);
  const jump = (l) => { const el = document.querySelector('main [data-letter="' + l + '"]'); if (el) el.scrollIntoView({ block: 'start' }); };
  if (letters.length < 2 || !box) return '';
  return html`<div class="alphawrap" style=${'top:' + Math.round(box.top) + 'px;height:' + Math.round(box.height) + 'px'}><div class="alpha">${letters.map((l) => html`<button onClick=${() => jump(l)}>${l}</button>`)}</div></div>`;
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return html`<div class="overlay" onClick=${onClose}><div class=${'modal' + (wide ? ' wide' : '')} onClick=${(e) => e.stopPropagation()}>
    <div class="mhead"><div class="mtitle">${title}</div><button class="dbtn" onClick=${onClose}>Close</button></div>${children}</div></div>`;
}

// Crash reports need the member's answer (Nov 24 2026, docs/BEST_PRACTICES.md). Asked once, on the first start or the first start after the update
// that added it; until then reports work as they always have. Either answer, or changing the setting, is remembered (errorReportingAsked).
function ErrorReportingAsk({ onDone }) {
  const answer = async (on) => { try { await api.saveSettings({ errorReporting: on, errorReportingAsked: true }); } catch (e) { } onDone(on); };
  return html`<${Modal} title="Help fix crashes?" onClose=${() => onDone(null)}>
    <div class="askbody">
      <p>When the app crashes or runs into an error, it can send a short report to ARMGDDN so it can be fixed.</p>
      <p>A report says what went wrong, the app version and your system (Windows, Mac or Linux). It never includes your name, Telegram account,
        IP address or your files. When a download fails, the report names the title that failed, so the failure can be traced.</p>
      <p class="sval">You can change this any time in Settings, under Send error reports.</p>
      <div class="askbtns"><button class="primary" onClick=${() => answer(true)}>Send reports</button><button class="dbtn" onClick=${() => answer(false)}>Don't send</button></div>
    </div>
  </${Modal}>`;
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

// Harbor: a game's page as in the mockup: a tinted top with the cover and the facts, how to get it running, and other big titles of the same kind.
function HarborTitle({ item, remote, folder, art, cover, cats, trailer, readme, onClose, onDownload, onBrowse, onTrailer, onReadme, actions, onOpenTrend }) {
  const shape = shapeFor(remote);                                     // wide game art, square album art, tall comic covers
  const isGame = ['PC Games', 'PCVR Games', 'Testing'].includes(remote);
  const [windows, setWindows] = useState(null);
  useEffect(() => { api.trending().then((r) => setWindows(r.ok && r.data && r.data.windows ? r.data.windows : {})); const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const vr = remote === 'PCVR Games';
  const kind = vr ? 'VR' : 'PC';
  const dl30 = Number(item.downloadCount || 0);
  const date = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
  const size = formatSize(item.size && Number(item.size) >= 1024 ? item.size : (item.crossRemoteSize || item.size));
  const build = buildNumber(item.name);
  const rel = date(item.releaseDate || art.releaseDate);
  const also = useMemo(() => rankTrending(windows && windows.month, { vr, exclude: [cleanTitle(item.name)], needCover: true, limit: 4 }), [windows, item.name]);
  const facts = [['Size', size], ['Build', build && (build + (item.modTime && date(item.modTime) ? ', updated ' + date(item.modTime) : ''))], ['Downloads, 30 days', dl30 > 0 ? dl30.toLocaleString('en-US') : ''], ['Released', rel], ['Genre', cats.slice(0, 4).join(', ')], ['Folder', item.name]].filter(([, v]) => v);
  return html`<div class="hb-page"><div class="hb-pagein">
    <section class="hb-thero">
      ${cover ? html`<img class="hb-herobg" src=${coverSrc(cover)} alt="" aria-hidden="true" />` : ''}
      <div class="hb-theroin">
        <nav class="hb-crumbs"><button onClick=${onClose}>${'← Back'}</button><span>${remote || 'Library'}</span><span aria-hidden="true">/</span><span>${cleanTitle(item.name)}</span></nav>
        <div class="hb-tmain">
          ${cover ? html`<img class=${'hb-heroart ' + shape} src=${coverSrc(cover)} alt=${cleanTitle(item.name)} />` : html`<div class=${'hb-heroart none ' + shape}>${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}
          <div class="hb-herotext">
            ${item.modTime && date(item.modTime) ? html`<span class="hb-kick">${isGame ? 'New build on' : 'Updated'} ${date(item.modTime)}${dl30 > 0 ? ' · ' + dl30.toLocaleString('en-US') + ' downloads in 30 days' : ''}</span>` : ''}
            <h1>${cleanTitle(item.name)}</h1>
            <dl class="hb-dl">${facts.map(([k, v]) => html`<${Fragment}><dt>${k}</dt><dd class=${k === 'Folder' ? 'folder' : ''}>${v}</dd></${Fragment}>`)}</dl>
            <div class="hb-actions">
              <button class="hb-go" onClick=${() => { onClose(); onDownload(item); }}>Download${size ? ' ' + size : ''}</button>
              ${actions ? html`<button class="hb-ghost" onClick=${() => actions.toggle(item)}>${actions.inList(item) ? 'In My List' : 'Add to My List'}</button>` : ''}
              ${trailer ? html`<button class="hb-text" onClick=${onTrailer}>Watch trailer</button>` : ''}
              <button class="hb-text" onClick=${() => { onClose(); onBrowse(item); }}>Browse files</button>
              <button class="hb-text" disabled=${!readme} onClick=${onReadme}>${readme === null ? 'Checking README...' : 'Read README'}</button>
              ${steamLinks(item).map(([n, u]) => html`<a class="hb-text" href="#" onClick=${(e) => { e.preventDefault(); api.openLink(u); }}>${n}</a>`)}
            </div>
          </div>
        </div>
      </div>
    </section>
    ${isGame ? html`<section class="hb-sec"><h3>Getting it running</h3>
      <ol class="hb-steps">
        <li><b>1</b><h4>Download</h4><p>The app fetches every part, checks each one, and picks up where it left off if your connection drops.</p></li>
        <li><b>2</b><h4>Extract</h4><p>With Auto-extract on, the app unpacks it for you. Otherwise right-click the first part and choose Extract Here. Leave room for the download plus the extracted game.</p></li>
        <li><b>3</b><h4>Install and play</h4><p>${vr ? 'Most VR games need a headset running SteamVR, though some games and launch methods get around it. Install the game from the extracted folder. Then start your headset with the launch method of your choice (not Steam Link), open the desktop view, and launch the game from its desktop or Start menu icon there.' : 'Install the game from the extracted folder, then start it from the desktop or Start menu icon the installer creates.'}</p></li>
      </ol>
    </section>` : ''}
    ${isGame && also.length ? html`<section class="hb-sec"><div class="hb-sechead"><h3>Also big in ${kind}</h3><span>Most downloaded, last 30 days</span></div>
      <div class="hb-also">${also.map((e) => html`<button key=${e.path} onClick=${() => { onClose(); onOpenTrend(e); }}><img src=${coverSrc(e.coverUrl)} alt="" /><b>${cleanTitle(e.title)}</b><span>${e.count.toLocaleString('en-US')} downloads${e.sizeBytes ? ' · ' + formatSize(e.sizeBytes) : ''}</span></button>`)}</div></section>` : ''}
  </div></div>`;
}

function DetailsModal({ item, remote, folder, onClose, onDownload, onBrowse, harbor, actions, onOpenTrend }) {
  const [playing, setPlaying] = useState(false);
  const trailer = trailerSource((item.coverArt || {}).trailer);
  const art = item.coverArt || {};
  // Comics and Music have no Steam-style art: use the same picture the library card shows (the collection or album cover), 960 px wide here.
  const cover = (art.cover && art.cover.url) || collectionCoverPath(remote, folder, item).replace(/&w=\d+$/, '&w=960');
  const [readme, setReadme] = useState(null);   // null = checking, false = none, object = found
  const [showReadme, setShowReadme] = useState(false);
  const path = [folder, item.name].filter(Boolean).join('/');
  useEffect(() => { api.readme(remote, path).then((r) => setReadme(r.ok && r.data && r.data.found && r.data.contentHash ? r.data : false)); }, []);
  const cats = Array.isArray(art.categories) ? art.categories.filter(Boolean).slice(0, 10) : [];
  if (playing && trailer) return html`<${TrailerModal} title=${cleanTitle(item.name)} src=${trailer} onClose=${() => setPlaying(false)} />`;
  if (showReadme && readme) return html`<${Modal} title=${'README - ' + cleanTitle(item.name)} onClose=${() => setShowReadme(false)} wide=${true}><pre class="readme">${readme.content}${readme.truncated ? '\n\n[README PREVIEW TRUNCATED]' : ''}</pre></${Modal}>`;
  if (harbor) return html`<${HarborTitle} item=${item} remote=${remote} folder=${folder} art=${art} cover=${cover} cats=${cats} trailer=${trailer} readme=${readme} onClose=${onClose} onDownload=${onDownload} onBrowse=${onBrowse} onTrailer=${() => setPlaying(true)} onReadme=${() => setShowReadme(true)} actions=${actions} onOpenTrend=${onOpenTrend} />`;
  return html`<${Modal} title=${cleanTitle(item.name)} onClose=${onClose} wide=${true}>
    <div class="dhead">
      <div class=${'dcover ' + shapeFor(remote)}>${cover ? html`<img src=${coverSrc(cover)} alt="" />` : html`<div class="nocover">${(cleanTitle(item.name)[0] || '?').toUpperCase()}</div>`}</div>
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

// The badge page: every badge as earned (pick one to wear), locked (what it takes and how far along you are), or HIDDEN (secret until earned).
const FAMILY_ORDER = ['Downloads', 'Explorer', 'Consistency', 'Community', 'Craft'];
function BadgesView({ say }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const load = async () => { const r = await api.badges(); if (r.ok && r.data) { setData(r.data); setError(null); } else { setError((r.error && r.error.message) || 'Could not load your badges'); setData({ items: [] }); } };
  useEffect(() => { load(); }, []);
  const choose = async (id) => {
    const r = await api.badgeChoose(id);
    if (r.ok) { say(id ? 'Badge chosen. It shows next to your name soon.' : 'Back to your rarest badge.'); load(); } else say((r.error && r.error.message) || 'Could not change your badge');
  };
  if (!data) return html`<div class="reqpane"><div class="loading">Loading your badges…</div></div>`;
  const items = data.items || [];
  const shown = items.filter((i) => filter === 'all' ? true : filter === 'earned' ? i.state === 'earned' : filter === 'locked' ? i.state === 'locked' : i.state === 'hidden');
  const groups = [...FAMILY_ORDER, ...new Set(items.map((i) => i.family).filter((f) => !FAMILY_ORDER.includes(f)))];
  const pct = data.permanentTotal ? Math.round((data.permanentHave / data.permanentTotal) * 100) : 0;
  return html`<div class="reqpane badgepage">
    <h2>Badges <span class="chip">${data.earnedCount || 0} of ${data.total || 0}</span></h2>
    <div class="sub">Just for fun: badges give no rewards. Earn them by using ARMGDDN, and pick the one that shows next to your name.</div>
    <div class="bprog" title=${data.permanentHave + ' of ' + data.permanentTotal + ' permanent badges'}><div class="bprogbar"><i style=${'width:' + pct + '%'}></i></div><span>${pct}% of the way to Badge Collector Supreme</span></div>
    ${data.hiddenLeft ? html`<div class="sub">${data.hiddenLeft} secret badge${data.hiddenLeft === 1 ? '' : 's'} left to discover.</div>` : ''}
    ${error ? html`<div class="notice">${error}</div>` : ''}
    <div class="bfilter">${['all', 'earned', 'locked', 'hidden'].map((f) => html`<button class=${filter === f ? 'tab on' : 'tab'} onClick=${() => setFilter(f)}>${f[0].toUpperCase() + f.slice(1)}</button>`)}
      ${data.chosen ? html`<button class="dbtn" title="Go back to showing your rarest badge" onClick=${() => choose(null)}>Use my rarest badge</button>` : html`<span class="sub">Wearing your rarest badge</span>`}</div>
    ${groups.map((g) => { const list = shown.filter((i) => i.family === g); return list.length ? html`<section key=${g}><h3>${g}</h3><div class="bgrid">${list.map((i) => html`<${BadgeCard} key=${i.id} b=${i} worn=${data.chosen === i.id} onWear=${choose} />`)}</div></section>` : ''; })}
  </div>`;
}
function BadgeCard({ b, worn, onWear }) {
  if (b.state === 'hidden') return html`<div class="bcard hidden" title="A secret badge"><div class="bemoji">❔</div><div class="bname">HIDDEN</div><div class="bdesc">${b.hint || 'Keep exploring to find out.'}</div></div>`;
  const earned = b.state === 'earned';
  const pct = !earned && b.need ? Math.min(100, Math.floor(((b.have || 0) / b.need) * 100)) : 0;
  // An earned secret badge is gold and says it was secret and how rare it is (George, Nov 24 2026).
  const gold = earned && b.secret;
  return html`<div class=${'bcard ' + (earned ? 'earned' : 'locked') + (gold ? ' gold' : '') + (worn ? ' worn' : '')}>
    ${gold ? html`<div class="bsecret" title="A secret badge you discovered">\u2726 Secret${b.rarity ? ' \u00b7 ' + b.rarity : ''}</div>` : ''}
    <div class="bemoji">${b.emoji}</div><div class="bname">${b.name}</div>
    <div class="bdesc">${b.desc}${b.steps > 1 ? ' (step ' + b.step + ' of ' + b.steps + ')' : ''}</div>
    ${!earned && b.need ? html`<div class="bprogbar" title=${(b.have || 0).toLocaleString('en-US') + ' of ' + b.need.toLocaleString('en-US') + (b.unit ? ' ' + b.unit : '')}><i style=${'width:' + pct + '%'}></i></div><div class="bnum">${(b.have || 0).toLocaleString('en-US')} / ${b.need.toLocaleString('en-US')}</div>` : ''}
    ${earned ? html`<div class="bnum">${b.holdersPct != null ? b.holdersPct + '% of members have this' : ''}</div><button class=${worn ? 'dbtn on' : 'dbtn'} disabled=${worn} onClick=${() => onWear(b.id)}>${worn ? 'Wearing' : 'Wear this'}</button>` : ''}
  </div>`;
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
      <div class="thread">${thread === null ? html`<div class="loading">Loading…</div>` : thread.length ? thread.map((c) => html`<div class=${'msg' + (c.system ? ' sys' : '')} key=${c.id}><div class="who">${c.authorName || c.username || (c.role === 'staff' ? 'Staff' : 'You')} · ${shortDate(c.createdAt)}</div><div>${c.message || c.text}</div></div>`) : html`<div class="empty">No messages yet.</div>`}</div>
      <div class="compose"><input type="text" maxlength="500" placeholder="Write a message…" aria-label="Write a message…" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} /><button class="primary" onClick=${send}>Send</button></div>
    </div>`;
  }
  return html`<div class="reqpane">
    <div class="reqhead"><h2>My requests</h2><button class="primary" onClick=${() => setForm({ category: 'Music', title: '', notes: '' })}>New request</button></div>
    ${error ? html`<div class="notice">${error.message}</div>` : ''}
    ${form ? html`<div class="reqform">
      <select aria-label="What to request" value=${form.category} onChange=${(e) => setForm({ ...form, category: e.target.value })}><option>Music</option><option>Comics</option></select>
      <input type="text" maxlength="200" placeholder="Artist and album, or comic series" aria-label="Artist and album, or comic series" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} />
      <input type="text" maxlength="500" placeholder="Notes (optional)" aria-label="Notes (optional)" value=${form.notes} onInput=${(e) => setForm({ ...form, notes: e.target.value })} />
      <div class="dbtns"><button class="primary" onClick=${submit}>Send request</button><button class="dbtn" onClick=${() => setForm(null)}>Cancel</button></div>
      <div class="sub">Game requests are closed for now.</div>
    </div>` : ''}
    ${list === null ? html`<div class="loading">Loading…</div>` : list.length ? html`<div class="dlist">${list.map((r) => { const [label, tone] = statusInfo(r.status); return html`<div class="drow clickable" key=${r.id} tabIndex="0" role="button" onKeyDown=${kbdClick(() => openThread(r))} onClick=${() => openThread(r)}>
      <div class="dname">#${r.id} ${r.gameTitle}<span><span class=${'chip ' + tone}>${label}</span>${r.unreadCount ? html` <span class="badge">${r.unreadCount}</span>` : ''}</span></div>
      <div class="dmeta">${r.category} · ${shortDate(r.createdAt)}</div></div>`; })}</div>` : html`<div class="empty">You haven't made any requests.</div>`}
  </div>`;
}

function MyListView({ list, render, listMode }) {
  if (!list.length) return html`<div class="empty">Your list is empty. Press the heart on a game, album or comic to save it here.</div>`;
  // The heading only shows in the Harbor theme (themes-custom.css); other themes keep the page as it was.
  return html`<main class=${listMode ? 'list' : 'grid wide'}><div class="hb-listhead"><b>My List</b><span>${list.length} saved</span></div>${list.slice().reverse().map((e) => render({ ...e, isDir: true, _remote: e.remote, _folder: String(e.path || e.name).split('/').slice(0, -1).join('/') }))}</main>`;
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
  if (!cur) return html`<div class="empty">The Wiki is not available.</div>`;
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

function EverywhereResults({ index, query, render, onWatch, onWatchlist }) {
  const exact = useMemo(() => (index ? searchEverywhere(index, query) : []), [index, query]);
  const fuzzy = useMemo(() => (index && !exact.length ? searchFuzzy(index, query) : []), [index, query, exact]);
  const found = exact.length ? exact : fuzzy;
  const badges = useMemo(() => versionBadges(found), [found]);
  if (!index) return html`<div class="loading">Loading every section so it can be searched...</div>`;
  if (!query.trim()) return html`<div class="empty">Type to search every section (PC, PCVR, Testing, Apps, 3D, Comics, Music).</div>`;
  const watch = html`<${WatchBar} query=${query} onWatch=${onWatch} onWatchlist=${onWatchlist} />`;
  if (!found.length) return html`<div><div class="empty">Nothing matches that.</div>${watch}</div>`;
  return html`<main class="grid wide"><div class="count" style="grid-column:1/-1">${exact.length ? '' : 'No exact match, closest: '}${found.length} found${watch}</div>${found.map((it) => render(it, badges.get(it)))}</main>`;
}

// "Tell me when it is added": a Telegram message when the title shows up (or a newer build appears), plus the member's watchlist.
function WatchBar({ query, onWatch, onWatchlist }) {
  return html`<span class="watchbar"><button class="dbtn" title="Get a Telegram message when this game is added or a newer build appears" onClick=${() => onWatch(query)}>Tell me when it is added</button><button class="dbtn" onClick=${onWatchlist}>My watchlist</button></span>`;
}
function WatchlistModal({ onClose, say, startTitle }) {
  const [items, setItems] = useState(null);
  const [title, setTitle] = useState(startTitle || '');
  const load = async () => { const r = await api.watchlist(); setItems(r && r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : []); if (r && !r.ok) say((r.error && r.error.message) || 'Could not load the watchlist'); };
  useEffect(() => { load(); }, []);
  const add = async () => {
    const t = title.trim(); if (t.length < 2) return;
    const r = await api.watchAdd(t);
    if (r && r.ok && r.data) { say(r.data.message || 'Added'); setTitle(''); load(); } else say((r && r.error && r.error.message) || 'Could not add it');
  };
  const remove = async (id) => { const r = await api.watchRemove(id); if (r && r.ok) load(); else say((r && r.error && r.error.message) || 'Could not remove it'); };
  return html`<div class="overlay" onClick=${onClose}><div class="modal" onClick=${(e) => e.stopPropagation()}>
    <h3>My watchlist</h3>
    <p class="sval">You get a Telegram message when a title on this list is added to the library, or when a newer build of it appears.</p>
    <div class="srow"><input class="wide" type="text" placeholder="Game title" aria-label="Game title" value=${title} onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} /><button class="dbtn go" onClick=${add}>Watch</button></div>
    ${items === null ? html`<div class="loading">Loading...</div>` : !items.length ? html`<div class="empty">You are not watching anything yet.</div>` : items.map((w) => html`<div class="srow" key=${w.id}><span class="slabel">${w.title}${w.notifiedAt ? html` <span class="sval">(told you on ${shortDate(w.notifiedAt)})</span>` : ''}</span><button class="dbtn" onClick=${() => remove(w.id)}>Stop watching</button></div>`)}
    <div class="dbtns"><button class="dbtn" onClick=${onClose}>Close</button></div>
  </div></div>`;
}

// Settings that used to live only in the classic window: the common ones are here; the rest (history, scans, schedule) are one button away.
// A number box you can type in. The old one took its value from the saved setting on every redraw, so a typed number was put back to the old one
// before it could be committed (the window redraws all the time while downloads run). Here what is typed is kept while the box has focus, and it
// is saved when you press Enter, click away, or use the little arrows.
function NumField({ value, min, max, onCommit, style, step, label }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const commit = (raw) => {
    const n = Math.max(min, Math.min(max, Math.round(Number(raw)) || min));
    setDraft(String(n));
    if (n !== Number(value)) onCommit(n);
  };
  return html`<input type="number" aria-label=${label || undefined} min=${min} max=${max} step=${step || 1} style=${style || ''} value=${draft}
    onInput=${(e) => setDraft(e.target.value)} onFocus=${() => setFocused(true)}
    onChange=${(e) => commit(e.target.value)}
    onBlur=${(e) => { setFocused(false); commit(e.target.value); }}
    onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />`;
}

const SETTING_ROWS = [
  ['number', 'maxConcurrentDownloads', 'Downloads at the same time', 1, 6],
  ['select', 'connectionsPerFile', 'Connections per file', [[0, 'Automatic'], [1, '1'], [2, '2'], [4, '4'], [8, '8'], [16, '16']]],
  ['number', 'maxDownloadSpeedMBps', 'Speed limit in MB/s (0 = no limit)', 0, 10000],
  ['check', 'autoHashCheck', 'Check files after downloading'],
  ['check', 'autoExtract7z', 'Extract .7z files automatically'],
  ['check', 'showNotifications', 'Show notifications'],
  ['check', 'minimizeToTrayOnMinimize', 'Minimize button hides the window to the tray'],
  ['check', 'minimizeToTrayOnClose', 'Close button keeps the app running in the tray (off: closing quits the app)'],
  ['check', 'lightGraphics', 'Lighter graphics (turns off blur and animations; use it if the app makes your graphics card work hard)'],
  ['check', 'autoUpdate', 'Update automatically'],
  ['check', 'installUpdatesOnQuit', 'Install a waiting update when I close the app (never during a download)'],
  ['check', 'startWithOsStartup', 'Start with the computer'],
  ['check', 'startWithOsMinimized', 'Start minimized'],
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
    <textarea class="prefs-box" placeholder="Paste the ARMGDDN-PREFS code here" aria-label="Paste the ARMGDDN-PREFS code here" value=${code} onInput=${(e) => { setCode(e.target.value); setProblem(''); }}></textarea>
    ${problem ? html`<div class="derr">${problem}</div>` : ''}
    <div class="dbtns"><button class="dbtn" onClick=${go}>Import</button></div>
  </${Modal}>`;
}

// ---- Tools: "only what I'm missing" for Comics and Music, and Komga. The scanning, comparing and downloading run in the main process (the
// same code the classic window uses); everything here is the screen for it. Your folder's contents never leave this PC.
function ScanTool({ kind, say }) {
  const music = kind === 'music';
  const [st, setSt] = useState(null);                 // { folder, scanned, running, progress }
  const [info, setInfo] = useState(null);             // comics: { lists, totals }, music: { totals }
  const [pick, setPick] = useState('all');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(null);
  const [canDownload, setCanDownload] = useState(false);
  const [busy, setBusy] = useState('');
  const timer = useRef(null);
  const call = (c, m) => (music ? api[m] : api[c]);
  const refresh = async () => { const r = await call('comicsState', 'musicState')(); setSt(r && typeof r === 'object' ? r : {}); return r; };
  useEffect(() => {
    refresh().catch(() => setSt({}));
    call('comicsInfo', 'musicInfo')().then((r) => setInfo(r && r.ok ? r : { error: (r && r.error) || 'Could not load the library list.' })).catch(() => setInfo({ error: 'Could not load the library list.' }));
    return () => clearInterval(timer.current);
  }, []);
  const running = !!(st && st.running);
  useEffect(() => { clearInterval(timer.current); if (running) timer.current = setInterval(() => { refresh().catch(() => { }); }, 700); return () => clearInterval(timer.current); }, [running]);
  if (!st) return html`<div class="loading">Loading...</div>`;
  const label = music ? 'music' : 'comics';
  const chooseFolder = async () => { const f = await call('comicsPickFolder', 'musicPickFolder')(); if (f) { setLines(null); setCanDownload(false); setNote('Folder chosen. Press Scan.'); await refresh(); } };
  const scan = async () => {
    setBusy('scan'); setLines(null); setCanDownload(false); setNote('Scanning...');
    setSt((x) => ({ ...x, running: true, progress: { scanned: 0, current: '' } }));
    const r = await call('comicsScan', 'musicScan')();
    setBusy(''); await refresh();
    if (!r || !r.ok) { setNote((r && r.error) || 'The scan failed.'); return; }
    setNote(`Scanned ${Number(r.count).toLocaleString()} ${music ? 'music' : 'comic'} files${r.fast ? ` (${Number(r.fast).toLocaleString()} matched the library by name and size without being opened)` : ''}${r.damaged ? `; ${Number(r.damaged).toLocaleString()} look damaged or cut short` : ''}.`);
  };
  const compare = async () => {
    setBusy('compare'); setLines([{ tone: 'info', text: 'Comparing...' }]); setCanDownload(false);
    const r = await (music ? api.musicCompare('') : api.comicsCompare(pick));
    setBusy('');
    if (!r || !r.ok) { setLines([{ tone: 'warn', text: (r && r.error) || 'The comparison failed.' }]); return; }
    setLines(compareLines(kind, r)); setCanDownload(!!(r.summary && r.summary.missing)); setNote('');
  };
  const download = async () => {
    setBusy('download'); setNote('Starting the downloads...');
    const r = await call('comicsDownloadMissing', 'musicDownloadMissing')();
    setBusy(''); setCanDownload(false);
    if (!r || !r.ok) { setNote((r && r.error) || 'Could not start the downloads.'); return; }
    setNote(startedLine(kind, r)); say('Started the missing ' + label);
  };
  const prog = running && st.progress ? `Scanning... ${Number(st.progress.scanned || 0).toLocaleString()} files` : '';
  const t = info && info.totals;
  return html`<section class="toolcard">
    <h3>${music ? 'Music' : 'Comics'}: only what I'm missing</h3>
    <p class="note">${music ? 'Scan your music folder and download only the albums and tracks you do not have.' : 'Scan your comics folder and download only the comics you do not have, for the whole library or one reading order.'} The contents of your folder never leave this PC; only the library's list comes down.</p>
    ${info && info.error ? html`<p class="note warn">${info.error} Sign in again if this keeps happening.</p>` : t ? html`<p class="note">${music ? `The library has ${Number(t.albums || 0).toLocaleString()} albums by ${Number(t.artists || 0).toLocaleString()} artists (${Number(t.tracks || 0).toLocaleString()} tracks, ${formatSize(t.bytes)}).` : `The library has ${Number(t.books || 0).toLocaleString()} comics${Number(t.bytes) > 0 ? ' (' + formatSize(t.bytes) + ')' : ''}.`}</p>` : ''}
    <div class="srow"><span class="slabel">${music ? 'Music' : 'Comics'} folder</span><span class="sval">${st.folder || 'No folder chosen'}</span><button class="dbtn" disabled=${running} onClick=${chooseFolder}>${st.folder ? 'Change' : 'Choose'}</button></div>
    <div class="srow">
      <button class="dbtn" disabled=${!st.folder || running || !!busy} onClick=${scan}>Scan</button>
      ${running ? html`<button class="dbtn" onClick=${() => call('comicsCancelScan', 'musicCancelScan')()}>Stop</button>` : ''}
      <span class="slabel">${prog || (st.scanned ? `Scanned ${Number(st.scanned).toLocaleString()} ${music ? 'music' : 'comic'} files.` : 'Not scanned yet.')}</span>
    </div>
    ${!music ? html`<label class="srow"><span class="slabel">Compare with</span><select value=${pick} onChange=${(e) => setPick(e.target.value)}>
      <option value="all">${`Everything in the library${t ? ` (${Number(t.books || 0).toLocaleString()} comics)` : ''}`}</option>
      ${((info && info.lists) || []).map((l) => html`<option value=${l.id}>${l.name} (${Number(l.books || 0).toLocaleString()})</option>`)}</select></label>` : ''}
    <div class="srow"><button class="dbtn" disabled=${!st.scanned || running || !!busy} onClick=${compare}>Compare</button>
      ${canDownload ? html`<button class="dbtn go" disabled=${!!busy} onClick=${download}>Download what I'm missing</button>` : ''}
      <span class="slabel">${st.scanned ? '' : 'Scan first.'}</span></div>
    ${note ? html`<p class="note">${note}</p>` : ''}
    ${lines ? html`<div class="results">${lines.map((l) => html`<div class=${'rline ' + l.tone}>${l.title ? html`<b>${l.title}: </b>` : ''}${l.text}</div>`)}</div>` : ''}
  </section>`;
}

function KomgaTool({ say }) {
  const [k, setK] = useState(null);                       // { url, hasKey, defaultUrl, lists }
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [lists, setLists] = useState([]);
  const load = async () => { const r = await api.komgaState(); setK(r); setUrl((u) => u || r.url || r.defaultUrl || ''); return r; };
  useEffect(() => { load().catch(() => setK({ lists: [], defaultUrl: 'http://localhost:25600' })); }, []);
  useEffect(() => { api.komgaLists().then((r) => setLists((r && r.lists) || [])).catch(() => { }); }, []);
  if (!k) return html`<div class="loading">Loading...</div>`;
  const save = async () => {
    const r = await api.komgaSave({ url, key });
    if (!r || !r.ok) { setMsg((r && r.error) || 'Could not save.'); return; }
    setKey(''); setMsg('Saved. The key is kept on this PC only.'); await load();
  };
  const forget = async () => { await api.komgaForget(); setMsg('Forgot the saved key.'); await load(); };
  const importKey = async () => {
    setMsg('Importing...');
    const r = await api.komgaImport();
    if (!r || !r.ok) { setMsg((r && r.error) || 'Could not import the key.'); return; }
    setUrl(r.url); setMsg('Imported the Komga address and key from the installed Companion. The key stays on this PC.'); await load();
  };
  const add = async (id, title) => {
    setBusy(id); setMsg(`Adding ${title}...`);
    const r = await api.komgaAdd(id);
    setBusy('');
    if (r && r.ok) { setMsg(`${r.replaced ? 'Updated' : 'Added'} "${r.name}" ${r.replaced ? 'in' : 'to'} your Komga: ${Number(r.count).toLocaleString()} of ${Number(r.total).toLocaleString()} comics, in reading order (${Number(r.byFile).toLocaleString()} matched by file${r.byCv ? `, ${Number(r.byCv).toLocaleString()} by Comic Vine id (another edition of the same issue)` : ''}).${r.missing ? ` ${Number(r.missing).toLocaleString()} are not in your Komga library, so they were left out.` : ''}`); say('Added to your Komga: ' + r.name); return; }
    setMsg((r && r.error) || 'Could not add the list.'); if (r && r.needsSetup) await load();
  };
  return html`<section class="toolcard">
    <h3>Add reading orders to my Komga</h3>
    <p class="note">Adds a suggested reading order to your own Komga server as a read list, matching the comics you already have in it. Needs your Komga address and an API key (Komga: account settings, API keys).</p>
    <label class="srow"><span class="slabel">Komga address</span><input class="wide" type="text" value=${url} placeholder=${k.defaultUrl} onInput=${(e) => setUrl(e.target.value)} /></label>
    <label class="srow"><span class="slabel">API key</span><input class="wide" type="password" value=${key} placeholder=${k.hasKey ? 'Saved on this PC (leave empty to keep it)' : 'Paste your API key'} onInput=${(e) => setKey(e.target.value)} /></label>
    ${k.canImport ? html`<div class="srow"><span class="slabel">The installed Companion already has a Komga server and key saved.</span><button class="dbtn go" onClick=${importKey}>Import them</button></div>` : ''}
    <div class="srow"><button class="dbtn" onClick=${save}>Save</button>${k.hasKey ? html`<button class="dbtn" onClick=${forget}>Forget the key</button>` : ''}<span class="slabel">${k.hasKey ? 'A key is saved.' : 'No key saved yet.'}</span></div>
    <div class="lists">${(lists.length ? lists : (k.lists || [])).map((l) => html`<div class="srow"><span class="slabel">${l.title}${l.books ? html` <span class="sval">${Number(l.books).toLocaleString()} comics</span>` : ''}</span><button class="dbtn" disabled=${!k.hasKey || !!busy} onClick=${() => add(l.id, l.title)}>${busy === l.id ? 'Adding...' : 'Add to my Komga'}</button></div>`)}</div>
    ${msg ? html`<p class="note">${msg}</p>` : ''}
  </section>`;
}

function ToolsView({ say }) {
  return html`<main class="settings tools">
    <h2>Tools</h2>
    <${ScanTool} kind="comics" say=${say} />
    <${ScanTool} kind="music" say=${say} />
    <${KomgaTool} say=${say} />
  </main>`;
}

// "Check for updates" in Settings: asks GitHub's latest release now, and says plainly what it found. The Companion also checks by itself once an hour.
function UpdateRow({ say }) {
  const [state, setState] = useState({ busy: false, text: '' });
  const [found, setFound] = useState(null);     // an update was found: the button now installs it
  const install = async () => {
    setState({ busy: true, text: 'Updating... ARMGDDN App will restart by itself.' });
    try {
      const r = await runAppUpdate('native-settings');
      if (r && r.success === false && !r.installerPath) setState({ busy: false, text: (r && r.error) || 'The update could not be started' });
    } catch (e) { setState({ busy: false, text: 'The update could not be started' }); }
  };
  const check = async () => {
    setState({ busy: true, text: 'Checking...' });
    try {
      const r = await api.checkUpdates();
      if (!r || r.error) setState({ busy: false, text: 'Could not check: ' + ((r && r.error) || 'no answer') });
      else if (r.hasUpdate) setState({ busy: false, text: `v${r.latestVersion} is available (you have v${r.version}). Finish or pause your downloads first: updating restarts ARMGDDN App.` });
      if (r.hasUpdate && r.canAutoInstall) setFound(r);
      else setState({ busy: false, text: `You are on the latest version (v${r.version}).` });
      if (r && r.hasUpdate) { try { window.dispatchEvent(new CustomEvent('native-update-found', { detail: r })); } catch (e) { } }
    } catch (e) { setState({ busy: false, text: 'Could not check for updates.' }); }
  };
  useEffect(() => { const run = () => check(); window.addEventListener('native-run-update-check', run); return () => window.removeEventListener('native-run-update-check', run); }, []);
  return html`<div class="srow"><span class="slabel">ARMGDDN App updates <span class="sval">${state.text || 'It checks once an hour by itself.'}</span></span>${found ? html`<button class="dbtn go" disabled=${state.busy} onClick=${install}>Update to v${found.latestVersion}</button>` : html`<button class="dbtn" disabled=${state.busy} onClick=${check}>Check for updates</button>`}</div>`;
}

// The download schedule, as in the classic Settings: pause or slow downloads between two times on chosen days.
const DAY_LABELS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
function ScheduleRow({ s, save }) {
  const sch = s.schedule || {};
  const days = Array.isArray(sch.days) ? sch.days : [0, 1, 2, 3, 4, 5, 6];
  const [banner, setBanner] = useState('');
  useEffect(() => { try { api.onScheduleBanner((t) => setBanner(t || '')); api.getScheduleBanner().then((t) => setBanner(t || '')).catch(() => { }); } catch (e) { } }, []);
  const put = (patch) => save({ schedule: { enabled: !!sch.enabled, start: sch.start || '23:00', end: sch.end || '07:00', action: sch.action === 'limit' ? 'limit' : 'pause', limitMBps: sch.limitMBps || 5, days, ...patch } });
  const toggleDay = (d) => put({ days: days.includes(d) ? days.filter((x) => x !== d) : days.concat(d).sort() });
  return html`<div class="sched">
    <div class="srow"><span class="slabel">Download schedule <span class="sval">Pause or slow downloads at set times.</span></span><label class="chk"><input type="checkbox" checked=${!!sch.enabled} onChange=${(e) => put({ enabled: e.target.checked })} /> On</label></div>
    ${sch.enabled ? html`<div class="srow schedfields"><span class="slabel">From <input type="time" aria-label="Start time" value=${sch.start || '23:00'} onChange=${(e) => put({ start: e.target.value || '23:00' })} /> to <input type="time" aria-label="End time" value=${sch.end || '07:00'} onChange=${(e) => put({ end: e.target.value || '07:00' })} />
      <select aria-label="What to do at those times" value=${sch.action === 'limit' ? 'limit' : 'pause'} onChange=${(e) => put({ action: e.target.value })}><option value="pause">Pause downloads</option><option value="limit">Limit speed to</option></select>
      ${sch.action === 'limit' ? html`<${NumField} label="Speed limit in MB/s" min=${1} max=${10000} style="width:70px" value=${sch.limitMBps || 5} onCommit=${(n) => put({ limitMBps: n })} /> MB/s` : ''}</span></div>
      <div class="srow"><span class="slabel">${DAY_LABELS.map(([d, l]) => html`<label class="chk" key=${d}><input type="checkbox" checked=${days.includes(d)} onChange=${() => toggleDay(d)} /> ${l}</label>`)}</span></div>` : ''}
    ${banner ? html`<div class="note">${banner}</div>` : ''}
  </div>`;
}

// "Check my games for updates": compares the finished downloads in the history with the newest version in the library.
function GameUpdatesRow({ onOpenGame }) {
  const [st, setSt] = useState({ busy: false, text: '', list: [] });
  const run = async () => {
    setSt({ busy: true, text: 'Checking...', list: [] });
    try {
      const res = await api.checkGameUpdates();
      if (!res || !res.ok) return setSt({ busy: false, text: (res && res.error) || 'Could not check for updates.', list: [] });
      if (!res.checked) return setSt({ busy: false, text: 'There are no finished downloads in your history to check.', list: [] });
      if (!res.updates.length) return setSt({ busy: false, text: `Checked ${res.checked} game${res.checked === 1 ? '' : 's'}: all are on the newest version in the library.`, list: [] });
      setSt({ busy: false, text: `${res.updates.length} game${res.updates.length === 1 ? ' has' : 's have'} a newer version in the library. Click one to open it in the library.`, list: res.updates });
    } catch (e) { setSt({ busy: false, text: 'Could not check for updates.', list: [] }); }
  };
  return html`<div><div class="srow"><span class="slabel">Game updates <span class="sval">${st.text || 'See which of your downloaded games have a newer version.'}</span></span><button class="dbtn" disabled=${st.busy} onClick=${run}>Check my games</button></div>
    ${st.list.length ? html`<ul class="gu">${st.list.map((u, i) => html`<li key=${i}><a class="glink" href="#" title="Open it in the library" onClick=${(e) => { e.preventDefault(); if (onOpenGame) onOpenGame(u.remote || 'PC Games', u.latestFolder); }}>${u.latestFolder}</a> <span class="sval">(you have ${u.current}, newest is ${u.latest})</span></li>`)}</ul>` : ''}</div>`;
}

// "New to .7z files?": the short help video, played from the app's own files. It starts playing as soon as Watch the video is clicked,
// centred in the row (George, Nov 24 2026).
function Help7zRow() {
  const [src, setSrc] = useState('');
  const [open, setOpen] = useState(false);
  const show = async () => { setOpen(!open); if (!open && !src) { try { setSrc(await api.getHelp7zVideoSrc()); } catch (e) { } } };
  return html`<div><div class="srow"><span class="slabel">New to .7z files? <span class="sval">A short video on opening multi-part archives after a download.</span></span><button class="dbtn" onClick=${show}>${open ? 'Hide the video' : 'Watch the video'}</button></div>
    ${open && src ? html`<video class="help7z" controls autoplay src=${src} ref=${(v) => { if (v && v.paused && !v.dataset.started) { v.dataset.started = '1'; v.play().catch(() => { }); } }}></video>` : ''}</div>`;
}

// What's New: the changes in the running version, shown once after an update and on request.
function WhatsNewBox({ entry, onClose }) {
  if (!entry) return '';
  const items = Array.isArray(entry.highlights) ? entry.highlights : [];
  return html`<div class="notice soft whatsnew"><strong>${entry.title ? "What's New: " + entry.title : "What's New"}</strong><ul>${items.map((h, i) => html`<li key=${i}>${String(h)}</li>`)}</ul><button class="dbtn" onClick=${onClose}>Got it</button></div>`;
}
function WhatsNewButton() {
  const [entry, setEntry] = useState(undefined);
  const show = async () => { try { setEntry((await api.getWhatsNew()) || null); } catch (e) { setEntry(null); } };
  return html`<div><div class="srow"><span class="slabel">What's New <span class="sval">The changes in this version.</span></span><button class="dbtn" onClick=${show}>Show what's new</button></div>
    ${entry === null ? html`<div class="note">There is nothing to show for this version.</div>` : entry ? html`<${WhatsNewBox} entry=${entry} onClose=${() => setEntry(undefined)} />` : ''}</div>`;
}

function SettingsView({ say, onPrefs, onOpenGame, ownerToggle }) {
  const [s, setS] = useState(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => { api.getSettings().then((r) => setS(r && typeof r === 'object' ? r : {})).catch(() => setS({})); }, []);
  if (!s) return html`<div class="loading">Loading settings...</div>`;
  const save = async (patch) => { if ('errorReporting' in patch) patch = { ...patch, errorReportingAsked: true };   // changing it is an answer
    const next = { ...s, ...patch }; setS(next); if ('lightGraphics' in patch && window.setLiteGraphics) window.setLiteGraphics(patch.lightGraphics); try { await api.saveSettings(patch); } catch (e) { say('Could not save'); } };
  const pickFolder = async (key) => { const r = await api.browseFolder(); if (r) save({ [key]: r }); };
  const folderRow = (key, label) => html`<div class="srow"><span class="slabel">${label}</span><span class="sval">${s[key] || 'Not set'}</span><button class="dbtn" onClick=${() => pickFolder(key)}>Change</button></div>`;
  const settingRow = (k) => { const [kind, key, label, min, max] = SETTING_ROWS.find((r) => r[1] === k); return kind === 'select'
      ? html`<label class="srow"><span class="slabel">${label}</span><select value=${Number(s[key]) || 0} onChange=${(e) => save({ [key]: Number(e.target.value) })}>${min.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>`
      : kind === 'check'
      ? html`<label class="srow"><input type="checkbox" checked=${!!s[key]} onChange=${(e) => save({ [key]: e.target.checked })} /> <span class="slabel">${label}</span></label>`
      : html`<label class="srow"><span class="slabel">${label}</span><${NumField} min=${min} max=${max} value=${Number(s[key]) || 0} onCommit=${(n) => save({ [key]: n })} /></label>`; };
  return html`<main class="settings">
    <h2>Settings</h2>
    <section class="sgroup"><h3>Updates</h3>
    <${UpdateRow} say=${say} />
    <${WhatsNewButton} />
    ${settingRow('autoUpdate')}
    ${settingRow('installUpdatesOnQuit')}
    </section>
    <section class="sgroup"><h3>Folders</h3>
    ${folderRow('downloadPath', 'Download folder')}
    ${folderRow('comicsFolder', 'Comics folder')}
    ${folderRow('musicFolder', 'Music folder')}
    <div class="srow" title="Where games are unpacked when Extract .7z files automatically is on. Empty: next to the download."><span class="slabel">Extract folder</span><span class="sval">${s.extractFolder || 'Same as the download folder'}</span><button class="dbtn" onClick=${() => pickFolder('extractFolder')}>Change</button>${s.extractFolder ? html`<button class="dbtn" onClick=${() => save({ extractFolder: '' })}>Reset</button>` : ''}</div>
    </section>
    <section class="sgroup"><h3>Downloads</h3>
    ${settingRow('maxConcurrentDownloads')}
    ${settingRow('connectionsPerFile')}
    ${settingRow('maxDownloadSpeedMBps')}
    ${settingRow('autoHashCheck')}
    ${settingRow('autoExtract7z')}
    <${Help7zRow} />
    <${ScheduleRow} s=${s} save=${save} />
    </section>
    <section class="sgroup"><h3>Your games</h3>
    <${GameUpdatesRow} onOpenGame=${onOpenGame} />
    </section>
    <section class="sgroup"><h3>The app and its window</h3>
    ${ownerToggle ? html`<label class="srow"><input type="checkbox" checked=${!ownerToggle.off} onChange=${(e) => ownerToggle.set(!e.target.checked)} /> <span class="slabel">Owner view: show the Admin tab and the status dock (turn off to see the app as a regular member)</span></label>` : ''}
    ${settingRow('showNotifications')}
    ${settingRow('minimizeToTrayOnMinimize')}
    ${settingRow('minimizeToTrayOnClose')}
    ${settingRow('lightGraphics')}
    ${settingRow('startWithOsStartup')}
    ${settingRow('startWithOsMinimized')}
    <div class="srow"><span class="slabel">Login animation (lightning and thunder, loud)</span><button class="dbtn" onClick=${() => mountLoginLightning()}>Replay</button></div>
    <label class="srow"><input type="checkbox" checked=${localStorage.getItem('native.lightningOff') !== '1'} onChange=${(e) => { try { localStorage.setItem('native.lightningOff', e.target.checked ? '0' : '1'); } catch (er) { } }} /> <span class="slabel">Play the login animation on a first sign-in</span></label>
    </section>
    <section class="sgroup"><h3>Import</h3>
    <div class="srow"><span class="slabel">Import the settings of an earlier ARMGDDN App install (folders, speed, toggles)</span><button class="dbtn" onClick=${async () => { const r = await api.importSettings(); if (r && r.same) say('This already is the installed Companion\'s settings'); else if (r && r.imported) { say('Imported ' + r.imported + ' settings'); const g = await api.getSettings(); if (g) setS(g); } else say('No installed Companion settings were found'); }}>Import</button></div>
    <div class="srow"><span class="slabel">Import my website preferences (My List, theme, hidden sections, recent searches)</span><button class="dbtn" onClick=${() => setPrefsOpen(true)}>Import</button></div>
    ${prefsOpen ? html`<${PrefsImport} onClose=${() => setPrefsOpen(false)} onApply=${onPrefs} say=${say} />` : ''}
    </section>
    <section class="sgroup"><h3>Help and reports</h3>
    ${settingRow('errorReporting')}
    <${SupportTools} say=${say} onApplyConnections=${(v) => save({ connectionsPerFile: v })} />
    </section>
  </main>`;
}

// Fireworks for the #1 game finale, ported from the website: rockets climb, burst into coloured particles and sparkles.
function startFireworks(container) {
  const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#ff8c00', '#e056fd', '#00ff88', '#ff3366', '#7c4dff', '#00e5ff'];
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const burst = (x, y, primary) => {
    const count = 12 + Math.floor(Math.random() * 8); const useSecond = Math.random() > 0.6; const second = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div'); const sparkle = Math.random() > 0.6; const trail = !sparkle && Math.random() > 0.7;
      p.className = 'firework-particle' + (sparkle ? ' sparkle' : '') + (trail ? ' trail' : '');
      p.style.left = x + '%'; p.style.top = y + '%';
      const color = useSecond && Math.random() > 0.5 ? second : primary; p.style.backgroundColor = color; p.style.color = color;
      const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.8; const dist = 30 + Math.random() * 50; const dur = 0.6 + Math.random() * 0.6;
      p.style.setProperty('--burst-x', Math.cos(angle) * dist + 'px'); p.style.setProperty('--burst-y', Math.sin(angle) * dist + 'px'); p.style.setProperty('--burst-duration', dur + 's');
      container.appendChild(p); later(() => p.remove(), dur * 1000 + 100);
    }
    for (let i = 0; i < 6; i++) later(() => {
      const sp = document.createElement('div'); sp.className = 'firework-particle sparkle'; sp.style.left = x + '%'; sp.style.top = y + '%'; sp.style.backgroundColor = '#fff'; sp.style.color = '#fff';
      const a = Math.random() * Math.PI * 2; const d = 10 + Math.random() * 20; sp.style.setProperty('--burst-x', Math.cos(a) * d + 'px'); sp.style.setProperty('--burst-y', Math.sin(a) * d + 'px'); sp.style.setProperty('--burst-duration', '0.4s');
      container.appendChild(sp); later(() => sp.remove(), 500);
    }, i * 50);
  };
  const rocket = () => {
    const fw = document.createElement('div'); fw.className = 'firework';
    const x = 10 + Math.random() * 80, y = 80 + Math.random() * 20, color = colors[Math.floor(Math.random() * colors.length)];
    fw.style.left = x + '%'; fw.style.top = y + '%'; fw.style.backgroundColor = color; fw.style.color = color;
    const travel = -(60 + Math.random() * 80), dur = 0.5 + Math.random() * 0.3;
    fw.style.setProperty('--fw-travel', travel + 'px'); fw.style.setProperty('--fw-duration', dur + 's');
    container.appendChild(fw);
    later(() => { burst(x, y + travel / 2, color); fw.remove(); }, dur * 1000 * 0.85);
  };
  for (let i = 0; i < 3; i++) later(rocket, i * 150);
  const every = setInterval(() => { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) later(rocket, i * 120); }, 350);
  return () => { clearInterval(every); timers.forEach(clearTimeout); timers.clear(); try { container.innerHTML = ''; } catch (e) { } };
}

// The website's ticker: one set of five titles at a time (PC then PCVR, 7 days then 30 days) slides across once, then the next set comes in.
function TrendingStrip({ windows, onOpen }) {
  const sets = useMemo(() => {
    const list = trendingSets(windows);
    // After the last set comes the #1 game of the last 30 days (7 if there is no 30 day list), for ten seconds with fireworks, then it starts over.
    const win = (windows && Array.isArray(windows.month) && windows.month.length) ? 'month' : 'week';
    let top = null, best = 0;
    for (const e of (windows && Array.isArray(windows[win]) ? windows[win] : [])) { const c = (Number(e.pc) || 0) + (Number(e.pcvr) || 0); if (c > best) { best = c; top = e; } }
    if (top && list.length) list.push({ win, platform: 'goat', goat: true, label: win === 'week' ? '#1 GAME \u00B7 LAST 7 DAYS' : '#1 GAME \u00B7 LAST 30 DAYS', items: [{ ...top, count: best }] });
    return list;
  }, [windows]);
  const fwBox = useRef(null);
  useEffect(() => { window.__tickerGoat = () => { setIdx(sets.length - 1); setCycle((n) => n + 1); return sets.map((x) => x.label + (x.goat ? '*' : '')).join(' | '); }; return () => { delete window.__tickerGoat; }; }, [sets.length]);   // lets a screenshot script jump to the finale
  const [idx, setIdx] = useState(0);
  const [cycle, setCycle] = useState(0);
  const view = useRef(null); const track = useRef(null); const anim = useRef(null);
  const cur = sets.length ? sets[idx % sets.length] : null;
  useEffect(() => {
    const v = view.current, t = track.current;
    if (!cur || !v || !t || typeof t.animate !== 'function') return;
    if (cur.goat) {
      let stop = null;
      if (document.documentElement.dataset.anim !== '0' && fwBox.current) stop = startFireworks(fwBox.current);
      const id = setTimeout(() => { setIdx((n) => (sets.length ? (n + 1) % sets.length : 0)); setCycle((n) => n + 1); }, 10000);
      return () => { clearTimeout(id); if (stop) stop(); };
    }
    if (document.documentElement.dataset.anim === '0') { t.style.transform = 'translateX(12px)'; const id = setTimeout(() => { setIdx((n) => (sets.length ? (n + 1) % sets.length : 0)); setCycle((n) => n + 1); }, 9000); return () => clearTimeout(id); }
    const pad = 24, w = t.scrollWidth, vw = v.clientWidth;
    const start = -(w + pad), end = vw + pad;
    const a = t.animate([{ transform: 'translateX(' + start + 'px)' }, { transform: 'translateX(' + end + 'px)' }], { duration: Math.max(4, (end - start) / 115) * 1000, easing: 'linear', fill: 'forwards' });
    anim.current = a;
    a.onfinish = () => { setIdx((n) => (sets.length ? (n + 1) % sets.length : 0)); setCycle((n) => n + 1); };
    return () => { try { a.cancel(); } catch (e) { } };
  }, [idx, cycle, sets.length]);
  if (!cur) return html`<div class="empty">Nothing is trending yet.</div>`;
  return html`<${Fragment}><div class="tbar"><span class=${'tbadge ' + (cur.goat ? 'goat' : cur.win)} title="Which set is showing">${cur.label}</span></div>
  <div class=${'ticker' + (cur.goat ? ' goatmode' : '')} ref=${view} onMouseEnter=${() => { try { anim.current && anim.current.pause(); } catch (e) { } }} onMouseLeave=${() => { try { anim.current && anim.current.play(); } catch (e) { } }}>
    <div class="ticker-track" ref=${track} key=${idx + '-' + cycle}>${cur.items.map((e) => html`<div class="tpill" key=${e.norm + e.platform} tabIndex="0" role="button" onKeyDown=${kbdClick(() => onOpen(e))} onClick=${() => onOpen(e)}>
      <div class="tcover">${e.coverUrl ? html`<img src=${coverSrc(e.coverUrl)} alt="" />` : html`<div class="nocover small">Non-Steam Game</div>`}</div>
      <div class="ttext"><div class="ttitle">${cleanTitle(e.title)}</div>
        <div class="tmeta"><span>\u{1F525} ${Number(e.count).toLocaleString('en-US')} downloads</span>${e.sizeBytes ? html`<span>${formatSize(e.sizeBytes)}</span>` : ''}${e.lastDownloadTs ? html`<span>${shortDate(e.lastDownloadTs)}</span>` : ''}</div></div>
    </div>`)}</div>
    ${cur.goat ? html`<div class="fireworks" ref=${fwBox}></div>` : ''}
  </div></${Fragment}>`;
}

// Home: the three strips the website's landing page has.
function Strip({ id, title, sub, right, children }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('native.strip.' + id) === '1'; } catch (e) { return false; } });
  const toggle = () => { const v = !hidden; setHidden(v); try { localStorage.setItem('native.strip.' + id, v ? '1' : '0'); } catch (e) { } };
  return html`<section class="strip"><div class="strip-head"><span class="strip-title">${title}</span>${sub ? html`<span class="strip-sub">${sub}</span>` : ''}<span class="strip-right">${right || ''}<button class="dbtn" onClick=${toggle}>${hidden ? 'Show' : 'Hide'}</button></span></div>${hidden ? '' : children}</section>`;
}
// Game Radar: three cards at a time, each swapping to a new pick every so often, from what you opened, saved and downloaded and what is trending.
const RADAR_INTERVALS = [11000, 16500, 13800];
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
function RadarCard({ item, fade, inList, onOpen, onSave, onDismiss }) {
  const cover = item.coverArt && item.coverArt.cover && item.coverArt.cover.url;
  const meta = [item.downloadCount > 0 ? '\u{1F525} ' + item.downloadCount.toLocaleString('en-US') + ' (30d)' : '', item.remote, item.releaseDate ? shortDate(item.releaseDate) : ''].filter(Boolean);
  const has = (b) => (item.badges || []).includes(b);
  return html`<div class=${'rcard' + (fade ? ' fade' : '')}>
    <div class="rcover">${cover ? html`<${Fragment}><img class="rbg" src=${coverSrc(cover)} alt="" aria-hidden="true" /><img class="rfg" src=${coverSrc(cover)} alt="" /></${Fragment}>` : html`<div class="nocover">Non-Steam Game</div>`}</div>
    <div class="rcopy">
      <div class="rtitle">${cleanTitle(radarTitle(item)) || 'Untitled'}</div>
      <div class="rwhy"><span class="rwhy-label">Why this is here</span><span>${item.why || item.reason}</span></div>
      <div class="rbadges">${has('saved') ? html`<span class="rbadge saved">Saved</span>` : ''}${has('history') ? html`<span class="rbadge history">Recent</span>` : ''}${has('trending') ? html`<span class="rbadge trending">Trending</span>` : ''}</div>
      <div class="rreason">${item.reason}</div>
      <div class="rmeta">${meta.length ? meta.map((m) => html`<span>${m}</span>`) : html`<span>Ready to browse</span>`}</div>
      <div class="ractions"><button class="primary" onClick=${() => onOpen(item)}>Open</button>${inList ? '' : html`<button class="dbtn" onClick=${() => onSave(item)}>Save</button>`}<button class="dbtn" onClick=${() => onDismiss(item)}>Not interested</button></div>
    </div>
  </div>`;
}
function RadarStrip({ trend, progress, myList, history, onOpen, onSave, onResume }) {
  const [dismissed, setDismissed] = useState(() => lsGet('native.radarDismissed', []));
  const [seen, setSeen] = useState(() => new Set());
  const [offset, setOffset] = useState(0);
  const [seed, setSeed] = useState(() => Math.random());
  const [slots, setSlots] = useState([]);
  const [fades, setFades] = useState([false, false, false]);
  const deck = useRef({ list: [], idx: 0 });
  const noise = useMemo(() => { const cache = new Map(); return (k, w) => { const id = k + '|' + w; if (!cache.has(id)) { let h = 0; const str = seed + id; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; cache.set(id, ((h >>> 0) % 10007) / 10007); } return cache.get(id); }; }, [seed]);
  const picks = useMemo(() => (trend ? radarPicks({ trending: trend, history, myList, related: progress && progress.relatedCandidates, downloads: progress && progress.downloads, dismissed, seen, offset, noise }) : []), [trend, progress, myList, history, dismissed, seen, offset, noise]);
  useEffect(() => {
    const list = picks.slice();
    for (let i = list.length - 1; i > RADAR_CARDS; i--) { const j = RADAR_CARDS + Math.floor(Math.random() * (i - RADAR_CARDS + 1)); [list[i], list[j]] = [list[j], list[i]]; }   // the rest of the deck, shuffled
    deck.current = { list, idx: RADAR_CARDS };
    setSlots(list.slice(0, RADAR_CARDS));
  }, [picks]);
  const next = () => { const d = deck.current; if (d.list.length <= RADAR_CARDS) return null; if (d.idx >= d.list.length) { for (let i = d.list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d.list[i], d.list[j]] = [d.list[j], d.list[i]]; } d.idx = 0; } return d.list[d.idx++]; };
  useEffect(() => {
    const timers = RADAR_INTERVALS.slice(0, slots.length).map((ms, slot) => setInterval(() => {
      const item = next(); if (!item) return;
      setFades((f) => f.map((v, i) => (i === slot ? true : v)));
      setTimeout(() => { setSlots((s) => s.map((x, i) => (i === slot ? item : x))); setFades((f) => f.map((v, i) => (i === slot ? false : v))); }, 450);
    }, ms));
    return () => timers.forEach(clearInterval);
  }, [slots.length > 0, picks]);
  const dismiss = (it) => { const k = radarKey(it.remote, it.path, it.name || it.title); const nextList = [...new Set([...dismissed, k])].slice(-80); setDismissed(nextList); lsSet('native.radarDismissed', nextList); };
  const refresh = () => { const n = new Set(seen); for (const c of slots) n.add(radarKey(c.remote, c.path, c.name || c.title)); setSeen(n); setOffset(offset + RADAR_CARDS); setSeed(Math.random()); };
  const reset = () => { setDismissed([]); lsSet('native.radarDismissed', []); setSeen(new Set()); setOffset(0); setSeed(Math.random()); };
  const inList = (it) => (myList || []).some((m) => radarGroup(m.remote) === it.remote && radarPath(m.path) === radarPath(it.path));
  return html`<${Fragment}>
    <div class="radar-actions"><button class="dbtn" onClick=${refresh}>Refresh</button><button class="dbtn" onClick=${reset}>Show dismissed cards again</button>${history && history[0] ? html`<button class="dbtn" onClick=${onResume}>Resume last visit</button>` : ''}</div>
    ${!slots.length ? html`<div class="empty">No new cards left yet. Use “Show dismissed cards again” to reset the stack.</div>` : html`<div class="rslots">${slots.map((it, i) => html`<${RadarCard} key=${i} item=${it} fade=${fades[i]} inList=${inList(it)} onOpen=${onOpen} onSave=${onSave} onDismiss=${dismiss} />`)}</div>`}
  </${Fragment}>`;
}

// Harbor (staff-only test redesign): the Home of the mockup. A hero for the most downloaded title, the ranked chart with pictures, the newest builds,
// and what is downloading now. The Game Radar and Hidden Gems strips stay below.
const harborDate = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
async function harborNewest() {
  const out = [];
  for (const g of ['PCVR Games', 'PC Games']) {
    const top = await api.browse(g, ''); if (!top.ok) continue;
    let files = top.data.files || []; let folder = '';
    const into = autoEnter(g, files);
    if (into) { const inner = await api.browse(g, into); if (inner.ok) { files = visibleItems(g, into, inner.data.files || []); folder = into; } }
    for (const f of files) if (f && f.isDir && f.modTime && f.coverArt && f.coverArt.cover && f.coverArt.cover.url) out.push({ ...f, _remote: g, _folder: folder });
  }
  return out.sort((a, b) => String(b.modTime).localeCompare(String(a.modTime))).slice(0, 12);
}
function HarborLead({ windows, downloads, onOpen, fresh, actions }) {
  const win = windows && Array.isArray(windows.month) && windows.month.length ? 'month' : 'week';
  const rows = useMemo(() => rankTrending(windows && windows[win], { limit: 9 }), [windows]);   // the window's own counts only; "total" is all time
  // A trending entry can come without art (mods and non-Steam titles); the library listing often has it, so it is read from there as needed.
  const extra = useListingCovers(rows.filter((e) => !e.coverUrl).map((e) => { const it = homeItem(e); return it ? { key: e.path, group: it._remote, folder: it._folder, name: it.name } : null; }).filter(Boolean));
  const coverOf = (e) => e.coverUrl || extra[e.path] || '';
  const active = (downloads || []).filter(isActiveDownload);
  const top = rows[0];
  const days = win === 'month' ? '30' : '7';
  const topItem = top ? homeItem(top) : null;
  const topFresh = top && fresh ? fresh.find((f) => f.name === (topItem && topItem.name)) : null;
  const left = bytesLeft(active);
  // A short firework celebration over the No. 1 title, once per visit to Home; off when animations are off or the system asks for less motion.
  const fw = useRef(null);
  const topPath = top && top.path;
  useEffect(() => {
    if (!topPath || !fw.current || document.documentElement.dataset.anim === '0') return;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { }
    const stop = startFireworks(fw.current); const id = setTimeout(stop, 6000);
    return () => { clearTimeout(id); stop(); };
  }, [topPath]);
  return html`<div class="hb-home">
    ${top ? html`<section class="hb-hero">
      ${coverOf(top) ? html`<img class="hb-herobg" src=${coverSrc(coverOf(top))} alt="" aria-hidden="true" />` : ''}
      <div class="fireworks hb-fw" ref=${fw}></div>
      <div class="hb-heroin">
        ${coverOf(top) ? html`<img class="hb-heroart" src=${coverSrc(coverOf(top))} alt=${cleanTitle(top.title)} tabIndex="0" role="button" onKeyDown=${kbdClick(() => onOpen(top))} onClick=${() => onOpen(top)} />` : ''}
        <div class="hb-herotext">
          <span class="hb-kick">No. 1 in the last ${days} days · ${top.count.toLocaleString('en-US')} downloads</span>
          <h2>${cleanTitle(top.title)}</h2>
          <div class="hb-facts">
            ${top.sizeBytes ? html`<div><span>Size</span><b>${formatSize(top.sizeBytes)}</b></div>` : ''}
            <div><span>Platform</span><b>${(Number(top.pcvr) || 0) > (Number(top.pc) || 0) ? 'VR' : 'PC'}</b></div>
            ${buildNumber(top.path) ? html`<div><span>Build</span><b>${buildNumber(top.path)}</b></div>` : ''}
            ${topFresh && harborDate(topFresh.modTime) ? html`<div><span>Updated</span><b>${harborDate(topFresh.modTime)}</b></div>` : ''}
          </div>
          <div class="hb-actions">
            ${topItem && actions ? html`<button class="hb-go" onClick=${() => actions.download(topItem)}>Download${top.sizeBytes ? ' ' + formatSize(top.sizeBytes) : ''}</button><button class="hb-ghost" onClick=${() => actions.details(topItem)}>Details</button><button class="hb-text" onClick=${() => actions.toggle(topItem)}>${actions.inList(topItem) ? 'In My List' : 'Add to My List'}</button>` : ''}
          </div>
        </div>
      </div>
    </section>` : ''}
    ${rows.length ? html`<section class="hb-sec"><div class="hb-sechead"><h3>Most downloaded</h3><span>Last ${days} days, all members</span></div>
      <div class="hb-chart3">${rows.map((e, i) => html`<button class="hb-crow" key=${e.path} onClick=${() => onOpen(e)}>
        <span class="hb-rank">${i + 1}</span>
        ${coverOf(e) ? html`<img src=${coverSrc(coverOf(e))} alt="" />` : html`<span class="hb-noimg">${(cleanTitle(e.title)[0] || '?').toUpperCase()}</span>`}
        <span class="hb-cinfo"><b>${cleanTitle(e.title)}</b><span>${e.count.toLocaleString('en-US')} downloads${e.sizeBytes ? ' · ' + formatSize(e.sizeBytes) : ''}</span><i>${(Number(e.pcvr) || 0) > (Number(e.pc) || 0) ? 'VR' : 'PC'}</i></span>
      </button>`)}</div></section>` : ''}
    ${fresh && fresh.length ? html`<section class="hb-sec"><div class="hb-sechead"><h3>Fresh builds</h3><span>Newest updates first</span></div>
      <div class="hb-fresh">${fresh.map((f) => html`<button class="hb-fcard" key=${f._remote + f.name} onClick=${() => onOpen({ remote: f._remote, path: (f._folder ? f._folder + '/' : '') + f.name })}>
        <img src=${coverSrc(f.coverArt.cover.url)} alt="" /><b>${cleanTitle(f.name)}</b><span>${[buildNumber(f.name) && 'Build ' + buildNumber(f.name), harborDate(f.modTime)].filter(Boolean).join(' · ')}</span>
      </button>`)}</div></section>` : ''}
    ${active.length ? html`<section class="hb-now"><div class="hb-nowhead"><b>Downloading now</b><span>${left > 0 ? formatSize(left) + ' left' : ''}</span></div>
      ${active.slice(0, 4).map((d) => { const pct = Math.max(0, Math.min(100, Number(d.progress) || 0)); return html`<div class="hb-nowitem" key=${d.id}><span class="hb-nowdot"><i style=${'width:' + pct + '%'}></i></span><span class="hb-nowtext"><b>${cleanTitle(d.name || '')}</b><span>${Math.round(pct)}%${d.totalSpeed ? ' · ' + d.totalSpeed : ''}</span></span></div>`; })}
    </section>` : ''}
  </div>`;
}

function HomeView({ myList, render, onOpenTrend, history, onRadarOpen, onRadarSave, onResume, harbor, downloads, actions }) {
  const [fresh, setFresh] = useState(null);
  useEffect(() => { if (harbor) harborNewest().then(setFresh).catch(() => setFresh([])); }, [harbor]);
  const [trend, setTrend] = useState(null);
  const [gems, setGems] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    api.trending().then((r) => setTrend(r.ok && r.data && r.data.windows ? r.data.windows : {}));
    api.appProgress().then((r) => setProgress(r.ok && r.data ? r.data : {}));
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
  return html`<main class="home">
    ${harbor && trend ? html`<${HarborLead} windows=${trend} downloads=${downloads} onOpen=${onOpenTrend} fresh=${fresh} actions=${actions} />` : ''}
    ${harbor ? '' : html`<${Strip} id="trending" title="\u{1F525} Trending Downloads">
      ${trend === null ? html`<div class="loading">Loading…</div>` : html`<${TrendingStrip} windows=${trend} onOpen=${onOpenTrend} />`}
      <div class="strip-note">Download counts are from the last 7 or 30 days, not all-time totals.</div>
    </${Strip}>`}
    <${Strip} id="picks" title="Game Radar" sub="Personalized picks">
      ${trend === null || progress === null ? html`<div class="loading">Loading…</div>` : html`<${RadarStrip} trend=${trend} progress=${progress} myList=${myList} history=${history} onOpen=${onRadarOpen} onSave=${onRadarSave} onResume=${onResume} />`}
    </${Strip}>
    <${Strip} id="gems" title="Hidden Gems" sub="In the library a while, hardly downloaded. A different handful each day.">
      ${gems === null ? html`<div class="loading">Loading…</div>` : !gems.length ? html`<div class="empty">No gems today.</div>` : html`<div class="hrow">${gems.map((it) => render(it, 'g'))}</div>`}
    </${Strip}>
  </main>`;
}

// Updating happens inside the app (Nov 24 2026; it used to open a download popup, then a grey Windows box): runAppUpdate starts it from any
// button, UpdateScreen covers the app window with the progress, and the install screen that shows while the app is closed uses these colours.
function pageColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const body = getComputedStyle(document.body).backgroundColor;
  const bg = body && body !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(body) ? body : v('--bg');
  return { bg, fg: v('--fg'), dim: v('--dim'), accent: v('--accent'), track: v('--inset') || v('--surface') || v('--line') };
}
async function runAppUpdate(source) {
  window.dispatchEvent(new CustomEvent('app-update', { detail: { kind: 'start' } }));
  let r;
  try { r = await api.installUpdate({ silent: true, relaunchAfterInstall: true, source, screen: pageColors() }); } catch (e) { r = { success: false, error: 'The update could not be started' }; }
  // Still running means the app is about to close for the install; anything else (an error, "install it yourself" on Linux/macOS) puts the app back.
  if (!r || r.success === false || r.message) window.dispatchEvent(new CustomEvent('app-update', { detail: { kind: 'stop' } }));
  return r;
}
function UpdateScreen() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    const onEv = (e) => { const k = e.detail && e.detail.kind; if (k === 'start') setSt({ pct: null, text: 'Getting the update ready...' }); else if (k === 'stop') setSt(null); };
    window.addEventListener('app-update', onEv);
    try {
      if (api.onUpdate) api.onUpdate((m) => setSt((prev) => {
        const s = { ...(prev || { pct: null }), version: (m && m.version) || (prev && prev.version) || '' };
        const p = m && m.payload;
        if (m && m.channel === 'update-progress' && p) { s.pct = typeof p.percent === 'number' ? p.percent : null; s.text = [p.status, p.speed].filter(Boolean).join(' · '); }
        else if (m && m.channel === 'update-status') { const t = String(p || ''); s.text = /^Installing update/i.test(t) ? 'Closing to install. ARMGDDN App opens again by itself in about a minute, right here.' : t; s.closing = /^Installing update/i.test(t); if (s.closing) s.pct = 100; }
        return s;
      }));
    } catch (e) { }
    return () => window.removeEventListener('app-update', onEv);
  }, []);
  if (!st) return '';
  return html`<div class="upscreen" role="dialog" aria-live="polite" aria-label="Updating ARMGDDN App"><div class="upbox">
    <img class="uplogo" src="skull-logo.png" alt="" />
    <h2>${st.version ? 'Updating to v' + st.version : 'Updating ARMGDDN App'}</h2>
    <div class=${'upbar' + (st.pct == null ? ' busy' : '')}><i style=${st.pct == null ? '' : 'width:' + Math.round(st.pct) + '%'}></i></div>
    <p class="uptext">${st.text || ''}${st.pct != null && !st.closing ? ' · ' + Math.round(st.pct) + '%' : ''}</p>
    ${st.closing ? '' : html`<p class="upnote">When it is ready the app closes for about a minute to install, then opens again right here.</p>`}
  </div></div>`;
}

// Shared by the classic Downloads page and Harbor's: a download's buttons (with the Mbps / MiB/s switch while it runs) and the files it is fetching at once.
function DownloadButtons({ d, mib, onFlip }) {
  return html`<div class="dbtns">${isActiveDownload(d) && onFlip && !finishingStage(d) ? html`<button class="dbtn" title="Show the speed in MiB/s instead of bits per second (for every download)" onClick=${onFlip}>${mib ? 'Show Mbps' : 'Show MiB/s'}</button>` : ''}${downloadActions(d).map((k) => html`<button class="dbtn" onClick=${() => (k === 'openFolder' ? api.openFolder(d.id) : api[k](d.id))}>${{ pause: 'Pause', resume: 'Resume', cancel: 'Cancel', retry: 'Retry', openFolder: 'Open folder' }[k]}</button>`)}</div>`;
}
function ActiveFiles({ d, mib, folded }) {
  const af = activeFileRows(d.activeFiles);
  if (!af.total) return '';
  const head = html`${af.total} file${af.total === 1 ? '' : 's'} at once`;
  const rows = html`${af.rows.map((r) => html`<div class="dfile"><span class="dfname" title=${r.name}>${r.name}${r.source ? html` <span class=${'dfsrc ' + r.source.toLowerCase()} title=${r.source === 'Drive' ? 'Downloaded straight from Google Drive' : 'Downloaded through the ARMGDDN download gateway'}>${r.source}</span>` : ''}</span><span class="dfpct">${r.pct}%</span><div class="bar small"><div class="fill" style=${'width:' + r.pct + '%'}></div></div><span class="dfspeed">${mib && r.bytes > 0 ? formatMiBps(r.bytes) : r.speed}</span></div>`)}${af.more ? html`<div class="dfmore">and ${af.more} more</div>` : ''}`;
  // Harbor's cards fold the list away (click to open); the classic page always shows it.
  return folded
    ? html`<details class="dfiles folded" title="The files being downloaded right now"><summary class="dfhead">${head}</summary>${rows}</details>`
    : html`<div class="dfiles" title="The files being downloaded right now"><div class="dfhead">${head}</div>${rows}</div>`;
}
// Cover art for titles from the library listings they sit in (each listing read once): wanted = [{key, group, folder, name, collection}] -> {key: url}.
// collection: also try the Music/Comics folder picture when the title has no cover.
function useListingCovers(wanted) {
  const [art, setArt] = useState({});
  const sig = wanted.map((w) => w.key + '|' + w.group + '|' + w.folder + '|' + w.name).join('||');
  useEffect(() => {
    let live = true;
    (async () => {
      const out = {}; const listings = new Map();
      for (const w of wanted) {
        const k = w.group + '|' + w.folder;
        if (!listings.has(k)) { const b = await api.browse(w.group, w.folder); listings.set(k, b.ok ? (b.data.files || []) : []); }
        const hit = listings.get(k).find((f) => f && f.name === w.name);
        const url = (hit && hit.coverArt && hit.coverArt.cover && hit.coverArt.cover.url) || (w.collection ? collectionCoverPath(w.group, w.folder, hit || { name: w.name, isDir: true }) : '');
        if (url) out[w.key] = url;
      }
      if (live && Object.keys(out).length) setArt((prev) => ({ ...prev, ...out }));
    })();
    return () => { live = false; };
  }, [sig]);
  return art;
}

// Download > Check > Unpack > Ready, with the step it is on lit (Nov 24: members could not tell a finished-but-unpacking title from a stuck one).
function StepBar({ d }) {
  const steps = downloadSteps(d);
  if (!steps) return '';
  const now = steps.find((s) => s.state === 'now');
  return html`<ol class="dsteps" aria-label=${'Download steps' + (now ? ', now: ' + now.label : ', all done')}>${steps.map((s) => html`<li key=${s.key} class=${'dstep ' + s.state} aria-current=${s.state === 'now' ? 'step' : undefined}><i aria-hidden="true"></i>${s.label}${s.state === 'skip' ? html`<span class="dskip"> (skipped)</span>` : ''}</li>`)}</ol>`;
}

// Harbor: the Downloads page of the mockup: a heading with speed, what is left and when it is done, the active downloads as art cards whose picture fills in
// (colour, left to right) as they progress, then Waiting and Finished lists. The art is read from the library listing as needed, not saved.
function HarborDownloads({ list, speedText, onClear, mib, onFlip }) {
  const covers = useListingCovers(list.map((d) => { const w = downloadPlace(d); return w ? { key: d.id, ...w, collection: true } : null; }).filter(Boolean));
  const art = useMemo(() => Object.fromEntries(Object.entries(covers).map(([k, u]) => [k, coverSrc(u)])), [covers]);
  const st = (d) => String(d.status || '').toLowerCase();
  const { active, waiting, done } = splitDownloads(list);
  const speed = active.reduce((n, d) => n + (finishingStage(d) ? 0 : Number(d.totalSpeedBytes) || 0), 0);
  const left = bytesLeft([...active, ...waiting]);
  const mins = speed > 0 && left > 0 ? Math.max(1, Math.round(left / speed / 60)) : 0;
  const bytesOf = (d) => formatSize(d.totalSize) || '';
  const actions = (d) => html`<${DownloadButtons} d=${d} mib=${mib} onFlip=${onFlip} />`;
  const thumb = (d, gray) => (art[d.id] ? html`<img class=${'hb-thumb' + (gray ? ' gray' : '')} src=${art[d.id]} alt="" />` : html`<span class="hb-thumb none"></span>`);
  return html`<div class="hb-dls">
    <div class="hb-dtitlebar"><div><h2>Downloads</h2><span class="hb-dsub">Every part is checked, and the game is extracted when it is done</span></div>
      <div class="hb-dstats">
        <div><span>Speed</span><b>${speed > 0 ? speedInUnit(speed, mib) : '—'}</b></div>
        <div><span>Left</span><b>${left > 0 ? formatSize(left) : '—'}</b></div>
        <div><span>All done in</span><b>${mins ? 'about ' + mins + ' min' : '—'}</b></div>
      </div></div>
    ${active.length ? html`<div class="hb-dlgrid">${active.map((d) => { const pct = Math.max(0, Math.min(100, Number(d.progress) || 0)); const img = art[d.id]; const paused = st(d) === 'paused';
      return html`<article class=${'hb-dcard' + (paused ? ' paused' : '')} key=${d.id}>
        <div class="hb-dart" role="progressbar" aria-label=${cleanTitle(d.name || '') + ' progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(pct)}>${img ? html`<img class="hb-dbg" src=${img} alt="" aria-hidden="true" /><img class="hb-dgray" src=${img} alt="" /><img class="hb-dcolor" style=${'clip-path:inset(0 ' + (100 - pct) + '% 0 0)'} src=${img} alt="" />` : ''}<i class="hb-dedge" style=${'left:calc(' + pct + '% - 1px)'}></i></div>
        <div class="hb-dbody"><div class="hb-dtop"><span class="hb-dtitle">${cleanTitle(d.name || '')}</span><span class="hb-dpct">${Math.round(pct)}%</span></div>
          <div class="hb-dline">${[bytesOf(d) && (formatSize(bytesDone(d)) || '0 B') + ' of ' + bytesOf(d), paused ? 'paused' : finishingText(d) || speedText(d), !paused && !finishingStage(d) && etaShown(d.eta) ? etaShown(d.eta) + ' left' : ''].filter(Boolean).join(' · ')}</div>
          <${StepBar} d=${d} />
          ${d.error ? html`<div class="derr">${d.error}</div>` : ''}<${ActiveFiles} d=${d} mib=${mib} folded=${true} />${actions(d)}</div>
      </article>`; })}</div>` : ''}
    <div class="hb-dcols">
      <section><h3>Waiting</h3>${waiting.length ? waiting.map((d) => html`<div class="hb-drow" key=${d.id}>${thumb(d, true)}<span class="hb-dinfo"><b>${cleanTitle(d.name || '')}</b><span>${bytesOf(d)}${bytesOf(d) ? ' · ' : ''}starts when a slot frees up</span></span><${DownloadButtons} d=${d} /></div>`) : html`<div class="hb-dnone">Nothing is waiting.</div>`}</section>
      <section><div class="hb-dsechead"><h3>Finished</h3>${done.length ? html`<button class="dbtn" title="Remove finished downloads from this list" onClick=${onClear}>Clear history</button>` : ''}</div>${done.length ? done.map((d) => html`<div class="hb-drow" key=${d.id}>${thumb(d, false)}<span class="hb-dinfo"><b>${cleanTitle(d.name || '')}</b><span>${[bytesOf(d), st(d) === 'completed' ? finishedText(d) : st(d)].filter(Boolean).join(' · ')}</span></span>${actions(d)}</div>`) : html`<div class="hb-dnone">Nothing finished yet.</div>`}</section>
    </div>
  </div>`;
}

function DownloadsView({ list, onClear, harbor }) {
  // Speed in bits per second as the Companion has always shown it; MiB/s is an option, remembered, switched from any download.
  const [mib, setMib] = useState(() => { try { return localStorage.getItem('native.speedUnit') === 'mib'; } catch (e) { return false; } });
  const flip = () => { const n = !mib; setMib(n); try { localStorage.setItem('native.speedUnit', n ? 'mib' : 'bits'); } catch (e) { } };
  const speedText = (d) => (mib && Number(d.totalSpeedBytes) > 0 ? formatMiBps(d.totalSpeedBytes) : (d.totalSpeed || formatSpeed(d.speed)));
  const heard = html`<div class="sr-only" role="status" aria-live="polite">${downloadAnnouncement(list)}</div>`;
  if (!list.length) return html`<div class="empty">No downloads yet. Press Download on any game, album or comic collection.</div>`;
  if (harbor) return html`${heard}<${HarborDownloads} list=${list} speedText=${speedText} onClear=${onClear} mib=${mib} onFlip=${flip} />`;
  return html`${heard}<div class="dlist"><div class="dtools"><button class="dbtn" title="Remove finished downloads from this list" onClick=${onClear}>Clear history</button></div>${list.slice().reverse().map((d) => html`<div class="drow" key=${d.id}>
    <div class="dname">${cleanTitle(d.name || '')}<span class="dstat">${d.status || ''}</span></div>
    <div class="bar" role="progressbar" aria-label=${cleanTitle(d.name || '') + ' progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(Math.max(0, Math.min(100, Number(d.progress) || 0)))}><div class="fill" style=${'width:' + Math.max(0, Math.min(100, Number(d.progress) || 0)) + '%'}></div></div>
    <div class="dmeta">${[Math.round(Number(d.progress) || 0) + '%', formatSize(bytesDone(d)) && formatSize(bytesDone(d)) + ' of ' + formatSize(d.totalSize), finishingText(d) || speedText(d), elapsedShown(d) ? 'Elapsed ' + elapsedShown(d) : '', etaShown(d.eta) ? 'ETA ' + etaShown(d.eta) : '', d.fileCount > 1 ? (d.completedFiles || 0) + ' of ' + d.fileCount + ' files' : ''].filter(Boolean).join(' · ')}</div>
    ${isActiveDownload(d) ? html`<${StepBar} d=${d} />` : ''}
    <${ActiveFiles} d=${d} mib=${mib} />
    ${d.error ? html`<div class="derr">${d.error}</div>` : ''}
    <${DownloadButtons} d=${d} mib=${mib} onFlip=${flip} />
  </div>`)}</div>`;
}

// A page that throws while it draws must not take the whole window with it: it says so and offers Back.
class PageGuard extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  componentDidCatch(err) {
    this.setState({ err });
    try { console.error('[page crash] ' + (err && err.message ? err.message : err) + ' ' + String(err && err.stack || '').split('\n').slice(0, 3).join(' | ')); } catch (e) { }
  }
  render(props) {
    if (!this.state.err) return props.children;
    return html`<div class="notice"><strong>This page ran into a problem.</strong> It has been reported in the log. <button class="dbtn" onClick=${() => this.setState({ err: null })}>Try again</button> <button class="dbtn" onClick=${props.onBack}>Back</button></div>`;
  }
}

function App() {
  const [status, setStatus] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [adminStart, setAdminStart] = useState({ tab: '', n: 0 });   // where the Admin page opens (the dock sends the owner to Analytics)
  const [realAdmin, setAdmin] = useState(null);       // { role, canManage } for owners and admins, null for everyone else
  // Owner view: an owner can switch the owner pages off to see the app as a regular member (the website's /ot toggle). It is a setting, so it stays.
  const [ownerViewOff, setOwnerViewOff] = useState(() => { try { return localStorage.getItem('native.ownerViewOff') === '1'; } catch (e) { return false; } });
  const admin = ownerViewOff && realAdmin && realAdmin.role === 'owner' ? null : realAdmin;
  const ownerToggle = realAdmin && realAdmin.role === 'owner' ? { off: ownerViewOff, set: (off) => { setOwnerViewOff(off); try { localStorage.setItem('native.ownerViewOff', off ? '1' : '0'); } catch (e) { } } } : null;
  const [bundles, setBundles] = useState(null);       // publisher collections for the Comics page
  const [quota, setQuota] = useState(() => new Set());     // sections whose download quota is used up
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchStart, setWatchStart] = useState('');
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
  // Grid (the cards with art) or list (titles only). Remembered on this PC; it applies to every page that lists titles.
  const [viewMode, setViewModeState] = useState(() => { try { return localStorage.getItem('native.viewMode') === 'list' ? 'list' : 'grid'; } catch (e) { return 'grid'; } });
  const setViewMode = (m) => { setViewModeState(m); try { localStorage.setItem('native.viewMode', m); } catch (e) { } };
  const [noticeOff, setNoticeOff] = useState(false);
  const [view, setView] = useState('home');
  // Back: the screens you came from, newest last. Alt+Left or the mouse's back button does the same. A step the app takes by itself (opening the
  // mirror's root folder) is not a screen of its own, so Back skips it.
  const navStack = useRef([]);
  const navNow = useRef(null);
  const navRestoring = useRef(false);
  const [canBack, setCanBack] = useState(false);
  const [openRequest, setOpenRequest] = useState(null);
  useEffect(() => { api.onOpen((m) => { if (m && m.view === 'requests') { setView('requests'); setOpenRequest(m.id); } else if (m && m.view === 'settings') { setView('settings'); if (m.check) setTimeout(() => { try { window.dispatchEvent(new Event('native-run-update-check')); } catch (e) { } }, 500); } else if (m && ['downloads', 'home', 'library', 'mylist', 'wiki', 'badges'].includes(m.view)) setView(m.view); }); }, []);
  const [downloads, setDownloads] = useState([]);
  const [toast, setToast] = useState('');
  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const [whatsNew, setWhatsNew] = useState(null);
  const [askReports, setAskReports] = useState(false);
  useEffect(() => { api.getSettings().then((r) => { if (r && typeof r === 'object' && r.errorReportingAsked !== true) setAskReports(true); }).catch(() => { }); }, []);
  useEffect(() => { api.pendingWhatsNew().then((e) => { if (e) setWhatsNew(e); }).catch(() => { }); }, []);
  // A new Companion version: found at start-up, or announced by the hourly check in the main process.
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    let alive = true;
    try { api.onUpdateAvailable((info) => { if (alive && info && info.hasUpdate) setUpdateInfo(info); }); } catch (e) { }
    const onFound = (e) => { if (alive && e && e.detail && e.detail.hasUpdate) setUpdateInfo(e.detail); };
    window.addEventListener('native-update-found', onFound);
    api.checkUpdates().then((r) => { if (alive && r && r.hasUpdate) setUpdateInfo(r); }).catch(() => { });
    return () => { alive = false; window.removeEventListener('native-update-found', onFound); };
  }, []);
  const installUpdate = async () => {
    setUpdating(true);
    try {
      const r = await runAppUpdate('native-banner');
      if (r && r.success === false && !r.installerPath) { setUpdating(false); say((r && r.error) || 'The update could not be started'); }
    } catch (e) { setUpdating(false); say('The update could not be started'); }
  };
  const [details, setDetails] = useState(null);
  const [preview, setPreview] = useState(null);
  const [myList, setMyList] = useState(() => { try { return JSON.parse(localStorage.getItem(MY_LIST_KEY) || '[]'); } catch (e) { return []; } });
  const [category, setCategory] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const [index, setIndex] = useState(null);     // every section's library list, loaded once when searching everywhere
  useEffect(() => {
    if ((!everywhere && query.trim().length < 3) || index || !tabs.length) return;
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
  }, [everywhere, tabs, query.trim().length >= 3]);
  const ctxRemote = (it) => (it && it._remote != null ? it._remote : remote);
  const ctxFolder = (it) => (it && it._folder != null ? it._folder : folder);
  const itemPath = (it) => [ctxFolder(it), it.name].filter(Boolean).join('/');
  const applyPrefs = (p, quiet, listOnly) => {
    const m = mergeMyList(myList, p.myList);
    setMyList(m.list); try { localStorage.setItem(MY_LIST_KEY, JSON.stringify(m.list)); } catch (e) { }
    if (listOnly) { if (m.added) say('Added ' + m.added + ' new My List item' + (m.added === 1 ? '' : 's') + ' from the website.'); return; }
    try {
      for (const [id, on] of Object.entries(p.strips)) localStorage.setItem('native.strip.' + id, on ? '1' : '0');
      // the website's own default ("dark") is not a choice the member made, so it does not replace the Harbor default
      if (p.theme && p.theme !== 'dark' && themeKeyOk(p.theme)) setThemeSel((c) => persistChoice(withWebsiteTheme(c, THEMES, p.theme)));
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
  // Viewing mode (Dark, Light, System) and a theme for each side; the theme menu lists only the themes of the side on screen (themeMode.mjs).
  const [themeSel, setThemeSel] = useState(() => loadChoice(THEMES, lsRaw));
  const [osIsLight, setOsIsLight] = useState(osLight);
  const shownMode = effectiveMode(themeSel.mode, osIsLight);
  const themeChoice = themeSel[shownMode];
  const chooseMode = (m) => setThemeSel((c) => persistChoice({ ...c, mode: m }));
  const chooseTheme = (id) => setThemeSel((c) => persistChoice(withTheme(c, THEMES, id)));
  useEffect(() => { applyTheme(themeChoice); }, [themeChoice]);
  useEffect(() => { let mq; try { mq = window.matchMedia('(prefers-color-scheme: light)'); } catch (e) { return; } const on = () => { setOsIsLight(mq.matches); setThemeSel((c) => persistChoice(c)); }; mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, []);
  const [animOn, setAnimOn] = useState(() => { try { return localStorage.getItem('native.animations') !== '0'; } catch (e) { return true; } });
  useEffect(() => { document.documentElement.dataset.anim = animOn ? '1' : '0'; }, [animOn]);
  const toggleAnim = () => { const v = !animOn; setAnimOn(v); try { localStorage.setItem('native.animations', v ? '1' : '0'); } catch (e) { } };
  const [expired, setExpired] = useState(false);
  const [staffOk, setStaffOk] = useState(false);
  const logout = async () => { await api.logout(); setStatus({ signedIn: false }); };
  const [radarHistory, setRadarHistory] = useState(() => lsGet('native.radarHistory', []));
  // Opening a game folder is remembered (newest first) so Game Radar can say "Continue browsing" and offer "Resume last visit".
  const recordVisit = (item, rem, base) => {
    const group = radarGroup(rem);
    const path = [base, item.name].filter(Boolean).join('/');
    if (!isRadarRemote(group) || radarPath(path).split('/').filter(Boolean).length < 2) return;
    const e = { remote: group, path, name: item.name, title: cleanTitle(item.name), downloadCount: Number(item.downloadCount) || 0, releaseDate: item.releaseDate || null, coverArt: item.coverArt || null, dateAdded: new Date().toISOString() };
    const next = [e, ...radarHistory.filter((x) => radarKey(x.remote, x.path, x.name) !== radarKey(e.remote, e.path, e.name))].slice(0, RADAR_HISTORY_MAX);
    setRadarHistory(next); lsSet('native.radarHistory', next);
  };
  const openRadar = (it) => {
    if (it.source === 'trending') { const parts = radarPath(it.path).split('/').filter(Boolean); const name = parts.pop(); pendingScroll.current = name || ''; goTo(it.remote, parts.join('/')); return; }
    goTo(it.remote, radarPath(it.path));
  };
  const saveRadar = (it) => {
    const next = myListToggle(myList, { name: it.name || it.title, remote: it.remote, path: radarPath(it.path), size: 0, downloadCount: it.downloadCount, releaseDate: it.releaseDate, coverArt: it.coverArt });
    setMyList(next); try { localStorage.setItem(MY_LIST_KEY, JSON.stringify(next)); } catch (e) { }
    say('Added to My List');
  };
  // Back and Forward remember where you were: the section and folder, the search, filter and sort, and how far the list was scrolled (Dirk, Nov 20:
  // Back from a game's folder dropped you at the top of the list, and there was no way forward).
  const fwdStack = useRef([]);
  const scrollMemo = useRef(new Map());     // nav key -> scrollTop of the list while that page was open
  const extraMemo = useRef(new Map());      // nav key -> { query, category, sort, reverse }
  const pendingTop = useRef(null);
  const [canFwd, setCanFwd] = useState(false);
  useEffect(() => {
    const onScroll = (e) => { const t = e.target; if (t && t.classList && (t.classList.contains('grid') || t.classList.contains('list')) && navNow.current) scrollMemo.current.set(navNow.current.key, t.scrollTop); };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
  useEffect(() => { if (navNow.current) extraMemo.current.set(navNow.current.key, { query, category, sort, reverse }); }, [query, category, sort, reverse]);
  const snapshot = (st, key) => ({ ...st, scroll: scrollMemo.current.get(key) || 0, extra: extraMemo.current.get(key) || null });
  useEffect(() => {
    const lib = view === 'library';
    const state = { view, remote: lib ? remote : '', folder: lib ? folder : '', everywhere: lib ? everywhere : false };
    const key = JSON.stringify(state);
    const prev = navNow.current;
    if (prev && prev.key !== key && !navRestoring.current) {
      navStack.current.push(snapshot(prev.state, prev.key));
      if (navStack.current.length > 60) navStack.current.shift();
      fwdStack.current = [];                  // a new step forgets the old "forward" pages, like a browser
    }
    navRestoring.current = false;
    navNow.current = { key, state };
    extraMemo.current.set(key, { query, category, sort, reverse });
    setCanBack(navStack.current.length > 0);
    setCanFwd(fwdStack.current.length > 0);
  }, [view, remote, folder, everywhere]);
  const restoreScroll = () => {
    if (pendingTop.current == null) return;
    const t = pendingTop.current;
    for (const ms of [150, 600]) setTimeout(() => { const el = document.querySelector('main.grid, main.list'); if (el && t != null) el.scrollTop = t; }, ms);
    setTimeout(() => { pendingTop.current = null; }, 700);
  };
  const applyNav = (e) => {
    navRestoring.current = true;
    setEverywhere(e.everywhere);
    setView(e.view);
    if (e.view === 'library') {
      autoOk.current = false;
      const x = e.extra || {};
      setCategory(x.category || ''); setQuery(x.query || '');
      if (x.sort) setSort(x.sort);
      setReverse(!!x.reverse);
      pendingTop.current = e.scroll || 0;
      setRemote(e.remote); setFolder(e.folder);
      restoreScroll();                        // also when the folder did not change (the list is already there)
    }
  };
  const goBack = () => {
    const cur = navNow.current && navNow.current.state;
    const curKey = navNow.current && navNow.current.key;
    let prev = navStack.current.pop();
    // skip the app's own step into a game group's root folder ("PC Games" -> "PC1")
    while (prev && cur && prev.view === 'library' && cur.view === 'library' && prev.remote === cur.remote && prev.folder === '' && /^PC(VR)?\d$/.test(cur.folder || '') && navStack.current.length) prev = navStack.current.pop();
    setCanBack(navStack.current.length > 0);
    if (!prev) return;
    if (cur) { fwdStack.current.push(snapshot(cur, curKey)); setCanFwd(true); }
    applyNav(prev);
  };
  const goForward = () => {
    const next = fwdStack.current.pop();
    setCanFwd(fwdStack.current.length > 0);
    if (!next) return;
    const cur = navNow.current && navNow.current.state;
    if (cur) { navStack.current.push(snapshot(cur, navNow.current.key)); setCanBack(true); }
    applyNav(next);
  };
  useEffect(() => {
    const key = (e) => {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); return; }
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      // Keyboard (Nov 24 2026): / searches, Esc goes back (or leaves the search box), the arrow keys move between cards.
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const open = document.querySelector('.overlay, .modal');     // a window on top handles its own Esc
      if (typing) { if (e.key === 'Escape' && !open && t.classList && t.classList.contains('search')) t.blur(); return; }
      if (e.key === '/') { const box = document.querySelector('input.search'); if (box) { e.preventDefault(); box.focus(); box.select(); } return; }
      if (e.key === 'Escape') { if (!open && canBack) { e.preventDefault(); goBack(); } return; }
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
      if (!dir || open) return;
      const cards = [...document.querySelectorAll('.card[tabindex], .lrow[tabindex]')].filter((c) => c.offsetParent);
      if (!cards.length) return;
      const box = (c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      const i = cards.indexOf(document.activeElement);
      const next = i < 0 ? 0 : nearestCard(box(cards[i]), cards.map(box), dir);
      if (next == null || next === i) return;
      e.preventDefault();
      cards[next].focus();
      cards[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const mouse = (e) => { if (e.button === 3) { e.preventDefault(); goBack(); } else if (e.button === 4) { e.preventDefault(); goForward(); } };
    window.addEventListener('keydown', key); window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); };
  });
  const watchTitle = async (title) => {
    const t = String(title || '').trim();
    if (t.length < 2) return;
    const r = await api.watchAdd(t);
    say(r && r.ok && r.data ? (r.data.message || 'Added to your watchlist.') : ((r && r.error && r.error.message) || 'Could not add it to your watchlist'));
  };
  const goTo = (rem, path) => { setEverywhere(false); setView('library'); autoOk.current = false; setQuery(''); setCategory(''); setRemote(rem); setFolder(path); };
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
  const browseInto = (item) => { recordVisit(item, ctxRemote(item), ctxFolder(item)); goTo(ctxRemote(item), itemPath(item)); };
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
      // remotePath (+ the section, actualRemote, for 3D, Apps and the like): finished rows find their cover art by where the title sits in the library
      // (downloadPlace); without them the art vanished once a download left the live list (Nov 24 2026).
      const done = (Array.isArray(h) ? h : []).filter((d) => d && !ids.has(d.id)).slice(0, 30)
        .map((d) => ({ id: d.id, name: d.name, status: d.status || 'completed', progress: 100, totalSize: d.totalSize, downloadedSize: d.totalSize, remotePath: d.remotePath || '', resumeRemote: d.actualRemote || '', resumePath: d.actualRemote ? (d.remotePath || '') : '', didCheck: d.didCheck, checkOk: d.checkOk, didExtract: d.didExtract, planUnpack: d.planUnpack }));
      setDownloads([...done.reverse(), ...active]);   // oldest first; the list is shown newest first
    };
    tick(); const t = setInterval(tick, 1500);
    return () => { live = false; clearInterval(t); };
  }, []);
  const activeCount = downloads.filter(isActiveDownload).length;
  const runningCount = downloads.filter(isRunningDownload).length;   // paused downloads do not hold up an update
  // "Update automatically" (Settings): only the classic window ever acted on it (Nov 24 2026). With an update waiting and nothing running
  // for 15 s, install it the same way the update bar does.
  const autoUpdateTried = useRef(false);
  useEffect(() => {
    if (!updateInfo || updating || runningCount > 0 || autoUpdateTried.current) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const st = await api.getSettings();
        if (live && st && st.autoUpdate && !autoUpdateTried.current) { autoUpdateTried.current = true; installUpdate(); }
      } catch (e) { }
    }, 15000);
    return () => { live = false; clearTimeout(t); };
  }, [updateInfo, updating, runningCount]);
  const pageLabel = view === 'library' ? (everywhere ? 'Search everywhere' : (remote || 'Library')) : ({ home: 'Home', tools: 'Tools', settings: 'Settings', wiki: 'Wiki', mylist: 'My List', requests: 'Requests', badges: 'Badges', downloads: 'Downloads', admin: 'Admin' }[view] || '');
  const prevActive = useRef(0); const [pulse, setPulse] = useState(false);
  useEffect(() => { if (activeCount > prevActive.current) { setPulse(true); const id = setTimeout(() => setPulse(false), 1700); prevActive.current = activeCount; return () => clearTimeout(id); } prevActive.current = activeCount; }, [activeCount]);
  const autoOk = useRef(true);   // step into the library folder when a tab is opened, but not when the member clicks back to the top

  const fail = (e) => { setError(e || { message: 'Something went wrong' }); setItems([]); };
  const boot = async (afterSignIn) => {
    setError(null);
    const s = await api.status();
    setStatus(s.ok ? s.data : { signedIn: false });
    if (!s.ok || !s.data.signedIn) return;
    const r = await api.remotes();
    // A saved sign-in the site no longer accepts (expired): sign out here so the sign-in screen comes back, instead of empty pages.
    if (!r.ok && r.error && (r.error.kind === 'auth' || r.error.status === 401)) { try { await api.logout(); } catch (e) { } setExpired(true); setStatus({ signedIn: false }); return; }
    if (!r.ok) return fail(r.error);
    setExpired(false);
    const t = tabsFrom(r.data.remotes); setTabs(t); if (t.length) setRemote(t[0]);
    try { setQuota(quotaTabs(r.data.remoteStatus)); } catch (e) { }
    // Owners and admins get an Admin tab; the site answers 403 to everyone else, so nobody else ever sees it.
    let adminOk = false;
    try { const a = await api.adminGet('stats', {}); if (a && a.ok && a.data && (a.data.role === 'owner' || a.data.role === 'admin')) { adminOk = true; setAdmin({ role: a.data.role, canManage: !!a.data.canManageRequests }); } } catch (e) { }
    // The website copies each member's preferences to the server; the first time here they come over by themselves, and later visits only add
    // new My List entries. Nothing for the member to do. They are read first, because they also say whether the member has seen the intro.
    let pulled = null;
    let staffNow = adminOk;
    try { const pr = await api.prefs(); if (pr.ok && pr.data && pr.data.prefs) pulled = pr.data; if (pr.ok && pr.data && pr.data.isStaff) staffNow = true; } catch (e) { }
    // Current staff as Tulip lists them, or an owner or admin (Harbor used to be limited to them; it is for everyone since 6.9.0).
    setStaffOk(staffNow);
    // The lightning reveal: a welcome for the first sign-in here (see introDecision); not for anyone already signed in when the window opens, and
    // not for anyone who has seen it on the website. Never in a screenshot run.
    try {
      const d = introDecision({
        afterSignIn: !!afterSignIn, seenHere: localStorage.getItem('native.lightningSeen') === '1', off: localStorage.getItem('native.lightningOff') === '1',
        quiet: !!api.quiet, seenOnWebsite: !!(pulled && pulled.prefs && pulled.prefs.introSeen === true)
      });
      if (d.markSeen) localStorage.setItem('native.lightningSeen', '1');
      if (d.play) mountLoginLightning();
    } catch (e) { }
    try {
      if (pulled) {
        const seen = Number(localStorage.getItem('native.prefsPulled') || 0);
        const stamp = Number(pulled.updatedAt) || 1;
        if (stamp > seen) {
          const n = normalizePrefs(pulled.prefs);
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
      restoreScroll();
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
  useEffect(() => {
    if (remote !== 'Comics' || bundles) return;
    let live = true;
    api.comicBundles().then((r) => { if (live) setBundles(r && r.ok && r.data && Array.isArray(r.data.bundles) ? r.data.bundles : []); }).catch(() => { if (live) setBundles([]); });
    return () => { live = false; };
  }, [remote]);
  // One click: every series of a publisher's collection that is in this list, as one batch.
  const downloadBundle = async (b) => {
    const paths = b.present;
    for (let i = 0; i < paths.length; i++) { if (!(await passGates(paths[i], 'Comics', i > 0))) { say('Download cancelled'); return; } }
    const r = await api.downloadBatch('Comics', paths, []);
    if (r.ok) { say('Started ' + b.title); setView('downloads'); } else say(r.error.message || 'Could not start the download');
  };
  // The publisher collections are the first rows of the Comics list itself, so they scroll with it (just under the Komga box).
  const showBundles = view === 'library' && remote === 'Comics' && !everywhere && !folder && !query && items !== null;
  const signIn = async () => { await api.login(); boot(true); };

  if (status && !status.signedIn) return html`<div class="center"><h1>ARMGDDN</h1><p>${expired ? 'Your sign-in expired. Sign in again to carry on.' : 'Sign in to browse the library.'}</p><button class="primary" onClick=${signIn}>Sign in with Telegram</button></div>`;
  return html`<div class="shell">
    <div class="banner">
      <div class="header-stars"><div class="header-star header-star-1"></div><div class="header-star header-star-2"></div><div class="header-star header-star-3"></div></div>
      <div class="banner-actions">
        <button class="dbtn" title="Turn the moving effects on or off" onClick=${toggleAnim}>\u2728 Animations ${animOn ? 'on' : 'off'}</button>
      <select class="themesel modesel" title="Dark, Light, or System (follows this computer's setting)" value=${themeSel.mode} onChange=${(e) => chooseMode(e.target.value)}>${THEME_MODES.map(([k, l, i]) => html`<option value=${k}>${i} ${l}</option>`)}</select>
      <select class="themesel" title=${shownMode === 'light' ? 'Theme (light themes)' : 'Theme (dark themes)'} value=${themeChoice} onChange=${(e) => chooseTheme(e.target.value)}>${themesForMode(THEMES, shownMode).map(([k, l, i]) => html`<option value=${k}>${i} ${l}</option>`)}</select>
        ${status && status.signedIn ? html`<button class="dbtn" title="Sign out of this PC" onClick=${logout}>Logout</button>` : ''}
      </div>
      <div class="banner-credit"><div class="fire-particles"><i class="flame"></i><i class="flame"></i><i class="flame"></i><i class="flame"></i><i class="flame"></i><i class="flame"></i><i class="flame"></i><i class="flame"></i></div><span class="fire-text">Created by Old Man of the Hills v${(status && status.version) || ''}</span></div>
      <img class="banner-logo" src="skull-logo.png" alt="ARMGDDN" />
      <div class="banner-text"><h1>ARMGDDN APP</h1><p>Secure Multi-Remote Game Browser</p></div>
    </div>
    <header class="topbar">
      <button class=${view === 'home' ? 'tab on' : 'tab'} onClick=${() => setView('home')}>Home</button>
      <nav>${tabs.map((t) => html`<button class=${(view === 'library' && !everywhere && t === remote ? 'tab on' : 'tab') + (quota.has(t) ? ' quota' : '')} title=${quota.has(t) ? 'This section has used up its download quota. Try again later (it usually resets within 24 hours).' : ''} disabled=${quota.has(t)} onClick=${() => { setEverywhere(false); setCategory(''); setView('library'); autoOk.current = true; setRemote(t); setFolder(''); setQuery(''); }}>${t}</button>`)}</nav>
      <button class=${view === 'tools' ? 'tab on' : 'tab'} title="Only what I'm missing, Komga" onClick=${() => setView('tools')}>Tools</button>
      <button class=${view === 'settings' ? 'tab on' : 'tab'} title="Settings" onClick=${() => setView('settings')}>Settings</button>
      <button class=${view === 'wiki' ? 'tab on' : 'tab'} onClick=${() => setView('wiki')}>Wiki</button>
      <button class=${view === 'mylist' ? 'tab on' : 'tab'} onClick=${() => setView('mylist')}>My List${myList.length ? html` <span class="badge">${myList.length}</span>` : ''}</button>
      <button class=${view === 'requests' ? 'tab on' : 'tab'} onClick=${() => setView('requests')}>Requests</button>
      <button class=${view === 'badges' ? 'tab on' : 'tab'} title="Your badge collection" onClick=${() => setView('badges')}>Badges</button>
      ${admin ? html`<button class=${view === 'admin' ? 'tab on' : 'tab'} onClick=${() => setView('admin')}>Admin</button>` : ''}
      <button class=${(view === 'downloads' ? 'tab on' : 'tab') + (pulse ? ' pulse' : '')} onClick=${() => setView('downloads')}>Downloads${activeCount ? html` <span class="badge">${activeCount}</span>` : ''}</button>
    </header>
    <div class="subbar">
      <button class="tab backbtn" title="Go back (Alt+Left)" disabled=${!canBack} onClick=${goBack}>\u2190 Back</button>
      <button class="tab backbtn" title="Go forward (Alt+Right)" disabled=${!canFwd} onClick=${goForward}>Forward \u2192</button>
      <span class="subtitle">${pageLabel}</span>
      ${view === 'library' ? html`<${Fragment}>
      <label class="everywhere" title="Search every section, not just this list"><input type="checkbox" checked=${everywhere} onChange=${(e) => { setEverywhere(e.target.checked); setView('library'); }} /> Everywhere</label>
      <input class="search" type="search" placeholder=${everywhere ? "Search every section" : "Search this list"} aria-label=${everywhere ? "Search every section" : "Search this list"} value=${query} onInput=${(e) => setQuery(e.target.value)} />
      ${cats.length ? html`<select aria-label="Category" value=${category} onChange=${(e) => setCategory(e.target.value)}><option value="">All categories</option>${cats.slice(0, 80).map((c) => html`<option value=${c.name}>${c.name} (${c.count})</option>`)}</select>` : ''}
      <select aria-label="Sort by" value=${sort} onChange=${(e) => setSort(e.target.value)}><option value="name">Name</option><option value="popularity">Popularity</option><option value="newest">Added</option><option value="released">Released</option><option value="size">Size</option></select>
      <button class="tab" title="Reverse the order" onClick=${() => setReverse(!reverse)}>${reverse ? '\u2191' : '\u2193'}</button>
      ${batchOk ? html`<label class="everywhere" title="Pick several items and download them together"><input type="checkbox" checked=${batchOn} onChange=${(e) => setBatch(e.target.checked)} /> Batch</label>` : ''}
      ${batchActive ? html`<label class="everywhere"><input type="checkbox" checked=${allPicked} onChange=${(e) => setPicked(e.target.checked ? new Set(shown.map(itemKeyOf)) : new Set())} /> Select all</label><button class="primary" disabled=${!picked.size} onClick=${startBatch}>Download ${picked.size || ''} selected</button>` : ''}
      ${!everywhere && remote ? html`<select value="" title="Save this section's titles and sizes as a file" onChange=${async (e) => { const fmt = e.target.value; e.target.value = ''; if (!fmt) return; say('Preparing the list...'); const r = await api.exportList(remote, fmt); say(r.ok ? (r.data.saved ? 'Saved ' + r.data.name : 'Cancelled') : (r.error.message || 'Could not export this list')); }}><option value="">Export list</option><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option></select>` : ''}
      </${Fragment}>` : ''}
      ${(view === 'library' || view === 'mylist') ? html`<span class="viewsel" title="How the titles are shown"><button class=${viewMode === 'grid' ? 'tab on' : 'tab'} onClick=${() => setViewMode('grid')}>Grid</button><button class=${viewMode === 'list' ? 'tab on' : 'tab'} onClick=${() => setViewMode('list')}>List</button></span>` : ''}
    </div>
    ${updateInfo ? html`<div class="notice soft updatebar"><span>ARMGDDN App ${updateInfo.latestVersion ? 'v' + updateInfo.latestVersion : 'update'} is available (you have v${updateInfo.version || ''}).</span> ${runningCount > 0 ? html`<span class="sval">Finish or pause your downloads first: updating restarts ARMGDDN App.</span>` : ''}<button class="dbtn go" disabled=${updating || runningCount > 0 || !updateInfo.canAutoInstall} onClick=${installUpdate}>${updating ? 'Updating...' : 'Update now'}</button><button class="dbtn" onClick=${() => setUpdateInfo(null)}>Later</button></div>` : ''}
    <${PageGuard} key=${view} onBack=${goBack}>
    ${view === 'admin' && admin ? html`<${AdminView} key=${adminStart.n} admin=${admin} initialTab=${adminStart.tab} />` : ''}
    ${view === 'home' ? html`<${HomeView} harbor=${themeChoice === 'harbor'} downloads=${downloads} actions=${{ download: startDownload, details: setDetails, toggle: toggleList, inList: (it) => myList.some((m) => m.remote === it._remote && m.path === itemPath(it)) }} myList=${myList} history=${radarHistory} onRadarOpen=${openRadar} onRadarSave=${saveRadar} onResume=${() => radarHistory[0] && goTo(radarHistory[0].remote, radarHistory[0].path)} onOpenTrend=${openTrend} render=${(it, tag) => html`<${Card} key=${tag + (it._remote || '') + '/' + it._folder + '/' + it.name} item=${it} remote=${it._remote} folder=${it._folder} platform=${it._remote === 'PCVR Games' ? 'PCVR' : it._remote === 'PC Games' ? 'PC' : ''} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${myList.some((m) => m.remote === it._remote && m.path === itemPath(it))} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : view === 'tools' ? html`<${ToolsView} say=${say} />` : view === 'settings' ? html`<${SettingsView} ownerToggle=${ownerToggle} say=${say} onPrefs=${applyPrefs} onOpenGame=${(rem, name) => { setCategory(''); setView('library'); autoOk.current = true; setRemote(rem); setFolder(''); setQuery(name); }} />` : view === 'wiki' ? html`<${WikiView} />` : view === 'mylist' ? html`<${MyListView} list=${myList} listMode=${viewMode === 'list'} render=${(it) => html`<${Card} listMode=${viewMode === 'list'} key=${it.remote + '/' + it.path} item=${it} remote=${it._remote} folder=${it._folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${true} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : view === 'requests' ? html`<${RequestsView} say=${say} openId=${openRequest} />` : view === 'badges' ? html`<${BadgesView} say=${say} />` : view === 'admin' ? '' : view === 'downloads' ? html`<${DownloadsView} harbor=${themeChoice === 'harbor'} list=${downloads} onClear=${async () => { try { await api.clearHistory(); setDownloads((downloads || []).filter(isActiveDownload)); say('History cleared'); } catch (e) { say('Could not clear the history'); } }} />` : html`<${Fragment}>
    <div class="crumbs" style=${everywhere ? "display:none" : ""}><button onClick=${() => { autoOk.current = false; setFolder(crumbs.root); }}>${remote || ''}</button>${crumbs.items.map((c) => html`<span> / <button onClick=${() => setFolder(c.path)}>${c.label}</button></span>`)}
      <span class="count">${items ? (() => { const total = items.filter((x) => !isHiddenItem(x)).length; return `${shown.length}${shown.length !== total ? ' of ' + total : ''} items`; })() : ''}</span></div>
    ${remote === '3D Printer Models' && !everywhere ? html`<div class="notice soft" role="note"><strong>Heads up:</strong> many 3D printer models don't have a cover picture yet. Missing covers in this section are expected and are not a bug; pictures are being added as we go.</div>` : ''}
    ${error ? html`<div class="notice">${error.message}${error.kind === 'auth' ? html` <button class="primary" onClick=${signIn}>Sign in again</button>` : ''}</div>` : ''}
    ${view === 'library' && !everywhere && (remote === 'Music' || remote === 'Comics') && !noticeOff ? html`<div class="notice soft">Some albums and comic collections may be missing tracks or issues that haven't been sourced yet. If you'd like to contribute, please contact Old Man of the Hills. Some releases are left out on purpose (remixes, live versions, compilations and the like), so these lists are not a complete or official catalogue. <button class="dbtn" onClick=${() => setNoticeOff(true)}>Got it</button></div>` : ''}
    ${view === 'library' && !everywhere && query.trim().length >= 3 && items !== null ? html`<div class="notice soft searchhint"><${WatchBar} query=${query} onWatch=${watchTitle} onWatchlist=${() => setWatchOpen(true)} />${(() => { const more = index ? otherSectionMatches(index, query, remote) : []; return more.length ? html` <span>Also matches in ${more.map((m) => m.remote + ' (' + m.count + ')').join(', ')}.</span> <button class="dbtn" onClick=${() => setEverywhere(true)}>Search all sections</button>` : ''; })()}</div>` : ''}
    ${items !== null && sort === 'name' ? html`<${AlphaBar} letters=${lettersPresent(shown)} />` : ''}
    ${view === 'library' && remote === 'Comics' && !everywhere && !folder && !query ? html`<section class="komgabox"><div><strong>Komga</strong> - free comic server and reader. It runs on your PC and reads the comics you download here, with covers, series and reading progress.</div><div class="dbtns"><button class="dbtn go" onClick=${() => api.openExternal('https://komga.org/docs/installation/desktop')}>Download Komga</button><button class="dbtn" onClick=${() => setView('wiki')}>Setup guide</button><button class="dbtn" onClick=${() => setView('tools')}>Add reading orders</button></div></section>` : ''}
    ${everywhere && view === 'library' ? html`<${EverywhereResults} index=${index} query=${query} onWatch=${watchTitle} onWatchlist=${() => setWatchOpen(true)} render=${(it, badge) => html`<${Card} badge=${badge} listMode=${viewMode === 'list'} key=${it._remote + '/' + it.path} item=${it} remote=${it._remote} folder=${it._folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${inMyList(it)} onToggleList=${toggleList} onOpen=${browseInto} />`} />` : ''}
    ${everywhere && view === 'library' ? '' : items === null ? html`<div class="loading">Loading…</div>` : html`<main class=${viewMode === 'list' ? 'list' : "grid " + shapeFor(remote)}>${showBundles ? html`<section class="bundles">${bundlesPresent(bundles, items).map((b) => html`<div class="bundle" key=${b.id}><div class="bcover"><img loading="lazy" decoding="async" src=${coverSrc(b.cover)} alt="" /></div><div class="binfo"><strong>${b.title}</strong><span class="sval">${formatSize(b.total)} · ${b.present.length} series: ${b.present.slice(0, 3).join(', ')}${b.present.length > 3 ? ' and ' + (b.present.length - 3) + ' more' : ''}</span><span class="sval">Downloads everything copied so far. Series still being added join in later.</span></div><button class="primary" onClick=${() => downloadBundle(b)}>Download All</button></div>`)}</section>` : ''}${shown.map((it) => html`<${Card} listMode=${viewMode === 'list'} key=${it.path || it.name} item=${it} remote=${remote} folder=${folder} onDownload=${startDownload} onDetails=${setDetails} onPreview=${setPreview} inList=${inMyList(it)} onToggleList=${toggleList} onStub=${(st) => { goTo(st.remote, st.folder); if (st.name) setQuery(st.name); }} batch=${batchActive ? { selected: picked.has(itemKeyOf(it)), toggle: () => togglePick(it) } : null} onOpen=${(x) => { recordVisit(x, remote, folder); setFolder(folder ? folder + '/' + x.name : x.name); setQuery(''); }} />`)}</main>`}
    </${Fragment}>`}
    </${PageGuard}>
    ${details ? html`<${DetailsModal} item=${details} remote=${ctxRemote(details)} folder=${ctxFolder(details)} onClose=${() => setDetails(null)} onDownload=${startDownload} onBrowse=${browseInto} harbor=${themeChoice === 'harbor'} actions=${{ download: startDownload, details: setDetails, toggle: toggleList, inList: (it) => myList.some((m) => m.remote === ctxRemote(it) && m.path === itemPath(it)) }} onOpenTrend=${openTrend} />` : ''}
    ${preview ? html`<${PreviewModal} item=${preview} onClose=${() => setPreview(null)} />` : ''}
    ${patchQ ? html`<${PatchModal} q=${patchQ} />` : ''}
    ${gate ? html`<${GateModal} gate=${gate} />` : ''}
    ${watchOpen ? html`<${WatchlistModal} onClose=${() => setWatchOpen(false)} say=${say} startTitle=${watchStart} />` : ''}
    ${whatsNew ? html`<${WhatsNewBox} entry=${whatsNew} onClose=${() => setWhatsNew(null)} />` : ''}
    ${!whatsNew && askReports ? html`<${ErrorReportingAsk} onDone=${(on) => { setAskReports(false); if (on !== null) say(on ? 'Thanks, error reports are on' : 'Error reports are off'); }} />` : ''}
    ${admin && admin.role === 'owner' ? html`<${OwnerDock} onOpenAnalytics=${() => { setAdminStart({ tab: 'analytics', n: Date.now() }); setView('admin'); }} />` : ''}
    <div class="sr-only" role="status" aria-live="polite">${toast}</div>${toast ? html`<div class="toast" aria-hidden="true">${toast}</div>` : ''}
    <${UpdateScreen} />
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
