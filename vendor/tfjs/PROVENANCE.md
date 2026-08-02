# TensorFlow.js (vendored)

- Project: TensorFlow.js
- Publisher: Google
- Source: https://github.com/tensorflow/tfjs
- npm package: `@tensorflow/tfjs` v4.22.0 (`dist/tf.fesm.min.js`)
- Licence: Apache-2.0 (see `LICENSE`)

`tf.fesm.min.js` is the flat ES-module build: one self-contained file with no
bare import specifiers, so a module worker can import it straight from disk.
The smaller per-package builds (`tf-core.fesm.min.js` and friends, about
270 kB lighter all told) are *not* usable here — they import
`@tensorflow/tfjs-core` and `seedrandom` by bare name, which a browser cannot
resolve without an import map, and import maps do not apply inside workers.

Used by ClackPaint's DeepDream effect
(content/applications/paint-deepdream-worker.js), which hand-builds the
inception5h trunk from `vendor/inception5h/` and runs gradient ascent through
it. That needs autodiff, so the effect deliberately does *not* use
`tf.loadGraphModel`: graph models in TensorFlow.js are inference-only. Only
`tf.conv2d`, `tf.maxPool`, `tf.localResponseNormalization`, `tf.concat`,
`tf.relu` and `tf.grad` are actually used; the bundled Layers, Data and
Converter packages come along for the ride because this is the only build
shaped like an importable module.

The WebGL and CPU backends are both inside this bundle and register
themselves, so the worker picks WebGL where the browser offers it (needing
OffscreenCanvas in a worker) and falls back to the CPU backend otherwise.

To update: copy `dist/tf.fesm.min.js` and `LICENSE` from the npm package.
