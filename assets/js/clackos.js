/* ClackOS — template/engine only.
 * All content lives in content/<menu>/*.md, all menu structure in
 * content/<menu>/menu.json, and the menu order in content/site.json. */
(() => {
const desktop = document.getElementById('desktop');
const tasksEl = document.getElementById('tasks');
const menubar = document.getElementById('menubar');
let zTop = 10;

/* ---------------- Themes ----------------
 * A theme is a small CSS file in assets/themes/. The base styles contain
 * resilient defaults; the selected file only overrides colour variables. */
const THEME_VARS = [
  '--ink', '--heading', '--ink-soft', '--control-text', '--strong-text', '--shadow',
  '--paper', '--paper-deep', '--paper-line', '--sage',
  '--leaf', '--leaf-deep', '--menu-text', '--menu-dim', '--desktop',
  '--titlebar', '--window-border', '--window-inactive', '--window-border-inactive',
  '--title-text', '--accent-hover', '--button-text',
  '--disabled-text'
];
/* Colours are hex; the two drop-shadow controls are a length and a percentage. */
const THEME_UNIT_VARS = { '--shadow-distance': /^\d{1,2}(\.\d+)?px$/, '--shadow-alpha': /^\d{1,3}(\.\d+)?%$/ };
let activeTheme = 'clackos.css';
let themePreview = null;
let availableThemes = new Set(['clackos.css']);
const observedThemeFrames = new WeakSet();
const THEME_KEY = 'clackos-theme';
const THEME_COOKIE = 'clackos-theme-default';
/* GitHub "owner/repo" for the Report bug action; overridden from site.json at boot. */
let siteRepo = 'clacktronics/clacktronics_website';

function readCookie(name) {
  const prefix = encodeURIComponent(name) + '=';
  const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return null; }
}

function safeThemeName(name) {
  name = String(name || '');
  return /^[a-z0-9][a-z0-9._-]*\.css$/i.test(name) ? name : 'clackos.css';
}

function themeHref(name) {
  return new URL(`assets/themes/${encodeURIComponent(safeThemeName(name))}`, location.href).href;
}

function setPreviewOnDocument(doc, variables) {
  if (!doc?.documentElement) return;
  for (const name of THEME_VARS) {
    if (variables && /^#[0-9a-f]{6}$/i.test(variables[name] || ''))
      doc.documentElement.style.setProperty(name, variables[name]);
    else
      doc.documentElement.style.removeProperty(name);
  }
  for (const [name, pattern] of Object.entries(THEME_UNIT_VARS)) {
    if (variables && pattern.test(String(variables[name] || '').trim()))
      doc.documentElement.style.setProperty(name, String(variables[name]).trim());
    else
      doc.documentElement.style.removeProperty(name);
  }
}

function revealThemedFrame(frame, link) {
  const reveal = () => frame.classList.remove('theme-loading');
  if (link.sheet) reveal();
  else {
    link.addEventListener('load', reveal, { once: true });
    link.addEventListener('error', reveal, { once: true });
  }
}

function themeVariablesForDocument(doc) {
  const styles = doc.defaultView.getComputedStyle(doc.documentElement);
  return Object.fromEntries([...THEME_VARS, ...Object.keys(THEME_UNIT_VARS)]
    .map(name => [name, styles.getPropertyValue(name).trim()]));
}

function dispatchThemeChange(doc) {
  try {
    const variables = themeVariablesForDocument(doc);
    const paper = variables['--paper'];
    const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(paper);
    const luminance = rgb
      ? (0.2126 * parseInt(rgb[1], 16) + 0.7152 * parseInt(rgb[2], 16) + 0.0722 * parseInt(rgb[3], 16)) / 255
      : 1;
    doc.documentElement.dataset.theme = activeTheme.replace(/\.css$/i, '');
    doc.documentElement.dataset.themeTone = luminance < 0.45 ? 'dark' : 'light';
    doc.defaultView?.dispatchEvent(new doc.defaultView.CustomEvent('clackos-themechange', {
      detail: { theme: activeTheme, variables }
    }));
  } catch {}
}

function observeThemeFrame(frame) {
  if (observedThemeFrames.has(frame)) return;
  observedThemeFrames.add(frame);
  frame.addEventListener('load', () => applyThemeToFrame(frame));
}

function applyThemeToFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc?.head) return;
    observeThemeFrame(frame);
    let link = doc.getElementById('clackos-theme');
    if (!link) {
      link = doc.createElement('link');
      link.id = 'clackos-theme';
      link.rel = 'stylesheet';
      doc.head.appendChild(link);
    }
    const href = themeHref(activeTheme);
    const finish = () => {
      setPreviewOnDocument(doc, themePreview);
      dispatchThemeChange(doc);
      doc.querySelectorAll('iframe').forEach(nestedFrame => {
        observeThemeFrame(nestedFrame);
        applyThemeToFrame(nestedFrame);
      });
      revealThemedFrame(frame, link);
    };
    if (link.href === href && link.sheet) finish();
    else {
      link.addEventListener('load', finish, { once: true });
      link.addEventListener('error', finish, { once: true });
      if (link.href !== href) link.href = href;
    }
  } catch {}
}

function applyTheme(name) {
  activeTheme = safeThemeName(name);
  const link = document.getElementById('clackos-theme');
  if (link) {
    const href = themeHref(activeTheme);
    const finish = () => {
      syncBrowserThemeColor();
      dispatchThemeChange(document);
      document.documentElement.classList.remove('theme-pending');
    };
    if (link.href === href && link.sheet) finish();
    else {
      link.addEventListener('load', finish, { once: true });
      link.addEventListener('error', finish, { once: true });
      link.href = href;
    }
  }
  document.documentElement.dataset.theme = activeTheme.replace(/\.css$/i, '');
  document.querySelectorAll('iframe.appframe').forEach(applyThemeToFrame);
}

function applyThemePreview(variables) {
  themePreview = variables && typeof variables === 'object' ? variables : null;
  setPreviewOnDocument(document, themePreview);
  dispatchThemeChange(document);
  document.querySelectorAll('iframe.appframe').forEach(applyThemeToFrame);
  syncBrowserThemeColor();
}

function syncBrowserThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  if (meta && ink) meta.content = ink;
}

/* ---------------- Content loading ---------------- */
const contentCache = new Map();   // md path -> { meta, html }
const windowTitles = new Map();   // md path -> title (for the taskbar)

/* GitHub Pages and other static hosts may cache JSON and Markdown longer than
 * the HTML shell. A unique query plus no-store prevents a new shell from being
 * paired with an older menu or document after a deployment. */
function fetchFresh(path) {
  const url = new URL(path, location.href);
  url.searchParams.set('_clack', Date.now());
  return fetch(url, { cache: 'no-store' });
}

