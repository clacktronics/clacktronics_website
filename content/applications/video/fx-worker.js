/* Video Lab's frame filter — one worker, one frame at a time.
 *
 * The filters are ClackPaint's, unchanged: assets/js/clack-fx.js holds the
 * maths behind the Effects menu, paint-dither.js the halftone algorithms and
 * paint-retouch.js the bilateral blur two of the filters lean on. A frame of
 * video is an ImageData like any other, so nothing here had to be written
 * twice — this file only decides the order things run in and gets the pixels
 * on and off the wire.
 *
 * It is a classic worker rather than a module one because importScripts is
 * what those three files are shaped for, and because a pool of these is the
 * whole point: frames do not depend on each other, so N workers render N
 * frames at once and the pool in fx-pool.js keeps them all fed.
 *
 * Buffers travel by transfer, never by copy. A 1080p frame is 8 MB and a
 * render is hundreds of them; copying each one twice per effect would cost
 * more than the filters do.
 */

importScripts(
  '../../../assets/js/clack-fx.js',
  '../paint-retouch.js',
  '../paint-dither.js'
);

const FX = globalThis.ClackFX;
const DITHER = globalThis.ClackDither;

/* The three filters that cannot work it out from the pixels alone: Clouds
   paints between two colours, Selective Colour needs a point, and the dithers
   quantise towards a palette built from the same two colours. Video Lab has no
   colour wells, so its effects panel offers them and they arrive with the job. */
const DEFAULT_COLOURS = { fg: '#ffffff', bg: '#000000', palette: [] };

/* Background removal is the one part that is an ES module — paint-matte.js is
   imported by ClackPaint's own matting worker and stays that way. A classic
   worker cannot importScripts a module, but it can import() one, so it is
   pulled in the first time a frame actually asks for a matte. */
let matteModule = null;
async function matting() {
  if (!matteModule) matteModule = await import('../paint-matte.js');
  return matteModule;
}

const hexToRgb = hex => {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* The matte comes back as coverage — one byte a pixel, 255 for subject — and
   is deliberately not a decision. Where along that ramp the subject ends, and
   how soft the crossing is, are the two controls that matter, and neither
   needs the matte worked out again.

   Over video the cut is either punched through to transparency or filled with
   a flat colour. Transparency is the honest answer and survives a WebM or a
   PNG sequence; most other containers have nowhere to put it, which is why
   filling is offered beside it rather than instead of it. */
async function applyMatte(image, method, values, colours) {
  const { classicMatte, CLASSIC_METHODS } = await matting();
  if (!CLASSIC_METHODS.has(method)) return image;

  const params = { ...values };
  if (params.key) params.key = hexToRgb(params.key);
  const { width: w, height: h, data } = image;
  const coverage = classicMatte(method, data, w, h, params);

  const cutoff = (Number(values.cutoff) || 0) / 100 * 255;
  const softness = Math.max(1, (Number(values.softness) || 0) / 100 * 255);
  const low = cutoff - softness / 2, high = cutoff + softness / 2;
  const invert = !!values.invert;
  const fill = values.output === 'fill' ? hexToRgb(values.fillColour || colours.bg) : null;

  for (let pixel = 0, at = 0; pixel < coverage.length; pixel += 1, at += 4) {
    let subject = (coverage[pixel] - low) / (high - low);
    subject = subject < 0 ? 0 : subject > 1 ? 1 : subject;
    if (invert) subject = 1 - subject;
    if (fill) {
      for (let channel = 0; channel < 3; channel += 1) {
        data[at + channel] = fill[channel] + (data[at + channel] - fill[channel]) * subject;
      }
    } else {
      data[at + 3] = data[at + 3] * subject;
    }
  }
  return image;
}

/* An effect entry is { kind, values }, where kind is namespaced by which of the
   libraries owns it. Anything unknown is skipped rather than thrown, so one bad
   entry in a saved stack cannot cost the whole render. */
async function applyOne(image, entry, colours) {
  const [family, name] = String(entry.kind || '').split(':');
  if (family === 'fx') {
    const effect = FX.EFFECTS[name];
    if (!effect) return image;
    FX.setContext({ fg: colours.fg, bg: colours.bg, pin: entry.values?.__pin || null });
    return effect.run(image, entry.values || {});
  }
  if (family === 'dither') {
    if (!DITHER.GROUPS[name]) return image;
    /* applyDither works in place and hands the same ImageData back */
    return DITHER.apply(image, name, DITHER.normalise(name, entry.values || {}), colours);
  }
  if (family === 'matte') return applyMatte(image, name, entry.values || {}, colours);
  return image;
}

async function renderFrame(payload) {
  const { width, height, data, stack, colours } = payload;
  let image = new ImageData(new Uint8ClampedArray(data), width, height);
  for (const entry of stack || []) {
    if (entry.bypass) continue;
    image = await applyOne(image, entry, colours || DEFAULT_COLOURS);
  }
  return image;
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'render') return;
  const { token } = message;
  try {
    const image = await renderFrame(message);
    const buffer = image.data.buffer;
    self.postMessage({ type: 'done', token, width: image.width, height: image.height, data: buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ type: 'failed', token, message: error?.message || String(error) });
  }
};

/* The page loads the same three files for its effects panel, so it already
   knows what the filters are and what controls they take — including the
   `when` predicates that decide which of Pixel Sorting's twenty controls apply
   to the method you picked, which are functions and would not survive the trip
   through postMessage. So this says only that it is up and holding the maths;
   the catalogue is read on the main thread from the same source. */
self.postMessage({ type: 'ready', effects: Object.keys(FX.EFFECTS).length, dithers: Object.keys(DITHER.GROUPS).length });
