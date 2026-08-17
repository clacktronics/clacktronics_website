import { FFmpeg } from './vendor/ffmpeg/index.js';
import { StoredZip } from './zip.js';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

async function toBlobURL(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the FFmpeg core (${response.status}).`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mimeType }));
}

const MIME_TYPES = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg'
};

/* Popcorn — the movie player in raspberrypi/pico-playground — reads two raw
   files and its converter crashes on anything else, so these are constants
   rather than settings: 320 × 240 30fps 24-bit RGB, and 44.1 kHz stereo
   signed 16-bit little-endian PCM. */
export const POPCORN = {
  width: 320, height: 240, fps: 30, sampleRate: 44100, channels: 2,
  get videoBytesPerSecond() { return this.width * this.height * 3 * this.fps; },
  get audioBytesPerSecond() { return this.sampleRate * this.channels * 2; }
};

const OUTPUT_ARGS = {
  mp4: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  webm: ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '28', '-b:v', '1M', '-c:a', 'libvorbis', '-q:a', '5'],
  mov: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'],
  mkv: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'],
  avi: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '192k'],
  gif: ['-loop', '0'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  wav: ['-c:a', 'pcm_s16le'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5']
};

/* A clip with no sound still has to be encoded, and the container's audio codec
   flags describe a stream that will not be there. Each is a flag and its value,
   so both go. */
const AUDIO_FLAGS = new Set(['-c:a', '-b:a', '-q:a', '-ar', '-ac']);
function withoutAudioArgs(args) {
  const kept = [];
  for (let index = 0; index < args.length; index += 1) {
    if (AUDIO_FLAGS.has(args[index])) { index += 1; continue; }
    kept.push(args[index]);
  }
  return kept;
}

const cleanExtension = name => {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? match[1] : 'bin';
};

const number = value => Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

function atempoChain(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining > 2.0001) { factors.push(2); remaining /= 2; }
  while (remaining < 0.4999) { factors.push(0.5); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.0001) factors.push(remaining);
  return factors.map(factor => `atempo=${number(factor)}`);
}

export class BrowserFFmpegEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.loaded = false;
    this.loading = null;
    this.written = new Map();
    this.logs = [];
    this.collectLogs = false;
    this.coreObjectURLs = [];
    /* A multi-pass export reports one bar, so each pass claims a slice of it
       instead of running 0–100% twice. */
    this.progressWindow = null;
    this.createInstance();
  }

  createInstance() {
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => {
      if (this.collectLogs) this.logs.push(message);
      this.callbacks.onLog?.(message);
    });
    this.ffmpeg.on('progress', ({ progress }) => {
      if (!Number.isFinite(progress)) return;
      const clamped = Math.max(0, Math.min(1, progress));
      const window = this.progressWindow;
      this.callbacks.onProgress?.(window ? window.base + clamped * window.span : clamped);
    });
  }

  async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.callbacks.onState?.('LOADING');
    this.loading = Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
    ]).then(([coreURL, wasmURL]) => {
      this.coreObjectURLs.push(coreURL, wasmURL);
      return this.ffmpeg.load({ coreURL, wasmURL });
    }).then(() => {
      this.loaded = true;
      this.callbacks.onState?.('READY');
    }).catch(error => {
      this.callbacks.onState?.('ERROR');
      throw error;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  async ensureAsset(asset) {
    await this.load();
    if (this.written.has(asset.id)) return this.written.get(asset.id);
    const path = `asset-${asset.id}.${cleanExtension(asset.file.name)}`;
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    await this.ffmpeg.writeFile(path, bytes);
    this.written.set(asset.id, path);
    return path;
  }

  async probeAudio(asset) {
    if (typeof asset.hasAudio === 'boolean') return asset.hasAudio;
    const path = await this.ensureAsset(asset);
    this.logs = [];
    this.collectLogs = true;
    try { await this.ffmpeg.exec(['-hide_banner', '-i', path]); } catch { /* probing exits non-zero */ }
    this.collectLogs = false;
    asset.hasAudio = this.logs.some(line => /Stream .* Audio:/i.test(line));
    return asset.hasAudio;
  }

  async normalizeForPreview(asset) {
    const input = await this.ensureAsset(asset);
    const output = `preview-${asset.id}.mp4`;
    const common = ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
    let code = await this.ffmpeg.exec([...common, '-c:v', 'libx264', '-preset', 'ultrafast', output]);
    if (code !== 0) {
      try { await this.ffmpeg.deleteFile(output); } catch { /* no output to remove */ }
      code = await this.ffmpeg.exec([...common, '-c:v', 'mpeg4', '-q:v', '5', output]);
    }
    if (code !== 0) throw new Error('FFmpeg could not create a browser-compatible preview.');
    const data = await this.ffmpeg.readFile(output);
    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  /* Every export — a container, Popcorn's raw pair, a sheet of stills — is the
     same timeline: trim each clip, scale it onto the canvas, concatenate,
     layer the extra audio, then apply reverse, speed and bounce. Only the
     final filters and the output arguments differ, so the graph is built once
     here and the callers bolt their ending onto the labels it returns. */
  async buildGraph({ segments, assets, audioLayer, width, height, speed, reverse, bounce, includeVideo, includeAudio, pixelFormat = 'yuv420p' }) {
    await this.load();
    const uniqueAssets = [...new Set(segments.map(segment => segment.assetId))].map(id => assets.get(id));
    const assetInputIndex = new Map();
    const args = ['-hide_banner', '-y'];

    for (let index = 0; index < uniqueAssets.length; index += 1) {
      const asset = uniqueAssets[index];
      const path = await this.ensureAsset(asset);
      assetInputIndex.set(asset.id, index);
      args.push('-i', path);
    }

    const filters = [];
    const videoLabels = [];
    const audioLabels = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const inputIndex = assetInputIndex.get(segment.assetId);
      const duration = Math.max(0.001, segment.end - segment.start);
      if (includeVideo) {
        filters.push(
          `[${inputIndex}:v:0]trim=start=${number(segment.start)}:end=${number(segment.end)},` +
          `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=${pixelFormat}[v${index}]`
        );
        videoLabels.push(`[v${index}]`);
      }
      if (includeAudio) {
        const asset = assets.get(segment.assetId);
        const hasAudio = await this.probeAudio(asset);
        if (hasAudio) {
          filters.push(
            `[${inputIndex}:a:0]atrim=start=${number(segment.start)}:end=${number(segment.end)},` +
            `asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`
          );
        } else {
          filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${number(duration)},asetpts=PTS-STARTPTS[a${index}]`);
        }
        audioLabels.push(`[a${index}]`);
      }
    }

    if (segments.length === 1) {
      if (includeVideo) filters.push('[v0]null[vbase]');
      if (includeAudio) filters.push('[a0]anull[abase]');
    } else if (includeVideo && includeAudio) {
      filters.push(`${segments.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segments.length}:v=1:a=1[vbase][abase]`);
    } else if (includeVideo) {
      filters.push(`${videoLabels.join('')}concat=n=${segments.length}:v=1:a=0[vbase]`);
    } else {
      filters.push(`${audioLabels.join('')}concat=n=${segments.length}:v=0:a=1[abase]`);
    }

    const timelineDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
    let videoLabel = 'vbase';
    let audioLabel = 'abase';

    /* Mix/replace before the project-wide reverse and tempo filters so the
       added layer stays locked to its timeline position in rendered output. */
    if (includeAudio && audioLayer?.asset) {
      const layerPath = await this.ensureAsset(audioLayer.asset);
      if (!(await this.probeAudio(audioLayer.asset))) {
        throw new Error('The selected audio layer has no decodable audio stream.');
      }
      const inputIndex = uniqueAssets.length;
      args.push('-i', layerPath);
      const delayMs = Math.max(0, Math.round(audioLayer.startAt * 1000));
      filters.push(
        `[${inputIndex}:a:0]atrim=start=${number(audioLayer.sourceStart || 0)},asetpts=PTS-STARTPTS,` +
        `adelay=${delayMs}|${delayMs},volume=${number(audioLayer.gain)},` +
        `apad,atrim=duration=${number(timelineDuration)},aresample=48000,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo[overlay]`
      );
      if (audioLayer.mode === 'replace') {
        filters.push(`[${audioLabel}]volume=0[mutebase]`);
        filters.push(`[mutebase][overlay]amix=inputs=2:duration=first:normalize=0[alayered]`);
      } else {
        filters.push(`[${audioLabel}][overlay]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[alayered]`);
      }
      audioLabel = 'alayered';
    }

    if (includeVideo) {
      const videoFx = [];
      if (reverse) videoFx.push('reverse');
      if (Math.abs(speed - 1) > 0.0001) videoFx.push(`setpts=PTS/${number(speed)}`);
      videoFx.push('fps=30');
      if (videoFx.length) {
        filters.push(`[${videoLabel}]${videoFx.join(',')}[vfx]`);
        videoLabel = 'vfx';
      }
    }
    if (includeAudio) {
      const audioFx = [];
      if (reverse) audioFx.push('areverse');
      audioFx.push(...atempoChain(speed));
      if (audioFx.length) {
        filters.push(`[${audioLabel}]${audioFx.join(',')}[afx]`);
        audioLabel = 'afx';
      }
    }

    /* Bounce is a palindrome: the render so far, then the same render played
       backwards. Both halves are buffered whole, so it costs twice the frames
       of a straight export as well as twice the duration. */
    if (bounce) {
      if (includeVideo) {
        filters.push(
          `[${videoLabel}]split[bounce-va][bounce-vb]`,
          '[bounce-vb]reverse[bounce-vr]',
          '[bounce-va][bounce-vr]concat=n=2:v=1:a=0[vbounce]'
        );
        videoLabel = 'vbounce';
      }
      if (includeAudio) {
        filters.push(
          `[${audioLabel}]asplit[bounce-aa][bounce-ab]`,
          '[bounce-ab]areverse[bounce-ar]',
          '[bounce-aa][bounce-ar]concat=n=2:v=0:a=1[abounce]'
        );
        audioLabel = 'abounce';
      }
    }

    const renderedDuration = (timelineDuration / (Math.abs(speed) > 0.0001 ? speed : 1)) * (bounce ? 2 : 1);
    return { args, filters, videoLabel, audioLabel, timelineDuration, renderedDuration };
  }

  async exportProject({ segments, assets, audioLayer, width, height, speed, reverse, bounce, format, extension }) {
    const audioOnly = ['mp3', 'wav', 'ogg'].includes(format);
    const videoOnly = format === 'gif';
    const includeVideo = !audioOnly;
    const includeAudio = !videoOnly;
    const graph = await this.buildGraph({
      segments, assets, audioLayer, width, height, speed, reverse, bounce, includeVideo, includeAudio
    });
    const { args, filters } = graph;
    let { videoLabel, audioLabel } = graph;

    if (format === 'gif') {
      filters.push(
        `[${videoLabel}]fps=12,scale=w='min(960,iw)':h=-2:flags=lanczos,split[gif-a][gif-b]`,
        '[gif-a]palettegen[palette]',
        '[gif-b][palette]paletteuse[vgif]'
      );
      videoLabel = 'vgif';
    }

    const finalExtension = format === 'custom' ? extension : format;
    const output = `clack-export.${finalExtension}`;
    try { await this.ffmpeg.deleteFile(output); } catch { /* first export */ }
    args.push('-filter_complex', filters.join(';'));
    if (includeVideo) args.push('-map', `[${videoLabel}]`);
    if (includeAudio) args.push('-map', `[${audioLabel}]`);
    args.push(...(OUTPUT_ARGS[format] || []), output);

    const code = await this.ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg stopped with exit code ${code}. This codec/container may not be in the browser build.`);
    const data = await this.ffmpeg.readFile(output);
    const result = {
      blob: new Blob([data.buffer], { type: MIME_TYPES[format] || 'application/octet-stream' }),
      extension: finalExtension
    };
    /* FFmpeg filters (especially reverse and VP9) retain sizeable WASM heaps.
       Recycle the worker after a completed render so consecutive exports start
       with clean memory instead of eventually trapping out-of-bounds. */
    this.cancel();
    return result;
  }

  /* Popcorn's converter takes the two raw files described in POPCORN and
     nothing else, so this writes exactly those. They are rendered in separate
     passes: a second of raw video is 6.9 MB and a second of PCM 176 kB, and
     holding both in the WebAssembly heap at once halves how long a clip can
     be before the tab gives up. */
  async exportRaw({ segments, assets, audioLayer, width, height, speed, reverse, bounce, framing = 'fill', streams = 'both', filterFrame = null }) {
    const wantVideo = streams !== 'audio';
    const wantAudio = streams !== 'video';
    const files = [];

    if (wantVideo) {
      this.progressWindow = wantAudio ? { base: 0, span: 0.85 } : { base: 0, span: 1 };
      const graph = await this.buildGraph({
        segments, assets, audioLayer, width, height, speed, reverse, bounce,
        includeVideo: true, includeAudio: false, pixelFormat: 'rgb24'
      });
      const target = `${POPCORN.width}:${POPCORN.height}`;
      /* Fill scales past the frame and trims the overhang; fit keeps the whole
         picture and pads the gap. Either way the converter gets 320 × 240. */
      const framed = framing === 'fit'
        ? `scale=${target}:force_original_aspect_ratio=decrease,pad=${target}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${target}:force_original_aspect_ratio=increase,crop=${target}`;
      graph.filters.push(`[${graph.videoLabel}]${framed},setsar=1,fps=${POPCORN.fps},format=rgb24[raw]`);
      const raw = await this.runToFile({
        args: graph.args,
        filters: graph.filters,
        output: 'popcorn.rgb',
        outputArgs: ['-map', '[raw]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-r', String(POPCORN.fps)],
        mimeType: 'application/octet-stream'
      });
      files.push(filterFrame ? await this.filterRaw(raw, filterFrame) : raw);
      this.cancel();
    }

    if (wantAudio) {
      this.progressWindow = wantVideo ? { base: 0.85, span: 0.15 } : { base: 0, span: 1 };
      const graph = await this.buildGraph({
        segments, assets, audioLayer, width, height, speed, reverse, bounce,
        includeVideo: false, includeAudio: true
      });
      files.push(await this.runToFile({
        args: graph.args,
        filters: graph.filters,
        output: 'popcorn.pcm',
        outputArgs: [
          '-map', `[${graph.audioLabel}]`, '-f', 's16le', '-c:a', 'pcm_s16le',
          '-ar', String(POPCORN.sampleRate), '-ac', String(POPCORN.channels)
        ],
        mimeType: 'application/octet-stream'
      }));
      this.cancel();
    }

    this.progressWindow = null;
    return { files };
  }

  /* One still per frame, collected into a ZIP. Each frame is read out of the
     FFmpeg filesystem and deleted again before the next is read, so the
     WebAssembly heap holds the sheet only once rather than alongside the copy
     the archive is being built from. */
  async exportImages({ segments, assets, audioLayer, width, height, speed, reverse, bounce, fps = 10, imageFormat = 'png', maxWidth = 0, maxFrames = 1200, baseName = 'frames', filterFrame = null }) {
    const graph = await this.buildGraph({
      segments, assets, audioLayer, width, height, speed, reverse, bounce,
      includeVideo: true, includeAudio: false
    });
    const extension = imageFormat === 'jpg' ? 'jpg' : 'png';
    const resize = maxWidth > 0 ? `,scale=w='min(${maxWidth},iw)':h=-2:flags=lanczos` : '';
    graph.filters.push(`[${graph.videoLabel}]fps=${number(fps)}${resize},format=rgb24[stills]`);

    const pattern = `still-%05d.${extension}`;
    const args = [
      ...graph.args, '-filter_complex', graph.filters.join(';'), '-map', '[stills]',
      '-frames:v', String(Math.max(1, Math.round(maxFrames))),
      ...(extension === 'jpg' ? ['-c:v', 'mjpeg', '-q:v', '3'] : ['-c:v', 'png']),
      '-f', 'image2', pattern
    ];
    const code = await this.ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg stopped with exit code ${code} while rendering stills.`);

    const written = (await this.ffmpeg.listDir('/'))
      .map(entry => entry.name)
      .filter(name => name.startsWith('still-') && name.endsWith(`.${extension}`))
      .sort();
    if (!written.length) throw new Error('FFmpeg produced no frames for this range.');

    const zip = new StoredZip();
    for (let index = 0; index < written.length; index += 1) {
      const data = await this.ffmpeg.readFile(written[index]);
      let bytes = new Uint8Array(data.buffer);
      /* With an effect stack the still is decoded, filtered and re-encoded on
         the way into the archive. PNG only — a JPEG round trip would put the
         filters' output through a second lossy pass. */
      if (filterFrame) {
        const image = await filterFrame(await this.decodeStill(bytes), index, written.length);
        bytes = await this.encodeStill(image);
      }
      zip.add(`${baseName}/${written[index]}`, bytes);
      await this.ffmpeg.deleteFile(written[index]);
      this.callbacks.onProgress?.((index + 1) / written.length);
    }
    const result = { blob: zip.close(), frames: written.length, extension };
    this.cancel();
    return result;
  }

  /* ---- rendering with an effect stack ------------------------------------
     FFmpeg has no idea what ClackPaint's filters are, and teaching it would
     mean writing them twice. So a filtered export is three passes rather than
     one: FFmpeg lays the project out as stills, the caller's filter runs over
     each still in turn, and FFmpeg puts the filtered stills back together with
     the audio it rendered on the way past.

     Stills, rather than a raw stream, because a raw 1080p frame is 8 MB and a
     ten-second clip of them is two and a half gigabytes in a filesystem that
     lives in the WebAssembly heap. PNG is lossless, so the round trip costs
     time rather than picture.

     The filtered frame is written back under its own name and the original
     deleted straight away, so the heap holds one copy of the sequence rather
     than two. */

  async decodeStill(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  async encodeStill(image) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d').putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* Runs `filterFrame` over every still FFmpeg wrote, in place. Returns the
     names of the filtered files, in order. */
  async filterStills(names, filterFrame, onProgress) {
    const filtered = [];
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const output = `fx-${name}`;
      const data = await this.ffmpeg.readFile(name);
      const image = await this.decodeStill(new Uint8Array(data.buffer));
      const result = await filterFrame(image, index, names.length);
      await this.ffmpeg.writeFile(output, await this.encodeStill(result));
      await this.ffmpeg.deleteFile(name);
      filtered.push(output);
      onProgress?.((index + 1) / names.length);
    }
    return filtered;
  }

  /* The project laid out as one still per frame, at full project size. */
  async renderStills({ segments, assets, audioLayer, width, height, speed, reverse, bounce, fps, maxFrames, maxWidth = 0 }) {
    const graph = await this.buildGraph({
      segments, assets, audioLayer, width, height, speed, reverse, bounce,
      includeVideo: true, includeAudio: false
    });
    const resize = maxWidth > 0 ? `,scale=w='min(${maxWidth},iw)':h=-2:flags=lanczos` : '';
    graph.filters.push(`[${graph.videoLabel}]fps=${number(fps)}${resize},format=rgb24[stills]`);
    const code = await this.ffmpeg.exec([
      ...graph.args, '-filter_complex', graph.filters.join(';'), '-map', '[stills]',
      '-frames:v', String(Math.max(1, Math.round(maxFrames))),
      '-c:v', 'png', '-f', 'image2', 'still-%05d.png'
    ]);
    if (code !== 0) throw new Error(`FFmpeg stopped with exit code ${code} while laying the clip out as frames.`);
    const names = (await this.ffmpeg.listDir('/'))
      .map(entry => entry.name)
      .filter(name => name.startsWith('still-') && name.endsWith('.png'))
      .sort();
    if (!names.length) throw new Error('FFmpeg produced no frames for this range.');
    return names;
  }

  /* The project's audio alone, so the encode at the end has something to mux
     against the filtered frames. Null when the project has none. */
  async renderAudioTrack(project) {
    const graph = await this.buildGraph({ ...project, includeVideo: false, includeAudio: true });
    const output = 'fx-audio.m4a';
    try { await this.ffmpeg.deleteFile(output); } catch { /* nothing written yet */ }
    const code = await this.ffmpeg.exec([
      ...graph.args, '-filter_complex', graph.filters.join(';'), '-map', `[${graph.audioLabel}]`,
      '-c:a', 'aac', '-b:a', '192k', output
    ]);
    /* A clip with no audio stream at all is normal, not a failure. */
    return code === 0 ? output : null;
  }

  async exportWithEffects({
    segments, assets, audioLayer, width, height, speed, reverse, bounce,
    format, extension, fps = 30, maxFrames = 1200, filterFrame, onStage
  }) {
    const project = { segments, assets, audioLayer, width, height, speed, reverse, bounce };
    const wantsAudio = format !== 'gif';

    onStage?.('Laying the clip out as frames…');
    const stills = await this.renderStills({ ...project, fps, maxFrames });

    let audio = null;
    if (wantsAudio) {
      onStage?.('Rendering the audio…');
      audio = await this.renderAudioTrack(project);
    }

    onStage?.(`Running the effects over ${stills.length} frames…`);
    const filtered = await this.filterStills(stills, filterFrame, value => this.callbacks.onProgress?.(value));

    onStage?.('Encoding the result…');
    const finalExtension = format === 'custom' ? extension : format;
    const output = `clack-export.${finalExtension}`;
    try { await this.ffmpeg.deleteFile(output); } catch { /* first export */ }

    const args = ['-framerate', number(fps), '-i', 'fx-still-%05d.png'];
    if (audio) args.push('-i', audio);
    if (format === 'gif') {
      args.push('-filter_complex',
        `[0:v]fps=12,scale=w='min(960,iw)':h=-2:flags=lanczos,split[gif-a][gif-b];[gif-a]palettegen[palette];[gif-b][palette]paletteuse[vgif]`,
        '-map', '[vgif]');
    } else {
      args.push('-map', '0:v');
      if (audio) args.push('-map', '1:a', '-shortest');
    }
    args.push(...(audio ? OUTPUT_ARGS[format] || [] : withoutAudioArgs(OUTPUT_ARGS[format] || [])));
    args.push(output);

    const code = await this.ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg stopped with exit code ${code} while encoding the filtered frames.`);
    const data = await this.ffmpeg.readFile(output);
    const result = {
      blob: new Blob([data.buffer], { type: MIME_TYPES[format] || 'application/octet-stream' }),
      extension: finalExtension,
      frames: filtered.length
    };
    this.cancel();
    return result;
  }

  /* The Popcorn export is the one place the frames arrive already uncompressed:
     320 × 240 packed RGB, three bytes a pixel, one frame after another. So an
     effect stack costs no codec round trip here at all — the bytes are widened
     to RGBA for the filters, which is the only layout they know, and packed
     back down afterwards. */
  async filterRaw(file, filterFrame) {
    const { width, height } = POPCORN;
    const packed = new Uint8Array(await file.blob.arrayBuffer());
    const frameBytes = width * height * 3;
    const frames = Math.floor(packed.length / frameBytes);
    for (let index = 0; index < frames; index += 1) {
      const at = index * frameBytes;
      const image = new ImageData(width, height);
      for (let pixel = 0, source = at, target = 0; pixel < width * height; pixel += 1, source += 3, target += 4) {
        image.data[target] = packed[source];
        image.data[target + 1] = packed[source + 1];
        image.data[target + 2] = packed[source + 2];
        image.data[target + 3] = 255;
      }
      const result = await filterFrame(image, index, frames);
      for (let pixel = 0, source = 0, target = at; pixel < width * height; pixel += 1, source += 4, target += 3) {
        packed[target] = result.data[source];
        packed[target + 1] = result.data[source + 1];
        packed[target + 2] = result.data[source + 2];
      }
      this.callbacks.onProgress?.((index + 1) / frames);
    }
    return { ...file, blob: new Blob([packed], { type: 'application/octet-stream' }), bytes: packed.length };
  }

  /* Shared tail for the raw passes: run one graph, read its single output back
     as a Blob, then drop the file so the heap does not carry it into the next
     pass. */
  async runToFile({ args, filters, output, outputArgs, mimeType }) {
    try { await this.ffmpeg.deleteFile(output); } catch { /* nothing written yet */ }
    const code = await this.ffmpeg.exec([...args, '-filter_complex', filters.join(';'), ...outputArgs, output]);
    if (code !== 0) throw new Error(`FFmpeg stopped with exit code ${code} while writing ${output}.`);
    const data = await this.ffmpeg.readFile(output);
    const blob = new Blob([data.buffer], { type: mimeType });
    try { await this.ffmpeg.deleteFile(output); } catch { /* already gone */ }
    return { name: output, blob, bytes: blob.size };
  }

  cancel() {
    try { this.ffmpeg.terminate(); } catch { /* engine was already stopped */ }
    this.coreObjectURLs.forEach(url => URL.revokeObjectURL(url));
    this.coreObjectURLs = [];
    this.loaded = false;
    this.loading = null;
    this.written.clear();
    this.createInstance();
    this.callbacks.onState?.('STANDBY');
  }
}
