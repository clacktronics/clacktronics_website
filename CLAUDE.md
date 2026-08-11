# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

`clacktronics.co.uk` — a retro desktop-style website ("ClackOS"). A window
manager written in vanilla JavaScript renders markdown content into draggable
windows, and a growing collection of standalone browser apps (paint program,
circuit simulator, MIDI sequencer, modem, PCB tools…) run inside those windows.

**There is no build step and no package manager.** No `package.json`, no
`node_modules`, no bundler, no test suite, no linter config. The browser fetches
`content/site.json`, each menu folder's `menu.json` and the markdown files at
runtime. Edit a file, refresh the page, done.

The Python scripts in `scripts/` are *generators* for derived files (the plain
HTML mirror, the blog index, the sitemap), not a build pipeline the site needs
in order to run.

**`README.md` is the real documentation** — ~1700 lines covering every feature
in depth. This file is the orientation map; when you need detail on a specific
subsystem, go read the matching README section rather than guessing from code.

## Running it locally

`fetch()` does not work over `file://`, so the site must be served:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Individual apps also work opened directly as their own page
(`http://localhost:8000/content/applications/paint.html`) — that is a design
requirement, not a coincidence. See "App conventions" below.

## Layout

```
index.html                    page shell — menu bar, desktop, taskbar
404.html  robots.txt  sitemap.xml  feed.xml    GENERATED (see below)
.htaccess                     Apache config for the live host (HTTPS, gzip, 404, /temp/ redirects)

assets/
  css/clackos.css             desktop chrome and window styling
  css/content.css             everything rendered from markdown
  css/app.css                 shared look for application pages
  css/{code,icons,file-manager,*-skin}.css
  themes/*.css                colour palettes — one file per theme, variables only
  backgrounds/                bitmap desktop wallpaper tiles
  icons/pixelarticons/        icon set (MIT)
  js/clackos.js               window manager + menu builder (~97 KB, the core)
  js/markdown.js              the markdown renderer (desktop + editor preview)
  js/app-bar.js               builds an app's menu bar
  js/app-home.js              "ClackOS" link back to the desktop from a standalone app
  js/app-menu.js              menu behaviour inside app pages
  js/app-state.js             opt-in state persistence for apps
  js/highlight.js             syntax highlighter for fenced code blocks
  js/model-scene.js           three.js viewer core (3D Model Viewer + inline @[model])
  js/{events,file-manager,image-zoom,backgrounds,midi-bytes,model-embed,model-squish}.js
  upload.php                  media upload endpoint (runs on the web host)
  upload-config.example.php   template — the real config is host-only, never committed

content/
  site.json                   menus, boot windows, theme list, wallpapers, siteUrl, Luma config
  file-associations.json      which app opens which file kind in File Manager
  link-whitelist.json         hosts allowed to load inside the in-desktop browser
  media-index.json            GENERATED catalogue of legacy host media
  file/                       FILE menu — menu.json + one .md per window
    blog/                     posts: YYYY-MM-DD-slug.md
    blog.md, blog-page-N.md, blog-list.md    GENERATED from blog/
    misc/, euroclack/, archive/              sub-pages
  view/  desktop/             menus containing actions only
  applications/               APPLICATIONS menu — menu.json + one .html per app
    video/  clackmosh/  pdf-reader/  qbasic/  kicad/  circuits/  models/  openscad/  calendar/

plain/                        GENERATED no-desktop HTML mirror — never hand-edit
scripts/                      Python/Node generators (excluded from deploy)
vendor/                       third-party bundles (circuitjs1, pyodide, mupdf, kicanvas, …)
todo.md                       Ben's running wishlist
```

## Generated files — never edit by hand

Editing any of these gets overwritten by the next script run or CI job:

| Path | Generator |
| --- | --- |
| `plain/**`, `sitemap.xml`, `robots.txt`, `feed.xml`, `404.html` | `scripts/build_plain_site.py` |
| `content/file/blog.md`, `blog-page-N.md`, `blog-list.md` | `scripts/build_blog_index.py` |
| `content/media-index.json` | `scripts/build_media_index.py` |
| `content/applications/calendar/luma.json` | `scripts/fetch_luma_events.py` (CI, manual dispatch) |
| `content/applications/qbasic/programs/programs.json` | `scripts/build_qbasic_programs.py` |
| `assets/backgrounds/*.png` | `scripts/build_background_tiles.py` |
| `vendor/kicanvas/kicanvas-clackos.js` | `scripts/build_kicanvas_theme.py` |
| `vendor/graphite/branding/` | `scripts/build_graphite_branding.mjs` |
| `version.json`, `*.wasm.gz` | deploy workflow (gitignored) |

**After editing anything under `content/`, regenerate the mirror:**

```sh
python3 scripts/build_plain_site.py
```

**After adding or editing a blog post, also regenerate the blog windows:**

```sh
python3 scripts/build_blog_index.py
python3 scripts/build_plain_site.py
```

CI does both on push (see "CI workflows"), but committing the regenerated files
yourself keeps the diff honest and matches how the repo's history reads — most
feature commits are followed by a `Rebuild plain HTML mirror` commit.

