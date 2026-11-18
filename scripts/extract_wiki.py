#!/usr/bin/env python3
"""Copies the website's Wiki into renderer/native/wiki.json, one entry per numbered section (read only: the site page is never changed).
Usage: scripts/extract_wiki.py /path/to/ArmgddnBrowser/default.php
The Wiki text lives inside <div id="wikiOverlay"> ... <div class="wiki-panel-body"> in that page. Inline handlers are removed (the app does not allow
them); links that open another Wiki section become data-wiki attributes, other links keep their address and open through the app's link handler."""
import json, os, re, sys, html as htmllib

src = sys.argv[1] if len(sys.argv) > 1 else '/home/armgddn/src/ArmgddnBrowser/default.php'
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'renderer', 'native', 'wiki.json')
page = open(src, encoding='utf-8', errors='replace').read()

overlay = page.index('id="wikiOverlay"')   # other overlays reuse the same panel classes
start = page.index('<div class="wiki-panel-body">', overlay)
pos = start + len('<div class="wiki-panel-body">')
depth = 1
for m in re.finditer(r'<div\b|</div>', page[pos:]):
    depth += 1 if m.group(0) != '</div>' else -1
    if depth == 0:
        body = page[pos:pos + m.start()]
        break
else:
    raise SystemExit('could not find the end of the Wiki body')

# php short tags inside the Wiki would be server side; there should be none
if '<?' in body:
    print('warning: PHP tags found in the Wiki body; they are left as text', file=sys.stderr)

def clean(fragment):
    f = fragment
    # links to another section: onclick="openWiki('wikiLinux'); return false;"  ->  data-wiki="wikiLinux"
    f = re.sub(r'(<a\b[^>]*?)\s+onclick="openWiki\(\'([A-Za-z0-9_-]+)\'\)[^"]*"', r'\1 data-wiki="\2"', f)
    f = re.sub(r'\s+on[a-z]+="[^"]*"', '', f)               # any other inline handler
    f = re.sub(r"\s+on[a-z]+='[^']*'", '', f)
    f = re.sub(r'<script\b.*?</script>', '', f, flags=re.S | re.I)
    # site-relative images and links become absolute so the app can fetch them
    f = re.sub(r'(src|href)="/(?!/)', r'\1="https://www.armgddnbrowser.com/', f)
    return f

parts = re.split(r'(?=<h2\b)', body)
sections = []
for part in parts:
    m = re.match(r'<h2\b([^>]*)>(.*?)</h2>', part, flags=re.S)
    if not m:
        continue
    attrs, title_html = m.group(1), m.group(2)
    title = htmllib.unescape(re.sub(r'<[^>]+>', '', title_html)).strip()
    idm = re.search(r'id="([^"]+)"', attrs)
    num = re.match(r'(\d+)\.', title)
    sid = idm.group(1) if idm else ('wiki' + (num.group(1) if num else str(len(sections) + 1)))
    sections.append({'id': sid, 'title': title, 'html': clean(part[m.end():]).strip()})

os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({'source': 'ArmgddnBrowser default.php #wikiOverlay', 'sections': sections}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(sections)} sections, {sum(len(s["html"]) for s in sections)} characters -> {out}')
for s in sections:
    print(f'  {s["id"]:14s} {s["title"][:70]}')
