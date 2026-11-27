// The in-app inbox (Nov 2026): copies of the request updates and watchlist notices the site sends on Telegram, so members no bot can reach
// still see them. The site keeps them 90 days (GET /api/inbox?since=<id>); these are the pure parts, tested in test/nativeInbox.test.js.

import { t as tr } from './i18n.mjs';
export const INBOX_POLL_MS = 2 * 60 * 1000;
export const INBOX_MAX = 200;

// Newest first, one copy per id; a later copy of an item (read on another PC) wins.
export function mergeInbox(have, incoming) {
  const byId = new Map();
  for (const it of [...(incoming || []), ...(have || [])]) {
    if (!it || !Number.isInteger(Number(it.id))) continue;
    const id = Number(it.id);
    if (!byId.has(id)) byId.set(id, { ...it, id });
  }
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, INBOX_MAX);
}

export const unreadCount = (items) => (items || []).filter((it) => it && !it.readAt).length;

// Items that should pop a desktop notification: unread and newer than the newest id this PC has already seen. The very first load only
// records where the member is (lastSeen null), so starting the app never shows a pile of old notices.
export function freshItems(incoming, lastSeen) {
  if (lastSeen == null) return [];
  return (incoming || []).filter((it) => it && !it.readAt && Number(it.id) > Number(lastSeen));
}

export function notificationFor(fresh) {
  if (!fresh || !fresh.length) return null;
  if (fresh.length === 1) return { title: 'ARMGDDN App', body: String(fresh[0].title || '').slice(0, 200) };
  return { title: 'ARMGDDN App', body: tr('You have {n} new messages in your inbox.', { n: fresh.length }) };
}

// Where clicking an item goes. A request update opens that request under Requests; a requester link (staff) goes through the request-link
// route (Admin > Requests for staff); a watchlist notice searches every section for the title it names.
export function inboxTarget(item) {
  if (!item) return null;
  const link = String(item.link == null ? '' : item.link).trim();
  if (item.kind === 'request' || item.kind === 'requester-link') {
    const id = Number(link);
    if (!Number.isInteger(id) || id < 1) return { view: 'requests' };
    return item.kind === 'request' ? { view: 'requests', id } : { view: 'request-link', id };
  }
  if (item.kind === 'watchlist') {
    const title = link.replace(/\s+v\d[\w.]*\s*(-ARMGDDN)?\s*$/i, '').replace(/\s*-ARMGDDN\s*$/i, '').trim();
    return title ? { view: 'library', query: title } : { view: 'library' };
  }
  return null;
}

// "When" in the list: today shows the time, older ones the date.
export function inboxWhen(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Is a title still in its library folder? listing: the files of the folder it came from. null = not known yet.
export function titleInListing(listing, name) {
  if (!Array.isArray(listing)) return null;
  const n = String(name || '').toLowerCase();
  return listing.some((f) => f && String(f.name || '').toLowerCase() === n);
}
