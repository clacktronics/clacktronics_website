/* ClackPaint classic matting — background removal without a neural network.
 *
 * Every routine here answers the same question the AI models answer, in the
 * same currency: one coverage byte per pixel, 0 for background and 255 for
 * subject. That is deliberate. The dialog shapes whatever comes back — cutoff,
 * softness, grow, feather, tidy up — so an algorithm from 1990 and a model from
 * last year arrive at the same set of sliders and the same preview.
 *
 * These cost nothing to fetch and run in milliseconds, which makes them the
 * right first thing to try. A green screen, a product on white, a photograph
 * with the camera locked off between two frames: none of that needs a network,
 * and a network is often worse at it, because the answer is already in the
 * pixels and there is nothing to guess. The models are for the pictures where
 * the answer really is a judgement — a person against a room.
 *
 * Loaded only by paint-worker.js, so the arithmetic never runs on the UI
 * thread even when it finishes in a blink. */

/* Rec. 601 luma, and the two colour-difference channels around it. Chroma
   keying works in Cb/Cr precisely because they drop brightness on the floor:
   a green screen stays the same green in shadow, where its RGB does not. */
const luma = (r, g, b) => .299 * r + .587 * g + .114 * b;
const chromaOf = (r, g, b) => {
  const y = luma(r, g, b);
  return [(b - y) * .564, (r - y) * .713];
};

const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value;

/* the matte the rest of the pipeline expects: coverage, one byte per pixel */
const toMatte = coverage => {
  const out = new Uint8ClampedArray(coverage.length);
  for (let i = 0; i < coverage.length; i++) out[i] = Math.round(clamp01(coverage[i]) * 255);
  return out;
};

/* Pixels the picture is unlikely to argue about: the four corners, averaged.
   Used when nobody has said what the background colour is. A transparent
   corner is skipped — an empty corner says nothing about the backdrop. */
export function sampleCorners(data, w, h, inset = 4) {
  const spots = [[inset, inset], [w - 1 - inset, inset], [inset, h - 1 - inset], [w - 1 - inset, h - 1 - inset]];
  let r = 0, g = 0, b = 0, counted = 0;
  for (const [x, y] of spots) {
    const at = ((Math.max(0, Math.min(h - 1, y)) * w) + Math.max(0, Math.min(w - 1, x))) * 4;
    if (data[at + 3] < 8) continue;
    r += data[at]; g += data[at + 1]; b += data[at + 2]; counted++;
  }
  if (!counted) return [255, 255, 255];
  return [Math.round(r / counted), Math.round(g / counted), Math.round(b / counted)];
}

/* ---- chroma key ----
 * Distance from the key colour in Cb/Cr alone. Tolerance is how far a pixel may
 * drift from the key before it counts as subject at all; beyond twice that it
 * is subject outright, and the ramp between is what saves the half-transparent
 * edge of a sleeve. Brightness is ignored throughout, which is the whole point:
 * the shadow a person casts on the screen behind them is still the screen. */
function chromaKey(data, w, h, params) {
  const [kr, kg, kb] = params.key || [0, 255, 0];
  const [keyCb, keyCr] = chromaOf(kr, kg, kb);
  const reach = Math.max(2, (params.tolerance ?? 35) / 100 * 90);
  const coverage = new Float32Array(w * h);
  for (let i = 0, at = 0; i < coverage.length; i++, at += 4) {
    const [cb, cr] = chromaOf(data[at], data[at + 1], data[at + 2]);
    const distance = Math.hypot(cb - keyCb, cr - keyCr);
    coverage[i] = clamp01((distance - reach) / reach + .5);
  }
  return toMatte(coverage);
}

/* ---- colour range ----
 * The same idea with brightness left in, which is what you want when the
 * background is a plain white sweep or a flat studio grey rather than a screen
 * chosen for its hue. Anywhere in the picture, contiguous or not. */
function colourRange(data, w, h, params) {
  const [kr, kg, kb] = params.key || [255, 255, 255];
  const reach = Math.max(4, (params.tolerance ?? 25) / 100 * 260);
  const coverage = new Float32Array(w * h);
  for (let i = 0, at = 0; i < coverage.length; i++, at += 4) {
    const distance = Math.hypot(data[at] - kr, data[at + 1] - kg, data[at + 2] - kb);
    coverage[i] = clamp01(distance / reach);
  }
  return toMatte(coverage);
}

