const test = require('node:test'); const assert = require('node:assert');
test('grid helpers', async () => {
  const { formatSize, releaseYear, cleanTitle, filterAndSort } = await import('../renderer/native/format.mjs');
  assert.equal(formatSize(0), ''); assert.equal(formatSize(1536), '1.5 KB'); assert.equal(formatSize(52 * 1024 ** 3), '52.0 GB'); assert.equal(formatSize(512 * 1024 ** 2), '512 MB');
  assert.equal(releaseYear({ releaseDate: '2021-03-04' }), '2021'); assert.equal(releaseYear({}), '');
  assert.equal(cleanTitle('Metro Awakening v20593050 -ARMGDDN'), 'Metro Awakening');
  assert.equal(cleanTitle('Half-Life Alyx v1.5 -ARMGDDN'), 'Half-Life Alyx');
  const items = [{ name: 'B Game v1 -ARMGDDN', size: 5, firstSeenAt: '2026-01-01' }, { name: 'a Game v2 -ARMGDDN', size: 9, firstSeenAt: '2026-02-01' }, { name: 'C v3 -ARMGDDN', size: 1 }];
  assert.deepEqual(filterAndSort(items, { sort: 'name' }).map((x) => x.size), [9, 5, 1]);
  assert.deepEqual(filterAndSort(items, { sort: 'size' }).map((x) => x.size), [9, 5, 1]);
  assert.equal(filterAndSort(items, { sort: 'newest' })[0].size, 9);
  assert.deepEqual(filterAndSort(items, { query: 'game' }).length, 2);

  const { autoEnter } = await import('../renderer/native/format.mjs');
  assert.equal(autoEnter('PC Games', [{ name: 'PC1', isDir: true }]), 'PC1');
  assert.equal(autoEnter('PCVR Games', [{ name: 'readme.txt', isDir: false }, { name: 'PCVR2', isDir: true }]), 'PCVR2');
  assert.equal(autoEnter('Music', [{ name: 'Music', isDir: true }]), 'Music');
  assert.equal(autoEnter('Comics', [{ name: 'A', isDir: true }, { name: 'B', isDir: true }]), null);
  assert.equal(autoEnter('PC Games', []), null);
});
