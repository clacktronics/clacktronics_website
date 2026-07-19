# Clacktronics website — ClackOS

A retro desktop-style website. The **visuals live in a single template**
(`index.html` + `assets/`), and **all content lives in markdown files** under
`content/`, organised in folders that mirror the menu bar:

```
index.html                  ← page shell (menu bar, desktop, taskbar)
assets/
  css/clackos.css           ← all styling (the "template")
  backgrounds/              ← bitmap desktop tiles (PNG/JPEG/GIF/WebP/BMP)
  themes/                   ← one editable colour theme per CSS file
    clackos.css             ← default palette
    midnight.css            ← example dark palette
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
  applications/             ← APPLICATIONS menu
    menu.json
    appearance.html         ← background + theme chooser
    paint.html              ← ClackPaint app
    recorder.html           ← Sound Recorder app
    video/                  ← browser-only Video Lab app + FFmpeg core
    about.md
```

Apps (`*.html`) are complete standalone pages — open
`content/applications/paint.html` directly and it works on its own — and
ClackOS shows the very same page inside a desktop window (an iframe). They
share `assets/css/app.css` for the look.

There is **no build step**: the browser fetches `site.json`, each folder's
`menu.json`, and the markdown files at runtime. Edit a `.md` file, refresh,
done. Hosted on GitHub Pages (or any static host).

## Colour themes

Colour templates live as standalone CSS files in `assets/themes/`. Each file
only sets the shared ClackOS colour variables, so one palette applies to the
desktop, Markdown windows and same-origin application windows. The active file
and the list shown in the editor are configured in `content/site.json`:

```json
"theme": "clackos.css",
"themes": ["clackos.css", "midnight.css"]
```

Open **Applications → Theme Editor…** to change the palette with colour
pickers and preview it live across the website. The File menu can open a theme
already on the website, open/save a local `.css` file, or commit the current
theme to GitHub. Committing always creates or updates one file under
`assets/themes/`, registers it in `content/site.json`, and can make it the
active website theme. It uses the same fine-grained GitHub token approach as
the Markdown editor; the token is kept only in memory for that editor window.

Theme filenames are restricted to letters, numbers, dots, underscores and
hyphens and must end in `.css`. This keeps every template self-contained in the
theme folder and prevents the editor from writing elsewhere in the repository.

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
- `[label](app:applications/video/index.html?src=content%2Fmedia%2Fdemo.mp4)`
  — link that launches a registered application with startup options
- `[label](app:applications/pdf-reader/index.html?file=content%2Ffiles%2Fmanual.pdf)`
  — opens a site-relative or CORS-enabled remote PDF in the PDF Reader
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
{ "type": "app", "page": "paint.html", "label": "ClackPaint…", "title": "ClackPaint",
  "width": 820, "height": 620, "multi": true }