/* ---- flood from the borders ----
 * A magic wand run from all four edges at once. What makes it worth having
 * beside the colour range is connectedness: the sky behind the subject goes,
 * and the identical blue of their shirt stays, because the shirt is not joined
 * to the edge of the frame. Transparent pixels are treated as background
 * outright — a picture already cut out once should not have to be cut twice.
 *
 * Tolerance is measured against the average border colour rather than against
 * each pixel's neighbour: a neighbour-to-neighbour rule creeps along a gradient
 * until it has swallowed the subject, and there is no tolerance low enough to
 * stop it doing that on a photograph of a sky. */
function borderFlood(data, w, h, params) {
  const reach = Math.max(4, (params.tolerance ?? 20) / 100 * 260);
  let r = 0, g = 0, b = 0, counted = 0;
  const edgePixel = i => {
    const x = i % w, y = (i - x) / w;
    return x === 0 || y === 0 || x === w - 1 || y === h - 1;
  };
  for (let i = 0; i < w * h; i++) {
    if (!edgePixel(i)) continue;
    const at = i * 4;
    if (data[at + 3] < 8) continue;
    r += data[at]; g += data[at + 1]; b += data[at + 2]; counted++;
  }
  if (counted) { r /= counted; g /= counted; b /= counted; }
  const background = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const consider = i => {
    if (background[i]) return;
    const at = i * 4;
    const near = data[at + 3] < 8 ||
      Math.hypot(data[at] - r, data[at + 1] - g, data[at + 2] - b) <= reach;
    if (!near) return;
    background[i] = 1; stack[top++] = i;
  };
  for (let x = 0; x < w; x++) { consider(x); consider((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { consider(y * w); consider(y * w + w - 1); }
  while (top) {
    const at = stack[--top];
    const x = at % w, y = (at - x) / w;
    if (x > 0) consider(at - 1);
    if (x < w - 1) consider(at + 1);
    if (y > 0) consider(at - w);
    if (y < h - 1) consider(at + w);
  }
  const coverage = new Float32Array(w * h);
  for (let i = 0; i < coverage.length; i++) coverage[i] = background[i] ? 0 : 1;
  return toMatte(coverage);
}

/* ---- brightness ----
 * The oldest trick there is, and still the right one for a scan, a line
 * drawing, or anything shot on a light table. The matte is simply how far each
 * pixel is from the background's brightness, so the cutoff slider becomes the
 * threshold and the softness slider the anti-aliasing. */
function brightness(data, w, h, params) {
  const dark = params.background === 'dark';
  const coverage = new Float32Array(w * h);
  for (let i = 0, at = 0; i < coverage.length; i++, at += 4) {
    const value = luma(data[at], data[at + 1], data[at + 2]) / 255;
    coverage[i] = dark ? value : 1 - value;
  }
  return toMatte(coverage);
}

/* ---- difference matting ----
 * Two frames from a locked-off camera: one with the subject, one without.
 * Whatever changed is the subject. This is how visual effects cut people out
 * before anyone had a green screen to hand, it is exact where it works at all,
 * and it needs a second layer holding the empty plate. */
function differenceMatte(data, w, h, params, reference) {
  const reach = Math.max(4, (params.tolerance ?? 18) / 100 * 260);
  const coverage = new Float32Array(w * h);
  if (!reference) return toMatte(coverage);
  for (let i = 0, at = 0; i < coverage.length; i++, at += 4) {
    const distance = Math.hypot(
      data[at] - reference[at], data[at + 1] - reference[at + 1], data[at + 2] - reference[at + 2]
    );
    coverage[i] = clamp01(distance / reach);
  }
  return toMatte(coverage);
}

/* ---- saliency ----
 * Achanta's frequency-tuned saliency, 2009: blur the picture a little, take
 * each pixel's distance from the average colour of the whole frame, and what
 * stands out is what is left. No training, no download, about twenty lines —
 * and on a photograph with one obvious subject against a settled background it
 * lands surprisingly close to what a model would say. On a busy picture it
 * does not, and that is the honest trade for nothing to fetch. */
function saliency(data, w, h) {
  const count = w * h;
  const blurred = boxBlurRgb(data, w, h, Math.max(1, Math.round(Math.min(w, h) / 100)));
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0, at = 0; i < count; i++, at += 3) { mr += blurred[at]; mg += blurred[at + 1]; mb += blurred[at + 2]; }
  mr /= count; mg /= count; mb /= count;
  const coverage = new Float32Array(count);
  let strongest = 1e-6;
  for (let i = 0, at = 0; i < count; i++, at += 3) {
    const distance = Math.hypot(blurred[at] - mr, blurred[at + 1] - mg, blurred[at + 2] - mb);
    coverage[i] = distance;
    if (distance > strongest) strongest = distance;
  }
  for (let i = 0; i < count; i++) coverage[i] /= strongest;
  return toMatte(coverage);
}

/* two box passes stand in for a Gaussian, on three planes at once */
function boxBlurRgb(data, w, h, radius) {
  const count = w * h;
  let current = new Float32Array(count * 3);
  for (let i = 0, at = 0, to = 0; i < count; i++, at += 4, to += 3) {
    current[to] = data[at]; current[to + 1] = data[at + 1]; current[to + 2] = data[at + 2];
  }
  const clampTo = (value, top) => value < 0 ? 0 : value > top ? top : value;
  for (let pass = 0; pass < 2; pass++) {
    const horizontal = new Float32Array(count * 3);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let x = -radius; x <= radius; x++) sum += current[(row + clampTo(x, w - 1)) * 3 + channel];
        for (let x = 0; x < w; x++) {
          horizontal[(row + x) * 3 + channel] = sum / (radius * 2 + 1);
          sum -= current[(row + clampTo(x - radius, w - 1)) * 3 + channel];
          sum += current[(row + clampTo(x + radius + 1, w - 1)) * 3 + channel];
        }
      }
    }
    const vertical = new Float32Array(count * 3);
    for (let x = 0; x < w; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) sum += horizontal[(clampTo(y, h - 1) * w + x) * 3 + channel];
        for (let y = 0; y < h; y++) {
          vertical[(y * w + x) * 3 + channel] = sum / (radius * 2 + 1);
          sum -= horizontal[(clampTo(y - radius, h - 1) * w + x) * 3 + channel];
          sum += horizontal[(clampTo(y + radius + 1, h - 1) * w + x) * 3 + channel];
        }
      }
    }
    current = vertical;
  }
  return current;
}

