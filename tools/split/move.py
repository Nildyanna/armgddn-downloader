#!/usr/bin/env python3
"""Move top-level functions out of main.js into a module under main/ (the main.js split, Nov 24 2026; docs/MAIN_SPLIT.md).

    python3 tools/split/move.py <module name> <function> [<function> ...]

Each function moves with the comment lines right above it, unchanged. The module gets 'use strict', the requires it needs
(--requires "const path = require('path');"), and module.exports of the moved names. main.js gets one line,
const { a, b } = require('./main/<module>');, placed with the other local requires near the top, so every caller keeps working
under the same names. A name already exported by that module is added to the same line. Pure moves only: no edits to the code.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / 'main.js'
ANCHOR = "// ---- split-out modules (docs/MAIN_SPLIT.md) ----"


def find(lines, name):
    pat = re.compile(r'^(async )?function ' + re.escape(name) + r'\s*\(')
    hits = [i for i, l in enumerate(lines) if pat.match(l)]
    if len(hits) != 1:
        sys.exit(f'{name}: expected one top-level definition, found {len(hits)}')
    i = hits[0]
    j = i
    if not lines[i].rstrip().endswith('}'):
        j = i + 1
        while j < len(lines) and not lines[j].startswith('}'):
            j += 1
    c = i
    while c > 0 and lines[c - 1].startswith('//'):
        c -= 1
    return c, j


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('module')
    ap.add_argument('names', nargs='+')
    ap.add_argument('--requires', default='', help='lines the module needs at the top, separated by ;; ')
    ap.add_argument('--doc', default='', help='one-line description for the module header')
    a = ap.parse_args()

    lines = MAIN.read_text().split('\n')
    spans = sorted((find(lines, n) + (n,) for n in a.names), reverse=True)
    moved = []
    for c, j, n in spans:
        moved.insert(0, '\n'.join(lines[c:j + 1]))
        del lines[c:j + 1]
        if c < len(lines) and lines[c] == '' and c > 0 and lines[c - 1] == '':
            del lines[c]
    # keep source order in the module
    order = {n: min(i for i, l in enumerate(MAIN.read_text().split('\n')) if re.match(r'^(async )?function ' + re.escape(n) + r'\s*\(', l)) for n in a.names}
    names_in_order = sorted(a.names, key=lambda n: order[n])
    blocks = dict(zip([s[2] for s in sorted(spans, key=lambda s: s[0])], [b for b in moved]))
    blocks = {n: b for n, b in zip(sorted(a.names, key=lambda n: order[n]), moved)}

    mod = ROOT / 'main' / (a.module + '.js')
    mod.parent.mkdir(exist_ok=True)
    if mod.exists():
        src = mod.read_text()
        m = re.search(r'module\.exports = \{([^}]*)\};\n?$', src)
        have = [x.strip() for x in m.group(1).split(',') if x.strip()]
        body = src[:m.start()].rstrip('\n') + '\n\n' + '\n\n'.join(blocks[n] for n in names_in_order) + '\n\n'
        allnames = have + [n for n in names_in_order if n not in have]
    else:
        head = ["'use strict';", f'// {a.doc or a.module} (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).']
        req = [r.strip() for r in a.requires.split(';;') if r.strip()]
        body = '\n'.join(head) + '\n' + ('\n'.join(req) + '\n' if req else '') + '\n' + '\n\n'.join(blocks[n] for n in names_in_order) + '\n\n'
        allnames = names_in_order
    mod.write_text(body + 'module.exports = { ' + ', '.join(allnames) + ' };\n')

    text = '\n'.join(lines)
    req_line_re = re.compile(r"^const \{ ([^}]*) \} = require\('\./main/" + re.escape(a.module) + r"'\);$", re.M)
    m = req_line_re.search(text)
    if m:
        have = [x.strip() for x in m.group(1).split(',')]
        new = have + [n for n in names_in_order if n not in have]
        text = text[:m.start()] + "const { " + ', '.join(new) + " } = require('./main/" + a.module + "');" + text[m.end():]
    else:
        line = "const { " + ', '.join(names_in_order) + " } = require('./main/" + a.module + "');"
        if ANCHOR not in text:
            # right after the Node built-ins at the top, before anything runs
            ls = text.split('\n')
            k = ls.index("const os = require('os');")
            ls.insert(k + 1, ANCHOR)
            text = '\n'.join(ls)
        text = text.replace(ANCHOR, ANCHOR + '\n' + line, 1)
    MAIN.write_text(text)
    print(f'moved {len(a.names)} function(s) to main/{a.module}.js; main.js now {len(text.splitlines())} lines')


if __name__ == '__main__':
    main()
