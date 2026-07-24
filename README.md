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
ClackOS shows the same page inside a desktop window. Apps use an iframe by
default; trusted system utilities marked `"integrated": true` in `menu.json`
mount into an isolated shadow root instead. They share `assets/css/app.css`
for the look and retain their standalone entry points.

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
pickers and preview it live across the website. Its Template file dropdown is
populated from the CSS themes registered in `content/site.json`, while the
separate Theme file field keeps Save As and new-theme workflows available.
The File menu can open a theme
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
- `@[youtube](https://youtu.be/VIDEO_ID "Optional title")` — responsive inline
  YouTube player (regular, Shorts, embed, and `youtu.be` URLs are accepted)
- `@[video](content/media/demo.mp4 "Optional title")` — inline video file;
  looping is on and controls are hidden by default. Add `{noloop}`, `{controls}`,
  or `{noloop controls}` after it to change playback, for example:
  `@[video](clips/demo.webm){noloop controls}`.
- `@[kicanvas](content/applications/kicad/example.kicad_sch "Optional caption")`
  — interactive inline KiCad schematic, board, or worksheet viewer. Site-relative
  and HTTP(S) sources ending in `.kicad_sch`, `.kicad_pcb`, or `.kicad_wks` are
  accepted; remote sources must allow cross-origin requests.
- Raw HTML blocks are rendered when a block starts with an HTML tag. Safe
  structural HTML is allowed; scripts, forms, styles, event handlers, SVG, and
  arbitrary iframes are removed. Use the YouTube directive for video.
- Headings automatically become anchor points: `# My Heading` gets
  `id="my-heading"`, so `[jump there](#my-heading)` scrolls within the window.
  Raw HTML can also define an explicit anchor such as `<a id="details"></a>`.
