const test = require('node:test'); const assert = require('node:assert');
const { engineReason } = require('../engineReason');
test('labels are short codes, never hosts or paths', () => {
  assert.equal(engineReason('read ECONNRESET'), 'econnreset');
  assert.equal(engineReason('connect ETIMEDOUT 203.0.113.9:44443'), 'etimedout');
  assert.equal(engineReason('HTTP 503'), 'http 503');
  assert.equal(engineReason('connection dropped'), 'dropped');
  assert.equal(engineReason('connection timed out'), 'timed out');
  assert.equal(engineReason('socket hang up'), 'hang up');
  assert.equal(engineReason(undefined).startsWith('other '), true);
});
test('HTTP/2 and Node error families get their own labels', () => {
  assert.equal(engineReason('Stream closed with error code NGHTTP2_REFUSED_STREAM'), 'nghttp2 refused stream');
  assert.equal(engineReason('ERR_HTTP2_STREAM_ERROR'), 'err http2 stream error');
  assert.equal(engineReason('Premature close'), 'premature close');
  assert.equal(engineReason('ERR_STREAM_PREMATURE_CLOSE'), 'err stream premature close');
  assert.equal(engineReason('Parse Error: Expected HTTP/'), 'bad response');
  assert.equal(engineReason('HPE_INVALID_CONSTANT'), 'hpe invalid constant');
  assert.equal(engineReason('The HTTP/2 session was closed (GOAWAY)'), 'h2 closed');
  assert.equal(engineReason('Client network socket disconnected before secure TLS connection'), 'tls');
});
test('an unknown message gets a stable fingerprint and never carries its text', () => {
  const a = engineReason('C:\\Users\\bob\\Games\\file.7z weird failure 4411');
  const b = engineReason('C:\\Users\\bob\\Games\\file.7z weird failure 9020');   // only the digits differ
  assert.match(a, /^other [0-9a-f]{6}$/);
  assert.equal(a, b);
  assert.ok(!/bob|users|file/i.test(a));
  assert.notEqual(a, engineReason('something else entirely'));
});
test('every label fits what the site accepts', () => {
  for (const m of ['ERR_HTTP2_STREAM_ERROR', 'NGHTTP2_REFUSED_STREAM', 'whatever', 'HTTP 502', 'Premature close']) assert.match(engineReason(m), /^[a-z0-9 ]{1,40}$/);
});
