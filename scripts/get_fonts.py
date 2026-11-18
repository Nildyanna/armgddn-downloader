"""Bundles the Google Fonts the website's themes use, for the native app (offline, no runtime request to Google).
Reads the exact requests from the site's own CSS and theme-font table, asks Google for the stylesheet with a modern browser UA (so it answers
with woff2), and downloads only the `latin` subset of each face. Writes renderer/native/fonts/*.woff2 and renderer/native/fonts.css."""
import json, os, re, sys, urllib.request, hashlib

SITE = '/home/armgddn/src/ArmgddnBrowser'
OUT = '/home/armgddn/src/ArmgddnCompanion-native/renderer/native'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

queries = []
css = open(SITE + '/src/app.css', encoding='utf-8').read()
queries += re.findall(r"@import url\('https://fonts\.googleapis\.com/css2\?([^']*?)&display=swap'\)", css)
php = open(SITE + '/default.php', encoding='utf-8').read()
m = re.search(r'window\.__THEME_FONTS = (\{.*?\});', php, re.S)
theme_fonts = json.loads(m.group(1)) if m else {}
queries += list(theme_fonts.values())
print('requests:', len(queries), '(', len(theme_fonts), 'theme font entries )')

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=30).read()

os.makedirs(OUT + '/fonts', exist_ok=True)
faces, seen_files, total = [], {}, 0
for q in queries:
    sheet = get('https://fonts.googleapis.com/css2?' + q + '&display=swap').decode('utf-8')
    # blocks look like:  /* latin */\n@font-face { ... src: url(https://fonts.gstatic.com/...woff2) format('woff2'); unicode-range: ...; }
    for subset, block in re.findall(r'/\*\s*([a-z0-9-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})', sheet):
        if subset != 'latin':
            continue
        url = re.search(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', block).group(1)
        fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        style = re.search(r'font-style:\s*(\w+)', block).group(1)
        weight = re.search(r'font-weight:\s*([0-9 ]+);', block).group(1).strip()
        name = re.sub(r'[^A-Za-z0-9]+', '', fam) + '-' + style + '-' + weight.replace(' ', '_') + '.woff2'
        if url not in seen_files:
            data = get(url)
            if not data.startswith(b'wOF2'):
                print('SKIP (not woff2):', name); continue
            open(OUT + '/fonts/' + name, 'wb').write(data)
            seen_files[url] = (name, len(data)); total += len(data)
        name = seen_files[url][0]
        faces.append("@font-face { font-family: '%s'; font-style: %s; font-weight: %s; font-display: swap; src: url('fonts/%s') format('woff2'); }" % (fam, style, weight, name))

# one rule per distinct face
uniq = list(dict.fromkeys(faces))
open(OUT + '/fonts.css', 'w').write('/* Bundled Google Fonts (latin subset) for the themes; made by scripts/get_fonts.py. Licenses: SIL Open Font License / Apache 2.0 (see fonts/LICENSES.txt). */\n' + '\n'.join(uniq) + '\n')
fams = sorted({re.search(r"font-family: '([^']+)'", f).group(1) for f in uniq})
print('families (%d): %s' % (len(fams), ', '.join(fams)))
print('files: %d, bytes: %d (%.2f MB), @font-face rules: %d' % (len(seen_files), total, total / 1048576, len(uniq)))
