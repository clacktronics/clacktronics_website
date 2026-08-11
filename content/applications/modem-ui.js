/* ClackModem — the parts the encoder and the receiver both need.
 *
 * Two applications now sit on top of modem-protocols.js: modem.html, which
 * turns text into a signal, and modem-rx.html, which turns a signal back into
 * text. Almost everything that is not modulation is common to both — the
 * waterfall, the parameter form, the protocol menus, the WAV container, the
 * shared audio clipboard and the transport — so it lives here rather than
 * being written twice and drifting apart.
 *
 * The scope is the reason this file exists at all. It draws the same
 * spectrogram the encoder has always drawn, and it can also run in a live mode
 * that scrolls one column per FFT hop, which is what a receiver watching a
 * microphone needs. Both modes share the ramp and the axis, so a signal looks
 * the same whichever application is looking at it.
 *
 * No dependencies; loaded by modem.html and modem-rx.html and exposed as
 * window.ClackModemUI.
 */
(function (global) {
'use strict';

const DEFAULT_RATE = 48000;

/* Everything these protocols do lives under 4 kHz, so the waterfall stops
 * there rather than spending four fifths of its height on silence. */
const SPEC_TOP_HZ = 4000;
const FFT_N = 512;
const LIVE_HOP = 256;   /* half a window: fast enough that 1200 baud keying is
                           visible as keying rather than as a smear */

/* ------------------------------------------------------------------ *
 * WAV, the same 16-bit mono container the Sound Recorder reads and writes
 * ------------------------------------------------------------------ */
function encodeWav(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function saveWav(samples, rate, suggested) {
  const name = prompt('Save audio as:', suggested);
  if (!name) return null;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(encodeWav(samples, rate));
  a.download = /\.wav$/i.test(name) ? name : name + '.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return a.download;
}

/* ------------------------------------------------------------------ *
 * Audio in
 * ------------------------------------------------------------------ */
let sharedCtx = null;
function audioContext() {
  if (!sharedCtx) sharedCtx = new (global.AudioContext || global.webkitAudioContext)();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function closeAudioContext() {
  if (sharedCtx) { sharedCtx.close().catch(() => {}); sharedCtx = null; }
}

/* Linear interpolation is well short of a proper resampler, but every decoder
 * downstream of this works on tone energy and edge timing rather than on
 * waveform fidelity, and a 44.1 kHz recording arriving as 48 kHz costs them
 * nothing they can measure. */
function resample(samples, from, to) {
  if (!from || from === to) return samples;
  const ratio = to / from;
  const n = Math.round(samples.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const src = i / ratio;
    const j = Math.floor(src), f = src - j;
    const a = samples[j] || 0, b = samples[j + 1] == null ? a : samples[j + 1];
    out[i] = a + (b - a) * f;
  }
  return out;
}

/* Any file the browser can decode, flattened to one channel at the rate the
 * decoders expect. Stereo is averaged rather than having a channel picked:
 * a recording made off a radio often has the signal on only one side. */
async function readAudioFile(file, wantRate) {
  const buf = await file.arrayBuffer();
  const rate = wantRate || DEFAULT_RATE;
  /* Decoded through an OfflineAudioContext fixed at the rate the decoders
   * want, so the browser resamples once, properly. Handing the file to the
   * live AudioContext instead gives whatever rate the output device happens to
   * run at — 44.1 kHz on most machines — and everything downstream then has to
   * be resampled a second time. */
  let audio;
  try {
    /* decodeAudioData detaches what it is given, so the fallback needs its own
     * copy rather than the husk the first attempt left behind */
    const spare = buf.slice(0);
    try {
      audio = await new (global.OfflineAudioContext || global.webkitOfflineAudioContext)(1, 1, rate)
        .decodeAudioData(buf);
    } catch {
      audio = await audioContext().decodeAudioData(spare);
    }
  } catch (err) {
    throw new Error('the browser could not decode that audio (' + (err.message || err) + ')');
  }
  let mono;
  if (audio.numberOfChannels === 1) {
    mono = audio.getChannelData(0);
  } else {
    mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
  }
  return { samples: resample(mono, audio.sampleRate, rate), rate: rate, sourceRate: audio.sampleRate };
}

/* ------------------------------------------------------------------ *
 * The clipboard the Sound Recorder instances share, so a signal can be pasted
 * into one and edited there, or a recording carried the other way.
 * ------------------------------------------------------------------ */
function createClipboard(onReceive) {
  const bus = 'BroadcastChannel' in global ? new BroadcastChannel('clackos-audio-clipboard') : null;
  let last = null;
  if (bus) bus.onmessage = e => {
    if (!e.data || e.data.type !== 'clip') return;
    last = { samples: e.data.samples, rate: e.data.rate };
    if (onReceive) onReceive(last);
  };
  return {
    available: !!bus,
    post(samples, rate) {
      if (!bus) return false;
      bus.postMessage({ type: 'clip', samples: samples, rate: rate });
      return true;
    },
    /* Only what has been broadcast while this app was listening — a
     * BroadcastChannel has no backlog, so a paste before any copy is empty. */
    peek() { return last; },
    close() { if (bus) bus.close(); }
  };
}

/* ------------------------------------------------------------------ *
 * FFT, for the spectrogram
 * ------------------------------------------------------------------ */
const fftCos = new Float32Array(FFT_N / 2), fftSin = new Float32Array(FFT_N / 2);
for (let i = 0; i < FFT_N / 2; i++) {
  fftCos[i] = Math.cos(-2 * Math.PI * i / FFT_N);
  fftSin[i] = Math.sin(-2 * Math.PI * i / FFT_N);
}
const hann = new Float32Array(FFT_N);
for (let i = 0; i < FFT_N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = fftCos[k * step], s = fftSin[k * step];
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * c - bi * s, ti = br * s + bi * c;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The scope — waterfall, waveform, axis and playhead over one signal.
 * ------------------------------------------------------------------ */
function createScope(opts) {
  const specEl = opts.spec, waveEl = opts.wave;
  const axisEl = opts.axis || null, playheadEl = opts.playhead || null;
  const topHz = opts.topHz || SPEC_TOP_HZ;
  const specCx = specEl.getContext('2d');
  const waveCx = waveEl.getContext('2d');

  let held = null;              /* the last buffer drawn, for redrawing on resize */
  let live = null;              /* live state, when scrolling */
  let observer = null;

  /* The app's own ramp: dark ink through leaf to paper. */
  function paint(img, o, v) {
    img.data[o] = 9 + v * v * 240;
    img.data[o + 1] = 20 + Math.pow(v, 0.7) * 222;
    img.data[o + 2] = 13 + Math.pow(v, 1.4) * 208;
    img.data[o + 3] = 255;
  }

  /* The two canvases are sized by the layout, so their backing stores have to
   * follow the window rather than the width and height they were written with. */
  function fit() {
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    let changed = false;
    for (const el of [specEl, waveEl]) {
      const w = Math.max(64, Math.round(el.clientWidth * dpr));
      const h = Math.max(20, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; changed = true; }
    }
    return changed;
  }

  function drawAxis(rate) {
    if (!axisEl) return;
    axisEl.textContent = '';
    void rate;
    for (let f = topHz - 1000; f > 0; f -= 1000) {
      const tick = document.createElement('span');
      tick.textContent = (f / 1000) + 'k';
      tick.style.top = ((1 - f / topHz) * 100) + '%';
      axisEl.appendChild(tick);
    }
  }

  function blank() {
    specCx.fillStyle = '#09140d';
    specCx.fillRect(0, 0, specEl.width, specEl.height);
    waveCx.fillStyle = '#09140d';
    waveCx.fillRect(0, 0, waveEl.width, waveEl.height);
  }

  /* One FFT column of `bins` magnitudes, normalised to the 62 dB window the
   * app has always used. The scratch buffers are hoisted because live mode
   * calls this a hundred times a second and the allocations showed up. */
  const scratchRe = new Float32Array(FFT_N), scratchIm = new Float32Array(FFT_N);
  function column(win, bins, out) {
    for (let i = 0; i < FFT_N; i++) { scratchRe[i] = win[i] * hann[i]; scratchIm[i] = 0; }
    fft(scratchRe, scratchIm);
    for (let b = 0; b < bins; b++) {
      const mag = Math.sqrt(scratchRe[b] * scratchRe[b] + scratchIm[b] * scratchIm[b]) / (FFT_N / 4);
      out[b] = Math.max(0, Math.min(1, (20 * Math.log10(mag + 1e-9) + 62) / 62));
    }
  }

  function drawSpectrogram(samples, rate) {
    const W = specEl.width, H = specEl.height;
    specCx.fillStyle = '#09140d';
    specCx.fillRect(0, 0, W, H);
    if (axisEl) axisEl.textContent = '';
    if (!samples || samples.length < FFT_N) return;

    const bins = Math.round(topHz / (rate / FFT_N));
    const img = specCx.createImageData(W, H);
    const hop = Math.max(1, (samples.length - FFT_N) / W);
    const col = new Float32Array(bins);
    const win = new Float32Array(FFT_N);

    for (let x = 0; x < W; x++) {
      const at = Math.round(x * hop);
      for (let i = 0; i < FFT_N; i++) win[i] = samples[at + i] || 0;
      column(win, bins, col);
      for (let y = 0; y < H; y++) {
        /* low frequencies at the bottom, the way a waterfall is read */
        const b = Math.min(bins - 1, Math.round((1 - y / H) * (bins - 1)));
        paint(img, (y * W + x) * 4, col[b]);
      }
    }
    specCx.putImageData(img, 0, 0);
    drawAxis(rate);
  }

  function drawWaveform(samples) {
    const W = waveEl.width, H = waveEl.height;
    waveCx.fillStyle = '#09140d';
    waveCx.fillRect(0, 0, W, H);
    if (!samples || !samples.length) return;
    waveCx.strokeStyle = '#4fae7d';
    waveCx.lineWidth = 1;
    waveCx.beginPath();
    const per = samples.length / W;
    for (let x = 0; x < W; x++) {
      let lo = 1, hi = -1;
      const from = Math.floor(x * per), to = Math.min(samples.length, Math.floor((x + 1) * per) || from + 1);
      for (let i = from; i < to; i++) { const v = samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo > hi) { lo = hi = 0; }
      waveCx.moveTo(x + 0.5, H / 2 - hi * H / 2);
      waveCx.lineTo(x + 0.5, H / 2 - lo * H / 2);
    }
    waveCx.stroke();
  }

  /* ---- live mode ----
   * The whole-buffer path recomputes every column each time it is called,
   * which is the wrong shape for a receiver: a microphone delivers a few
   * thousand samples at a time and the picture has to move sideways rather
   * than be redrawn. So live mode keeps a window's worth of history, emits a
   * column every LIVE_HOP samples, shifts the canvas left by however many
   * columns are due and paints them at the right-hand edge.
   */
  function beginLive(rate) {
    fit();
    blank();
    drawAxis(rate);
    live = {
      rate: rate,
      bins: Math.round(topHz / (rate / FFT_N)),
      /* a ring rather than a shift register: sliding a 512-sample window one
       * place per sample is 24 million copies a second at 48 kHz, and the
       * window is only ever read when a column falls due */
      ring: new Float32Array(FFT_N),
      ringPos: 0,
      win: new Float32Array(FFT_N),
      filled: 0,
      since: 0,
      peak: 0
    };
    if (playheadEl) playheadEl.style.display = 'none';
  }

  function pushLive(block) {
    if (!live || !block || !block.length) return;
    const W = specEl.width, H = specEl.height;
    const wavW = waveEl.width, wavH = waveEl.height;
    const win = live.win;
    const pending = [];       /* [magnitudes, waveLo, waveHi] per due column */
    let lo = 1, hi = -1;

    const ring = live.ring;
    for (let i = 0; i < block.length; i++) {
      const s = block[i];
      ring[live.ringPos] = s;
      live.ringPos = (live.ringPos + 1) % FFT_N;
      if (live.filled < FFT_N) live.filled++;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
      if (Math.abs(s) > live.peak) live.peak = Math.abs(s);

      if (++live.since >= LIVE_HOP) {
        live.since = 0;
        if (live.filled >= FFT_N) {
          /* unwrap the ring oldest-first into the analysis window */
          for (let k = 0; k < FFT_N; k++) win[k] = ring[(live.ringPos + k) % FFT_N];
          const mags = new Float32Array(live.bins);
          column(win, live.bins, mags);
          pending.push([mags, lo > hi ? 0 : lo, lo > hi ? 0 : hi]);
        }
        lo = 1; hi = -1;
      }
    }
    if (!pending.length) return;

    /* One shift for the whole block, then all the new columns at once —
     * a drawImage per column is what makes a live waterfall stutter. */
    const n = Math.min(pending.length, W);
    const from = pending.length - n;
    specCx.drawImage(specEl, -n, 0);
    const img = specCx.createImageData(n, H);
    for (let k = 0; k < n; k++) {
      const mags = pending[from + k][0];
      for (let y = 0; y < H; y++) {
        const b = Math.min(live.bins - 1, Math.round((1 - y / H) * (live.bins - 1)));
        paint(img, (y * n + k) * 4, mags[b]);
      }
    }
    specCx.putImageData(img, W - n, 0);

    const wn = Math.min(pending.length, wavW);
    waveCx.drawImage(waveEl, -wn, 0);
    waveCx.fillStyle = '#09140d';
    waveCx.fillRect(wavW - wn, 0, wn, wavH);
    waveCx.strokeStyle = '#4fae7d';
    waveCx.lineWidth = 1;
    waveCx.beginPath();
    for (let k = 0; k < wn; k++) {
      const p = pending[pending.length - wn + k];
      const x = wavW - wn + k + 0.5;
      waveCx.moveTo(x, wavH / 2 - p[2] * wavH / 2);
      waveCx.lineTo(x, wavH / 2 - p[1] * wavH / 2);
    }
    waveCx.stroke();
  }

  function endLive() {
    live = null;
  }

  function drawBuffer(samples, rate) {
    live = null;
    held = samples && samples.length ? { samples: samples, rate: rate } : null;
    fit();
    drawSpectrogram(samples, rate || DEFAULT_RATE);
    drawWaveform(samples);
  }

  function setPlayhead(fraction) {
    if (!playheadEl) return;
    if (fraction == null) { playheadEl.style.display = 'none'; return; }
    playheadEl.style.display = 'block';
    playheadEl.style.left = (Math.min(1, Math.max(0, fraction)) * 100) + '%';
  }

  function repaint() {
    if (live) {
      /* A live waterfall is a picture of time, and a resize has no history to
       * redraw it from — so it starts again from the current moment rather
       * than showing a stretched copy of the last one. */
      const rate = live.rate;
      beginLive(rate);
      return;
    }
    if (held) drawSpectrogram(held.samples, held.rate);
    else drawSpectrogram(null, DEFAULT_RATE);
    drawWaveform(held ? held.samples : null);
  }

  if (opts.observe !== false && 'ResizeObserver' in global) {
    observer = new ResizeObserver(() => { if (fit()) repaint(); });
    observer.observe(opts.root || specEl.parentNode || specEl);
  }

  return {
    fit: fit,
    drawBuffer: drawBuffer,
    beginLive: beginLive,
    pushLive: pushLive,
    endLive: endLive,
    setPlayhead: setPlayhead,
    repaint: repaint,
    clear() { held = null; live = null; fit(); blank(); if (axisEl) axisEl.textContent = ''; },
    get peak() { return live ? live.peak : 0; },
    resetPeak() { if (live) live.peak = 0; },
    destroy() { if (observer) observer.disconnect(); observer = null; live = null; held = null; }
  };
}

/* ------------------------------------------------------------------ *
 * The parameter form — one row per field the protocol declares.
 * ------------------------------------------------------------------ */
function buildParamForm(host, proto, values, onChange) {
  host.textContent = '';
  for (const f of proto.params) {
    if (f.when && !f.when(values)) continue;
    const row = document.createElement('label');
    row.className = 'mdm-field';
    const label = document.createElement('span');
    label.textContent = f.label;
    const wrap = document.createElement('span');
    wrap.className = 'mdm-input';

    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      for (const [v, text] of f.options) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = text;
        input.appendChild(o);
      }
      input.value = values[f.id];
    } else if (f.type === 'check') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = values[f.id] !== false;
    } else if (f.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = values[f.id] == null ? '' : values[f.id];
    } else {
      input = document.createElement('input');
      input.type = 'number';
      if (f.min != null) input.min = f.min;
      if (f.max != null) input.max = f.max;
      if (f.step != null) input.step = f.step;
      input.value = values[f.id];
    }
    input.addEventListener('input', () => {
      const v = f.type === 'check' ? input.checked
        : f.type === 'select' || f.type === 'text' ? input.value
        : parseFloat(input.value);
      /* a preset select can change which fields are relevant, so the form is
       * rebuilt for those and left alone for a plain number */
      onChange(f.id, v, f.type === 'select' || f.type === 'check');
    });

    wrap.appendChild(input);
    if (f.unit) {
      const u = document.createElement('span');
      u.className = 'mdm-unit';
      u.textContent = f.unit;
      wrap.appendChild(u);
    }
    row.appendChild(label);
    row.appendChild(wrap);
    host.appendChild(row);
  }
}

/* ------------------------------------------------------------------ *
 * Protocol lists — the same hierarchy in a <select> and in the menu bar.
 * `filter` is what lets the receiver offer only the protocols it can decode.
 * ------------------------------------------------------------------ */
function buildProtocolLists(opts) {
  const protocols = (opts.protocols || []).filter(opts.filter || (() => true));
  const groups = [];
  for (const p of protocols) {
    let g = groups.find(x => x.name === p.group);
    if (!g) groups.push(g = { name: p.group, items: [] });
    g.items.push(p);
  }
  if (opts.select) {
    opts.select.textContent = '';
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.name;
      for (const p of g.items) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        og.appendChild(o);
      }
      opts.select.appendChild(og);
    }
  }
  if (opts.menu) {
    opts.menu.textContent = '';
    groups.forEach((g, i) => {
      if (i) opts.menu.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
      const head = document.createElement('button');
      head.disabled = true;
      head.textContent = g.name;
      opts.menu.appendChild(head);
      for (const p of g.items) {
        const b = document.createElement('button');
        b.dataset.proto = p.id;
        b.textContent = p.name;
        opts.menu.appendChild(b);
      }
    });
  }
  return protocols;
}

