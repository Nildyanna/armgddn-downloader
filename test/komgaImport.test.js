const { test } = require('node:test'); const assert = require('node:assert');
const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { decryptV10, unwrapProfileKey, readInstalledKomga } = require('../komgaImport');

const seal = (text, key) => { const n = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, n); const d = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([Buffer.from('v10'), n, d, c.getAuthTag()]); };
const tmpProfile = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kgi-'));

test('a v10 value is opened with the profile key, and a wrong key or a damaged value is refused', () => {
  const key = crypto.randomBytes(32);
  const sealed = seal('secret-api-key-123', key);
  assert.equal(decryptV10(sealed, key), 'secret-api-key-123');
  assert.throws(() => decryptV10(sealed, crypto.randomBytes(32)));
  const bad = Buffer.from(sealed); bad[20] ^= 1; assert.throws(() => decryptV10(bad, key));
  assert.throws(() => decryptV10(Buffer.from('v11xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), key), /not a v10/);
});

test('the profile key comes from Local State through the Windows unwrap, and bad input is refused', async () => {
  const dir = tmpProfile(); const aes = crypto.randomBytes(32);
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped-blob')]).toString('base64') } }));
  let seenScript = '';
  const run = (cmd, args, opts, cb) => { seenScript = args[args.length - 1]; cb(null, aes.toString('base64') + '\r\n'); };
  assert.ok((await unwrapProfileKey(dir, run)).equals(aes));
  assert.match(seenScript, /Unprotect/); assert.ok(seenScript.includes(Buffer.from('wrapped-blob').toString('base64')));
  await assert.rejects(unwrapProfileKey(dir, (c, a, o, cb) => cb(new Error('boom'))), /unlock/);
  await assert.rejects(unwrapProfileKey(dir, (c, a, o, cb) => cb(null, 'AAAA')), /key size/);
  const empty = tmpProfile(); await assert.rejects(unwrapProfileKey(empty, run), /no saved encryption key/);
});

test('a plain (unencrypted) saved key is read as is; a missing file says so', async () => {
  const dir = tmpProfile();
  fs.writeFileSync(path.join(dir, 'komga.json'), JSON.stringify({ url: 'http://localhost:25600', enc: false, key: 'plain-key' }));
  assert.deepEqual(await readInstalledKomga(dir), { url: 'http://localhost:25600', key: 'plain-key' });
  await assert.rejects(readInstalledKomga(tmpProfile()), /no saved Komga key/);
});

test('an encrypted saved key is opened end to end (Windows unwrap stubbed)', { skip: process.platform !== 'win32' && 'the encrypted path is Windows only' }, async () => {
  const dir = tmpProfile(); const aes = crypto.randomBytes(32);
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('x')]).toString('base64') } }));
  fs.writeFileSync(path.join(dir, 'komga.json'), JSON.stringify({ url: 'http://nas:25600', enc: true, key: seal('the-real-key', aes).toString('base64') }));
  const out = await readInstalledKomga(dir, (c, a, o, cb) => cb(null, aes.toString('base64')));
  assert.deepEqual(out, { url: 'http://nas:25600', key: 'the-real-key' });
});
