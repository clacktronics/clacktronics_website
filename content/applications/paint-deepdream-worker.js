/* ClackPaint DeepDream worker — the original 2015 effect, in the browser.
 *
 * Gradient ascent on an intermediate activation of inception5h, the ImageNet
 * GoogLeNet Google dreamed with in the first place, which is why what grows out
 * of the picture is dogs and birds. The model (Apache-2.0) is vendored under
 * vendor/inception5h/ as a trimmed graph plus one fp16 blob; nothing is
 * uploaded and nothing is fetched from anyone else's server.
 *
 * The one structural thing worth knowing: TensorFlow.js graph models are
 * inference-only, and DeepDream is *nothing but* gradients, so the network
 * cannot be loaded with tf.loadGraphModel. Instead the trunk is rebuilt here
 * op by op from graph.json using plain tf functions — all six op types it uses
 * have registered gradients — and tf.grad differentiates straight through it.
 */
import * as tf from '../../vendor/tfjs/tf.fesm.min.js';

const MODEL_BASE = new URL('../../vendor/inception5h/', import.meta.url);

/* Gradients are taken tile by tile, as in the original notebook: it bounds how
   much lives on the GPU at once, and the random offset each pass stops tile
   boundaries from printing themselves into the picture. */
const TILE = 512;
const CPU_TILE = 192;             /* the CPU kernels are slow enough to need smaller bites */
const MIN_OCTAVE = 48;            /* an octave below this is too small to dream in */

let graph = null;                 /* the trimmed inception5h description */
let weights = null;               /* Map<string, tf.Tensor> */
let device = null;
let cancelToken = -1;             /* runs whose token matches this are abandoned */

/* fp16 → fp32 through a 64k table. The blob holds six million halves and the
   arithmetic per value is not free, but every possible half fits in one table. */
const HALF_TO_FLOAT = (() => {
  const table = new Float32Array(65536);
  for (let bits = 0; bits < 65536; bits++) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    if (exponent === 0) table[bits] = sign * 2 ** -14 * (fraction / 1024);
    else if (exponent === 31) table[bits] = fraction ? NaN : sign * Infinity;
    else table[bits] = sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return table;
})();

async function selectBackend() {
  /* WebGL in a worker needs OffscreenCanvas for its drawing surface; where the
     browser will not give us one, the CPU kernels still work, just slowly. */
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      await tf.setBackend('webgl');
      await tf.ready();
    } catch { /* fall through to the CPU backend */ }
  }
  if (tf.getBackend() !== 'webgl') {
    await tf.setBackend('cpu');
    await tf.ready();
  }
  device = tf.getBackend();
}

async function fetchWeights(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch the model (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  /* Without a readable stream there is no progress to report — the download
     still works, the bar just jumps at the end. */
  if (!response.body) return { buffer: await response.arrayBuffer(), total };
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0, lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const now = Date.now();
    if (now - lastReport > 120) { lastReport = now; postMessage({ type: 'progress', loaded, total }); }
  }
  postMessage({ type: 'progress', loaded, total: total || loaded });
  const buffer = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; }
  return { buffer: buffer.buffer, total };
}

async function load() {
  if (weights) return;
  await selectBackend();
  postMessage({ type: 'loading', detail: 'Reading the model description…' });
  graph = await (await fetch(new URL('graph.json', MODEL_BASE))).json();
  postMessage({ type: 'loading', detail: 'Fetching the network weights…' });
  const { buffer } = await fetchWeights(new URL('weights.bin', MODEL_BASE));
  postMessage({ type: 'loading', detail: 'Unpacking the network…' });
  const halves = new Uint16Array(buffer);
  const built = new Map();
  for (const [name, spec] of Object.entries(graph.weights)) {
    const count = spec.shape.reduce((total, dim) => total * dim, 1);
    const start = spec.offset / 2;
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = HALF_TO_FLOAT[halves[start + i]];
    built.set(name, tf.tensor(values, spec.shape));
  }
  weights = built;
}

/* ---- the network ---- */

/* Runs the trunk over `input` and hands back the named activation. Everything
   in here is differentiable, which is the whole point. */
function forward(input, target) {
  const values = new Map();
  for (const op of graph.ops) {
    let output;
    switch (op.op) {
      case 'input': output = input; break;
      case 'conv2d':
        output = tf.conv2d(values.get(op.input), weights.get(op.filter), op.strides, op.pad);
        break;
      case 'biasAdd': output = tf.add(values.get(op.input), weights.get(op.bias)); break;
      case 'relu': output = tf.relu(values.get(op.input)); break;
      case 'maxPool':
        output = tf.maxPool(values.get(op.input), op.ksize, op.strides, op.pad);
        break;
      case 'avgPool':
        output = tf.avgPool(values.get(op.input), op.ksize, op.strides, op.pad);
        break;
      case 'lrn':
        output = tf.localResponseNormalization(
          values.get(op.input), op.depthRadius, op.bias, op.alpha, op.beta);
        break;
      case 'concat':
        output = tf.concat(op.inputs.map(name => values.get(name)), op.axis);
        break;
      default: throw new Error(`unknown op ${op.op}`);
    }
    values.set(op.name, output);
    if (op.name === target) return output;
  }
  throw new Error(`the model has no layer called ${target}`);
}