async function loadJSON(path) {
  const res = await fetchFresh(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadContent(id) {
  if (contentCache.has(id)) return contentCache.get(id);
  const res = await fetchFresh('content/' + id);
  if (!res.ok) throw new Error(`Failed to load content/${id}: ${res.status}`);
  const { meta, body } = parseFrontmatter(await res.text());
  const rec = { meta, html: mdToHtml(body, meta) };
  contentCache.set(id, rec);
  windowTitles.set(id, meta.title || id);
  return rec;
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

/* Hosts allowed to open inside the in-OS browser / PDF reader, loaded from
 * content/link-whitelist.json at boot. Local (same-origin) links are always
 * allowed; everything else opens in a real new tab so a site that refuses to be
 * framed (X-Frame-Options / CSP) can't leave a blank window on the desktop. */
let linkWhitelist = [];

async function loadLinkWhitelist() {
  try {
    const data = await loadJSON('content/link-whitelist.json');
    const hosts = Array.isArray(data) ? data : (data.hosts || []);
    linkWhitelist = hosts
      .filter(host => typeof host === 'string')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    linkWhitelist = [];
  }
}

/* A URL may be shown inside the OS when it is same-origin as this site or when
 * its host (or a parent domain) is on the whitelist. */
function canEmbedUrl(safe) {
  let url;
  try { url = new URL(safe, location.href); } catch { return false; }
  if (url.origin === location.origin) return true;
  const host = url.hostname.toLowerCase();
  return linkWhitelist.some(entry => host === entry || host.endsWith('.' + entry));
}

function webViewerAppId(value) {
  const safe = safeWebUrl(value, false);
  if (!/^https?:/i.test(safe)) return '';
  if (!canEmbedUrl(safe)) return '';
  let pathname;
  try { pathname = new URL(safe).pathname; } catch { return ''; }
  const isPdf = /\.pdf$/i.test(pathname);
  const page = isPdf ? 'pdf-reader/index.html?file=' : 'browser.html?url=';
  return `app:applications/${page}${encodeURIComponent(safe)}`;
}

function bindWebLinkRouting(root) {
  root.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.dataset.action || anchor.hasAttribute('download')) return;
    /* target="_blank" is an explicit opt-out of in-OS routing (e.g. the
     * taskbar's Plain HTML link) — let the browser open a real new tab */
    if (anchor.target === '_blank') return;
    const safe = safeWebUrl(anchor.href, false);
    if (!/^https?:/i.test(safe)) return;   /* mailto:, tel:, fragments — leave alone */
    const appId = webViewerAppId(safe);
    if (appId) { event.preventDefault(); openWindow(appId); return; }
    /* Not local and not whitelisted: open in a real new tab rather than the
     * in-OS viewer, so a site that blocks framing never leaves a blank window. */
    event.preventDefault();
    window.open(safe, '_blank', 'noopener');
  }, true);
}

function safeIconName(name) {
  name = String(name || '');
  return /^[a-z0-9][a-z0-9-]*$/.test(name) ? name : '';
}

function iconHTML(name, extraClass = '') {
  name = safeIconName(name);
  return name
    ? `<span class="pixel-icon ${extraClass}" data-icon="${name}" aria-hidden="true"></span>`
    : '';
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
    src = safeWebUrl(src, false);
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
      const icon = appDefs.get(page)?.icon || 'app-windows';
      return `<a href="#" class="app-link" data-action="open:${escInlineAttr(href)}">${iconHTML(icon)}<span>${text.trim()}</span></a>`;
    }
    if (href.startsWith('action:'))
      return `<a href="#" data-action="${escInlineAttr(href.slice(7))}">${text.trim()}</a>`;
    if (href.startsWith('#'))
      return `<a href="${escInlineAttr(href)}" data-anchor="${escInlineAttr(href.slice(1))}">${text.trim()}</a>`;
    const safeHref = safeWebUrl(href, false);
    const appId = webViewerAppId(safeHref);
    if (appId) return `<a href="#" data-action="open:${escInlineAttr(appId)}">${text.trim()}</a>`;
    return safeHref
      ? `<a href="${escInlineAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${text.trim()}</a>`
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

function videoEmbed(markdown) {
  const match = /^@\[video\]\((\S+?)(?:\s+["']([^"']+)["'])?\)(?:\{([^}]*)\})?$/i.exec(markdown.trim());
  if (!match) return '';
  const src = safeWebUrl(match[1], false);
  if (!src) return '';
  const options = new Set(String(match[3] || '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  if ([...options].some(option => !['noloop', 'controls'].includes(option))) return '';
  const title = match[2] || 'Video';
  return `<div class="video-embed"><video src="${escAttr(src)}" aria-label="${escAttr(title)}" preload="metadata" playsinline${options.has('controls') ? ' controls' : ''}${options.has('noloop') ? '' : ' loop'}></video></div>`;
}

function kicanvasEmbed(markdown) {
  const match = /^@\[kicanvas\]\((\S+?)(?:\s+["']([^"']+)["'])?\)$/i.exec(markdown.trim());
  if (!match) return '';
  const src = safeWebUrl(match[1], false);
  if (!src || !/\.(?:kicad_sch|kicad_pcb|kicad_wks)(?:[?#].*)?$/i.test(src)) return '';
  if (!customElements.get('kicanvas-embed') && !document.getElementById('kicanvas-module')) {
    const script = document.createElement('script');
    script.id = 'kicanvas-module';
    script.type = 'module';
    script.src = new URL('vendor/kicanvas/kicanvas-clackos.js', location.href).href;
    document.head.appendChild(script);
  }
  const title = match[2] || 'KiCad design';
  return `<figure class="kicanvas-embed"><kicanvas-embed controls="full" aria-label="${escAttr(title)}"><kicanvas-source src="${escAttr(src)}"></kicanvas-source></kicanvas-embed><figcaption>${esc(title)}</figcaption></figure>`;
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
    versionInfo = fetch(new URL('version.json', location.href), { cache: 'no-store' })
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
        node.setAttribute('src', src);
        node.setAttribute('loading', 'lazy');
      }
      if (tag === 'a') {
        const href = safeWebUrl(node.getAttribute('href'));
        if (!href) node.removeAttribute('href');
        else if (href.startsWith('#')) {
          node.removeAttribute('target');
          node.setAttribute('data-anchor', href.slice(1));
        } else if (webViewerAppId(href)) {
          node.setAttribute('href', '#');
          node.setAttribute('data-action', `open:${webViewerAppId(href)}`);
          node.removeAttribute('target');
          node.removeAttribute('rel');
        } else {
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

function mdToHtml(body, meta) {
  /* lift fenced code blocks out before splitting on blank lines */
  const fences = [];
  body = body.replace(/```\w*\r?\n([\s\S]*?)```/g, (_, code) => {
    fences.push(`<pre class="code">${esc(code.replace(/\s+$/, ''))}</pre>`);
    return `\x00fence${fences.length - 1}\x00`;
  });

  const blocks = body.split(/\r?\n[ \t]*\r?\n/).map(b => b.trim()).filter(Boolean);
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
    const build = buildEmbed(block);
    if (fence) {
      out.push(fences[+fence[1]]);
    } else if (youtube) {
      out.push(youtube);
    } else if (video) {
      out.push(video);
    } else if (kicanvas) {
      out.push(kicanvas);
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
  return `<div class="${style}">${out.join('\n')}</div>`;
}

/* ---------------- Wallpapers ----------------
 * Website tiles are bitmap files registered in content/site.json. Paint can
 * add one browser-local PNG tile without introducing an SVG code path. */
const wallpapers = {};
const CUSTOM_BG_KEY = 'clackos-custom-background';
const CUSTOM_BG_NAME = 'Custom paint tile';
let currentWallpaper = 'Sand dots';
const wallpaperDropdowns = [];

function loadWebsiteBackgrounds(site) {
  for (const name of Object.keys(wallpapers)) delete wallpapers[name];
  for (const item of site.backgrounds || []) {
    const name = String(item?.name || '').trim();
    const file = String(item?.file || '').trim();
    if (!name || !/^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|gif|webp|bmp)$/i.test(file)) continue;
    const href = new URL(`assets/backgrounds/${encodeURIComponent(file)}`, location.href).href;
    wallpapers[name] = { file, image: `url("${href}")` };
  }
}

function customWallpaper() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_BG_KEY));
    if (saved && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(saved.dataUrl || ''))
      return { image: `url("${saved.dataUrl}")`, label: saved.name || CUSTOM_BG_NAME };
  } catch {}
  return null;
}

function getWallpaper(name) {
  if (wallpapers[name]) return wallpapers[name];
  return name === CUSTOM_BG_NAME ? customWallpaper() : null;
}

function applyWallpaper(name) {
  const wp = getWallpaper(name);
  if (!wp) return;
  currentWallpaper = name;
  try { localStorage.setItem('clackos-wallpaper', name); } catch {}
  /* The colour belongs to the active theme. Wallpapers contribute only the
   * transparent pattern layer, otherwise this inline colour would override
   * --desktop and make Theme Editor changes appear not to work. */
  desktop.style.removeProperty('background-color');
  desktop.style.backgroundImage = wp.image;
  wallpaperDropdowns.forEach(buildWallpaperMenu);
}

function buildWallpaperMenu(container) {
  container.innerHTML = '';
  const custom = customWallpaper();
  for (const name of [...Object.keys(wallpapers), ...(custom ? [CUSTOM_BG_NAME] : [])]) {
    const b = document.createElement('button');
    const label = name === CUSTOM_BG_NAME && custom?.label ? `${name} (${custom.label})` : name;
    b.innerHTML = `<span class="menu-item-label">${iconHTML('image')}${esc(label)}</span><span class="check">${name === currentWallpaper ? '&#10003;' : ''}</span>`;
    b.addEventListener('click', () => { applyWallpaper(name); closeMenus(); });
    container.appendChild(b);
  }
}

/* ---------------- Windows ---------------- */
const windows = new Map();
/* apps are standalone pages under content/<menu>/ shown in an iframe;
 * defs are registered from menu.json entries at boot */
const appDefs = new Map();
const windowIcons = new Map();
let spawnOffset = 0;
let appInstances = 0;

/* A few small system utilities are part of the desktop itself. They still
 * retain standalone HTML entry points, but inside ClackOS their markup runs in
 * an isolated shadow root instead of a nested browsing context. All other apps
 * continue through the iframe launcher below. */
async function mountIntegratedApp(body, launchPage, title, onClose) {
  body.classList.add('integrated-app-body');
  const host = document.createElement('div');
  host.className = 'integrated-app-host';
  host.setAttribute('aria-label', title);
  const root = host.attachShadow({ mode: 'open' });
  body.appendChild(host);

  onClose(() => host.dispatchEvent(new CustomEvent('clackos-disconnect')));

  try {
    const sourceUrl = new URL('content/' + launchPage, location.href);
    const res = await fetchFresh(sourceUrl.href);
    if (!res.ok) throw new Error(`Failed to load ${sourceUrl.pathname}: ${res.status}`);
    const source = new DOMParser().parseFromString(await res.text(), 'text/html');

    const styleLoads = [];
    source.head.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
      if (node.id === 'clackos-theme') return; // native apps inherit the live desktop palette
      const copy = document.createElement(node.tagName.toLowerCase());
      for (const attr of node.attributes) copy.setAttribute(attr.name, attr.value);
      if (node.tagName === 'LINK') {
        copy.href = new URL(node.getAttribute('href'), sourceUrl).href;
        styleLoads.push(new Promise(resolve => {
          copy.addEventListener('load', resolve, { once: true });
          copy.addEventListener('error', resolve, { once: true });
        }));
      } else copy.textContent = node.textContent;
      root.appendChild(copy);
    });

    const nativeStyle = document.createElement('style');
    nativeStyle.textContent = `
      :host { position: relative; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; }
      .app { height: 100%; min-height: 0; }
      .modal, .paint-modal { position: absolute; }
    `;
    root.appendChild(nativeStyle);
    await Promise.all(styleLoads);

    [...source.body.childNodes].filter(node => node.nodeName !== 'SCRIPT').forEach(node => {
      root.appendChild(document.importNode(node, true));
    });
    for (const oldScript of source.body.querySelectorAll('script')) {
      const script = document.createElement('script');
      for (const attr of oldScript.attributes) script.setAttribute(attr.name, attr.value);
      if (oldScript.src) script.src = new URL(oldScript.getAttribute('src'), sourceUrl).href;
      else script.textContent = oldScript.textContent;
      /* Scripts do not execute when appended to a shadow root in all target
       * browsers. Run them in the document while exposing the instance root
       * for the duration of synchronous setup; their selectors stay scoped. */
      window.ClackOSMountRoot = root;
      document.head.appendChild(script);
      script.remove();
      delete window.ClackOSMountRoot;
    }
    bindWebLinkRouting(root);
  } catch (error) {
    console.error(error);
    root.textContent = `Could not load ${title}.`;
  }
}

