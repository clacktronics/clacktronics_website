/* ClackPaint — retouching maths.
 *
 * The touch-up tools in paint.html are mostly thin wrappers: a pointer stroke
 * works out *where* to retouch, and everything that decides *what the pixels
 * become* lives in here. Keeping it separate means the heavy numerical work —
 * the Poisson solve behind healing, the PatchMatch search behind content-aware
 * fill — can be read on its own, without the surrounding tool plumbing.
 *
 * Sources for the methods that could not simply be derived:
 *   - Poisson image editing: Pérez, Gangnet & Blake, SIGGRAPH 2003. Healing,
 *     the patch tools and the seam pass after a content-aware fill all solve
 *     the same equation — match the source's gradients, match the target's
 *     colour at the border.
 *   - PatchMatch: Barnes, Shechtman, Finkelstein & Goldman, SIGGRAPH 2009,
 *     with the iterate-and-vote completion scheme of Wexler, Shechtman &
 *     Irani, "Space-Time Completion of Video", PAMI 2007.
 *   - Bilateral filtering (the Surface Blur / skin-softening brush):
 *     Tomasi & Manduchi, ICCV 1998.
 *   - Reconstruction filters (the resampler at the end, shared by Image Size
 *     and the program-array exporter): Mitchell & Netravali, SIGGRAPH 1988.
 *
 * Everything here is pure: ImageData and typed arrays in, new pixels out. No
 * DOM, no canvas state, so the same routines serve a live brush stroke and a
 * filter dialog without either knowing about the other.
 */
(() => {
'use strict';

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const clampByte = value => (value < 0 ? 0 : value > 255 ? 255 : value);

/* Repeatable randomness: a preview and the apply that follows it must land on
   the same pixels, so nothing here reaches for Math.random. */
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

/* ------------------------------------------------------------------ masks */

/* Brush footprints and selections both arrive here as a coverage plane: one
   float per pixel, 0 outside and 1 inside, with soft edges in between. */
function makeMask(w, h) {
  return new Float32Array(w * h);
}

function maskBounds(mask, w, h, threshold = 0) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* A soft round stamp, the shape every retouching brush paints with. The edge
   is a smoothstep over the outer fifth of the radius rather than a hard cut,
   which is what stops a dodge or heal stroke showing its own circles. */
function stampMask(mask, w, h, cx, cy, radius, hardness = .5, strength = 1) {
  const inner = radius * clamp(hardness, 0, .95);
  const span = Math.max(.5, radius - inner);
  const x0 = Math.max(0, Math.floor(cx - radius - 1)), x1 = Math.min(w - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1)), y1 = Math.min(h - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    const dy = y + .5 - cy, row = y * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x + .5 - cx;
      const distance = Math.hypot(dx, dy);
      if (distance >= radius) continue;
      const t = distance <= inner ? 1 : 1 - (distance - inner) / span;
      const coverage = t * t * (3 - 2 * t) * strength;
      if (coverage > mask[row + x]) mask[row + x] = coverage;
    }
  }
  return mask;
}

function dilateMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Float32Array(mask.length);
  const r = Math.round(radius), r2 = radius * radius;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = 0;
    for (let dy = -r; dy <= r && best < 1; dy++) {
      const sy = y + dy;
      if (sy < 0 || sy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= w || dx * dx + dy * dy > r2) continue;
        const value = mask[sy * w + sx];
        if (value > best) { best = value; if (best >= 1) break; }
      }
    }
    out[y * w + x] = best;
  }
  return out;
}

function erodeMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const inverted = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) inverted[i] = 1 - mask[i];
  const grown = dilateMask(inverted, w, h, radius);
  const out = new Float32Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = 1 - grown[i];
  return out;
}

/* Feathering is a blur of the coverage plane. Two box passes approximate a
   Gaussian closely enough for an edge nobody measures with a ruler. */
function featherMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  let current = mask;
  for (let pass = 0; pass < 2; pass++) {
    const horizontal = new Float32Array(current.length);
    const r = Math.max(1, Math.round(radius));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += current[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        horizontal[row + x] = sum / (r * 2 + 1);
        sum -= current[row + clamp(x - r, 0, w - 1)];
        sum += current[row + clamp(x + r + 1, 0, w - 1)];
      }
    }
    const vertical = new Float32Array(current.length);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += horizontal[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        vertical[y * w + x] = sum / (r * 2 + 1);
        sum -= horizontal[clamp(y - r, 0, h - 1) * w + x];
        sum += horizontal[clamp(y + r + 1, 0, h - 1) * w + x];
      }
    }
    current = vertical;
  }
  return current;
}

/* ---------------------------------------------------- Poisson (healing) */

function downsamplePlane(plane, w, h, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
    const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
    out[y * cw + x] = (plane[y0 * w + x0] + plane[y0 * w + x1] + plane[y1 * w + x0] + plane[y1 * w + x1]) / 4;
  }
  return out;
}

