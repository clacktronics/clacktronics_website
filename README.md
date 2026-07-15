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
  desktop/                  ← DESKTOP menu (wallpaper picker)
    menu.json
  special/                  ← SPECIAL menu
    menu.json
    about.md
```

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
width: 480                 ← initial window size in px
height: 360
style: plain               ← "plain" or "page" (rich landing-page look)
tagline: Optional line     ← "page" style only, rendered under the h1
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

Built-in actions: `close-front`, `tidy`, `toggle-taskbar`, `copy`, `restart`.
`{ "type": "wallpapers" }` expands to the wallpaper picker (wallpapers are SVG
tiles defined in `assets/js/clackos.js`).

### Adding a whole new menu

1. Create `content/<name>/` with a `menu.json`.
2. Add `<name>` to the `menus` array in `content/site.json`.

## Developing locally

`fetch()` doesn't work over `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
