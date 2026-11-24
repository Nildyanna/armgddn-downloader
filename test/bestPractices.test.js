'use strict';
// Guards for docs/BEST_PRACTICES.md (Nov 24 2026). Each test is one rule from that checklist, checked in the source so a change that breaks
// it fails here before a release. Rules that need a real page (contrast, focus order) are in tools/preview/page-check.js instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['renderer/native/app.mjs', 'renderer/native/admin.mjs', 'renderer/native/ownerConsole.mjs', 'renderer/native/ownerDock.mjs'].filter((f) => fs.existsSync(path.join(ROOT, f)));

// The text of each `<tag ...>` in a page module (htm templates), with the file and line, so a failure says where.
function tags(name) {
  const out = [];
  for (const f of PAGES) {
    const src = read(f);
    const re = new RegExp('<' + name + '\\b', 'g');
    let m;
    while ((m = re.exec(src))) {
      // up to the end of the opening tag: the first '>' that is not inside ${...}
      let depth = 0, i = m.index + 1;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '{' && src[i - 1] === '$') depth++;
        else if (c === '{' && depth) depth++;
        else if (c === '}' && depth) depth--;
        else if (c === '>' && !depth) break;
      }
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      out.push({ file: f, line: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1), before });
    }
  }
  return out;
}
const where = (t) => t.file + ':' + t.line;

test('Security: every window has context isolation, no Node in the page, the sandbox, and cannot open windows by itself', () => {
  for (const f of ['main.js', 'native/bridge.js']) {
    const src = read(f);
    const re = /(\w+)\s*=\s*new BrowserWindow\(\{/g;
    let m, n = 0;
    while ((m = re.exec(src))) {
      n++;
      const name = m[1];
      const body = src.slice(m.index, src.indexOf('\n  });', m.index) > 0 ? Math.min(src.indexOf('});', m.index + 40) + 3, m.index + 2500) : m.index + 2500);
      const opts = src.slice(m.index, m.index + 2500);
      for (const need of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true']) assert.ok(opts.includes(need), f + ': window ' + name + ' is missing ' + need);
      const after = src.slice(m.index, m.index + 4000);
      assert.ok(new RegExp('denyNewWindows\\(' + name + '\\b|' + name + '\\.webContents\\.setWindowOpenHandler').test(after), f + ': window ' + name + ' can open new windows (call denyNewWindows)');
      void body;
    }
    assert.ok(n > 0, 'no windows found in ' + f + ' (the check is broken)');
  }
});

test('Security: the app page keeps a content security policy with no inline scripts', () => {
  const html = read('renderer/native/index.html');
  const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  assert.ok(csp, 'index.html has no CSP');
  const script = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert.ok(script && !/unsafe-inline|unsafe-eval/.test(script), 'script-src must not allow inline or eval: ' + script);
  assert.ok(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp));
});

test('Accessibility: every picture has alt text (alt="" for decoration)', () => {
  const bad = tags('img').filter((t) => !/\balt=/.test(t.text));
  assert.deepStrictEqual(bad.map(where), []);
});

test('Accessibility: every text box, menu and checkbox has a label', () => {
  const bad = [...tags('input'), ...tags('select'), ...tags('textarea')].filter((t) => {
    if (/type="hidden"/.test(t.text)) return false;
    if (/aria-label=|aria-labelledby=|\btitle=/.test(t.text)) return false;
    const open = t.before.lastIndexOf('<label'), close = t.before.lastIndexOf('</label>');
    return !(open >= 0 && open > close);            // inside a <label>
  });
  assert.deepStrictEqual(bad.map(where), []);
});

test('Accessibility: every button has a name (text, or aria-label / title when it shows only a symbol)', () => {
  const bad = tags('button').filter((t) => {
    if (/aria-label=|\btitle=/.test(t.text)) return false;
    const src = read(t.file);
    const start = src.indexOf(t.text, 0);
    const rest = src.slice(src.indexOf(t.text) + t.text.length, src.indexOf(t.text) + t.text.length + 200);
    const inner = rest.slice(0, rest.indexOf('</button>'));
    void start;
    return !/[A-Za-z]{2}|\$\{/.test(inner);           // no words and nothing computed inside
  });
  assert.deepStrictEqual(bad.map(where), []);
});

test('Accessibility: nothing is click-only. A div, span or img with onClick also has tabIndex (or is a backdrop that closes a window)', () => {
  const bad = [...tags('div'), ...tags('span'), ...tags('img'), ...tags('li')].filter((t) => /\bonClick=/.test(t.text)
    && !/tabIndex=|tabindex=/.test(t.text)
    && !/data-kbd="card"/.test(t.text)          // inside a card that has tabIndex and answers Enter itself
    && !/class="overlay"|stopPropagation\(\)\s*\}?\s*>?$|onClick=\$\{\(e\) => e\.stopPropagation\(\)\}/.test(t.text)
    && !/onClick=\$\{\(e\) => e\.stopPropagation\(\)\}/.test(t.text));
  assert.deepStrictEqual(bad.map(where), []);
});

test('Accessibility: progress bars say what they show', () => {
  const bars = tags('div').filter((t) => /class="bar"/.test(t.text));
  assert.ok(bars.length > 0);
  for (const t of bars) assert.ok(/role="progressbar"/.test(t.text) && /aria-valuenow=/.test(t.text), where(t) + ' is a progress bar without role="progressbar" and aria-valuenow');
});

test('Accessibility: animations stop for people who ask for less motion', () => {
  const css = ['renderer/native/native.css', 'renderer/native/themes-custom.css', 'renderer/native/themes.css'].map(read).join('\n');
  assert.ok(/prefers-reduced-motion/.test(css));
});

test('Performance: no single page file over 1.5 MB (it is loaded into every window and copied into every install)', () => {
  const big = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.statSync(p).size > 1.5e6) big.push(path.relative(ROOT, p)); } };
  walk(path.join(ROOT, 'renderer'));
  assert.deepStrictEqual(big, []);
});

test('Performance: every font face says how to show text while it loads (font-display)', () => {
  const css = read('renderer/native/fonts.css');
  assert.strictEqual((css.match(/@font-face/g) || []).length, (css.match(/font-display/g) || []).length);
});

test('Privacy: crash reports need the member\'s answer, asked once, before or after an update', () => {
  const app = read('renderer/native/app.mjs');
  assert.ok(app.includes('ErrorReportingAsk'), 'the question component is missing');
  const main = read('main.js');
  assert.ok(/errorReportingAsked/.test(main), 'the "already answered" flag is missing from the settings');
});

test('Housekeeping: no retired project left in the repo (the old mobile/ folder carried 22 security alerts)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'mobile', 'package.json')));
});
