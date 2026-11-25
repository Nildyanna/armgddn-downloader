'use strict';
// "Send this problem to staff" on a failed download: what is removed, what is sent, the limits, and what the button says.
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitize } = require('../setupReport');
const pr = require('../downloadProblemReport');

test('redaction: signed-link parts, tokens, Bearer, cookies', () => {
  const out = sanitize('GET /dl/file.7z sig=abc123def&exp=99 token=xyz789 access_token=qqq Authorization: Bearer eyJhbGciOi.abc');
  assert.ok(!/abc123def|xyz789|qqq|eyJhbGciOi/.test(out), out);
  assert.match(out, /sig=<removed>/);
  assert.match(out, /token=<removed>/);
  assert.ok(!/Bearer eyJ/.test(sanitize('header Bearer eyJabc.def.ghi')));
  assert.strictEqual(sanitize('Cookie: ag_auth=abc; other=1'), 'Cookie: <removed>');
  assert.match(sanitize('set-cookie=sessid=1234'), /set-cookie=<removed>/);
  assert.ok(!/s3cr3t/.test(sanitize('https://www.armgddnbrowser.com/api/download-file?path=a&sig=s3cr3t')));
  assert.ok(!/HMACVALUE/.test(sanitize('X-Amz-Signature=HMACVALUE')));
});

test('redaction: user folders on every system', () => {
  for (const [input, gone] of [
    ['C:\\Users\\GeorgeJ\\Downloads\\game', 'GeorgeJ'],
    ['C:/Users/GeorgeJ/Downloads/game', 'GeorgeJ'],
    ['"dir":"C:\\\\Users\\\\GeorgeJ\\\\Games"', 'GeorgeJ'],
    ['d:\\Documents and Settings\\Bob\\x', 'Bob'],
    ['/home/george/Games/x', 'george'],
    ['/Users/george/Downloads', 'george'],
  ]) {
    const out = sanitize(input);
    assert.ok(!out.includes(gone), `${input} -> ${out}`);
    assert.match(out, /<user>/, out);
  }
});

test('redaction: e-mails, IPs and long token-like strings still removed', () => {
  const out = sanitize('mail a@b.com from 10.1.2.3 key ' + 'A'.repeat(40));
  assert.ok(!/a@b\.com|10\.1\.2\.3|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/.test(out), out);
});

const dl = { id: 'dl-42', name: 'Some Game v1.2', remotePath: 'PC1/Some Game v1.2', status: 'error', error: 'Failed: C:\\Users\\Bob\\Games token=abcd1234', fileCount: 3, completedFiles: 1, totalSize: 5e9, token: 'SESSIONTOKEN-SECRET', files: [{ name: 'somegame.7z.001', url: 'https://x/y?sig=1' }] };
const log = [
  '[t] [Route] fileRoute=direct file=somegame.7z.001',
  '[t] unrelated line about another title',
  '[t] [segmented] somegame.7z.001: retry 1: stall https://dl.example.com/f?sig=SIGVALUE&exp=1',
  '[t] [Progress] Sending: {"downloadId":"dl-42","dir":"/home/bob/Games"}',
  '[t] Authorization: Bearer TOKENVALUE',
].join('\n');

test('payload: title, error, version, OS, engine fields, this download\'s log lines only', () => {
  const p = pr.buildPayload({ download: dl, appVersion: '6.13.0', os: 'win32 10.0 x64', logText: log, note: '  it stopped at 80% /home/bob  ', engine: { outcome: 'failed', endedBy: 'stall', failKind: 'stall', retries: { stall: 3 }, reasons: { timeout: 2 }, streams: 8, seconds: 12.3456, engine: 'segmented', direct: true, url: 'https://x?sig=1', token: 'T' } });
  assert.strictEqual(p.title, 'Some Game v1.2');
  assert.strictEqual(p.app, '6.13.0');
  assert.strictEqual(p.os, 'win32 10.0 x64');
  assert.deepStrictEqual(p.files, { total: 3, done: 1 });
  assert.ok(!p.error.includes('Bob') && !p.error.includes('abcd1234'), p.error);
  assert.strictEqual(p.log.length, 3, JSON.stringify(p.log));
  assert.ok(!p.log.some((l) => l.includes('unrelated')));
  assert.deepStrictEqual(Object.keys(p.engine).sort(), ['direct', 'endedBy', 'engine', 'failKind', 'outcome', 'reasons', 'retries', 'seconds', 'streams']);
  assert.strictEqual(p.engine.seconds, 12.35);
  assert.strictEqual(p.note, 'it stopped at 80% /home/<user>');
  const text = JSON.stringify(p);
  for (const secret of ['SESSIONTOKEN-SECRET', 'SIGVALUE', 'TOKENVALUE', '/home/bob', 'Bob', 'sig=1']) assert.ok(!text.includes(secret), secret);
});

