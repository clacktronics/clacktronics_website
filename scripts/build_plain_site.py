#!/usr/bin/env python3
"""Generate a plain-HTML mirror of the markdown content in plain/.

The ClackOS desktop stays untouched; this walks content/file/ (plus the
about page) and converts each markdown file to a standalone HTML page with
ordinary links. window:<path> links become relative links between mirror
pages, app:<page> links open the standalone application page in a new tab,
and the @[youtube] / @[video] / @[kicanvas] embed directives keep working
inline. Run it after editing content:

    python3 scripts/build_plain_site.py
"""
import html
import posixpath
import re
import pathlib
import urllib.parse

root = pathlib.Path(__file__).resolve().parent.parent
content = root / 'content'
out_root = root / 'plain'

NAV = [
    ('index.html', 'Home', 'file/home.md'),
    ('readme.html', 'README', 'file/readme.md'),
    ('catalogue.html', 'Catalogue', 'file/catalogue.md'),
    ('euroclack.html', 'EuroClack', 'file/euroclack.md'),
    ('blog.html', 'Blog', 'file/blog.md'),
    ('about.html', 'About', 'applications/about.md'),
]

# ---------------------------------------------------------------- collect
def collect_pages():
    """Map content-relative md path -> mirror-relative html path."""
    pages = {}
    for f in sorted((content / 'file').rglob('*.md')):
        rel = f.relative_to(content).as_posix()          # file/blog/x.md
        out = rel[len('file/'):]                          # blog/x.md
        out = 'index.html' if out == 'home.md' else out[:-3] + '.html'
        pages[rel] = out
    about = content / 'applications' / 'about.md'
    if about.exists():
        pages['applications/about.md'] = 'about.html'
    return pages

PAGES = collect_pages()

# ---------------------------------------------------------------- helpers
def esc(s):
    return html.escape(str(s), quote=True)

def parse_front_matter(text):
    meta = {}
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            for line in text[3:end].strip().splitlines():
                if ':' in line:
                    k, v = line.split(':', 1)
                    meta[k.strip()] = v.strip()
            text = text[end + 4:]
    return meta, text.lstrip('\n')

def rel_href(target, page_out):
    """Relative link from the current output page to a mirror-relative path."""
    depth = page_out.count('/')
    return ('../' * depth + target) if depth else target

def resolve_site_url(url, page_out):
    """Resolve a root-relative / dot-relative content URL for this page.

    In ClackOS every page renders inside index.html at the repo root, so
    relative URLs in markdown resolve against the root. Mirror pages live
    one level down in plain/ (and deeper for blog/euroclack), so prefix
    the right number of ../ segments to land back at the repo root.
    """
    path = posixpath.normpath(url.lstrip('/'))
    while path.startswith('../'):
        path = path[3:]
    return '../' * (1 + page_out.count('/')) + path

def fix_url(url, page_out):
    if re.match(r'^(?:https?:|mailto:|tel:|#)', url, re.I):
        return url
    return resolve_site_url(url, page_out)

# ---------------------------------------------------------------- inline
def inline(s, page_out):
    s = esc(s)
    imgs = []

    def img_sub(m):
        alt, src = m.group(1), m.group(2)
        imgs.append('<img src="%s" alt="%s" loading="lazy">'
                    % (esc(fix_url(src, page_out)), esc(alt)))
        return '\x00%d\x00' % (len(imgs) - 1)

    s = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)', img_sub, s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(^|[^*])\*([^*]+)\*', r'\1<i>\2</i>', s)

    def link_sub(m):
        text, href = m.group(1).strip(), m.group(2)
        if href.startswith('window:'):
            target = href[len('window:'):]
            if target in PAGES:
                return '<a href="%s">%s</a>' % (esc(rel_href(PAGES[target], page_out)), text)
            return text
        if href.startswith('app:'):
            # Apps are standalone pages under content/; open them plainly
            # in a new window instead of a desktop window.
            page, sep, opts = href[len('app:'):].partition('?')
            url = resolve_site_url('content/' + page, page_out)
            if sep:
                url += '?' + opts
            return ('<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>'
                    % (esc(url), text))
        if href.startswith('action:'):
            return text
        return ('<a href="%s"%s>%s</a>'
                % (esc(fix_url(href, page_out)),
                   '' if href.startswith('#') else ' target="_blank" rel="noopener noreferrer"',
                   text))

    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link_sub, s)
    s = re.sub('\x00(\\d+)\x00', lambda m: imgs[int(m.group(1))], s)
    return s

