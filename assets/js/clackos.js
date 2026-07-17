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
  '--window-inactive', '--title-text', '--accent-hover', '--button-text',
  '--disabled-text'
];
let activeTheme = 'clackos.css';
let themePreview = null;

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
}

function applyThemeToFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc?.head) return;
    let link = doc.getElementById('clackos-theme');
    if (!link) {
      link = doc.createElement('link');
      link.id = 'clackos-theme';
      link.rel = 'stylesheet';
      doc.head.appendChild(link);
    }
    link.href = themeHref(activeTheme);
    setPreviewOnDocument(doc, themePreview);
  } catch {}
}

function applyTheme(name) {
  activeTheme = safeThemeName(name);
  const link = document.getElementById('clackos-theme');
  if (link) {
    link.addEventListener('load', syncBrowserThemeColor, { once: true });
    link.href = themeHref(activeTheme);
  }
  document.documentElement.dataset.theme = activeTheme.replace(/\.css$/i, '');
  document.querySelectorAll('iframe.appframe').forEach(applyThemeToFrame);
}

function applyThemePreview(variables) {
  themePreview = variables && typeof variables === 'object' ? variables : null;
  setPreviewOnDocument(document, themePreview);
  document.querySelectorAll('iframe.appframe').forEach(frame => {
    try { setPreviewOnDocument(frame.contentDocument, themePreview); } catch {}
  });
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

/* Inline markdown: `code` -> keyword span, **bold**, *italic*, ![alt](src),
 * [text](href). Links may use window:<md-path> to open a content window,
 * app:<registered-page>?<options> to launch an application, or action:<name>
 * to run a desktop action; anything else is a normal external link. */
function inline(s) {
  s = esc(s);
  /* images become placeholder tokens so the link pass can wrap them */
  const imgs = [];
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    imgs.push(`<img src="${src}" alt="${alt}" loading="lazy">`);
    return `\x00${imgs.length - 1}\x00`;
  });
  s = s.replace(/`([^`]+)`/g, '<span class="k">$1</span>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    if (href.startsWith('window:'))
      return `<a href="#" data-action="open:${href.slice(7)}">${text.trim()}</a>`;
    if (href.startsWith('app:'))
      return `<a href="#" data-action="open:${href}">${text.trim()}</a>`;
    if (href.startsWith('action:'))
      return `<a href="#" data-action="${href.slice(7)}">${text.trim()}</a>`;
    return `<a href="${href}" target="_blank" rel="noopener">${text.trim()}</a>`;
  });
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => imgs[i]);
  return s;
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

  blocks.forEach((block, idx) => {
    const isLast = idx === blocks.length - 1;

    if (footerNext && isLast) {
      const spans = block.split(/\r?\n/).map(l => `<span>${inline(l)}</span>`).join('\n');
      out.push(`<footer>${spans}</footer>`);
      return;
    }
    footerNext = false;

    const fence = /^\x00fence(\d+)\x00$/.exec(block);
    if (fence) {
      out.push(fences[+fence[1]]);
    } else if (/^>\s?/.test(block)) {
      out.push(`<blockquote>${inline(block.replace(/^>\s?/gm, '')).replace(/\r?\n/g, '<br>')}</blockquote>`);
    } else if (/^##\s+/.test(block)) {
      out.push(`<p class="eyebrow">${inline(block.replace(/^##\s+/, ''))}</p>`);
    } else if (/^#\s+/.test(block)) {
      out.push(`<h1>${inline(block.replace(/^#\s+/, ''))}</h1>`);
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
    } else if (block.split(/\r?\n/).every(l => /^\[[^\]]+\]\([^)]+\)$/.test(l.trim()))) {
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

/* ---------------- Wallpapers ---------------- */
const svgTile = (w, h, body) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

const wallpapers = {
  'Sand dots': {
    color: '#e3ddc6',
    image: svgTile(16, 16, `<circle cx='1' cy='1' r='1' fill='#c2b998'/>`)
  },
  'Pebbles': {
    color: '#ddd5ba',
    image: svgTile(96, 96, `
      <g fill='#cfc5a3' stroke='#b7ac87' stroke-width='1.5'>
        <ellipse cx='22' cy='20' rx='15' ry='11' transform='rotate(-14 22 20)'/>
        <ellipse cx='68' cy='30' rx='18' ry='12' transform='rotate(9 68 30)'/>
        <ellipse cx='38' cy='62' rx='13' ry='16' transform='rotate(22 38 62)'/>
        <ellipse cx='80' cy='76' rx='12' ry='9' transform='rotate(-8 80 76)'/>
        <ellipse cx='10' cy='84' rx='9' ry='7' transform='rotate(15 10 84)'/>
      </g>
      <g fill='#e9e2c8'>
        <ellipse cx='19' cy='17' rx='6' ry='4' transform='rotate(-14 19 17)'/>
        <ellipse cx='63' cy='26' rx='7' ry='4' transform='rotate(9 63 26)'/>
        <ellipse cx='35' cy='56' rx='4' ry='6' transform='rotate(22 35 56)'/>
      </g>`)
  },
  'Cracked earth': {
    color: '#d9cfae',
    image: svgTile(90, 90, `
      <g stroke='#a3986f' stroke-width='2' fill='none' stroke-linecap='round'>
        <path d='M0,30 L26,36 L44,22 L66,34 L90,30'/>
        <path d='M45,0 L40,22 L52,50 L42,72 L45,90'/>
        <path d='M26,36 L14,60 L0,64'/>
        <path d='M90,64 L70,60 L52,50'/>
        <path d='M66,34 L74,14 L90,10'/>
        <path d='M0,10 L16,14 L26,36' stroke-width='1.4'/>
        <path d='M42,72 L20,80' stroke-width='1.4'/>
      </g>`)
  },
  'Fern weave': {
    color: '#dfd8bd',
    image: svgTile(64, 64, `
      <g stroke='#b9c4a0' stroke-width='2' fill='none'>
        <path d='M0,16 Q16,8 32,16 T64,16'/>
        <path d='M0,48 Q16,40 32,48 T64,48'/>
      </g>
      <g stroke='#9db388' stroke-width='2' fill='none'>
        <path d='M16,0 Q8,16 16,32 T16,64'/>
        <path d='M48,0 Q40,16 48,32 T48,64'/>
      </g>`)
  },
  'Circuit trace': {
    color: '#e0dac1',
    image: svgTile(80, 80, `
      <g stroke='#bcb28c' stroke-width='2' fill='none'>
        <path d='M0,20 H28 V52 H60 V80'/>
        <path d='M40,0 V16 H68 V44 H80'/>
      </g>
      <g fill='#a89d73'>
        <circle cx='28' cy='20' r='3.5'/><circle cx='28' cy='52' r='3.5'/>
        <circle cx='60' cy='52' r='3.5'/><circle cx='68' cy='16' r='3.5'/>
        <circle cx='68' cy='44' r='3.5'/>
      </g>`)
  },
  'Terrazzo': {
    color: '#e6dfc7',
    image: svgTile(72, 72, `
      <g fill='#c9bd94'>
        <path d='M12,10 l10,-4 l4,9 l-11,5 z'/>
        <path d='M52,20 l9,3 l-4,10 l-9,-4 z'/>
        <path d='M28,48 l8,-6 l7,7 l-9,6 z'/>
        <path d='M60,58 l7,2 l-3,8 l-7,-3 z'/>
      </g>
      <g fill='#a9bb95'>
        <path d='M40,6 l6,2 l-2,7 l-7,-2 z'/>
        <path d='M8,40 l7,-3 l4,7 l-8,4 z'/>
        <path d='M14,62 l8,1 l-1,7 l-8,-1 z'/>
      </g>`)
  }
};
let currentWallpaper = 'Sand dots';
const wallpaperDropdowns = [];

/* user-drawn 8x8 patterns (Desktop -> Edit pattern...), kept in localStorage */
const PAT_KEY = 'clackos-patterns';
const PAT_FG = '#7c7355', PAT_BG = '#e3ddc6';

function loadPatterns() {
  try { return JSON.parse(localStorage.getItem(PAT_KEY)) || {}; } catch { return {}; }
}
function savePatterns(map) {
  try { localStorage.setItem(PAT_KEY, JSON.stringify(map)); } catch {}
}
function patternWallpaper(rows) {
  let px = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++)
      if ((row >> (7 - x)) & 1)
        px += `<rect x='${x * 2}' y='${y * 2}' width='2' height='2' fill='${PAT_FG}'/>`;
  });
  return { color: PAT_BG, image: svgTile(16, 16, px) };
}
function getWallpaper(name) {
  if (wallpapers[name]) return wallpapers[name];
  const rows = loadPatterns()[name];
  return rows ? patternWallpaper(rows) : null;
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
  for (const name of [...Object.keys(wallpapers), ...Object.keys(loadPatterns())]) {
    const b = document.createElement('button');
    b.innerHTML = `<span>${name}</span><span class="check">${name === currentWallpaper ? '&#10003;' : ''}</span>`;
    b.addEventListener('click', () => { applyWallpaper(name); closeMenus(); });
    container.appendChild(b);
  }
}