function upsamplePlane(plane, cw, ch, out, w, h) {
  for (let y = 0; y < h; y++) {
    const sy = clamp((y - .5) / 2, 0, ch - 1);
    const y0 = Math.floor(sy), y1 = Math.min(ch - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = clamp((x - .5) / 2, 0, cw - 1);
      const x0 = Math.floor(sx), x1 = Math.min(cw - 1, x0 + 1), fx = sx - x0;
      const top = plane[y0 * cw + x0] * (1 - fx) + plane[y0 * cw + x1] * fx;
      const bottom = plane[y1 * cw + x0] * (1 - fx) + plane[y1 * cw + x1] * fx;
      out[y * w + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/* Gauss-Seidel with over-relaxation. Inside the mask each pixel is pulled
   towards its neighbours' average, offset by the source's Laplacian; outside
   it holds the target's colour, which is what makes the border invisible. */
function relaxPlane(f, guide, mask, w, h, iterations) {
  const omega = 1.85;
  for (let pass = 0; pass < iterations; pass++) {
    /* Sweeping alternate directions on alternate passes stops the solution
       drifting in the scan direction on long thin regions. */
    const forward = (pass & 1) === 0;
    for (let step = 0; step < (h - 2); step++) {
      const y = forward ? step + 1 : h - 2 - step;
      const row = y * w;
      for (let inner = 0; inner < (w - 2); inner++) {
        const x = forward ? inner + 1 : w - 2 - inner;
        const i = row + x;
        if (mask[i] <= 0) continue;
        const value = (f[i - 1] + f[i + 1] + f[i - w] + f[i + w] + guide[i]) * .25;
        f[i] += omega * (value - f[i]);
      }
    }
  }
}

function guidePlane(src, w, h) {
  const guide = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      guide[i] = 4 * src[i] - src[i - 1] - src[i + 1] - src[i - w] - src[i + w];
    }
  }
  return guide;
}

function solvePlane(dst, src, mask, w, h, depth) {
  const f = new Float32Array(w * h);
  if (w > 24 && h > 24 && depth < 6) {
    const cw = w >> 1, ch = h >> 1;
    const coarse = solvePlane(
      downsamplePlane(dst, w, h, cw, ch),
      downsamplePlane(src, w, h, cw, ch),
      downsamplePlane(mask, w, h, cw, ch),
      cw, ch, depth + 1
    );
    upsamplePlane(coarse, cw, ch, f, w, h);
    /* The coarse answer is only a starting guess for the interior; the border
       must go back to the exact target colour or the solve has nothing to
       match. */
    for (let i = 0; i < f.length; i++) if (mask[i] <= 0) f[i] = dst[i];
  } else {
    f.set(dst);
  }
  relaxPlane(f, guidePlane(src, w, h), mask, w, h, depth ? 24 : 40);
  return f;
}

function extractPlanes(image, box) {
  const { x, y, w, h } = box, sw = image.width, data = image.data;
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const i = ((y + row) * sw + x + column) * 4, j = row * w + column;
      planes[0][j] = data[i]; planes[1][j] = data[i + 1]; planes[2][j] = data[i + 2]; planes[3][j] = data[i + 3];
    }
  }
  return planes;
}

/* Blend `source` into `image` wherever `mask` covers, matching the source's
   texture and the image's colour. `source` is expected to be aligned with the
   image already — the callers shift their sample first. */
function poissonBlend(image, source, mask, options = {}) {
  const w = image.width, h = image.height;
  const region = options.box || maskBounds(mask, w, h);
  if (!region) return image;
  const pad = 2;
  const x0 = Math.max(0, region.x - pad), y0 = Math.max(0, region.y - pad);
  const x1 = Math.min(w, region.x + region.w + pad), y1 = Math.min(h, region.y + region.h + pad);
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (box.w < 3 || box.h < 3) return image;

  const dstPlanes = extractPlanes(image, box);
  const srcPlanes = extractPlanes(source, box);
  const boxMask = new Float32Array(box.w * box.h);
  for (let row = 0; row < box.h; row++) for (let column = 0; column < box.w; column++) {
    /* The outermost ring is the boundary condition, so it never solves even if
       the brush ran off the edge of the layer. */
    const edge = row === 0 || column === 0 || row === box.h - 1 || column === box.w - 1;
    boxMask[row * box.w + column] = edge ? 0 : mask[(box.y + row) * w + box.x + column];
  }

  const solved = [0, 1, 2].map(channel => solvePlane(dstPlanes[channel], srcPlanes[channel], boxMask, box.w, box.h, 0));
  const data = image.data;
  for (let row = 0; row < box.h; row++) for (let column = 0; column < box.w; column++) {
    const j = row * box.w + column, coverage = boxMask[j];
    if (coverage <= 0) continue;
    const i = ((box.y + row) * w + box.x + column) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = clampByte(dstPlanes[channel][j] + (solved[channel][j] - dstPlanes[channel][j]) * coverage);
    }
    data[i + 3] = clampByte(dstPlanes[3][j] + (srcPlanes[3][j] - dstPlanes[3][j]) * coverage);
  }
  return image;
}

/* A straight alpha-blended copy — what the patch tools show while you drag,
   before the expensive solve runs on release. */
function stampSource(image, source, mask) {
  const data = image.data, from = source.data;
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    const coverage = mask[pixel];
    if (coverage <= 0) continue;
    for (let channel = 0; channel < 4; channel++) {
      data[i + channel] = clampByte(data[i + channel] + (from[i + channel] - data[i + channel]) * coverage);
    }
  }
  return image;
}

/* An image shifted by a whole number of pixels, clamped at the edges. Healing
   and the patch tools both work by lining a donor area up with the damage. */
function offsetImage(image, dx, dy) {
  const w = image.width, h = image.height, data = image.data;
  const out = new ImageData(w, h), result = out.data;
  for (let y = 0; y < h; y++) {
    const sy = clamp(y + dy, 0, h - 1);
    for (let x = 0; x < w; x++) {
      const sx = clamp(x + dx, 0, w - 1);
      const i = (y * w + x) * 4, j = (sy * w + sx) * 4;
      result[i] = data[j]; result[i + 1] = data[j + 1]; result[i + 2] = data[j + 2]; result[i + 3] = data[j + 3];
    }
  }
  return out;
}

