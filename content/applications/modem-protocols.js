/* ClackModem — the modulators.
 *
 * Every protocol here is a way of putting bits (or a picture of bits) into
 * something a loudspeaker can carry, and they all come apart into the same
 * three pieces: a bit source, a framing rule, and a modulator. That is why
 * this file has one Writer and fifteen small encoders rather than fifteen
 * signal generators — the Writer owns sample timing and phase, so an encoder
 * only has to say "mark for one bit time" and the audio comes out clean.
 *
 * These are encoders only. Each one is written so a decoder can be dropped in
 * beside it later without the framing being rewritten, which is why the bit
 * and element helpers are separate from the tone generation.
 *
 * No dependencies; loaded by modem.html and exposed as window.ClackModem.
 */
(function (global) {
'use strict';

const TAU = Math.PI * 2;
const RATE = 48000;
/* A slow mode and a long message make a very long file — 45 baud RTTY runs at
 * about six characters a second. Rather than letting the tab allocate its way
 * into trouble, the Writer stops accepting samples here and the encoder says
 * so in its notes. */
const MAX_SECONDS = 180;

/* ------------------------------------------------------------------ *
 * Writer — the sample sink every modulator writes through.
 * ------------------------------------------------------------------ */
class Writer {
  constructor(rate) {
    this.rate = rate || RATE;
    this.data = [];
    this.phase = 0;      /* carried across calls: this is what makes FSK
                            phase-continuous rather than a string of clicks */
    this.cursor = 0;     /* fractional sample position of the end of the signal */
    this.level = 1;      /* current square-wave level, for the tape formats */
    this.truncated = false;
  }

  get seconds() { return this.data.length / this.rate; }

  /* How many samples are still owed for a run of `sec` seconds. Timing is kept
   * as a running fractional cursor and differenced against what has actually
   * been written, so a baud rate that doesn't divide the sample rate — 45.45,
   * 31.25, 29.97 frames — can't accumulate drift over a long transmission. */
  _n(sec) {
    this.cursor += sec * this.rate;
    if (this.cursor > MAX_SECONDS * this.rate) { this.truncated = true; return 0; }
    const n = Math.round(this.cursor) - this.data.length;
    return n > 0 ? n : 0;
  }

  silence(sec) {
    const n = this._n(sec);
    for (let i = 0; i < n; i++) this.data.push(0);
  }

  /* One run of a sine, continuing the phase from wherever the last one left
   * off. Every FSK mode in this file is built out of this. */
  tone(freq, sec, amp) {
    const n = this._n(sec), step = TAU * freq / this.rate;
    const a = amp == null ? 0.7 : amp;
    for (let i = 0; i < n; i++) {
      this.data.push(a * Math.sin(this.phase));
      this.phase += step;
      if (this.phase >= TAU) this.phase -= TAU;
    }
  }

  /* Several tones at once, each starting from zero phase, with short linear
   * edges. Used by the signalling modes, where a burst is a burst and the
   * phase relationship between bursts carries nothing. */
  tones(freqs, sec, amp, rampSec) {
    const n = this._n(sec);
    if (!n) return;
    const a = (amp == null ? 0.42 : amp) / Math.max(1, freqs.length);
    const steps = freqs.map(f => TAU * f / this.rate);
    const ph = freqs.map(() => 0);
    const ramp = Math.max(1, Math.round((rampSec == null ? 0.002 : rampSec) * this.rate));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < freqs.length; k++) { s += Math.sin(ph[k]); ph[k] += steps[k]; }
      const env = Math.min(1, i / ramp, (n - 1 - i) / ramp);
      this.data.push(a * s * env);
    }
  }

  /* A keyed tone with raised-cosine edges — the difference between Morse that
   * sounds like Morse and Morse that sounds like a machine gun of key clicks. */
  keyed(freq, sec, riseSec, amp) {
    const n = this._n(sec);
    if (!n) return;
    const step = TAU * freq / this.rate;
    const a = amp == null ? 0.7 : amp;
    const r = Math.min(Math.max(1, Math.round(riseSec * this.rate)), Math.floor(n / 2) || 1);
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < r) env = 0.5 - 0.5 * Math.cos(Math.PI * i / r);
      else if (i >= n - r) env = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / r);
      this.data.push(a * env * Math.sin(this.phase));
      this.phase += step;
      if (this.phase >= TAU) this.phase -= TAU;
    }
  }

  /* One square-wave pulse at the current level, then flip. The cassette
   * formats and SMPTE timecode are specified as edge timings rather than as
   * tones, so they are written this way round. */
  pulse(sec, amp) {
    const n = this._n(sec), a = (amp == null ? 0.75 : amp) * this.level;
    for (let i = 0; i < n; i++) this.data.push(a);
    this.level = -this.level;
  }

  /* A square-wave half-bit that does not flip the level — biphase mark needs
   * both kinds. */
  hold(sec, amp) {
    const n = this._n(sec), a = (amp == null ? 0.75 : amp) * this.level;
    for (let i = 0; i < n; i++) this.data.push(a);
  }

  flip() { this.level = -this.level; }

  toFloat32() { return Float32Array.from(this.data); }
}

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

/* The retro modes predate Unicode by decades, so anything outside 7-bit ASCII
 * is reported rather than silently mangled into a byte that means something
 * else on the receiving machine. */
function toBytes(text, notes) {
  const out = [];
  let dropped = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c > 0x7e && c !== 0x0a && c !== 0x0d) { dropped++; out.push(0x3f); }
    else out.push(c);
  }
  if (dropped && notes) notes.push(dropped + ' character' + (dropped === 1 ? '' : 's') +
    ' outside 7-bit ASCII replaced with "?".');
  return out;
}

function crlf(text) { return text.replace(/\r\n?|\n/g, '\r\n'); }

/* An asynchronous character as a list of [level, length-in-bit-times] pairs.
 * The length is not always 1: teleprinters use a stop element one and a half
 * bits long, which is why this returns elements rather than bits. */
function asyncElements(bytes, dataBits, stopLen) {
  const el = [];
  for (const b of bytes) {
    el.push([0, 1]);                                            /* start: space */
    for (let i = 0; i < dataBits; i++) el.push([(b >> i) & 1, 1]); /* LSB first */
    el.push([1, stopLen]);                                      /* stop: mark */
  }
  return el;
}

function fskElements(w, elements, baud, mark, space, amp) {
  const unit = 1 / baud;
  for (const e of elements) w.tone(e[0] ? mark : space, unit * e[1], amp);
}

function bitsOfByteLSB(b) { const o = []; for (let i = 0; i < 8; i++) o.push((b >> i) & 1); return o; }
function bitsOfByteMSB(b) { const o = []; for (let i = 7; i >= 0; i--) o.push((b >> i) & 1); return o; }

function num(p, key, dflt) {
  const v = parseFloat(p[key]);
  return Number.isFinite(v) ? v : dflt;
}

/* ------------------------------------------------------------------ *
 * 1. DTMF — the touch-tone keypad. Two tones from two groups of four.
 * ------------------------------------------------------------------ */
const DTMF_ROWS = [697, 770, 852, 941];
const DTMF_COLS = [1209, 1336, 1477, 1633];
const DTMF_KEYS = '123A456B789C*0#D';

function encodeDtmf(text, p, w, notes) {
  const on = num(p, 'toneMs', 100) / 1000, off = num(p, 'gapMs', 60) / 1000;
  const amp = num(p, 'level', 0.5);
  let sent = 0, skipped = 0;
  for (const raw of text.toUpperCase()) {
    if (raw === ' ' || raw === '-' || raw === ',') { w.silence(off * 3); continue; }
    if (raw === '\n' || raw === '\r') { w.silence(off * 6); continue; }
    const i = DTMF_KEYS.indexOf(raw);
    if (i < 0) { skipped++; continue; }
    w.tones([DTMF_ROWS[i >> 2], DTMF_COLS[i & 3]], on, amp);
    w.silence(off);
    sent++;
  }
  if (skipped) notes.push(skipped + ' character' + (skipped === 1 ? '' : 's') +
    ' are not on a DTMF keypad and were skipped.');
  return { digits: sent };
}

