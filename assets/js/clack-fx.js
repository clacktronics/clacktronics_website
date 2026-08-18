/* ClackFX — the filter maths shared by ClackPaint and Video Lab.
 *
 * These functions began as a section of paint.html and moved out here when
 * Video Lab wanted the same filters frame by frame. Nothing about them is
 * specific to either app: a filter takes an ImageData and its dialog's values
 * and returns fresh pixels, so the same run() serves a layer, a preview and
 * the four hundredth frame of a clip.
 *
 * The file is a plain script rather than a module on purpose. ClackPaint's own
 * code is one large inline script that cannot import, and Video Lab's render
 * workers pull it in with importScripts; a module would serve neither. So it
 * hangs one object off globalThis, which is `window` on a page and the worker
 * scope inside a worker, and both get at it the same way.
 *
 * Three filters want something the picture cannot tell them — the two colours
 * Clouds paints between, and the point Selective Colour was aimed at. Those
 * used to be reached for as paint globals, which a worker has none of, so the
 * caller now sets them through setContext() before it runs anything.
 *
 * Sampling wraps around the edges wherever wrapping means something, so a
 * filter run over a tile leaves it seamless; the radial filters clamp instead,
 * because a tile has no meaningful centre.
 */
(() => {
'use strict';

/* What the picture cannot say. ClackPaint fills these from its colour wells
   and the last click; Video Lab from its own effect panel. */
const hostContext = { fg: '#ffffff', bg: '#000000', pin: null };
const setContext = next => Object.assign(hostContext, next);

/* Retouch's bilateral blur backs two of the filters below. It lives in
   paint-retouch.js and is looked up when a filter actually runs, so an app
   that never offers Surface Blur or Clarity does not have to load it. */
const retouchOf = () => {
  const found = globalThis.ClackRetouch;
  if (!found) throw new Error('This filter needs paint-retouch.js, which is not loaded.');
  return found;
};

const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));

const blankImage = (w, h) => new ImageData(w, h);
const copyImage = image => new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
const wrapIndex = (value, limit) => ((value % limit) + limit) % limit;
const edgeIndex = (value, limit, wrap) => wrap ? wrapIndex(value, limit) : value < 0 ? 0 : value >= limit ? limit - 1 : value;
const smoothStep = t => t * t * (3 - 2 * t);

/* A small integer hash — the seed for the noise lattice, for the jittered cell
   centres in Crystallize and for the span lengths in Pixel Sorting, all of
   which must be repeatable. */
function hashNoise(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/* Bilinear sampling on premultiplied colour, so a distortion that reaches
   across a transparent edge does not drag black fringes with it. */
function sampleImage(src, x, y, wrap, out) {
  const w = src.width, h = src.height, data = src.data;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let dy = 0; dy < 2; dy++) {
    const weightY = dy ? fy : 1 - fy;
    if (!weightY) continue;
    const sy = edgeIndex(y0 + dy, h, wrap);
    for (let dx = 0; dx < 2; dx++) {
      const weight = weightY * (dx ? fx : 1 - fx);
      if (!weight) continue;
      const i = (sy * w + edgeIndex(x0 + dx, w, wrap)) * 4, alpha = data[i + 3] / 255 * weight;
      r += data[i] * alpha; g += data[i + 1] * alpha; b += data[i + 2] * alpha; a += alpha;
    }
  }
  out[3] = a * 255;
  if (a > 1e-4) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else { out[0] = out[1] = out[2] = 0; }
  return out;
}

/* Every distortion is an inverse map: for each destination pixel work out
   where its colour came from, then sample there. */
function remapImage(src, wrap, map) {
  const w = src.width, h = src.height, out = blankImage(w, h), data = out.data;
  const point = [0, 0], sample = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    point[0] = x + .5; point[1] = y + .5;
    map(point);
    sampleImage(src, point[0] - .5, point[1] - .5, wrap, sample);
    const i = (y * w + x) * 4;
    data[i] = sample[0]; data[i + 1] = sample[1]; data[i + 2] = sample[2]; data[i + 3] = sample[3];
  }
  return out;
}

/* A tap that lands on a transparent pixel would drag its undefined colour into
   the result, so those taps borrow the centre pixel's colour instead. Alpha is
   carried straight through: a convolution never moves the layer's shape. */
function convolveImage(src, kernel, size, divisor, bias, wrap) {
  const w = src.width, h = src.height, data = src.data;
  const out = blankImage(w, h), result = out.data, half = (size - 1) / 2, scale = divisor || 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const centre = (y * w + x) * 4;
    let r = 0, g = 0, b = 0;
    for (let ky = 0; ky < size; ky++) {
      const sy = edgeIndex(y + ky - half, h, wrap);
      for (let kx = 0; kx < size; kx++) {
        const weight = kernel[ky * size + kx];
        if (!weight) continue;
        let i = (sy * w + edgeIndex(x + kx - half, w, wrap)) * 4;
        if (!data[i + 3]) i = centre;
        r += data[i] * weight; g += data[i + 1] * weight; b += data[i + 2] * weight;
      }
    }
    result[centre] = r / scale + bias; result[centre + 1] = g / scale + bias; result[centre + 2] = b / scale + bias;
    result[centre + 3] = data[centre + 3];
  }
  return out;
}

/* A canvas to work on, wherever this is running. On a page that is the element
   ClackPaint has always used; in a render worker there is no document, and
   OffscreenCanvas is the only one on offer. */
function scratchCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    return canvas;
  }
  return new OffscreenCanvas(w, h);
}

/* The browser's own Gaussian, borrowed for the filters that need a blurred
   copy to work from. Tiling it 3 × 3 keeps the wrap-around seamless, exactly
   as Effects → Gaussian Blur does. */
function blurredImage(src, radius, wrap = true) {
  if (radius <= 0) return copyImage(src);
  const w = src.width, h = src.height;
  const source = scratchCanvas(w, h);
  source.getContext('2d').putImageData(src, 0, 0);
  const canvas = scratchCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.filter = `blur(${radius}px)`;
  if (wrap) { for (const x of [-w, 0, w]) for (const y of [-h, 0, h]) context.drawImage(source, x, y); }
  else context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, w, h);
}

/* Separable box blur over premultiplied colour, running sums rather than a
   window per pixel, so the cost does not grow with the radius. */
function boxBlurImage(src, radius, wrap) {
  const w = src.width, h = src.height, data = src.data, size = Math.max(0, Math.round(radius));
  if (!size) return copyImage(src);
  let plane = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    plane[i] = data[i] * alpha; plane[i + 1] = data[i + 1] * alpha; plane[i + 2] = data[i + 2] * alpha; plane[i + 3] = alpha;
  }
  const pass = (input, horizontal) => {
    const output = new Float32Array(input.length);
    const lines = horizontal ? h : w, count = horizontal ? w : h;
    const step = horizontal ? 4 : w * 4, span = size * 2 + 1;
    for (let line = 0; line < lines; line++) {
      const start = horizontal ? line * w * 4 : line * 4;
      const at = position => start + step * edgeIndex(position, count, wrap);
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let k = -size; k <= size; k++) { const i = at(k); s0 += input[i]; s1 += input[i + 1]; s2 += input[i + 2]; s3 += input[i + 3]; }
      for (let position = 0; position < count; position++) {
        const o = start + step * position;
        output[o] = s0 / span; output[o + 1] = s1 / span; output[o + 2] = s2 / span; output[o + 3] = s3 / span;
        const gone = at(position - size), added = at(position + size + 1);
        s0 += input[added] - input[gone]; s1 += input[added + 1] - input[gone + 1];
        s2 += input[added + 2] - input[gone + 2]; s3 += input[added + 3] - input[gone + 3];
      }
    }
    return output;
  };
  plane = pass(pass(plane, true), false);
  return unpremultiply(plane, w, h);
}

function unpremultiply(plane, w, h) {
  const out = blankImage(w, h), result = out.data;
  for (let i = 0; i < result.length; i += 4) {
    const alpha = plane[i + 3];
    result[i + 3] = alpha * 255;
    if (alpha > 1e-4) { result[i] = plane[i] / alpha; result[i + 1] = plane[i + 1] / alpha; result[i + 2] = plane[i + 2] / alpha; }
  }
  return out;
}

/* Smearing along a line: the average of the pixels the shutter would have
   swept across. */
function motionBlurImage(src, distance, angle, wrap) {
  const w = src.width, h = src.height, out = blankImage(w, h), result = out.data;
  const steps = Math.max(1, Math.round(distance)), radians = angle * Math.PI / 180;
  const stepX = Math.cos(radians), stepY = -Math.sin(radians), sample = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let s = 0; s <= steps; s++) {
      const offset = (s / steps - .5) * distance;
      sampleImage(src, x + stepX * offset, y + stepY * offset, wrap, sample);
      const alpha = sample[3] / 255;
      r += sample[0] * alpha; g += sample[1] * alpha; b += sample[2] * alpha; a += alpha;
    }
    const i = (y * w + x) * 4;
    result[i + 3] = a / (steps + 1) * 255;
    if (a > 1e-4) { result[i] = r / a; result[i + 1] = g / a; result[i + 2] = b / a; }
  }
  return out;
}

/* Spin smears along the arc around the centre, zoom along the ray out of it. */
function radialBlurImage(src, amount, method, centreX, centreY) {
  const w = src.width, h = src.height, out = blankImage(w, h), result = out.data;
  const originX = centreX / 100 * w, originY = centreY / 100 * h;
  const steps = Math.max(3, Math.min(48, Math.round(amount / 2) + 3));
  const sweep = amount / 100 * Math.PI / 7, zoom = amount / 100 * .3, sample = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + .5 - originX, dy = y + .5 - originY;
    let r = 0, g = 0, b = 0, a = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps - .5;
      let sx, sy;
      if (method === 'zoom') { const scale = 1 + t * zoom; sx = originX + dx * scale; sy = originY + dy * scale; }
      else {
        const turn = t * sweep, cos = Math.cos(turn), sin = Math.sin(turn);
        sx = originX + dx * cos - dy * sin; sy = originY + dx * sin + dy * cos;
      }
      sampleImage(src, sx - .5, sy - .5, false, sample);
      const alpha = sample[3] / 255;
      r += sample[0] * alpha; g += sample[1] * alpha; b += sample[2] * alpha; a += alpha;
    }
    const i = (y * w + x) * 4;
    result[i + 3] = a / (steps + 1) * 255;
    if (a > 1e-4) { result[i] = r / a; result[i + 1] = g / a; result[i + 2] = b / a; }
  }
  return out;
}

function unsharpMaskImage(src, amount, radius, threshold, wrap) {
  const low = blurredImage(src, radius, wrap).data, source = src.data;
  const out = copyImage(src), data = out.data, gain = amount / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (!source[i + 3]) continue;
    for (let c = 0; c < 3; c++) {
      const difference = source[i + c] - low[i + c];
      if (Math.abs(difference) >= threshold) data[i + c] = source[i + c] + difference * gain;
    }
  }
  return out;
}

function highPassImage(src, radius, wrap) {
  const low = blurredImage(src, radius, wrap).data, source = src.data;
  const out = copyImage(src), data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    if (!source[i + 3]) continue;
    for (let c = 0; c < 3; c++) data[i + c] = 128 + source[i + c] - low[i + c];
  }
  return out;
}

/* A directional derivative lit from one side: flat areas land on mid grey,
   slopes facing the light go pale and slopes facing away go dark. */
function embossImage(src, angle, height, amount, grey, wrap) {
  const radians = angle * Math.PI / 180, lightX = Math.cos(radians), lightY = -Math.sin(radians);
  const gain = amount / 100 * height, kernel = new Float32Array(9);
  for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
    if (!kx && !ky) continue;
    kernel[(ky + 1) * 3 + kx + 1] = (kx * lightX + ky * lightY) / Math.hypot(kx, ky) * gain;
  }
  const out = convolveImage(src, kernel, 3, 1, 128, wrap);
  if (grey) {
    const data = out.data;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
      data[i] = value; data[i + 1] = value; data[i + 2] = value;
    }
  }
  return out;
}

/* Sobel gradient magnitude, per channel. */
function findEdgesImage(src, amount, invert, grey, wrap) {
  const w = src.width, h = src.height, data = src.data;
  const out = blankImage(w, h), result = out.data, gain = amount / 100;
  const horizontal = [-1, 0, 1, -2, 0, 2, -1, 0, 1], vertical = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const centre = (y * w + x) * 4;
    let edge = 0;
    for (let c = 0; c < 3; c++) {
      let gx = 0, gy = 0;
      for (let ky = 0; ky < 3; ky++) {
        const sy = edgeIndex(y + ky - 1, h, wrap);
        for (let kx = 0; kx < 3; kx++) {
          let i = (sy * w + edgeIndex(x + kx - 1, w, wrap)) * 4;
          if (!data[i + 3]) i = centre;
          const value = data[i + c];
          gx += value * horizontal[ky * 3 + kx]; gy += value * vertical[ky * 3 + kx];
        }
      }
      const magnitude = Math.hypot(gx, gy) * gain;
      result[centre + c] = invert ? 255 - magnitude : magnitude;
      edge = Math.max(edge, magnitude);
    }
    if (grey) {
      const value = invert ? 255 - edge : edge;
      result[centre] = value; result[centre + 1] = value; result[centre + 2] = value;
    }
    result[centre + 3] = data[centre + 3];
  }
  return out;
}

/* Sliding-window minimum or maximum through a monotonic deque, so Maximum and
   Minimum cost the same whatever the radius. */
function slidingExtreme(source, sourceStart, sourceStride, count, radius, maximum, target, targetStart, targetStride) {
  const queue = new Int32Array(count);
  const valueAt = position => source[sourceStart + position * sourceStride];
  let head = 0, tail = 0;
  for (let i = 0; i < count + radius; i++) {
    if (i < count) {
      const value = valueAt(i);
      while (tail > head && (maximum ? valueAt(queue[tail - 1]) <= value : valueAt(queue[tail - 1]) >= value)) tail--;
      queue[tail++] = i;
    }
    const position = i - radius;
    if (position < 0) continue;
    while (queue[head] < position - radius) head++;
    target[targetStart + position * targetStride] = valueAt(queue[head]);
  }
}

/* Maximum spreads the light pixels, Minimum spreads the dark ones. Transparent
   pixels are neutralised first so they cannot win the comparison on colour,
   only on alpha, where growing or shrinking the layer's shape is the point. */
