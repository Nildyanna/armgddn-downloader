const test = require('node:test');
const assert = require('node:assert');
const d = require('../downloadErrors');

test('a Go runtime crash is a crash, not an expired link', () => {
  assert.ok(d.isCrashOutput('fatal error: runtime: mcall called on m->g0 stack'));
  assert.ok(d.isCrashOutput('fatal error: unexpected signal during runtime execution'));
  assert.ok(!d.isNotFound('fatal error: runtime: mcall called on m->g0 stack', 'x\nnot found in cache\nfatal error: runtime: mcall called on m->g0 stack'));
});

test('a real 404 is still recognised, from the detail or the CopyURL wording', () => {
  assert.ok(d.isNotFound('CopyURL failed: 404 Not Found', ''));
  assert.ok(d.isNotFound('something', 'NOTICE: Failed to copyurl: CopyURL failed: 404 Not Found'));
});

test('words elsewhere in the output do not make a failure a 404', () => {
  assert.ok(!d.isNotFound('Failed to copyurl: read tcp: boom', 'config file not found, using defaults\nFailed to copyurl: read tcp: boom'));
});

test('Windows socket errors in any language are a dropped connection, never a 404', () => {
  for (const msg of [
    'Failed to copyurl: Get "https://dl.neatbarb.box.ca/dl?…": read tcp4 192.168.1.72:56266->72.21.17.66:443: wsarecv: An existing connection was forcibly closed by the remote host.',
    'read tcp4 192.168.1.177:58106->72.21.17.66:443: wsarecv: Varolan bir bağlantı uzaktaki bir ana bilgisayar tarafından zorla kapatıldı.',
    'read tcp4 192.168.50.50:54977->72.21.17.66:443: wsarecv: De externe host heeft een verbinding verbroken.',
    'write tcp 10.0.0.2:5555->1.2.3.4:443: wsasend: broken',
  ]) {
    assert.ok(d.isConnectionDrop(msg, ''), msg);
    assert.ok(!d.isNotFound(msg, msg), msg);
  }
});

test('a plain HTTP answer to a secure request is its own case', () => {
  const m = 'Failed to copyurl: Get "https://dl.example/dl": http: server gave HTTP response to HTTPS client';
  assert.ok(d.isHttpOnHttps(m, ''));
  assert.ok(!d.isNotFound(m, m));
});

test('a dead local proxy is recognised and is not "not found"', () => {
  const m = 'Failed to copyurl: Get "https://endeavour.whatbox.ca:44443/dl?…": proxyconnect tcp: dial tcp4 0.0.0.0:0->127.0.0.1:18092: connectex: No connection could be made because the target machine actively refused it.';
  assert.ok(d.isDeadProxy(m, ''));
  assert.ok(!d.isNotFound(m, ''));
  assert.ok(!d.isDeadProxy('Failed to copyurl: read tcp: connectex: refused', ''));
});

test('withoutProxyEnv drops proxy variables only', () => {
  const out = d.withoutProxyEnv({ HTTPS_PROXY: 'http://127.0.0.1:18092', http_proxy: 'x', ALL_PROXY: 'y', PATH: 'p', NO_PROXY: 'z' });
  assert.deepStrictEqual(out, { PATH: 'p', NO_PROXY: 'z' });
  assert.ok(d.hasProxyEnv({ https_proxy: 'x' }));
  assert.ok(!d.hasProxyEnv({ PATH: 'p' }));
});
