'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('typed commands become the right action', async () => {
  const { parseCommand: p } = await import('../renderer/native/ownerConsole.mjs');
  assert.deepEqual(p('admins'), { op: 'access' });
  assert.deepEqual(p('both+ 12345'), { op: 'accessAdd', lists: ['channel', 'request'], id: '12345' });
  assert.deepEqual(p('req- 999'), { op: 'accessRemove', lists: ['request'], id: '999' });
  assert.deepEqual(p('ban @Pat spamming links'), { op: 'banUser', username: 'Pat', reason: 'spamming links' });
  assert.deepEqual(p('ban 777123'), { op: 'banUser', id: '777123', reason: '' });
  assert.deepEqual(p('ban ip 1.2.3.4 bot'), { op: 'banIp', ip: '1.2.3.4', reason: 'bot' });
  assert.deepEqual(p('lookup id 5551'), { op: 'lookup', id: '5551' });
  assert.deepEqual(p('lookup @kim'), { op: 'lookup', username: 'kim' });
  assert.equal(p('ro').op, 'reload');
  assert.equal(p('ot').op, 'note');
  assert.equal(p('nonsense').op, 'unknown');
  assert.equal(p('unban').op, 'usage');
  assert.equal(p('   '), null);
});

test('a ban by @name looks the member up first and refuses digits that are not an id', async () => {
  const { runCommand } = await import('../renderer/native/ownerConsole.mjs');
  const calls = [];
  const api = {
    adminGet: async (k, a) => { calls.push(['get', k, a]); return { ok: true, data: { telegramId: '4242' } }; },
    adminDo: async (k, a) => { calls.push(['do', k, a]); return { ok: true, data: { success: true, message: 'Banned.' } }; },
  };
  assert.equal(await runCommand(api, 'ban @pat spam'), 'Banned.');
  assert.deepEqual(calls, [['get', 'lookup', { username: 'pat' }], ['do', 'banUser', { telegramId: '4242', reason: 'spam' }]]);
  assert.match(await runCommand(api, 'admin+ 12'), /digits only/);
});

test('a cancelled confirmation and a refusal are reported plainly', async () => {
  const { runCommand } = await import('../renderer/native/ownerConsole.mjs');
  assert.equal(await runCommand({ adminDo: async () => ({ ok: true, data: { cancelled: true } }) }, 'unban ip 1.2.3.4'), 'Cancelled.');
  await assert.rejects(() => runCommand({ adminDo: async () => ({ ok: false, error: { message: 'Owner only' } }) }, 'ro'), /Owner only/);
});

test('the access lists are shown with who is on both', async () => {
  const { formatAccess } = await import('../renderer/native/ownerConsole.mjs');
  const t = formatAccess({ effective: { channelAdminIds: [1, 2], requestAdminIds: [2, 3] } });
  assert.match(t, /Both: 2/); assert.match(t, /Channel-only: 1/); assert.match(t, /Request-only: 3/);
});
