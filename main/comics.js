'use strict';
// Comics catalog sign-in tokens and the support diagnostics block (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const directEndpoint = require('../directEndpoint');
const { savedSessionToken } = require('./session');
const { app } = require('electron');
const os = require('os');

// Every app sign-in the Companion holds, newest source first: the token the site's button handed over for this page, the other
// page's, and the saved one. Any of them is a normal app session, so a catalog request tries each until one is accepted.
function catalogTokens(first) {
  const out = [];
  for (const t of [first, ctx.comicsState.token, ctx.musicState.token, savedSessionToken()]) { if (t && !out.includes(t)) out.push(t); }
  return out;
}

// A few lines about the member's setup that make a log easier to read (no paths, no addresses, no proxy values).
function supportDiagnostics() {
  try {
    const px = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'].some((k) => process.env[k]);
    const lines = [
      '# --- setup ---',
      `# connections per file: ${ctx.settings.connectionsPerFile > 0 ? ctx.settings.connectionsPerFile : 'auto'}; downloads at once: ${ctx.settings.maxConcurrentDownloads}; speed limit: ${ctx.settings.maxDownloadSpeedMBps > 0 ? ctx.settings.maxDownloadSpeedMBps + ' MB/s' : 'none'}`,
      `# own downloader: ${ctx.settings.segmentedDownloads === false ? 'off' : 'on'}; direct endpoint: ${directEndpoint.describe()}; proxy variable set: ${px ? 'yes' : 'no'}`,
      `# app ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${os.release()} ${process.arch}`,
      ...(ctx.lastConnectionTest ? [`# last connection test ${new Date(ctx.lastConnectionTest.at).toISOString()}: ${ctx.lastConnectionTest.results.map((r) => `${r.streams}x ${r.mbps} MB/s ${r.stalls} stalls`).join(', ')}; recommended ${ctx.lastConnectionTest.recommendation.value || 'auto'}`] : []),
      '# --- log ---',
      '',
    ];
    return lines.join('\n');
  } catch (e) { return ''; }
}

module.exports = { catalogTokens, supportDiagnostics };
