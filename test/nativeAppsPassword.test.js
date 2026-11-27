'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'renderer/native/app.mjs'), 'utf8');

test('Copy PW is offered on the PC Apps notice only (games never have a password)', () => {
  const asks = app.match(/ask\(\{[^\n]*\}\)/g) || [];
  const withPw = asks.filter((a) => a.includes('copyPw: true'));
  assert.equal(withPw.length, 1, 'exactly one notice offers Copy PW');
  assert.ok(withPw[0].includes('DOWNLOADING PC APPS'), 'and it is the PC Apps notice');
  assert.ok(!asks.find((a) => a.includes('DOWNLOADING THE GAME') && a.includes('copyPw')), 'the game README never offers it');
});

test('the copied password matches the one extraction uses', () => {
  const extract = fs.readFileSync(path.join(__dirname, '..', 'main/extract.js'), 'utf8');
  const used = (extract.match(/const password = '([^']+)'/) || [])[1];
  const offered = (app.match(/const APPS_ARCHIVE_PW = '([^']+)'/) || [])[1];
  assert.ok(used && offered && used === offered);
});
