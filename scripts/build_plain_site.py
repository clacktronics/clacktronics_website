#!/usr/bin/env python3
"""Generate a plain-HTML mirror of the markdown content in plain/.

The ClackOS desktop stays untouched; this walks content/file/ (plus the
about page) and converts each markdown file to a standalone HTML page with
ordinary links. window:<path> links become relative links between mirror
pages, app:<page> links open the standalone application in a new tab,
and the @[youtube] / @[video] / @[kicanvas] embed directives keep working
inline. Run it after editing content:

    python3 scripts/build_plain_site.py
"""
import html
import html.parser
import json
import os
import posixpath
import re
import pathlib
import unicodedata
import urllib.parse

root = pathlib.Path(__file__).resolve().parent.parent
content = root / 'content'
out_root = root / 'plain'
site = json.loads((content / 'site.json').read_text(encoding='utf-8'))
file_menu = json.loads((content / 'file' / 'menu.json').read_text(encoding='utf-8'))
applications_menu = json.loads((content / 'applications' / 'menu.json').read_text(encoding='utf-8'))

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

def esc_inline_attr(s):
    """inline() escapes its whole source before parsing, so an attribute built
    from that source only still needs its quotes escaped — running esc() again
    would turn an '&' in a query string into '&amp;amp;'."""
    return str(s).replace('"', '&quot;').replace("'", '&#x27;')

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

def safe_web_url(url, allow_fragment=True):
    """Mirror of safeWebUrl() in assets/js/clackos.js.

    Accepts fragments, http(s)/mailto/tel, and ordinary relative paths;
    rejects anything else (javascript:, data:, …) by returning ''.
    """
    url = str(url or '').strip()
    if allow_fragment and url.startswith('#'):
        return url
    if re.match(r'^(?:https?:|mailto:|tel:)', url, re.I):
        return url
    if re.match(r'^(?:\.\.?/|/)?[a-z0-9][^\s:]*$', url, re.I):
        return url
    return ''

def fix_url(url, page_out, allow_fragment=True):
    """Resolve a markdown URL for this mirror page, or '' if it is unsafe."""
    url = safe_web_url(url, allow_fragment)
    if not url:
        return ''
    if re.match(r'^(?:https?:|mailto:|tel:|#)', url, re.I):
        return url
    return resolve_site_url(url, page_out)

def menu_link(href, label, new_tab=False):
    target = ' target="_blank" rel="noopener noreferrer"' if new_tab else ''
    return '<a href="%s"%s>%s</a>' % (esc(href), target, esc(label))

def submenu(label, items):
    if not items:
        return ''
    return ('<details class="plain-submenu"><summary>%s</summary>'
            '<div class="plain-menu-panel">%s</div></details>'
            % (esc(label), ''.join(items)))

def application_items(items, page_out):
    """Build the static Applications menu from the same JSON as ClackOS."""
    out = []
    for item in items:
        kind = item.get('type')
        if kind == 'submenu':
            nested = application_items(item.get('items', []), page_out)
            if nested:
                out.append(submenu(item.get('label', ''), nested))
        elif kind == 'app' and item.get('page'):
            href = resolve_site_url('content/applications/' + item['page'], page_out)
            out.append(menu_link(href, item.get('label', item['page']), new_tab=True))
        elif kind == 'window' and item.get('md'):
            target = 'applications/' + item['md']
            if target in PAGES:
                out.append(menu_link(rel_href(PAGES[target], page_out),
                                     item.get('label', item['md'])))
        elif kind == 'sep' and out and out[-1] != '<hr>':
            out.append('<hr>')
    while out and out[-1] == '<hr>':
        out.pop()
    return out

def render_menu(md_rel, page_out):
    open_items = []
    for item in file_menu.get('items', []):
        if item.get('type') != 'submenu' or item.get('label', '').lower() != 'open':
            continue
        for child in item.get('items', []):
            target = 'file/' + child.get('md', '')
            if child.get('type') == 'window' and target in PAGES:
                open_items.append(menu_link(rel_href(PAGES[target], page_out),
                                            child.get('label', child['md'])))

    repo = site.get('repo', 'clacktronics/clacktronics_website')
    bug_href = 'https://github.com/%s/issues/new' % repo
    edit_href = resolve_site_url('content/applications/markdown.html', page_out)
    edit_href += '?open=' + urllib.parse.quote('content/' + md_rel, safe='/')
    file_items = [submenu('Open', open_items),
                  menu_link(bug_href, 'Report bug…', new_tab=True),
                  menu_link(edit_href, 'Edit…', new_tab=True)]
    apps = application_items(applications_menu.get('items', []), page_out)
    return ('<nav class="plain-menubar" aria-label="Site menu">'
            '<details class="plain-menu"><summary>File</summary>'
            '<div class="plain-menu-panel">%s</div></details>'
            '<details class="plain-menu"><summary>Applications</summary>'
            '<div class="plain-menu-panel">%s</div></details>'
            '</nav>') % (''.join(file_items), ''.join(apps))

