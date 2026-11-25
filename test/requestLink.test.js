// A request link (armgddn://request/<id>, from Tulip's request notices via the site's hand-off page): staff who handle requests get
// Admin > Requests with that request open; everyone else their own Requests tab. Nov 25 2026.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('findRequestRow: the request itself, or the one a duplicate was merged into', async () => {
  const f = await import('../renderer/native/adminFormat.mjs');
  const list = [{ id: 900, gameTitle: 'A' }, { id: 917, gameTitle: 'B' }, { id: 918, gameTitle: 'B', linkedTo: 917 }];
  assert.equal(f.findRequestRow(list, 917).id, 917);
  assert.equal(f.findRequestRow(list, '917').id, 917, 'id from a link may be text');
  assert.equal(f.findRequestRow(list, 918).id, 917, 'merged duplicate opens the main request');
  assert.equal(f.findRequestRow(list, 5), null);
  assert.equal(f.findRequestRow(null, 5), null);
});

test('the window routes a request link by role, after sign-in has loaded', () => {
  const app = read('renderer', 'native', 'app.mjs');
  assert.ok(app.includes("if (m && m.view === 'requests') { setPendingReq(m.id); }"));
  assert.ok(app.includes("if (admin && admin.canManage) { setAdminStart({ tab: 'requests', n: Date.now(), openId: pendingReq }); setView('admin'); }"));
  assert.ok(app.includes('setRolesKnown(true);') && app.indexOf('setRolesKnown(true);') > app.indexOf('setStaffOk(staffNow);'));
  assert.ok(app.includes('initialTab=${adminStart.tab} openId=${adminStart.openId}'));
  const admin = read('renderer', 'native', 'admin.mjs');
  assert.ok(admin.includes('function RequestsPage({ audit, owner, openId })') && admin.includes('findRequestRow(st.data.requests, openId)'));
  // hooks before the early return, or the page breaks when the list arrives
  assert.ok(admin.indexOf('findRequestRow(st.data.requests, openId)') < admin.indexOf("if (!st.data) return html`<${Status} state=${st} onRetry=${reload} />`;\n  const all = requestRows"));
});

test('main process waits for the window before opening a request', () => {
  const dl = read('main', 'deepLinks.js');
  assert.ok(dl.includes('openRequestWhenReady(rid, Date.now() + 30000)'));
  assert.ok(dl.includes("w.webContents.send('native:open', { view: 'requests', id: rid })"));
  assert.ok(/process\.platform === 'linux'\) \{ try \{ w\.moveTop\(\)/.test(dl), 'Linux raises with moveTop, never focus');
});