/* `restore` is a saved window entry (see the Session section): it carries the
 * geometry, stacking and app state a window had when the desktop was last
 * saved or shared as a link. */
async function openWindow(id, restore = null) {
  const existing = windows.get(id);
  if (existing) {
    existing.el.style.display = 'flex';
    existing.minimised = false;
    focusWindow(existing.el);
    updateTaskbar();
    return;
  }

  let meta, contentHtml, mount = null;
  if (id.startsWith('app:')) {
    /* a restored multi-instance window keeps the id it was saved under, so its
     * "#instance-2" suffix is not part of the page to load */
    const instance = /#instance-(\d+)$/.exec(id);
    const launchPage = id.slice(4).replace(/#instance-\d+$/, '');
    const page = launchPage.split(/[?#]/)[0];
    const def = appDefs.get(page);
    if (!def) return;
    /* multi-instance apps get a fresh window id on every open */
    if (instance) appInstances = Math.max(appInstances, parseInt(instance[1], 10));
    else if (def.multi) id = `${id}#instance-${++appInstances}`;
    meta = {
      title: def.title || def.label || page,
      icon: safeIconName(def.icon) || 'app-windows',
      width: def.width,
      height: def.height,
      fixed: def.fixed,
      integrated: def.integrated === true
    };
    windowTitles.set(id, meta.title);
    mount = (body, hooks) => {
      if (meta.integrated) {
        mountIntegratedApp(body, launchPage, meta.title, hooks.onClose);
        return;
      }
      const f = document.createElement('iframe');
      f.className = 'appframe theme-loading';
      f.src = 'content/' + launchPage;
      f.title = meta.title;
      if (page === 'applications/clackbase.html') f.allow = 'midi';
      /* clicks inside the app should still raise its window */
      f.addEventListener('load', () => {
        try {
          applyThemeToFrame(f);
          bindWebLinkRouting(f.contentDocument);
          /* clicking into an app also hands it the keyboard: apps that render
           * to a canvas (emulators) never take focus on their own */
          f.contentDocument.addEventListener('pointerdown', () => {
            focusWindow(el);
            try { f.contentWindow.focus(); } catch {}
          });
        } catch {}
      });
      body.appendChild(f);
    };
  } else {
    let content;
    try {
      content = await loadContent(id);
    } catch (err) {
      console.error(err);
      return;
    }
    meta = {
      ...content.meta,
      icon: safeIconName(content.meta.icon) || windowIcons.get(id) || 'file-text'
    };
    contentHtml = content.html;
  }
  const title = meta.title || id;

  const el = document.createElement('section');
  el.className = 'window';
  if (meta.integrated) el.classList.add('integrated-app-window');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);

  /* windows open at 80% of the desktop unless frontmatter says otherwise;
   * width/height accept px numbers or percentages ("width: 60%") */
  const sizeOf = (v, avail) => {
    v = v == null ? '' : String(v);
    if (v.trim().endsWith('%')) return Math.round(avail * parseFloat(v) / 100);
    const n = parseInt(v, 10);
    return Math.min(n || Math.round(avail * 0.8), avail - 24);
  };
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  const w = sizeOf(meta.width, dw);
  const h = sizeOf(meta.height, dh);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  /* centred, stepped along for the next one, but never stepped off the desktop:
     a window as wide as the desktop would otherwise hang over the right edge */
  el.style.left = Math.max(12, Math.min((dw - w) / 2 + spawnOffset, dw - w - 12)) + 'px';
  el.style.top = Math.max(12, Math.min((dh - h) / 2 - 20 + spawnOffset, dh - h - 12)) + 'px';
  spawnOffset = (spawnOffset + 28) % 112;

  /* fixed windows keep their exact size: no resize handles, no maximise */
  const isFixed = meta.fixed === true || String(meta.fixed) === 'true';
  if (isFixed) el.classList.add('fixed');
  el.innerHTML = `
    <div class="titlebar">
      <button class="dot close" aria-label="Close ${title}"></button>
      <button class="dot min" aria-label="Minimise ${title}"></button>
      ${isFixed ? '' : `<button class="dot max" aria-label="Maximise ${title}"></button>`}
      <span class="title">${iconHTML(meta.icon, 'title-icon')}<span class="title-label">${esc(title)}</span></span>
    </div>
    <div class="winbody"></div>
    ${isFixed ? '' : `
    <div class="rs n" data-dir="n"></div><div class="rs s" data-dir="s"></div>
    <div class="rs e" data-dir="e"></div><div class="rs w" data-dir="w"></div>
    <div class="rs ne" data-dir="ne"></div><div class="rs nw" data-dir="nw"></div>
    <div class="rs se" data-dir="se"></div><div class="rs sw" data-dir="sw"></div>`}
    <div class="frame" aria-hidden="true"></div>`;

  desktop.appendChild(el);
  const rec = { id, el, icon: meta.icon, minimised: false, maxed: null, cleanups: [] };
  /* Held before the app mounts: apps ask for their state as they start up. */
  if (restore && restore.state !== undefined) rec.state = restore.state;
  windows.set(id, rec);

  const winbody = el.querySelector('.winbody');
  if (mount) mount(winbody, { onClose: fn => rec.cleanups.push(fn) });
  else { winbody.innerHTML = contentHtml; populateBuildStamps(winbody); }

  const titlebar = el.querySelector('.titlebar');

  /* Apps that know their own natural size can ask the window to wrap around
   * them: dispatch a composed, bubbling `clackos-resize` carrying the window
   * body size they want in `detail.width` / `detail.height`. */
  el.addEventListener('clackos-resize', event => {
    const { width, height } = event.detail || {};
    fitWindowToContent(rec, width, height);
  });

  el.addEventListener('pointerdown', () => focusWindow(el));

  el.querySelector('.dot.close').addEventListener('click', e => { e.stopPropagation(); closeWindow(id); });
  el.querySelector('.dot.min').addEventListener('click', e => { e.stopPropagation(); minimiseWindow(id); });
  el.querySelector('.dot.max')?.addEventListener('click', e => { e.stopPropagation(); toggleMax(id); });

  /* drag */
  titlebar.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('dot')) return;
    e.preventDefault();
    focusWindow(el);
    /* iframes must not swallow pointer events mid-drag */
    document.body.classList.add('win-drag');
    const startX = e.clientX, startY = e.clientY;
    const origL = el.offsetLeft, origT = el.offsetTop;
    const move = ev => {
      let nl = origL + (ev.clientX - startX);
      let nt = origT + (ev.clientY - startY);
      nl = Math.min(Math.max(nl, -el.offsetWidth + 80), desktop.clientWidth - 80);
      nt = Math.min(Math.max(nt, 0), desktop.clientHeight - 40);
      el.style.left = nl + 'px';
      el.style.top = nt + 'px';
      rec.maxed = null;
    };
    const up = () => {
      document.body.classList.remove('win-drag');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* resize — all edges and corners */
  const MINW = 320, MINH = 180;
  el.querySelectorAll('.rs').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      focusWindow(el);
      document.body.classList.add('win-drag');
      const dir = handle.dataset.dir;
      const startX = e.clientX, startY = e.clientY;
      const orig = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const move = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        let { l, t, w, h } = orig;
        if (dir.includes('e')) w = Math.max(MINW, orig.w + dx);
        if (dir.includes('s')) h = Math.max(MINH, orig.h + dy);
        if (dir.includes('w')) {
          w = Math.max(MINW, orig.w - dx);
          l = orig.l + (orig.w - w);
        }
        if (dir.includes('n')) {
          h = Math.max(MINH, orig.h - dy);
          t = orig.t + (orig.h - h);
          if (t < 0) { h += t; t = 0; }  /* don't grow under the menu bar */
        }
        el.style.left = l + 'px';
        el.style.top = t + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        rec.maxed = null;
      };
      const up = () => {
        document.body.classList.remove('win-drag');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        scheduleSessionSave();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });

  focusWindow(el);
  if (restore) applyWindowEntry(rec, restore);
  updateTaskbar();
}

