# Clacktronics website — ClackOS

A retro desktop-style website. The **visuals live in a single template**
(`index.html` + `assets/`), and **all content lives in markdown files** under
`content/`, organised in folders that mirror the menu bar:

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
    calendar.html           ← Calendar app
    calendar/events.csv     ← the upcoming events it shows
    calendar/luma.json      ← mirror of the Luma events (generated)
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

### Syntax highlighting

Fenced code blocks are coloured by `assets/js/highlight.js`, a small tokeniser
written for this site (no vendored library). It understands Python, C/C++
(including Arduino sketches), JavaScript/TypeScript, HTML and XML — with
embedded `<script>` and `<style>` blocks coloured in their own language — plus
CSS, JSON, shell, OpenSCAD and Markdown.

The fence tag picks the language, using the usual aliases (`py`, `c++`, `js`,
`sh`, `scad`, …):

    ```python
    def blink(pin, ms=250):
        ...
    ```

**A fence with no tag is detected automatically.** Each language scores itself
against the code — `#include <…>` and `std::` say C++, `def …:` and `import`
say Python, a closing tag says HTML — and the highest score wins. Prose and
program output score nothing, so a fence holding a traceback or a paste of text
stays plain monospace rather than being coloured at random. Tag a block
` ```text ` (or `output`, `log`, `csv`) to switch colouring off deliberately.

Colours are never written in the highlighter. Every token is wrapped in a
`tok-…` span and `assets/css/code.css` builds the colour out of the code
surface's own background in OKLCH, so a palette written in the Theme Editor
recolours code with no further work:

- **lightness is inverted from the panel's.** `sign(0.577 - l)` is +1 when the
  panel is dark and -1 when it is light, so tokens are pushed away from the
  background whichever way round a theme paints it — bright on ink, deep on
  paper — and never strand themselves at the middle lightness of a strongly
  coloured panel. How far each token is pushed is what separates the prominent
  ones (functions, keywords) from the quiet ones (comments, punctuation).
- **hue is turned away from the panel's own.** `calc(h + 150)` and friends put
  each token most of the way around the wheel from the background, so a red
  panel cannot get red text. The palette still rotates with the theme rather
  than being a fixed rainbow dropped on top of it.
- **chroma is set per token type**, high enough to read as colour rather than
  as tinted grey. Out-of-gamut combinations are mapped back by the browser.
- weight and italics carry the same distinctions, so the code still reads as
  code if a browser renders it without colour.

Errors and warnings are rotated furthest from the panel hue for the same
reason — a console that cannot show its errors is no use — with
`--code-alert` / `--code-caution` left as the fallback hues.

Two surfaces are defined: the dark panels (code blocks, shells, consoles,
`--ink`) and the light editors (`--paper`). Browsers too old for
`oklch(from …)` or `sign()` fall back to a plainer set of colours mixed from
the theme accents.

Measured across the seven themes in `assets/themes/`, the worst token contrast
on a code block is 9.9:1 for `clackos.css`, 8.7:1 for `blood.css`, 6.1:1 for
`brownstone.css` and 4.4:1 for `poolside.css`, whose panel is a fully
saturated blue. Where a number looks low it is the palette's own ceiling
rather than the derivation: `blood.css`'s editor lands around 3:1 because
plain white text on its red `--paper` only manages 4:1 to begin with.

The same stylesheet retunes the CodeMirror editors in Python, OpenSCAD and
Processing, and the shell/console panes in Python, OpenSCAD, Processing and
Pure Data — anything carrying the `code-dark` class gets the code-block
surface, including its `.err`, `.warn`, `.sys` and `.echo` message colours.
The Markdown editor's preview uses the highlighter too, so a code block looks
the same while you write it as it will on the page.

In the plain HTML mirror the colouring happens in the browser: the generator
writes the fence tag into `data-lang` and loads the highlighter with
`data-auto`. With scripting off, code blocks are still the plain monospace
panels they always were.

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

Every page but the home window carries a small `↑ <parent>` link above its
title. The parent is worked out from where the file sits — a page in a folder
goes up to the folder's own page (`file/euroclack/mini-speaker.md` →
`file/euroclack.md`, a blog post → `file/blog.md`) and anything at the top
level goes up to the home window — so a new file gets one without being asked.
`up:` in the frontmatter overrides it.

Following a `window:` link from inside a window replaces that window, the way
a page follows a link; the taskbar entry and titlebar follow along. The File
menu still opens a new window, and a page already open in another window is
raised rather than duplicated.

Windows shrink to fit the browser. Every window remembers the box it was last
deliberately given — opened at, dragged to, resized to, tidied into or restored
from a saved desktop — and whenever the browser window changes size each window
is re-fitted against it: squeezed down (and nudged back inside) when the
browser gets smaller, eased back out towards that remembered box when it gets
larger, and never grown past it. A window is only ever as large as someone
asked for it to be. The usual 320×180 minimum gives way on a desktop too small
to hold it, so windows still fit on a phone; maximised windows simply follow
the desktop, and the size saved into a session is the remembered box rather
than the squeezed one, so a desktop last seen on a narrow screen comes back
full-size on a wide one.

Windows move the way an eight-bit desktop's did. Closing one dissolves it into
the desktop a pixel at a time, in a random order — the window is masked with a
tile of noise that has more of itself rubbed out on each of twenty steps, so
the chrome, the drop shadow and whatever the window contains all go together.
The grain is one noise pixel per device pixel; a mask that fine cannot be
re-encoded twenty times over at window size, which is why it is a 256-pixel
tile repeated across the window rather than one image the size of the window.
Minimising shrinks the window into its own taskbar button and
restoring expands it back out of it; a new window arrives by expanding onto the
desktop, and maximise moves and resizes in one transition. None of it changes
what the desktop does: every animation is skipped, and the window simply
appears or goes, under `prefers-reduced-motion`, while a saved desktop is being
rebuilt at boot, and on any browser without the Web Animations API or CSS
masking.

### Blog posts

Posts live in `content/file/blog/` as `YYYY-MM-DD-slug.md` files with the
same frontmatter as any window (use `tagline:` for the displayed date).
They were converted from the old Jekyll/WordPress site; images point at
`assets/old_assets/` — a site-root-relative path, not an absolute URL, so the
same link works on the live site, on GitHub Pages under a project subpath, and
in a local checkout. New media goes to `assets/uploads/` via the upload
endpoint instead (see “Uploading images, video and 3D models”).

To add a post: drop the file in `content/file/blog/`, then regenerate the
blog windows:

```sh
python3 scripts/build_blog_index.py
```

That rewrites two things, both from the posts alone:

* `content/file/blog.md` and `content/file/blog-page-N.md` — the blog itself
  (File → Open → Blog). Five posts per page in full, newest first, with a
  Newer/Older button row and a link to the list at the top and bottom of
  every page. Pages 2 and up are `robots: noindex`, since each post is
  already a page of its own and the list links to all of them.
* `content/file/blog-list.md` — the list window (File → Open → Blog List):
  every post as a dated link, newest first, grouped by year, closing with a
  quiet link that starts the next post. It opens the Markdown Editor on
  `app:applications/markdown.html?new=post` (`NEW_POST_APP` in the script),
  which fills the buffer with a post dated today — frontmatter, title, a
  picture and a paragraph — and names the file `YYYY-MM-DD-new-post.md`, so
  **File → Commit to website…** already points at `content/file/blog/`.
  Rename the slug in the commit path if you want a better one; the date is
  the part that has to be right.

Pages are rebuilt from scratch each run, so the count follows the number of
posts and any page no longer needed is deleted. `POSTS_PER_PAGE` at the top
of the script sets the five. Pushing a post to `content/file/blog/` runs the
script in CI (`.github/workflows/blog-index.yml`) and commits the result, so
the blog keeps itself up to date.

### Dead links and Wayback mirrors

The posts go back to 2011 and a fair number of the sites they link to have
since gone. `scripts/wayback_dead_links.py` walks the markdown in `content/`,
checks every outbound link, and for the ones that are actually gone swaps the
URL for an archive.org snapshot and marks it in the text:

```markdown
[Vintage Synth Explorer](http://www.vintagesynth.com/misc/octavecat.php)
[Vintage Synth Explorer](https://web.archive.org/web/20110123182157/http://www.vintagesynth.com/misc/octavecat.php) (wayback mirror)
```

Which snapshot depends on the file. A blog post is named `YYYY-MM-DD-slug.md`,
so its links get the capture closest to the day the post was written — the page
as it was when the post was talking about it. Everything else gets the newest
capture.

Replacing a link that still works would be worse than leaving a broken one, so
the checker only calls a link dead on an unambiguous answer: `404`, `410`, a
host with no DNS record, or a refused connection. A `403`, `429`, `500` or a
timeout means "cannot tell" and the link is left alone. `HEAD` is tried first
and then `GET`, because plenty of servers refuse `HEAD` and serve the page
happily. There are three more guards: a connection error is only believed if
the hostname really fails to resolve (behind a proxy, urllib lies about this),
the run aborts if it cannot reach the web at all, and it aborts if more than
half the links look dead — that is a broken network, not a broken web.

```sh
python3 scripts/wayback_dead_links.py --dry-run       # report, change nothing
python3 scripts/wayback_dead_links.py                 # rewrite in place
python3 scripts/wayback_dead_links.py --report out.md content/file/blog
```

Only the posts are rewritten: `blog.md`, `blog-page-N.md` and `blog-list.md`
are built from them, so a directory scan skips them and the workflow re-runs
`build_blog_index.py` instead. Re-running is safe: links already pointing at
`web.archive.org`, and any link already carrying the marker, are skipped, and
a link the archive had no snapshot for this month is simply tried again next
month. Statuses are cached in `.link-check-cache.json` (gitignored) for a week
so a re-run is cheap.
Image sources are left alone unless `--include-images` is given — a marker
next to a picture would just render as stray text. Links to
`clacktronics.co.uk` itself are skipped too, since that host serves this
site's own assets; `--include-site` takes them in, which is worth a `--dry-run`
first because the old WordPress permalinks under it are dead and would all be
rewritten at once.

`.github/workflows/dead-links.yml` runs the sweep on the 1st of each month and
on demand from the Actions tab (with a dry-run switch). It opens a **pull
request** rather than pushing to `main` — calling a link dead is a judgement
call and the diff is worth reading — with the report as the PR body, and
uploads that report as an artifact either way. For the PR step to work,
Settings → Actions → General → "Allow GitHub Actions to create and approve pull
requests" has to be ticked; without it the branch is still pushed and only the
`gh pr create` fails.

Reference-style links (`[text][ref]`) and bare `<http://…>` autolinks are not
rewritten — nothing in `content/` uses them. A page that answers `200` with
"this video is unavailable" is not detectable either; those still need a human.

### The events calendar

Upcoming events live in one CSV, `content/applications/calendar/events.csv`,
read at runtime by Applications → System → Calendar and by the menu bar's date
pull-down, which the desktop opens with. Both go through
`assets/js/events.js`, so they agree on what an event is. Ordinary RFC 4180
rules apply, which is what lets a whole markdown note sit in one cell: quote
the field and double any `"` inside it.

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

Columns are matched by header name, so their order in the file does not matter
and extra columns are left alone. A row without a usable date is skipped and
counted in the status bar. Rows may be in any order — the app sorts by date
and rewrites the file sorted whenever it saves or commits.

Edit the file by hand and refresh, or use the Calendar app: it can add, change
and delete events and then commit the regenerated CSV straight to GitHub with
a fine-grained token, the same way the Markdown and Theme editors publish.
Nothing about the calendar is generated at build time, so a committed change is
live as soon as the deploy finishes.

#### Events hosted on Luma

Events from the Luma profile in `content/site.json` are shown alongside the CSV
ones, tagged **Luma** and linking back to their Luma page. They are a mirror,
kept in `content/applications/calendar/luma.json`, so the app treats them as
read-only: they have no pencil, and committing the calendar never writes them
into `events.csv`.

Luma sends no `Access-Control-Allow-Origin` header, so the browser cannot fetch
the profile itself. `scripts/fetch_luma_events.py` does it instead and
`.github/workflows/luma-events.yml` runs it hourly (and on demand from the
Actions tab), committing `luma.json` only when the events have actually changed
— the timestamp alone never makes a commit. A run that finds nothing new writes
nothing, so asking often costs two small HTTP requests.

When it does commit, it then asks the deploy workflow to run. That step is not
decoration: a push made with the automatic `GITHUB_TOKEN` deliberately does not
trigger other workflows, so the mirror's own commit cannot start the deploy, and
without the nudge a new Luma event would sit in the repository until something
else happened to push to `main`.

Scheduled workflows only run on the default branch, so the mirror refreshes from
`main` and nowhere else. To pick up an event you have just created without
waiting for the hour, run **Actions → Mirror Luma events → Run workflow**.

```json
"luma": {
  "username": "clacktronics",
  "userApiId": "usr-...",
  "pastMonths": 24
}
```

`username` is the profile at `https://luma.com/user/<username>`. `userApiId` is
optional — the script reads it from the profile page when it is missing, and the
committed value just saves a request. `pastMonths` bounds how far back finished
events are kept for the Show past events toggle.

Only events Luma reports as `public` are mirrored, so unlisted ones stay
unlisted. Times are written as wall-clock in each event's own timezone, the way
Luma shows them and the way `events.csv` records them, so both sources read the
same in the app. Run it by hand with:

```sh
python3 scripts/fetch_luma_events.py            # or --dry-run to just look
```

To show a Luma event with your own wording, add a row to `events.csv` with the
same date and title: a CSV entry wins over the mirrored one.

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

Nothing has to be written for this: every `![alt](src)` in every markdown file
is checked, on the desktop and in the plain mirror alike.

A picture is drawn at the width of the text column, and most photographs and
screenshots are wider than that. `assets/js/image-zoom.js` compares each image's
file with the size it was actually drawn at once the page has laid out, and
where the file holds more detail it wraps the image in a link to the file, shown
by a `zoom-in` cursor and the small open-in-a-new-window badge the rest of the
OS uses, in the picture's top right corner. Clicking it opens
the full-size image in a new browser window (a real window — not the in-OS Web
Browser, so the picture arrives at the browser's own size and zoom controls).

An image that is already being shown whole gets nothing at all: no link, no
badge, no change of cursor. The threshold is deliberately generous — the file
has to be half as wide again as the drawn image, and at least 64 pixels wider —
so that a picture only a little larger than the column is not advertised as if
there were more to see. Because the test is about the size the image ends up at,
it is repeated whenever that changes: dragging a ClackOS window wider until the
picture is shown whole removes the link, and narrowing it brings it back.

Three kinds of image are left alone. One the author has already linked by hand
(`[![thumb](small.png)](big.png)`) belongs to that link. One written inside a
raw HTML block — the BYOM hero photographs and system map on the EuroClack pages,
say — belongs to the layout around it, which is what decides how big it should
be; link it by hand there if it should open. And SVGs have no full size to open
in the first place, being drawn at whatever size the page gives them.

The same script runs in the desktop (`contentMounted` in `assets/js/clackos.js`),
in the Markdown Editor's preview, and on the [plain HTML mirror](#plain-html-mirror),
where `scripts/build_plain_site.py` adds it to any page that has an image.

### The right-hand end of the menu bar

Two fixtures live to the right of the menus, outside `menu.json` because they
are part of the shell rather than content:

- **The date**, as `25th July`, with a ▾. Clicking it pulls down the next
  eight upcoming events — date, title, when and where, with a **Luma** tag on
  the mirrored ones — and **Open Calendar** at the foot raises the Calendar
  window itself, as does clicking any row. It reads the same two files the app
  does through `assets/js/events.js`, and refreshes on every open, so a calendar
  committed from the app shows up without a reload. It closes the way a menu
  does: outside click, Escape, or opening a menu.

  The desktop **opens with this pull-down showing**, so what is coming up is the
  first thing a visitor sees without a window opening or anything moving. It
  waits for the list before appearing rather than flashing "Loading…", and it
  gives way to a visitor who has already started clicking. Nothing else about
  the opening desktop changes: `boot` in `content/site.json` still decides which
  windows open, and they still open centred.
- **The clock**, whose colon blinks once a second. That is a CSS animation
  rather than a timer, phase-aligned to the wall clock by `clackos.js` and
  stopped under `prefers-reduced-motion`.

Menus are inserted before `#menubar-right`, so they always fill the bar from
the left however many there are.

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

Built-in actions: `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`,
`reset`, `copy-desktop-link`, `forget-desktop`.
`{ "type": "submenu" }` nests the same item vocabulary one level deeper and
flies out to the right of its label; in a browser window too narrow to hold
that, the menu and its fly-out narrow themselves and wrap their labels so they
stay on screen rather than being cut off by the edge.
`{ "type": "wallpapers" }` expands to the wallpaper picker. Wallpapers are
bitmap files under `assets/backgrounds/`. Curated names and the default live in
`content/site.json`; additional bitmap files in the public repository directory
are discovered automatically and given a readable name. `"app"` items open the given HTML
page from the same menu folder in a desktop window; `multi: true` opens a
fresh instance every time it's picked from the menu. `integrated: true` is
reserved for in-desktop system utilities; all other app entries remain iframe
loadable. `plain: false` keeps an entry out of the [plain HTML
mirror](#plain-html-mirror)'s Applications menu — for apps that only mean
anything inside the desktop, like the wallpaper and palette editors.

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
window to the board.

An app that can end its own session closes its window by posting
`{ type: 'clackos-close-window' }` to the desktop. The window closed is the one
the message came from, so an app can only close itself. QBasic uses this for
File → Exit. Current apps:

Application links may include a query string. Only pages already registered as
`"type": "app"` in a menu can be launched, so Markdown cannot turn the desktop
into an arbitrary iframe launcher. The Markdown Editor's Insert menu creates
links for Video Lab and PDF Reader files, Falstad exported data or saved
circuit files, KiCad files, OpenSCAD files or inline OpenSCAD code, generic
registered applications (chosen from the current Applications menu), Markdown
windows, and desktop actions.

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
  The demo programs in `content/applications/qbasic/programs/` are copied into
  `C:\PROGRAMS`, which QBasic runs from, so its File → Open dialog lists them
  immediately. Static hosting cannot list a directory, so the set to copy comes
  from `programs.json`: run `scripts/build_qbasic_programs.py` after adding,
  renaming or removing a program. Names must be DOS 8.3 and the emulated CPU is
  modest, so keep drawing loops cheap (see `PLASMA.BAS`, which precomputes its
  sines). QBasic is started from the DOSBox shell rather than as a `-c`
  argument: it writes nothing to stdout, so the shell prompt reappearing there
  is how File → Exit is detected, and the app then asks ClackOS to close its
  window with a `clackos-close-window` message.
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
  images, video, and audio hosted in `assets/old_assets/` on the web host rather
  than in the repository. The same explorer powers File → Open from website in the
  Markdown Editor, ClackPaint, and PDF Reader. Markdown opens `.md` files and
  inserts links/media for other selections, Paint accepts images, and PDF
  Reader accepts PDFs. The standalone File Manager opens recognised files in
  their ClackOS application (including Paint, Markdown Editor, PDF Reader,
  Video Lab, OpenSCAD, Pure Data, Web Browser, and Text Editor); unknown file
  types show a confirmation before opening a browser tab. When a file matches
  more than one rule an "Open with" menu appears next to the Open button, so a
  `.md` file can be opened in the Markdown Editor, as a rendered page (the
  Markdown Viewer rule, which adds `view=rendered`), or in a browser tab.
  Associations are configured in `content/file-associations.json` rather than
  in the File Manager code. Rules are checked from top to bottom and may match
  `kinds`, `extensions`, and optional `drives`; each rule names the destination
  `app`, query-string `parameter`, label, optional fixed `params` appended to
  the query, and optional `source: "url"`.
- `applications/text.html` (Applications → System → Text Editor) — a small plain
  text editor with local open/save, File System Access support where available,
  website-file browsing, and startup association for `.txt` and related text
  files.

  The live `assets/old_assets/` directory intentionally cannot be enumerated
  over HTTP, so legacy media comes from `content/media-index.json`. After adding
  legacy media references to site content, refresh that catalogue with
  `python3 scripts/build_media_index.py`. Uploaded media is different:
  File Manager also reads the live `assets/upload.php?list=1` catalogue, which
  scans the configured uploads directory. Files under
  `assets/uploads/YYYY/MM/` therefore appear under Website Media → Uploads
  immediately; no GitHub Action or media-index commit is required.
- `applications/calendar.html` (Applications → System → Calendar) — the
  website's upcoming events, in a **Month** grid and an **Upcoming** list. The
  calendar is one CSV file, `content/applications/calendar/events.csv`, plus a
  read-only mirror of the events hosted on Luma (see “The events calendar”
  below); there is no database and nothing is stored server-side. Weeks start on Monday, today is marked, and selecting a day
  fills the sidebar with that day's events in full. The Upcoming view lists
  everything from today onwards, newest last, with a Show past events
  checkbox. Event notes are markdown, rendered by a small built-in renderer
  (headings, emphasis, lists, quotes, code, rules, links and images) that
  escapes everything first, so a note can never inject markup. Locations link
  out to Google Maps: the `map` column is used when it holds an `http(s)` URL,
  otherwise the app builds a Maps search from the location text. Event → New
  event…, the + in the sidebar, or the pencil on any event opens the editor
  (title, date, optional start time, optional end date and time, location, map
  link, notes); Delete needs a second click to confirm. File → Commit to
  website… publishes the regenerated CSV through GitHub's contents API with the
  same in-memory fine-grained token approach as the Markdown and Theme
  editors, and File → Open/Save CSV file… works on a local copy — in both cases
  only the CSV's own events, never the Luma mirror. It can be launched from a
  Markdown link with `?view=upcoming` or `?date=YYYY-MM-DD`.
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
- `applications/model-viewer.html` (Applications → 3D Model Viewer) — an STL,
  STEP, OBJ, 3MF and GLB viewer built on three.js (loaded from a CDN; STEP is
  triangulated by `occt-import-js`). Files are read in the browser and never
  uploaded unless you ask. The scene, loaders and lighting rig live in
  `assets/js/model-scene.js`, shared with the inline `@[model]` embeds, so both
  render identically. View fits, resets, wireframes and auto-rotates; Colours
  and Lighting follow the ClackOS palette until overridden, with five lighting
  presets, a brightness slider and shadows. **Animation** idles the model the
  way the old Windows 3D Viewer did — Turntable (the long-standing behaviour,
  which walks the camera round so the ground grid stays still), Swing, Jump &
  turn, Hover, Tumble and Rock, all of which move the model itself — with a
  speed slider and a Reverse toggle. The same set is available to inline embeds
  as `{animation=…}`. **Material** puts one finish over the whole model in place
  of whatever it came with, which is how you read a shape rather than its
  decoration: As authored, Model colour (the palette accent, still driven by
  Colours → Model), Clay (matte and near-white, like a plaster cast), Chrome and
  Normals (each face coloured by the direction it points, which makes flipped
  faces and bad smoothing obvious). **View → Squish** makes the model springy:
  left-drag takes hold of a patch of it and pulls that patch out of shape, the
  way you would pinch an inch of something soft; letting go springs it back, and
  the overshoot ripples outwards from the pinch before it settles (orbiting
  moves to the right button while it is on). The model itself is never
  simulated — imported meshes are hollow shells, and STL and OBJ have no shared
  vertices to hang springs from at all — so the springs live in a 9x9x9 cage
  around it (`assets/js/model-squish.js`, fetched the first time squish is
  switched on), and the mesh follows by trilinear interpolation of that cage in
  the vertex shader. The simulation therefore costs the same for three thousand
  triangles as for three hundred thousand, and the deformation itself is free.
  How local a pinch stays is set by how far a pull spreads through the cage
  before the springs pull it home, and the **Squish area** slider beside the
  toggle sets that: it is the width of the pinch as a percentage of the model,
  from 3% — a single feature lifted on its own, and as tight as a 9x9x9 cage can
  be asked to hold — up to 60%, where the whole body sways. The springs are
  retuned to match, so the pull home always gives out at about the width being
  asked for and the damping stays at the same fraction of critical, which keeps
  a small pinch quick and a large one slow rather than either going dead. The
  shadow follows all of it: the shadow map is a separate depth pass that knows
  nothing about a material's own vertex work, so it is given the same cage
  lookup. Because the cage moves vertices, it can only show detail the model
  already has — a flat CAD face is two big triangles with nothing between their
  corners to lift — so squish subdivides the model while it holds it, to
  whichever is smaller of a cage cell and the pinch itself, within a triangle
  budget, and puts the original geometry back when it lets go. Moving the slider
  can therefore call for finer triangles than are on screen; the re-cut waits
  for the next grab rather than running on every tick of the slider. Only the
  application offers it; inline embeds have no gesture to spare. Chrome is the one that needs something to
  reflect, so the first time it is picked the viewer builds a reflection map
  from three's own studio-room scene, fetched alongside the rest of the addons;
  the other finishes are immediate. Embeds take the same set as
  `{material=…}`. **Axes** maps the file's axes onto
  the world's: three.js is Y-up while CAD and slicers write Z-up, so STL, STEP
  and 3MF are turned a quarter turn as they load (OBJ is left alone) and any of
  the six orders can be picked by hand (GLB is Y-up by specification, so it is
  left alone too). Colours a file brings with it win over the palette and are
  shown as authored: STEP carries a colour per part and per b-rep face, which
  become one material per colour; GLB carries whole PBR materials, kept
  untouched, textures and all. Only geometry that names no colour of its own
  follows Colours → Model, and the status bar says which you are looking at.
  GLB extras are handled where they can be and dropped where they cannot: Draco
  and meshopt compression and KTX2 textures are decoded (their decoders are
  fetched from the same three build on first use), the file's own lights are
  dropped in favour of the viewer's rig, and a file that brought its own
  animation plays it (Animation → Model's own animation turns it off; the entry
  stays disabled for a file that has none). `.gltf` is deliberately not accepted: the JSON form
  points at its buffers and textures as separate files, which does not survive
  being passed round as a single upload. File → Upload to website… sends the open
  model to the web host through the same endpoint ClackPaint and the Markdown
  Editor use, and hands back the public URL plus a ready-made `@[model]`
  directive — including `{axes=…}` when the viewer is not on the format default.
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
  side-by-side split rendered by the site's own renderer
  (`assets/js/markdown.js`) with the shared content styles
  (`assets/css/content.css`), so the preview is what a ClackOS window and the
  plain mirror will show — embeds, button rows and eyebrow headings included. Open/save uses the
  File System Access API where the browser supports it (true in-place
  saving); elsewhere saving downloads the file. Drag-and-drop works,
  Ctrl+S saves. File → Open from website… opens the shared file manager:
  Markdown files load into the editor, while other files insert a suitable
  link or media embed (a `.stl`, `.step`, `.stp`, `.obj`, `.3mf` or `.glb` file
  inserts an inline `@[model]` viewer). A file passed as `?repo=` (or `?open=`) with
  `view=rendered` opens straight into the rendered preview — what the File
  Manager's Markdown Viewer entry does — and the toolbar's preview button
  switches back to the source. `?new=post` opens a blog post dated today
  instead of a file, which is what the last line of the blog list links to.
  File → Commit to website…
  publishes an edit straight to the repo through GitHub's contents API:
  it needs a fine-grained personal access token (GitHub → Settings →
  Developer settings → Fine-grained tokens; scope it to this repo only
  with Contents read & write and an expiry). The token is pasted once
  per session and held only in memory. The target repo/branch comes
  from `repo`/`branch` in content/site.json — update `branch` if the
  site moves to main. New blog posts committed this way are indexed
  automatically by the GitHub Action in
  .github/workflows/blog-index.yml, which rebuilds the blog pages and the
  blog list on push. The toolbar icons are plain text glyphs, so nothing is
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
  website background opening; PNG saving and uploading straight to the web host
  (File → Upload to website…); image-size resampling, anchored
  canvas resizing, crop selection, flip, invert and clear. Documents retain a
  reorderable layer stack with visibility, rename, duplicate, delete and merge
  controls; rectangular, freehand-lasso and edge-snapping magnetic-lasso
  selections can be copied or cut directly to a new layer from the canvas
  right-click menu. Image → Form-Detecting Scale opens a Photoshop-style
  transform box: drag any edge or corner handle, hold Shift on a corner to
  preserve the aspect ratio, then Apply (or press Enter). While a handle moves,
  a debounced low-resolution seam-carved proxy updates live; superseded worker
  jobs are cancelled so dragging stays responsive. The exact-size dialog remains
  available alongside it. The final full-resolution worker pass shrinks or
  enlarges every layer along shared low-detail paths, optionally protecting the
  current selection. The zoom tool
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

## Saved desktops and shareable links

The desktop remembers itself between visits, and there is still no server
involved. On every change ClackOS writes a small snapshot to `localStorage`
(key `clackos-session`) holding which windows are open, where they sit, how
large they are, which one is in front, whether they are minimised or
maximised, how far each markdown document is scrolled, the theme and
wallpaper, and whatever state each app chooses to report. On the next visit
that snapshot is replayed instead of the `boot` list in `site.json`; the boot
list is still what a first-time visitor gets.

**View → Copy link to this desktop** encodes the same snapshot into the URL
after a `#`, deflate-compressed and base64url-encoded:

```
https://clacktronics.co.uk/#desktop=zVNNb9swDP0rgs9x4qRJm...
```

Because it is a fragment it is never sent to the web host — the whole desktop
travels inside the link itself. Opening one restores that desktop in any
browser, then clears the hash so the visitor carries on with a session of
their own. Window ids arriving this way are treated as untrusted: an
application must be one already registered in a `menu.json`, and a document
must be a markdown path under `content/` with no traversal, so a link cannot
turn the desktop into an arbitrary iframe or file viewer. A desktop carrying
more app state than fits in a sensible URL is shared as window layout only,
and the toast says so.

**View → Forget saved desktop** deletes the snapshot and stops saving for the
rest of the visit (otherwise the next click would write it straight back);
remembering resumes on the next load.

Two menu items reboot the desktop, and they differ in how much they take with
them:

- **File → Restart** drops the saved desktop and reloads, so the windows come
  back as `site.json`'s `boot` list has them. The theme, the wallpaper and
  everything the applications have saved are left alone.
- **View → Reset** clears everything this browser holds for the site —
  `localStorage`, `sessionStorage`, the `clackos-theme-default` cookie and the
  Cache Storage entries the applications fill (ClackChat's downloaded language
  model among them) — and reloads into the site as a first-time visitor sees
  it. Browser-saved work goes with it, so it asks for confirmation first.
  IndexedDB is left alone.

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

`connect()` returns `{ report, schedule, capture, apply }` — `schedule()` is a
debounced `report()`, for state that changes on every keystroke. With
`controls: true` the helper reports by itself whenever a control changes, and
on restore it sets the values and then fires `input`/`change` so the app
recalculates. Pass `dispatch: false` when those synthetic events would fight
the app (the PCB Heater's pattern select resets pitch and iteration depth to
that pattern's defaults) and use `restore` to call the app's own recompute
instead. Under the hood the app posts `{ type: 'clackos-state', state }` and
`{ type: 'clackos-request-state' }` to the desktop, which replies with
`{ type: 'clackos-state-restore', state }`; iframe apps use `postMessage`,
integrated apps the same `clackos-message` DOM event as the rest of the
protocol. State is stored as JSON and capped at 64 KB per window, so keep it
to settings and documents rather than bitmaps or audio.

Opening an app page directly, outside the desktop, is a no-op: there is nobody
to report to and nothing to restore, so the standalone entry points behave
exactly as before. Apps wired up so far are the PCB Heater Designer (its whole
control panel) and the Text Editor (its document, name and caret); apps
launched with a query string — the Markdown Editor's `?open=`, for example —
already come back with the right file because that query is part of the
window's id.

## Plain HTML mirror

`plain/` is a no-desktop mirror of all the markdown content — ordinary HTML
pages with standard links, for readers (and machines) that don't want the
ClackOS window manager. Its menu contains File (Open, Report bug, and Edit)
plus the same Applications hierarchy as ClackOS, minus the entries marked
`"plain": false` in `content/applications/menu.json` — apps that only do
something with a desktop around them (Appearance, Theme Editor, Web Browser,
File Manager). A submenu left empty by that filter is dropped
too. `window:` links become normal
page-to-page links in the current tab, while `app:` links open the standalone
application as a full page in a new tab. The
`@[youtube]` / `@[video]` / `@[kicanvas]` / `@[model]` embeds still render inline, raw HTML
blocks go through the same sanitiser policy as ClackOS, and headings get the
same generated anchor ids so `[jump](#heading)` links work. The
pages reuse `assets/css/clackos.css` plus the active theme from `site.json`,
so the mirror keeps the ClackOS typography and palette. Phones get the desktop
like everyone else — the mirror is a choice, not a redirect — so each page
footer links back to the desktop version, and the taskbar links to the mirror.

The mirror is generated — don't edit `plain/` by hand (the same run also writes
the root `sitemap.xml` and `robots.txt`; see [Search engines](#search-engines)).
A GitHub Actions
workflow (`.github/workflows/plain-mirror.yml`) regenerates it automatically
whenever anything under `content/` changes. To rebuild it locally:

```sh
python3 scripts/build_plain_site.py
```

## Search engines

The ClackOS desktop builds itself in the browser, so `index.html` has no
content of its own and the site has no per-page URLs — every window is a menu
click. The **plain mirror is therefore the crawlable site**, and the same
generator produces the metadata that makes it indexable:

- a per-page `<title>` (with the site name appended when the frontmatter title
  doesn't already carry it), `<meta name="description">`, Open Graph and
  Twitter-card tags, and a self-referencing `<link rel="canonical">`;
- `sitemap.xml` and `robots.txt` at the repo root — both only work from the
  origin root, so they sit beside `index.html` rather than inside `plain/`;
- `BlogPosting` JSON-LD on posts (with `datePublished` from the filename) and
  `WebSite` JSON-LD on the home page.

`index.html` carries a relative `<link rel="canonical" href="plain/index.html">`
so the empty desktop shell doesn't compete with the mirror's copy of the same
page — the shell serves the desktop to every device, so the canonical link is
the only thing pointing crawlers at the mirror.

The description is taken from `description:` in the frontmatter, else
`tagline:`, else the first real paragraph, trimmed to ~155 characters. Blog
posts keep their date in `tagline:`, which makes a poor search snippet, so a
date-shaped tagline is skipped in favour of the prose. **Write a
`description:` line** for any page whose opening paragraph would read badly in
search results. `robots: noindex` in the frontmatter keeps a page crawlable but
out of the index and out of the sitemap (the Markdown test page uses it).

Canonical links, Open Graph URLs and sitemap entries have to be absolute, so
the build needs to know where the pages will be served from:

- `"siteUrl"` in `content/site.json` is the default (the live root);
- the `SITE_URL` environment variable overrides it. The deploy workflow derives
  `SITE_URL` from its own `SUBDIR`, so a build staged in a subfolder emits URLs
  under that subfolder instead of pointing crawlers at pages it isn't serving.

`SUBDIR` is now empty, so the deploy publishes to the web root and the two
agree. To stage a build somewhere harmless again, set `SUBDIR` to a folder name
in `.github/workflows/deploy-purely.yml` — that one job-level knob drives both
the rsync destination and the URLs.

## Deploying to a web host (purely.website)

GitHub stays the source of truth; a GitHub Action copies the built site to the
web host so everything is served from one origin. `.github/workflows/deploy-purely.yml`
runs on every push to `main` (and can be run by hand from the Actions tab) and
`rsync`s the repo to the host over SSH. It uploads only changed files, never
deletes on the host, and excludes VCS/CI files, `scripts/`, the notes, and the
upload folders. It publishes to the web root; set `SUBDIR` in the workflow to a
folder name to stage a build in a subfolder instead.

### The move from `/temp/` to the root

The site was staged under `https://clacktronics.co.uk/temp/` while it was being
built out. Emptying `SUBDIR` moves the deploy to the web root, and the root
`.htaccess` 301s `/temp/…` to the matching root path so indexed and pasted links
follow across. Two things on the host have to be done by hand, because the
deploy never deletes and never touches `assets/uploads/`:

1. **Move the legacy media into `assets/old_assets/`.** The WordPress-era
   images sat directly in `public_html/assets/`, which is the same directory
   the repo's own `assets/` (CSS, JS, themes) now deploys into — so they are
   filed one level down, out of the way:

   ```sh
   cd public_html/assets
   mkdir -p old_assets
   # everything that was there before the repo's assets/ landed on top of it
   mv 643_*.jpg *.gif thumb_*.jpg … old_assets/
   ```

   The post bodies link to `assets/old_assets/NAME` (site-root-relative), so
   nothing needs re-editing once the files are in place.
2. **Move the uploads.** `mv public_html/temp/assets/uploads public_html/assets/uploads`
   — media uploaded during staging lives only on the host, and the post bodies
   now link to it at the root path.
3. **Move the upload config.** `mv public_html/temp/assets/upload-config.php ~/upload-config.php`
   — the upload token is git-ignored and excluded from deploys, so it too stayed
   behind in the old tree, and without it every upload fails with *“Upload
   endpoint is not configured on the server”*. Putting it in your home directory
   rather than back inside `assets/` is deliberate: `upload.php` searches upwards
   as well as beside itself (see “Uploading images, video and 3D models”), so one
   copy above the web root survives this move and any future one. If it sets
   `base`/`dir`, drop those lines — they still point into `/temp`, and uploads
   would keep landing there.
4. **Delete the old copy.** `rm -rf public_html/temp` once the root is serving.
   Until it is gone the stale tree keeps answering `/temp/…` (a subdirectory's
   `.htaccess` rewrite rules are not inherited from the parent, so the redirect
   above cannot reach inside it) and search engines see the whole site twice.

Neither `assets/uploads/` nor `assets/old_assets/` is in Git, and the deploy
excludes both, so a later deploy will never overwrite or remove them.

It needs these repository secrets (Settings → Secrets and variables → Actions):
`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` (a key whose public half is in the
host's `~/.ssh/authorized_keys`), `DEPLOY_PATH` (the absolute web root, e.g.
`/home/USER/public_html`), and optionally `SSH_PORT` (defaults to 22).

## Uploading images, video and 3D models

Large binaries do not belong in Git (repo-size and Actions limits), so the site
links to media served from the web host instead — the same pattern the old blog
posts already use. ClackOS can upload media straight to the host from the
browser and hand back a URL to link:

- **Applications → Markdown Editor… → Insert → Upload image, video or 3D model…**
  (or just drag an image, video, audio or model file onto the editor). The file
  is sent to the host, and the returned URL is inserted as `![](…)`,
  `@[video](…){controls}`, `@[model](… "name")`, or a plain link depending on
  its type. Insert → Inline 3D model… (and the toolbar's model button) writes
  the same directive for a file that is already on the site, asking for the
  path, an optional caption and an optional option string.
- **Applications → 3D Model Viewer → File → Upload to website…** sends the model
  currently open to the host and shows the public URL, with buttons to copy the
  link or the whole `@[model]` directive for pasting into a page.
- **Applications → ClackPaint… → File → Upload to website…** sends the picture
  you are working on to the host as a PNG (never through GitHub) and shows the
  public URL with a Copy link button, ready to paste into a post.

The endpoint is `assets/upload.php`, named by `"assetUpload"` in
`content/site.json` and resolved against the site root (so it is same-origin —
no CORS needed once the site is on the host). It stores files under
`assets/uploads/YYYY/MM/`, which the deploy never touches and Git ignores.

**One-time server setup.** Because the repo is public, the secret is not in it.
On the host, copy `upload-config.example.php` to `upload-config.php` and set a
strong `token` (e.g. `openssl rand -hex 32`). That file is git-ignored and
excluded from deploys, so it never leaves the server. Paste the same token into
the editor's upload dialog (kept in memory for the session only). The site is
served from the web root, so the returned URLs are already canonical and
`base`/`dir` can stay unset; they only matter if you stage the site in a
subfolder again.

`upload.php` looks for the config in the path in `$CLACKOS_UPLOAD_CONFIG` (if
that is set, e.g. by `SetEnv` in `.htaccess`), then beside itself, then in each
directory above it, four levels up. **Keep it above the web root** —
`/home/USER/upload-config.php`, outside the deployed tree — and it is found
wherever the site is served from, so moving or restaging the site cannot leave
the token behind. Uploads themselves are unaffected by where the config lives:
with `dir` unset they always go into an `uploads/` folder beside `upload.php`.

If uploads fail, the endpoint now says which of these it is rather than a flat
"not configured": no config file found (and the exact list of places it looked),
a config that does not return a settings array or fails to parse, an unset
`token`, or the example placeholder token still in place.

**How malicious uploads are prevented.** Every request needs the secret token
(constant-time checked); only an allow-list of image/video/audio types is
accepted, with the stored extension taken from the file's *sniffed* content type
rather than its name; 3D models (STL, STEP, OBJ, 3MF, GLB) have no MIME type of their
own that `finfo` reports, so they are matched on their actual content instead —
a binary STL's triangle count must account for its exact byte length, a STEP
must open with `ISO-10303-21;`, a 3MF must be a zip containing a
`3dmodel.model` part, a GLB's header must declare a total length equal to the
file's own, and so on, with the filename still trusted for nothing; filenames are generated server-side (date + random) so
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
