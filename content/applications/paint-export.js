/* ClackPaint — exporting a picture as a program array.
 *
 * File → Export → As Program Array turns the canvas into something a
 * microcontroller can draw: a C array for the Arduino toolchain, a MicroPython
 * bytes literal, or the bare numbers. File → Import reads one back.
 *
 * Everything here is pure — ImageData and option objects in, bytes and text
 * out — so the same routines serve the dialog's live preview, its Copy button
 * and the importer's decoder. The dialog itself lives in paint.html; the
 * dithering comes from paint-dither.js, driven headlessly with a palette taken
 * from whatever pixel format is about to be packed, and the scaling from the
 * resampler in paint-retouch.js.
 *
 * The formats are the ones real displays and libraries ask for:
 *   - 1/2/4/8-bit greyscale, packed along rows or in SSD1306-style vertical
 *     pages, either bit order. Adafruit_GFX wants MSB first and rows padded to
 *     a byte; U8g2's XBM wants LSB first; MicroPython's framebuf calls the
 *     three combinations MONO_HLSB, MONO_HMSB and MONO_VLSB.
 *   - Indexed colour: a palette array plus 1/2/4/8-bit indices.
 *   - Packed RGB: 332, 565 (the workhorse of every ST7735 and ILI9341),
 *     888 and 8888.
 *   - YUV 4:2:2, YUYV or UYVY, BT.601 or BT.709, full or studio range.
 * plus a serpentine scan order, because LED matrices are wired in a zigzag and
 * every library ends up reimplementing the same fix.
 */
(() => {
'use strict';

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const clampByte = value => (value < 0 ? 0 : value > 255 ? 255 : value);

const hexToRgb = hex => {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ------------------------------------------------------------- geometry */

function blankImage(w, h, fill) {
  const image = new ImageData(Math.max(1, w), Math.max(1, h));
  if (!fill) return image;
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
  }
  return image;
}

/* source over destination, clipped to the destination, premultiply-free
   because both sides are 8-bit straight alpha and the background is opaque */
function blit(dst, src, dx, dy) {
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
  const x1 = Math.min(dst.width, dx + src.width), y1 = Math.min(dst.height, dy + src.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = ((y - dy) * src.width + (x - dx)) * 4;
      const d = (y * dst.width + x) * 4;
      const alpha = src.data[s + 3] / 255;
      if (alpha <= 0) continue;
      if (alpha >= 1) {
        dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1];
        dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = 255;
        continue;
      }
      const keep = 1 - alpha;
      dst.data[d] = Math.round(src.data[s] * alpha + dst.data[d] * keep);
      dst.data[d + 1] = Math.round(src.data[s + 1] * alpha + dst.data[d + 1] * keep);
      dst.data[d + 2] = Math.round(src.data[s + 2] * alpha + dst.data[d + 2] * keep);
      dst.data[d + 3] = Math.max(dst.data[d + 3], src.data[s + 3]);
    }
  }
  return dst;
}

function rotateImage(image, quarters, flipH, flipV) {
  const turns = ((Math.round((+quarters || 0) / 90) % 4) + 4) % 4;
  if (!turns && !flipH && !flipV) return image;
  const swap = turns % 2 === 1;
  const w = image.width, h = image.height;
  const out = new ImageData(swap ? h : w, swap ? w : h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = flipH ? w - 1 - x : x, sy = flipV ? h - 1 - y : y;
      let tx, ty;
      if (turns === 0) { tx = sx; ty = sy; }
      else if (turns === 1) { tx = h - 1 - sy; ty = sx; }
      else if (turns === 2) { tx = w - 1 - sx; ty = h - 1 - sy; }
      else { tx = sy; ty = w - 1 - sx; }
      const s = (y * w + x) * 4, d = (ty * out.width + tx) * 4;
      out.data[d] = image.data[s]; out.data[d + 1] = image.data[s + 1];
      out.data[d + 2] = image.data[s + 2]; out.data[d + 3] = image.data[s + 3];
    }
  }
  return out;
}

function scaleImage(image, w, h, options) {
  if (image.width === w && image.height === h) return image;
  const retouch = window.ClackRetouch;
  if (retouch && retouch.resample) return retouch.resample(image, w, h, options);
  /* the resampler is part of the app, but the module can be used without it */
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / w));
      const s = (sy * image.width + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = image.data[s]; out.data[d + 1] = image.data[s + 1];
      out.data[d + 2] = image.data[s + 2]; out.data[d + 3] = image.data[s + 3];
    }
  }
  return out;
}

const FIT_MODES = [
  ['contain', 'Fit inside — bars down the sides'],
  ['cover', 'Fill the screen — clip the overflow'],
  ['stretch', 'Stretch to fit — change the shape'],
  ['centre', 'Centre at actual size — no scaling'],
  ['tile', 'Tile at actual size — repeat to fill']
];

/* Rotate, scale and place the picture into the output rectangle. Native size
   with no rotation returns the source untouched, which is what the dialog
   opens on: nothing is resampled until you ask for a different size. */
function prepare(source, options = {}) {
  const background = hexToRgb(options.background || '#000000');
  const rotated = rotateImage(source, options.rotate, options.flipH, options.flipV);
  const w = Math.max(1, Math.round(+options.outWidth || rotated.width));
  const h = Math.max(1, Math.round(+options.outHeight || rotated.height));
  const fit = options.fit || 'contain';
  const filter = { filter: options.filter, linear: options.linearScale !== false };

  if (rotated.width === w && rotated.height === h && fit !== 'tile') {
    return options.flatten === false ? rotated : blit(blankImage(w, h, background), rotated, 0, 0);
  }

  const canvas = blankImage(w, h, background);
  if (fit === 'stretch') return blit(canvas, scaleImage(rotated, w, h, filter), 0, 0);

  if (fit === 'centre' || fit === 'tile') {
    if (fit === 'centre') {
      return blit(canvas, rotated, Math.round((w - rotated.width) / 2), Math.round((h - rotated.height) / 2));
    }
    for (let y = 0; y < h; y += rotated.height) {
      for (let x = 0; x < w; x += rotated.width) blit(canvas, rotated, x, y);
    }
    return canvas;
  }

  /* contain takes the smaller scale and leaves bars, cover takes the larger
     and lets the long side run off the edge; both keep the shape */
  const scale = fit === 'cover'
    ? Math.max(w / rotated.width, h / rotated.height)
    : Math.min(w / rotated.width, h / rotated.height);
  const sw = Math.max(1, Math.round(rotated.width * scale));
  const sh = Math.max(1, Math.round(rotated.height * scale));
  const scaled = scaleImage(rotated, sw, sh, filter);
  return blit(canvas, scaled, Math.round((w - sw) / 2), Math.round((h - sh) / 2));
}

/* -------------------------------------------------------------- palettes */

