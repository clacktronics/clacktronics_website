/* ClackPaint — File ▸ Open ▸ As Raw Data…
 *
 * Opens any file at all as a picture, by being told nothing about it and
 * guessing the rest: where the pixels start, how wide a line is, and how a
 * pixel is spelled. GIMP's raw loader is the model, and everything it offers
 * is here — offset, geometry, its list of image types, a palette read from a
 * file — with the parts that make the hunt bearable added on top: a preview
 * that redraws while the offset slider is dragged, a width guessed from the
 * data itself, and the file's own header shown in hex so the bytes being
 * skipped are visible rather than counted.
 *
 * The decoders are paint-export.js's, run backwards, exactly as the program
 * array importer does — so anything ClackPaint exported as a .bin reopens here
 * byte for byte. Only the shapes that module has no use for are implemented
 * below: planar RGB, 16-bit greyscale, and the elevation tiles that come in it.
 */
(() => {
'use strict';

let host = null;
const el = id => host.appRoot.querySelector('#' + id);

const SETTINGS_KEY = 'clackpaint-raw-settings';
/* A preview redrawn on every drag of the offset slider has to stay cheap, so
   it decodes only the rows that fit this budget and says how many it showed.
   The full geometry is decoded once, when the picture is actually opened. */
const PREVIEW_PIXELS = 1.2e6;
const OPEN_PIXELS = 32e6;
const HEX_BYTES = 256;

const DEFAULTS = {
  format: 'mono', monoBits: 8, invert: false,
  indexBits: 8, paletteOrder: 'rgb', paletteEntry: 3, paletteOffset: 0,
  pixelFormat: 'rgb888', endian: 'big',
  planes: 3, planeOrder: 'rgb',
  greyEndian: 'big', greySigned: false, greyAuto: true, greyRamp: 'grey',
  yuvOrder: 'yuyv', matrix: '601', range: 'full',
  scan: 'rows', serpentine: false, bitOrder: 'msb', rowAlign: true,
  offset: 0, stride: 0, width: 0, height: 0, flipH: false, flipV: false
};

let values = { ...DEFAULTS };
let bytes = null;              /* the whole file, verbatim */
let sourceName = 'raw.bin';
let palette = null;            /* [[r,g,b], …] once a palette file is read */
let paletteName = '';
let preview = null;            /* the ImageData last drawn, for the summary */
let previewRows = 0;
let sniffed = null;            /* what the header looked like, if anything */
let pendingFile = null;        /* kept so "open it properly" has something to open */
let building = false, redrawTimer = 0, zoomed = false;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const api = () => window.ClackExport;
const humanBytes = n => (api()?.humanBytes ? api().humanBytes(n) : `${n} B`);

/* ------------------------------------------------------------ geometry */

/* Formats paint-export.js does not know about are measured here; everything
   else is measured by the module that will decode it, so the two can never
   disagree about how many bytes a line takes. */
function byteLengthOf(width, height, options) {
  const w = Math.max(1, width | 0), h = Math.max(1, height | 0);
  if (options.format === 'planar') return w * h * clamp(options.planes | 0 || 3, 3, 4);
  if (options.format === 'gray16') return w * h * 2;
  return api().byteLength(w, h, options);
}

/* The bytes one line of the picture occupies, which is what a stride is
   measured against and what a guessed width is worked back from. */
function rowBytesOf(width, options) {
  if (options.scan !== 'rows') return 0;
  if (options.format === 'planar' || options.format === 'gray16') {
    return byteLengthOf(width, 1, options);
  }
  return api().byteLength(width, 1, options);
}

function widthForRowBytes(rowBytes, options) {
  if (rowBytes <= 0) return 0;
  if (options.format === 'gray16') return Math.round(rowBytes / 2);
  if (options.format === 'planar') return Math.round(rowBytes / clamp(options.planes | 0 || 3, 3, 4));
  if (options.format === 'rgb') {
    const packing = api().RGB_PACKINGS[options.pixelFormat] || api().RGB_PACKINGS.rgb565;
    return Math.round(rowBytes / packing.bytes);
  }
  if (options.format === 'yuv422') return Math.round(rowBytes / 2);
  const bits = options.format === 'indexed'
    ? clamp(options.indexBits | 0 || 8, 1, 8)
    : clamp(options.monoBits | 0 || 1, 1, 8);
  return Math.max(1, Math.floor((rowBytes * 8) / bits));
}

/* The sizes that would use exactly the bytes left after the offset. For the
   formats paint-export.js handles this is its own search; the two extra
   formats get the same treatment with the local measurement. */
function candidateSizes(length, options, limit = 12) {
  if (options.format !== 'planar' && options.format !== 'gray16') {
    return api().candidateSizes(length, options, limit);
  }
  const out = [];
  const unit = options.format === 'gray16' ? 2 : clamp(options.planes | 0 || 3, 3, 4);
  if (length % unit) return out;
  const pixels = length / unit;
  for (let width = 1; width <= 4096; width++) {
    if (pixels % width) continue;
    const height = pixels / width;
    if (height < 1 || height > 8192) continue;
    out.push({ width, height });
  }
  const score = ({ width, height }) => {
    const ratio = width / height;
    const shape = Math.min(Math.abs(ratio - 4 / 3), Math.abs(ratio - 1), Math.abs(ratio - 16 / 9), Math.abs(ratio - 2));
    return shape + ((width % 8 ? 1 : 0) + (height % 8 ? 1 : 0)) * 0.35;
  };
  return out.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

/* -------------------------------------------------------------- reading */

/* What the decoder is handed: the file from the offset on, and — when a line
   is longer on disk than in the picture, as it is for anything aligned to a
   4-byte boundary — the padding taken back out, since the decoders below all
   expect lines packed end to end. */
function viewFor(options, rows) {
  const start = clamp(options.offset | 0, 0, bytes.length);
  const body = bytes.subarray(start);
  const stride = options.stride | 0;
  const natural = rowBytesOf(options.width, options);
  if (!stride || !natural || stride === natural || options.format === 'planar') return body;
  const out = new Uint8Array(natural * rows);
  for (let y = 0; y < rows; y++) {
    const from = y * stride;
    if (from >= body.length) break;
    out.set(body.subarray(from, Math.min(body.length, from + natural)), y * natural);
  }
  return out;
}

/* Three planes one after another rather than three bytes per pixel — how a
   good deal of scientific and scanner data is written, and the one GIMP image
   type paint-export.js has no use for. */
function decodePlanar(view, options) {
  const w = Math.max(1, options.width | 0), h = Math.max(1, options.height | 0);
  const planes = clamp(options.planes | 0 || 3, 3, 4);
  const image = new ImageData(w, h);
  const data = image.data;
  const size = w * h;
  const order = options.planeOrder === 'bgr' ? [2, 1, 0] : [0, 1, 2];
  for (let i = 0; i < size; i++) {
    const p = i * 4;
    data[p + order[0]] = view[i] || 0;
    data[p + order[1]] = view[size + i] || 0;
    data[p + order[2]] = view[size * 2 + i] || 0;
    data[p + 3] = planes === 4 ? (view[size * 3 + i] ?? 255) : 255;
  }
  return image;
}

/* A colour for a height. Terrain is the reason 16-bit greyscale is here at
   all — an elevation tile in flat grey is nearly black everywhere, because its
   whole range is a few hundred of the 65,536 values available to it. */
const TERRAIN = [
  [0, [12, 62, 105]], [0.02, [34, 110, 60]], [0.25, [106, 148, 66]],
  [0.5, [190, 176, 106]], [0.72, [140, 106, 74]], [0.88, [126, 118, 116]], [1, [252, 252, 252]]
];
function rampColour(t) {
  for (let i = 1; i < TERRAIN.length; i++) {
    if (t > TERRAIN[i][0] && i < TERRAIN.length - 1) continue;
    const [lowStop, low] = TERRAIN[i - 1], [highStop, high] = TERRAIN[i];
    const k = highStop === lowStop ? 0 : (t - lowStop) / (highStop - lowStop);
    return [0, 1, 2].map(c => Math.round(low[c] + (high[c] - low[c]) * clamp(k, 0, 1)));
  }
  return [255, 255, 255];
}

/* 16-bit samples, and the SRTM elevation tiles that use them. Signed, big
   endian and stretched to the range actually present is exactly an .hgt file;
   the same path unsigned covers 16-bit greyscale scans. */
function decodeGray16(view, options) {
  const w = Math.max(1, options.width | 0), h = Math.max(1, options.height | 0);
  const image = new ImageData(w, h);
  const data = image.data;
  const little = options.greyEndian === 'little';
  const signed = !!options.greySigned;
  const count = w * h;
  const sample = new Int32Array(count);
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < count; i++) {
    const a = view[i * 2] || 0, b = view[i * 2 + 1] || 0;
    let value = little ? a | (b << 8) : (a << 8) | b;
    if (signed && value > 32767) value -= 65536;
    /* SRTM writes its holes as the lowest signed value; letting one in would
       stretch the whole tile to a single black speck and a white plateau */
    sample[i] = value;
    if (signed && value === -32768) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) { low = 0; high = signed ? 32767 : 65535; }
  if (!options.greyAuto) { low = signed ? -32768 : 0; high = signed ? 32767 : 65535; }
  const span = Math.max(1, high - low);
  const terrain = options.greyRamp === 'terrain';
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const void16 = signed && sample[i] === -32768;
    const t = void16 ? 0 : clamp((sample[i] - low) / span, 0, 1);
    const [r, g, b] = terrain ? rampColour(t) : [0, 0, 0].map(() => Math.round(t * 255));
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }
  return image;
}

/* An indexed file with no palette beside it still has to look like something:
   an even ramp shows the structure, which is all that is wanted before the
   real palette is found. */
function paletteFor(options) {
  if (palette && palette.length) return palette;
  const count = 1 << clamp(options.indexBits | 0 || 8, 1, 8);
  return Array.from({ length: count }, (unused, i) => {
    const grey = Math.round((i * 255) / Math.max(1, count - 1));
    return [grey, grey, grey];
  });
}

function flipImage(image, options) {
  if (!options.flipH && !options.flipV) return image;
  const { width: w, height: h, data } = image;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = options.flipV ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const sx = options.flipH ? w - 1 - x : x;
      const from = (sy * w + sx) * 4, to = (y * w + x) * 4;
      out.data[to] = data[from]; out.data[to + 1] = data[from + 1];
      out.data[to + 2] = data[from + 2]; out.data[to + 3] = data[from + 3];
    }
  }
  return out;
}