/* Grow or shrink a window so its body is exactly the requested size, keeping
 * the window inside the desktop and under the desktop's own bounds. Either
 * dimension may be omitted to leave it alone. */
function fitWindowToContent(rec, contentWidth, contentHeight) {
  const el = rec.el, winbody = el.querySelector('.winbody');
  if (!winbody || rec.maxed) return;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  /* frame = titlebar, borders and window padding; measured, not assumed */
  const frameW = el.offsetWidth - winbody.offsetWidth;
  const frameH = el.offsetHeight - winbody.offsetHeight;
  const w = contentWidth == null ? el.offsetWidth
    : Math.min(Math.round(contentWidth) + frameW, dw - 16);
  const h = contentHeight == null ? el.offsetHeight
    : Math.min(Math.round(contentHeight) + frameH, dh - 16);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.max(8, Math.min(el.offsetLeft, dw - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(el.offsetTop, dh - h - 8)) + 'px';
}

function focusWindow(el) {
  zTop += 1;
  el.style.zIndex = zTop;
  document.querySelectorAll('.window').forEach(w => w.classList.toggle('inactive', w !== el));
  updateTaskbar();
}

function closeWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.cleanups.forEach(fn => { try { fn(); } catch {} });
  rec.el.classList.add('closing');
  setTimeout(() => { rec.el.remove(); windows.delete(id); updateTaskbar(); }, 160);
}

function minimiseWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.el.style.display = 'none';
  rec.minimised = true;
  updateTaskbar();
}

function toggleMax(id) {
  const rec = windows.get(id);
  if (!rec) return;
  const el = rec.el;
  if (rec.maxed) {
    Object.assign(el.style, rec.maxed);
    rec.maxed = null;
  } else {
    rec.maxed = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
    el.style.left = '8px';
    el.style.top = '8px';
    el.style.width = (desktop.clientWidth - 16) + 'px';
    el.style.height = (desktop.clientHeight - 16) + 'px';
  }
  focusWindow(el);
}

function frontWindow() {
  let best = null, bestZ = -1;
  windows.forEach(rec => {
    if (rec.minimised) return;
    const z = parseInt(rec.el.style.zIndex || 0, 10);
    if (z > bestZ) { bestZ = z; best = rec; }
  });
  return best;
}

/* A markdown content window uses its content path as the window id
 * (e.g. "file/readme.md"); application windows start with "app:". Only the
 * former can be handed to the Markdown Editor, so this returns the editable
 * path or null. */
function markdownPathOf(rec) {
  return rec && !rec.id.startsWith('app:') ? rec.id : null;
}

/* File → Edit…: open the front markdown page in the Markdown Editor app,
 * with that file loaded via its ?open= query. */
function editFrontWindow() {
  const path = markdownPathOf(frontWindow());
  if (!path) return;
  openWindow(`app:applications/markdown.html?open=${encodeURIComponent(path)}`);
}

/* window arrangement (the View › Tidy windows submenu) --------------- */
const GAP = 8;
function openWindowList() {
  return [...windows.values()].filter(rec => !rec.minimised);
}

function bindDesktopIcons() {
  desktop.querySelectorAll('.desktop-icon[data-window]').forEach(icon => {
    const open = () => openWindow(icon.dataset.window);
    icon.addEventListener('dblclick', open);
    icon.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      open();
    });
  });
}
function placeWindow(rec, left, top, width, height) {
  rec.maxed = null;
  const s = rec.el.style;
  s.left = Math.round(left) + 'px';
  s.top = Math.round(top) + 'px';
  if (width != null) s.width = Math.round(width) + 'px';
  if (height != null) s.height = Math.round(height) + 'px';
  scheduleSessionSave();
}

/* Cascade: uniform size, stepped down from the top-left, front-to-back */
function arrangeCascade() {
  const wins = openWindowList();
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  const w = Math.round(dw * 0.6), h = Math.round(dh * 0.62);
  const step = 30, span = Math.max(step, Math.min(dw - w, dh - h));
  wins.forEach((rec, i) => {
    const off = (i * step) % span;
    placeWindow(rec, 16 + off, 16 + off, w, h);
    focusWindow(rec.el);
  });
}

