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
  const { shapeFor } = await import('../renderer/native/format.mjs');
  assert.equal(shapeFor('PC Games'), 'wide'); assert.equal(shapeFor('PCVR Games'), 'wide'); assert.equal(shapeFor('Music'), 'square');
  assert.equal(shapeFor('Comics'), 'tall'); assert.equal(shapeFor('3D Printer Models'), 'square'); assert.equal(shapeFor('Pirated PC Apps'), 'wide');
  const { crumbsFor } = await import('../renderer/native/format.mjs');
  assert.deepEqual(crumbsFor('PC Games', 'PC1'), { root: 'PC1', items: [] });
  assert.deepEqual(crumbsFor('PC Games', 'PC1/Game v1/Update'), { root: 'PC1', items: [{ label: 'Game v1', path: 'PC1/Game v1' }, { label: 'Update', path: 'PC1/Game v1/Update' }] });
  assert.deepEqual(crumbsFor('Music', 'Artist/Album'), { root: '', items: [{ label: 'Artist', path: 'Artist' }, { label: 'Album', path: 'Artist/Album' }] });
  assert.deepEqual(crumbsFor('Comics', ''), { root: '', items: [] });
  const { visibleItems } = await import('../renderer/native/format.mjs');
  const raw = [{ name: 'Game', path: 'PC1/Game', isDir: true }, { name: 'currentserverPC-FTP.json', path: 'PC1/currentserverPC-FTP.json', isDir: false }, { name: 'PC1', path: 'PC1', isDir: true }, { name: 'notes.txt', path: 'PC1/notes.txt', isDir: false }];
  assert.deepEqual(visibleItems('PC Games', 'PC1', raw).map((x) => x.name), ['Game', 'notes.txt']);
  const t = [{ name: 'PC', isDir: true }, { name: 'PCVR', isDir: true }, { name: 'stray', isDir: true }, { name: 'a.json', isDir: false }];
  assert.deepEqual(visibleItems('Testing', '', t).map((x) => x.name), ['PC', 'PCVR']);
  assert.equal(visibleItems('Music', '', [{ name: 'X', isDir: true }]).length, 1);
  const { collectionCoverPath } = await import('../renderer/native/format.mjs');
  assert.equal(collectionCoverPath('Music', '', { name: 'Abba', isDir: true }), '/api/collection-cover?remote=Music&path=Abba&w=480');
  assert.equal(collectionCoverPath('Comics', 'Marvel/X-Men', { name: 'Issue 1.cbz', isDir: false }), '/api/collection-cover?remote=Comics&path=Marvel%2FX-Men%2FIssue%201.cbz&w=480');
  assert.equal(collectionCoverPath('PC Games', '', { name: 'A', isDir: true }), '');
  assert.equal(collectionCoverPath('Music', '', { name: 'notes.txt', isDir: false }), '');
  assert.equal(visibleItems('Music', '', [{ name: '.trash-2026-11-05', isDir: true }, { name: 'Abba', isDir: true }]).length, 1);
  const { canDownload } = await import('../renderer/native/format.mjs');
  assert.equal(canDownload('3D Printer Models', 'Bambu', { name: 'X1C', isDir: true }), false);
  assert.equal(canDownload('3D Printer Models', 'Bambu/X1C', { name: 'Tool Caddy.stl', isDir: false }), true);
  assert.equal(canDownload('Testing', '', { name: 'PC', isDir: true }), false);
  assert.equal(canDownload('Testing', 'PC', { name: 'Some Game', isDir: true }), true);
  assert.equal(canDownload('PC Games', 'PC1', { name: 'Game', isDir: true }), true);
  assert.equal(canDownload('Music', '', { name: 'Abba', isDir: true }), true);
  assert.equal(canDownload('Comics', '', { name: 'Marvel', isDir: true }), true);
  const { downloadActions } = await import('../renderer/native/format.mjs');
  assert.deepEqual(downloadActions({ status: 'downloading' }), ['pause', 'cancel']);
  assert.deepEqual(downloadActions({ status: 'paused' }), ['resume', 'cancel']);
  assert.deepEqual(downloadActions({ status: 'error' }), ['retry', 'cancel']);
  assert.deepEqual(downloadActions({ status: 'completed' }), ['openFolder']);
  assert.deepEqual(downloadActions({ status: 'cancelled' }), []);
  const { letterOf, lettersPresent } = await import('../renderer/native/format.mjs');
  assert.equal(letterOf('(the) Gnorp Apologue'), '#');   /* sorts with the symbols, first in the list */ assert.equal(letterOf('7 Days to Die v1 -ARMGDDN'), '#');
  assert.equal(letterOf('\u00c9dith Piaf'), 'E'); assert.equal(letterOf('\u0421\u043a\u0440\u0438\u043f'), '#');
  assert.deepEqual(lettersPresent([{ name: 'Zelda' }, { name: '1942' }, { name: 'Abba' }]), ['#', 'A', 'Z']);
  const { statusInfo, shortDate } = await import('../renderer/native/format.mjs');
  assert.deepEqual(statusInfo('pending'), ['Pending', 'warn']); assert.deepEqual(statusInfo('REJECTED'), ['Rejected', 'bad']); assert.equal(statusInfo('weird')[0], 'Weird');
  assert.equal(shortDate('not a date'), ''); assert.match(shortDate('2026-11-17T12:00:00Z'), /2026/);
  const { detailLines, steamLinks, dayKey } = await import('../renderer/native/format.mjs');
  const item = { size: 52 * 1024 ** 3, modTime: '2026-11-01T00:00:00Z', releaseDate: '2025-02-03', downloadCount: 1234, coverArt: { steamAppId: 4242 } };
  const lines = detailLines('PC Games', item);
  assert.equal(lines[0], 'Remote: PC Games'); assert.ok(lines.some((l) => l.startsWith('Size: 52.0 GB'))); assert.ok(lines.some((l) => l.includes('1,234 downloads')));
  assert.deepEqual(steamLinks(item).map((x) => x[0]), ['Steam', 'SteamDB']); assert.deepEqual(steamLinks({}), []);
  assert.equal(dayKey(new Date(2026, 10, 18)), '2026-11-18');
  assert.equal(detailLines('Music', { size: 10, crossRemoteSize: 5000 }).some((l) => l.startsWith('Size: 4.9 KB')), true);   // a stub folder shows the real size
  const { trailerSource, youtubeEmbed } = await import('../renderer/native/format.mjs');
  assert.deepEqual(trailerSource({ mp4: { max: 'https://video.akamai.steamstatic.com/a.mp4' }, youtube: 'dQw4w9WgXcQ' }), { kind: 'video', url: 'https://video.akamai.steamstatic.com/a.mp4' });
  assert.deepEqual(trailerSource({ webm: { 480: 'https://v.example/a.webm' } }), { kind: 'video', url: 'https://v.example/a.webm' });
  assert.deepEqual(trailerSource({ hls: 'https://video.fastly.steamstatic.com/x/master.m3u8' }), { kind: 'hls', url: 'https://video.fastly.steamstatic.com/x/master.m3u8' });
  assert.equal(trailerSource({ youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }).url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
  assert.equal(youtubeEmbed('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
  assert.equal(trailerSource({ mp4: { max: 'http://insecure/a.mp4' } }), null); assert.equal(trailerSource(null), null); assert.equal(youtubeEmbed('javascript:alert(1)'), '');
  const { isPatchFolder, patchOldRepackLabel, mayHavePatchQuestion } = await import('../renderer/native/format.mjs');
  assert.equal(isPatchFolder('Game 1.0-1.5 Update Patch'), true); assert.equal(isPatchFolder('Game_Update_Patch_v2'), true); assert.equal(isPatchFolder('Hotfix 2'), false); assert.equal(isPatchFolder('Patch Notes'), false);
  assert.equal(patchOldRepackLabel('Cool Game v1.5 -ARMGDDN', 'Cool Game 1.0-1.5 Update Patch'), 'Cool Game v1.0 -ARMGDDN');
  assert.equal(patchOldRepackLabel('Cool Game v1.5 -ARMGDDN', 'Update Patch'), null);
  assert.equal(mayHavePatchQuestion('Cool Game v1.5 -ARMGDDN'), true); assert.equal(mayHavePatchQuestion('Cool Game 1.0-1.5 Update Patch -ARMGDDN'), false); assert.equal(mayHavePatchQuestion('Some Folder'), false);
  const F = await import('../renderer/native/format.mjs');
  assert.equal(F.isStarfieldTarget('PC1/Starfield v1 -ARMGDDN'), true); assert.equal(F.isStarfieldTarget('PC1/Starfield2'), false); assert.equal(F.isStarfieldTarget('PC1/Not Starfield'), false);
  let l = F.myListToggle([], { name: 'G', remote: 'PC Games', path: 'PC1/G', size: 5 });
  assert.equal(l.length, 1); assert.equal(F.myListHas(l, 'PC Games', '/PC1/G/'), true); assert.equal(F.myListToggle(l, { name: 'G', remote: 'PC Games', path: 'PC1/G' }).length, 0);
  const catItems = [{ isDir: true, coverArt: { categories: ['Indie', 'Action'] } }, { isDir: true, coverArt: { categories: ['Indie'] } }, { isDir: false, name: 'f' }];
  assert.deepEqual(F.categoryCounts(catItems, 'PC Games').map((c) => [c.name, c.count]), [['Indie', 2], ['Action', 1]]);
  assert.equal(F.filterByCategory(catItems, 'Action', 'PC Games').length, 2);   // the matching folder and the loose file
  assert.deepEqual(F.categoryCounts([{ isDir: true }], 'Music'), []);   // nothing tagged yet: no dropdown
  assert.deepEqual(F.categoriesOf({ isDir: true, genres: ['Rock'] }, 'Music'), ['Rock']);
  const W = await import('../renderer/native/format.mjs');
  assert.equal(W.wikiHtmlForApp('<p>x</p><img class="a" src="https://www.armgddnbrowser.com/static/wiki/a b.webp" alt="">'), '<p>x</p><img class="a" src="armgddn-img://c/?u=' + encodeURIComponent('https://www.armgddnbrowser.com/static/wiki/a b.webp') + '" alt="">');
  assert.equal(W.wikiSectionFor([{ id: 'a' }, { id: 'b' }], 'b').id, 'b'); assert.equal(W.wikiSectionFor([{ id: 'a' }], 'zzz').id, 'a'); assert.equal(W.wikiSectionFor([], 'a'), null);
  const S = await import('../renderer/native/format.mjs');
  assert.equal(S.searchMatches("Assassin's Creed Mirage v1 -ARMGDDN", 'assassins creed'), true); assert.equal(S.searchMatches('Half-Life Alyx', 'half life'), true);
  assert.equal(S.searchMatches('\u00c9dith Piaf', 'edith'), true); assert.equal(S.searchMatches('Doom', 'doom eternal'), false); assert.equal(S.searchMatches('Doom', ''), false);
  assert.equal(S.searchEverywhere([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Alphabet' }], 'alpha').length, 2); assert.equal(S.searchEverywhere([{ name: 'a' }, { name: 'a' }], 'a', 1).length, 1);
});

test('sort by popularity and release, reversed, and the flame label', async () => {
  const { filterAndSort, popularityLabel } = await import('../renderer/native/format.mjs');
  const items = [{ name: 'A', downloadCount: 3, releaseDate: '2020-01-01' }, { name: 'B', downloadCount: 30, releaseDate: '2018-05-05' }, { name: 'C', releaseDate: '2024-02-02' }];
  assert.deepEqual(filterAndSort(items, { sort: 'popularity' }).map((x) => x.name), ['B', 'A', 'C']);
  assert.deepEqual(filterAndSort(items, { sort: 'released' }).map((x) => x.name), ['C', 'A', 'B']);
  assert.deepEqual(filterAndSort(items, { sort: 'popularity', reverse: true }).map((x) => x.name), ['C', 'A', 'B']);
  assert.equal(popularityLabel({ downloadCount: 1234 }), '\u{1F525} 1,234 (30d)');
  assert.equal(popularityLabel({ downloadCount: 0 }), ''); assert.equal(popularityLabel({}), '');
});

test('home strip entries become list items, and picks skip what is already on My List', async () => {
  const { homeItem, picksFrom } = await import('../renderer/native/format.mjs');
  const it = homeItem({ title: 'Half-Life Alyx', remote: 'PCVR-2', path: 'PCVR2/Half-Life Alyx v1 -ARMGDDN', sizeBytes: 5e9, coverUrl: '/api/art-proxy?url=x', total: 12 });
  assert.deepEqual([it.name, it._remote, it._folder, it.size, it.downloadCount, it.isDir], ['Half-Life Alyx v1 -ARMGDDN', 'PCVR Games', 'PCVR2', 5e9, 12, true]);
  assert.equal(it.coverArt.cover.url, '/api/art-proxy?url=x');
  assert.equal(homeItem({ title: 'x' }), null);
  const e = ['A', 'B', 'C', 'D'].map((t) => ({ title: t, remote: 'PC-2', path: 'PC2/' + t }));
  const a = picksFrom(e, ['b'], '2026-11-18', 10).map((x) => x.title);
  assert.deepEqual(a.slice().sort(), ['A', 'C', 'D']);
  assert.deepEqual(picksFrom(e, ['b'], '2026-11-18', 10).map((x) => x.title), a);          // stable within a day
  assert.equal(picksFrom(e, [], 'd', 2).length, 2);
});

test('website preferences code: read, checked field by field, merged without duplicates', async () => {
  const { parsePrefs, mergeMyList, PREFS_PREFIX } = await import('../renderer/native/format.mjs');
  const enc = (o) => PREFS_PREFIX + Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const good = { theme: 'solar-flare', myList: [{ name: 'Half-Life Alyx v1 -ARMGDDN', remote: 'PCVR-2', path: 'PCVR2/Half-Life Alyx v1 -ARMGDDN', size: 5, downloadCount: 3, coverArt: { cover: { url: '/api/art-proxy?url=x' } } }, { name: 'bad', remote: '../x', path: '' }, { name: 'trav', remote: 'PC-1', path: 'a/../b' }, null],
    searches: ['half life', 5], komgaUrl: 'https://komga.example/', animations: '0', collapsed: { trendingPillContainer: '1' } };
  const p = parsePrefs('\n  ' + enc(good) + '  \n');
  assert.equal(p.error, undefined);
  assert.equal(p.myList.length, 1); assert.equal(p.myList[0].remote, 'PCVR-2'); assert.equal(p.theme, 'solar-flare');
  assert.deepEqual(p.searches, ['half life']); assert.equal(p.komgaUrl, 'https://komga.example/'); assert.equal(p.animations, false);
  assert.deepEqual(p.strips, { picks: false, trending: true, gems: false });
  assert.ok(parsePrefs('hello').error); assert.ok(parsePrefs(PREFS_PREFIX + '!!!').error);
  assert.ok(parsePrefs(enc({ theme: 'x y', komgaUrl: 'javascript:alert(1)' })).komgaUrl === '');
  const m = mergeMyList([{ remote: 'PCVR-2', path: 'PCVR2/Half-Life Alyx v1 -ARMGDDN', name: 'x' }, { remote: 'PC-1', path: 'z', name: 'z' }], p.myList);
  assert.equal(m.added, 0); assert.equal(m.list.length, 2);
});

test('the copy of the preferences the site keeps on the server is read the same way', async () => {
  const { normalizePrefs } = await import('../renderer/native/format.mjs');
  const p = normalizePrefs({ theme: 'dark', myList: [{ name: 'G', remote: 'PC-1', path: 'PC1/G', size: 1 }], searches: ['a'], komgaUrl: '', animations: false, collapsed: { gameRadarContainer: true, trendingPillContainer: false, hiddenGemsContainer: false } });
  assert.deepEqual(p.strips, { picks: true, trending: false, gems: false });
  assert.equal(p.animations, false); assert.equal(p.myList.length, 1); assert.equal(p.theme, 'dark');
  assert.ok(normalizePrefs(null).error);
});

test('batch mode only inside a folder with several things, and nested picks are dropped', async () => {
  const { batchEligible, batchPaths } = await import('../renderer/native/format.mjs');
  assert.equal(batchEligible('PC-1', 2, 5), true); assert.equal(batchEligible('PC-1', 1, 5), false); assert.equal(batchEligible('PC-1', 2, 1), false);
  assert.equal(batchEligible('Testing', 1, 3), true); assert.equal(batchEligible('Comics', 0, 3), false);
  assert.deepEqual(batchPaths(['A/B', 'A/B/c', 'A/B/', '/A/D', 'A/Bx', '']), ['A/B', 'A/D', 'A/Bx']);
});

test('trending sets follow the website: four sets, five titles each, most downloaded first', async () => {
  const { trendingSets } = await import('../renderer/native/format.mjs');
  const mk = (n, pc, pcvr, platform) => ({ title: 'T' + n, pc, pcvr, platform, lastDownloadTs: n });
  const week = [...[1, 2, 3, 4, 5, 6, 7].map((n) => mk(n, n, 0, 'pc')), mk(8, 0, 9, 'pcvr')];
  const sets = trendingSets({ week, month: [mk(1, 3, 0, 'pc')] });
  assert.deepEqual(sets.map((s) => s.label), ['PC \u00B7 LAST 7 DAYS', 'PCVR \u00B7 LAST 7 DAYS', 'PC \u00B7 LAST 30 DAYS']);
  assert.deepEqual(sets[0].items.map((x) => x.title), ['T7', 'T6', 'T5', 'T4', 'T3']);
  assert.equal(sets[1].items[0].title, 'T8'); assert.deepEqual(trendingSets({}), []);
});

test('the theme file has every palette the app needs, in colours the page can use', () => {
  const themes = require('../renderer/native/themes.json');
  assert.ok(Object.keys(themes).length >= 20);
  assert.ok(themes.dark && themes.light && themes['blood-moon']);
  const colour = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i;
  for (const [id, t] of Object.entries(themes)) {
    for (const k of ['bg', 'panel', 'fg', 'dim', 'line', 'accent', 'accent2', 'onAccent']) assert.match(String(t[k]), colour, id + '.' + k + ' = ' + t[k]);
    assert.ok(t.mode === 'dark' || t.mode === 'light', id);
    if (t.radius) assert.match(t.radius, /^[\d.]+px( [\d.]+px){0,3}$/);
  }
  assert.equal(themes.light.mode, 'light'); assert.equal(themes.dark.mode, 'dark');
});

test('comparison lines read like the classic window, for comics and music', async () => {
  const { compareLines, startedLine } = await import('../renderer/native/format.mjs');
  const c = compareLines('comics', { list: { name: 'Batman Collection' }, summary: { total: 100, have: 60, haveByName: 10, missing: 30, bytesMissing: 3e9, maybe: 2, damagedCount: 4, damaged: ['a.cbz', 'b.cbz', 'c.cbz', 'd.cbz'], perSeries: [{ series: 'Batman', count: 20, bytes: 2e9 }] } });
  assert.equal(c[0].tone, 'warn'); assert.match(c[0].text, /You have 70 of 100\. 30 are missing \(2\.8 GB\)\./);
  assert.ok(c.some((l) => /matched by name/.test(l.text))); assert.ok(c.some((l) => /different year/.test(l.text)));
  assert.ok(c.some((l) => /a\.cbz, b\.cbz, c\.cbz, \.\.\./.test(l.text)));
  assert.equal(c[c.length - 1].title, 'Missing by series'); assert.match(c[c.length - 1].text, /Batman: 20 \(1\.9 GB\)/);
  const all = compareLines('comics', { list: { name: 'Marvel' }, summary: { total: 5, have: 5, missing: 0 } });
  assert.equal(all[0].tone, 'ok'); assert.match(all[0].text, /all 5 comics in Marvel/);
  const m = compareLines('music', { summary: { total: 1000, have: 900, missing: 100, bytesMissing: 5e8, albums: { complete: 40, partial: 3, none: 7 }, damaged: 2 } });
  assert.match(m[0].text, /You have 900 of 1,000 tracks\. 100 are missing/); assert.match(m[1].text, /40 complete, 3 partly there, 7 not in your folder/); assert.match(m[2].text, /2 of your files look empty/);
  assert.deepEqual(compareLines('music', null), []);
  assert.match(startedLine('music', { started: 1, files: 10, bytes: 2e9, folder: 'D:\\Music' }), /Started 1 download \(10 tracks, 1\.9 GB\)\. .* arrive in D:\\Music/);
  assert.match(startedLine('comics', { started: 3, files: 5, bytes: 0, folder: 'x' }), /Started 3 downloads \(5 comics, 0 B\)/);
});

test('the intro plays only after a real first sign-in here, never for someone already signed in, who has seen it, or who has seen it on the website', async () => {
  const { introDecision, normalizePrefs } = await import('../renderer/native/format.mjs');
  // a new member signs in for the first time: plays, and is remembered
  assert.deepEqual(introDecision({ afterSignIn: true }), { play: true, markSeen: true });
  // the window opens with the member already signed in (an existing Companion user): no intro, and it is not offered later either
  assert.deepEqual(introDecision({ afterSignIn: false }), { play: false, markSeen: true });
  // seen in this app before
  assert.deepEqual(introDecision({ afterSignIn: true, seenHere: true }), { play: false, markSeen: false });
  // seen on the website (carried with the synced preferences): no intro, and remembered
  assert.deepEqual(introDecision({ afterSignIn: true, seenOnWebsite: true }), { play: false, markSeen: true });
  // switched off in Settings, or a screenshot run: no intro and nothing remembered
  assert.deepEqual(introDecision({ afterSignIn: true, off: true }), { play: false, markSeen: false });
  assert.deepEqual(introDecision({ afterSignIn: true, quiet: true }), { play: false, markSeen: false });
  assert.deepEqual(introDecision(), { play: false, markSeen: true });
  // the website's flag is read as a strict boolean
  assert.equal(normalizePrefs({ introSeen: true }).introSeen, true);
  for (const v of [false, 'true', 1, null, undefined]) assert.equal(normalizePrefs({ introSeen: v }).introSeen, false);
  assert.equal(normalizePrefs({}).introSeen, false);
});

test('the native window starts the intro only after a sign-in made in it, reads the synced preferences first, and offers the classic switches', () => {
  const fs = require('fs'); const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  assert.ok(app.includes('const boot = async (afterSignIn) => {') && app.includes('boot(true); };') && app.includes('useEffect(() => { boot(); }, []);'));
  const boot = app.slice(app.indexOf('const boot = async'), app.indexOf('useEffect(() => { boot(); }, []);'));
  assert.ok(boot.indexOf('api.prefs()') > -1 && boot.indexOf('api.prefs()') < boot.indexOf('introDecision('), 'the preferences are read before the intro is decided');
  assert.ok(boot.includes('seenOnWebsite') && boot.includes("localStorage.setItem('native.lightningSeen', '1')"));
  for (const key of ['minimizeToTrayOnMinimize', 'startWithOsMinimized', 'minimizeToTrayOnClose', 'startWithOsStartup', 'autoUpdate', 'showNotifications', 'autoExtract7z', 'autoHashCheck', 'errorReporting'])
    assert.ok(app.includes("'" + key + "'"), key + ' is in the native Settings');
});

test('update housekeeping files are never listed, and cover art fills the tile only when its shape matches (like the website)', async () => {
  const { isHiddenItem, coverFills, filterAndSort } = await import('../renderer/native/format.mjs');
  assert.equal(isHiddenItem({ name: 'updatePCVR-FTP.txt', isDir: false }), true);
  assert.equal(isHiddenItem({ name: 'updatePC-FTP.txt', isDir: false }), true);
  assert.equal(isHiddenItem({ name: 'Update Game', isDir: true }), false);
  assert.equal(isHiddenItem({ name: 'Epic Fun', isDir: true }), false);
  assert.deepEqual(filterAndSort([{ name: 'updatePCVR-FTP.txt', isDir: false }, { name: 'Epic Fun', isDir: true }]).map((x) => x.name), ['Epic Fun']);
  assert.equal(coverFills(616, 353, 'wide'), true);      // Steam capsule: fills
  assert.equal(coverFills(460, 215, 'wide'), false);  // 2.14:1 is wider than the website's limit, so it stays whole
  assert.equal(coverFills(1000, 1000, 'wide'), false);   // square art stays whole
  assert.equal(coverFills(900, 300, 'wide'), false);     // very wide banner stays whole
  assert.equal(coverFills(600, 900, 'tall'), true);
  assert.equal(coverFills(900, 600, 'tall'), false);
  assert.equal(coverFills(500, 500, 'square'), true);
  assert.equal(coverFills(0, 0, 'wide'), false);
});

test('Newest / Older tags, typo-forgiving search, other-section hint, stubs, quota and comics details', async () => {
  const f = await import('../renderer/native/format.mjs');
  // Newest / Older: only titles that appear with two different builds
  const a = { name: 'Dave the Diver v20260101 -ARMGDDN' }, b = { name: 'Dave the Diver v20260301 -ARMGDDN' }, c = { name: 'Other Game v20260101 -ARMGDDN' }, d = { name: 'No Build Here' };
  const m = f.versionBadges([a, b, c, d]);
  assert.equal(m.get(a), 'older'); assert.equal(m.get(b), 'newest'); assert.equal(m.has(c), false); assert.equal(m.has(d), false);
  assert.equal(f.versionBadges([a, { name: 'Dave the Diver v20260101 -ARMGDDN' }]).size, 0, 'the same build twice is not a newer one');
  assert.equal(f.searchBuildNumber('Game v1.5 -X'), null); assert.equal(f.searchBuildNumber('Game v20260101'), 20260101);
  // typo search: one slip per word of five or more letters
  assert.equal(f.withinOneEdit('spiderman', 'spidermam'), true); assert.equal(f.withinOneEdit('cat', 'cut'), false);
  assert.equal(f.fuzzyMatches("Assassin's Creed Mirage", 'assasins mirage'), true);
  assert.equal(f.fuzzyMatches('Halo Infinite', 'zelda'), false);
  assert.deepEqual(f.searchFuzzy([{ name: 'Cyberpunk 2077' }, { name: 'Hades' }], 'cyberpnk'), [{ name: 'Cyberpunk 2077' }]);
  assert.deepEqual(f.searchFuzzy([{ name: 'Hades' }], 'hade'), [], 'short queries are never guessed at');
  // other sections that also match
  const idx = [{ name: 'Dave the Diver', isDir: true, _remote: 'PC Games' }, { name: 'Dave the Diver v2', isDir: true, _remote: 'Testing' }, { name: 'Dave the Diver v3', isDir: true, _remote: 'Testing' }];
  assert.deepEqual(f.otherSectionMatches(idx, 'dave diver', 'PC Games'), [{ remote: 'Testing', count: 2 }]);
  // stubs
  assert.deepEqual(f.stubNotice('PC Games', 'PC1', { isDir: true, size: 0 }), { message: 'You must download from PCVR server', remote: 'PCVR Games', folder: '' });
  assert.equal(f.stubNotice('PCVR Games', '', { isDir: true, size: 10 }).message, 'You must download from PC server');
  assert.deepEqual(f.stubNotice('Testing', 'PC', { isDir: true, size: 0 }), { message: 'You must download from PCVR server', remote: 'Testing', folder: 'PCVR' });
  assert.equal(f.stubNotice('PC Games', '', { isDir: true, size: 5000 }), null); assert.equal(f.stubNotice('Music', '', { isDir: true, size: 0 }), null); assert.equal(f.stubNotice('PC Games', '', { isDir: false, size: 0 }), null);
  // quota: a game group only when every mirror is used up
  assert.deepEqual([...f.quotaTabs({ 'PC-1': 'at-quota', 'PC-2': 'at-quota', 'PC-3': 'at-quota', 'PCVR-1': 'at-quota', 'PCVR-2': 'healthy', 'PCVR-3': 'at-quota', Comics: 'at-quota' })].sort(), ['Comics', 'PC Games']);
  assert.equal(f.quotaTabs(null).size, 0);
  // comics: proper title, issue and date, and release order inside a series
  const c1 = { name: 'b.cbz', comic: { title: 'Batman', number: '2', date: '2020-02-01' } }, c2 = { name: 'a.cbz', comic: { title: 'Batman', number: '1', date: '2020-01-01' } }, c3 = { name: 'c.cbz', comic: { title: 'Batman', number: '10', date: '2020-01-01' } }, plain = { name: 'z.cbz' };
  assert.deepEqual(f.filterAndSort([c1, c3, c2], { sort: 'name' }).map((x) => x.name), ['a.cbz', 'c.cbz', 'b.cbz']);
  assert.equal(f.comicTitle(c1), 'Batman'); assert.equal(f.comicTitle(plain), 'z.cbz');
  assert.deepEqual(f.comicParts(c1), ['Issue #2', '2020-02-01']); assert.deepEqual(f.comicParts(plain), []);
  assert.equal(f.filterAndSort([c1, plain], { query: 'batman' }).length, 1, 'a comic is found by its proper title');
});

test('the app wires in the watchlist, Newest/Older, typo suggestions, other-section hint, stubs, quota and ComicVine', () => {
  const fs = require('fs'), path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'native', 'bridge.js'), 'utf8');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload-native.js'), 'utf8');
  for (const piece of ['<${WatchlistModal}', 'Tell me when it is added', 'My watchlist', 'versionBadges(found)', "No exact match, closest: ", 'otherSectionMatches(index, query, remote)', 'Search all sections', 'stubNotice(remote, folder, item)', 'Go there', 'quotaTabs(r.data.remoteStatus)', "' quota'", 'cvbadge']) assert.ok(app.includes(piece), piece);
  for (const piece of ["'native:watchlist'", "'native:watchAdd'", "'native:watchRemove'", "'/api/watchlist'", 'comicvine.gamespot.com']) assert.ok(bridge.includes(piece), piece);
  for (const piece of ['watchlist: call', 'watchAdd: call', 'watchRemove: call']) assert.ok(pre.includes(piece), piece);
});

test('publisher collections: members present in the list, total size, and the cover', async () => {
  const f = await import('../renderer/native/format.mjs');
  const items = [{ name: 'Batman Collection', isDir: true, size: 100 }, { name: 'Superman Collection', isDir: true, size: 50 }, { name: 'Other', isDir: true, size: 7 }, { name: 'Spider-Man Collection', isDir: false, size: 9 }];
  const live = [{ id: 'dc', title: 'DC Collection', members: ['Batman Collection', 'Superman Collection', 'Missing One'], art: 'Superman Collection/Superman Vol. 1 (1939)' }, { id: 'x', title: 'Nothing', members: ['Nope'], art: '' }];
  const out = f.bundlesPresent(live, items);
  assert.equal(out.length, 1); assert.deepEqual(out[0].present, ['Batman Collection', 'Superman Collection']); assert.equal(out[0].total, 150);
  assert.ok(out[0].cover.startsWith('/api/collection-cover?remote=Comics&path=Superman%20Collection'));
  assert.equal(f.bundlesPresent(null, items).map((b) => b.id).join(), 'dc', 'built-in bundles are used while the site has none');
});
test('the Comics page shows the publisher collections right under the Komga box', () => {
  const fs = require('fs'), path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'native', 'app.mjs'), 'utf8');
  const lib = app.indexOf("html`<main class=${viewMode === 'list' ? 'list'");
  assert.ok(lib > 0 && app.indexOf('class="komgabox"') > 0 && app.indexOf('class="komgabox"') < lib, 'the Komga box is above the list');
  assert.ok(app.indexOf('${showBundles ? html`<section class="bundles">', lib) === lib + app.slice(lib).indexOf('${showBundles ? html`<section class="bundles">') && app.slice(lib, lib + 400).includes('showBundles'), 'the collections are the first rows INSIDE the scrolling list, so they scroll with it');
  assert.ok(!/\n    \$\{view === 'library' && remote === 'Comics' && !everywhere && !folder && !query && items !== null \? html`<section class="bundles">/.test(app), 'no static copy above the list');
  assert.ok(app.includes('api.comicBundles()') && app.includes('downloadBundle') && app.includes('Download All'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'native', 'bridge.js'), 'utf8').includes("'/api/comic-bundles'"));
});

test('a file in a game folder shows the part of its name that tells the pieces apart', async () => {
  const { fileSuffix } = await import('../renderer/native/format.mjs');
  assert.equal(fileSuffix('A Plague Tale - Innocence v4336652 -ARMGDDN.part1.rar'), '.part1.rar');
  assert.equal(fileSuffix('A Plague Tale - Innocence v4336652 -ARMGDDN.part12.rar'), '.part12.rar');
  assert.equal(fileSuffix('Game -ARMGDDN.7z.001'), '.7z.001');
  assert.equal(fileSuffix('Game -ARMGDDN.zip'), '.zip');
  assert.equal(fileSuffix('Setup.exe'), '.exe');
  assert.equal(fileSuffix('archive.part03.rar'), '.part03.rar');
  assert.equal(fileSuffix('No extension at all'), '');
});
