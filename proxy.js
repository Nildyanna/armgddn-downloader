// HTTP proxy support for the built-in (segmented) downloader. rclone reads the proxy variables itself; Node does not, so this
// does the same job: HTTPS_PROXY / HTTP_PROXY / ALL_PROXY (either case) and NO_PROXY, tunnelling https through the proxy with CONNECT.
const http = require('http');
const https = require('https');
const tls = require('tls');

function envGet(env, name) { return env[name] || env[name.toLowerCase()] || ''; }

function noProxyMatches(host, port, list) {
  for (let raw of String(list || '').split(/[\s,]+/)) {
    raw = raw.trim().toLowerCase(); if (!raw) continue;
    if (raw === '*') return true;
    let h = raw, p = '';
    const m = /^(.*):(\d+)$/.exec(raw); if (m && !raw.includes(']')) { h = m[1]; p = m[2]; }
    if (p && p !== String(port)) continue;
    h = h.replace(/^\*?\./, '');
    if (host === h || host.endsWith('.' + h)) return true;
  }
  return false;
}

// -> URL of the proxy to use for target (a URL), or null for a direct connection.
function proxyFor(target, env = process.env) {
  let u; try { u = target instanceof URL ? target : new URL(target); } catch (e) { return null; }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (noProxyMatches(host, port, envGet(env, 'NO_PROXY'))) return null;
  let raw = (u.protocol === 'https:' ? envGet(env, 'HTTPS_PROXY') : envGet(env, 'HTTP_PROXY')) || envGet(env, 'ALL_PROXY');
  raw = String(raw).trim(); if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'http://' + raw;
  try {
    const p = new URL(raw);
    return (p.protocol === 'http:' || p.protocol === 'https:') && p.hostname ? p : null;   // socks and the like are not supported
  } catch (e) { return null; }
}

function authHeader(p) {
  if (!p.username && !p.password) return null;
  return 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64');
}

// A socket to host:port through the proxy (CONNECT). cb(err, socket).
function connectTunnel(p, host, port, cb, timeoutMs = 20000) {
  const isTls = p.protocol === 'https:';
  const headers = { Host: `${host}:${port}` };
  const auth = authHeader(p); if (auth) headers['Proxy-Authorization'] = auth;
  const req = (isTls ? https : http).request({ host: p.hostname.replace(/^\[|\]$/g, ''), port: p.port || (isTls ? 443 : 80), method: 'CONNECT', path: `${host}:${port}`, headers, timeout: timeoutMs, agent: false });
  let done = false;
  const finish = (err, sock) => { if (done) { if (sock) sock.destroy(); return; } done = true; cb(err, sock); };
  req.once('connect', (res, socket) => {
    if (res.statusCode !== 200) { socket.destroy(); return finish(new Error(`proxy refused the connection (${res.statusCode}${res.statusCode === 407 ? ', it needs a username and password' : ''})`)); }
    finish(null, socket);
  });
  req.once('timeout', () => { req.destroy(); finish(new Error('proxy connection timed out')); });
  req.once('error', (e) => finish(new Error(`proxy connection failed: ${e && e.message ? e.message : e}`)));
  req.end();
}

// TLS to the target over the tunnel. alpn: e.g. ['h2'].
function tlsOverTunnel(p, u, tlsOpts, alpn, cb) {
  const port = Number(u.port) || 443;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  connectTunnel(p, host, port, (err, raw) => {
    if (err) return cb(err);
    const s = tls.connect({ ...(tlsOpts || {}), socket: raw, servername: host, ...(alpn ? { ALPNProtocols: alpn } : {}) });
    const onErr = (e) => cb(e);
    s.once('error', onErr);
    s.once('secureConnect', () => { s.removeListener('error', onErr); cb(null, s); });
  });
}

// https.Agent whose connections go through the proxy.
class TunnelAgent extends https.Agent {
  constructor(p, tlsOpts) { super({ keepAlive: false }); this.p = p; this.tlsOpts = tlsOpts || {}; }
  createConnection(options, cb) {
    const u = new URL(`https://${options.host || options.hostname}:${options.port || 443}`);
    tlsOverTunnel(this.p, u, this.tlsOpts, null, (err, s) => cb(err, s));
  }
}

module.exports = { proxyFor, connectTunnel, tlsOverTunnel, TunnelAgent, authHeader };