/* ------------------------------------------------------------------ *
 * 2. MF R1 — the inter-office signalling the blue boxes imitated. Two of six
 *    tones for the digits, plus KP and ST to bracket a number, plus the
 *    2600 Hz supervisory tone that made the whole thing famous.
 * ------------------------------------------------------------------ */
const MF_TONES = {
  '1': [700, 900], '2': [700, 1100], '3': [900, 1100], '4': [700, 1300], '5': [900, 1300],
  '6': [1100, 1300], '7': [700, 1500], '8': [900, 1500], '9': [1100, 1500], '0': [1300, 1500],
  'KP': [1100, 1700], 'KP2': [700, 1700],
  'ST': [1500, 1700], 'ST2P': [900, 1700], 'ST3P': [1300, 1700]
};
const MF_TOKENS = ['KP2', 'KP', 'ST2P', 'ST3P', 'ST', '2600'];

function encodeMf(text, p, w, notes) {
  const on = num(p, 'toneMs', 68) / 1000, off = num(p, 'gapMs', 68) / 1000;
  const kpOn = num(p, 'kpMs', 100) / 1000, superSec = num(p, 'superMs', 550) / 1000;
  const amp = num(p, 'level', 0.5);
  const src = text.toUpperCase();
  let i = 0, sent = 0, skipped = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const token = MF_TOKENS.find(t => rest.startsWith(t));
    if (token) {
      i += token.length;
      if (token === '2600') w.tones([2600], superSec, amp);
      else w.tones(MF_TONES[token], token.startsWith('KP') ? kpOn : on, amp);
      w.silence(off);
      sent++;
      continue;
    }
    const ch = src[i++];
    if (MF_TONES[ch]) { w.tones(MF_TONES[ch], on, amp); w.silence(off); sent++; }
    else if (/\s|-/.test(ch)) w.silence(off);
    else skipped++;
  }
  if (skipped) notes.push(skipped + ' character' + (skipped === 1 ? '' : 's') +
    ' are not MF signals and were skipped. Digits, KP, KP2, ST, ST2P, ST3P and 2600 are.');
  return { digits: sent };
}

/* ------------------------------------------------------------------ *
 * 3-6. Asynchronous FSK — Bell 202, Bell 103, V.21, V.23.
 *
 * All four are the same modulator with different numbers: a mark tone, a
 * space tone, a baud rate, and 8N1 characters between them. Bell 202 gets a
 * second framing option because that is where it is still used — AX.25, the
 * packet radio and APRS link layer.
 * ------------------------------------------------------------------ */
function encodeAsyncFsk(text, p, w, notes) {
  const baud = num(p, 'baud', 1200);
  const mark = num(p, 'mark', 1200), space = num(p, 'space', 2200);
  const amp = num(p, 'level', 0.6);
  const lead = num(p, 'leadMs', 300) / 1000;
  const body = p.crlf === false ? text : crlf(text);
  const bytes = toBytes(body, notes);

  w.tone(mark, lead, amp);                                  /* mark idle leader */
  fskElements(w, asyncElements(bytes, 8, num(p, 'stopBits', 1)), baud, mark, space, amp);
  w.tone(mark, lead, amp);                                  /* mark idle trailer */
  return { bytes: bytes.length, bits: bytes.length * 10 };
}

/* --- AX.25, for Bell 202 --- */

/* The X.25 frame check sequence: reflected CRC-16-CCITT, seeded all-ones and
 * sent inverted, low byte first. */
function fcs(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >> 1) ^ 0x8408) : (crc >> 1);
  }
  crc ^= 0xffff;
  return [crc & 0xff, (crc >> 8) & 0xff];
}

/* An AX.25 address: six callsign characters shifted up one bit to leave room
 * for the end-of-address flag in the bottom bit of the SSID byte. */
function ax25Address(call, last, cbit, notes) {
  const m = /^([A-Za-z0-9]{1,6})(?:-(\d{1,2}))?$/.exec(String(call || '').trim());
  if (!m) { notes.push('"' + call + '" is not a valid callsign — using NOCALL.'); call = 'NOCALL'; }
  const name = (m ? m[1] : 'NOCALL').toUpperCase();
  const ssid = m && m[2] ? Math.min(15, parseInt(m[2], 10)) : 0;
  const out = [];
  for (let i = 0; i < 6; i++) out.push(((i < name.length ? name.charCodeAt(i) : 0x20) << 1) & 0xfe);
  out.push(0x60 | (ssid << 1) | (cbit ? 0x80 : 0) | (last ? 1 : 0));
  return out;
}

/* HDLC: opening and closing flags, and a zero stuffed into the payload after
 * any five ones so 0x7E can only ever mean "flag". */
function hdlcBits(frame, preFlags, postFlags) {
  const out = [];
  const flag = () => { for (let i = 0; i < 8; i++) out.push((0x7e >> i) & 1); };
  for (let i = 0; i < preFlags; i++) flag();
  let ones = 0;
  for (const b of frame) for (let i = 0; i < 8; i++) {
    const bit = (b >> i) & 1;
    out.push(bit);
    if (bit) { if (++ones === 5) { out.push(0); ones = 0; } } else ones = 0;
  }
  for (let i = 0; i < postFlags; i++) flag();
  return out;
}

/* NRZI: a zero is a change of tone, a one is no change. The receiver recovers
 * its clock from the transitions, which is what the bit stuffing guarantees. */
function nrzi(bits) {
  let cur = 1;
  return bits.map(b => (b ? cur : (cur ^= 1)));
}

function encodeAx25(text, p, w, notes) {
  const baud = num(p, 'baud', 1200);
  const mark = num(p, 'mark', 1200), space = num(p, 'space', 2200);
  const amp = num(p, 'level', 0.6);
  const preFlags = Math.max(1, Math.round(num(p, 'preFlags', 32)));

  const frame = [];
  const path = String(p.path || '').split(',').map(s => s.trim()).filter(Boolean);
  const addrs = [
    { call: p.dest || 'APRS', c: true },
    { call: p.source || 'N0CALL-1', c: false }
  ].concat(path.map(c => ({ call: c, c: false })));
  addrs.forEach((a, i) => frame.push(...ax25Address(a.call, i === addrs.length - 1, a.c, notes)));
  frame.push(0x03, 0xf0);                                   /* UI frame, no layer 3 */
  frame.push(...toBytes(text.replace(/[\r\n]+/g, ' '), notes));
  frame.push(...fcs(frame));

  const bits = nrzi(hdlcBits(frame, preFlags, 3));
  const unit = 1 / baud;
  w.silence(0.02);
  for (const b of bits) w.tone(b ? mark : space, unit, amp);
  w.silence(0.02);
  notes.push('AX.25 UI frame: ' + frame.length + ' bytes including a ' +
    'two-byte FCS, sent as ' + bits.length + ' NRZI bit times.');
  return { bytes: frame.length, bits: bits.length };
}

function encodeBell202(text, p, w, notes) {
  return p.framing === 'ax25' ? encodeAx25(text, p, w, notes) : encodeAsyncFsk(text, p, w, notes);
}

/* ------------------------------------------------------------------ *
 * 7. RTTY — 5-bit Baudot at 45.45 baud with a 170 Hz shift, and the LTRS/FIGS
 *    escape that lets 32 codes carry 60-odd characters.
 * ------------------------------------------------------------------ */
const ITA2_LTRS = ' E\nA SIU\rDRJNFCKTZLWHYPQOBGMXV';
const ITA2_FIGS = ' 3\n- 87\r$4\',!:(5")2#6019?&./;';
const RTTY_LTRS_CODE = 0x1f, RTTY_FIGS_CODE = 0x1b;

