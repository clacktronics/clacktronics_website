/* ClackPaint background-removal worker — cuts the subject out of an image
 * fully in-browser, either with one of several Transformers.js models or with
 * one of the classic algorithms in paint-matte.js. Model weights are fetched
 * from the Hugging Face Hub on first use and cached by the browser; the picture
 * itself never leaves the machine.
 *
 * What comes back is always the matte, not a finished cut-out: one byte of
 * coverage per pixel, 0 for background and 255 for subject, with the fuzz of
 * hair and fur in between. Inference is the expensive part and the shaping of
 * that coverage — cutoff, softness, growing, feathering — is not, so the
 * shaping belongs to the page, where the settings can be moved with the result
 * on screen and nothing has to be worked out twice.
 *
 * Transformers.js is imported only when a model is actually asked for. The
 * classic methods are the ones you reach for first and they are pure
 * arithmetic; making them wait on a megabyte of runtime they will never call
 * would be a poor trade. */
import { classicMatte, CLASSIC_METHODS } from './paint-matte.js';

/* Every model here is a drop-in for every other: Transformers.js registers
 * modnet, isnet, ben and birefnet against one wrapper, so each returns a single
 * greyscale mask at the picture's own size and the page's shaping code never
 * has to know which one ran.
 *
 * `dtype` is per device, and each value here was arrived at by running it.
 * WebGPU takes fp16 throughout. The WASM path takes fp16 as well — tested, and
 * worth halving the download for — except for ormbg, where fp32 is the build
 * confirmed to run there. MODNet is the exception at both ends: it is small
 * enough that even its 8-bit build is usable, which is what makes it the one to
 * reach for on a phone. ormbg's 8-bit build is not usable at all — it comes
 * back as fog rather than a matte — so it is not offered. */
const MODELS = {
  modnet: { id: 'Xenova/modnet', webgpu: 'fp16', wasm: 'q8' },
  ormbg: { id: 'onnx-community/ormbg-ONNX', webgpu: 'fp16', wasm: 'fp32' },
  'birefnet-lite': { id: 'onnx-community/BiRefNet_lite-ONNX', webgpu: 'fp16', wasm: 'fp16' },
  ben2: { id: 'onnx-community/BEN2-ONNX', webgpu: 'fp16', wasm: 'fp16' },
  birefnet: { id: 'onnx-community/BiRefNet-ONNX', webgpu: 'fp16', wasm: 'fp16' }
};

let transformers = null;
/* One model at a time, and only one. Keeping every model that has been tried
 * alive is tempting — swapping back would be instant — but each one holds its
 * weights on the device it runs on, and these weights are hundreds of megabytes
 * apiece. On WebGPU that is worse than slow: a second set of weights can take
 * the adapter past what it will allocate, and what comes back is not a clean
 * out-of-memory but a broken context, where the next model to run fails to
 * build a shader for a node that would otherwise have been fine. So the model
 * on the way out is disposed of before the model on the way in is asked for. */
let loaded = null;              /* { method, segmenter } */
let device = null;

async function loadRuntime() {
  if (transformers) return transformers;
  transformers = await import('../../vendor/transformers/transformers.min.js');
  /* serve the ONNX runtime .wasm from our vendor dir, not the jsDelivr CDN */
  transformers.env.backends.onnx.wasm.wasmPaths =
    new URL('../../vendor/transformers/', self.location.href).href;
  return transformers;
}

async function hasWebGPU() {
  try {
    if (!('gpu' in navigator)) return false;
    return !!await navigator.gpu.requestAdapter();
  } catch {
    return false;
  }
}

/* one progress event per ~120 ms tick, summed over every file being fetched */
let fileProgress = new Map();
let lastReport = 0;
function reportProgress(info) {
  if (info.status === 'progress' && info.file) {
    fileProgress.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
    const now = Date.now();
    if (now - lastReport < 120) return;
    lastReport = now;
    let loaded = 0, total = 0;
    for (const p of fileProgress.values()) { loaded += p.loaded; total += p.total; }
    postMessage({ type: 'progress', loaded, total });
  } else if (info.status === 'initiate' && info.file) {
    postMessage({ type: 'loading', detail: `Fetching ${info.file}…` });
  }
}

async function release() {
  if (!loaded) return;
  const going = loaded;
  loaded = null;
  try { await going.segmenter.dispose(); } catch { /* already gone */ }
}

async function load(method) {
  if (loaded?.method === method) return loaded.segmenter;
  const model = MODELS[method];
  if (!model) throw new Error(`unknown model "${method}"`);
  await release();
  const { pipeline } = await loadRuntime();
  if (device === null) device = await hasWebGPU() ? 'webgpu' : 'wasm';
  fileProgress = new Map();
  postMessage({ type: 'loading', detail: 'Contacting the Hugging Face Hub…' });
  /* image-segmentation rather than background-removal: same model, same
   * weights, same cache entry — it just stops before pasting the matte into
   * the picture's alpha, which is the step we want to do ourselves. */
  const segmenter = await pipeline('image-segmentation', model.id, {
    device,
    dtype: model[device],
    progress_callback: reportProgress
  });
  loaded = { method, segmenter };
  return segmenter;
}

async function run(msg) {
  const token = msg.token;
  const method = msg.method || 'modnet';
  try {
    const data = new Uint8ClampedArray(msg.data);
    let matte, width = msg.width, height = msg.height;
    if (CLASSIC_METHODS.has(method)) {
      postMessage({ type: 'ready', device: 'cpu', token });
      const reference = msg.reference ? new Uint8ClampedArray(msg.reference) : null;
      const seeds = msg.seeds ? new Uint8Array(msg.seeds) : null;
      matte = classicMatte(method, data, width, height, msg.params || {}, reference, seeds);
    } else {
      const segmenter = await load(method);
      postMessage({ type: 'ready', device, token });
      postMessage({ type: 'loading', detail: 'Separating the subject from the background…' });
      const { RawImage } = await loadRuntime();
      const image = new RawImage(data, width, height, 4);
      const [{ mask }] = await segmenter(image);
      /* the mask comes back single-channel at the picture's own size */
      matte = new Uint8ClampedArray(mask.data);
      width = mask.width; height = mask.height;
    }
    postMessage({ type: 'result', token, method, data: matte, width, height }, [matte.buffer]);
  } catch (err) {
    /* a model that has failed mid-run may be holding a device that is now in a
       bad way; let it go rather than hand it to the next run */
    await release();
    postMessage({ type: 'error', token, message: String(err?.message || err) });
  }
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'run') run(msg);
};
