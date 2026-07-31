/* ClackPaint — dithering effects.
 *
 * Everything in here is pure pixel work plus one generated dialog; the paint
 * app hands over a small host object (canvas access, undo, status line) and
 * calls ClackDither.open('error-diffusion') and friends from its Effects menu.
 *
 * Sources for the numbers that could not simply be derived:
 *   - Ostromoukhov's variable coefficients: Appendix I of "A Simple and
 *     Efficient Error-Diffusion Algorithm", SIGGRAPH 2001.
 *   - Knuth's dot-diffusion class matrix and sharpening filter: his own
 *     literate program DOT-DIFF (cs.stanford.edu/~knuth/programs/dot-diff.w),
 *     accompanying "Digital halftones by dot diffusion", TOG 6 (1987).
 */
(() => {
'use strict';

/* ------------------------------------------------------------------ maths */

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

/* sRGB transfer curve, so "work in linear light" mixes tones the way light
 * actually mixes rather than the way the file encodes it. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = 255 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
}
function linearToSrgb(value) {
  const c = clamp(value / 255, 0, 1);
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

/* Seeded so that the live preview and the applied result are identical. */
function makeRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianFrom(random) {
  let u = 0, v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const hexToRgb = hex => {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ------------------------------------------------------- output palettes */

/* Every quantiser answers q(r, g, b, out) in the working colour space and
 * advertises `step`, the typical distance between neighbouring output values,
 * which the ordered and noise dithers use to size their offsets. */

function levelQuantiser(levels, mono) {
  /* levels are already in the working space and sorted low to high */
  const TABLE = 1024;
  const table = new Float32Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    const value = (i * 255) / (TABLE - 1);
    let best = levels[0], bestDistance = Infinity;
    for (const level of levels) {
      const distance = Math.abs(level - value);
      if (distance < bestDistance) { bestDistance = distance; best = level; }
    }
    table[i] = best;
  }
  const lookup = value => table[clamp(Math.round((value * (TABLE - 1)) / 255), 0, TABLE - 1)];
  return {
    mono,
    step: 255 / Math.max(1, levels.length - 1),
    size: levels.length,
    q(r, g, b, out) { out[0] = lookup(r); out[1] = lookup(g); out[2] = lookup(b); }
  };
}

function listQuantiser(colours) {
  const count = colours.length / 3;
  const cached = count > 8 ? new Int16Array(1 << 18).fill(-1) : null;
  const nearest = (r, g, b) => {
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < count; i++) {
      const dr = r - colours[i * 3], dg = g - colours[i * 3 + 1], db = b - colours[i * 3 + 2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  };
  return {
    mono: false,
    /* a rough spacing for a cube-ish palette; the strength control tunes it */
    step: clamp(255 / Math.max(1, Math.cbrt(count) - 1), 32, 255),
    size: count,
    colours,
    nearest,
    q(r, g, b, out) {
      const cr = clamp(r, 0, 255), cg = clamp(g, 0, 255), cb = clamp(b, 0, 255);
      let index;
      if (cached) {
        const key = (((cr * 63) / 255) | 0) << 12 | (((cg * 63) / 255) | 0) << 6 | (((cb * 63) / 255) | 0);
        index = cached[key];
        if (index < 0) {
          /* resolve from the cache cell's own position so the answer is stable */
          index = nearest(((key >> 12) & 63) * 255 / 63, ((key >> 6) & 63) * 255 / 63, (key & 63) * 255 / 63);
          cached[key] = index;
        }
      } else index = nearest(cr, cg, cb);
      out[0] = colours[index * 3]; out[1] = colours[index * 3 + 1]; out[2] = colours[index * 3 + 2];
    }
  };
}

const WEB_SAFE = (() => {
  const out = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) out.push([r * 51, g * 51, b * 51]);
  return out;
})();

function buildQuantiser(options, colours) {
  const linear = !!options.linear;
  const toWorking = channel => (linear ? SRGB_TO_LINEAR[clamp(Math.round(channel), 0, 255)] : channel);
  const listOf = entries => {
    const flat = new Float32Array(entries.length * 3);
    entries.forEach(([r, g, b], i) => {
      flat[i * 3] = toWorking(r); flat[i * 3 + 1] = toWorking(g); flat[i * 3 + 2] = toWorking(b);
    });
    return listQuantiser(flat);
  };
  const evenLevels = count => {
    const out = [];
    for (let i = 0; i < count; i++) out.push(toWorking((i * 255) / (count - 1)));
    return out;
  };
  switch (options.palette) {
    case 'gray': return levelQuantiser(evenLevels(clamp(options.grayLevels | 0, 2, 64)), true);
    case 'rgb': return levelQuantiser(evenLevels(clamp(options.rgbLevels | 0, 2, 16)), false);
    case 'fgbg': return listOf([hexToRgb(colours.bg), hexToRgb(colours.fg)]);
    case 'paint': return listOf(colours.palette.map(hexToRgb));
    case 'web': return listOf(WEB_SAFE);
    case 'mono':
    default: return levelQuantiser(evenLevels(2), true);
  }
}

/* ------------------------------------------------- working pixel buffers */

function toWorking(image, options, quantiser) {
  const count = image.width * image.height;
  const buffer = new Float32Array(count * 3);
  const data = image.data;
  const linear = !!options.linear;
  /* Rec.709 in linear light, the traditional Rec.601 weights in gamma space */
  const wr = linear ? 0.2126 : 0.299, wg = linear ? 0.7152 : 0.587, wb = linear ? 0.0722 : 0.114;
  for (let i = 0, p = 0, j = 0; i < count; i++, p += 3, j += 4) {
    let r = data[j], g = data[j + 1], b = data[j + 2];
    if (linear) { r = SRGB_TO_LINEAR[r]; g = SRGB_TO_LINEAR[g]; b = SRGB_TO_LINEAR[b]; }
    if (quantiser.mono) { const luma = r * wr + g * wg + b * wb; r = g = b = luma; }
    buffer[p] = r; buffer[p + 1] = g; buffer[p + 2] = b;
  }
  return buffer;
}

function fromWorking(buffer, image, options) {
  const count = image.width * image.height;
  const data = image.data;
  const linear = !!options.linear;
  for (let i = 0, p = 0, j = 0; i < count; i++, p += 3, j += 4) {
    if (!data[j + 3]) continue; /* fully transparent pixels are left alone */
    data[j] = Math.round(clamp(linear ? linearToSrgb(buffer[p]) : buffer[p], 0, 255));
    data[j + 1] = Math.round(clamp(linear ? linearToSrgb(buffer[p + 1]) : buffer[p + 1], 0, 255));
    data[j + 2] = Math.round(clamp(linear ? linearToSrgb(buffer[p + 2]) : buffer[p + 2], 0, 255));
  }
}

/* ------------------------------------------------- error-diffusion kernels */

const ED_KERNELS = {
  'floyd-steinberg': { label: 'Floyd–Steinberg (1976)', div: 16, cells: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  'false-floyd-steinberg': { label: 'False Floyd–Steinberg (3 cell)', div: 8, cells: [[1, 0, 3], [0, 1, 3], [1, 1, 2]] },
  atkinson: { label: 'Atkinson (1980s Mac)', div: 8, cells: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jjn: { label: 'Jarvis, Judice & Ninke', div: 48, cells: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { label: 'Stucki', div: 42, cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  burkes: { label: 'Burkes', div: 32, cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra3: { label: 'Sierra (three row)', div: 32, cells: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
  sierra2: { label: 'Two-row Sierra', div: 16, cells: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]] },
  'sierra-lite': { label: 'Sierra Lite', div: 4, cells: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  fan: { label: 'Fan', div: 16, cells: [[1, 0, 7], [-2, 1, 1], [-1, 1, 3], [0, 1, 5]] },
  'shiau-fan': { label: 'Shiau–Fan', div: 8, cells: [[1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2]] },
  'shiau-fan-2': { label: 'Shiau–Fan II', div: 16, cells: [[1, 0, 8], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4]] },
  ostromoukhov: { label: 'Ostromoukhov (variable coefficients)', variable: true }
};

const FS_SPREAD = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];

/* Appendix I of Ostromoukhov 2001: right, down-left and down weights for input
 * levels 0…127; levels 128…255 mirror these, D(i) = D(255 - i). */
const OSTROMOUKHOV = Int32Array.from([
  13, 0, 5, 13, 0, 5, 21, 0, 10, 7, 0, 4, 8, 0, 5, 47, 3, 28, 23, 3, 13, 15, 3, 8,
  22, 6, 11, 43, 15, 20, 7, 3, 3, 501, 224, 211, 249, 116, 103, 165, 80, 67, 123, 62, 49, 489, 256, 191,
  81, 44, 31, 483, 272, 181, 60, 35, 22, 53, 32, 19, 237, 148, 83, 471, 304, 161, 3, 2, 1, 481, 314, 185,
  354, 226, 155, 1389, 866, 685, 227, 138, 125, 267, 158, 163, 327, 188, 220, 61, 34, 45, 627, 338, 505, 1227, 638, 1075,
  20, 10, 19, 1937, 1000, 1767, 977, 520, 855, 657, 360, 551, 71, 40, 57, 2005, 1160, 1539, 337, 200, 247, 2039, 1240, 1425,
  257, 160, 171, 691, 440, 437, 1045, 680, 627, 301, 200, 171, 177, 120, 95, 2141, 1480, 1083, 1079, 760, 513, 725, 520, 323,
  137, 100, 57, 2209, 1640, 855, 53, 40, 19, 2243, 1720, 741, 565, 440, 171, 759, 600, 209, 1147, 920, 285, 2311, 1880, 513,
  97, 80, 19, 335, 280, 57, 1181, 1000, 171, 793, 680, 95, 599, 520, 57, 2413, 2120, 171, 405, 360, 19, 2447, 2200, 57,
  11, 10, 0, 158, 151, 3, 178, 179, 7, 1030, 1091, 63, 248, 277, 21, 318, 375, 35, 458, 571, 63, 878, 1159, 147,
  5, 7, 1, 172, 181, 37, 97, 76, 22, 72, 41, 17, 119, 47, 29, 4, 1, 1, 4, 1, 1, 4, 1, 1,
  4, 1, 1, 4, 1, 1, 4, 1, 1, 4, 1, 1, 4, 1, 1, 4, 1, 1, 65, 18, 17, 95, 29, 26,
  185, 62, 53, 30, 11, 9, 35, 14, 11, 85, 37, 28, 55, 26, 19, 80, 41, 29, 155, 86, 59, 5, 3, 2,
  5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2,
  5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 5, 3, 2, 305, 176, 119, 155, 86, 59, 105, 56, 39,
  80, 41, 29, 65, 32, 23, 55, 26, 19, 335, 152, 113, 85, 37, 28, 115, 48, 37, 35, 14, 11, 355, 136, 109,
  30, 11, 9, 365, 128, 107, 185, 62, 53, 25, 8, 7, 95, 29, 26, 385, 112, 103, 65, 18, 17, 395, 104, 101,
  4, 1, 1
]);

/* ------------------------------------------------------ threshold matrices */

const matrixCache = new Map();
const cachedMatrix = (key, build) => {
  if (!matrixCache.has(key)) matrixCache.set(key, build());
  return matrixCache.get(key);
};

/* ranks 0…n-1 become thresholds spread evenly across (0, 1) */
const ranksToThresholds = (ranks, count) => {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (ranks[i] + 0.5) / count;
  return out;
};

function bayerMatrix(size) {
  return cachedMatrix(`bayer:${size}`, () => {
    let matrix = [[0]], side = 1;
    while (side < size) {
      const next = [];
      for (let y = 0; y < side * 2; y++) next.push(new Array(side * 2).fill(0));
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const value = matrix[y][x] * 4;
        next[y][x] = value;
        next[y][x + side] = value + 2;
        next[y + side][x] = value + 3;
        next[y + side][x + side] = value + 1;
      }
      matrix = next; side *= 2;
    }
    const ranks = new Int32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ranks[y * size + x] = matrix[y][x];
    return ranksToThresholds(ranks, size * size);
  });
}

/* A clustered-dot screen: cells are ranked by how close they sit to a dot
 * centre, so the darker the tone the fatter the halftone dot grows. */
function clusteredMatrix(size, shape, angle) {
  return cachedMatrix(`clustered:${size}:${shape}:${angle}`, () => {
    const centres = angle === 45 ? [[0, 0], [size / 2, size / 2]] : [[0, 0]];
    const wrap = delta => {
      const d = Math.abs(delta) % size;
      return Math.min(d, size - d);
    };
    const spot = (dx, dy) => {
      switch (shape) {
        case 'diamond': return Math.abs(dx) + Math.abs(dy);
        case 'square': return Math.max(Math.abs(dx), Math.abs(dy));
        case 'ellipse': return dx * dx * 0.6 + dy * dy * 1.6;
        case 'line': return Math.abs(dy) * size + Math.abs(dx) * 1e-3;
        default: return dx * dx + dy * dy;
      }
    };
    const cells = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let distance = Infinity;
      for (const [cx, cy] of centres) {
        let dx = wrap(x - cx), dy = wrap(y - cy);
        if (shape === 'line' && angle === 45) { const rx = dx; dx = (rx + dy) / 2; dy = (rx - dy) / 2; }
        distance = Math.min(distance, spot(dx, dy));
      }
      cells.push([distance, y * size + x]);
    }
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const ranks = new Int32Array(size * size);
    cells.forEach(([, index], rank) => { ranks[index] = rank; });
    return ranksToThresholds(ranks, size * size);
  });
}

/* Ulichney's void-and-cluster: the standard way to build a blue-noise mask.
 * The filtered energy is kept up to date incrementally, which is what makes
 * generating a 64×64 or 128×128 mask in the browser practical. */
function voidAndClusterMatrix(size, sigma, seed) {
  return cachedMatrix(`vac:${size}:${sigma}:${seed}`, () => {
    const count = size * size;
    const binary = new Uint8Array(count);
    const energy = new Float32Array(count);
    const radius = Math.min(size >> 1, Math.max(1, Math.ceil(sigma * 3)));
    const offsets = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      offsets.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
    }
    const touch = (index, sign) => {
      const x = index % size, y = (index / size) | 0;
      for (const [dx, dy, weight] of offsets) {
        const nx = (x + dx + size) % size, ny = (y + dy + size) % size;
        energy[ny * size + nx] += sign * weight;
      }
    };
    const tightestCluster = () => {
      let best = -1, bestEnergy = -Infinity;
      for (let i = 0; i < count; i++) if (binary[i] && energy[i] > bestEnergy) { bestEnergy = energy[i]; best = i; }
      return best;
    };
    const largestVoid = () => {
      let best = -1, bestEnergy = Infinity;
      for (let i = 0; i < count; i++) if (!binary[i] && energy[i] < bestEnergy) { bestEnergy = energy[i]; best = i; }
      return best;
    };

    const random = makeRandom(seed);
    let ones = Math.max(1, Math.round(count / 10));
    for (let placed = 0; placed < ones;) {
      const index = (random() * count) | 0;
      if (binary[index]) continue;
      binary[index] = 1; touch(index, 1); placed++;
    }
    /* shuffle the seed pattern until removing a cluster reopens the same hole */
    for (let guard = 0; guard < count * 4; guard++) {
      const cluster = tightestCluster();
      binary[cluster] = 0; touch(cluster, -1);
      const gap = largestVoid();
      binary[gap] = 1; touch(gap, 1);
      if (gap === cluster) break;
    }

    const prototype = binary.slice();
    const protoEnergy = energy.slice();
    const ranks = new Int32Array(count);

    for (let rank = ones - 1; rank >= 0; rank--) {
      const cluster = tightestCluster();
      binary[cluster] = 0; touch(cluster, -1);
      ranks[cluster] = rank;
    }
    binary.set(prototype); energy.set(protoEnergy);
    for (let rank = ones; rank < count; rank++) {
      const gap = largestVoid();
      binary[gap] = 1; touch(gap, 1);
      ranks[gap] = rank;
    }
    return ranksToThresholds(ranks, count);
  });
}

function orderedMatrix(options) {
  switch (options.matrix) {
    case 'clustered': return { data: clusteredMatrix(clamp(options.clusterSize | 0, 2, 32), options.spot, +options.screenAngle), size: clamp(options.clusterSize | 0, 2, 32) };
    case 'blue': {
      const size = clamp(options.maskSize | 0, 8, 128);
      return { data: voidAndClusterMatrix(size, +options.sigma || 1.5, options.seed | 0), size };
    }
    default: {
      const size = clamp(options.bayerSize | 0, 2, 32);
      const power = 1 << Math.round(Math.log2(size));
      return { data: bayerMatrix(power), size: power };
    }
  }
}

/* ------------------------------------------------------------- algorithms */

function runErrorDiffusion(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  const out = new Float32Array(3);
  const strength = clamp((+options.strength || 0) / 100, 0, 2);
  const jitter = clamp((+options.jitter || 0) / 100, 0, 1);
  const serpentine = !!options.serpentine;
  const random = makeRandom(options.seed | 0);
  const variable = options.kernel === 'ostromoukhov';
  const kernel = ED_KERNELS[options.kernel] || ED_KERNELS['floyd-steinberg'];
  const cells = variable ? [[1, 0, 0], [-1, 1, 0], [0, 1, 0]] : kernel.cells;
  const weights = new Float32Array(cells.length);
  /* Atkinson and friends deliberately drop part of the error, so keep the
   * kernel's own share of it rather than always normalising back to 1. */
  const kept = variable ? 1 : cells.reduce((total, cell) => total + cell[2], 0) / kernel.div;
  const hysteresis = clamp(+options.hysteresis || 0, 0, 1);
  const done = hysteresis ? new Float32Array(buffer.length) : null;

  for (let y = 0; y < height; y++) {
    const reverse = serpentine && (y & 1) === 1;
    for (let step = 0; step < width; step++) {
      const x = reverse ? width - 1 - step : step;
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const p = pixel * 3;
      const r = buffer[p], g = buffer[p + 1], b = buffer[p + 2];

      /* Green noise: nudge the decision towards what the neighbours already
       * became, which pulls single pixels together into clusters. */
      let dr = r, dg = g, db = b;
      if (hysteresis) {
        let sr = 0, sg = 0, sb = 0, total = 0;
        for (const [ox, oy] of [[-1, 0], [-1, -1], [0, -1], [1, -1]]) {
          const nx = x + (reverse ? -ox : ox), ny = y + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const q = (ny * width + nx) * 3;
          sr += done[q]; sg += done[q + 1]; sb += done[q + 2]; total++;
        }
        if (total) {
          dr += hysteresis * (sr / total - r);
          dg += hysteresis * (sg / total - g);
          db += hysteresis * (sb / total - b);
        }
      }

      quantiser.q(dr, dg, db, out);
      buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
      if (done) { done[p] = out[0]; done[p + 1] = out[1]; done[p + 2] = out[2]; }

      const errorR = (r - out[0]) * strength;
      const errorG = (g - out[1]) * strength;
      const errorB = (b - out[2]) * strength;

      if (variable) {
        /* the coefficients depend on how light or dark this pixel came out */
        const level = clamp(Math.round(r * 0.299 + g * 0.587 + b * 0.114), 0, 255);
        const row = (level < 128 ? level : 255 - level) * 3;
        const sum = OSTROMOUKHOV[row] + OSTROMOUKHOV[row + 1] + OSTROMOUKHOV[row + 2];
        weights[0] = OSTROMOUKHOV[row] / sum;
        weights[1] = OSTROMOUKHOV[row + 1] / sum;
        weights[2] = OSTROMOUKHOV[row + 2] / sum;
      } else {
        let sum = 0;
        for (let i = 0; i < cells.length; i++) {
          const weight = cells[i][2] * (jitter ? 1 + (random() - 0.5) * 2 * jitter : 1);
          weights[i] = weight > 0 ? weight : 0;
          sum += weights[i];
        }
        if (sum <= 0) continue;
        for (let i = 0; i < cells.length; i++) weights[i] = (weights[i] / sum) * kept;
      }

      for (let i = 0; i < cells.length; i++) {
        const weight = weights[i];
        if (!weight) continue;
        const nx = x + (reverse ? -cells[i][0] : cells[i][0]);
        const ny = y + cells[i][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (!alpha[neighbour * 4 + 3]) continue;
        const q = neighbour * 3;
        buffer[q] += errorR * weight;
        buffer[q + 1] += errorG * weight;
        buffer[q + 2] += errorB * weight;
      }
    }
  }
}

function runOrdered(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  const { data: matrix, size } = orderedMatrix(options);
  const out = new Float32Array(3);
  const amount = clamp((+options.strength || 0) / 100, 0, 3) * quantiser.step;
  const shift = options.channelShift ? [0, 1, 2] : [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const p = pixel * 3;
      const base = matrix[(y % size) * size + (x % size)] - 0.5;
      const offsetR = base * amount;
      const offsetG = (options.channelShift ? matrix[((y + shift[1]) % size) * size + ((x + shift[1]) % size)] - 0.5 : base) * amount;
      const offsetB = (options.channelShift ? matrix[((y + shift[2]) % size) * size + ((x + shift[2]) % size)] - 0.5 : base) * amount;
      quantiser.q(buffer[p] + offsetR, buffer[p + 1] + offsetG, buffer[p + 2] + offsetB, out);
      buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
    }
  }
}

function runNoise(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  if (options.noise === 'green') {
    runErrorDiffusion(job, {
      kernel: 'floyd-steinberg', strength: options.strength, jitter: 0,
      serpentine: true, seed: options.seed, hysteresis: clamp(+options.hysteresis || 0, 0, 1)
    });
    return;
  }
  if (options.noise === 'blue') {
    runOrdered(job, {
      matrix: 'blue', maskSize: options.maskSize, sigma: options.sigma,
      seed: options.seed, strength: options.amplitude, channelShift: false
    });
    return;
  }
  const random = makeRandom(options.seed | 0);
  const amount = clamp((+options.amplitude || 0) / 100, 0, 3) * quantiser.step;
  const white = options.noise === 'white';
  const out = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const p = pixel * 3;
      const draw = () => (white ? clamp(gaussianFrom(random) / 3, -0.5, 0.5) : random() - 0.5) * amount;
      const nr = draw();
      const ng = options.monochrome ? nr : draw();
      const nb = options.monochrome ? nr : draw();
      quantiser.q(buffer[p] + nr, buffer[p + 1] + ng, buffer[p + 2] + nb, out);
      buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
    }
  }
}

/* Riemersma: error diffusion that walks a Hilbert curve, so the error is
 * shared with whichever pixels are genuinely nearby rather than with the
 * pixels that happen to be next in raster order. */
function hilbertPoint(order, distance) {
  let x = 0, y = 0, t = distance;
  for (let side = 1; side < 1 << order; side <<= 1) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = side - 1 - x; y = side - 1 - y; }
      const swap = x; x = y; y = swap;
    }
    x += side * rx; y += side * ry;
    t >>= 2;
  }
  return [x, y];
}

