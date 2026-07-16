#!/usr/bin/env python3
"""Generate vendor/kicanvas/kicanvas-clackos.js from the pristine bundle.

KiCanvas compiles its themes into the bundle with no runtime hook for
custom colours, so this script rewrites the default (witch-hazel) theme's
colour literals — canvas palette and UI CSS variables — to the ClackOS
palette. Re-run after updating vendor/kicanvas/kicanvas.js; it fails
loudly if upstream changed a colour string so the map can be refreshed.
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'vendor' / 'kicanvas' / 'kicanvas.js'
dst = root / 'vendor' / 'kicanvas' / 'kicanvas-clackos.js'

# witch-hazel canvas palette -> ClackOS
CANVAS_MAP = {
    'rgb(19, 18, 24)': 'rgb(248, 242, 221)',     # background -> paper
    'rgb(40, 38, 52)': 'rgb(243, 236, 209)',     # alt background -> paper-deep
    'rgb(174, 129, 255)': 'rgb(39, 107, 71)',    # wires/fields -> leaf-deep
    'rgb(197, 163, 255)': 'rgb(138, 61, 46)',    # component outlines -> brick
    'rgb(220, 200, 255)': 'rgb(9, 20, 13)',      # junctions/local labels -> ink
    'rgb(129, 238, 255)': 'rgb(20, 35, 26)',     # reference/value/bus -> ink-soft
    'rgb(163, 243, 255)': 'rgb(39, 107, 71)',    # bus junction -> leaf-deep
    'rgb(67, 62, 86)': 'rgb(243, 236, 209)',     # component body -> paper-deep
    'rgb(129, 255, 190)': 'rgb(102, 117, 90)',   # pins/pin names -> sage
    'rgb(100, 203, 150)': 'rgb(138, 154, 122)',  # pin numbers -> light sage
    'rgb(255, 247, 129)': 'rgb(168, 132, 31)',   # global labels -> amber
    'rgb(163, 255, 207)': 'rgb(79, 174, 125)',   # hierarchical labels -> leaf
    'rgb(255, 129, 173)': 'rgb(160, 74, 58)',    # no-connect/axes -> red
    'rgb(248, 248, 240)': 'rgb(102, 117, 90)',   # notes -> sage
    'rgb(113, 103, 153)': 'rgb(216, 207, 169)',  # grid -> paper-line
    'rgb(200, 248, 255)': 'rgb(79, 174, 125)',   # hover shadow -> leaf
    'rgb(200, 255, 227)': 'rgb(79, 174, 125)',   # brightened -> leaf
    'rgb(78, 129, 137)': 'rgb(102, 117, 90)',    # sheet filename -> sage
    'rgb(100, 190, 203)': 'rgb(138, 61, 46)',    # worksheet frame -> brick
    'rgb(255, 160, 0)': 'rgb(168, 132, 31)',     # aux items -> amber
    'rgb(226, 114, 153)': 'rgb(160, 74, 58)',    # front copper -> red
    'rgb(111, 204, 219)': 'rgb(39, 107, 71)',    # back copper -> leaf-deep
}

# DNP / ERC markers
CANVAS_MAP['rgba(255, 55, 162, 0.800)'] = 'rgba(160, 74, 58, 0.800)'

# the kc-ui gradient stops (activity bar etc.): purple/blue sweeps -> green
GRADIENT_MAP = {
    'hsl(261deg 27% 42%)': 'hsl(160deg 40% 30%)',
    'hsl(243deg 27% 42%)': 'hsl(157deg 40% 32%)',
    'hsl(224deg 27% 42%)': 'hsl(154deg 40% 34%)',
    'hsl(205deg 27% 42%)': 'hsl(151deg 39% 36%)',
    'hsl(187deg 27% 42%)': 'hsl(149deg 38% 38%)',
    'hsl(168deg 27% 42%)': 'hsl(147deg 37% 40%)',
    'hsl(149deg 27% 42%)': 'hsl(145deg 37% 42%)',
    'hsl(261deg 27% 53%)': 'hsl(160deg 35% 42%)',
    'hsl(243deg 27% 52%)': 'hsl(157deg 35% 43%)',
    'hsl(224deg 27% 52%)': 'hsl(154deg 35% 44%)',
    'hsl(205deg 27% 51%)': 'hsl(151deg 35% 45%)',
    'hsl(186deg 27% 51%)': 'hsl(149deg 35% 46%)',
    'hsl(168deg 27% 50%)': 'hsl(147deg 35% 47%)',
    'hsl(149deg 27% 50%)': 'hsl(145deg 35% 48%)',
    'hsl(261deg 28% 30%)': 'hsl(158deg 42% 24%)',
    'hsl(248deg 30% 31%)': 'hsl(156deg 42% 25%)',
    'hsl(235deg 32% 32%)': 'hsl(154deg 41% 26%)',
    'hsl(222deg 34% 33%)': 'hsl(152deg 41% 27%)',
    'hsl(209deg 35% 34%)': 'hsl(150deg 40% 28%)',
    'hsl(197deg 37% 35%)': 'hsl(148deg 40% 29%)',
    'hsl(183deg 38% 36%)': 'hsl(146deg 39% 30%)',
    'hsl(183deg 63% 33%)': 'hsl(150deg 45% 33%)',
    'hsl(189deg 69% 30%)': 'hsl(152deg 45% 31%)',
    'hsl(194deg 74% 27%)': 'hsl(154deg 46% 29%)',
    'hsl(199deg 79% 24%)': 'hsl(156deg 46% 27%)',
    'hsl(203deg 85% 21%)': 'hsl(158deg 46% 25%)',
    'hsl(209deg 89% 18%)': 'hsl(160deg 47% 23%)',
    'hsl(214deg 95% 15%)': 'hsl(162deg 47% 21%)',
}

# kc-ui chrome CSS variables (panels, toolbar, inputs) -> ClackOS
UI_MAP = {
    '#282634': '#14231a',
    '#111928': '#09140d',
    '#1d162a': '#122019',
    '#cb6488': '#8a3d2e',
    '#b187ff': '#4fae7d',
    '#ff80ac': '#b86a4a',
    '#ff81ad': '#c05a44',
    '#81eeff': '#8fcaa8',
    '#a3f3ff': '#b3dcc4',
    '#81ffbe': '#7fc89f',
    '#464258': '#20342a',
    '#433e56': '#1e3126',
    '#131218': '#09140d',    # panel bg -> ink
    '#f8f8f0': '#f5efdb',    # panel fg -> menu-text
    '#ae81ffbb': '#4fae7dbb',
    '#ae81ff66': '#4fae7d66',
    '#ae81ff': '#4fae7d',    # accent -> leaf
    '#8077a8': '#66755a',    # muted -> sage
    '#634e89': '#276b47',    # active -> leaf-deep
    '#dcc8ff': '#8fcaa8',    # dim fg -> menu-dim
    '#64cb96': '#276b47',    # hover green -> leaf-deep
    '#8864cb': '#276b47',    # tooltip bg -> leaf-deep
}

text = src.read_text()
missing = []
for mapping in (CANVAS_MAP, GRADIENT_MAP, UI_MAP):
    for old, new in mapping.items():
        if old not in text:
            missing.append(old)
        text = text.replace(old, new)

if missing:
    sys.exit(f'colour strings not found in bundle (upstream changed?): {missing}')

dst.write_text(text)
print(f'wrote {dst.relative_to(root)} ({len(text)} bytes)')
