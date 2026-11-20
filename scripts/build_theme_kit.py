#!/usr/bin/env python3
"""Builds the theme kit: a folder (and a zip) with a standalone preview page, the app's own CSS and fonts, the existing themes and their images, so a theme can be
made and looked at in any browser, without the app. Usage: python3 scripts/build_theme_kit.py [output folder]   (default: dist-theme-kit/)"""
import json, os, shutil, sys, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
NATIVE = os.path.join(ROOT, 'renderer', 'native')
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-theme-kit')

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
for f in ('fonts.css', 'native.css', 'themes.css', 'themes-custom.css', 'skull-logo.png'):
    p = os.path.join(NATIVE, f)
    if os.path.exists(p):
        shutil.copy(p, OUT)
for d in ('fonts', 'themes'):
    shutil.copytree(os.path.join(NATIVE, d), os.path.join(OUT, d))
shutil.copy(os.path.join(ROOT, 'tools', 'theme-kit', 'preview.html'), OUT)
shutil.copy(os.path.join(ROOT, 'NATIVE_THEME_GUIDE.md'), OUT)

themes = {}
for name in ('themes.json', 'themes-custom.json'):
    p = os.path.join(NATIVE, name)
    if os.path.exists(p):
        themes.update(json.load(open(p, encoding='utf-8')))
open(os.path.join(OUT, 'preview-data.js'), 'w', encoding='utf-8').write('window.KIT_THEMES = ' + json.dumps(themes, ensure_ascii=False) + ';\n')
open(os.path.join(OUT, 'README.txt'), 'w', encoding='utf-8').write(
    'ARMGDDN theme kit\n\n1. Open preview.html in any browser (double-click it).\n2. Use "Load your palette" and "Load your CSS" in the box at the bottom right to try your own theme.\n'
    '3. Read NATIVE_THEME_GUIDE.md for what to make and what to send back.\n4. Put your own images in the themes folder (refer to them as url(\'themes/name.svg\')).\n')

zpath = OUT + '.zip'
if os.path.exists(zpath):
    os.remove(zpath)
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(OUT):
        for f in files:
            full = os.path.join(base, f)
            z.write(full, os.path.join('theme-kit', os.path.relpath(full, OUT)))
print('kit:', OUT, '| zip:', zpath, '|', round(os.path.getsize(zpath) / 1e6, 2), 'MB |', len(themes), 'themes')