/* Spot healing has no donor chosen for it, so it looks for one: a ring of
   candidate offsets, scored on how well the pixels *around* the blemish would
   line up. The winner is the neighbourhood that continues the surroundings
   best, which is the same judgement a retoucher makes by eye. */
function bestSourceOffset(image, mask, box, options = {}) {
  const w = image.width, h = image.height, data = image.data;
  const radius = Math.max(box.w, box.h) / 2;
  const ring = [];
  const step = Math.max(1, Math.round(radius / 6));
  const band = Math.max(2, Math.round(radius * .6));
  for (let y = Math.max(0, box.y - band); y < Math.min(h, box.y + box.h + band); y += step) {
    for (let x = Math.max(0, box.x - band); x < Math.min(w, box.x + box.w + band); x += step) {
      if (mask[y * w + x] > .02) continue;
      ring.push(y * w + x);
    }
  }
  if (!ring.length) return { dx: 0, dy: 0 };

  const distances = options.distances || [1.6, 2.1, 2.8, 3.6];
  const angles = 24;
  let best = null, bestScore = Infinity;
  for (const scale of distances) {
    const reach = Math.max(4, Math.round(radius * 2 * scale));
    for (let a = 0; a < angles; a++) {
      const angle = a / angles * Math.PI * 2;
      const dx = Math.round(Math.cos(angle) * reach), dy = Math.round(Math.sin(angle) * reach);
      if (box.x + dx < 0 || box.y + dy < 0 || box.x + box.w + dx > w || box.y + box.h + dy > h) continue;
      let score = 0, counted = 0, overlapped = false;
      for (const index of ring) {
        const x = index % w + dx, y = (index / w | 0) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) { overlapped = true; break; }
        const donor = y * w + x;
        if (mask[donor] > .02) { overlapped = true; break; }
        const i = index * 4, j = donor * 4;
        const dr = data[i] - data[j], dg = data[i + 1] - data[j + 1], db = data[i + 2] - data[j + 2];
        score += dr * dr + dg * dg + db * db;
        counted++;
      }
      if (overlapped || !counted) continue;
      /* A gentle preference for a closer donor: all else equal, texture from
         next door matches better than texture from across the picture. */
      const mean = score / counted * (1 + scale * .05);
      if (mean < bestScore) { bestScore = mean; best = { dx, dy }; }
    }
  }
  return best || { dx: 0, dy: 0 };
}

/* --------------------------------------------- PatchMatch (content-aware) */

/* One pyramid level of the completion loop: find, for every patch that touches
   the hole, the most similar patch that does not, then rebuild the hole from
   the overlapping votes. Repeating that a few times is what turns a smeared
   first guess into something with texture in it. */
