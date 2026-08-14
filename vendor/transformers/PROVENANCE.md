# Transformers.js (vendored)

- Project: Transformers.js
- Publisher: Hugging Face
- Source: https://github.com/huggingface/transformers.js
- npm package: `@huggingface/transformers` v4.2.0 (`dist/transformers.min.js`)
- Licence: Apache-2.0 (see `LICENSE`)

The ONNX Runtime WebAssembly artifacts are taken from the exact
`onnxruntime-web` build that `@huggingface/transformers` v4.2.0 pins
(`1.26.0-dev.20260416-b7804b056c`):

- `ort-wasm-simd-threaded.jsep.mjs` / `.wasm` (legacy JSEP build)
- `ort-wasm-simd-threaded.asyncify.mjs` / `.wasm`
- `ort-wasm-simd-threaded.jspi.mjs` / `.wasm`
- Licence: MIT, Microsoft Corporation (see `LICENSE-onnxruntime.txt`)

All three variants are needed: the runtime picks asyncify or jspi at
startup depending on whether the browser supports JS Promise
Integration (this applies to the WebGPU backend too, not just CPU).

The `.wasm` files here are also loaded by the standalone ONNX Runtime in
../onnxruntime-web/, which audioGen's Magenta RealTime 2 engine drives
directly — the same build, so keep the two directories on one version.

Shared runtime for in-browser ML apps: content/applications/chat.html,
content/applications/audiogen/,
ClackPaint's background removal (paint-worker.js, which offers MODNet,
Open RMBG, BiRefNet, BiRefNet lite and BEN2 behind one image-segmentation
pipeline), ClackPaint's Select Object tool (paint-sam-worker.js,
SlimSAM), ClackPaint's Text to Image (paint-text2image-worker.js,
Janus-Pro-1B — an autoregressive image model rather than a diffusion one,
which is what lets it run on this runtime at all) and ClackPaint's Image Size
dialog (paint-upscale-worker.js, which offers all five published Swin2SR
checkpoints behind one image-to-image pipeline — the only super-resolution
architecture this runtime implements). Workers must set
`env.backends.onnx.wasm.wasmPaths` to this directory, otherwise the
runtime fetches the .wasm from the jsDelivr CDN.

The paint workers import this bundle lazily, inside the call that first
needs a model, so the classic matting algorithms in paint-matte.js — and
a session that never asks for a model at all — do not pay for a megabyte
of runtime they will not call.

Model weights are NOT vendored — they are fetched from the Hugging Face
Hub at runtime and cached by the browser.

To update: copy `dist/transformers.min.js` and `LICENSE` from the npm
package, plus the two `ort-wasm-simd-threaded.jsep.*` files from the
`onnxruntime-web` version pinned in its `package.json`.