test('payload: keeps the newest 200 lines and stays under the size limit', () => {
  const many = Array.from({ length: 1000 }, (_, i) => `[t] somegame.7z.001: line ${i} ` + 'x'.repeat(300)).join('\n');
  const p = pr.buildPayload({ download: dl, appVersion: '1', os: 'linux', logText: many, note: 'word '.repeat(1000) });
  assert.ok(p.log.length <= 200);
  assert.ok(Buffer.byteLength(JSON.stringify(p)) <= pr.MAX_PAYLOAD);
  assert.match(p.log[p.log.length - 1], /line 999/);
  assert.strictEqual(p.note.length, 1000);
});

test('payload: a download with no id or name has no log lines (never the whole log)', () => {
  assert.deepStrictEqual(pr.logLinesFor(log, {}), []);
});

test('rate limit: one report per download, five a day', () => {
  const now = 1_000_000_000_000;
  let s = pr.normalizeState(null);
  assert.ok(pr.canSend(s, 'a', now).ok);
  s = pr.recordSent(s, 'a', 7, now);
  const again = pr.canSend(s, 'a', now + 1);
  assert.strictEqual(again.ok, false); assert.strictEqual(again.reason, 'already'); assert.strictEqual(again.reportId, 7);
  for (const id of ['b', 'c', 'd', 'e']) s = pr.recordSent(s, id, 8, now + 10);
  const sixth = pr.canSend(s, 'f', now + 20);
  assert.strictEqual(sixth.ok, false); assert.strictEqual(sixth.reason, 'daily');
  assert.ok(pr.canSend(s, 'f', now + 24 * 3600 * 1000 + 11).ok, 'a day later the daily limit has passed');
  assert.strictEqual(pr.canSend(s, 'a', now + 3 * 24 * 3600 * 1000).reason, 'already', 'the per-download limit does not expire');
  assert.deepStrictEqual(pr.sentMap(s), { a: 7, b: 8, c: 8, d: 8, e: 8 });
  assert.strictEqual(pr.canSend(s, '', now).ok, false);
});

test('button state on the download card', async () => {
  const { problemButton, previewRows } = await import('../renderer/native/problemReport.mjs');
  assert.strictEqual(problemButton({ status: 'completed' }, 0, false).show, false);
  assert.strictEqual(problemButton({ status: 'downloading' }, 0, false).show, false);
  assert.strictEqual(problemButton({ status: 'paused' }, 0, false).show, false);
  assert.deepStrictEqual(problemButton({ status: 'error' }, 0, false), { show: true, sent: false, disabled: false, label: 'Send this problem to staff' });
  assert.strictEqual(problemButton({ status: 'failed' }, 0, true).disabled, true);
  assert.deepStrictEqual(problemButton({ status: 'error' }, 12, false), { show: true, sent: true, disabled: true, label: 'Sent to staff (report #12)' });
  const rows = previewRows({ title: 'T', error: 'E', app: '6', os: 'win', files: { total: 2, done: 1 }, engine: { engine: 'segmented', outcome: 'failed', streams: 4 } });
  assert.deepStrictEqual(rows.map((r) => r[0]), ['Title', 'Error', 'App version', 'System', 'Files', 'Download engine']);
});