/* ---------------- Windows ---------------- */
const windows = new Map();
/* apps are standalone pages under content/<menu>/ shown in an iframe;
 * defs are registered from menu.json entries at boot */
const appDefs = new Map();
let spawnOffset = 0;
let appInstances = 0;

async function openWindow(id) {
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
    const launchPage = id.slice(4);
    const page = launchPage.split(/[?#]/)[0];
    const def = appDefs.get(page);
    if (!def) return;
    /* multi-instance apps get a fresh window id on every open */
    if (def.multi) id = `${id}#instance-${++appInstances}`;
    meta = { title: def.title || def.label || page, width: def.width, height: def.height, fixed: def.fixed };
    windowTitles.set(id, meta.title);
    mount = body => {
      const f = document.createElement('iframe');
      f.className = 'appframe';
      f.src = 'content/' + launchPage;
      f.title = meta.title;
      if (page === 'applications/clackbase.html') f.allow = 'midi';
      /* clicks inside the app should still raise its window */
      f.addEventListener('load', () => {
        try {
          applyThemeToFrame(f);
          f.contentDocument.addEventListener('pointerdown', () => focusWindow(el));
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
    meta = content.meta;
    contentHtml = content.html;
  }
  const title = meta.title || id;

  const el = document.createElement('section');
  el.className = 'window';
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
  el.style.left = Math.max(12, (dw - w) / 2 + spawnOffset) + 'px';
  el.style.top = Math.max(12, (dh - h) / 2 - 20 + spawnOffset) + 'px';
  spawnOffset = (spawnOffset + 28) % 112;

  /* fixed windows keep their exact size: no resize handles, no maximise */
  const isFixed = meta.fixed === true || String(meta.fixed) === 'true';
  if (isFixed) el.classList.add('fixed');
  el.innerHTML = `
    <div class="titlebar">
      <button class="dot close" aria-label="Close ${title}"></button>
      <button class="dot min" aria-label="Minimise ${title}"></button>
      ${isFixed ? '' : `<button class="dot max" aria-label="Maximise ${title}"></button>`}
      <span class="title">${title}</span>
    </div>
    <div class="winbody"></div>
    ${isFixed ? '' : `
    <div class="rs n" data-dir="n"></div><div class="rs s" data-dir="s"></div>
    <div class="rs e" data-dir="e"></div><div class="rs w" data-dir="w"></div>
    <div class="rs ne" data-dir="ne"></div><div class="rs nw" data-dir="nw"></div>
    <div class="rs se" data-dir="se"></div><div class="rs sw" data-dir="sw"></div>`}
    <div class="frame" aria-hidden="true"></div>`;

  desktop.appendChild(el);
  const rec = { id, el, minimised: false, maxed: null, cleanups: [] };
  windows.set(id, rec);

  const winbody = el.querySelector('.winbody');
  if (mount) mount(winbody, { onClose: fn => rec.cleanups.push(fn) });
  else winbody.innerHTML = contentHtml;

  const titlebar = el.querySelector('.titlebar');

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
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });

  focusWindow(el);
  updateTaskbar();
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
function placeWindow(rec, left, top, width, height) {
  rec.maxed = null;
  const s = rec.el.style;
  s.left = Math.round(left) + 'px';
  s.top = Math.round(top) + 'px';
  if (width != null) s.width = Math.round(width) + 'px';
  if (height != null) s.height = Math.round(height) + 'px';
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
    b.innerHTML = `<span class="sq" aria-hidden="true"></span><span class="lbl">${title}</span>`;
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
}

/* ---------------- Menu bar (built from content/) ---------------- */
let menuOpen = false;

function closeMenus() {
  menubar.querySelectorAll('.menu').forEach(m => m.classList.remove('open'));
  menubar.querySelectorAll('.submenu').forEach(s => s.classList.remove('open'));
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
      sb.innerHTML = `${esc(item.label || '')} <span class="arrow" aria-hidden="true">▸</span>`;
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
      b.innerHTML = `${esc(item.label || '')} ${shortcut}`;
      if (item.disabled) b.disabled = true;
      if (item.type === 'window') b.dataset.action = `open:${folder}/${item.md}`;
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
    case 'toggle-taskbar': document.body.classList.toggle('no-taskbar'); break;
    case 'copy': {
      const sel = String(document.getSelection() || '');
      if (sel && navigator.clipboard) navigator.clipboard.writeText(sel).catch(() => {});
      break;
    }
    case 'restart': {
      document.body.style.transition = 'opacity 0.4s ease';
      document.body.style.opacity = '0';
      setTimeout(() => location.reload(), 420);
      break;
    }
  }
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  runAction(btn.dataset.action);
  closeMenus();
});

/* ---------------- Clock ---------------- */
function tick() {
  const d = new Date();
  document.getElementById('clock').textContent =
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

/* ---------------- Boot ---------------- */
async function boot() {
  let savedWp = null;
  try { savedWp = localStorage.getItem('clackos-wallpaper'); } catch {}
  applyWallpaper(savedWp && getWallpaper(savedWp) ? savedWp : 'Sand dots');
  updateTaskbar();

  const site = await loadJSON('content/site.json');
  applyTheme(site.theme);
  const defs = await Promise.all(
    site.menus.map(folder => loadJSON(`content/${folder}/menu.json`))
  );

  const clock = document.getElementById('clock');
  site.menus.forEach((folder, i) => {
    menubar.insertBefore(buildMenu(folder, defs[i]), clock);
  });

  for (const id of site.boot || []) await openWindow(id);
}

boot().catch(err => console.error('ClackOS failed to boot:', err));

/* The Theme Editor sends palette previews to the desktop. Only same-origin
 * application windows can change these variables, and only known hex colours
 * are accepted by applyThemePreview. */
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'clackos-theme-preview') return;
  applyThemePreview(e.data.variables);
});

/* app pages (pattern editor) talk to the desktop through localStorage;
 * same-origin iframes and other tabs raise storage events here */
window.addEventListener('storage', e => {
  if (e.key === PAT_KEY) {
    wallpaperDropdowns.forEach(buildWallpaperMenu);
    if (!wallpapers[currentWallpaper] && !getWallpaper(currentWallpaper)) applyWallpaper('Sand dots');
    else if (!wallpapers[currentWallpaper]) applyWallpaper(currentWallpaper);
  } else if (e.key === 'clackos-wallpaper' && e.newValue && e.newValue !== currentWallpaper) {
    applyWallpaper(e.newValue);
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
