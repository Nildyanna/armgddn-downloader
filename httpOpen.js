// Opens one HTTP GET and hands back { req, res } where res is a Readable with statusCode and headers.
//
// https hosts that offer HTTP/2 are reached over ONE shared connection per host, every request being a stream on it. That is what
// rclone (Go) does, and it matters: a download host such as nginx answers a handful of separate HTTP/1.1 connections at once and
// leaves the rest waiting for tens of seconds, which showed up as repeated stalls with 16 parallel connections per file.
// Anything else (plain http, a host without h2, a failed h2 handshake) falls back to ordinary HTTP/1.1.
// A signal cancels a request even while it is still waiting for its first response.
const http = require('http');
const https = require('https');
const http2 = require('http2');
const { ResumeError } = require('./resumeDownload');
const proxy = require('./proxy');

const MAX_REDIRECTS = 5;
const IDLE_CLOSE_MS = 15 * 1000;
const H1_ONLY_MS = 10 * 60 * 1000;
let SESSION_GRACE_MS = 5 * 1000;     // a session asked to close politely is destroyed after this if the other side never answers
const sessions = new Map();      // origin -> { session, active, timer, ready }
const h1Only = new Map();        // origin -> until (ms): h2 did not work, use HTTP/1.1 for a while

const closedBy = (signal) => (signal && signal.aborted) ? new ResumeError('stopped', 'aborted') : null;

function dropSession(origin, session) {
  const e = sessions.get(origin);
  if (e && e.session === session) sessions.delete(origin);
}

// close() only ends the connection politely. When the other side is gone (a stalled Wi-Fi link, a router that dropped the flow) the session
// and its TLS socket would otherwise stay open until the garbage collector reaches them, with writes still queued; destroying them
// ourselves keeps that work out of the collector.
function closeSession(session) {
  try { session.close(); } catch (e) { }
  const t = setTimeout(() => { try { if (!session.destroyed) session.destroy(); } catch (e) { } }, SESSION_GRACE_MS);
  if (t.unref) t.unref();
  try { session.once('close', () => clearTimeout(t)); } catch (e) { }
}

// Watches the bytes that arrive on a shared connection (all streams together), so a request that times out can tell "this stream is slow"
// from "the whole connection has stopped".
function watchProgress(entry, stallMs) {
  if (entry.watch) return;
  const bytes = () => { try { return entry.session.socket.bytesRead || 0; } catch (e) { return 0; } };
  entry.lastBytes = bytes(); entry.progressAt = Date.now();
  entry.watch = setInterval(() => { const b = bytes(); if (b !== entry.lastBytes) { entry.lastBytes = b; entry.progressAt = Date.now(); } }, Math.max(20, Math.min(1000, Math.floor(stallMs / 10))));
  if (entry.watch.unref) entry.watch.unref();
}
function stopWatch(entry) { if (entry.watch) { clearInterval(entry.watch); entry.watch = null; } }
const connectionStalled = (entry, stallMs) => !!entry.watch && Date.now() - entry.progressAt >= stallMs - Math.min(2000, stallMs / 4);

function getSession(origin, tls) {
  const have = sessions.get(origin);
  if (have && !have.session.closed && !have.session.destroyed) return have.ready;
  if (have && have.pending) return have.ready;
  const px = proxy.proxyFor(origin);
  const entry = { session: null, active: 0, timer: null, ready: null, pending: !!px };
  const wire = (session) => {
    entry.session = session; entry.pending = false;
    session.once('connect', () => { try { session.setLocalWindowSize(64 * 1024 * 1024); } catch (e) { } entry.resolve(entry); });
    session.once('error', () => { h1Only.set(origin, Date.now() + H1_ONLY_MS); dropSession(origin, session); entry.resolve(null); });
    session.once('close', () => { stopWatch(entry); dropSession(origin, session); entry.resolve(null); });
    session.on('error', () => { });
    session.on('goaway', () => dropSession(origin, session));
    session.on('close', () => dropSession(origin, session));
  };
  entry.ready = new Promise((resolve) => { entry.resolve = resolve; });
  sessions.set(origin, entry);
  const settings = { initialWindowSize: 16 * 1024 * 1024, enablePush: false };
  if (!px) { wire(http2.connect(origin, { ...(tls || {}), settings })); return entry.ready; }
  // through a proxy: CONNECT tunnel, TLS with h2 offered, then HTTP/2 over that socket (a proxy or host without h2 falls back to HTTP/1.1)
  proxy.tlsOverTunnel(px, new URL(origin), tls, ['h2'], (err, sock) => {
    if (err || sock.alpnProtocol !== 'h2') {
      if (sock) sock.destroy();
      h1Only.set(origin, Date.now() + H1_ONLY_MS); sessions.delete(origin); return entry.resolve(null);
    }
    wire(http2.connect(origin, { createConnection: () => sock, settings }));
  });
  return entry.ready;
}

const SKIP_H2 = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

