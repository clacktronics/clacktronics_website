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

SITE_NAME = 'Clacktronics'

# Absolute base URL for canonical links, Open Graph URLs and sitemap entries —
# all three have to be absolute, so the build needs to know where the pages
# will actually be served from. The deploy workflow exports SITE_URL derived
# from its SUBDIR, so a build staged in a subfolder emits URLs under that
# subfolder rather than pointing search engines at pages it isn't serving;
# otherwise site.json's "siteUrl" decides. The deploy publishes to the root
# today, so both normally agree.
SITE_URL = (os.environ.get('SITE_URL', '').strip()
            or site.get('siteUrl', 'https://clacktronics.co.uk/')).rstrip('/') + '/'

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

# ---------------------------------------------------------------- crawling
DESCRIPTION_LIMIT = 155

def page_url(page_out):
    """Absolute URL of a mirror page (canonical link and sitemap entry)."""
    return SITE_URL + 'plain/' + page_out

def absolute_url(url, page_out):
    """Promote a URL already resolved for this page to an absolute one."""
    if re.match(r'^https?:', url, re.I):
        return url
    return urllib.parse.urljoin(page_url(page_out), url)

def strip_markdown(text):
    """Reduce a markdown block to the prose inside it."""
    text = re.sub(r'!\[[^\]]*\]\([^)\s]*\)', '', text)             # images
    text = re.sub(r'@\[[a-z]+\]\([^)]*\)(?:\{[^}]*\})?', '', text, flags=re.I)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)           # links -> label
    text = re.sub(r'<[^>]+>', '', text)                            # raw html tags
    text = re.sub(r'[*`>#]+', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def page_title(meta, body):
    """Frontmatter title, else the first heading — archive.md has no header."""
    if meta.get('title'):
        return meta['title'].strip()
    m = re.search(r'^#\s+(.+)$', body, re.M)
    return strip_markdown(m.group(1)) if m else SITE_NAME

def head_title(title):
    """Search results show the site name, so add it when the title lacks it."""
    return title if 'clacktronics' in title.lower() else f'{title} — {SITE_NAME}'

DATE_LIKE = re.compile(
    r'^(?:\d{4}-\d{2}-\d{2}'
    r'|\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}'
    r'|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})$', re.I)

def summarise(meta, body):
    """Meta description: an explicit one, else the tagline, else first prose.

    Blog posts put their date in `tagline:`, which makes a useless search
    snippet, so a date-shaped tagline falls through to the prose instead.
    """
    for key in ('description', 'tagline'):
        value = strip_markdown(meta.get(key, ''))
        if value and not DATE_LIKE.match(value):
            return value
    for block in re.split(r'\r?\n\s*\r?\n', body):
        block = block.strip()
        # Headings, rules, lists, fences, embeds, raw HTML, quotes and tables
        # are not prose. Image-led blocks are: the old posts open with a photo
        # and carry straight on into the text, and strip_markdown drops images.
        if not block or block.startswith(('#', '-', '`', '@', '<', '>', '|')):
            continue
        if re.match(r'^\d+\.\s', block):
            continue
        # A paragraph of nothing but links is the button row, not a summary.
        if all(re.match(r'^\[[^\]]+\]\([^)]+\)$', l.strip())
               for l in block.splitlines()):
            continue
        text = strip_markdown(block)
        if len(text) < 40:
            continue
        if len(text) > DESCRIPTION_LIMIT:
            text = text[:DESCRIPTION_LIMIT].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
        return text
    return ''

def first_image(body, page_out):
    """Absolute URL of the page's first image, for og:image."""
    m = re.search(r'!\[[^\]]*\]\(([^)\s]+)\)', body)
    if not m:
        return ''
    src = fix_url(m.group(1), page_out, allow_fragment=False)
    return absolute_url(src, page_out) if src else ''

def post_date(md_rel):
    """The YYYY-MM-DD a blog post filename starts with, or ''."""
    m = re.match(r'(\d{4}-\d{2}-\d{2})', posixpath.basename(md_rel))
    return m.group(1) if m else ''

def json_ld(md_rel, page_out, title, description, image):
    """Schema.org metadata: BlogPosting for posts, WebSite for the home page."""
    url = page_url(page_out)
    if page_out.startswith('blog/'):
        data = {'@context': 'https://schema.org', '@type': 'BlogPosting',
                'headline': title, 'url': url, 'mainEntityOfPage': url,
                'publisher': {'@type': 'Organization', 'name': SITE_NAME,
                              'url': SITE_URL}}
        date = post_date(md_rel)
        if date:
            data['datePublished'] = date
        if image:
            data['image'] = image
    elif page_out == 'index.html':
        data = {'@context': 'https://schema.org', '@type': 'WebSite',
                'name': SITE_NAME, 'url': SITE_URL}
    else:
        return ''
    if description:
        data['description'] = description
    body = json.dumps(data, ensure_ascii=False).replace('</', r'<\/')
    return '<script type="application/ld+json">%s</script>\n' % body

def head_meta(md_rel, page_out, meta, body):
    """The crawler-facing part of <head>: description, canonical, OG, JSON-LD."""
    title = page_title(meta, body)
    description = summarise(meta, body)
    image = first_image(body, page_out)
    noindex = 'noindex' in meta.get('robots', '').lower()
    tags = [f'<title>{esc(head_title(title))}</title>']
    if description:
        tags.append(f'<meta name="description" content="{esc(description)}">')
    if noindex:
        # Test and scratch pages stay crawlable but out of the index.
        tags.append('<meta name="robots" content="noindex,follow">')
    tags += [f'<link rel="canonical" href="{esc(page_url(page_out))}">',
             f'<meta property="og:site_name" content="{esc(SITE_NAME)}">',
             '<meta property="og:type" content="%s">'
             % ('article' if page_out.startswith('blog/') else 'website'),
             f'<meta property="og:title" content="{esc(title)}">',
             f'<meta property="og:url" content="{esc(page_url(page_out))}">']
    if description:
        tags.append(f'<meta property="og:description" content="{esc(description)}">')
    if image:
        tags.append(f'<meta property="og:image" content="{esc(image)}">')
    tags.append('<meta name="twitter:card" content="%s">'
                % ('summary_large_image' if image else 'summary'))
    ld = json_ld(md_rel, page_out, title, description, image)
    return '\n'.join(tags) + '\n' + ld, noindex

def build_sitemap(entries):
    """A sitemap of the mirror — the only per-page URLs the site has."""
    urls = []
    for url, lastmod in entries:
        urls.append('  <url>\n    <loc>%s</loc>%s\n  </url>'
                    % (esc(url),
                       '\n    <lastmod>%s</lastmod>' % lastmod if lastmod else ''))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(urls) + '\n</urlset>\n')

