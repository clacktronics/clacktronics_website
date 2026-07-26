---
title: New Post Template
tagline: The starting point for a new blog post
style: plain
up: file/blog-list.md
robots: noindex
---
# New Post Template

Copy the block below into a new file in `content/file/blog/`, named
`YYYY-MM-DD-slug.md`. The date in the filename is the date the post is
published and the order it appears in — nothing else reads it.

```markdown
---
title: The title of the post
tagline: 27 June 2024
style: plain
---
# The title of the post

![alt text](https://clacktronics.co.uk/assets/picture.jpg)

The first paragraph. This one gets used as the search snippet if there is
no `description:` in the frontmatter, so it is worth writing it as a
summary of the post rather than a warm-up.

## A section

More words. `Inline code` for part numbers and values, **bold**, *italic*,
a [link out](https://example.com) and a [link to another window](window:file/euroclack.md).

@[video](https://clacktronics.co.uk/assets/clip.mp4 "Optional title")

> A quote, if there is one.
```

## Things worth knowing

- The `# heading` at the top repeats the title. The blog pages strip it and
  print the title with the date instead, so leave it in — the post reads
  correctly on its own page.
- Images live on the web host, not in the repository: point at
  `https://clacktronics.co.uk/assets/…` and link the file there.
- `## sections` become bold lines when the post is shown on a blog page,
  because the blog page's own headings are already using that level.
- A paragraph made of nothing but links turns into a row of buttons, which
  is usually not what a post wants mid-sentence.

## Then rebuild the blog

```sh
python3 scripts/build_blog_index.py
```

That rewrites [the blog](window:file/blog.md) and [the blog list](window:file/blog-list.md)
from the posts alone. Pushing the post runs the same script in CI, so this
is only needed to see the result before committing.
