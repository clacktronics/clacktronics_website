/* ClackPaint upscaling worker — Swin2SR, the one super-resolution architecture
 * the vendored Transformers.js can run, used to enlarge a picture with a model
 * rather than with a filter. Weights are fetched from the Hugging Face Hub on
 * first use and cached by the browser; the picture itself never leaves the
 * machine.
 *
 * A resampling filter can only ever redistribute the detail already there. It
 * has no idea what an edge is, so enlarging with one gives a soft picture with
 * the same information spread over more pixels. These models were trained on
 * pairs of the same photograph large and small, so they put back the edge they
 * expect to have been lost — which is a guess, and worth having exactly when a
 * guess is better than a blur, and not when the picture is being made smaller.
 *
 * Each checkpoint enlarges by its own fixed factor and has no say in the
 * matter. Reaching some other size from that is resampling, which the page
 * already does well, so the worker's job stops at the model's own multiple. */

const MODELS = {
  'swin2sr-x2': { id: 'Xenova/swin2SR-classical-sr-x2-64', scale: 2 },
  'swin2sr-x2-light': { id: 'Xenova/swin2SR-lightweight-x2-64', scale: 2 },
  'swin2sr-x4': { id: 'Xenova/swin2SR-classical-sr-x4-64', scale: 4 },
  'swin2sr-x4-real': { id: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', scale: 4 },
  'swin2sr-x4-jpeg': { id: 'Xenova/swin2SR-compressed-sr-x4-48', scale: 4 },
};

/* One build per model rather than one per device, which is not what the other
 * workers here do and is the answer measurement gave. The half-precision builds
 * cannot even open a session on the WASM backend — onnxruntime-web rejects the
 * graph — so the CPU path has to be 8-bit or full. Against the full build the
 * 8-bit one measured 28.11 dB where fp32 gave 28.32 on the same picture: two
 * tenths of a decibel for a third of the download. On WebGPU the picture is
 * different, because 8-bit weights there mean dynamic quantisation nodes that
 * drop back to the processor mid-graph, so full precision is both simpler and
 * quicker on the device where the download matters least. */
const DTYPES = { wasm: 'q8', webgpu: 'fp32' };

/* Tiles, because a whole photograph will not fit. Attention is quadratic in the
 * window count and the WASM heap is 32-bit, so a picture of any size goes
 * through in squares. 192 and 32 are both multiples of the model's window size,
 * which means no tile is padded and every inference has the same shape — the
 * runtime plans the graph once and reuses it.
 *
 * The overlap is not free: at this step each pixel is looked at about 1.4 times.
 * What it buys is a seam nobody can see, which is worth more than the minute. */
const TILE = 192, OVERLAP = 32;

let transformers = null;
/* One model at a time. These are small next to the segmentation models next
   door, but the reason is the same: two sets of weights on one GPU adapter is
   how you get a broken context rather than a clean failure. */
let loaded = null;              /* { method, upscaler } */
let device = null;
let currentToken = -1;

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
  try { await going.upscaler.dispose(); } catch { /* already gone */ }
}

async function load(method) {
  if (loaded?.method === method) return loaded.upscaler;
  const model = MODELS[method];
  if (!model) throw new Error(`unknown model "${method}"`);
  await release();
  const { pipeline } = await loadRuntime();
  if (device === null) device = await hasWebGPU() ? 'webgpu' : 'wasm';
  fileProgress = new Map();
  postMessage({ type: 'loading', detail: 'Contacting the Hugging Face Hub…' });
  const upscaler = await pipeline('image-to-image', model.id, {
    device,
    dtype: DTYPES[device],
    progress_callback: reportProgress,
  });
  loaded = { method, upscaler };
  return upscaler;
}

/* Where the tiles start along one axis. Every tile is the full TILE wide except
   on a picture smaller than one, and the last one is pulled back against the
   far edge rather than allowed to hang over it. */
function tileStarts(size) {
  if (size <= TILE) return [0];
  const step = TILE - OVERLAP;
  const starts = [];
  for (let at = 0; at + TILE < size; at += step) starts.push(at);
  starts.push(size - TILE);
  return starts;
}

/* A raised cosine across the overlap, and flat everywhere else: a tile fades in
   over the strip it shares with the tile before and out over the strip it
   shares with the tile after, and holds its full say in between. The two ends
   of the picture do not fade, having nothing to fade into. */
function tileWeights(start, span, size, scale) {
  const weights = new Float32Array(span * scale);
  const ramp = OVERLAP * scale;
  const fadeIn = start > 0, fadeOut = start + span < size;
  for (let i = 0; i < weights.length; i++) {
    let weight = 1;
    if (fadeIn && i < ramp) weight = 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / ramp);
    if (fadeOut && i >= weights.length - ramp) {
      const back = weights.length - 1 - i;
      weight = Math.min(weight, 0.5 - 0.5 * Math.cos(Math.PI * (back + 0.5) / ramp));
    }
    weights[i] = weight;
  }
  return weights;
}

