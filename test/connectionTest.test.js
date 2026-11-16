const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { runPhase, recommend, runTest } = require('../connectionTest');

const SIZE = 40 * 1024 * 1024;
function server() {
  const srv = http.createServer((q, s) => {
    const m = /bytes=(\d+)-(\d+)/.exec(q.headers.range || '');
    const a = m ? +m[1] : 0, b = m ? Math.min(+m[2], SIZE - 1) : SIZE - 1;
    s.writeHead(206, { 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${SIZE}` });
    s.end(Buffer.alloc(b - a + 1, 1));
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/f` })));
}

test('a phase reads ranges for the time given and reports speed', async () => {
  const { srv, url } = await server();
  const r = await runPhase({ url, total: SIZE, streams: 3, ms: 400 });
  srv.close();
  assert.ok(r.bytes > 0 && r.mbps > 0, JSON.stringify(r));
  assert.strictEqual(r.streams, 3);
  assert.ok(r.seconds >= 0.3 && r.seconds < 3);
});

test('a full test runs every level and recommends one', async () => {
  const { srv, url } = await server();
  const seen = [];
  const out = await runTest({ getTarget: async () => ({ url, total: SIZE }), levels: [4, 2, 1], phaseMs: 300, onProgress: (p) => seen.push(p.streams) });
  srv.close();
  assert.deepStrictEqual(seen, [4, 2, 1]);
  assert.strictEqual(out.results.length, 3);
  assert.ok(out.recommendation.streams > 0);
});

test('recommend picks the fewest connections that are nearly as fast and as steady', () => {
  const r = (streams, mbps, stalls = 0) => ({ streams, bytes: 1000, mbps, stalls, errors: 0 });
  assert.strictEqual(recommend([r(16, 100), r(8, 98), r(4, 60), r(1, 20)]).streams, 8);
  assert.strictEqual(recommend([r(16, 100), r(8, 70), r(4, 50), r(1, 20)]).value, 0);       // 16 clearly best: Auto
  const wifi = recommend([r(16, 90, 3), r(8, 80, 1), r(4, 75, 0), r(1, 30, 0)]);
  assert.strictEqual(wifi.streams, 4); assert.strictEqual(wifi.value, 4); assert.strictEqual(wifi.wifiHint, true);
  assert.strictEqual(recommend([{ streams: 16, bytes: 0, mbps: 0, stalls: 0, errors: 3 }]).reason, 'nodata');
});

test('no test file means a clear error', async () => {
  await assert.rejects(runTest({ getTarget: async () => null, levels: [1], phaseMs: 100 }), /no test file/);
});
