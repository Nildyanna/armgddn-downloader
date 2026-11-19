// "Live routing" map for the Owner/Admin panel: remotes on the left, the site's gateway in the middle, the mirrors on the right.
// It is an in-motion display, not a picture: every line carries travelling dots whose speed and thickness follow the traffic on it,
// the numbers glide to their new values, nodes pulse while they are busy, and trouble turns a node or line red or amber. The map is
// built once and then patched on every refresh (no redraw), so the motion never restarts or flickers. It uses the same
// /api/admin/stats data as the panel's text lists, so nothing extra is fetched.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OwnerRouting = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const COLORS = ['#38bdf8', '#4ade80', '#a78bfa', '#fb923c', '#f472b6', '#facc15', '#2dd4bf', '#818cf8'];
    const BAD = '#f87171', WARN = '#fb923c', OK = '#4ade80';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Turns the stats response into what is drawn. Pure, so it can be tested without a browser.
    function buildModel(stats) {
        const s = stats || {};
        const api = s.api || {};
        const byRemote = s.appDownloadsByRemote || {};
        const browsing = api.activeBrowsePerRemote || {};
        const perRemote = api.perRemote || {};
        const conc = s.concurrency || {};
        // Members do not choose a mirror, so the left side is what they ask for (PC, PCVR, Music, ...): PC-1/2/3 and "PC Games" count as PC, and
        // PCVR-1/2/3 and "PCVR Games" as PCVR. The individual mirrors are the right-hand side.
        const groupOf = (n) => String(n).trim().replace(/^(PCVR|PC)(?:-?\d+| Games)?$/i, (m, g) => g.toUpperCase());
        const groups = new Map();
        const grp = (name) => {
            const key = groupOf(name);
            if (!groups.has(key)) groups.set(key, { key, label: key, downloads: 0, browsing: 0, errors: 0, bad: false, note: '' });
            return groups.get(key);
        };
        for (const r of (s.remotes || [])) {
            if (!r || !r.name) continue;
            const g = grp(r.name);
            if (r.status && r.status !== 'healthy') { g.bad = true; g.note = g.note || r.lastError || ''; }
        }
        for (const k of Object.keys(byRemote)) grp(k).downloads += num(byRemote[k]);
        for (const k of Object.keys(browsing)) grp(k).browsing += num(browsing[k]);
        for (const k of Object.keys(perRemote)) grp(k).errors += num((perRemote[k] || {}).rcloneErrors) + num((perRemote[k] || {}).rcloneAtQuotaErrors);
        const order = (k) => (k === 'PC' ? 0 : (k === 'PCVR' ? 1 : 2));
        const left = [...groups.values()].sort((x, y) => order(x.key) - order(y.key)).map((g, i) => ({
            key: g.key, label: g.label, downloads: g.downloads, browsing: g.browsing, errors: g.errors,
            status: g.bad ? 'bad' : (g.errors > 0 ? 'warn' : 'ok'), flow: g.downloads + g.browsing, color: COLORS[i % COLORS.length], note: g.note,
            remote: g.key === 'PC' ? 'PC-2' : (g.key === 'PCVR' ? 'PCVR-2' : g.key),
        }));

        const mirrors = s.ownerExtra && s.ownerExtra.mirrorLoad ? s.ownerExtra.mirrorLoad : {};
        const right = Object.keys(mirrors).map((key) => {
            const m = mirrors[key] || {};
            const status = m.status === 'available' || !m.status ? 'ok' : (m.status === 'quota' ? 'warn' : 'bad');
            const label = key.replace(/:.*$/, '');
            const word = { ok: 'available', warn: 'at quota (temporarily out of bandwidth)', bad: 'failing' }[status];
            return { key, label, group: m.group || '', streams: num(m.activeStreams), status, flow: num(m.activeStreams), note: m.lastError || '',
                detail: { title: `Mirror ${label}${m.group ? ' (' + m.group + ')' : ''}`,
                    lines: [`Status: ${word}.`, `${num(m.activeStreams)} stream${num(m.activeStreams) === 1 ? '' : 's'} running through it now.`,
                        m.lastError ? `Last error: ${m.lastError}` : 'No recent errors.', 'Mirrors are the Google copies behind each library. Members never pick one; the site spreads their downloads across them.'] } };
        });

        const center = {
            streams: num(conc.activeTotalStreams != null ? conc.activeTotalStreams : (s.overhead || {}).activeStreams),
            max: num(conc.maxGlobalRcloneStreams),
            queue: num(conc.globalStreamQueueLength) + num(conc.appQueuedDownloads),
            users: num(conc.userActiveStreamsUsers),
            loopMs: num((s.overhead || {}).eventLoopMeanMs),
            level: (s.overhead || {}).level || 'normal',
            requests: num(api.browseRequests) + num(api.remotesRequests) + num(api.downloadManifestRequests),
        };
        const maxFlow = Math.max(1, ...left.map((n) => n.flow), ...right.map((n) => n.flow));
        return { left, center, right, maxFlow };
    }

    // How a line looks for a given amount of traffic: faster dots and a thicker stroke when busier. Idle lines still drift slowly.
    function lineLook(flow, maxFlow) {
        const f = Math.max(0, Math.min(1, flow / Math.max(1, maxFlow)));
        return { width: +(1.6 + 3.4 * f).toFixed(2), durationS: +(flow > 0 ? 3.2 - 2.2 * f : 9).toFixed(2), opacity: flow > 0 ? 1 : 0.35 };
    }

    // The layout is computed from the room actually available: the columns widen to use the width, and the boxes get shorter (their text
    // stays the same size) until every row fits the window's height. Only when even the shortest box does not fit is the whole map
    // scaled down a little as a last resort.
    const GAP = 8, MID_W = 190, MIN_NODE_H = 50, MAX_NODE_H = 74;
    // The room is measured where the map really sits: the window that scrolls it (the panel box), minus what lies above the map inside
    // it and a margin below, so the whole map is inside the visible part. Without such a window the page height is used.
    function scrollerOf(el) {
        if (typeof getComputedStyle !== 'function') return null;
        for (let p = el.parentElement; p; p = p.parentElement) {
            const o = getComputedStyle(p).overflowY;
            if ((o === 'auto' || o === 'scroll') && p.clientHeight > 0) return p;
        }
        return null;
    }
    function roomOf(el, reserve, share) {
        const aw = Math.max(520, (el.clientWidth || 900) - 32);
        const sc = scrollerOf(el);
        let ah;
        if (sc) {
            const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
            ah = sc.clientHeight - top - 56 - 30;                    // 56: the map's own header line, 30: breathing room below
            if (share) ah = Math.min(ah, Math.floor(sc.clientHeight * share));
        } else {
            ah = (typeof window !== 'undefined' ? window.innerHeight : 900) - reserve;
        }
        return { aw, ah: Math.max(260, ah) };
    }
    function ownerGeom(rows, room) {
        rows = Math.max(rows, 1);
        const gutterMin = 90;
        const colW = Math.max(190, Math.min(340, Math.floor((room.aw - MID_W - 2 * gutterMin) / 2)));
        const gutter = Math.max(gutterMin, Math.floor((room.aw - MID_W - 2 * colW) / 2));
        const nodeH = Math.max(MIN_NODE_H, Math.min(MAX_NODE_H, Math.floor((room.ah - GAP) / rows - GAP)));
        const w = 2 * colW + MID_W + 2 * gutter, h = rows * (nodeH + GAP) + GAP;
        return { w, h, colW, gutter, nodeH, mx1: colW + gutter, mx2: colW + gutter + MID_W, rx: colW + 2 * gutter + MID_W, k: h > room.ah ? Math.max(0.55, room.ah / h) : 1, compact: nodeH < 64 };
    }
    const yOf = (i, count, h, nodeH) => GAP + (h - GAP * 2 - count * nodeH - (count - 1) * GAP) / 2 + i * (nodeH + GAP) + nodeH / 2;
    const pathFor = (x1, y1, x2, y2) => { const dx = (x2 - x1) * 0.55; return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };

    function sig(m) { return m.left.map((n) => n.key).join('|') + '#' + m.right.map((n) => n.key).join('|'); }

    function build(el, m, g) {
        const midY = g.h / 2;
        const nh = g.nodeH;
        let lines = '', nodes = '';
        const node = (side, n, x, y) => `<div class="or-node" data-node="${side}:${esc(n.key)}" style="left:${x}px;top:${(y - nh / 2).toFixed(1)}px;width:${g.colW}px;height:${nh}px"><span class="or-dot"></span><div class="or-txt"><div class="or-name">${esc(n.label)}</div><div class="or-sub"></div></div></div>`;
        m.left.forEach((n, i) => {
            const y = yOf(i, m.left.length, g.h, nh), p = pathFor(g.colW, y, g.mx1, midY);
            lines += `<g class="or-link" data-line="L:${esc(n.key)}"><path class="or-rail" d="${p}"/><path class="or-flow" d="${p}"/></g>`;
            nodes += node('L', n, 0, y);
        });
        m.right.forEach((n, i) => {
            const y = yOf(i, m.right.length, g.h, nh), p = pathFor(g.mx2, midY, g.rx, y);
            lines += `<g class="or-link" data-line="R:${esc(n.key)}"><path class="or-rail" d="${p}"/><path class="or-flow" d="${p}"/></g>`;
            nodes += node('R', n, g.rx, y);
        });
        el.innerHTML = `<div class="or-wrap">
          <div class="or-head"><span class="or-live"><i></i>Live routing</span><span class="or-pill" data-f="pill">listening for traffic</span></div>
          <div class="or-scroll"><div class="or-fit"><div class="or-map" style="width:${g.w}px;height:${g.h}px"${g.compact ? ' data-compact="1"' : ''}>
            <svg width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}" aria-hidden="true">${lines}</svg>${nodes}
            <div class="or-node or-gateway" data-node="C" style="left:${g.mx1}px;top:${(midY - 62).toFixed(1)}px;width:${MID_W}px">
              <div class="or-gw-title">Gateway</div><div class="or-gw-big"><span data-f="streams">0</span><small data-f="max"></small></div>
              <div class="or-gw-sub" data-f="gwsub"></div><div class="or-bar"><i data-f="bar"></i></div><div class="or-gw-sub" data-f="gwsub2"></div>
            </div></div></div></div></div>`;
    }

    // Last resort only (more rows than even the shortest boxes allow): scale the map down a little. Also keeps it centred.
    function applyScale(el, g) {
        const map = el.querySelector('.or-map'), box = el.querySelector('.or-fit');
        if (!map || !box) return;
        map.style.transform = g.k < 1 ? `scale(${g.k.toFixed(3)})` : '';
        map.style.transformOrigin = '0 0';
        box.style.width = Math.round(g.w * g.k) + 'px';
        box.style.height = Math.round(g.h * g.k) + 'px';
    }

    // Lays the map out again when the window or the panel changes size or is shown for the first time.
    const watched = new Set();
    function watch(el, redo) {
        if (watched.has(el)) return;
        watched.add(el);
        let queued = false;
        const go = () => { if (queued) return; queued = true; (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => { queued = false; redo(); }); };
        if (typeof ResizeObserver === 'function') new ResizeObserver(go).observe(el);
        if (typeof window !== 'undefined') window.addEventListener('resize', go);
    }

    // Clicking a box opens its section on the site (the host page sets OwnerRouting.onOpen and returns true when it did) or, when
    // there is no section, a short description right on the map.
    const api = { onOpen: null };
    function showDetail(el, d) {
        const wrap = el.querySelector('.or-wrap');
        if (!wrap || !d) return;
        const old = wrap.querySelector('.or-pop');
        if (old) old.remove();
        const pop = document.createElement('div');
        pop.className = 'or-pop';
        pop.setAttribute('role', 'dialog');
        pop.innerHTML = `<button type="button" class="or-pop-x" aria-label="Close">×</button><div class="or-pop-title">${esc(d.title)}</div>${(d.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}`;
        pop.querySelector('.or-pop-x').onclick = () => pop.remove();
        wrap.appendChild(pop);
    }
    function bindClicks(el) {
        if (el.__bound) return;
        el.__bound = true;
        const go = (nd) => {
            const act = el.__acts && el.__acts[nd.getAttribute('data-act')];
            if (!act) return;
            let handled = false;
            try { handled = !!(api.onOpen && act.kind && api.onOpen(act.kind, act.key, act)); } catch (e) { handled = false; }
            if (!handled && act.detail) showDetail(el, act.detail);
        };
        el.addEventListener('click', (ev) => { const nd = ev.target.closest && ev.target.closest('.or-node[data-act]'); if (nd) go(nd); });
        el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { const nd = ev.target.closest && ev.target.closest('.or-node[data-act]'); if (nd) { ev.preventDefault(); go(nd); } } });
    }
    function setAct(el, nd, id, act) {
        el.__acts = el.__acts || {};
        el.__acts[id] = act;
        nd.setAttribute('data-act', id);
        nd.setAttribute('role', 'button');
        nd.setAttribute('tabindex', '0');
    }

    // Numbers glide to the new value instead of jumping.
    function glide(node, to) {
        const from = num(node.getAttribute('data-v'));
        node.setAttribute('data-v', String(to));
        if (from === to || typeof requestAnimationFrame !== 'function') { node.textContent = String(to); return; }
        const t0 = Date.now();
        const step = () => {
            const p = Math.min(1, (Date.now() - t0) / 600);
            node.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
            if (p < 1 && node.isConnected) requestAnimationFrame(step); else node.textContent = String(to);
        };
        requestAnimationFrame(step);
    }

    function patchNode(el, side, n) {
        const nd = el.querySelector(`[data-node="${side}:${CSS_esc(n.key)}"]`);
        if (!nd) return;
        nd.className = `or-node or-${n.status}${n.flow > 0 ? ' or-busy' : ''}`;
        nd.title = (n.label || n.key) + (n.note ? ' - ' + n.note : '');
        setAct(el, nd, side + ':' + n.key, side === 'L' ? { kind: 'remote', key: n.key, remote: n.remote, detail: { title: n.label, lines: [`${n.downloads} downloads running, ${n.browsing} people browsing.`, n.errors ? `${n.errors} failed requests to its storage.` : 'No failed requests.'] } } : { kind: 'mirror', key: n.key, detail: n.detail });
        const sub = side === 'L'
            ? `${n.downloads} dl · ${n.browsing} browsing${n.errors ? ` · <b class="or-bad">${n.errors} failed</b>` : ''}`
            : `${n.streams} stream${n.streams === 1 ? '' : 's'}${n.status === 'warn' ? ' · <b class="or-warn">at quota</b>' : (n.status === 'bad' ? ' · <b class="or-bad">error</b>' : '')}`;
        const s = nd.querySelector('.or-sub');
        if (s.innerHTML !== sub) s.innerHTML = sub;
        const link = el.querySelector(`[data-line="${side}:${CSS_esc(n.key)}"]`);
        if (link) {
            const look = lineLook(n.flow, 0 + (el.__max || 1));
            const color = n.status === 'bad' ? BAD : (side === 'L' ? n.color : (n.status === 'warn' ? WARN : OK));
            link.style.setProperty('--c', color);
            link.style.setProperty('--w', look.width + 'px');
            link.style.setProperty('--dur', look.durationS + 's');
            link.style.opacity = String(look.opacity);
        }
    }
    const CSS_esc = (k) => String(k).replace(/["\\]/g, '\\$&');

    // Creates the map on first use, then patches it in place. Call it on every refresh with a model from buildModel().
    function update(el, m) {
        if (!el) return;
        el.__model = m;
        const g = ownerGeom(Math.max(m.left.length, m.right.length), roomOf(el, 200));
        const gsig = sig(m) + '#' + [g.w, g.h, g.nodeH, g.colW].join(',');
        if (el.__sig !== gsig) { build(el, m, g); el.__sig = gsig; el.__req = null; }
        applyScale(el, g);
        watch(el, () => { if (el.__model) update(el, el.__model); });
        el.__max = m.maxFlow;
        bindClicks(el);
        m.left.forEach((n) => patchNode(el, 'L', n));
        m.right.forEach((n) => patchNode(el, 'R', n));
        const c = m.center;
        const f = (k) => el.querySelector(`[data-f="${k}"]`);
        glide(f('streams'), c.streams);
        f('max').textContent = c.max ? ' / ' + c.max : '';
        f('gwsub').innerHTML = `streams${c.queue ? ` · <b class="or-warn">${c.queue} queued</b>` : ''}`;
        f('gwsub2').textContent = `${c.users} user${c.users === 1 ? '' : 's'} · loop ${c.loopMs} ms`;
        f('bar').style.width = (c.max ? Math.min(100, Math.round((c.streams / c.max) * 100)) : 0) + '%';
        const gw = el.querySelector('[data-node="C"]');
        setAct(el, gw, 'C', { kind: 'gateway', key: 'gateway', detail: { title: 'Gateway', lines: [`${c.streams} of ${c.max || '?'} download streams in use, ${c.queue} waiting.`, `${c.users} people downloading, event loop ${c.loopMs} ms.`, 'Every download passes through here on its way from a mirror to a member.'] } });
        gw.className = `or-node or-gateway or-${c.level === 'normal' || c.level === 'ok' ? 'ok' : 'warn'}${c.streams > 0 ? ' or-busy' : ''}`;
        const total = c.requests;
        const delta = el.__req == null ? null : Math.max(0, total - el.__req);
        el.__req = total;
        f('pill').textContent = delta == null ? 'listening for traffic' : `${delta} new request${delta === 1 ? '' : 's'} since last refresh`;
    }

    // ---- Flow graphs for the status window and the requests window. A graph is columns of nodes plus links; each node carries its own
    // status class and sub-text, each link its colour and speed, so one drawing and patching routine serves every map here.
    const SV = 8;
    const statusClass = (x) => (x === 'ok' ? 'ok' : (x === 'down' ? 'bad' : 'warn'));

    function graphGeom(g, room) {
        const cols = g.cols.length, rows = Math.max(...g.cols.map((c) => c.length), 1);
        const sw = Math.max(150, Math.min(240, Math.floor((room.aw - (cols - 1) * 40) / cols)));
        const sgap = cols > 1 ? Math.max(40, Math.floor((room.aw - cols * sw) / (cols - 1))) : 0;
        const sh = Math.max(MIN_NODE_H, Math.min(MAX_NODE_H, Math.floor((room.ah - SV) / rows - SV)));
        const w = cols * sw + (cols - 1) * sgap, h = rows * (sh + SV) + SV;
        return { w, h, sw, sgap, sh, k: h > room.ah ? Math.max(0.55, room.ah / h) : 1, compact: sh < 64 };
    }

    function drawGraph(el, g, title, geo) {
        const { w, h, sw, sgap, sh } = geo;
        const pos = {};
        g.cols.forEach((col, ci) => col.forEach((n, ri) => {
            pos[n.key] = { x: ci * (sw + sgap), y: SV + (h - SV * 2 - col.length * sh - (col.length - 1) * SV) / 2 + ri * (sh + SV) };
        }));
        let lines = '', nodes = '';
        for (const l of g.links) {
            if (!pos[l.a] || !pos[l.b]) continue;
            const p = pathFor(pos[l.a].x + sw, pos[l.a].y + sh / 2, pos[l.b].x, pos[l.b].y + sh / 2);
            lines += `<g class="or-link" data-line="${esc(l.a)}>${esc(l.b)}"><path class="or-rail" d="${p}"/><path class="or-flow" d="${p}"/></g>`;
        }
        for (const col of g.cols) for (const n of col) {
            nodes += `<div class="or-node or-svc" data-svc="${esc(n.key)}" style="left:${pos[n.key].x}px;top:${pos[n.key].y.toFixed(1)}px;width:${sw}px;height:${sh}px"><span class="or-dot"></span><div class="or-txt"><div class="or-name">${esc(n.label)}</div><div class="or-sub"></div></div></div>`;
        }
        el.innerHTML = `<div class="or-wrap"><div class="or-head"><span class="or-live"><i></i>${esc(title)}</span><span class="or-pill" data-f="pill"></span></div>
            <div class="or-scroll"><div class="or-fit"><div class="or-map" style="width:${w}px;height:${h}px"${geo.compact ? ' data-compact="1"' : ''}><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${lines}</svg>${nodes}</div></div></div></div>`;
    }

    function patchGraph(el, g, title) {
        if (!el) return;
        bindClicks(el);
        el.__graph = g;
        const geo = graphGeom(g, roomOf(el, 330, 0.55));
        const sg = title + '#' + g.cols.map((c) => c.map((n) => n.key).join(',')).join('|') + '#' + [geo.w, geo.h, geo.sw].join(',');
        if (el.__sg !== sg) { drawGraph(el, g, title, geo); el.__sg = sg; }
        applyScale(el, geo);
        watch(el, () => { if (el.__graph) patchGraph(el, el.__graph, title); });
        g.cols.forEach((col) => col.forEach((n) => {
            const nd = el.querySelector(`[data-svc="${CSS_esc(n.key)}"]`);
            if (!nd) return;
            nd.className = `or-node or-svc or-${n.cls}${n.busy ? ' or-busy' : ''}`;
            nd.title = n.label + (n.tip ? ' - ' + n.tip : '');
            if (n.act) setAct(el, nd, n.key, n.act);
            const t = nd.querySelector('.or-sub');
            if (t.innerHTML !== n.subHtml) t.innerHTML = n.subHtml;
        }));
        for (const l of g.links) {
            const link = el.querySelector(`[data-line="${CSS_esc(l.a)}>${CSS_esc(l.b)}"]`);
            if (!link) continue;
            link.style.setProperty('--c', l.color);
            link.style.setProperty('--dur', l.dur + 's');
            link.style.setProperty('--w', l.w + 'px');
            link.classList.toggle('or-dead', !!l.dead);
        }
        const pill = el.querySelector('[data-f="pill"]');
        if (pill) pill.textContent = g.pill || '';
    }

    // Service map for the status window: Members -> login / library / accounts -> download server -> Google mirrors, bots on the side.
    // A working service passes dots along, a degraded one is amber and slow, a down one is red, dashed and still.
    function serviceGraph(view, whenText) {
        const comps = (view && view.components) || [];
        const by = (id) => comps.find((c) => c && c.id === id);
        const mirrors = comps.filter((c) => c && String(c.id).indexOf('mirror:') === 0);
        const node = (key, label, c, sub) => {
            const st = c ? c.status : 'ok';
            const cls = statusClass(st);
            const word = st === 'down' ? 'not working' : 'some problems';
            const since = c && c.since && whenText ? ' since ' + whenText(c.since) : '';
            const detail = { title: label, lines: [c && c.impact ? c.impact : (sub || 'Part of the site.'),
                st === 'ok' ? 'Working normally.' : `${st === 'down' ? 'Not working' : 'Some problems'}${since}.`, c && c.detail ? String(c.detail) : ''].filter(Boolean) };
            return { key, label, status: st, cls, busy: st === 'ok', tip: st === 'ok' ? '' : word + since, act: { kind: 'service', key, detail },
                subHtml: st === 'ok' ? esc(sub || 'working') : `<b class="or-${cls}">${esc(word)}</b>${esc(since)}` };
        };
        const cols = [
            [{ key: 'members', label: 'Members', status: 'ok', cls: 'ok', busy: true, tip: '', subHtml: 'browser and Companion',
                act: { kind: 'service', key: 'members', detail: { title: 'Members', lines: ['People using the website and the Companion app. Everything to the right is what they depend on.'] } } }],
            [node('login', 'Telegram login', by('login'), 'working'), node('library', 'Library and search', by('library'), 'working'),
             node('database', 'Accounts and requests', by('database'), 'working')],
            [node('downloads', 'Download server', by('downloads'), 'working'), node('bots', 'Telegram bots', by('bots'), 'Tulip, search, moderation')],
            mirrors.map((c) => node(c.id, String(c.label).replace(/ mirrors$/, ''), c, 'Google mirrors')),
        ];
        const st = {};
        cols.forEach((col) => col.forEach((n) => { st[n.key] = n.status; }));
        const pairs = [['members', 'login'], ['members', 'library'], ['members', 'database'], ['library', 'downloads'], ['database', 'downloads'], ['members', 'bots']];
        for (const c of mirrors) pairs.push(['downloads', c.id]);
        const links = pairs.map(([a, b]) => {
            const worst = st[b] === 'down' || st[a] === 'down' ? 'down' : (st[b] !== 'ok' || st[a] !== 'ok' ? 'degraded' : 'ok');
            return { a, b, w: 2.4, color: worst === 'down' ? BAD : (worst === 'degraded' ? WARN : '#38bdf8'), dur: worst === 'ok' ? 3 : (worst === 'degraded' ? 7 : 1000), dead: worst === 'down' };
        });
        const bad = Object.values(st).filter((v) => v !== 'ok').length;
        return { cols, links, pill: bad ? `${bad} service${bad === 1 ? '' : 's'} affected` : 'everything is working' };
    }

    function updateServices(el, view, whenText) { patchGraph(el, serviceGraph(view, whenText), 'Service map'); }

    // Request flow for the requests window: each category's requests -> everything asked for -> where they stand now.
    // Line thickness follows the count; Pending and Approved (being worked on) keep moving, Completed and Rejected are the ends.
    function requestGraph(stats) {
        const s = stats || {};
        const by = s.byCategory || {};
        const cats = Object.keys(by).map((k) => ({ k, v: by[k], total: num(by[k].pending) + num(by[k].approved) + num(by[k].completed) + num(by[k].rejected) })).filter((c) => c.total > 0);
        const total = num(s.total);
        const ends = [['pending', 'Pending', 'warn', 'waiting for a decision'], ['approved', 'Approved', 'ok', 'being worked on'], ['completed', 'Completed', 'ok', 'done'], ['rejected', 'Rejected', 'bad', 'declined']];
        const maxN = Math.max(1, total, ...ends.map(([k]) => num(s[k])));
        const look = (n) => 1.6 + 3.4 * Math.min(1, n / maxN);
        const colors = { pending: WARN, approved: '#38bdf8', completed: OK, rejected: BAD };
        const cols = [
            cats.map((c) => ({ key: 'cat:' + c.k, label: c.k, cls: 'ok', busy: (c.v.pending || 0) + (c.v.approved || 0) > 0, tip: '', act: { kind: 'reqCat', key: c.k, detail: { title: c.k, lines: [`${c.total} requests in this category.`] } }, subHtml: `${c.total} request${c.total === 1 ? '' : 's'} · ${num(c.v.pending) + num(c.v.approved)} open` })),
            [{ key: 'all', label: 'Requests', cls: 'ok', busy: num(s.arrivals7) > 0, act: { kind: 'reqAll', key: 'all', detail: { title: 'Requests', lines: ['Every request, with duplicates merged into one.'] } }, tip: `${num(s.merged)} duplicate requests were merged into these`, subHtml: `${total} total · ${num(s.arrivals7)} new this week` }],
            ends.map(([k, label, cls, sub]) => ({ key: 'st:' + k, label, cls: k === 'pending' && num(s[k]) > 0 ? 'warn' : (k === 'rejected' ? 'ok' : cls === 'warn' ? 'ok' : cls), busy: (k === 'pending' || k === 'approved') && num(s[k]) > 0, tip: sub, act: { kind: 'reqStatus', key: k, detail: { title: label, lines: [`${num(s[k])} requests are ${sub}.`] } }, subHtml: `<b>${num(s[k])}</b> · ${esc(sub)}` })),
        ];
        const links = [
            ...cats.map((c) => ({ a: 'cat:' + c.k, b: 'all', w: look(c.total), color: '#38bdf8', dur: c.total ? +(3.4 - 2.2 * Math.min(1, c.total / maxN)).toFixed(2) : 9 })),
            ...ends.map(([k]) => ({ a: 'all', b: 'st:' + k, w: look(num(s[k])), color: colors[k], dur: num(s[k]) ? +(3.4 - 2.2 * Math.min(1, num(s[k]) / maxN)).toFixed(2) : 9 })),
        ];
        const open = num(s.pending) + num(s.approved);
        return { cols, links, pill: `${open} open · ${num(s.pending)} waiting for a decision` };
    }

    function updateRequests(el, stats) { patchGraph(el, requestGraph(stats), 'Request flow'); }

    api.buildModel = buildModel; api.update = update; api.lineLook = lineLook; api.serviceGraph = serviceGraph;
    api.updateServices = updateServices; api.requestGraph = requestGraph; api.updateRequests = updateRequests;
    return api;
}));