function encodeRtty(text, p, w, notes) {
  const baud = num(p, 'baud', 45.45);
  const mark = num(p, 'mark', 2125), space = num(p, 'space', 2295);
  const amp = num(p, 'level', 0.6);
  const unit = 1 / baud;
  const stopLen = num(p, 'stopBits', 1.5);
  const diddle = num(p, 'diddleSec', 0.8);

  const el = [];
  const sendCode = code => {
    el.push([0, 1]);
    for (let i = 0; i < 5; i++) el.push([(code >> i) & 1, 1]);
    el.push([1, stopLen]);
  };

  /* an idle run of LTRS, the traditional way of giving the far end's motor
   * and demodulator something to lock to before the text starts */
  const codeSec = unit * (7 + stopLen);
  for (let i = 0; i < Math.round(diddle / codeSec); i++) sendCode(RTTY_LTRS_CODE);

  let figs = false, skipped = 0, codes = 0;
  for (const raw of crlf(text).toUpperCase()) {
    let code = ITA2_LTRS.indexOf(raw), wantFigs = false;
    if (code < 0) { code = ITA2_FIGS.indexOf(raw); wantFigs = code >= 0; }
    if (code < 0 || code === RTTY_LTRS_CODE || code === RTTY_FIGS_CODE) { skipped++; continue; }
    /* space, CR and LF sit at the same code in both cases, so they never
     * force a shift — which is exactly why they were put there */
    const shared = code === 4 || code === 8 || code === 2;
    if (!shared && wantFigs !== figs) {
      sendCode(wantFigs ? RTTY_FIGS_CODE : RTTY_LTRS_CODE);
      figs = wantFigs;
    }
    sendCode(code);
    codes++;
  }
  sendCode(RTTY_LTRS_CODE);
  fskElements(w, el, baud, mark, space, amp);

  if (skipped) notes.push(skipped + ' character' + (skipped === 1 ? '' : 's') +
    ' have no Baudot code and were skipped.');
  notes.push('Shift is ' + Math.abs(mark - space).toFixed(0) + ' Hz.');
  return { chars: codes };
}

/* ------------------------------------------------------------------ *
 * 8. Morse — on-off keying of a single tone, timed against PARIS, and the
 *    same keying multiplexed across several tones at once.
 * ------------------------------------------------------------------ */
const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', $: '...-..-', '@': '.--.-.'
};

/* One message keyed into a writer at one speed and one tone. Kept apart from
 * the encoder below because the multi-channel mode runs it once per channel,
 * into a writer of its own, and mixes what comes out. */
function keyMorse(w, text, opt) {
  const dit = 1.2 / opt.wpm;
  /* Farnsworth stretches the gaps between characters and words while the
   * characters themselves stay at full speed — the standard way of learning
   * the rhythm of fast code without being outrun by it. */
  const gap = 1.2 / opt.eff;
  const rise = Math.min(0.006, dit / 3);

  let skipped = 0, letters = 0;
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  words.forEach((word, wi) => {
    if (wi) w.silence(gap * 7);
    [...word].forEach((ch, ci) => {
      const code = MORSE[ch];
      if (!code) { skipped++; return; }
      if (ci) w.silence(gap * 3);
      [...code].forEach((sym, si) => {
        if (si) w.silence(dit);
        w.keyed(opt.freq, sym === '-' ? dit * 3 : dit, rise, opt.amp);
      });
      letters++;
    });
  });
  return { letters: letters, skipped: skipped, dit: dit, gap: gap };
}

/* The effective speed characters are spaced at: Farnsworth is only meaningful
 * when it is slower than the character speed, and 0 means no stretching. */
function farnsworthSpeed(wpm, farns) {
  return Math.max(3, Math.min(wpm, farns || wpm));
}

function encodeMorse(text, p, w, notes) {
  const wpm = Math.max(3, num(p, 'wpm', 18));
  const eff = farnsworthSpeed(wpm, num(p, 'farnsworth', 0));
  const freq = num(p, 'tone', 700), amp = num(p, 'level', 0.6);

  w.silence(0.15);
  const r = keyMorse(w, text, { wpm: wpm, eff: eff, freq: freq, amp: amp });
  w.silence(0.15);

  if (r.skipped) notes.push(r.skipped + ' character' + (r.skipped === 1 ? '' : 's') +
    ' have no Morse code and were skipped.');
  notes.push('Dit length ' + (r.dit * 1000).toFixed(1) + ' ms' +
    (eff < wpm ? ', Farnsworth gaps at ' + eff + ' wpm' : '') + '.');
  return { letters: r.letters };
}

/* --- Multi-channel CW ---
 *
 * Frequency-division multiplexed telegraphy: several messages keyed at the
 * same time, each on its own tone, summed into one signal. This is the
 * harmonic telegraph of the 1870s — Gray and Bell both chasing more than one
 * message down a single wire by giving each one a pitch of its own — and it
 * is also what a crowded CW band sounds like through one receiver.
 *
 * Nothing here is a new modulation: every channel is the same on-off keying
 * `encodeMorse` writes, so each one on its own still decodes as Morse, and a
 * filter narrow enough to sit on one tone recovers just that channel.
 *
 * A line reads `freq/wpm@delay: message`, and every part of the header is
 * optional — what is left out is filled in from the parameters, spacing the
 * channels out in frequency and staggering their starts so they overlap
 * rather than march in step. */
const CW_HEADER = /^[ \t]*(\d+(?:\.\d+)?)?[ \t]*(?:\/[ \t]*(\d+(?:\.\d+)?))?[ \t]*(?:@[ \t]*(\d+(?:\.\d+)?))?[ \t]*:[ \t]?/;
const CW_MAX_CHANNELS = 12;

function encodeCwMulti(text, p, w, notes) {
  const baseWpm = Math.max(3, num(p, 'wpm', 18));
  const farns = num(p, 'farnsworth', 0);
  const tone = num(p, 'tone', 600);
  const spacing = num(p, 'spacing', 250);
  const stagger = num(p, 'stagger', 0.4);
  const repeat = Math.max(1, Math.min(20, Math.round(num(p, 'repeat', 1))));
  const amp = num(p, 'level', 0.6);

  /* --- one channel per non-empty line --- */
  const chans = [];
  let over = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    if (!line.trim()) continue;
    if (chans.length >= CW_MAX_CHANNELS) { over++; continue; }
    const i = chans.length;
    const m = CW_HEADER.exec(line);
    /* a bare colon is not a header — a message may well contain one, and only
     * a line that states a frequency, a speed or a delay is treated as having
     * one, so `RST 599 : QSL` stays a message */
    const head = m && (m[1] || m[2] || m[3]) ? m : null;
    /* a header states its own numbers, so it is not held to the ranges the
     * parameter fields enforce — clamp them here instead of letting a typo
     * write a channel at DC or key one faster than it is Morse */
    const wpm = head && head[2] ? Math.min(120, Math.max(3, parseFloat(head[2]))) : baseWpm;
    chans.push({
      msg: head ? line.slice(head[0].length) : line,
      freq: head && head[1]
        ? Math.min(w.rate / 2 - 1, Math.max(20, parseFloat(head[1])))
        : tone + spacing * i,
      wpm: wpm,
      eff: farnsworthSpeed(wpm, farns),
      delay: head && head[3] ? parseFloat(head[3]) : stagger * i
    });
  }

  if (!chans.length) {
    notes.push('Nothing to send — one message per line, each its own channel.');
    return { channels: 0, letters: 0 };
  }

  /* --- render each channel on its own, summing as we go ---
   * A channel is written through a Writer of its own so it keeps its own
   * phase and its own timing cursor, and is dropped as soon as it has been
   * added in: holding twelve full-length signals at once is what would make
   * this expensive, and none of them are needed twice. */
  const mix = [];
  let letters = 0, skipped = 0, truncated = false;
  for (const c of chans) {
    const cw = new Writer(w.rate);
    cw.silence(0.15 + Math.max(0, c.delay));
    for (let r = 0; r < repeat; r++) {
      if (r) cw.silence((1.2 / c.eff) * 7);      /* a word space between sendings */
      const res = keyMorse(cw, c.msg, { wpm: c.wpm, eff: c.eff, freq: c.freq, amp: amp });
      if (!r) { letters += res.letters; skipped += res.skipped; }
    }
    if (cw.truncated) truncated = true;
    const d = cw.data;
    for (let i = 0; i < d.length; i++) mix[i] = (i < mix.length ? mix[i] : 0) + d[i];
  }
  for (let i = 0, n = Math.round(0.15 * w.rate); i < n; i++) mix.push(0);

  /* --- level ---
   * Summed channels overshoot: two dits keyed at the same instant are twice
   * the amplitude of one. The whole mix is scaled by a single number so its
   * peak lands on the requested level, which clips nothing and leaves the
   * channels in the ratio they were keyed at. */
  let peak = 0;
  for (let i = 0; i < mix.length; i++) { const v = Math.abs(mix[i]); if (v > peak) peak = v; }
  const g = peak > 0 ? amp / peak : 1;
  for (let i = 0; i < mix.length; i++) w.data.push(mix[i] * g);
  w.cursor = w.data.length;
  if (truncated) w.truncated = true;

  notes.push(chans.length + ' channel' + (chans.length === 1 ? '' : 's') + ' at ' +
    chans.map(c => Math.round(c.freq) + ' Hz/' + c.wpm + ' wpm').join(', ') +
    (repeat > 1 ? ', sent ' + repeat + ' times' : '') + '.');
  if (g < 0.999) notes.push('Mix scaled to ' + (g).toFixed(2) +
    ' of each channel so the overlaps do not clip.');
  if (skipped) notes.push(skipped + ' character' + (skipped === 1 ? '' : 's') +
    ' have no Morse code and were skipped.');
  if (over) notes.push(over + ' line' + (over === 1 ? '' : 's') + ' past the ' +
    CW_MAX_CHANNELS + ' channel limit ' + (over === 1 ? 'was' : 'were') + ' ignored.');
  return { channels: chans.length, letters: letters };
}