const PAINT_PALETTE_FALLBACK = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080',
  '#800080', '#808040', '#004040', '#0080FF', '#004080', '#8000FF', '#804000',
  '#FFFFFF', '#C0C0C0', '#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF',
  '#FF00FF', '#FFFF80', '#00FF80', '#80FFFF', '#8080FF', '#FF0080', '#FF8040'
];

const WEB_SAFE = (() => {
  const out = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) out.push([r * 51, g * 51, b * 51]);
  return out;
})();

/* Heckbert's median cut: put every pixel in one box, then repeatedly split the
   box with the widest colour spread at its median along that axis, until there
   are as many boxes as colours wanted. Each box becomes its average. */
function medianCut(image, count) {
  const wanted = clamp(count | 0, 2, 256);
  const data = image.data;
  const total = image.width * image.height;
  /* a few tens of thousands of samples decide a palette as well as millions */
  const stride = Math.max(1, Math.floor(total / 48000));
  const pixels = [];
  for (let i = 0; i < total; i += stride) {
    const p = i * 4;
    if (data[p + 3] < 8) continue;
    pixels.push([data[p], data[p + 1], data[p + 2]]);
  }
  if (!pixels.length) return [[0, 0, 0], [255, 255, 255]];

  let boxes = [pixels];
  while (boxes.length < wanted) {
    let target = -1, widest = -1, axis = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let channel = 0; channel < 3; channel++) {
        let low = 255, high = 0;
        for (const pixel of box) {
          if (pixel[channel] < low) low = pixel[channel];
          if (pixel[channel] > high) high = pixel[channel];
        }
        /* weight the spread the way the eye does, so a green range splits
           before an equally wide blue one */
        const spread = (high - low) * (channel === 0 ? 1.0 : channel === 1 ? 1.4 : 0.7);
        if (spread > widest) { widest = spread; target = index; axis = channel; }
      }
    });
    if (target < 0 || widest <= 0) break;
    const box = boxes[target];
    box.sort((a, b) => a[axis] - b[axis]);
    const middle = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, middle), box.slice(middle));
  }

  return boxes.filter(box => box.length).map(box => {
    let r = 0, g = 0, b = 0;
    for (const pixel of box) { r += pixel[0]; g += pixel[1]; b += pixel[2]; }
    return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)];
  });
}

const PALETTE_SOURCES = [
  ['median', 'Best colours from this picture'],
  ['paint', 'ClackPaint 28-colour box'],
  ['web', 'Web-safe (216 colours)'],
  ['gray', 'Even greys'],
  ['fgbg', 'Foreground and background colours']
];

function buildPalette(image, options, colours = {}) {
  const size = clamp(options.paletteSize | 0 || 16, 2, 256);
  switch (options.paletteSource) {
    case 'paint': return (colours.palette || PAINT_PALETTE_FALLBACK).map(hexToRgb).slice(0, size);
    case 'web': return WEB_SAFE.slice(0, size);
    case 'fgbg': return [hexToRgb(colours.bg || '#FFFFFF'), hexToRgb(colours.fg || '#000000')];
    case 'gray': {
      const out = [];
      for (let i = 0; i < size; i++) { const v = Math.round((i * 255) / (size - 1)); out.push([v, v, v]); }
      return out;
    }
    default: return medianCut(image, size);
  }
}

/* --------------------------------------------------------------- formats */

/* How many levels of each channel survive the pack. The dither aims at exactly
   these, so what it rounds to is what the format can store — anything else and
   the packer would quietly re-round the dithered pixels and undo the work. */
const RGB_PACKINGS = {
  rgb332: { label: 'RGB332 — 8 bits', bits: [3, 3, 2], bytes: 1 },
  rgb565: { label: 'RGB565 — 16 bits', bits: [5, 6, 5], bytes: 2 },
  bgr565: { label: 'BGR565 — 16 bits', bits: [5, 6, 5], bytes: 2, swap: true },
  rgb666: { label: 'RGB666 — 18 bits in 3 bytes', bits: [6, 6, 6], bytes: 3 },
  rgb888: { label: 'RGB888 — 24 bits', bits: [8, 8, 8], bytes: 3 },
  bgr888: { label: 'BGR888 — 24 bits', bits: [8, 8, 8], bytes: 3, swap: true },
  rgba8888: { label: 'RGBA8888 — 32 bits', bits: [8, 8, 8], bytes: 4, alpha: true },
  argb8888: { label: 'ARGB8888 — 32 bits', bits: [8, 8, 8], bytes: 4, alpha: true, alphaFirst: true }
};

const FORMATS = [
  ['mono', 'Mono / greyscale'],
  ['indexed', 'Indexed palette'],
  ['rgb', 'Packed RGB'],
  ['yuv422', 'YUV 4:2:2']
];

const SCAN_ORDERS = [
  ['rows', 'Rows, left to right'],
  ['columns', 'Columns, top to bottom'],
  ['pages', 'Vertical pages of 8 (SSD1306)']
];

/* the dither's target palette for a given output format */
function ditherTarget(options, palette) {
  if (options.format === 'indexed') return { palette: 'custom', customColours: palette };
  if (options.format === 'mono') {
    const levels = 1 << clamp(options.monoBits | 0 || 1, 1, 8);
    const list = [];
    for (let i = 0; i < levels; i++) list.push(Math.round((i * 255) / (levels - 1)));
    return { palette: 'custom-gray', customLevels: list };
  }
  if (options.format === 'rgb') {
    const packing = RGB_PACKINGS[options.pixelFormat] || RGB_PACKINGS.rgb565;
    return { palette: 'channels', channelLevels: packing.bits.map(bits => 1 << bits) };
  }
  /* 4:2:2 keeps eight bits a sample; the loss is in the chroma resolution,
     which no amount of dithering the RGB would help */
  return null;
}

/* ------------------------------------------------------------ quantising */

/* Runs the chosen dither (or a plain nearest-colour round) against the palette
   the format can actually store, and hands back the picture it produced. */
function quantise(image, options, colours = {}) {
  const palette = options.format === 'indexed' ? buildPalette(image, options, colours) : null;
  const target = ditherTarget(options, palette);
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  if (!target) return { image: out, palette };

  const dither = window.ClackDither;
  const group = options.ditherGroup;
  if (dither && group && group !== 'none' && dither.GROUPS[group]) {
    const values = dither.normalise(group, { ...dither.defaults(group, false), ...(options.ditherValues || {}) }, false);
    dither.apply(out, group, { ...values, ...target }, colours);
    return { image: out, palette };
  }
  if (dither) {
    /* no dither: the same quantiser, every pixel simply to its nearest colour,
       which is what the threshold group does with its plainest settings */
    dither.apply(out, 'threshold', {
      method: 'fixed', level: 128, linear: !!options.ditherValues?.linear, ...target
    }, colours);
  }
  return { image: out, palette };
}

/* ---------------------------------------------------------- scan orders */

/* Every packer walks the picture through one of these. A "line" is a run of
   pixels that may be padded to a whole byte; serpentine reverses every other
   one, the way an LED matrix is wired so the strip can carry on where it left
   off rather than jumping back to the far side. */