/* Tile: even grid filling the desktop */
function arrangeGrid() {
  const wins = openWindowList(); const n = wins.length; if (!n) return;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const cw = (dw - GAP * (cols + 1)) / cols;
  const ch = (dh - GAP * (rows + 1)) / rows;
  wins.forEach((rec, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    placeWindow(rec, GAP + c * (cw + GAP), GAP + r * (ch + GAP), cw, ch);
  });
}

/* Tile horizontally: full-width windows stacked in rows */
function arrangeRows() {
  const wins = openWindowList(); const n = wins.length; if (!n) return;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  const h = (dh - GAP * (n + 1)) / n;
  wins.forEach((rec, i) => placeWindow(rec, GAP, GAP + i * (h + GAP), dw - GAP * 2, h));
}

/* Tile vertically: full-height windows side by side in columns */
function arrangeColumns() {
  const wins = openWindowList(); const n = wins.length; if (!n) return;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  const w = (dw - GAP * (n + 1)) / n;
  wins.forEach((rec, i) => placeWindow(rec, GAP + i * (w + GAP), GAP, w, dh - GAP * 2));
}


function minimiseAll() {
  [...windows.keys()].forEach(id => { if (!windows.get(id).minimised) minimiseWindow(id); });
}
function restoreAll() {
  windows.forEach(rec => {
    if (rec.minimised) { rec.el.style.display = 'flex'; rec.minimised = false; }
  });
  updateTaskbar();
}

/* ---------------- Session ----------------
 * The desktop remembers itself without a server: which windows are open,
 * where they sit, which one is in front, how far each document is scrolled and
 * whatever state an app chooses to report (see assets/js/app-state.js). The
 * snapshot is kept in localStorage and restored at boot; the same snapshot
 * encodes into the URL hash, so a desktop can be handed to someone else — or
 * to another browser — as a link.
 *
 * Nothing here needs a server: localStorage is per-origin browser storage and
 * a hash is never sent to the host. */
const SESSION_KEY = 'clackos-session';
const SESSION_VERSION = 1;
const SESSION_PARAM = 'desktop';
/* Guard rails. localStorage is a few megabytes per origin and a URL stops
 * being shareable long before that, so app state is dropped rather than
 * silently truncated when it runs over. */
const MAX_APP_STATE = 64 * 1024;
const MAX_LINK_PAYLOAD = 12 * 1024;
let sessionRestoring = false;
let sessionRemembering = true;
let sessionSaveTimer = 0;

/* Ids arriving from a shared link are untrusted: an application id must name a
 * page registered in a menu (openWindow enforces that), and a document id must
 * be a markdown path under content/ with no traversal. */
function safeWindowId(id) {
  id = String(id || '');
  if (id.startsWith('app:'))
    return /^app:[a-z0-9][a-z0-9._/-]*\.html(?:\?[^\s#]*)?(?:#instance-\d+)?$/i.test(id) && !id.includes('..') ? id : '';
  return /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+\.md$/i.test(id) && !id.includes('..') ? id : '';
}

function captureSession() {
  const px = value => Math.round(parseFloat(value) || 0);
  const list = [];
  windows.forEach(rec => {
    const el = rec.el;
    /* a maximised window is stored at the size it will return to, plus a flag */
    const box = rec.maxed || el.style;
    const entry = {
      id: rec.id,
      x: px(box.left), y: px(box.top), w: px(box.width), h: px(box.height),
      z: parseInt(el.style.zIndex || 0, 10)
    };
    if (rec.minimised) entry.min = 1;
    if (rec.maxed) entry.max = 1;
    const scroll = Math.round(el.querySelector('.winbody')?.scrollTop || 0);
    if (scroll) entry.scroll = scroll;
    if (rec.state !== undefined) entry.state = rec.state;
    list.push(entry);
  });
  list.sort((a, b) => a.z - b.z);   /* replayed back to front, so focus lands right */
  return { v: SESSION_VERSION, theme: activeTheme, wallpaper: currentWallpaper, windows: list };
}

function saveSession() {
  if (sessionRestoring || !sessionRemembering) return;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(captureSession())); } catch {}
}

function scheduleSessionSave() {
  if (sessionRestoring || !sessionRemembering) return;
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(saveSession, 400);
}

/* Clear the saved desktop and stop saving for the rest of this visit —
 * otherwise the next click would write it straight back. Remembering resumes
 * on the next load. */
function forgetSession() {
  sessionRemembering = false;
  clearTimeout(sessionSaveTimer);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

/* Fade out and come back up. Whatever the caller cleared first decides how
 * much of the desktop survives the trip. */
function rebootDesktop() {
  document.body.style.transition = 'opacity 0.4s ease';
  document.body.style.opacity = '0';
  setTimeout(() => location.reload(), 420);
}

/* Everything ClackOS and its applications keep in this browser: the saved
 * desktop, the theme and wallpaper (including a tile painted in ClackPaint),
 * each app's own settings and saved games, and the files the applications
 * have cached — the language model ClackChat downloads, for one. Local files
 * and anything on the website are untouched, but browser-saved work is not
 * recoverable, so this asks first. */
async function resetClackOS() {
  const warning = 'Reset ClackOS?\n\n' +
    'This clears everything this browser remembers: the saved desktop, the ' +
    'chosen theme and wallpaper, every application\'s saved settings and ' +
    'games, and any files the applications have cached.';
  if (!window.confirm(warning)) return;
  forgetSession();
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  /* the theme cookie is the one preference that lives outside storage */
  document.cookie = `${encodeURIComponent(THEME_COOKIE)}=; Max-Age=0; Path=/; SameSite=Lax`;
  if (window.caches) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch {}
  }
  rebootDesktop();
}

/* Put a restored window back exactly where it was, clamped to the desktop it
 * is being restored onto — which may be a different size from the one it was
 * saved on, especially when the snapshot arrived as a link. */
function applyWindowEntry(rec, entry) {
  const el = rec.el;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  if (entry.w > 0 && !el.classList.contains('fixed')) {
    el.style.width = Math.min(entry.w, dw - 16) + 'px';
    el.style.height = Math.min(entry.h, dh - 16) + 'px';
  }
  if (Number.isFinite(entry.x)) {
    el.style.left = Math.max(0, Math.min(entry.x, dw - 80)) + 'px';
    el.style.top = Math.max(0, Math.min(entry.y, dh - 40)) + 'px';
  }
  if (entry.max) toggleMax(rec.id);
  if (entry.scroll) {
    const winbody = el.querySelector('.winbody');
    if (winbody) winbody.scrollTop = entry.scroll;
  }
  if (entry.min) minimiseWindow(rec.id);
}

async function restoreSession(snapshot) {
  if (!snapshot || snapshot.v !== SESSION_VERSION || !Array.isArray(snapshot.windows)) return false;
  const entries = snapshot.windows
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => ({ ...entry, id: safeWindowId(entry.id) }))
    .filter(entry => entry.id);
  if (!entries.length) return false;

  if (snapshot.theme && availableThemes.has(safeThemeName(snapshot.theme))) applyTheme(snapshot.theme);
  if (snapshot.wallpaper && getWallpaper(snapshot.wallpaper)) applyWallpaper(snapshot.wallpaper);

  sessionRestoring = true;
  try {
    for (const entry of entries) await openWindow(entry.id, entry);
  } finally {
    sessionRestoring = false;
  }
  return windows.size > 0;
}

/* --- link encoding ---
 * A snapshot travels in the URL hash as deflate-compressed JSON in base64url,
 * tagged "z"; browsers without CompressionStream fall back to plain JSON,
 * tagged "j". The hash is a fragment, so the snapshot never leaves the
 * browser until someone chooses to send the link. */
function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function packSession(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
    } catch {}
  }
  return 'j' + toBase64Url(bytes);
}

