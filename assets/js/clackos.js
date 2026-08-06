/* ClackOS — template/engine only.
 * All content lives in content/<menu>/*.md, all menu structure in
 * content/<menu>/menu.json, and the menu order in content/site.json. */
(() => {
/* The markdown renderer lives in assets/js/markdown.js so the Markdown Editor's
 * preview can render exactly what a window will show. Two pieces of it belong
 * to the desktop, and are handed back below. */
const {
  render: mdToHtml, parseFrontmatter, populateBuildStamps,
  esc, escAttr, escInlineAttr, safeWebUrl, siteVersion
} = window.ClackMarkdown;

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
  '--title-text', '--title-text-inactive', '--accent-hover', '--button-text',
  '--disabled-text'
];
/* Non-colour controls are validated before an editor preview can put them into
 * another document's inline style. */
const THEME_UNIT_VARS = {
  '--shadow-distance': /^\d{1,2}(\.\d+)?px$/,
  '--shadow-alpha': /^\d{1,3}(\.\d+)?%$/,
  '--media-grayscale': /^\d{1,3}(\.\d+)?%$/,
  '--media-sepia': /^\d{1,3}(\.\d+)?%$/,
  '--media-saturate': /^\d{1,3}(\.\d+)?%$/,
  '--media-hue': /^-?\d{1,3}(\.\d+)?deg$/,
  '--media-brightness': /^\d{1,3}(\.\d+)?%$/,
  '--media-contrast': /^\d{1,3}(\.\d+)?%$/
};
const THEME_FILTER_VAR = '--media-filter';
const THEME_FILTER_PATTERN = /^(?:none|grayscale\(\d{1,3}(?:\.\d+)?%\) sepia\(\d{1,3}(?:\.\d+)?%\) saturate\(\d{1,3}(?:\.\d+)?%\) hue-rotate\(-?\d{1,3}(?:\.\d+)?deg\) brightness\(\d{1,3}(?:\.\d+)?%\) contrast\(\d{1,3}(?:\.\d+)?%\))$/;
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
  if (variables && THEME_FILTER_PATTERN.test(String(variables[THEME_FILTER_VAR] || '').trim()))
    doc.documentElement.style.setProperty(THEME_FILTER_VAR, String(variables[THEME_FILTER_VAR]).trim());
  else
    doc.documentElement.style.removeProperty(THEME_FILTER_VAR);
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
  return Object.fromEntries([...THEME_VARS, ...Object.keys(THEME_UNIT_VARS), THEME_FILTER_VAR]
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
const metaCache = new Map();      // md path -> frontmatter (null when missing)
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

/* Where a page goes when it goes up: `up:` in the frontmatter decides, with
 * `up: none` for a page that is already the top; otherwise it is the folder's
 * own page — file/euroclack/mini-speaker.md goes up to file/euroclack.md —
 * and the home window for everything that sits at the top level. */
const HOME_PAGE = 'file/home.md';
function upTarget(id, meta) {
  const declared = (meta.up || '').trim();
  if (declared) return declared === 'none' ? '' : declared;
  if (id === HOME_PAGE) return '';
  const dir = id.replace(/\/[^/]*$/, '');
  return dir.includes('/') ? dir + '.md' : HOME_PAGE;
}

/* Frontmatter only, for the title of a page that is not being opened. */
async function loadMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  let meta = null;
  try {
    const res = await fetchFresh('content/' + id);
    if (res.ok) meta = parseFrontmatter(await res.text()).meta;
  } catch {}
  metaCache.set(id, meta);
  return meta;
}

/* The "up" link every page but the top one carries, above its title. */
async function upLinkHTML(id, meta) {
  const up = upTarget(id, meta);
  if (!up || up === id) return '';
  const parent = await loadMeta(up);
  if (!parent) return '';
  return `<p class="up-link"><a href="#" data-action="open:${escInlineAttr(up)}">`
    + `↑ ${esc(parent.title || up)}</a></p>`;
}

async function loadContent(id) {
  if (contentCache.has(id)) return contentCache.get(id);
  const res = await fetchFresh('content/' + id);
  if (!res.ok) throw new Error(`Failed to load content/${id}: ${res.status}`);
  const { meta, body } = parseFrontmatter(await res.text());
  const rec = { meta, html: mdToHtml(body, meta, await upLinkHTML(id, meta)) };
  contentCache.set(id, rec);
  windowTitles.set(id, meta.title || id);
  return rec;
}

/* Rendered markdown that has just been put into a window: fill in the build
 * stamps, and let a picture the window is showing smaller than its file offer
 * that file in a new browser window (assets/js/image-zoom.js). The images are
 * re-measured as the window is resized, so this is the only call it needs. */
function contentMounted(root) {
  populateBuildStamps(root);
  window.ClackImageZoom?.enhance(root);
}

/* An app: link shows its application's icon, and an external link that ClackOS
 * can display opens in the in-OS browser or PDF reader instead of a new tab.
 * Both need desktop state, so the renderer calls back into here. */
window.ClackMarkdown.configure({
  appIconHTML: page => iconHTML(appDefs.get(page)?.icon || 'app-windows'),
  webViewerAppId
});

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
    /* An in-page anchor is handled by the data-anchor scroller, not here.
     * anchor.href resolves "#section" against the document, so it has to be
     * caught by the attribute — the resolved URL looks like an ordinary page. */
    if (anchor.dataset.anchor || (anchor.getAttribute('href') || '').startsWith('#')) return;
    const safe = safeWebUrl(anchor.href, false);
    if (!/^https?:/i.test(safe)) return;   /* mailto:, tel: — leave alone */
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
  desktop.style.removeProperty('background-image');
  desktop.style.setProperty('--desktop-wallpaper-image', wp.image);
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

/* smallest a window may be dragged to — also the floor the responsive
 * shrink below will not push a window past (unless the desktop itself is
 * narrower than that, in which case the desktop wins) */
const MINW = 320, MINH = 180;
/* largest a window opens at when its size is relative to the desktop: on a
 * very wide browser window a percentage would give an absurdly large window,
 * so relative sizes stop growing here. The width is the 640px text column
 * ('.page' in content.css) plus about 20%, leaving a gutter either side of
 * the page's own padding. Explicit pixel sizes in frontmatter, dragging,
 * resizing and maximising are all unaffected. */
const MAXW = 770, MAXH = 800;
/* a document window that asks for no particular size opens as a tall column
 * down the left of the desktop: DOC_W wide (the 640px text column in
 * content.css plus a comfortable gutter) and clear of the desktop edges — so
 * of the menubar and taskbar too — by DOC_MARGIN */
const DOC_W = 800, DOC_MARGIN = 10;
/* breathing room kept between a shrunk window and the desktop edges */
const FIT_MARGIN = 16;

/* Every window remembers the box it was last *put* at deliberately — opened,
 * dragged, resized, tidied or restored. A browser window that gets smaller
 * shrinks windows to fit inside it; one that gets bigger lets them grow back
 * towards this remembered box but never past it, so a window is only ever as
 * large as someone asked for it to be. */
function rememberWindowBox(rec) {
  if (!rec || rec.maxed) return;
  const el = rec.el;
  /* a minimised window has no layout to read — keep the box it had */
  if (!el.offsetWidth || !el.offsetHeight) return;
  rec.desired = {
    left: el.offsetLeft, top: el.offsetTop,
    width: el.offsetWidth, height: el.offsetHeight
  };
}

/* Every app is also a complete standalone page, so a window running one can
 * offer the way back out to it: File > Open app in new tab, added to the app's
 * own menu bar once it is mounted. The item only exists inside the desktop —
 * the standalone page it points at has no reason to link to itself.
 *
 * Apps marked "plain": false in menu.json are desktop-only (they drive the
 * shell's wallpaper, palette or window contents) and would do nothing opened
 * on their own, so they are skipped here exactly as the plain mirror skips
 * them. Every other app gets the item, including the full-window ones with no
 * menu bar of their own — those are given a bar to hold it.
 *
 * The bar itself, and the File menu the item goes in, come from
 * assets/js/app-bar.js: the same code makes the bar for the link an app opened
 * on its own puts back the other way, to the desktop. */
const STANDALONE_LINK_CLASS = 'rm-standalone-link';

function addStandaloneAppLink(root, pageUrl, def) {
  if (!root || def?.plain === false) return;
  if (root.querySelector('.' + STANDALONE_LINK_CLASS)) return;
  const bar = window.ClackOSAppBar?.ensureBar(root);
  if (!bar) return;
  const dd = window.ClackOSAppBar.ensureFileMenu(root, bar).querySelector(':scope > .rm-dd');
  if (!dd) return;

  const doc = root.ownerDocument || root;
  if (dd.childElementCount) {
    const sep = doc.createElement('div');
    sep.className = 'sep';
    dd.appendChild(sep);
  }
  const link = doc.createElement('a');
  link.className = STANDALONE_LINK_CLASS;
  link.href = pageUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.innerHTML = '<span class="pixel-icon" data-icon="open" aria-hidden="true"></span>Open app in new tab';
  link.addEventListener('click', () => {
    bar.querySelectorAll('.rm.open').forEach(menu => menu.classList.remove('open'));
  });
  dd.appendChild(link);
}

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
    host.dataset.sourceUrl = sourceUrl.href;

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
      .modal, .paint-modal, .clack-fm-modal { position: absolute; }
      .paint-modal-box { width: min(520px, 92%); max-height: 82%; }
      .paint-dialog { width: min(410px, 92%); }
      .clack-fm-window { width: min(980px, 96%); height: min(680px, 92%); min-height: min(420px, 100%); }
    `;
    root.appendChild(nativeStyle);
    await Promise.all(styleLoads);

    /* Standalone apps often keep shared dependencies in <head>.  An iframe
     * loads those naturally; an integrated app has to load them explicitly
     * before its body script starts.  Reuse dependencies already present in
     * ClackOS so opening another instance does not evaluate them twice. */
    for (const oldScript of source.head.querySelectorAll('script')) {
      const rawSrc = oldScript.getAttribute('src');
      if (rawSrc) {
        const src = new URL(rawSrc, sourceUrl).href;
        const perInstance = oldScript.hasAttribute('data-integrated-instance');
        if (!perInstance && [...document.scripts].some(existing => existing.src === src)) continue;
        await new Promise(resolve => {
          const script = document.createElement('script');
          for (const attr of oldScript.attributes) script.setAttribute(attr.name, attr.value);
          script.src = src;
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', resolve, { once: true });
          document.head.appendChild(script);
        });
      } else {
        const script = document.createElement('script');
        for (const attr of oldScript.attributes) script.setAttribute(attr.name, attr.value);
        script.textContent = oldScript.textContent;
        window.ClackOSMountRoot = root;
        document.head.appendChild(script);
        script.remove();
        delete window.ClackOSMountRoot;
      }
    }

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

    /* Integrated menus are real descendants of the window body, unlike menus
     * inside an iframe. Let them paint beyond the body while they are open,
     * then restore the body's normal scrolling as soon as they close. Watching
     * class changes also covers nested menus that open on hover. */
    const syncMenuOverflow = () => {
      body.classList.toggle('integrated-menu-open', Boolean(root.querySelector('.rm.open')));
    };
    const menuObserver = new MutationObserver(syncMenuOverflow);
    menuObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });
    onClose(() => menuObserver.disconnect());
    syncMenuOverflow();

    /* menus opening on hover, listening on this root rather than the document
     * (see assets/js/app-menu.js) */
    window.ClackOSMenus?.install(root);

    bindWebLinkRouting(root);
    addStandaloneAppLink(root, sourceUrl.href, appDefs.get(launchPage.split(/[?#]/)[0]));
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
    unminimiseWindow(existing);
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
      minHeight: def.minHeight,
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
      /* device access is delegated to the frame only where a menu entry asks
       * for it: an app that talks to hardware (MIDI, serial) names the
       * permissions it needs in menu.json rather than having them assumed */
      if (def.allow) f.allow = def.allow;
      else if (page === 'applications/clackbase.html') f.allow = 'midi';
      /* clicks inside the app should still raise its window */
      f.addEventListener('load', () => {
        try {
          applyThemeToFrame(f);
          bindWebLinkRouting(f.contentDocument);
          addStandaloneAppLink(f.contentDocument, new URL(f.getAttribute('src'), location.href).href, def);
          /* clicking into an app also hands it the keyboard: apps that render
           * to a canvas (emulators) never take focus on their own */
          f.contentDocument.addEventListener('pointerdown', () => {
            closeMenus();          /* clicking into an app is "outside" the desktop menus */
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
  const windowMinHeight = Math.max(MINH, parseInt(meta.minHeight, 10) || MINH);
  el.style.setProperty('--window-min-height', windowMinHeight + 'px');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);

  /* windows open at 80% of the desktop unless frontmatter says otherwise;
   * width/height accept px numbers or percentages ("width: 60%"). Sizes
   * relative to the desktop are capped at MAXW/MAXH so a very wide browser
   * window gives a sensibly sized window rather than a huge one. */
  const sizeOf = (v, avail, cap) => {
    v = v == null ? '' : String(v);
    if (v.trim().endsWith('%')) return Math.round(Math.min(avail * parseFloat(v) / 100, cap));
    const n = parseInt(v, 10);
    return Math.min(n || Math.round(Math.min(avail * 0.8, cap)), avail - 24);
  };
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  /* a document asking for no size of its own gets the tall left-hand column;
   * anything with a width or height in frontmatter is sized and centred as
   * before, apps included */
  const isDoc = !id.startsWith('app:') && meta.width == null && meta.height == null;
  const w = isDoc ? Math.min(DOC_W, dw - DOC_MARGIN * 2) : sizeOf(meta.width, dw, MAXW);
  const h = isDoc ? dh - DOC_MARGIN * 2 : sizeOf(meta.height, dh, MAXH);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  if (isDoc) {
    /* pinned to the top-left margin, stepped right for each window after it
       so a stack of documents is still separable by its titlebars */
    el.style.left = Math.min(DOC_MARGIN + spawnOffset, Math.max(DOC_MARGIN, dw - w - DOC_MARGIN)) + 'px';
    el.style.top = DOC_MARGIN + 'px';
  } else {
    /* centred, stepped along for the next one, but never stepped off the desktop:
       a window as wide as the desktop would otherwise hang over the right edge */
    el.style.left = Math.max(12, Math.min((dw - w) / 2 + spawnOffset, dw - w - 12)) + 'px';
    el.style.top = Math.max(12, Math.min((dh - h) / 2 - 20 + spawnOffset, dh - h - 12)) + 'px';
  }
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
  const rec = { id, el, icon: meta.icon, minHeight: windowMinHeight, minimised: false, maxed: null, cleanups: [] };
  /* Held before the app mounts: apps ask for their state as they start up. */
  if (restore && restore.state !== undefined) rec.state = restore.state;
  windows.set(id, rec);

  const winbody = el.querySelector('.winbody');
  if (mount) mount(winbody, { onClose: fn => rec.cleanups.push(fn) });
  else { winbody.innerHTML = contentHtml; contentMounted(winbody); }

  const titlebar = el.querySelector('.titlebar');

  /* Apps that know their own natural size can ask the window to wrap around
   * them: dispatch a composed, bubbling `clackos-resize` carrying the window
   * body size they want in `detail.width` / `detail.height`. */
  el.addEventListener('clackos-resize', event => {
    const { width, height } = event.detail || {};
    fitWindowToContent(rec, width, height);
  });

  el.addEventListener('pointerdown', () => focusWindow(el));

  /* rec.id, not the id this window opened with: following a link inside the
   * window re-keys it under the page it navigated to, so a captured id would
   * name a window that is no longer in the map and these buttons would go dead */
  el.querySelector('.dot.close').addEventListener('click', e => { e.stopPropagation(); closeWindow(rec.id); });
  el.querySelector('.dot.min').addEventListener('click', e => { e.stopPropagation(); minimiseWindow(rec.id); });
  el.querySelector('.dot.max')?.addEventListener('click', e => { e.stopPropagation(); toggleMax(rec.id); });

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
      rememberWindowBox(rec);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /* resize — all edges and corners */
  el.querySelectorAll('.rs').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      focusWindow(el);
      document.body.classList.add('win-drag');
      const dir = handle.dataset.dir;
      /* the floor gives way on a desktop too small to hold it */
      const minW = Math.min(MINW, desktop.clientWidth - FIT_MARGIN);
      const minH = Math.min(rec.minHeight, desktop.clientHeight - FIT_MARGIN);
      const startX = e.clientX, startY = e.clientY;
      const orig = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const move = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        let { l, t, w, h } = orig;
        if (dir.includes('e')) w = Math.max(minW, orig.w + dx);
        if (dir.includes('s')) h = Math.max(minH, orig.h + dy);
        if (dir.includes('w')) {
          w = Math.max(minW, orig.w - dx);
          l = orig.l + (orig.w - w);
        }
        if (dir.includes('n')) {
          h = Math.max(minH, orig.h - dy);
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
        rememberWindowBox(rec);
        scheduleSessionSave();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });

  focusWindow(el);
  rememberWindowBox(rec);
  /* a window opened on a desktop too small for it starts out squeezed, and
   * knows the size to grow back to if the browser is widened */
  fitWindowToDesktop(rec);
  if (restore) applyWindowEntry(rec, restore);
  updateTaskbar();
  /* last, so the window expands from the box it has actually settled at */
  animateOpen(rec);
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
  const minH = Math.min(rec.minHeight || MINH, dh - 16);
  const h = contentHeight == null ? el.offsetHeight
    : Math.max(minH, Math.min(Math.round(contentHeight) + frameH, dh - 16));
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.max(8, Math.min(el.offsetLeft, dw - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(el.offsetTop, dh - h - 8)) + 'px';
  rememberWindowBox(rec);
}

/* Size one window against the desktop it currently sits on: never wider or
 * taller than the box it was last deliberately given, never larger than the
 * desktop can hold, and kept fully on screen. Shrinking the browser squeezes
 * windows down; widening it lets them ease back out to — and stop at — the
 * size they had before. */
function fitWindowToDesktop(rec) {
  const el = rec.el;
  const dw = desktop.clientWidth, dh = desktop.clientHeight;
  if (rec.maxed) {
    /* a maximised window simply follows the desktop */
    el.style.left = '8px';
    el.style.top = '8px';
    el.style.width = (dw - 16) + 'px';
    el.style.height = (dh - 16) + 'px';
    return;
  }
  const want = rec.desired;
  if (!want) return;
  /* the CSS minimum ('.window' min-width/min-height) is itself capped to the
   * desktop, so this can shrink a window the whole way down on a phone */
  const w = Math.round(Math.min(want.width, dw - FIT_MARGIN));
  const minH = Math.min(rec.minHeight || MINH, dh - FIT_MARGIN);
  const h = Math.round(Math.max(minH, Math.min(want.height, dh - FIT_MARGIN)));
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = Math.round(Math.max(0, Math.min(want.left, dw - w - 8))) + 'px';
  el.style.top = Math.round(Math.max(0, Math.min(want.top, dh - h - 8))) + 'px';
}

function focusWindow(el) {
  zTop += 1;
  el.style.zIndex = zTop;
  document.querySelectorAll('.window').forEach(w => w.classList.toggle('inactive', w !== el));
  updateTaskbar();
}

/* The window record a node sits in, if any. */
function windowOf(node) {
  const el = node.closest?.('.window');
  return el ? [...windows.values()].find(rec => rec.el === el) || null : null;
}

/* Follow a markdown link inside an open window: the window keeps its place,
 * size and stacking and swaps its content, title and icon for the page it was
 * pointed at — the window id is the content path, so it moves with it. A page
 * already open in another window is raised instead of being duplicated. */
async function navigateWindow(rec, id) {
  if (rec.id === id) return;
  const open = windows.get(id);
  if (open) {
    unminimiseWindow(open);
    updateTaskbar();
    return;
  }
  let content;
  try {
    content = await loadContent(id);
  } catch (err) {
    console.error(err);
    return;
  }
  windows.delete(rec.id);
  rec.id = id;
  windows.set(id, rec);

  const title = content.meta.title || id;
  rec.icon = safeIconName(content.meta.icon) || windowIcons.get(id) || 'file-text';
  rec.el.setAttribute('aria-label', title);
  rec.el.querySelector('.title').innerHTML =
    `${iconHTML(rec.icon, 'title-icon')}<span class="title-label">${esc(title)}</span>`;
  rec.el.querySelector('.dot.close').setAttribute('aria-label', `Close ${title}`);
  rec.el.querySelector('.dot.min').setAttribute('aria-label', `Minimise ${title}`);
  rec.el.querySelector('.dot.max')?.setAttribute('aria-label', `Maximise ${title}`);

  const winbody = rec.el.querySelector('.winbody');
  winbody.innerHTML = content.html;
  contentMounted(winbody);
  winbody.scrollTop = 0;
  focusWindow(rec.el);
  updateTaskbar();
  scheduleSessionSave();
}

/* ---------------- Window animations ----------------
 * Three moments in a window's life have a movement of their own: closing
 * dissolves it into the desktop a block of pixels at a time, minimising
 * shrinks it into its taskbar button, and arriving — a new window, one coming
 * back out of the taskbar, or one being maximised — expands it into place.
 *
 * All of it is decoration. Every routine below hands control straight back to
 * its caller when it cannot run, so a browser without the Web Animations API
 * or CSS masking, and a visitor who has asked for less movement, get exactly
 * the same desktop with the movement left out.
 */

/* The dissolve works at the finest grain the screen has — one noise pixel per
 * device pixel — so a mask the size of the window is far too expensive to
 * re-encode on every step: a full-window PNG costs 20-60ms each time. The
 * noise is a tile of this many pixels repeated across the window instead,
 * which encodes in a couple of milliseconds. At single-pixel grain the repeat
 * is not something the eye picks up in four hundred milliseconds.
 *
 * The tile is this size in device pixels, not CSS pixels: it is drawn smaller
 * on a dense display rather than larger, so the grain stays one noise pixel
 * per device pixel while the encoding costs the same on every screen. A tile
 * scaled up for a retina display costs four times as much to encode, which is
 * more than a step's worth of frame budget on a slower encoder. */
const DISSOLVE_TILE = 256;
/* how many steps clear the window, and how long the whole thing takes */
const DISSOLVE_STEPS = 20, DISSOLVE_MS = 420;
/* minimise/restore travel, a new window arriving, a maximise toggle */
const TRAVEL_MS = 220, OPEN_MS = 160, RESIZE_MS = 200;
/* the desktop's own easings: out of the way quickly, back in gently */
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.75, 0.6)';
const EASE_IN = 'cubic-bezier(0.2, 0.8, 0.3, 1)';

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/* Movement is skipped for a visitor who has asked for less of it, and while a
 * saved desktop is being rebuilt — a restored session should simply be there
 * rather than animate a dozen windows into existence at boot. */
function motionOff() {
  return sessionRestoring || reducedMotion?.matches === true;
}

/* …and on anything without the Web Animations API, which is what everything
 * but the dissolve is built on. */
function canAnimate() {
  return !motionOff() && typeof Element.prototype.animate === 'function';
}

/* One animation at a time per window: starting another cancels whatever the
 * previous click left running, and the class keeps the CSS transition on
 * `.window` from fighting the keyframes. */
function runWindowAnim(rec, frames, options) {
  const el = rec.el;
  try { rec.anim?.cancel(); } catch {}
  el.classList.add('animating');
  const anim = el.animate(frames, { fill: 'none', ...options });
  rec.anim = anim;
  /* a cancel arrives after its replacement has been recorded, so only the
     animation still holding the slot is allowed to clean up after itself */
  const settle = () => {
    if (rec.anim !== anim) return;
    rec.anim = null;
    el.classList.remove('animating');
  };
  anim.addEventListener('finish', settle);
  anim.addEventListener('cancel', settle);
  return anim;
}

/* The taskbar button a window minimises into and comes back out of. */
function taskRectFor(id) {
  const button = [...tasksEl.children].find(node => node.dataset.windowId === id);
  return button ? button.getBoundingClientRect() : null;
}

/* Keyframes running between the window's own box and its taskbar button.
 * `into` picks the direction; null means there is nothing to travel to. */
function travelFrames(rec, into) {
  const from = rec.el.getBoundingClientRect();
  const to = taskRectFor(rec.id);
  if (!to || !to.width || from.width < 2 || from.height < 2) return null;
  const docked = {
    transformOrigin: 'top left',
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) ` +
      `scale(${to.width / from.width}, ${to.height / from.height})`,
    opacity: 0.2
  };
  const open = { transformOrigin: 'top left', transform: 'none', opacity: 1 };
  return into ? [open, docked] : [docked, open];
}

