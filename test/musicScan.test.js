'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ms = require('../musicScan');

const row = (rel, size = 5e6) => ({ rel, size, damaged: size < 2048 });
const cat = (...paths) => paths.map((p) => [p, 30e6]);

test('title keys ignore track numbers, format and punctuation', () => {
  assert.strictEqual(ms.titleKey('01 - Ambitionz Az A Ridah.flac'), ms.titleKey('1. Ambitionz az a Ridah.mp3'));
  assert.strictEqual(ms.titleKey('1-02 All About U.flac'), ms.titleKey('All About U.m4a'));
  assert.strictEqual(ms.titleKey('Track 07 Hello.mp3'), ms.titleKey('Hello.flac'));
  assert.notStrictEqual(ms.titleKey('01 Intro.flac'), ms.titleKey('01 Outro.flac'));
});

test('a copy in another format, with other track numbers, still counts as owned', () => {
  const c = cat('2Pac/All Eyez On Me/01 Ambitionz.flac', '2Pac/All Eyez On Me/02 All About U.flac');
  const r = ms.compare(c, [row('2Pac/All Eyez On Me/1 - Ambitionz.mp3'), row('2Pac/All Eyez On Me/02. All About U.mp3')]);
  assert.strictEqual(r.have, 2);
  assert.strictEqual(r.missing, 0);
  assert.deepStrictEqual(r.albums, { complete: 1, partial: 0, none: 0 });
});

test('missing tracks come back in the shape the download batcher uses', () => {
  const c = cat('Tina Turner/Private Dancer/01 One.mp3', 'Tina Turner/Private Dancer/02 Two.mp3', 'Tina Turner/Break Every Rule/01 Three.mp3');
  const r = ms.compare(c, [row('Tina Turner/Private Dancer/01 One.mp3')]);
  assert.strictEqual(r.have, 1);
  assert.deepStrictEqual(r.missingRows.map((m) => m[0]), ['Tina Turner/Private Dancer/02 Two.mp3', 'Tina Turner/Break Every Rule/01 Three.mp3']);
  assert.strictEqual(r.missingRows[0][2], 30e6);
  assert.deepStrictEqual(r.albums, { complete: 0, partial: 1, none: 1 });
});

test('"The" and punctuation in folder names do not matter', () => {
  const r = ms.compare(cat('The Beatles/Abbey Road/01 Come Together.flac'), [row('Beatles/Abbey Road/01 Come Together.mp3')]);
  assert.strictEqual(r.have, 1);
});

test('the same title on another album is not a match', () => {
  const r = ms.compare(cat('Artist/Album A/01 Intro.flac'), [row('Artist/Album B/01 Intro.flac')]);
  assert.strictEqual(r.have, 0);
});

test('an album folder with no artist level matches on album and title', () => {
  const r = ms.compare(cat('Pink Floyd/The Wall/01 In The Flesh.flac'), [row('The Wall/01 In The Flesh.mp3')]);
  assert.strictEqual(r.have, 1);
});

test('disc folders are kept apart, so Disc 1 track 1 is not Disc 2 track 1', () => {
  const c = cat('Pink Floyd/The Wall/CD1/01 Intro.flac', 'Pink Floyd/The Wall/CD2/01 Intro.flac');
  const r = ms.compare(c, [row('Pink Floyd/The Wall/Disc 1/01 Intro.mp3')]);
  assert.strictEqual(r.have, 1);
  assert.deepStrictEqual(r.missingRows.map((m) => m[0]), ['Pink Floyd/The Wall/CD2/01 Intro.flac']);
});

test('a zero-length or tiny file is damaged: it is not owned and the track is downloaded again', () => {
  const r = ms.compare(cat('A/B/01 Song.flac'), [row('A/B/01 Song.flac', 0)]);
  assert.strictEqual(r.have, 0);
  assert.strictEqual(r.damaged, 1);
  assert.strictEqual(r.missing, 1);
});

test('scanFolder lists audio files by size only and skips everything else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicscan-'));
  try {
    fs.mkdirSync(path.join(root, 'Artist', 'Album'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, 'Artist', 'Album', '01 Song.mp3'), Buffer.alloc(4096));
    fs.writeFileSync(path.join(root, 'Artist', 'Album', 'cover.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(root, 'Artist', 'Album', '02 Empty.flac'), '');
    fs.writeFileSync(path.join(root, '.hidden', 'x.mp3'), Buffer.alloc(4096));
    const out = ms.scanFolder(root);
    assert.deepStrictEqual(out.rows.map((r) => [r.rel, r.damaged]).sort(), [['Artist/Album/01 Song.mp3', false], ['Artist/Album/02 Empty.flac', true]]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('planBatches splits by file count and bytes', () => {
  const rows = [['a', 0, 40], ['b', 0, 40], ['c', 0, 40]];
  assert.strictEqual(ms.planBatches(rows, 2, 1000).length, 2);
  assert.strictEqual(ms.planBatches(rows, 10, 70).length, 3);
});