Note `build_plain_site.py` reads `git log` for sitemap `<lastmod>` dates. On a
shallow clone it detects this and omits dates entirely rather than emit wrong
ones — so run it in a full checkout.

## Adding content

### A new markdown window

1. Drop a `.md` file into the folder of the menu it belongs to, e.g.
   `content/file/projects.md`.
2. Register it in that folder's `menu.json`:
   `{ "type": "window", "md": "projects.md", "label": "Projects", "icon": "file-text" }`

Frontmatter drives the window:

```markdown
---
title: Projects            # titlebar / taskbar text
style: plain               # "plain" or "page" (rich landing-page look)
tagline: Optional line     # rendered under the h1 with a rule
description: One sentence  # search-result snippet for the plain mirror
seoTitle: …                # optional; separate <title> when the window title is too terse
robots: noindex            # optional; keep out of search results and the sitemap
up: file/euroclack.md      # optional; overrides the auto "↑ parent" link ("none" to drop it)
width: 480                 # optional; px or % (default 80% of the desktop)
height: 60%
---
```

Write a `description:` for any page whose opening paragraph would read badly as
a search snippet.

### A blog post

`content/file/blog/YYYY-MM-DD-slug.md`, same frontmatter (`tagline:` carries the
displayed date). The filename date is the publication date and matters — it
drives ordering, `datePublished` and Wayback snapshot selection. Then regenerate
as above.

Legacy post images point at `assets/old_assets/` (site-root-relative). That
directory is host-only and gitignored. New media goes to `assets/uploads/` via
the upload endpoint — also host-only. **Do not commit binaries into either.**

### Markdown the renderer understands

Standard markdown plus custom directives — `@[youtube]`, `@[video]`,
`@[kicanvas]`, `@[model]` (each with `{option}` strings), `window:` /
`app:` / `action:` link schemes, a button row from a links-only paragraph, a
footer from the paragraph after a trailing `---`. Full reference:
README § "Markdown that the renderer understands". Both `assets/js/markdown.js`
and `scripts/build_plain_site.py` implement this vocabulary — **a change to one
usually needs the matching change to the other**, or the mirror and the desktop
disagree.

## Menus (`menu.json`)

Item types: `window`, `app`, `action`, `submenu`, `sep`, `wallpapers`.

```json
{ "type": "app", "page": "paint.html", "label": "ClackPaint", "title": "ClackPaint",
  "icon": "brush", "width": 900, "height": 680, "multi": true, "integrated": true }
```

Key flags:

- `multi: true` — a fresh instance each time it is picked.
- `integrated: true` — trusted system utility, mounted into an isolated shadow
  root in the desktop document instead of an iframe. Everything else is an iframe.
- `plain: false` — keep out of the plain mirror's Applications menu, for apps
  that only mean something with a desktop around them (Appearance, Theme Editor,
  Web Browser, File Manager).
- `allow: "serial; usb"` — iframe permission policy; only name what the app needs.
- `fixed: true` — no resize handles.

Built-in actions: `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`,
`reset`, `copy-desktop-link`, `forget-desktop`, `edit-front`, `report-bug`.

Only pages registered as `"type": "app"` can be launched by an `app:` link, so
markdown cannot turn the desktop into an arbitrary iframe launcher. Keep it
that way.

## App conventions

Every app under `content/applications/` is a **complete standalone page** that
works when opened directly, and the same page is what ClackOS shows in a window.
Preserve both modes when editing.

A new app should:

- link `../../assets/css/app.css` for the shared look, and use the theme CSS
  variables (`--ink`, `--paper`, `--paper-deep`, `--leaf`, `--menu-text`, …)
  rather than hardcoded colours, so themes apply;
- load `assets/js/app-home.js` (adds the "ClackOS" link back to the desktop,
  only when the app *is* the page) and `assets/js/app-bar.js` if it builds a bar;
- carry its own crawler metadata in `<head>` — `description`, `canonical`,
  Open Graph. The mirror generator reads indexing decisions back out of the
  file: a canonical link and no `noindex` puts it in the sitemap. Desktop
  furniture (editors, games, file manager) is `noindex,follow`; distinctive
  tools are indexed. There is no second list to keep in step;
- be registered in `content/applications/menu.json`.

Desktop integration hooks:

- `clackos-resize` — a bubbling, composed `CustomEvent` with
  `detail: { width, height }` asks the desktop to wrap the window around the
  app's natural size (Clacksweeper, ClackPaint).
