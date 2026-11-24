/* The way back to the desktop from an app opened on its own.
 *
 * Every app under content/ is a complete page, linkable and reachable from the
 * plain mirror and from search, so someone can arrive at one having never seen
 * ClackOS — and with nothing on the page saying where it came from. This puts a
 * "ClackOS" link at the head of the app's menu bar, giving the full-window apps
 * with no bar of their own one to hold it (assets/js/app-bar.js).
 *
 * It is the mirror of the link ClackOS adds the other way, File > Open app in
 * new tab, and appears in exactly the cases that one does not: only when the
 * app *is* the page. An app inside a ClackOS window is either an iframe or
 * mounted into the desktop document, and both already have the desktop around
 * them.
 *
 * An app on its own also has no desktop to take a palette from, so this gives
 * it one, and a Theme menu beside the home link to change it. The palette it
 * starts in is, in order: the one named by ?theme= (ClackOS writes the
 * desktop's live theme into File > Open app in new tab, so the tab opens
 * looking like the window it came from), then the desktop's saved choice in
 * this browser, then the site default from content/site.json. Picking one from
 * the menu changes this tab only — it is written back into ?theme= so a reload
 * keeps it, but never into the desktop's own setting, which is the Appearance
 * app's job. */
(function () {
  const HOME_CLASS = 'rm-home';

  /* an app in a window: an iframe, or (integrated apps) a script this page's
   * markup carries, running in the desktop document with the mount root set */
  if (window.parent !== window || window.ClackOSMountRoot) return;

  /* An integrated app's scripts are loaded into the desktop document, where
   * the mount root is only set around the app's own inline setup — so ask
   * where the *document* came from: an app page is under content/, the desktop
   * is the site root. This also keeps the link off any other page that happens
   * to load this script. */
  const path = location.pathname;
  const marker = path.lastIndexOf('/content/');
  if (marker < 0) return;

  /* one ../ per directory between the app page and the site root, so the link
   * is right for content/applications/paint.html and for the apps a directory
   * deeper alike, and works on file:// as well as over http */
  const depth = path.slice(marker + 1).split('/').length - 1;
  /* ?open= asks the desktop to open this app in a window when it boots, so the
   * link lands on the desktop with the app you were using in front. The id is
   * the page's path under content/, which is what the desktop registers apps
   * by; a page that is not a registered app is simply ignored there. */
  const appId = 'app:' + path.slice(marker + '/content/'.length);
  const siteRoot = '../'.repeat(depth);
  const home = siteRoot + 'index.html?open=' + encodeURIComponent(appId).replace(/%2F/g, '/').replace(/%3A/g, ':');

  function addHomeLink() {
    if (document.querySelector('.' + HOME_CLASS)) return;
    const bar = window.ClackOSAppBar?.ensureBar(document);
    if (!bar) return;

    const link = document.createElement('a');
    link.className = HOME_CLASS;
    link.href = home;
    link.title = 'Back to the ClackOS desktop';
    link.innerHTML = '<span class="pixel-icon" data-icon="arrow-left" aria-hidden="true"></span>ClackOS';
    bar.prepend(link);
  }

  /* ---- Theme ----
   * The same names and the same checks as the desktop (assets/js/clackos.js):
   * a theme is a CSS file in assets/themes/ that sets the shared colour
   * variables, and its name is restricted to a plain filename so a query
   * string cannot point the stylesheet anywhere else. */
  const THEME_PARAM = 'theme';
  const THEME_KEY = 'clackos-theme';
  const THEME_COOKIE = 'clackos-theme-default';
  const safeTheme = name => /^[a-z0-9][a-z0-9._-]*\.css$/i.test(String(name || '')) ? String(name) : null;
  const themeLabel = name => {
    const base = name.replace(/\.css$/i, '');
    return base.charAt(0).toUpperCase() + base.slice(1);
  };
  let activeTheme = null;

  function readCookie(name) {
    const prefix = encodeURIComponent(name) + '=';
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    if (!item) return null;
    try { return decodeURIComponent(item.slice(prefix.length)); } catch { return null; }
  }

  /* what this tab was asked for: its own ?theme=, else the desktop's */
  function requestedTheme() {
    const fromUrl = safeTheme(new URLSearchParams(location.search).get(THEME_PARAM));
    if (fromUrl) return fromUrl;
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch {}
    return safeTheme(saved) || safeTheme(readCookie(THEME_COOKIE));
  }

  /* Apps that draw their own canvases read the palette from this event, the
   * same one ClackOS sends a themed iframe, so they repaint here too. */
  function announceTheme() {
    const styles = getComputedStyle(document.documentElement);
    const paper = styles.getPropertyValue('--paper').trim();
    const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(paper);
    const luminance = rgb
      ? (0.2126 * parseInt(rgb[1], 16) + 0.7152 * parseInt(rgb[2], 16) + 0.0722 * parseInt(rgb[3], 16)) / 255
      : 1;
    document.documentElement.dataset.theme = activeTheme.replace(/\.css$/i, '');
    document.documentElement.dataset.themeTone = luminance < 0.45 ? 'dark' : 'light';
    const variables = {};
    for (let i = 0; i < styles.length; i++) {
      const name = styles[i];
      if (name.startsWith('--')) variables[name] = styles.getPropertyValue(name).trim();
    }
    window.dispatchEvent(new CustomEvent('clackos-themechange', { detail: { theme: activeTheme, variables } }));
  }

  /* A wrapper app that runs its tool in a same-origin iframe (CircuitJS, the
   * vendored editors) has that frame themed by ClackOS on the desktop; this
   * does the same for the page on its own, including a frame that loads, or
   * reloads, after the theme was chosen. A cross-origin frame throws on the
   * contentDocument read and is left as it is. */
  const themedFrames = new WeakSet();
  function themeFrame(frame, href) {
    if (!themedFrames.has(frame)) {
      themedFrames.add(frame);
      frame.addEventListener('load', () => themeFrame(frame, currentHref));
    }
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
      if (link.href !== href) link.href = href;
      doc.documentElement.dataset.theme = activeTheme.replace(/\.css$/i, '');
    } catch {}
  }
  let currentHref = null;

  /* One stylesheet, id clackos-theme — the id ClackOS uses for a themed
   * iframe, and the one the pages that ship a palette of their own already
   * carry — appended last so its variables win over app.css's defaults. */
  function applyTheme(name) {
    activeTheme = name;
    let link = document.getElementById('clackos-theme');
    if (!link) {
      link = document.createElement('link');
      link.id = 'clackos-theme';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    const href = new URL(siteRoot + 'assets/themes/' + encodeURIComponent(name), location.href).href;
    currentHref = href;
    document.querySelectorAll('iframe').forEach(frame => themeFrame(frame, href));
    if (link.href === href && link.sheet) announceTheme();
    else {
      link.addEventListener('load', announceTheme, { once: true });
      link.addEventListener('error', announceTheme, { once: true });
      link.href = href;
    }
    document.querySelectorAll('.rm-theme-item').forEach(item => {
      item.setAttribute('aria-checked', String(item.dataset.theme === name));
    });
  }

  function chooseTheme(name) {
    applyTheme(name);
    const url = new URL(location.href);
    url.searchParams.set(THEME_PARAM, name);
    try { history.replaceState(history.state, '', url); } catch {}
  }

  function addThemeMenu(themes) {
    const bar = window.ClackOSAppBar?.ensureBar(document);
    if (!bar || bar.querySelector('.rm-theme-menu')) return;
    const menu = window.ClackOSAppBar.ensureMenu(document, bar, 'Theme');
    menu.classList.add('rm-theme-menu');
    const dd = menu.querySelector(':scope > .rm-dd');
    dd.setAttribute('role', 'menu');
    for (const name of themes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'rm-theme-item';
      item.dataset.theme = name;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(name === activeTheme));
      const tick = document.createElement('span');
      tick.className = 'rm-theme-tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.textContent = '✓';
      item.append(tick, themeLabel(name));
      item.addEventListener('click', () => {
        chooseTheme(name);
        menu.classList.remove('open');
      });
      dd.appendChild(item);
    }
  }

  /* The palette goes on straight away, ahead of the fetch, so the page does
   * not sit in the default colours while site.json is on its way; the list
   * then confirms it, falling back to the site default for a name that is no
   * longer offered. */
  async function setUpThemes() {
    const asked = requestedTheme();
    if (asked) applyTheme(asked);
    let site = null;
    try {
      const res = await fetch(siteRoot + 'content/site.json', { cache: 'no-cache' });
      if (res.ok) site = await res.json();
    } catch {}
    if (!site) return;
    const fallback = safeTheme(site.theme) || 'clackos.css';
    const themes = [...new Set([fallback, ...(site.themes || []).map(safeTheme)].filter(Boolean))];
    const chosen = asked && themes.includes(asked) ? asked : fallback;
    if (chosen !== activeTheme) applyTheme(chosen);
    addThemeMenu(themes);
  }

  function start() {
    addHomeLink();
    setUpThemes();
  }

  /* the script is deferred, so the bar the app wrote is already parsed; the
   * check keeps it working if a page ever loads it without defer */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