def build_robots():
    """robots.txt, generated so the Sitemap line follows SITE_URL."""
    return f'''# robots.txt for {SITE_NAME} — generated by scripts/build_plain_site.py
#
# The ClackOS desktop at / assembles itself in the browser from site.json,
# menu.json and Markdown, so crawlers need assets/ and content/ to render it at
# all: those stay open deliberately. Per-page URLs only exist in the static
# mirror under /plain/, which is what the sitemap lists.
User-agent: *
Allow: /

# Vendored emulators and WebAssembly runtimes are tens of megabytes of payload
# with nothing to index. KiCanvas stays allowed because mirror pages embed it.
Disallow: /vendor/
Allow: /vendor/kicanvas/

# Reader uploads (linked from content where they matter) and the frozen copies
# of the previous websites, which would otherwise read as duplicate content.
Disallow: /assets/uploads/
Disallow: /archive/

Sitemap: {SITE_URL}sitemap.xml
'''

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
    """Build the static Applications menu from the same JSON as ClackOS.

    Entries marked "plain": false are desktop-only — they drive the ClackOS
    shell itself (wallpaper, palette, window contents) and would do nothing
    opened as a standalone page — so the mirror leaves them out.
    """
    out = []
    for item in items:
        kind = item.get('type')
        if item.get('plain') is False:
            continue
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

VIDEO_OPTIONS = {'noloop', 'controls', 'autoplay', 'noautoplay', 'muted'}