/* What the picture is pushed towards: how loudly the chosen layer — or one
   single feature of it — answers. */
function objective(activation, channel) {
  const wanted = channel >= 0
    ? tf.slice(activation, [0, 0, 0, channel], [-1, -1, -1, 1])
    : activation;
  return tf.mean(tf.square(wanted));
}

/* ---- gradients ---- */

function roll(image, shiftY, shiftX) {
  const height = image.shape[1], width = image.shape[2];
  let out = image;
  if (shiftY) {
    out = tf.concat([
      tf.slice(out, [0, height - shiftY, 0, 0], [-1, shiftY, -1, -1]),
      tf.slice(out, [0, 0, 0, 0], [-1, height - shiftY, -1, -1]),
    ], 1);
  }
  if (shiftX) {
    out = tf.concat([
      tf.slice(out, [0, 0, width - shiftX, 0], [-1, -1, shiftX, -1]),
      tf.slice(out, [0, 0, 0, 0], [-1, -1, width - shiftX, -1]),
    ], 2);
  }
  return out;
}

/* Tile starts and sizes along one axis, with any short last tile folded into
   the one before it — a sliver narrower than the network's own 32× reduction
   would have nothing left to convolve. */
function spans(length, tile) {
  const out = [];
  for (let start = 0; start < length; start += tile) {
    out.push([start, Math.min(tile, length - start)]);
  }
  if (out.length > 1 && out[out.length - 1][1] < MIN_OCTAVE) {
    out[out.length - 2][1] += out[out.length - 1][1];
    out.pop();
  }
  return out;
}

/* The notebook's calc_grad_tiled: shift the picture by a random amount, take
   the gradient one tile at a time, then shift the result back. */
function tiledGradient(image, layer, channel, tile) {
  return tf.tidy(() => {
    const height = image.shape[1], width = image.shape[2];
    const shiftY = Math.floor(Math.random() * Math.min(tile, height));
    const shiftX = Math.floor(Math.random() * Math.min(tile, width));
    const shifted = roll(image, shiftY, shiftX);
    const gradient = tf.grad(x => objective(forward(x, layer), channel));
    const rows = [];
    for (const [top, tileHeight] of spans(height, tile)) {
      const columns = [];
      for (const [left, tileWidth] of spans(width, tile)) {
        const patch = tf.slice(shifted, [0, top, left, 0], [-1, tileHeight, tileWidth, -1]);
        columns.push(gradient(patch));
      }
      rows.push(columns.length > 1 ? tf.concat(columns, 2) : columns[0]);
    }
    const whole = rows.length > 1 ? tf.concat(rows, 1) : rows[0];
    return roll(whole, shiftY ? height - shiftY : 0, shiftX ? width - shiftX : 0);
  });
}

/* ---- Laplacian pyramid normalisation (the "smooth" variant) ----
   Plain gradient ascent piles detail on at whatever scale the layer likes best;
   flattening the gradient's own frequency bands spreads it evenly instead, for
   the softer look of the notebook's render_lapnorm. */
let laplaceKernel = null;
function kernel() {
  if (laplaceKernel) return laplaceKernel;
  const taps = [1, 4, 6, 4, 1];
  const values = new Float32Array(5 * 5 * 3 * 3);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const weight = taps[y] * taps[x] / 256;
      for (let channel = 0; channel < 3; channel++) {
        values[((y * 5 + x) * 3 + channel) * 3 + channel] = weight;
      }
    }
  }
  laplaceKernel = tf.keep(tf.tensor(values, [5, 5, 3, 3]));
  return laplaceKernel;
}

function laplacianNormalise(gradient, levels = 4) {
  return tf.tidy(() => {
    const k = kernel();
    const bands = [];
    let current = gradient;
    for (let level = 0; level < levels - 1; level++) {
      if (current.shape[1] < 8 || current.shape[2] < 8) break;
      const low = tf.conv2d(current, k, 2, 'same');
      const expanded = tf.conv2dTranspose(low, tf.mul(k, 4), current.shape, 2, 'same');
      bands.push(tf.sub(current, expanded));
      current = low;
    }
    bands.push(current);              /* the last one is what is left over, not a band */
    /* every band brought to unit scale, then folded back together the way it
       came apart */
    const flat = bands.map(band => tf.div(band, tf.add(tf.sqrt(tf.mean(tf.square(band))), 1e-8)));
    let merged = flat[flat.length - 1];
    for (let level = flat.length - 2; level >= 0; level--) {
      const expanded = tf.conv2dTranspose(merged, tf.mul(k, 4), flat[level].shape, 2, 'same');
      merged = tf.add(expanded, flat[level]);
    }
    return merged;
  });
}