# ---------------------------------------------------------------- embeds
def youtube_embed(block):
    m = re.match(r'^@\[youtube\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)$', block, re.I)
    if not m:
        return None
    url = urllib.parse.urlparse(m.group(1))
    host = url.hostname.lower().removeprefix('www.') if url.hostname else ''
    vid = ''
    if host == 'youtu.be':
        vid = url.path.lstrip('/').split('/')[0]
    elif host in ('youtube.com', 'm.youtube.com', 'youtube-nocookie.com'):
        if url.path == '/watch':
            vid = urllib.parse.parse_qs(url.query).get('v', [''])[0]
        else:
            m2 = re.match(r'^/(?:embed|shorts)/([^/]+)', url.path)
            vid = m2.group(1) if m2 else ''
    if not re.match(r'^[A-Za-z0-9_-]{11}$', vid):
        return None
    title = m.group(2) or 'YouTube video'
    return ('<div class="youtube-embed"><iframe src="https://www.youtube-nocookie.com/embed/%s" '
            'title="%s" loading="lazy" allow="accelerometer; autoplay; clipboard-write; '
            'encrypted-media; gyroscope; picture-in-picture; web-share" '
            'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>'
            % (vid, esc(title)))

def video_embed(block, page_out):
    m = re.match(r'^@\[video\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)(?:\{([^}]*)\})?$', block, re.I)
    if not m:
        return None
    opts = set(re.split(r'[\s,]+', (m.group(3) or '').lower().strip()) if m.group(3) else [])
    opts.discard('')
    if opts - {'noloop', 'controls'}:
        return None
    return ('<div class="video-embed"><video src="%s" aria-label="%s" preload="metadata" '
            'playsinline%s%s></video></div>'
            % (esc(fix_url(m.group(1), page_out)), esc(m.group(2) or 'Video'),
               ' controls' if 'controls' in opts else '',
               '' if 'noloop' in opts else ' loop'))

def kicanvas_embed(block, page_out, state):
    m = re.match(r'^@\[kicanvas\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)$', block, re.I)
    if not m or not re.search(r'\.(?:kicad_sch|kicad_pcb|kicad_wks)(?:[?#].*)?$', m.group(1), re.I):
        return None
    state['kicanvas'] = True
    title = m.group(2) or 'KiCad design'
    return ('<figure class="kicanvas-embed"><kicanvas-embed controls="full" aria-label="%s">'
            '<kicanvas-source src="%s"></kicanvas-source></kicanvas-embed>'
            '<figcaption>%s</figcaption></figure>'
            % (esc(title), esc(fix_url(m.group(1), page_out)), esc(title)))