function completeLevel(rgb, w, h, hole, patch, iterations, random, nnf) {
  const half = patch >> 1;
  const centreLow = half, centreHighX = w - 1 - half, centreHighY = h - 1 - half;
  if (centreHighX < centreLow || centreHighY < centreLow) return nnf;

  /* A patch may be used as a donor only when none of it is missing. */
  const holeSum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    holeSum[(y + 1) * (w + 1) + x + 1] = hole[y * w + x] +
      holeSum[y * (w + 1) + x + 1] + holeSum[(y + 1) * (w + 1) + x] - holeSum[y * (w + 1) + x];
  }
  const holeCount = (x0, y0, x1, y1) =>
    holeSum[(y1 + 1) * (w + 1) + x1 + 1] - holeSum[y0 * (w + 1) + x1 + 1] -
    holeSum[(y1 + 1) * (w + 1) + x0] + holeSum[y0 * (w + 1) + x0];
  const validDonor = (x, y) => holeCount(x - half, y - half, x + half, y + half) === 0;

  const donors = [];
  for (let y = centreLow; y <= centreHighY; y++) for (let x = centreLow; x <= centreHighX; x++) {
    if (validDonor(x, y)) donors.push(y * w + x);
  }
  if (!donors.length) return nnf;

  /* Targets are the patches that overlap the hole at all, not just the hole
     pixels themselves — that is what carries texture across the boundary. */
  const targets = [];
  const isTarget = new Uint8Array(w * h);
  for (let y = centreLow; y <= centreHighY; y++) for (let x = centreLow; x <= centreHighX; x++) {
    if (holeCount(x - half, y - half, x + half, y + half) === 0) continue;
    isTarget[y * w + x] = 1;
    targets.push(y * w + x);
  }
  if (!targets.length) return nnf;

  if (!nnf) {
    nnf = new Int32Array(w * h).fill(-1);
    for (const index of targets) nnf[index] = donors[(random() * donors.length) | 0];
  } else {
    for (const index of targets) if (nnf[index] < 0 || !validDonor(nnf[index] % w, nnf[index] / w | 0)) {
      nnf[index] = donors[(random() * donors.length) | 0];
    }
  }

  const patchDistance = (tx, ty, sx, sy, ceiling) => {
    let total = 0;
    for (let dy = -half; dy <= half; dy++) {
      let ti = ((ty + dy) * w + tx - half) * 3;
      let si = ((sy + dy) * w + sx - half) * 3;
      for (let dx = -half; dx <= half; dx++) {
        const dr = rgb[ti] - rgb[si], dg = rgb[ti + 1] - rgb[si + 1], db = rgb[ti + 2] - rgb[si + 2];
        total += dr * dr + dg * dg + db * db;
        ti += 3; si += 3;
      }
      if (total > ceiling) return total;
    }
    return total;
  };

  const best = new Float64Array(w * h).fill(Infinity);
  for (const index of targets) {
    const source = nnf[index];
    best[index] = patchDistance(index % w, index / w | 0, source % w, source / w | 0, Infinity);
  }

  const tryCandidate = (index, tx, ty, sx, sy) => {
    if (sx < centreLow || sy < centreLow || sx > centreHighX || sy > centreHighY) return;
    if (!validDonor(sx, sy)) return;
    const distance = patchDistance(tx, ty, sx, sy, best[index]);
    if (distance < best[index]) { best[index] = distance; nnf[index] = sy * w + sx; }
  };

  const maxSearch = Math.max(w, h);
  for (let pass = 0; pass < iterations; pass++) {
    const forward = (pass & 1) === 0;
    for (let n = 0; n < targets.length; n++) {
      const index = targets[forward ? n : targets.length - 1 - n];
      const tx = index % w, ty = index / w | 0;
      /* Propagation: a good donor for my neighbour, shifted by one, is often a
         good donor for me. */
      const shift = forward ? -1 : 1;
      const left = index + shift;
      if (isTarget[left] && nnf[left] >= 0) tryCandidate(index, tx, ty, nnf[left] % w - shift, nnf[left] / w | 0);
      const up = index + shift * w;
      if (up >= 0 && up < w * h && isTarget[up] && nnf[up] >= 0) {
        tryCandidate(index, tx, ty, nnf[up] % w, (nnf[up] / w | 0) - shift);
      }
      /* Random search over a window that halves each try, so both a nearby
         nudge and a completely different part of the picture get a look in. */
      let reach = maxSearch;
      const source = nnf[index];
      let sx = source % w, sy = source / w | 0;
      while (reach > 1) {
        const cx = sx + Math.round((random() * 2 - 1) * reach);
        const cy = sy + Math.round((random() * 2 - 1) * reach);
        tryCandidate(index, tx, ty, cx, cy);
        reach = reach >> 1;
      }
    }

    /* Vote: every hole pixel becomes the average of the donor pixels lying on
       top of it, weighted so a well-matched patch counts for more. */
    const accumulate = new Float32Array(w * h * 3);
    const weights = new Float32Array(w * h);
    for (const index of targets) {
      const tx = index % w, ty = index / w | 0, source = nnf[index];
      const sx = source % w, sy = source / w | 0;
      const weight = 1 / (1 + best[index] / (patch * patch * 3 * 64));
      for (let dy = -half; dy <= half; dy++) {
        let ti = (ty + dy) * w + tx - half;
        let si = ((sy + dy) * w + sx - half) * 3;
        for (let dx = -half; dx <= half; dx++) {
          if (hole[ti]) {
            const at = ti * 3;
            accumulate[at] += rgb[si] * weight;
            accumulate[at + 1] += rgb[si + 1] * weight;
            accumulate[at + 2] += rgb[si + 2] * weight;
            weights[ti] += weight;
          }
          ti++; si += 3;
        }
      }
    }
    for (let index = 0; index < w * h; index++) {
      if (!hole[index] || !weights[index]) continue;
      const at = index * 3, weight = weights[index];
      rgb[at] = accumulate[at] / weight;
      rgb[at + 1] = accumulate[at + 1] / weight;
      rgb[at + 2] = accumulate[at + 2] / weight;
    }
  }
  return nnf;
}

/* The first guess before any texture is synthesised: push colour inwards from
   the rim of the hole until it meets in the middle. On its own this is the old
   "smart blur fill"; as a starting point it keeps PatchMatch from wandering. */
function diffuseFill(rgb, w, h, hole) {
  const pending = [];
  for (let index = 0; index < w * h; index++) if (hole[index]) pending.push(index);
  if (!pending.length) return;
  for (let pass = 0; pass < 64; pass++) {
    let moved = 0;
    for (const index of pending) {
      const x = index % w, y = index / w | 0;
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const neighbour = sy * w + sx;
        if (hole[neighbour] && pass === 0) continue;
        const at = neighbour * 3;
        r += rgb[at]; g += rgb[at + 1]; b += rgb[at + 2]; count++;
      }
      if (!count) continue;
      const at = index * 3;
      rgb[at] = r / count; rgb[at + 1] = g / count; rgb[at + 2] = b / count;
      moved++;
    }
    if (!moved) break;
  }
}

function downsampleRgb(rgb, w, h, cw, ch) {
  const out = new Float32Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
    const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
    const at = (y * cw + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      out[at + channel] = (
        rgb[(y0 * w + x0) * 3 + channel] + rgb[(y0 * w + x1) * 3 + channel] +
        rgb[(y1 * w + x0) * 3 + channel] + rgb[(y1 * w + x1) * 3 + channel]) / 4;
    }
  }
  return out;
}

function downsampleHole(hole, w, h, cw, ch) {
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
    const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
    out[y * cw + x] = (hole[y0 * w + x0] || hole[y0 * w + x1] || hole[y1 * w + x0] || hole[y1 * w + x1]) ? 1 : 0;
  }
  return out;
}

