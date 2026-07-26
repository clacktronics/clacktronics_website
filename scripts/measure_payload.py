#!/usr/bin/env python3
"""Measure ClackOS transfer weight: raw bytes vs. bytes-on-the-wire.

Bytes-on-the-wire follows the deploy config in .htaccess:
  - mod_deflate gzips text/html, css, js, json, svg, xml
  - .wasm is pre-gzipped at deploy time and served Content-Encoding: gzip
  - everything else (png, ico, fonts, zip, models) transfers raw
"""
import gzip, json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

GZIPPED_EXT = {'.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg',
               '.xml', '.txt', '.md', '.map', '.wasm'}

_cache = {}


def measure(rel):
    """(raw, wire) for one repo-relative path."""
    if rel in _cache:
        return _cache[rel]
    p = ROOT / rel
    if not p.is_file():
        return (0, 0)
    data = p.read_bytes()
    raw = len(data)
    if p.suffix.lower() in GZIPPED_EXT:
        wire = len(gzip.compress(data, 6))
    else:
        wire = raw
    _cache[rel] = (raw, wire)
    return (raw, wire)


def total(paths):
    raw = wire = 0
    for rel in paths:
        r, w = measure(rel)
        raw += r
        wire += w
    return raw, wire


def expand(patterns):
    """Expand a list of repo-relative paths/globs into concrete files."""
    out = []
    for pat in patterns:
        if pat.endswith('/**'):          # pathlib's bare ** matches dirs only
            pat = pat[:-3]
        if any(ch in pat for ch in '*?['):
            out += [str(p.relative_to(ROOT)) for p in sorted(ROOT.glob(pat)) if p.is_file()]
        else:
            p = ROOT / pat
            if p.is_dir():
                out += [str(q.relative_to(ROOT)) for q in sorted(p.rglob('*')) if q.is_file()]
            elif p.is_file():
                out.append(pat)
    # de-dupe, preserve order
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


REF_RE = re.compile(r'(?:src|href)\s*=\s*["\']([^"\'#?]+)', re.I)
CSS_URL_RE = re.compile(r'url\(\s*["\']?([^"\')#?]+)', re.I)


def static_refs(entry, depth=2, _seen=None):
    """Resolve local src/href/url() refs from an HTML/CSS file, recursively."""
    if _seen is None:
        _seen = set()
    entry = os.path.normpath(entry)
    if entry in _seen or depth < 0:
        return _seen
    p = ROOT / entry
    if not p.is_file():
        return _seen
    _seen.add(entry)
    try:
        text = p.read_text(errors='ignore')
    except Exception:
        return _seen
    base = os.path.dirname(entry)
    refs = REF_RE.findall(text)
    if p.suffix.lower() == '.css':
        refs += CSS_URL_RE.findall(text)
    for ref in refs:
        if re.match(r'^(https?:|data:|mailto:|javascript:|//)', ref, re.I):
            continue
        target = os.path.normpath(os.path.join(base, ref.lstrip('/')))
        if target.startswith('..'):
            continue
        if (ROOT / target).is_file():
            static_refs(target, depth - 1, _seen)
    return _seen


# ---------------------------------------------------------------- initial load

# The desktop shell: what a first-time visitor on a cold cache pulls before the
# desktop is usable. clackos.js fetches site.json, then each menu.json listed in
# it, then the boot window (file/home.md).
SHELL_CRITICAL = [
    'index.html',
    'assets/css/icons.css',
    'assets/css/clackos.css',
    'assets/themes/clackos.css',
    'assets/js/backgrounds.js',
    'assets/js/events.js',
    'assets/js/clackos.js',
]
SHELL_RUNTIME = [
    'content/site.json',
    'content/file/menu.json',
    'content/view/menu.json',
    'content/applications/menu.json',
    'content/desktop/menu.json',
    'content/file/home.md',
    'assets/icons/favicon.png',
    'assets/backgrounds/sand-dots.png',
]

# ------------------------------------------------------------------- app rules
# Each app: (label, wrapper globs, vendor globs actually fetched at runtime).
# Vendor sets are the files a browser really pulls, not whole directories --
# several vendors ship multiple mutually-exclusive builds (GWT permutations,
# ORT wasm variants, Monaco language workers) of which exactly one is loaded.

SHARED_APP_CHROME = ['assets/css/app.css']

