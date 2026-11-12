const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const direct = require('../directEndpoint');

const MANAGED = 'https://dl.neatbarb.box.ca/dl?remote=PC-2&file=a%2Fb.7z.001&exp=1&uid=7&sig=abc';

beforeEach(() => {
  direct.configure({ enabled: false });
  direct._state.failedUntil = 0;
  direct._state.reach = { at: 0, ok: false };
});

test('off by default: the managed link is used unchanged', () => {
  assert.strictEqual(direct.rewrite(MANAGED), MANAGED);
  assert.strictEqual(direct.isDirectUrl(MANAGED), false);
});

test('switched on: only managed signed /dl links are rewritten, the query stays intact', () => {
  assert.strictEqual(direct.configure({ enabled: true, host: 'endeavour.whatbox.ca', port: 44443 }), true);
  const out = new URL(direct.rewrite(MANAGED));
  assert.strictEqual(out.hostname, 'endeavour.whatbox.ca');
  assert.strictEqual(out.port, '44443');
  assert.strictEqual(out.pathname, '/dl');
  assert.strictEqual(out.search, new URL(MANAGED).search);
  assert.ok(direct.isDirectUrl(out.toString()));
  for (const other of [
    'https://www.armgddnbrowser.com/api/download-file?x=1',
    'https://dl.neatbarb.box.ca/dl?remote=PC-2&file=x',           // no signature
    'https://dl.neatbarb.box.ca/other?sig=abc',
    'http://dl.neatbarb.box.ca/dl?sig=abc',
    'https://example.com/dl?sig=abc',
  ]) assert.strictEqual(direct.rewrite(other), other, other);
});

test('the site cannot name any other host or an unsafe port', () => {
  for (const bad of [
    { enabled: true, host: 'evil.example.com', port: 44443 },
    { enabled: true, host: 'endeavour.whatbox.ca', port: 80 },
    { enabled: true, host: 'endeavour.whatbox.ca', port: 'x' },
    { enabled: false, host: 'endeavour.whatbox.ca', port: 44443 },
    null, undefined, {},
  ]) {
    direct.configure(bad);
    assert.strictEqual(direct.rewrite(MANAGED), MANAGED, JSON.stringify(bad));
  }
});

test('a failure pauses the direct endpoint for ten minutes, then it comes back', () => {
  direct.configure({ enabled: true, host: 'endeavour.whatbox.ca', port: 44443 });
  const now = Date.now();
  direct.noteFailure(now);
  assert.strictEqual(direct.rewrite(MANAGED, now + 1000), MANAGED);
  assert.strictEqual(direct.rewrite(MANAGED, now + 9 * 60 * 1000), MANAGED);
  assert.notStrictEqual(direct.rewrite(MANAGED, now + 11 * 60 * 1000), MANAGED);
});

test('TLS options trust the pinned certificate and keep the normal roots', () => {
  const o = direct.tlsOptions();
  assert.ok(o.ca.includes(direct.CERT_PEM));
  assert.ok(o.ca.length > 50, 'system roots are still there');
});

test('the certificate file is written for rclone and rewritten if it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-'));
  const f = direct.certFile(dir);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), direct.CERT_PEM);
  fs.writeFileSync(f, 'tampered');
  assert.strictEqual(fs.readFileSync(direct.certFile(dir), 'utf8'), direct.CERT_PEM);
});

test('reachable() is false when off or when nothing listens', async () => {
  assert.strictEqual(await direct.reachable(500), false);
  direct.configure({ enabled: true, host: 'endeavour.whatbox.ca', port: 44443 });
  direct._state.host = '127.0.0.1';      // nothing listens on this port locally
  direct._state.port = 9;
  assert.strictEqual(await direct.reachable(500), false);
});
