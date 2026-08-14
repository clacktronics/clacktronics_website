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
  js/midi-bytes.js          ← MIDI messages in words (ClackTerm + MIDIterm)
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
    about.md
```

Apps (`*.html`) are complete standalone pages — open
`content/applications/paint.html` directly and it works on its own — and
ClackOS shows the same page inside a desktop window. Apps use an iframe by
default; trusted system utilities marked `"integrated": true` in `menu.json`
mount into an isolated shadow root instead. They share `assets/css/app.css`
for the look and retain their standalone entry points.

An app running in a window offers the way out to that standalone page:
ClackOS adds **File → Open app in new tab** to the app's own menu bar, and
gives a bar to the full-window apps that have none. Apps marked
`"plain": false` in `menu.json` are desktop-only — they drive the shell
itself — so they get no such link, the same ones the plain mirror leaves out
of its Applications menu.

An app opened on its own offers the way back the other way: **ClackOS**, the
first item in its menu bar, linking to the desktop (`assets/js/app-home.js`,
loaded by every app page). It appears only when the app *is* the page — inside
a ClackOS window the desktop is already there — and full-window apps with no
bar are given one for it. Both links build their bar with
`assets/js/app-bar.js`.

### The app menu bar on a phone

A window on a 390px phone is about 366px wide, which is narrower than most
apps' menu bars. Two things in `assets/css/app.css` keep the menus reachable
there, and both apply to `.rm-standalone-bar` too (the copy of the same rules
inside `assets/js/app-bar.js`, for apps that style themselves):

- **`.rm-bar` wraps.** A flex row that does not wrap has no scrollbar and no
  second line, so a menu past the right edge is not scrolled off, it is gone —
  ClackPaint lost Image and Effects, Pure Data lost everything past Put. A
  wrapped bar takes a second row only when there was no room for one, so
  nothing changes on a desktop. Scrolling the bar sideways was the other
  option and is the worse one: it makes the bar a clipping box, and then the
  dropdowns are cut off at the bar's own height instead (Video Lab tried it
  that way first — see the comment in `content/applications/video/styles.css`).
- **Dropdowns are nudged back inside.** `.rm-dd` is anchored under its own
  button, so on a narrow bar each successive menu opens further off the right
  edge. `place()` in `assets/js/app-menu.js` measures an opening dropdown and
  shifts it left until it fits, stopping at the left edge of the bar; the
  `max-width` in the CSS narrows one too wide to be shifted anywhere useful.
  It measures against **the bar, not the viewport**, because an integrated app
  draws its menus in the desktop document, where the viewport is the whole
  screen and the app is only as wide as its window. This is the same clamp the
  desktop's own menus have always applied in `assets/js/clackos.js`; the app
  bar is a separate implementation that needed its own.

A non-wrapping bar was also what pushed several app pages wider than the
screen: a `nowrap` flex row sets a min-content width the document has to
honour, so the bar alone was making Python, Pure Data and the 3D Model Viewer
scroll sideways. With it wrapping, every app page fits a 320px screen.

Video Lab and ClackMosh keep private copies of the menu chrome rather than
loading `app.css`, so a change here needs the matching change in
`content/applications/video/styles.css` and
`content/applications/clackmosh/styles.css`.

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
pickers and preview it live across the website. The Media treatment section
can leave media untouched, make it black and white, add a warm cast, create an
orange monochrome treatment, or tune the grayscale, warmth, hue, saturation,
brightness and contrast manually. The treatment follows photos, video,
canvas-rendered tools and the desktop wallpaper while leaving interface text
and controls on their explicit theme colours. Its Template file dropdown is
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

### Status, scrim and series roles

The palette proper describes surfaces, text and one accent. It has no word for
"this went wrong" or "careful", so for a long time every app that needed one
wrote its own red or amber out in hex — and then kept it through a theme
change. Four roles close that gap, and the Theme Editor offers them under
**Status**:

| Variable | Used for |
| --- | --- |
| `--danger` | errors, destructive actions, recording, a mine going off |
| `--warning` | cautions, a busy lamp, a hot level meter, code `[!CAUTION]` |
| `--ok` | success and confirmation; defaults to `--leaf-deep` |
| `--info` | informational text and secondary data; defaults to `--sage` in the editor |

Three more groups are **derived in the base stylesheet rather than set by a
theme**, so a palette written before they existed — or by someone who has never
heard of them — still moves them:

- `--overlay` and `--overlay-strong` are the scrims behind modals, dialogs and
  drop targets, mixed out of `--shadow`. They used to be written as
  `rgba(9, 20, 13, …)`, which is the *default* theme's ink, so every modal on
  the website laid a swamp-green veil over whatever palette was actually
  chosen.
- `--series-1` … `--series-6` are plot traces and chart series, used by the
  serial and MIDI consoles, the graphing calculator and Clacksweeper's
  neighbour counts. They are derived from the palette, so a new theme gets a
  matching set of traces without naming them.

Because the derived roles are built from variables the theme *does* set, only
the four status colours need adding when writing a palette by hand.

**What is deliberately left alone.** Some colours on the site carry meaning
rather than style, and a theme must not move them: the resistor colour code,
the PCB layer colours in the panel and heater tools, CircuitJS1's green
positive and red negative voltage, ClackPaint's transparency checkerboard and
default swatches, the RGB channel traces in the gamma table, and the two-tone
selection outlines that have to read over arbitrary artwork. The graphing
calculator's Oscilloscope and Blueprint surfaces keep their own fixed palettes
too — those are drawing surfaces the reader picks, not the theme showing
through. On the `monochrome` theme the series roles collapse to near-identical
greys, which is that palette working as intended; the tools that use them all
carry a label or a digit as the primary cue.

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
tile repeated across the window rather than one image the size of the window —
laid down smaller on a dense display rather than encoded bigger, so a step
costs the same on a retina screen as anywhere else. Each tile is decoded before
it is handed to the mask, because Firefox decodes the images CSS asks for off
the main thread and paints a window whose mask has not arrived as gone rather
than as half dissolved; a browser that cannot encode and decode fast enough
takes the window out in fewer, coarser steps instead of losing the dissolve.
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

### The taskbar, and what it drops on a phone

The taskbar holds the window buttons in `#tasks`, then three fixtures: the
**Plain HTML** link to the mirror, the **CPU/RAM** readouts (browser telemetry
— CPU is a pressure state, not a percentage; RAM is this page's JS heap), and
the **build stamp** naming the deployed commit.

`#tasks` is the only flexible one; everything after it is `flex: none` and
`white-space: nowrap`. On a 390px phone those three were taking 292px of the
bar between them and leaving the window switcher 23px to sit in — one open
window's button wants 120px minimum, so it was unreadable and the control you
most need on a small screen was the one squeezed out. Below 640px the
telemetry and the build stamp are therefore hidden and the task buttons
narrow, which gives `#tasks` about 243px and room for two legible windows.
The Plain HTML link stays: the mirror being one tap away is the reason it is
in the taskbar at all.

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
`allow` is handed to the app's iframe as its permission policy, so an app that
talks to hardware asks for what it needs by name — `"allow": "serial; usb"` for
ClackTerm, `"allow": "midi"` for MIDIterm — and every other app is loaded
without it.

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
- `applications/modem.html` (Applications → Multimedia → ClackMo) — a faux
  modem that turns typed text into real audio modulation, plays it and saves it
  as a 16-bit mono `.wav`. Fifteen protocols in five families: DTMF and MF R1
  signalling; Bell 202 AFSK (raw async or a genuine AX.25 UI frame, with bit
  stuffing, NRZI and an X.25 frame check sequence), Bell 103, V.21, V.23, RTTY,
  Morse and multi-channel CW (a line per channel, each with its own tone, speed
  and start time, keyed at once and summed); the Kansas City Standard, ZX
  Spectrum and Commodore 64 cassette formats; SMPTE linear timecode; and PSK31
  and Bell 212A/V.22 DQPSK. Every
  parameter that defines a mode — baud, mark and space frequencies, pulse
  lengths, callsigns — is editable, and the signal is redrawn as a spectrogram
  and waveform as it changes. Send a signal to Sound Recorder through the shared
  audio clipboard to edit it there. The modulators live in
  `applications/modem-protocols.js`, one `encode` per protocol over a single
  Writer that owns sample timing and phase; the framing helpers are kept
  separate from the tone generation so the decoders could be written beside
  them. Signals are capped at three minutes.
- `applications/modem-rx.html` (Applications → Multimedia → ClackDem) — the
  other half: it takes audio and reads it back into text.
  Thirteen of the fifteen modes decode (V.22 DQPSK and multi-channel CW are
  encode-only so far). Audio comes from a WAV or other file the browser can
  decode, from a drop onto the window, from the shared audio clipboard, or live
  from the microphone, where the waterfall scrolls and characters appear as
  they arrive. The parameters are the tuning controls — mark and space
  frequencies, baud, framing — and what the demodulator actually measured is
  shown beneath them along with a lock lamp, which is the quickest way to tell
  a mistuned parameter from a bad recording. Output can be read as text or as a
  timestamped event log carrying frame boundaries, callsigns and checksum
  results. Because both windows are ordinary apps, putting the encoder and the
  receiver side by side and pressing Play in one while the other listens
  decodes the signal acoustically, out of the speakers and back in through the
  microphone.
- `applications/modem-decoders.js` — the demodulators, in four front ends: a
  Goertzel tone bank for DTMF and MF R1; a quadrature correlator pair feeding
  asynchronous framing for Bell 202, Bell 103, V.21, V.23, RTTY and the Kansas
  City Standard, and a bit-clock recovery loop with NRZI, bit destuffing and a
  verified frame check sequence for AX.25; zero-crossing interval timing for
  the ZX Spectrum and C64 tape formats and SMPTE timecode, checksums verified;
  and a differential detector with the varicode alphabet for PSK31. Morse is
  read from the envelope of the keyed tone. Every decoder is a state machine
  fed by `push()`, so the same code runs over a whole file and over a
  microphone delivering a few thousand samples at a time. The alphabets and
  tone plans are read back out of `modem-protocols.js` through its `tables`
  export rather than copied, so an encoder's alphabet cannot change without its
  decoder following.
- `applications/scope.html` (Applications → Multimedia → ClackScope
  Oscilloscope) — an oscilloscope for audio, laid out the way a bench
  instrument is: a screen carrying the numbers that change while you watch, and
  a column of settings beside it. Input is the soundcard (needs HTTPS +
  permission; the browser's echo cancellation, noise suppression and automatic
  gain are all turned off, since they gate and filter exactly the signal the
  instrument exists to show), an audio file opened or dropped on the screen and
  played through the speakers, or a built-in test tone with a waveform, a
  frequency and a channel ratio — the tone is what the app opens with, so it
  draws something before any permission has been granted. One volt on the
  graticule is digital full scale.

  Four displays, all off the same pair of `AnalyserNode`s (32768 points, so a
  node gives both the newest 0.7 s of samples and their spectrum, which is a
  timebase and an FFT for the price of one node per channel):

  - **Sweep** — a triggered Y-T trace. The trigger hunts the level crossing
    inside the captured block rather than trusting the clock, with hysteresis so
    noise cannot arm it, and takes the most recent crossing so the picture is as
    fresh as the buffer allows. Rising or falling, either channel as the source,
    and Auto / Normal / Single: Auto sweeps anyway and says `AUTO`, Normal holds
    the last triggered picture until an edge arrives, Single freezes on the
    first one. Fast sweeps are drawn sample by sample and slow ones as one
    min/max column per pixel, which is what a real timebase does at its two
    extremes.
  - **Roll** — the envelope, scrolling. A screen at 100 ms/div is twelve times
    longer than the analyser holds, so the newest samples are reduced to
    min/max pairs two milliseconds wide and pushed into a ring buffer: peak
    detect, which is what a bench instrument switches to when a pixel is worth
    more than a cycle. Sweep and roll are two ends of one timebase — stepping
    past 50 ms/div moves into roll and back out again — but each remembers where
    it was left.
  - **X-Y** — right channel across, left channel up, for stereo. Its divisions
    are kept square whatever shape the window is, or a circle comes out an
    ellipse and the figure stops meaning anything.
  - **FFT** — the spectrum on a log frequency axis from 20 Hz to Nyquist, 10 dB
    a division, with its own decade graticule. The peak bin is refined by the
    parabola through its neighbours, and that same reading feeds the `Freq`
    measurement in every mode.

  Volts and time per division are 1-2-5 steppers (also the wheel over the
  screen, Shift for time, and the arrow keys); each channel has a vertical
  position, drawn as a ground marker at the left edge the way a DSO draws it,
  and the trigger level rides its own source channel's position rather than the
  middle of the screen. AC coupling is the instrument's, not the browser's: the
  offset is measured off the captured block and subtracted on the way to the
  screen, never taken out of what is heard. Persistence is a phosphor: the trace
  layer is eaten away a little each frame instead of cleared, off / short /
  long. Measurements are Vpp, Vrms, peak in dBFS and frequency, with a peak
  hold; **Measure → Copy Readings** puts them on the clipboard and
  **File → Save Screen as PNG** saves the screen. `Space` runs and stops — STOP
  freezes the picture rather than the maths, so what is on the phosphor when it
  stops is what stays there.

  The canvas cannot resolve `var()`, and the palettes are not all dark-on-light
  — `blood` paints white ink on red paper, `tasteless` mint on tan — so rather
  than assume `--ink` is the dark one, the screen takes whichever of the two
  grounds is darker and picks its trace colours from the theme by contrast
  against it, falling back to plain white or black for the readouts when no
  theme colour clears a contrast ratio of 4. State (mode, both scales, trigger,
  positions, persistence) is saved with the desktop through
  [app state](#letting-an-app-remember-its-own-state); the input is deliberately
  not, so a restored session cannot reopen the microphone by itself.
- `applications/modem-ui.js` — what the two share: the waterfall and waveform
  scope (including its live scrolling mode, one column per FFT hop), the
  parameter form, the protocol menus, the 16-bit WAV container, file reading
  and resampling, the shared audio clipboard and the transport.
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
- `applications/gamma-table.html` (Applications → Electronics → Gamma Table) —
  builds the gamma-correction lookup table an LED needs to fade the way the eye
  expects. Mono or RGB (a curve and a gamma per channel, linked by default), any
  table length from 2 to 4096 steps, and an output range of 8, 10, 12 or 16 bits
  or a maximum of your own. The gamma sets the shape and the handles on the
  graph adjust it: drag one to bend the response, double-click the graph to add
  another, shift-click or right-click one to take it away. A handle holds its
  distance from the plain gamma curve rather than an absolute height, so the
  shaping survives moving the gamma slider, and Reset handles puts every one of
  them back on the curve. Between the handles the curve is a monotone cubic, so
  it never overshoots into a dip the LED would show as a flicker. Underneath,
  two strips preview the ramp — the corrected one against the same number of
  uncorrected steps — with the linear duty cycle sRGB-encoded, since a screen
  and an LED do not share a response. The table comes out as an Arduino/C header
  (`uint8_t`/`uint16_t`/`uint32_t` to suit the range, optionally `PROGMEM`), a
  MicroPython `array` module, or CSV, each ready to copy or download, and the
  panel beside the graph counts the distinct levels, the steps stuck at zero and
  the memory the table will take. Everything it holds is remembered by the
  desktop through `assets/js/app-state.js`.
- `applications/serial-console.html` (Applications → Electronics → ClackTerm) —
  a serial console. It talks to a USB serial port over **Web Serial** — baud
  rate including a custom one, 7 or 8 data bits, parity, stop bits, RTS/CTS,
  DTR and RTS as outputs, CTS/DSR/DCD/RI shown as they arrive, a break, and a
  DTR pulse for the reset an Arduino expects — and to a **demo device** that
  pretends to be a GPS receiver, an Arduino printing telemetry, a Modbus slave,
  a modem, a GRBL controller, a DIN MIDI keyboard or an echo, which is what
  makes the app worth opening in Firefox and Safari, where Web Serial does not
  exist. Both can be open at once and every row says which it came from.

  What arrives is put through one of ten interpreters: plain text (carriage
  returns, backspaces and ANSI escapes behave as a terminal's would, so a
  MicroPython REPL reads properly), a hex dump, NMEA 0183 with the checksum
  verified and the fix, position, speed and satellites named, Modbus RTU cut
  into frames on the idle gap with the CRC checked and the function and any
  exception in words, MIDI bytes with running status and SysEx (DIN MIDI on a
  UART at 31250 baud), SLIP (RFC 1055) and COBS framing, AT commands with the
  final result codes classified and signal strength converted to dBm, GRBL
  replies with the error and alarm numbers spelled out and the `?` status
  report split up, and telemetry — `temp:23.4,rh:41` or plain comma-separated
  numbers — which feeds a strip-chart plotter that autoscales, fits each line
  to its own range on request and hides a line when its legend entry is
  clicked.

  Sending is by typed text with the line ending of your choice, by bytes in hex
  (`1B 5B 41`, `0x0D` and `"text\r\n"` all read the same), by six editable
  macros, by file, or by repeating what is in the box on an interval. Send →
  keystrokes straight out turns the console into a real terminal — control
  keys, arrows as ANSI sequences, no local echo, so what you see typed is the
  device echoing it back. The console filters on text or a regex, timestamps by
  clock, by delta or since connecting, holds still while you read, and saves as
  text, as the raw received bytes, or as the plotted numbers in CSV. Everything
  but the connection itself is remembered by the desktop through
  `assets/js/app-state.js`.

  Link → the two bridge entries hand DIN MIDI to **MIDIterm** in another
  window, and take MIDI back the other way, over a `BroadcastChannel` named
  `clackos-midi-bridge` — a serial port with a MIDI adapter on it therefore
  reaches a real MIDI output without either app taking on the other's job. The
  menu entry carries `"allow": "serial; usb"`, which is how ClackOS knows to
  delegate device access to that app's frame and no other.
- `applications/midi-console.html` (Applications → Multimedia → MIDIterm) — a
  MIDI monitor and console over **Web MIDI**. Every message is decoded in
  words by `assets/js/midi-bytes.js`, the parser ClackTerm uses for DIN MIDI —
  notes with their names, controllers with theirs, program changes, pitch bend
  as a signed number, aftertouch, channel mode messages, system common, the
  realtime bytes, and SysEx named by manufacturer, with the universal messages
  (identity request and reply, GM on) called what they are.

  It can listen to one input or to every input at once, which is how you find
  out which cable is which. Message types and channels filter separately, and
  clock and active sensing start hidden because they bury everything else —
  the tempo is still read off the incoming clock and shown in beats per minute
  whether or not the messages are on show. A lane per channel lights as
  traffic arrives and counts what is sounding, and the plotter draws every
  controller, bend, aftertouch and note velocity that comes in, one line per
  channel and controller.

  Under the log sits the keyboard, the width of the window, with the channel,
  velocity, octave, CC, program, bend and clock controls in a row above it. It
  plays, and it shows the notes held at the input, so you can watch what a
  controller is sending. How many octaves it spans follows the width — keys
  keep their proportions rather than stretching into planks on a wide desktop
  — every C is named, and keys a high bottom octave would push past note 127
  grey out. View → Keyboard and controls puts the whole strip away.

  Sending covers notes, CC (with a slider that sends as it moves), program
  changes, pitch bend that springs back to centre, raw bytes in hex, panic and
  reset-controllers on all sixteen channels, and a clock at a tempo you set —
  aimed at absolute times rather than `setInterval`, which rounds 20.833 ms
  down to 20 and turns 120 bpm into 125. SysEx gets a librarian: dumps are
  captured as they arrive and save as a `.syx` file, and a `.syx` file sends
  back a message at a time with a gap old instruments need. Thru passes the
  input to the output untouched, and the same `clackos-midi-bridge` channel
  carries messages to and from ClackTerm. The log saves as text or as CSV, one
  row per message. A demo instrument — an arpeggiating synth, a controller, a
  clocked sequencer, or a synth that answers an identity request — drives the
  whole app without hardware. The menu entry carries `"allow": "midi"`.
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
  selection tools; a full Effects menu (see below); the
  classic 28-colour box with left/right-click foreground/background
  colours; arbitrary bitmap dimensions up to 8192 × 8192; undo/redo with a
  Photoshop-style History panel under the layers (every state named after the
  action that made it, click one to step back or forward, ⌫ clears the states
  to release their memory, Layer → Minimise History Panel folds it away). The
  rail holding both panels starts folded to its edge tab so a fresh window gives
  the canvas the width; open it from the tab or with Layer → Minimise Layers
  Panel and that choice is remembered from then on. Local or
  website background opening; PNG saving and uploading straight to the web host
  (File → Upload to website…); image-size resampling, anchored
  canvas resizing, crop selection, flip, invert and clear. Transparent pixels
  show as a checkerboard behind the layer stack. Documents retain a
  reorderable layer stack with visibility, rename, duplicate, delete and merge
  controls; File → Open as Layer… (and its website equivalent) drops a picture
  onto a new layer, centred and scaled to fit, without disturbing the document
  size. File → Open → As Raw Data… opens a file that is not a picture at all —
  a framebuffer dump, a sensor capture, anything — by guessing its width and
  letting you scrub the offset until it lines up. Rectangular, freehand-lasso and edge-snapping magnetic-lasso
  selections crawl with animated marching ants, and can be copied or cut
  directly to a new layer from the canvas right-click menu. **Select Object**
  joins them: click the thing you want and SlimSAM — Meta's Segment Anything,
  pruned, run in a worker through the vendored Transformers.js — works out where
  it ends. Where the magic wand asks what else is this colour, this asks what
  this thing is, so a cat in front of a sofa comes out as one object across a
  dozen colours. The model looks at the picture once and answers each click
  against that one look, so shift-clicking to add a point and Alt-clicking to
  mark where the object stops both come back in a fraction of a second; the
  options bar chooses between the whole object, a part of it and a detail, or
  takes whichever the model is surest of. It is fetched once (≈40 MB) and cached. A selection confines
  every filter and effect — adjustments, every entry in the Effects menu,
  dithering, background removal, invert, flip and clear all stop at its exact
  outline, not just its bounding box — and each one applies to the active layer
  alone. The Effects menu groups its filters the way Photoshop, GIMP and
  Photopea do: **Blur** (Gaussian, Box, Motion, Radial — spin or zoom),
  **Sharpen** (Sharpen, Unsharp Mask, High Pass), **Stylize** (Emboss, Find
  Edges, Maximum, Minimum, and a Custom Matrix taking a 3 × 3 or 5 × 5
  convolution kernel with divisor and offset), **Pixelate** (Mosaic, Colour
  Halftone with rotated CMYK screens, Crystallize, and JPEG Artifacts, which
  runs the picture through the real JPEG pipeline — colour split off at a
  coarser resolution, blocks rounded down to a quantisation table — so the
  blocking, the ringing round hard edges and the smeared colour all come out on
  their own, with the block size, the colour detail, the ringing and the number
  of times it is saved again all under your hand), **Distort** (Twirl, Pinch /
  Spherize, Polar Coordinates, Wave, Ripple) and **Render** (tileable fractal
  Clouds between the current colours, Lens Flare). One dialog serves them all:
  it builds whatever controls the chosen filter asks for, previews the result
  live on the layer, and rolls the pixels back if you cancel — and on a picture
  large enough for the preview to stutter it waits for the slider to be let go
  instead. Filters that can sample beyond an edge wrap around by default, so a
  seamless tile stays seamless, and Effects → Repeat runs the last filter again
  with the settings it was given.
  Edit → Free Transform (Ctrl/⌘-T) lifts the selection, or the whole active
  layer when nothing is selected, onto a floating frame: drag inside it to move,
  drag a handle to scale (Shift on a corner keeps the aspect ratio, dragging
  past the opposite edge flips), drag the knob above it to rotate (Shift snaps
  to 15°), then Apply or press Enter; Esc puts the pixels back untouched.
  Edit → Select All and Deselect (Ctrl/⌘-A and Ctrl/⌘-D) round out the menu. Image → Form-Detecting Scale opens a Photoshop-style
  transform box: drag any edge or corner handle, hold Shift on a corner to
  preserve the aspect ratio, then Apply (or press Enter). While a handle moves,
  a debounced low-resolution seam-carved proxy updates live; superseded worker
  jobs are cancelled so dragging stays responsive. The exact-size dialog remains
  available alongside it. The final full-resolution worker pass shrinks or
  enlarges every layer along shared low-detail paths, optionally protecting the
  current selection. Image → Image Size… offers five Swin2SR super-resolution
  models in the same box as its resampling filters, for an enlargement that
  invents the edge rather than spreading the one it has (see "Resampling").
  Every setting the armed tool has lives in one options bar
  under the menus, the way a photo editor arranges it: the tool's name, its size
  where size means anything, its own controls (the brush's Softness, a healing
  brush's Hardness, liquify's warp mode) and a line of help, with the canvas
  zoom parked on the right beside 1:1 and Fit buttons. The zoom tool
  supports 12.5%–800% views, and brush-based tools show their live footprint
  over the canvas. The View menu holds Zoom In/Out, Actual Size, Fit to Screen,
  Fit to Width and a grid toggle; the same three zoom levels are on the canvas
  right-click menu while the zoom tool is armed. The grid draws over the picture
  without touching the pixels, doubling its cell size as the view zooms out so
  the lines never crowd, with every eighth line drawn stronger. A non-destructive
  50% X/Y offset (Image → Check Seams) animates into a wrapped, fully
  editable seam-checking view. Effects → Mirror Paint mirrors new paint strokes
  across either axis or both. The three effects that can call on a neural network
  share an **Effects → AI** submenu, and each runs in a Web Worker so a download
  or a long inference never freezes the painting. **Remove Background** offers
  twelve ways of cutting the subject out, all behind one set of sliders. Seven
  are classic algorithms that download nothing and answer at once: a **chroma
  key** working in Cb/Cr, so the shadow falling on the screen goes with the
  screen; a **colour range** that opens on the picture's own corner colour; a
  **flood in from the frame edges**, which spares a patch of sky-blue shirt
  because the shirt is not joined to the sky; a **brightness threshold** for
  scans and line art; **difference matting** against a second layer holding the
  empty plate; **GrowCut** (Vezhnevets & Konouchine, 2005), a cellular automaton
  grown out of a rough selection; and **frequency-tuned saliency** (Achanta et
  al., 2009). Five are neural models run through the vendored Transformers.js,
  each fetched from the Hugging Face Hub once and then cached by the browser:
  **MODNet** (Apache-2.0, ≈13 MB, quick), **Open RMBG** (Apache-2.0), **BiRefNet
  lite** and the full **BiRefNet** (MIT), and **BEN2** (MIT), which cuts the
  cleanest edge of the five. Each takes the half-precision build where the
  browser offers WebGPU and falls back to a precision that actually runs on the
  CPU otherwise — on that path a heavy model takes a minute or two rather than
  seconds. Whichever method runs, the picture never leaves the browser, and what
  the worker sends back is the matte, not a finished cut-out: one coverage byte
  per pixel, with hair, fur and glass left in the middle ground. Every judgement about that matte is
  then made in the dialog, against a live preview over a checkerboard that can
  also be flipped to the matte itself or the picture before. **Cutoff** says
  where along the fuzz the subject begins and **edge softness** how wide that
  crossing is, **grow / shrink** pulls the edge in or pushes it out by up to
  eight pixels, **feather** blurs it, and two tidying switches throw away the
  specks found off in the background and close the holes left inside the
  subject. A last switch swaps subject for background. The **Output** box then
  decides what the cut-out is for: erasing the background in place, cutting or
  copying the subject to a layer of its own, filling the background with the
  second colour, putting the matte on a layer as a black-and-white mask, or
  making the subject the selection and touching no pixels at all. Since the
  shaping is arithmetic rather than inference, nothing needs the network twice
  — the settings move under the slider, and reopening the dialog on the same
  layer reuses the matte it already has. **DeepDream** is
  Google's 2015 original: gradient ascent on one layer of `inception5h`, the
  ImageNet GoogLeNet it was first done with, which is why what grows out of the
  picture is dogs, birds and eyes. Six layers are offered from fur and weave up
  to whole animal faces, either as a whole layer or one feature of it, with the
  strength, the steps per octave, the number of octaves and Laplacian smoothing
  under your hand. It is the one filter that cannot preview live — a dream takes
  seconds on a GPU and minutes without one — so the worker sends the picture
  back after every octave, and cancelling (or Escape) puts the original back
  untouched. Nothing is uploaded: TensorFlow.js and the ≈12 MB network are both
  served from this site. **Text to Image** draws a picture from a description,
  using DeepSeek's **Janus-Pro-1B** through the vendored Transformers.js.
  Janus is the only text-to-image model that fits here, because it is the only
  one that does not diffuse: it emits 576 image tokens autoregressively, exactly
  as a language model emits words, and decodes them in one pass at the end, so
  it runs through the same generate loop as every other causal model and needs
  no scheduler, no VAE and no second inference runtime. What that costs is the
  download — about 2 GB of weights even at four bits, fetched from the Hugging
  Face Hub once and cached by the browser afterwards — and WebGPU, which is
  required rather than preferred: 576 forward passes on the WASM backend is not
  a slow version of this feature but a ten-minute wait ending in the same
  picture, so the dialog says the figure and the requirement before the button
  is pressed and refuses cleanly where there is no adapter. The model always
  draws 384 × 384 and has no say in where it goes. **With something selected the
  picture lands in the selection's bounds and is then confined to its actual
  shape, so a lasso, a magic wand or a Select Object mask crops it as exactly as
  a rectangle does; with nothing selected it fills the frame.** How it meets that
  area is a decision taken with the result on screen — **Cover** fills it and
  crops the overhang, **Contain** fits inside and leaves the margins as they
  were, **Stretch** squashes it to the area's shape — and the note under the
  chooser gives the actual figure, the percentage cropped or the margin in
  pixels. **Pictures** asks for one, two or four; they are drawn one after
  another rather than as a batch, because four sequences of key/value cache for
  a 1.5B model at once can take an adapter past what it will allocate, and
  because the first picture arriving after a minute beats all four arriving
  after four. Each appears as it lands, in a row of thumbnails to choose
  between, with the count carrying on underneath for the ones still coming, and
  a run cancelled or failed part way keeps whatever already arrived. The worker
  is loaded through a URL carrying a protocol version, and the dialog stops on
  any message it does not recognise rather than ignoring it: the browser caches
  the worker script separately from the page that starts it, so an upgrade can
  otherwise leave a new dialog waiting for ever on an old worker's answer. **Seed** makes a picture repeatable — the runtime's sampler draws
  through its own Mersenne Twister rather than `Math.random`, and exports it
  with its `seed()`, so the same words, seed and settings give the same picture
  again; asking for several numbers the seeds upwards from the one given, and
  each picture reports its own so it can be asked for on its own later.
  **Variety** is the sampler's temperature, defaulting to the 0.7 the model
  ships with, and **Choices** is `top_k`, how many of the likeliest tokens are
  in the running at each step out of a picture vocabulary of 16,384 — the
  runtime's default of 50 is a narrow field. Those four, with the prompt, are
  the whole of what this model exposes. `top_p` is not offered because the
  runtime defines the warper and never constructs it, so a control for it would
  do nothing; a negative prompt is not offered because it needs guidance; and
  the output size is the model's own 384 × 384 rather than a setting. There is
  deliberately no guidance control either: classifier-free
  guidance is what Janus is tuned for, but the vendored runtime's implementation
  of it for this model is broken — the image masks are not batched up alongside
  the doubled `input_ids`, the unconditional half is handed an all-zero
  attention mask, and its tokens are all pad where reference Janus keeps the
  opening BOS and the trailing image_start tag — so the guided logits come back
  degenerate and the sampler locks onto one token, producing vertical stripes
  rather than a picture. Hugging Face's own example passes no `guidance_scale`
  either. See the comment in `paint-text2image-worker.js` before adding one.
  Unlike every other effect this one
  never paints straight onto the layer: the picture is previewed at the target's
  aspect over a checkerboard, and nothing is touched until Apply. Since the model
  samples, the same words give a different picture every time unless the seed is
  held — so the pictures on screen cannot be got back by generating again.
  Closing the dialog keeps them, and reopening finds them still there ready to
  place, which is what Repeat Last Effect does here rather than spending another
  minute on a different picture. The prompt and the pictures never leave the
  machine.
  **File → Export → As Program Array…** turns the
  picture into something a microcontroller can draw, and **File → Import → From
  Program Array…** reads one back (both described below). File → Set as
  background tile stores a PNG tile in the browser and applies it to the
  desktop. Multi-instance.

#### Exporting a picture as a program array

`File → Export → As Program Array…` writes the canvas out as source code: a C
array for the Arduino toolchain, a MicroPython `bytearray`, the bare numbers,
or a `.bin` of the bytes themselves. The dialog is two panels — the settings,
and what they produce — and the preview on the right is the **encoded bytes
decoded back into a picture**, not the picture that went in, so a bit order or
an endianness that does not match the display shows up here rather than on the
bench.

It opens at the picture's own size, with the pixel format guessed from the
picture: two-tone artwork arrives as a 1-bit array, a photograph as RGB565.
Everything after that is a choice:

- **Output size.** Native by default, a custom width and height, or a **display
  preset** — SSD1306 and SH1106 OLEDs, ST7735, ST7789 and ILI9341 TFTs, a 2.9"
  e-paper panel, 8 × 8 and 16 × 16 WS2812 matrices, the Sense HAT — which sets
  the size, the pixel format, the bit order and the scan its controller reads,
  all in one go. Where the shapes do not match, the picture can be **fitted
  inside with bars** down the sides, **filled to the screen and clipped**,
  **stretched**, **centred at actual size** or **tiled**; the bars take the
  background colour set beside them. Rotation by quarter turns and flips are
  there too, because a panel is usually mounted the wrong way round.
- **Pixel format.** 1/2/4/8-bit greyscale; indexed colour with a palette built
  by median cut from the picture itself (or the ClackPaint box, the web-safe
  216, an even grey ramp, or the two current colours) and 1/2/4/8-bit indices;
  packed RGB332, RGB565, BGR565, RGB666, RGB888, BGR888, RGBA8888 or ARGB8888;
  or YUV 4:2:2 as YUYV or UYVY, BT.601 or BT.709, full or studio range. Bytes
  run along rows, down columns, or in the vertical pages of 8 an SSD1306
  addresses, either bit order, with lines optionally padded to a whole byte —
  and a **serpentine** option that reverses every other line, the way an LED
  matrix is actually wired. A 1-bit transparency mask can come out alongside,
  for the sprite calls that take an image and a mask.
- **Dithering.** The whole of the Effects → Dithering menu is available here,
  driven headlessly: error diffusion, ordered and halftone screens, noise,
  pattern, dot diffusion, Riemersma and thresholding, with their own controls.
  What it dithers *to* is decided by the pixel format rather than chosen
  separately, so RGB565 is dithered against the 32/64/32 levels it can really
  store rather than against a palette it cannot.
- **Output.** Arduino/C with optional `PROGMEM`, MicroPython, or raw numbers;
  hex or decimal; the array's name and how many numbers to a line. Naming the
  **library** fills in the fiddly half — Adafruit_GFX `drawBitmap` and
  `drawRGBBitmap`, U8g2's XBM, TFT_eSPI `pushImage`, LVGL, FastLED,
  MicroPython's `framebuf` (with the right `MONO_HLSB`/`MONO_VLSB`/`GS4_HMSB`
  constant worked out for the settings) and CircuitPython's `displayio` — and
  writes the matching usage line into the comment.

A **memory budget** panel puts the size in proportion: what the array costs as
a percentage of the flash on an ATtiny85, an Uno, a Mega, a Blue Pill, an
ESP8266 or ESP32, a Pico, a micro:bit v2 and a Teensy 4.0, and whether it would
also fit in that part's RAM. Settings are remembered between sessions.

`File → Import → From Program Array…` runs the same decoders the other way.
Paste a C array or a Python `bytes` literal — or read a `.h`, `.py`, `.txt` or
`.bin` file — and it comes back as a picture, opened as a new document or
dropped onto a layer. Width, height and format are read out of the text where
they are written down (`#define`s, a `framebuf` constant, a `drawXBMP` call, an
`RGB565` mention); where they are not, it offers the sizes that would use
exactly that many bytes, likeliest first. An indexed array takes its palette
from a second box.

The pixel work lives in `content/applications/paint-export.js`, which is pure —
ImageData and options in, bytes and text out — so the same routines serve the
live preview, the Copy button and the importer's decoder.

#### Opening a file as raw data

`File → Open → As Raw Data…` opens *any* file as a picture — a framebuffer
dumped off a device, a sensor capture, a font, a recording, a program — by
being told nothing about it and working the rest out. The picker has no accept
list at all; a file that is not a picture opens just the same. Everything
GIMP's raw loader offers is here: a byte offset, width and height, and its list
of image types — 1 to 8-bit greyscale, 16-bit greyscale, indexed, packed RGB
and RGBA in eight packings, planar RGB, YUV 4:2:2 — with a palette read from a
`.pal`, `.gpl`, `.act` or raw triples file, in either channel order.

What it adds is the part that makes the hunt bearable. The preview redraws
while the offset slider is dragged, so a picture can be *scrubbed* into
alignment rather than arrived at by arithmetic; ±1 byte and ±1 pixel nudges sit
beside it, along with page buttons that step a whole screenful of bytes through
a long file. **Guess size** takes the width from the data itself — lines of a
picture resemble the line above them and nothing else does, so the byte spacing
that minimises that difference is a line, with the pattern-repeat traps that
catches ruled out by comparing against how badly an unrelated spacing scores.
The file's first bytes are shown in hex and ASCII from the current offset, so
the header being skipped is visible rather than counted. A file that turns out
to be an ordinary PNG or JPEG says so and offers to open properly instead;
BMP and uncompressed Targa fill the whole dialog in from their headers,
padding and bottom-up rows included; a file whose length can only be an SRTM
elevation tile is read as signed big-endian 16-bit and shaded with a terrain
ramp. Row stride is separate from width, for framebuffers padded to a 4-byte
boundary, and there are flips for the formats that count from the bottom.
Settings are remembered between sessions; the result opens as a new document or
as a layer.

The dialog lives in `paint-raw.js`; the decoding is `paint-export.js`'s, run
backwards, so anything ClackPaint wrote as a `.bin` reopens here byte for byte.
Only the shapes the exporter has no use for — planar RGB and 16-bit samples —
are implemented in the raw module itself.

#### Resampling

`Image → Image Size…` chooses how the picture is resampled: **nearest
neighbour** for pixel art, **box**, **bilinear**, **Mitchell**, **bicubic
(Catmull–Rom)** or **Lanczos 3**, which is the default. The filter widens as
the picture shrinks, so every source pixel lands in some destination pixel
rather than being sampled past — the difference between a legible 128-pixel
version of a photograph and an aliased one. Resampling runs on premultiplied
alpha, so a transparent edge cannot bleed its colour, and optionally in linear
light. The resampler lives in `paint-retouch.js` and is shared with the
exporter's output-size box.

The same box also offers five **Swin2SR** super-resolution models, run through
the vendored Transformers.js in `paint-upscale-worker.js` and fetched from the
Hugging Face Hub on first use: a **×2 lightweight** (7 MB, about four times the
speed of the others and within a fifth of a decibel of the full ×2), a general
**×2** and **×4**, a **×4 trained on real-world degradation** for photographs
that have already been through a resize and a sharpen, and a **×4 trained on
compressed input**, which is the only one that mends JPEG blocking rather than
sharpening it — on a picture saved at quality 20 it measured 19.1 dB against
the general ×4's 17.1, and on a clean picture it is the worst of the five.
Swin2SR is the one super-resolution architecture Transformers.js can build,
which is what settles the list. Choosing a model fills the width and height in
with its own multiple; any other size is reached by resampling its output with
the filter chosen last, and a model picked for a picture that is not getting
bigger — or one whose output would be past the sixteen megapixels the worker
can assemble — is quietly not run at all, with the note saying so. Each model
is fetched as its 8-bit build on the processor path, which measured 28.11 dB
against full precision's 28.32 for a third of the download, and as the full
build on WebGPU, where 8-bit weights would mean dynamic quantisation nodes
dropping back to the processor mid-graph; the half-precision builds cannot open
a session on the WASM backend at all. The picture goes through in 192-pixel
tiles overlapping by 32 — attention is quadratic in the window count and the
WASM heap is 32-bit — blended back together with a raised cosine across the
overlap, which measured 48 dB against the same picture done in one pass, with
no error at the tile boundaries. Every layer goes through separately at its own
size, and a layer with transparency is handed to the model over black and
divided back out of the enlarged alpha afterwards, so a soft edge cannot be
sharpened into whatever colour happened to be stored under it. Nothing is
uploaded; closing the dialog abandons the run but leaves the weights loaded for
the next attempt.

The committed PNG tiles are generated by `scripts/build_background_tiles.py`
(Pillow is required only when regenerating them). The runtime never loads SVG
wallpapers.

`vendor/inception5h/` is likewise generated, by
`scripts/build_inception5h_weights.py` (numpy only): it fetches Google's frozen
53.9 MB DeepDream graph, walks its dependency tree back from `mixed5b` to drop
the three classification heads that gradient ascent never runs, and rewrites
what is left as a JSON description plus one fp16 blob — 196 ops, 6.0 M
parameters, 12.1 MB. The trimmed graph uses six op types, all of which have a
registered *gradient* in TensorFlow.js; that matters because graph models there
are inference-only, so the trunk is rebuilt op by op from the JSON rather than
loaded with `tf.loadGraphModel`.

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
control panel), the Text Editor (its document, name and caret) and the Gamma
Table (its settings and every curve handle, which are not form controls); apps
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
the root `sitemap.xml`, `robots.txt`, `feed.xml` and `404.html`; see
[Search engines](#search-engines)).
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
- `sitemap.xml`, `robots.txt`, `feed.xml` and `404.html` at the repo root — all
  four only work from the origin root, so they sit beside `index.html` rather
  than inside `plain/`;
- `BlogPosting` JSON-LD on posts (with `datePublished` from the filename) and,
  on the home page, a `WebSite` + `Organization` pair. Only the second carries
  `sameAs`, which is what ties this domain to the same people elsewhere; the
  profile list is `"sameAs"` in `content/site.json`, so adding one is a config
  change rather than a code change.

### Titles that have two jobs

A window title and a search result want different things: the first has a title
bar's worth of room inside a site the reader has already reached, the second has
to say what the page is to somebody who has never been here. Where one string
can't do both, `seoTitle:` in the frontmatter sets the `<title>` and `og:title`
while `title:` goes on carrying the ClackOS window — which is why the home page
window still says `clacktronics.co.uk` and its search result doesn't.

### Sitemap dates

`<lastmod>` is the date a page's markdown was last committed, read from `git log`
in one pass. A blog post's filename date is when it was *written* — that stays in
the visible date and in `datePublished` — but a post edited years later has
genuinely changed, which is what `lastmod` is asking about; the filename is the
fallback for a file git hasn't seen yet.

This needs real history, so both workflows that run the generator check out with
`fetch-depth: 0`. On a shallow clone every file reports the same commit date, so
the generator prints a note and writes **no** `lastmod` at all rather than
telling crawlers the whole site changed today.

### The blog feed

`feed.xml` is RSS 2.0 of the posts, newest first, built from the same titles,
descriptions and dates as the mirror pages — listings (`blog.html`,
`blog-page-N.html`) and `noindex` pages stay out. Every mirror page and the
desktop shell advertise it with `<link rel="alternate">`, so a reader or crawler
finds it wherever it lands.

### Applications

The apps under `content/applications/` are hand-written HTML, not generated, and
each one is a real URL that the plain mirror links to — so each carries its own
description, canonical and Open Graph tags. The distinctive tools (the Eurorack
panel generator, the PCB heater designer, the simulators) are indexed; the
desktop's own furniture — theme editor, file manager, games, text editor — is
`noindex,follow`.

The generator reads that decision back out of the files: a shell with a
canonical link and no `noindex` goes into the sitemap, everything else doesn't.
So an app changes its own indexing by editing its own `<head>`, and there is no
second list to keep in step. Their canonical links are hardcoded to the live
origin (unlike the mirror's, which follow `SITE_URL`) — if the domain ever
changes, they need a find-and-replace.

What those tags could not say is *what kind of thing the page is*. Most apps
render nothing at all until JavaScript has run — `circuit.html` is a bare
`<iframe>`, so a crawler that doesn't get as far as executing the page finds an
empty body and a sentence of description. `scripts/build_app_metadata.py` gives
each indexed app a `WebApplication` block in `<head>` saying it is a free,
browser-based tool of a particular category, which stands on its own without
anything being rendered:

```sh
python3 scripts/build_app_metadata.py          # rewrite the blocks
python3 scripts/build_app_metadata.py --check  # verify without writing
```

Every field is derived from something the repo already states — the name and
the `applicationCategory` from the app's entry in
`content/applications/menu.json` (the submenu it sits in picks the category,
so moving an app between submenus moves its category with it), the description
and URL from the page's own `<meta>` tags. **So the way to change what a
crawler is told about an app is to edit that app's
`<meta name="description">` and re-run the script** — the block is generated
between markers and hand edits to it are overwritten. Apps carrying `noindex`
get no block at all; the script applies the same two tests as the sitemap
builder, so the two can't disagree about an app. The `publisher` node shares
the `#organization` `@id` the mirror's home page uses, which is what ties the
apps and the site together as one publisher rather than two organisations with
the same name.

Both the mirror workflow and the deploy workflow run the script, for the same
reason they rebuild the blog index — a bot push doesn't re-trigger them, so the
tree they check out can still hold the previous block.

### The 404 page

Two websites came before this one and their URLs are still linked from other
people's pages, so `404.html` is generated with the site's styling and points at
the blog, the projects and the archive of the old sites. `.htaccess` wires it up
with `ErrorDocument 404 /404.html` — a server-root path, so it tracks `SUBDIR`
in the deploy workflow. It is `noindex`: a soft 404 in the index is worse than
no page at all.

### Which URL is the home page

The desktop boots `content/file/home.md` into a window, so the site root and
`plain/index.html` render the same page and only one of them should be indexed.
It is the root: it is what people link to, it reads properly in a search result,
and it is the desktop the site is actually for. `index.html` therefore carries
`<link rel="canonical" href="./">`, and `build_plain_site.py` points the
mirror's home page back at the root rather than at itself.

`./` rather than a self-referencing absolute URL because it resolves to the site
root from `/index.html` and from `/index.html?desktop=1` — the link back from
every mirror page's footer — as well as from `/`, folding all three addresses
into one; and because staying relative keeps it right under `SUBDIR`. The
shell's `<title>` and description are home.md's `seoTitle:` and `description:`,
the same pair the mirror's copy carries, so the two agree in a search result;
they are hand-written in `index.html` and need keeping in step if that
frontmatter changes.

This is the one place a mirror page's canonical link is not its own address, so
`build_plain_site.py` keeps the two ideas apart: `page_url()` is where a page is
served from and stays the base for resolving its relative links (og:image would
break otherwise), while `canonical_url()` is the address crawlers are given and
special-cases the home page. The sitemap lists the root and not
`plain/index.html`. Every other mirror page is the only URL its content has and
keeps its own self-canonical — the desktop's deep links are fragments, which
never become separate URLs.

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
deletes on the host, and excludes VCS/CI files, `scripts/`, the notes
(`README.md`, `todo.md`, `CLAUDE.md`), `.gitignore`, and the upload folders. It
publishes to the web root; set `SUBDIR` in the workflow to a folder name to
stage a build in a subfolder instead.

Those excludes are the only thing keeping the repository's own furniture off the
web, because the host serves the deploy directory straight out: whatever is
rsynced up has a public URL. The notes are documentation nobody browsing the
site should be handed. `.gitignore` is the one that reads harmlessly and is not
— it names `assets/upload-config.php` as the upload secret and lists the
host-only media directories, so it hands anyone who asks a map of the parts of
the server that are not in Git.

**Adding a file to the excludes does not take an already-uploaded copy down.**
The deploy runs without `--delete`, so a file that shipped before it was
excluded stays on the host until it is removed there. `CLAUDE.md` and
`.gitignore` were both live before they were added to the list; clearing them is
a one-off on the host:

```sh
rm public_html/CLAUDE.md public_html/.gitignore
```

Apache refuses `.htaccess` itself (its built-in `^\.ht` rule, not anything in
this repo), and `upload.php` answers a bare `GET` with `405`, so neither needs
an exclude.

A `paths-ignore` on the trigger skips the run entirely for commits that touch
only `todo.md`, `README.md`, `CLAUDE.md`, `.gitignore` or `.github/` — all of
them excluded from the rsync, so the deploy could not have changed what the host
serves anyway. `scripts/` is
excluded from the upload but *not* from the trigger, because the generators run
during the deploy: a fix to `build_plain_site.py` changes the mirror that gets
shipped even though the script itself never leaves the repository. Editing the
deploy workflow no longer deploys as a side effect either — use **Actions →
Deploy to purely.website → Run workflow** to try a change out.

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