/* ------------------------------------------------------------------ *
 * 9. Kansas City Standard — the 1976 byte-on-cassette agreement, and the
 *    shape of most 8-bit tape formats that followed. A zero is a whole
 *    number of 1200 Hz cycles, a one is twice as many at 2400 Hz, so both
 *    take exactly one bit time and the waveform never has a discontinuity.
 * ------------------------------------------------------------------ */
function encodeKcs(text, p, w, notes) {
  const baud = num(p, 'baud', 300);
  const amp = num(p, 'level', 0.65);
  const lo = 1200, hi = 2400;
  const cyclesLo = lo / baud, cyclesHi = hi / baud;
  const lead = num(p, 'leadSec', 2);
  const stopBits = num(p, 'stopBits', 2);
  const bytes = toBytes(crlf(text), notes);

  if (Math.abs(cyclesLo - Math.round(cyclesLo)) > 1e-9)
    notes.push('At ' + baud + ' baud a bit is not a whole number of 1200 Hz cycles, ' +
      'so this is a Kansas-City-shaped signal rather than a standard one.');

  w.tone(hi, lead, amp);                                    /* leader: solid mark */
  for (const e of asyncElements(bytes, 8, stopBits)) {
    const cycles = (e[0] ? cyclesHi : cyclesLo) * e[1];
    w.tone(e[0] ? hi : lo, cycles / (e[0] ? hi : lo), amp);
  }
  w.tone(hi, Math.min(lead, 1), amp);
  notes.push(baud === 1200
    ? 'At 1200 baud this is the BBC Micro / Acorn tape format.'
    : 'Zero = ' + Math.round(cyclesLo) + ' cycles of 1200 Hz, one = ' +
      Math.round(cyclesHi) + ' cycles of 2400 Hz.');
  return { bytes: bytes.length };
}

/* ------------------------------------------------------------------ *
 * 10. ZX Spectrum tape — pulse-width keyed, timed in Z80 T-states at
 *     3.5 MHz. Produces a real header-plus-data pair for a "Bytes" file, so
 *     the output loads in an emulator with LOAD "" CODE.
 * ------------------------------------------------------------------ */
const ZX_T = 1 / 3500000;
const ZX_PILOT = 2168, ZX_SYNC1 = 667, ZX_SYNC2 = 735, ZX_ZERO = 855, ZX_ONE = 1710;

function zxBlock(w, bytes, pilotPulses, amp) {
  for (let i = 0; i < pilotPulses; i++) w.pulse(ZX_PILOT * ZX_T, amp);
  w.pulse(ZX_SYNC1 * ZX_T, amp);
  w.pulse(ZX_SYNC2 * ZX_T, amp);
  for (const b of bytes) for (const bit of bitsOfByteMSB(b)) {
    const len = (bit ? ZX_ONE : ZX_ZERO) * ZX_T;
    w.pulse(len, amp);                                      /* two pulses per bit: */
    w.pulse(len, amp);                                      /* one full cycle */
  }
}

function encodeZxSpectrum(text, p, w, notes) {
  const amp = num(p, 'level', 0.7);
  const start = Math.max(16384, Math.min(65535, Math.round(num(p, 'address', 40000))));
  const pilotHeader = Math.round(num(p, 'pilotHeader', 8063));
  const pilotData = Math.round(num(p, 'pilotData', 3223));
  const name = String(p.filename || 'clackmdm').slice(0, 10).padEnd(10, ' ');
  const data = toBytes(text, notes);

  /* the 17-byte header the ROM loader reads: file type, name, length and two
   * type-dependent parameters — for CODE, the load address and 32768 */
  const header = [3];
  for (let i = 0; i < 10; i++) header.push(name.charCodeAt(i) & 0xff);
  header.push(data.length & 0xff, (data.length >> 8) & 0xff);
  header.push(start & 0xff, (start >> 8) & 0xff);
  header.push(0x00, 0x80);

  const withFlag = (flag, body) => {
    const b = [flag].concat(body);
    let sum = 0;
    for (const x of b) sum ^= x;
    b.push(sum);
    return b;
  };

  w.silence(0.1);
  zxBlock(w, withFlag(0x00, header), pilotHeader, amp);
  w.silence(num(p, 'gapSec', 1));
  zxBlock(w, withFlag(0xff, data), pilotData, amp);
  w.silence(0.1);

  notes.push('A CODE file named "' + name.trim() + '", ' + data.length +
    ' bytes at address ' + start + '. Load it with LOAD "" CODE.');
  return { bytes: data.length };
}

/* ------------------------------------------------------------------ *
 * 11. Commodore 64 tape — three pulse lengths in pairs. The KERNAL writes
 *     everything twice with different sync countdowns, so a dropout in one
 *     copy can be repaired from the other; both passes are produced here.
 *
 *     Lengths are the .TAP definition — the byte value is the gap between
 *     falling edges in units of eight clock cycles, at the PAL 985248 Hz.
 * ------------------------------------------------------------------ */
const C64_CLOCK = 985248;
const C64_SHORT = 0x30 * 8 / C64_CLOCK;
const C64_MED = 0x42 * 8 / C64_CLOCK;
const C64_LONG = 0x56 * 8 / C64_CLOCK;

function c64Pulse(w, sec, amp) { w.pulse(sec / 2, amp); w.pulse(sec / 2, amp); }

function c64Byte(w, b, amp) {
  c64Pulse(w, C64_LONG, amp);                               /* byte marker */
  c64Pulse(w, C64_MED, amp);
  let ones = 0;
  for (const bit of bitsOfByteLSB(b)) {
    if (bit) { ones++; c64Pulse(w, C64_MED, amp); c64Pulse(w, C64_SHORT, amp); }
    else { c64Pulse(w, C64_SHORT, amp); c64Pulse(w, C64_MED, amp); }
  }
  const parity = (ones % 2) ? 0 : 1;                        /* odd parity overall */
  if (parity) { c64Pulse(w, C64_MED, amp); c64Pulse(w, C64_SHORT, amp); }
  else { c64Pulse(w, C64_SHORT, amp); c64Pulse(w, C64_MED, amp); }
}