async function unpackSession(payload) {
  const tag = payload.slice(0, 1), body = fromBase64Url(payload.slice(1));
  if (tag === 'j') return JSON.parse(new TextDecoder().decode(body));
  if (tag !== 'z' || typeof DecompressionStream !== 'function') return null;
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

/* Prefer a link that carries everything; fall back to window layout alone when
 * app state makes the URL unreasonable. */
async function desktopLink() {
  const snapshot = captureSession();
  let payload = await packSession(snapshot);
  let complete = true;
  if (payload.length > MAX_LINK_PAYLOAD) {
    complete = false;
    snapshot.windows = snapshot.windows.map(({ state, ...rest }) => rest);
    payload = await packSession(snapshot);
  }
  const url = new URL(location.href);
  url.hash = `${SESSION_PARAM}=${payload}`;
  return { url: url.href, complete, oversize: payload.length > MAX_LINK_PAYLOAD };
}

async function sessionFromHash() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith(SESSION_PARAM + '=')) return null;
  const payload = hash.slice(SESSION_PARAM.length + 1);
  try {
    return await unpackSession(payload);
  } catch (error) {
    console.warn('Ignoring an unreadable desktop link:', error);
    return null;
  }
}

async function copyDesktopLink() {
  let link;
  try {
    link = await desktopLink();
  } catch (error) {
    console.error(error);
    showToast('Could not build a link for this desktop.');
    return;
  }
  if (link.oversize) {
    showToast('This desktop is too large to fit in a link.');
    return;
  }
  const note = link.complete
    ? 'Link to this desktop copied'
    : 'Link copied — window layout only, app contents were too large';
  try {
    await navigator.clipboard.writeText(link.url);
    showToast(note);
  } catch {
    /* clipboard permission denied, or no user activation left after awaiting */
    window.prompt('Copy this link to your desktop:', link.url);
  }
}

/* A short-lived message above the taskbar; the desktop has no other notion of
 * a notification and this is the only thing that needs one. */
let toastTimer = 0;
function showToast(message) {
  let toast = document.getElementById('system-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'system-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

/* Apps report their own state (slider positions, document contents, whatever
 * they choose) and ask for it back as they start. Both directions carry the
 * app's own JSON, which the desktop stores without interpreting. */
function windowStateFor(rec) {
  return rec.state === undefined ? null : rec.state;
}

function deliverAppState(rec, source) {
  const message = { type: 'clackos-state-restore', state: windowStateFor(rec) };
  const frame = rec.el.querySelector('iframe.appframe');
  if (frame && frame.contentWindow === source) {
    frame.contentWindow.postMessage(message, location.origin);
  } else if (source instanceof Node) {
    source.dispatchEvent(new CustomEvent('clackos-state-restore', { detail: message }));
  }
}

function recordAppState(rec, state) {
  let encoded;
  try { encoded = JSON.stringify(state ?? null); } catch { return; }
  if (encoded.length > MAX_APP_STATE) return;   /* too big to remember */
  rec.state = JSON.parse(encoded);
  scheduleSessionSave();
}

/* Last chance to save: a debounced write may still be pending when the tab
 * goes away. */
window.addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
/* scroll does not bubble, so reading position is picked up in the capture phase */
desktop.addEventListener('scroll', scheduleSessionSave, true);

/* ---------------- Taskbar ---------------- */
function updateTaskbar() {
  tasksEl.innerHTML = '';
  const front = frontWindow();
  windows.forEach((rec, id) => {
    const title = windowTitles.get(id) || id;
    const b = document.createElement('button');
    b.className = 'task';
    if (rec.minimised) b.classList.add('minimised');
    if (front && front.id === id && !rec.minimised) b.classList.add('active');
    b.innerHTML = `${iconHTML(rec.icon || 'file-text', 'task-icon')}<span class="lbl">${esc(title)}</span>`;
    b.setAttribute('aria-label', title + (rec.minimised ? ' (minimised)' : ''));
    b.addEventListener('click', () => {
      if (rec.minimised) {
        openWindow(id);                      /* restore + focus */
      } else if (front && front.id === id) {
        minimiseWindow(id);                  /* click active task = minimise */
      } else {
        focusWindow(rec.el);                 /* bring to front */
      }
    });
    tasksEl.appendChild(b);
  });
  /* every open, close, focus and minimise ends here, which makes this the one
   * place the session needs to be marked dirty */
  scheduleSessionSave();
}

/* ---------------- Menu bar (built from content/) ---------------- */
let menuOpen = false;

/* The events pull-down is dismissed like a menu — outside click, Escape, or
 * opening a menu — so it closes here rather than growing its own handlers. */
function closeMenus() {
  menubar.querySelectorAll('.menu').forEach(m => m.classList.remove('open'));
  menubar.querySelectorAll('.submenu').forEach(s => s.classList.remove('open'));
  closeEventsPanel();
  menuOpen = false;
}

/* Menu items whose availability depends on the current front window are
 * refreshed each time a menu is opened. Edit… only applies to a rendered
 * markdown page, so it is disabled when the front window is an app or when
 * no window is open. */
function refreshDynamicItems() {
  const editable = !!markdownPathOf(frontWindow());
  menubar.querySelectorAll('[data-action="edit-front"]').forEach(b => {
    b.disabled = !editable;
  });
}

/* fill a dropdown from a list of items; recurses for nested submenus so the
 * same item vocabulary (window/app/action/sep/wallpapers) works at any depth */
function buildMenuItems(container, items, folder) {
  for (const item of items || []) {
    if (item.type === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      container.appendChild(sep);
    } else if (item.type === 'wallpapers') {
      const holder = document.createElement('div');
      container.appendChild(holder);
      wallpaperDropdowns.push(holder);
      buildWallpaperMenu(holder);
    } else if (item.type === 'submenu') {
      const wrap = document.createElement('div');
      wrap.className = 'submenu';
      const sb = document.createElement('button');
      sb.className = 'submenu-btn';
      sb.setAttribute('aria-haspopup', 'true');
      sb.innerHTML = `<span class="menu-item-label">${iconHTML(item.icon)}${esc(item.label || '')}</span><span class="arrow" aria-hidden="true">▸</span>`;
      wrap.appendChild(sb);
      const sub = document.createElement('div');
      sub.className = 'dropdown sub';
      wrap.appendChild(sub);
      buildMenuItems(sub, item.items, folder);
      /* CSS opens it on hover; a click toggles it so it works by tap too */
      sb.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains('open');
        container.querySelectorAll('.submenu.open').forEach(s => s.classList.remove('open'));
        if (!wasOpen) wrap.classList.add('open');
      });
      container.appendChild(wrap);
    } else {
      const b = document.createElement('button');
      const shortcut = item.shortcut ? `<span>${esc(item.shortcut)}</span>` : '';
      b.innerHTML = `<span class="menu-item-label">${iconHTML(item.icon)}${esc(item.label || '')}</span>${shortcut}`;
      if (item.disabled) b.disabled = true;
      if (item.type === 'window') {
        const id = `${folder}/${item.md}`;
        windowIcons.set(id, safeIconName(item.icon) || 'file-text');
        b.dataset.action = `open:${id}`;
      }
      else if (item.type === 'app') {
        const page = `${folder}/${item.page}`;
        appDefs.set(page, item);
        b.dataset.action = `open:app:${page}`;
      }
      else if (item.action) b.dataset.action = item.action;
      container.appendChild(b);
    }
  }
}

function buildMenu(folder, def) {
  const m = document.createElement('div');
  m.className = 'menu';

  const btn = document.createElement('button');
  btn.setAttribute('aria-haspopup', 'true');
  btn.textContent = def.label || folder;
  m.appendChild(btn);

  const dd = document.createElement('div');
  dd.className = 'dropdown';
  m.appendChild(dd);

  buildMenuItems(dd, def.items, folder);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = m.classList.contains('open');
    closeMenus();
    if (!wasOpen) { refreshDynamicItems(); m.classList.add('open'); menuOpen = true; }
  });
  btn.addEventListener('pointerenter', () => {
    if (menuOpen && !m.classList.contains('open')) {
      closeMenus();
      refreshDynamicItems();
      m.classList.add('open');
      menuOpen = true;
    }
  });

  return m;
}

