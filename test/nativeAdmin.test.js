const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('admin formatting helpers', async () => {
  const f = await import('../renderer/native/adminFormat.mjs');
  assert.equal(f.labelOf('globalStreamQueueLength'), 'Global Stream Queue Length'); assert.equal(f.labelOf('last_error'), 'Last Error');
  assert.equal(f.formatUptime(90 * 60000), '1h 30m'); assert.equal(f.formatUptime(26 * 3600000), '1d 2h'); assert.equal(f.formatUptime(-1), '');
  assert.equal(f.formatCell(null), ''); assert.equal(f.formatCell(true), 'Yes'); assert.equal(f.formatCell(12345), '12,345'); assert.equal(f.formatCell(['a', 'b']), 'a, b'); assert.equal(f.formatCell([{ a: 1 }, { b: 2 }]), '2 items');
  assert.ok(f.formatCell('x'.repeat(200)).endsWith('...') && f.formatCell('x'.repeat(200)).length === 90);
  assert.deepEqual(f.tableColumns([{ id: 1, name: 'a', meta: { x: 1 } }, { id: 2, extra: 'y', tags: ['t'] }]), ['id', 'name', 'extra', 'tags'], 'nested objects are skipped');
  assert.equal(f.tableColumns([{ a: 1, b: 2, c: 3 }], 2).length, 2);
  assert.deepEqual(f.adminTabs('owner', true).map((t) => t[0]), ['overview', 'system', 'activity', 'missing', 'ipbans', 'access', 'controls', 'queue', 'requests', 'audit']);
  assert.deepEqual(f.adminTabs('admin', false).map((t) => t[0]), ['overview']);
  assert.deepEqual(f.adminTabs('admin', true).map((t) => t[0]), ['overview', 'queue', 'requests', 'audit']);
  assert.deepEqual(f.adminTabs('user', false), []); assert.deepEqual(f.adminTabs(undefined, false), []);
  const cards = f.statCards({ uptimeMs: 3600000, overhead: { level: 'ok', eventLoopMeanMs: 3, eventLoopP99Ms: 9, rssMb: 410 }, concurrency: { activeTotalStreams: 12, maxGlobalRcloneStreams: 40, globalStreamQueueLength: 0, peaksSinceBoot: { globalStreamQueueLength: 5 } }, api: { uniqueDownloads: 99, auth: { success: 7, failure: 1 } } });
  assert.equal(cards.find((c) => c.label === 'Uptime').value, '1h 0m'); assert.equal(cards.find((c) => c.label === 'Active streams').hint, 'limit 40'); assert.equal(cards.find((c) => c.label === 'Logins').hint, '1 failed');
  assert.deepEqual(f.statCards(null), []);
  for (const a of ['resetQuota', 'restartServer', 'banIp', 'unbanIp', 'requestStatus', 'clearMissing']) { const c = f.confirmText(a, { ip: '1.2.3.4', id: 5, title: 'T', status: 'approved', gameKey: 'k' }); assert.ok(c && c.title && c.text && c.ok, a); }
  assert.equal(f.confirmText('somethingElse'), null);
  assert.ok(f.confirmText('banIp', { ip: '1.2.3.4' }).text.includes('1.2.3.4')); assert.ok(f.confirmText('requestStatus', { id: 5, title: 'Halo', status: 'rejected' }).text.includes('"rejected"'));
  const miss = { count: 2, trailerCount: 1, trailerUnavailableCount: 3, totalUniqueGames: 10, gamesWithStatus: [{ gameKey: 'PC1/Halo', cleanTitle: 'Halo', missingCover: true, missingTrailer: false }, { gameKey: 'PC1/Doom', cleanTitle: 'Doom', missingCover: false, missingTrailer: true }] };
  assert.equal(f.missingCards(miss)[1].hint, '3 marked unavailable'); assert.deepEqual(f.missingCards(null), []);
  assert.deepEqual(f.missingRows(miss, { what: 'cover' }).map((r) => r.title), ['Halo']); assert.deepEqual(f.missingRows(miss, { what: 'trailer' }).map((r) => r.title), ['Doom']);
  assert.deepEqual(f.missingRows(miss, { query: 'do' }).map((r) => r.title), ['Doom']); assert.equal(f.missingRows(miss).length, 2); assert.equal(f.missingRows(null).length, 0);
  assert.deepEqual(f.remoteRows({ remotes: [{ name: 'PC-1', status: 'healthy', lastStatusAt: null, errorDetail: { failureCount: 2 } }] }), [{ name: 'PC-1', status: 'healthy', lastChecked: '', lastError: '', failures: 2 }]);
  const reqs = [{ id: 1, gameTitle: 'A', username: 'u', status: 'pending', createdAt: 'x', popularity: 3 }, { id: 2, gameTitle: 'B', status: 'completed', processedBy: 'dmp', processedAt: 'y' }, { id: 3, gameTitle: 'C', linkedTo: 1, processedBy: 'dmp' }];
  assert.equal(f.requestRows(reqs).length, 2, 'merged duplicates are not listed twice');
  assert.deepEqual(f.requestRows(reqs, { audit: true }).map((r) => r.id), [2]); assert.equal(f.requestRows(reqs, { audit: true, processedBy: 'nobody' }).length, 0);
});

test('admin actions are a fixed list, validated, each behind a confirmation, and only for owners and admins', () => {
  const bridge = read('native', 'bridge.js'), app = read('renderer', 'native', 'app.mjs'), view = read('renderer', 'native', 'admin.mjs');
  const block = bridge.slice(bridge.indexOf('const ADMIN_GET'), bridge.indexOf("// The publisher collections"));
  for (const route of ['/api/admin/stats', '/api/admin/system-details', '/api/admin/user-activity', '/api/admin/queue', '/api/admin/requests', '/api/admin/missing-covers']) assert.ok(block.includes("'" + route + "'"), route);
  assert.ok(block.includes('Unknown admin page') && block.includes('A-Za-z_ -'));
  const acts = bridge.slice(bridge.indexOf("ipcMain.handle('native:adminDo'"), bridge.indexOf("// The publisher collections"));
  for (const a of ['resetQuota', 'restartServer', 'banIp', 'unbanIp', 'requestStatus', 'clearMissing']) assert.ok(acts.includes("case '" + a + "'"), a);
  assert.ok(acts.includes('Unknown admin action') && acts.includes('A-Fa-f') || acts.includes('a-fA-F'));
  assert.ok(!/api\.(put|del)\(/.test(acts) && !acts.includes('/api/admin/requests/' + '${id}`)' + ', {}'), 'no delete or free-form write');
  assert.ok(view.includes('useAdminAction') && view.includes('confirmText(') && view.includes('api.adminDo('), 'every action goes through the confirmation');
  assert.ok(!/api\.adminDo\(/.test(view.replace(/const r = await api\.adminDo\(p\.action, p\.args\);/, '')), 'adminDo is only called from the confirmation step');
  assert.ok(app.includes("a.data.role === 'owner' || a.data.role === 'admin'") && app.includes("view === 'admin' && admin"), 'the tab and the page need the role the site reported');
  assert.ok(view.includes('export function AdminView') && view.includes('adminTabs('));
  assert.ok(read('preload-native.js').includes("adminGet: call('native:adminGet')"));
});