function morphologyImage(src, radius, round, maximum) {
  const w = src.width, h = src.height, data = src.data, size = Math.max(1, Math.round(radius));
  const plane = new Float32Array(w * h * 4), scratch = new Float32Array(plane.length);
  const identity = maximum ? 0 : 255;
  for (let i = 0; i < data.length; i += 4) {
    const opaque = data[i + 3] > 0;
    plane[i] = opaque ? data[i] : identity; plane[i + 1] = opaque ? data[i + 1] : identity;
    plane[i + 2] = opaque ? data[i + 2] : identity; plane[i + 3] = data[i + 3];
  }
  if (!round) {
    for (let c = 0; c < 4; c++) {
      for (let y = 0; y < h; y++) slidingExtreme(plane, y * w * 4 + c, 4, w, size, maximum, scratch, y * w * 4 + c, 4);
      for (let x = 0; x < w; x++) slidingExtreme(scratch, x * 4 + c, w * 4, h, size, maximum, plane, x * 4 + c, w * 4);
    }
  } else {
    /* A disc is the union of horizontal spans, one per row offset, so each
       output row merges 2r + 1 sliding passes of the rows around it. */
    const row = new Float32Array(w), line = new Float32Array(w);
    for (let c = 0; c < 4; c++) {
      for (let y = 0; y < h; y++) {
        row.fill(maximum ? -Infinity : Infinity);
        for (let dy = -size; dy <= size; dy++) {
          const sy = Math.max(0, Math.min(h - 1, y + dy)), span = Math.round(Math.sqrt(size * size - dy * dy));
          slidingExtreme(plane, sy * w * 4 + c, 4, w, span, maximum, line, 0, 1);
          for (let x = 0; x < w; x++) row[x] = maximum ? Math.max(row[x], line[x]) : Math.min(row[x], line[x]);
        }
        for (let x = 0; x < w; x++) scratch[(y * w + x) * 4 + c] = row[x];
      }
    }
    plane.set(scratch);
  }
  const out = blankImage(w, h), result = out.data;
  for (let i = 0; i < result.length; i += 4) {
    result[i + 3] = plane[i + 3];
    if (plane[i + 3] > 0) { result[i] = plane[i]; result[i + 1] = plane[i + 1]; result[i + 2] = plane[i + 2]; }
  }
  return out;
}

/* Square blocks of one averaged colour. */
function mosaicImage(src, cell) {
  const w = src.width, h = src.height, data = src.data, size = Math.max(2, Math.round(cell));
  const out = blankImage(w, h), result = out.data;
  for (let cellY = 0; cellY < h; cellY += size) for (let cellX = 0; cellX < w; cellX += size) {
    const right = Math.min(w, cellX + size), bottom = Math.min(h, cellY + size);
    let r = 0, g = 0, b = 0, a = 0, count = 0;
    for (let y = cellY; y < bottom; y++) for (let x = cellX; x < right; x++) {
      const i = (y * w + x) * 4, alpha = data[i + 3] / 255;
      r += data[i] * alpha; g += data[i + 1] * alpha; b += data[i + 2] * alpha; a += alpha; count++;
    }
    const red = a > 1e-4 ? r / a : 0, green = a > 1e-4 ? g / a : 0, blue = a > 1e-4 ? b / a : 0, alpha = a / count * 255;
    for (let y = cellY; y < bottom; y++) for (let x = cellX; x < right; x++) {
      const i = (y * w + x) * 4;
      result[i] = red; result[i + 1] = green; result[i + 2] = blue; result[i + 3] = alpha;
    }
  }
  return out;
}

/* Voronoi cells around jittered centres: each pixel takes the average colour of
   the cell whose centre is nearest. */
function crystallizeImage(src, cell) {
  const w = src.width, h = src.height, data = src.data, size = Math.max(3, Math.round(cell));
  const columns = Math.max(1, Math.ceil(w / size)), rows = Math.max(1, Math.ceil(h / size));
  const centres = new Float32Array(columns * rows * 2);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) {
    const site = (cy * columns + cx) * 2;
    centres[site] = (cx + hashNoise(cx, cy, 1)) * size;
    centres[site + 1] = (cy + hashNoise(cx, cy, 2)) * size;
  }
  const owner = new Int32Array(w * h), sums = new Float64Array(columns * rows * 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.min(columns - 1, Math.floor(x / size)), cy = Math.min(rows - 1, Math.floor(y / size));
    let best = cy * columns + cx, nearest = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const site = ny * columns + nx, ox = centres[site * 2] - x - .5, oy = centres[site * 2 + 1] - y - .5;
      const distance = ox * ox + oy * oy;
      if (distance < nearest) { nearest = distance; best = site; }
    }
    const pixel = y * w + x, i = pixel * 4, alpha = data[i + 3] / 255, sum = best * 5;
    owner[pixel] = best;
    sums[sum] += data[i] * alpha; sums[sum + 1] += data[i + 1] * alpha; sums[sum + 2] += data[i + 2] * alpha;
    sums[sum + 3] += alpha; sums[sum + 4]++;
  }
  const out = blankImage(w, h), result = out.data;
  for (let pixel = 0; pixel < owner.length; pixel++) {
    const sum = owner[pixel] * 5, count = sums[sum + 4] || 1, alpha = sums[sum + 3], i = pixel * 4;
    result[i + 3] = alpha / count * 255;
    if (alpha > 1e-4) { result[i] = sums[sum] / alpha; result[i + 1] = sums[sum + 1] / alpha; result[i + 2] = sums[sum + 2] / alpha; }
  }
  return out;
}

/* Printer's screens: each ink gets its own rotated grid of dots whose area
   carries the ink level, which is what stops the colours moiréing. */
function halftoneImage(src, maxRadius, angle, mono) {
  const w = src.width, h = src.height, data = src.data;
  const out = blankImage(w, h), result = out.data;
  const cell = Math.max(2, maxRadius) * 2;
  const screens = mono
    ? [{ angle: angle + 45, ink: [0, 0, 0], channel: -1 }]
    : [{ angle: angle + 15, ink: [0, 255, 255], channel: 0 }, { angle: angle + 75, ink: [255, 0, 255], channel: 1 },
       { angle: angle, ink: [255, 255, 0], channel: 2 }, { angle: angle + 45, ink: [0, 0, 0], channel: 3 }];
  const prepared = screens.map(screen => {
    const radians = screen.angle * Math.PI / 180;
    return { ...screen, cos: Math.cos(radians), sin: Math.sin(radians) };
  });
  const inkAt = (x, y, channel) => {
    const i = (Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))) * 4;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    if (channel < 0) return 1 - (r * .299 + g * .587 + b * .114);
    const black = 1 - Math.max(r, g, b);
    if (channel === 3) return black;
    if (black >= 1) return 0;
    const value = channel === 0 ? r : channel === 1 ? g : b;
    return Math.max(0, Math.min(1, (1 - value - black) / (1 - black)));
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let red = 255, green = 255, blue = 255;
    for (const screen of prepared) {
      const u = (x + .5) * screen.cos + (y + .5) * screen.sin, v = -(x + .5) * screen.sin + (y + .5) * screen.cos;
      const cellU = Math.round(u / cell) * cell, cellV = Math.round(v / cell) * cell;
      const ink = inkAt(cellU * screen.cos - cellV * screen.sin, cellU * screen.sin + cellV * screen.cos, screen.channel);
      const radius = maxRadius * Math.sqrt(Math.max(0, Math.min(1, ink)));
      const coverage = Math.max(0, Math.min(1, radius - Math.hypot(u - cellU, v - cellV) + .5));
      if (!coverage) continue;
      red *= 1 - coverage * (1 - screen.ink[0] / 255);
      green *= 1 - coverage * (1 - screen.ink[1] / 255);
      blue *= 1 - coverage * (1 - screen.ink[2] / 255);
    }
    result[i] = red; result[i + 1] = green; result[i + 2] = blue; result[i + 3] = data[i + 3];
  }
  return out;
}

/* The JPEG pipeline itself, minus the entropy coding that has nothing to show
   for itself: colour is split into brightness and two colour-difference
   planes, the colour planes are kept at a coarser resolution, and every plane
   is cut into blocks whose cosine coefficients are rounded off. Blocking,
   ringing round hard edges, smeared colour and generation loss are not drawn
   on afterwards — they all fall out of those three steps on their own.

   The quantisation steps are the tables from the JPEG standard, scaled the way
   libjpeg scales them for a quality setting. They are not held to the 8-bit
   ceiling a real baseline encoder works within, so the bottom of the Quality
   slider destroys rather more than any real encoder could. */
const JPEG_LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];
const JPEG_CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
];
/* How many pixels across and down share one colour sample. */
const JPEG_SUBSAMPLING = { '444': [1, 1], '422': [2, 1], '420': [2, 2], '411': [4, 1] };

/* The standard tables describe an 8 × 8 block. A larger block wants the same
   answer stretched over it, so each step is read at its own frequency. */
function jpegQuantTable(base, quality, size) {
  const wanted = Math.min(100, Math.max(1, quality));
  const scale = wanted < 50 ? 5000 / wanted : 200 - wanted * 2;
  const table = new Float32Array(size * size);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const step = base[Math.min(7, v * 8 / size | 0) * 8 + Math.min(7, u * 8 / size | 0)];
    table[v * size + u] = Math.max(1, Math.round((step * scale + 50) / 100));
  }
  return table;
}

/* The cosine basis, orthonormal so a block survives untouched when nothing is
   quantised away, and so the same steps mean the same thing at any size. */
function jpegCosines(size) {
  const cosines = new Float32Array(size * size), scale = Math.sqrt(2 / size);
  for (let u = 0; u < size; u++) for (let n = 0; n < size; n++)
    cosines[u * size + n] = scale * (u ? 1 : Math.SQRT1_2) * Math.cos((2 * n + 1) * u * Math.PI / (2 * size));
  return cosines;
}

/* Ringing rises with frequency, so the boost lands on the coefficients that
   describe edges. In flat parts of the picture they are already zero and stay
   that way, which is why the halos appear round the edges and nowhere else. */
function jpegRingWeights(size) {
  const weights = new Float32Array(size * size), longest = Math.hypot(size - 1, size - 1) || 1;
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) weights[v * size + u] = Math.hypot(u, v) / longest;
  return weights;
}

/* One plane through the encoder and back. The grid can be offset, which is how
   a second pass lands its blocks somewhere new. */
function jpegPlane(plane, w, h, size, quant, cosines, weights, ring, offsetX, offsetY, wrap) {
  const out = new Float32Array(plane.length);
  const values = new Float32Array(size * size), rows = new Float32Array(size * size), coefficients = new Float32Array(size * size);
  for (let blockY = -offsetY; blockY < h; blockY += size) for (let blockX = -offsetX; blockX < w; blockX += size) {
    for (let y = 0; y < size; y++) {
      const line = edgeIndex(blockY + y, h, wrap) * w;
      for (let x = 0; x < size; x++) values[y * size + x] = plane[line + edgeIndex(blockX + x, w, wrap)] - 128;
    }
    for (let y = 0; y < size; y++) for (let u = 0; u < size; u++) {
      let sum = 0;
      for (let x = 0; x < size; x++) sum += cosines[u * size + x] * values[y * size + x];
      rows[y * size + u] = sum;
    }
    /* Rounding to the step is where the picture is actually thrown away. Most
       of the fine detail lands on zero, and noting how far the survivors reach
       lets the way back skip the empty remainder. */
    let lastU = 0, lastV = 0;
    for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
      let sum = 0;
      for (let y = 0; y < size; y++) sum += cosines[v * size + y] * rows[y * size + u];
      const at = v * size + u, step = quant[at];
      let value = Math.round(sum / step) * step;
      if (at && ring !== 1) value *= 1 + (ring - 1) * weights[at];
      coefficients[at] = value;
      if (value) { if (u > lastU) lastU = u; if (v > lastV) lastV = v; }
    }
    const spanU = lastU + 1, spanV = lastV + 1;
    for (let y = 0; y < size; y++) for (let u = 0; u < spanU; u++) {
      let sum = 0;
      for (let v = 0; v < spanV; v++) sum += cosines[v * size + y] * coefficients[v * size + u];
      rows[y * size + u] = sum;
    }
    for (let y = 0; y < size; y++) {
      const py = blockY + y;
      if (!wrap && (py < 0 || py >= h)) continue;
      const line = edgeIndex(py, h, wrap) * w;
      for (let x = 0; x < size; x++) {
        const px = blockX + x;
        if (!wrap && (px < 0 || px >= w)) continue;
        let sum = 0;
        for (let u = 0; u < spanU; u++) sum += cosines[u * size + x] * rows[y * size + u];
        out[line + edgeIndex(px, w, wrap)] = sum + 128;
      }
    }
  }
  return out;
}

function jpegDownsample(plane, w, h, stepX, stepY) {
  const cw = Math.ceil(w / stepX), ch = Math.ceil(h / stepY), out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let sum = 0, count = 0;
    for (let dy = 0; dy < stepY; dy++) {
      const sy = y * stepY + dy;
      if (sy >= h) continue;
      for (let dx = 0; dx < stepX; dx++) {
        const sx = x * stepX + dx;
        if (sx >= w) continue;
        sum += plane[sy * w + sx]; count++;
      }
    }
    out[y * cw + x] = count ? sum / count : 128;
  }
  return { plane: out, width: cw, height: ch };
}

/* Repeating the sample rather than smoothing between them, the way a cheap
   decoder does — it is the blockier and more recognisable of the two. */
function jpegUpsample(plane, cw, ch, w, h, stepX, stepY) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const line = Math.min(ch - 1, y / stepY | 0) * cw;
    for (let x = 0; x < w; x++) out[y * w + x] = plane[line + Math.min(cw - 1, x / stepX | 0)];
  }
  return out;
}

/* JPEG has nowhere to put transparency, so a transparent pixel carries no
   colour worth compressing — and whatever is sitting in it would be dragged
   across the picture by the colour planes. Each cell lends its own visible
   colour to its holes instead, which keeps the edges clean. */
function jpegFillHoles(planes, data, w, h, size) {
  const average = [0, 0, 0], cell = [0, 0, 0];
  let total = 0;
  for (let pixel = 0; pixel < w * h; pixel++) {
    if (!data[pixel * 4 + 3]) continue;
    for (let p = 0; p < 3; p++) average[p] += planes[p][pixel];
    total++;
  }
  if (!total) return;
  for (let p = 0; p < 3; p++) average[p] /= total;
  for (let cellY = 0; cellY < h; cellY += size) for (let cellX = 0; cellX < w; cellX += size) {
    const right = Math.min(w, cellX + size), bottom = Math.min(h, cellY + size);
    let count = 0;
    cell[0] = cell[1] = cell[2] = 0;
    for (let y = cellY; y < bottom; y++) for (let x = cellX; x < right; x++) {
      const pixel = y * w + x;
      if (!data[pixel * 4 + 3]) continue;
      for (let p = 0; p < 3; p++) cell[p] += planes[p][pixel];
      count++;
    }
    for (let p = 0; p < 3; p++) cell[p] = count ? cell[p] / count : average[p];
    for (let y = cellY; y < bottom; y++) for (let x = cellX; x < right; x++) {
      const pixel = y * w + x;
      if (data[pixel * 4 + 3]) continue;
      for (let p = 0; p < 3; p++) planes[p][pixel] = cell[p];
    }
  }
}