```

Built-in actions: `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`.
`{ "type": "wallpapers" }` expands to the wallpaper picker. Wallpapers are
bitmap files under `assets/backgrounds/`, registered by name and filename in
the `backgrounds` array in `content/site.json`. `"app"` items open the given HTML
page from the same menu folder in a desktop window; `multi: true` opens a
fresh instance every time it's picked from the menu. Current apps:

Application links may include a query string. Only pages already registered as
`"type": "app"` in a menu can be launched, so Markdown cannot turn the desktop
into an arbitrary iframe launcher. The Markdown Editor's Insert menu creates
links for Video Lab and PDF Reader files, Falstad exported data or saved
circuit files, KiCad files, generic registered applications, Markdown windows,
and desktop actions.

- `applications/appearance.html` (Applications → System → Appearance) — a
  simple chooser for the registered bitmap background tiles and colour themes.
  Choices are saved in the browser and applied live to the desktop.
- `applications/recorder.html` (Applications → Sound Recorder…) — a Windows
  98-style sound recorder with the full sndrec32 feature set. Records from
  the microphone (needs HTTPS + permission) with a live oscilloscope;
  recordings are inserted at the current position like the original. File:
  New, Open, Save/Save As (16-bit mono .wav), Revert, Properties. Edit:
  Copy, Paste Insert, Paste Mix (one clipboard shared across instances via
  BroadcastChannel), Insert/Mix with File, Delete Before/After Current
  Position. Effects: Increase/Decrease Volume, Increase/Decrease Speed
  (pitch shifts, like the original), Add Echo, Reverse. Multi-instance.
- `applications/video/index.html` (Applications → Video Lab…) — a
  browser-only video player and editor with native preview plus a version-pinned
  FFmpeg WebAssembly compatibility/export engine. Supports forward and
  reverse playback, 0.25×–4× speed, full and A/B loops, clip insertion,
  cuts before/after the playhead, and a replacement or mixed audio layer.
  Exports MP4, WebM, MOV, MKV, AVI, GIF, MP3, WAV, Ogg, and custom containers;
  no media is uploaded. The app and codec core live in their own folder so the
  rest of ClackOS requires only the menu entry above.
- `applications/pdf-reader/index.html` (Applications → Internet → PDF Reader) — a
  MuPDF.js/WebAssembly reader with lazy page rendering, page and zoom
  navigation, fit-to-width, full-document text search, and password support.
  Open local files with the picker or drag-and-drop; File → Open from website…
  lists PDFs in the configured repository. Every opened PDF can also be
  downloaded or opened in the browser's external PDF viewer. `?file=` accepts
  paths relative to the site root as well as remote HTTP(S) URLs whose servers
  allow cross-origin browser requests. MuPDF.js 1.28.0 is vendored under
  `vendor/mupdf/` (AGPL-3.0; see its LICENSE and PROVENANCE files).
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
- `applications/markdown.html` (Applications → Markdown Editor…) — a
  markdown text editor built on EasyMDE (vendored under
  `vendor/easymde/`, MIT). Full markdown support: toolbar with
  headings, emphasis, strikethrough, quotes, lists, tables, code, links
  and images; syntax-highlighted editing; inline preview and
  side-by-side split rendered in the ClackOS style. Open/save uses the
  File System Access API where the browser supports it (true in-place
  saving); elsewhere saving downloads the file. Drag-and-drop works,
  Ctrl+S saves. File → Open from website… lists every markdown file the
  site serves (discovered from site.json, the menu.json files and the
  blog index) and opens it in the editor. File → Commit to website…
  publishes an edit straight to the repo through GitHub's contents API:
  it needs a fine-grained personal access token (GitHub → Settings →
  Developer settings → Fine-grained tokens; scope it to this repo only
  with Contents read & write and an expiry). The token is pasted once
  per session and held only in memory. The target repo/branch comes
  from `repo`/`branch` in content/site.json — update `branch` if the
  site moves to main. New blog posts committed this way are indexed
  automatically by the GitHub Action in
  .github/workflows/blog-index.yml, which regenerates blog.md on push. The toolbar icons are plain text glyphs, so nothing is
  fetched from icon CDNs.
- `applications/theme.html` (Applications → Theme Editor…) — edits the shared
  colour variables with a live desktop preview, propagates temporary colours to
  open ClackOS app windows, opens and saves standalone CSS theme files, and
  commits new or updated files to `assets/themes/` through GitHub's contents
  API. A commit also registers the filename in `content/site.json` and can set
  it as the active site theme.
- `applications/python.html` (Applications → Python…) — a Thonny-style
  Python IDE running entirely in the browser on Pyodide (vendored under
  `vendor/pyodide/`, MPL-2.0 — the same WASM CPython that powers
  PyScript), with a CodeMirror 5 editor (`vendor/codemirror5/`, MIT).
  Editor with Python syntax highlighting, a shell with a REPL and
  history, and Thonny's signature Variables pane showing every global's
  name, type and value after each run. Run (F5) executes the script in
  a worker; Stop/Restart terminates the worker and boots a fresh
  interpreter, so runaway loops can always be killed. Open/save .py
  files like the Markdown editor (File System Access API with download
  fallback, Ctrl+S). Only the core interpreter is vendored — installing
  packages with micropip fetches wheels from PyPI at runtime.
- `applications/paint.html` (Applications → ClackPaint) — a classic bitmap
  editor: pencil, brush, eraser, airbrush, flood fill, colour picker, clone
  stamp, soft blur, line, rectangle (outline/filled), ellipse and rectangular
  selection tools; Gaussian Blur and Noise effects; the
  classic 28-colour box with left/right-click foreground/background
  colours; arbitrary bitmap dimensions up to 8192 × 8192; undo/redo; local or
  website background opening; PNG saving; image-size resampling, anchored
  canvas resizing, crop selection, flip, invert and clear. A non-destructive
  50% X/Y offset checkbox below Tool Size previews wrapped edges for seam
  checking without changing the bitmap. File → Set as background tile stores a PNG tile in the browser
  and applies it to the desktop. Multi-instance.

The committed PNG tiles are generated by `scripts/build_background_tiles.py`
(Pillow is required only when regenerating them). The runtime never loads SVG
wallpapers.

### Adding a whole new menu

1. Create `content/<name>/` with a `menu.json`.
2. Add `<name>` to the `menus` array in `content/site.json`.

## Developing locally

`fetch()` doesn't work over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
