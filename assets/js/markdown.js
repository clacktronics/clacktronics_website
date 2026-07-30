/* The ClackOS markdown renderer.
 *
 * One renderer serves the desktop (assets/js/clackos.js), which mounts the
 * result in a window, and the Markdown Editor's preview pane, so what an author
 * types is previewed exactly as the site will render it. The static mirror
 * carries its own copy of these rules in scripts/build_plain_site.py, which has
 * to be kept in step by hand.
 *
 * Two behaviours belong to the desktop rather than to markdown — the icon on an
 * app: link and routing an external link into the in-OS browser — so they come
 * in through configure(); without them an app link renders without its icon and
 * external links open in a new tab, which is what a standalone page wants.
 *
 * Paths in markdown are written relative to the site root, because that is
 * where index.html sits. Anything this renderer emits is resolved against the
 * root explicitly, so the same HTML works in a page served from a subfolder —
 * the editor, for one, lives in content/applications/.
 */
(() => {
'use strict';

const ownScript = document.currentScript;
const SITE_ROOT = new URL('../../', ownScript ? ownScript.src : location.href);

const hooks = {
  appIconHTML: () => '',
  webViewerAppId: () => ''
};

function configure(overrides = {}) {
  Object.assign(hooks, overrides);
}

/* Resolve a site-root-relative URL. Absolute URLs, fragments and mailto:/tel:
   are left exactly as they were written. */
function siteUrl(url) {
  const value = String(url || '');
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return value;
  try { return new URL(value, SITE_ROOT).href; } catch { return value; }
}

/* ---------------- Markdown ---------------- */
function parseFrontmatter(text) {
  const meta = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return esc(String(s)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* inline() escapes the full source before parsing it, so only quote characters
 * still need attribute escaping at that stage. */
function escInlineAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeWebUrl(value, allowFragment = true) {
  const url = String(value || '').trim();
  if (allowFragment && url.startsWith('#')) return url;
  if (/^(?:https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^(?:\.\.?\/|\/)?[a-z0-9][^\s:]*$/i.test(url)) return url;
  return '';
}

/* Find a Markdown link destination without treating parentheses inside a URL
 * as the end of the link. This matters for generated links whose query value
 * contains source code (for example OpenSCAD's cylinder(...)). */
function markdownLinks(s, render) {
  const start = /\[([^\]]+)\]\(/g;
  let out = '';
  let copiedTo = 0;
  let match;

  while ((match = start.exec(s))) {
    let depth = 1;
    let end = start.lastIndex;
    for (; end < s.length; end++) {
      if (s[end] === '(') depth++;
      else if (s[end] === ')' && --depth === 0) break;
    }
    if (depth !== 0) break;

    const href = s.slice(start.lastIndex, end);
    if (/\s/.test(href)) continue;
    out += s.slice(copiedTo, match.index) + render(match[1], href);
    copiedTo = end + 1;
    start.lastIndex = copiedTo;
  }

  return out + s.slice(copiedTo);
}

function isMarkdownLink(s) {
  let matched = false;
  const rendered = markdownLinks(s, () => { matched = true; return ''; });
  return matched && rendered === '';
}

/* Inline markdown: `code` -> keyword span, **bold**, *italic*, ![alt](src),
 * [text](href). Links may use window:<md-path> to open a content window,
 * app:<registered-page>?<options> to launch an application, or action:<name>
 * to run a desktop action; anything else is a normal external link. */
function inline(s) {
  s = esc(s);
  /* images become placeholder tokens so the link pass can wrap them */
  const imgs = [];
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    src = siteUrl(safeWebUrl(src, false));
    imgs.push(src ? `<img src="${escInlineAttr(src)}" alt="${escInlineAttr(alt)}" loading="lazy">` : '');
    return `\x00${imgs.length - 1}\x00`;
  });
  s = s.replace(/`([^`]+)`/g, '<span class="k">$1</span>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  s = markdownLinks(s, (text, href) => {
    if (href.startsWith('window:'))
      return `<a href="#" data-action="open:${escInlineAttr(href.slice(7))}">${text.trim()}</a>`;
    if (href.startsWith('app:')) {
      const page = href.slice(4).split(/[?#]/)[0];
      return `<a href="#" class="app-link" data-action="open:${escInlineAttr(href)}">${hooks.appIconHTML(page)}<span>${text.trim()}</span></a>`;
    }
    if (href.startsWith('action:'))
      return `<a href="#" data-action="${escInlineAttr(href.slice(7))}">${text.trim()}</a>`;
    if (href.startsWith('#'))
      return `<a href="${escInlineAttr(href)}" data-anchor="${escInlineAttr(href.slice(1))}">${text.trim()}</a>`;
    const safeHref = safeWebUrl(href, false);
    const appId = hooks.webViewerAppId(safeHref);
    if (appId) return `<a href="#" data-action="open:${escInlineAttr(appId)}">${text.trim()}</a>`;
    return safeHref
      ? `<a href="${escInlineAttr(siteUrl(safeHref))}" target="_blank" rel="noopener noreferrer">${text.trim()}</a>`
      : text.trim();
  });
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => imgs[i]);
  return s;
}

function headingSlug(text) {
  const slug = String(text).replace(/[`*_~\[\]]/g, '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'section';
}

function youtubeEmbed(markdown) {
  const match = /^@\[youtube\]\((\S+?)(?:\s+["']([^"']+)["'])?\)$/i.exec(markdown.trim());
  if (!match) return '';
  let url;
  try { url = new URL(match[1]); } catch { return ''; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
  else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else id = url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return '';
  const title = match[2] || 'YouTube video';
  return `<div class="youtube-embed"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${escAttr(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

/* @[video](clip.mp4 "Caption"){options} — an inline video file.
 *
 * A looping clip is the page's stand-in for an animated GIF, so it starts
 * playing on its own; one that plays through once waits to be started instead.
 * Browsers only honour autoplay on a muted video, so autoplay implies muted —
 * without that the clip silently stays on its first frame, which is not what a
 * looping video is for. `autoplay`/`noautoplay` override the default either way.
 */
const VIDEO_OPTIONS = ['noloop', 'controls', 'autoplay', 'noautoplay', 'muted'];

function videoEmbed(markdown) {
  const match = /^@\[video\]\((\S+?)(?:\s+["']([^"']+)["'])?\)(?:\{([^}]*)\})?$/i.exec(markdown.trim());
  if (!match) return '';
  const src = siteUrl(safeWebUrl(match[1], false));
  if (!src) return '';
  const options = new Set(String(match[3] || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  if ([...options].some(option => !VIDEO_OPTIONS.includes(option))) return '';
  const title = match[2] || 'Video';
  const loop = !options.has('noloop');
  const autoplay = options.has('autoplay') || (loop && !options.has('noautoplay'));
  const muted = autoplay || options.has('muted');
  const attributes = [
    `src="${escAttr(src)}"`,
    `aria-label="${escAttr(title)}"`,
    /* an autoplaying clip is going to be fetched anyway */
    `preload="${autoplay ? 'auto' : 'metadata'}"`,
    'playsinline',
    ...(loop ? ['loop'] : []),
    ...(autoplay ? ['autoplay'] : []),
    ...(muted ? ['muted'] : []),
    ...(options.has('controls') ? ['controls'] : [])
  ].join(' ');
  return `<div class="video-embed"><video ${attributes}></video></div>`;
}

function kicanvasEmbed(markdown) {
  const match = /^@\[kicanvas\]\((\S+?)(?:\s+["']([^"']+)["'])?\)$/i.exec(markdown.trim());
  if (!match) return '';
  const src = siteUrl(safeWebUrl(match[1], false));
  if (!src || !/\.(?:kicad_sch|kicad_pcb|kicad_wks)(?:[?#].*)?$/i.test(src)) return '';
  if (!customElements.get('kicanvas-embed') && !document.getElementById('kicanvas-module')) {
    const script = document.createElement('script');
    script.id = 'kicanvas-module';
    script.type = 'module';
    script.src = new URL('vendor/kicanvas/kicanvas-clackos.js', SITE_ROOT).href;
    document.head.appendChild(script);
  }
  const title = match[2] || 'KiCad design';
  return `<figure class="kicanvas-embed"><kicanvas-embed controls="full" aria-label="${escAttr(title)}"><kicanvas-source src="${escAttr(src)}"></kicanvas-source></kicanvas-embed><figcaption>${esc(title)}</figcaption></figure>`;
}

/* @[model](part.stl "Caption"){options} — an inline 3D model.
 *
 * The directive only writes a placeholder; assets/js/model-embed.js turns it
 * into a viewport built on the same three.js core as the 3D Model Viewer app
 * (assets/js/model-scene.js). Defaults are chosen to sit in the prose rather
 * than to look like a panel: no border, no grid, transparent background, and a
 * slow spin. Every knob the app exposes is available as an option.
 */
const MODEL_LIGHTING = ['studio', 'soft', 'dramatic', 'flat', 'unlit'];

const MODEL_ANIMATIONS = ['none', 'turntable', 'swing', 'jump', 'hover', 'tumble', 'rock'];

const MODEL_FINISHES = ['authored', 'colour', 'clay', 'chrome', 'normals'];

const MODEL_CONTROLS = ['none', 'orbit', 'full'];
const MODEL_AXIS_ORDERS = ['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx'];

const MODEL_COLOUR_OPTIONS = {
  colour: 'colour', color: 'colour', grid: 'gridcolour',
  key: 'key', fill: 'fill', sky: 'sky', ground: 'ground'
};

const isHexColour = value => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

/* Returns null for an unrecognised or out-of-range option, which leaves the
 * directive unrendered rather than silently ignoring what was asked for. */
function modelEmbedSettings(text) {
  const settings = { data: {}, classes: [], caption: false, height: 320, width: 0 };
  const inRange = (value, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  for (const token of String(text || '').trim().split(/[\s,]+/).filter(Boolean)) {
    const split = token.indexOf('=');
    const name = (split < 0 ? token : token.slice(0, split)).toLowerCase();
    const value = split < 0 ? '' : token.slice(split + 1);
    /* a colour option: {colour=#c98a3a}, {grid=#276b47}, {sky=#fff} … */
    const colourKey = split > 0 && MODEL_COLOUR_OPTIONS[name];
    if (colourKey) {
      if (!isHexColour(value)) return null;
      settings.data[colourKey] = value;
      /* asking for a grid colour is asking for the grid */
      if (colourKey === 'gridcolour') settings.data.grid = 'true';
      continue;
    }
    switch (name) {
      case 'height': {
        const height = inRange(value, 80, 900);
        if (height === null) return null;
        settings.height = height;
        break;
      }
      case 'width': {
        const width = inRange(value.replace(/%$/, ''), 10, 100);
        if (width === null) return null;
        settings.width = width;
        break;
      }
      case 'left': case 'right':
        settings.classes.push(`model-embed-${name}`);
        if (!settings.width) settings.width = 42;
        break;
      case 'background':
        if (value !== 'none' && !isHexColour(value)) return null;
        settings.data.background = value;
        break;
      case 'lighting':
        if (!MODEL_LIGHTING.includes(value)) return null;
        settings.data.lighting = value;
        break;
      case 'brightness': {
        const brightness = inRange(value, 20, 400);
        if (brightness === null) return null;
        settings.data.brightness = String(brightness);
        break;
      }
      case 'zoom': {
        const zoom = inRange(value, 0.2, 4);
        if (zoom === null) return null;
        settings.data.zoom = String(zoom);
        break;
      }
      case 'speed': {
        const speed = inRange(value, -8, 8);
        if (speed === null) return null;
        settings.data.speed = String(speed);
        break;
      }
      case 'controls':
        if (!MODEL_CONTROLS.includes(value)) return null;
        settings.data.controls = value;
        break;
      case 'axes':
        if (!MODEL_AXIS_ORDERS.includes(value)) return null;
        settings.data.axes = value;
        break;
      case 'animation':
        if (!MODEL_ANIMATIONS.includes(value)) return null;
        settings.data.animation = value;
        break;
      case 'material':
        if (!MODEL_FINISHES.includes(value)) return null;
        settings.data.finish = value;
        break;
      case 'static': settings.data.controls = 'none'; break;
      case 'interactive': settings.data.controls = 'full'; break;
      case 'grid': settings.data.grid = 'true'; break;
      case 'nogrid': settings.data.grid = 'false'; break;
      case 'shadows': settings.data.shadows = 'true'; break;
      case 'noshadows': settings.data.shadows = 'false'; break;
      case 'wireframe': settings.data.wireframe = 'true'; break;
      /* spin/nospin predate the animation option and stay the short way to
         ask for the default turntable, or for nothing at all. */
      case 'spin': settings.data.rotate = 'true'; break;
      case 'nospin': settings.data.rotate = 'false'; break;
      case 'caption': settings.caption = true; break;
      case 'border': settings.classes.push('model-embed-bordered'); break;
      default: return null;
    }
  }
  return settings;
}

function modelEmbedMarkup(src, title, settings) {
  const data = Object.entries(settings.data)
    .map(([name, value]) => ` data-${name}="${escAttr(value)}"`).join('');
  const caption = settings.caption ? `<figcaption>${esc(title)}</figcaption>` : '';
  /* The fallback link is what a reader with scripting off (or a viewer that
     cannot start WebGL) is left with; the embed script hides it as soon as it
     claims the placeholder. */
  return `<figure class="${['model-embed', ...settings.classes].join(' ')}"`
    + `${settings.width ? ` style="width:${settings.width}%"` : ''}>`
    + `<div class="model-embed-stage" style="height:${settings.height}px" role="img" aria-label="${escAttr(title)}"`
    + ` data-model-src="${escAttr(src)}"${data}>`
    + `<a class="model-embed-fallback" href="${escAttr(src)}">${esc(title)} — download the 3D model</a>`
    + `</div>${caption}</figure>`;
}

function modelEmbed(markdown) {
  const match = /^@\[model\]\((\S+?)(?:\s+["']([^"']+)["'])?\)(?:\{([^}]*)\})?$/i.exec(markdown.trim());
  if (!match) return '';
  const src = siteUrl(safeWebUrl(match[1], false));
  if (!src || !/\.(?:stl|step|stp|obj|3mf|glb)(?:[?#].*)?$/i.test(src)) return '';
  const settings = modelEmbedSettings(match[3]);
  if (!settings) return '';
  if (!document.getElementById('model-embed-module')) {
    const script = document.createElement('script');
    script.id = 'model-embed-module';
    script.type = 'module';
    script.src = new URL('assets/js/model-embed.js', SITE_ROOT).href;
    document.head.appendChild(script);
  }
  return modelEmbedMarkup(src, match[2] || 'Interactive 3D model', settings);
}

/* @[build] renders a placeholder that is filled in after the window mounts
 * with the deployed commit from version.json (see populateBuildStamps). Useful
 * for telling at a glance which build the host is actually serving — handy when
 * a cache is showing stale content. */
function buildEmbed(markdown) {
  if (!/^@\[build\]$/i.test(markdown.trim())) return '';
  return '<p class="build-stamp" data-build-stamp>Build <span class="k">checking…</span></p>';
}

/* version.json is written at deploy time and fetched no-store so it always
 * reflects what the server currently has, even when index.html/clackos.js are
 * themselves cached. Absent on hosts that never ran the deploy (e.g. a raw
 * checkout), in which case the stamp reads "dev". */
let versionInfo;

function siteVersion() {
  if (!versionInfo) {
    versionInfo = fetch(new URL('version.json', SITE_ROOT), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  return versionInfo;
}

function populateBuildStamps(root) {
  const stamps = root.querySelectorAll('[data-build-stamp]');
  if (!stamps.length) return;
  siteVersion().then(v => {
    stamps.forEach(el => {
      el.textContent = '';
      if (v && v.short) {
        el.append('Build ');
        let code = document.createElement('span');
        code.className = 'k';
        code.textContent = v.short;
        if (v.url) {
          const a = document.createElement('a');
          a.href = v.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.appendChild(code);
          code = a;
        }
        el.append(code);
        if (v.builtAt) el.append(' · ' + String(v.builtAt).slice(0, 10));
      } else {
        el.append('Build: dev (unversioned)');
      }
    });
  });
}

/* Raw HTML is useful in hand-authored site content, but it must not turn a
 * Markdown file into a script injection point. Keep structural/content tags,
 * discard active elements, event handlers and unsafe URLs. YouTube iframes are
 * available through the dedicated directive above, not arbitrary raw HTML. */
function sanitizeHtmlBlock(html) {
  const allowed = new Set(('a abbr article aside b blockquote br caption code col colgroup details div em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q s samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul var').split(' '));
  const removeEntirely = new Set(('script style iframe object embed link meta base form input button textarea select option svg math').split(' '));
  const template = document.createElement('template');
  template.innerHTML = html;

  function clean(parent) {
    [...parent.childNodes].forEach(node => {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (removeEntirely.has(tag)) { node.remove(); return; }
      if (!allowed.has(tag)) {
        clean(node);
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        return;
      }
      [...node.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const generallySafe = name === 'id' || name === 'class' || name === 'title' || name === 'role' ||
          name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan' ||
          name.startsWith('aria-') || name.startsWith('data-') && name !== 'data-action' && name !== 'data-anchor';
        const tagSafe = tag === 'img' && ['src', 'alt', 'loading'].includes(name) ||
          tag === 'a' && ['href', 'target', 'rel'].includes(name);
        if (name.startsWith('on') || (!generallySafe && !tagSafe)) node.removeAttribute(attribute.name);
      });
      if (tag === 'img') {
        const src = safeWebUrl(node.getAttribute('src'), false);
        if (!src) { node.remove(); return; }
        node.setAttribute('src', siteUrl(src));
        node.setAttribute('loading', 'lazy');
      }
      if (tag === 'a') {
        const href = safeWebUrl(node.getAttribute('href'));
        if (!href) node.removeAttribute('href');
        else if (href.startsWith('#')) {
          node.removeAttribute('target');
          node.setAttribute('data-anchor', href.slice(1));
        } else if (hooks.webViewerAppId(href)) {
          node.setAttribute('href', '#');
          node.setAttribute('data-action', `open:${hooks.webViewerAppId(href)}`);
          node.removeAttribute('target');
          node.removeAttribute('rel');
        } else {
          node.setAttribute('href', siteUrl(href));
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
      clean(node);
    });
  }
  clean(template.content);
  return template.innerHTML;
}

/* A fenced code block, coloured by assets/js/highlight.js. The fence's info
 * string picks the language; without one the highlighter sniffs the code and
 * leaves it plain when it is prose or program output rather than source. */
function codeBlock(code, info) {
  const highlighter = window.ClackHighlight;
  const language = highlighter ? highlighter.resolve(info, code) : '';
  const attribute = language ? ` data-lang="${escAttr(language)}"` : '';
  const inner = language ? highlighter.highlight(code, language) : esc(code);
  return `<pre class="code"${attribute}>${inner}</pre>`;
}

/* `prefix` is HTML placed inside the content wrapper, above the page: the
 * link back up to the page a window sits under. */
function mdToHtml(body, meta, prefix = '') {
  /* lift fenced code blocks out before splitting on blank lines */
  const fences = [];
  body = body.replace(/```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_, info, code) => {
    fences.push(codeBlock(code.replace(/\s+$/, ''), info));
    return `\x00fence${fences.length - 1}\x00`;
  });

  /* A heading owns its own line and nothing else. Without the split, a line
     written directly under a `#`/`##` with no blank line between them lands in
     the same block and is swallowed by the heading — a whole paragraph coming
     out as a green eyebrow label. Splitting here rather than in the heading
     branch means what follows still goes through the full set of rules, so a
     list tucked under a heading is a list. */
  const blocks = body.split(/\r?\n[ \t]*\r?\n/).map(b => b.trim()).filter(Boolean)
    .flatMap(block => {
      const heading = /^(#{1,2}[ \t]+[^\r\n]*)\r?\n([\s\S]+)$/.exec(block);
      return heading ? [heading[1], heading[2]] : [block];
    });
  const out = [];
  let footerNext = false;
  const headingIds = new Map();
  const uniqueHeadingId = text => {
    const base = headingSlug(text);
    const count = (headingIds.get(base) || 0) + 1;
    headingIds.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  blocks.forEach((block, idx) => {
    const isLast = idx === blocks.length - 1;

    if (footerNext && isLast) {
      const spans = block.split(/\r?\n/).map(l => `<span>${inline(l)}</span>`).join('\n');
      out.push(`<footer>${spans}</footer>`);
      return;
    }
    footerNext = false;

    const fence = /^\x00fence(\d+)\x00$/.exec(block);
    const youtube = youtubeEmbed(block);
    const video = videoEmbed(block);
    const kicanvas = kicanvasEmbed(block);
    const model = modelEmbed(block);
    const build = buildEmbed(block);
    if (fence) {
      out.push(fences[+fence[1]]);
    } else if (youtube) {
      out.push(youtube);
    } else if (video) {
      out.push(video);
    } else if (kicanvas) {
      out.push(kicanvas);
    } else if (model) {
      out.push(model);
    } else if (build) {
      out.push(build);
    } else if (/^<[/!A-Za-z][\s\S]*>$/m.test(block)) {
      out.push(`<div class="html-block">${sanitizeHtmlBlock(block)}</div>`);
    } else if (/^>\s?/.test(block)) {
      out.push(`<blockquote>${inline(block.replace(/^>\s?/gm, '')).replace(/\r?\n/g, '<br>')}</blockquote>`);
    } else if (/^##\s+/.test(block)) {
      const heading = block.replace(/^##\s+/, '');
      out.push(`<p class="eyebrow" id="${uniqueHeadingId(heading)}">${inline(heading)}</p>`);
    } else if (/^#\s+/.test(block)) {
      const heading = block.replace(/^#\s+/, '');
      out.push(`<h1 id="${uniqueHeadingId(heading)}">${inline(heading)}</h1>`);
      if (meta.tagline) {
        out.push(`<p class="tagline">${esc(meta.tagline)}</p>`);
        out.push('<div class="rule"></div>');
      }
    } else if (/^-{3,}$/.test(block)) {
      /* an hr right before the final block introduces the window footer */
      if (idx === blocks.length - 2) footerNext = true;
      else out.push('<div class="rule"></div>');
    } else if (/^\d+\.\s/.test(block)) {
      const items = block.split(/\r?\n(?=\d+\.\s)/).map(item =>
        `<li><p>${inline(item.replace(/^\d+\.\s+/, '').replace(/\r?\n/g, ' '))}</p></li>`);
      out.push(`<ol class="list">${items.join('')}</ol>`);
    } else if (/^[-*]\s/.test(block)) {
      const items = block.split(/\r?\n(?=[-*]\s)/).map(item =>
        `<li><p>${inline(item.replace(/^[-*]\s+/, '').replace(/\r?\n/g, ' '))}</p></li>`);
      out.push(`<ul class="list">${items.join('')}</ul>`);
    } else if (block.split(/\r?\n/).every(l => isMarkdownLink(l.trim()))) {
      /* a block made only of links becomes the call-to-action button row;
       * the first button is solid, the rest are ghosts */
      const btns = block.split(/\r?\n/).map((l, i) =>
        inline(l.trim()).replace('<a ', `<a class="btn ${i === 0 ? 'primary' : 'ghost'}" `));
      out.push(`<div class="ctas">${btns.join('')}</div>`);
    } else {
      out.push(`<p>${inline(block).replace(/\r?\n/g, '<br>')}</p>`);
    }
  });

  const style = meta.style === 'page' ? 'page' : 'plain';
  return `<div class="${style}">${prefix}${out.join('\n')}</div>`;
}

window.ClackMarkdown = {
  configure,
  render: mdToHtml,
  parseFrontmatter,
  populateBuildStamps,
  esc, escAttr, escInlineAttr, safeWebUrl, siteUrl, siteVersion,
  headingSlug, isMarkdownLink, markdownLinks
};
})();
