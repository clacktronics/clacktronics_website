/*
 * ClackSFX: the sfxr sound-effect synthesiser, in about two hundred lines.
 *
 * audioGen's other entries are neural models that take a description and a
 * minute or two of CPU. A game blip does not need either, and no text-to-audio
 * model that runs on this runtime makes a convincing one, so the sound-effects
 * entry in the catalog is DrPetter's sfxr algorithm (2007) instead: eight
 * generators that each roll a random set of oscillator, envelope, slide and
 * filter parameters, rendered here with 8× supersampling at 44.1 kHz.
 *
 * The randomness is seeded from the words typed into the prompt box rather
 * than from Math.random, which is what lets the app promise that the same
 * seed always gives the same sound — the parameters are not stored anywhere,
 * so the seed is the only record of a sound worth keeping.
 *
 * The parameter names are sfxr's own (p_base_freq, p_env_punch and the rest),
 * kept deliberately, so anything written about sfxr or as3sfxr reads across to
 * this file.
 */

const SAMPLE_RATE = 44100;

/* mulberry32 over an FNV-1a hash of the seed text: small, fast, and stable
 * across browsers, which a seed people share has to be. */
function createRandom(seed) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultParameters() {
  return {
    wave_type: 0,
    p_env_attack: 0, p_env_sustain: 0.3, p_env_punch: 0, p_env_decay: 0.4,
    p_base_freq: 0.3, p_freq_limit: 0, p_freq_ramp: 0, p_freq_dramp: 0,
    p_vib_strength: 0, p_vib_speed: 0,
    p_arp_mod: 0, p_arp_speed: 0,
    p_duty: 0, p_duty_ramp: 0,
    p_repeat_speed: 0,
    p_pha_offset: 0, p_pha_ramp: 0,
    p_lpf_freq: 1, p_lpf_ramp: 0, p_lpf_resonance: 0,
    p_hpf_freq: 0, p_hpf_ramp: 0,
    sound_vol: 0.5,
  };
}

/* The eight generators, transcribed from sfxr's own buttons. `frnd` is a
 * float in [0, n), `rnd` an integer in [0, n]. */