/* Minimise: down into the taskbar, then `hide` takes the window out of the
 * layout. A restore part-way through cancels this, and `hide` never runs. */
function animateMinimise(rec, hide) {
  const frames = canAnimate() ? travelFrames(rec, true) : null;
  if (!frames) { hide(); return; }
  runWindowAnim(rec, frames, { duration: TRAVEL_MS, easing: EASE_OUT })
    .addEventListener('finish', hide);
}

/* Restore: back out of the taskbar button to the box it left behind. */
function animateRestore(rec) {
  const frames = canAnimate() ? travelFrames(rec, false) : null;
  if (frames) runWindowAnim(rec, frames, { duration: TRAVEL_MS, easing: EASE_IN });
}

/* A window opening expands onto the desktop from just under its full size. */
function animateOpen(rec) {
  if (!canAnimate()) return;
  runWindowAnim(rec, [
    { transform: 'scale(0.9)', opacity: 0 },
    { transform: 'none', opacity: 1 }
  ], { duration: OPEN_MS, easing: EASE_IN });
}

/* Maximise and un-maximise move and resize in one go. `apply` sets the new box
 * immediately and the window is then animated from where it just was, so the
 * content inside is laid out once instead of on every frame. */
function animateBoxChange(rec, apply) {
  const el = rec.el;
  const from = el.getBoundingClientRect();
  apply();
  if (!canAnimate()) return;
  const to = el.getBoundingClientRect();
  if (from.width < 2 || from.height < 2 || to.width < 2 || to.height < 2) return;
  runWindowAnim(rec, [
    {
      transformOrigin: 'top left',
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) ` +
        `scale(${from.width / to.width}, ${from.height / to.height})`
    },
    { transformOrigin: 'top left', transform: 'none' }
  ], { duration: RESIZE_MS, easing: EASE_IN });
}

function maskSupported() {
  return typeof CSS === 'object' && typeof CSS.supports === 'function' &&
    (CSS.supports('mask-image', 'linear-gradient(#000, #000)') ||
     CSS.supports('-webkit-mask-image', 'linear-gradient(#000, #000)'));
}

/* mask-image is still prefixed in Safari; both spellings are written and the
 * one the browser does not know is ignored. `layout` is set once, up front;
 * after that only the image changes. */
function setMask(el, image, layout) {
  for (const property of ['mask', 'webkitMask']) {
    if (image != null) el.style[property + 'Image'] = image;
    if (!layout) continue;
    el.style[property + 'Size'] = layout.size;
    el.style[property + 'Repeat'] = layout.repeat;
    /* the drop shadow is drawn outside the border box, which is where a mask
       would otherwise stop: no-clip keeps it in the dissolve instead of
       cutting it away the moment the mask is applied */
    el.style[property + 'Clip'] = 'no-clip';
  }
}

/* Close: the window leaves the way a 1980s desktop did it, one pixel at a time
 * in a random order. The whole window is masked by a tile of noise that has
 * more of itself rubbed out on each step, so the desktop shows through the
 * holes — chrome, shadow and content together, no matter what is inside. */
function dissolveWindow(rec, done) {
  const el = rec.el;
  /* a minimised window has no box to dissolve */
  const roomToDissolve = el.offsetWidth >= 2 && el.offsetHeight >= 2 &&
    maskSupported() && !motionOff();
  const ctx = roomToDissolve ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) {
    /* nothing to dissolve with, or no appetite for movement: the plain fade */
    el.classList.add('fade-out');
    setTimeout(done, motionOff() ? 0 : 160);
    return;
  }

  /* one noise pixel per device pixel, so nothing is resampled on its way to
   * the screen and the dissolve is as fine as the display can draw: the tile
   * is always the same image, laid down smaller the denser the display */
  const scale = Math.min(Math.max(Math.round(window.devicePixelRatio || 1), 1), 3);
  const side = DISSOLVE_TILE;
  const tile = side / scale;
  const total = side * side;
  const canvas = ctx.canvas;
  canvas.width = canvas.height = side;
  const noise = ctx.createImageData(side, side);
  /* one 32-bit write per pixel: opaque white to start, so the whole window
     shows through, and zero — transparent — once a pixel has gone */
  const mask = new Uint32Array(noise.data.buffer);
  mask.fill(0xffffffff);

  /* the order the pixels go in — a plain shuffle, which is what the
     pseudo-random dissolves of the era looked like anyway */
  const order = new Uint32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }

  el.classList.add('dissolving');
  setMask(el, null, { size: `${tile}px ${tile}px`, repeat: 'repeat' });

  /* Handing the mask a freshly encoded image is not the end of it: Firefox
   * decodes the images CSS asks for off the main thread, and a mask layer
   * whose image has not arrived yet contributes nothing — the window is not
   * half dissolved, it is gone. Chrome and Safari decode a data URL on the
   * spot, which is why the same code dissolves there and blinks out here.
   *
   * So each step's tile is decoded before it is given to the mask, and the
   * next one is not encoded until the last has landed: a browser that cannot
   * keep up takes the window out in fewer, coarser steps instead of losing
   * the dissolve altogether. `latest` keeps the newest frame's image alive
   * until it has been painted, and drops any that decode out of order. */
  let latest = null, waiting = false;
  const showFrame = () => {
    ctx.putImageData(noise, 0, 0);
    const url = canvas.toDataURL();
    const image = new Image();
    latest = image;
    waiting = true;
    const paint = () => {
      if (latest !== image) return;
      waiting = false;
      if (el.isConnected) setMask(el, `url("${url}")`);
    };
    image.src = url;
    /* decode() rejects on a detached document as readily as on a bad image,
       and either way the frame is no worse off painted than skipped */
    if (typeof image.decode === 'function') image.decode().then(paint, paint);
    else paint();
  };

  let cleared = 0, step = 0;
  const start = performance.now();
  const tick = now => {
    if (!el.isConnected) return;
    const elapsed = now - start;
    const due = Math.min(DISSOLVE_STEPS, Math.ceil(elapsed / (DISSOLVE_MS / DISSOLVE_STEPS)));
    if (due > step && !waiting) {
      step = due;
      const target = Math.round(total * step / DISSOLVE_STEPS);
      for (; cleared < target; cleared++) mask[order[cleared]] = 0;
      showFrame();
    }
    /* the last step clears the tile completely, so there is nothing left to
       see and the window goes; the deadline is there so a browser that never
       manages to decode a frame still gets the window off the desktop */
    if ((step >= DISSOLVE_STEPS && !waiting) || elapsed > DISSOLVE_MS * 3) done();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function closeWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.cleanups.forEach(fn => { try { fn(); } catch {} });
  /* the window stops counting as open the moment it is asked to close: the
   * taskbar loses its button now rather than when the dissolve has finished */
  rec.closing = true;
  try { rec.anim?.cancel(); } catch {}
  rec.el.classList.add('closing');
  windows.delete(id);
  updateTaskbar();
  dissolveWindow(rec, () => rec.el.remove());
}

function minimiseWindow(id) {
  const rec = windows.get(id);
  if (!rec || rec.minimised) return;
  rec.minimised = true;
  updateTaskbar();
  /* only taken out of the layout once it has finished shrinking into its
   * button — and not at all if it was restored or closed on the way down */
  animateMinimise(rec, () => {
    if (rec.minimised && !rec.closing) rec.el.style.display = 'none';
  });
}

/* Put a minimised window back on the desktop, expanding it out of its taskbar
 * button. Also the way an already-open window is raised, which is why the
 * animation only runs when there was something to come back from. */
function unminimiseWindow(rec) {
  const wasMinimised = rec.minimised;
  rec.el.style.display = 'flex';
  rec.minimised = false;
  focusWindow(rec.el);
  if (wasMinimised) animateRestore(rec);
}

function toggleMax(id) {
  const rec = windows.get(id);
  if (!rec) return;
  const el = rec.el;
  animateBoxChange(rec, () => {
    if (rec.maxed) {
      Object.assign(el.style, rec.maxed);
      rec.maxed = null;
      /* the desktop may have shrunk while the window was maximised */
      fitWindowToDesktop(rec);
    } else {
      rec.maxed = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      el.style.left = '8px';
      el.style.top = '8px';
      el.style.width = (desktop.clientWidth - 16) + 'px';
      el.style.height = (desktop.clientHeight - 16) + 'px';
    }
  });
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
  rememberWindowBox(rec);
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
  windows.forEach(rec => { if (rec.minimised) unminimiseWindow(rec); });
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
    /* a maximised window is stored at the size it will return to, plus a flag.
     * Otherwise the *desired* box is stored, not the on-screen one: a window
     * squeezed by a narrow browser should reopen at its full size on a wide
     * one, rather than being permanently shrunk by having once been viewed
     * small. */
    const box = rec.maxed || rec.desired || el.style;
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
  /* the saved box is what the window wants to be; fitWindowToDesktop then
   * squeezes it into the desktop it has landed on, and a later widening of the
   * browser lets it come back out to exactly this */
  rec.desired = rec.desired || { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  if (entry.w > 0 && !el.classList.contains('fixed')) {
    rec.desired.width = entry.w;
    rec.desired.height = entry.h;
  }
  if (Number.isFinite(entry.x)) {
    rec.desired.left = Math.max(0, entry.x);
    rec.desired.top = Math.max(0, entry.y);
  }
  fitWindowToDesktop(rec);
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
    /* the box a window minimises into and expands back out of */
    b.dataset.windowId = id;
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

/* Menus grow rightwards — a dropdown from its button, a fly-out from the item
 * that owns it — so in a narrow browser window the right-hand edge starts
 * cutting them off. Both are measured against that edge as they open and told
 * how much width is actually going spare (--room, see clackos.css); a menu
 * that doesn't fit narrows and wraps its labels instead of being clipped.
 * MENU_MIN_WIDTH is where narrowing stops, since a menu a few characters wide
 * is no more use than one running off the screen. */
const MENU_EDGE_GAP = 8;   /* leaves the pixel shadow clear of the window edge */
const MENU_MIN_WIDTH = 120;
const MENU_NATURAL_WIDTH = 220;   /* mirrors the min-width of .dropdown in the CSS */

/* room going spare to the right of x, and the CSS to spend it with: below its
 * natural width a menu is also told to trim its padding (.narrow) */
function fitTo(el, x) {
  const room = Math.max(window.innerWidth - MENU_EDGE_GAP - x, MENU_MIN_WIDTH);
  el.style.setProperty('--room', room + 'px');
  el.classList.toggle('narrow', room < MENU_NATURAL_WIDTH);
}

/* Sized as the menu opens rather than as a fly-out is hovered, so the list
 * never reflows under the pointer. A menu holding fly-outs gives up width for
 * one first — that way the fly-out lands beside it rather than on top of it —
 * and if even that leaves too little, the menu slides out from under its button
 * towards the left of the screen to buy the pair some more. */
function fitDropdown(menu, dd) {
  /* the dropdown is still display:none here, but it hangs off the menu button,
   * which is on screen and therefore measurable */
  const anchor = menu.getBoundingClientRect().left;
  const reserve = dd.querySelector('.submenu') ? MENU_MIN_WIDTH : 0;
  const left = Math.max(0, Math.min(anchor, window.innerWidth - MENU_EDGE_GAP - reserve - MENU_MIN_WIDTH));
  dd.style.left = (left - anchor) + 'px';
  fitTo(dd, left + reserve);
}

function fitSubmenu(sub) {
  /* a fly-out sits at left:100% of its .submenu wrapper, so the wrapper's right
   * edge is where it starts — again measurable before the fly-out is shown */
  fitTo(sub, sub.parentElement.getBoundingClientRect().right);
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
      /* CSS opens it on hover; a click toggles it so it works by tap too. Both
       * routes size it to the room available before it becomes visible. */
      wrap.addEventListener('pointerenter', () => fitSubmenu(sub));
      sb.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains('open');
        container.querySelectorAll('.submenu.open').forEach(s => s.classList.remove('open'));
        if (!wasOpen) { fitSubmenu(sub); wrap.classList.add('open'); }
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

  const open = () => {
    refreshDynamicItems();
    fitDropdown(m, dd);
    m.classList.add('open');
    menuOpen = true;
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = m.classList.contains('open');
    closeMenus();
    if (!wasOpen) open();
  });
  btn.addEventListener('pointerenter', () => {
    if (menuOpen && !m.classList.contains('open')) {
      closeMenus();
      open();
    }
  });

  return m;
}

document.addEventListener('click', closeMenus);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

/* The other half of that: a click on the desktop is "outside" for an app
 * running in an iframe too, but its document never sees the click, so the menu
 * it left open is closed from here (assets/js/app-menu.js, loaded by the app). */
document.addEventListener('pointerdown', () => {
  document.querySelectorAll('iframe.appframe').forEach(frame => {
    try { frame.contentWindow?.ClackOSCloseAppMenus?.(); } catch {}
  });
});

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
  /* A markdown link followed from inside a content window replaces that
   * window, the way a page follows a link — the menus still open windows. */
  const from = btn.closest('.winbody') && windowOf(btn);
  const target = btn.dataset.action.startsWith('open:') ? btn.dataset.action.slice(5) : '';
  if (from && target && !target.startsWith('app:') && !from.id.startsWith('app:'))
    navigateWindow(from, target);
  else runAction(btn.dataset.action);
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
  } else if (data?.type === 'clackos-focus-window') {
    /* an app asking for its window to come to the front — ClackPaint does this
     * when a dialog opens or closes, since a dialog dragged out of the window
     * sits on the desktop and must not be left behind another window */
    const rec = windows.get(windowIdFor(source));
    if (rec) focusWindow(rec.el);
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

/* The desktop is elastic: every window re-fits itself whenever the browser
 * window changes size. Coalesced into an animation frame so a slow drag of the
 * browser edge doesn't relayout every window on every pixel. */
let reflowPending = false;
function reflowWindows() {
  if (reflowPending) return;
  reflowPending = true;
  requestAnimationFrame(() => {
    reflowPending = false;
    windows.forEach(fitWindowToDesktop);
    /* a menu left open across the resize is re-fitted to the new window */
    menubar.querySelectorAll('.menu.open').forEach(m => fitDropdown(m, m.querySelector('.dropdown')));
    menubar.querySelectorAll('.submenu.open > .dropdown.sub').forEach(sub => fitSubmenu(sub));
  });
}
window.addEventListener('resize', reflowWindows);
/* orientation changes and mobile browser chrome sliding away don't always fire
 * a resize; watching the desktop itself catches those too */
if (window.ResizeObserver) new ResizeObserver(reflowWindows).observe(desktop);
})();