# ---------------------------------------------------------------- inline
def inline(s, page_out):
    s = esc(s)
    imgs = []

    def img_sub(m):
        alt, src = m.group(1), m.group(2)
        src = fix_url(src, page_out, allow_fragment=False)
        imgs.append('<img src="%s" alt="%s" loading="lazy">'
                    % (esc_inline_attr(src), esc_inline_attr(alt)) if src else '')
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
                return '<a href="%s">%s</a>' % (esc_inline_attr(rel_href(PAGES[target], page_out)), text)
            return text
        if href.startswith('app:'):
            # Apps are standalone pages under content/; open the page itself
            # in a new tab instead of putting it in a desktop window.
            page, sep, opts = href[len('app:'):].partition('?')
            url = resolve_site_url('content/' + page, page_out)
            if sep:
                url += '?' + opts
            return ('<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>'
                    % (esc_inline_attr(url), text))
        if href.startswith('action:'):
            return text
        safe = fix_url(href, page_out)
        if not safe:
            return text
        return ('<a href="%s"%s>%s</a>'
                % (esc_inline_attr(safe),
                   '' if href.startswith('#') else ' target="_blank" rel="noopener noreferrer"',
                   text))

    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link_sub, s)
    s = re.sub('\x00(\\d+)\x00', lambda m: imgs[int(m.group(1))], s)
    return s

# ---------------------------------------------------------------- headings
def heading_slug(text):
    """Mirror of headingSlug() in assets/js/clackos.js."""
    slug = re.sub(r'[`*_~\[\]]', '', str(text))
    slug = unicodedata.normalize('NFKD', slug)
    slug = ''.join(c for c in slug if not unicodedata.combining(c))
    slug = re.sub(r'[^a-z0-9]+', '-', slug.lower()).strip('-')
    return slug or 'section'

def unique_heading_id(text, state):
    """Same de-duplication as ClackOS: the second 'Text' heading is text-2."""
    base = heading_slug(text)
    count = state['headings'].get(base, 0) + 1
    state['headings'][base] = count
    return base if count == 1 else '%s-%d' % (base, count)

# ---------------------------------------------------------------- raw HTML
# Same policy as sanitizeHtmlBlock() in assets/js/clackos.js: keep structural
# and content tags, drop active elements entirely, unwrap anything unknown, and
# strip event handlers, unsafe URLs and the desktop's own data-action hooks.
HTML_ALLOWED = set((
    'a abbr article aside b blockquote br caption code col colgroup details div em figcaption '
    'figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q s samp section small span strong '
    'sub summary sup table tbody td tfoot th thead tr u ul var').split())
HTML_REMOVED = set('script style iframe object embed link meta base form input button textarea select option svg math'.split())
HTML_VOID = set('br col hr img'.split())
# Tags that implicitly close an open sibling, as the browser's parser does for
# the DOM that sanitizeHtmlBlock() works on. Without this, '<td>a<td>b' would
# come out nested instead of side by side.
HTML_IMPLIED_CLOSE = {
    'li': {'li'},
    'td': {'td', 'th'},
    'th': {'td', 'th'},
    'tr': {'td', 'th', 'tr'},
    'thead': {'td', 'th', 'tr', 'thead', 'tbody', 'tfoot'},
    'tbody': {'td', 'th', 'tr', 'thead', 'tbody', 'tfoot'},
    'tfoot': {'td', 'th', 'tr', 'thead', 'tbody', 'tfoot'},
    'p': {'p'},
}