const GENERATORS = {
  pickupCoin(p, frnd, rnd) {
    p.p_base_freq = 0.4 + frnd(0.5);
    p.p_env_attack = 0;
    p.p_env_sustain = frnd(0.1);
    p.p_env_decay = 0.1 + frnd(0.4);
    p.p_env_punch = 0.3 + frnd(0.3);
    if (rnd(1)) {
      p.p_arp_speed = 0.5 + frnd(0.2);
      p.p_arp_mod = 0.2 + frnd(0.4);
    }
  },
  laserShoot(p, frnd, rnd) {
    p.wave_type = rnd(2);
    if (p.wave_type === 2 && rnd(1)) p.wave_type = rnd(1);
    p.p_base_freq = 0.5 + frnd(0.5);
    p.p_freq_limit = Math.max(0.2, p.p_base_freq - 0.2 - frnd(0.6));
    p.p_freq_ramp = -0.15 - frnd(0.2);
    if (rnd(2) === 0) {
      p.p_base_freq = 0.3 + frnd(0.6);
      p.p_freq_limit = frnd(0.1);
      p.p_freq_ramp = -0.35 - frnd(0.3);
    }
    if (rnd(1)) {
      p.p_duty = frnd(0.5);
      p.p_duty_ramp = frnd(0.2);
    } else {
      p.p_duty = 0.4 + frnd(0.5);
      p.p_duty_ramp = -frnd(0.7);
    }
    p.p_env_attack = 0;
    p.p_env_sustain = 0.1 + frnd(0.2);
    p.p_env_decay = frnd(0.4);
    if (rnd(1)) p.p_env_punch = frnd(0.3);
    if (rnd(2) === 0) {
      p.p_pha_offset = frnd(0.2);
      p.p_pha_ramp = -frnd(0.2);
    }
    if (rnd(1)) p.p_hpf_freq = frnd(0.3);
  },
  explosion(p, frnd, rnd) {
    p.wave_type = 3;
    if (rnd(1)) {
      p.p_base_freq = 0.1 + frnd(0.4);
      p.p_freq_ramp = -0.1 + frnd(0.4);
    } else {
      p.p_base_freq = 0.2 + frnd(0.7);
      p.p_freq_ramp = -0.2 - frnd(0.2);
    }
    p.p_base_freq *= p.p_base_freq;
    if (rnd(4) === 0) p.p_freq_ramp = 0;
    if (rnd(2) === 0) p.p_repeat_speed = 0.3 + frnd(0.5);
    p.p_env_attack = 0;
    p.p_env_sustain = 0.1 + frnd(0.3);
    p.p_env_decay = frnd(0.5);
    p.p_env_punch = 0.2 + frnd(0.6);
    if (rnd(1)) {
      p.p_pha_offset = -0.3 + frnd(0.9);
      p.p_pha_ramp = -frnd(0.3);
    }
    if (rnd(1)) {
      p.p_vib_strength = frnd(0.7);
      p.p_vib_speed = frnd(0.6);
    }
    if (rnd(2) === 0) {
      p.p_arp_speed = 0.6 + frnd(0.3);
      p.p_arp_mod = 0.8 - frnd(1.6);
    }
  },
  powerUp(p, frnd, rnd) {
    if (rnd(1)) p.wave_type = 1;
    else p.p_duty = frnd(0.6);
    if (rnd(1)) {
      p.p_base_freq = 0.2 + frnd(0.3);
      p.p_freq_ramp = 0.1 + frnd(0.4);
      p.p_repeat_speed = 0.4 + frnd(0.4);
    } else {
      p.p_base_freq = 0.2 + frnd(0.3);
      p.p_freq_ramp = 0.05 + frnd(0.2);
      if (rnd(1)) {
        p.p_vib_strength = frnd(0.7);
        p.p_vib_speed = frnd(0.6);
      }
    }
    p.p_env_attack = 0;
    p.p_env_sustain = frnd(0.4);
    p.p_env_decay = 0.1 + frnd(0.4);
  },
  hitHurt(p, frnd, rnd) {
    p.wave_type = rnd(2);
    if (p.wave_type === 2) p.wave_type = 3;
    if (p.wave_type === 0) p.p_duty = frnd(0.6);
    p.p_base_freq = 0.2 + frnd(0.6);
    p.p_freq_ramp = -0.3 - frnd(0.4);
    p.p_env_attack = 0;
    p.p_env_sustain = frnd(0.1);
    p.p_env_decay = 0.1 + frnd(0.2);
    if (rnd(1)) p.p_hpf_freq = frnd(0.3);
  },
  jump(p, frnd, rnd) {
    p.wave_type = 0;
    p.p_duty = frnd(0.6);
    p.p_base_freq = 0.3 + frnd(0.3);
    p.p_freq_ramp = 0.1 + frnd(0.2);
    p.p_env_attack = 0;
    p.p_env_sustain = 0.1 + frnd(0.3);
    p.p_env_decay = 0.1 + frnd(0.2);
    if (rnd(1)) p.p_hpf_freq = frnd(0.3);
    if (rnd(1)) p.p_lpf_freq = 1 - frnd(0.6);
  },
  blipSelect(p, frnd, rnd) {
    p.wave_type = rnd(1);
    if (p.wave_type === 0) p.p_duty = frnd(0.6);
    p.p_base_freq = 0.2 + frnd(0.4);
    p.p_env_attack = 0;
    p.p_env_sustain = 0.1 + frnd(0.1);
    p.p_env_decay = frnd(0.2);
    p.p_hpf_freq = 0.1;
  },
  /* Not one of sfxr's buttons: a plain sine with a soft envelope, for the
   * cases where what is wanted is a beep rather than a character. */
  tone(p, frnd, rnd) {
    p.wave_type = 2;
    p.p_base_freq = 0.25 + frnd(0.35);
    p.p_env_attack = frnd(0.1);
    p.p_env_sustain = 0.2 + frnd(0.3);
    p.p_env_decay = 0.2 + frnd(0.3);
    if (rnd(2) === 0) {
      p.p_vib_strength = frnd(0.3);
      p.p_vib_speed = 0.3 + frnd(0.4);
    }
  },
  /* sfxr's Randomize: every parameter rolled, which is where its best
   * accidents come from. */
  random(p, frnd, rnd) {
    const bipolar = () => frnd(2) - 1;
    p.wave_type = rnd(3);
    p.p_base_freq = bipolar() ** 2 * (rnd(1) ? 2 : 1);
    if (p.p_base_freq < 0.01) p.p_base_freq = 0.01;
    p.p_freq_limit = 0;
    p.p_freq_ramp = bipolar() ** 5;
    if (p.p_base_freq > 0.7 && p.p_freq_ramp > 0.2) p.p_freq_ramp = -p.p_freq_ramp;
    if (p.p_base_freq < 0.2 && p.p_freq_ramp < -0.05) p.p_freq_ramp = -p.p_freq_ramp;
    p.p_freq_dramp = bipolar() ** 3;
    p.p_duty = bipolar();
    p.p_duty_ramp = bipolar() ** 3;
    p.p_vib_strength = bipolar() ** 3;
    p.p_vib_speed = bipolar();
    p.p_env_attack = bipolar() ** 3;
    p.p_env_sustain = bipolar() ** 2;
    p.p_env_decay = bipolar();
    p.p_env_punch = Math.abs(bipolar()) ** 2;
    if (p.p_env_attack + p.p_env_sustain + p.p_env_decay < 0.2) {
      p.p_env_sustain += 0.2 + frnd(0.3);
      p.p_env_decay += 0.2 + frnd(0.3);
    }
    p.p_lpf_resonance = bipolar();
    p.p_lpf_freq = 1 - Math.abs(bipolar()) ** 3;
    p.p_lpf_ramp = bipolar() ** 3;
    if (p.p_lpf_freq < 0.1 && p.p_lpf_ramp < -0.05) p.p_lpf_ramp = -p.p_lpf_ramp;
    p.p_hpf_freq = Math.abs(bipolar()) ** 5;
    p.p_hpf_ramp = Math.abs(bipolar()) ** 5;
    p.p_pha_offset = bipolar() ** 3;
    p.p_pha_ramp = bipolar() ** 3;
    p.p_repeat_speed = bipolar();
    p.p_arp_speed = bipolar();
    p.p_arp_mod = bipolar();
  },
};