document.addEventListener('click', closeMenus);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

/* ---------------- Actions ---------------- */
function runAction(action) {
  if (action.startsWith('open:')) { openWindow(action.slice(5)); return; }
  switch (action) {
    case 'close-front': { const f = frontWindow(); if (f) closeWindow(f.id); break; }
    case 'edit-front': editFrontWindow(); break;
    case 'tidy': case 'arrange-cascade': arrangeCascade(); break;
    case 'arrange-grid': arrangeGrid(); break;
    case 'arrange-rows': arrangeRows(); break;
    case 'arrange-columns': arrangeColumns(); break;
    case 'minimise-all': minimiseAll(); break;
    case 'restore-all': restoreAll(); break;
    case 'plain-html': window.open('plain/index.html', '_blank', 'noopener'); break;
    case 'copy-desktop-link': copyDesktopLink(); break;
    case 'forget-desktop': {
      forgetSession();
      showToast('Saved desktop cleared — this visit will not be remembered');
      break;
    }
    case 'report-bug': window.open(`https://github.com/${siteRepo}/issues/new`, '_blank', 'noopener'); break;
    case 'copy': {
      const sel = String(document.getSelection() || '');
      if (sel && navigator.clipboard) navigator.clipboard.writeText(sel).catch(() => {});
      break;
    }
    /* File → Restart: the windows go back to the desktop the website ships
     * with. Only the saved desktop is dropped — the chosen theme, wallpaper
     * and everything the applications have saved are left alone. */
    case 'restart': {
      forgetSession();
      rebootDesktop();
      break;
    }
    /* View → Reset: everything this browser remembers about ClackOS goes,
     * and the desktop comes back as a first-time visitor sees it. */
    case 'reset': resetClackOS(); break;
  }
}