function runRiemersma(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  const size = clamp(options.queue | 0, 2, 64);
  const ratio = clamp(+options.ratio || 16, 1.01, 256);
  const weights = new Float32Array(size);
  let total = 0;
  for (let i = 0; i < size; i++) { weights[i] = Math.pow(ratio, i / (size - 1)); total += weights[i]; }
  for (let i = 0; i < size; i++) weights[i] /= total;

  const queue = new Float32Array(size * 3);
  let head = 0;
  const out = new Float32Array(3);
  const visit = (x, y) => {
    const pixel = y * width + x;
    if (!alpha[pixel * 4 + 3]) return;
    const p = pixel * 3;
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < size; i++) {
      /* index 0 is the oldest error in the queue, size-1 the newest */
      const slot = ((head + i) % size) * 3;
      ar += queue[slot] * weights[i];
      ag += queue[slot + 1] * weights[i];
      ab += queue[slot + 2] * weights[i];
    }
    const r = buffer[p] + ar, g = buffer[p + 1] + ag, b = buffer[p + 2] + ab;
    quantiser.q(r, g, b, out);
    buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
    const slot = head * 3;
    queue[slot] = r - out[0]; queue[slot + 1] = g - out[1]; queue[slot + 2] = b - out[2];
    head = (head + 1) % size;
  };

  if (options.curve === 'serpentine') {
    for (let y = 0; y < height; y++) {
      for (let step = 0; step < width; step++) visit((y & 1) ? width - 1 - step : step, y);
    }
    return;
  }
  const order = Math.max(1, Math.ceil(Math.log2(Math.max(width, height))));
  const length = 1 << (order * 2);
  for (let d = 0; d < length; d++) {
    const [x, y] = hilbertPoint(order, d);
    if (x < width && y < height) visit(x, y);
  }
}

