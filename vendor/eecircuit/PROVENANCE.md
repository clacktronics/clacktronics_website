# EEcircuit (vendored)

Browser-based SPICE simulator by Danial Chitnis — ngspice compiled to
WebAssembly, netlist editor and WebGL plotting.

- App source: https://github.com/eelab-dev/EEcircuit (MIT, see LICENSE)
- Simulation engine: eecircuit-engine (npm, MIT; ngspice itself is
  BSD-3-Clause). The engine WASM is embedded inside
  assets/simulationWorker-*.js.
- These files are a mirror of the production deployment at
  https://eecircuit.com (fetched 2026-07-16). The repo does not publish
  a built bundle, and building from source requires a private sibling
  package (see below).

## Deviations from upstream

1. **Schematic feature disabled.** The schematic editor component
   (`eecircuit-schematic`) is not open source: its repository is not
   accessible, it is not on npm, and its build artifacts
   (canvas.worker.js, exporters.worker.js, font.bmp) are distributed
   obfuscated with no licence grant. Those artifacts are therefore NOT
   redistributed here: the two workers are replaced by inert stubs and
   font.bmp is omitted. The Schematic tab is hidden by the ClackOS skin.
   Simulation and plotting — the MIT-licensed parts — are unaffected.
2. Subpath fixes: `index.html` asset paths made relative, and the
   module-preload base helper in `assets/index-*.js` and the absolute
   `/assets/...` worker URLs in several chunks patched to resolve
   against the module/page URL instead of the site root, so the app
   works from a subdirectory.
3. `assets/appStore-*.js` (MIT app code) patched: the app boots into the
   netlist Simulation tab (instead of the disabled schematic) and seeds
   the standard MOSFET example netlist, since the default netlist
   normally comes from the schematic converter.

To update: re-mirror eecircuit.com and re-apply the three deviations.