function jpegImage(src, quality, block, chroma, chromaQuality, ringing, passes, drift, wrap) {
  const w = src.width, h = src.height, data = src.data, count = w * h;
  const size = Math.max(2, Math.min(32, Math.round(block)));
  const [stepX, stepY] = JPEG_SUBSAMPLING[chroma] || JPEG_SUBSAMPLING['420'];
  let luma = new Float32Array(count), blue = new Float32Array(count), red = new Float32Array(count);
  let holes = false;
  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    luma[pixel] = .299 * r + .587 * g + .114 * b;
    blue[pixel] = 128 - .168736 * r - .331264 * g + .5 * b;
    red[pixel] = 128 + .5 * r - .418688 * g - .081312 * b;
    if (!data[i + 3]) holes = true;
  }
  if (holes) jpegFillHoles([luma, blue, red], data, w, h, size);

  const cosines = jpegCosines(size), weights = jpegRingWeights(size), ring = Math.max(0, ringing) / 100;
  const lumaQuant = jpegQuantTable(JPEG_LUMA_QUANT, quality, size);
  const chromaQuant = jpegQuantTable(JPEG_CHROMA_QUANT, chromaQuality, size);
  /* Saving the same file again lands every block back where it was and rounds
     it to the step it is already on, so a fixed grid stops doing damage after
     the first pass. Moving the grid is what keeps generation loss going. */
  for (let pass = 0, rounds = Math.max(1, Math.round(passes)); pass < rounds; pass++) {
    const offsetX = drift && pass ? hashNoise(pass, 0, 7) * size | 0 : 0;
    const offsetY = drift && pass ? hashNoise(0, pass, 11) * size | 0 : 0;
    luma = jpegPlane(luma, w, h, size, lumaQuant, cosines, weights, ring, offsetX, offsetY, wrap);
    const encodeChroma = plane => {
      const small = jpegDownsample(plane, w, h, stepX, stepY);
      const coded = jpegPlane(small.plane, small.width, small.height, size, chromaQuant, cosines, weights, ring,
        offsetX / stepX | 0, offsetY / stepY | 0, wrap);
      return jpegUpsample(coded, small.width, small.height, w, h, stepX, stepY);
    };
    blue = encodeChroma(blue); red = encodeChroma(red);
  }

  const out = blankImage(w, h), result = out.data;
  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4, alpha = data[i + 3];
    result[i + 3] = alpha;
    if (!alpha) { result[i] = data[i]; result[i + 1] = data[i + 1]; result[i + 2] = data[i + 2]; continue; }
    const y = luma[pixel], u = blue[pixel] - 128, v = red[pixel] - 128;
    result[i] = y + 1.402 * v;
    result[i + 1] = y - .344136 * u - .714136 * v;
    result[i + 2] = y + 1.772 * u;
  }
  return out;
}

/* Pixel sorting — the glitch Kim Asendorf's 2010 script made a genre of. The
   layer is walked in straight lines, each line is broken into spans, and the
   pixels inside a span are reordered by whatever is being sorted on. Nothing is
   averaged or resampled: a span is a permutation of the pixels that were
   already lying there, which is why the streaks still read as the photograph
   they came out of however far they run.

   Everything that reads a pixel — what picks the spans, what sorts them — draws
   on the same list of channels, normalised to 0…1 so one pair of threshold
   sliders means the same thing whichever one is chosen. Hue is the odd one: it
   wraps, so sorting by it leaves red at both ends of a span. */
const PIXEL_SORT_CHANNELS = [
  ['luminance', 'Luminance'],
  ['lightness', 'Lightness (HSL)'],
  ['brightness', 'Brightness (max)'],
  ['intensity', 'Intensity (R+G+B)'],
  ['minimum', 'Darkest channel'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['red', 'Red'],
  ['green', 'Green'],
  ['blue', 'Blue'],
  ['alpha', 'Alpha']
];

function pixelChannelReader(kind) {
  switch (kind) {
    case 'lightness': return (r, g, b) => (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
    case 'brightness': return (r, g, b) => Math.max(r, g, b) / 255;
    case 'intensity': return (r, g, b) => (r + g + b) / 765;
    case 'minimum': return (r, g, b) => Math.min(r, g, b) / 255;
    case 'hue': return (r, g, b) => {
      const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
      if (!delta) return 0;
      const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return hue / 6;
    };
    case 'saturation': return (r, g, b) => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      return delta ? (max + min > 255 ? delta / (510 - max - min) : delta / (max + min)) : 0;
    };
    case 'red': return r => r / 255;
    case 'green': return (r, g) => g / 255;
    case 'blue': return (r, g, b) => b / 255;
    case 'alpha': return (r, g, b, a) => a / 255;
    default: return (r, g, b) => (r * .2126 + g * .7152 + b * .0722) / 255;
  }
}

function pixelChannelValues(src, kind) {
  const data = src.data, values = new Float32Array(src.width * src.height), read = pixelChannelReader(kind);
  for (let pixel = 0, i = 0; pixel < values.length; pixel++, i += 4) {
    values[pixel] = read(data[i], data[i + 1], data[i + 2], data[i + 3]);
  }
  return values;
}

/* The lines a sort runs along. Rotating the layer to the angle and rotating the
   result back would resample every pixel twice and soften exactly the hard
   streaks the effect exists to make, so instead each pixel is filed under the
   line it sits on — its distance across the lines, rounded — and read back out
   along that line. Walking x in the direction of the angle's cosine and y in
   the direction of its sine meets the pixels of any one line end to end, so a
   line comes out in order without having to be sorted into it. */
function pixelSortParallelLines(w, h, angle) {
  const turn = angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
  let low = Infinity, high = -Infinity;
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const across = y * cos - x * sin;
    if (across < low) low = across;
    if (across > high) high = across;
  }
  const count = Math.round(high - low) + 1, starts = new Int32Array(count + 1);
  const lineAt = (x, y) => Math.max(0, Math.min(count - 1, Math.round(y * cos - x * sin - low)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) starts[lineAt(x, y) + 1]++;
  for (let index = 0; index < count; index++) starts[index + 1] += starts[index];
  const cursor = starts.slice(0, count), order = new Int32Array(w * h);
  const xFrom = cos >= 0 ? 0 : w - 1, xStep = cos >= 0 ? 1 : -1;
  const yFrom = sin >= 0 ? 0 : h - 1, yStep = sin >= 0 ? 1 : -1;
  const file = (x, y) => { order[cursor[lineAt(x, y)]++] = y * w + x; };
  if (Math.abs(cos) >= Math.abs(sin)) {
    for (let column = 0, x = xFrom; column < w; column++, x += xStep) {
      for (let row = 0, y = yFrom; row < h; row++, y += yStep) file(x, y);
    }
  } else {
    for (let row = 0, y = yFrom; row < h; row++, y += yStep) {
      for (let column = 0, x = xFrom; column < w; column++, x += xStep) file(x, y);
    }
  }
  return { order, starts, count };
}

/* Rings and rays, the sorting counterparts of a spin blur and a zoom blur — the
   same two the Radial Blur dialog offers, and named after them for that reason.
   Nothing about the sort itself changes: a line is still a list of pixels in the
   order something travels along it, and the spans, the methods and the channels
   all work on it exactly as they do on a straight line.

   A spiral is the third of the family and sits between the other two: one line
   is one turn of an Archimedean spiral, so the sort winds outwards instead of
   closing on itself.

   These lines cannot be walked in scan order the way parallel ones can, so the
   pixels are put in order along their line first — by radius for a ray, by angle
   round the centre for a ring or a spiral — with a counting sort, and then filed
   into their lines in that order. Two linear passes rather than a comparison
   sort per line, and no pixel is resampled on the way. */
/* Where each ring or turn is cut. Cutting them all at the same angle leaves the
   join in plain sight — every ring's darkest pixel against every ring's
   brightest, down one straight line out of the centre — so the cut can be given
   a wander instead. Not a fresh angle per line, which would leave every ring
   starting its gradient somewhere unrelated to its neighbours and lose the
   swirl altogether, but a smooth drift over the lattice: neighbours stay roughly
   in step and the join becomes a curve that wanders through the picture rather
   than a straight edge across it. */
function pixelSortCuts(count, seed, scatter, turnSteps) {
  const cuts = new Int32Array(count);
  if (!scatter) return cuts;
  const span = 24;
  for (let line = 0; line < count; line++) {
    const at = line / span, cell = Math.floor(at), blend = smoothStep(at - cell);
    const drift = hashNoise(cell, 0, seed) * (1 - blend) + hashNoise(cell + 1, 0, seed) * blend;
    cuts[line] = Math.round(drift * scatter * turnSteps);
  }
  return cuts;
}

function pixelSortPolarLines(w, h, v) {
  const TURN = Math.PI * 2, total = w * h;
  const centreX = w * v.centreX / 100, centreY = h * v.centreY / 100;
  const winding = v.path !== 'zoom';
  let far = 0;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) far = Math.max(far, Math.hypot(x - centreX, y - centreY));
  /* One ray per pixel of the outermost circle, so the rays arrive about a pixel
     apart where the picture is widest, the way a zoom blur's streaks do. */
  const rays = Math.max(8, Math.round(TURN * far)), radii = Math.max(1, Math.round(far) + 1);
  /* A spiral is a ring whose radius climbs as it goes round, so one line is one
     whole turn and the next starts a pixel further out. Twist is how far out a
     turn travels, which makes a ring the spiral with no twist in it and a wide
     twist an arm that crosses most of the picture before it comes round. Its
     lines can start inside the centre or finish beyond the rim, so the numbering
     is shifted far enough to keep them all positive. */
  const twist = v.path === 'spiral' ? v.twist : 0;
  const shift = twist ? Math.ceil(Math.abs(twist)) + 1 : 0;
  const count = winding ? radii + shift * 2 : rays;
  /* Where a ring or a spiral is cut. A sorted circle has to start somewhere, and
     this is the one thing the angle control still means when lines curve. */
  const seam = ((v.angle % 360) + 360) % 360 * Math.PI / 180;
  /* The line a pixel belongs to is rounded to the pixel — rings a pixel apart,
     rays about a pixel apart at the rim. Its place along that line is kept to a
     quarter of one, so that two pixels the counting sort cannot separate are at
     worst a quarter of a pixel out of order rather than a whole one. */
  const step = 4, turnSteps = rays * step;
  const cuts = winding ? pixelSortCuts(count, v.seed | 0, v.scatter / 100, turnSteps) : null;
  const line = new Int32Array(total), along = new Int32Array(total);
  let alongMax = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + .5 - centreX, dy = y + .5 - centreY;
    const distance = Math.hypot(dx, dy);
    const turn = Math.atan2(dy, dx) - seam;
    const round = ((turn % TURN) + TURN) % TURN / TURN;
    const pixel = y * w + x;
    const on = winding
      ? Math.max(0, Math.min(count - 1, Math.round(distance - twist * round) + shift))
      : Math.min(rays - 1, Math.floor(round * rays));
    line[pixel] = on;
    /* Moving a line's cut is moving where its pixels are read from: the same
       ring, started at a different angle and wrapped round to meet itself. */
    along[pixel] = winding
      ? (Math.min(turnSteps - 1, Math.floor(round * turnSteps)) + cuts[on]) % turnSteps
      : Math.min((radii - 1) * step, Math.round(distance * step));
    if (along[pixel] > alongMax) alongMax = along[pixel];
  }
  const places = new Int32Array(alongMax + 2);
  for (let pixel = 0; pixel < total; pixel++) places[along[pixel] + 1]++;
  for (let step = 0; step <= alongMax; step++) places[step + 1] += places[step];
  const walked = new Int32Array(total);
  for (let pixel = 0; pixel < total; pixel++) walked[places[along[pixel]]++] = pixel;
  const starts = new Int32Array(count + 1);
  for (let pixel = 0; pixel < total; pixel++) starts[line[pixel] + 1]++;
  for (let index = 0; index < count; index++) starts[index + 1] += starts[index];
  const cursor = starts.slice(0, count), order = new Int32Array(total);
  for (let step = 0; step < total; step++) {
    const pixel = walked[step];
    order[cursor[line[pixel]]++] = pixel;
  }
  return { order, starts, count };
}

const pixelSortLines = (w, h, v) => v.path === 'parallel' || !v.path
  ? pixelSortParallelLines(w, h, v.angle)
  : pixelSortPolarLines(w, h, v);

/* Which algorithm does the sorting only matters if it is not allowed to finish:
   run to completion, quicksort and mergesort and heapsort all leave a span in
   exactly the same order, and swapping one for another would be a filter option
   that changes nothing. Stopped part way they are quite different pictures,
   because a half-sorted array still carries the shape of the machine that was
   sorting it — bubble passes drag the highlights a fixed distance along the
   line, a bounded quicksort partitions it into tonal tiers, a heap that is
   built but never emptied prints its own binary tree as echoes at half, quarter
   and eighth scale. So the methods here are mostly ways of stopping early, and
   the number each one wants — passes, depth, run length — is its own control.

   Every method is a permutation of the span it is given. `uses` names the
   controls it reads, which is what puts the right slider in the dialog. */
const swapEntries = (a, i, j) => { const held = a[i]; a[i] = a[j]; a[j] = held; };
const ascendingBy = keys => (a, b) => keys[a] - keys[b];