- ` ``` ` fenced code blocks
- `> quote` — blockquote
- `[label](window:file/catalogue.md)` — link that opens another window
- `[label](app:applications/video/index.html?src=content%2Fmedia%2Fdemo.mp4)`
  — link that launches a registered application with startup options
- `[label](app:applications/pdf-reader/index.html?file=content%2Ffiles%2Fmanual.pdf)`
  — opens a site-relative or CORS-enabled remote PDF in the PDF Reader
- `[label](action:tidy)` — link that runs a desktop action
- `[label](https://…)` — opens an HTTP(S) page in the Web Browser, or a
  `.pdf` URL in PDF Reader
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
bitmap files under `assets/backgrounds/`. Curated names and the default live in
`content/site.json`; additional bitmap files in the public repository directory
are discovered automatically and given a readable name. `"app"` items open the given HTML
page from the same menu folder in a desktop window; `multi: true` opens a
fresh instance every time it's picked from the menu. `integrated: true` is
reserved for in-desktop system utilities; all other app entries remain iframe
loadable.

An app that knows its own natural size can make the window wrap around it
instead of taking the `width`/`height` from `menu.json` as final: dispatch a
bubbling, composed `clackos-resize` event carrying the window body size it
wants, and ClackOS resizes the frame around it, clamped to the desktop.

```js
host.dispatchEvent(new CustomEvent('clackos-resize', {
  bubbles: true, composed: true, detail: { width: 320, height: 420 }
}));
```

The `menu.json` size still applies while the app loads, so keep it close to the
app's usual size to avoid a visible jump. Clacksweeper uses this to fit its
window to the board. Current apps:

Application links may include a query string. Only pages already registered as
`"type": "app"` in a menu can be launched, so Markdown cannot turn the desktop
into an arbitrary iframe launcher. The Markdown Editor's Insert menu creates
links for Video Lab and PDF Reader files, Falstad exported data or saved
circuit files, KiCad files, OpenSCAD files or inline OpenSCAD code, generic
registered applications, Markdown windows, and desktop actions.

- `applications/appearance.html` (Applications → System → Appearance) — a
  simple chooser for the registered bitmap background tiles and colour themes.
  Choices are saved in the browser and applied live to the desktop. A selected
  theme can be made the browser’s cookie default without GitHub access, or
  committed as the website default in `content/site.json` with a fine-grained
  Contents read/write token.
- `applications/recorder.html` (Applications → Sound Recorder…) — a Windows
  98-style sound recorder with the full sndrec32 feature set. Records from
  the microphone (needs HTTPS + permission) with a live oscilloscope;
  recordings are inserted at the current position like the original. File:
  New, Open, Save/Save As (16-bit mono .wav), Revert, Properties. Edit:
  Copy, Paste Insert, Paste Mix (one clipboard shared across instances via
  BroadcastChannel), Insert/Mix with File, Delete Before/After Current
  Position. Effects: Increase/Decrease Volume, Increase/Decrease Speed
  (pitch shifts, like the original), Add Echo, Reverse. Multi-instance.
- `applications/clacksweeper.html` (Applications → Games → Clacksweeper) — a
  classic minesweeper game with Beginner, Intermediate, Expert and
  custom boards; safe first reveal; flags and question marks; number chording;
  mouse and keyboard play; optional sound; and browser-saved best times. Its
  window has no resize handles because it sizes itself: whenever the board
  changes the app measures its layout and shrinks or grows the window to wrap
  it exactly (see `clackos-resize` below).
- `applications/solitaire.html` (Applications → Games → Solitaire) — a themed
  Klondike Solitaire game adapted from Aashish Chakravarty's MIT-licensed
  browser game. It supports drag/drop moves, double-click to foundation,
  scoring and browser-saved high scores, persistent games, restart, undo,
  hints and auto-complete. The upstream revision, adaptation notes and full
  licence are retained under `vendor/solitaire/`.
- `applications/qbasic.html` (Applications → Emulation → QBasic 1.1) — launches
  the supplied `QBASIC.EXE` directly in a browser-hosted DOSBox WebAssembly
  runtime. The stable js-dos 6.22.60 canvas build is vendored under
  `vendor/js-dos-6.22/` (GPL-2.0); the v8 player was unsuitable because its
  DOSBox backend crashed on mouse input in QBasic. The startup curtain remains
  in place until the QBasic screen is rendered, so users see QBasic rather than
  the DOS shell or emulator interface. `QBASIC.HLP` sits beside the executable
  and is copied into the DOS filesystem at startup, so F1 and the Help menu
  work; if it is ever missing QBasic still starts without help. Clicking the
  screen claims keyboard focus for the frame (js-dos cancels the canvas
  mousedown, which otherwise leaves the keystrokes with the desktop), and
  Ctrl+V or the corner Paste button feeds clipboard text in as keystrokes.
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
- `applications/files.html` (Applications → System → File Manager) — a shared,
  read-only faux file manager with two drives. **GitHub** browses the complete
  repository tree with folder navigation; **Website Media** browses legacy
  images, video, and audio hosted at `clacktronics.co.uk/assets/` rather than in
  the repository. The same explorer powers File → Open from website in the
  Markdown Editor, ClackPaint, and PDF Reader. Markdown opens `.md` files and
  inserts links/media for other selections, Paint accepts images, and PDF
  Reader accepts PDFs. The standalone File Manager opens recognised files in
  their ClackOS application (including Paint, Markdown Editor, PDF Reader,
  Video Lab, OpenSCAD, Pure Data, Web Browser, and Text Editor); unknown file
  types show a confirmation before opening a browser tab. Associations are
  configured in `content/file-associations.json` rather than in the File
  Manager code. Rules are checked from top to bottom and may match `kinds`,
  `extensions`, and optional `drives`; each rule names the destination `app`,
  query-string `parameter`, label, and optional `source: "url"`.
- `applications/text.html` (Applications → System → Text Editor) — a small plain
  text editor with local open/save, File System Access support where available,
  website-file browsing, and startup association for `.txt` and related text
  files.

  The live `/assets/` directory intentionally cannot be enumerated over HTTP,
  so this drive reads `content/media-index.json`. After adding legacy media
  references to site content, refresh the catalogue with
  `python3 scripts/build_media_index.py`.
- `applications/browser.html` (Applications → Internet → Web Browser) — a
  lightweight iframe-based browser with an address bar, local navigation
  history, reload, home, and external-tab fallback. HTTP(S) links across
  Markdown pages, safe HTML blocks, and same-origin applications are routed
  here automatically; `.pdf` URLs are routed to PDF Reader instead. Sites may
  still decline embedded display through their own frame security policy.
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
  Ctrl+S saves. File → Open from website… opens the shared file manager:
  Markdown files load into the editor, while other files insert a suitable
  link or media embed. File → Commit to website…
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
  colour variables in an isolated live preview, applies them to the desktop and
  open ClackOS apps only when requested, opens and saves standalone CSS theme files, and
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
- `applications/openscad.html` (Applications → Maths & Programming → OpenSCAD) —
  a parametric CAD environment that runs the OpenSCAD engine as WebAssembly
  (openscad-wasm, GPL-2.0), fetched from a CDN on first render and cached
  afterwards. A CodeMirror 5 editor with OpenSCAD syntax highlighting on the
  left; a live three.js STL preview on the right (orbit/pan/zoom, fit,
  wireframe and grid toggles) that takes its colours from the active ClackOS
  theme. Press Render (F5) to build; each render runs in a fresh, short-lived
  Web Worker so a heavy or runaway model never freezes the desktop and can be
  stopped. Nothing is uploaded — the .scad goes in and an .stl comes back in
  the browser. File → Open loads your own .scad scripts (picker or
  drag-and-drop); Save writes the .scad (File System Access API with a download
  fallback); Export writes the rendered .stl. Publish → Commit sends both the
  .scad and the rendered .stl to `content/applications/openscad/` through
  GitHub's contents API, using the same in-memory fine-grained token approach as
  the Markdown and Theme editors. It can be launched from a Markdown link with
  `?src=<path to a .scad>` or `?code=<url-encoded source>` (add `&render=1` to
  build on open), which the Markdown Editor's Insert menu writes for you.
- `applications/paint.html` (Applications → ClackPaint) — a classic bitmap
  editor: pencil, brush, eraser, airbrush, flood fill, colour picker, clone
  stamp, soft blur, line, rectangle (outline/filled), ellipse and rectangular
  selection tools; Gaussian Blur and Noise effects; the
  classic 28-colour box with left/right-click foreground/background
  colours; arbitrary bitmap dimensions up to 8192 × 8192; undo/redo; local or
  website background opening; PNG saving; image-size resampling, anchored
  canvas resizing, crop selection, flip, invert and clear. The zoom tool
  supports 12.5%–800% views, and brush-based tools show their live footprint
  over the canvas. A non-destructive
  50% X/Y offset checkbox below Tool Size animates into a wrapped, fully
  editable seam-checking view. A second checkbox mirrors new paint strokes
  across the Y axis. Image → Remove Background cuts the subject out onto
  transparency using the MODNet model (Apache-2.0) run in a Web Worker with the
  vendored Transformers.js — the picture never leaves the browser, and the
  ≈13 MB model is fetched from the Hugging Face Hub once and cached. File → Set
  as background tile stores a PNG tile in the browser and applies it to the
  desktop. Multi-instance.

The committed PNG tiles are generated by `scripts/build_background_tiles.py`
(Pillow is required only when regenerating them). The runtime never loads SVG
wallpapers.

### Adding a whole new menu

1. Create `content/<name>/` with a `menu.json`.
2. Add `<name>` to the `menus` array in `content/site.json`.

## Plain HTML mirror

`plain/` is a no-desktop mirror of all the markdown content — ordinary HTML
pages with standard links, for readers (and machines) that don't want the
ClackOS window manager. Its menu contains File (Open, Report bug, and Edit)
plus the same Applications hierarchy as ClackOS. `window:` links become normal
page-to-page links in the current tab, while `app:` links open the standalone
application as a full page in a new tab. The
`@[youtube]` / `@[video]` / `@[kicanvas]` embeds still render inline, raw HTML
blocks go through the same sanitiser policy as ClackOS, and headings get the
same generated anchor ids so `[jump](#heading)` links work. The
pages reuse `assets/css/clackos.css` plus the active theme from `site.json`,
so the mirror keeps the ClackOS typography and palette. Mobile devices enter
this version by default. Each page footer links back to the desktop version,
and the taskbar links to the mirror.

The mirror is generated — don't edit `plain/` by hand. A GitHub Actions
workflow (`.github/workflows/plain-mirror.yml`) regenerates it automatically
whenever anything under `content/` changes. To rebuild it locally:

```sh
python3 scripts/build_plain_site.py
```

## Deploying to a web host (purely.website)

GitHub stays the source of truth; a GitHub Action copies the built site to the
web host so everything is served from one origin. `.github/workflows/deploy-purely.yml`
runs on every push to `main` (and can be run by hand from the Actions tab) and
`rsync`s the repo to the host over SSH. It uploads only changed files, never
deletes on the host, and excludes VCS/CI files, `scripts/`, the notes, and the
upload folders. It publishes to a `temp/` subfolder by default (set `SUBDIR=""`
in the workflow to go live at the web root).

It needs these repository secrets (Settings → Secrets and variables → Actions):
`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` (a key whose public half is in the
host's `~/.ssh/authorized_keys`), `DEPLOY_PATH` (the absolute web root, e.g.
`/home/USER/public_html`), and optionally `SSH_PORT` (defaults to 22).

## Uploading images and video

Large binaries do not belong in Git (repo-size and Actions limits), so the site
links to media served from the web host instead — the same pattern the old blog
posts already use. ClackOS can upload media straight to the host from the
browser and hand back a URL to link:

- **Applications → Markdown Editor… → Insert → Upload image or video…** (or just
  drag an image/video/audio file onto the editor). The file is sent to the host,
  and the returned URL is inserted as `![](…)`, `@[video](…){controls}`, or a
  plain link depending on its type.

The endpoint is `assets/upload.php`, named by `"assetUpload"` in
`content/site.json` and resolved against the site root (so it is same-origin —
no CORS needed once the site is on the host). It stores files under
`assets/uploads/YYYY/MM/`, which the deploy never touches and Git ignores.

**One-time server setup.** Because the repo is public, the secret is not in it.
On the host, next to `upload.php`, copy `upload-config.example.php` to
`upload-config.php` and set a strong `token` (e.g. `openssl rand -hex 32`). That
file is git-ignored and excluded from deploys, so it never leaves the server.
Paste the same token into the editor's upload dialog (kept in memory for the
session only). To keep links stable while the site is staged under `temp/`, also
set `base` and `dir` in the config to the canonical live paths.

**How malicious uploads are prevented.** Every request needs the secret token
(constant-time checked); only an allow-list of image/video/audio types is
accepted, with the stored extension taken from the file's *sniffed* content type
rather than its name; filenames are generated server-side (date + random) so
there is no path traversal or overwriting; a size cap applies (100 MB default,
subject to the host's `upload_max_filesize`/`post_max_size`); and `upload.php`
drops a `.htaccess` into the uploads folder that disables script execution, so
nothing stored there can ever run.

## Developing locally

`fetch()` doesn't work over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