class HtmlBlockSanitizer(html.parser.HTMLParser):
    def __init__(self, page_out):
        super().__init__(convert_charrefs=True)
        self.page_out = page_out
        self.out = []
        self.drop_depth = 0          # inside a removed element
        self.drop_tag = None
        self.open_tags = []          # kept tags, so end tags can be matched up

    # -- attributes ----------------------------------------------------
    def _attrs(self, tag, attrs):
        kept = []
        for name, value in attrs:
            name = name.lower()
            value = '' if value is None else value
            generally_safe = (
                name in ('id', 'class', 'title', 'role', 'width', 'height', 'colspan', 'rowspan')
                or name.startswith('aria-')
                or (name.startswith('data-') and name not in ('data-action', 'data-anchor')))
            tag_safe = ((tag == 'img' and name in ('src', 'alt', 'loading'))
                        or (tag == 'a' and name in ('href', 'target', 'rel')))
            if name.startswith('on') or not (generally_safe or tag_safe):
                continue
            kept.append((name, value))
        return dict(kept)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.drop_depth:
            if tag == self.drop_tag and tag not in HTML_VOID:
                self.drop_depth += 1
            return
        if tag in HTML_REMOVED:
            if tag not in HTML_VOID:
                self.drop_depth, self.drop_tag = 1, tag
            return
        if tag not in HTML_ALLOWED:
            return                                   # unwrap: children survive
        closes = HTML_IMPLIED_CLOSE.get(tag, ())
        while self.open_tags and self.open_tags[-1] in closes:
            self.out.append('</%s>' % self.open_tags.pop())
        attributes = self._attrs(tag, attrs)

        if tag == 'img':
            src = fix_url(attributes.get('src', ''), self.page_out, allow_fragment=False)
            if not src:
                return
            attributes['src'] = src
            attributes['loading'] = 'lazy'
        if tag == 'a':
            href = attributes.pop('href', '')
            safe = safe_web_url(href)
            if not safe:
                attributes.pop('target', None)
                attributes.pop('rel', None)
            elif safe.startswith('#'):
                attributes['href'] = safe
                attributes.pop('target', None)
                attributes.pop('rel', None)
            else:
                attributes['href'] = fix_url(href, self.page_out)
                attributes['target'] = '_blank'
                attributes['rel'] = 'noopener noreferrer'

        rendered = ''.join(' %s="%s"' % (name, esc(value)) for name, value in attributes.items())
        if tag in HTML_VOID:
            self.out.append('<%s%s>' % (tag, rendered))
            return
        self.out.append('<%s%s>' % (tag, rendered))
        self.open_tags.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in HTML_VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop_depth:
            if tag == self.drop_tag:
                self.drop_depth -= 1
                if not self.drop_depth:
                    self.drop_tag = None
            return
        if tag in HTML_VOID or tag not in self.open_tags:
            return
        while self.open_tags:                        # close anything left open
            open_tag = self.open_tags.pop()
            self.out.append('</%s>' % open_tag)
            if open_tag == tag:
                break

    def handle_data(self, data):
        if not self.drop_depth:
            self.out.append(esc(data))

    def handle_comment(self, data):
        pass

    def result(self):
        self.close()
        while self.open_tags:
            self.out.append('</%s>' % self.open_tags.pop())
        return ''.join(self.out)

def sanitize_html_block(block, page_out):
    parser = HtmlBlockSanitizer(page_out)
    parser.feed(block)
    return parser.result()

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
    src = fix_url(m.group(1), page_out, allow_fragment=False)
    if not src:
        return None
    return ('<div class="video-embed"><video src="%s" aria-label="%s" preload="metadata" '
            'playsinline%s%s></video></div>'
            % (esc(src), esc(m.group(2) or 'Video'),
               ' controls' if 'controls' in opts else '',
               '' if 'noloop' in opts else ' loop'))

