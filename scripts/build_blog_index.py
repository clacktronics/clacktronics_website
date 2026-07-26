#!/usr/bin/env python3
"""Regenerate the blog windows from the posts in content/file/blog/.

Run this after adding a post. Posts are named YYYY-MM-DD-slug.md and need a
`title:` line in their frontmatter. Two things come out of them:

  content/file/blog-list.md      every post, newest first, grouped by year,
                                 ending with a link to blog-template.md
  content/file/blog.md           the blog itself: the newest POSTS_PER_PAGE
  content/file/blog-page-N.md    posts in full, then the next five, and so on

Each blog page carries a Newer/Older button row and a link back to the list,
so the whole archive can be read by paging through it. Adding a post and
re-running this is all it takes — the pages are rebuilt from scratch and any
page that the new count no longer needs is deleted.
"""
import datetime
import pathlib
import re

POSTS_PER_PAGE = 5

root = pathlib.Path(__file__).resolve().parent.parent
file_dir = root / 'content' / 'file'
blog = file_dir / 'blog'

LIST_MD = 'blog-list.md'
TEMPLATE_MD = 'blog-template.md'


def page_md(number):
    """Filename of page `number` (1-based); page one is the blog window."""
    return 'blog.md' if number == 1 else f'blog-page-{number}.md'


def front_matter(**fields):
    return '\n'.join(['---', *(f'{k}: {v}' for k, v in fields.items()), '---'])


def split_post(text):
    """(frontmatter dict, body) of a post file."""
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


def demote_headings(body):
    """Make room for the post title above the post's own headings.

    The markdown dialect has exactly two heading levels — `#` (the window
    title) and `##` (a section heading) — and nothing below them, so a post's
    `##` sections become bold lines rather than a level that does not render.
    Fenced code blocks are left alone: a `#` there is a comment.
    """
    out = []
    fence = None
    for line in body.splitlines():
        opener = re.match(r'^\s*(```+|~~~+)', line)
        if fence:
            if opener and opener.group(1)[0] == fence[0] and len(opener.group(1)) >= len(fence):
                fence = None
        elif opener:
            fence = opener.group(1)
        else:
            heading = re.match(r'^#{1,6}\s+(.*?)\s*#*\s*$', line)
            if heading:
                line = f'**{heading.group(1)}**'
        out.append(line)
    return '\n'.join(out)


def post_body(path):
    """A post's body, ready to concatenate: no frontmatter, no leading h1."""
    body = split_post(path.read_text())[1]
    # the opening h1 repeats the title, which the page prints with its date
    body = re.sub(r'^#\s+.*(\r?\n)+', '', body, count=1)
    return demote_headings(body).strip()


# ---------------------------------------------------------------- collect
posts = []
for f in sorted(blog.glob('*.md'), reverse=True):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})-', f.name)
    if not m:
        continue
    date = datetime.date(*map(int, m.groups()))
    title = re.search(r'^title:\s*(.+)$', f.read_text(), re.M).group(1).strip()
    posts.append((date, title, f))

# square brackets in a title would break the markdown link syntax
safe_title = lambda t: t.replace('[', '(').replace(']', ')')

# ---------------------------------------------------------------- the list
lines = ['# Blog List', f'[Read the blog](window:file/{page_md(1)})']
year = None
group = []
for date, title, f in posts:
    if date.year != year:
        if group:
            lines.append('\n'.join(group))
            group = []
        year = date.year
        lines.append(f'## {year}')
    group.append(f"`{date.strftime('%d %b')}` [{safe_title(title)}](window:file/blog/{f.name})")
if group:
    lines.append('\n'.join(group))

# a quiet last line pointing at the template for the next post. The text
# around the link keeps it a paragraph — a block of nothing but links is
# rendered as the button row, which would be anything but quiet.
lines.append(f'*Writing the next one? Start from the '
             f'[post template](window:file/{TEMPLATE_MD}).*')

(file_dir / LIST_MD).write_text(front_matter(
    title='Blog List',
    tagline=f'Every one of the {len(posts)} posts from the workbench',
    style='plain',
) + '\n' + '\n\n'.join(lines) + '\n')

# ---------------------------------------------------------------- the blog
pages = [posts[i:i + POSTS_PER_PAGE] for i in range(0, len(posts), POSTS_PER_PAGE)] or [[]]
written = set()

for index, page in enumerate(pages, start=1):
    total = len(pages)
    nav = [f'[Blog list](window:file/{LIST_MD})']
    if index > 1:
        nav.append(f'[< Newer posts](window:file/{page_md(index - 1)})')
    if index < total:
        nav.append(f'[Older posts >](window:file/{page_md(index + 1)})')
    counter = f'Page {index} of {total}'

    blocks = ['# Blog', '\n'.join(nav), counter]
    for date, title, f in page:
        blocks.append('---')
        blocks.append(f'## {safe_title(title)}')
        blocks.append(f"`{date.strftime('%d %B %Y')}` · "
                      f'[Open this post on its own](window:file/blog/{f.name})')
        body = post_body(f)
        if body:
            blocks.append(body)
    # the counter sits between the rule and the buttons on purpose: the
    # renderer turns the last block into a window footer when a rule comes
    # directly before it, and these are buttons, not a footer.
    blocks += ['---', counter, '\n'.join(nav)]

    first = index * POSTS_PER_PAGE - POSTS_PER_PAGE + 1
    (file_dir / page_md(index)).write_text(front_matter(
        title='Blog' if index == 1 else f'Blog (page {index})',
        tagline=f'Posts {first}–{first + len(page) - 1} of {len(posts)}'
                if page else 'No posts yet',
        style='plain',
        # the posts are also pages of their own, so only the newest five are
        # offered to search engines; the rest would be duplicates
        **({} if index == 1 else {'robots': 'noindex'}),
    ) + '\n' + '\n\n'.join(blocks) + '\n')
    written.add(page_md(index))

for stale in file_dir.glob('blog-page-*.md'):
    if stale.name not in written:
        stale.unlink()
        print(f'removed {stale.name}')

print(f'{LIST_MD}: indexed {len(posts)} posts')
print(f'blog: {len(pages)} page(s) of {POSTS_PER_PAGE}')