- `{ type: 'clackos-close-window' }` posted to the desktop closes the app's own
  window and nothing else (QBasic's File → Exit).
- `ClackOSAppState.connect({ controls: true })` opts an app into session
  persistence — saved with the desktop, restored on reopen or from a shared
  desktop link. No-op when the page is opened on its own.
- Integrated apps run in the host document with `window.ClackOSMountRoot` set to
  their shadow root; iframe apps talk to `window.parent`. Code that touches the
  DOM root must handle both — see the top of `assets/js/app-state.js` for the
  idiom.

## Themes

One CSS file per palette in `assets/themes/`, setting only the shared ClackOS
colour variables so one palette covers the desktop, markdown windows and
same-origin app windows. Register new themes in `content/site.json`
(`"theme"` = active, `"themes"` = the list offered in the editors). Filenames
are restricted to `[A-Za-z0-9._-]+\.css` — the Theme Editor can commit themes
via GitHub and that restriction is what keeps it writing only into that folder.

## CI workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `blog-index.yml` | push touching `content/file/blog/**` | rebuilds the blog windows, commits them |
| `plain-mirror.yml` | push touching `content/**` or the generator | rebuilds `plain/` + sitemap/robots/feed/404, commits them |
| `deploy-purely.yml` | push to `main` (except `todo.md`/`README.md`/`.github/**`), or manual | stamps `version.json`, rebuilds blog + mirror, gzips `.wasm`, rsyncs over SSH to the host |
| `luma-events.yml` | manual | mirrors the Luma events into `calendar/luma.json`, then triggers the deploy |
| `dead-links.yml` | 1st of the month, or manual | checks outbound links, repoints dead ones at Wayback snapshots, **opens a PR** (never pushes to `main`) |

Two things about this arrangement are worth knowing before you change any of it:

- Bot pushes made with the automatic `GITHUB_TOKEN` deliberately do **not**
  re-trigger other workflows. That is why `deploy-purely.yml` regenerates the
  blog index and the mirror itself rather than trusting the checked-out tree,
  and why `luma-events.yml` dispatches the deploy explicitly.
- `plain-mirror.yml` and `blog-index.yml` start from the same push; the mirror
  job rebuilds the blog windows so it mirrors current content, then
  `git checkout -- content/file` to hand ownership of those files back to the
  blog-index job. Removing that would give two jobs pushing the same files.

The deploy uses `rsync` **without `--delete`** — it never removes anything on
the host, which is what protects `assets/uploads/` and `assets/old_assets/`
(neither is in Git). Files deleted from the repo therefore linger on the host
until removed by hand.

The host serves the deploy directory straight to the web, so anything rsynced
up is a public URL. The repo's own documentation — `README.md`, `todo.md`,
`CLAUDE.md` — is excluded from the upload for that reason, and excluded from
the deploy trigger too. Adding a file to the rsync excludes does not take an
already-uploaded copy down; that needs deleting on the host.

## Secrets and host-only paths

Never commit: `assets/upload-config.php` (the upload token),
`assets/uploads/`, `assets/old_assets/`, `version.json`, `*.wasm.gz`,
`.link-check-cache.json`, `link-report.md`. All are in `.gitignore`; the deploy
excludes the config and both media directories too.

Deploy secrets live in repository settings: `SSH_HOST`, `SSH_USER`,
`SSH_PRIVATE_KEY`, `DEPLOY_PATH`, optionally `SSH_PORT`.

## Code style

Match the surrounding code — it has a distinct and consistent voice:

- **Comments explain *why*, in prose.** Block comments at the top of a file or
  above a non-obvious decision, written as full sentences, often naming the
  failure they prevent ("Firefox decodes the images CSS asks for off the main
  thread and paints a window whose mask has not arrived as gone rather than as
  half dissolved"). Do not replace these with terse restatements of the code, and
  do not add comments that merely narrate what the next line does.
- British spelling in prose and in identifiers where it already appears
  (`colour`, `centred`, `grey`) — but note the `@[model]` directive accepts both
  `colour=` and `color=`.
- Vanilla JS, no frameworks, no transpilation. IIFEs or `(() => { … })()` at
  file scope, `const`/`let`, optional chaining, template literals.
- Python: standard library plus `PIL` where a script needs it; module docstring
  explaining what the script generates and when to re-run it.
- CSS: theme variables over literal colours.
- Commit subjects are imperative sentence case with no prefix or ticket id —
  `Add a multi-channel CW mode to ClackModem`, `ClackPaint: add a Photoshop-style
  History panel below the layers`. An `App: change` prefix is used when the
  change is scoped to one app.

## Testing

There is no automated test suite. `content/file/markdown-test.md` is a manual
exercise page for the renderer (it is `robots: noindex`). Verify changes by
serving the site locally and looking at them — in a desktop window *and* on the
standalone app page *and* in the regenerated `plain/` mirror, since those are
three different rendering paths over the same content.

## Working in this repo

- Develop on the assigned feature branch, never push to `main` directly.
- **Never link to the assistant conversation that produced a change** — no
  session URLs in commit messages, pull request titles or bodies, code comments,
  issue comments, or anything else that lands in the repository. The commit and
  its diff are the record; a link to a chat log nobody else can open is not.
- Regenerate the derived files your change affects and commit them alongside it.
- When a change touches the renderer's vocabulary, change `assets/js/markdown.js`
  and `scripts/build_plain_site.py` together.
- Read the relevant README section before changing a subsystem, then update that
  section in the same commit — the README documents behaviour in detail and
  going stale is its main failure mode. Update `todo.md` when you finish
  something listed there.
