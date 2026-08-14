/* audioGen inference worker: model downloads and generation stay off the UI thread.
 *
 * One adapter per model family, picked from the catalog's `family` field. An
 * adapter loads whatever it needs and returns planar samples; everything after
 * that — the tape-speed resampler, the WAV header, the transfer back to the
 * page — is shared, so a new family is a class and a line in ADAPTERS.
 *
 * The Transformers.js bundle is imported on demand rather than at the top of
 * the file, so a session that opens the app and reads the model descriptions
 * without loading one does not pay for a megabyte of ONNX runtime.
 */
import { getModelBuild, getModelDefinition, getRepository, supportsWebGPU } from './model-catalog.js';
import {
  CFG_DEFAULTS,
  Mrt2Engine,
  SAMPLE_RATE as MRT2_SAMPLE_RATE,
  StreamingDecoder,
} from './mrt2/engine.js';
import { fetchBytes, loadMrt2Sessions } from './mrt2/loader.js';
import { MAPPER_NOISE } from './mrt2/mapper-noise.js';
import { loadSentencePiece } from './mrt2/sentencepiece.js';

let runtime = null;
let onnxRuntime = null;

/* Magenta RealTime 2 skips Transformers.js entirely and drives ONNX Runtime
 * itself, so it loads the runtime's own bundle — the same build, from
 * vendor/onnxruntime-web, reading its WebAssembly out of vendor/transformers
 * where that build's .wasm files already live. */
async function loadOnnxRuntime() {
  if (!onnxRuntime) {
    onnxRuntime = await import('../../../vendor/onnxruntime-web/ort.webgpu.min.mjs');
    onnxRuntime.env.wasm.wasmPaths = new URL('../../../vendor/transformers/', self.location.href).href;
  }
  return onnxRuntime;
}

async function loadRuntime() {
  if (!runtime) {
    runtime = await import('../../../vendor/transformers/transformers.min.js');
    /* Use the repository's pinned ONNX runtime instead of a second CDN download. */
    runtime.env.backends.onnx.wasm.wasmPaths =
      new URL('../../../vendor/transformers/', self.location.href).href;
  }
  return runtime;
}

/* An adapter is only worth having for the models the catalog builds fp16
 * weights for, and only if it can do half precision: without shader-f16 the
 * WebGPU backend widens the CPU build on every dispatch and lands slower than
 * the build it replaced. Everything else runs on the processor. */