function encodeC64(text, p, w, notes) {
  const amp = num(p, 'level', 0.7);
  const leader = Math.max(64, Math.round(num(p, 'leaderPulses', 6000)));
  const interLeader = Math.max(32, Math.round(leader / 8));
  const bytes = toBytes(crlf(text), notes);
  let sum = 0;
  for (const b of bytes) sum ^= b;
  const block = bytes.concat([sum]);

  const pass = (first, pulses) => {
    for (let i = 0; i < pulses; i++) c64Pulse(w, C64_SHORT, amp);
    for (let i = 9; i >= 1; i--) c64Byte(w, (first ? 0x80 : 0x00) | i, amp);
    for (const b of block) c64Byte(w, b, amp);
  };

  w.silence(0.05);
  pass(true, leader);                                       /* countdown $89…$81 */
  pass(false, interLeader);                                 /* countdown $09…$01 */
  for (let i = 0; i < interLeader; i++) c64Pulse(w, C64_SHORT, amp);
  w.silence(0.05);

  notes.push(block.length + ' bytes including an XOR checksum, written twice. ' +
    'Pulse lengths ' + (C64_SHORT * 1e6).toFixed(0) + '/' + (C64_MED * 1e6).toFixed(0) +
    '/' + (C64_LONG * 1e6).toFixed(0) + ' µs.');
  if (leader < 27136) notes.push('The leader is shortened from the KERNAL’s 27136 pulses ' +
    'to keep the file small; real hardware wants the full one.');
  return { bytes: bytes.length };
}

/* ------------------------------------------------------------------ *
 * 12. SMPTE linear timecode — 80 bits a frame in biphase mark code, so the
 *     clock survives being played backwards, slowly, or off a worn tape.
 * ------------------------------------------------------------------ */
const LTC_FPS = { 24: [24, false], 25: [25, false], 2997: [30, true], 30: [30, false] };

function ltcFrameBits(h, m, s, f, dropFrame, fps) {
  const bits = new Array(80).fill(0);
  const put = (at, count, value) => { for (let i = 0; i < count; i++) bits[at + i] = (value >> i) & 1; };
  put(0, 4, f % 10); put(8, 2, Math.floor(f / 10));
  put(16, 4, s % 10); put(24, 3, Math.floor(s / 10));
  put(32, 4, m % 10); put(40, 3, Math.floor(m / 10));
  put(48, 4, h % 10); put(56, 2, Math.floor(h / 10));
  bits[10] = dropFrame ? 1 : 0;
  /* sync word — the only place in the frame where five ones can be followed
   * by a zero-one, which is how a decoder finds the frame boundary */
  const sync = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
  for (let i = 0; i < 16; i++) bits[64 + i] = sync[i];
  /* the polarity correction bit keeps the number of ones even so every frame
   * starts on the same edge; it lives at 27 for 25 fps and 59 otherwise */
  const parityBit = fps === 25 ? 27 : 59;
  let ones = 0;
  for (let i = 0; i < 80; i++) if (bits[i]) ones++;
  bits[parityBit] = ones % 2;
  return bits;
}

function encodeLtc(text, p, w, notes) {
  const sel = LTC_FPS[String(p.fps || 25)] || LTC_FPS[25];
  const fps = sel[0], dropFrame = sel[1];
  const rate = dropFrame ? 30000 / 1001 : fps;
  const amp = num(p, 'level', 0.7);
  const duration = Math.max(0.2, num(p, 'duration', 5));

  const tc = /(\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})/.exec(text || '');
  if (!tc) notes.push('No start timecode found in the text — starting from 00:00:00:00. ' +
    'Write it as hh:mm:ss:ff.');
  let h = tc ? Math.min(23, +tc[1]) : 0, m = tc ? Math.min(59, +tc[2]) : 0;
  let s = tc ? Math.min(59, +tc[3]) : 0, f = tc ? Math.min(fps - 1, +tc[4]) : 0;

  const half = 1 / (rate * 80 * 2);
  const frames = Math.round(duration * rate);
  for (let n = 0; n < frames; n++) {
    for (const bit of ltcFrameBits(h, m, s, f, dropFrame, fps)) {
      /* biphase mark: an edge at every bit boundary, and a one gets a second
       * edge in the middle — so the bit is told by counting edges, which
       * survives the tape being played slowly or backwards */
      w.flip();
      w.hold(half, amp);
      if (bit) w.flip();
      w.hold(half, amp);
    }
    if (++f >= fps) {
      f = 0;
      if (++s >= 60) {
        s = 0;
        if (++m >= 60) { m = 0; h = (h + 1) % 24; }
        /* 29.97 drop-frame skips two frame numbers a minute, except every
         * tenth, so the count keeps up with the clock on the wall */
        if (dropFrame && m % 10 !== 0) f = 2;
      }
    }
  }

  const pad = n => String(n).padStart(2, '0');
  notes.push('Ends at ' + pad(h) + ':' + pad(m) + ':' + pad(s) + (dropFrame ? ';' : ':') + pad(f) +
    ' — ' + frames + ' frames at ' + (dropFrame ? '29.97 drop-frame' : fps + ' fps') +
    ', ' + (rate * 80).toFixed(0) + ' bits per second.');
  return { frames: frames };
}

/* ------------------------------------------------------------------ *
 * 13. PSK31 — 31.25 baud BPSK with a variable-length code, so common letters
 *     are short. A zero reverses the carrier's phase and a one leaves it
 *     alone, which is why the alphabet is built to avoid runs of zeros.
 * ------------------------------------------------------------------ */
const PSK_VARICODE = [
  '1010101011', '1011011011', '1011101101', '1101110111', '1011101011', '1101011111',
  '1011101111', '1011111101', '1011111111', '11101111', '11101', '1101101111',
  '1011011101', '11111', '1101110101', '1110101011', '1011110111', '1011110101',
  '1110101101', '1110101111', '1101011011', '1101101011', '1101101101', '1101010111',
  '1101111011', '1101111101', '1110110111', '1101010101', '1101011101', '1110111011',
  '1011111011', '1101111111', '1', '111111111', '101011111', '111110101', '111011011',
  '1011010101', '1010111011', '101111111', '11111011', '11110111', '101101111',
  '111011111', '1110101', '110101', '1010111', '110101111', '10110111', '10111101',
  '11101101', '11111111', '101110111', '101011011', '101101011', '110101101',
  '110101011', '110110111', '11110101', '110111101', '111101101', '1010101',
  '111010111', '1010101111', '1010111101', '1111101', '11101011', '10101101',
  '10110101', '1110111', '11011011', '11111101', '101010101', '1111111', '111111101',
  '101111101', '11010111', '10111011', '11011101', '10101011', '11010101', '111011101',
  '10101111', '1101111', '1101101', '101010111', '110110101', '101011101', '101110101',
  '101111011', '1010101101', '111110111', '111101111', '111111011', '1010111111',
  '101101101', '1011011111', '1011', '1011111', '101111', '101101', '11', '111101',
  '1011011', '101011', '1101', '111101011', '10111111', '11011', '111011', '1111',
  '111', '111111', '110111111', '10101', '10111', '101', '110111', '1111011',
  '1101011', '11011111', '1011101', '111010101', '1010110111', '110111011',
  '1010110101', '1011010111', '1110110101'
];

