const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildRunner } = require('../updateRunner');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// 5.21.0: the History "Check for game updates" button reused the id of the app-update button, so getElementById found the other one and
// the History button never did anything.
test('every id in index.html is used once', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual([...new Set(dupes)], []);
});

test('the buttons the renderer wires up exist in the page', () => {
  for (const id of ['check-game-updates-btn', 'game-updates-result', 'connection-test-btn', 'connection-test-note', 'schedule-enabled', 'schedule-banner', 'connections-per-file']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes("getElementById('check-game-updates-btn')"));
});

// The install window's bar is a Marquee bar; Windows draws it frozen unless visual styles are on.
test('the install progress bar is set up to animate', () => {
  const script = buildRunner({ pid: 1, filePath: 'C:\\x.exe', appExe: 'C:\\a.exe', wrapperLogPath: 'C:\\l.log', resultPath: 'C:\\r.json', silentArg: '/S', shouldRelaunch: true, shortcut: '' });
  assert.ok(script.includes('EnableVisualStyles()'));
  assert.ok(script.includes('MarqueeAnimationSpeed'));
  assert.ok(script.indexOf('EnableVisualStyles') < script.indexOf('New-Object System.Windows.Forms.Form'));
});
