'use strict';
// The support line added to error messages (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');

function withSupportFooter(message, fix) {
  try {
    const msg = String(message || '').trim();
    const fixText = String(fix || '').trim();
    const fixLine = fixText ? `Most likely fix: ${fixText}` : '';
    const supportLine = `If that doesn't help, contact support on Telegram: ${ctx.SUPPORT_TELEGRAM_URL}`;
    return [msg, fixLine, supportLine].filter(Boolean).join('\n');
  } catch (e) {
    return String(message || '');
  }
}

module.exports = { withSupportFooter };
