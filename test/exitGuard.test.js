const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../exitGuard');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eg-')), 'session-state.json');

test('a first launch, or one after a clean quit, counts no unclean exits', () => {
  const f = tmp();
  assert.strictEqual(guard.begin(f), 0);
  guard.markClean(f);
  assert.strictEqual(guard.begin(f), 0);
});

test('launches that never quit cleanly are counted one after another', () => {
  const f = tmp();
  assert.strictEqual(guard.begin(f), 0);      // launch 1, crashes
  assert.strictEqual(guard.begin(f), 1);      // launch 2 sees one unclean exit, crashes too
  assert.strictEqual(guard.begin(f), 2);      // launch 3 sees two in a row
});

test('one clean quit resets the count', () => {
  const f = tmp();
  guard.begin(f); guard.begin(f);
  guard.markClean(f);
  assert.strictEqual(guard.begin(f), 0);
});

test('a missing or damaged state file is treated as clean', () => {
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  assert.strictEqual(guard.begin(f), 0);
});
