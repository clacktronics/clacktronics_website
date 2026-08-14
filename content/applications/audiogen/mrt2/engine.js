/*
 * Magenta RealTime 2, driven directly on ONNX Runtime.
 *
 * MRT2 is not a Transformers.js model and never will be: it is three models
 * chained together, exported as nine separate graphs with no HuggingFace
 * config between them, and the loop that carries a windowed KV-cache from one
 * 25 Hz audio frame to the next lives in the host rather than in any graph. So
 * this file is that host — the piece of code the runtime does not supply.
 *
 * The chain, per the model card:
 *   MusicCoCa   prompt text -> 768-d style embedding -> 12 RVQ style tokens
 *   Depthformer style + conditioning -> SpectroStream tokens, frame by frame
 *   SpectroStream  12 codes per frame -> 48 kHz stereo audio
 *
 * Structure and constants follow the reference runtime published with the ONNX
 * export (the demo Space's src/lib/mrt2), which was in turn read off Google's
 * magenta_rt system.py. Where this differs from that reference it is because
 * that one drives the graphs through jax-js on WebGPU and this drives them
 * through ONNX Runtime: tensors are ort.Tensor, int64 inputs really are
 * BigInt64Array, and nothing is reference-counted.
 */

/* RVQ vocabulary: 12 codebooks of 1024, after 6 reserved ids. */
const NUM_RESERVED = 6;
const CODEBOOK = 1024;
const NUM_CODEBOOKS = 12;
const VOCAB = NUM_RESERVED + NUM_CODEBOOKS * CODEBOOK;

/* Conditioning is one 144-slot vector: style[12] + notes[128] + drums[1] +
 * cfg[3], every slot shifted past the reserved ids. Notes and drums are the
 * live-performance half of Magenta RealTime, which this app does not drive, so
 * they are sent masked. */
const COND_OFFSET = NUM_RESERVED + 1;
const MASKED = -1;

/* SpectroStream timing. */
const FRAME_RATE = 25;
const FRAME_SAMPLES = 1920;
export const SAMPLE_RATE = 48000;

/* Overlap-save decode: the decoder is stateless and emits (frames - 1) * 1920
 * samples, so each pull re-decodes [context | new | margin] and keeps the safe
 * interior. */
const DECODE_CONTEXT = 16;
const DECODE_MARGIN = 2;

/* Depthformer KV-cache geometry; windows are [1, W, H, head_dim]. */
const TEMPORAL = { layers: 12, window: 41, heads: 8, head: 128 };
const DEPTH = { layers: 2, window: 12, heads: 6, head: 128 };

export const CFG_DEFAULTS = Object.freeze({ musiccoca: 1.6, notes: 2.4, drums: 4.0 });
export const SAMPLE_DEFAULTS = Object.freeze({ temperature: 1.3, topK: 40 });

/* magenta_rt system.discretize_cfg: a guidance strength becomes a token. */
function discretizeCfg(value, step, maxBin) {
  const clamped = Math.max(-1, Math.min(7, value));
  return Math.max(0, Math.min(maxBin, Math.round((clamped + 1) / step)));
}