/* --------------------------------------------------------- dot diffusion */

/* Knuth's class matrix, generated exactly as DOT-DIFF does: a 45° dot order
 * built from eight-fold symmetry rather than a table of 64 magic numbers. */
function knuthClassMatrix() {
  return cachedMatrix('class:knuth', () => {
    const classNumber = [];
    for (let i = 0; i < 10; i++) classNumber.push(new Int32Array(10).fill(-1));
    let next = 0;
    const store = (i, j) => {
      if (i < 1) i += 8; else if (i > 8) i -= 8;
      if (j < 1) j += 8; else if (j > 8) j -= 8;
      classNumber[i][j] = next++;
    };
    const storeEight = (i, j) => {
      store(i, j); store(i - 4, j + 4); store(1 - j, i - 4); store(5 - j, i);
      store(j, 5 - i); store(4 + j, 1 - i); store(5 - i, 5 - j); store(1 - i, 1 - j);
    };
    storeEight(7, 2); storeEight(8, 3); storeEight(8, 2); storeEight(8, 1);
    storeEight(1, 4); storeEight(1, 3); storeEight(1, 2); storeEight(2, 3);
    const matrix = new Int32Array(64);
    for (let i = 1; i <= 8; i++) for (let j = 1; j <= 8; j++) matrix[(i - 1) * 8 + (j - 1)] = classNumber[i][j];
    return matrix;
  });
}

/* Any threshold matrix doubles as a class matrix: its ranks are simply the
 * order the pixels get decided in. */
const ranksOf = (thresholds, size) => {
  const matrix = new Int32Array(size * size);
  for (let i = 0; i < size * size; i++) matrix[i] = Math.round(thresholds[i] * size * size - 0.5);
  return { matrix, size };
};

function classMatrixFor(name) {
  switch (name) {
    case 'clustered': return ranksOf(clusteredMatrix(8, 'round', 45), 8);
    case 'blue8': return ranksOf(voidAndClusterMatrix(8, 1.5, 1), 8);
    case 'blue16': return ranksOf(voidAndClusterMatrix(16, 1.5, 1), 16);
    default: return { matrix: knuthClassMatrix(), size: 8 };
  }
}

