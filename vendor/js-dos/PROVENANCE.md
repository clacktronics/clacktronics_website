# js-dos provenance

- Project: js-dos and emulators
- Upstream: https://github.com/caiiiycuk/js-dos and https://github.com/caiiiycuk/emulators
- Version: 8.4.1
- Package: `js-dos@8.4.1` from the npm registry
- Package SHA-512: `ae714743f5c57e876698e14004d5bbaea9792bfa904df2a80a090425329ab4b2c8ac1f349a1515671c64c00ecc6d72c2469e7891bae192124b6cf3b190b224b6`
- License: GPL-2.0 (see `LICENSE-GPL-2.0.txt`)

The browser distribution is vendored so QBasic can start without relying on a
third-party CDN. Only the js-dos player, its DOSBox WebAssembly backend, and the
libzip files used to construct the in-memory drive are included. Generated
source maps, DOSBox-X, networking, file-explorer, and debug symbol assets are
omitted because this application does not load them.

The QBasic executable is a user-supplied application payload and is not part of
the js-dos distribution. Its SHA-256 is
`dbfd7e7d27fea72877c5332551889b3d3c46fc5b72d15e35e232ea611570a2cd`.
