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
    allvars = {k: resolve(v, env) for k, v in env.items() if k.startswith('--') and not k.startswith('--side-art') and 'url(' not in v}
    t = {'mode': 'light' if tid in LIGHT else 'dark', 'bg': bg, 'panel': panel, 'fg': g('--text-primary'), 'dim': g('--text-secondary'), 'line': g('--border-color'), 'accent': accent, 'accent2': accent2 or accent}
    l = lum(accent)
    t['onAccent'] = '#04121a' if (l is None or l > 0.45) else '#ffffff'
    rc = g('--radius-card')
    if rc and re.fullmatch(r'[\d.]+px( [\d.]+px){0,3}', rc.strip()): t['radius'] = rc.strip()
    # The page background: the last `body` rule for the theme wins (the redesign file comes after app.css). Paths point at the copies in renderer/native/themes.
    bg_rules = blocks(css, r'(?:html)?\[data-theme="' + tid + r'"\]\s+body')
    page = bgcolor = None
    for rule in bg_rules:
        m = re.search(r'(?<![\w-])background\s*:\s*([^;]+(?:\([^)]*\)[^;]*)*);', rule, re.S)
        if m: page = m.group(1)
        m2 = re.search(r'background-color\s*:\s*([^;]+);', rule)
        if m2: bgcolor = re.sub(r'\s*!important', '', m2.group(1)).strip()
    if page:
        page = re.sub(r'\s*!important', '', page)
        page = re.sub(r'\s+', ' ', page).strip()
        page = page.replace("/static/themes/", "themes/").replace("'/Pirate-Background.jpg'", "'themes/pirate-bg.jpg'").replace('"/Pirate-Background.jpg"', "'themes/pirate-bg.jpg'").replace("'/FatNinja_Background.jpg'", "'themes/fatninja-bg.jpg'")
        page = re.sub(r"(top center|center top) / 100% auto repeat-y scroll", "center top / cover no-repeat fixed", page)
        if 'url(' in page and 'url(\'themes/' not in page and 'url("themes/' not in page: page = None
    if page: t['page'] = page
    if bgcolor: t['pageColor'] = bgcolor
    t['vars'] = allvars
    t.update(labels.get(tid, {}))
    themes[tid] = t

# The default (dark) comes from :root
dark = {'mode': 'dark', 'bg': root['--bg-primary'], 'panel': root['--bg-secondary'], 'fg': root['--text-primary'], 'dim': root['--text-secondary'], 'line': 'rgba(46, 242, 255, 0.38)', 'accent': resolve(root['--accent-primary'], root), 'accent2': resolve(root['--accent-secondary'], root), 'onAccent': '#04121a'}
dark['page'] = "linear-gradient(to bottom, rgba(5,4,12,.55) 0%, rgba(5,4,12,.78) 55%, rgba(5,4,12,.96) 100%), url('themes/pirate-bg.jpg') center top / cover no-repeat fixed"
dark['pageColor'] = '#05040c'
dark['vars'] = {k: resolve(v, root) for k, v in root.items() if k.startswith('--') and 'url(' not in v and not k.startswith('--side-art')}
dark.update(labels.get('dark', {}))
themes = {'dark': dark, **themes}
json.dump(themes, open(OUT, 'w'), indent=1, ensure_ascii=False)
print(len(themes), 'themes:', ', '.join(themes))


# ---- Theme rules (shapes, fonts, hover, header decoration), translated from the site's selectors to the app's ----
MAP = {'.header': '.banner', '.subtitle': '.banner p', '.remote-card': '.card', '.file-item': '.card', '.remote-name': '.card .title', '.file-name': '.card .title',
       '.remote-description': '.card .sub', '.file-meta': '.card .sub', '.browser-section': '.strip', '.toolbar': 'header', '.search-bar': '.search',
       '.trending-pill': '.strip', '.game-radar-panel': '.strip', '.btn-primary': '.primary', '.btn-secondary': '.dbtn', '.btn': '.dbtn'}

def top_level_rules(text):
    out = []; i = 0; n = len(text)
    while i < n:
        j = text.find('{', i)
        if j < 0: break
        sel = text[i:j].strip(); depth = 1; k = j + 1
        while k < n and depth:
            depth += {'{': 1, '}': -1}.get(text[k], 0); k += 1
        body = text[j + 1:k - 1]
        if not sel.startswith('@'): out.append((sel, body))
        i = k
    return out

def split_selectors(sel):
    parts = []; depth = 0; cur = ''
    for ch in sel:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0: parts.append(cur.strip()); cur = ''
        else: cur += ch
    if cur.strip(): parts.append(cur.strip())
    return parts

def translate_selector(one, tid):
    m = re.match(r'^(?:html)?\[data-theme="' + re.escape(tid) + r'"\]\s*(.*)$', one)
    if not m: return None
    rest = m.group(1).strip()
    if not rest: return None
    classes = re.findall(r'\.[A-Za-z][\w-]*', rest)
    if any(c not in MAP for c in classes): return None          # something the app does not have
    def sub(mm): return MAP[mm.group(0)]
    mapped = re.sub(r'\.[A-Za-z][\w-]*', sub, rest)
    if re.match(r'^body\b', rest): return None
    if not classes: return None
    return 'html[data-theme="' + tid + '"] ' + mapped

def keep_decls(body, only=None):
    return body

rules_out = []
alltext = css
for sel, body in top_level_rules(alltext):
    for tid in themes:
        if ('data-theme="' + tid + '"') not in sel: continue
        # body font
        for one in split_selectors(sel):
            mm = re.match(r'^(?:html)?\[data-theme="' + re.escape(tid) + r'"\]\s+body$', one)
            if mm:
                f = re.search(r'font-family\s*:\s*([^;]+);', body)
                if f: rules_out.append('html[data-theme="%s"] body { font-family: %s; }' % (tid, f.group(1).strip()))
        mapped = [x for x in (translate_selector(o, tid) for o in split_selectors(sel)) if x]
        if mapped:
            rules_out.append(', '.join(mapped) + ' { ' + re.sub(r'\s+', ' ', body.strip()) + ' }')
open(os.path.join(os.path.dirname(OUT), 'themes.css'), 'w').write('/* Generated by scripts/extract_themes.py from the website theme rules. Do not edit by hand. */\n' + '\n'.join(rules_out) + '\n')
print(len(rules_out), 'theme rules written to themes.css')
