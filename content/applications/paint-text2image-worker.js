/* ClackPaint text-to-image worker — DeepSeek's Janus-Pro-1B, run in the
 * browser through Transformers.js.
 *
 * Every other text-to-image model worth having is a diffusion model, and
 * Transformers.js cannot run one: there is no scheduler and no VAE loop in it,
 * and adding a second inference runtime alongside the one this site already
 * carries for background removal and Select Object is a megabyte of duplication
 * for one menu item. Janus is the way in, because it does not diffuse. It is an
 * autoregressive model that emits image tokens exactly as a language model
 * emits word tokens — 576 of them, decoded in one pass at the end into a
 * 384 x 384 picture — so it runs through the same generate loop as any other
 * causal model and needs nothing this runtime does not already have.
 *
 * What that costs is the download. The weights are about two gigabytes even at
 * four bits, which is two orders of magnitude past anything else this site
 * fetches, and there is no honest way to shrink it — a model that has to know
 * what a thing looks like is simply large. The page says the figure before the
 * button is pressed rather than after. Nothing is uploaded; the prompt and the
 * picture never leave the machine.
 *
 * WebGPU is required, not preferred. The language model runs 576 forward passes
 * per picture and the WASM backend takes roughly a second over each of them, so
 * the CPU path is not a slow version of this feature, it is a ten-minute wait
 * that ends in the same picture. Better to say so and stop. */
let transformers = null;
let model = null, processor = null;
let stopper = null, cancelled = false;

async function loadRuntime() {
  if (transformers) return transformers;
  transformers = await import('../../vendor/transformers/transformers.min.js');
  /* serve the ONNX runtime .wasm from our vendor dir, not the jsDelivr CDN */
  transformers.env.backends.onnx.wasm.wasmPaths =
    new URL('../../vendor/transformers/', self.location.href).href;
  return transformers;
}

/* Two questions, not one: whether there is an adapter at all, and whether it
   will take half-precision. The second decides which build of each part is
   fetched, so it has to be answered before anything is downloaded rather than
   discovered by a shader failing three minutes in. */
async function inspectAdapter() {
  try {
    if (!('gpu' in navigator)) return { ok: false, reason: 'this browser has no WebGPU' };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'no WebGPU adapter is available' };
    return { ok: true, fp16: adapter.features.has('shader-f16') };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

const MODEL_ID = 'onnx-community/Janus-Pro-1B-ONNX';

/* Which build of each part to fetch. The mixture is the one Hugging Face's own
 * Janus-Pro WebGPU example arrived at, with one deliberate change: lm_head is
 * taken at four bits rather than fp16. It is never called here — forward()
 * picks gen_head whenever the model is generating an image and lm_head only
 * when it is generating text, and this worker only ever asks for images — so
 * the 300 MB the full-precision build would cost buys nothing at all.
 *
 * prepare_inputs_embeds stays on the CPU. It is the largest single file and it
 * runs once per picture rather than 576 times, so what it would gain on the GPU
 * is a fraction of a second against a hold on GPU memory the language model has
 * a better use for. */
const BUILDS = {
  fp16: {
    prepare_inputs_embeds: 'q4', language_model: 'q4f16', lm_head: 'q4f16',
    gen_head: 'fp16', gen_img_embeds: 'fp16', image_decode: 'fp32',
  },
  fp32: {
    prepare_inputs_embeds: 'q4', language_model: 'q4', lm_head: 'q4',
    gen_head: 'fp32', gen_img_embeds: 'fp32', image_decode: 'fp32',
  },
};

const DEVICES = {
  prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu',
  gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu',
};

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

async function load() {
  if (model) return;
  const { MultiModalityCausalLM, AutoProcessor } = await loadRuntime();
  const adapter = await inspectAdapter();
  if (!adapter.ok) throw new Error(adapter.reason);
  fileProgress = new Map();
  postMessage({ type: 'loading', detail: 'Contacting the Hugging Face Hub…' });
  model = await MultiModalityCausalLM.from_pretrained(MODEL_ID, {
    dtype: BUILDS[adapter.fp16 ? 'fp16' : 'fp32'],
    device: DEVICES,
    progress_callback: reportProgress,
  });
  processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: reportProgress });
}

async function run(msg) {
  const token = msg.token;
  cancelled = false;
  try {
    await load();
    postMessage({ type: 'ready', token });
    const { InterruptableStoppingCriteria } = await loadRuntime();
    stopper = new InterruptableStoppingCriteria();

    /* Janus keeps a separate chat template for this direction: the same
       tokeniser, but the prompt is wrapped so that what follows it is read as
       the opening of a picture rather than of a reply. */
    const inputs = await processor(
      [{ role: '<|User|>', content: msg.prompt }],
      { chat_template: 'text_to_image' }
    );
    const total = processor.num_image_tokens;

    /* The streamer is handed the whole prompt first and one token per step
       after that, so the first call is skipped and the rest are the count. */
    let seen = -1;
    const streamer = {
      put: () => { if (seen++ >= 0) postMessage({ type: 'tick', token, done: seen, total }); },
      end: () => {},
    };

    /* No guidance_scale, deliberately, and it must stay that way until the
       runtime is fixed. Classifier-free guidance is what Janus is tuned for and
       turning it on here is one word — but this runtime's implementation of it
       for Janus is broken three ways over, and the result is not a worse
       picture, it is vertical stripes. Asking prepare_inputs_for_generation for
       a guided step shows why: input_ids and attention_mask are doubled to
       [2, L] for the conditional and unconditional halves, while images_seq_mask
       and images_emb_mask are left at [1, L]; the unconditional half is given an
       attention mask of all zeros, so it attends to nothing; and every one of
       its tokens is the pad id, where reference Janus keeps the opening BOS and
       the trailing image_start tag. The unconditional logits come back
       degenerate, cond + w * (cond - uncond) blows up, and the sampler locks
       onto a single token a couple of rows in. Hugging Face's own Janus example
       passes no guidance_scale either, and generation_config.json has no such
       key, so every published run of this model is an unguided one. */
    const [image] = await model.generate_images({
      ...inputs,
      min_new_tokens: total,
      max_new_tokens: total,
      do_sample: true,
      temperature: msg.temperature,
      top_p: msg.topP,
      streamer,
      stopping_criteria: stopper,
    });
    if (cancelled) return;

    const rgba = image.rgba();
    const data = new Uint8ClampedArray(rgba.data);
    postMessage(
      { type: 'result', token, data, width: rgba.width, height: rgba.height },
      [data.buffer]
    );
  } catch (err) {
    /* An interrupted run comes back short, and the decoder rejects a token
       sequence that is not a whole picture. That throw is the cancellation
       arriving, not a fault, so it is reported as one. */
    if (cancelled) { postMessage({ type: 'cancelled', token }); return; }
    postMessage({ type: 'error', token, message: String(err?.message || err) });
  } finally {
    stopper = null;
  }
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'run') run(msg);
  else if (msg.type === 'cancel') { cancelled = true; stopper?.interrupt(); }
};