function compileDotDiffusion(name) {
  return cachedMatrix(`dot:${name}`, () => {
    const { matrix, size } = classMatrixFor(name);
    const count = size * size;
    const rowOf = new Int32Array(count), colOf = new Int32Array(count);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const klass = matrix[y * size + x];
      rowOf[klass] = y; colOf[klass] = x;
    }
    const instructions = [];
    for (let klass = 0; klass < count; klass++) {
      const y = rowOf[klass], x = colOf[klass];
      const list = [];
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = (y + dy + size) % size, nx = (x + dx + size) % size;
        if (matrix[ny * size + nx] > klass) {
          list.push({ dx, dy, alpha: dx && dy ? 1 : 2 });
          weight += dx && dy ? 1 : 2;
        }
      }
      for (const item of list) item.alpha /= weight;
      instructions.push(list);
    }
    return { size, rowOf, colOf, instructions };
  });
}

/* Knuth's pre-sharpening: a[i][j] ← (a - α·ā) / (1 - α) over the 3×3 mean. */
function sharpenBuffer(buffer, width, height, amount) {
  if (!amount) return;
  const source = buffer.slice();
  const at = (x, y, channel) => source[((clamp(y, 0, height - 1) * width) + clamp(x, 0, width - 1)) * 3 + channel];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      let mean = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mean += at(x + dx, y + dy, channel);
      mean /= 9;
      buffer[p + channel] = clamp((source[p + channel] - amount * mean) / (1 - amount), 0, 255);
    }
  }
}

function runDotDiffusion(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  sharpenBuffer(buffer, width, height, clamp(+options.sharpening || 0, 0, 0.95));
  const { size, rowOf, colOf, instructions } = compileDotDiffusion(options.classMatrix);
  const count = size * size;
  const zeta = quantiser.size === 2 && quantiser.mono ? clamp(+options.zeta || 0, -0.25, 1) : 0;
  const out = new Float32Array(3);

  /* Knuth's toner model only makes sense for a strict black-and-white result;
   * WHITE / GRAY / BLACK track how much ink a white pixel picks up from its
   * blackened neighbours. */
  const state = zeta ? new Uint8Array(width * height) : null;
  const stateAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : state[y * width + x]);

  for (let klass = 0; klass < count; klass++) {
    const instruction = instructions[klass];
    for (let y = rowOf[klass]; y < height; y += size) {
      for (let x = colOf[klass]; x < width; x += size) {
        const pixel = y * width + x;
        if (!alpha[pixel * 4 + 3]) continue;
        const p = pixel * 3;
        let errorR, errorG, errorB;
        if (state) {
          const darkness = 1 - buffer[p] / 255;
          let error = state[pixel] === 0 ? darkness - 1 - 4 * zeta : darkness - 1 + zeta;
          if (state[pixel] === 1) {
            if (stateAt(x, y - 1) === 0) error -= zeta;
            if (stateAt(x, y + 1) === 0) error -= zeta;
            if (stateAt(x - 1, y) === 0) error -= zeta;
            if (stateAt(x + 1, y) === 0) error -= zeta;
          }
          if (error + darkness > 0) {
            state[pixel] = 2;
            for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
              if (nx >= 0 && ny >= 0 && nx < width && ny < height && state[ny * width + nx] === 0) state[ny * width + nx] = 1;
            }
            buffer[p] = buffer[p + 1] = buffer[p + 2] = 0;
          } else {
            error = darkness;
            buffer[p] = buffer[p + 1] = buffer[p + 2] = 255;
          }
          errorR = errorG = errorB = -error * 255; /* back into luminance units */
        } else {
          const r = buffer[p], g = buffer[p + 1], b = buffer[p + 2];
          quantiser.q(r, g, b, out);
          buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
          errorR = r - out[0]; errorG = g - out[1]; errorB = b - out[2];
        }
        for (const { dx, dy, alpha: share } of instruction) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (!alpha[neighbour * 4 + 3]) continue;
          const q = neighbour * 3;
          buffer[q] += errorR * share;
          buffer[q + 1] += errorG * share;
          buffer[q + 2] += errorB * share;
        }
      }
    }
  }
  if (state) {
    for (let i = 0, p = 0; i < width * height; i++, p += 3) {
      const value = state[i] === 2 ? 0 : 255;
      buffer[p] = buffer[p + 1] = buffer[p + 2] = value;
    }
  }
}

/* -------------------------------------------------------- pattern dither */

/* Yliluoma's ordered pattern dithering: instead of picking one palette entry
 * per pixel, work out the mixture of n entries that averages to the wanted
 * colour, then let the threshold matrix choose which one this pixel shows. */
function runPattern(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  if (!quantiser.colours) { runOrdered(job, { matrix: 'bayer', bayerSize: options.patternSize, strength: 100 }); return; }
  const side = clamp(options.patternSize | 0, 2, 8);
  const slots = side * side;
  const thresholds = bayerMatrix(1 << Math.round(Math.log2(side)));
  const matrixSide = 1 << Math.round(Math.log2(side));
  const colours = quantiser.colours;
  const count = colours.length / 3;
  const mix = clamp(+options.mix || 1, 0, 2);
  const plans = new Map();
  const out = new Float32Array(3);

  const planFor = (r, g, b) => {
    const plan = new Int32Array(slots);
    let accR = 0, accG = 0, accB = 0;
    for (let i = 0; i < slots; i++) {
      const tr = r + accR * mix, tg = g + accG * mix, tb = b + accB * mix;
      let best = 0, bestDistance = Infinity;
      for (let c = 0; c < count; c++) {
        const dr = tr - colours[c * 3], dg = tg - colours[c * 3 + 1], db = tb - colours[c * 3 + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) { bestDistance = distance; best = c; }
      }
      plan[i] = best;
      accR += r - colours[best * 3];
      accG += g - colours[best * 3 + 1];
      accB += b - colours[best * 3 + 2];
    }
    const luma = index => colours[index * 3] * 0.299 + colours[index * 3 + 1] * 0.587 + colours[index * 3 + 2] * 0.114;
    return Int32Array.from([...plan].sort((a, b2) => luma(a) - luma(b2)));
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const p = pixel * 3;
      const r = clamp(buffer[p], 0, 255), g = clamp(buffer[p + 1], 0, 255), b = clamp(buffer[p + 2], 0, 255);
      /* Planning a mixture is the expensive part, so plans are memoised per
       * colour. 7 bits a channel is fine enough that the cache does not band
       * a smooth ramp; the cap keeps a photograph from filling memory. */
      const key = ((r * 127 / 255) | 0) << 14 | ((g * 127 / 255) | 0) << 7 | ((b * 127 / 255) | 0);
      let plan = plans.get(key);
      if (!plan) {
        if (plans.size > 300000) plans.clear();
        plan = planFor(((key >> 14) & 127) * 255 / 127, ((key >> 7) & 127) * 255 / 127, (key & 127) * 255 / 127);
        plans.set(key, plan);
      }
      const rank = thresholds[(y % matrixSide) * matrixSide + (x % matrixSide)];
      const index = plan[clamp(Math.floor(rank * slots), 0, slots - 1)];
      out[0] = colours[index * 3]; out[1] = colours[index * 3 + 1]; out[2] = colours[index * 3 + 2];
      buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
    }
  }
}

/* ------------------------------------------------------------- subpixel */

/* An LCD's pixel is three vertical stripes, so a 640-wide screen really has
 * 1920 addressable columns. Dither at that resolution and hand each stripe to
 * the matching colour channel. */