/* One decode, at whatever height was asked for — the preview asks for fewer
   rows than the picture has so that dragging the offset stays smooth. */
function decodeAt(rows) {
  const options = { ...values, height: rows };
  const view = viewFor(options, rows);
  let image;
  if (options.format === 'planar') image = decodePlanar(view, options);
  else if (options.format === 'gray16') image = decodeGray16(view, options);
  else image = api().decode(view, options, options.format === 'indexed' ? paletteFor(options) : null);
  return flipImage(image, options);
}

/* ------------------------------------------------------------- guessing */

/* The width is the one setting nothing in the file admits to, so it is taken
   from the data: lines of a picture resemble the line above them, and no other
   spacing does, so the byte distance that minimises the difference between a
   byte and the byte that far ahead of it is the length of a line. */
function guessRowBytes(view) {
  const len = Math.min(view.length, 384 * 1024);
  if (len < 512) return 0;
  const maxStride = Math.min(16384, Math.floor(len / 6));
  let best = null;
  const scores = new Float64Array(maxStride + 1);
  for (let stride = 4; stride <= maxStride; stride++) {
    const step = Math.max(1, Math.floor((len - stride) / 220));
    let sum = 0, n = 0;
    for (let i = 0; i + stride < len; i += step) { sum += Math.abs(view[i] - view[i + stride]); n++; }
    if (!n) continue;
    const score = sum / n;
    scores[stride] = score;
    if (!best || score < best.score) best = { stride, score };
  }
  if (!best) return 0;
  /* Twice a line's length matches at least as well as one line does, and a
     picture with any repetition down it — a row of icons, seven rows of a
     texture — matches best at whatever its pattern repeats over. So the
     winner is compared against how badly an unrelated spacing does, and the
     smallest fraction of it that still recovers most of that difference is
     the line, rather than the pattern. */
  const spread = [...scores].filter(Boolean).sort((a, b) => a - b);
  const typical = spread.length ? spread[Math.floor(spread.length / 2)] : best.score;
  const allowed = best.score + (typical - best.score) * 0.25;
  for (let divisor = 8; divisor >= 2; divisor--) {
    const stride = Math.round(best.stride / divisor);
    if (stride >= 4 && scores[stride] && scores[stride] <= allowed) return stride;
  }
  return best.stride;
}

