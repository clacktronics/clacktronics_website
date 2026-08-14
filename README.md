# Clacktronics website — ClackOS

A retro desktop-style website. The interface lives in `index.html` and
`assets/`; Markdown content lives under `content/` in folders that mirror the
menu bar:

```
index.html                  ← page shell (menu bar, desktop, taskbar)
assets/
  css/clackos.css           ← desktop styling (the "template")
  css/content.css           ← styles for everything rendered from markdown
  backgrounds/              ← bitmap desktop tiles (PNG/JPEG/GIF/WebP/BMP)
  themes/                   ← one editable colour theme per CSS file
    clackos.css             ← default palette
    midnight.css            ← example dark palette
  js/clackos.js             ← window manager and menu builder
  js/markdown.js            ← the markdown renderer (desktop + editor preview)
  js/model-scene.js         ← three.js viewer core (app + inline @[model])
  js/app-state.js           ← opt-in state persistence for application pages
  js/events.js              ← shared events reader (Calendar app + menu-bar pull-down)
  js/midi-bytes.js          ← shared MIDI message parser
content/
  site.json                 ← menu order + which windows open at boot
  file/                     ← FILE menu
    menu.json               ← items in this menu, in order
    home.md                 ← the landing window
    blog.md                 ← the blog, page 1 (generated, see below)
    blog-page-N.md          ← the blog, pages 2+ (generated)
    blog-list.md            ← index of every post (generated)
    blog/                   ← one post per file: YYYY-MM-DD-slug.md
    misc.md                 ← the Misc section index
    misc/                   ← tutorials and odds and ends, one per file
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
    scope.html              ← ClackScope oscilloscope app
    calendar.html           ← Calendar app
    calendar/events.csv     ← the upcoming events it shows
    calendar/luma.json      ← mirror of the Luma events (generated)
    video/                  ← browser-only Video Lab app + FFmpeg core
    audiogen/               ← local Transformers.js + MusicGen audio generator
    about.md
```

Apps are standalone HTML pages that ClackOS also opens in desktop windows.
They use iframes by default; trusted utilities marked `"integrated": true` in
`menu.json` use an isolated shadow root. Shared app styles live in
`assets/css/app.css`. ClackOS adds **File → Open app in new tab** unless an app
is marked `"plain": false`, which identifies desktop-only utilities.

Standalone apps show a **ClackOS** link back to the desktop through
`assets/js/app-home.js` and `app-bar.js`. App menus wrap and clamp dropdowns on
narrow screens. Video Lab and ClackMosh keep private menu styles, so update
their CSS when changing this behavior.

There is **no build step**. The browser loads JSON and Markdown at runtime, so
content changes need only a refresh. The site works on GitHub Pages or any
static host.

## Colour themes

Themes are CSS files in `assets/themes/` that set shared colour variables for
the desktop, Markdown windows, and same-origin apps. Configure the active theme
and available choices in `content/site.json`:

```json
"theme": "clackos.css",
"themes": ["clackos.css", "midnight.css"]
```

**Applications → Theme Editor…** previews changes live, opens or saves local
CSS, applies optional media filters, and can commit a theme to GitHub. A commit
writes under `assets/themes/`, registers the file in `content/site.json`, and
can make it active. The fine-grained token stays in memory. Filenames may use
letters, numbers, dots, underscores, and hyphens, and must end in `.css`.

### Status, scrim and series roles

Themes set `--danger`, `--warning`, `--ok`, and `--info`. Overlay scrims and
the six chart-series colours are derived automatically. Hardware colour codes,
artwork swatches, selection outlines, and specialised drawing surfaces remain
fixed because their colours carry meaning rather than decoration.

### Syntax highlighting

`assets/js/highlight.js` highlights fenced Python, C/C++ and Arduino,
JavaScript/TypeScript, HTML/XML, CSS, JSON, shell, OpenSCAD, and Markdown.

The fence tag picks the language, using the usual aliases (`py`, `c++`, `js`,
`sh`, `scad`, …):

    ```python
    def blink(pin, ms=250):
        ...
    ```