APPS = [
    ('Clacksweeper',            ['content/applications/clacksweeper.html'], []),
    ('Solitaire',               ['content/applications/solitaire.html'], ['vendor/solitaire/*']),
    ('QBasic 1.1',              ['content/applications/qbasic.html', 'content/applications/qbasic/**'],
                                ['vendor/js-dos-6.22/js-dos.js', 'vendor/js-dos-6.22/wdosbox.js',
                                 'vendor/js-dos-6.22/wdosbox.wasm.js']),
    ('Clackbase MIDI Sequencer',['content/applications/clackbase.html'], []),
    ('Pure Data',               ['content/applications/puredata.html'], ['vendor/webpd/dist/src/**']),
    ('Video Lab',               ['content/applications/video/index.html', 'content/applications/video/vendor/**'], []),
    ('Sound Recorder',          ['content/applications/recorder.html'], []),
    ('ClackPaint',              ['content/applications/paint.html', 'content/applications/paint-worker.js'], []),
    ('Graphite',                ['content/applications/graphite.html', 'assets/css/graphite-skin.css'],
                                ['vendor/graphite/index.html', 'vendor/graphite/assets/*.js',
                                 'vendor/graphite/assets/*.css', 'vendor/graphite/assets/*.wasm']),
    ('3D Model Viewer',         ['content/applications/model-viewer.html'], []),
    ('Graphing Calculator',     ['content/applications/graphing-calculator.html'], []),
    ('Python',                  ['content/applications/python.html'],
                                ['vendor/codemirror5/codemirror.js', 'vendor/codemirror5/codemirror.css',
                                 'vendor/codemirror5/python.js', 'vendor/pyodide/pyodide.mjs',
                                 'vendor/pyodide/pyodide.asm.mjs', 'vendor/pyodide/pyodide.asm.wasm',
                                 'vendor/pyodide/python_stdlib.zip', 'vendor/pyodide/pyodide-lock.json']),
    ('Processing',              ['content/applications/processing.html'],
                                ['vendor/processingjs/processing.min.js',
                                 'vendor/codemirror5/codemirror.js', 'vendor/codemirror5/codemirror.css',
                                 'vendor/codemirror5/clike.js']),
    ('OpenSCAD',                ['content/applications/openscad.html', 'content/applications/openscad/**'], []),
    ('Circuit Simulator',       ['content/applications/circuit.html', 'assets/css/circuitjs-skin.css',
                                 'content/applications/circuits/**'],
                                ['vendor/circuitjs1/circuitjs.html', 'vendor/circuitjs1/lz-string.min.js',
                                 'vendor/circuitjs1/font/**', 'vendor/circuitjs1/circuitjs1/circuitjs1.nocache.js',
                                 'vendor/circuitjs1/circuitjs1/5157D0F4782D12D06541B1B1A9DC2F57.cache.js']),
    ('EEcircuit (SPICE)',       ['content/applications/eecircuit.html', 'assets/css/eecircuit-skin.css'],
                                ['vendor/eecircuit/index.html', 'vendor/eecircuit/assets/index-*.js',
                                 'vendor/eecircuit/assets/chunk-*.js', 'vendor/eecircuit/assets/flex-*.js',
                                 'vendor/eecircuit/assets/box-*.js', 'vendor/eecircuit/assets/circle-*.js',
                                 'vendor/eecircuit/assets/stack-*.js', 'vendor/eecircuit/assets/*.css',
                                 'vendor/eecircuit/assets/simulationWorker-*.js']),
    ('KiCAD Viewer',            ['content/applications/kicad.html', 'content/applications/kicad/**'],
                                ['vendor/kicanvas/kicanvas-clackos.js']),
    ('Eurorack Panel Generator',['content/applications/eurorack-panel.html'], []),
    ('PCB Heater Designer',     ['content/applications/pcb-heater.html'], []),
    ('Resistor Calculator',     ['content/applications/resistor.html'], []),
    ('Web Browser',             ['content/applications/browser.html'], []),
    ('PDF Reader',              ['content/applications/pdf-reader/**'],
                                ['vendor/mupdf/mupdf.js', 'vendor/mupdf/mupdf-wasm.js',
                                 'vendor/mupdf/mupdf-wasm.wasm']),
    ('Markdown Editor',         ['content/applications/markdown.html'],
                                ['vendor/easymde/easymde.min.js', 'vendor/easymde/easymde.min.css',
                                 'vendor/codemirror5/codemirror.js', 'vendor/codemirror5/codemirror.css']),
    ('ClackChat',               ['content/applications/chat.html', 'content/applications/chat-worker.js'],
                                ['vendor/transformers/transformers.min.js',
                                 'vendor/transformers/ort-wasm-simd-threaded.jsep.wasm']),
    ('File Manager',            ['content/applications/files.html', 'assets/js/file-manager.js',
                                 'assets/css/file-manager.css'], []),
    ('Text Editor',             ['content/applications/text.html'], []),
    ('Calendar',                ['content/applications/calendar.html', 'content/applications/calendar/**'], []),
    ('Appearance',              ['content/applications/appearance.html'], []),
    ('Theme Editor',            ['content/applications/theme.html'], []),
]