def video_embed(block, page_out):
    """An inline video file; see videoEmbed() in assets/js/markdown.js.

    A looping clip autoplays (muted, because that is the only autoplay a
    browser allows); one that plays through once waits to be started."""
    m = re.match(r'^@\[video\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)(?:\{([^}]*)\})?$', block, re.I)
    if not m:
        return None
    opts = set(re.split(r'[\s,]+', (m.group(3) or '').lower().strip()) if m.group(3) else [])
    opts.discard('')
    if opts - VIDEO_OPTIONS:
        return None
    src = fix_url(m.group(1), page_out, allow_fragment=False)
    if not src:
        return None
    loop = 'noloop' not in opts
    autoplay = 'autoplay' in opts or (loop and 'noautoplay' not in opts)
    muted = autoplay or 'muted' in opts
    attributes = ['src="%s"' % esc(src),
                  'aria-label="%s"' % esc(m.group(2) or 'Video'),
                  'preload="%s"' % ('auto' if autoplay else 'metadata'),
                  'playsinline']
    attributes += [name for name, on in (('loop', loop), ('autoplay', autoplay),
                                         ('muted', muted), ('controls', 'controls' in opts)) if on]
    return '<div class="video-embed"><video %s></video></div>' % ' '.join(attributes)

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

MODEL_LIGHTING = ('studio', 'soft', 'dramatic', 'flat', 'unlit')
MODEL_CONTROLS = ('none', 'orbit', 'full')
MODEL_AXIS_ORDERS = ('xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx')
MODEL_ANIMATIONS = ('none', 'turntable', 'swing', 'jump', 'hover', 'tumble', 'rock')
MODEL_FINISHES = ('authored', 'colour', 'clay', 'chrome', 'normals')
MODEL_COLOUR_OPTIONS = {'colour': 'colour', 'color': 'colour', 'grid': 'gridcolour',
                        'key': 'key', 'fill': 'fill', 'sky': 'sky', 'ground': 'ground'}

def is_hex_colour(value):
    return bool(re.match(r'^#(?:[0-9a-f]{3}|[0-9a-f]{6})$', value, re.I))

def model_embed_settings(text):
    """Mirror of modelEmbedSettings() in assets/js/clackos.js.

    Returns None for an unrecognised or out-of-range option so the directive is
    left unrendered rather than quietly ignoring what was asked for.
    """
    settings = {'data': {}, 'classes': [], 'caption': False, 'height': 320, 'width': 0}

    def in_range(value, low, high):
        try:
            number = float(value)
        except ValueError:
            return None
        return number if low <= number <= high else None

    def as_text(number):
        return str(int(number)) if number == int(number) else str(number)

    for token in re.split(r'[\s,]+', (text or '').strip()):
        if not token:
            continue
        name, sep, value = token.partition('=')
        name = name.lower()
        colour_key = MODEL_COLOUR_OPTIONS.get(name) if sep else None
        if colour_key:
            if not is_hex_colour(value):
                return None
            settings['data'][colour_key] = value
            # asking for a grid colour is asking for the grid
            if colour_key == 'gridcolour':
                settings['data']['grid'] = 'true'
            continue
        if name == 'height':
            height = in_range(value, 80, 900)
            if height is None:
                return None
            settings['height'] = as_text(height)
        elif name == 'width':
            width = in_range(value.rstrip('%'), 10, 100)
            if width is None:
                return None
            settings['width'] = as_text(width)
        elif name in ('left', 'right'):
            settings['classes'].append('model-embed-%s' % name)
            if not settings['width']:
                settings['width'] = '42'
        elif name == 'background':
            if value != 'none' and not is_hex_colour(value):
                return None
            settings['data']['background'] = value
        elif name == 'lighting':
            if value not in MODEL_LIGHTING:
                return None
            settings['data']['lighting'] = value
        elif name in ('brightness', 'zoom', 'speed'):
            limits = {'brightness': (20, 400), 'zoom': (0.2, 4), 'speed': (-8, 8)}[name]
            number = in_range(value, *limits)
            if number is None:
                return None
            settings['data'][name] = as_text(number)
        elif name == 'controls':
            if value not in MODEL_CONTROLS:
                return None
            settings['data']['controls'] = value
        elif name == 'axes':
            if value not in MODEL_AXIS_ORDERS:
                return None
            settings['data']['axes'] = value
        elif name == 'animation':
            if value not in MODEL_ANIMATIONS:
                return None
            settings['data']['animation'] = value
        elif name == 'material':
            if value not in MODEL_FINISHES:
                return None
            settings['data']['finish'] = value
        elif name == 'static':
            settings['data']['controls'] = 'none'
        elif name == 'interactive':
            settings['data']['controls'] = 'full'
        elif name in ('grid', 'nogrid'):
            settings['data']['grid'] = str(name == 'grid').lower()
        elif name in ('shadows', 'noshadows'):
            settings['data']['shadows'] = str(name == 'shadows').lower()
        elif name in ('spin', 'nospin'):
            settings['data']['rotate'] = str(name == 'spin').lower()
        elif name == 'wireframe':
            settings['data']['wireframe'] = 'true'
        elif name == 'caption':
            settings['caption'] = True
        elif name == 'border':
            settings['classes'].append('model-embed-bordered')
        else:
            return None
    return settings

