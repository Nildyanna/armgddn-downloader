// The app's side of direct-from-Drive downloads (the site's lib/driveDirect.js has the other half; see docs/direct-drive-downloads-design.md).
//
// The manifest tells the app, per file, a Drive link with an Authorization header, when it expires and the gateway link to fall back to.
// This module keeps the bookkeeping for one download: renewing the token through the site (which does not count as a new download), and
// telling the site at the end how much was not downloaded, so the member's daily allowance is credited and finished files are remembered.
const https = require('https');

// The grant a manifest started, or null (an old site, a remote without direct downloads, or a member over a limit).
function grantFromManifest(manifest) {
  const d = manifest && manifest.directDrive;
  if (!d || d.used !== true || typeof d.grantId !== 'string' || !/^[a-f0-9]{8,64}$/.test(d.grantId)) return null;
  const files = new Map();   // path -> size, for the files that were given a Drive link
  for (const f of (manifest.files || [])) if (f && f.path && f.headers && f.headers.Authorization) files.set(String(f.path), Number(f.size) || 0);
  if (!files.size) return null;
  return { grantId: d.grantId, files, done: new Set(), sent: new Set(), skipped: new Set(), finished: false };
}

function post(base, pathName, token, body, { request = https.request, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathName, base);
    const data = JSON.stringify(body);
    const req = request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', family: 4, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + token } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

// A fresh token for a running grant. Returns { headers, expiresAt } or null when the site would not renew it (the caller then uses the gateway).
async function renew(grant, manifestUrl, token, opts) {
  if (!grant) return null;
  try {
    const r = await post(manifestUrl, '/api/drive-direct/renew', token, { grantId: grant.grantId }, opts);
    if (r.status === 200 && r.json && r.json.success && r.json.headers && r.json.headers.Authorization && r.json.expiresAt) return { headers: r.json.headers, expiresAt: r.json.expiresAt };
  } catch (e) { }
  return null;
}

// Bytes that were given a Drive link but not downloaded (cancelled, failed, or already on disk), for the site to credit back.
function notDownloaded(grant) {
  let n = 0;
  for (const [p, size] of grant.files) if (!grant.done.has(p)) n += size;
  return n;
}

// Tell the site how the grant ended: the bytes that were given a Drive link but not downloaded (credited back, once, by the site) and the files
// that finished (remembered, so a repeat counts double). Safe to call again: a later call only sends files that finished since the last one, and
// sends nothing at all when there is nothing new (a failed download that is retried and then completes reports its remaining files this way).
async function finish(grant, manifestUrl, token, opts) {
  if (!grant) return false;
  const fresh = Array.from(grant.done).filter((p) => !grant.sent.has(p));
  if (grant.finished && !fresh.length) return false;
  const first = !grant.finished;
  grant.finished = true;
  for (const p of fresh) grant.sent.add(p);
  try {
    const r = await post(manifestUrl, '/api/drive-direct/finish', token,
      { grantId: grant.grantId, notDownloaded: first ? notDownloaded(grant) : 0, completedPaths: fresh }, opts);
    return r.status === 200;
  } catch (e) { return false; }
}

module.exports = { grantFromManifest, renew, finish, notDownloaded };