/* ------------------------------------------------------------------ *
 * Menu bar behaviour — open one at a time, close on anything else.
 * ------------------------------------------------------------------ */
function wireMenuBar(appRoot, handlers) {
  const rms = appRoot.querySelectorAll('.rm');
  const closeAll = () => rms.forEach(m => m.classList.remove('open'));
  rms.forEach(m => {
    m.querySelector(':scope > button').addEventListener('click', e => {
      e.stopPropagation();
      const was = m.classList.contains('open');
      closeAll();
      if (!was) m.classList.add('open');
    });
  });
  const bar = appRoot.querySelector('.rm-bar');
  if (bar) bar.addEventListener('click', e => {
    const proto = e.target.closest('[data-proto]');
    if (proto) { closeAll(); if (handlers.onProto) handlers.onProto(proto.dataset.proto); return; }
    const cmd = e.target.closest('[data-cmd]');
    if (!cmd || cmd.disabled) return;
    closeAll();
    if (handlers.onCmd) handlers.onCmd(cmd.dataset.cmd);
  });
  appRoot.addEventListener('click', e => { if (!e.target.closest('.rm')) closeAll(); });
  return closeAll;
}

/* ------------------------------------------------------------------ *
 * Transport — play a buffer and follow it with the playhead.
 * ------------------------------------------------------------------ */
