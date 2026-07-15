#!/usr/bin/env python3
"""Regenerate content/file/blog.md from the posts in content/file/blog/.

Run this after adding a post. Posts are named YYYY-MM-DD-slug.md and need a
`title:` line in their frontmatter; the index lists them newest first,
grouped by year.
"""
import datetime
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
blog = root / 'content' / 'file' / 'blog'

posts = []
for f in sorted(blog.glob('*.md'), reverse=True):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})-', f.name)
    if not m:
        continue
    date = datetime.date(*map(int, m.groups()))
    title = re.search(r'^title:\s*(.+)$', f.read_text(), re.M).group(1).strip()
    posts.append((date, title, f.name))

frontmatter = '\n'.join([
    '---',
    'title: Blog',
    f'tagline: {len(posts)} posts from the workbench',
    'width: 560',
    'height: 560',
    'style: plain',
    '---',
])
lines = ['# Blog']
year = None
group = []
for date, title, name in posts:
    if date.year != year:
        if group:
            lines.append('\n'.join(group))
            group = []
        year = date.year
        lines.append(f'## {year}')
    # square brackets in a title would break the markdown link syntax
    safe = title.replace('[', '(').replace(']', ')')
    group.append(f"`{date.strftime('%d %b')}` [{safe}](window:file/blog/{name})")
if group:
    lines.append('\n'.join(group))

(root / 'content' / 'file' / 'blog.md').write_text(
    frontmatter + '\n' + '\n\n'.join(lines) + '\n')
print(f'blog.md: indexed {len(posts)} posts')
