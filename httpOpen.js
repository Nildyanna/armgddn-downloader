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

const MAX_REDIRECTS = 5;
const IDLE_CLOSE_MS = 15 * 1000;
const H1_ONLY_MS = 10 * 60 * 1000;
const sessions = new Map();      // origin -> { session, active, timer, ready }
const h1Only = new Map();        // origin -> until (ms): h2 did not work, use HTTP/1.1 for a while

const closedBy = (signal) => (signal && signal.aborted) ? new ResumeError('stopped', 'aborted') : null;

function dropSession(origin, session) {
  const e = sessions.get(origin);
  if (e && e.session === session) sessions.delete(origin);
}

function getSession(origin, tls) {
  const have = sessions.get(origin);
  if (have && !have.session.closed && !have.session.destroyed) return have.ready;
  const session = http2.connect(origin, { ...(tls || {}), settings: { initialWindowSize: 16 * 1024 * 1024, enablePush: false } });
  const entry = { session, active: 0, timer: null, ready: null };
  entry.ready = new Promise((resolve) => {
    session.once('connect', () => { try { session.setLocalWindowSize(64 * 1024 * 1024); } catch (e) { } resolve(entry); });
    session.once('error', () => { h1Only.set(origin, Date.now() + H1_ONLY_MS); dropSession(origin, session); resolve(null); });
    session.once('close', () => { dropSession(origin, session); resolve(null); });
  });
  session.on('error', () => { });
  session.on('goaway', () => dropSession(origin, session));
  session.on('close', () => dropSession(origin, session));
  sessions.set(origin, entry);
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
  entry.active++; clearTimeout(entry.timer);
  req.once('close', () => {
    entry.active--;
    if (entry.active <= 0) { entry.timer = setTimeout(() => { if (entry.active <= 0) { try { entry.session.close(); } catch (e) { } } }, IDLE_CLOSE_MS); if (entry.timer.unref) entry.timer.unref(); }
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => req.destroy(new ResumeError('stopped', 'aborted'));
    if (opts.signal) { opts.signal.addEventListener('abort', onAbort, { once: true }); req.once('close', () => opts.signal.removeEventListener('abort', onAbort)); }
    req.setTimeout(stallMs, () => req.destroy(new ResumeError('connection timed out', 'network')));
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
    const req = lib.get(u, { headers, signal: opts.signal, ...(u.protocol === 'https:' ? (opts.tls || {}) : {}) }, (res) => {
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
  for (const [origin, e] of sessions) { try { e.session.close(); } catch (x) { } sessions.delete(origin); }
  h1Only.clear();
}

module.exports = { openAuto, closeAllSessions };
