/* ClackChat inference worker — runs one small language model (the page picks
 * which, from the catalogue in chat.html) fully in-browser with
 * Transformers.js on WebGPU. Weights come from the Hugging Face Hub on first
 * use and stay in the browser cache; nothing typed in the chat ever leaves
 * the machine. One worker holds one model: switching models terminates the
 * worker, which is the only reliable way to hand its GPU memory back. */
import { pipeline, TextStreamer, InterruptableStoppingCriteria, env }
  from '../../vendor/transformers/transformers.min.js';

/* serve the ONNX runtime .wasm from our vendor dir, not the jsDelivr CDN */
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', self.location.href).href;

let generator = null;
let sampling = {};
const stopper = new InterruptableStoppingCriteria();

/* f16 says whether the adapter offers shader-f16: the q1f16/q2f16/q4f16
 * builds are smaller and faster, but only run where it does */
async function checkWebGPU() {
  try {
    if (!('gpu' in navigator)) return { ok: false };
    const adapter = await navigator.gpu.requestAdapter();
    return { ok: !!adapter, f16: !!adapter?.features.has('shader-f16') };
  } catch {
    return { ok: false };
  }
}

/* one progress event per animation-frame-ish tick, summed over all files */
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

async function load({ model, dtype, gen }) {
  if (generator) { postMessage({ type: 'ready' }); return; }
  if (!(await checkWebGPU()).ok) {
    postMessage({ type: 'no-webgpu' });
    return;
  }
  try {
    postMessage({ type: 'loading', detail: 'Contacting the Hugging Face Hub…' });
    sampling = gen || {};
    generator = await pipeline('text-generation', model, {
      device: 'webgpu',
      dtype,
      progress_callback: reportProgress,
    });
    postMessage({ type: 'loading', detail: 'Compiling shaders…' });
    /* tiny warm-up run so the first real prompt doesn't stall on compilation */
    await generator('Hi', { max_new_tokens: 1 });
    postMessage({ type: 'ready' });
  } catch (err) {
    generator = null;
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
}

async function generate(messages) {
  if (!generator) { postMessage({ type: 'error', message: 'Model is not loaded.' }); return; }
  stopper.reset();
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: text => postMessage({ type: 'token', text }),
  });
  try {
    const output = await generator(messages, {
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      ...sampling,
      streamer,
      stopping_criteria: stopper,
    });
    /* chat-style input returns the whole conversation; the reply is last */
    const generated = output[0]?.generated_text;
    const text = typeof generated === 'string' ? generated : generated?.at(-1)?.content ?? '';
    postMessage({ type: 'done', text });
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
}

self.onmessage = async e => {
  const msg = e.data;
  switch (msg.type) {
    case 'check': postMessage({ type: 'webgpu', ...await checkWebGPU() }); break;
    case 'load': await load(msg); break;
    case 'generate': await generate(msg.messages); break;
    case 'interrupt': stopper.interrupt(); break;
  }
};
