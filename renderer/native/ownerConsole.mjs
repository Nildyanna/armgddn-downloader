// The owner console of the website, for the built-in window: the same typed commands, run through the app's own admin calls. Pure parts first
// (parse, help, formatting) so they are tested on their own; `runCommand` does the asking.
export const HELP = [
  'ACCESS LISTS',
  '  admins - show the admin lists',
  '  admin+ <id> / admin- <id> - add or remove a full admin',
  '  req+ <id> / req- <id> - add or remove a request admin',
  '  both+ <id> / both- <id> - add to or remove from both',
  '',
  'MODERATION',
  '  ban @user [reason] - ban the IPs of a member',
  '  ban <id> [reason] - ban by Telegram id',
  '  ban ip X.X.X.X [reason] - ban an IP',
  '  unban ip X.X.X.X - unban an IP',
  '  bans - list banned IPs',
  '  lookup @user / lookup id <id> - look a member up',
  '',
  'SYSTEM',
  '  reload / ro - reload the override file',
  '  help / ? - this list',
].join('\n');

const ID = /^\d{3,20}$/;

// "ban @pat spamming" -> { op: 'banUser', username: 'pat', reason: 'spamming' }; null when it is not a command we know.
export function parseCommand(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  const action = parts[0].toLowerCase();
  const rest = parts.slice(1);
  const idArg = (list, add) => (rest[0] ? { op: add ? 'accessAdd' : 'accessRemove', lists: list, id: rest[0] } : { op: 'usage', text: 'Usage: ' + action + ' <telegramId>' });
  if (['admins', 'adminlist', 'access'].includes(action)) return { op: 'access' };
  if (['admin+', 'adminadd'].includes(action)) return idArg(['channel'], true);
  if (['admin-', 'admindel', 'adminrm'].includes(action)) return idArg(['channel'], false);
  if (['req+', 'reqadd', 'request+'].includes(action)) return idArg(['request'], true);
  if (['req-', 'reqdel', 'reqrm', 'request-'].includes(action)) return idArg(['request'], false);
  if (['both+', 'bothadd'].includes(action)) return idArg(['channel', 'request'], true);
  if (['both-', 'bothdel', 'bothrm'].includes(action)) return idArg(['channel', 'request'], false);
  if (action === 'ban') {
    if (rest[0] && rest[0].toLowerCase() === 'ip' && rest[1]) return { op: 'banIp', ip: rest[1], reason: rest.slice(2).join(' ') };
    if (rest[0] && rest[0].startsWith('@')) return { op: 'banUser', username: rest[0].slice(1), reason: rest.slice(1).join(' ') };
    if (rest[0]) return { op: 'banUser', id: rest[0], reason: rest.slice(1).join(' ') };
    return { op: 'usage', text: 'Usage: ban @username [reason] OR ban ip 1.2.3.4 [reason] OR ban <telegramId> [reason]' };
  }
  if (action === 'unban') return rest[0] && rest[0].toLowerCase() === 'ip' && rest[1] ? { op: 'unbanIp', ip: rest[1] } : { op: 'usage', text: 'Usage: unban ip 1.2.3.4' };
  if (action === 'lookup') {
    if (rest[0] && rest[0].toLowerCase() === 'id' && rest[1]) return { op: 'lookup', id: rest[1] };
    if (rest[0]) return { op: 'lookup', username: rest[0].replace(/^@/, '') };
    return { op: 'usage', text: 'Usage: lookup @username OR lookup id <telegramId>' };
  }
  if (action === 'bans') return { op: 'bans' };
  if (['reload', 'ro', 'reload-overrides'].includes(action)) return { op: 'reload' };
  if (['ot', 'ownertoggle'].includes(action)) return { op: 'note', text: 'This window has no separate owner view to switch, so "ot" is not needed here.' };
  if (['help', '?'].includes(action)) return { op: 'help' };
  return { op: 'unknown', action };
}