function encodePsk31(text, p, w, notes) {
  const baud = num(p, 'baud', 31.25);
  const carrier = num(p, 'carrier', 1000);
  const amp = num(p, 'level', 0.7);
  const preSec = num(p, 'preambleSec', 1.5);

  const bits = [];
  const idle = Math.max(0, Math.round(preSec * baud));
  for (let i = 0; i < idle; i++) bits.push(0);              /* idle: solid reversals */
  let skipped = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c > 127) { skipped++; continue; }
    for (const b of PSK_VARICODE[c]) bits.push(b === '1' ? 1 : 0);
    bits.push(0, 0);                                        /* the inter-character gap:
                                                               no varicode contains 00 */
  }
  for (let i = 0; i < idle; i++) bits.push(0);

  /* A phase reversal is made at a point where the envelope is zero, so the
   * signal stays inside its 31 Hz of spectrum instead of splattering. Each
   * symbol is shaped by whether a reversal falls at its start and at its end. */
  const reversal = bits.map(b => b === 0);
  const step = TAU * carrier / w.rate;
  let phase = w.phase, sign = 1;
  const unit = 1 / baud;
  for (let k = 0; k < bits.length; k++) {
    if (reversal[k]) sign = -sign;
    const n = w._n(unit);
    const startsRev = reversal[k], endsRev = k + 1 < bits.length && reversal[k + 1];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let env = 1;
      if (startsRev && t < 0.5) env = 0.5 - 0.5 * Math.cos(TAU * t);
      if (endsRev && t >= 0.5) env = Math.min(env, 0.5 - 0.5 * Math.cos(TAU * (1 - t)));
      w.data.push(amp * env * sign * Math.sin(phase));
      phase += step;
      if (phase >= TAU) phase -= TAU;
    }
  }
  w.phase = phase;

  if (skipped) notes.push(skipped + ' non-ASCII character' + (skipped === 1 ? '' : 's') +
    ' skipped — the varicode alphabet is 7-bit.');
  notes.push(bits.length + ' symbols at ' + baud + ' baud, carrier ' + carrier + ' Hz.');
  return { bits: bits.length };
}

/* ------------------------------------------------------------------ *
 * 14. Bell 212A / V.22 — 1200 bits a second as 600 differential quadrature
 *     symbols, each carrying a dibit as a change of phase. The scrambler is
 *     what stops a run of identical bytes turning into an unmodulated
 *     carrier the receiver can't take a clock from.
 * ------------------------------------------------------------------ */
const V22_PHASE = { '00': 90, '01': 0, '11': 270, '10': 180 };

function encodeV22(text, p, w, notes) {
  const carrier = num(p, 'carrier', 1200);
  const baud = num(p, 'baud', 600);
  const amp = num(p, 'level', 0.6);
  const preSec = num(p, 'preambleSec', 0.6);
  const scramble = p.scramble !== false;
  const bytes = toBytes(crlf(text), notes);

  let bits = [];
  const mark = Math.max(0, Math.round(preSec * baud * 2));
  for (let i = 0; i < mark; i++) bits.push(1);              /* scrambled ones, the
                                                               training pattern */
  for (const e of asyncElements(bytes, 8, 1)) for (let i = 0; i < e[1]; i++) bits.push(e[0]);
  /* the carrier does not stop dead on the last stop bit — without a trailing
   * idle the receiver's differential detector has no symbol to compare the
   * final one against, and the last character is lost */
  for (let i = 0; i < 32; i++) bits.push(1);
  while (bits.length % 2) bits.push(1);

  if (scramble) {
    /* the self-synchronising scrambler of V.22 originate mode: 1 + x^-14 + x^-17,
     * fed from its own output so the receiver can undo it without being told
     * where the sequence started */
    const reg = new Array(17).fill(0);
    bits = bits.map(b => {
      const y = b ^ reg[13] ^ reg[16];
      reg.unshift(y);
      reg.pop();
      return y;
    });
  }

  const unit = 1 / baud;
  const step = TAU * carrier / w.rate;
  let phase = w.phase, offset = 0;
  for (let k = 0; k + 1 < bits.length; k += 2) {
    const delta = V22_PHASE['' + bits[k] + bits[k + 1]] * Math.PI / 180;
    const from = offset;
    offset = (offset + delta) % TAU;
    const n = w._n(unit);
    /* a real modem shapes this with a root-raised-cosine filter; here the
     * phase is swept across the first quarter of the symbol, which keeps the
     * clicks out without pulling in a full pulse shaper */
    const sweep = Math.max(1, Math.round(n * 0.25));
    for (let i = 0; i < n; i++) {
      const t = i < sweep ? 0.5 - 0.5 * Math.cos(Math.PI * i / sweep) : 1;
      const ph = from + delta * t;
      w.data.push(amp * Math.sin(phase + ph));
      phase += step;
      if (phase >= TAU) phase -= TAU;
    }
  }
  w.phase = phase;

  notes.push(bytes.length + ' bytes as ' + Math.floor(bits.length / 2) + ' DQPSK symbols, ' +
    'carrier ' + carrier + ' Hz' + (scramble ? ', scrambled' : ', unscrambled') + '.');
  return { bytes: bytes.length };
}

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */
const LEVEL = { id: 'level', label: 'Level', type: 'number', def: 0.6, min: 0.05, max: 1, step: 0.05 };

