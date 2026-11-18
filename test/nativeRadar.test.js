const test = require('node:test'); const assert = require('node:assert');
const load = () => import('../renderer/native/radar.mjs');

test('radar titles lose version tags, repack tags and brackets', async () => {
  const r = await load();
  assert.equal(r.radarFileTitle('PC2/Half-Life Alyx v1.5 -ARMGDDN'), 'Half-Life Alyx');
  assert.equal(r.radarFileTitle('Metro Awakening v20593050 -ARMGDDN'), 'Metro Awakening');
  assert.equal(r.radarFileTitle('Some Game (2021)'), 'Some Game');
  assert.equal(r.radarGroup('PC-2'), 'PC Games'); assert.equal(r.radarGroup('PCVR-3'), 'PCVR Games'); assert.equal(r.radarGroup('Testing'), 'Testing');
});

test('download taste: words from finished downloads raise the score of similar titles', async () => {
  const r = await load();
  const profile = r.downloadProfile([{ title: 'Fallout 4 VR Essentials Overhaul', status: 'completed', remote: 'PCVR-2' }, { title: 'Skyrim Special Edition', status: 'completed', remote: 'PCVR-1' }, { title: 'Ignored', status: 'failed' }]);
  assert.equal(profile.total, 2); assert.equal(profile.pcvr, 2);
  assert.ok(r.affinity({ title: 'Fallout 76', remote: 'PCVR Games' }, profile) > r.affinity({ title: 'Cooking Simulator', remote: 'PCVR Games' }, profile));
  assert.equal(r.affinity({ title: 'x' }, { total: 0 }), 0);
});

const base = { noise: () => 0.5 };
const trending = { week: [{ title: 'Hot One', remote: 'PC-2', path: 'PC2/Hot One v1 -ARMGDDN', pc: 9, pcvr: 0, total: 9, coverUrl: '/api/art-proxy?url=x' }, { title: 'Hot Two', remote: 'PCVR-2', path: 'PCVR2/Hot Two', pc: 0, pcvr: 4, total: 4 }], month: [] };

test('picks: trending always shows, saved and recent come first, downloaded and dismissed titles are left out', async () => {
  const { radarPicks, radarKey } = await load();
  const myList = [{ name: 'Saved Game v1 -ARMGDDN', remote: 'PC Games', path: 'PC1/Saved Game v1 -ARMGDDN', dateAdded: '2026-11-01' }, { name: 'Already Have v2 -ARMGDDN', remote: 'PC Games', path: 'PC1/Already Have v2 -ARMGDDN' }];
  const history = [{ remote: 'PC Games', path: 'PC2/Recent Game v3 -ARMGDDN', name: 'Recent Game v3 -ARMGDDN' }, { remote: 'PC Games', path: 'PC2', name: 'too shallow' }];
  const downloads = [{ title: 'Already Have v2 -ARMGDDN', status: 'completed', remote: 'PC-1' }];
  const picks = radarPicks({ ...base, trending, history, myList, related: [], downloads, dismissed: [], seen: new Set() });
  const titles = picks.map((p) => p.title);
  assert.ok(titles.includes('Hot One') && titles.includes('Hot Two') && titles.includes('Saved Game v1 -ARMGDDN') && titles.includes('Recent Game v3 -ARMGDDN'));
  assert.ok(!titles.some((t) => /Already Have/.test(t)), 'a title already downloaded is not suggested');
  assert.ok(!titles.includes('too shallow'));
  assert.equal(picks.find((p) => p.title === 'Recent Game v3 -ARMGDDN').reason, 'Continue browsing');
  const gone = radarKey('PC Games', 'PC1/Saved Game v1 -ARMGDDN', 'Saved Game v1 -ARMGDDN');
  const after = radarPicks({ ...base, trending, history, myList, related: [], downloads, dismissed: [gone], seen: new Set() }).map((p) => p.title);
  assert.ok(!after.includes('Saved Game v1 -ARMGDDN')); assert.ok(after.includes('Hot One'));
});

test('a title from two sources is shown once with both badges, and the stack falls back to trending when nothing else is left', async () => {
  const { radarPicks } = await load();
  const myList = [{ name: 'Hot One v1 -ARMGDDN', remote: 'PC Games', path: 'PC2/Hot One v1 -ARMGDDN' }];
  const picks = radarPicks({ ...base, trending, history: [], myList, related: [], downloads: [], dismissed: [], seen: new Set() });
  const hot = picks.filter((p) => /Hot One/.test(p.title));
  assert.equal(hot.length, 1); assert.ok(hot[0].badges.includes('saved') && hot[0].badges.includes('trending'));
  const onlyDismissed = radarPicks({ ...base, trending: {}, history: [], myList: [], related: [], downloads: [], dismissed: [], seen: new Set() });
  assert.deepEqual(onlyDismissed, []);
  const rotated = radarPicks({ ...base, trending, history: [], myList: [], related: [], downloads: [], dismissed: [], seen: new Set(), offset: 1 }).map((p) => p.title);
  const plain = radarPicks({ ...base, trending, history: [], myList: [], related: [], downloads: [], dismissed: [], seen: new Set() }).map((p) => p.title);
  assert.deepEqual(rotated, plain.slice(1).concat(plain.slice(0, 1)));
});
