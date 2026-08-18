/* The clip's own loudness, as a curve a motion card can read.
 *
 * Measured once, kept, and read by time — which is the only way it can work
 * here. A live analyser would give a different answer on every pass, and the
 * preview, the pre-render and the export all have to agree about what frame
 * four hundred looked like. So the audio is decoded up front and reduced to a
 * few hundred buckets a second, and every later question is a lookup.
 *
 * Three bands rather than a spectrum: the whole signal, the low end and the
 * top. A bass drum should be able to drive one thing and a hi-hat another, and
 * anything finer than that is a synthesiser's problem, not a video filter's.
 */

/* fine enough for a kick to read as a kick at 30fps, coarse enough that a
   minute of audio is a few thousand numbers rather than a few million */
const BUCKETS_PER_SECOND = 200;

const BANDS = ['full', 'low', 'high'];

/* One-pole filters at roughly 200 Hz, which is where a kick stops and a voice
   starts. Crude next to a real crossover, and inaudible here — the output is a
   control voltage, not something anyone listens to. */
function splitBands(samples, sampleRate) {
  const cut = Math.exp(-2 * Math.PI * 200 / sampleRate);
  const low = new Float32Array(samples.length);
  let carried = 0;
  for (let i = 0; i < samples.length; i += 1) {
    carried = samples[i] * (1 - cut) + carried * cut;
    low[i] = carried;
  }
  return { low, high: samples };
}

/* Root mean square per bucket, so a bucket's number is its energy rather than
   whichever sample happened to be the tallest. */
function bucketRms(samples, sampleRate, buckets, pick) {
  const out = new Float32Array(buckets);
  const per = samples.length / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor(bucket * per);
    const to = Math.min(samples.length, Math.floor((bucket + 1) * per));
    let sum = 0, count = 0;
    for (let i = from; i < to; i += 1) { const value = pick(i); sum += value * value; count += 1; }
    out[bucket] = count ? Math.sqrt(sum / count) : 0;
  }
  return out;
}

const normalise = curve => {
  let peak = 0;
  for (const value of curve) if (value > peak) peak = value;
  if (peak <= 0.0001) return curve;
  for (let i = 0; i < curve.length; i += 1) curve[i] = curve[i] / peak;
  return curve;
};

/* What a motion card holds on to. `at` is the whole point of it: a time, a
   band and a smoothing window in, a number between 0 and 1 out. */
function makeEnvelope(curves, seconds) {
  const buckets = curves.full.length;
  return {
    seconds,
    buckets,
    curves,
    at(time, band = 'full', smoothingMs = 0) {
      const curve = curves[band] || curves.full;
      if (!curve.length || !(seconds > 0)) return 0;
      const position = Math.max(0, Math.min(1, time / seconds)) * (buckets - 1);
      const span = Math.max(0, Math.round((smoothingMs / 1000) * BUCKETS_PER_SECOND));
      if (!span) {
        /* between two buckets, so scrubbing does not step */
        const low = Math.floor(position), high = Math.min(buckets - 1, low + 1);
        const blend = position - low;
        return curve[low] * (1 - blend) + curve[high] * blend;
      }
      /* a trailing average: the envelope should fall away after a hit rather
         than start rising before one */
      const from = Math.max(0, Math.round(position) - span);
      const to = Math.min(buckets - 1, Math.round(position));
      let sum = 0, count = 0;
      for (let i = from; i <= to; i += 1) { sum += curve[i]; count += 1; }
      return count ? sum / count : 0;
    }
  };
}

/* Decoding is the expensive half and happens once per clip. The file goes in
   whole: an OfflineAudioContext is not needed to read samples, only to render
   them, and decodeAudioData already hands back the buffer. */
export async function analyseAudio(file, { onProgress } = {}) {
  const bytes = await file.arrayBuffer();
  onProgress?.(0.3);

  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('This browser cannot decode audio.');
  const context = new Context();
  let buffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new Error('That clip has no audio this browser can decode.');
  } finally {
    context.close?.();
  }
  onProgress?.(0.7);

  /* mixed to mono — a filter parameter has one value, not one per speaker */
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < length; i += 1) mono[i] /= buffer.numberOfChannels;
  }

  const seconds = buffer.duration;
  const buckets = Math.max(1, Math.round(seconds * BUCKETS_PER_SECOND));
  const { low } = splitBands(mono, buffer.sampleRate);

  const curves = {
    full: normalise(bucketRms(mono, buffer.sampleRate, buckets, i => mono[i])),
    low: normalise(bucketRms(low, buffer.sampleRate, buckets, i => low[i])),
    /* what is left when the low end is taken away */
    high: normalise(bucketRms(mono, buffer.sampleRate, buckets, i => mono[i] - low[i]))
  };
  onProgress?.(1);

  return makeEnvelope(curves, seconds);
}

export const AUDIO_BANDS = BANDS;