const PIXEL_SORT_METHODS = {
  full: {
    label: 'Full sort', uses: [],
    arrange: (span, keys) => span.sort(ascendingBy(keys))
  },
  ties: {
    label: 'Full sort, ties shuffled', uses: ['seed'],
    /* The only way a finished sort can differ from another finished sort is in
       what it does with pixels it cannot tell apart, and a coarse key leaves
       plenty of those — every colour of one hue, every pixel with the same red
       in it, everything inside one bucket level. A stable sort leaves them
       lying in the order it found them and their texture survives the sort;
       breaking the tie on a hash of the pixel scatters it instead. Sorting on
       luminance alone this method does nothing, because pixels that tie there
       are usually the same colour anyway. */
    arrange: (span, keys, v) => span.sort((a, b) => keys[a] - keys[b] || hashNoise(a, 0, v.seed) - hashNoise(b, 0, v.seed))
  },
  bucket: {
    label: 'Bucket by level', uses: ['levels'],
    /* A counting sort on a coarsely quantised key: the span is graded into
       tonal bands, but inside a band nothing moves, so the texture survives. */
    keys: (base, v) => base.map(value => Math.min(v.levels - 1, Math.floor(value * v.levels))),
    arrange: (span, keys) => span.sort(ascendingBy(keys))
  },
  radix: {
    label: 'Radix, low bits only', uses: ['bits'],
    /* Radix sort works up from the least significant bits. Stop it after the
       first few and the span is ordered by the noise in the bottom of each
       value rather than by anything the eye would call brightness. */
    keys: (base, v) => base.map(value => Math.round(value * 255) & ((1 << v.bits) - 1)),
    arrange: (span, keys) => span.sort(ascendingBy(keys))
  },
  bubble: {
    label: 'Bubble drift', uses: ['passes'],
    arrange: (span, keys, v) => {
      for (let pass = 0; pass < v.passes; pass++) {
        let moved = false;
        for (let i = 0; i < span.length - 1 - pass; i++) {
          if (keys[span[i]] > keys[span[i + 1]]) { swapEntries(span, i, i + 1); moved = true; }
        }
        if (!moved) break;
      }
    }
  },
  cocktail: {
    label: 'Cocktail shaker', uses: ['passes'],
    arrange: (span, keys, v) => {
      let low = 0, high = span.length - 1;
      for (let pass = 0; pass < v.passes && low < high; pass++) {
        for (let i = low; i < high; i++) if (keys[span[i]] > keys[span[i + 1]]) swapEntries(span, i, i + 1);
        high--;
        for (let i = high; i > low; i--) if (keys[span[i - 1]] > keys[span[i]]) swapEntries(span, i - 1, i);
        low++;
      }
    }
  },
  'odd-even': {
    label: 'Odd–even transposition', uses: ['passes'],
    /* The parallel network: every other neighbouring pair at once, alternating
       which pairs. Neither end of the span is favoured, so the drift is even. */
    arrange: (span, keys, v) => {
      for (let pass = 0; pass < v.passes; pass++) {
        for (let i = pass & 1; i < span.length - 1; i += 2) {
          if (keys[span[i]] > keys[span[i + 1]]) swapEntries(span, i, i + 1);
        }
      }
    }
  },
  comb: {
    label: 'Comb sort', uses: ['passes'],
    /* Bubble sort over a gap that shrinks by a factor of 1.3 each pass, so the
       long-range disorder goes first and the local texture last. Once the gap
       reaches one it stays there and the remaining passes are bubble passes,
       which is how comb sort finishes and what keeps the slider meaning
       something past the dozen or so passes the shrinking takes. */
    arrange: (span, keys, v) => {
      let gap = span.length;
      for (let pass = 0; pass < v.passes; pass++) {
        gap = Math.max(1, Math.floor(gap / 1.3));
        let moved = false;
        for (let i = 0; i + gap < span.length; i++) {
          if (keys[span[i]] > keys[span[i + gap]]) { swapEntries(span, i, i + gap); moved = true; }
        }
        if (gap === 1 && !moved) break;
      }
    }
  },
  shell: {
    label: 'Shell, one gap', uses: ['gap'],
    /* Shell sort's first round only: every gap-th pixel is sorted among its
       own kind, which combs the span without ever comparing neighbours. */
    arrange: (span, keys, v) => {
      const gap = Math.max(2, Math.round(v.gap));
      for (let offset = 0; offset < gap && offset < span.length; offset++) {
        const strand = [];
        for (let i = offset; i < span.length; i += gap) strand.push(span[i]);
        strand.sort(ascendingBy(keys));
        for (let i = offset, s = 0; i < span.length; i += gap, s++) span[i] = strand[s];
      }
    }
  },
  insertion: {
    label: 'Insertion, bounded reach', uses: ['reach'],
    arrange: (span, keys, v) => {
      const reach = Math.max(1, Math.round(v.reach));
      for (let i = 1; i < span.length; i++) {
        const held = span[i];
        let j = i - 1, moves = 0;
        while (j >= 0 && keys[span[j]] > keys[held] && moves < reach) { span[j + 1] = span[j]; j--; moves++; }
        span[j + 1] = held;
      }
    }
  },
  selection: {
    label: 'Selection, first picks', uses: ['picks'],
    /* Each pick is final and the pixel it displaces is thrown wherever the
       chosen one came from, so the sorted head grows against a scarred tail. */
    arrange: (span, keys, v) => {
      const picks = Math.min(Math.round(v.picks), span.length);
      for (let i = 0; i < picks; i++) {
        let best = i;
        for (let j = i + 1; j < span.length; j++) if (keys[span[j]] < keys[span[best]]) best = j;
        swapEntries(span, i, best);
      }
    }
  },
  merge: {
    label: 'Merge, runs only', uses: ['runs'],
    /* Bottom-up mergesort stopped once its runs reach a length: the span comes
       out as hard blocks, each sorted, none merged with its neighbour. */
    arrange: (span, keys, v) => {
      const size = Math.max(2, Math.round(v.runs)), compare = ascendingBy(keys);
      for (let start = 0; start < span.length; start += size) {
        const block = span.slice(start, start + size).sort(compare);
        for (let i = 0; i < block.length; i++) span[start + i] = block[i];
      }
    }
  },
  quick: {
    label: 'Quicksort, bounded depth', uses: ['depth'],
    arrange: (span, keys, v) => {
      const step = (low, high, left) => {
        if (low >= high || left <= 0) return;
        const pivot = keys[span[(low + high) >> 1]];
        let i = low, j = high;
        while (i <= j) {
          while (keys[span[i]] < pivot) i++;
          while (keys[span[j]] > pivot) j--;
          if (i <= j) { swapEntries(span, i, j); i++; j--; }
        }
        step(low, j, left - 1); step(i, high, left - 1);
      };
      step(0, span.length - 1, Math.round(v.depth));
    }
  },
  heapify: {
    label: 'Heapify, never emptied', uses: [],
    arrange: (span, keys) => pixelSortHeap(span, keys, span.length)
  },
  heapsort: {
    label: 'Heapsort, part emptied', uses: ['extract'],
    /* Building the heap prints the tree; pulling the top off it one at a time
       lays a sorted tail down over that pattern from the far end back. */
    arrange: (span, keys, v) => {
      pixelSortHeap(span, keys, span.length);
      const wanted = Math.round(span.length * v.extract / 100);
      for (let end = span.length - 1, taken = 0; end > 0 && taken < wanted; end--, taken++) {
        swapEntries(span, 0, end);
        pixelSortSift(span, keys, 0, end);
      }
    }
  },
  bitonic: {
    label: 'Bitonic network', uses: ['stages'],
    arrange: (span, keys, v) => pixelSortBitonic(span, keys, Math.round(v.stages))
  },
  pancake: {
    label: 'Pancake flips', uses: ['flips'],
    /* Only ever reverses a prefix, so the span keeps arriving in mirrored
       pieces however long it runs. */
    arrange: (span, keys, v) => {
      const flip = end => { for (let i = 0, j = end; i < j; i++, j--) swapEntries(span, i, j); };
      const flips = Math.min(Math.round(v.flips), span.length - 1);
      for (let end = span.length - 1, done = 0; end > 0 && done < flips; end--, done++) {
        let best = 0;
        for (let i = 1; i <= end; i++) if (keys[span[i]] > keys[span[best]]) best = i;
        if (best !== end) { if (best) flip(best); flip(end); }
      }
    }
  },
  noisy: {
    label: 'Faulty comparisons', uses: ['passes', 'error'],
    /* A sorting network built out of comparators that sometimes answer the
       wrong way — the span settles towards order but never reaches it. This is
       the only method that wants a random number per comparison rather than per
       pixel, hundreds of millions of them over a large layer, so the xorshift
       runs on local state here instead of behind a call. */
    arrange: (span, keys, v, seed) => {
      const wrong = v.error / 100 * 4294967296;
      let state = seed;
      for (let pass = 0; pass < v.passes; pass++) {
        for (let i = pass & 1; i < span.length - 1; i += 2) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          if ((keys[span[i]] > keys[span[i + 1]]) !== ((state >>> 0) < wrong)) swapEntries(span, i, i + 1);
        }
      }
    }
  },
  shuffle: {
    label: 'Shuffle, no sorting', uses: ['seed'],
    arrange: (span, keys, v, seed) => {
      let state = seed;
      for (let i = span.length - 1; i > 0; i--) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        swapEntries(span, i, (state >>> 0) % (i + 1));
      }
    }
  },
  reverse: {
    label: 'Reverse, no sorting', uses: [],
    arrange: span => span.reverse()
  }
};

/* Heapsort's two halves, kept out here because Heapify and Heapsort share
   them. The array is the usual implicit binary tree: the children of i live at
   2i+1 and 2i+2, which is the structure that shows up as halving echoes when a
   heap is built and then left alone. */
function pixelSortSift(span, keys, root, size) {
  while (true) {
    let largest = root;
    const left = root * 2 + 1, right = left + 1;
    if (left < size && keys[span[left]] > keys[span[largest]]) largest = left;
    if (right < size && keys[span[right]] > keys[span[largest]]) largest = right;
    if (largest === root) return;
    swapEntries(span, root, largest);
    root = largest;
  }
}

function pixelSortHeap(span, keys, size) {
  for (let root = (size >> 1) - 1; root >= 0; root--) pixelSortSift(span, keys, root, size);
}

/* Batcher's bitonic network, which sorts by comparing fixed pairs of positions
   rather than by looking at what it finds — the reason its half-finished states
   are so regular. The network only exists for powers of two, so the span is
   padded out with entries that compare as larger than anything real and are
   dropped again afterwards; the pixels that are left keep the order the network
   put them in. */
function pixelSortBitonic(span, keys, stages) {
  let size = 1;
  while (size < span.length) size *= 2;
  const padded = span.slice();
  while (padded.length < size) padded.push(-1);
  const rank = index => index < 0 ? Infinity : keys[index];
  let done = 0;
  for (let run = 2; run <= size && done < stages; run *= 2) {
    /* Halving the step with a shift and not a divide: at a fractional step the
       partner index XORs to itself, and the network would spend the whole stage
       budget on comparisons that cannot move anything. */
    for (let step = run >> 1; step > 0 && done < stages; step >>= 1, done++) {
      for (let i = 0; i < size; i++) {
        const partner = i ^ step;
        if (partner <= i) continue;
        const here = rank(padded[i]), there = rank(padded[partner]);
        if ((i & run) === 0 ? here > there : here < there) swapEntries(padded, i, partner);
      }
    }
  }
  for (let i = 0, out = 0; i < size; i++) if (padded[i] >= 0) span[out++] = padded[i];
}

/* The starting state for the methods that run an xorshift: hashed from the seed
   and the span's number, so the same span of the same picture is scrambled the
   same way twice and the seed slider moves it. Never zero, which is the one
   state an xorshift cannot leave. */
function pixelSortSeed(seed, span) {
  return ((hashNoise(span, seed, 47) * 4294967296) | 0) || 0x9e3779b9;
}

const pixelSortUses = (method, control) => !!PIXEL_SORT_METHODS[method]?.uses.includes(control);

/* What a span rearranges. Moving whole pixels is a sort of the picture; moving
   one channel and leaving the rest where they are is a sort of one separation,
   and the colours come apart wherever the spans run. Sorting all three that way
   in one pass, each by its own values, is the loudest of them — every pixel
   ends up holding a red from one place, a green from another and a blue from a
   third, so the picture keeps its overall tone and loses its colour edges. */
const PIXEL_SORT_PARTS = {
  all: { label: 'All — whole pixels', offsets: [0, 1, 2, 3] },
  red: { label: 'Red only', offsets: [0] },
  green: { label: 'Green only', offsets: [1] },
  blue: { label: 'Blue only', offsets: [2] },
  alpha: { label: 'Alpha only', offsets: [3] },
  separate: { label: 'Each channel by itself', offsets: [0, 1, 2], separate: ['red', 'green', 'blue'] }
};

function pixelSortImage(src, v) {
  const w = src.width, h = src.height, data = src.data;
  const out = copyImage(src), result = out.data;
  const method = PIXEL_SORT_METHODS[v.method] || PIXEL_SORT_METHODS.full;
  const parts = PIXEL_SORT_PARTS[v.channels] || PIXEL_SORT_PARTS.all;
  /* Every method sorts upwards; descending is the same run over a flipped key,
     which keeps one implementation of each algorithm rather than two. */
  const keysFor = kind => {
    let values = pixelChannelValues(src, kind);
    if (v.order === 'descending') values = values.map(value => 1 - value);
    return method.keys ? method.keys(values, v) : values;
  };
  /* Each channel sorted by itself needs a key array per channel; everything
     else sorts on the one channel chosen in the dialog. */
  const passes = parts.separate
    ? parts.separate.map((kind, index) => [parts.offsets[index], keysFor(kind)])
    : [[-1, keysFor(v.sort)]];
  const pickValues = pixelChannelValues(src, v.select);
  const { order, starts, count } = pixelSortLines(w, h, v);
  const lower = Math.min(v.lower, v.upper) / 100, upper = Math.max(v.lower, v.upper) / 100;
  const mode = v.intervals, invert = !!v.invert, keepClear = !!v.transparent;
  const edge = v.edge / 100, length = Math.max(1, Math.round(v.length));
  const skip = v.skip / 100, seed = v.seed | 0;
  /* A span is gathered as the positions it covers, in the order the line meets
     them; the same list rearranged is what goes back into those positions. */
  const run = [];
  let spans = 0;
  const flush = () => {
    if (!run.length) return;
    const chance = hashNoise(spans++, seed, 13);
    if (run.length > 1 && chance >= skip) {
      passes.forEach(([only, keys], pass) => {
        const sorted = run.slice();
        /* A different stream per channel, or a shuffle would move all three the
           same way and come out as whole pixels again. */
        method.arrange(sorted, keys, v, pixelSortSeed(seed, spans * 4 + pass));
        const offsets = only < 0 ? parts.offsets : [only];
        if (offsets.length === 4) {
          for (let k = 0; k < run.length; k++) {
            const to = run[k] * 4, from = sorted[k] * 4;
            result[to] = data[from]; result[to + 1] = data[from + 1];
            result[to + 2] = data[from + 2]; result[to + 3] = data[from + 3];
          }
        } else {
          const offset = offsets[0];
          for (let k = 0; k < run.length; k++) result[run[k] * 4 + offset] = data[sorted[k] * 4 + offset];
        }
      });
    }
    run.length = 0;
  };
  for (let index = 0; index < count; index++) {
    const from = starts[index], to = starts[index + 1];
    let previous = -1, limit = 0;
    for (let at = from; at < to; at++) {
      const pixel = order[at];
      if (keepClear && !data[pixel * 4 + 3]) { flush(); previous = -1; continue; }
      if (mode === 'threshold') {
        const inside = (pickValues[pixel] >= lower && pickValues[pixel] <= upper) !== invert;
        if (!inside) { flush(); previous = -1; continue; }
      } else if (mode === 'edges') {
        if (previous >= 0 && Math.abs(pickValues[pixel] - pickValues[previous]) > edge) flush();
      } else if ((mode === 'random' || mode === 'waves') && !run.length) {
        limit = mode === 'waves' ? length : Math.max(1, Math.round(length * (.25 + 1.5 * hashNoise(spans, seed, 29))));
      }
      run.push(pixel); previous = pixel;
      if (limit && run.length >= limit) flush();
    }
    flush();
  }
  return out;
}

/* Sonification — the picture handed to an effects unit as though it were a
   tape. A row of pixels is a run of numbers arriving one after another, which
   is exactly what a sampled waveform is, so a filter written for audio will run
   over it unmodified; what it does to a sound it does to the picture, and the
   only thing that changes is that the result is looked at rather than listened
   to. Nothing here resamples or averages a neighbourhood the way a blur does:
   every pixel is the arithmetic of the pixels the reading head has already
   passed, so the marks all trail behind the thing that made them.

   The reading order is the whole character of it, and it is three decisions
   rather than one. Read says which way the head travels, across the rows or
   down the columns. One stream says whether the unit is torn down and rebuilt
   at the start of every line — echoes then live and die inside the line that
   threw them — or kept running from the first pixel to the last, which makes
   the picture one signal several hundred thousand samples long and lets a tail
   thrown off the end of a line arrive at the start of the next one. Turn at the
   ends says whether the head lifts to get back: left it alone it snakes, so the
   tail carries on at the same edge it went off and the smear leans the way a
   raster scan does, and turned off the head flies back and the tail crosses the
   whole picture to reappear on the far side. */
const SONIFY_SCANS = {
  rows: { label: 'Rows', down: false },
  columns: { label: 'Columns', down: true }
};

/* Each trip over the picture is a list of runs: where the head lands, how far
   it steps between samples, and how many samples the run holds. Everything the
   reading order decides is settled here, so the filters downstream only ever
   see a stream. */
function sonifyRuns(w, h, scan, snake) {
  const down = !!(SONIFY_SCANS[scan] || SONIFY_SCANS.rows).down;
  const runs = [], lines = down ? w : h, length = down ? h : w;
  const step = down ? w : 1;
  for (let line = 0; line < lines; line++) {
    const back = snake && (line & 1);
    const first = down ? line : line * w;
    runs.push({ start: back ? first + step * (length - 1) : first, step: back ? -step : step, length });
  }
  return runs;
}

/* One shape for everything in the rack that sweeps or multiplies. The phase is
   carried in samples, so an oscillator's period is a distance across the
   picture rather than a frequency — the natural unit here, since what a slow
   oscillator writes on a picture is a stripe you can measure with a ruler. */
const SONIFY_WAVES = {
  sine: { label: 'Sine', at: phase => Math.sin(phase * Math.PI * 2) },
  triangle: { label: 'Triangle', at: phase => 4 * Math.abs(phase - .5) - 1 },
  square: { label: 'Square', at: phase => phase < .5 ? 1 : -1 },
  saw: { label: 'Sawtooth', at: phase => phase * 2 - 1 }
};