function buildConditioning(styleTokens, cfg = CFG_DEFAULTS) {
  const cond = new BigInt64Array(144);
  let at = 0;
  for (let i = 0; i < NUM_CODEBOOKS; i += 1) {
    cond[at] = BigInt((styleTokens?.[i] ?? MASKED) + COND_OFFSET);
    at += 1;
  }
  for (let i = 0; i < 128; i += 1) { cond[at] = BigInt(MASKED + COND_OFFSET); at += 1; }
  cond[at] = BigInt(MASKED + COND_OFFSET); at += 1;
  cond[at] = BigInt(discretizeCfg(cfg.musiccoca, 0.2, 40) + COND_OFFSET); at += 1;
  cond[at] = BigInt(discretizeCfg(cfg.notes, 0.2, 40) + COND_OFFSET); at += 1;
  cond[at] = BigInt(discretizeCfg(cfg.drums, 1.0, 8) + COND_OFFSET);
  return cond;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Sampling, as magenta_rt does it: mask to the level's codebook, keep the
 * top-k logits, then take argmax(logit + temperature * gumbel) — which is
 * exactly a draw from softmax(logit / temperature), without ever building the
 * softmax. */
class Sampler {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
    this.scratch = new Float32Array(CODEBOOK);
  }

  gumbel() {
    const uniform = Math.min(1 - 1e-12, Math.max(1e-12, this.random()));
    return -Math.log(-Math.log(uniform));
  }

  sample(logits, low, high, temperature, topK) {
    const span = high - low;
    const k = Math.max(1, Math.min(topK | 0, span));
    let threshold = -Infinity;
    if (k < span) {
      for (let i = 0; i < span; i += 1) this.scratch[i] = logits[low + i];
      this.scratch.subarray(0, span).sort();
      threshold = this.scratch[span - k];
    }
    let best = low;
    let bestScore = -Infinity;
    for (let i = low; i < high; i += 1) {
      const logit = logits[i];
      if (logit < threshold) continue;
      const score = temperature > 0 ? logit + temperature * this.gumbel() : logit;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
}

export class Mrt2Engine {
  constructor(ort, sessions, tokenizer, mapperNoise) {
    this.ort = ort;
    this.sessions = sessions;
    this.tokenizer = tokenizer;
    this.mapperNoise = mapperNoise;
    this.embeddingCache = new Map();
  }

  tensor(type, data, dims) {
    return new this.ort.Tensor(type, data, dims);
  }

  zeros(shape) {
    return this.tensor('float32', new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
  }

  /* --- MusicCoCa: prompt -> 12 style tokens ------------------------------ */

  async textEmbedding(text) {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;

    const labels = this.tokenizer.encode(text.toLowerCase()).slice(0, 127);
    const ids = new Int32Array(128);
    ids[0] = 1; /* <s> */
    labels.forEach((token, index) => { ids[index + 1] = token; });
    /* The mask marks padding with 1, not the other way round. */
    const paddings = new Float32Array(128).fill(1);
    for (let i = 0; i < labels.length + 1; i += 1) paddings[i] = 0;

    const session = this.sessions.textEncoder;
    const feeds = {};
    for (const name of session.inputNames) {
      feeds[name] = name.includes('padding')
        ? this.tensor('float32', paddings, [1, 128])
        : this.tensor('int32', ids, [1, 128]);
    }
    const output = await session.run(feeds);
    const embedding = Float32Array.from(output[session.outputNames[0]].data);
    this.embeddingCache.set(text, embedding);
    return embedding;
  }

  async styleTokens(prompts) {
    const blended = new Float32Array(768);
    let total = 0;
    for (const { text, weight } of prompts) {
      if (!text?.trim() || weight <= 0) continue;
      const embedding = await this.textEmbedding(text);
      total += weight;
      for (let i = 0; i < 768; i += 1) blended[i] += weight * embedding[i];
    }
    if (total > 0) for (let i = 0; i < 768; i += 1) blended[i] /= total;

    /* The mapper is not optional: it carries text-space into the audio-style
     * space the quantizer was trained on. Its second input is a fixed noise
     * vector — reproducing the reference means reproducing that noise. */
    const mapper = this.sessions.mapper;
    const feeds = {};
    for (const name of mapper.inputNames) {
      feeds[name] = name.includes('args_1')
        ? this.tensor('float32', this.mapperNoise, [1, 768])
        : this.tensor('float32', blended, [1, 768]);
    }
    const mapped = (await mapper.run(feeds))[mapper.outputNames[0]].data;

    let sum = 0;
    for (let i = 0; i < mapped.length; i += 1) sum += mapped[i] * mapped[i];
    const inverse = 1 / Math.sqrt(sum);
    const normalised = new Float32Array(mapped.length);
    for (let i = 0; i < mapped.length; i += 1) normalised[i] = mapped[i] * inverse;

    const quantizer = this.sessions.quantizer;
    const quantized = await quantizer.run({
      [quantizer.inputNames[0]]: this.tensor('float32', normalised, [1, 768]),
    });
    return Array.from(quantized[quantizer.outputNames[0]].data, Number).slice(0, NUM_CODEBOOKS);
  }

  /* --- Depthformer: style tokens -> audio tokens, one 40 ms frame at a time */

  async startStream(styleTokens, { cfg, seed } = {}) {
    const encoder = this.sessions.encoder;
    const cond = buildConditioning(styleTokens, cfg);
    const encoded = await encoder.run({ cond: this.tensor('int64', cond, [1, 1, 144]) });
    const encOut = encoded[encoder.outputNames[0]];

    const state = {
      encOut,
      selfK: [], selfV: [], crossK: [], crossV: [],
      previous: this.tensor('int64', new BigInt64Array(NUM_CODEBOOKS), [1, NUM_CODEBOOKS]),
      cachePosition: 0,
      sampler: new Sampler(seed ?? (Math.random() * 0xffffffff) >>> 0),
    };
    const shape = [1, TEMPORAL.window, TEMPORAL.heads, TEMPORAL.head];
    for (let i = 0; i < TEMPORAL.layers; i += 1) {
      state.selfK.push(this.zeros(shape));
      state.selfV.push(this.zeros(shape));
      state.crossK.push(this.zeros(shape));
      state.crossV.push(this.zeros(shape));
    }
    return state;
  }

  async step(state, temperature, topK) {
    const temporal = this.sessions.temporal;
    const feeds = {
      prev_codes: state.previous,
      enc_out: state.encOut,
      cache_pos: this.tensor('int64', BigInt64Array.from([BigInt(state.cachePosition)]), [1]),
    };
    for (let i = 0; i < TEMPORAL.layers; i += 1) {
      feeds[`past_self_k.${i}`] = state.selfK[i];
      feeds[`past_self_v.${i}`] = state.selfV[i];
      feeds[`past_cross_k.${i}`] = state.crossK[i];
      feeds[`past_cross_v.${i}`] = state.crossV[i];
    }
    const out = await temporal.run(feeds);
    for (let i = 0; i < TEMPORAL.layers; i += 1) {
      state.selfK[i] = out[`present_self_k.${i}`];
      state.selfV[i] = out[`present_self_v.${i}`];
      state.crossK[i] = out[`present_cross_k.${i}`];
      state.crossV[i] = out[`present_cross_v.${i}`];
    }

    /* The depth transformer runs once per RVQ level, its own cache starting
     * empty every frame, each sampled token embedded as the next level's
     * input. */
    const depth = this.sessions.depth;
    const embed = this.sessions.embed;
    const depthShape = [1, DEPTH.window, DEPTH.heads, DEPTH.head];
    const pastK = [];
    const pastV = [];
    for (let i = 0; i < DEPTH.layers; i += 1) { pastK.push(this.zeros(depthShape)); pastV.push(this.zeros(depthShape)); }

    let depthIn = out.temporal_out;
    const codes = [];
    for (let level = 0; level < NUM_CODEBOOKS; level += 1) {
      const depthFeeds = {
        depth_in: depthIn,
        level: this.tensor('int64', BigInt64Array.from([BigInt(level)]), [1]),
      };
      for (let i = 0; i < DEPTH.layers; i += 1) {
        depthFeeds[`past_k.${i}`] = pastK[i];
        depthFeeds[`past_v.${i}`] = pastV[i];
      }
      const stepOut = await depth.run(depthFeeds);
      for (let i = 0; i < DEPTH.layers; i += 1) {
        pastK[i] = stepOut[`present_k.${i}`];
        pastV[i] = stepOut[`present_v.${i}`];
      }
      const logits = stepOut.logits.data;
      const low = NUM_RESERVED + level * CODEBOOK;
      const token = state.sampler.sample(logits, low, low + CODEBOOK, temperature, topK);
      codes.push(token);
      if (level < NUM_CODEBOOKS - 1) {
        const embedded = await embed.run({
          token: this.tensor('int64', BigInt64Array.from([BigInt(token)]), [1]),
        });
        depthIn = embedded[embed.outputNames[0]];
      }
    }

    state.previous = this.tensor('int64', BigInt64Array.from(codes.map(BigInt)), [1, NUM_CODEBOOKS]);
    state.cachePosition += 1;
    return codes;
  }

  /* --- SpectroStream: audio tokens -> 48 kHz stereo --------------------- */

  /* Unique-scheme ids are global across the 12 codebooks; the codec wants each
   * level's own 0..1023 index. */
  toCodecCodes(frames) {
    return frames.map(frame => frame.map(token => (((token - NUM_RESERVED) % CODEBOOK) + CODEBOOK) % CODEBOOK));
  }

  async decode(frames) {
    const decoder = this.sessions.decoder;
    const codes = Int32Array.from(this.toCodecCodes(frames).flat());
    const output = await decoder.run({ codes: this.tensor('int32', codes, [1, frames.length, NUM_CODEBOOKS]) });
    return output[decoder.outputNames[0]];
  }
}

/* Overlap-save streaming decode. The decoder has no state of its own, so each
 * pull re-decodes a sliding window and keeps only the interior that has both
 * left context and right margin — bit-equivalent to a stateful decode, at the
 * cost of decoding the context twice. */
export class StreamingDecoder {
  constructor(engine, context = DECODE_CONTEXT, margin = DECODE_MARGIN) {
    this.engine = engine;
    this.context = context;
    this.margin = margin;
    this.history = [];
    this.emitted = 0;
  }

  push(frames) {
    for (const frame of frames) this.history.push(frame);
  }

  async pull(flush = false) {
    const margin = flush ? 0 : this.margin;
    const total = this.history.length;
    const available = total - 1 - margin - this.emitted;
    if (available <= 0) return null;

    const start = Math.max(0, total - (available + margin + this.context + 1));
    const window = this.history.slice(start);
    const wav = await this.engine.decode(window);
    const samples = wav.data;

    const end = (window.length - 1) * FRAME_SAMPLES - margin * FRAME_SAMPLES;
    const begin = end - available * FRAME_SAMPLES;
    this.emitted += available;
    /* Interleaved stereo out of the graph; copied because ORT reuses buffers. */
    return samples.slice(begin * 2, end * 2);
  }

  get seconds() {
    return this.emitted / FRAME_RATE;
  }
}

export const MRT2 = { NUM_CODEBOOKS, FRAME_RATE, FRAME_SAMPLES, VOCAB };