function scanLines(w, h, options) {
  const serpentine = !!options.serpentine;
  const lines = [];
  if (options.scan === 'columns') {
    for (let x = 0; x < w; x++) {
      const line = new Int32Array(h);
      for (let i = 0; i < h; i++) {
        const y = serpentine && x % 2 ? h - 1 - i : i;
        line[i] = y * w + x;
      }
      lines.push(line);
    }
    return lines;
  }
  for (let y = 0; y < h; y++) {
    const line = new Int32Array(w);
    for (let i = 0; i < w; i++) {
      const x = serpentine && y % 2 ? w - 1 - i : i;
      line[i] = y * w + x;
    }
    lines.push(line);
  }
  return lines;
}

/* ------------------------------------------------------------- packing */

function greyOf(data, p, weights) {
  return data[p] * weights[0] + data[p + 1] * weights[1] + data[p + 2] * weights[2];
}

const LUMA_601 = [0.299, 0.587, 0.114];
const LUMA_709 = [0.2126, 0.7152, 0.0722];

/* values are already quantised to `levels` steps; this returns the index of
   the step rather than its 0–255 value, which is what gets packed */
function levelIndex(value, levels) {
  return clamp(Math.round((value * (levels - 1)) / 255), 0, levels - 1);
}

function packLines(lines, bits, valueAt, options) {
  const bitOrder = options.bitOrder === 'lsb' ? 'lsb' : 'msb';
  const align = options.rowAlign !== false && bits < 8;
  const perLine = lines.length ? lines[0].length : 0;
  const lineBytes = align ? Math.ceil((perLine * bits) / 8) : 0;
  const total = align ? lineBytes * lines.length : Math.ceil((perLine * lines.length * bits) / 8);
  const bytes = new Uint8Array(total);
  let cursor = 0, used = 0;
  const perByte = 8 / bits;
  for (const line of lines) {
    if (align && used) { cursor++; used = 0; }
    for (let i = 0; i < line.length; i++) {
      const value = valueAt(line[i]) & ((1 << bits) - 1);
      const slot = bitOrder === 'msb' ? perByte - 1 - used : used;
      bytes[cursor] |= value << (slot * bits);
      if (++used === perByte) { cursor++; used = 0; }
    }
  }
  return bytes;
}

/* SSD1306 and its kin address the screen in pages: one byte holds eight
   pixels stacked vertically, and the pages run down the screen. */
function packPages(image, w, h, valueAt, options) {
  const topBit = options.bitOrder === 'msb';
  const pages = Math.ceil(h / 8);
  const bytes = new Uint8Array(pages * w);
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < w; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y >= h) break;
        if (!valueAt(y * w + x)) continue;
        byte |= 1 << (topBit ? 7 - bit : bit);
      }
      bytes[page * w + x] = byte;
    }
  }
  return bytes;
}

function encodeMono(image, options) {
  const w = image.width, h = image.height;
  const bits = clamp(options.monoBits | 0 || 1, 1, 8);
  const levels = 1 << bits;
  const weights = options.matrix === '709' ? LUMA_709 : LUMA_601;
  const data = image.data;
  const invert = !!options.invert;
  const valueAt = pixel => {
    const p = pixel * 4;
    const index = levelIndex(greyOf(data, p, weights), levels);
    return invert ? levels - 1 - index : index;
  };
  const bytes = bits === 1 && options.scan === 'pages'
    ? packPages(image, w, h, valueAt, options)
    : packLines(scanLines(w, h, options), bits, valueAt, options);
  return { bytes, unit: 1, bits, levels };
}

function encodeIndexed(image, options, palette) {
  const w = image.width, h = image.height;
  const bits = clamp(options.indexBits | 0 || 8, 1, 8);
  const data = image.data;
  /* the picture arrives already quantised to the palette, so this is a lookup
     rather than a search — but a search is the honest fallback for a colour
     that somehow is not in it */
  const lookup = new Map();
  palette.forEach(([r, g, b], index) => lookup.set((r << 16) | (g << 8) | b, index));
  const nearest = (r, g, b) => {
    let best = 0, bestDistance = Infinity;
    palette.forEach(([pr, pg, pb], index) => {
      const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    return best;
  };
  const valueAt = pixel => {
    const p = pixel * 4;
    const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    const found = lookup.get(key);
    return found === undefined ? nearest(data[p], data[p + 1], data[p + 2]) : found;
  };
  const bytes = packLines(scanLines(w, h, options), bits, valueAt, options);
  return { bytes, unit: 1, bits, palette };
}

function encodeRgb(image, options) {
  const w = image.width, h = image.height;
  const packing = RGB_PACKINGS[options.pixelFormat] || RGB_PACKINGS.rgb565;
  const [rb, gb, bb] = packing.bits;
  const little = options.endian === 'little';
  const data = image.data;
  const lines = scanLines(w, h, options);
  const bytes = new Uint8Array(lines.length * (lines[0]?.length || 0) * packing.bytes);
  let cursor = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i] * 4;
      let r = levelIndex(data[p], 1 << rb);
      let g = levelIndex(data[p + 1], 1 << gb);
      let b = levelIndex(data[p + 2], 1 << bb);
      if (packing.swap) { const t = r; r = b; b = t; }
      if (packing.bytes === 1) {
        bytes[cursor++] = (r << (gb + bb)) | (g << bb) | b;
      } else if (packing.bytes === 2) {
        const word = (r << (gb + bb)) | (g << bb) | b;
        if (little) { bytes[cursor++] = word & 255; bytes[cursor++] = word >> 8; }
        else { bytes[cursor++] = word >> 8; bytes[cursor++] = word & 255; }
      } else if (packing.bytes === 3) {
        /* 666 sits in the top six bits of each byte, the way an ILI9341 in
           18-bit mode reads it */
        const shift = rb === 6 ? 2 : 0;
        bytes[cursor++] = r << shift; bytes[cursor++] = g << shift; bytes[cursor++] = b << shift;
      } else {
        const alpha = data[p + 3];
        if (packing.alphaFirst) { bytes[cursor++] = alpha; bytes[cursor++] = r; bytes[cursor++] = g; bytes[cursor++] = b; }
        else { bytes[cursor++] = r; bytes[cursor++] = g; bytes[cursor++] = b; bytes[cursor++] = alpha; }
      }
    }
  }
  return { bytes, unit: packing.bytes === 2 ? 2 : 1, packing };
}

/* YUYV / UYVY: two pixels share one pair of colour-difference samples, so the
   run is four bytes long and the width has to be even. */