def model_embed(block, page_out, state):
    """@[model](part.stl "Caption"){options} -> an inline 3D model placeholder.

    assets/js/model-embed.js turns it into a live viewport built on the same
    three.js core as the 3D Model Viewer app. With scripting off the placeholder
    is a plain link to the model file.
    """
    m = re.match(r'^@\[model\]\((\S+?)(?:\s+["\']([^"\']+)["\'])?\)(?:\{([^}]*)\})?$', block, re.I)
    if not m or not re.search(r'\.(?:stl|step|stp|obj|3mf|glb)(?:[?#].*)?$', m.group(1), re.I):
        return None
    src = fix_url(m.group(1), page_out, allow_fragment=False)
    if not src:
        return None
    settings = model_embed_settings(m.group(3))
    if settings is None:
        return None
    state['model'] = True
    title = m.group(2) or 'Interactive 3D model'
    data = ''.join(' data-%s="%s"' % (name, esc(value))
                   for name, value in settings['data'].items())
    width = ' style="width:%s%%"' % settings['width'] if settings['width'] else ''
    caption = '<figcaption>%s</figcaption>' % esc(title) if settings['caption'] else ''
    return ('<figure class="%s"%s><div class="model-embed-stage" style="height:%spx" role="img" '
            'aria-label="%s" data-model-src="%s"%s>'
            '<a class="model-embed-fallback" href="%s">%s — download the 3D model</a>'
            '</div>%s</figure>'
            % (esc(' '.join(['model-embed'] + settings['classes'])), width,
               esc(settings['height']), esc(title), esc(src), data,
               esc(src), esc(title), caption))

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
def paragraphs_with_fences(block, fences, page_out):
    """Render a paragraph, restoring any fenced code block inside it.

    A fence written without a blank line after it ends up in the same block as
    the prose that follows, which used to leak the raw placeholder (NUL bytes
    and all) into the page. Emit the code where it was written instead.
    """
    out = []
    for i, part in enumerate(re.split(r'\x00fence(\d+)\x00', block)):
        if i % 2:
            out.append(fences[int(part)])
        elif part.strip():
            out.append('<p>%s</p>'
                       % inline(part.strip(), page_out).replace('\n', '<br>'))
    return out

def code_block(info, code, state):
    """A fenced code block, carrying its fence tag through as data-lang.

    The mirror stays static: assets/js/highlight.js resolves the tag (or sniffs
    the code when there is no tag) and colours the block in the browser. With
    scripting off the block is still the plain monospace panel it always was.
    """
    state['code'] = True
    tag = ' data-lang="%s"' % esc(info) if info else ''
    return '<pre class="code"%s>%s</pre>' % (tag, esc(code.rstrip()))

def md_to_html(body, meta, page_out, state):
    fences = []
    body = re.sub(r'```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```',
                  lambda m: fences.append(code_block(m.group(1), m.group(2), state)) or
                  '\x00fence%d\x00' % (len(fences) - 1), body)

    # A heading owns its own line and nothing else; see mdToHtml() in
    # assets/js/markdown.js. Anything written directly under one, with no blank
    # line between, is the next block rather than part of the heading.
    blocks = []
    for block in (b.strip() for b in re.split(r'\r?\n[ \t]*\r?\n', body)):
        if not block:
            continue
        heading = re.match(r'^(#{1,2}[ \t]+[^\r\n]*)\r?\n([\s\S]+)$', block)
        blocks += [heading.group(1), heading.group(2)] if heading else [block]
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
                 or kicanvas_embed(block, page_out, state)
                 or model_embed(block, page_out, state) or build_embed(block))
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
            out.extend(paragraphs_with_fences(block, fences, page_out))
    return '\n'.join(out)

# ---------------------------------------------------------------- pages
STYLE = 'style.css'

HOME_PAGE = 'file/home.md'

