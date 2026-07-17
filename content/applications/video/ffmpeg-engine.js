import { FFmpeg } from './vendor/ffmpeg/index.js';

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
    this.createInstance();
  }

  createInstance() {
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => {
      if (this.collectLogs) this.logs.push(message);
      this.callbacks.onLog?.(message);
    });
    this.ffmpeg.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) this.callbacks.onProgress?.(Math.max(0, Math.min(1, progress)));
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

  async exportProject({ segments, assets, audioLayer, width, height, speed, reverse, format, extension }) {
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

    const audioOnly = ['mp3', 'wav', 'ogg'].includes(format);
    const videoOnly = format === 'gif';
    const includeVideo = !audioOnly;
    const includeAudio = !videoOnly;
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
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${index}]`
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
