'use strict';
// Download lists (manifests): fetching them, avoiding mirrors that failed, riding out network drops, renewing expired links (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { noteRecovery } = require('./failures');
const { logToFile } = require('./log');
const { markMirrorCooldown, getActiveMirrorAvoidList } = require('./mirrors');
const { waitForNetwork, transformProxyUrlToDirectIfPossible } = require('./net');
const { updateProgress } = require('./progress');
const { isAllowedServiceHost } = require('./siteApi');
const { app } = require('electron');
const https = require('https');

function isNetworkDownError(err) {
  if (!err) return false;
  if (err.code && ctx.NETWORK_DOWN_CODES.has(String(err.code))) return true;
  return /getaddrinfo|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH/i.test(String(err.message || err));
}

// fetchManifestWithAvoidMirror, but rides out a dropped connection: on a
// network-down error, wait for the network (up to 5 min) and try once more.
async function fetchManifestRidingOutNetwork(download, manifestUrl, token, avoidMirror) {
  try {
    return await fetchManifestWithAvoidMirror(manifestUrl, token, avoidMirror);
  } catch (e) {
    if (!isNetworkDownError(e)) throw e;
    noteRecovery(download, `network down (${e && e.code ? e.code : 'error'}); waiting for it to come back`);
    if (!(await waitForNetwork())) {
      noteRecovery(download, 'network still down after 5 minutes');
      throw e;
    }
    noteRecovery(download, 'network back; retrying');
    return await fetchManifestWithAvoidMirror(manifestUrl, token, avoidMirror);
  }
}

