const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');

test('inbox items merge newest first, one copy per id', async () => {
  const { mergeInbox, unreadCount } = await import('../renderer/native/inbox.mjs');
  const have = [{ id: 2, title: 'b', readAt: null }, { id: 1, title: 'a', readAt: '2026-11-25T10:00:00Z' }];
  const next = mergeInbox(have, [{ id: 3, title: 'c', readAt: null }, { id: 2, title: 'b', readAt: '2026-11-25T11:00:00Z' }, null, { id: 'x' }]);
  assert.deepEqual(next.map((i) => i.id), [3, 2, 1]);
  assert.equal(next[1].readAt, '2026-11-25T11:00:00Z');          // the newer copy (read on another PC) wins
  assert.equal(unreadCount(next), 1);
  assert.equal(unreadCount(null), 0);
  assert.equal(mergeInbox([], Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }))).length, 200);
});

test('desktop notifications: only unread items newer than what this PC has seen, never on the first load', async () => {
  const { freshItems, notificationFor } = await import('../renderer/native/inbox.mjs');
  const items = [{ id: 7, title: 'Reach is now in the library', readAt: null }, { id: 6, title: 'old', readAt: null }, { id: 8, title: 'read', readAt: 'x' }];
  assert.deepEqual(freshItems(items, null), []);
  assert.deepEqual(freshItems(items, 6).map((i) => i.id), [7]);
  assert.deepEqual(notificationFor(freshItems(items, 6)), { title: 'ARMGDDN App', body: 'Reach is now in the library' });
  assert.match(notificationFor([{ id: 1 }, { id: 2 }]).body, /2 new messages/);
  assert.equal(notificationFor([]), null);
});

test('clicking an item: a request opens that request, a requester link goes through the staff route, a watchlist notice searches the title', async () => {
  const { inboxTarget } = await import('../renderer/native/inbox.mjs');
  assert.deepEqual(inboxTarget({ kind: 'request', link: '42' }), { view: 'requests', id: 42 });
  assert.deepEqual(inboxTarget({ kind: 'request', link: 'nope' }), { view: 'requests' });
  assert.deepEqual(inboxTarget({ kind: 'requester-link', link: '9' }), { view: 'request-link', id: 9 });
  assert.deepEqual(inboxTarget({ kind: 'watchlist', link: 'Reach v22888515 -ARMGDDN' }), { view: 'library', query: 'Reach' });
  assert.deepEqual(inboxTarget({ kind: 'watchlist', link: 'Half-Life Alyx v1.5 -ARMGDDN' }), { view: 'library', query: 'Half-Life Alyx' });
  assert.deepEqual(inboxTarget({ kind: 'watchlist', link: null }), { view: 'library' });
  assert.equal(inboxTarget({ kind: 'notice' }), null);
  assert.equal(inboxTarget(null), null);
});

test('a title is checked against its folder; unknown until the folder has loaded', async () => {
  const { titleInListing, inboxWhen } = await import('../renderer/native/inbox.mjs');
  assert.equal(titleInListing(null, 'A'), null);
  assert.equal(titleInListing([{ name: 'Reach v1 -ARMGDDN' }], 'reach v1 -armgddn'), true);
  assert.equal(titleInListing([{ name: 'Other' }], 'Reach v1 -ARMGDDN'), false);
  assert.equal(inboxWhen('nope'), '');
  assert.ok(inboxWhen('2026-01-02T10:00:00Z', new Date('2026-11-25T10:00:00Z')).length > 0);
});

test('bridge: the poll address takes only a number, mark-read only ids or all', () => {
  const { inboxPath, inboxReadBody } = require('../native/bridge');
  assert.equal(inboxPath(0), '/api/inbox');
  assert.equal(inboxPath(15), '/api/inbox?since=15');
  assert.equal(inboxPath('15&x=1'), '/api/inbox');
  assert.equal(inboxPath(-3), '/api/inbox');
  assert.deepEqual(inboxReadBody('all'), { all: true });
  assert.deepEqual(inboxReadBody([3, '4', 'x', -1]), { ids: [3, 4] });
  assert.deepEqual(inboxReadBody(5), { ids: [5] });
  assert.throws(() => inboxReadBody(['x']));
});

test('the page wires the inbox: bell with unread badge, two-minute poll and focus, both cleaned up, notifications through the main process', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/native/app.mjs'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'native/bridge.js'), 'utf8');
  const pre = fs.readFileSync(path.join(root, 'preload-native.js'), 'utf8');
  for (const piece of ["setView('inbox')", 'unreadCount(inbox)', 'setInterval(pollInbox, INBOX_POLL_MS)', "window.addEventListener('focus', onFocus)",
    'clearInterval(every); window.removeEventListener(\'focus\', onFocus)', '<${InboxView}', 'api.inboxNotify(', 'markInbox([it.id])', 'setPendingReq(t.id)', 'setOpenRequest(t.id']) {
    assert.ok(app.includes(piece), piece);
  }
  for (const ch of ['native:inbox', 'native:inboxRead', 'native:inboxNotify']) { assert.ok(bridge.includes(`ipcMain.handle('${ch}'`), ch); assert.ok(pre.includes(`call('${ch}')`), ch); }
  // the desktop notification goes through the finished-download helper, which honours Settings > Show notifications
  assert.ok(fs.readFileSync(path.join(root, 'main.js'), 'utf8').includes('notify: (title, body) => showDownloadNotification(title, body)'));
  assert.ok(INBOX_POLL_OK());
  function INBOX_POLL_OK() { return /INBOX_POLL_MS = 2 \* 60 \* 1000/.test(fs.readFileSync(path.join(root, 'renderer/native/inbox.mjs'), 'utf8')); }
});

test('Notify me: on a title that is not in the library, and on a search with no match, with the arrival promise', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/native/app.mjs'), 'utf8');
  assert.ok(app.includes('titleInListing(r.data.files, item.name)'));
  assert.ok(app.includes('${missing ? notifyBtn :'), 'Download becomes Notify me when the title is gone');
  assert.ok(app.includes("We'll tell you when it arrives."));
  assert.ok(app.includes('>Notify me</button>'));
  assert.ok(!/Companion/.test(app.match(/function InboxView[\s\S]*?\n}\n/)[0]), 'members never see the internal name');
});
