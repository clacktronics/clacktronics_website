/* ClackPaint background-removal worker — cuts the subject out of an image
 * fully in-browser with Transformers.js, using MODNet (Apache-2.0). The model
 * is fetched from the Hugging Face Hub on first use and cached by the browser;
 * the picture itself never leaves the machine. */
import { pipeline, RawImage, env }
  from '../../vendor/transformers/transformers.min.js';

/* serve the ONNX runtime .wasm from our vendor dir, not the jsDelivr CDN */
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', self.location.href).href;

const MODEL_ID = 'Xenova/modnet';

let segmenter = null;
let device = null;

async function hasWebGPU() {
  try {
    if (!('gpu' in navigator)) return false;
    return !!await navigator.gpu.requestAdapter();
  } catch {
    return false;
  }
}

/* one progress event per ~120 ms tick, summed over every file being fetched */
const fileProgress = new Map();
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

async function load() {
  if (segmenter) return;
  const webgpu = await hasWebGPU();
  device = webgpu ? 'webgpu' : 'wasm';
  postMessage({ type: 'loading', detail: 'Contacting the Hugging Face Hub…' });
  /* fp16 is small and fast on the GPU; on the CPU path use the 8-bit model so
   * the download stays tiny and inference finishes in a few seconds */
  segmenter = await pipeline('background-removal', MODEL_ID, {
    device,
    dtype: webgpu ? 'fp16' : 'q8',
    progress_callback: reportProgress,
  });
}

async function run(msg) {
  const token = msg.token;
  try {
    await load();
    postMessage({ type: 'ready', device, token });
    postMessage({ type: 'loading', detail: 'Separating the subject from the background…' });
    const image = new RawImage(new Uint8ClampedArray(msg.data), msg.width, msg.height, 4);
    const output = await segmenter(image);
    const rgba = output.rgba();
    const data = new Uint8ClampedArray(rgba.data);
    postMessage(
      { type: 'result', token, data, width: rgba.width, height: rgba.height },
      [data.buffer]
    );
  } catch (err) {
    segmenter = null;
    postMessage({ type: 'error', token, message: String(err?.message || err) });
  }
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'run') run(msg);
};