def kicanvas_embed(block, page_out, state):
    m = re.match(r'^@\[kicanvas\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)$', block, re.I)
    if not m or not re.search(r'\.(?:kicad_sch|kicad_pcb|kicad_wks)(?:[?#].*)?$', m.group(1), re.I):
        return None
    src = fix_url(m.group(1), page_out, allow_fragment=False)
    if not src:
        return None
    state['kicanvas'] = True
    title = m.group(2) or 'KiCad design'
    return ('<figure class="kicanvas-embed"><kicanvas-embed controls="full" aria-label="%s">'
            '<kicanvas-source src="%s"></kicanvas-source></kicanvas-embed>'
            '<figcaption>%s</figcaption></figure>'
            % (esc(title), esc(src), esc(title)))

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
        elif re.search(r'^<[/!A-Za-z][\s\S]*>$', block, re.M):
            out.append('<div class="html-block">%s</div>'
                       % sanitize_html_block(block, page_out))
        elif re.match(r'^>\s?', block):
            text = re.sub(r'^>\s?', '', block, flags=re.M)
            out.append('<blockquote>%s</blockquote>'
                       % inline(text, page_out).replace('\n', '<br>'))
        elif re.match(r'^##\s+', block):
            heading = re.sub(r'^##\s+', '', block)
            out.append('<p class="eyebrow" id="%s">%s</p>'
                       % (esc(unique_heading_id(heading, state)), inline(heading, page_out)))
        elif re.match(r'^#\s+', block):
            heading = re.sub(r'^#\s+', '', block)
            out.append('<h1 id="%s">%s</h1>'
                       % (esc(unique_heading_id(heading, state)), inline(heading, page_out)))
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
    meta, body = parse_front_matter((content / md_rel).read_text(encoding='utf-8'))
    state = {'kicanvas': False, 'headings': {}}
    article = md_to_html(body, meta, page_out, state)
    style_class = 'page' if meta.get('style') == 'page' else 'plain'
    title = meta.get('title', 'Clacktronics')
    menu = render_menu(md_rel, page_out)
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
<header id="plain-nav">{menu}</header>
<main>
<div class="{style_class}">
{article}
</div>
</main>
<div id="plain-site-footer"><a href="{esc(resolve_site_url('index.html?desktop=1', page_out))}">Switch to the ClackOS desktop version</a></div>
<script>
(() => {{
  const topMenus = [...document.querySelectorAll('.plain-menu')];
  const submenus = [...document.querySelectorAll('.plain-submenu')];
  const closeTree = menu => {{
    menu.open = false;
    menu.querySelectorAll('details[open]').forEach(child => {{ child.open = false; }});
  }};

  topMenus.forEach(menu => {{
    menu.addEventListener('toggle', () => {{
      if (menu.open)
        topMenus.filter(other => other !== menu).forEach(closeTree);
    }});
    menu.addEventListener('mouseleave', () => closeTree(menu));
  }});

  submenus.forEach(menu => {{
    menu.addEventListener('toggle', () => {{
      if (!menu.open) return;
      const siblings = menu.parentElement.querySelectorAll(':scope > .plain-submenu[open]');
      siblings.forEach(other => {{ if (other !== menu) closeTree(other); }});
    }});
    if (matchMedia('(hover: hover)').matches)
      menu.addEventListener('mouseenter', () => {{ menu.open = true; }});
  }});

  document.addEventListener('click', event => {{
    if (!event.target.closest('.plain-menubar')) topMenus.forEach(closeTree);
  }});
  document.addEventListener('keydown', event => {{
    if (event.key === 'Escape') topMenus.forEach(closeTree);
  }});
}})();
</script>
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
  min-height: 34px;
}
.plain-menubar {
  max-width: 980px; margin: 0 auto; padding: 0 8px;
  display: flex; align-items: stretch;
}
.plain-menu, .plain-submenu { position: relative; }
.plain-menu summary, .plain-submenu summary {
  list-style: none; cursor: pointer; user-select: none;
}
.plain-menu summary::-webkit-details-marker,
.plain-submenu summary::-webkit-details-marker { display: none; }
.plain-menu > summary { padding: 9px 12px 8px; }
.plain-menu[open] > summary { background: var(--leaf-deep); color: var(--accent-hover); }
.plain-menu-panel {
  position: absolute; z-index: 20; top: 100%; left: 0;
  min-width: 230px; padding: 5px 0;
  background: var(--paper); color: var(--control-text);
  border: 1px solid var(--ink); box-shadow: 3px 3px 0 var(--shadow);
}
.plain-menu-panel a, .plain-submenu > summary {
  display: block; padding: 7px 14px; color: var(--control-text);
  text-decoration: none; white-space: nowrap;
}
.plain-menu-panel a:hover, .plain-menu-panel a:focus,
.plain-submenu[open] > summary { background: var(--ink); color: var(--menu-text); }
.plain-submenu > summary::after { content: '\\203a'; float: right; margin-left: 20px; }
.plain-submenu > .plain-menu-panel { top: -6px; left: 100%; }
.plain-menu-panel hr { border: 0; border-top: 1px solid var(--paper-line); margin: 5px 0; }

@media (max-width: 640px) {
  .plain-menu { position: static; }
  .plain-menu > .plain-menu-panel {
    left: 8px; right: 8px; min-width: 0; max-height: calc(100vh - 48px); overflow: auto;
  }
  .plain-submenu > .plain-menu-panel {
    position: static; border-width: 1px 0; box-shadow: none; margin: 0 8px 5px;
  }
  .plain-menu-panel a, .plain-submenu > summary { white-space: normal; }
}

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
        dest.write_text(render_page(md_rel, page_out), encoding='utf-8', newline='\n')
    (out_root / STYLE).write_text(CSS, encoding='utf-8', newline='\n')
    print(f'wrote {len(PAGES)} pages to {out_root.relative_to(root)}/')

if __name__ == '__main__':
    main()
