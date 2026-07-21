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
import json
import os
import posixpath
import re
import pathlib
import urllib.parse

root = pathlib.Path(__file__).resolve().parent.parent
content = root / 'content'
out_root = root / 'plain'
site = json.loads((content / 'site.json').read_text())

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
    s = re.sub(r'`([^`]+)`', r'<span class="k">\1</span>', s)
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

def build_embed(block):
    """@[build] -> a small stamp of the deployed commit. The values come from
    the environment set by the deploy/mirror workflow (SITE_COMMIT etc.); with
    none set (a plain local run) it degrades to a 'dev' label."""
    if not re.match(r'^@\[build\]$', block.strip(), re.I):
        return None
    sha = os.environ.get('SITE_COMMIT', '').strip()
    built = os.environ.get('SITE_BUILT_AT', '').strip()
    repo = os.environ.get('SITE_REPO', '').strip()
    if not sha:
        return '<p class="build-stamp">Build: dev (unversioned)</p>'
    code = '<span class="k">%s</span>' % esc(sha[:7])
    if repo:
        code = ('<a href="https://github.com/%s/commit/%s" target="_blank" '
                'rel="noopener noreferrer">%s</a>' % (esc(repo), esc(sha), code))
    tail = ' · ' + esc(built[:10]) if built else ''
    return '<p class="build-stamp">Build %s%s</p>' % (code, tail)

# ---------------------------------------------------------------- blocks
def md_to_html(body, meta, page_out, state):
    fences = []
    body = re.sub(r'```\w*\r?\n([\s\S]*?)```',
                  lambda m: fences.append('<pre class="code">%s</pre>' % esc(m.group(1).rstrip())) or
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
                 or kicanvas_embed(block, page_out, state) or build_embed(block))
        if fence:
            out.append(fences[int(fence.group(1))])
        elif embed:
            out.append(embed)
        elif re.match(r'^>\s?', block):
            text = re.sub(r'^>\s?', '', block, flags=re.M)
            out.append('<blockquote>%s</blockquote>'
                       % inline(text, page_out).replace('\n', '<br>'))
        elif re.match(r'^##\s+', block):
            out.append('<p class="eyebrow">%s</p>' % inline(re.sub(r'^##\s+', '', block), page_out))
        elif re.match(r'^#\s+', block):
            out.append('<h1>%s</h1>' % inline(re.sub(r'^#\s+', '', block), page_out))
            if meta.get('tagline'):
                out.append('<p class="tagline">%s</p>' % esc(meta['tagline']))
                out.append('<div class="rule"></div>')
        elif re.match(r'^-{3,}$', block):
            if idx == len(blocks) - 2:
                footer_next = True
            else:
                out.append('<div class="rule"></div>')
        elif re.match(r'^\d+\.\s', block):
            items = re.split(r'\r?\n(?=\d+\.\s)', block)
            out.append('<ol class="list">%s</ol>' % ''.join(
                '<li><p>%s</p></li>' % inline(re.sub(r'^\d+\.\s+', '', i).replace('\n', ' '), page_out)
                for i in items))
        elif re.match(r'^[-*]\s', block):
            items = re.split(r'\r?\n(?=[-*]\s)', block)
            out.append('<ul class="list">%s</ul>' % ''.join(
                '<li><p>%s</p></li>' % inline(re.sub(r'^[-*]\s+', '', i).replace('\n', ' '), page_out)
                for i in items))
        elif all(re.match(r'^\[[^\]]+\]\([^)]+\)$', l.strip()) for l in block.splitlines()):
            btns = [inline(l.strip(), page_out).replace(
                        '<a ', '<a class="btn %s" ' % ('primary' if i == 0 else 'ghost'), 1)
                    for i, l in enumerate(block.splitlines())]
            out.append('<div class="ctas">%s</div>' % ''.join(btns))
        else:
            out.append('<p>%s</p>' % inline(block, page_out).replace('\n', '<br>'))
    return '\n'.join(out)

# ---------------------------------------------------------------- pages
STYLE = 'style.css'

def render_page(md_rel, page_out):
    meta, body = parse_front_matter((content / md_rel).read_text())
    state = {'kicanvas': False}
    article = md_to_html(body, meta, page_out, state)
    style_class = 'page' if meta.get('style') == 'page' else 'plain'
    title = meta.get('title', 'Clacktronics')
    nav = ' · '.join(
        '<a href="%s"%s>%s</a>'
        % (esc(rel_href(out, page_out)),
           ' class="current"' if out == page_out else '',
           esc(label))
        for out, label, _md in NAV)
    kicanvas = ('<script type="module" src="%s"></script>\n'
                % esc(resolve_site_url('vendor/kicanvas/kicanvas.js', page_out))
                if state['kicanvas'] else '')
    theme = site.get('theme', 'clackos.css')
    css = lambda path: esc(resolve_site_url(path, page_out))
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
<title>{esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Dosis:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{css('assets/css/icons.css')}">
<link rel="stylesheet" href="{css('assets/css/clackos.css')}">
<link rel="stylesheet" href="{css('assets/themes/' + theme)}">
<link rel="stylesheet" href="{esc(rel_href(STYLE, page_out))}">
{kicanvas}</head>
<body class="plain-mirror">
<header id="plain-nav"><nav>{nav}</nav></header>
<main>
<div class="{style_class}">
{article}
</div>
</main>
<div id="plain-site-footer"><a href="{esc(resolve_site_url('index.html', page_out))}">Switch to the ClackOS desktop version</a></div>
</body>
</html>
'''

CSS = '''/* Plain mirror of clacktronics.co.uk — the ClackOS look without the desktop.
 * Loaded after assets/css/clackos.css + the active theme; these overrides
 * turn the fixed desktop shell back into an ordinary scrolling document. */
html, body.plain-mirror { height: auto; overflow: auto; }
body.plain-mirror {
  background: var(--paper);
  user-select: text;
  min-height: 100vh;
  display: flex; flex-direction: column;
}
body.plain-mirror main { flex: 1; width: 100%; }

#plain-nav {
  background: var(--ink); color: var(--menu-text);
  font-size: 13px; font-weight: 500;
  padding: 8px 16px;
}
#plain-nav nav { max-width: 980px; margin: 0 auto; }
#plain-nav a {
  color: var(--menu-text); text-decoration: none;
  padding: 3px 8px; border-radius: 5px;
}
#plain-nav a:hover { background: var(--leaf-deep); }
#plain-nav a.current { background: var(--leaf-deep); color: var(--accent-hover); }

#plain-site-footer {
  border-top: 1px solid var(--paper-line);
  padding: 14px 16px 28px; text-align: center;
  font-size: 11px; color: var(--sage);
}
#plain-site-footer a { color: var(--sage); }
#plain-site-footer a:hover { color: var(--leaf); }

.build-stamp { font-size: 11px; opacity: 0.6; }
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
