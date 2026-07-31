/* ClackPaint content-aware resize worker. It applies each seam found in the
 * visible composite to every document layer, keeping the layer stack intact. */

function energyMap(rgba, width, height, protect) {
  const energy = new Float32Array(width * height);
  const difference = (a, b) => {
    const ai = a * 4, bi = b * 4;
    return Math.abs(rgba[ai] - rgba[bi]) + Math.abs(rgba[ai + 1] - rgba[bi + 1]) +
      Math.abs(rgba[ai + 2] - rgba[bi + 2]) + Math.abs(rgba[ai + 3] - rgba[bi + 3]) * 2;
  };
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1), down = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1), i = y * width + x;
      let value = difference(y * width + left, y * width + right) +
        difference(up * width + x, down * width + x);
      if (rgba[i * 4 + 3] < 8) value -= 1200; // consume transparent margins first
      if (protect?.[i]) value += 1000000;
      energy[i] = value;
    }
  }
  return energy;
}

function lowestVerticalSeam(rgba, width, height, protect) {
  const energy = energyMap(rgba, width, height, protect);
  const cost = new Float32Array(width * height);
  const previous = new Int8Array(width * height);
  cost.set(energy.subarray(0, width));
  for (let y = 1; y < height; y++) {
    const row = y * width, prior = row - width;
    for (let x = 0; x < width; x++) {
      let bestX = x, best = cost[prior + x];
      if (x && cost[prior + x - 1] < best) { best = cost[prior + x - 1]; bestX = x - 1; }
      if (x + 1 < width && cost[prior + x + 1] < best) { best = cost[prior + x + 1]; bestX = x + 1; }
      cost[row + x] = energy[row + x] + best;
      previous[row + x] = bestX - x;
    }
  }
  let x = 0, best = cost[(height - 1) * width];
  for (let candidate = 1; candidate < width; candidate++) {
    const value = cost[(height - 1) * width + candidate];
    if (value < best) { best = value; x = candidate; }
  }
  const seam = new Int32Array(height);
  for (let y = height - 1; y >= 0; y--) {
    seam[y] = x;
    if (y) x += previous[y * width + x];
  }
  return seam;
}

function removeRgbaSeam(source, width, height, seam) {
  const target = new Uint8ClampedArray((width - 1) * height * 4);
  for (let y = 0; y < height; y++) {
    const cut = seam[y], sourceRow = y * width * 4, targetRow = y * (width - 1) * 4;
    target.set(source.subarray(sourceRow, sourceRow + cut * 4), targetRow);
    target.set(source.subarray(sourceRow + (cut + 1) * 4, sourceRow + width * 4), targetRow + cut * 4);
  }
  return target;
}

function insertRgbaSeam(source, width, height, seam) {
  const target = new Uint8ClampedArray((width + 1) * height * 4);
  for (let y = 0; y < height; y++) {
    const cut = seam[y], sourceRow = y * width * 4, targetRow = y * (width + 1) * 4;
    const through = (cut + 1) * 4;
    target.set(source.subarray(sourceRow, sourceRow + through), targetRow);
    const left = sourceRow + cut * 4, right = sourceRow + Math.min(width - 1, cut + 1) * 4;
    for (let channel = 0; channel < 4; channel++) target[targetRow + through + channel] = Math.round((source[left + channel] + source[right + channel]) / 2);
    target.set(source.subarray(sourceRow + through, sourceRow + width * 4), targetRow + through + 4);
  }
  return target;
}

function removeMaskSeam(source, width, height, seam) {
  if (!source) return null;
  const target = new Uint8Array((width - 1) * height);
  for (let y = 0; y < height; y++) {
    const cut = seam[y], sourceRow = y * width, targetRow = y * (width - 1);
    target.set(source.subarray(sourceRow, sourceRow + cut), targetRow);
    target.set(source.subarray(sourceRow + cut + 1, sourceRow + width), targetRow + cut);
  }
  return target;
}

function insertMaskSeam(source, width, height, seam) {
  if (!source) return null;
  const target = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const cut = seam[y], sourceRow = y * width, targetRow = y * (width + 1);
    target.set(source.subarray(sourceRow, sourceRow + cut + 1), targetRow);
    target[targetRow + cut + 1] = source[sourceRow + cut];
    target.set(source.subarray(sourceRow + cut + 1, sourceRow + width), targetRow + cut + 2);
  }
  return target;
}

function transposeRgba(source, width, height) {
  const target = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = (x * height + y) * 4;
    target[to] = source[from]; target[to + 1] = source[from + 1]; target[to + 2] = source[from + 2]; target[to + 3] = source[from + 3];
  }
  return target;
}

function transposeMask(source, width, height) {
  if (!source) return null;
  const target = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[x * height + y] = source[y * width + x];
  return target;
}

async function changeWidth(state, targetWidth, progress) {
  while (state.width !== targetWidth) {
    const shrinking = targetWidth < state.width;
    if (shrinking && state.width <= 1) break;
    const seam = lowestVerticalSeam(state.composite, state.width, state.height, state.protect);
    const transformRgba = shrinking ? removeRgbaSeam : insertRgbaSeam;
    const transformMask = shrinking ? removeMaskSeam : insertMaskSeam;
    state.composite = transformRgba(state.composite, state.width, state.height, seam);
    state.layers = state.layers.map(layer => transformRgba(layer, state.width, state.height, seam));
    state.protect = transformMask(state.protect, state.width, state.height, seam);
    state.width += shrinking ? -1 : 1;
    progress();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function run(message) {
  const token = message.token;
  try {
    const state = {
      width: message.width, height: message.height,
      composite: new Uint8ClampedArray(message.composite),
      layers: message.layers.map(buffer => new Uint8ClampedArray(buffer)),
      protect: message.protect ? new Uint8Array(message.protect) : null,
    };
    const total = Math.abs(message.targetWidth - state.width) + Math.abs(message.targetHeight - state.height);
    let complete = 0;
    const progress = () => postMessage({ type: 'progress', token, complete: ++complete, total, width: state.width, height: state.height });
    await changeWidth(state, message.targetWidth, progress);
    if (state.height !== message.targetHeight) {
      state.composite = transposeRgba(state.composite, state.width, state.height);
      state.layers = state.layers.map(layer => transposeRgba(layer, state.width, state.height));
      state.protect = transposeMask(state.protect, state.width, state.height);
      [state.width, state.height] = [state.height, state.width];
      await changeWidth(state, message.targetHeight, progress);
      state.composite = transposeRgba(state.composite, state.width, state.height);
      state.layers = state.layers.map(layer => transposeRgba(layer, state.width, state.height));
      state.protect = transposeMask(state.protect, state.width, state.height);
      [state.width, state.height] = [state.height, state.width];
    }
    const buffers = state.layers.map(layer => layer.buffer);
    postMessage({ type: 'result', token, width: state.width, height: state.height, layers: buffers }, buffers);
  } catch (error) {
    postMessage({ type: 'error', token, message: String(error?.message || error) });
  }
}

self.onmessage = event => { if (event.data?.type === 'run') run(event.data); };