function encodeYuv422(image, options) {
  const w = image.width, h = image.height;
  const weights = options.matrix === '709' ? LUMA_709 : LUMA_601;
  const studio = options.range === 'studio';
  const average = options.chroma !== 'nearest';
  const data = image.data;
  const pairs = Math.floor(w / 2);
  const bytes = new Uint8Array(pairs * 2 * 2 * h);
  const uyvy = options.yuvOrder === 'uyvy';
  const sample = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const luma = greyOf(data, p, weights);
    return [luma, b - luma, r - luma, r, g, b];
  };
  /* the colour-difference scalings that put U and V in 0–255 around 128 */
  const kb = weights[2], kr = weights[0];
  const uScale = 0.5 / (1 - kb), vScale = 0.5 / (1 - kr);
  const encodeY = value => (studio ? Math.round(16 + (clamp(value, 0, 255) * 219) / 255) : Math.round(clamp(value, 0, 255)));
  const encodeC = value => {
    const centred = 128 + value;
    return studio ? Math.round(16 + (clamp(centred, 0, 255) * 224) / 255) : Math.round(clamp(centred, 0, 255));
  };
  let cursor = 0;
  for (let y = 0; y < h; y++) {
    for (let pair = 0; pair < pairs; pair++) {
      const left = sample(pair * 2, y), right = sample(pair * 2 + 1, y);
      const y0 = clampByte(encodeY(left[0])), y1 = clampByte(encodeY(right[0]));
      const u = average ? (left[1] + right[1]) / 2 : left[1];
      const v = average ? (left[2] + right[2]) / 2 : left[2];
      const cb = clampByte(encodeC(u * uScale)), cr = clampByte(encodeC(v * vScale));
      if (uyvy) { bytes[cursor++] = cb; bytes[cursor++] = y0; bytes[cursor++] = cr; bytes[cursor++] = y1; }
      else { bytes[cursor++] = y0; bytes[cursor++] = cb; bytes[cursor++] = y1; bytes[cursor++] = cr; }
    }
  }
  return { bytes, unit: 1, evenWidth: pairs * 2 };
}

/* a 1-bit stencil of where the picture is opaque, for the sprite-drawing calls
   that take an image and a mask */
function encodeMask(image, options) {
  const w = image.width, h = image.height;
  const data = image.data;
  const cutoff = clamp(options.maskCutoff | 0 || 128, 1, 255);
  const valueAt = pixel => (data[pixel * 4 + 3] >= cutoff ? 1 : 0);
  return options.scan === 'pages'
    ? packPages(image, w, h, valueAt, options)
    : packLines(scanLines(w, h, options), 1, valueAt, options);
}

function encode(image, options, palette) {
  switch (options.format) {
    case 'indexed': return encodeIndexed(image, options, palette || [[0, 0, 0], [255, 255, 255]]);
    case 'rgb': return encodeRgb(image, options);
    case 'yuv422': return encodeYuv422(image, options);
    default: return encodeMono(image, options);
  }
}

/* --------------------------------------------------------------- decoding */

/* The preview shows the bytes read back rather than the picture that went in,
   so a bit order or an endianness that does not match what the display expects
   is visible here rather than on the bench. The importer uses the same code. */

function unpackLines(bytes, w, h, bits, options, plot) {
  const bitOrder = options.bitOrder === 'lsb' ? 'lsb' : 'msb';
  const align = options.rowAlign !== false && bits < 8;
  const lines = scanLines(w, h, options);
  const perByte = 8 / bits;
  const mask = (1 << bits) - 1;
  let cursor = 0, used = 0;
  for (const line of lines) {
    if (align && used) { cursor++; used = 0; }
    for (let i = 0; i < line.length; i++) {
      const slot = bitOrder === 'msb' ? perByte - 1 - used : used;
      plot(line[i], (bytes[cursor] >> (slot * bits)) & mask);
      if (++used === perByte) { cursor++; used = 0; }
    }
  }
}

function unpackPages(bytes, w, h, options, plot) {
  const topBit = options.bitOrder === 'msb';
  const pages = Math.ceil(h / 8);
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < w; x++) {
      const byte = bytes[page * w + x] || 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y >= h) break;
        plot(y * w + x, (byte >> (topBit ? 7 - bit : bit)) & 1);
      }
    }
  }
}

function decode(bytes, options, palette) {
  const w = Math.max(1, options.width | 0), h = Math.max(1, options.height | 0);
  const image = blankImage(w, h, [0, 0, 0]);
  const data = image.data;
  const put = (pixel, r, g, b, a = 255) => {
    const p = pixel * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = a;
  };

  if (options.format === 'rgb') {
    const packing = RGB_PACKINGS[options.pixelFormat] || RGB_PACKINGS.rgb565;
    const [rb, gb, bb] = packing.bits;
    const little = options.endian === 'little';
    const lines = scanLines(w, h, options);
    let cursor = 0;
    const expand = (value, bits) => Math.round((value * 255) / ((1 << bits) - 1));
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        let r = 0, g = 0, b = 0, a = 255;
        if (packing.bytes === 1) {
          const byte = bytes[cursor++] || 0;
          r = (byte >> (gb + bb)) & ((1 << rb) - 1);
          g = (byte >> bb) & ((1 << gb) - 1);
          b = byte & ((1 << bb) - 1);
        } else if (packing.bytes === 2) {
          const first = bytes[cursor++] || 0, second = bytes[cursor++] || 0;
          const word = little ? first | (second << 8) : (first << 8) | second;
          r = (word >> (gb + bb)) & ((1 << rb) - 1);
          g = (word >> bb) & ((1 << gb) - 1);
          b = word & ((1 << bb) - 1);
        } else if (packing.bytes === 3) {
          const shift = rb === 6 ? 2 : 0;
          r = (bytes[cursor++] || 0) >> shift; g = (bytes[cursor++] || 0) >> shift; b = (bytes[cursor++] || 0) >> shift;
        } else {
          if (packing.alphaFirst) { a = bytes[cursor++] || 0; r = bytes[cursor++] || 0; g = bytes[cursor++] || 0; b = bytes[cursor++] || 0; }
          else { r = bytes[cursor++] || 0; g = bytes[cursor++] || 0; b = bytes[cursor++] || 0; a = bytes[cursor++] || 0; }
        }
        if (packing.swap) { const t = r; r = b; b = t; }
        put(line[i], expand(r, rb), expand(g, gb), expand(b, bb), a);
      }
    }
    return image;
  }

  if (options.format === 'yuv422') {
    const weights = options.matrix === '709' ? LUMA_709 : LUMA_601;
    const studio = options.range === 'studio';
    const uyvy = options.yuvOrder === 'uyvy';
    const kb = weights[2], kr = weights[0];
    const uScale = 0.5 / (1 - kb), vScale = 0.5 / (1 - kr);
    const pairs = Math.floor(w / 2);
    let cursor = 0;
    const decodeY = value => (studio ? ((value - 16) * 255) / 219 : value);
    const decodeC = value => (studio ? ((value - 16) * 255) / 224 : value) - 128;
    for (let y = 0; y < h; y++) {
      for (let pair = 0; pair < pairs; pair++) {
        let y0, y1, cb, cr;
        if (uyvy) { cb = bytes[cursor++] || 0; y0 = bytes[cursor++] || 0; cr = bytes[cursor++] || 0; y1 = bytes[cursor++] || 0; }
        else { y0 = bytes[cursor++] || 0; cb = bytes[cursor++] || 0; y1 = bytes[cursor++] || 0; cr = bytes[cursor++] || 0; }
        const u = decodeC(cb) / uScale, v = decodeC(cr) / vScale;
        for (const [offset, luma] of [[0, decodeY(y0)], [1, decodeY(y1)]]) {
          const r = luma + v, b = luma + u;
          const g = (luma - weights[0] * r - weights[2] * b) / weights[1];
          put(y * w + pair * 2 + offset, clampByte(Math.round(r)), clampByte(Math.round(g)), clampByte(Math.round(b)));
        }
      }
      /* an odd final column has no pair of its own; show it as its neighbour */
      if (w % 2) {
        const p = (y * w + w - 2) * 4;
        put(y * w + w - 1, data[p], data[p + 1], data[p + 2]);
      }
    }
    return image;
  }

  if (options.format === 'indexed') {
    const list = palette && palette.length ? palette : [[0, 0, 0], [255, 255, 255]];
    const bits = clamp(options.indexBits | 0 || 8, 1, 8);
    unpackLines(bytes, w, h, bits, options, (pixel, value) => {
      const colour = list[Math.min(value, list.length - 1)] || [255, 0, 255];
      put(pixel, colour[0], colour[1], colour[2]);
    });
    return image;
  }

  const bits = clamp(options.monoBits | 0 || 1, 1, 8);
  const levels = 1 << bits;
  const invert = !!options.invert;
  const plot = (pixel, value) => {
    const index = invert ? levels - 1 - value : value;
    const grey = Math.round((index * 255) / (levels - 1));
    put(pixel, grey, grey, grey);
  };
  if (bits === 1 && options.scan === 'pages') unpackPages(bytes, w, h, options, plot);
  else unpackLines(bytes, w, h, bits, options, plot);
  return image;
}