Untagged fences are detected automatically; use `text`, `output`, `log`, or
`csv` to disable highlighting. `assets/css/code.css` derives token colours from
the active theme with OKLCH, with fallbacks for older browsers. The same styles
cover CodeMirror editors, consoles, the Markdown preview, and the plain mirror.
Without JavaScript, code remains readable monospace text.

## Adding or editing content

### A new window

1. Drop a markdown file into the folder of the menu it belongs to, e.g.
   `content/file/projects.md`.
2. Add an entry to that folder's `menu.json`:

   ```json
   { "type": "window", "md": "projects.md", "label": "Projects" }
   ```

Each markdown file starts with frontmatter describing its window:

```markdown
---
title: Projects            ← titlebar / taskbar text
style: plain               ← "plain" or "page" (rich landing-page look)
tagline: Optional line     ← rendered under the h1 with a rule
description: One sentence  ← optional; search-result snippet for the mirror
robots: noindex            ← optional; keep this page out of search results
up: file/euroclack.md      ← optional; overrides the link back up ("none" for
                             a page that is already the top)
width: 480                 ← optional; px or % (default: 80% of the desktop)
height: 60%
---
```

Every page except home gets an automatic `↑ <parent>` link based on its path;
`up:` overrides it. A `window:` link replaces the current window, while menu
items open or raise a separate one.

Windows fit small screens while remembering their requested size for larger
ones. Open, close, minimise, restore, and maximise use retro transitions that
are disabled by `prefers-reduced-motion` and on unsupported browsers.

### Blog posts

Posts live in `content/file/blog/` as `YYYY-MM-DD-slug.md` files with the
same frontmatter as any window (use `tagline:` for the displayed date).
Legacy post images use site-relative paths under `assets/old_assets/`. New
media goes to `assets/uploads/` through the upload endpoint.

To add a post: drop the file in `content/file/blog/`, then regenerate the
blog windows:

```sh
python3 scripts/build_blog_index.py
```

This regenerates:

* `blog.md` and `blog-page-N.md`: five full posts per page, newest first;
* `blog-list.md`: every post grouped by year, plus a link that starts a dated
  post template in the Markdown Editor.

`POSTS_PER_PAGE` controls pagination. `.github/workflows/blog-index.yml` runs
the same rebuild after posts are pushed.

### Dead links and Wayback mirrors

`scripts/wayback_dead_links.py` checks outbound Markdown links and replaces
confirmed dead URLs with marked archive.org snapshots:

```markdown
[Vintage Synth Explorer](http://www.vintagesynth.com/misc/octavecat.php)
[Vintage Synth Explorer](https://web.archive.org/web/20110123182157/http://www.vintagesynth.com/misc/octavecat.php) (wayback mirror)
```

Blog links use the snapshot nearest the post date; other pages use the newest.
Only `404`, `410`, confirmed DNS failure, or connection refusal count as dead.
Ambiguous failures are left alone, and network-wide failures abort the run.

```sh
python3 scripts/wayback_dead_links.py --dry-run       # report, change nothing
python3 scripts/wayback_dead_links.py                 # rewrite in place
python3 scripts/wayback_dead_links.py --report out.md content/file/blog
```

Generated blog pages are skipped and rebuilt from their posts. Results are
cached for a week in `.link-check-cache.json`. Archive links and previously
marked links are ignored. Images require `--include-images`; site links require
`--include-site` and are best checked with `--dry-run` first.

`.github/workflows/dead-links.yml` runs monthly or on demand and opens a pull
request with its report. Enable **Settings → Actions → General → Allow GitHub
Actions to create and approve pull requests**. Reference links, autolinks, and
soft failures such as “video unavailable” still need manual review.

### The events calendar

Upcoming events live in `content/applications/calendar/events.csv`, which
`assets/js/events.js` supplies to the Calendar app and date menu. The file uses
RFC 4180 CSV; quote multiline notes and double embedded `"` characters.

