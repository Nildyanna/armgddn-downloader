#!/usr/bin/env python3
"""Reads the website's theme palettes (src/app.css, then src/themes-redesign.css, which overrides it) and writes renderer/native/themes.json for the app.
Run again when the website's themes change. Usage: python3 scripts/extract_themes.py [path to the site's src folder]"""
import json, re, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/armgddn/src/ArmgddnBrowser/src'
OUT = os.path.join(os.path.dirname(__file__), '..', 'renderer', 'native', 'themes.json')
LIGHT = {'light', 'glacier', 'parchment', 'bubblegum', 'sage', 'oldskool'}

def blocks(css, selector_re):
    out = []
    for m in re.finditer(r'(?m)^\s*' + selector_re + r'\s*\{', css):
        i = m.end(); depth = 1
        while i < len(css) and depth:
            depth += {'{': 1, '}': -1}.get(css[i], 0); i += 1
        out.append(css[m.end():i - 1])
    return out

def decls(body):
    return {k.strip(): re.sub(r'\s*!important', '', v).strip() for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', body)}

css = ''
for name in ('app.css', 'themes-redesign.css'):
    p = os.path.join(SRC, name)
    if os.path.exists(p): css += '\n' + open(p, encoding='utf-8').read()

root = {}
for b in blocks(css, r':root'): root.update(decls(b))

def resolve(val, env, depth=0):
    m = re.fullmatch(r'var\((--[\w-]+)\)', val.strip())
    if m and depth < 6 and m.group(1) in env: return resolve(env[m.group(1)], env, depth + 1)
    return val

def lum(color):
    m = re.match(r'#([0-9a-fA-F]{6})', color.strip())
    if not m:
        m2 = re.match(r'rgba?\((\d+),\s*(\d+),\s*(\d+)', color.strip())
        if not m2: return None
        r, g, b = [int(x) for x in m2.groups()]
    else:
        h = m.group(1); r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

labels = {}
src = open(os.path.join(os.path.dirname(__file__), '..', 'renderer', 'native', 'theme_labels.json')).read() if os.path.exists(os.path.join(os.path.dirname(__file__), '..', 'renderer', 'native', 'theme_labels.json')) else '{}'
labels = json.loads(src)

themes = {}
ids = sorted(set(re.findall(r'(?m)^\s*\[data-theme="([a-z0-9-]+)"\]\s*\{', css)))
for tid in ids:
    if tid == 'system': continue          # follows the computer's light or dark setting; handled in the app
    env = dict(root)
    for b in blocks(css, r'\[data-theme="' + tid + r'"\]'): env.update(decls(b))
    g = lambda k, d=None: resolve(env.get(k, d), env) if env.get(k, d) else d
    bg, panel = g('--bg-primary'), g('--bg-secondary')
    accent, accent2 = g('--accent-primary'), g('--accent-secondary')
    if not (bg and panel and accent): continue
    t = {'mode': 'light' if tid in LIGHT else 'dark', 'bg': bg, 'panel': panel, 'fg': g('--text-primary'), 'dim': g('--text-secondary'), 'line': g('--border-color'), 'accent': accent, 'accent2': accent2 or accent}
    l = lum(accent)
    t['onAccent'] = '#04121a' if (l is None or l > 0.45) else '#ffffff'
    rc = g('--radius-card')
    if rc and re.fullmatch(r'[\d.]+px( [\d.]+px){0,3}', rc.strip()): t['radius'] = rc.strip()
    body = ''.join(blocks(css, r'\[data-theme="' + tid + r'"\]\s+body'))
    m = re.search(r'background(?:-color)?\s*:\s*([^;]+);', body, re.S)
    if m and 'url(' not in m.group(1): t['page'] = re.sub(r'\s+', ' ', m.group(1)).strip()
    t.update(labels.get(tid, {}))
    themes[tid] = t

# The default (dark) comes from :root
dark = {'mode': 'dark', 'bg': root['--bg-primary'], 'panel': root['--bg-secondary'], 'fg': root['--text-primary'], 'dim': root['--text-secondary'], 'line': 'rgba(46, 242, 255, 0.38)', 'accent': resolve(root['--accent-primary'], root), 'accent2': resolve(root['--accent-secondary'], root), 'onAccent': '#04121a'}
dark.update(labels.get('dark', {}))
themes = {'dark': dark, **themes}
json.dump(themes, open(OUT, 'w'), indent=1, ensure_ascii=False)
print(len(themes), 'themes:', ', '.join(themes))