function makeOscillator(period, wave) {
  const shape = (SONIFY_WAVES[wave] || SONIFY_WAVES.sine).at;
  const step = 1 / Math.max(2, period);
  let phase = 0;
  return () => { const value = shape(phase); phase += step; if (phase >= 1) phase -= 1; return value; };
}

/* Two rules every unit in the rack that remembers anything has to keep, both of
   them consequences of a picture being a signal that never goes negative.

   A steady level in must give the same steady level out. An echo feeding itself
   has a gain of 1/(1 − feedback) at DC, and a picture is nearly all DC, so a
   unit left unnormalised would use its feedback control as a brightness control
   and flare the whole frame to white before it showed a single repeat. Anything
   with a feedback path is scaled by 1 − feedback to undo that.

   And the delay lines start filled, not empty. A sound sits either side of zero
   and starts from silence, so an empty line is the honest state to begin in; a
   picture sits entirely above zero, and an empty unit spends its first few
   hundred pixels climbing from black to the brightness it was handed. At any
   useful feedback that climb is longer than the line it happens in, so every
   row would arrive with a dark ramp burnt down its leading edge and a flat grey
   picture would come back as a gradient. Every maker below takes the level the
   reading head is about to meet and fills its state with the steady state for
   it, so unchanging pixels pass through untouched and only what changes rings.

   Three units are exempt, and honestly so. Ring modulation and clipping are
   both meant to rewrite the level rather than hold it — that is what they are
   for. The bitcrusher holds one only as far as its own resolution allows: a
   steady level comes back as the nearest step it has left to describe it with,
   which at three bits can be a good way off. */

/* Freeverb's delay lengths, kept as ratios of the shortest rather than as the
   sample counts Jezar tuned for 44.1 kHz. Holding the ratios is what lets Depth
   scale the whole room: the delays stay near enough mutually prime at any size,
   so the six combs never line up into one flat repeat, and a small room is the
   same reverb heard closer rather than a different one. */
const REVERB_COMBS = [1, 1.0645, 1.1443, 1.2151, 1.2742, 1.3361];
const REVERB_ALLPASS = [.4982, .3952, .3056];

/* Six comb filters in parallel make the tail — each one an echo feeding itself,
   with a one-pole lowpass in the loop so the repeats lose their edges the way a
   real room's do — and three allpasses in series scramble what comes out into
   something dense enough not to read as a row of copies. */
function makeReverb(depth, feedback, damping, level) {
  const size = ratio => new Float32Array(Math.max(1, Math.round(depth * ratio)));
  const settled = level / (1 - feedback);
  const combs = REVERB_COMBS.map(ratio => ({ buffer: size(ratio).fill(settled), at: 0, store: settled }));
  const allpasses = REVERB_ALLPASS.map(ratio => ({ buffer: size(ratio).fill(level * 2), at: 0 }));
  const keep = 1 - damping, scale = (1 - feedback) / combs.length;
  return sample => {
    let wet = 0;
    for (const comb of combs) {
      const delayed = comb.buffer[comb.at];
      wet += delayed;
      comb.store = delayed * keep + comb.store * damping;
      comb.buffer[comb.at] = sample + comb.store * feedback;
      if (++comb.at >= comb.buffer.length) comb.at = 0;
    }
    wet *= scale;
    for (const allpass of allpasses) {
      const delayed = allpass.buffer[allpass.at];
      allpass.buffer[allpass.at] = wet + delayed * .5;
      wet = delayed - wet;
      if (++allpass.at >= allpass.buffer.length) allpass.at = 0;
    }
    return wet;
  };
}

/* One delay line feeding itself: the reverb's comb without the five others or
   the allpasses, which is the whole difference between a room and a repeat. The
   dry signal is kept in the line rather than added around it, so unlike the
   reverb the output is not shifted — the picture stays where it was and the
   copies pile up behind it at Delay, twice Delay, three times Delay. */
function makeEcho(time, feedback, damping, level) {
  const settled = level / (1 - feedback);
  const buffer = new Float32Array(Math.max(1, Math.round(time))).fill(settled);
  const keep = 1 - damping, scale = 1 - feedback;
  let at = 0, store = settled;
  return sample => {
    const delayed = buffer[at];
    store = delayed * keep + store * damping;
    const wet = sample + store * feedback;
    buffer[at] = wet;
    if (++at >= buffer.length) at = 0;
    return wet * scale;
  };
}

/* The same delay line, short and moving. Sweeping where it reads from drags a
   copy of the picture back and forth across the original, and where the two
   agree or disagree changes with the sweep, so the comb the two of them make
   together slides — the bands are the audible flange written down. The read
   point lands between samples, so it is interpolated; rounding it instead would
   step the sweep and draw the staircase rather than the wave. */
function makeFlanger(time, period, wave, range, feedback, level) {
  const base = Math.max(1, time), swing = base * range;
  const size = Math.ceil(base + swing) + 2;
  const settled = level / (1 - feedback);
  const buffer = new Float32Array(size).fill(settled);
  const osc = makeOscillator(period, wave);
  const scale = 1 - feedback;
  let at = 0;
  return sample => {
    const delay = Math.min(size - 2, Math.max(1, base + swing * osc()));
    const back = at - delay, first = Math.floor(back), fraction = back - first;
    const a = buffer[(first % size + size) % size], b = buffer[((first + 1) % size + size) % size];
    const wet = sample + (a + (b - a) * fraction) * feedback;
    buffer[at] = wet;
    if (++at >= size) at = 0;
    return wet * scale;
  };
}

/* A phaser is not a delay at all: a chain of allpass filters passes everything
   through at full strength and only shifts where each detail sits, and it is
   adding that back to the untouched signal that turns the shift into notches
   where the two cancel. Sweeping the allpass corner walks the notches along the
   scan, which on a picture is a set of soft dark bands that drift. Feedback
   round the chain sharpens them into something much more metallic. */
function makePhaser(stages, period, wave, range, feedback, level) {
  const count = Math.max(1, Math.round(stages)), settled = level / (1 - feedback);
  const ins = new Float32Array(count).fill(settled), outs = new Float32Array(count).fill(settled);
  const osc = makeOscillator(period, wave);
  const scale = 1 - feedback;
  let last = settled;
  return sample => {
    const coefficient = .5 + .45 * range * osc();
    let value = sample + last * feedback;
    for (let stage = 0; stage < count; stage++) {
      const out = -coefficient * value + ins[stage] + coefficient * outs[stage];
      ins[stage] = value; outs[stage] = out; value = out;
    }
    last = value;
    return (sample + value * scale) * .5;
  };
}

/* The shapes a distorted signal is bent to. Each takes the detail already
   normalised to ±1 and hands back the same range, so Drive decides how hard the
   signal is pushed into the shape rather than how loud what comes out is. Soft
   is divided by its own value at full drive, which is what keeps the edges
   growing towards a square as drive goes up instead of quietly shrinking. */
const SONIFY_CURVES = {
  soft: { label: 'Soft — saturate', at: (value, drive) => Math.tanh(value * drive) / Math.tanh(drive) },
  hard: { label: 'Hard — clip', at: (value, drive) => Math.max(-1, Math.min(1, value * drive)) },
  fold: {
    label: 'Fold back',
    at: (value, drive) => {
      const turn = (value * drive + 1) % 4, wrapped = turn < 0 ? turn + 4 : turn;
      return (wrapped < 2 ? wrapped : 4 - wrapped) - 1;
    }
  },
  rectify: { label: 'Rectify', at: (value, drive) => Math.min(1, Math.abs(value * drive)) }
};

/* Distortion is the one effect that would do nothing interesting taken
   literally. A waveshaper has no memory: run one straight over pixel values and
   every pixel of a given brightness comes out the same brightness whatever it
   sits next to, which is a tone curve — the app already has four of those under
   Image ▸ Adjustments, and none of them care which way the picture is read.

   What makes an amplifier interesting is that it is fed an AC signal, so the
   bending happens either side of where the music is sitting rather than either
   side of some fixed level. The same split does it here: a one-pole tracker
   follows the body of the picture, the shape is applied to what is left over,
   and the body goes back on afterwards. Now a lit wall and a dark wall both
   distort around themselves, texture is what gets driven into the shape, and
   Tone decides how fine a detail has to be to count as detail at all. */
function makeDistortion(drive, tone, curve, level) {
  const shape = (SONIFY_CURVES[curve] || SONIFY_CURVES.soft).at;
  const follow = tone * tone * .5 + .002;
  let body = level;
  return sample => {
    body += (sample - body) * follow;
    return body + shape((sample - body) / 255, drive) * 255;
  };
}

/* What a signal does when it runs out of headroom, which in a fixed-point
   machine depends entirely on what the arithmetic was told to do about it.
   Clipping is the well-behaved answer and the one that sounds like a loud
   record; folding is what a modular synth's rectifier does; and wrapping is the
   famous one, the overflow nobody checked for, where one more unit of
   brightness takes a highlight all the way back to black. Wrap is why a bad
   sample rate turns a photograph into contour bands.

   This is the only unit in the rack with no memory, so the reading order
   controls have nothing to bite on and the dialog hides them. */
function makeClip(gain, ceiling, beyond) {
  const top = Math.max(1, ceiling), turn = top * 2;
  return sample => {
    const driven = sample * gain;
    if (driven <= top) return driven;
    if (beyond === 'clip') return top;
    if (beyond === 'wrap') return driven % top;
    const folded = driven % turn;
    return folded <= top ? folded : turn - folded;
  };
}

/* Multiplying the picture by an oscillator rather than adding one to it. At
   full depth the carrier swings negative and takes the picture with it, and
   everything that lands below zero is clipped away black, which is the hard
   banding a ring modulator is known for; backed off, the carrier stays positive
   and it softens into tremolo, the same stripes drawn in shadow rather than cut
   out. Nothing here preserves a steady level and nothing should — rewriting the
   level in step with the oscillator is the entire effect. */
function makeRing(period, wave, depth) {
  const osc = makeOscillator(period, wave);
  return sample => sample * (1 - depth + depth * osc());
}

/* Both halves of what a cheap sampler does to a sound: fewer bits to say how
   loud with, and fewer chances per second to say it. The bits show up as
   banding, and the hold as steps drawn along whichever way the picture is being
   read — which is what separates it from Mosaic, whose blocks are square
   because it has no reading order to be stretched along. */
function makeCrush(bits, hold, level) {
  const steps = Math.max(1, Math.pow(2, bits) - 1), span = Math.max(1, Math.round(hold));
  let held = level, left = 0;
  return sample => {
    if (left <= 0) { held = Math.round(sample / 255 * steps) / steps * 255; left = span; }
    left--;
    return held;
  };
}

/* A Chamberlin state variable filter, which gives all four outputs off one set
   of arithmetic and, more to the point, has a resonance control. That is what
   earns it a place next to the app's existing blurs: a lowpass with the
   resonance up does not smooth an edge, it overshoots and rings past it, and
   because this runs one way along the scan the ringing trails the edge instead
   of sitting symmetrically around it the way a convolution's would.

   The coefficient has to be capped short of where the filter falls apart, and
   where that is depends on the resonance — which is the opposite way round from
   the way it feels. Writing the two state updates as a matrix and asking when
   its eigenvalues stay inside the unit circle gives f² + 2fq < 4, so the safe
   ceiling on f is √(q² + 4) − q: at full resonance, where q is nearly nothing,
   that is comfortably above anything a picture can ask for, and it is the
   *unresonant* filter, with q at 2, that is pinned down to 0.83. Capping f at a
   flat 0.9 and thinking the resonant end was the dangerous one is exactly the
   way to get a filter that runs away to infinity with the resonance at zero.
   A tenth is kept back off the limit, and the two outputs that throw away the
   picture's average are lifted to mid grey so they read as an image. */
function makeFilter(period, resonance, mode, level) {
  const damping = Math.max(.03, 2 - 2 * resonance);
  const limit = Math.min(.9, .9 * (Math.sqrt(damping * damping + 4) - damping));
  const coefficient = Math.min(limit, 2 * Math.sin(Math.PI / Math.max(4, period)));
  let low = level, band = 0;
  return sample => {
    low += coefficient * band;
    const high = sample - low - damping * band;
    band += coefficient * high;
    if (mode === 'low') return low;
    if (mode === 'notch') return low + high;
    return (mode === 'high' ? high : band) + 128;
  };
}

/* Colour spread pulls each channel's unit slightly out of step with the other
   two, applied to whatever length or period gives that unit its character.
   Identical settings echo grey — every channel repeats at the same distance and
   the copy comes back the same colour as the original. Pull them apart and each
   repeat lands at its own offset, so the marks split into the colour fringes
   that are the whole reason for doing this to a picture rather than to a sound.
   Alpha, when it is being sounded, rides with blue rather than being flung
   further out than any colour goes. */
const sonifySpread = (v, channel) => 1 + (Math.min(channel, 2) - 1) * (v.spread / 100) * .35;

/* The rack. The dialog reads each unit's controls out of `uses`, so every
   slider in the panel belongs to whichever unit is selected and the rest go
   away; `ordered: false` marks the one unit with no memory, whose output cannot
   depend on which way the picture was read. `voice` is handed the channel it is
   being built for, so a unit can detune itself per colour, and the level the
   reading head is about to meet, so it can start settled rather than empty. */
const SONIFY_EFFECTS = {
  reverb: {
    label: 'Reverb',
    uses: ['depth', 'feedback', 'damping'],
    voice: (v, channel, level) =>
      makeReverb(Math.max(1, v.depth * sonifySpread(v, channel)), v.feedback / 100, v.damping / 100, level)
  },
  echo: {
    label: 'Echo',
    uses: ['time', 'feedback', 'damping'],
    voice: (v, channel, level) =>
      makeEcho(Math.max(1, v.time * sonifySpread(v, channel)), v.feedback / 100, v.damping / 100, level)
  },
  distortion: {
    label: 'Distortion',
    uses: ['drive', 'tone', 'curve'],
    voice: (v, channel, level) => makeDistortion(v.drive / 100, v.tone / 100 / sonifySpread(v, channel), v.curve, level)
  },
  clip: {
    label: 'Clipping',
    uses: ['gain', 'ceiling', 'beyond'],
    ordered: false,
    voice: (v, channel) => makeClip(v.gain / 100, v.ceiling * sonifySpread(v, channel), v.beyond)
  },
  phaser: {
    label: 'Phaser',
    uses: ['stages', 'sweep', 'range', 'feedback', 'wave'],
    voice: (v, channel, level) => makePhaser(v.stages, Math.max(2, v.sweep * sonifySpread(v, channel)),
      v.wave, v.range / 100, v.feedback / 100, level)
  },
  flanger: {
    label: 'Flanger',
    uses: ['flange', 'sweep', 'range', 'feedback', 'wave'],
    voice: (v, channel, level) => makeFlanger(Math.max(1, v.flange * sonifySpread(v, channel)),
      Math.max(2, v.sweep), v.wave, v.range / 100, v.feedback / 100, level)
  },
  ring: {
    label: 'Ring modulator',
    uses: ['frequency', 'ringDepth', 'wave'],
    voice: (v, channel) => makeRing(Math.max(2, v.frequency * sonifySpread(v, channel)), v.wave, v.ringDepth / 100)
  },
  crush: {
    label: 'Bitcrusher',
    uses: ['bits', 'hold'],
    voice: (v, channel, level) => makeCrush(v.bits, Math.max(1, v.hold * sonifySpread(v, channel)), level)
  },
  filter: {
    label: 'Resonant filter',
    uses: ['cutoff', 'resonance', 'filterMode'],
    voice: (v, channel, level) =>
      makeFilter(Math.max(4, v.cutoff * sonifySpread(v, channel)), v.resonance / 100, v.filterMode, level)
  }
};

