const test = require('node:test'); const assert = require('node:assert');
const { engineReason } = require('../engineReason');
test('labels are short codes, never hosts or paths', () => {
  assert.equal(engineReason('read ECONNRESET'), 'econnreset');
  assert.equal(engineReason('connect ETIMEDOUT 203.0.113.9:44443'), 'etimedout');
  assert.equal(engineReason('HTTP 503'), 'http 503');
  assert.equal(engineReason('connection dropped'), 'dropped');
  assert.equal(engineReason('connection timed out'), 'timed out');
  assert.equal(engineReason('socket hang up'), 'hang up');
  assert.equal(engineReason('C:\\Users\\bob\\file.7z weird'), 'other');
  assert.equal(engineReason(undefined), 'other');
});
