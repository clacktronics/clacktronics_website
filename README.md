# Clacktronics website — ClackOS

A retro desktop-style website. The **visuals live in a single template**
(`index.html` + `assets/`), and **all content lives in markdown files** under
`content/`, organised in folders that mirror the menu bar:

```
index.html                  ← page shell (menu bar, desktop, taskbar)
assets/
  css/clackos.css           ← all styling (the "template")
  js/clackos.js             ← window manager, menu builder, markdown renderer
content/
  site.json                 ← menu order + which windows open at boot
  file/                     ← FILE menu
    menu.json               ← items in this menu, in order
    home.md                 ← the landing window
    readme.md
    catalogue.md
    blog.md                 ← blog index (generated, see below)
    blog/                   ← one post per file: YYYY-MM-DD-slug.md
  edit/                     ← EDIT menu (actions only)
    menu.json
  view/                     ← VIEW menu (actions only)
    menu.json
  desktop/                  ← DESKTOP menu
    menu.json
    patterns.html           ← pattern editor app
  applications/             ← APPLICATIONS menu
    menu.json
    paint.html              ← Paint app
    recorder.html           ← Sound Recorder app
    about.md
```

Apps (`*.html`) are complete standalone pages — open
`content/applications/paint.html` directly and it works on its own — and
ClackOS shows the very same page inside a desktop window (an iframe). They
share `assets/css/app.css` for the look.

There is **no build step**: the browser fetches `site.json`, each folder's
`menu.json`, and the markdown files at runtime. Edit a `.md` file, refresh,
done. Hosted on GitHub Pages (or any static host).

## Adding or editing content

### A new window

1. Drop a markdown file into the folder of the menu it belongs to, e.g.
   `content/file/projects.md`.
2. Add an entry to that folder's `menu.json`:

   ```json
   { "type": "window", "md": "projects.md", "label": "Open Projects" }
   ```

Each markdown file starts with frontmatter describing its window:

```markdown
---
title: Projects            ← titlebar / taskbar text
style: plain               ← "plain" or "page" (rich landing-page look)
tagline: Optional line     ← rendered under the h1 with a rule
width: 480                 ← optional; px or % (default: 80% of the desktop)
height: 60%
---
```

### Blog posts

Posts live in `content/file/blog/` as `YYYY-MM-DD-slug.md` files with the
same frontmatter as any window (use `tagline:` for the displayed date).
They were converted from the old Jekyll/WordPress site; images point at
`https://clacktronics.co.uk/assets/`.

To add a post: drop the file in `content/file/blog/`, then regenerate the
index window:

```sh
python3 scripts/build_blog_index.py
```

This rewrites `content/file/blog.md` (the window behind File → Open Blog),
listing every post newest-first, grouped by year.

### Markdown that the renderer understands

