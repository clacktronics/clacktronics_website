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
 * them. */
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
  const home = '../'.repeat(depth) + 'index.html';

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

  /* the script is deferred, so the bar the app wrote is already parsed; the
   * check keeps it working if a page ever loads it without defer */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHomeLink);
  else addHomeLink();
})();