const list = (a) => (Array.isArray(a) && a.length ? a.join(', ') : 'none');
export function formatAccess(data) {
  const e = (data && data.effective) || {};
  const ch = Array.isArray(e.channelAdminIds) ? e.channelAdminIds : [], rq = Array.isArray(e.requestAdminIds) ? e.requestAdminIds : [];
  return ['Full Admin (channel): ' + list(ch), 'Request Admin (request): ' + list(rq), 'Both: ' + list(ch.filter((x) => rq.includes(x))),
    'Channel-only: ' + list(ch.filter((x) => !rq.includes(x))), 'Request-only: ' + list(rq.filter((x) => !ch.includes(x)))].join('\n');
}
export function formatBans(data) {
  const b = (data && data.bannedIps) || {};
  const keys = Object.keys(b);
  if (!keys.length) return 'No IPs are currently banned.';
  return [keys.length + ' banned IP(s):', ...keys.map((ip) => '- ' + ip + ' - ' + (b[ip] && b[ip].username ? '@' + b[ip].username : (b[ip] && b[ip].telegramId) || 'manual') + ' (' + ((b[ip] && b[ip].reason) || 'no reason') + ')')].join('\n');
}
export function formatLookup(d) {
  d = d || {};
  return ['@' + (d.username || 'unknown'), 'ID: ' + d.telegramId, 'Last seen: ' + (d.lastSeen || 'never'), 'IPs: ' + list(d.ips), 'Banned IPs: ' + list(d.bannedIps), d.allIpsBanned ? 'ALL IPs BANNED' : ''].filter(Boolean).join('\n');
}

// The answer of an admin action as one line: what the site said, or why it did not work.
function said(r) {
  if (r && r.ok && r.data && r.data.cancelled) return 'Cancelled.';
  if (r && r.ok && r.data && r.data.success !== false) return r.data.message || 'Done.';
  throw new Error((r && r.error && r.error.message) || (r && r.data && r.data.error) || 'no answer');
}
async function got(api, kind, params) {
  const r = await api.adminGet(kind, params);
  if (!(r && r.ok)) throw new Error((r && r.error && r.error.message) || 'no answer');
  return r.data;
}

// Runs one typed command with the app's admin calls (`api` = window.nativeAPI) and returns the text to show.
export async function runCommand(api, input) {
  const c = parseCommand(input);
  if (!c) return '';
  switch (c.op) {
    case 'help': return HELP;
    case 'note': case 'usage': return c.text;
    case 'unknown': return 'Unknown command: ' + c.action + '\nType "help" for the commands.';
    case 'access': return formatAccess(await got(api, 'access'));
    case 'bans': return formatBans(await got(api, 'ipbans'));
    case 'lookup': return formatLookup(await got(api, 'lookup', c.id ? { telegramId: c.id } : { username: c.username }));
    case 'reload': return said(await api.adminDo('reloadOverrides', {}));
    case 'banIp': return said(await api.adminDo('banIp', { ip: c.ip, reason: c.reason }));
    case 'unbanIp': return said(await api.adminDo('unbanIp', { ip: c.ip }));
    case 'accessAdd': case 'accessRemove': {
      if (!ID.test(c.id)) return 'A Telegram id is digits only.';
      const out = [];
      for (const l of c.lists) out.push(said(await api.adminDo(c.op, { list: l, id: c.id })));
      return out.join('\n') + '\n' + formatAccess(await got(api, 'access'));
    }
    case 'banUser': {
      let id = c.id;
      if (c.username) {
        const who = await got(api, 'lookup', { username: c.username });
        id = who && who.telegramId;
        if (!id) return 'No member found with @' + c.username + '.';
      }
      if (!ID.test(String(id))) return 'A Telegram id is digits only.';
      return said(await api.adminDo('banUser', { telegramId: String(id), reason: c.reason }));
    }
    default: return '';
  }
}