function upsampleRgb(rgb, cw, ch, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = clamp((y - .5) / 2, 0, ch - 1);
    const y0 = Math.floor(sy), y1 = Math.min(ch - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = clamp((x - .5) / 2, 0, cw - 1);
      const x0 = Math.floor(sx), x1 = Math.min(cw - 1, x0 + 1), fx = sx - x0;
      const at = (y * w + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const top = rgb[(y0 * cw + x0) * 3 + channel] * (1 - fx) + rgb[(y0 * cw + x1) * 3 + channel] * fx;
        const bottom = rgb[(y1 * cw + x0) * 3 + channel] * (1 - fx) + rgb[(y1 * cw + x1) * 3 + channel] * fx;
        out[at + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

/* Content-aware fill. `hole` marks what to replace; everything else in the
   working window is fair game as donor material. */
function inpaint(image, hole, options = {}) {
  const w = image.width, h = image.height, data = image.data;
  const patch = Math.max(3, (options.patch || 7) | 1);
  const passes = Math.max(1, options.passes || 4);
  const random = makeRandom(options.seed ?? 1234);

  const holeMask = new Uint8Array(w * h);
  let holeCount = 0;
  for (let index = 0; index < holeMask.length; index++) {
    if (hole[index] > .5) { holeMask[index] = 1; holeCount++; }
  }
  if (!holeCount) return image;
  const bounds = maskBounds(holeMask, w, h);
  if (!bounds) return image;

  /* Only a window around the damage takes part: donors from the far side of a
     large picture are rarely what you wanted, and the search cost is the size
     of the window squared. */
  const reach = Math.round(clamp(Math.max(bounds.w, bounds.h) * (options.reach || 1.5), 24, 220));
  const x0 = Math.max(0, bounds.x - reach), y0 = Math.max(0, bounds.y - reach);
  const x1 = Math.min(w, bounds.x + bounds.w + reach), y1 = Math.min(h, bounds.y + bounds.h + reach);
  const ww = x1 - x0, wh = y1 - y0;

  let rgb = new Float32Array(ww * wh * 3);
  const windowHole = new Uint8Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = ((y0 + y) * w + x0 + x) * 4, j = (y * ww + x) * 3;
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
    windowHole[y * ww + x] = holeMask[(y0 + y) * w + x0 + x];
  }

  /* A pyramid so the fill agrees with the picture's large shapes before it
     starts inventing detail. */
  const levels = [{ rgb, hole: windowHole, w: ww, h: wh }];
  while (levels.length < 4) {
    const top = levels[levels.length - 1];
    const cw = top.w >> 1, ch = top.h >> 1;
    if (cw < patch * 3 || ch < patch * 3) break;
    levels.push({
      rgb: downsampleRgb(top.rgb, top.w, top.h, cw, ch),
      hole: downsampleHole(top.hole, top.w, top.h, cw, ch),
      w: cw, h: ch
    });
  }

  const coarsest = levels[levels.length - 1];
  diffuseFill(coarsest.rgb, coarsest.w, coarsest.h, coarsest.hole);
  let carried = null;
  for (let level = levels.length - 1; level >= 0; level--) {
    const current = levels[level];
    if (level < levels.length - 1) {
      const finer = upsampleRgb(levels[level + 1].rgb, levels[level + 1].w, levels[level + 1].h, current.w, current.h);
      for (let index = 0; index < current.w * current.h; index++) {
        if (!current.hole[index]) continue;
        const at = index * 3;
        current.rgb[at] = finer[at]; current.rgb[at + 1] = finer[at + 1]; current.rgb[at + 2] = finer[at + 2];
      }
      carried = null;
    }
    const iterations = level === levels.length - 1 ? passes + 2 : Math.max(2, passes - level);
    carried = completeLevel(current.rgb, current.w, current.h, current.hole, patch, iterations, random, carried);
  }

  rgb = levels[0].rgb;
  const filled = new ImageData(w, h);
  filled.data.set(data);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const index = y * ww + x;
    if (!windowHole[index]) continue;
    const i = ((y0 + y) * w + x0 + x) * 4, j = index * 3;
    filled.data[i] = clampByte(rgb[j]);
    filled.data[i + 1] = clampByte(rgb[j + 1]);
    filled.data[i + 2] = clampByte(rgb[j + 2]);
    filled.data[i + 3] = 255;
  }

  /* Synthesised texture can still sit a shade off its surroundings, so the
     same Poisson solve healing uses irons out the join. */
  if (options.blend !== false) {
    const soft = featherMask(Float32Array.from(holeMask), w, h, 1);
    for (let index = 0; index < soft.length; index++) if (holeMask[index]) soft[index] = 1;
    poissonBlend(image, filled, soft, { box: bounds });
    return image;
  }
  image.data.set(filled.data);
  return image;
}

/* ------------------------------------------------------------- filtering */

/* Bilateral blur: neighbours count only while they look like the centre
   pixel, so shading smooths out and edges stay put. This is the skin
   softening brush, and Effects → Blur → Surface Blur. */
function surfaceBlur(image, radius, threshold, box = null) {
  const w = image.width, h = image.height, data = image.data;
  const out = new ImageData(w, h), result = out.data;
  result.set(data);
  const r = Math.max(1, Math.min(24, Math.round(radius)));
  const span = r * 2 + 1;
  const sigma = Math.max(1, threshold);
  const range = new Float32Array(256 * 3);
  for (let i = 0; i < range.length; i++) range[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const spatial = new Float32Array(span * span);
  const spread = Math.max(.5, radius / 2);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    spatial[(dy + r) * span + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * spread * spread));
  }
  /* A brush only ever needs its own footprint filtered, and the cost here is
     the radius squared per pixel, so the caller can hand over a box. */
  const x0 = box ? Math.max(0, box.x) : 0, y0 = box ? Math.max(0, box.y) : 0;
  const x1 = box ? Math.min(w, box.x + box.w) : w, y1 = box ? Math.min(h, box.y + box.h) : h;
  for (let y = y0; y < y1; y++) {
    const topY = Math.max(0, y - r), bottomY = Math.min(h - 1, y + r);
    for (let x = x0; x < x1; x++) {
      const centre = (y * w + x) * 4;
      const cr = data[centre], cg = data[centre + 1], cb = data[centre + 2];
      const leftX = Math.max(0, x - r), rightX = Math.min(w - 1, x + r);
      let r0 = 0, g0 = 0, b0 = 0, total = 0;
      for (let sy = topY; sy <= bottomY; sy++) {
        const spatialRow = (sy - y + r) * span + r - x;
        let i = (sy * w + leftX) * 4;
        for (let sx = leftX; sx <= rightX; sx++, i += 4) {
          if (!data[i + 3]) continue;
          const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb;
          const difference = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
          const weight = spatial[spatialRow + sx] * range[difference];
          r0 += data[i] * weight; g0 += data[i + 1] * weight; b0 += data[i + 2] * weight; total += weight;
        }
      }
      if (!total) continue;
      result[centre] = r0 / total; result[centre + 1] = g0 / total; result[centre + 2] = b0 / total;
    }
  }
  return out;
}

/* Clarity / structure: contrast at one scale only. Working on luminance keeps
   colours from going lurid, and easing off at the ends of the range stops
   haloes round a bright sky. */
function localContrast(image, blurred, amount, protectTones = true) {
  const w = image.width, h = image.height, data = image.data, soft = blurred.data;
  const out = new ImageData(w, h), result = out.data;
  const gain = amount / 100;
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
    const base = soft[i] * .299 + soft[i + 1] * .587 + soft[i + 2] * .114;
    let boost = (luma - base) * gain;
    if (protectTones) {
      const t = luma / 255;
      boost *= 4 * t * (1 - t);
    }
    result[i] = clampByte(data[i] + boost);
    result[i + 1] = clampByte(data[i + 1] + boost);
    result[i + 2] = clampByte(data[i + 2] + boost);
    result[i + 3] = data[i + 3];
  }
  return out;
}