export const SFX_SHAPES = Object.freeze(Object.keys(GENERATORS));

function makeParameters(shape, random) {
  const frnd = range => random() * range;
  const rnd = max => Math.floor(random() * (max + 1));
  const parameters = defaultParameters();
  (GENERATORS[shape] || GENERATORS.random)(parameters, frnd, rnd);
  return parameters;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/* A straight transcription of sfxr's render loop. The state it resets on a
 * repeat (period, slide, duty, arpeggio) is separated from the state it does
 * not (envelope, filters, phaser), which is the whole trick behind the
 * stuttering machine-gun and engine sounds. */
function render(p, shaping, random) {
  let period = 100 / (p.p_base_freq * p.p_base_freq + 0.001);
  let maxPeriod = 100 / (p.p_freq_limit * p.p_freq_limit + 0.001);
  let slide = 1 - p.p_freq_ramp ** 3 * 0.01;
  const deltaSlide = -(p.p_freq_dramp ** 3) * 0.000001;
  let squareDuty = 0.5 - p.p_duty * 0.5;
  const dutySweep = -p.p_duty_ramp * 0.00005;
  const arpModulation = p.p_arp_mod >= 0
    ? 1 - p.p_arp_mod ** 2 * 0.9
    : 1 + p.p_arp_mod ** 2 * 10;
  let arpTime = 0;
  let arpLimit = p.p_arp_speed === 1 ? 0 : Math.floor((1 - p.p_arp_speed) ** 2 * 20000 + 32);

  const resetPeriod = () => {
    period = 100 / (p.p_base_freq * p.p_base_freq + 0.001);
    maxPeriod = 100 / (p.p_freq_limit * p.p_freq_limit + 0.001);
    slide = 1 - p.p_freq_ramp ** 3 * 0.01;
    squareDuty = 0.5 - p.p_duty * 0.5;
    arpTime = 0;
    arpLimit = p.p_arp_speed === 1 ? 0 : Math.floor((1 - p.p_arp_speed) ** 2 * 20000 + 32);
  };

  let filterPoint = 0;
  let filterDelta = 0;
  let filterWidth = p.p_lpf_freq ** 3 * 0.1;
  const filterWidthDelta = 1 + p.p_lpf_ramp * 0.0001;
  const filterDamping = Math.min(0.8, 5 / (1 + p.p_lpf_resonance ** 2 * 20) * (0.01 + filterWidth));
  let highPassPoint = 0;
  let highPass = p.p_hpf_freq ** 2 * 0.1;
  const highPassDelta = 1 + p.p_hpf_ramp * 0.0003;

  let vibratoPhase = 0;
  const vibratoSpeed = p.p_vib_speed ** 2 * 0.01;
  const vibratoAmplitude = p.p_vib_strength * 0.5;

  const envelopeLength = [
    Math.floor(p.p_env_attack ** 2 * 100000),
    Math.floor(p.p_env_sustain ** 2 * 100000 * shaping.length),
    Math.floor(p.p_env_decay ** 2 * 100000 * shaping.length),
  ];
  let envelopeStage = 0;
  let envelopeTime = 0;
  let envelopeVolume = 0;

  let phaserOffset = p.p_pha_offset ** 2 * 1020 * Math.sign(p.p_pha_offset || 1);
  const phaserDelta = p.p_pha_ramp ** 2 * Math.sign(p.p_pha_ramp || 1);
  let phaserPosition = 0;
  const phaserBuffer = new Float32Array(1024);

  const noiseBuffer = new Float32Array(32);
  const refillNoise = () => {
    for (let i = 0; i < 32; i += 1) noiseBuffer[i] = random() * 2 - 1;
  };
  refillNoise();

  let repeatTime = 0;
  const repeatLimit = p.p_repeat_speed === 0
    ? 0
    : Math.floor((1 - p.p_repeat_speed) ** 2 * 20000 + 32);

  const total = envelopeLength[0] + envelopeLength[1] + envelopeLength[2];
  const samples = new Float32Array(Math.max(1, total));
  let phase = 0;
  let written = 0;

  for (; written < samples.length; written += 1) {
    if (repeatLimit) {
      repeatTime += 1;
      if (repeatTime >= repeatLimit) {
        repeatTime = 0;
        resetPeriod();
      }
    }

    if (arpLimit) {
      arpTime += 1;
      if (arpTime >= arpLimit) {
        arpLimit = 0;
        period *= arpModulation;
      }
    }

    slide += deltaSlide;
    period *= slide;
    if (period > maxPeriod) {
      period = maxPeriod;
      if (p.p_freq_limit > 0) break;
    }

    let periodNow = period;
    if (vibratoAmplitude > 0) {
      vibratoPhase += vibratoSpeed;
      periodNow *= 1 + Math.sin(vibratoPhase) * vibratoAmplitude;
    }
    periodNow = Math.max(8, Math.floor(periodNow));

    squareDuty = clamp(squareDuty + dutySweep, 0, 0.5);

    envelopeTime += 1;
    if (envelopeTime > envelopeLength[envelopeStage]) {
      envelopeTime = 0;
      envelopeStage += 1;
      if (envelopeStage > 2) break;
    }
    if (envelopeStage === 0) {
      envelopeVolume = envelopeLength[0] ? envelopeTime / envelopeLength[0] : 1;
    } else if (envelopeStage === 1) {
      const remaining = envelopeLength[1] ? 1 - envelopeTime / envelopeLength[1] : 0;
      envelopeVolume = 1 + remaining * 2 * p.p_env_punch;
    } else {
      envelopeVolume = envelopeLength[2] ? 1 - envelopeTime / envelopeLength[2] : 0;
    }

    phaserOffset += phaserDelta;
    const phaserInteger = Math.min(1023, Math.abs(Math.floor(phaserOffset)));

    highPass = clamp(highPass * highPassDelta, 0.00001, 0.1);

    let sample = 0;
    for (let pass = 0; pass < 8; pass += 1) {
      phase += 1;
      if (phase >= periodNow) {
        phase %= periodNow;
        if (p.wave_type === 3) refillNoise();
      }

      let sub;
      const cycle = phase / periodNow;
      if (p.wave_type === 0) sub = cycle < squareDuty ? 0.5 : -0.5;
      else if (p.wave_type === 1) sub = 1 - cycle * 2;
      else if (p.wave_type === 2) sub = Math.sin(cycle * Math.PI * 2);
      else sub = noiseBuffer[Math.floor(cycle * 32)] || 0;

      const previous = filterPoint;
      filterWidth = clamp(filterWidth * filterWidthDelta, 0, 0.1);
      if (p.p_lpf_freq !== 1) {
        filterDelta += (sub - filterPoint) * filterWidth;
        filterDelta -= filterDelta * filterDamping;
      } else {
        filterPoint = sub;
        filterDelta = 0;
      }
      filterPoint += filterDelta;

      highPassPoint += filterPoint - previous;
      highPassPoint -= highPassPoint * highPass;
      sub = highPassPoint;

      phaserBuffer[phaserPosition & 1023] = sub;
      sub += phaserBuffer[(phaserPosition - phaserInteger + 1024) & 1023];
      phaserPosition = (phaserPosition + 1) & 1023;

      sample += sub;
    }

    samples[written] = clamp(sample / 8 * envelopeVolume * p.sound_vol, -1, 1);
  }

  return samples.subarray(0, Math.max(1, written));
}

/*
 * shaping: { pitch, length, brightness } — the three sliders in the app, kept
 * outside the generators so the same seed keeps its character while they move.
 */
export function synthesise(shape, seed, shaping = {}) {
  const text = String(seed || '');
  const random = text
    ? createRandom(text)
    : createRandom(`${Math.random()}`);
  const parameters = makeParameters(shape, random);

  const pitch = Number(shaping.pitch) || 1;
  const brightness = Number(shaping.brightness) || 1;
  parameters.p_base_freq = clamp(parameters.p_base_freq * pitch, 0.001, 1);
  if (parameters.p_freq_limit > 0) {
    parameters.p_freq_limit = clamp(parameters.p_freq_limit * pitch, 0.001, 1);
  }
  parameters.p_lpf_freq = clamp(parameters.p_lpf_freq * brightness, 0.02, 1);

  const samples = render(parameters, { length: Number(shaping.length) || 1 }, random);
  return { samples, sampleRate: SAMPLE_RATE, channels: 1, frames: samples.length };
}
