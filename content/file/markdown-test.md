---
title: Markdown test page
style: page
robots: noindex
tagline: Every renderer feature on one page — if something here looks wrong, the renderer is wrong.
width: 760
height: 80%
---
# Markdown test

## // Contents

This page exercises every construct `mdToHtml()` understands, in the order the
renderer checks them. Each section says what it should look like, so a broken
build is visible without reading the source.

[Text](#text) · [Lists](#lists) · [Links and buttons](#links-and-buttons) · [Code and quotes](#code-and-quotes) · [Embeds](#embeds) · [Raw HTML](#raw-html) · [Edge cases](#edge-cases)

---

## // Frontmatter

The window this opens in should be titled **Markdown test**, use the rich
`page` style, be 760px wide and 80% of the desktop tall, and show the tagline
plus a rule directly under the `h1` above.

## // Text

Every heading gets an anchor id from its text. This paragraph shows
**bold text**, *italic text*, **bold with *italic* inside**, and `inline
keywords` — the last should be a green highlight, which is how prices like
`£45`, part numbers like `RP2350` and colours like `#00ff88` are marked up.

A single line break inside a paragraph
should stay a line break,
so these three lines stack without a blank line between them.

## // Eyebrow headings

A `##` heading is not an `h2` — it renders as a small green eyebrow label, and
is meant for section markers like the `// What we make` style used on the home
page.

## // Lists

1. **Numbered lists become the bordered box.** The list should render as the
   `01/02/03` feature panel, not as a plain ordered list. Wrapped lines in an
   item are joined into one paragraph.
2. **Second item.** Inline markup still works here: `code`, *italic*, and a
   [link back home](window:file/home.md).
3. **Third item** so the numbering has somewhere to go.

- A bullet list renders as a plain `ul.list`.
- Items also support **inline** `markup`.
- Wrapping a bullet across two lines
  joins it into a single paragraph.

* Asterisk bullets are accepted too.
* Both markers produce the same list.

## // Links and buttons

Inline links come in six flavours: an [external link](https://clacktronics.co.uk)
(opens in the Web Browser app), a [PDF link](https://example.com/manual.pdf)
(routed to PDF Reader), a [window link](window:file/euroclack.md), an
[app link](app:applications/paint.html) (shown with its app icon), an
[action link](action:tidy) that runs a desktop action, and an
[anchor link](#edge-cases) that scrolls within this window.

A paragraph containing **only** links becomes the call-to-action button row —
first solid, the rest ghosts:

[Open EuroClack](window:file/euroclack.md)
[Launch ClackPaint](app:applications/paint.html)
[Tidy the desktop](action:tidy)
[clacktronics.co.uk](https://clacktronics.co.uk)

An app link may carry a query string, including one whose value contains
parentheses — the link parser counts nesting rather than stopping at the first
`)`:

[Open a ring in OpenSCAD](app:applications/openscad.html?code=%24fn%3D64%3B%0Adifference%28%29%20%7B%0A%20%20cylinder%28d%3D30%2C%20h%3D5%2C%20center%3Dtrue%29%3B%0A%20%20cylinder%28d%3D20%2C%20h%3D6%2C%20center%3Dtrue%29%3B%0A%7D&render=1)

## // Images

A plain image:

![Circuit trace tile](assets/backgrounds/circuit-trace.png)

A linked image (thumbnail that opens the full file) — clicking it should open
the image, not follow a broken link:

[![Cracked earth tile](assets/backgrounds/cracked-earth.png)](assets/backgrounds/cracked-earth.png)

An image with an unsafe source is dropped entirely, leaving nothing behind:

![nothing here](javascript:alert)

## // Code and quotes

```
Fenced code keeps    its   spacing,
  its indentation,
and its <angle brackets> unescaped-looking but safely escaped.
```

```python
# a language tag is accepted and ignored — no highlighting, just monospace
def blink(pin, ms=250):
    while True:
        pin.toggle()
        sleep_ms(ms)
```

> A blockquote renders in the quote style.
> Continuation lines stay inside the same quote as line breaks,
> and **inline markup** with `code` still works here.

## // Embeds

A YouTube embed, responsive, cookie-less domain:

@[youtube](https://www.youtube.com/watch?v=PFA5VV02D28 "Mini-Speaker kit assembly")

Short links and Shorts/embed URLs are accepted by the same directive:

@[youtube](https://youtu.be/9yssRi2fjQk "Proto-PSU kit assembly")

An inline video — default playback is looping with no controls:

@[video](https://clacktronics.co.uk/assets/flipdots.mp4 "Flipdots flipping")

The same video with both options, so it plays once and shows controls:

@[video](https://clacktronics.co.uk/assets/flipdots.mp4 "Flipdots with controls"){noloop controls}

An interactive KiCad schematic viewer:

@[kicanvas](content/applications/kicad/example.kicad_sch "Example schematic")

The build stamp, filled in from `version.json` after the window mounts (reads
"dev" on a raw checkout):

@[build]

An embed directive with a bad target is not treated as an embed — this line
should render as ordinary paragraph text:

@[youtube](https://example.com/not-a-video)

## // Raw HTML

A block starting with an HTML tag is passed through the sanitiser:

<table>
  <thead><tr><th>Module</th><th>HP</th><th>Price</th></tr></thead>
  <tbody>
    <tr><td>Green Screen 2350</td><td>12</td><td>£120</td></tr>
    <tr><td>Proto-PSU</td><td>4</td><td>£45</td></tr>
  </tbody>
</table>

<details>
  <summary>Structural tags survive</summary>
  <p>Lists, <kbd>kbd</kbd>, <mark>mark</mark>, <sub>sub</sub>, <sup>sup</sup>,
  <abbr title="Voltage Controlled Oscillator">VCO</abbr> and
  <a href="https://clacktronics.co.uk">links</a> are all allowed.</p>
</details>

<a id="explicit-anchor"></a>
<p>Raw HTML can define an explicit anchor, so
<a href="#explicit-anchor">this link</a> has a target that no heading created.</p>

<div onclick="alert('nope')" data-action="restart">
  <script>alert('nope')</script>
  <p>Event handlers, <code>script</code>, <code>style</code>, <code>iframe</code>,
  <code>form</code>, <code>svg</code> and <code>data-action</code> are stripped.
  This paragraph should survive with no way to run anything.</p>
  <form><input value="removed"><button>removed</button></form>
</div>

## // Edge cases

## // Duplicate headings

## // Text

The heading directly above repeats `// Text` from earlier in the page, so it
gets the id `text-2` and the contents link at the top still lands on the first
one.

Only one `# ` heading is used on this page, at the very top: in `page` style
every `# ` heading re-emits the frontmatter tagline and rule underneath itself,
so a second one would print the tagline twice.

## // Rules and footers

A `---` on its own line is a horizontal rule (there is one below). A `---`
immediately before the *final* block of the file is different: it turns that
last block into the window footer, with one `<span>` per line. That is why this
page ends the way it does.

---

Escaping check: `<script>alert(1)</script>` inside inline code, and a bare
&amp; ampersand, must both come out as visible text rather than as markup.

---

Clacktronics — markdown renderer test page
Every feature above should render; nothing should execute
[Back to Clacktronics](window:file/home.md)