async function pickDevice(definition) {
  if (!supportsWebGPU(definition)) return 'wasm';
  try {
    if (!('gpu' in navigator)) return 'wasm';
    const adapter = await navigator.gpu.requestAdapter();
    return adapter?.features.has('shader-f16') ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
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

function reportGeneration(progress) {
  postMessage({ type: 'generation-progress', progress: Math.max(0, Math.min(1, progress)) });
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

function tensorToPlanar(audioValues) {
  const samples = audioValues.data;
  const dims = audioValues.dims || [samples.length];
  const frames = Number(dims.at(-1)) || samples.length;
  const possibleChannels = dims.length >= 2 ? Number(dims.at(-2)) : 1;
  const channels = possibleChannels > 0 && possibleChannels * frames <= samples.length
    ? possibleChannels
    : 1;
  return { samples, channels, frames };
}

/* The speech models have no speed of their own — the rate is baked into the
 * weights — so the Speed control is a tape transport: resampling the finished
 * waveform moves the pitch with it, which is the honest version of the effect
 * and the one that sounds right on a retro desktop. */
function resample(result, speed) {
  const ratio = Number(speed) || 1;
  if (Math.abs(ratio - 1) < 0.001) return result;
  const { samples, channels, frames } = result;
  const outFrames = Math.max(1, Math.round(frames / ratio));
  const output = new Float32Array(outFrames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const inOffset = channel * frames;
    const outOffset = channel * outFrames;
    for (let frame = 0; frame < outFrames; frame += 1) {
      const position = frame * ratio;
      const index = Math.floor(position);
      const next = Math.min(frames - 1, index + 1);
      const blend = position - index;
      output[outOffset + frame] =
        samples[inOffset + index] * (1 - blend) + samples[inOffset + next] * blend;
    }
  }
  return { ...result, samples: output, frames: outFrames };
}

/* Both speech models lose the thread on a long passage — SpeechT5 in
 * particular decides it has finished and stops halfway through a sentence of
 * more than about seventy characters — so text is spoken a piece at a time and
 * joined up. Sentences break first, then clauses at commas, and only then
 * between words, so a cut lands where a reader would draw breath. Doing it
 * this way also gives generation a real progress figure, which neither model
 * reports on its own. */
function splitSentences(text, limit) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  const add = (pieces, split) => {
    for (const piece of pieces) {
      if ((current + piece).trim().length <= limit) {
        current += piece;
      } else if (piece.trim().length <= limit) {
        push();
        current = piece;
      } else if (split) {
        push();
        split(piece);
      } else {
        push();
        current = piece;
        push();
      }
    }
  };

  const byWord = piece => {
    for (const word of piece.split(' ')) {
      if ((current + word).length > limit) push();
      current += `${word} `;
    }
    push();
  };
  const byClause = piece => add(piece.match(/[^,–—]+[,–—]*\s*/g) || [piece], byWord);

  add(clean.match(/[^.!?;:…]+[.!?;:…]*\s*/g) || [clean], byClause);
  push();
  return chunks;
}

/* SpeechT5 comes out at about a tenth of full scale, which is a quiet clip to
 * save and play next to everything else the app makes, so speech is lifted to
 * a common level before it leaves the worker. */
function normalise(result, target = 0.89) {
  let peak = 0;
  for (const sample of result.samples) peak = Math.max(peak, Math.abs(sample));
  if (peak < 0.0001 || Math.abs(peak - target) < 0.02) return result;
  const gain = target / peak;
  const samples = new Float32Array(result.samples.length);
  for (let i = 0; i < samples.length; i += 1) samples[i] = result.samples[i] * gain;
  return { ...result, samples };
}

function joinSpeech(parts, sampleRate) {
  const gap = Math.round(sampleRate * 0.12);
  const frames = parts.reduce((total, part) => total + part.length, 0) + gap * Math.max(0, parts.length - 1);
  const samples = new Float32Array(frames);
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length + gap;
  }
  return { samples, channels: 1, frames, sampleRate };
}

class MusicGenAdapter {
  tokenizer = null;
  model = null;

  async load(definition, variantId, device) {
    const { AutoTokenizer, MusicgenForConditionalGeneration } = await loadRuntime();
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

  async generate({ prompt, controls }) {
    const { BaseStreamer } = await loadRuntime();
    const { duration, guidance, temperature } = controls;
    const inputs = this.tokenizer(prompt);
    const configuredMaximum = Number(this.model.generation_config.max_length) || 1500;
    /* MusicGen emits about 50 audio tokens per second; four tokens prime the delay mask. */
    const maxLength = Math.min(Math.max(Math.floor(duration * 50), 1) + 4, configuredMaximum);
    let tokens = 0;
    const streamer = new (class extends BaseStreamer {
      put() {
        tokens += 1;
        reportGeneration(Math.min(0.99, tokens / maxLength));
      }

      end() {
        reportGeneration(1);
      }
    })();

    const audioValues = await this.model.generate({
      ...inputs,
      max_length: maxLength,
      guidance_scale: guidance,
      temperature,
      do_sample: true,
      streamer,
    });
    const sampleRate = Number(this.model.config.audio_encoder.sampling_rate) || 32000;
    return { ...tensorToPlanar(audioValues), sampleRate };
  }
}

class SpeechT5Adapter {
  tokenizer = null;
  processor = null;
  model = null;
  vocoder = null;
  embeddings = new Map();

  async load(definition, variantId, device) {
    const { AutoTokenizer, AutoProcessor, SpeechT5ForTextToSpeech, SpeechT5HifiGan } = await loadRuntime();
    const build = getModelBuild(definition, device);
    const common = { progress_callback: reportDownload };
    [this.tokenizer, this.processor, this.model, this.vocoder] = await Promise.all([
      AutoTokenizer.from_pretrained(definition.repository, common),
      AutoProcessor.from_pretrained(definition.repository, common),
      SpeechT5ForTextToSpeech.from_pretrained(definition.repository, {
        ...common,
        device,
        dtype: build.dtype,
      }),
      SpeechT5HifiGan.from_pretrained(definition.vocoder, {
        ...common,
        dtype: build.dtype.vocoder,
      }),
    ]);
  }

  async speaker(definition, voice) {
    if (!this.embeddings.has(voice)) {
      const { Tensor } = await loadRuntime();
      const url = `${definition.speech.speakerEmbeddingBase}${voice}.bin`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch the "${voice}" speaker embedding.`);
      const data = new Float32Array(await response.arrayBuffer());
      this.embeddings.set(voice, new Tensor('float32', data, [1, data.length]));
    }
    return this.embeddings.get(voice);
  }

  async generate({ definition, prompt, controls }) {
    const speaker = await this.speaker(definition, controls.voice);
    const sentences = splitSentences(prompt, definition.speech.sentenceLength);
    if (!sentences.length) throw new Error('There is nothing to say — type some text first.');

    const parts = [];
    for (const [index, sentence] of sentences.entries()) {
      reportGeneration(index / sentences.length);
      const { input_ids } = this.tokenizer(sentence);
      const { waveform } = await this.model.generate_speech(input_ids, speaker, { vocoder: this.vocoder });
      parts.push(waveform.data);
    }
    reportGeneration(1);
    const sampleRate = Number(this.processor?.feature_extractor?.config?.sampling_rate) || 16000;
    return resample(normalise(joinSpeech(parts, sampleRate)), controls.speed);
  }
}

class SupertonicAdapter {
  synthesiser = null;
  voices = new Map();

  async load(definition, variantId, device) {
    const { pipeline } = await loadRuntime();
    this.synthesiser = await pipeline('text-to-speech', definition.repository, {
      device,
      dtype: getModelBuild(definition, device).dtype,
      progress_callback: reportDownload,
    });
  }

  /* The pipeline will fetch a style vector from a URL itself, but it does that
   * on every call; holding the fetched buffer means only the first clip in a
   * voice waits for the network. */
  async voice(definition, name) {
    if (!this.voices.has(name)) {
      const response = await fetch(`${definition.speech.voiceBase}${name}.bin`);
      if (!response.ok) throw new Error(`Could not fetch the "${name}" voice.`);
      this.voices.set(name, new Float32Array(await response.arrayBuffer()));
    }
    return this.voices.get(name);
  }

  async generate({ definition, prompt, controls }) {
    const style = await this.voice(definition, controls.voice);
    const sentences = splitSentences(prompt, definition.speech.sentenceLength);
    if (!sentences.length) throw new Error('There is nothing to say — type some text first.');

    const parts = [];
    let sampleRate = 44100;
    for (const [index, sentence] of sentences.entries()) {
      reportGeneration(index / sentences.length);
      const spoken = await this.synthesiser(sentence, {
        speaker_embeddings: style,
        num_inference_steps: controls.steps,
        speed: controls.speed,
      });
      parts.push(spoken.audio);
      sampleRate = Number(spoken.sampling_rate) || sampleRate;
    }
    reportGeneration(1);
    /* Speed is the model's own, so there is nothing to resample afterwards. */
    return normalise(joinSpeech(parts, sampleRate));
  }
}

class VitsAdapter {
  tokenizer = null;
  model = null;

  async load(definition, variantId, device) {
    const { AutoTokenizer, VitsModel } = await loadRuntime();
    const repository = getRepository(definition, variantId);
    const common = { progress_callback: reportDownload };
    [this.tokenizer, this.model] = await Promise.all([
      AutoTokenizer.from_pretrained(repository, common),
      VitsModel.from_pretrained(repository, {
        ...common,
        device,
        dtype: getModelBuild(definition, device).dtype,
      }),
    ]);
  }

  async generate({ definition, prompt, controls }) {
    const sentences = splitSentences(prompt, definition.speech.sentenceLength);
    if (!sentences.length) throw new Error('There is nothing to say — type some text first.');

    const parts = [];
    for (const [index, sentence] of sentences.entries()) {
      reportGeneration(index / sentences.length);
      const { waveform } = await this.model(this.tokenizer(sentence));
      parts.push(waveform.data);
    }
    reportGeneration(1);
    const sampleRate = Number(this.model.config.sampling_rate) || 16000;
    return resample(normalise(joinSpeech(parts, sampleRate)), controls.speed);
  }
}

class Mrt2Adapter {
  engine = null;

  async load(definition) {
    const ort = await loadOnnxRuntime();
    const { baseUrl, graphs, tokenizer } = definition.mrt2;
    const sessions = await loadMrt2Sessions(ort, {
      baseUrl,
      graphs,
      onProgress: (loaded, total) => postMessage({ type: 'load-progress', loaded, total }),
      onDetail: detail => postMessage({ type: 'load-detail', detail }),
    });
    const spm = await fetchBytes(`${baseUrl}${tokenizer}`);
    this.engine = new Mrt2Engine(ort, sessions, loadSentencePiece(spm), MAPPER_NOISE);
  }

  async generate({ definition, prompt, controls }) {
    const frames = Math.max(1, Math.round(controls.duration * 25));

    postMessage({ type: 'load-detail', detail: 'Reading the prompt...' });
    const style = await this.engine.styleTokens([{ text: prompt, weight: 1 }]);

    const state = await this.engine.startStream(style, {
      cfg: { ...CFG_DEFAULTS, musiccoca: controls.guidance },
    });
    /* The last frame carries no audio of its own — the decoder emits
     * (frames - 1) windows — so one extra is generated for the tail. */
    const decoder = new StreamingDecoder(this.engine);
    for (let frame = 0; frame <= frames; frame += 1) {
      decoder.push([await this.engine.step(state, controls.temperature, 40)]);
      /* Decoding costs about as much as generating, so it is reported as the
       * last fifth of the bar rather than pretending it is instant. */
      reportGeneration((frame / frames) * 0.8);
    }

    postMessage({ type: 'load-detail', detail: 'Decoding audio...' });
    const parts = [];
    for (;;) {
      const chunk = await decoder.pull(true);
      if (!chunk) break;
      parts.push(chunk);
    }
    reportGeneration(1);

    /* Interleaved stereo out of SpectroStream; the WAV encoder wants the
     * channels one after the other. */
    let interleaved = 0;
    for (const part of parts) interleaved += part.length;
    const frameCount = interleaved / 2;
    const samples = new Float32Array(interleaved);
    let at = 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 2) {
        samples[at] = part[i];
        samples[frameCount + at] = part[i + 1];
        at += 1;
      }
    }
    return normalise({ samples, channels: 2, frames: frameCount, sampleRate: MRT2_SAMPLE_RATE });
  }
}

const ADAPTERS = Object.freeze({
  musicgen: () => new MusicGenAdapter(),
  speecht5: () => new SpeechT5Adapter(),
  supertonic: () => new SupertonicAdapter(),
  vits: () => new VitsAdapter(),
  mrt2: () => new Mrt2Adapter(),
});

let activeKey = null;
let activeAdapter = null;
let activeDevice = null;
let generating = false;

/* A model that ships one repository per language is only loaded once its
 * variant is known, so what counts as "already loaded" is the pair. */
function modelKey(modelId, variantId) {
  return `${modelId}/${variantId || ''}`;
}

async function loadModel(modelId, variantId) {
  const definition = getModelDefinition(modelId);
  if (!definition) throw new Error(`Unknown audio model: ${modelId}`);
  const key = modelKey(modelId, variantId);
  if (activeAdapter && activeKey === key) {
    postMessage({ type: 'model-ready', modelId, variantId, device: activeDevice });
    return;
  }
  const createAdapter = ADAPTERS[definition.family];
  if (!createAdapter) throw new Error(`No adapter is registered for ${definition.family}.`);

  /* An adapter that answers requestAdapter is not an adapter that will hold a
   * 1.1 GB model — a laptop with a small memory budget refuses somewhere
   * inside the session build, and there is nothing to inspect beforehand that
   * would have told us. So the CPU build is a retry rather than a
   * precondition: a machine that cannot take the fast path still gets working
   * audio, at the cost of having fetched the wrong weights first. */
  let device = await pickDevice(definition);
  fileProgress.clear();
  activeAdapter = createAdapter();
  activeKey = null;
  activeDevice = null;
  postMessage({ type: 'load-detail', detail: `Preparing ${definition.label}...` });
  try {
    await activeAdapter.load(definition, variantId, device);
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    fileProgress.clear();
    activeAdapter = createAdapter();
    postMessage({ type: 'load-detail', detail: 'The graphics adapter refused the model. Falling back to the processor...' });
    await activeAdapter.load(definition, variantId, device);
  }
  activeKey = key;
  activeDevice = device;
  postMessage({ type: 'model-ready', modelId, variantId, device });
}

async function generate(options) {
  const definition = getModelDefinition(options.modelId);
  if (!activeAdapter || activeKey !== modelKey(options.modelId, options.variantId)) {
    throw new Error('Load the selected model before generating audio.');
  }
  if (generating) throw new Error('Audio generation is already in progress.');
  generating = true;
  try {
    const result = await activeAdapter.generate({ ...options, definition });
    const buffer = encodeWave(result.samples, result.sampleRate, result.channels, result.frames);
    postMessage({
      type: 'result',
      buffer,
      sampleRate: result.sampleRate,
      channels: result.channels,
      frames: result.frames,
    }, [buffer]);
  } finally {
    generating = false;
  }
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === 'load') await loadModel(message.modelId, message.variantId);
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
