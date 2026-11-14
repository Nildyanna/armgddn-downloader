// How many parallel connections each download host has been seen to allow. The segmented downloader reports it when a server turns
// connections away; the next download from that host then starts at that number instead of being refused again. A learned limit
// expires after a week, so a host that gets roomier is tried at full speed again.
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hostOf(url) {
  try { return new URL(String(url)).host.toLowerCase(); } catch (e) { return ''; }
}

function create(dir, now = () => Date.now()) {
  const file = path.join(dir, 'host-limits.json');
  const load = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; } };
  return {
    // The limit to start with for this URL's host, or 0 when none is known (or the old one has expired).
    get(url) {
      const h = hostOf(url); if (!h) return 0;
      const e = load()[h];
      if (!e || !(e.limit >= 1) || !(now() - Number(e.at) < MAX_AGE_MS)) return 0;
      return Math.floor(e.limit);
    },
    learn(url, limit) {
      const h = hostOf(url); const n = Math.floor(Number(limit));
      if (!h || !(n >= 1)) return;
      const d = load();
      d[h] = { limit: n, at: now() };
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(d)); fs.renameSync(file + '.tmp', file); } catch (e) { /* best effort */ }
    },
  };
}

module.exports = { create, hostOf, MAX_AGE_MS };
