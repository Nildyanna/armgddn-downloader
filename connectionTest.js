// "Test my connection": downloads (and throws away) ranges of one big file from the download server with 16, 8, 4 and 1 connections for a
// few seconds each, then recommends the "Connections per file" value that is fastest without stalls. Nothing is written to disk.
const { openAuto } = require('./httpOpen');

const LEVELS = [16, 8, 4, 1];
const WINDOW = 4 * 1024 * 1024;          // each request asks for this many bytes
const STALL_GAP_MS = 3000;               // no bytes at all for this long (across every connection) counts as one stall

// One phase: `streams` workers keep fetching WINDOW-sized ranges for `ms` milliseconds. Returns { streams, bytes, seconds, mbps, stalls, errors }.
async function runPhase({ url, total, streams, ms, tls, headers = {}, now = Date.now }) {
  const started = now();
  const deadline = started + ms;
  const ctl = new AbortController();
  let bytes = 0, errors = 0, stalls = 0, lastByteAt = started, next = 0;
  const gapTimer = setInterval(() => {
    if (now() - lastByteAt >= STALL_GAP_MS) { stalls++; lastByteAt = now(); }
  }, 500);
  const stopTimer = setTimeout(() => ctl.abort(), ms);
  const worker = async () => {
    while (now() < deadline && !ctl.signal.aborted) {
      const start = (next++ * WINDOW) % Math.max(WINDOW, total - WINDOW);
      const end = Math.min(total - 1, start + WINDOW - 1);
      try {
        const { req, res } = await openAuto(url, { ...headers, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` }, 8000, { signal: ctl.signal, tls });
        if ((res.statusCode || 0) !== 206 && res.statusCode !== 200) { errors++; try { res.resume(); req.destroy(); } catch (e) { } continue; }
        await new Promise((resolve) => {
          res.on('data', (d) => { bytes += d.length; lastByteAt = now(); });
          res.on('error', () => { errors++; resolve(); });
          res.on('close', resolve);
          res.on('end', resolve);
        });
        try { req.destroy(); } catch (e) { }
      } catch (e) {
        if (ctl.signal.aborted) return;
        errors++;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  };
  try { await Promise.all(Array.from({ length: streams }, worker)); }
  finally { clearInterval(gapTimer); clearTimeout(stopTimer); }
  const seconds = Math.max(0.001, (now() - started) / 1000);
  return { streams, bytes, seconds, mbps: Math.round((bytes / seconds / 1048576) * 10) / 10, stalls, errors };
}

// Picks the lowest connection count that is nearly as fast as the best of the steadiest settings. A setting that paused the whole connection
// loses to one that did not, unless the steady one is less than half as fast. results: runPhase outputs.
function recommend(results) {
  const ok = (results || []).filter((r) => r && r.bytes > 0);
  if (!ok.length) return { value: 0, reason: 'nodata' };
  const overallBest = ok.reduce((a, b) => (b.mbps > a.mbps ? b : a));
  const fewestStalls = Math.min(...ok.map((r) => r.stalls));
  let pool = ok.filter((r) => r.stalls === fewestStalls);
  if (Math.max(...pool.map((r) => r.mbps)) < overallBest.mbps * 0.5) pool = ok;
  const best = pool.reduce((a, b) => (b.mbps > a.mbps ? b : a));
  const pick = pool.filter((r) => r.mbps >= best.mbps * 0.9).sort((a, b) => a.streams - b.streams)[0] || best;
  const sixteen = ok.find((r) => r.streams === 16);
  const wifiHint = !!sixteen && sixteen.stalls > 0 && pick.streams < 16;
  return { value: pick.streams >= 16 ? 0 : pick.streams, streams: pick.streams, mbps: pick.mbps, wifiHint, reason: wifiHint ? 'stalls' : 'speed' };
}

async function runTest({ getTarget, tls, phaseMs = 12000, levels = LEVELS, onProgress = () => { }, now = Date.now }) {
  const results = [];
  for (let i = 0; i < levels.length; i++) {
    const t = await getTarget(i);                      // { url, total } with a fresh signed URL each phase
    if (!t || !t.url || !(t.total > 0)) throw new Error('no test file available');
    onProgress({ phase: i + 1, of: levels.length, streams: levels[i] });
    results.push(await runPhase({ url: t.url, total: t.total, streams: levels[i], ms: phaseMs, tls, now }));
  }
  return { results, recommendation: recommend(results) };
}

module.exports = { runPhase, recommend, runTest, LEVELS };