/* ---- GrowCut ----
 * Vezhnevets and Konouchine, 2005: a cellular automaton where every pixel is a
 * cell holding a label and a conviction, and at each tick a cell may be
 * conquered by a neighbour whose conviction, weakened by how different the two
 * colours are, still beats its own. Seeds start certain; everything else starts
 * at zero and is taken by whichever side reaches it through the easiest
 * colours. It walks round an object the way a flood fill cannot, because a
 * strong edge is expensive to cross rather than merely different.
 *
 * Seeds are the page's business: it turns a rough selection into a core of
 * certain subject, a surround of certain background, and a wide undecided band
 * between them. Failing that, this falls back to a central ellipse and a ring
 * round the frame, which is a guess and says so. Run on a shrunk copy: the
 * automaton needs one tick per pixel of travel, so full resolution would mean
 * thousands of ticks to reach the same answer. */
function growCut(data, w, h, params, seeds) {
  const limit = 320;
  const scale = Math.min(1, limit / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * scale)), sh = Math.max(8, Math.round(h * scale));
  const small = shrinkRgb(data, w, h, sw, sh);
  const label = new Int8Array(sw * sh);      /* 0 unknown, 1 subject, -1 background */
  const strength = new Float32Array(sw * sh);

  if (seeds) {
    /* the page sends its seeds at picture size; take the nearest sample */
    for (let y = 0; y < sh; y++) {
      const sourceY = Math.min(h - 1, Math.floor(y / sh * h));
      for (let x = 0; x < sw; x++) {
        const sourceX = Math.min(w - 1, Math.floor(x / sw * w));
        const seed = seeds[sourceY * w + sourceX];
        if (!seed) continue;
        label[y * sw + x] = seed === 1 ? 1 : -1;
        strength[y * sw + x] = 1;
      }
    }
  }
  let hasSubject = false, hasBackground = false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] > 0) hasSubject = true; else if (label[i] < 0) hasBackground = true;
  }
  if (!hasSubject) {
    const cx = sw / 2, cy = sh / 2, rx = sw * .3, ry = sh * .38;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) { label[y * sw + x] = 1; strength[y * sw + x] = 1; }
    }
  }
  if (!hasBackground) {
    const band = Math.max(2, Math.round(Math.min(sw, sh) * .04));
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (x >= band && y >= band && x < sw - band && y < sh - band) continue;
      label[y * sw + x] = -1; strength[y * sw + x] = 1;
    }
  }

  /* The automaton only ever settles from the outside in, so a cell can change
     this round only if one of its neighbours changed last round. Carrying that
     frontier about turns a sweep of the whole grid per round — hundreds of
     rounds, every cell, eight neighbours each — into work proportional to the
     ground actually being fought over. Measured on a 640 × 400 photograph, that
     is the difference between half a minute and about two seconds. */
  const maxDistance = Math.sqrt(3 * 255 * 255);
  const rounds = Math.max(60, Math.round(Math.max(sw, sh) * 1.5));
  const nextLabel = Int8Array.from(label), nextStrength = Float32Array.from(strength);
  let active = new Uint8Array(sw * sh), pending = new Uint8Array(sw * sh);
  const wake = (x, y, into) => {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= sh) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= sw) continue;
        into[ny * sw + nx] = 1;
      }
    }
  };
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (label[y * sw + x]) wake(x, y, active);
  for (let round = 0; round < rounds; round++) {
    let changed = false;
    pending.fill(0);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const at = y * sw + x;
        if (!active[at]) continue;
        const colour = at * 3;
        const red = small[colour], green = small[colour + 1], blue = small[colour + 2];
        let bestLabel = label[at], bestStrength = strength[at];
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= sh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if ((!dx && !dy) || nx < 0 || nx >= sw) continue;
            const neighbour = ny * sw + nx;
            if (!label[neighbour]) continue;
            const other = neighbour * 3;
            const dr = red - small[other], dg = green - small[other + 1], db = blue - small[other + 2];
            const attack = (1 - Math.sqrt(dr * dr + dg * dg + db * db) / maxDistance) * strength[neighbour];
            if (attack > bestStrength) { bestStrength = attack; bestLabel = label[neighbour]; }
          }
        }
        if (bestLabel !== label[at] || bestStrength !== strength[at]) {
          changed = true;
          wake(x, y, pending);
        }
        nextLabel[at] = bestLabel; nextStrength[at] = bestStrength;
      }
    }
    label.set(nextLabel); strength.set(nextStrength);
    if (!changed) break;
    const swap = active; active = pending; pending = swap;
  }

  /* back up to picture size, sampled smoothly so the edge does not come back
     as the staircase the shrunk grid would otherwise leave */
  const smallCoverage = new Float32Array(sw * sh);
  for (let i = 0; i < smallCoverage.length; i++) smallCoverage[i] = label[i] > 0 ? 1 : 0;
  return toMatte(growTo(smallCoverage, sw, sh, w, h));
}

