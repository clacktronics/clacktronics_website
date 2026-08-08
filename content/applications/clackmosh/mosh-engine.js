/* The FFmpeg side of ClackMosh.

   Datamoshing only works if every frame in the project speaks the same
   dialect, so nothing reaches the editor until it has been through
   `normalise()`: MPEG-4 Part 2, no B-frames, a fixed GOP and a fixed size.
   After that a frame is a frame, and the byte surgery in avi.js can move them
   around without the decoder objecting.

   The FFmpeg client is shared with Video Lab rather than vendored twice; the
   licence notices live in ../video/vendor/. */

import { FFmpeg } from '../video/vendor/ffmpeg/index.js';
import { parseAvi } from './avi.js';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

/* Decoder flags that make a broken stream smear instead of stall. Without
   `-ec favor_inter` a missing anchor tends to freeze or drop, which throws
   away the whole effect; it belongs before -i because it configures the
   decoder, not the output. */
export const TOLERANT_DECODE = ['-err_detect', 'ignore_err', '-ec', 'favor_inter'];

/* The encoder settings every frame in a project shares.

   Only options that demonstrably change the bitstream are here. `-me_method`
   is the notable omission: the mpeg4 encoder ignores it outright — every
   value from `zero` to `full` produces a byte-identical file — so offering it
   would be a control that does nothing. `-me_range` is the one that really
   bites, because a short search means the encoder cannot follow fast movement
   and gives up into large, messy residuals, which is exactly the ugly the
   effect feeds on. */
export function encoderArgs({ gop, quality, meRange = 0, mv4 = false, qpel = false }) {
  const args = [
    '-c:v', 'mpeg4', '-bf', '0', '-g', String(gop),
    '-sc_threshold', '0', '-q:v', String(quality)
  ];
  if (meRange > 0) args.push('-me_range', String(meRange));
  const flags = `${mv4 ? '+mv4' : ''}${qpel ? '+qpel' : ''}`;
  if (flags) args.push('-flags', flags);
  return args;
}