/* ------------------------------------------------------------- emitting */

const LANGUAGES = [
  ['arduino', 'Arduino / C'],
  ['micropython', 'MicroPython'],
  ['raw', 'Raw bytes']
];

/* What a library expects, so the awkward half of the settings — bit order,
   padding, endianness, the shape of the declaration — comes from naming the
   library rather than from getting three checkboxes right. */
const LIBRARIES = {
  generic: { label: 'Plain array (no library)', languages: ['arduino', 'micropython', 'raw'] },
  adafruit: {
    label: 'Adafruit_GFX — drawBitmap',
    languages: ['arduino'],
    apply: { format: 'mono', monoBits: 1, bitOrder: 'msb', scan: 'rows', rowAlign: true, serpentine: false },
    usage: name => [`display.drawBitmap(x, y, ${name}, ${name}_WIDTH, ${name}_HEIGHT, SSD1306_WHITE);`]
  },
  adafruit565: {
    label: 'Adafruit_GFX — drawRGBBitmap',
    languages: ['arduino'],
    apply: { format: 'rgb', pixelFormat: 'rgb565', endian: 'big', scan: 'rows', serpentine: false, wordOutput: 'words' },
    usage: name => [`tft.drawRGBBitmap(x, y, ${name}, ${name}_WIDTH, ${name}_HEIGHT);`]
  },
  u8g2: {
    label: 'U8g2 — XBM',
    languages: ['arduino'],
    apply: { format: 'mono', monoBits: 1, bitOrder: 'lsb', scan: 'rows', rowAlign: true, serpentine: false },
    usage: name => [`u8g2.drawXBMP(x, y, ${name}_WIDTH, ${name}_HEIGHT, ${name});`]
  },
  tft_espi: {
    label: 'TFT_eSPI — pushImage',
    languages: ['arduino'],
    apply: { format: 'rgb', pixelFormat: 'rgb565', endian: 'big', scan: 'rows', serpentine: false, wordOutput: 'words' },
    usage: name => [`tft.pushImage(x, y, ${name}_WIDTH, ${name}_HEIGHT, ${name});`]
  },
  lvgl: {
    label: 'LVGL — lv_img_dsc_t',
    languages: ['arduino'],
    apply: { format: 'rgb', pixelFormat: 'rgb565', endian: 'little', scan: 'rows', serpentine: false, wordOutput: 'bytes' },
    usage: name => [`lv_img_set_src(img, &${name}_dsc);`]
  },
  fastled: {
    label: 'FastLED — CRGB array',
    languages: ['arduino'],
    apply: { format: 'rgb', pixelFormat: 'rgb888', scan: 'rows', serpentine: true },
    usage: name => [`memcpy(leds, ${name}, sizeof(leds));  // ${name} is CRGB-ordered`]
  },
  framebuf: {
    label: 'MicroPython — framebuf',
    languages: ['micropython'],
    usage: (name, options) => {
      const mode = framebufMode(options);
      return mode
        ? [`fb = framebuf.FrameBuffer(${name}, ${name}_WIDTH, ${name}_HEIGHT, framebuf.${mode})`,
          `display.blit(fb, x, y)`]
        : [`# framebuf has no constant for this format — blit the bytes yourself`];
    }
  },
  displayio: {
    label: 'CircuitPython — displayio',
    languages: ['micropython'],
    apply: { format: 'indexed', indexBits: 8, scan: 'rows', serpentine: false, rowAlign: true },
    usage: name => [
      `bitmap = displayio.Bitmap(${name}_WIDTH, ${name}_HEIGHT, len(${name}_PALETTE) // 3)`,
      `# copy ${name} into bitmap, then show it with a TileGrid`
    ]
  }
};

function framebufMode(options) {
  if (options.format === 'mono') {
    if (options.monoBits === 1 || !options.monoBits) {
      if (options.scan === 'pages') return options.bitOrder === 'lsb' ? 'MONO_VLSB' : null;
      return options.bitOrder === 'lsb' ? 'MONO_HMSB' : 'MONO_HLSB';
    }
    if (options.monoBits === 2) return 'GS2_HMSB';
    if (options.monoBits === 4) return 'GS4_HMSB';
    if (options.monoBits === 8) return 'GS8';
  }
  if (options.format === 'rgb' && options.pixelFormat === 'rgb565') return 'RGB565';
  return null;
}

const identifierOf = name => {
  const cleaned = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `img_${cleaned}` || 'image';
};

function formatNumbers(values, options, indent, unit) {
  const hex = options.radix !== 'dec';
  const digits = unit === 4 ? 8 : unit === 2 ? 4 : 2;
  const perLine = clamp(options.perLine | 0 || (unit === 1 ? 12 : 8), 1, 64);
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    const chunk = [];
    for (let j = i; j < Math.min(i + perLine, values.length); j++) {
      chunk.push(hex ? '0x' + values[j].toString(16).toUpperCase().padStart(digits, '0') : String(values[j]));
    }
    lines.push(indent + chunk.join(', ') + (i + perLine < values.length ? ',' : ''));
  }
  return lines.join('\n');
}

/* 16-bit formats can go out as words — easier to read, and what pushImage
   wants — or as the bytes that would go down the wire. */