document.addEventListener('click', e => {
  const anchor = e.target.closest('a[data-anchor]');
  if (anchor) {
    e.preventDefault();
    const winbody = anchor.closest('.winbody');
    const target = [...(winbody || document).querySelectorAll('[id]')]
      .find(element => element.id === anchor.dataset.anchor);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  runAction(btn.dataset.action);
  closeMenus();
});
bindWebLinkRouting(document);

/* ---------------- Upcoming events pull-down ----------------
 * A small read-only view of the two files the Calendar app reads, hung under
 * the date in the menu bar: enough to see what is on without opening a window.
 * Nothing is fetched until it is first opened, so a visitor who never touches
 * it pays nothing; after that every open refreshes, which keeps a calendar
 * committed from the app from going stale behind a long-lived desktop. */
const eventsPill = document.getElementById('events-pill');
const eventsPanel = document.getElementById('events-panel');
const eventsList = document.getElementById('events-list');
const eventsCount = document.getElementById('events-count');
const eventsSource = document.getElementById('events-source');
/* One window: the same id the boot list uses, so the pull-down and the menu
 * raise the calendar that is already open rather than opening a second. */
const CALENDAR_APP = 'app:applications/calendar.html?view=upcoming';
const PANEL_ROWS = 8;
let eventsLoading = null;

function closeEventsPanel() {
  eventsPanel.hidden = true;
  eventsPill.setAttribute('aria-expanded', 'false');
}

function showCalendarApp() {
  closeEventsPanel();
  openWindow(CALENDAR_APP);
}

function eventRow(event) {
  const row = document.createElement('button');
  row.type = 'button';
  const mirrored = !ClackOSEvents.isOwn(event);
  row.className = 'event-row' + (mirrored ? ' from-luma' : '');
  const date = ClackOSEvents.dateOf(event.date);
  row.innerHTML = `
    <span class="when">
      <span class="d">${date.getDate()}</span>
      <span class="m">${ClackOSEvents.SHORT_MONTHS[date.getMonth()]}</span>
    </span>
    <span class="what">
      <strong>${esc(event.title)}</strong>
      <span>${esc(ClackOSEvents.describeWhen(event))}</span>
      ${event.location ? `<span>${esc(event.location)}</span>` : ''}
    </span>
    ${mirrored ? '<span class="tag">Luma</span>' : ''}`;
  row.addEventListener('click', showCalendarApp);
  return row;
}

function renderEventsPanel(loaded) {
  const upcoming = ClackOSEvents.upcoming(loaded.events);
  const shown = upcoming.slice(0, PANEL_ROWS);
  eventsList.textContent = '';

  if (!shown.length) {
    const note = document.createElement('p');
    note.className = 'empty';
    note.textContent = loaded.csvError
      ? loaded.csvError
      : 'Nothing coming up just yet. Open the Calendar to look back over past events.';
    eventsList.appendChild(note);
  } else {
    for (const event of shown) eventsList.appendChild(eventRow(event));
  }

  eventsCount.textContent = upcoming.length > shown.length
    ? `next ${shown.length} of ${upcoming.length}`
    : (upcoming.length ? `${upcoming.length} to come` : '');
  eventsSource.hidden = !loaded.lumaSource;
  if (loaded.lumaSource) eventsSource.href = loaded.lumaSource;
}

function loadEventsPanel() {
  if (eventsLoading) return eventsLoading;
  eventsLoading = ClackOSEvents.load()
    .then(renderEventsPanel)
    .catch(error => {
      console.warn(error);
      eventsList.innerHTML = '<p class="empty">The events could not be loaded.</p>';
    })
    .finally(() => { eventsLoading = null; });
  return eventsLoading;
}

function openEventsPanel() {
  closeMenus();                       /* also closes this panel, so open after */
  eventsPanel.hidden = false;
  eventsPill.setAttribute('aria-expanded', 'true');
  if (!eventsList.childElementCount) eventsList.innerHTML = '<p class="empty">Loading…</p>';
  loadEventsPanel();
}

/* Opening the desktop with the events showing, once the list is in place rather
 * than mid-load, so it arrives filled instead of flashing "Loading…". A visitor
 * who has already started clicking is left alone: a panel that appears late,
 * over whatever they just opened, is a surprise rather than a welcome. */
let visitorHasClicked = false;
document.addEventListener('pointerdown', () => { visitorHasClicked = true; },
  { once: true, capture: true });

async function greetWithEvents() {
  await loadEventsPanel();
  if (!visitorHasClicked) openEventsPanel();
}

eventsPill.addEventListener('click', event => {
  event.stopPropagation();
  if (eventsPanel.hidden) openEventsPanel(); else closeEventsPanel();
});
/* clicks inside the panel are its own business, not a click on the desktop */
eventsPanel.addEventListener('click', event => event.stopPropagation());
document.getElementById('events-open-app').addEventListener('click', showCalendarApp);

/* ---------------- Clock and date ----------------
 * The colon blinks once a second. That is a CSS animation rather than a timer,
 * so it costs nothing and stops under prefers-reduced-motion; the only thing
 * done here is to line its phase up with the wall clock. */
const clockEl = document.getElementById('clock');
const clockHours = clockEl.querySelector('.hh');
const clockMinutes = clockEl.querySelector('.mm');
const clockTick = clockEl.querySelector('.tick');
const pillDate = document.querySelector('#events-pill .pill-date');
let shownDate = '';

function tick() {
  const now = new Date();
  clockHours.textContent = String(now.getHours()).padStart(2, '0');
  clockMinutes.textContent = String(now.getMinutes()).padStart(2, '0');
  clockEl.setAttribute('aria-label', `${clockHours.textContent}:${clockMinutes.textContent}`);
  clockTick.style.animationDelay = `-${now.getMilliseconds()}ms`;

  const today = ClackOSEvents.todayIso();
  if (today !== shownDate) {
    shownDate = today;
    pillDate.textContent = ClackOSEvents.formatLongDay(today);
  }
}
tick();
setInterval(tick, 15000);

/* ---------------- Browser resource telemetry ---------------- */
const cpuStat = document.getElementById('cpu-stat');
const ramStat = document.getElementById('ram-stat');
let cpuPressureObserver = null;

function formatMemory(bytes) {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${Math.round(mib)} MB`;
}

function updatePageMemory() {
  const memory = window.performance && window.performance.memory;
  ramStat.textContent = memory && Number.isFinite(memory.usedJSHeapSize)
    ? formatMemory(memory.usedJSHeapSize)
    : 'N/A';
}

async function observeCpuPressure() {
  if (!('PressureObserver' in window)) return;

  try {
    cpuPressureObserver = new PressureObserver(records => {
      const reading = records[records.length - 1];
      if (!reading) return;
      cpuStat.textContent = reading.state.toUpperCase();
      cpuStat.dataset.state = reading.state;
    });
    await cpuPressureObserver.observe('cpu', { sampleInterval: 2000 });
  } catch {
    cpuPressureObserver = null;
  }
}

updatePageMemory();
setInterval(updatePageMemory, 5000);
observeCpuPressure();

/* ---------------- Taskbar build stamp ---------------- */
/* Show the deployed commit in the bottom-right of the taskbar. version.json is
 * written at deploy time (see siteVersion); on a raw checkout it is absent, so
 * the stamp stays "dev". */
(function taskbarBuildStamp() {
  const stamp = document.getElementById('build-stamp-tb');
  const sha = document.getElementById('build-sha');
  if (!stamp || !sha) return;
  siteVersion().then(v => {
    if (!v || !v.short) return;
    sha.textContent = v.short;
    if (v.builtAt) stamp.title = `Deployed commit ${v.short} · ${String(v.builtAt).slice(0, 10)}`;
    else stamp.title = `Deployed commit ${v.short}`;
    if (v.url) {
      stamp.href = v.url;
      stamp.target = '_blank';
      stamp.rel = 'noopener noreferrer';
    }
  });
})();

/* ---------------- Boot ---------------- */
async function boot() {
  const site = await loadJSON('content/site.json');
  if (typeof site.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(site.repo)) siteRepo = site.repo;
  await loadLinkWhitelist();
  site.backgrounds = await window.ClackOSBackgrounds.list(site);
  loadWebsiteBackgrounds(site);
  availableThemes = new Set((site.themes || []).map(safeThemeName));
  availableThemes.add(safeThemeName(site.theme));

  let savedWp = null, savedTheme = null;
  try {
    savedWp = localStorage.getItem('clackos-wallpaper');
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {}
  if (!savedTheme) savedTheme = readCookie(THEME_COOKIE);
  const configuredBackground = Object.keys(wallpapers).find(name => wallpapers[name].file === site.background);
  const fallbackBackground = configuredBackground || Object.keys(wallpapers)[0];
  if (savedWp && getWallpaper(savedWp)) applyWallpaper(savedWp);
  else if (fallbackBackground) applyWallpaper(fallbackBackground);
  applyTheme(savedTheme && availableThemes.has(safeThemeName(savedTheme)) ? savedTheme : site.theme);
  updateTaskbar();

  const defs = await Promise.all(
    site.menus.map(folder => loadJSON(`content/${folder}/menu.json`))
  );

  /* menus fill the bar from the left; the date and clock keep the right-hand end */
  const rightSide = document.getElementById('menubar-right');
  site.menus.forEach((folder, i) => {
    menubar.insertBefore(buildMenu(folder, defs[i]), rightSide);
  });

  bindDesktopIcons();

  /* A desktop arrives from one of three places, in order of authority: a
   * shared link, this browser's saved desktop, or site.json's boot list. */
  const shared = await sessionFromHash();
  let restored = shared ? await restoreSession(shared) : false;
  if (shared) {
    /* the link has been consumed — from here the desktop is this browser's
     * again, and further changes belong in its own saved session */
    history.replaceState(null, '', location.pathname + location.search);
    if (!restored) showToast('That desktop link could not be opened');
  }
  if (!restored && !shared) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
    restored = await restoreSession(saved);
  }
  if (!restored) for (const id of site.boot || []) await openWindow(id);
  saveSession();

  /* The desktop opens with the events showing. This is a calendar of what is
   * coming up as much as it is a website, and the pull-down says so without
   * taking a window or moving anything the visitor came for. */
  greetWithEvents();
}

boot().catch(err => console.error('ClackOS failed to boot:', err));

/* Same-origin system applications can preview palettes or select registered
 * themes/backgrounds. Integrated apps send the same payload as a DOM event;
 * iframe apps retain postMessage. Paint sends a PNG data URL for its custom
 * tile slot. */
/* Which window an app message came from: iframe apps post from their own
 * contentWindow, integrated apps dispatch from an element inside the window. */
function windowIdFor(source) {
  if (!source) return null;
  for (const rec of windows.values()) {
    const frame = rec.el.querySelector('iframe.appframe');
    if (frame && frame.contentWindow === source) return rec.id;
    if (source instanceof Node && rec.el.contains(source)) return rec.id;
  }
  return null;
}

function handleAppMessage(data, source) {
  if (data?.type === 'clackos-theme-preview') {
    applyThemePreview(data.variables);
  } else if (data?.type === 'clackos-appearance') {
    const theme = safeThemeName(data.theme);
    if (data.theme && availableThemes.has(theme)) {
      try { localStorage.setItem(THEME_KEY, theme); } catch {}
      applyTheme(theme);
    }
    if (data.wallpaper && getWallpaper(data.wallpaper)) applyWallpaper(data.wallpaper);
  } else if (data?.type === 'clackos-set-background-tile') {
    const dataUrl = String(data.dataUrl || '');
    if (!/^data:image\/png;base64,/i.test(dataUrl)) return;
    try {
      localStorage.setItem(CUSTOM_BG_KEY, JSON.stringify({ name: String(data.name || 'paint-tile.png'), dataUrl }));
      applyWallpaper(CUSTOM_BG_NAME);
    } catch {}
  } else if (data?.type === 'clackos-open-app') {
    const id = String(data.id || '');
    if (/^app:applications\/[a-z0-9][a-z0-9._/-]*(?:[?#].*)?$/i.test(id)) openWindow(id);
  } else if (data?.type === 'clackos-state') {
    /* an app reporting the state it wants remembered */
    const rec = windows.get(windowIdFor(source));
    if (rec) recordAppState(rec, data.state);
  } else if (data?.type === 'clackos-request-state') {
    /* an app asking for the state it was restored with */
    const rec = windows.get(windowIdFor(source));
    if (rec) deliverAppState(rec, source);
  } else if (data?.type === 'clackos-close-window') {
    /* apps that can quit on their own (QBasic's File > Exit) close their window */
    const id = windowIdFor(source);
    if (id) closeWindow(id);
  }
}

document.addEventListener('clackos-message', e => handleAppMessage(e.detail, e.target));
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  handleAppMessage(e.data, e.source);
});

/* Same-origin app windows and other tabs also synchronise through storage. */
window.addEventListener('storage', e => {
  if (e.key === CUSTOM_BG_KEY) {
    wallpaperDropdowns.forEach(buildWallpaperMenu);
    if (currentWallpaper === CUSTOM_BG_NAME && getWallpaper(CUSTOM_BG_NAME)) applyWallpaper(CUSTOM_BG_NAME);
    else if (currentWallpaper === CUSTOM_BG_NAME) applyWallpaper(Object.keys(wallpapers)[0]);
  } else if (e.key === 'clackos-wallpaper' && e.newValue && e.newValue !== currentWallpaper) {
    applyWallpaper(e.newValue);
  } else if (e.key === THEME_KEY && e.newValue && availableThemes.has(safeThemeName(e.newValue))) {
    applyTheme(e.newValue);
  }
});

window.addEventListener('resize', () => {
  windows.forEach(rec => {
    if (rec.maxed !== null) return;
    const el = rec.el;
    if (el.offsetLeft > desktop.clientWidth - 80) el.style.left = (desktop.clientWidth - 100) + 'px';
    if (el.offsetTop > desktop.clientHeight - 40) el.style.top = (desktop.clientHeight - 60) + 'px';
  });
});
})();
