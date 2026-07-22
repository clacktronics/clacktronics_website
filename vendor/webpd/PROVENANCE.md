# WebPd (vendored)

Compiler + runtime for the Pure Data audio programming language by
Sébastien Piquemal & contributors — parses .pd patches, compiles them to
plain JavaScript DSP code and runs it in an AudioWorklet.

- Project: https://github.com/sebpiq/WebPd
- Vendored from the npm package `webpd@1.0.0-alpha.14`
  (https://registry.npmjs.org/webpd/-/webpd-1.0.0-alpha.14.tgz,
  fetched 2026-07-22). `dist/` is the package's build output, unmodified.
- Licence: LGPL-3.0 (see COPYING.LESSER + COPYING). Pure Data itself is
  a separate project by Miller Puckette (BSD-3-Clause); WebPd is an
  independent reimplementation and no Pd code is redistributed here.

## Deviations from upstream

1. TypeScript declaration files (`*.d.ts`) were stripped from `dist/` to
   keep the repo lean — no runtime code was changed.
2. `COPYING.LESSER` is not shipped inside the npm tarball (only
   `COPYING`, the GPL-3 text that the LGPL-3 supplements), so it was
   added from the upstream repository
   (https://raw.githubusercontent.com/sebpiq/WebPd/main/COPYING.LESSER).

Used by `content/applications/puredata.html`, which imports
`dist/src/index.js` as an ES module.

To update: `npm pack webpd`, replace `dist/`, re-strip `*.d.ts`.