/* --------------------------------------------------------------- selection */

/* The magic wand. Contiguous mode floods outwards from the click; the global
   mode takes every pixel of that colour anywhere in the layer. */
function magicWand(image, sx, sy, options = {}) {
  const w = image.width, h = image.height, data = image.data;
  const tolerance = (options.tolerance ?? 32) * 3;
  const mask = new Float32Array(w * h);
  const start = (sy * w + sx) * 4;
  const r0 = data[start], g0 = data[start + 1], b0 = data[start + 2], a0 = data[start + 3];
  const matches = i => {
    const difference = Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) + Math.abs(data[i + 3] - a0);
    return difference <= tolerance;
  };
  if (options.contiguous === false) {
    for (let index = 0; index < w * h; index++) if (matches(index * 4)) mask[index] = 1;
    return mask;
  }
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  queue[tail++] = sy * w + sx;
  mask[sy * w + sx] = 1;
  while (head < tail) {
    const index = queue[head++];
    const x = index % w, y = index / w | 0;
    for (let side = 0; side < 4; side++) {
      const nx = x + (side === 0 ? -1 : side === 1 ? 1 : 0);
      const ny = y + (side === 2 ? -1 : side === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const neighbour = ny * w + nx;
      if (mask[neighbour]) continue;
      if (!matches(neighbour * 4)) continue;
      mask[neighbour] = 1;
      queue[tail++] = neighbour;
    }
  }
  return mask;
}

/* Marching squares round the mask, so a wand selection can crawl with the same
   marching ants as a lasso. The rings are only for showing and clipping — the
   mask itself stays the authority on which pixels are in. */
function maskContours(mask, w, h, threshold = .5) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > threshold;
  const seen = new Set();
  const contours = [];
  /* Walk each boundary edge once, following the wall on the left — the same
     square-tracing a flood fill's outline would use. */
  const edgeKey = (x, y, side) => `${x},${y},${side}`;
  const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = DIRECTIONS[side];
      if (inside(x + dx, y + dy)) continue;
      if (seen.has(edgeKey(x, y, side))) continue;
      const points = [];
      let cx = x, cy = y, current = side, guard = 0;
      do {
        seen.add(edgeKey(cx, cy, current));
        const corners = [[cx, cy], [cx + 1, cy], [cx + 1, cy + 1], [cx, cy + 1]];
        points.push({ x: corners[current][0], y: corners[current][1] });
        const next = (current + 1) & 3;
        const [nx, ny] = DIRECTIONS[next];
        if (!inside(cx + nx, cy + ny)) {
          current = next;
        } else {
          const diagonal = DIRECTIONS[current];
          if (inside(cx + nx + diagonal[0], cy + ny + diagonal[1])) {
            cx += nx + diagonal[0]; cy += ny + diagonal[1];
            current = (current + 3) & 3;
          } else {
            cx += nx; cy += ny;
          }
        }
      } while (++guard < w * h * 4 && !(cx === x && cy === y && current === side));
      if (points.length > 2) contours.push(points);
    }
  }
  return contours;
}

