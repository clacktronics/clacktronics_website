/* Visitor counting, through GoatCounter (https://www.goatcounter.com).
 *
 * GoatCounter was picked because it sets no cookies and stores nothing on the
 * visitor's machine, so there is no consent banner to show, and because its
 * script is a few kilobytes with no dependencies. Each hit is a single request
 * to the endpoint below carrying the path, title, referrer and screen size; the
 * counts live on GoatCounter's servers and are read from its dashboard. Nothing
 * is written on this site's own host.
 *
 * This file is the one place the endpoint is named. Every page that should be
 * counted loads it: the desktop (index.html), each app page under content/, and
 * the plain mirror pages written by scripts/build_plain_site.py.
 *
 * The desktop is one page, so on its own GoatCounter would record a whole
 * visit as a single hit on "/" however many windows were opened. clackos.js
 * calls ClackOSAnalytics.countWindow() as each window opens, which records it
 * under /desktop/<id> — /desktop/file/blog.md, /desktop/applications/paint.html
 * — keeping desktop windows apart from the same content read as a standalone
 * page or in the mirror.
 *
 * An app is only counted as a page when it *is* the page. Inside an iframe
 * window count.js declines on its own (it ignores framed pages unless told
 * otherwise); an integrated app runs its scripts in the desktop document,
 * where this file has already run, so the guard below stops it loading twice.
 *
 * count.js also ignores localhost and file:// on its own, so serving the site
 * locally while working on it adds nothing to the numbers. */
(() => {
  if (window.ClackOSAnalytics) return;

  const ENDPOINT = 'https://clacktronics.goatcounter.com/count';
  const SCRIPT = 'https://gc.zgo.at/count.js';

  /* windows opened before count.js has arrived wait here; it loads async so
   * the boot windows usually open first */
  const pending = [];
  const send = hit => window.goatcounter.count(hit);
  const flush = () => { while (pending.length) send(pending.shift()); };

  window.ClackOSAnalytics = {
    countWindow(id, title) {
      const hit = { path: '/desktop/' + String(id).replace(/^app:/, '').replace(/#instance-\d+$/, ''), title, event: false };
      if (window.goatcounter?.count) send(hit);
      else pending.push(hit);
    }
  };

  if (window.parent !== window) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = SCRIPT;
  script.dataset.goatcounter = ENDPOINT;
  script.addEventListener('load', flush, { once: true });
  document.head.appendChild(script);
})();