async function fetchManifestWithAvoidMirror(manifestUrl, token, avoidMirror, redirectCount = 0) {
  // Prevent infinite redirect loops
  if (redirectCount > 3) {
    throw new Error('Too many redirects while fetching manifest');
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(manifestUrl);

    // Security: Enforce HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('Security error: Only HTTPS connections are allowed'));
      return;
    }

    if (!isAllowedServiceHost(parsedUrl.hostname)) {
      reject(new Error('Security error: Host not allowed'));
      return;
    }

    const queryString = parsedUrl.search.substring(1);
    const params = {};
    for (const pair of queryString.split('&')) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        const key = decodeURIComponent(pair.substring(0, eqIndex));
        const value = decodeURIComponent(pair.substring(eqIndex + 1));
        params[key] = value;
      }
    }

    const remote = params.remote;
    const pathParam = params.path;

    if (!remote || !pathParam) {
      const errorMsg = `Missing remote or path. Query="${queryString}", Params=${JSON.stringify(params)}, remote="${remote}", path="${pathParam}"`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }

    const postBody = { remote, path: pathParam };
    if (avoidMirror) {
      postBody.avoidMirror = String(avoidMirror);
    }
    const postData = JSON.stringify(postBody);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: 'POST',
      family: 4,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);

          if (json.redirect && json.newRemote && json.newPath) {
            // Security (M3): validate server-supplied redirect params before use
            if (typeof json.newRemote !== 'string' || json.newRemote.length > 4096 ||
                typeof json.newPath !== 'string' || json.newPath.length > 4096) {
              reject(new Error('Invalid redirect parameters from server'));
              return;
            }
            const newManifestUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}?remote=${encodeURIComponent(json.newRemote)}&path=${encodeURIComponent(json.newPath)}`;
            try {
              const newManifest = await fetchManifestWithAvoidMirror(newManifestUrl, token, avoidMirror, redirectCount + 1);
              resolve(newManifest);
            } catch (retryErr) {
              reject(new Error(`Game was moved but failed to fetch from new location: ${retryErr.message}`));
            }
            return;
          }

          if (json.success === false) {
            reject(new Error(json.error || 'Server returned error'));
            return;
          }

          resolve(json);
        } catch (e) {
          console.error('Failed to parse manifest:', data);
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });
    req.write(postData);
    req.end();
  });
}

// Internal function to fetch manifest (can be called recursively for redirects)
async function fetchManifestInternal(manifestUrl, token, redirectCount = 0) {
  // Prevent infinite redirect loops
  if (redirectCount > 3) {
    throw new Error('Too many redirects while fetching manifest');
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(manifestUrl);

    // Security: Enforce HTTPS only
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('Security error: Only HTTPS connections are allowed'));
      return;
    }

    if (!isAllowedServiceHost(parsedUrl.hostname)) {
      reject(new Error('Security error: Host not allowed'));
      return;
    }

    // Parse query params using decodeURIComponent (preserves + as literal +)
    const queryString = parsedUrl.search.substring(1);
    const params = {};
    for (const pair of queryString.split('&')) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        const key = decodeURIComponent(pair.substring(0, eqIndex));
        const value = decodeURIComponent(pair.substring(eqIndex + 1));
        params[key] = value;
      }
    }

    const remote = params.remote;
    const pathParam = params.path;

    if (!remote || !pathParam) {
      const errorMsg = `Missing remote or path. Query="${queryString}", Params=${JSON.stringify(params)}, remote="${remote}", path="${pathParam}"`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }

    const postData = JSON.stringify({ remote, path: pathParam });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: 'POST',
      family: 4,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        // Says this app can use a Drive link with a token (direct-from-Drive); the site decides per file and otherwise sends the usual links.
        'X-Drive-Direct': '1',
        'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(),   // the site can tell an out-of-date app and ask it to update (version 6.0.0 cutover)
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };

    const req = https.request(options, (res) => {

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);

          // Handle game moved to new location (server returns 302 with redirect info)
          if (json.redirect && json.newRemote && json.newPath) {
            // Security (M3): validate server-supplied redirect params before use
            if (typeof json.newRemote !== 'string' || json.newRemote.length > 4096 ||
                typeof json.newPath !== 'string' || json.newPath.length > 4096) {
              reject(new Error('Invalid redirect parameters from server'));
              return;
            }
            // Build new manifest URL with updated remote and path
            const newManifestUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}?remote=${encodeURIComponent(json.newRemote)}&path=${encodeURIComponent(json.newPath)}`;

            try {
              // Recursively fetch from new location
              const newManifest = await fetchManifestInternal(newManifestUrl, token, redirectCount + 1);
              resolve(newManifest);
            } catch (retryErr) {
              reject(new Error(`Game was moved but failed to fetch from new location: ${retryErr.message}`));
            }
            return;
          }

          if (json.success === false) {
            reject(new Error(json.error || 'Server returned error'));
            return;
          }

          resolve(json);
        } catch (e) {
          console.error('Failed to parse manifest:', data);
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });
    req.write(postData);
    req.end();
  });
}