/* ------------------------------------------------------------------- eyes */

/* Red-eye: flash bounced off the retina leaves pixels whose red channel runs
   away from the other two. Those get their colour thrown away and their
   brightness pulled down, which is all any red-eye button has ever done. */
function removeRedEye(image, cx, cy, radius, tolerance = 50, darken = 40) {
  const w = image.width, h = image.height, data = image.data;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h - 1, Math.ceil(cy + radius));
  const limit = 1 + tolerance / 100;
  let changed = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const distance = Math.hypot(x + .5 - cx, y + .5 - cy);
    if (distance > radius) continue;
    const i = (y * w + x) * 4;
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    const rest = (green + blue) / 2;
    if (red <= rest * limit || red < 40) continue;
    const falloff = clamp(1 - (distance / radius) ** 3, 0, 1);
    const grey = green * .6 + blue * .4;
    const target = grey * (1 - darken / 100);
    data[i] = clampByte(red + (target - red) * falloff);
    data[i + 1] = clampByte(green + (target - green) * falloff * .5);
    data[i + 2] = clampByte(blue + (target - blue) * falloff * .5);
    changed++;
  }
  return changed;
}

/* ---------------------------------------------------------------- liquify */

/* The warp is a coarse grid of displacements, not one per pixel: a 4000 px
   picture would otherwise want 128 MB of mesh, and the brushes are smooth
   enough that nobody can see the interpolation. */
function makeWarpGrid(w, h, maxNodes = 320) {
  const step = Math.max(1, Math.ceil(Math.max(w, h) / maxNodes));
  const gw = Math.floor(w / step) + 2, gh = Math.floor(h / step) + 2;
  return { step, gw, gh, dx: new Float32Array(gw * gh), dy: new Float32Array(gw * gh) };
}

function warpBrush(grid, mode, cx, cy, radius, strength, moveX, moveY) {
  const { step, gw, gh, dx, dy } = grid;
  const g0x = Math.max(0, Math.floor((cx - radius) / step)), g1x = Math.min(gw - 1, Math.ceil((cx + radius) / step));
  const g0y = Math.max(0, Math.floor((cy - radius) / step)), g1y = Math.min(gh - 1, Math.ceil((cy + radius) / step));
  const power = clamp(strength, 0, 1);
  for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
    const px = gx * step, py = gy * step;
    const offsetX = px - cx, offsetY = py - cy;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > radius) continue;
    const t = 1 - distance / radius;
    const falloff = t * t * (3 - 2 * t) * power;
    const node = gy * gw + gx;
    if (mode === 'push') {
      /* The remap samples backwards, so pulling pixels one way means moving
         the sample point the other. */
      dx[node] -= moveX * falloff;
      dy[node] -= moveY * falloff;
    } else if (mode === 'bloat') {
      dx[node] -= offsetX * falloff * .35;
      dy[node] -= offsetY * falloff * .35;
    } else if (mode === 'pucker') {
      dx[node] += offsetX * falloff * .35;
      dy[node] += offsetY * falloff * .35;
    } else if (mode === 'twirl-right' || mode === 'twirl-left') {
      const angle = falloff * .35 * (mode === 'twirl-right' ? -1 : 1);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      dx[node] += offsetX * cos - offsetY * sin - offsetX;
      dy[node] += offsetX * sin + offsetY * cos - offsetY;
    } else if (mode === 'reconstruct') {
      dx[node] *= 1 - falloff;
      dy[node] *= 1 - falloff;
    }
  }
}

