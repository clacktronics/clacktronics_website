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
let contextLimit = 0;
/* the longest reply asked for; it is also reserved out of the context window,
 * so a conversation is trimmed before a reply could run off its end */
const REPLY_TOKENS = 1024;
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
    contextLimit = readContextLimit(generator.model.config);
    postMessage({ type: 'loading', detail: 'Compiling shaders…' });
    /* tiny warm-up run so the first real prompt doesn't stall on compilation */
    await generator('Hi', { max_new_tokens: 1 });
    postMessage({ type: 'ready', limit: contextLimit });
  } catch (err) {
    generator = null;
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
}

/* The window a model was trained to attend over. Multimodal exports keep it
 * in text_config; a config naming neither leaves the meter showing usage
 * alone, with nothing to count down from. */
function readContextLimit(config) {
  const c = config?.text_config ?? config ?? {};
  return c.max_position_embeddings || config?.max_position_embeddings || 0;
}

/* Counted the way the pipeline will feed it: the model's own chat template
 * rendered over the whole conversation, generation prompt included, then
 * tokenised. Per-message figures are the message text alone, so they add up
 * to a little less than the total — the difference is the template's own
 * role markers, which the Context panel shows as a line of its own. */
function countChat(messages) {
  const text = generator.tokenizer.apply_chat_template(messages, { add_generation_prompt: true, tokenize: false });
  return generator.tokenizer.encode(text, { add_special_tokens: false }).length;
}
const countText = t => generator.tokenizer.encode(t, { add_special_tokens: false }).length;

function contextReport(id, messages, dropped) {
  return {
    type: 'context', id, dropped, limit: contextLimit,
    used: countChat(messages),
    parts: messages.map(m => countText(m.content)),
  };
}

/* Drop the oldest exchanges, a user turn and its reply at a time, until the
 * conversation plus a full-length reply fits. The system prompt and the
 * newest message always stay; if those alone are too long there is nothing
 * sensible left to send. Returns how many history messages went. */
function fit(messages) {
  if (!contextLimit) return { messages, dropped: 0 };
  const [system, ...rest] = messages;
  let dropped = 0;
  const budget = contextLimit - Math.min(REPLY_TOKENS, contextLimit >> 2);
  while (rest.length > 1 && countChat([system, ...rest]) > budget) {
    const n = rest.length > 2 && rest[1].role === 'assistant' ? 2 : 1;
    rest.splice(0, n);
    dropped += n;
  }
  return { messages: [system, ...rest], dropped };
}

function count({ id, messages }) {
  if (!generator) return;
  postMessage(contextReport(id, messages, 0));
}

async function generate({ id, messages: all }) {
  if (!generator) { postMessage({ type: 'error', message: 'Model is not loaded.' }); return; }
  stopper.reset();
  const { messages, dropped } = fit(all);
  const report = contextReport(id, messages, dropped);
  if (contextLimit && report.used >= contextLimit) {
    postMessage({ type: 'error', id, tooLong: true, message: `That message is ${report.used.toLocaleString()} tokens — longer than this model's ${contextLimit.toLocaleString()}-token context.` });
    return;
  }
  postMessage(report);
  /* never ask for more than the window has left, so the meter cannot pass 100% */
  const room = contextLimit ? contextLimit - report.used : REPLY_TOKENS;
  let generated = 0;
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => { generated++; },
    callback_function: text => postMessage({ type: 'token', id, text, generated }),
  });
  try {
    const output = await generator(messages, {
      max_new_tokens: Math.min(REPLY_TOKENS, room),
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
    postMessage({ type: 'done', id, text, generated });
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
}

self.onmessage = async e => {
  const msg = e.data;
  switch (msg.type) {
    case 'check': postMessage({ type: 'webgpu', ...await checkWebGPU() }); break;
    case 'load': await load(msg); break;
    case 'generate': await generate(msg); break;
    case 'count': count(msg); break;
    case 'count-text': if (generator) postMessage({ type: 'text-count', key: msg.key, n: countText(msg.text) }); break;
    case 'interrupt': stopper.interrupt(); break;
  }
};