def fmt(n):
    if n >= 1024 ** 2:
        return f'{n / 1024 ** 2:.1f} MB'
    if n >= 1024:
        return f'{n / 1024:.0f} kB'
    return f'{n} B'


def main():
    out = []
    crit_raw, crit_wire = total(SHELL_CRITICAL)
    run_raw, run_wire = total(SHELL_RUNTIME)

    out.append('=' * 78)
    out.append('INITIAL PAGE LOAD (desktop shell, cold cache)')
    out.append('=' * 78)
    out.append(f'{"file":<44}{"raw":>12}{"on the wire":>16}')
    out.append('-' * 78)
    for rel in SHELL_CRITICAL + SHELL_RUNTIME:
        r, w = measure(rel)
        mark = '  ' if rel in SHELL_CRITICAL else '* '
        out.append(f'{mark + rel:<44}{fmt(r):>12}{fmt(w):>16}')
    out.append('-' * 78)
    out.append(f'{"  render-blocking subtotal":<44}{fmt(crit_raw):>12}{fmt(crit_wire):>16}')
    out.append(f'{"* fetched by clackos.js after parse":<44}{fmt(run_raw):>12}{fmt(run_wire):>16}')
    out.append(f'{"  TOTAL to a usable desktop":<44}'
               f'{fmt(crit_raw + run_raw):>12}{fmt(crit_wire + run_wire):>16}')
    out.append('')
    out.append('  Not counted: Google Fonts (IBM Plex Mono + Dosis, ~2 CSS + 4-6 woff2,')
    out.append('  roughly 90-120 kB from fonts.gstatic.com, cross-origin and cached).')
    out.append('')

    # ------------------------------------------------------------------ apps
    out.append('=' * 78)
    out.append('PER-APP WEIGHT (on top of the shell, first open, cold cache)')
    out.append('=' * 78)
    out.append(f'{"app":<28}{"own code":>11}{"vendor":>11}{"raw":>11}{"on wire":>11}')
    out.append('-' * 78)

    rows = []
    for label, own_pat, vendor_pat in APPS:
        own = expand(own_pat)
        # follow the wrapper's own static refs (app.css, skins, shared js)
        extra = set()
        for e in own:
            if e.endswith(('.html', '.css')):
                extra |= static_refs(e, depth=2)
        own = sorted(set(own) | {e for e in extra if not e.startswith('vendor/')})
        vend = expand(vendor_pat)
        o_raw, o_wire = total(own)
        v_raw, v_wire = total(vend)
        rows.append((label, o_raw, o_wire, v_raw, v_wire))

    for label, o_raw, o_wire, v_raw, v_wire in sorted(rows, key=lambda r: -(r[2] + r[4])):
        out.append(f'{label:<28}{fmt(o_wire):>11}{fmt(v_wire):>11}'
                   f'{fmt(o_raw + v_raw):>11}{fmt(o_wire + v_wire):>11}')
    out.append('-' * 78)
    out.append('own code / vendor columns are on-the-wire bytes.')
    out.append('')

    # ------------------------------------------------- repo vs shipped totals
    out.append('=' * 78)
    out.append('VENDOR DIRECTORIES: on disk vs. what one session actually pulls')
    out.append('=' * 78)
    out.append(f'{"vendor":<24}{"on disk":>12}{"loaded raw":>14}{"loaded wire":>14}')
    out.append('-' * 78)
    loaded_by_vendor = {}
    for label, own_pat, vendor_pat in APPS:
        for rel in expand(vendor_pat):
            top = '/'.join(rel.split('/')[:2])
            loaded_by_vendor.setdefault(top, set()).add(rel)
    for d in sorted(ROOT.glob('vendor/*')):
        if not d.is_dir():
            continue
        key = f'vendor/{d.name}'
        disk = sum(p.stat().st_size for p in d.rglob('*') if p.is_file())
        files = sorted(loaded_by_vendor.get(key, []))
        l_raw, l_wire = total(files)
        out.append(f'{d.name:<24}{fmt(disk):>12}{fmt(l_raw):>14}{fmt(l_wire):>14}')
    out.append('')

    text = '\n'.join(out)
    print(text)
    Path(sys.argv[1]).write_text(text + '\n') if len(sys.argv) > 1 else None


if __name__ == '__main__':
    main()
