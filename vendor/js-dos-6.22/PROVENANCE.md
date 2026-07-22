# js-dos 6.22 provenance

- Project: js-dos
- Upstream: https://github.com/caiiiycuk/js-dos
- Version: 6.22.60
- Package: `js-dos@6.22.60` from the npm registry
- Package SHA-512: `d4485f31fb4e841677e06bf3fd108bb00a0472059c675a66ba6a46dbc67ef6843da1054ff748dc910a6f4bd356eefbdfc182569828fe3d7fa3dd43b8e223ba2c`
- License: GPL-2.0 (see `LICENSE-GPL-2.0.txt`)

The browser distribution is vendored so QBasic can start without a third-party
CDN. It contains the js-dos canvas API and its default DOSBox WebAssembly
backend. Source maps, JavaScript-only fallbacks, profiling variants, tests, and
debug symbols are omitted because this application does not load them.

Version 6.22.60 replaces the original v8.4.1 integration. The v8 DOSBox backend
could be reproduced corrupting the QBasic framebuffer and panicking with a
WebAssembly out-of-bounds memory access as soon as it received browser mouse
input. The 6.22 canvas backend renders QBasic's native 640 × 400 screen and
remains stable across mouse input and viewport resizing.

The QBasic executable is a user-supplied application payload and is not part of
the js-dos distribution. Its SHA-256 is
`dbfd7e7d27fea72877c5332551889b3d3c46fc5b72d15e35e232ea611570a2cd`.
