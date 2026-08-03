/* ClackPaint object-select worker — Meta's Segment Anything, in the pruned
 * SlimSAM form, run entirely in the browser through Transformers.js.
 *
 * SAM is split in two on purpose and the split is what makes it usable here.
 * The vision encoder looks at the picture once and produces an embedding; that
 * is the slow half, seconds rather than milliseconds. The prompt encoder and
 * mask decoder then answer "what is at this point?" against that embedding in a
 * fraction of a second, over and over, for as many clicks as it takes. So the
 * embedding is made once per picture and kept, and every click after that is
 * cheap enough to feel like a tool rather than a job.
 *
 * Each decode returns three masks — roughly a detail, a part, and the whole
 * object — with the model's own opinion of each. Which one is wanted is a
 * question only the person clicking can answer, so all three scores come back
 * and the page decides. */
let transformers = null;
let model = null, processor = null, device = null;
let embedding = null;      /* { imageId, inputs, embeddings } */

async function loadRuntime() {
  if (transformers) return transformers;
  transformers = await import('../../vendor/transformers/transformers.min.js');
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

const MODEL_ID = 'Xenova/slimsam-77-uniform';

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
  }
}

async function load() {
  if (model) return;
  const { SamModel, AutoProcessor } = await loadRuntime();
  if (device === null) device = await hasWebGPU() ? 'webgpu' : 'wasm';
  fileProgress = new Map();
  postMessage({ type: 'loading', detail: 'Fetching the object-select model…' });
  /* Full precision, deliberately. SlimSAM ships an 8-bit build a third of the
     size and it does not survive the pruning the model has already had: the
     scores collapse and the mask comes back as static rather than an object.
     40 MB fetched once is the price of the tool working at all. */
  model = await SamModel.from_pretrained(MODEL_ID, {
    device,
    dtype: 'fp32',
    progress_callback: reportProgress
  });
  processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: reportProgress });
}

async function encode(msg) {
  const { RawImage } = await loadRuntime();
  const image = new RawImage(new Uint8ClampedArray(msg.data), msg.width, msg.height, 4);
  const inputs = await processor(image);
  embedding = {
    imageId: msg.imageId,
    inputs,
    embeddings: await model.get_image_embeddings(inputs),
    width: msg.width,
    height: msg.height
  };
}

/* Points arrive in picture pixels; SAM wants them in the padded square the
   processor resized the picture into, so each is carried across by the ratio
   the processor itself reported. */
async function decode(msg) {
  const { Tensor } = await loadRuntime();
  const [reshapedHeight, reshapedWidth] = embedding.inputs.reshaped_input_sizes[0];
  const coordinates = [], labels = [];
  for (const point of msg.points) {
    coordinates.push(point.x / embedding.width * reshapedWidth, point.y / embedding.height * reshapedHeight);
    labels.push(point.positive ? 1n : 0n);
  }
  const input_points = new Tensor('float32', coordinates, [1, 1, msg.points.length, 2]);
  const input_labels = new Tensor('int64', labels, [1, 1, msg.points.length]);
  const outputs = await model({ ...embedding.embeddings, input_points, input_labels });
  const masks = await processor.post_process_masks(
    outputs.pred_masks, embedding.inputs.original_sizes, embedding.inputs.reshaped_input_sizes
  );
  const scores = Array.from(outputs.iou_scores.data);
  const [, candidates, height, width] = masks[0].dims;
  let chosen = 0;
  if (msg.scope === 'auto') {
    for (let i = 1; i < candidates; i++) if (scores[i] > scores[chosen]) chosen = i;
  } else {
    chosen = Math.min(candidates - 1, Math.max(0, Number(msg.scope)));
  }
  /* the mask tensor is one boolean per pixel per candidate, laid out plane by
     plane; the page wants coverage bytes for the one candidate it is having */
  const source = masks[0].data;
  const plane = chosen * width * height;
  const coverage = new Uint8ClampedArray(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = source[plane + i] ? 255 : 0;
  return { coverage, width, height, scores, chosen };
}

self.onmessage = async e => {
  const msg = e.data;
  const token = msg.token;
  try {
    if (msg.type === 'select') {
      await load();
      postMessage({ type: 'ready', device, token });
      if (!embedding || embedding.imageId !== msg.imageId) {
        postMessage({ type: 'loading', detail: 'Looking at the picture…' });
        embedding = null;
        await encode(msg);
      }
      const { coverage, width, height, scores, chosen } = await decode(msg);
      postMessage(
        { type: 'mask', token, data: coverage, width, height, scores, chosen },
        [coverage.buffer]
      );
    }
  } catch (err) {
    embedding = null;
    postMessage({ type: 'error', token, message: String(err?.message || err) });
  }
};
