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

Shared runtime for in-browser ML apps (currently
content/applications/chat.html; intended to also serve future
transformers.js apps such as image background removal). Workers must set
`env.backends.onnx.wasm.wasmPaths` to this directory, otherwise the
runtime fetches the .wasm from the jsDelivr CDN.

Model weights are NOT vendored — they are fetched from the Hugging Face
Hub at runtime and cached by the browser.

To update: copy `dist/transformers.min.js` and `LICENSE` from the npm
package, plus the two `ort-wasm-simd-threaded.jsep.*` files from the
`onnxruntime-web` version pinned in its `package.json`.