/* ---- the dream ---- */

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

function toPixels(image, alpha, width, height) {
  const scaled = tf.tidy(() => {
    const full = image.shape[1] === height && image.shape[2] === width
      ? image
      : tf.image.resizeBilinear(image, [height, width]);
    return tf.clipByValue(tf.add(full, graph.imagenetMean), 0, 255);
  });
  const values = scaled.dataSync();
  scaled.dispose();
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, at = 0; i < pixels.length; i += 4, at += 3) {
    pixels[i] = values[at];
    pixels[i + 1] = values[at + 1];
    pixels[i + 2] = values[at + 2];
    pixels[i + 3] = alpha[i + 3];
  }
  return pixels;
}

async function dream(job) {
  const { token, width, height, layer, channel, step, iterations, octaves, octaveScale, smooth } = job;
  const source = new Uint8ClampedArray(job.data);
  const tile = device === 'webgl' ? TILE : CPU_TILE;

  /* the picture as the network wants it: RGB, mean-centred, no scaling */
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, at = 0; i < source.length; i += 4, at += 3) {
    rgb[at] = source[i] - graph.imagenetMean;
    rgb[at + 1] = source[i + 1] - graph.imagenetMean;
    rgb[at + 2] = source[i + 2] - graph.imagenetMean;
  }

  let image = tf.tensor(rgb, [1, height, width, 3]);
  const details = [];
  /* Split the picture into octaves first, keeping each level's detail aside, so
     the dream starts on a small blurry copy — that is what makes the shapes it
     grows large enough to read, rather than a fizz of pixel-sized noise. */
  for (let level = 0; level < octaves - 1; level++) {
    const low = Math.round(image.shape[1] / octaveScale);
    const narrow = Math.round(image.shape[2] / octaveScale);
    if (low < MIN_OCTAVE || narrow < MIN_OCTAVE) break;
    const smaller = tf.image.resizeBilinear(image, [low, narrow]);
    const back = tf.image.resizeBilinear(smaller, [image.shape[1], image.shape[2]]);
    details.push(tf.sub(image, back));
    back.dispose();
    image.dispose();
    image = smaller;
  }

  /* Cancelling walks out of the middle of this, so the tensors the run is
     holding are freed on the way out however it ends. */
  try {
    const passes = details.length + 1;
    for (let octave = 0; octave < passes; octave++) {
      if (octave > 0) {
        const detail = details.pop();
        const grown = tf.image.resizeBilinear(image, [detail.shape[1], detail.shape[2]]);
        image.dispose();
        image = tf.add(grown, detail);
        grown.dispose();
        detail.dispose();
      }
      for (let iteration = 0; iteration < iterations; iteration++) {
        if (token === cancelToken) return;
        const stepped = tf.tidy(() => {
          let gradient = tiledGradient(image, layer, channel, tile);
          if (smooth) gradient = laplacianNormalise(gradient);
          /* Normalising by the gradient's own average size is what keeps one
             step worth the same amount whatever the layer's numbers happen to
             be — a deep layer answers in hundreds, an early one in tens. */
          const scale = tf.div(step, tf.add(tf.mean(tf.abs(gradient)), 1e-7));
          return tf.add(image, tf.mul(gradient, scale));
        });
        image.dispose();
        image = stepped;
        postMessage({
          type: 'tick', token, octave: octave + 1, octaves: passes,
          iteration: iteration + 1, iterations,
        });
        await nextTick();               /* lets a cancel message get a word in */
      }
      if (token === cancelToken) return;
      if (octave < passes - 1) {
        const preview = toPixels(image, source, width, height);
        postMessage(
          { type: 'preview', token, data: preview, width, height },
          [preview.buffer]
        );
        await nextTick();
      }
    }
    if (token === cancelToken) return;
    const pixels = toPixels(image, source, width, height);
    postMessage({ type: 'result', token, data: pixels, width, height }, [pixels.buffer]);
  } finally {
    image.dispose();
    for (const detail of details) detail.dispose();
  }
}

async function run(job) {
  try {
    await load();
    if (job.token === cancelToken) return;
    postMessage({ type: 'ready', token: job.token, device });
    await dream(job);
  } catch (error) {
    postMessage({ type: 'error', token: job.token, message: String(error?.message || error) });
  }
}

self.onmessage = event => {
  const message = event.data;
  if (message.type === 'run') run(message);
  else if (message.type === 'cancel') cancelToken = message.token;
};

/* Also importable as a plain module, which is how the port was checked against
   the same weights run through numpy: load(), then forward() a known picture
   and compare the activations layer by layer. */
export { tf, load, forward, objective };