function runSubpixel(job, options) {
  const { width, height, buffer, alpha } = job;
  const columns = width * 3;
  const source = new Float32Array(columns * height);
  const bgr = options.layout === 'bgr';
  const wr = 0.299, wg = 0.587, wb = 0.114;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const r = buffer[p], g = buffer[p + 1], b = buffer[p + 2];
      const luma = r * wr + g * wg + b * wb;
      const stripes = options.source === 'rgb' ? [r, g, b] : [luma, luma, luma];
      if (bgr) stripes.reverse();
      for (let s = 0; s < 3; s++) source[y * columns + x * 3 + s] = stripes[s];
    }
  }

  const bits = new Float32Array(columns * height);
  const bayer = bayerMatrix(8);
  const random = makeRandom(options.seed | 0);
  const strength = clamp((+options.strength || 0) / 100, 0, 2);
  if (options.method === 'ordered') {
    for (let y = 0; y < height; y++) for (let x = 0; x < columns; x++) {
      const t = bayer[(y % 8) * 8 + (x % 8)] * 255;
      bits[y * columns + x] = source[y * columns + x] >= t ? 255 : 0;
    }
  } else if (options.method === 'threshold') {
    for (let i = 0; i < bits.length; i++) bits[i] = source[i] >= 128 ? 255 : 0;
  } else {
    const work = source.slice();
    for (let y = 0; y < height; y++) {
      const reverse = (y & 1) === 1;
      for (let step = 0; step < columns; step++) {
        const x = reverse ? columns - 1 - step : step;
        const index = y * columns + x;
        const value = work[index];
        const quantised = value >= 128 ? 255 : 0;
        bits[index] = quantised;
        const error = (value - quantised) * strength;
        for (const [dx, dy, weight] of FS_SPREAD) {
          const nx = x + (reverse ? -dx : dx), ny = y + dy;
          if (nx < 0 || nx >= columns || ny < 0 || ny >= height) continue;
          work[ny * columns + nx] += error * weight;
        }
      }
    }
  }

  /* Filtering across the stripes trades a little sharpness for much less
   * colour fringing — the same job ClearType's FIR filter does. */
  const taps = options.filter === 'strong' ? [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9]
    : options.filter === 'light' ? [1 / 3, 1 / 3, 1 / 3] : null;
  const filtered = taps ? new Float32Array(bits.length) : bits;
  if (taps) {
    const half = (taps.length - 1) / 2;
    for (let y = 0; y < height; y++) for (let x = 0; x < columns; x++) {
      let total = 0;
      for (let t = 0; t < taps.length; t++) total += bits[y * columns + clamp(x + t - half, 0, columns - 1)] * taps[t];
      filtered[y * columns + x] = total;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const stripes = [0, 1, 2].map(s => filtered[y * columns + x * 3 + s]);
      if (bgr) stripes.reverse();
      const p = pixel * 3;
      buffer[p] = stripes[0]; buffer[p + 1] = stripes[1]; buffer[p + 2] = stripes[2];
    }
  }
}

/* --------------------------------------------------- threshold / average */

function otsuThreshold(buffer, alpha, count) {
  const histogram = new Float64Array(256);
  let total = 0;
  for (let i = 0, p = 0; i < count; i++, p += 3) {
    if (!alpha[i * 4 + 3]) continue;
    histogram[clamp(Math.round(buffer[p]), 0, 255)]++; total++;
  }
  if (!total) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0, weightB = 0, best = 128, bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB, meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) { bestVariance = variance; best = t; }
  }
  return best;
}

function runThreshold(job, options) {
  const { width, height, buffer, alpha, quantiser } = job;
  const count = width * height;
  const out = new Float32Array(3);
  let level = clamp(+options.threshold || 0, 0, 255);

  if (options.method === 'mean') {
    let total = 0, seen = 0;
    for (let i = 0, p = 0; i < count; i++, p += 3) {
      if (!alpha[i * 4 + 3]) continue;
      total += buffer[p]; seen++;
    }
    level = seen ? total / seen : 128;
  } else if (options.method === 'otsu') {
    level = otsuThreshold(buffer, alpha, count);
  }

  if (options.method === 'adaptive') {
    /* Bradley's adaptive threshold over a running box mean */
    const window = clamp(options.window | 0, 3, 255);
    const half = window >> 1;
    const bias = clamp(+options.bias || 0, -50, 50) / 100;
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += buffer[(y * width + x) * 3];
        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }
    const boxMean = (x, y) => {
      const x0 = clamp(x - half, 0, width - 1), x1 = clamp(x + half, 0, width - 1);
      const y0 = clamp(y - half, 0, height - 1), y1 = clamp(y + half, 0, height - 1);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * (width + 1) + (x1 + 1)] - integral[y0 * (width + 1) + (x1 + 1)]
        - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      return sum / area;
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!alpha[pixel * 4 + 3]) continue;
      const p = pixel * 3;
      const local = boxMean(x, y) * (1 - bias);
      const value = buffer[p] >= local ? 255 : 0;
      buffer[p] = buffer[p + 1] = buffer[p + 2] = value;
    }
    return;
  }

  const shift = quantiser.mono ? 127.5 - level : 0;
  for (let i = 0, p = 0; i < count; i++, p += 3) {
    if (!alpha[i * 4 + 3]) continue;
    quantiser.q(buffer[p] + shift, buffer[p + 1] + shift, buffer[p + 2] + shift, out);
    buffer[p] = out[0]; buffer[p + 1] = out[1]; buffer[p + 2] = out[2];
  }
}

/* --------------------------------------------------------------- groups */

const PALETTE_OPTIONS = [
  ['mono', 'Black & white (1 bit)'],
  ['gray', 'Grey levels'],
  ['rgb', 'RGB levels per channel'],
  ['paint', 'ClackPaint 28-colour palette'],
  ['web', 'Web-safe (216 colours)'],
  ['fgbg', 'Foreground / background colours']
];

const sharedParams = () => ([
  { key: 'palette', type: 'select', label: 'Output colours', options: PALETTE_OPTIONS, default: 'mono' },
  { key: 'grayLevels', type: 'number', label: 'Grey levels', min: 2, max: 64, step: 1, default: 4, showIf: v => v.palette === 'gray' },
  { key: 'rgbLevels', type: 'number', label: 'Levels per channel', min: 2, max: 16, step: 1, default: 2, showIf: v => v.palette === 'rgb' },
  { key: 'linear', type: 'check', label: 'Work in linear light (gamma correct)', default: false }
]);

