const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const guard = require('../pipeGuard');

test('a closed stdout or stderr no longer raises an uncaught error', () => {
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  assert.strictEqual(guard.install(proc), 2);
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  assert.doesNotThrow(() => proc.stdout.emit('error', epipe));    // with a listener attached, an emitted error is handled and nothing throws
  assert.doesNotThrow(() => proc.stderr.emit('error', epipe));
});

test('other stream errors are not hidden', () => {
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  guard.install(proc);
  const real = global.setImmediate;
  let deferred = null;
  global.setImmediate = (fn) => { deferred = fn; };
  try {
    proc.stdout.emit('error', Object.assign(new Error('disk on fire'), { code: 'EOTHER' }));
  } finally { global.setImmediate = real; }
  assert.ok(deferred, 'the error is rethrown on the next tick');
  assert.throws(deferred, /disk on fire/);
});

test('missing streams are skipped, and the Sentry filter recognises the write failure', () => {
  assert.strictEqual(guard.install({}), 0);
  assert.ok(guard.isClosedOutputError({ exception: { values: [{ type: 'Error', value: 'write EPIPE' }] } }));
  assert.ok(!guard.isClosedOutputError({ exception: { values: [{ type: 'Error', value: 'ECONNRESET' }] } }));
  assert.ok(!guard.isClosedOutputError({}));
});
