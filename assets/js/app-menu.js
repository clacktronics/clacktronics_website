/* Windows-style menu bars.
 *
 * Every app builds its bar the same way — a .rm per menu, holding the button
 * that toggles it and the .rm-dd it opens — and wires the button to a click.
 * That alone means each menu has to be clicked to be read. This adds the other
 * half of the desktop convention: once one menu in a bar is open, moving the
 * pointer across its neighbours opens them in turn, and the bar stays open
 * until something is picked, Escape is pressed, or the pointer clicks away.
 *
 * The switch is made by clicking the neighbour's own button rather than by
 * setting .open on it, so whatever the app does as a menu opens — rebuilding a
 * list, ticking the current option, closing its siblings — still happens. The
 * apps stop that click at the button, so it never reaches the document handler
 * that would close the bar again.
 *
 * Loaded by the app pages themselves, so it applies to an app in a window, in
 * an iframe and opened on its own; ClackOS loads it too, for the apps it mounts
 * into a shadow root, whose menus live in the desktop document. */
(function () {
  const INSTALLED = 'clackosMenuHoverInstalled';
  const VIEW_INSTALLED = 'clackosMenuResizeInstalled';
  /* breathing room between a shifted dropdown and the edge it was shifted off */
  const EDGE_GAP = 8;

  /* the deepest element under the pointer, reached through any shadow boundary
   * — the desktop's copy of this script sees a mounted app's menus only as the
   * host element otherwise */
  function hovered(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const node = path[0] || event.target;
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el && typeof el.closest === 'function' ? el : null;
  }

  /* menus that are siblings of the hovered one: a bar's own menus, or the
   * nested ones inside a dropdown, whichever level the pointer is at */
  function openSiblings(menu) {
    const bar = menu.parentElement;
    if (!bar) return [];
    return [...bar.children].filter(el =>
      el !== menu && el.classList && el.classList.contains('rm') && el.classList.contains('open'));
  }

  function closeMenu(menu) {
    menu.classList.remove('open');
    menu.querySelectorAll('.rm.open').forEach(nested => nested.classList.remove('open'));
  }

  /* A dropdown is anchored under its own button, which is fine until the button
   * is most of the way along a phone-width bar: File opens against the left edge
   * and everything after it opens progressively further off the right one — on a
   * 390px screen ClackPaint's Effects menu started 244px past the edge. The
   * desktop's own menus have always clamped themselves this way (see the menu
   * placement in assets/js/clackos.js); this is the app bar's half of it.
   *
   * The bar, not the viewport, is the edge to measure against: an app mounted
   * into the desktop draws its menus in the desktop document, where the viewport
   * is the whole screen and the app is only as wide as its window. */
  function place(dd) {
    const bar = dd.closest('.rm-bar');
    if (!bar) return;
    const view = dd.ownerDocument?.defaultView;
    if (!view) return;

    dd.style.left = '';
    dd.style.maxWidth = '';
    const room = bar.getBoundingClientRect();
    /* narrow it first if it cannot fit whatever it is shifted against, so the
     * measurement below is of the width it will actually be drawn at */
    const fits = Math.min(room.width, view.innerWidth) - EDGE_GAP * 2;
    if (fits > 0 && dd.getBoundingClientRect().width > fits) dd.style.maxWidth = fits + 'px';

    const box = dd.getBoundingClientRect();
    const limit = Math.min(room.right, view.innerWidth) - EDGE_GAP;
    /* never past the left edge of the bar: a dropdown hanging off that side is
     * no more reachable than one hanging off the other */
    const shift = Math.min(box.right - limit, box.left - (room.left + EDGE_GAP));
    if (shift > 0) dd.style.left = -shift + 'px';
  }

  function placeOpen(bar) {
    bar.querySelectorAll('.rm.open > .rm-dd').forEach(place);
  }

  /* Placement waits a frame because this runs in the capture phase, before the
   * app's own toggle has added .open to the menu that was clicked. */
  function onClickPlace(event) {
    const el = hovered(event);
    const bar = el && el.closest ? el.closest('.rm-bar') : null;
    if (!bar) return;
    const view = bar.ownerDocument?.defaultView;
    if (view) view.requestAnimationFrame(() => placeOpen(bar));
  }

  /* Turning a phone changes which menus fit and which have to be shifted, and
   * an open menu would otherwise keep the offset it was given in the old
   * orientation until it is closed and opened again. */
  function onViewResize(event) {
    const doc = event.target?.document;
    if (!doc) return;
    const bars = new Set();
    const collect = root => {
      root.querySelectorAll('.rm-bar').forEach(bar => bars.add(bar));
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) collect(el.shadowRoot); });
    };
    collect(doc);
    bars.forEach(placeOpen);
  }

  function onPointerOver(event) {
    /* mouse only: on a touchscreen the same gesture also fires the click that
     * toggles the menu, which would open and immediately close it */
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const el = hovered(event);
    if (!el) return;
    const button = el.closest('button');
    if (!button) return;
    const menu = button.parentElement;
    if (!menu || !menu.classList || !menu.classList.contains('rm')) return;
    if (menu.classList.contains('open')) return;

    const open = openSiblings(menu);
    if (!open.length) return;
    button.click();
    /* a bar whose buttons carry no handler of their own still switches */
    if (!menu.classList.contains('open')) {
      open.forEach(closeMenu);
      menu.classList.add('open');
    }
  }

  /* An app mounted into the desktop keeps its menus in a shadow root, out of
   * reach of a plain document query — so closing goes through every root. */
  function closeAll(root) {
    root.querySelectorAll('.rm.open').forEach(closeMenu);
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) closeAll(el.shadowRoot); });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') closeAll(event.target?.ownerDocument || document);
  }

  /* the click that dismisses an open bar: anywhere that is not a menu of its
   * own — a menu's own click is stopped at its button by the app */
  function onClick(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.some(node => node.classList && node.classList.contains('rm'))) return;
    closeAll(event.target?.ownerDocument || document);
  }

  /* A document listener is not enough for an app mounted in a shadow root:
   * pointerover carries a relatedTarget, and an event whose target and
   * relatedTarget retarget to the same node — the host, for any move from one
   * menu to the next inside the same root — is never dispatched outside that
   * root. The move in from the desktop is dispatched, which is why those
   * menus opened on the way in but not as the pointer went along the bar.
   * Listening on the root itself sees every move. */
  function install(root) {
    if (!root || root[INSTALLED]) return;
    root[INSTALLED] = true;
    root.addEventListener('pointerover', onPointerOver, true);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', onClick);
    /* capture, so it sees the click the app stops at its own menu button */
    root.addEventListener('click', onClickPlace, true);

    /* one resize listener per window, however many roots it ends up holding */
    const view = (root.ownerDocument || root).defaultView;
    if (view && !view[VIEW_INSTALLED]) {
      view[VIEW_INSTALLED] = true;
      view.addEventListener('resize', onViewResize);
    }
  }

  install(document);
  /* ClackOS mounts an app into a shadow root, and closes the menus of an app
   * in an iframe when the click that should dismiss them lands on the desktop */
  window.ClackOSMenus = { install, closeAll };
  window.ClackOSCloseAppMenus = doc => closeAll(doc || document);
})();