async function refetchManifestAndRetryExpiredLink(downloadId, download, file, downloadDir, reason = 'expired') {
  // Prevents the poll loop's hasErrors-and-no-active-processes check from
  // finalizing this download as failed while a retry is in flight — activeProcesses
  // is empty for the whole duration of the manifest refetch below, not just the
  // moment between the old process closing and the new one spawning.
  if (download) download.recovering = true;
  try {
    if (!download || !download.manifestUrl || !download.token) return false;
    // Budget per file, not per download: a game split into many parts used to
    // share 2 renewals for the whole download, so later parts failed outright
    // (Sentry COMPANION-2, Half-Life Alyx part .011). Overall cap stops loops.
    download.tokenRefreshes = (Number(download.tokenRefreshes) || 0) + 1;
    if (download.tokenRefreshes > 30) return false;
    if (!download.__fileRetries) download.__fileRetries = {};
    const retryKey = String((file && (file.path || file.name)) || '');
    const counts = download.__fileRetries[retryKey] || (download.__fileRetries[retryKey] = { expired: 0, network: 0 });
    counts[reason] = (Number(counts[reason]) || 0) + 1;
    if (counts[reason] > 3) {
      noteRecovery(download, `${reason} retries used up for ${file && file.name ? file.name : retryKey}`);
      return false;
    }
    if (reason === 'network' && !(await waitForNetwork())) {
      noteRecovery(download, 'network still down after 5 minutes');
      return false;
    }

    // First refresh: same mirror (a genuinely expired signed link). If that
    // still fails, the "expired" 403 is more likely the mirror refusing the
    // file (Google per-file limits also answer 403), so the second refresh
    // asks for a different mirror. Sentry COMPANION-2: five "link expired"
    // failures in a row, all on PCVR-1.
    const avoidCurrent = reason === 'expired' && counts.expired >= 2 && download.actualRemote;
    logToFile(`[TokenRefresh] refetching manifest for expired link refreshCount=${download.tokenRefreshes}${avoidCurrent ? ` avoidMirror=${download.actualRemote}` : ''} file=${file && file.name ? String(file.name) : ''}`);
    let newManifest;
    if (avoidCurrent) {
      try { markMirrorCooldown(String(download.actualRemote), 'repeated expired-link 403'); } catch (e) { }
      const tried = Array.isArray(download.triedMirrors) ? download.triedMirrors.map(String) : [];
      if (!tried.includes(String(download.actualRemote))) tried.push(String(download.actualRemote));
      newManifest = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, getActiveMirrorAvoidList(tried).join(','));
    } else {
      newManifest = await fetchManifestRidingOutNetwork(download, String(download.manifestUrl), download.token, '');
    }
    if (!newManifest || !Array.isArray(newManifest.files)) return false;
    try {
      const newActual = newManifest.actualRemote ? String(newManifest.actualRemote) : '';
      if (avoidCurrent && newActual && newActual !== String(download.actualRemote)) {
        download.actualRemote = newActual;
        download.mirrorSwitches = (Number(download.mirrorSwitches) || 0) + 1;
        if (!Array.isArray(download.triedMirrors)) download.triedMirrors = [];
        download.triedMirrors.push(newActual);
        logToFile(`[TokenRefresh] switched mirror to ${newActual} for expired-link retry`);
      }
    } catch (e) { }

    const wantPath = file && file.path ? String(file.path) : '';
    const wantName = file && file.name ? String(file.name) : '';
    const match = newManifest.files.find(f => {
      if (!f) return false;
      if (wantPath && f.path && String(f.path) === wantPath) return true;
      if (wantName && f.name && String(f.name) === wantName) return true;
      return false;
    });

    if (!match || !match.url) return false;

    const retryFile = { ...file, url: String(match.url), __resume: true };
    try {
      const transformed = transformProxyUrlToDirectIfPossible(retryFile.url);
      if (transformed && transformed !== retryFile.url) {
        retryFile.url = transformed;
      }
    } catch (e) { }

    // Clear stale error state before retrying.
    try {
      download.status = 'downloading';
      download.error = '';
      download.statusMessage = '';
      // Remove this file from failedFiles since we're retrying it — otherwise the
      // poll loop's hasErrors-and-no-active-processes check can race this retry
      // (activeProcesses is briefly empty between the old process closing and the
      // new one being spawned below) and permanently finalize the download as
      // failed while the retry is still in flight.
      if (Array.isArray(download.failedFiles)) {
        download.failedFiles = download.failedFiles.filter(n => String(n) !== String(wantName));
      }
      updateProgress(downloadId);
    } catch (e) { }

    noteRecovery(download, `${reason === 'network' ? 'network recovered' : 'link renewed'} (${counts[reason]}/3) for ${wantName}`);
    logToFile(`[TokenRefresh] retrying file with refreshed url reason=${reason} file=${wantName}`);
    await ctx.downloadFile(downloadId, retryFile, downloadDir);
    return true;
  } catch (e) {
    try {
      logToFile(`[TokenRefresh] manifest refetch/retry failed: ${e && e.message ? e.message : String(e)}`);
    } catch (e2) { }
    return false;
  } finally {
    if (download) download.recovering = false;
  }
}

module.exports = { isNetworkDownError, fetchManifestRidingOutNetwork, fetchManifestWithAvoidMirror, fetchManifestInternal, refetchManifestAndRetryExpiredLink };