const PROTOCOLS = [
  {
    id: 'dtmf', name: 'DTMF (Touch-Tone)', group: 'Telephone signalling',
    year: '1963', input: 'Digits',
    hint: '0-9, A-D, * and #. A space, comma or hyphen is a pause.',
    sample: '01706 555 0123',
    blurb: 'Two tones at once, one from a row group and one from a column group, ' +
      'so a single stuck oscillator can never fake a digit.',
    params: [
      { id: 'toneMs', label: 'Tone', type: 'number', def: 100, min: 20, max: 500, step: 5, unit: 'ms' },
      { id: 'gapMs', label: 'Gap', type: 'number', def: 60, min: 20, max: 500, step: 5, unit: 'ms' },
      LEVEL
    ],
    encode: encodeDtmf
  },
  {
    id: 'mf', name: 'MF R1 (blue box)', group: 'Telephone signalling',
    year: '1950s', input: 'Signals',
    hint: 'Digits plus KP, KP2, ST, ST2P, ST3P and 2600.',
    sample: 'KP 212 555 1212 ST',
    blurb: 'The trunk signalling that ran between exchanges, two of six tones a ' +
      'digit — and 2600 Hz, the tone that told the far end the line was idle.',
    params: [
      { id: 'toneMs', label: 'Digit', type: 'number', def: 68, min: 20, max: 300, step: 1, unit: 'ms' },
      { id: 'kpMs', label: 'KP', type: 'number', def: 100, min: 20, max: 300, step: 1, unit: 'ms' },
      { id: 'gapMs', label: 'Gap', type: 'number', def: 68, min: 20, max: 300, step: 1, unit: 'ms' },
      { id: 'superMs', label: '2600 Hz', type: 'number', def: 550, min: 50, max: 3000, step: 10, unit: 'ms' },
      LEVEL
    ],
    encode: encodeMf
  },
  {
    id: 'bell202', name: 'Bell 202 AFSK — 1200 baud', group: 'Frequency shift keying',
    year: '1976', input: 'Message',
    hint: 'Raw async sends bytes; AX.25 wraps them in a packet radio frame.',
    sample: 'CQ CQ de ClackOS',
    blurb: 'Half-duplex 1200 baud, and the reason your radio still makes that ' +
      'noise: APRS, packet radio and Caller ID all ride on it.',
    params: [
      { id: 'framing', label: 'Framing', type: 'select', def: 'async',
        options: [['async', 'Raw async 8N1'], ['ax25', 'AX.25 UI frame (APRS)']] },
      { id: 'baud', label: 'Baud', type: 'number', def: 1200, min: 50, max: 4800, step: 1 },
      { id: 'mark', label: 'Mark', type: 'number', def: 1200, min: 100, max: 8000, step: 1, unit: 'Hz' },
      { id: 'space', label: 'Space', type: 'number', def: 2200, min: 100, max: 8000, step: 1, unit: 'Hz' },
      { id: 'leadMs', label: 'Leader', type: 'number', def: 300, min: 0, max: 3000, step: 10, unit: 'ms',
        when: p => p.framing !== 'ax25' },
      { id: 'source', label: 'Source call', type: 'text', def: 'N0CALL-1', when: p => p.framing === 'ax25' },
      { id: 'dest', label: 'Destination', type: 'text', def: 'APRS', when: p => p.framing === 'ax25' },
      { id: 'path', label: 'Digipeater path', type: 'text', def: 'WIDE1-1', when: p => p.framing === 'ax25' },
      { id: 'preFlags', label: 'Preamble flags', type: 'number', def: 32, min: 1, max: 255, step: 1,
        when: p => p.framing === 'ax25' },
      LEVEL
    ],
    encode: encodeBell202
  },
  {
    id: 'bell103', name: 'Bell 103 — 300 baud', group: 'Frequency shift keying',
    year: '1962', input: 'Message',
    hint: 'The two ends use different tone pairs, which is what makes it full duplex.',
    sample: 'ATDT 5551234\r\nCONNECT 300\r\n',
    blurb: 'The first dial-up standard worth the name. Both ends can talk at ' +
      'once because each has its own pair of tones.',
    params: [
      { id: 'channel', label: 'Channel', type: 'select', def: 'originate',
        options: [['originate', 'Originate (1070/1270)'], ['answer', 'Answer (2025/2225)']],
        apply: (p, v) => v === 'answer' ? { mark: 2225, space: 2025 } : { mark: 1270, space: 1070 } },
      { id: 'baud', label: 'Baud', type: 'number', def: 300, min: 25, max: 1200, step: 1 },
      { id: 'leadMs', label: 'Leader', type: 'number', def: 400, min: 0, max: 3000, step: 10, unit: 'ms' },
      LEVEL
    ],
    encode: encodeAsyncFsk
  },
  {
    id: 'v21', name: 'ITU-T V.21 — 300 baud', group: 'Frequency shift keying',
    year: '1964', input: 'Message',
    hint: 'The European answer to Bell 103, and still the control channel in every fax call.',
    sample: 'RING\r\nCONNECT\r\n',
    blurb: 'Same idea as Bell 103 with different numbers — and the survivor of ' +
      'the two, because fax machines negotiate over it to this day.',
    params: [
      { id: 'channel', label: 'Channel', type: 'select', def: 'ch1',
        options: [['ch1', 'Channel 1 (980/1180)'], ['ch2', 'Channel 2 (1650/1850)']],
        apply: (p, v) => v === 'ch2' ? { mark: 1650, space: 1850 } : { mark: 980, space: 1180 } },
      { id: 'baud', label: 'Baud', type: 'number', def: 300, min: 25, max: 1200, step: 1 },
      { id: 'leadMs', label: 'Leader', type: 'number', def: 400, min: 0, max: 3000, step: 10, unit: 'ms' },
      LEVEL
    ],
    encode: encodeAsyncFsk
  },
  {
    id: 'v23', name: 'ITU-T V.23 — Minitel / Prestel', group: 'Frequency shift keying',
    year: '1964', input: 'Message',
    hint: 'Fast one way, slow the other — pages down, keystrokes up.',
    sample: 'CLACKTRONICS VIEWDATA\r\nPAGE 100\r\n',
    blurb: 'The lopsided one: 1200 baud towards the terminal and 75 baud back. ' +
      'Videotex worked because nobody types at 1200 baud.',
    params: [
      { id: 'channel', label: 'Direction', type: 'select', def: 'forward',
        options: [['forward', 'Forward, 1200 baud (1300/2100)'], ['back', 'Back channel, 75 baud (390/450)']],
        apply: (p, v) => v === 'back' ? { mark: 390, space: 450, baud: 75 } : { mark: 1300, space: 2100, baud: 1200 } },
      { id: 'leadMs', label: 'Leader', type: 'number', def: 400, min: 0, max: 3000, step: 10, unit: 'ms' },
      LEVEL
    ],
    encode: encodeAsyncFsk
  },
  {
    id: 'rtty', name: 'RTTY — Baudot 45.45 baud', group: 'Frequency shift keying',
    year: '1930s', input: 'Message',
    hint: 'Upper case only. Figures are reached by a shift code, inserted automatically.',
    sample: 'CQ CQ DE G0CLK G0CLK K',
    blurb: 'Five bits a character and a shift code to reach the numbers — the ' +
      'teleprinter alphabet, still on the air eighty years on.',
    params: [
      { id: 'baud', label: 'Baud', type: 'number', def: 45.45, min: 10, max: 300, step: 0.01 },
      { id: 'mark', label: 'Mark', type: 'number', def: 2125, min: 100, max: 8000, step: 1, unit: 'Hz' },
      { id: 'space', label: 'Space', type: 'number', def: 2295, min: 100, max: 8000, step: 1, unit: 'Hz' },
      { id: 'stopBits', label: 'Stop bits', type: 'number', def: 1.5, min: 1, max: 2, step: 0.5 },
      { id: 'diddleSec', label: 'Idle run', type: 'number', def: 0.8, min: 0, max: 5, step: 0.1, unit: 's' },
      LEVEL
    ],
    encode: encodeRtty
  },
  {
    id: 'morse', name: 'Morse / CW', group: 'Frequency shift keying',
    year: '1840s', input: 'Message',
    hint: 'Letters, digits and common punctuation. Farnsworth 0 means no stretching.',
    sample: 'CQ DE CLACKTRONICS K',
    blurb: 'On-off keying, the oldest digital mode there is. Timed against PARIS, ' +
      'with soft edges so it does not click.',
    params: [
      { id: 'wpm', label: 'Speed', type: 'number', def: 18, min: 3, max: 60, step: 1, unit: 'wpm' },
      { id: 'farnsworth', label: 'Farnsworth', type: 'number', def: 0, min: 0, max: 60, step: 1, unit: 'wpm' },
      { id: 'tone', label: 'Tone', type: 'number', def: 700, min: 200, max: 3000, step: 10, unit: 'Hz' },
      LEVEL
    ],
    encode: encodeMorse
  },
  {
    id: 'cwmulti', name: 'Multi-channel CW', group: 'Frequency shift keying',
    year: '1874', input: 'Channels',
    hint: 'One channel per line, "freq/wpm@delay: message" — every part of that optional.',
    sample: 'CQ CQ DE M0ABC M0ABC K\n/28: TEST DE G3XYZ K\n1450/12@2.5: QRZ? DE 2E0QQQ K',
    blurb: 'Several messages keyed at once, each on its own tone — the harmonic telegraph\'s ' +
      'trick of putting more than one message on a wire by giving each a pitch.',
    params: [
      { id: 'tone', label: 'Base tone', type: 'number', def: 600, min: 200, max: 3000, step: 10, unit: 'Hz' },
      /* wide enough that neighbouring channels land in different bins of the
         512-point spectrogram, so the waterfall shows them apart */
      { id: 'spacing', label: 'Spacing', type: 'number', def: 250, min: 0, max: 1000, step: 10, unit: 'Hz' },
      { id: 'wpm', label: 'Speed', type: 'number', def: 18, min: 3, max: 60, step: 1, unit: 'wpm' },
      { id: 'farnsworth', label: 'Farnsworth', type: 'number', def: 0, min: 0, max: 60, step: 1, unit: 'wpm' },
      { id: 'stagger', label: 'Stagger', type: 'number', def: 0.4, min: 0, max: 20, step: 0.1, unit: 's' },
      { id: 'repeat', label: 'Repeat', type: 'number', def: 1, min: 1, max: 20, step: 1, unit: '×' },
      LEVEL
    ],
    encode: encodeCwMulti
  },
  {
    id: 'kcs', name: 'Kansas City Standard', group: 'Cassette tape',
    year: '1976', input: 'Message',
    hint: 'At 1200 baud this is the BBC Micro and Acorn format.',
    sample: '10 PRINT "CLACKOS"\r\n20 GOTO 10\r\n',
    blurb: 'Agreed in a Kansas City hotel over two days so the 8-bit machines ' +
      'could at least read each other’s cassettes. Mostly they still did not.',
    params: [
      { id: 'baud', label: 'Baud', type: 'select', def: 300,
        options: [[300, '300 (KCS)'], [600, '600'], [1200, '1200 (BBC Micro)']] },
      { id: 'leadSec', label: 'Leader', type: 'number', def: 2, min: 0, max: 10, step: 0.5, unit: 's' },
      { id: 'stopBits', label: 'Stop bits', type: 'number', def: 2, min: 1, max: 2, step: 1 },
      LEVEL
    ],
    encode: encodeKcs
  },
  {
    id: 'zx', name: 'ZX Spectrum tape', group: 'Cassette tape',
    year: '1982', input: 'File contents',
    hint: 'Produces a header and data block pair. Load it with LOAD "" CODE.',
    sample: 'CLACKOS ON TAPE',
    blurb: 'Pulse-width keyed and timed in Z80 T-states, pilot tone and all. ' +
      'The output is a real CODE file, not an impression of one.',
    params: [
      { id: 'filename', label: 'Filename', type: 'text', def: 'clackmdm' },
      { id: 'address', label: 'Address', type: 'number', def: 40000, min: 16384, max: 65535, step: 1 },
      { id: 'pilotHeader', label: 'Header pilot', type: 'number', def: 8063, min: 200, max: 20000, step: 1, unit: 'pulses' },
      { id: 'pilotData', label: 'Data pilot', type: 'number', def: 3223, min: 200, max: 20000, step: 1, unit: 'pulses' },
      { id: 'gapSec', label: 'Block gap', type: 'number', def: 1, min: 0.1, max: 5, step: 0.1, unit: 's' },
      LEVEL
    ],
    encode: encodeZxSpectrum
  },
  {
    id: 'c64', name: 'Commodore 64 tape', group: 'Cassette tape',
    year: '1982', input: 'File contents',
    hint: 'Three pulse lengths in pairs, written twice like the KERNAL does.',
    sample: 'CLACKOS ON DATASSETTE',
    blurb: 'Slow, loud, and belt-and-braces: every block goes down twice with a ' +
      'different countdown, so one bad pass can be repaired from the other.',
    params: [
      { id: 'leaderPulses', label: 'Leader', type: 'number', def: 6000, min: 64, max: 27136, step: 1, unit: 'pulses' },
      LEVEL
    ],
    encode: encodeC64
  },
  {
    id: 'ltc', name: 'SMPTE linear timecode', group: 'Timecode',
    year: '1969', input: 'Start timecode',
    hint: 'Written hh:mm:ss:ff. The duration sets how much timecode to generate.',
    sample: '01:00:00:00',
    blurb: 'Eighty bits a frame in biphase mark code, so it still reads when the ' +
      'tape is crawling, or running backwards.',
    params: [
      { id: 'fps', label: 'Frame rate', type: 'select', def: '25',
        options: [['24', '24 fps'], ['25', '25 fps'], ['2997', '29.97 drop-frame'], ['30', '30 fps']] },
      { id: 'duration', label: 'Duration', type: 'number', def: 5, min: 0.2, max: 120, step: 0.5, unit: 's' },
      { id: 'level', label: 'Level', type: 'number', def: 0.7, min: 0.05, max: 1, step: 0.05 }
    ],
    encode: encodeLtc
  },
  {
    id: 'psk31', name: 'PSK31', group: 'Phase shift keying',
    year: '1998', input: 'Message',
    hint: 'Mixed case is fine — the alphabet is shortest for lower-case English.',
    sample: 'CQ CQ de G0CLK pse k',
    blurb: 'Thirty-one baud in about as many hertz. The alphabet is Huffman-ish, ' +
      'so an "e" is two bits and a "$" is nine.',
    params: [
      { id: 'carrier', label: 'Carrier', type: 'number', def: 1000, min: 200, max: 3000, step: 10, unit: 'Hz' },
      { id: 'baud', label: 'Baud', type: 'number', def: 31.25, min: 5, max: 250, step: 0.25 },
      { id: 'preambleSec', label: 'Idle', type: 'number', def: 1.5, min: 0, max: 10, step: 0.5, unit: 's' },
      { id: 'level', label: 'Level', type: 'number', def: 0.7, min: 0.05, max: 1, step: 0.05 }
    ],
    encode: encodePsk31
  },
  {
    id: 'v22', name: 'Bell 212A / V.22 DQPSK', group: 'Phase shift keying',
    year: '1980', input: 'Message',
    hint: 'Two bits a symbol, carried as a change of phase rather than a phase.',
    sample: 'ATDT 5551234\r\nCONNECT 1200\r\n',
    blurb: '1200 bits a second out of 600 symbols. Differential, so it does not ' +
      'matter which way up the receiver thinks the carrier is.',
    params: [
      { id: 'carrier', label: 'Carrier', type: 'select', def: 1200,
        options: [[1200, 'Originate (1200 Hz)'], [2400, 'Answer (2400 Hz)']] },
      { id: 'baud', label: 'Symbol rate', type: 'number', def: 600, min: 100, max: 1200, step: 1, unit: 'Bd' },
      { id: 'scramble', label: 'Scrambler', type: 'check', def: true },
      { id: 'preambleSec', label: 'Training', type: 'number', def: 0.6, min: 0, max: 5, step: 0.1, unit: 's' },
      LEVEL
    ],
    encode: encodeV22
  }
];