const GROUPS = {
  'error-diffusion': {
    label: 'Error Diffusion',
    hint: 'Each pixel is rounded to the nearest available colour and the rounding error is pushed onto the neighbours that have not been decided yet.',
    params: [
      { key: 'kernel', type: 'select', label: 'Kernel', default: 'floyd-steinberg', options: Object.entries(ED_KERNELS).map(([id, k]) => [id, k.label]) },
      { key: 'strength', type: 'range', label: 'Error strength', min: 0, max: 200, step: 1, default: 100, unit: '%' },
      { key: 'jitter', type: 'range', label: 'Coefficient jitter', min: 0, max: 100, step: 1, default: 0, unit: '%', showIf: v => v.kernel !== 'ostromoukhov' },
      { key: 'serpentine', type: 'check', label: 'Serpentine scan (alternate row direction)', default: true },
      { key: 'seed', type: 'number', label: 'Random seed', min: 1, max: 999999, step: 1, default: 1, showIf: v => +v.jitter > 0 && v.kernel !== 'ostromoukhov' }
    ],
    run: runErrorDiffusion
  },
  ordered: {
    label: 'Ordered / Halftone',
    hint: 'A repeating threshold matrix decides each pixel on its own. Bayer is the classic dispersed-dot screen, clustered-dot builds printer-style halftone cells, and void-and-cluster generates a blue-noise mask.',
    params: [
      {
        key: 'matrix', type: 'select', label: 'Matrix', default: 'bayer', options: [
          ['bayer', 'Bayer — ordered, dispersed dot'],
          ['clustered', 'Clustered dot — halftone screen'],
          ['blue', 'Void-and-cluster — blue-noise mask']
        ]
      },
      { key: 'bayerSize', type: 'select', label: 'Matrix size', default: '8', options: [['2', '2 × 2'], ['4', '4 × 4'], ['8', '8 × 8'], ['16', '16 × 16'], ['32', '32 × 32']], showIf: v => v.matrix === 'bayer' },
      { key: 'clusterSize', type: 'number', label: 'Cell size', min: 2, max: 32, step: 2, default: 8, showIf: v => v.matrix === 'clustered' },
      { key: 'spot', type: 'select', label: 'Dot shape', default: 'round', options: [['round', 'Round'], ['ellipse', 'Elliptical'], ['diamond', 'Diamond'], ['square', 'Square'], ['line', 'Line screen']], showIf: v => v.matrix === 'clustered' },
      { key: 'screenAngle', type: 'select', label: 'Screen angle', default: '45', options: [['0', '0°'], ['45', '45°']], showIf: v => v.matrix === 'clustered' },
      { key: 'maskSize', type: 'select', label: 'Mask size', default: '32', options: [['16', '16 × 16'], ['32', '32 × 32'], ['64', '64 × 64'], ['128', '128 × 128 (slow to build)']], showIf: v => v.matrix === 'blue' },
      { key: 'sigma', type: 'number', label: 'Filter sigma', min: 0.5, max: 4, step: 0.1, default: 1.5, showIf: v => v.matrix === 'blue' },
      { key: 'seed', type: 'number', label: 'Mask seed', min: 1, max: 999999, step: 1, default: 1, showIf: v => v.matrix === 'blue' },
      { key: 'strength', type: 'range', label: 'Pattern strength', min: 0, max: 300, step: 1, default: 100, unit: '%' },
      { key: 'channelShift', type: 'check', label: 'Offset the matrix per colour channel', default: false }
    ],
    run: runOrdered
  },
  noise: {
    label: 'Noise Dithering',
    hint: 'The threshold is shaken by a noise field. Uniform and white noise scatter pixels evenly, blue noise keeps them apart, and green noise pulls them into small clusters that survive printing.',
    params: [
      {
        key: 'noise', type: 'select', label: 'Noise', default: 'random', options: [
          ['random', 'Random — uniform threshold'],
          ['white', 'White noise — Gaussian'],
          ['blue', 'Blue noise — void-and-cluster mask'],
          ['green', 'Green noise — clustered feedback']
        ]
      },
      { key: 'amplitude', type: 'range', label: 'Noise amount', min: 0, max: 300, step: 1, default: 100, unit: '%', showIf: v => v.noise !== 'green' },
      { key: 'monochrome', type: 'check', label: 'Same noise for every channel', default: true, showIf: v => v.noise === 'random' || v.noise === 'white' },
      { key: 'maskSize', type: 'select', label: 'Mask size', default: '32', options: [['16', '16 × 16'], ['32', '32 × 32'], ['64', '64 × 64'], ['128', '128 × 128 (slow to build)']], showIf: v => v.noise === 'blue' },
      { key: 'sigma', type: 'number', label: 'Filter sigma', min: 0.5, max: 4, step: 0.1, default: 1.5, showIf: v => v.noise === 'blue' },
      { key: 'hysteresis', type: 'range', label: 'Cluster strength', min: 0, max: 95, step: 1, default: 40, unit: '%', showIf: v => v.noise === 'green', scale: 0.01 },
      { key: 'strength', type: 'range', label: 'Error strength', min: 0, max: 200, step: 1, default: 100, unit: '%', showIf: v => v.noise === 'green' },
      { key: 'seed', type: 'number', label: 'Random seed', min: 1, max: 999999, step: 1, default: 1 }
    ],
    run: runNoise
  },
  pattern: {
    label: 'Pattern Dithering',
    hint: 'Yliluoma-style: works out which mixture of palette colours averages to the wanted colour, then lets an ordered matrix pick which member of the mixture each pixel shows. Needs a colour palette, so grey and RGB level modes fall back to Bayer.',
    params: [
      { key: 'patternSize', type: 'select', label: 'Pattern size', default: '4', options: [['2', '2 × 2 (4 slots)'], ['4', '4 × 4 (16 slots)'], ['8', '8 × 8 (64 slots)']] },
      { key: 'mix', type: 'range', label: 'Mixing bias', min: 0, max: 200, step: 1, default: 100, unit: '%', scale: 0.01 }
    ],
    run: runPattern,
    defaults: { palette: 'paint' }
  },
  'dot-diffusion': {
    label: 'Dot Diffusion (Knuth)',
    hint: 'Knuth 1987: pixels are split into 64 classes and decided class by class, each one pushing its error only onto neighbours in later classes. The sharpening pre-filter is part of the published method.',
    params: [
      {
        key: 'classMatrix', type: 'select', label: 'Class matrix', default: 'knuth', options: [
          ['knuth', 'Knuth 8 × 8 (45° dot order)'],
          ['clustered', 'Clustered 8 × 8'],
          ['blue8', 'Blue noise 8 × 8'],
          ['blue16', 'Blue noise 16 × 16']
        ]
      },
      { key: 'sharpening', type: 'range', label: 'Sharpening', min: 0, max: 95, step: 1, default: 90, unit: '%', scale: 0.01 },
      { key: 'zeta', type: 'range', label: 'Ink spread (ζ)', min: -25, max: 100, step: 1, default: 0, unit: '%', scale: 0.01, showIf: v => v.palette === 'mono' }
    ],
    run: runDotDiffusion
  },
  riemersma: {
    label: 'Riemersma',
    hint: 'Error diffusion that follows a Hilbert curve instead of scan lines, so the error only ever travels to pixels that are genuinely close by. The result has no directional grain at all.',
    params: [
      { key: 'curve', type: 'select', label: 'Path', default: 'hilbert', options: [['hilbert', 'Hilbert curve'], ['serpentine', 'Serpentine scan']] },
      { key: 'queue', type: 'number', label: 'History length', min: 2, max: 64, step: 1, default: 16 },
      { key: 'ratio', type: 'number', label: 'Decay ratio', min: 1.1, max: 256, step: 0.1, default: 16 }
    ],
    run: runRiemersma
  },
  subpixel: {
    label: 'Subpixel (LCD)',
    hint: 'Treats every pixel as three vertical stripes, so the picture is dithered at three times the horizontal resolution. Looks right on an RGB-stripe LCD and colourful anywhere else.',
    params: [
      { key: 'layout', type: 'select', label: 'Stripe order', default: 'rgb', options: [['rgb', 'RGB'], ['bgr', 'BGR']] },
      { key: 'source', type: 'select', label: 'Stripe source', default: 'luma', options: [['luma', 'Luminance'], ['rgb', 'Matching colour channel']] },
      { key: 'method', type: 'select', label: 'Method', default: 'fs', options: [['fs', 'Floyd–Steinberg'], ['ordered', 'Bayer 8 × 8'], ['threshold', 'Plain threshold']] },
      { key: 'strength', type: 'range', label: 'Error strength', min: 0, max: 200, step: 1, default: 100, unit: '%', showIf: v => v.method === 'fs' },
      { key: 'filter', type: 'select', label: 'Fringe filter', default: 'light', options: [['none', 'None — hard stripes'], ['light', 'Light (1/3, 1/3, 1/3)'], ['strong', 'Strong (5 tap)']] },
      { key: 'seed', type: 'number', label: 'Random seed', min: 1, max: 999999, step: 1, default: 1 }
    ],
    run: runSubpixel,
    noPalette: true,
    forcePalette: { palette: 'rgb', rgbLevels: 2, linear: false }
  },
  threshold: {
    label: 'Threshold / Average',
    hint: 'No dithering at all — the honest baseline every other method is judged against. Fixed, mean and Otsu round each pixel to the chosen palette; the adaptive local mean always produces plain black and white.',
    params: [
      {
        key: 'method', type: 'select', label: 'Method', default: 'fixed', options: [
          ['fixed', 'Fixed threshold'],
          ['mean', 'Average (mean of the image)'],
          ['otsu', 'Otsu (automatic)'],
          ['adaptive', 'Adaptive local mean (Bradley)']
        ]
      },
      { key: 'threshold', type: 'range', label: 'Threshold', min: 0, max: 255, step: 1, default: 128, showIf: v => v.method === 'fixed' },
      { key: 'window', type: 'number', label: 'Window size', min: 3, max: 255, step: 2, default: 25, showIf: v => v.method === 'adaptive' },
      { key: 'bias', type: 'range', label: 'Bias', min: -50, max: 50, step: 1, default: 8, unit: '%', showIf: v => v.method === 'adaptive' }
    ],
    run: runThreshold
  }
};

/* --------------------------------------------------------- apply to pixels */

function applyDither(image, groupId, values, colours) {
  const group = GROUPS[groupId];
  const options = { ...values, ...(group.forcePalette || {}) };
  const quantiser = buildQuantiser(options, colours);
  const buffer = toWorking(image, options, quantiser);
  const job = {
    width: image.width, height: image.height, buffer,
    alpha: image.data, quantiser, image
  };
  group.run(job, options);
  fromWorking(buffer, image, options);
  return image;
}

/* ------------------------------------------------------------------- host */

let host = null;
let lastRun = null;

const OPTION_LABEL = (list, value) => {
  const found = list.find(([id]) => String(id) === String(value));
  return found ? found[1] : value;
};

function paramsFor(groupId) {
  const group = GROUPS[groupId];
  return group.noPalette ? group.params.slice() : [...group.params, ...sharedParams()];
}

function defaultsFor(groupId) {
  const values = {};
  for (const param of paramsFor(groupId)) values[param.key] = param.default;
  Object.assign(values, GROUPS[groupId].defaults || {});
  return values;
}

/* numbers arrive from the DOM as strings; give the algorithms real values */
function normalise(groupId, values) {
  const out = {};
  for (const param of paramsFor(groupId)) {
    let value = values[param.key];
    if (param.type === 'check') value = !!value;
    else if (param.type === 'number' || param.type === 'range') value = (+value || 0) * (param.scale || 1);
    out[param.key] = value;
  }
  return out;
}

/* ----------------------------------------------------------------- panel */

/* Dithering is judged by eye, so the controls deliberately are not a modal:
 * they sit beside the picture with the preview running live. Inside ClackOS
 * the panel becomes a real window on the desktop next to ClackPaint — the
 * same trick the Processing app uses for its sketch window — so nothing
 * covers the canvas at all. Standalone there is no desktop to put a window
 * on, so it floats over the edge of the page instead.
 *
 * All of its styling is defined here rather than in app.css, because the
 * desktop document does not load app.css; only the colour variables are
 * common to both documents. */