function elementsOf(result, options) {
  if (result.unit !== 2 || options.wordOutput === 'bytes') return { values: Array.from(result.bytes), unit: 1 };
  const words = [];
  const little = options.endian === 'little';
  for (let i = 0; i + 1 < result.bytes.length; i += 2) {
    words.push(little ? result.bytes[i] | (result.bytes[i + 1] << 8) : (result.bytes[i] << 8) | result.bytes[i + 1]);
  }
  return { values: words, unit: 2 };
}

function paletteValues(palette, options) {
  if (options.paletteFormat === 'rgb565') {
    return {
      values: palette.map(([r, g, b]) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)),
      unit: 2, type: 'uint16_t', typecode: 'H'
    };
  }
  if (options.paletteFormat === 'rgb332') {
    return {
      values: palette.map(([r, g, b]) => ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6)),
      unit: 1, type: 'uint8_t', typecode: 'B'
    };
  }
  return { values: palette.flat(), unit: 1, type: 'uint8_t', typecode: 'B', triples: true };
}

function summaryLines(result, options, meta) {
  const lines = [];
  const shape = `${meta.width} × ${meta.height}`;
  if (options.format === 'mono') {
    lines.push(`${shape}, ${result.bits} bpp ${result.bits === 1 ? 'mono' : 'greyscale'}, ${options.bitOrder === 'lsb' ? 'LSB' : 'MSB'} first, ${options.scan === 'pages' ? 'vertical pages of 8' : options.scan === 'columns' ? 'column order' : 'row order'}${options.serpentine ? ', serpentine' : ''}${options.invert ? ', inverted' : ''}`);
  } else if (options.format === 'indexed') {
    lines.push(`${shape}, ${result.bits} bpp indexed, ${result.palette.length} colours`);
  } else if (options.format === 'rgb') {
    lines.push(`${shape}, ${result.packing.label}${result.packing.bytes > 1 ? `, ${options.endian === 'little' ? 'little' : 'big'}-endian` : ''}${options.serpentine ? ', serpentine' : ''}`);
  } else {
    lines.push(`${shape}, YUV 4:2:2 ${options.yuvOrder === 'uyvy' ? 'UYVY' : 'YUYV'}, BT.${options.matrix === '709' ? '709' : '601'}, ${options.range === 'studio' ? 'studio' : 'full'} range`);
  }
  if (options.ditherGroup && options.ditherGroup !== 'none' && window.ClackDither?.GROUPS[options.ditherGroup]) {
    lines.push(`Dithered: ${window.ClackDither.GROUPS[options.ditherGroup].label}`);
  }
  lines.push(`${result.bytes.length.toLocaleString()} bytes`);
  return lines;
}

function cType(unit) {
  return unit === 4 ? 'uint32_t' : unit === 2 ? 'uint16_t' : 'uint8_t';
}

function emitArduino(result, options, meta) {
  const name = identifierOf(options.name).toUpperCase();
  const library = LIBRARIES[options.library] || LIBRARIES.generic;
  const { values, unit } = elementsOf(result, options);
  const store = options.progmem ? ' PROGMEM' : '';
  const lines = [];

  if (options.comments !== false) lines.push('// ' + summaryLines(result, options, meta).join('\n// '), '');
  lines.push('#pragma once', '#include <stdint.h>');
  if (options.progmem) lines.push('#include <avr/pgmspace.h>');
  lines.push('');
  if (options.dimensions !== false) {
    lines.push(`#define ${name}_WIDTH  ${meta.width}`, `#define ${name}_HEIGHT ${meta.height}`, '');
  }

  if (result.palette) {
    const palette = paletteValues(result.palette, options);
    if (options.comments !== false) {
      lines.push(palette.triples ? '// palette, three bytes a colour' : '// palette');
    }
    lines.push(`const ${palette.type} ${name}_PALETTE[${palette.values.length}]${store} = {`);
    lines.push(formatNumbers(palette.values, options, '  ', palette.unit));
    lines.push('};', '');
  }

  lines.push(`const ${cType(unit)} ${name}[${values.length}]${store} = {`);
  lines.push(formatNumbers(values, options, '  ', unit));
  lines.push('};', '');

  if (result.mask) {
    if (options.comments !== false) lines.push('// 1 where the picture is opaque');
    lines.push(`const uint8_t ${name}_MASK[${result.mask.length}]${store} = {`);
    lines.push(formatNumbers(Array.from(result.mask), options, '  ', 1));
    lines.push('};', '');
  }

  if (options.comments !== false && library.usage) {
    lines.push('// usage', ...library.usage(name, options).map(line => '//   ' + line));
  }
  return lines.join('\n') + '\n';
}

/* MicroPython wants the bytes as a literal far more often than as a list: a
   bytes object can be handed straight to framebuf without copying. */
function pythonBytes(bytes, perLine) {
  const lines = [];
  const width = clamp(perLine | 0 || 16, 1, 64);
  for (let i = 0; i < bytes.length; i += width) {
    let text = '';
    for (let j = i; j < Math.min(i + width, bytes.length); j++) {
      text += '\\x' + bytes[j].toString(16).padStart(2, '0');
    }
    lines.push(`    b'${text}'`);
  }
  return lines.length ? lines.join('\n') : "    b''";
}

function emitMicroPython(result, options, meta) {
  const name = identifierOf(options.name).toUpperCase();
  const library = LIBRARIES[options.library] || LIBRARIES.generic;
  const lines = [];

  const palette = result.palette ? paletteValues(result.palette, options) : null;
  if (options.comments !== false) lines.push('# ' + summaryLines(result, options, meta).join('\n# '), '');
  if (options.library === 'framebuf' || framebufMode(options)) lines.push('import framebuf');
  /* 16-bit palette entries are an array of words rather than a bytes object */
  if (palette && palette.unit === 2) lines.push('from array import array');
  if (lines[lines.length - 1] !== '') lines.push('');
  if (options.dimensions !== false) {
    lines.push(`${name}_WIDTH = ${meta.width}`, `${name}_HEIGHT = ${meta.height}`, '');
  }

  if (palette) {
    lines.push(`${name}_PALETTE = ${palette.unit === 2 ? "array('H', (" : 'bytes(('}`);
    lines.push(formatNumbers(palette.values, options, '    ', palette.unit));
    lines.push('))', '');
  }

  /* bytearray rather than bytes when framebuf is in the picture: a
     FrameBuffer over a read-only object cannot be drawn into */
  const holder = options.mutable === false ? 'bytes' : 'bytearray';
  lines.push(`${name} = ${holder}(`);
  lines.push(pythonBytes(result.bytes, options.perLine));
  lines.push(')', '');

  if (result.mask) {
    lines.push(`${name}_MASK = ${holder}(`);
    lines.push(pythonBytes(result.mask, options.perLine));
    lines.push(')', '');
  }

  if (options.comments !== false && library.usage) {
    lines.push('# usage', ...library.usage(name, options).map(line => '#   ' + line));
  } else if (options.comments !== false && framebufMode(options)) {
    lines.push('# usage', `#   fb = framebuf.FrameBuffer(${name}, ${name}_WIDTH, ${name}_HEIGHT, framebuf.${framebufMode(options)})`);
  }
  return lines.join('\n') + '\n';
}