const BY_ID = {};
for (const proto of PROTOCOLS) BY_ID[proto.id] = proto;

/* Defaults for a protocol, with any `apply` mapping from a preset select
 * folded in — that is how "Answer" on Bell 103 becomes mark 2225 / space 2025
 * without the frequencies having to be typed. */
function defaults(proto) {
  const p = {};
  for (const f of proto.params) p[f.id] = f.def;
  return resolve(proto, p);
}

function resolve(proto, values) {
  const p = Object.assign({}, values);
  for (const f of proto.params) {
    if (f.apply && p[f.id] != null) Object.assign(p, f.apply(p, p[f.id]));
  }
  return p;
}

function encode(id, text, values) {
  const proto = BY_ID[id];
  if (!proto) throw new Error('Unknown protocol: ' + id);
  const p = resolve(proto, Object.assign(defaults(proto), values || {}));
  const w = new Writer(RATE);
  const notes = [];
  const stats = proto.encode(String(text == null ? '' : text), p, w, notes) || {};
  if (w.truncated) notes.push('Signal reached the ' + MAX_SECONDS +
    ' second limit and was cut short. Shorten the message or raise the baud rate.');
  return {
    samples: w.toFloat32(),
    rate: RATE,
    seconds: w.seconds,
    notes: notes,
    stats: stats,
    params: p,
    protocol: proto
  };
}

global.ClackModem = {
  RATE: RATE,
  MAX_SECONDS: MAX_SECONDS,
  PROTOCOLS: PROTOCOLS,
  get: id => BY_ID[id],
  defaults: defaults,
  resolve: resolve,
  encode: encode,
  /* The alphabets and tone plans, exported so the demodulators in
   * modem-decoders.js can invert these tables rather than keep second copies
   * that would quietly stop matching. */
  tables: {
    DTMF_ROWS: DTMF_ROWS, DTMF_COLS: DTMF_COLS, DTMF_KEYS: DTMF_KEYS,
    MF_TONES: MF_TONES,
    ITA2_LTRS: ITA2_LTRS, ITA2_FIGS: ITA2_FIGS,
    RTTY_LTRS_CODE: RTTY_LTRS_CODE, RTTY_FIGS_CODE: RTTY_FIGS_CODE,
    MORSE: MORSE,
    PSK_VARICODE: PSK_VARICODE,
    LTC_FPS: LTC_FPS,
    ZX_T: ZX_T, ZX_PILOT: ZX_PILOT, ZX_SYNC1: ZX_SYNC1, ZX_SYNC2: ZX_SYNC2,
    ZX_ZERO: ZX_ZERO, ZX_ONE: ZX_ONE,
    C64_CLOCK: C64_CLOCK, C64_SHORT: C64_SHORT, C64_MED: C64_MED, C64_LONG: C64_LONG
  }
};

})(window);
