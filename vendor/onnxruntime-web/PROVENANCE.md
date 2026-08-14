# ONNX Runtime Web (vendored — the JavaScript half)

- Project: ONNX Runtime Web
- Publisher: Microsoft
- npm package: `onnxruntime-web` v1.26.0-dev.20260416-b7804b056c
  (`dist/ort.webgpu.min.mjs`)
- Licence: MIT (see `../transformers/LICENSE-onnxruntime.txt`)

This is the *same* ONNX Runtime the Transformers.js bundle in
`../transformers/` already carries, at the exact version that package pins.
Only the JavaScript API is here; the WebAssembly artifacts are not duplicated
— this build loads `ort-wasm-simd-threaded.{jsep,asyncify,jspi}.{mjs,wasm}`
from `../transformers/`, which is why the worker sets
`env.wasm.wasmPaths` to that directory rather than to this one. Keep the two
directories on the same ORT version: the JS and the `.wasm` are one build and
a mismatch fails at session creation.

`ort.webgpu.min.mjs` is the wasm + WebGPU build (67 KB). The wasm-only build
would be smaller still, but it loads a *different* set of `.wasm` files
(`ort-wasm-simd-threaded.wasm`, without the JSEP additions) that this
repository does not vendor — so the smaller JS would cost 12 MB of new
WebAssembly.

## Why this exists at all

Transformers.js does not re-export ONNX Runtime: `env.backends.onnx` exposes
the runtime's *settings* but not `InferenceSession`, so a model it cannot
describe cannot be run through it. audioGen's Magenta RealTime 2 is exactly
that model — nine separate graphs with no HuggingFace config between them and
a host-side loop carrying a KV-cache from one audio frame to the next (see
`content/applications/audiogen/mrt2/`). It needs the raw runtime, so the raw
runtime is vendored.

Everything else in ClackOS that runs a model goes through Transformers.js and
should keep doing so; this is not a second general-purpose ML runtime.

To update: copy `dist/ort.webgpu.min.mjs` from the `onnxruntime-web` version
that `@huggingface/transformers` pins, at the same time as the files in
`../transformers/`.