- `# Heading` — window heading (in `page` style, followed by the tagline and rule)
- `## Text` — small green eyebrow label (e.g. `## // What we make`)
- `**bold**`, `*italic*`
- `` `text` `` — green keyword highlight (used for `$`, part numbers, hex colours)
- `1. item` — numbered feature list, rendered as the bordered `01/02/03` box
- `![alt](src)` — image (linked images `[![](thumb)](full)` work too)
- ` ``` ` fenced code blocks
- `> quote` — blockquote
- `[label](window:file/catalogue.md)` — link that opens another window
- `[label](action:tidy)` — link that runs a desktop action
- `[label](https://…)` — normal external link
- A paragraph containing **only** links becomes the button row (first button solid, rest ghost)
- `---` — horizontal rule; a `---` before the final paragraph turns that
  paragraph into the window footer (one `<span>` per line)
- Single line breaks inside a paragraph are kept as `<br>`

### Menu items (`menu.json`)

```json
{ "type": "window", "md": "home.md", "label": "Open Clacktronics", "shortcut": "⌘O" }
{ "type": "action", "action": "close-front", "label": "Close front window" }
{ "type": "action", "label": "Undo", "disabled": true }
{ "type": "sep" }
{ "type": "wallpapers" }
```

```json
{ "type": "app", "page": "paint.html", "label": "Paint…", "title": "Paint",
  "width": 820, "height": 620, "multi": true }
```

Built-in actions: `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`.
`{ "type": "wallpapers" }` expands to the wallpaper picker (wallpapers are SVG
tiles defined in `assets/js/clackos.js`). `"app"` items open the given HTML
page from the same menu folder in a desktop window; `multi: true` opens a
fresh instance every time it's picked from the menu. Current apps:

- `desktop/patterns.html` (Desktop → Edit pattern…) — a Windows 3-style 8×8
  desktop pattern editor. Saved patterns live in the browser's localStorage,
  appear in the Desktop menu alongside the built-in wallpapers, and the
  chosen wallpaper is remembered between visits. The desktop listens for
  localStorage changes, so applying works live from the windowed app, a
  standalone tab, or another window.
- `applications/recorder.html` (Applications → Sound Recorder…) — a Windows
  98-style sound recorder with the full sndrec32 feature set. Records from
  the microphone (needs HTTPS + permission) with a live oscilloscope;
  recordings are inserted at the current position like the original. File:
  New, Open, Save/Save As (16-bit mono .wav), Revert, Properties. Edit:
  Copy, Paste Insert, Paste Mix (one clipboard shared across instances via
  BroadcastChannel), Insert/Mix with File, Delete Before/After Current
  Position. Effects: Increase/Decrease Volume, Increase/Decrease Speed
  (pitch shifts, like the original), Add Echo, Reverse. Multi-instance.
- `applications/circuit.html` (Applications → Circuit Simulator…) — Paul
  Falstad's CircuitJS1, vendored unmodified under `vendor/circuitjs1/`
  (GPLv2 — see the COPYING.txt and PROVENANCE.md there). The wrapper
  page applies the ClackOS colour theme in two vendor-untouched layers:
  canvas colours through CircuitJS1's own startup URL parameters
  (whiteBackground, positiveColor, …, euroResistors), and the GUI chrome
  (menus, toolbar, dialogs, side panel) by injecting
  `assets/css/circuitjs-skin.css` into the same-origin iframe after
  load. Load your own circuit at startup by dropping a
  CircuitJS text file in `content/applications/circuits/` and opening
  `circuit.html?circuit=<name>.txt` — the wrapper compresses it into the
  simulator's `ctz` parameter. `?ctz=` links exported from the simulator
  itself (File → Export as Link) pass straight through.
- `applications/kicad.html` (Applications → KiCAD Viewer…) — views KiCAD
  schematics and boards using KiCanvas (vendored under `vendor/kicanvas/`,
  MIT — see LICENSE.md and PROVENANCE.md there). KiCanvas compiles its
  themes into the bundle, so `scripts/build_kicanvas_theme.py` generates
  `kicanvas-clackos.js` from the pristine bundle by remapping the default
  theme's colours to the ClackOS palette — re-run it after updating the
  vendor bundle. Open files with the button or drag-and-drop (several at
  once works), or link to a file kept in `content/applications/kicad/`
  with `kicad.html?file=<name>`.
- `applications/eecircuit.html` (Applications → EEcircuit (SPICE)…) —
  EEcircuit, a browser SPICE simulator (ngspice as WebAssembly) with a
  netlist editor and WebGL plotting, mirrored from eecircuit.com under
  `vendor/eecircuit/` (app and engine are MIT — see LICENSE and
  PROVENANCE.md there). The schematic-editor component is not openly
  licensed, so it is not redistributed: its workers are stubbed and the
  Schematic tab hidden — netlist simulation and plotting are fully
  functional. The ClackOS look is injected via
  `assets/css/eecircuit-skin.css`.
- `applications/paint.html` (Applications → Paint…) — a Windows 95-style
  Paint: pencil, brush, eraser, airbrush, flood fill, colour picker, line,
  rectangle (outline/filled) and ellipse tools with a size slider; the
  classic 28-colour box with left/right-click foreground/background
  colours; undo/redo; File New/Open/Save (PNG download); Image menu with
  Clear, Invert Colours and Flip Horizontal/Vertical. Multi-instance.

### Adding a whole new menu

1. Create `content/<name>/` with a `menu.json`.
2. Add `<name>` to the `menus` array in `content/site.json`.

## Developing locally

`fetch()` doesn't work over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