function sampleWarp(grid, x, y, out) {
  const { step, gw, gh, dx, dy } = grid;
  const gx = clamp(x / step, 0, gw - 1), gy = clamp(y / step, 0, gh - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const mix = plane => {
    const top = plane[y0 * gw + x0] * (1 - fx) + plane[y0 * gw + x1] * fx;
    const bottom = plane[y1 * gw + x0] * (1 - fx) + plane[y1 * gw + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  out[0] = mix(dx); out[1] = mix(dy);
  return out;
}

/* ------------------------------------------------------------- resampling */

/* Canvas can rescale a picture, but only its own way: one filter, chosen by
 * the browser, in gamma space, with no say in the matter. Shrinking a photo to
 * a 128-pixel display through it aliases — whole rows of pixels are simply not
 * looked at — and enlarging pixel art through it smears. So the resizing here
 * is done properly: a separable filter with a real support radius, widened
 * when shrinking so that every source pixel lands in some destination pixel,
 * run on premultiplied alpha so transparent edges cannot bleed their colour,
 * and optionally in linear light, where a half-lit pixel really is half the
 * light rather than half the number written in the file.
 *
 * Filter shapes are the standard ones: Mitchell & Netravali, "Reconstruction
 * Filters in Computer Graphics", SIGGRAPH 1988, for the two cubics, and the
 * windowed sinc for Lanczos. */

const SRGB_TO_LIGHT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIGHT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function lightToSrgb(value) {
  const c = clamp(value, 0, 1);
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

function cubic(t, b, c) {
  const x = Math.abs(t);
  if (x < 1) return ((12 - 9 * b - 6 * c) * x * x * x + (-18 + 12 * b + 6 * c) * x * x + (6 - 2 * b)) / 6;
  if (x < 2) return ((-b - 6 * c) * x * x * x + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + (8 * b + 24 * c)) / 6;
  return 0;
}
function lanczos(t, lobes) {
  const x = Math.abs(t);
  if (x < 1e-6) return 1;
  if (x >= lobes) return 0;
  const pix = Math.PI * x;
  return (lobes * Math.sin(pix) * Math.sin(pix / lobes)) / (pix * pix);
}

const RESAMPLE_FILTERS = {
  nearest: { label: 'Nearest neighbour (hard pixel edges)', radius: 0.5, sharp: true, kernel: () => 1 },
  box: { label: 'Box (area average)', radius: 0.5, kernel: t => (Math.abs(t) <= 0.5 ? 1 : 0) },
  triangle: { label: 'Bilinear (smooth)', radius: 1, kernel: t => Math.max(0, 1 - Math.abs(t)) },
  mitchell: { label: 'Mitchell (soft bicubic)', radius: 2, kernel: t => cubic(t, 1 / 3, 1 / 3) },
  catrom: { label: 'Bicubic (Catmull–Rom)', radius: 2, kernel: t => cubic(t, 0, 0.5) },
  lanczos3: { label: 'Lanczos 3 (sharpest)', radius: 3, kernel: t => lanczos(t, 3) }
};

/* One destination column (or row) at a time: which source samples feed it and
   how much of each. Shrinking widens the support so nothing is skipped. */
function resampleWeights(srcSize, dstSize, filter) {
  const ratio = dstSize / srcSize;
  /* nearest keeps its one-sample footprint however far the picture shrinks;
     everything else spreads out to average what it is throwing away */
  const scale = filter.sharp || ratio >= 1 ? 1 : ratio;
  const support = filter.radius / scale;
  const rows = [];
  for (let i = 0; i < dstSize; i++) {
    const centre = (i + 0.5) / ratio;
    const first = Math.max(0, Math.floor(centre - support + 0.5));
    const last = Math.min(srcSize - 1, Math.ceil(centre + support - 0.5));
    const weights = new Float32Array(Math.max(1, last - first + 1));
    let sum = 0;
    for (let j = first; j <= last; j++) {
      const weight = filter.kernel((j + 0.5 - centre) * scale);
      weights[j - first] = weight;
      sum += weight;
    }
    if (sum === 0) {
      /* a footprint that fell between samples: take the nearest one whole */
      const nearest = clamp(Math.round(centre - 0.5), 0, srcSize - 1);
      rows.push({ first: nearest, weights: Float32Array.of(1) });
      continue;
    }
    for (let k = 0; k < weights.length; k++) weights[k] /= sum;
    rows.push({ first, weights });
  }
  return rows;
}

/* image → a new ImageData of dstW × dstH. options.filter names one of
   RESAMPLE_FILTERS; options.linear resamples in linear light. */
function resample(image, dstW, dstH, options = {}) {
  const filter = RESAMPLE_FILTERS[options.filter] || RESAMPLE_FILTERS.lanczos3;
  const linear = !!options.linear;
  const srcW = image.width, srcH = image.height;
  const out = new ImageData(dstW, dstH);
  if (!srcW || !srcH) return out;
  const src = image.data, dst = out.data;

  /* horizontal pass, into premultiplied floats one source row tall */
  const columns = resampleWeights(srcW, dstW, filter);
  const rows = resampleWeights(srcH, dstH, filter);
  const middle = new Float32Array(dstW * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    const rowStart = y * srcW * 4, outStart = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const { first, weights } = columns[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const weight = weights[k];
        if (!weight) continue;
        const p = rowStart + (first + k) * 4;
        const alpha = src[p + 3] / 255;
        const wa = weight * alpha;
        r += (linear ? SRGB_TO_LIGHT[src[p]] : src[p]) * wa;
        g += (linear ? SRGB_TO_LIGHT[src[p + 1]] : src[p + 1]) * wa;
        b += (linear ? SRGB_TO_LIGHT[src[p + 2]] : src[p + 2]) * wa;
        a += weight * alpha;
      }
      const q = outStart + x * 4;
      middle[q] = r; middle[q + 1] = g; middle[q + 2] = b; middle[q + 3] = a;
    }
  }

  /* vertical pass, undoing the premultiply on the way out */
  for (let y = 0; y < dstH; y++) {
    const { first, weights } = rows[y];
    for (let x = 0; x < dstW; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const weight = weights[k];
        if (!weight) continue;
        const p = ((first + k) * dstW + x) * 4;
        r += middle[p] * weight; g += middle[p + 1] * weight;
        b += middle[p + 2] * weight; a += middle[p + 3] * weight;
      }
      const q = (y * dstW + x) * 4;
      if (a <= 1e-6) { dst[q] = dst[q + 1] = dst[q + 2] = dst[q + 3] = 0; continue; }
      const inv = 1 / a;
      dst[q] = clampByte(Math.round(linear ? lightToSrgb(r * inv) : r * inv));
      dst[q + 1] = clampByte(Math.round(linear ? lightToSrgb(g * inv) : g * inv));
      dst[q + 2] = clampByte(Math.round(linear ? lightToSrgb(b * inv) : b * inv));
      dst[q + 3] = clampByte(Math.round(a * 255));
    }
  }
  return out;
}

window.ClackRetouch = {
  makeMask, maskBounds, stampMask, dilateMask, erodeMask, featherMask,
  poissonBlend, stampSource, offsetImage, bestSourceOffset,
  inpaint, surfaceBlur, localContrast,
  magicWand, maskContours, removeRedEye,
  makeWarpGrid, warpBrush, sampleWarp,
  RESAMPLE_FILTERS, resample
};
})();
