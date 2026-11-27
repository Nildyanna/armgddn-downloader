// "Send this problem to staff" on a failed download's card: when the button shows and what it says. Pure, so test/problemReport.test.js can check it.
// sentId: the report number the site gave for this download (0 if none); busy: a preview or send is in progress for it.
import { t as tr } from './i18n.mjs';
export function isFailedDownload(d) {
  const st = String((d && d.status) || '').toLowerCase();
  return st === 'error' || st === 'failed';
}

export function problemButton(d, sentId, busy) {
  if (!isFailedDownload(d)) return { show: false };
  const n = Number(sentId) || 0;
  if (n > 0) return { show: true, sent: true, disabled: true, label: tr('Sent to staff (report #{n})', { n }) };
  return { show: true, sent: false, disabled: !!busy, label: busy ? 'Getting the report ready...' : 'Send this problem to staff' };
}

// The lines of the "what will be sent" box, in the order the member reads them.
export function previewRows(p) {
  if (!p) return [];
  const e = p.engine || null;
  const engine = e ? [e.engine, e.outcome, e.endedBy && 'ended by ' + e.endedBy, e.failKind, e.streams ? e.streams + ' connection(s)' : ''].filter(Boolean).join(', ') : '';
  return [
    ['Title', p.title || ''],
    ['Error', p.error || '(no error text)'],
    ['App version', p.app || ''],
    ['System', p.os || ''],
    ['Files', p.files && p.files.total ? `${p.files.done} of ${p.files.total} done` : ''],
    ['Download engine', engine],
  ].filter(([, v]) => v);
}
