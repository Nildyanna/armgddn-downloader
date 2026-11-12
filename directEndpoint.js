// A direct download endpoint next to the managed link.
//
// The download host's managed link (dl.neatbarb.box.ca) is capped by the hosting provider at about 100 simultaneous connections for
// the whole slot, and resets new ones past that. The same gateway is also served on its own TCP port with a self-signed
// certificate. The Companion trusts exactly that certificate (and the normal system roots), so it still refuses anything else.
//
// The site switches this on and off through /api/app-load (directDownload). Off, unreachable, or after a failure, every download
// goes through the managed link as before.
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBxDCCAWqgAwIBAgIUJxc3k5P0JkvdJlJ0fE5Fb5tOmCYwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOYXJtZ2Rkbi1kaXJlY3QwHhcNMjYxMTEyMjExMDA2WhcNMzYx
MTA5MjExMDA2WjAZMRcwFQYDVQQDDA5hcm1nZGRuLWRpcmVjdDBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABB6iVT0refYOGAK21LwZRnOGjsLPPKr9Yuvn4+U9lgcX
7hFPHIBEq97CyzMMYJB0MTNnGY9vLYNi3qma3PuSHO+jgY8wgYwwHQYDVR0OBBYE
FH/TM8erbsTw1DYCaNdUXs1W9uc1MB8GA1UdIwQYMBaAFH/TM8erbsTw1DYCaNdU
Xs1W9uc1MA8GA1UdEwEB/wQFMAMBAf8wOQYDVR0RBDIwMIIUZW5kZWF2b3VyLndo
YXRib3guY2GCEmRsLm5lYXRiYXJiLmJveC5jYYcESBURQjAKBggqhkjOPQQDAgNI
ADBFAiBGAPph42sAvQ8H1/QLdLb8e6LkHvR0YI2NqNm3URgPsgIhAK/sr8hOFlD0
q+EzCvsW/8WN7W0dDwAcamg2GNg9n8fu
-----END CERTIFICATE-----
`;

// Only these hosts may be named by the site: a changed app-load answer can never send downloads somewhere else.
const ALLOWED_DIRECT_HOSTS = new Set(['endeavour.whatbox.ca', '72.21.17.66']);
const MANAGED_HOSTS = new Set(['dl.neatbarb.box.ca', 'dl-origin.neatbarb.box.ca']);
const COOLDOWN_MS = 10 * 60 * 1000;
const REACH_CACHE_MS = 60 * 1000;

const state = { enabled: false, host: '', port: 0, failedUntil: 0, reach: { at: 0, ok: false } };

// info = loadInfo.directDownload from /api/app-load: { enabled, host, port }
function configure(info) {
  const had = state.enabled;
  const ok = info && info.enabled === true
    && typeof info.host === 'string' && ALLOWED_DIRECT_HOSTS.has(info.host.toLowerCase())
    && Number.isInteger(Number(info.port)) && Number(info.port) >= 1024 && Number(info.port) <= 65535;
  if (!ok) { state.enabled = false; state.host = ''; state.port = 0; return had; }
  state.enabled = true; state.host = info.host.toLowerCase(); state.port = Number(info.port);
  return !had;
}

function inCooldown(now = Date.now()) { return now < state.failedUntil; }
function noteFailure(now = Date.now()) { state.failedUntil = now + COOLDOWN_MS; state.reach = { at: 0, ok: false }; }
function isDirectUrl(urlString) {
  try { const u = new URL(String(urlString)); return state.enabled && u.hostname.toLowerCase() === state.host && Number(u.port) === state.port; } catch (e) { return false; }
}

// The URL to download from: the direct one when allowed, otherwise the one given.
function rewrite(urlString, now = Date.now()) {
  if (!state.enabled || inCooldown(now)) return String(urlString);
  try {
    const u = new URL(String(urlString));
    if (u.protocol !== 'https:' || !MANAGED_HOSTS.has(u.hostname.toLowerCase()) || u.pathname !== '/dl' || !u.searchParams.get('sig')) return String(urlString);
    u.hostname = state.host; u.port = String(state.port);
    return u.toString();
  } catch (e) { return String(urlString); }
}

// Options for https/http2 requests: the system roots plus our certificate.
function tlsOptions() { return { ca: [...tls.rootCertificates, CERT_PEM] }; }

// Can a TLS connection be made to the direct port with the pinned certificate? (cached for a minute)
function reachable(timeoutMs = 4000, now = Date.now()) {
  if (!state.enabled) return Promise.resolve(false);
  if (now - state.reach.at < REACH_CACHE_MS) return Promise.resolve(state.reach.ok);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; state.reach = { at: Date.now(), ok }; try { sock.destroy(); } catch (e) { } resolve(ok); };
    const sock = tls.connect({ host: state.host, port: state.port, ca: [CERT_PEM], servername: state.host === '72.21.17.66' ? undefined : state.host }, () => finish(!!sock.authorized));
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.on('error', () => finish(false));
  });
}

// rclone takes the certificate as a file. Written once to a folder the app owns.
function certFile(dir) {
  const p = path.join(dir, 'armgddn-direct-ca.pem');
  try { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== CERT_PEM) fs.writeFileSync(p, CERT_PEM); return p; } catch (e) { return null; }
}

function describe() { return state.enabled ? `${state.host}:${state.port}${inCooldown() ? ' (paused after a failure)' : ''}` : 'off'; }

module.exports = { configure, rewrite, isDirectUrl, noteFailure, inCooldown, tlsOptions, reachable, certFile, describe, CERT_PEM, _state: state };