```csv
title,date,end,location,map,notes
Workshop night,2026-07-29 19:00,2026-07-29 22:00,"The Shed, Clacton-on-Sea",,"Bring a **soldering iron**.

- Solder practice boards
- Panel drilling"
Open studio,2026-08-14,2026-08-16,"Colchester Arts Centre",https://maps.app.goo.gl/example,Three days of open studio.
```

| Column | |
| --- | --- |
| `title` | required |
| `date` | required — `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` for a start time |
| `end` | optional — a later date for a multi-day event, a full stamp, or just `HH:MM` for an end time on the same day |
| `location` | optional free text, shown on the event |
| `map` | optional `http(s)` link; when empty the app builds a Google Maps search from `location` |
| `notes` | optional markdown |

Columns are matched by name and may appear in any order. Invalid dates are
skipped. The Calendar app sorts rows, edits events, opens or saves local CSV,
and commits to GitHub with an in-memory fine-grained token.

#### Events hosted on Luma

Luma events configured in `content/site.json` appear beside CSV events as
read-only entries and link to Luma. `scripts/fetch_luma_events.py` writes the
mirror to `content/applications/calendar/luma.json` because Luma cannot be read
directly from the browser. `.github/workflows/luma-events.yml` refreshes it
hourly on `main`, commits only real changes, and triggers deployment. Run the
workflow manually to refresh immediately.

```json
"luma": {
  "username": "clacktronics",
  "userApiId": "usr-...",
  "pastMonths": 24
}
```

`username` identifies the profile. `userApiId` is optional and discovered when
omitted. `pastMonths` controls retained history. Only public events are copied,
with wall-clock times in each event's timezone. To run it locally:

```sh
python3 scripts/fetch_luma_events.py            # or --dry-run to just look
```

A CSV row with the same date and title overrides its Luma counterpart.

### Markdown that the renderer understands

- `# Heading` — window heading (in `page` style, followed by the tagline and rule)
- `## Text` — small green eyebrow label (e.g. `## // What we make`). Both
  heading forms take their own line and nothing else: a line written directly
  underneath, with no blank line between, is the next block.
