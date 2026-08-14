/* audioGen inference worker: model downloads and generation stay off the UI thread. */
import {
  AutoTokenizer,
  BaseStreamer,
  MusicgenForConditionalGeneration,
  env,
} from '../../../vendor/transformers/transformers.min.js';
import { getModelDefinition, getModelBuild } from './model-catalog.js';

/* Use the repository's pinned ONNX runtime instead of a second CDN download. */
env.backends.onnx.wasm.wasmPaths = new URL('../../../vendor/transformers/', self.location.href).href;

/* An adapter is only worth having here if it can do half precision. The
 * catalog's WebGPU build is fp16 throughout, and the full precision weights it
 * would otherwise need are 1.6 GB for the decoder alone — past the point where
 * a browser app should be asking. Without shader-f16 the CPU build is the
 * better answer, so this reports no rather than falling back to fp32. */
async function pickDevice() {
  try {
    if (!('gpu' in navigator)) return 'wasm';
    const adapter = await navigator.gpu.requestAdapter();
    return adapter?.features.has('shader-f16') ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

class CallbackStreamer extends BaseStreamer {
  constructor(callback) {
    super();
    this.callback = callback;
  }

  put(value) {
    this.callback(value);
  }

  end() {
    this.callback(undefined);
  }
}

const fileProgress = new Map();
let lastProgressReport = 0;

function reportDownload(info) {
  if (!info?.file) return;
  if (info.status === 'initiate') {
    postMessage({ type: 'load-detail', detail: `Fetching ${info.file}...` });
    return;
  }
  if (info.status !== 'progress') return;

  fileProgress.set(info.file, {
    loaded: Number(info.loaded) || 0,
    total: Number(info.total) || 0,
  });
  const now = performance.now();
  if (now - lastProgressReport < 100) return;
  lastProgressReport = now;

  let loaded = 0;
  let total = 0;
  for (const progress of fileProgress.values()) {
    loaded += progress.loaded;
    total += progress.total;
  }
  postMessage({ type: 'load-progress', loaded, total });
}

function encodeWave(samples, sampleRate, channels, frames) {
  const bytesPerSample = 2;
  const dataLength = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeText = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, samples[channel * frames + frame] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}

function tensorToWave(audioValues, sampleRate) {
  const samples = audioValues.data;
  const dims = audioValues.dims || [samples.length];
  const frames = Number(dims.at(-1)) || samples.length;
  const possibleChannels = dims.length >= 2 ? Number(dims.at(-2)) : 1;
  const channels = possibleChannels > 0 && possibleChannels * frames <= samples.length
    ? possibleChannels
    : 1;
  return {
    buffer: encodeWave(samples, sampleRate, channels, frames),
    channels,
    frames,
  };
}

class MusicGenAdapter {
  tokenizer = null;
  model = null;

  async load(definition, device) {
    const common = { progress_callback: reportDownload };
    [this.tokenizer, this.model] = await Promise.all([
      AutoTokenizer.from_pretrained(definition.repository, common),
      MusicgenForConditionalGeneration.from_pretrained(definition.repository, {
        ...common,
        device,
        dtype: getModelBuild(definition, device).dtype,
      }),
    ]);
  }

  async generate(options) {
    const { prompt, duration, guidance, temperature } = options;
    const inputs = this.tokenizer(prompt);
    const configuredMaximum = Number(this.model.generation_config.max_length) || 1500;
    /* MusicGen emits about 50 audio tokens per second; four tokens prime the delay mask. */
    const maxLength = Math.min(Math.max(Math.floor(duration * 50), 1) + 4, configuredMaximum);
    let tokens = 0;
    const streamer = new CallbackStreamer(value => {
      if (value !== undefined) tokens += 1;
      postMessage({
        type: 'generation-progress',
        progress: value === undefined ? 1 : Math.min(0.99, tokens / maxLength),
      });
    });

    const audioValues = await this.model.generate({
      ...inputs,
      max_length: maxLength,
      guidance_scale: guidance,
      temperature,
      do_sample: true,
      streamer,
    });
    const sampleRate = Number(this.model.config.audio_encoder.sampling_rate) || 32000;
    return { ...tensorToWave(audioValues, sampleRate), sampleRate };
  }
}

const ADAPTERS = Object.freeze({
  musicgen: () => new MusicGenAdapter(),
});

let activeModelId = null;
let activeAdapter = null;
let activeDevice = null;
let generating = false;

async function loadModel(modelId) {
  const definition = getModelDefinition(modelId);
  if (!definition) throw new Error(`Unknown audio model: ${modelId}`);
  if (activeAdapter && activeModelId === modelId) {
    postMessage({ type: 'model-ready', modelId, device: activeDevice });
    return;
  }
  const createAdapter = ADAPTERS[definition.family];
  if (!createAdapter) throw new Error(`No adapter is registered for ${definition.family}.`);

  /* An adapter that answers requestAdapter is not an adapter that will hold a
   * 1.1 GB model — a laptop with a small memory budget refuses somewhere
   * inside the session build, and there is nothing to inspect beforehand that
   * would have told us. So the CPU build is a retry rather than a precondition:
   * a machine that cannot take the fast path still gets working audio, at the
   * cost of having fetched the wrong weights first. */
  let device = await pickDevice();
  fileProgress.clear();
  activeAdapter = createAdapter();
  activeModelId = null;
  activeDevice = null;
  postMessage({ type: 'load-detail', detail: `Preparing ${definition.label}...` });
  try {
    await activeAdapter.load(definition, device);
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    fileProgress.clear();
    activeAdapter = createAdapter();
    postMessage({ type: 'load-detail', detail: 'The graphics adapter refused the model. Falling back to the processor...' });
    await activeAdapter.load(definition, device);
  }
  activeModelId = modelId;
  activeDevice = device;
  postMessage({ type: 'model-ready', modelId, device });
}

async function generate(options) {
  if (!activeAdapter || activeModelId !== options.modelId) {
    throw new Error('Load the selected model before generating audio.');
  }
  if (generating) throw new Error('Audio generation is already in progress.');
  generating = true;
  try {
    const result = await activeAdapter.generate(options);
    postMessage({
      type: 'result',
      buffer: result.buffer,
      sampleRate: result.sampleRate,
      channels: result.channels,
      frames: result.frames,
    }, [result.buffer]);
  } finally {
    generating = false;
  }
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === 'load') await loadModel(message.modelId);
    if (message.type === 'generate') await generate(message.options);
  } catch (error) {
    postMessage({
      type: 'error',
      phase: message.type,
      message: String(error?.message || error),
    });
  }
};

postMessage({ type: 'worker-ready' });
