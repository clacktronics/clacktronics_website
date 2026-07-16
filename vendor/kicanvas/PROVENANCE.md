# KiCanvas (vendored)

- `kicanvas.js` — the unmodified embeddable bundle from
  https://kicanvas.org/kicanvas/kicanvas.js (KiCanvas by Alethea
  Katherine Flowers, MIT — see LICENSE.md; source at
  https://github.com/theacodes/kicanvas).
- `kicanvas-clackos.js` — generated from kicanvas.js by
  `scripts/build_kicanvas_theme.py`, which remaps the default theme's
  colour literals to the ClackOS palette (KiCanvas has no runtime
  custom-theme hook). Do not edit by hand.

To update: replace kicanvas.js with the current upstream bundle and
re-run the script. It fails loudly if upstream renamed a colour.