async function openH2(u, headers, stallMs, opts, hops) {
  const entry = await getSession(u.origin, opts.tls);
  if (!entry) return null;
  const gone = closedBy(opts.signal); if (gone) throw gone;
  const h = { ':method': 'GET', ':path': (u.pathname || '/') + (u.search || '') };
  for (const [k, v] of Object.entries(headers || {})) { const key = k.toLowerCase(); if (!SKIP_H2.has(key)) h[key] = String(v); }
  let req;
  try { req = entry.session.request(h, { endStream: true }); } catch (e) { return null; }     // session closed under us: use HTTP/1.1
  entry.active++; clearTimeout(entry.timer); watchProgress(entry, stallMs);
  req.once('close', () => {
    entry.active--;
    if (entry.active <= 0) {
      stopWatch(entry);
      entry.timer = setTimeout(() => { if (entry.active <= 0) { dropSession(u.origin, entry.session); closeSession(entry.session); } }, IDLE_CLOSE_MS);
      if (entry.timer.unref) entry.timer.unref();
    }
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => req.destroy(new ResumeError('stopped', 'aborted'));
    if (opts.signal) { opts.signal.addEventListener('abort', onAbort, { once: true }); req.once('close', () => opts.signal.removeEventListener('abort', onAbort)); }
    req.setTimeout(stallMs, () => {
      // Nothing arrived on this stream for stallMs. When nothing arrived on the whole connection either, the connection itself is stuck:
      // throw it away so the retry dials a fresh one instead of queueing behind the dead one. One slow stream on a healthy connection
      // only loses that stream.
      const stuck = connectionStalled(entry, stallMs);
      req.destroy(new ResumeError('connection timed out', 'network'));
      if (stuck) { dropSession(u.origin, entry.session); try { entry.session.destroy(); } catch (e) { } }
    });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network')); } });
    req.on('close', () => { if (!settled) { settled = true; reject(closedBy(opts.signal) || new ResumeError('connection closed', 'network')); } });
    req.on('response', (rh) => {
      if (settled) return;
      const code = Number(rh[':status']) || 0;
      if (code >= 300 && code < 400 && rh.location) {
        settled = true; req.close();
        if (hops >= MAX_REDIRECTS) return reject(new ResumeError('too many redirects', 'network'));
        let next; try { next = new URL(rh.location, u).toString(); } catch (e) { return reject(new ResumeError('bad redirect', 'network')); }
        return openAuto(next, headers, stallMs, opts, hops + 1).then(resolve, reject);
      }
      settled = true;
      req.statusCode = code; req.headers = rh; req.httpVersion = '2.0';
      resolve({ req, res: req });
    });
  });
}

function openH1(u, headers, stallMs, opts, hops) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'http:' ? http : https;
    const gone = closedBy(opts.signal); if (gone) return reject(gone);
    const px = proxy.proxyFor(u);
    let target = u, extra = {};
    if (px && u.protocol === 'https:') extra = { agent: new proxy.TunnelAgent(px, opts.tls) };
    else if (px) {            // plain http through a proxy: ask the proxy for the full URL
      const a = proxy.authHeader(px);
      target = new URL(`http://${px.hostname}:${px.port || 80}/`);
      extra = { path: u.href, headers: { ...headers, Host: u.host, ...(a ? { 'Proxy-Authorization': a } : {}) } };
    }
    const req = lib.get(target, { headers, signal: opts.signal, ...(u.protocol === 'https:' ? (opts.tls || {}) : {}), ...extra }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(new ResumeError('too many redirects', 'network'));
        let next; try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new ResumeError('bad redirect', 'network')); }
        return openAuto(next, headers, stallMs, opts, hops + 1).then(resolve, reject);
      }
      resolve({ req, res });
    });
    req.setTimeout(stallMs, () => req.destroy(new ResumeError('connection timed out', 'network')));
    req.on('error', (e) => reject(e && e.name === 'AbortError' ? new ResumeError('stopped', 'aborted') : (e instanceof ResumeError ? e : new ResumeError(e && e.message ? e.message : String(e), 'network'))));
  });
}

// opts: { signal, tls }
async function openAuto(urlString, headers, stallMs, opts = {}, hops = 0) {
  let u;
  try { u = new URL(urlString); } catch (e) { throw new ResumeError('bad url', 'fatal'); }
  if (u.protocol === 'https:' && !((h1Only.get(u.origin) || 0) > Date.now())) {
    const r = await openH2(u, headers, stallMs, opts, hops);
    if (r) return r;
  }
  return openH1(u, headers, stallMs, opts, hops);
}

// Close the shared connections (tests, shutdown).
function closeAllSessions() {
  for (const [origin, e] of sessions) { stopWatch(e); if (e.session) closeSession(e.session); sessions.delete(origin); }
  h1Only.clear();
}

module.exports = { openAuto, closeAllSessions, _closeSession: closeSession, _setGraceMs: (ms) => { SESSION_GRACE_MS = ms; } };