async function toBlobURL(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the FFmpeg core (${response.status}).`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mimeType }));
}

export class MoshEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.loaded = false;
    this.loading = null;
    this.logs = [];
    this.collectLogs = false;
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => {
      if (this.collectLogs) this.logs.push(message);
      this.callbacks.onLog?.(message);
    });
    this.ffmpeg.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) {
        this.callbacks.onProgress?.(Math.max(0, Math.min(1, progress)));
      }
    });
  }

  async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.callbacks.onState?.('LOADING');
    this.loading = Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
    ]).then(([coreURL, wasmURL]) => this.ffmpeg.load({ coreURL, wasmURL }))
      .then(() => { this.loaded = true; this.callbacks.onState?.('READY'); })
      .catch(error => { this.callbacks.onState?.('ERROR'); throw error; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  async run(args) {
    await this.load();
    const code = await this.ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}.`);
  }

  async quiet(path) {
    try { await this.ffmpeg.deleteFile(path); } catch { /* already gone */ }
  }

  /* writeFile hands the array's buffer to the worker as a transferable, which
     detaches it on this side. The project keeps its normalised AVI around for
     the whole session and rebuilds from it on every edit, so anything crossing
     that boundary goes as a copy. */
  async writeCopy(path, bytes) {
    await this.ffmpeg.writeFile(path, bytes.slice());
  }

  /* Every import lands here first. The settings chosen on this one pass decide
     what the whole session can do: `-g` is how many anchors you get to edit,
     and `-bf 0` guarantees every frame is either an anchor or motion, with no
     B-frames to reason about.

     `height` is what makes moshing two videos together possible. The first
     clip takes its height from its own shape; every clip added afterwards is
     given the project's exact frame instead, letterboxed rather than
     stretched. Pixel dimensions and sample aspect both end up in the VOL
     header, so `setsar=1` is not cosmetic — without it a clip of a different
     shape would encode a header that disagrees, and its frames would not be
     interchangeable with the ones already in the project. */
  async normalise(file, { width = 480, height = null, fps = 25, gop = 25,
                          quality = 5, meRange = 0, mv4 = false, qpel = false,
                          maxSeconds = 30 } = {}) {
    await this.load();
    const input = `in-${Date.now()}.src`;
    const output = 'mosh-source.avi';
    await this.ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    const scale = height
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
      : `scale=${width}:-2:flags=bicubic`;

    this.logs = [];
    this.collectLogs = true;
    try {
      await this.run([
        '-hide_banner', '-y', '-t', String(maxSeconds), '-i', input,
        '-an', '-sn', '-map', '0:v:0',
        '-vf', `${scale},setsar=1,fps=${fps}`,
        ...encoderArgs({ gop, quality, meRange, mv4, qpel }),
        '-f', 'avi', output
      ]);
    } finally {
      this.collectLogs = false;
    }

    const hasAudio = this.logs.some(line => /Stream .*: Audio:/i.test(line));
    const data = await this.ffmpeg.readFile(output);
    const bytes = new Uint8Array(data.buffer.slice(0));

    await this.quiet(output);
    // The original stays on the FS so audio can be re-muxed at render time.
    return { bytes, hasAudio, sourcePath: input, settings: { width, fps, gop, quality } };
  }

  /* One JPEG per I-frame, for the filmstrip. `select` counts only anchors, so
     the Nth image lines up with the Nth I-frame in the parsed chunk list. */
  async keyframeThumbnails(aviBytes, count, thumbWidth = 160) {
    await this.load();
    const input = 'thumbs-in.avi';
    await this.writeCopy(input, aviBytes);
    await this.run([
      '-hide_banner', '-y', ...TOLERANT_DECODE, '-i', input,
      '-vf', `select='eq(pict_type\\,I)',scale=${thumbWidth}:-2`,
      '-fps_mode', 'passthrough', '-q:v', '4', 'thumb%04d.jpg'
    ]);

    const urls = [];
    for (let i = 1; i <= count; i++) {
      const name = `thumb${String(i).padStart(4, '0')}.jpg`;
      try {
        const data = await this.ffmpeg.readFile(name);
        urls.push(URL.createObjectURL(new Blob([data.buffer.slice(0)], { type: 'image/jpeg' })));
      } catch {
        urls.push(null); // a dropped anchor just shows a placeholder
      }
      await this.quiet(name);
    }
    await this.quiet(input);
    return urls;
  }

  /* Encode one edited picture as a lone I-frame, matching the stream's own
     encoder settings so the VOL header it produces agrees with the file it is
     about to be spliced into. Only the VOP is kept — see spliceVop. */
  async encodeStill(pngBytes, { width, height, ...encode }) {
    await this.load();
    const input = 'still.png';
    const output = 'still.avi';
    await this.writeCopy(input, pngBytes);
    await this.run([
      '-hide_banner', '-y', '-i', input, '-frames:v', '1',
      '-vf', `scale=${width}:${height},setsar=1`,
      ...encoderArgs(encode),
      '-f', 'avi', output
    ]);
    const data = await this.ffmpeg.readFile(output);
    const parsed = parseAvi(new Uint8Array(data.buffer.slice(0)));
    await this.quiet(input);
    await this.quiet(output);
    if (!parsed.frames.length) throw new Error('Could not encode the replacement frame.');
    return parsed.frames[0].payload;
  }

  /* Decode the moshed AVI and re-encode it to something a browser will play.
     The smear is baked into pixels here, which is the point: the artefact
     survives into a file that is not itself broken. */
  async render(aviBytes, { audioFrom = null, crf = 20, format = 'mp4' } = {}) {
    await this.load();
    const input = 'render-in.avi';
    const output = `render-out.${format}`;
    await this.writeCopy(input, aviBytes);

    const args = ['-hide_banner', '-y', ...TOLERANT_DECODE, '-i', input];
    const audioCodec = format === 'webm'
      ? ['-c:a', 'libvorbis', '-q:a', '5']
      : ['-c:a', 'aac', '-b:a', '160k'];
    if (audioFrom) args.push('-i', audioFrom, '-map', '0:v:0', '-map', '1:a:0', '-shortest', ...audioCodec);
    else args.push('-an');

    args.push(...(format === 'webm'
      ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', String(crf + 6), '-b:v', '1M']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    ), output);

    await this.run(args);
    const data = await this.ffmpeg.readFile(output);
    const blob = new Blob([data.buffer.slice(0)], {
      type: format === 'webm' ? 'video/webm' : 'video/mp4'
    });
    await this.quiet(input);
    await this.quiet(output);
    return blob;
  }
}

/* Chromium builds without the proprietary codecs — the ones most Linux
   distributions ship — decode H.264 in FFmpeg happily enough but refuse to
   play it back, so a preview rendered as MP4 would be a black rectangle. The
   preview follows what the browser admits to; exports stay MP4, because that
   is the file worth sending to anyone else. */
export function playablePreviewFormat() {
  const probe = document.createElement('video');
  if (probe.canPlayType('video/mp4; codecs="avc1.42E01E"')) return 'mp4';
  if (probe.canPlayType('video/webm; codecs="vp8"')) return 'webm';
  return 'mp4';
}
