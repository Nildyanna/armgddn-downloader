const { test } = require('node:test');
const assert = require('node:assert');
const { classify7zFailure, describe7zFailure, blamedFile } = require('../sevenZipErrors');

// Text copied from a real 7-Zip run on a password-protected archive with damaged bytes inside data.bin.
const CRC = 'ERROR: CRC Failed in encrypted file. Wrong password? : data.bin\n\nSub items Errors: 1';

test('a CRC failure in a protected archive is reported as damage, not as a wrong password', () => {
  assert.strictEqual(classify7zFailure(CRC), 'damaged');
  const msg = describe7zFailure(CRC, 2);
  assert.match(msg, /data\.bin is damaged/);
  assert.match(msg, /Check files/);
  assert.doesNotMatch(msg, /download (it )?again|re-?download/i);
  assert.doesNotMatch(msg, /wrong password/i);
});

test('names the file 7-Zip blames', () => {
  assert.strictEqual(blamedFile(CRC), 'data.bin');
  assert.strictEqual(blamedFile('ERROR: Data Error : Game/Data/pack 1.bin'), 'Game/Data/pack 1.bin');
  assert.strictEqual(blamedFile('nothing here'), '');
});

test('a cut-short archive is reported as incomplete', () => {
  const msg = describe7zFailure('ERROR: Unexpected end of archive : game.7z', 2);
  assert.match(msg, /damaged or incomplete|damaged/);
});

test('a real password problem still says so', () => {
  assert.strictEqual(classify7zFailure('ERROR: Wrong password : data.bin'), 'password');
  assert.strictEqual(describe7zFailure('Enter password (will not be echoed):', 2), '7z extraction failed: wrong password or encrypted archive');
});

test('anything else falls through to the caller\'s own message', () => {
  assert.strictEqual(describe7zFailure('ERROR: Cannot create output file : No space left on device', 2), null);
});