const PANEL_CSS = `
.dither-panel {
  font-family: 'IBM Plex Mono', monospace; font-size: 12.5px;
  color: var(--ink-soft, #14231a); display: flex; flex-direction: column; min-height: 0;
}
.dither-panel form { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow-y: auto; min-height: 0; }
.dither-panel p { font-size: 11.5px; color: var(--sage, #66755a); line-height: 1.6; margin: 0; }
.dither-note:empty { display: none; }
.dither-fields { display: flex; flex-direction: column; gap: 10px; }
.dither-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dither-row[hidden], .dither-check[hidden] { display: none; }
/* option text such as "Void-and-cluster — blue-noise mask" has no chance of
   fitting beside its label in a panel this narrow, so dropdowns stack */
.dither-row.stacked { flex-direction: column; align-items: stretch; gap: 4px; }
.dither-row.stacked .dither-control { justify-content: stretch; }
.dither-row.stacked select { flex: 1; }
.dither-check { display: flex; align-items: center; gap: 8px; line-height: 1.4; }
.dither-label { flex: none; }
.dither-control { display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex: 1; min-width: 0; }
.dither-panel select, .dither-panel input[type="number"] {
  font: inherit; font-size: 11.5px; color: var(--control-text, #14231a);
  background: var(--paper, #f8f2dd); border: 1px solid var(--ink, #09140d);
  border-radius: 6px; padding: 5px 8px;
}
.dither-panel select { max-width: 100%; min-width: 0; }
.dither-panel input[type="number"] { width: 90px; }
.dither-panel input[type="range"] { flex: 1; max-width: 160px; min-width: 80px; accent-color: var(--leaf-deep, #276b47); }
.dither-panel input[type="checkbox"] { accent-color: var(--leaf-deep, #276b47); flex: none; }
.dither-panel :focus-visible { outline: 2px solid var(--leaf, #4fae7d); outline-offset: 1px; }
.dither-readout { flex: none; min-width: 42px; text-align: right; font-size: 11px; color: var(--sage, #66755a); font-variant-numeric: tabular-nums; }
.dither-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 2px; }
.dither-btn {
  all: unset; cursor: pointer; box-sizing: border-box; font: inherit; font-size: 12px;
  padding: 7px 14px; border-radius: 6px; border: 1px solid var(--ink, #09140d);
  color: var(--control-text, #14231a); background: var(--paper, #f8f2dd);
}
.dither-btn:hover { background: var(--paper-deep, #f3ecd1); }
.dither-btn.primary { background: var(--ink, #09140d); color: var(--button-text, #f2ecd6); }
.dither-btn.primary:hover { background: var(--leaf-deep, #276b47); border-color: var(--leaf-deep, #276b47); }
.dither-btn:focus-visible { outline: 2px solid var(--leaf, #4fae7d); outline-offset: 2px; }

/* window chrome, only used when there is no desktop to host a real window */
.dither-float {
  position: fixed; z-index: 60; right: 18px; top: 64px;
  width: 392px; max-width: calc(100vw - 24px);
  display: flex; flex-direction: column; max-height: calc(100vh - 90px);
  background: var(--paper, #f8f2dd); border: 2px solid var(--ink, #09140d); border-radius: 10px;
  box-shadow: 8px 8px 0 color-mix(in srgb, var(--ink, #09140d) 22%, transparent);
}
.dither-float > .dither-titlebar {
  flex: none; display: flex; align-items: center; gap: 8px; cursor: grab; touch-action: none;
  user-select: none; padding: 8px 12px; border-radius: 7px 7px 0 0;
  background: var(--ink, #09140d); color: var(--menu-text, #f5efdb);
}
.dither-float > .dither-titlebar:active { cursor: grabbing; }
.dither-titlebar .dither-dot {
  all: unset; width: 11px; height: 11px; border-radius: 50%; cursor: pointer; flex: none;
  box-sizing: border-box; background: var(--leaf, #4fae7d); border: 1.5px solid var(--leaf, #4fae7d);
}
.dither-titlebar .dither-dot:hover { background: var(--accent-hover, #6fcf9a); border-color: var(--accent-hover, #6fcf9a); }
.dither-titlebar .dither-name {
  margin: 0 auto; transform: translateX(-10px); font-size: 12.5px;
  color: var(--title-text, #c8e3d2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* narrow pages have no room beside the picture, so dock along the bottom
   and leave the canvas visible above */
@media (max-width: 760px) {
  .dither-float { left: 10px; right: 10px; width: auto; top: auto; bottom: 10px; max-height: 54vh; }
}

/* when it is a desktop window the desktop styles the chrome; only the body
   padding and sizing need saying */
.dither-window { width: 392px; }
.dither-window > .winbody { padding: 0; display: flex; flex-direction: column; }
`;

const dialog = {};

function parentDesktop() {
  try {
    const mountHost = host?.getMountHost?.();
    if (mountHost?.ownerDocument.getElementById('desktop')) return mountHost.ownerDocument;
    if (window.parent !== window) {
      const doc = window.parent.document;
      if (doc.getElementById('desktop')) return doc;
    }
  } catch { /* a cross-origin parent is simply not a desktop we can use */ }
  return null;
}

function ensurePanelStyle(doc) {
  if (doc.getElementById('clack-dither-style')) return;
  const style = doc.createElement('style');
  style.id = 'clack-dither-style';
  style.textContent = PANEL_CSS;
  doc.head.appendChild(style);
}

function panelBody(doc) {
  const panel = doc.createElement('div');
  panel.className = 'dither-panel';
  const form = doc.createElement('form');
  form.innerHTML = `
    <p class="dither-hint"></p>
    <div class="dither-fields"></div>
    <label class="dither-check"><input type="checkbox" class="dither-preview" checked><span>Live preview</span></label>
    <p class="dither-note"></p>
    <div class="dither-actions">
      <button type="button" class="dither-btn" data-dither-cancel>Cancel</button>
      <button type="submit" class="dither-btn primary">Apply</button>
    </div>`;
  panel.appendChild(form);

  dialog.form = form;
  dialog.hint = form.querySelector('.dither-hint');
  dialog.note = form.querySelector('.dither-note');
  dialog.fields = form.querySelector('.dither-fields');
  dialog.preview = form.querySelector('.dither-preview');

  form.addEventListener('submit', event => { event.preventDefault(); applyAndClose(); });
  form.addEventListener('click', event => { if (event.target.closest('[data-dither-cancel]')) closePanel(true); });
  form.addEventListener('input', event => {
    if (event.target === dialog.preview) { if (dialog.preview.checked) schedulePreview(); else restoreOriginal(); return; }
    refreshVisibility();
    schedulePreview();
  });
  form.addEventListener('change', () => { refreshVisibility(); schedulePreview(); });
  return panel;
}

/* Drag by the title bar. Inside the desktop the body gets .win-drag, which is
 * what stops the iframes swallowing the pointer mid-drag. */
function makeDraggable(doc, win, handle, bounds) {
  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    event.preventDefault();
    const rect = win.getBoundingClientRect();
    /* pin the size before switching off the right/bottom anchors, or a panel
     * docked with left+right would collapse the moment it starts moving */
    win.style.width = rect.width + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    win.style.left = win.offsetLeft + 'px';
    win.style.top = win.offsetTop + 'px';
    const grabX = event.clientX - rect.left, grabY = event.clientY - rect.top;
    const startLeft = win.offsetLeft - rect.left, startTop = win.offsetTop - rect.top;
    const view = doc.defaultView;
    doc.body.classList.add('win-drag');
    const move = moved => {
      win.style.left = clamp(moved.clientX - grabX + startLeft, -rect.width + 70, bounds().width - 70) + 'px';
      win.style.top = clamp(moved.clientY - grabY + startTop, 0, bounds().height - 34) + 'px';
    };
    const up = () => {
      doc.body.classList.remove('win-drag');
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
  });
}

function buildPanel(title) {
  const desktop = parentDesktop();
  const doc = desktop || document;
  ensurePanelStyle(doc);
  dialog.doc = doc;
  dialog.onDesktop = !!desktop;

  const body = panelBody(doc);
  let win;
  if (desktop) {
    const surface = desktop.getElementById('desktop');
    win = doc.createElement('section');
    win.className = 'window fixed dither-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', title);
    win.innerHTML = `
      <div class="titlebar"><button class="dot close" aria-label="Close"></button><span class="title"><span class="title-label"></span></span></div>
      <div class="winbody"></div>
      <div class="frame" aria-hidden="true"></div>`;
    win.querySelector('.title-label').textContent = title;
    win.querySelector('.winbody').appendChild(body);
    surface.appendChild(win);

    /* sit above every other window, and beside ClackPaint if there is room */
    const raise = () => {
      let top = 10;
      doc.querySelectorAll('.window').forEach(other => {
        top = Math.max(top, parseInt(other.style.zIndex || 0, 10));
        if (other !== win) other.classList.add('inactive');
      });
      win.style.zIndex = top + 1;
      win.classList.remove('inactive');
    };
    /* whichever side of ClackPaint has room for the panel wins; if neither
     * does it goes to the right edge and the user can drag it about */
    const paintWindow = host?.getMountHost?.()?.closest('.window') ||
      (window.frameElement && window.frameElement.closest('.window'));
    const rect = (paintWindow || window.frameElement || surface).getBoundingClientRect();
    const width = win.offsetWidth || 392;
    const roomRight = surface.clientWidth - rect.right, roomLeft = rect.left;
    let left = surface.clientWidth - width - 12;
    if (roomRight >= width + 24) left = rect.right + 18;
    else if (roomLeft >= width + 24) left = rect.left - width - 18;
    win.style.left = Math.max(12, left) + 'px';
    win.style.top = Math.max(12, Math.min(rect.top, surface.clientHeight - 200)) + 'px';
    raise();
    win.addEventListener('pointerdown', raise);
    win.querySelector('.dot.close').addEventListener('click', event => { event.stopPropagation(); closePanel(true); });
    makeDraggable(doc, win, win.querySelector('.titlebar'), () => ({ width: surface.clientWidth, height: surface.clientHeight }));
  } else {
    win = doc.createElement('div');
    win.className = 'dither-float';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', title);
    win.innerHTML = `
      <div class="dither-titlebar"><button type="button" class="dither-dot" aria-label="Close"></button><span class="dither-name"></span></div>`;
    win.querySelector('.dither-name').textContent = title;
    win.appendChild(body);
    /* the resting position stays in the stylesheet so the narrow-screen rule
     * that docks the panel along the bottom can still win */
    doc.body.appendChild(win);
    win.querySelector('.dither-dot').addEventListener('click', () => closePanel(true));
    makeDraggable(doc, win, win.querySelector('.dither-titlebar'), () => ({ width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight }));
  }

  dialog.win = win;
  dialog.escape = event => { if (event.key === 'Escape') closePanel(true); };
  doc.addEventListener('keydown', dialog.escape);
  if (doc !== document) document.addEventListener('keydown', dialog.escape);
  return win;
}