/* ------------------------------------------------------------- sniffing */

const ascii = (view, at, text) => text.split('').every((ch, i) => view[at + i] === ch.charCodeAt(0));
const le16 = (view, at) => (view[at] | (view[at + 1] << 8)) >>> 0;
const le32 = (view, at) => (view[at] | (view[at + 1] << 8) | (view[at + 2] << 16) | (view[at + 3] << 24)) >>> 0;

/* What the first few bytes say the file is. A file that turns out to be an
   ordinary picture is worth saying so about — opening a PNG as raw bytes shows
   its compressed stream, which is noise and nothing else — and the two formats
   that are raw pixels behind a short header are worth filling the whole dialog
   in from. */
function sniff(view, name) {
  if (!view || view.length < 16) return null;
  const named = ext => new RegExp(`\\.${ext}$`, 'i').test(name);

  if (ascii(view, 1, 'PNG') && view[0] === 0x89) return { label: 'PNG image', real: true };
  if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return { label: 'JPEG image', real: true };
  if (ascii(view, 0, 'GIF8')) return { label: 'GIF image', real: true };
  if (ascii(view, 0, 'RIFF') && ascii(view, 8, 'WEBP')) return { label: 'WebP image', real: true };
  if (ascii(view, 0, '<?xml') || ascii(view, 0, '<svg')) return { label: 'SVG image', real: true };

  if (ascii(view, 0, 'BM')) {
    const start = le32(view, 10), width = le32(view, 18) | 0;
    const signed = le32(view, 22) | 0;
    const height = signed > 0x7FFFFFFF ? 0x100000000 - signed : signed;
    const bpp = le16(view, 28), compression = le32(view, 30);
    if (width > 0 && height !== 0 && start > 0 && start < view.length && !compression && bpp >= 8) {
      const packing = bpp === 32 ? 'rgba8888' : bpp === 24 ? 'bgr888' : 'rgb332';
      return {
        label: `BMP — ${width} × ${Math.abs(height)}, ${bpp}-bit`,
        note: bpp === 32 ? 'A 32-bit BMP stores its channels as B,G,R,A; the red and blue will read swapped.' : '',
        apply: {
          format: bpp === 8 ? 'indexed' : 'rgb', indexBits: 8, pixelFormat: packing,
          offset: start, width, height: Math.abs(height), stride: Math.ceil((width * bpp) / 8 / 4) * 4,
          scan: 'rows', serpentine: false, flipH: false, flipV: signed > 0 && signed <= 0x7FFFFFFF
        }
      };
    }
    return { label: 'BMP image (compressed or paletted below 8 bits)' };
  }

  /* Targa keeps its size in the header and its pixels straight after it —
     uncompressed only; the run-length kinds are a different animal. Nothing in
     a Targa header is distinctive on its own, so it counts as one only when
     the size it claims accounts for the file exactly, or the name says so. */
  if ((view[2] === 2 || view[2] === 3) && (view[1] === 0 || view[1] === 1)) {
    const width = le16(view, 12), height = le16(view, 14), bpp = view[16];
    const mapBytes = view[1] === 1 ? le16(view, 5) * Math.ceil(view[7] / 8) : 0;
    const claimed = 18 + view[0] + mapBytes + Math.ceil((width * height * bpp) / 8);
    const believable = named('tga') || claimed === view.length || claimed + 26 === view.length;
    if (believable && width > 0 && height > 0 && (bpp === 8 || bpp === 24 || bpp === 32)) {
      return {
        label: `Targa — ${width} × ${height}, ${bpp}-bit`,
        apply: {
          format: bpp === 8 ? 'mono' : 'rgb', monoBits: 8,
          pixelFormat: bpp === 32 ? 'rgba8888' : 'bgr888',
          offset: 18 + view[0] + mapBytes, width, height, stride: 0,
          scan: 'rows', serpentine: false, flipH: false, flipV: !(view[17] & 0x20)
        }
      };
    }
  }

  /* Elevation tiles carry nothing but samples, so the file's length is the
     only thing that identifies them — and it identifies them exactly */
  const side = Math.sqrt(view.length / 2);
  if (named('hgt') || side === 1201 || side === 3601 || side === 601) {
    if (Number.isInteger(side)) {
      return {
        label: `SRTM elevation tile — ${side} × ${side}`,
        apply: {
          format: 'gray16', greyEndian: 'big', greySigned: true, greyAuto: true, greyRamp: 'terrain',
          offset: 0, width: side, height: side, stride: 0, flipH: false, flipV: false
        }
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------- palette */

/* A palette file is usually raw triples, sometimes one of the two text
   formats everybody exports. Both text kinds start by saying so. */
function readPalette(buffer, name) {
  const view = new Uint8Array(buffer);
  const head = String.fromCharCode(...view.subarray(0, 16));
  if (/^JASC-PAL/.test(head) || /^GIMP Palette/.test(head)) {
    const lines = new TextDecoder().decode(view).split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const parts = line.trim().split(/[\s\t]+/);
      if (parts.length < 3) continue;
      const [r, g, b] = parts.map(Number);
      if ([r, g, b].every(n => Number.isFinite(n) && n >= 0 && n <= 255)) out.push([r, g, b]);
    }
    /* the headers of both formats — the version, the entry count, "Name:" —
       are one or two tokens, or have a word where a number should be, so
       taking only the lines that are three numbers leaves just the colours */
    palette = out;
  } else {
    const entry = clamp(values.paletteEntry | 0 || 3, 3, 4);
    const order = values.paletteOrder;
    const out = [];
    for (let at = clamp(values.paletteOffset | 0, 0, view.length); at + 2 < view.length; at += entry) {
      const a = view[at], b = view[at + 1], c = view[at + 2];
      out.push(order === 'bgr' ? [c, b, a] : [a, b, c]);
    }
    palette = out;
  }
  paletteName = name;
  return palette.length;
}

/* --------------------------------------------------------------- fields */

function fieldSpec() {
  const packings = api().RGB_PACKINGS;
  const is = format => () => values.format === format;
  const packed = () => values.format === 'rgb' || values.format === 'planar';
  const paletted = () => values.format === 'indexed';
  const lined = () => values.format !== 'yuv422' && values.format !== 'gray16' && values.format !== 'planar';
  return [
    { group: 'Pixels' },
    { key: 'preset', type: 'select', label: 'Preset', options: presetOptions },
    { key: 'format', type: 'select', label: 'Image type', options: [
      ['mono', 'Greyscale / mono, 1–8 bit'],
      ['gray16', 'Greyscale 16-bit / elevation'],
      ['indexed', 'Indexed palette'],
      ['rgb', 'Packed RGB / RGBA'],
      ['planar', 'Planar RGB'],
      ['yuv422', 'YUV 4:2:2']
    ] },
    { key: 'monoBits', type: 'select', label: 'Bit depth', options: [[1, '1 bit'], [2, '2 bits'], [4, '4 bits'], [8, '8 bits']], showIf: is('mono') },
    { key: 'invert', type: 'check', label: 'Invert — 1 means dark', showIf: is('mono') },
    { key: 'greyEndian', type: 'select', label: 'Byte order', options: [['big', 'Big-endian'], ['little', 'Little-endian']], showIf: is('gray16') },
    { key: 'greySigned', type: 'check', label: 'Signed samples', showIf: is('gray16') },
    { key: 'greyAuto', type: 'check', label: 'Stretch to the range present', showIf: is('gray16') },
    { key: 'greyRamp', type: 'select', label: 'Shown as', options: [['grey', 'Greyscale'], ['terrain', 'Terrain colours']], showIf: is('gray16') },
    { key: 'indexBits', type: 'select', label: 'Bits per index', options: [[1, '1 bit'], [2, '2 bits'], [4, '4 bits'], [8, '8 bits']], showIf: paletted },
    { key: 'pixelFormat', type: 'select', label: 'Packing', options: Object.entries(packings).map(([id, packing]) => [id, packing.label]), showIf: is('rgb') },
    { key: 'endian', type: 'select', label: 'Byte order', options: [['big', 'Big-endian'], ['little', 'Little-endian']], showIf: () => values.format === 'rgb' && packings[values.pixelFormat]?.bytes === 2 },
    { key: 'planes', type: 'select', label: 'Planes', options: [[3, 'R, G, B'], [4, 'R, G, B, A']], showIf: is('planar') },
    { key: 'planeOrder', type: 'select', label: 'Plane order', options: [['rgb', 'R, G, B'], ['bgr', 'B, G, R']], showIf: is('planar') },
    { key: 'yuvOrder', type: 'select', label: 'Sample order', options: [['yuyv', 'YUYV (YUY2)'], ['uyvy', 'UYVY']], showIf: is('yuv422') },
    { key: 'matrix', type: 'select', label: 'Matrix', options: [['601', 'BT.601'], ['709', 'BT.709']], showIf: is('yuv422') },
    { key: 'range', type: 'select', label: 'Range', options: [['full', 'Full'], ['studio', 'Studio']], showIf: is('yuv422') },

    { group: 'Palette', showIf: paletted },
    { key: 'paletteOrder', type: 'select', label: 'Channel order', options: [['rgb', 'R, G, B'], ['bgr', 'B, G, R']], showIf: paletted },
    { key: 'paletteEntry', type: 'select', label: 'Bytes per entry', options: [[3, '3 — R,G,B'], [4, '4 — R,G,B,X']], showIf: paletted },
    { key: 'paletteOffset', type: 'number', label: 'Palette offset', min: 0, max: 1e9, showIf: paletted, unit: 'B' },

    { group: 'Layout' },
    { key: 'scan', type: 'select', label: 'Scan order', options: () => api().SCAN_ORDERS.filter(([id]) => id !== 'pages' || (values.format === 'mono' && +values.monoBits === 1)), showIf: lined },
    { key: 'serpentine', type: 'check', label: 'Serpentine — every other line reversed', showIf: () => lined() && values.scan !== 'pages' },
    { key: 'bitOrder', type: 'select', label: 'Bit order', options: [['msb', 'MSB first'], ['lsb', 'LSB first']], showIf: () => values.format === 'mono' || paletted() },
    { key: 'rowAlign', type: 'check', label: 'Lines padded to a whole byte', showIf: () => (values.format === 'mono' || paletted()) && values.scan !== 'pages' },
    { key: 'flipH', type: 'check', label: 'Flip left to right' },
    { key: 'flipV', type: 'check', label: 'Flip top to bottom' },

    { group: 'Where and how big' },
    { key: 'offset', type: 'number', label: 'Offset', min: 0, max: Math.max(0, (bytes?.length || 1) - 1), unit: 'B' },
    { key: 'size', type: 'select', label: 'Exact fits', options: sizeOptions },
    { key: 'width', type: 'number', label: 'Width', min: 1, max: 8192, unit: 'px' },
    { key: 'height', type: 'number', label: 'Height', min: 1, max: 8192, unit: 'px' },
    { key: 'stride', type: 'number', label: 'Row stride', min: 0, max: 1e6, unit: 'B' }
  ];
}

/* The screens the exporter already knows about, offered here so that a
   framebuffer dumped off a device needs one click rather than six settings. */
function presetOptions() {
  const list = [['', 'Choose…']];
  for (const preset of api().PRESETS) {
    if (preset.native || preset.custom) continue;
    list.push([preset.id, preset.label]);
  }
  return list;
}

function applyPreset(id) {
  const preset = api().PRESETS.find(entry => entry.id === id);
  if (!preset || !preset.width) return;
  const wanted = preset.options || {};
  for (const key of ['format', 'monoBits', 'scan', 'bitOrder', 'rowAlign', 'invert', 'pixelFormat', 'endian', 'serpentine']) {
    if (wanted[key] !== undefined) values[key] = wanted[key];
  }
  values.width = preset.width; values.height = preset.height; values.stride = 0;
}

function sizeOptions() {
  const left = (bytes?.length || 0) - clamp(values.offset | 0, 0, bytes?.length || 0);
  if (left <= 0) return [['', 'Nothing left after the offset']];
  const sizes = candidateSizes(left, values);
  const list = sizes.map(({ width, height }) => [`${width}x${height}`, `${width} × ${height}`]);
  return list.length ? [['', 'Choose…'], ...list] : [['', 'No exact fit — set it below']];
}

function fieldElement(param) {
  const row = document.createElement('label');
  const options = typeof param.options === 'function' ? param.options() : param.options;
  if (param.type === 'check') {
    row.className = 'paint-check';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.dataset.rawKey = param.key;
    const caption = document.createElement('span');
    caption.textContent = param.label;
    row.append(input, caption);
    return row;
  }
  const caption = document.createElement('span');
  caption.textContent = param.label;
  const holder = document.createElement('span');
  let input;
  if (param.type === 'select') {
    input = document.createElement('select');
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value; option.textContent = text;
      input.append(option);
    }
  } else {
    input = document.createElement('input');
    input.type = 'number';
    if (param.min !== undefined) input.min = param.min;
    if (param.max !== undefined) input.max = param.max;
  }
  input.dataset.rawKey = param.key;
  holder.append(input);
  if (param.unit) holder.append(document.createTextNode(' ' + param.unit));
  row.append(caption, holder);
  return row;
}

/* Changing a setting rebuilds the panel, because a format adds and removes
   whole rows — so whatever was being typed into has to be handed back
   afterwards, cursor and all. */
function buildFields() {
  building = true;
  const panel = el('rawFields');
  const root = panel.getRootNode();
  const active = root.activeElement?.dataset?.rawKey && panel.contains(root.activeElement) ? root.activeElement.dataset.rawKey : null;
  panel.replaceChildren();
  let group = null;
  for (const param of fieldSpec()) {
    if (param.showIf && !param.showIf()) continue;
    if (param.group) {
      group = document.createElement('div');
      group.className = 'paint-export-group';
      const heading = document.createElement('h4');
      heading.textContent = param.group;
      group.append(heading);
      panel.append(group);
      continue;
    }
    if (!group) { group = document.createElement('div'); group.className = 'paint-export-group'; panel.append(group); }
    const row = fieldElement(param);
    const input = row.querySelector('[data-raw-key]');
    if (param.key === 'size' || param.key === 'preset') input.value = '';
    else if (param.type === 'check') input.checked = !!values[param.key];
    else input.value = values[param.key] ?? '';
    group.append(row);
  }
  if (active) panel.querySelector(`[data-raw-key="${CSS.escape(active)}"]`)?.focus();
  syncOffsetSlider();
  el('rawPaletteRow').hidden = values.format !== 'indexed';
  el('rawPaletteName').textContent = paletteName ? `${paletteName} — ${palette.length} colours` : 'No palette file — showing an even ramp';
  building = false;
}

function syncOffsetSlider() {
  const slider = el('rawOffsetSlider');
  const length = bytes?.length || 1;
  slider.max = String(Math.max(0, length - 1));
  slider.value = String(clamp(values.offset | 0, 0, length - 1));
  el('rawOffsetReadout').textContent = `${(values.offset | 0).toLocaleString()} of ${length.toLocaleString()} B`;
}

/* ------------------------------------------------------------ rendering */

function drawHex() {
  if (!bytes) { el('rawHex').textContent = ''; return; }
  const start = clamp(values.offset | 0, 0, bytes.length);
  const slice = bytes.subarray(start, start + HEX_BYTES);
  const lines = [];
  for (let at = 0; at < slice.length; at += 16) {
    const row = slice.subarray(at, at + 16);
    const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const text = [...row].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
    lines.push(`${(start + at).toString(16).padStart(8, '0')}  ${hex}  ${text}`);
  }
  el('rawHex').textContent = lines.join('\n') || '(past the end of the file)';
}

function render() {
  const canvas = el('rawPreview');
  const context = canvas.getContext('2d');
  const summary = el('rawSummary');
  drawHex();
  if (!bytes || !bytes.length) {
    preview = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    summary.textContent = 'Choose a file to see it.';
    return;
  }
  if (!values.width || !values.height) {
    preview = null;
    summary.textContent = 'Set a width and height, or press Guess.';
    return;
  }
  try {
    const rows = Math.max(1, Math.min(values.height, Math.floor(PREVIEW_PIXELS / Math.max(1, values.width))));
    previewRows = rows;
    preview = decodeAt(rows);
    const source = document.createElement('canvas');
    source.width = preview.width; source.height = preview.height;
    source.getContext('2d').putImageData(preview, 0, 0);
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(64, Math.round(box.width || 320));
    canvas.height = Math.max(64, Math.round(box.height || 232));
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (zoomed) {
      /* every pixel its own pixel, top left corner first: the view that shows
         whether a line has slipped by a byte */
      context.drawImage(source, 0, 0, Math.min(canvas.width, preview.width), Math.min(canvas.height, preview.height),
        0, 0, Math.min(canvas.width, preview.width), Math.min(canvas.height, preview.height));
    } else {
      const scale = Math.min(canvas.width / preview.width, canvas.height / preview.height);
      const w = preview.width * scale, h = preview.height * scale;
      context.drawImage(source, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
    }
    const needed = byteLengthOf(values.width, values.height, values);
    const left = bytes.length - clamp(values.offset | 0, 0, bytes.length);
    const parts = [
      `${humanBytes(bytes.length)} file · ${values.width} × ${values.height} needs ${humanBytes(needed)}`,
      needed > left ? 'not enough left — the end will be blank' : needed < left ? `${humanBytes(left - needed)} after it` : 'an exact fit'
    ];
    if (rows < values.height) parts.push(`preview shows the first ${rows} of ${values.height} lines`);
    summary.textContent = parts.join(' · ');
  } catch (error) {
    preview = null;
    summary.textContent = `Could not read that: ${error.message}`;
  }
}

function refresh(immediate) {
  clearTimeout(redrawTimer);
  if (immediate) render();
  else redrawTimer = setTimeout(render, 60);
}

function setNote() {
  const note = el('rawNote');
  const real = el('rawOpenProperly');
  if (!sniffed) {
    note.textContent = bytes ? `${sourceName} — no header recognised; every byte is treated as picture data.` : '';
    real.hidden = true;
    return;
  }
  note.textContent = `${sourceName} — ${sniffed.label}.` + (sniffed.real
    ? ' Its pixels are compressed, so as raw bytes it will look like noise.'
    : sniffed.apply ? ' The settings below were filled in from its header.' : '') + (sniffed.note ? ' ' + sniffed.note : '');
  real.hidden = !sniffed.real;
}

/* ---------------------------------------------------------------- events */

function onInput(event) {
  const input = event.target.closest('[data-raw-key]');
  if (!input || building) return;
  const key = input.dataset.rawKey;
  if (key === 'size') {
    const [w, h] = input.value.split('x').map(Number);
    if (w && h) { values.width = w; values.height = h; values.stride = 0; }
  } else if (key === 'preset') {
    if (input.value) applyPreset(input.value);
  } else {
    values[key] = input.type === 'checkbox' ? input.checked
      : input.type === 'number' ? Math.max(0, Number(input.value) || 0) : input.value;
    if (key === 'format') {
      if (values.format !== 'mono' && values.scan === 'pages') values.scan = 'rows';
      if (values.format === 'planar' || values.format === 'gray16') values.scan = 'rows';
      /* a width in one format is the wrong width in another, and the fits list
         is the quickest way back to a sensible one */
      values.stride = 0;
    }
    if (key === 'paletteOrder' || key === 'paletteEntry' || key === 'paletteOffset') repalette();
  }
  buildFields();
  refresh(true);
}

let paletteBuffer = null;
function repalette() {
  if (paletteBuffer) readPalette(paletteBuffer, paletteName);
}

function nudge(what, by) {
  if (what === 'offset') values.offset = clamp((values.offset | 0) + by, 0, Math.max(0, (bytes?.length || 1) - 1));
  else if (what === 'width') values.width = clamp((values.width | 0) + by, 1, 8192);
  else if (what === 'page') {
    const step = byteLengthOf(values.width, values.height, values);
    values.offset = clamp((values.offset | 0) + by * step, 0, Math.max(0, (bytes?.length || 1) - 1));
  }
  buildFields();
  refresh(true);
}

function guess() {
  if (!bytes || !bytes.length) return;
  const rowBytes = guessRowBytes(bytes.subarray(clamp(values.offset | 0, 0, bytes.length)));
  if (!rowBytes) { host.setStatus('Nothing in the data looks like a repeating line'); return; }
  const width = clamp(widthForRowBytes(rowBytes, values), 1, 8192);
  values.width = width;
  values.stride = rowBytes === rowBytesOf(width, values) ? 0 : rowBytes;
  const left = bytes.length - clamp(values.offset | 0, 0, bytes.length);
  const per = Math.max(1, values.stride || rowBytesOf(width, values) || byteLengthOf(width, 1, values));
  values.height = clamp(Math.floor(left / per), 1, 8192);
  buildFields();
  refresh(true);
  host.setStatus(`Guessed ${values.width} × ${values.height} from a ${rowBytes}-byte line`);
}

function skipHeader() {
  if (!sniffed?.apply) return;
  Object.assign(values, sniffed.apply);
  buildFields();
  refresh(true);
  host.setStatus('Filled in from the file header');
}

/* ------------------------------------------------------------- the file */

async function take(file) {
  pendingFile = file;
  sourceName = file.name || 'raw.bin';
  bytes = new Uint8Array(await file.arrayBuffer());
  sniffed = sniff(bytes, sourceName);
  values = { ...values, offset: 0, stride: 0, flipH: false, flipV: false };
  if (sniffed?.apply) Object.assign(values, sniffed.apply);
  else {
    /* nothing said how wide it is: an exact fit if there is one, and the
       autocorrelation if there is not */
    const fit = candidateSizes(bytes.length, values, 1)[0];
    if (fit) { values.width = fit.width; values.height = fit.height; }
    else guessQuietly();
  }
  el('rawFileName').textContent = `${sourceName} · ${humanBytes(bytes.length)}`;
  el('rawSkipHeader').hidden = !sniffed?.apply;
  setNote();
  buildFields();
  refresh(true);
}

function guessQuietly() {
  const rowBytes = guessRowBytes(bytes);
  if (!rowBytes) { values.width = 320; values.height = clamp(Math.floor(bytes.length / 320), 1, 8192); return; }
  values.width = clamp(widthForRowBytes(rowBytes, values), 1, 8192);
  const per = Math.max(1, rowBytesOf(values.width, values) || byteLengthOf(values.width, 1, values));
  values.height = clamp(Math.floor(bytes.length / per), 1, 8192);
}

function finish(asLayer) {
  if (!bytes || !values.width || !values.height) { host.setStatus('Nothing to open yet'); return; }
  if (values.width * values.height > OPEN_PIXELS) {
    host.setStatus(`That geometry is ${Math.round((values.width * values.height) / 1e6)} megapixels — reduce the height first`);
    return;
  }
  let image;
  try {
    image = decodeAt(values.height);
  } catch (error) {
    host.setStatus(`Could not read that: ${error.message}`); return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  save();
  host.hideModal('rawOpenModal');
  const name = `${sourceName.replace(/\.[^.]+$/, '') || 'raw'}-${image.width}x${image.height}.png`;
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    (asLayer ? host.loadImageAsLayer(url, name) : host.loadImage(url, name))
      .catch(() => {}).finally(() => URL.revokeObjectURL(url));
  }, 'image/png');
}

/* The settings are worth keeping: somebody reading one camera's dumps is
   reading the next one the same way. The file is not — it is opened again. */
function save() {
  try {
    const keep = { ...values };
    delete keep.width; delete keep.height; delete keep.offset; delete keep.stride;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(keep));
  } catch { /* private browsing; the defaults will do */ }
}

function restore() {
  try {
    const kept = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (kept && typeof kept === 'object') values = { ...DEFAULTS, ...kept, width: 0, height: 0, offset: 0, stride: 0 };
  } catch { /* keep the defaults */ }
}

/* ----------------------------------------------------------------- wiring */

function wire() {
  const panel = el('rawFields');
  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onInput);

  const slider = el('rawOffsetSlider');
  slider.addEventListener('input', () => {
    values.offset = Number(slider.value) || 0;
    el('rawOffsetReadout').textContent = `${values.offset.toLocaleString()} of ${(bytes?.length || 0).toLocaleString()} B`;
    const box = panel.querySelector('[data-raw-key="offset"]');
    if (box) box.value = values.offset;
    refresh(false);
  });

  host.appRoot.querySelectorAll('[data-raw-nudge]').forEach(button => {
    button.addEventListener('click', () => {
      const [what, by] = button.dataset.rawNudge.split(':');
      nudge(what, Number(by));
    });
  });

  el('rawGuess').addEventListener('click', guess);
  el('rawSkipHeader').addEventListener('click', skipHeader);
  el('rawZoom').addEventListener('click', () => {
    zoomed = !zoomed;
    el('rawZoom').setAttribute('aria-pressed', String(zoomed));
    render();
  });
  el('rawOpenProperly').addEventListener('click', () => {
    if (!pendingFile) return;
    const file = pendingFile;
    host.hideModal('rawOpenModal');
    host.openNormally(file);
  });

  const picker = el('rawFilePicker');
  el('rawChoose').addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files[0]; picker.value = '';
    if (file) await take(file);
  });

  const palettePicker = el('rawPalettePicker');
  el('rawPaletteChoose').addEventListener('click', () => palettePicker.click());
  palettePicker.addEventListener('change', async () => {
    const file = palettePicker.files[0]; palettePicker.value = '';
    if (!file) return;
    paletteBuffer = await file.arrayBuffer();
    const count = readPalette(paletteBuffer, file.name);
    buildFields();
    refresh(true);
    host.setStatus(`Read ${count} colours from ${file.name}`);
  });
  el('rawPaletteClear').addEventListener('click', () => {
    palette = null; paletteBuffer = null; paletteName = '';
    buildFields(); refresh(true);
  });

  el('rawOpen').addEventListener('click', () => finish(false));
  el('rawOpenLayer').addEventListener('click', () => finish(true));

  /* dropping a file on the dialog is the same as choosing one */
  const box = host.appRoot.querySelector('#rawOpenModal .paint-modal-box');
  box.addEventListener('dragover', event => { event.preventDefault(); box.classList.add('paint-raw-over'); });
  box.addEventListener('dragleave', () => box.classList.remove('paint-raw-over'));
  box.addEventListener('drop', async event => {
    event.preventDefault(); box.classList.remove('paint-raw-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) await take(file);
  });
}

window.ClackRaw = {
  init(hostApi) {
    host = hostApi;
    restore();
    wire();
  },
  open(asLayer) {
    if (!host) return;
    if (!api()) { host.setStatus('Opening raw data needs paint-export.js, which did not load'); return; }
    el('rawOpenLayer').classList.toggle('primary', !!asLayer);
    el('rawOpen').classList.toggle('primary', !asLayer);
    if (!bytes) {
      el('rawFileName').textContent = 'No file chosen';
      el('rawSkipHeader').hidden = true;
    }
    setNote();
    buildFields();
    refresh(true);
    host.showModal('rawOpenModal');
    if (!bytes) el('rawChoose').focus();
  },
  /* the file manager and the desktop hand files in directly */
  openWith(file) {
    if (!host || !api()) return;
    host.showModal('rawOpenModal');
    take(file).then(() => el('rawOpen').focus());
  },
  destroy() { host = null; bytes = null; pendingFile = null; }
};
})();
