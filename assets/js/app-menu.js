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

  function install(doc) {
    if (!doc || doc[INSTALLED]) return;
    doc[INSTALLED] = true;
    doc.addEventListener('pointerover', onPointerOver, true);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('click', onClick);
  }

  install(document);
  /* ClackOS closes the menus of an app in an iframe when the click that should
   * dismiss them lands on the desktop instead */
  window.ClackOSCloseAppMenus = doc => closeAll(doc || document);
})();