function emitRaw(result, options, meta) {
  const { values, unit } = elementsOf(result, options);
  const lines = [];
  if (options.comments) lines.push(...summaryLines(result, options, meta).map(line => '// ' + line));
  lines.push(formatNumbers(values, options, '', unit));
  return lines.join('\n') + '\n';
}

function emit(result, options, meta) {
  if (options.language === 'micropython') return emitMicroPython(result, options, meta);
  if (options.language === 'raw') return emitRaw(result, options, meta);
  return emitArduino(result, options, meta);
}

/* --------------------------------------------------------------- budgets */

/* Bytes on their own do not say much; "a third of an Uno" does. Flash figures
   are the usable part after the bootloader where there is one. */
const MCUS = [
  { id: 'attiny85', label: 'ATtiny85', flash: 8 * 1024, ram: 512 },
  { id: 'uno', label: 'Arduino Uno / Nano (ATmega328P)', flash: 32 * 1024 - 512, ram: 2 * 1024 },
  { id: 'mega', label: 'Arduino Mega 2560', flash: 256 * 1024 - 8192, ram: 8 * 1024 },
  { id: 'bluepill', label: 'STM32F103C8 "Blue Pill"', flash: 64 * 1024, ram: 20 * 1024 },
  { id: 'esp8266', label: 'ESP8266 (NodeMCU)', flash: 1024 * 1024, ram: 80 * 1024 },
  { id: 'esp32', label: 'ESP32 (4 MB module)', flash: 4 * 1024 * 1024, ram: 320 * 1024 },
  { id: 'rp2040', label: 'Raspberry Pi Pico (RP2040)', flash: 2 * 1024 * 1024, ram: 264 * 1024 },
  { id: 'microbit', label: 'micro:bit v2 (nRF52833)', flash: 512 * 1024, ram: 128 * 1024 },
  { id: 'teensy40', label: 'Teensy 4.0', flash: 2 * 1024 * 1024, ram: 1024 * 1024 }
];

function budget(bytes) {
  return MCUS.map(mcu => ({
    ...mcu,
    flashPercent: (bytes / mcu.flash) * 100,
    ramPercent: (bytes / mcu.ram) * 100,
    fitsFlash: bytes <= mcu.flash,
    fitsRam: bytes <= mcu.ram
  }));
}

const humanBytes = bytes => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 2 : 1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
};

/* --------------------------------------------------------------- presets */

/* Everything a given screen needs in one go: the size, the pixel format, and
   the bit order and scan its controller reads. */
const PRESETS = [
  { id: 'native', label: 'Native — this picture\'s own size', native: true },
  {
    id: 'ssd1306-128x64', label: 'SSD1306 OLED — 128 × 64', width: 128, height: 64,
    options: { format: 'mono', monoBits: 1, scan: 'pages', bitOrder: 'lsb', invert: false, library: 'framebuf', language: 'micropython' }
  },
  {
    id: 'ssd1306-128x32', label: 'SSD1306 OLED — 128 × 32', width: 128, height: 32,
    options: { format: 'mono', monoBits: 1, scan: 'pages', bitOrder: 'lsb', invert: false, library: 'framebuf', language: 'micropython' }
  },
  {
    id: 'sh1106-128x64', label: 'SH1106 OLED — 128 × 64', width: 128, height: 64,
    options: { format: 'mono', monoBits: 1, scan: 'pages', bitOrder: 'lsb', invert: false, library: 'framebuf', language: 'micropython' }
  },
  {
    id: 'gfx-mono', label: 'Adafruit_GFX bitmap — 128 × 64', width: 128, height: 64,
    options: { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'msb', rowAlign: true, library: 'adafruit', language: 'arduino' }
  },
  {
    id: 'st7735-160x128', label: 'ST7735 TFT — 160 × 128', width: 160, height: 128,
    options: { format: 'rgb', pixelFormat: 'rgb565', endian: 'big', library: 'adafruit565', language: 'arduino' }
  },
  {
    id: 'ili9341-320x240', label: 'ILI9341 TFT — 320 × 240', width: 320, height: 240,
    options: { format: 'rgb', pixelFormat: 'rgb565', endian: 'big', library: 'tft_espi', language: 'arduino' }
  },
  {
    id: 'st7789-240x240', label: 'ST7789 TFT — 240 × 240', width: 240, height: 240,
    options: { format: 'rgb', pixelFormat: 'rgb565', endian: 'big', library: 'tft_espi', language: 'arduino' }
  },
  {
    id: 'epaper-296x128', label: 'e-Paper 2.9" — 296 × 128', width: 296, height: 128,
    options: { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'msb', rowAlign: true, library: 'generic', language: 'arduino' }
  },
  {
    id: 'ws2812-16x16', label: 'WS2812 matrix — 16 × 16', width: 16, height: 16,
    options: { format: 'rgb', pixelFormat: 'rgb888', serpentine: true, scan: 'rows', library: 'fastled', language: 'arduino', ditherGroup: 'none' }
  },
  {
    id: 'ws2812-8x8', label: 'WS2812 matrix — 8 × 8', width: 8, height: 8,
    options: { format: 'rgb', pixelFormat: 'rgb888', serpentine: true, scan: 'rows', library: 'fastled', language: 'arduino', ditherGroup: 'none' }
  },
  {
    id: 'sensehat-8x8', label: 'Sense HAT LED matrix — 8 × 8', width: 8, height: 8,
    options: { format: 'rgb', pixelFormat: 'rgb888', serpentine: false, scan: 'rows', library: 'generic', language: 'micropython', ditherGroup: 'none' }
  },
  { id: 'custom', label: 'Custom size…', custom: true }
];

/* ---------------------------------------------------------------- import */

/* Reads back anything this module writes, and most of what other tools do:
   C arrays, Python bytes literals, bare hex, base-10 lists. */