function destroyPanel() {
  if (!dialog.win) return;
  dialog.doc.removeEventListener('keydown', dialog.escape);
  document.removeEventListener('keydown', dialog.escape);
  dialog.win.remove();
  dialog.win = null;
  dialog.form = null;
}

/* the panel must not outlive the ClackPaint window it belongs to */
window.addEventListener('pagehide', () => { if (dialog.win) closePanel(true); });

function fieldFor(doc, param) {
  const row = doc.createElement('label');
  row.className = param.type === 'check' ? 'dither-check'
    : param.type === 'select' ? 'dither-row stacked' : 'dither-row';
  row.dataset.key = param.key;
  if (param.type === 'check') {
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.name = param.key;
    const caption = doc.createElement('span');
    caption.textContent = param.label;
    row.append(input, caption);
    return row;
  }
  const caption = doc.createElement('span');
  caption.className = 'dither-label';
  caption.textContent = param.label;
  const holder = doc.createElement('span');
  holder.className = 'dither-control';
  let input;
  if (param.type === 'select') {
    input = doc.createElement('select');
    for (const [value, text] of param.options) {
      const option = doc.createElement('option');
      option.value = value; option.textContent = text;
      input.appendChild(option);
    }
  } else {
    input = doc.createElement('input');
    input.type = param.type === 'range' ? 'range' : 'number';
    input.min = param.min; input.max = param.max; input.step = param.step;
  }
  input.name = param.key;
  holder.appendChild(input);
  if (param.type === 'range') {
    const readout = doc.createElement('output');
    readout.className = 'dither-readout';
    holder.appendChild(readout);
    input.addEventListener('input', () => { readout.textContent = input.value + (param.unit || ''); });
  } else if (param.unit) {
    holder.appendChild(doc.createTextNode(' ' + param.unit));
  }
  row.append(caption, holder);
  return row;
}

function currentValues() {
  const values = {};
  for (const param of dialog.params) {
    const input = dialog.form.elements[param.key];
    if (!input) continue;
    values[param.key] = param.type === 'check' ? input.checked : input.value;
  }
  return values;
}

function refreshVisibility() {
  const values = currentValues();
  for (const param of dialog.params) {
    const row = dialog.fields.querySelector(`[data-key="${param.key}"]`);
    if (row) row.hidden = param.showIf ? !param.showIf(values) : false;
  }
  for (const param of dialog.params) {
    if (param.type !== 'range') continue;
    const input = dialog.form.elements[param.key];
    const readout = input && input.parentElement.querySelector('.dither-readout');
    if (readout) readout.textContent = input.value + (param.unit || '');
  }
}

/* -------------------------------------------------------- preview / apply */

const PREVIEW_PIXEL_LIMIT = 4e6;
let previewTimer = 0;
let original = null;
let region = null;

function targetRegion() {
  const selection = host.getSelection && host.getSelection();
  if (!selection || selection.w < 1 || selection.h < 1) return { x: 0, y: 0, w: host.width(), h: host.height() };
  return { x: selection.x, y: selection.y, w: selection.w, h: selection.h };
}

function restoreOriginal() {
  if (original) host.getContext().putImageData(original, 0, 0);
}

function computeInto(canvasWrite) {
  const context = host.getContext();
  const values = normalise(dialog.groupId, currentValues());
  const slice = new ImageData(
    new Uint8ClampedArray(sliceOf(original, region).data),
    region.w, region.h
  );
  applyDither(slice, dialog.groupId, values, host.getColours());
  if (canvasWrite) {
    restoreOriginal();
    context.putImageData(slice, region.x, region.y);
  }
  return { values, slice };
}

function sliceOf(image, rect) {
  if (rect.x === 0 && rect.y === 0 && rect.w === image.width && rect.h === image.height) return image;
  const out = new ImageData(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    const from = ((y + rect.y) * image.width + rect.x) * 4;
    out.data.set(image.data.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return out;
}

function schedulePreview() {
  if (!dialog.preview.checked || !original) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    try { computeInto(true); } catch (error) { dialog.note.textContent = 'Preview failed: ' + error.message; }
  }, 90);
}

function applyAndClose() {
  const label = GROUPS[dialog.groupId].label;
  try {
    restoreOriginal();
    host.pushUndo();
    const { values } = computeInto(true);
    lastRun = { groupId: dialog.groupId, values: currentValues() };
    closePanel(false);
    const detail = describe(dialog.groupId, values);
    host.setStatus(`${label} dither applied${detail ? ' — ' + detail : ''}${region.w !== host.width() || region.h !== host.height() ? ' (selection only)' : ''}`);
  } catch (error) {
    restoreOriginal();
    closePanel(false);
    host.setStatus(`Dithering failed: ${error.message}`);
  }
}

function describe(groupId, values) {
  const group = GROUPS[groupId];
  const key = group.params[0];
  if (!key || key.type !== 'select') return '';
  return OPTION_LABEL(key.options, values[key.key]);
}

function closePanel(restore) {
  clearTimeout(previewTimer);
  if (restore) restoreOriginal();
  destroyPanel();
  original = null;
  if (host.setBusy) host.setBusy(false);
}

function openPanel(groupId) {
  const group = GROUPS[groupId];
  if (!group) return;
  if (dialog.win) closePanel(true);
  buildPanel(group.label + ' dither');
  dialog.groupId = groupId;
  dialog.params = paramsFor(groupId);
  dialog.hint.textContent = group.hint;
  dialog.fields.textContent = '';
  for (const param of dialog.params) dialog.fields.appendChild(fieldFor(dialog.doc, param));

  const values = lastRun && lastRun.groupId === groupId ? { ...defaultsFor(groupId), ...lastRun.values } : defaultsFor(groupId);
  for (const param of dialog.params) {
    const input = dialog.form.elements[param.key];
    if (!input) continue;
    if (param.type === 'check') input.checked = !!values[param.key];
    else input.value = values[param.key];
  }
  refreshVisibility();

  original = host.getContext().getImageData(0, 0, host.width(), host.height());
  region = targetRegion();
  const wholeImage = region.w === host.width() && region.h === host.height();
  const tooBig = region.w * region.h > PREVIEW_PIXEL_LIMIT;
  dialog.preview.disabled = tooBig;
  if (tooBig) dialog.preview.checked = false;
  dialog.note.textContent = tooBig
    ? 'Preview is off above 4 megapixels — press Apply to see the result.'
    : wholeImage ? '' : `Applying to the ${region.w} × ${region.h} px selection only.`;

  /* the preview keeps rewriting the canvas, so a brush stroke made now would
   * vanish at the next keystroke — painting waits until the panel is shut */
  if (host.setBusy) host.setBusy(true);
  const first = dialog.fields.querySelector('select, input');
  if (first) first.focus();
  schedulePreview();
}

function repeatLast() {
  if (!lastRun) { host.setStatus('No dither has been applied yet'); return; }
  const context = host.getContext();
  const rect = targetRegion();
  host.pushUndo();
  const full = context.getImageData(0, 0, host.width(), host.height());
  const slice = sliceOf(full, rect);
  const values = normalise(lastRun.groupId, lastRun.values);
  try {
    applyDither(slice, lastRun.groupId, values, host.getColours());
    context.putImageData(slice, rect.x, rect.y);
    host.setStatus(`${GROUPS[lastRun.groupId].label} dither repeated`);
  } catch (error) {
    host.setStatus(`Dithering failed: ${error.message}`);
  }
}

window.ClackDither = {
  GROUPS,
  init(api) { host = api; },
  open(groupId) { if (host) openPanel(groupId); },
  repeat() { if (host) repeatLast(); },
  destroy() {
    if (dialog.win) closePanel(true);
    host = null;
  }
};
})();