- `**bold**`, `*italic*`
- `` `text` `` — green keyword highlight (used for `$`, part numbers, hex colours)
- `1. item` — numbered feature list, rendered as the bordered `01/02/03` box
- `![alt](src)` — image (linked images `[![](thumb)](full)` work too). An image
  whose file holds more than the page is showing gets a link to the full-size
  file, opening in a new browser window — see
  [Images bigger than the page shows](#images-bigger-than-the-page-shows)
- `@[youtube](https://youtu.be/VIDEO_ID "Optional title")` — responsive inline
  YouTube player (regular, Shorts, embed, and `youtu.be` URLs are accepted)
- `@[video](content/media/demo.mp4 "Optional title")` — inline video file. By
  default it behaves like an animated GIF: looping, muted, playing on its own,
  with no controls. Options in `{}` after it change that:

  | Option | Effect |
  | --- | --- |
  | `noloop` | play through once instead of repeating |
  | `controls` | show the player controls |
  | `autoplay` / `noautoplay` | start on its own, or wait to be started — the default follows looping |
  | `muted` | mute a clip that is not playing on its own (an autoplaying clip is always muted, because that is the only autoplay a browser allows) |

  So `@[video](clips/demo.webm){noloop controls}` is an ordinary video player,
  and `@[video](clips/demo.webm)` is a silent looping animation. The editor's
  **Insert → Inline video file…** offers these as tick boxes and shows the line
  it will write.
- `@[kicanvas](content/applications/kicad/example.kicad_sch "Optional caption")`
  — interactive inline KiCad schematic, board, or worksheet viewer. Site-relative
  and HTTP(S) sources ending in `.kicad_sch`, `.kicad_pcb`, or `.kicad_wks` are
  accepted; remote sources must allow cross-origin requests.
- `@[model](content/applications/models/part.stl "Optional caption")` — an
  inline 3D model, rendered by the same three.js core as the 3D Model Viewer
  application (`assets/js/model-scene.js`). `.stl`, `.step`/`.stp`, `.obj`,
  `.3mf` and `.glb` sources are accepted. It is deliberately borderless and transparent so
  it reads as part of the prose; options in `{}` after it change any of the
  viewer's settings:

  | Option | Default | Effect |
  | --- | --- | --- |
  | `height=320` | `320` | Viewport height in pixels (80–900) |
  | `width=60` | full width | Width as a percentage (10–100) |
  | `left` / `right` | — | Float beside the text (width defaults to 42%) |
  | `caption` | off | Show the title under the model |
  | `border` | off | Draw the bordered panel the other embeds use |
  | `colour=#c98a3a` | theme accent | Model colour (`color=` also works). Parts that name their own colour — STEP faces, GLB materials and textures — keep it |
  | `background=#f3ecd1` | `none` | Backdrop; `none` lets the page show through |
  | `grid` / `nogrid` | `nogrid` | Ground grid; `grid=#276b47` turns it on in that colour |
  | `shadows` / `noshadows` | `shadows` | Shadow casting |
  | `lighting=studio` | `studio` | `studio`, `soft`, `dramatic`, `flat`, `unlit` |
  | `brightness=100` | `100` | Light intensity percentage (20–400) |
  | `key=` `fill=` `sky=` `ground=` | theme | Individual light colours |
  | `wireframe` | off | Render as wireframe |
  | `animation=hover` | `turntable` | Idle animation: `none`, `turntable`, `swing`, `jump`, `hover`, `tumble`, `rock` |
  | `material=clay` | `authored` | One finish over the whole model: `authored`, `colour`, `clay`, `chrome`, `normals` |
  | `spin` / `nospin` | `spin` | The short way to ask for the turntable, or for nothing |
  | `speed=0.9` | `0.9` | Animation speed (−8–8; negative reverses). A GLB's own animation plays at its authored speed at `0.9` |
  | `zoom=1` | `1` | Framing multiplier; above 1 fills more of the frame |
  | `static` / `interactive` | drag to orbit | `static` disables input entirely; `interactive` (`controls=full`) adds wheel zoom and panning |
  | `axes=xzy` | per format | Which source axis becomes world X, Y, Z. STL, STEP and 3MF default to `xzy` (Z up, as CAD draws it); OBJ and GLB default to `xyz` |

  Dragging orbits the model by default, while the wheel and one-finger touch
  stay with the page so scrolling past an embed still works. An unknown or
  out-of-range option leaves the line as ordinary text, the same as the other
  directives. Models load only once they are near the viewport, and a reader
  without scripting gets a link to the model file.
- Raw HTML blocks are rendered when a block starts with an HTML tag. Safe
  structural HTML is allowed; scripts, forms, styles, event handlers, SVG, and
  arbitrary iframes are removed. Use the YouTube directive for video.
- Headings automatically become anchor points: `# My Heading` gets
  `id="my-heading"`, so `[jump there](#my-heading)` scrolls within the window.
  Raw HTML can also define an explicit anchor such as `<a id="details"></a>`.
- ` ``` ` fenced code blocks, syntax coloured — see
  [Syntax highlighting](#syntax-highlighting)
- `> quote` — blockquote
- `[label](window:file/euroclack.md)` — link to another window (followed in
  place; see above)
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

### Images bigger than the page shows

`assets/js/image-zoom.js` links a raster image to its full-size file when it is
at least 1.5 times and 64 pixels wider than its rendered size. It updates when
the layout changes and runs in the desktop, Markdown preview, and plain mirror.
Already linked images, raw-HTML images, and SVGs are left alone.

### The right-hand end of the menu bar

Two shell controls sit to the right of the menus:

- **Date:** opens with the next eight CSV and Luma events and a link to the
  Calendar. The pull-down is shown at startup and refreshes each time it opens.
- **Clock:** uses a wall-clock-aligned CSS animation for its blinking colon and
  respects `prefers-reduced-motion`.

Menus are inserted before `#menubar-right`, so they always fill the bar from
the left however many there are.

### The taskbar on small screens

The taskbar contains window buttons, a **Plain HTML** link, browser CPU/RAM
telemetry, and the deployed commit. Below 640px, telemetry and the build stamp
are hidden so window buttons remain usable; the mirror link stays visible.

### Menu items (`menu.json`)

```json
{ "type": "window", "md": "home.md", "label": "Clacktronics", "shortcut": "⌘O" }
{ "type": "action", "action": "close-front", "label": "Close front window" }
{ "type": "action", "label": "Undo", "disabled": true }
{ "type": "sep" }
{ "type": "wallpapers" }
{ "type": "submenu", "label": "Games", "items": [ … ] }
```

```json
{ "type": "app", "page": "paint.html", "label": "ClackPaint…", "title": "ClackPaint",
  "width": 820, "height": 620, "multi": true }
```

Built-in actions are `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`,
`reset`, `copy-desktop-link`, and `forget-desktop`. Submenus nest items one level
deep. `wallpapers` expands to the bitmap picker configured by
`content/site.json` and `assets/backgrounds/`.

App options include `multi: true` for new instances, `integrated: true` for
trusted shadow-root utilities, `plain: false` to omit desktop-only apps from
the [plain mirror](#plain-html-mirror), and `allow` for iframe permissions such
as `serial; usb` or `midi`.

An app can request a natural window size with a bubbling, composed
`clackos-resize` event:

```js
host.dispatchEvent(new CustomEvent('clackos-resize', {
  bubbles: true, composed: true, detail: { width: 320, height: 420 }
}));
```

Keep the `menu.json` size close to the usual result to avoid a loading jump.

An app closes itself by posting `{ type: 'clackos-close-window' }`.

Application links may include query strings but can launch only registered
apps. The Markdown Editor can create links for registered apps, files, inline
OpenSCAD, Markdown windows, and desktop actions.

#### Applications

- `applications/appearance.html` — live wallpaper and theme chooser. Settings
  persist locally; the site default can be committed to `content/site.json`.
- `applications/recorder.html` — Windows 98-style microphone and WAV recorder
  with editing, mixing, speed, volume, echo, reverse, and shared clipboard.
- `applications/modem.html` — ClackMo encodes text as WAV audio using fifteen
  modem, signalling, radio, cassette, timecode, and PSK protocols. Parameters
  are editable and output can be sent to Sound Recorder.
- `applications/modem-rx.html` — ClackDem decodes thirteen of those modes from
  files, shared audio, or a live microphone, with tuning measurements and a
  timestamped event log. Shared DSP and UI code lives beside both apps.
- `applications/scope.html` — audio oscilloscope for microphone, files, or a
  test tone, with sweep, roll, X-Y, FFT, triggering, persistence, measurements,
  PNG export, and saved instrument settings.
- `applications/clacksweeper.html` — Minesweeper with standard and custom
  boards, keyboard play, sound, saved times, and automatic window sizing.
- `applications/solitaire.html` — MIT-licensed Klondike with saved games,
  scoring, undo, hints, and auto-complete. Sources and licence are in
  `vendor/solitaire/`.
- `applications/qbasic.html` — QBasic 1.1 in vendored js-dos 6.22.60
  (GPL-2.0), with help, clipboard paste, and demo programs. Run
  `scripts/build_qbasic_programs.py` after changing the DOS 8.3 files in
  `content/applications/qbasic/programs/`.
- `applications/video/index.html` — local video/audio editor with native
  preview and FFmpeg WebAssembly export to common media formats.
- `applications/pdf-reader/index.html` — MuPDF.js 1.28.0 reader with lazy
  rendering, search, zoom, passwords, local/website files, and `?file=` URLs.
  MuPDF is vendored under `vendor/mupdf/` (AGPL-3.0).
- `applications/audiogen/index.html` — local MusicGen text-to-music app;
  prompts and WAV output stay in the browser. The catalog carries one build per
  device: a `shader-f16` adapter fetches the fp16 build (~1127 MB) and decodes
  on the GPU, anything else fetches the q8/fp32 build (~656 MB) and decodes on
  the CPU. The 8-bit weights are not sent to the GPU because the WebGPU backend
  has no integer matmul and widens them on every dispatch. An adapter can still
  refuse a model that size mid-load, so the CPU build is also a retry; the
  worker reports the device it finished on and the status line names it.
- `applications/files.html` — read-only browser for repository and website
  media, shared by app file pickers. Associations live in
  `content/file-associations.json`. Rebuild the legacy-media catalogue with
  `python3 scripts/build_media_index.py`; uploaded media is listed live.
- `applications/text.html` — plain-text editor with local and website file
  access and startup associations for common text formats.
- `applications/calendar.html` — month and upcoming views for CSV and read-only
  Luma events, with Markdown notes, Maps links, local CSV access, GitHub commit,
  and `?view=upcoming` or `?date=YYYY-MM-DD` startup options.
- `applications/browser.html` — iframe browser for routed HTTP(S) links, with
  history, home, reload, and external-tab fallback. PDFs open in PDF Reader.
- `applications/circuit.html` — themed CircuitJS1 simulator (GPLv2, vendored in
  `vendor/circuitjs1/`). Startup accepts `?circuit=<name>.txt` or exported
  `?ctz=` data.
- `applications/gamma-table.html` — mono or RGB LED gamma-table designer with
  editable curves, previews, memory estimates, and Arduino/C, MicroPython, or
  CSV export.
- `applications/serial-console.html` — ClackTerm Web Serial console with a demo
  device, protocol interpreters, plotting, logging, macros, and serial/USB
  permission support.
- `applications/midi-console.html` — MIDIterm Web MIDI monitor and sender with
  decoded messages, channel/type filters, activity lanes, plotting, recording,
  and demo input. MIDI parsing is shared with ClackTerm.
- `applications/kicad.html` — KiCanvas schematic and board viewer (MIT,
  vendored in `vendor/kicanvas/`) with local files and `?file=` startup. Run
  `scripts/build_kicanvas_theme.py` after updating the vendor bundle.
- `applications/model-viewer.html` — local STL, STEP, OBJ, 3MF, and GLB viewer
  sharing `assets/js/model-scene.js` with inline models. It supports materials,
  lighting, animation, axes, wireframe, deformation, authored GLB features, and
  optional upload with a ready-made `@[model]` directive. `.gltf` is unsupported
  because it depends on separate files.
- `applications/eecircuit.html` — MIT-licensed ngspice/WebAssembly netlist
  simulator with WebGL plots. The unlicensed schematic editor is omitted from
  the vendored copy under `vendor/eecircuit/`.
- `applications/markdown.html` — EasyMDE editor with the site's renderer,
  preview, local and website files, media insertion, post templates, and GitHub
  commit. Startup accepts `?repo=` or `?open=`, `view=rendered`, and `?new=post`.
  Repository and branch settings come from `content/site.json`; tokens stay in
  memory.
- `applications/theme.html` — theme editor with isolated preview, local CSS
  access, and GitHub commit to `assets/themes/` and `content/site.json`.
- `applications/python.html` — Pyodide and CodeMirror IDE with editor, worker
  execution, REPL, variables, stoppable runs, and local files. Pyodide is
  vendored; `micropip` packages are downloaded at runtime.
- `applications/openscad.html` — OpenSCAD WebAssembly editor and worker-based
  three.js preview with local SCAD/STL access and GitHub publish. Startup accepts
  `?src=`, `?code=`, and `&render=1`.
- `applications/paint.html` — multi-instance bitmap editor with layers,
  drawing and selection tools, transforms, seam-carved scaling, filters,
  tile-preview tools, local/website files, PNG upload, and desktop wallpaper
  export. It also imports raw framebuffers, imports/exports microcontroller
  arrays, offers multiple resamplers and Swin2SR upscaling, and runs MODNet,
  DeepDream, and Janus text-to-image locally without uploading images.

Generate committed PNG wallpapers with `scripts/build_background_tiles.py`
(requires Pillow). Generate the trimmed DeepDream weights in
`vendor/inception5h/` with `scripts/build_inception5h_weights.py` (requires
NumPy).

### Adding a whole new menu

1. Create `content/<name>/` with a `menu.json`.
2. Add `<name>` to the `menus` array in `content/site.json`.

## Saved desktops and shareable links

ClackOS stores window layout, scroll positions, theme, wallpaper, and opt-in app
state in `localStorage` under `clackos-session`. Returning visitors restore this
snapshot; first-time visitors use the `boot` list in `site.json`.

**View → Copy link to this desktop** encodes the same snapshot into the URL
after a `#`, deflate-compressed and base64url-encoded:

```
https://clacktronics.co.uk/#desktop=zVNNb9swDP0rgs9x4qRJm...
```

Fragments are not sent to the host. Shared links can open only registered apps
and safe Markdown paths under `content/`. If app state makes the URL too large,
only the layout is included.

**View → Forget saved desktop** removes the snapshot and disables saving until
the next load. Reboot options differ in scope:

- **File → Restart** clears the desktop snapshot but keeps theme, wallpaper,
  and app data.
- **View → Reset** confirms, then clears local/session storage, the theme
  cookie, and Cache Storage. IndexedDB is retained.

### Letting an app remember its own state

Apps opt in with `assets/js/app-state.js`. Add the script, then either hand
over the whole form or describe the state yourself:

```html
<script src="../../assets/js/app-state.js"></script>
<script>
/* every input, select and textarea with an id */
ClackOSAppState.connect({ controls: true });

/* or a shape of your own */
const session = ClackOSAppState.connect({
  save: () => ({ text: editor.value, caret: editor.selectionStart }),
  restore: saved => editor.value = saved?.text || ''
});
editor.addEventListener('input', () => session.schedule());
</script>
```

`connect()` returns `{ report, schedule, capture, apply }`; `schedule()` is a
debounced report. `controls: true` watches identified form controls and fires
`input`/`change` after restoring them. Use `dispatch: false` and a custom
`restore` callback when that is unsuitable. State is JSON, limited to 64 KB per
window, and ignored when the app runs outside ClackOS.

## Plain HTML mirror

`plain/` is a generated, crawlable HTML mirror of the Markdown content. It keeps
the theme, embeds, sanitisation, and heading anchors; `window:` links become
normal page links and `app:` links open standalone apps. Entries marked
`"plain": false` are omitted. The desktop and mirror link to each other.

Do not edit `plain/` directly. The generator also writes `sitemap.xml`,
`robots.txt`, `feed.xml`, and `404.html`. The
`.github/workflows/plain-mirror.yml` workflow runs after content changes. To
rebuild locally:

```sh
python3 scripts/build_plain_site.py
```

## Search engines

Because the desktop has no per-page URLs, the **plain mirror is the crawlable
site**. Its generator writes:

- titles, descriptions, Open Graph, Twitter cards, and canonical links;
- root `sitemap.xml`, `robots.txt`, `feed.xml`, and `404.html`;
- `BlogPosting` JSON-LD on posts and `WebSite`/`Organization` data on home.
  Social profiles come from `sameAs` in `content/site.json`.

### Titles that have two jobs

Use frontmatter `title:` for the window and optional `seoTitle:` for `<title>`
and `og:title` when search results need more context.

### Sitemap dates

`<lastmod>` uses the last Markdown commit; untracked posts fall back to their
filename date. Generator workflows use `fetch-depth: 0`. Shallow clones omit
`lastmod` instead of writing misleading dates.

### The blog feed

`feed.xml` is a newest-first RSS 2.0 feed of indexable posts and is advertised
by the desktop and every mirror page.

### Applications

Hand-written apps carry their own description, canonical, Open Graph, and
robots tags. The generator includes apps with a canonical link and no
`noindex` in the sitemap. App canonicals use the live origin directly, so a
domain change requires updating them.

Indexed apps also receive generated `WebApplication` JSON-LD based on their
menu entry and meta description:

```sh
python3 scripts/build_app_metadata.py          # rewrite metadata
python3 scripts/build_app_metadata.py --check  # verify only
```

Edit the app's meta description rather than the generated block. Mirror and
deploy workflows run this generator automatically.

### The 404 page

The generated, `noindex` 404 page links to current and archived content;
`.htaccess` selects it with a `SUBDIR`-aware `ErrorDocument`.

The site root is the canonical home page. `index.html` uses `./`, and the
mirror home points back to the root; the sitemap includes the root rather than
`plain/index.html`. Keep the shell title and description aligned with
`content/file/home.md`.

Descriptions fall back from `description:` to a non-date `tagline:` and then
the first paragraph, trimmed to about 155 characters. Add `description:` when
that fallback reads poorly. `robots: noindex` excludes a page from indexing and
the sitemap.

Absolute metadata URLs use:

- `siteUrl` in `content/site.json` by default;
- the `SITE_URL` environment override, derived from `SUBDIR` during deployment.

`SUBDIR` is currently empty. Set it in `.github/workflows/deploy-purely.yml` to
stage both deployed files and generated URLs in a subfolder.

## Deploying to a web host (purely.website)

`.github/workflows/deploy-purely.yml` runs on relevant pushes to `main` or
manually and uses SSH/rsync to publish changed files. It never deletes remote
files and excludes VCS/CI files, scripts, notes (`README.md`, `todo.md`, and
`CLAUDE.md`), `.gitignore`, and upload folders. Documentation-only commits do
not deploy; generator script changes do. Set `SUBDIR` to stage in a subfolder.

Because rsync does not delete, files published before being excluded must be
removed from the host manually, for example:

```sh
rm public_html/CLAUDE.md public_html/.gitignore
```

### The move from `/temp/` to the root

The site was previously staged under `/temp/`. The root `.htaccess` redirects
old URLs, but the deploy never deletes or moves uploaded media. Complete these
host steps manually:

1. **Move legacy media into `assets/old_assets/`:**

   ```sh
   cd public_html/assets
   mkdir -p old_assets
   # everything that was there before the repo's assets/ landed on top of it
   mv 643_*.jpg *.gif thumb_*.jpg … old_assets/
   ```

2. **Move the uploads.** `mv public_html/temp/assets/uploads public_html/assets/uploads`
3. **Move the config above the web root.**
   `mv public_html/temp/assets/upload-config.php ~/upload-config.php`. Remove
   stale `base` or `dir` settings that still point to `/temp`.
4. **Delete the old copy** with `rm -rf public_html/temp` only after verifying
   the root deployment.

`assets/uploads/` and `assets/old_assets/` are outside Git and excluded from
deployment.

Required Actions secrets are `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, and
`DEPLOY_PATH`; `SSH_PORT` is optional and defaults to 22.

## Uploading images, video and 3D models

Large media is uploaded directly to the web host instead of Git:

- **Markdown Editor:** upload or drag media to insert an image, video, model,
  or file link.
- **3D Model Viewer:** upload the open model and copy its URL or `@[model]`
  directive.
- **ClackPaint:** upload the current image as PNG and copy its URL.

`assetUpload` in `content/site.json` points to `assets/upload.php`. It stores
files under ignored, deployment-safe `assets/uploads/YYYY/MM/` paths.

**One-time setup:** copy `upload-config.example.php` on the host, set a strong
`token` such as one from `openssl rand -hex 32`, and keep the config outside the
public repository. Paste the token into upload dialogs; it remains in memory
for the session. Leave `base` and `dir` unset for a root deployment.

`upload.php` checks `$CLACKOS_UPLOAD_CONFIG`, its own directory, and four parent
directories. Prefer `/home/USER/upload-config.php`, above the web root, so
deployments cannot overwrite it.

Upload errors distinguish missing or invalid config, an unset token, and the
unchanged example token.

Uploads require a constant-time-checked token, use type allow-lists and content
inspection, generate server-side filenames, enforce a 100 MB default cap, and
disable script execution in upload folders. Model formats are validated from
their structure rather than trusting names or MIME labels.

## Developing locally

`fetch()` doesn't work over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