/* The tiles form a full grid and each one's say is an X ramp times a Y ramp, so
   the total weight landing on a pixel factorises into one number per column
   times one per row. That is the whole reason there is no weight buffer here:
   two arrays of a few thousand floats stand in for one the size of the finished
   picture, which at four times a large photograph is a hundred megabytes not
   asked for. */
function axisTotals(starts, size, scale) {
  const totals = new Float32Array(size * scale);
  for (const start of starts) {
    const span = Math.min(TILE, size);
    const weights = tileWeights(start, span, size, scale);
    for (let i = 0; i < weights.length; i++) totals[start * scale + i] += weights[i];
  }
  return totals;
}

/* The processor pads each tile up to a multiple of the window size before the
   model sees it, and the padding comes back enlarged along with everything
   else, so the result is cropped to what was actually asked for. */
function cropTile(result, span, height, scale) {
  const outW = span * scale, outH = height * scale;
  if (result.width === outW && result.height === outH) return result.data;
  const cropped = new Uint8ClampedArray(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    const from = y * result.width * 3, to = y * outW * 3;
    cropped.set(result.data.subarray(from, from + outW * 3), to);
  }
  return cropped;
}

async function run(msg) {
  const token = msg.token;
  currentToken = token;
  try {
    const model = MODELS[msg.method];
    if (!model) throw new Error(`unknown model "${msg.method}"`);
    const upscaler = await load(msg.method);
    if (token !== currentToken) return;
    postMessage({ type: 'ready', device, scale: model.scale, token });

    const { RawImage } = await loadRuntime();
    const scale = model.scale;
    const width = msg.width, height = msg.height;
    const source = new Uint8ClampedArray(msg.data);
    const outW = width * scale, outH = height * scale;

    const columns = tileStarts(width), rows = tileStarts(height);
    const spanX = Math.min(TILE, width), spanY = Math.min(TILE, height);
    const totalTiles = columns.length * rows.length;
    const accumulator = new Float32Array(outW * outH * 3);
    const tile = new Uint8ClampedArray(spanX * spanY * 4);

    const columnWeightsAt = new Map(columns.map(left => [left, tileWeights(left, spanX, width, scale)]));
    let done = 0;
    for (const top of rows) {
      const rowWeights = tileWeights(top, spanY, height, scale);
      for (const left of columns) {
        if (token !== currentToken) return;
        postMessage({ type: 'tile', token, done, total: totalTiles });
        for (let y = 0; y < spanY; y++) {
          const from = ((top + y) * width + left) * 4;
          tile.set(source.subarray(from, from + spanX * 4), y * spanX * 4);
        }
        const result = await upscaler(new RawImage(tile, spanX, spanY, 4));
        if (token !== currentToken) return;
        const pixels = cropTile(result, spanX, spanY, scale);
        const columnWeights = columnWeightsAt.get(left);
        for (let y = 0; y < spanY * scale; y++) {
          const weightY = rowWeights[y];
          const into = ((top * scale + y) * outW + left * scale) * 3;
          const from = y * spanX * scale * 3;
          for (let x = 0; x < spanX * scale; x++) {
            const weight = weightY * columnWeights[x];
            accumulator[into + x * 3] += pixels[from + x * 3] * weight;
            accumulator[into + x * 3 + 1] += pixels[from + x * 3 + 1] * weight;
            accumulator[into + x * 3 + 2] += pixels[from + x * 3 + 2] * weight;
          }
        }
        done++;
      }
    }

    const columnTotals = axisTotals(columns, width, scale);
    const rowTotals = axisTotals(rows, height, scale);
    const out = new Uint8ClampedArray(outW * outH * 3);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const at = (y * outW + x) * 3;
        const divisor = rowTotals[y] * columnTotals[x];
        out[at] = accumulator[at] / divisor;
        out[at + 1] = accumulator[at + 1] / divisor;
        out[at + 2] = accumulator[at + 2] / divisor;
      }
    }
    postMessage({ type: 'result', token, data: out, width: outW, height: outH, scale }, [out.buffer]);
  } catch (err) {
    /* a model that has failed mid-run may be holding a device that is now in a
       bad way; let it go rather than hand it to the next run */
    await release();
    if (token !== currentToken) return;
    postMessage({ type: 'error', token, message: String(err?.message || err) });
  }
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'run') run(msg);
  /* Cancelling only bumps the token: the tile in flight is left to finish
     rather than the worker thrown away, so the weights are still there for the
     next attempt. Nothing is posted back for a run nobody is waiting for. */
  else if (msg.type === 'cancel') currentToken = -1;
};
