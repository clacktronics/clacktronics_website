/* The app menu bar, shared by the two links that cross between an app and the
 * desktop.
 *
 * ClackOS adds "File > Open app in new tab" to an app it has mounted
 * (assets/js/clackos.js), and an app opened on its own adds the way back to the
 * desktop (assets/js/app-home.js). Both need the same two things — the app's
 * own menu bar, and a bar of the right look for the full-window apps that have
 * none — so that lives here, written to work on a document (an app in a tab or
 * in an iframe) and on a shadow root (an app mounted into the desktop) alike.
 *
 * Loaded by ClackOS and by the app pages themselves; whichever copy runs, the
 * URLs it writes into the injected stylesheet are resolved against this
 * script's own src, so they are right at either depth. */
(function () {
  const script = document.currentScript;
  const SITE_ROOT = new URL('../../', script ? script.src : location.href).href;
  const icon = name => `${SITE_ROOT}assets/icons/pixelarticons/${name}.svg`;
  const STYLE_ID = 'clackos-app-bar-style';

  /* Menu bar styling for apps that do not load assets/css/app.css (the
   * full-window vendor wrappers style themselves). Written with the same values
   * app.css uses, so an app that does load it looks no different. The icon
   * rules name the same custom property assets/css/icons.css does, so an app
   * that already has that stylesheet keeps its own icons. */
  const BAR_CSS = `
.rm-standalone-bar {
  flex: none; display: flex; gap: 2px; padding: 0 8px;
  background: var(--paper-deep, #e7e2d4); border-bottom: 1px solid var(--paper-line, #c9c2ae);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
.rm-standalone-bar .rm { position: relative; }
.rm-standalone-bar .rm > button {
  all: unset; cursor: pointer; padding: 8px 12px; font: inherit; font-size: 12px;
  color: var(--control-text, #2f2a1f);
}
.rm-standalone-bar .rm > button:hover, .rm-standalone-bar .rm.open > button {
  background: var(--ink, #2f2a1f); color: var(--menu-text, #f6f2e6);
}
.rm-standalone-bar .rm-dd {
  position: absolute; top: 100%; left: 0; min-width: 240px; z-index: 2147483000;
  background: var(--paper, #f6f2e6); border: 2px solid var(--ink, #2f2a1f);
  border-radius: 0 0 8px 8px; display: none; padding: 6px 2px;
}
.rm-standalone-bar .rm.open > .rm-dd { display: block; }
.rm-standalone-bar .rm-dd a {
  all: unset; box-sizing: border-box; display: flex; align-items: center; width: 100%;
  cursor: pointer; gap: 8px; padding: 7px 14px; font: inherit; font-size: 12px;
  color: var(--control-text, #2f2a1f); white-space: nowrap;
}
.rm-standalone-bar .rm-dd a:hover { background: var(--ink, #2f2a1f); color: var(--menu-text, #f6f2e6); }
.rm-standalone-bar .rm-dd a:focus-visible { outline: 2px solid var(--leaf, #4c7a4c); outline-offset: -2px; }
.rm-standalone-bar .rm-dd .sep { height: 1px; background: var(--paper-line, #c9c2ae); margin: 6px 0; }

/* the way back to the desktop, first thing in the bar of an app open on its
 * own — a real link, so it can be middle-clicked or copied like any other */
.rm-bar .rm-home {
  all: unset; box-sizing: border-box; cursor: pointer; flex: none;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--control-text, #2f2a1f);
}
.rm-bar .rm-home:hover { background: var(--ink, #2f2a1f); color: var(--menu-text, #f6f2e6); }
.rm-bar .rm-home:focus-visible { outline: 2px solid var(--leaf, #4c7a4c); outline-offset: -2px; }

/* the icons, for an app that does not load assets/css/icons.css either */
.rm-standalone-bar .pixel-icon, .rm-bar .rm-home .pixel-icon {
  display: inline-block; flex: none; width: 16px; height: 16px;
  background-color: currentColor;
  -webkit-mask: var(--pixel-icon) center / contain no-repeat;
  mask: var(--pixel-icon) center / contain no-repeat;
}
.rm-bar .rm-home .pixel-icon { width: 14px; height: 14px; }
.rm-standalone-bar .pixel-icon[data-icon="open"] { --pixel-icon: url('${icon('open')}'); }
.rm-bar .rm-home .pixel-icon[data-icon="arrow-left"] { --pixel-icon: url('${icon('arrow-left')}'); }

/* the app's shell keeps whatever layout the app had; the bar sits above it */
.rm-standalone-shell { flex: 1 1 auto; min-height: 0; min-width: 0; }
`;

  /* One copy per root: an app in a tab styles its own document, an app mounted
   * into the desktop styles its shadow root. */
  function ensureStyle(root) {
    const doc = root.ownerDocument || root;
    if (root.getElementById ? root.getElementById(STYLE_ID) : root.querySelector('#' + STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = BAR_CSS;
    (root.head || root).appendChild(style);
  }

  /* The bar an app gets when it has none: everything the app already had moves
   * into a shell below it, laid out the way the app laid itself out, so a
   * full-window canvas, iframe or sidebar still fills what is left. */
  function create(root) {
    const doc = root.ownerDocument || root;
    const view = doc.defaultView;
    const container = root.body || root;              /* document, or shadow root */
    const layoutSource = root.body || root.host;
    if (!container || !view || !layoutSource) return null;
    ensureStyle(root);

    const box = view.getComputedStyle(layoutSource);
    const shell = doc.createElement('div');
    shell.className = 'rm-standalone-shell';
    shell.style.display = box.display === 'inline' ? 'block' : box.display;
    shell.style.flexDirection = box.flexDirection;
    shell.style.alignItems = box.alignItems;
    /* stylesheets and scripts stay where they are — only what the app renders
     * moves, and moving a script node would run it a second time */
    for (const node of [...container.childNodes]) {
      if (['STYLE', 'LINK', 'SCRIPT'].includes(node.nodeName)) continue;
      shell.appendChild(node);
    }

    const bar = doc.createElement('nav');
    bar.className = 'rm-bar rm-standalone-bar';
    bar.setAttribute('aria-label', 'App menu');
    container.append(bar, shell);
    if (root.body) {
      root.body.style.display = 'flex';
      root.body.style.flexDirection = 'column';
      root.body.style.alignItems = 'stretch';
      if (!root.documentElement.style.height) root.body.style.minHeight = '100vh';
    } else {
      const hostStyle = doc.createElement('style');
      hostStyle.textContent = ':host { display: flex !important; flex-direction: column; }';
      root.appendChild(hostStyle);
    }
    return bar;
  }

  /* the app's bar, or one made for it */
  function ensureBar(root) {
    const existing = root.querySelector('.rm-bar');
    if (existing) {
      ensureStyle(root);
      return existing;
    }
    return create(root);
  }

  /* The app's own File menu if it has one, otherwise a new one at the head of
   * the menu bar, wired to open and close like the app's other menus. Apps bind
   * their menu toggles at load over the menus that existed then, so a menu added
   * afterwards brings its own behaviour. */
  function ensureFileMenu(root, bar) {
    const doc = root.ownerDocument || root;
    const label = menu => (menu.querySelector(':scope > button')?.textContent || '').trim().toLowerCase();
    const menus = [...bar.querySelectorAll(':scope > .rm')];
    const existing = menus.find(menu => label(menu) === 'file');
    if (existing) return existing;

    const menu = doc.createElement('div');
    menu.className = 'rm';
    menu.innerHTML = '<button>File</button><div class="rm-dd"></div>';
    bar.prepend(menu);

    menu.querySelector(':scope > button').addEventListener('click', event => {
      event.stopPropagation();
      const opening = !menu.classList.contains('open');
      bar.querySelectorAll('.rm.open').forEach(other => other.classList.remove('open'));
      if (opening) menu.classList.add('open');
    });
    /* another menu in the bar opening closes this one: the app's own handler
     * only knows about the menus it captured at load. Capture, so it runs
     * before that handler opens the menu that was clicked. */
    bar.addEventListener('click', event => {
      if (!menu.contains(event.target)) menu.classList.remove('open');
    }, true);
    doc.addEventListener('click', () => menu.classList.remove('open'));
    return menu;
  }

  window.ClackOSAppBar = { ensureStyle, create, ensureBar, ensureFileMenu };
})();
