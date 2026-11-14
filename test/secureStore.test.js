const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

// Load secureStore.js against a fake Electron safeStorage with only the methods the scenario's Electron version has.
function load(fake) {
  const file = path.join(__dirname, '..', 'secureStore.js');
  delete require.cache[require.resolve(file)];
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { safeStorage: fake };
    return orig.call(this, request, ...rest);
  };
  try { return require(file); } finally { Module._load = orig; }
}

const enc = (s) => Buffer.from('ENC:' + s);
const dec = (b) => b.toString().replace(/^ENC:/, '');
const syncApi = () => ({ isEncryptionAvailable: () => true, encryptString: enc, decryptString: dec });
const asyncApi = () => ({ isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (s) => enc(s), decryptStringAsync: async (b) => dec(b) });

test('Electron 44: only the synchronous methods exist, and the async helpers use them', async () => {
  const s = load(syncApi());
  assert.strictEqual(s.hasAsync, false);
  assert.strictEqual(s.syncAvailable, true);
  assert.strictEqual(await s.isAvailable(), true);
  assert.strictEqual(await s.decrypt(await s.encrypt('token-1')), 'token-1');
  assert.strictEqual(s.decryptSync(s.encryptSync('t2')), 't2');
});

test('Electron 45: both exist, the async methods are preferred', async () => {
  let asyncCalls = 0;
  const fake = Object.assign(syncApi(), asyncApi(), { encryptStringAsync: async (x) => { asyncCalls++; return enc(x); } });
  const s = load(fake);
  assert.strictEqual(s.hasAsync, true);
  assert.strictEqual(s.syncAvailable, true);
  assert.strictEqual(dec(await s.encrypt('abc')), 'abc');
  assert.strictEqual(asyncCalls, 1);
});

test('Electron 46: the synchronous methods are gone, nothing breaks, data from the sync era still decrypts', async () => {
  const s = load(asyncApi());
  assert.strictEqual(s.syncAvailable, false);
  assert.strictEqual(s.isAvailableSync(), false);
  assert.strictEqual(await s.isAvailable(), true);
  const old = enc('written-by-an-older-version').toString('base64');          // a file saved by the synchronous API
  assert.strictEqual(await s.decrypt(Buffer.from(old, 'base64')), 'written-by-an-older-version');
});

test('no usable safeStorage at all: not available, and encrypt/decrypt refuse instead of returning garbage', async () => {
  const s = load({});
  assert.strictEqual(await s.isAvailable(), false);
  await assert.rejects(() => s.encrypt('x'));
  await assert.rejects(() => s.decrypt(Buffer.from('x')));
});