const sonifyUses = (effect, control) => !!SONIFY_EFFECTS[effect]?.uses.includes(control);
const sonifyOrdered = effect => SONIFY_EFFECTS[effect]?.ordered !== false;

function sonifyPass(src, v) {
  const w = src.width, h = src.height, out = copyImage(src), data = out.data, source = src.data;
  const unit = SONIFY_EFFECTS[v.effect] || SONIFY_EFFECTS.reverb;
  const runs = sonifyRuns(w, h, v.scan, !!v.snake);
  const stream = !!v.continuous;
  const channels = v.alpha ? 4 : 3, backwards = !!v.reverse;
  for (let channel = 0; channel < channels; channel++) {
    let voice = null;
    for (let index = 0; index < runs.length; index++) {
      const run = runs[backwards ? runs.length - 1 - index : index];
      /* Read backwards and the echoes arrive before the edge that threw them,
         which is the swell in front of the note that reverse reverb is for. */
      const step = backwards ? -run.step : run.step;
      let at = backwards ? run.start + run.step * (run.length - 1) : run.start;
      /* One stream builds the unit once and lets it run the whole picture;
         line by line, each line gets a unit of its own, settled on whatever
         that line opens with. */
      if (!stream || !voice) voice = unit.voice(v, channel, source[at * 4 + channel]);
      for (let sample = 0; sample < run.length; sample++, at += step) {
        const i = at * 4 + channel;
        data[i] = clampByte(voice(source[i]));
      }
    }
  }
  return out;
}

/* Passes is the picture fed back into the unit — the take played out and
   recorded again, not the same take with a longer tail. Each trip works on what
   the last one left, so echoes get echoes of their own and the smear reaches
   further than winding Depth or Feedback up could take it, while every trip on
   its own stays a plausible room rather than a runaway. The unit is rebuilt
   each time round: carrying its delays over would be a second, silent feedback
   path on top of the one the slider names.

   Mix is held back until the end and settled once against the picture as it
   arrived, rather than being applied on every trip. Mixed in each time it stops
   being a wet/dry control and turns into a second decay: at 70% the original is
   down to a fifth of itself by the fourth pass and gone by the sixth, so most
   of a twenty-stop slider would be the same wash and Mix would mean something
   different at every stop. Kept to the end it means one thing — how much of the
   picture survives — and the passes decide only how far the echoes reach. */
function sonifyImage(src, v) {
  let out = src;
  for (let pass = 0, passes = Math.max(1, Math.round(v.passes)); pass < passes; pass++) out = sonifyPass(out, v);
  const mix = v.mix / 100, data = out.data, source = src.data;
  for (let i = 0; i < data.length; i++) data[i] = clampByte(source[i] + (data[i] - source[i]) * mix);
  return out;
}

/* Tileable value noise: the lattice wraps at the image edge, so Clouds over a
   tile still meets itself cleanly. */
function cloudField(w, h, cells, octaves, roughness, seed) {
  const field = new Float32Array(w * h);
  let amplitude = 1, total = 0, columns = Math.max(1, Math.round(cells));
  let rows = Math.max(1, Math.round(cells * h / w));
  for (let octave = 0; octave < octaves; octave++) {
    for (let y = 0; y < h; y++) {
      const v = y / h * rows, v0 = Math.floor(v), fy = smoothStep(v - v0);
      const row0 = wrapIndex(v0, rows), row1 = wrapIndex(v0 + 1, rows);
      for (let x = 0; x < w; x++) {
        const u = x / w * columns, u0 = Math.floor(u), fx = smoothStep(u - u0);
        const column0 = wrapIndex(u0, columns), column1 = wrapIndex(u0 + 1, columns);
        const top = hashNoise(column0, row0, seed + octave) * (1 - fx) + hashNoise(column1, row0, seed + octave) * fx;
        const bottom = hashNoise(column0, row1, seed + octave) * (1 - fx) + hashNoise(column1, row1, seed + octave) * fx;
        field[y * w + x] += (top * (1 - fy) + bottom * fy) * amplitude;
      }
    }
    total += amplitude; amplitude *= roughness; columns *= 2; rows *= 2;
  }
  for (let i = 0; i < field.length; i++) field[i] /= total;
  return field;
}

function hexToRgb(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function cloudsImage(src, cells, detail, roughness, seed, blend, keepAlpha) {
  const w = src.width, h = src.height, field = cloudField(w, h, cells, detail, roughness, seed);
  const out = copyImage(src), data = out.data, source = src.data;
  const from = hexToRgb(hostContext.bg), to = hexToRgb(hostContext.fg);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    const t = field[pixel];
    for (let c = 0; c < 3; c++) {
      const cloud = from[c] + (to[c] - from[c]) * t;
      data[i + c] = blend === 'difference' ? Math.abs(source[i + c] - cloud) : cloud;
    }
    if (!keepAlpha) data[i + 3] = 255;
  }
  return out;
}

const LENS_GHOSTS = {
  zoom: [[-.28, .045, .5, [.4, .8, 1]], [.22, .07, .35, [1, .55, .35]], [.42, .035, .55, [.5, 1, .7]],
         [.68, .09, .3, [1, .8, .4]], [.95, .05, .4, [.6, .5, 1]], [1.3, .13, .22, [1, .45, .55]]],
  prime: [[-.2, .03, .45, [.5, .85, 1]], [.3, .06, .4, [1, .7, .4]], [.75, .1, .28, [.55, 1, .8]],
          [1.15, .16, .18, [1, .5, .45]]],
  movie: [[.35, .12, .3, [.45, .7, 1]], [.8, .07, .45, [1, .75, .45]], [1.25, .2, .16, [.8, .55, 1]]]
};

/* Light added on top of the picture: the flare's core and streaks, one halo
   ring, and the ghosts the lens throws along the line to the frame's centre. */
function lensFlareImage(src, brightness, centreX, centreY, lens) {
  const w = src.width, h = src.height, out = copyImage(src), data = out.data;
  const span = Math.hypot(w, h), gain = brightness / 100;
  const flareX = centreX / 100 * w, flareY = centreY / 100 * h;
  const ghosts = LENS_GHOSTS[lens] || LENS_GHOSTS.zoom;
  const blades = lens === 'movie' ? 1 : lens === 'prime' ? 2 : 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + .5 - flareX, dy = y + .5 - flareY, distance = Math.hypot(dx, dy) / span;
    let red = 0, green = 0, blue = 0;
    const core = Math.exp(-distance * distance * 700) * 2.4 + Math.exp(-distance * 24) * .5;
    red += core; green += core * .96; blue += core * .88;
    const streak = Math.pow(Math.abs(Math.cos(Math.atan2(dy, dx) * blades)), 24) * Math.exp(-distance * 8) * .8;
    red += streak; green += streak * .92; blue += streak * .74;
    const ring = Math.exp(-Math.pow((distance - .33) * 24, 2)) * .16;
    red += ring * .62; green += ring * .8; blue += ring;
    for (const [at, size, strength, colour] of ghosts) {
      const ghostX = flareX + (w / 2 - flareX) * at, ghostY = flareY + (h / 2 - flareY) * at;
      const reach = Math.hypot(x + .5 - ghostX, y + .5 - ghostY) / (size * span);
      if (reach >= 1) continue;
      const light = Math.pow(1 - reach, 1.5) * strength;
      red += light * colour[0]; green += light * colour[1]; blue += light * colour[2];
    }
    red *= gain * 255; green *= gain * 255; blue *= gain * 255;
    if (red < .5 && green < .5 && blue < .5) continue;
    const i = (y * w + x) * 4;
    if (data[i + 3]) { data[i] += red; data[i + 1] += green; data[i + 2] += blue; }
    else {
      data[i] = red; data[i + 1] = green; data[i + 2] = blue;
      data[i + 3] = Math.max(red, green, blue);
    }
  }
  return out;
}

