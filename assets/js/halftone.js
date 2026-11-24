/* Halftone screen for the theme's media treatment.
 *
 * CSS has no halftone filter function, but `filter` accepts url(#id) pointing
 * at an SVG <filter>, and that can build one: the picture's luminance is added
 * to a tiled dot screen and the sum thresholded, so a pixel inks wherever it is
 * darker than the screen at that point and the dots swell as the image darkens.
 * The screen is a 45° grid, the newspaper angle, drawn as a centre diamond and
 * four corner triangles each holding a radial ramp about its own dot. The ramp
 * is quadratic rather than linear so the inked area tracks the tone — a 50%
 * grey comes out half covered instead of the 39% a straight ramp would give.
 *
 * A url(#id) reference resolves only inside the document (or shadow root) that
 * holds the element being filtered, and Chrome will not follow one into another
 * file or a data: URL, so every themed document needs its own copy. ClackOS
 * installs it on the desktop, in each same-origin app frame and in each
 * integrated app's shadow root; app-home.js does the same for an app opened on
 * its own. A theme refers to a filter by its dot pitch in CSS pixels,
 * clackos-halftone-1 to clackos-halftone-12; the Theme Editor's slider covers
 * that range and clackos.js refuses anything outside it. A reference to a
 * filter that is missing leaves the picture unfiltered rather than blank, so a
 * page that never installs these shows the colour treatment alone. */
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ID = 'clackos-halftone-defs';
  const MAX_PITCH = 12;

  /* Coverage for a dot of radius r in a cell of area 0.5 (the 45° grid on a
     unit tile) is 2πr²; with the ramp running to r = 0.5 that is π·x²/2 in ramp
     position x, until neighbouring dots meet at x ≈ 0.707. */
  const RAMP = [[0, 0], [0.2, 0.0628], [0.4, 0.2513], [0.55, 0.4752], [0.7071, 0.7854], [1, 1]];

  function cellSvg() {
    const stops = RAMP.map(([offset, v]) => {
      const grey = Math.round(v * 255);
      return `<stop offset="${offset}" stop-color="rgb(${grey},${grey},${grey})"/>`;
    }).join('');
    const ramps = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy], i) =>
      `<radialGradient id="r${i}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="0.5">${stops}</radialGradient>`).join('');
    const shapes = [
      '0.5,0 1,0.5 0.5,1 0,0.5', '0,0 0.5,0 0,0.5', '1,0 1,0.5 0.5,0', '0,1 0,0.5 0.5,1', '1,1 0.5,1 1,0.5'
    ].map((points, i) => `<polygon points="${points}" fill="url(#r${i})"/>`).join('');
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1" preserveAspectRatio="none"><defs>${ramps}</defs>` +
      `<rect width="1" height="1" fill="#fff"/>${shapes}</svg>`;
  }

  function markup() {
    const href = 'data:image/svg+xml,' + encodeURIComponent(cellSvg());
    const luminance = '0.2126 0.7152 0.0722 0 0';
    let filters = '';
    for (let pitch = 1; pitch <= MAX_PITCH; pitch++) {
      /* The 45° tile holds two dots, so it is √2 times the dot pitch. feTile
         repeats whole pixels most reliably, hence the rounding. */
      const tile = Math.max(1, Math.round(pitch * Math.SQRT2));
      filters +=
        `<filter id="clackos-halftone-${pitch}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
        `<feColorMatrix in="SourceGraphic" type="matrix" values="${luminance} ${luminance} ${luminance} 0 0 0 1 0" result="tone"/>` +
        `<feImage href="${href}" x="0" y="0" width="${tile}" height="${tile}" preserveAspectRatio="none" result="cell"/>` +
        `<feTile in="cell" result="screen"/>` +
        /* tone + screen − ½, clamped: at or above ½ is paper, below is ink. The
           sum's alpha clamps to 1, which keeps the colour channels from being
           clipped to a half-transparent premultiplied value. */
        `<feComposite in="tone" in2="screen" operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.5" result="sum"/>` +
        `<feComponentTransfer in="sum" result="dots"><feFuncR type="discrete" tableValues="0 1"/>` +
        `<feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer>` +
        `<feComposite in="dots" in2="SourceGraphic" operator="in"/>` +
        `</filter>`;
    }
    return filters;
  }

  let cached = null;

  /* root is a Document or a ShadowRoot. Safe to call repeatedly. */
  function install(root) {
    try {
      if (!root || root.getElementById?.(ID) || root.querySelector?.(`#${ID}`)) return;
      const doc = root.ownerDocument || root;
      const parent = root.nodeType === 11 ? root : (doc.body || doc.documentElement);
      if (!parent) return;
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.id = ID;
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      /* Not display:none — some engines will not render a filter whose <svg>
         is not rendered. Zero-sized and out of flow instead. */
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
      const defs = doc.createElementNS(SVG_NS, 'defs');
      defs.innerHTML = cached ||= markup();
      svg.appendChild(defs);
      parent.appendChild(svg);
    } catch {}
  }

  window.ClackHalftone = { install, MAX_PITCH };
  if (document.body) install(document);
  else document.addEventListener('DOMContentLoaded', () => install(document), { once: true });
})();