function createPlayer(scope) {
  let source = null, playStart = 0, raf = 0, seconds = 0;

  function stop() {
    if (source) { source.onended = null; try { source.stop(); } catch { /* already stopped */ } source = null; }
    if (scope) scope.setPlayhead(null);
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function play(samples, rate) {
    if (!samples || !samples.length) return;
    stop();
    const ctx = audioContext();
    /* the signal is generated at a fixed 48 kHz; if the output device runs at
     * another rate the buffer says so and the browser resamples it */
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(ctx.destination);
    seconds = samples.length / rate;
    source.onended = () => { source = null; if (scope) scope.setPlayhead(null); cancelAnimationFrame(raf); raf = 0; };
    playStart = ctx.currentTime;
    source.start();
    const follow = () => {
      if (!source) return;
      if (scope) scope.setPlayhead((audioContext().currentTime - playStart) / seconds);
      raf = requestAnimationFrame(follow);
    };
    follow();
  }

  return { play: play, stop: stop, get playing() { return !!source; } };
}

global.ClackModemUI = {
  RATE: DEFAULT_RATE,
  SPEC_TOP_HZ: SPEC_TOP_HZ,
  encodeWav: encodeWav,
  saveWav: saveWav,
  readAudioFile: readAudioFile,
  resample: resample,
  audioContext: audioContext,
  closeAudioContext: closeAudioContext,
  createClipboard: createClipboard,
  createScope: createScope,
  buildParamForm: buildParamForm,
  buildProtocolLists: buildProtocolLists,
  wireMenuBar: wireMenuBar,
  createPlayer: createPlayer
};

})(window);