const EFFECTS = {
  'box-blur': {
    title: 'Box Blur',
    help: 'Averages a square of pixels — flatter and blockier than a Gaussian.',
    fields: [
      { id: 'radius', label: 'Radius', type: 'range', min: 1, max: 80, value: 4, step: 1, unit: ' px' },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => boxBlurImage(src, v.radius, v.wrap)
  },
  'motion-blur': {
    title: 'Motion Blur',
    help: 'Smears the layer along one direction, as a moving subject would.',
    fields: [
      { id: 'distance', label: 'Distance', type: 'range', min: 1, max: 200, value: 20, step: 1, unit: ' px' },
      { id: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, value: 0, step: 1, unit: '°' },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => motionBlurImage(src, v.distance, v.angle, v.wrap)
  },
  'radial-blur': {
    title: 'Radial Blur',
    help: 'Spin turns the picture about the centre; zoom rushes out of it.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: 1, max: 100, value: 20, step: 1 },
      { id: 'method', label: 'Method', type: 'select', value: 'spin', options: [['spin', 'Spin'], ['zoom', 'Zoom']] },
      { id: 'centreX', label: 'Centre X', type: 'range', min: 0, max: 100, value: 50, step: 1, unit: '%' },
      { id: 'centreY', label: 'Centre Y', type: 'range', min: 0, max: 100, value: 50, step: 1, unit: '%' }
    ],
    run: (src, v) => radialBlurImage(src, v.amount, v.method, v.centreX, v.centreY)
  },
  sharpen: {
    title: 'Sharpen',
    help: 'The classic three-by-three sharpening kernel, at the strength you ask for.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: 5, max: 300, value: 100, step: 5, unit: '%' },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => {
      const gain = v.amount / 100;
      return convolveImage(src, [0, -gain, 0, -gain, 1 + 4 * gain, -gain, 0, -gain, 0], 3, 1, 0, v.wrap);
    }
  },
  'unsharp-mask': {
    title: 'Unsharp Mask',
    help: 'Adds back what a blur takes away. Threshold leaves flat areas — skin, sky, grain — alone.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: 1, max: 500, value: 100, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'range', min: .1, max: 40, value: 1.5, step: .1, decimals: 1, unit: ' px' },
      { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 128, value: 0, step: 1 },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => unsharpMaskImage(src, v.amount, v.radius, v.threshold, v.wrap)
  },
  'high-pass': {
    title: 'High Pass',
    help: 'Keeps the detail and throws away the tone — mid grey everywhere the layer is flat.',
    fields: [
      { id: 'radius', label: 'Radius', type: 'range', min: .1, max: 50, value: 3, step: .1, decimals: 1, unit: ' px' },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => highPassImage(src, v.radius, v.wrap)
  },
  emboss: {
    title: 'Emboss',
    help: 'Stamps the layer into mid grey, lit from the angle you choose.',
    fields: [
      { id: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, value: 135, step: 1, unit: '°' },
      { id: 'height', label: 'Height', type: 'range', min: 1, max: 10, value: 3, step: 1, unit: ' px' },
      { id: 'amount', label: 'Amount', type: 'range', min: 10, max: 500, value: 100, step: 10, unit: '%' },
      { id: 'grey', label: 'Desaturate', type: 'check', value: true },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => embossImage(src, v.angle, v.height, v.amount, v.grey, v.wrap)
  },
  'find-edges': {
    title: 'Find Edges',
    help: 'Sobel gradients: the outlines stay, the flat areas go.',
    fields: [
      { id: 'amount', label: 'Strength', type: 'range', min: 10, max: 400, value: 100, step: 10, unit: '%' },
      { id: 'invert', label: 'Dark lines on white', type: 'check', value: true },
      { id: 'grey', label: 'Desaturate', type: 'check', value: false },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => findEdgesImage(src, v.amount, v.invert, v.grey, v.wrap)
  },
  maximum: {
    title: 'Maximum',
    help: 'Spreads the light pixels into the dark ones and grows the layer’s shape.',
    fields: [
      { id: 'radius', label: 'Radius', type: 'range', min: 1, max: 40, value: 2, step: 1, unit: ' px' },
      { id: 'round', label: 'Round', type: 'check', value: false }
    ],
    run: (src, v) => morphologyImage(src, v.radius, v.round, true)
  },
  minimum: {
    title: 'Minimum',
    help: 'Spreads the dark pixels into the light ones and shrinks the layer’s shape.',
    fields: [
      { id: 'radius', label: 'Radius', type: 'range', min: 1, max: 40, value: 2, step: 1, unit: ' px' },
      { id: 'round', label: 'Round', type: 'check', value: false }
    ],
    run: (src, v) => morphologyImage(src, v.radius, v.round, false)
  },
  custom: {
    title: 'Custom Matrix',
    help: 'Your own convolution. Each pixel becomes the weighted sum of its neighbours, divided and offset.',
    fields: [
      { id: 'size', label: 'Kernel', type: 'select', value: '3', options: [['3', '3 × 3'], ['5', '5 × 5']] },
      { id: 'matrix', label: 'Weights', type: 'matrix' },
      { id: 'divisor', label: 'Divisor', type: 'number', min: -999, max: 999, value: 1, step: .1 },
      { id: 'offset', label: 'Offset', type: 'number', min: -255, max: 255, value: 0, step: 1 },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => convolveImage(src, v.matrix, Number(v.size), v.divisor, v.offset, v.wrap)
  },
  mosaic: {
    title: 'Mosaic',
    help: 'Averages the layer into square blocks.',
    fields: [{ id: 'cell', label: 'Cell size', type: 'range', min: 2, max: 120, value: 10, step: 1, unit: ' px' }],
    run: (src, v) => mosaicImage(src, v.cell)
  },
  halftone: {
    title: 'Colour Halftone',
    help: 'Redraws the layer as printer’s dots — four rotated ink screens, or one black screen.',
    fields: [
      { id: 'radius', label: 'Max radius', type: 'range', min: 2, max: 30, value: 6, step: 1, unit: ' px' },
      { id: 'angle', label: 'Screen angle', type: 'range', min: 0, max: 90, value: 0, step: 1, unit: '°' },
      { id: 'mono', label: 'Single black screen', type: 'check', value: false }
    ],
    run: (src, v) => halftoneImage(src, v.radius, v.angle, v.mono)
  },
  crystallize: {
    title: 'Crystallize',
    help: 'Clumps the layer into flat polygons around scattered centres.',
    fields: [{ id: 'cell', label: 'Cell size', type: 'range', min: 3, max: 120, value: 12, step: 1, unit: ' px' }],
    run: (src, v) => crystallizeImage(src, v.cell)
  },
  jpeg: {
    title: 'JPEG Artifacts',
    help: 'Saves the picture as a bad JPEG and opens it again: blocks, ringing round hard edges and smeared colour.',
    fields: [
      { id: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, value: 15, step: 1 },
      { id: 'block', label: 'Block size', type: 'range', min: 2, max: 32, value: 8, step: 1, unit: ' px' },
      {
        id: 'chroma', label: 'Colour detail', type: 'select', value: '420',
        options: [['444', '4:4:4 — full'], ['422', '4:2:2 — half across'], ['420', '4:2:0 — half both ways'], ['411', '4:1:1 — quarter across']]
      },
      { id: 'chromaQuality', label: 'Colour quality', type: 'range', min: 1, max: 100, value: 20, step: 1 },
      { id: 'ringing', label: 'Ringing', type: 'range', min: 0, max: 300, value: 100, step: 5, unit: '%' },
      { id: 'passes', label: 'Recompressions', type: 'range', min: 1, max: 20, value: 1, step: 1 },
      { id: 'drift', label: 'Shift blocks between passes', type: 'check', value: true },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => jpegImage(src, v.quality, v.block, v.chroma, v.chromaQuality, v.ringing, v.passes, v.drift, v.wrap)
  },
  'pixel-sort': {
    title: 'Pixel Sorting',
    livePixels: 400_000,
    fields: [
      {
        id: 'intervals', label: 'Spans', type: 'select', value: 'threshold',
        options: [
          ['threshold', 'Threshold range'], ['edges', 'Edges'], ['random', 'Random lengths'],
          ['waves', 'Fixed lengths'], ['none', 'Whole line']
        ]
      },
      {
        id: 'select', label: 'Select by', type: 'select', value: 'luminance', options: PIXEL_SORT_CHANNELS,
        when: v => v.intervals === 'threshold' || v.intervals === 'edges'
      },
      { id: 'lower', label: 'Lower threshold', type: 'range', min: 0, max: 100, value: 25, step: 1, unit: '%', when: v => v.intervals === 'threshold' },
      { id: 'upper', label: 'Upper threshold', type: 'range', min: 0, max: 100, value: 80, step: 1, unit: '%', when: v => v.intervals === 'threshold' },
      { id: 'invert', label: 'Sort outside the range', type: 'check', value: false, when: v => v.intervals === 'threshold' },
      { id: 'edge', label: 'Edge threshold', type: 'range', min: 1, max: 100, value: 12, step: 1, unit: '%', when: v => v.intervals === 'edges' },
      {
        id: 'length', label: 'Span length', type: 'range', min: 2, max: 400, value: 60, step: 1, unit: ' px',
        when: v => v.intervals === 'random' || v.intervals === 'waves'
      },
      {
        id: 'channels', label: 'Move', type: 'select', value: 'all',
        options: Object.entries(PIXEL_SORT_PARTS).map(([value, part]) => [value, part.label])
      },
      {
        id: 'sort', label: 'Sort by', type: 'select', value: 'luminance', options: PIXEL_SORT_CHANNELS,
        when: v => v.channels !== 'separate'
      },
      { id: 'order', label: 'Order', type: 'select', value: 'ascending', options: [['ascending', 'Ascending'], ['descending', 'Descending']] },
      {
        id: 'method', label: 'Method', type: 'select', value: 'full',
        options: Object.entries(PIXEL_SORT_METHODS).map(([value, method]) => [value, method.label])
      },
      { id: 'passes', label: 'Passes', type: 'range', min: 1, max: 200, value: 30, step: 1, when: v => pixelSortUses(v.method, 'passes') },
      { id: 'error', label: 'Wrong answers', type: 'range', min: 1, max: 50, value: 5, step: 1, unit: '%', when: v => pixelSortUses(v.method, 'error') },
      { id: 'gap', label: 'Gap', type: 'range', min: 2, max: 256, value: 16, step: 1, unit: ' px', when: v => pixelSortUses(v.method, 'gap') },
      { id: 'reach', label: 'Reach', type: 'range', min: 1, max: 400, value: 25, step: 1, unit: ' px', when: v => pixelSortUses(v.method, 'reach') },
      { id: 'picks', label: 'Picks', type: 'range', min: 1, max: 400, value: 60, step: 1, when: v => pixelSortUses(v.method, 'picks') },
      { id: 'runs', label: 'Run length', type: 'range', min: 2, max: 512, value: 32, step: 1, unit: ' px', when: v => pixelSortUses(v.method, 'runs') },
      { id: 'depth', label: 'Depth', type: 'range', min: 1, max: 12, value: 3, step: 1, when: v => pixelSortUses(v.method, 'depth') },
      { id: 'extract', label: 'Emptied', type: 'range', min: 1, max: 100, value: 30, step: 1, unit: '%', when: v => pixelSortUses(v.method, 'extract') },
      { id: 'stages', label: 'Stages', type: 'range', min: 1, max: 60, value: 10, step: 1, when: v => pixelSortUses(v.method, 'stages') },
      { id: 'flips', label: 'Flips', type: 'range', min: 1, max: 200, value: 20, step: 1, when: v => pixelSortUses(v.method, 'flips') },
      { id: 'levels', label: 'Levels', type: 'range', min: 2, max: 64, value: 8, step: 1, when: v => pixelSortUses(v.method, 'levels') },
      { id: 'bits', label: 'Bits kept', type: 'range', min: 1, max: 7, value: 3, step: 1, when: v => pixelSortUses(v.method, 'bits') },
      {
        id: 'path', label: 'Lines', type: 'select', value: 'parallel',
        options: [['parallel', 'Parallel'], ['spin', 'Spin — rings'], ['zoom', 'Zoom — rays'], ['spiral', 'Spiral — turns']]
      },
      {
        id: 'angle', type: 'range', min: 0, max: 360, value: 0, step: 1, unit: '°',
        label: v => v.path === 'spin' ? 'Ring cut' : v.path === 'spiral' ? 'Spiral cut' : 'Angle',
        when: v => v.path !== 'zoom'
      },
      { id: 'twist', label: 'Twist', type: 'range', min: -300, max: 300, value: 24, step: 1, unit: ' px/turn', when: v => v.path === 'spiral' },
      {
        id: 'scatter', label: 'Wander the cut', type: 'range', min: 0, max: 100, value: 30, step: 1, unit: '%',
        when: v => v.path === 'spin' || v.path === 'spiral'
      },
      { id: 'centreX', label: 'Centre X', type: 'range', min: 0, max: 100, value: 50, step: 1, unit: '%', when: v => v.path !== 'parallel' },
      { id: 'centreY', label: 'Centre Y', type: 'range', min: 0, max: 100, value: 50, step: 1, unit: '%', when: v => v.path !== 'parallel' },
      { id: 'skip', label: 'Leave spans alone', type: 'range', min: 0, max: 100, value: 0, step: 1, unit: '%' },
      {
        id: 'seed', label: 'Seed', type: 'range', min: 0, max: 999, value: 1, step: 1,
        when: v => v.intervals === 'random' || v.skip > 0 || pixelSortUses(v.method, 'seed')
          || (v.scatter > 0 && (v.path === 'spin' || v.path === 'spiral'))
      },
      { id: 'transparent', label: 'Leave transparent pixels', type: 'check', value: true }
    ],
    run: (src, v) => pixelSortImage(src, v)
  },
  sonify: {
    title: 'Sonification',
    livePixels: v => 400_000 / Math.max(1, v.passes),
    fields: [
      {
        id: 'effect', label: 'Effect', type: 'select', value: 'reverb',
        options: Object.entries(SONIFY_EFFECTS).map(([value, unit]) => [value, unit.label])
      },
      { id: 'depth', label: 'Depth', type: 'range', min: 1, max: 400, value: 40, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'depth') },
      { id: 'time', label: 'Delay', type: 'range', min: 2, max: 800, value: 120, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'time') },
      { id: 'flange', label: 'Delay', type: 'range', min: 1, max: 120, value: 10, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'flange') },
      { id: 'feedback', label: 'Feedback', type: 'range', min: 0, max: 98, value: 80, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'feedback') },
      { id: 'damping', label: 'Damping', type: 'range', min: 0, max: 99, value: 40, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'damping') },
      { id: 'drive', label: 'Drive', type: 'range', min: 100, max: 2000, value: 500, step: 10, unit: '%', when: v => sonifyUses(v.effect, 'drive') },
      { id: 'tone', label: 'Tone', type: 'range', min: 1, max: 100, value: 40, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'tone') },
      {
        id: 'curve', label: 'Shape', type: 'select', value: 'soft',
        options: Object.entries(SONIFY_CURVES).map(([value, curve]) => [value, curve.label]),
        when: v => sonifyUses(v.effect, 'curve')
      },
      { id: 'gain', label: 'Gain', type: 'range', min: 100, max: 1000, value: 250, step: 5, unit: '%', when: v => sonifyUses(v.effect, 'gain') },
      { id: 'ceiling', label: 'Ceiling', type: 'range', min: 8, max: 255, value: 200, step: 1, when: v => sonifyUses(v.effect, 'ceiling') },
      {
        id: 'beyond', label: 'Past the ceiling', type: 'select', value: 'wrap',
        options: [['clip', 'Flatten off'], ['fold', 'Fold back down'], ['wrap', 'Wrap round to black']],
        when: v => sonifyUses(v.effect, 'beyond')
      },
      { id: 'stages', label: 'Stages', type: 'range', min: 1, max: 12, value: 4, step: 1, when: v => sonifyUses(v.effect, 'stages') },
      { id: 'sweep', label: 'Sweep', type: 'range', min: 8, max: 4000, value: 600, step: 8, unit: ' px', when: v => sonifyUses(v.effect, 'sweep') },
      { id: 'range', label: 'Sweep width', type: 'range', min: 0, max: 100, value: 80, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'range') },
      { id: 'frequency', label: 'Frequency', type: 'range', min: 2, max: 400, value: 24, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'frequency') },
      { id: 'ringDepth', label: 'Depth', type: 'range', min: 0, max: 100, value: 100, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'ringDepth') },
      {
        id: 'wave', label: 'Wave', type: 'select', value: 'sine',
        options: Object.entries(SONIFY_WAVES).map(([value, wave]) => [value, wave.label]),
        when: v => sonifyUses(v.effect, 'wave')
      },
      { id: 'bits', label: 'Bits', type: 'range', min: 1, max: 8, value: 3, step: 1, when: v => sonifyUses(v.effect, 'bits') },
      { id: 'hold', label: 'Hold', type: 'range', min: 1, max: 64, value: 4, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'hold') },
      { id: 'cutoff', label: 'Cutoff', type: 'range', min: 4, max: 400, value: 20, step: 1, unit: ' px', when: v => sonifyUses(v.effect, 'cutoff') },
      { id: 'resonance', label: 'Resonance', type: 'range', min: 0, max: 99, value: 80, step: 1, unit: '%', when: v => sonifyUses(v.effect, 'resonance') },
      {
        id: 'filterMode', label: 'Keep', type: 'select', value: 'low',
        options: [['low', 'Low — the broad shapes'], ['high', 'High — the fine detail'], ['band', 'Band — the ringing only'], ['notch', 'Notch — all but the ringing']],
        when: v => sonifyUses(v.effect, 'filterMode')
      },
      { id: 'spread', label: 'Colour spread', type: 'range', min: 0, max: 100, value: 25, step: 1, unit: '%' },
      { id: 'mix', label: 'Mix', type: 'range', min: 0, max: 100, value: 70, step: 1, unit: '%' },
      { id: 'passes', label: 'Passes', type: 'range', min: 1, max: 20, value: 1, step: 1 },
      {
        id: 'scan', label: 'Read', type: 'select', value: 'rows',
        options: Object.entries(SONIFY_SCANS).map(([value, scan]) => [value, scan.label]),
        when: v => sonifyOrdered(v.effect)
      },
      { id: 'continuous', label: 'Run the picture as one stream', type: 'check', value: true, when: v => sonifyOrdered(v.effect) },
      { id: 'snake', label: 'Turn at the ends, don’t fly back', type: 'check', value: true, when: v => sonifyOrdered(v.effect) },
      { id: 'reverse', label: 'Play backwards', type: 'check', value: false, when: v => sonifyOrdered(v.effect) },
      { id: 'alpha', label: 'Sound the alpha channel too', type: 'check', value: false }
    ],
    run: (src, v) => sonifyImage(src, v)
  },
  twirl: {
    title: 'Twirl',
    help: 'Winds the picture around the centre, hardest in the middle.',
    fields: [
      { id: 'angle', label: 'Angle', type: 'range', min: -720, max: 720, value: 120, step: 5, unit: '°' },
      { id: 'radius', label: 'Radius', type: 'range', min: 5, max: 150, value: 100, step: 1, unit: '%' }
    ],
    run: (src, v) => {
      const w = src.width, h = src.height, centreX = w / 2, centreY = h / 2;
      const reach = Math.min(w, h) / 2 * (v.radius / 100), turn = v.angle * Math.PI / 180;
      return remapImage(src, false, point => {
        const dx = point[0] - centreX, dy = point[1] - centreY, distance = Math.hypot(dx, dy);
        if (distance >= reach) return;
        const amount = turn * Math.pow(1 - distance / reach, 2);
        const cos = Math.cos(amount), sin = Math.sin(amount);
        point[0] = centreX + dx * cos - dy * sin; point[1] = centreY + dx * sin + dy * cos;
      });
    }
  },
  pinch: {
    title: 'Pinch / Spherize',
    help: 'Negative amounts pinch the picture inwards, positive ones bulge it out like glass.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: -100, max: 100, value: 50, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'range', min: 5, max: 150, value: 100, step: 1, unit: '%' }
    ],
    run: (src, v) => {
      const w = src.width, h = src.height, centreX = w / 2, centreY = h / 2;
      const reach = Math.min(w, h) / 2 * (v.radius / 100), strength = v.amount / 100;
      return remapImage(src, false, point => {
        const dx = point[0] - centreX, dy = point[1] - centreY, distance = Math.hypot(dx, dy);
        if (distance >= reach || distance < 1e-4) return;
        /* Pulling the sampled radius in towards the centre magnifies what is
           there, which reads as a bulge; pushing it out reads as a pinch. The
           pinch side needs the gentler curve — minifying runs out of picture
           far quicker than magnifying runs out of room. */
        const t = distance / reach, scale = Math.pow(t, 1 + strength * (strength > 0 ? .9 : .5)) / t;
        point[0] = centreX + dx * scale; point[1] = centreY + dy * scale;
      });
    }
  },
  polar: {
    title: 'Polar Coordinates',
    help: 'Bends the picture around a circle, or unrolls a circular one into a strip.',
    fields: [{
      id: 'method', label: 'Method', type: 'select', value: 'to-polar',
      options: [['to-polar', 'Rectangular → polar'], ['to-rect', 'Polar → rectangular']]
    }],
    run: (src, v) => {
      const w = src.width, h = src.height, centreX = w / 2, centreY = h / 2, reach = Math.min(w, h) / 2;
      if (v.method === 'to-polar') return remapImage(src, false, point => {
        const dx = point[0] - centreX, dy = point[1] - centreY;
        const angle = Math.atan2(dx, -dy), distance = Math.hypot(dx, dy);
        point[0] = (angle / (Math.PI * 2) + .5) * w;
        point[1] = Math.min(1, distance / reach) * h;
      });
      return remapImage(src, false, point => {
        const angle = (point[0] / w - .5) * Math.PI * 2, distance = point[1] / h * reach;
        point[0] = centreX + Math.sin(angle) * distance;
        point[1] = centreY - Math.cos(angle) * distance;
      });
    }
  },
  wave: {
    title: 'Wave',
    help: 'Shifts each row and column along a sine, like heat haze or old glass.',
    fields: [
      { id: 'amplitude', label: 'Amplitude', type: 'range', min: 1, max: 100, value: 10, step: 1, unit: ' px' },
      { id: 'wavelength', label: 'Wavelength', type: 'range', min: 4, max: 400, value: 60, step: 1, unit: ' px' },
      { id: 'phase', label: 'Phase', type: 'range', min: 0, max: 360, value: 0, step: 5, unit: '°' },
      {
        id: 'direction', label: 'Direction', type: 'select', value: 'both',
        options: [['both', 'Both axes'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical']]
      },
      { id: 'wrap', label: 'Wrap tile edges', type: 'check', value: true }
    ],
    run: (src, v) => {
      const step = Math.PI * 2 / v.wavelength, phase = v.phase * Math.PI / 180;
      const horizontal = v.direction !== 'vertical', vertical = v.direction !== 'horizontal';
      return remapImage(src, v.wrap, point => {
        const x = point[0], y = point[1];
        if (horizontal) point[0] = x + Math.sin(y * step + phase) * v.amplitude;
        if (vertical) point[1] = y + Math.sin(x * step + phase) * v.amplitude;
      });
    }
  },
  ripple: {
    title: 'Ripple',
    help: 'Concentric ripples spreading from the centre, as if the picture were a pond.',
    fields: [
      { id: 'amplitude', label: 'Amount', type: 'range', min: 1, max: 60, value: 8, step: 1, unit: ' px' },
      { id: 'wavelength', label: 'Ripple size', type: 'range', min: 4, max: 200, value: 30, step: 1, unit: ' px' },
      { id: 'phase', label: 'Phase', type: 'range', min: 0, max: 360, value: 0, step: 5, unit: '°' }
    ],
    run: (src, v) => {
      const centreX = src.width / 2, centreY = src.height / 2;
      const step = Math.PI * 2 / v.wavelength, phase = v.phase * Math.PI / 180;
      return remapImage(src, false, point => {
        const dx = point[0] - centreX, dy = point[1] - centreY, distance = Math.hypot(dx, dy);
        if (distance < 1e-4) return;
        const shift = Math.sin(distance * step + phase) * v.amplitude;
        point[0] += dx / distance * shift; point[1] += dy / distance * shift;
      });
    }
  },
  clouds: {
    title: 'Clouds',
    help: 'Tileable fractal noise between the background and foreground colours.',
    fields: [
      { id: 'cells', label: 'Scale', type: 'range', min: 1, max: 24, value: 4, step: 1 },
      { id: 'detail', label: 'Detail', type: 'range', min: 1, max: 8, value: 5, step: 1, unit: ' octaves' },
      { id: 'roughness', label: 'Roughness', type: 'range', min: .2, max: .9, value: .5, step: .05, decimals: 2 },
      { id: 'seed', label: 'Seed', type: 'range', min: 0, max: 999, value: 1, step: 1 },
      { id: 'blend', label: 'Blend', type: 'select', value: 'replace', options: [['replace', 'Replace'], ['difference', 'Difference']] },
      { id: 'keepAlpha', label: 'Keep layer transparency', type: 'check', value: false }
    ],
    run: (src, v) => cloudsImage(src, v.cells, v.detail, v.roughness, v.seed, v.blend, v.keepAlpha)
  },
  'lens-flare': {
    title: 'Lens Flare',
    help: 'Adds the light a bright source throws around inside a lens.',
    fields: [
      { id: 'brightness', label: 'Brightness', type: 'range', min: 10, max: 300, value: 120, step: 5, unit: '%' },
      { id: 'centreX', label: 'Centre X', type: 'range', min: 0, max: 100, value: 30, step: 1, unit: '%' },
      { id: 'centreY', label: 'Centre Y', type: 'range', min: 0, max: 100, value: 30, step: 1, unit: '%' },
      {
        id: 'lens', label: 'Lens', type: 'select', value: 'zoom',
        options: [['zoom', '50–300 mm zoom'], ['prime', '35 mm prime'], ['movie', 'Movie prime']]
      }
    ],
    run: (src, v) => lensFlareImage(src, v.brightness, v.centreX, v.centreY, v.lens)
  },
  'surface-blur': {
    title: 'Surface Blur',
    help: 'Smooths shading but leaves edges where they are — the filter behind skin softening.',
    fields: [
      { id: 'radius', label: 'Radius', type: 'range', min: 1, max: 24, value: 5, step: 1, unit: ' px' },
      { id: 'threshold', label: 'Threshold', type: 'range', min: 2, max: 120, value: 25, step: 1 }
    ],
    run: (src, v) => retouchOf().surfaceBlur(src, v.radius, v.threshold)
  },
  clarity: {
    title: 'Clarity',
    help: 'Contrast at one scale only. Positive gives punch, negative gives the soft-focus look.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: -100, max: 100, value: 40, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'range', min: 2, max: 120, value: 24, step: 1, unit: ' px' },
      { id: 'protect', label: 'Protect black and white', type: 'check', value: true }
    ],
    run: (src, v) => retouchOf().localContrast(src, blurredImage(src, v.radius, false), v.amount, v.protect)
  },
  vignette: {
    title: 'Vignette',
    help: 'Darkens or lightens the corners, the way a lens does wide open.',
    fields: [
      { id: 'amount', label: 'Amount', type: 'range', min: -100, max: 100, value: -40, step: 1, unit: '%' },
      { id: 'midpoint', label: 'Midpoint', type: 'range', min: 5, max: 100, value: 55, step: 1, unit: '%' },
      { id: 'feather', label: 'Feather', type: 'range', min: 1, max: 100, value: 55, step: 1, unit: '%' },
      { id: 'roundness', label: 'Roundness', type: 'range', min: 0, max: 100, value: 60, step: 1, unit: '%' }
    ],
    run: (src, v) => vignetteImage(src, v.amount, v.midpoint, v.feather, v.roundness)
  },
  graduated: {
    title: 'Graduated Filter',
    help: 'One adjustment poured in through a straight edge — the photographer’s grey grad, for skies.',
    fields: [
      { id: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, value: 0, step: 1, unit: '°' },
      { id: 'position', label: 'Position', type: 'range', min: 0, max: 100, value: 40, step: 1, unit: '%' },
      { id: 'softness', label: 'Softness', type: 'range', min: 1, max: 100, value: 35, step: 1, unit: '%' },
      { id: 'exposure', label: 'Exposure', type: 'range', min: -100, max: 100, value: -35, step: 1, unit: '%' },
      { id: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0, step: 1, unit: '%' },
      { id: 'warmth', label: 'Warmth', type: 'range', min: -100, max: 100, value: 0, step: 1, unit: '%' }
    ],
    run: (src, v) => graduatedImage(src, v)
  },
  'lens-correction': {
    title: 'Lens Correction',
    help: 'Straightens barrel or pincushion distortion and pulls the colour fringes back together.',
    fields: [
      { id: 'distortion', label: 'Distortion', type: 'range', min: -60, max: 60, value: 0, step: 1 },
      { id: 'fringe', label: 'Fringe', type: 'range', min: -40, max: 40, value: 0, step: 1 },
      { id: 'scale', label: 'Scale', type: 'range', min: 80, max: 140, value: 100, step: 1, unit: '%' },
      { id: 'devignette', label: 'Corner lift', type: 'range', min: 0, max: 100, value: 0, step: 1, unit: '%' }
    ],
    run: (src, v) => lensCorrectionImage(src, v.distortion, v.fringe, v.scale, v.devignette)
  },
  selective: {
    title: 'Selective Adjustment',
    help: 'The pin decides what changes: pixels near it that look like it move, the rest stay put.',
    fields: [
      { id: 'size', label: 'Size', type: 'range', min: 2, max: 100, value: 25, step: 1, unit: '%' },
      { id: 'tolerance', label: 'Similarity', type: 'range', min: 1, max: 100, value: 35, step: 1 },
      { id: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, value: 0, step: 1 },
      { id: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0, step: 1 },
      { id: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0, step: 1 },
      { id: 'showMask', label: 'Show the mask', type: 'check', value: false }
    ],
    run: (src, v) => selectiveImage(src, v)
  }
};

