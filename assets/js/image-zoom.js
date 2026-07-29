/* ClackOS image zoom — "there is more of this picture than you are being shown".
 *
 * A markdown image is drawn at the width of the text column, which for most
 * photographs and screenshots is a long way short of the file itself. This
 * script compares the two after layout and, only when the file really does hold
 * more than the page is showing, wraps the image in a link to the file that
 * opens in a new browser window. A picture that already fits — a diagram drawn
 * at its natural size, a small icon, a tile — is left exactly as the markdown
 * produced it: no link, no pointer change, no badge.
 *
 * The comparison is repeated whenever an image changes size, because the
 * container it sits in is not fixed: a ClackOS window is resizable and the plain
 * mirror is a responsive column, so widening either one until the picture is
 * shown whole takes the link away again.
 *
 * Two kinds of image are left alone, because both are already the author's own
 * arrangement rather than the renderer's: one linked by hand
 * (`[![thumb](small.png)](big.png)`), and one written inside a raw HTML block,
 * where the surrounding markup — a figure, a caption, a picture placed in a
 * diagram — decides how big the picture is meant to be and a wrapper of ours
 * would be in the way.
 *
 * Usage:
 *   ClackImageZoom.enhance(root)  -> watch every markdown image under root
 *
 * A <script data-auto> tag watches the whole document once it has loaded, which
 * is all the static pages of the plain HTML mirror need.
 */
(() => {
'use strict';

/* How much bigger the file has to be before the link is worth offering: half as
 * wide again, and at least 64 CSS pixels. Under that the "full size" view is
 * near enough the same picture a second time. */
const ZOOM_RATIO = 1.5;
const ZOOM_GAIN = 64;

/* The images the markdown renderer produces from `![alt](src)`, in a window or
 * on a plain page. Raw HTML blocks (.html-block) are the author's own layout
 * and are excluded in watch() below. */
const SELECTOR = '.page img, .plain img';

const watched = new WeakSet();

/* The file to open, or '' for an image there is no point opening: a data: or
 * blob: source (browsers refuse to navigate to one anyway) and vector art,
 * which has no "full size" — an SVG is already drawn at whatever size it is
 * given. */
function zoomTarget(img) {
  const url = img.currentSrc || img.src || '';
  if (!/^https?:/i.test(url)) return '';
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return ''; }
  if (/\.svgz?$/i.test(pathname)) return '';
  return url;
}

/* Our own wrapper, if this image is currently in one. */
function zoomLink(img) {
  const parent = img.parentElement;
  return parent && parent.classList.contains('image-zoom') ? parent : null;
}

/* A picture that belongs to something the author wrote: a link of their own, or
 * a raw HTML block that arranges it. */
function authorsOwn(img) {
  const anchor = img.closest('a');
  return (!!anchor && !anchor.classList.contains('image-zoom')) || !!img.closest('.html-block');
}

function wrap(img) {
  const href = zoomTarget(img);
  if (!href) return;
  const size = `${img.naturalWidth} × ${img.naturalHeight}`;
  const link = document.createElement('a');
  link.className = 'image-zoom';
  link.href = href;
  /* A real new browser window, not the in-OS one: the desktop's link routing
   * (bindWebLinkRouting in clackos.js) treats target="_blank" as an explicit
   * opt-out, so this behaves the same on the desktop and in the mirror. */
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `Open full size — ${size}`;
  /* The link, not the image, is what a screen reader announces here, and a
   * decorative image has no alt text to name it with. */
  link.setAttribute('aria-label',
    `${img.alt || 'Image'} — open full size (${size}) in a new window`);
  img.replaceWith(link);
  link.appendChild(img);
}

function unwrap(link) {
  const img = link.querySelector('img');
  if (img) link.replaceWith(img);
}

function update(img) {
  /* The Markdown Editor rebuilds its preview on every keystroke, so images do
   * get thrown away under us: stop watching one that is no longer in the page. */
  if (!img.isConnected) {
    if (sizeWatch) sizeWatch.unobserve(img);
    return;
  }
  const shown = img.getBoundingClientRect().width;
  /* Nothing to compare yet: the image has not loaded, or it is in a minimised
   * window or a hidden preview pane and has no layout at all. Whatever was
   * decided last time stands until it does. */
  if (!img.naturalWidth || !shown) return;
  const bigger = img.naturalWidth >= shown * ZOOM_RATIO &&
    img.naturalWidth - shown >= ZOOM_GAIN;
  const link = zoomLink(img);
  if (bigger === !!link) return;
  if (bigger) wrap(img);
  else unwrap(link);
}

/* Wrapping does not change the width of the image, so this settles in one pass
 * rather than feeding itself. */
const sizeWatch = typeof ResizeObserver === 'function'
  ? new ResizeObserver(entries => entries.forEach(entry => update(entry.target)))
  : null;

function watch(img) {
  if (watched.has(img) || authorsOwn(img) || !zoomTarget(img)) return;
  watched.add(img);
  /* Images are lazily loaded, so the natural size usually arrives later. */
  img.addEventListener('load', () => update(img));
  if (sizeWatch) sizeWatch.observe(img);   /* observing measures it right away */
  else if (img.complete) update(img);
}

function enhance(root) {
  (root || document).querySelectorAll(SELECTOR).forEach(watch);
}

window.ClackImageZoom = { enhance };

/* The plain HTML mirror is static: watch its pictures once the page is up. */
if (document.currentScript && document.currentScript.hasAttribute('data-auto')) {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => enhance(document));
  else
    enhance(document);
}
})();