# ---------------------------------------------------------------- blocks
def md_to_html(body, meta, page_out, state):
    fences = []
    body = re.sub(r'```\w*\r?\n([\s\S]*?)```',
                  lambda m: fences.append('<pre>%s</pre>' % esc(m.group(1).rstrip())) or
                  '\x00fence%d\x00' % (len(fences) - 1), body)

    blocks = [b.strip() for b in re.split(r'\r?\n[ \t]*\r?\n', body) if b.strip()]
    out = []
    footer_next = False
    for idx, block in enumerate(blocks):
        is_last = idx == len(blocks) - 1
        if footer_next and is_last:
            spans = '\n'.join('<span>%s</span>' % inline(l, page_out)
                              for l in block.splitlines())
            out.append('<footer>%s</footer>' % spans)
            continue
        footer_next = False

        fence = re.match(r'^\x00fence(\d+)\x00$', block)
        embed = (youtube_embed(block) or video_embed(block, page_out)
                 or kicanvas_embed(block, page_out, state))
        if fence:
            out.append(fences[int(fence.group(1))])
        elif embed:
            out.append(embed)
        elif re.match(r'^>\s?', block):
            text = re.sub(r'^>\s?', '', block, flags=re.M)
            out.append('<blockquote>%s</blockquote>'
                       % inline(text, page_out).replace('\n', '<br>'))
        elif re.match(r'^##\s+', block):
            out.append('<h2>%s</h2>' % inline(re.sub(r'^##\s+', '', block), page_out))
        elif re.match(r'^#\s+', block):
            out.append('<h1>%s</h1>' % inline(re.sub(r'^#\s+', '', block), page_out))
            if meta.get('tagline'):
                out.append('<p class="tagline">%s</p>' % esc(meta['tagline']))
        elif re.match(r'^-{3,}$', block):
            if idx == len(blocks) - 2:
                footer_next = True
            else:
                out.append('<hr>')
        elif re.match(r'^\d+\.\s', block):
            items = re.split(r'\r?\n(?=\d+\.\s)', block)
            out.append('<ol>%s</ol>' % ''.join(
                '<li>%s</li>' % inline(re.sub(r'^\d+\.\s+', '', i).replace('\n', ' '), page_out)
                for i in items))
        elif re.match(r'^[-*]\s', block):
            items = re.split(r'\r?\n(?=[-*]\s)', block)
            out.append('<ul>%s</ul>' % ''.join(
                '<li>%s</li>' % inline(re.sub(r'^[-*]\s+', '', i).replace('\n', ' '), page_out)
                for i in items))
        elif all(re.match(r'^\[[^\]]+\]\([^)]+\)$', l.strip()) for l in block.splitlines()):
            links = ' '.join(inline(l.strip(), page_out) for l in block.splitlines())
            out.append('<p class="ctas">%s</p>' % links)
        else:
            out.append('<p>%s</p>' % inline(block, page_out).replace('\n', '<br>'))
    return '\n'.join(out)

# ---------------------------------------------------------------- pages
STYLE = 'style.css'

def render_page(md_rel, page_out):
    meta, body = parse_front_matter((content / md_rel).read_text())
    state = {'kicanvas': False}
    article = md_to_html(body, meta, page_out, state)
    title = meta.get('title', 'Clacktronics')
    nav = ' · '.join(
        '<a href="%s"%s>%s</a>'
        % (esc(rel_href(out, page_out)),
           ' class="current"' if out == page_out else '',
           esc(label))
        for out, label, _md in NAV)
    kicanvas = ('<script type="module" src="%s"></script>'
                % esc(resolve_site_url('vendor/kicanvas/kicanvas.js', page_out))
                if state['kicanvas'] else '')
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<link rel="stylesheet" href="{esc(rel_href(STYLE, page_out))}">
{kicanvas}</head>
<body>
<header><nav>{nav}</nav></header>
<main>
{article}
</main>
<footer class="site"><a href="{esc(resolve_site_url('index.html', page_out))}">Switch to the ClackOS desktop version</a></footer>
</body>
</html>
'''

CSS = '''/* Plain mirror of clacktronics.co.uk — no desktop, just documents. */
:root { color-scheme: light dark; }
body {
  font-family: Georgia, 'Times New Roman', serif;
  max-width: 44rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 3rem;
  line-height: 1.55;
}
header nav { font-family: monospace; padding: .5rem 0 1rem; border-bottom: 1px solid; }
h1 { margin-bottom: .25rem; }
.tagline { margin-top: 0; font-style: italic; opacity: .75; }
img, video, iframe, kicanvas-embed { max-width: 100%; height: auto; }
.youtube-embed iframe { width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; }
kicanvas-embed { display: block; width: 100%; height: 24rem; }
pre { overflow-x: auto; padding: .75rem; border: 1px solid; }
code { font-family: monospace; }
blockquote { border-left: 3px solid; margin-left: 0; padding-left: 1rem; opacity: .85; }
footer { display: block; margin-top: 2rem; font-size: .85em; opacity: .7; }
footer span { display: block; }
footer.site { border-top: 1px solid; padding-top: .75rem; }
a { color: inherit; }
'''

def main():
    for md_rel, page_out in PAGES.items():
        dest = out_root / page_out
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(render_page(md_rel, page_out))
    (out_root / STYLE).write_text(CSS)
    print(f'wrote {len(PAGES)} pages to {out_root.relative_to(root)}/')

if __name__ == '__main__':
    main()