/* A radial falloff from the centre. Negative amounts darken the corners, which
   is the way round anybody actually wants it. */
function vignetteImage(src, amount, midpoint, feather, roundness) {
  const w = src.width, h = src.height, out = copyImage(src), data = out.data;
  const centreX = w / 2, centreY = h / 2;
  /* Roundness slides between a circle and an ellipse that follows the frame. */
  const shortest = Math.min(centreX, centreY), longest = Math.hypot(centreX, centreY);
  const radiusX = centreX + (shortest - centreX) * (roundness / 100);
  const radiusY = centreY + (shortest - centreY) * (roundness / 100);
  const inner = midpoint / 100 * (longest / Math.max(radiusX, radiusY));
  const softness = Math.max(.02, feather / 100);
  const gain = amount / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + .5 - centreX) / radiusX, dy = (y + .5 - centreY) / radiusY;
    const distance = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, (distance - inner) / softness));
    const falloff = smoothStep(t) * gain;
    if (!falloff) continue;
    const i = (y * w + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const value = data[i + channel];
      data[i + channel] = clampByte(falloff < 0 ? value * (1 + falloff) : value + (255 - value) * falloff);
    }
  }
  return out;
}

function graduatedImage(src, values) {
  const w = src.width, h = src.height, out = copyImage(src), data = out.data;
  const angle = values.angle * Math.PI / 180;
  const dirX = Math.sin(angle), dirY = -Math.cos(angle);
  const diagonal = Math.hypot(w, h);
  const line = (values.position / 100 - .5) * diagonal;
  const softness = Math.max(1, values.softness / 100 * diagonal / 2);
  const exposure = values.exposure / 100, saturation = values.saturation / 100, warmth = values.warmth / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const distance = (x + .5 - w / 2) * dirX + (y + .5 - h / 2) * dirY;
    const t = Math.max(0, Math.min(1, (line + softness - distance) / (softness * 2)));
    const strength = smoothStep(t);
    if (strength <= 0) continue;
    const i = (y * w + x) * 4;
    let red = data[i], green = data[i + 1], blue = data[i + 2];
    if (exposure) {
      const shift = exposure * strength;
      red = shift > 0 ? red + (255 - red) * shift : red * (1 + shift);
      green = shift > 0 ? green + (255 - green) * shift : green * (1 + shift);
      blue = shift > 0 ? blue + (255 - blue) * shift : blue * (1 + shift);
    }
    if (saturation) {
      const luma = red * .299 + green * .587 + blue * .114, amount = saturation * strength;
      red += (red - luma) * amount; green += (green - luma) * amount; blue += (blue - luma) * amount;
    }
    if (warmth) {
      const amount = warmth * strength * 40;
      red += amount; blue -= amount;
    }
    data[i] = clampByte(red); data[i + 1] = clampByte(green); data[i + 2] = clampByte(blue);
  }
  return out;
}

/* Barrel and pincushion are a radial polynomial; the colour fringe is the same
   polynomial applied a little harder to red and a little softer to blue. */
function lensCorrectionImage(src, distortion, fringe, scale, devignette) {
  const w = src.width, h = src.height, out = blankImage(w, h), data = out.data;
  const centreX = w / 2, centreY = h / 2;
  const norm = Math.hypot(centreX, centreY);
  const k = distortion / 100, zoom = 100 / scale;
  const sample = [0, 0, 0, 0], channels = [0, 0, 0];
  const map = (x, y, extra) => {
    const dx = (x - centreX) / norm, dy = (y - centreY) / norm;
    const r2 = dx * dx + dy * dy;
    const factor = (1 + (k + extra) * r2) * zoom;
    return [centreX + dx * norm * factor, centreY + dy * norm * factor];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const spread = fringe / 4000;
    for (let channel = 0; channel < 3; channel++) {
      const extra = channel === 0 ? spread : channel === 2 ? -spread : 0;
      const [sx, sy] = map(x + .5, y + .5, extra);
      sampleImage(src, sx - .5, sy - .5, false, sample);
      channels[channel] = sample[channel];
      if (channel === 1) data[i + 3] = sample[3];
    }
    let lift = 1;
    if (devignette) {
      const dx = (x + .5 - centreX) / norm, dy = (y + .5 - centreY) / norm;
      lift = 1 + devignette / 100 * (dx * dx + dy * dy) * 1.4;
    }
    data[i] = clampByte(channels[0] * lift);
    data[i + 1] = clampByte(channels[1] * lift);
    data[i + 2] = clampByte(channels[2] * lift);
  }
  return out;
}

/* The Snapseed trick: one pin, and a mask that spreads to whatever nearby
   pixels look like the one underneath it. */
function selectiveImage(src, values) {
  const w = src.width, h = src.height, out = copyImage(src), data = out.data, source = src.data;
  const pin = hostContext.pin || { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const centre = ((Math.min(h - 1, pin.y)) * w + Math.min(w - 1, pin.x)) * 4;
  const pinRed = source[centre], pinGreen = source[centre + 1], pinBlue = source[centre + 2];
  const radius = values.size / 100 * Math.hypot(w, h) / 2;
  const tolerance = Math.max(1, values.tolerance * 3);
  const brightness = values.brightness / 100, contrast = values.contrast / 100, saturation = values.saturation / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const distance = Math.hypot(x + .5 - pin.x, y + .5 - pin.y);
    if (distance > radius) { if (values.showMask) { data[i] = data[i + 1] = data[i + 2] = 0; } continue; }
    const difference = Math.abs(source[i] - pinRed) + Math.abs(source[i + 1] - pinGreen) + Math.abs(source[i + 2] - pinBlue);
    const likeness = Math.max(0, 1 - difference / tolerance);
    const reach = smoothStep(Math.max(0, 1 - distance / radius));
    const coverage = likeness * reach;
    if (values.showMask) {
      const grey = clampByte(coverage * 255);
      data[i] = grey; data[i + 1] = grey; data[i + 2] = grey;
      continue;
    }
    if (coverage <= 0) continue;
    let red = source[i], green = source[i + 1], blue = source[i + 2];
    if (brightness) {
      const shift = brightness * coverage;
      red = shift > 0 ? red + (255 - red) * shift : red * (1 + shift);
      green = shift > 0 ? green + (255 - green) * shift : green * (1 + shift);
      blue = shift > 0 ? blue + (255 - blue) * shift : blue * (1 + shift);
    }
    if (contrast) {
      const amount = 1 + contrast * coverage;
      red = (red - 128) * amount + 128; green = (green - 128) * amount + 128; blue = (blue - 128) * amount + 128;
    }
    if (saturation) {
      const luma = red * .299 + green * .587 + blue * .114, amount = saturation * coverage;
      red += (red - luma) * amount; green += (green - luma) * amount; blue += (blue - luma) * amount;
    }
    data[i] = clampByte(red); data[i + 1] = clampByte(green); data[i + 2] = clampByte(blue);
  }
  return out;
}

/* Beyond this size a filter takes long enough that chasing the slider would
   stutter, so the preview waits for the control to be let go instead. A filter
   whose own cost is far from the usual — Pixel Sorting runs an algorithm over
   every span and can be asked to run it hundreds of times — sets its own
   livePixels rather than dragging this number down for the other thirty.

   A filter may also give livePixels as a function of its own settings, for the
   case where one of the sliders is a multiplier on the whole job: Sonification
   asked to play the picture through twenty times costs twenty times what one
   pass costs, and a budget fixed when the dialog opened would either forbid a
   live preview that is perfectly affordable at one pass or promise one it
   cannot keep at twenty. Those are re-read whenever a control moves. */
const EFFECT_LIVE_PIXELS = 1_500_000;
const effectBudget = (config, values) =>
  (typeof config.livePixels === 'function' ? config.livePixels(values) : config.livePixels) || EFFECT_LIVE_PIXELS;
const CUSTOM_KERNELS = {
  3: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  5: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};

/* ClackPaint pulls these back into its own scope so its call sites read as
   they always did; Video Lab reaches for EFFECTS and runs entries by name. */
globalThis.ClackFX = {
  EFFECTS, CUSTOM_KERNELS, EFFECT_LIVE_PIXELS, effectBudget,
  setContext,
  blankImage, copyImage, sampleImage, remapImage, convolveImage, blurredImage,
  hexToRgb, clampByte, wrapIndex, edgeIndex
};
})();