/* nearest-sample shrink of the RGB planes; the automaton only ever compares
   neighbours, so a cheap average is plenty and a proper filter is not */
function shrinkRgb(data, w, h, sw, sh) {
  const out = new Float32Array(sw * sh * 3);
  const stepX = w / sw, stepY = h / sh;
  for (let y = 0; y < sh; y++) {
    const fromY = Math.floor(y * stepY), toY = Math.min(h, Math.max(fromY + 1, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < sw; x++) {
      const fromX = Math.floor(x * stepX), toX = Math.min(w, Math.max(fromX + 1, Math.floor((x + 1) * stepX)));
      let r = 0, g = 0, b = 0, counted = 0;
      for (let sy = fromY; sy < toY; sy++) {
        for (let sx = fromX; sx < toX; sx++) {
          const at = (sy * w + sx) * 4;
          r += data[at]; g += data[at + 1]; b += data[at + 2]; counted++;
        }
      }
      const to = (y * sw + x) * 3;
      out[to] = r / counted; out[to + 1] = g / counted; out[to + 2] = b / counted;
    }
  }
  return out;
}

/* bilinear enlargement of a coverage plane */
function growTo(coverage, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + .5) * sh / h - .5));
    const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + .5) * sw / w - .5));
      const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
      const top = coverage[y0 * sw + x0] * (1 - fx) + coverage[y0 * sw + x1] * fx;
      const bottom = coverage[y1 * sw + x0] * (1 - fx) + coverage[y1 * sw + x1] * fx;
      out[y * w + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

export const CLASSIC_METHODS = new Set([
  'chroma', 'colour-range', 'border-flood', 'brightness', 'difference', 'saliency', 'growcut'
]);

/* `data` is the picture's RGBA, `reference` the RGBA of another layer for
   difference matting, `seeds` a byte per pixel for GrowCut (1 subject,
   2 background, 0 undecided). */
export function classicMatte(method, data, w, h, params = {}, reference = null, seeds = null) {
  switch (method) {
    case 'chroma': return chromaKey(data, w, h, params);
    case 'colour-range': return colourRange(data, w, h, params);
    case 'border-flood': return borderFlood(data, w, h, params);
    case 'brightness': return brightness(data, w, h, params);
    case 'difference': return differenceMatte(data, w, h, params, reference);
    case 'saliency': return saliency(data, w, h);
    case 'growcut': return growCut(data, w, h, params, seeds);
    default: throw new Error(`unknown matting method "${method}"`);
  }
}
