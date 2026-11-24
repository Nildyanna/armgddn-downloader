const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('Home cards (Hidden Gems and the other strips) say whether a title is PC or PCVR', async () => {
  const f = await import('../renderer/native/format.mjs');
  assert.equal(f.homeItem({ remote: 'PC-2', path: 'Halo', total: 3 })._remote, 'PC Games');
  assert.equal(f.homeItem({ remote: 'PCVR-2', path: 'Half-Life Alyx', total: 3 })._remote, 'PCVR Games');
  const app = read('renderer', 'native', 'app.mjs');
  const homeRender = app.slice(app.indexOf('onOpenTrend=${openTrend} render='), app.indexOf('onOpenTrend=${openTrend} render=') + 700);
  assert.ok(homeRender.includes("platform=${it._remote === 'PCVR Games' ? 'PCVR' : it._remote === 'PC Games' ? 'PC' : ''}"), 'only the Home cards pass the platform');
  assert.equal(app.split("platform=${it._remote === 'PCVR Games'").length - 1, 1, 'library and search cards are unchanged');
  // the badge sits beside the title text (never inside the clamped text, where a long title such as Transformers - Fall of Cybertron hid it)
  assert.ok(app.includes('<span class="ttext">${shownTitle}${badgeEl}</span>${platformEl}'));
  assert.ok(app.includes('</span>${platformEl}'));
  assert.ok(read('renderer', 'native', 'native.css').includes('.title.withp'));
  assert.ok(read('renderer', 'native', 'native.css').includes('.pbadge.pcvr'));
});

test('the 3D Printer Models section says that missing covers are expected', () => {
  const app = read('renderer', 'native', 'app.mjs');
  assert.ok(app.includes("remote === '3D Printer Models'") && app.includes('Missing covers in this section are expected and are not a bug'));
});

test('Back remembers the scroll position and filters, and there is a Forward button', () => {
  const app = read('renderer', 'native', 'app.mjs');
  assert.ok(app.includes('scrollMemo') && app.includes('extraMemo') && app.includes('const goForward'));
  assert.ok(app.includes('Forward \\u2192') && app.includes("e.altKey && e.key === 'ArrowRight'") && app.includes('e.button === 4'));
  assert.ok(app.includes('fwdStack.current = []'));
});

test('clicking a folder card name opens its page, and the window is titled ARMGDDN App', () => {
  const app = read('renderer', 'native', 'app.mjs');
  assert.ok(app.includes("(item.isDir ? ' clickable' : '')} data-kbd=\"card\" onClick=${item.isDir ? () => onOpen(item) : undefined}"));
  assert.ok(read('renderer', 'native', 'index.html').includes('<title>ARMGDDN App</title>'));
});