def up_link(md_rel, meta, page_out):
    """The link back to the page above this one, matching the desktop's rule.

    `up:` in the frontmatter decides, with `up: none` for a page that is
    already the top; otherwise it is the folder's own page —
    file/euroclack/mini-speaker.md goes up to file/euroclack.md — and the home
    page for everything at the top level.
    """
    declared = meta.get('up', '').strip()
    if declared:
        target = '' if declared == 'none' else declared
    elif md_rel == HOME_PAGE:
        target = ''
    else:
        folder = posixpath.dirname(md_rel)
        target = folder + '.md' if '/' in folder else HOME_PAGE
    if not target or target == md_rel or target not in PAGES:
        return ''
    title = parse_front_matter((content / target).read_text(encoding='utf-8'))[0].get('title', target)
    return '<p class="up-link"><a href="%s">↑ %s</a></p>\n' % (
        esc(rel_href(PAGES[target], page_out)), esc(title))

def render_page(md_rel, page_out):
    meta, body = parse_front_matter((content / md_rel).read_text(encoding='utf-8'))
    state = {'kicanvas': False, 'code': False, 'model': False, 'headings': {}}
    article = up_link(md_rel, meta, page_out) + md_to_html(body, meta, page_out, state)
    style_class = 'page' if meta.get('style') == 'page' else 'plain'
    crawl_meta, noindex = head_meta(md_rel, page_out, meta, body)
    menu = render_menu(md_rel, page_out)
    kicanvas = ('<script type="module" src="%s"></script>\n'
                % esc(resolve_site_url('vendor/kicanvas/kicanvas.js', page_out))
                if state['kicanvas'] else '')
    # Inline 3D models: the import map has to be in the document before any
    # module loads, so it is emitted alongside the embed script itself.
    model = ('<script type="importmap">\n'
             '{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js",'
             '"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/"}}\n'
             '</script>\n<script type="module" src="%s"></script>\n'
             % esc(resolve_site_url('assets/js/model-embed.js', page_out))
             if state['model'] else '')
    # data-auto tells the highlighter to colour this page's code blocks itself
    highlight = ('<script src="%s" data-auto defer></script>\n'
                 % esc(resolve_site_url('assets/js/highlight.js', page_out))
                 if state['code'] else '')
    # Pictures the column shows smaller than the file get a link to the file.
    # That has to be decided in the browser, because it depends on the width the
    # page ends up with; only pages with a picture on them carry the script.
    zoom = ('<script src="%s" data-auto defer></script>\n'
            % esc(resolve_site_url('assets/js/image-zoom.js', page_out))
            if '<img ' in article else '')
    theme = site.get('theme', 'clackos.css')
    css = lambda path: esc(resolve_site_url(path, page_out))
    page = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
{crawl_meta}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Dosis:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{css('assets/css/icons.css')}">
<link rel="stylesheet" href="{css('assets/css/clackos.css')}">
<link rel="stylesheet" href="{css('assets/css/content.css')}">
<link rel="stylesheet" href="{css('assets/themes/' + theme)}">
<link rel="stylesheet" href="{esc(rel_href(STYLE, page_out))}">
{kicanvas}{model}{highlight}{zoom}</head>
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
    return page, noindex

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
  /* 640px column + the .plain/.page side padding, so the menu titles line up
     with the text underneath them */
  max-width: 716px; margin: 0 auto; padding: 0 8px;
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
  /* the panels span the bar rather than sitting under their own title, so they
     hang off the bar itself — #plain-nav has to be the containing block, or
     `top: 100%` measures against the whole page and drops them off-screen */
  #plain-nav { position: relative; }
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
    indexable = []
    for md_rel, page_out in PAGES.items():
        dest = out_root / page_out
        dest.parent.mkdir(parents=True, exist_ok=True)
        page, noindex = render_page(md_rel, page_out)
        dest.write_text(page, encoding='utf-8', newline='\n')
        if not noindex:
            indexable.append((page_url(page_out), post_date(md_rel)))
    (out_root / STYLE).write_text(CSS, encoding='utf-8', newline='\n')
    # robots.txt and sitemap.xml only work from the origin root, so they sit
    # beside index.html rather than in the mirror they describe.
    (root / 'sitemap.xml').write_text(build_sitemap(indexable),
                                      encoding='utf-8', newline='\n')
    (root / 'robots.txt').write_text(build_robots(), encoding='utf-8', newline='\n')
    print(f'wrote {len(PAGES)} pages to {out_root.relative_to(root)}/')
    print(f'wrote sitemap.xml ({len(indexable)} urls) and robots.txt for {SITE_URL}')

if __name__ == '__main__':
    main()