function parse(text) {
  const source = String(text || '');
  const bytes = [];
  let unit = 1;

  /* a Python bytes literal wins outright — its escapes are unambiguous */
  const literals = source.match(/b(['"])(?:\\.|(?!\1).)*\1/g);
  if (literals && literals.length) {
    for (const literal of literals) {
      const body = literal.slice(2, -1);
      for (let i = 0; i < body.length;) {
        if (body[i] === '\\' && (body[i + 1] === 'x' || body[i + 1] === 'X')) {
          bytes.push(parseInt(body.slice(i + 2, i + 4), 16) || 0); i += 4;
        } else if (body[i] === '\\' && body[i + 1] === '\\') { bytes.push(92); i += 2; }
        else if (body[i] === '\\' && body[i + 1] === 'n') { bytes.push(10); i += 2; }
        else if (body[i] === '\\' && body[i + 1] === 'r') { bytes.push(13); i += 2; }
        else if (body[i] === '\\' && body[i + 1] === 't') { bytes.push(9); i += 2; }
        else if (body[i] === '\\' && body[i + 1] === '0') { bytes.push(0); i += 2; }
        else { bytes.push(body.charCodeAt(i) & 255); i += 1; }
      }
    }
    return { bytes: Uint8Array.from(bytes), unit: 1, hints: hintsFrom(source) };
  }

  /* otherwise: every number in the text, minus the ones that are plainly
     dimensions rather than data */
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*(?:\/\/|#).*$/gm, ' ')
    .replace(/^[ \t]*#\s*(?:include|pragma|define)[^\n]*$/gm, ' ')
    /* the length in `uint8_t LOGO[1024] PROGMEM = {` is not one of the bytes.
       Only a bracket that declares something is dropped, so a Python list of
       data keeps its numbers. */
    .replace(/\[\s*\d*\s*\](?=\s*(?:PROGMEM|__attribute|=|;))/g, ' ');
  const numbers = stripped.match(/0[xX][0-9a-fA-F]+|\b\d+\b/g) || [];
  const values = numbers.map(token => (/^0[xX]/.test(token) ? parseInt(token, 16) : parseInt(token, 10)))
    .filter(value => Number.isFinite(value));
  /* array-length declarations and #defines are already gone; anything over
     255 means the data is words, so keep both readings */
  const wide = values.some(value => value > 255);
  if (wide) {
    unit = 2;
    for (const value of values) { bytes.push((value >> 8) & 255, value & 255); }
  } else {
    for (const value of values) bytes.push(value & 255);
  }
  return { bytes: Uint8Array.from(bytes), unit, hints: hintsFrom(source) };
}

/* Width, height and format are usually written down somewhere near the data —
   in a #define, in a framebuf call, or in the comment this exporter leaves. */
function hintsFrom(source) {
  const hints = {};
  const size = source.match(/(\d{1,5})\s*(?:×|x|\*)\s*(\d{1,5})/);
  if (size) { hints.width = +size[1]; hints.height = +size[2]; }
  const defineW = source.match(/#define\s+\w*WIDTH\s+(\d+)/i) || source.match(/^\s*\w*WIDTH\s*=\s*(\d+)/mi);
  const defineH = source.match(/#define\s+\w*HEIGHT\s+(\d+)/i) || source.match(/^\s*\w*HEIGHT\s*=\s*(\d+)/mi);
  if (defineW) hints.width = +defineW[1];
  if (defineH) hints.height = +defineH[1];
  const mode = source.match(/framebuf\.(MONO_VLSB|MONO_HLSB|MONO_HMSB|GS2_HMSB|GS4_HMSB|GS8|RGB565)/);
  if (mode) {
    const map = {
      MONO_VLSB: { format: 'mono', monoBits: 1, scan: 'pages', bitOrder: 'lsb' },
      MONO_HLSB: { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'msb' },
      MONO_HMSB: { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'lsb' },
      GS2_HMSB: { format: 'mono', monoBits: 2, scan: 'rows', bitOrder: 'msb' },
      GS4_HMSB: { format: 'mono', monoBits: 4, scan: 'rows', bitOrder: 'msb' },
      GS8: { format: 'mono', monoBits: 8, scan: 'rows', bitOrder: 'msb' },
      RGB565: { format: 'rgb', pixelFormat: 'rgb565', endian: 'little' }
    };
    Object.assign(hints, map[mode[1]]);
  }
  if (/XBM|drawXBM/i.test(source)) Object.assign(hints, { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'lsb' });
  else if (/drawBitmap/i.test(source)) Object.assign(hints, { format: 'mono', monoBits: 1, scan: 'rows', bitOrder: 'msb' });
  if (/drawRGBBitmap|pushImage/i.test(source)) Object.assign(hints, { format: 'rgb', pixelFormat: 'rgb565', endian: 'big' });
  const named = source.match(/\bRGB(332|565|666|888)\b/i);
  if (named) Object.assign(hints, { format: 'rgb', pixelFormat: 'rgb' + named[1] });
  if (/\bUYVY\b/i.test(source)) Object.assign(hints, { format: 'yuv422', yuvOrder: 'uyvy' });
  else if (/\bYUYV\b/i.test(source)) Object.assign(hints, { format: 'yuv422', yuvOrder: 'yuyv' });
  return hints;
}

/* How many bytes a given size and format should come to — the importer uses it
   to work out which of the plausible widths actually matches the data. */
function byteLength(width, height, options) {
  const w = Math.max(1, width | 0), h = Math.max(1, height | 0);
  if (options.format === 'rgb') {
    const packing = RGB_PACKINGS[options.pixelFormat] || RGB_PACKINGS.rgb565;
    return w * h * packing.bytes;
  }
  if (options.format === 'yuv422') return Math.floor(w / 2) * 4 * h;
  const bits = options.format === 'indexed'
    ? clamp(options.indexBits | 0 || 8, 1, 8)
    : clamp(options.monoBits | 0 || 1, 1, 8);
  if (options.format === 'mono' && bits === 1 && options.scan === 'pages') return Math.ceil(h / 8) * w;
  const across = options.scan === 'columns' ? h : w;
  const lines = options.scan === 'columns' ? w : h;
  const align = options.rowAlign !== false && bits < 8;
  return align ? Math.ceil((across * bits) / 8) * lines : Math.ceil((across * lines * bits) / 8);
}

/* Given a byte count and a format, the sizes that would use exactly that many
   bytes — offered to the importer when the text says nothing about its shape */
function candidateSizes(length, options, limit = 12) {
  const out = [];
  /* the whole range is searched before any are thrown away: stopping at the
     first few would only ever offer the tall thin shapes that come of the
     narrowest widths */
  for (let width = 1; width <= 2048; width++) {
    const height = Math.round(length / Math.max(1, byteLength(width, 1, options)));
    if (height < 1 || height > 4096) continue;
    if (byteLength(width, height, options) === length) out.push({ width, height });
  }
  /* the sensible ones first: nearest to a 4:3-ish shape, and round numbers */
  const score = ({ width, height }) => {
    const ratio = width / height;
    const shape = Math.min(Math.abs(ratio - 4 / 3), Math.abs(ratio - 1), Math.abs(ratio - 16 / 9), Math.abs(ratio - 2));
    const round = (width % 8 === 0 ? 0 : 1) + (height % 8 === 0 ? 0 : 1);
    return shape + round * 0.35;
  };
  return out.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

window.ClackExport = {
  FORMATS, FIT_MODES, SCAN_ORDERS, PRESETS, LIBRARIES, LANGUAGES, MCUS,
  PALETTE_SOURCES, RGB_PACKINGS,
  prepare, quantise, encode, encodeMask, decode, emit, parse,
  buildPalette, medianCut, budget, byteLength, candidateSizes,
  identifierOf, humanBytes, framebufMode, summaryLines
};
})();
