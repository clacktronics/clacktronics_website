/* ClackModem — the demodulators.
 *
 * modem-protocols.js takes text apart into bits, framing and tones. This file
 * puts a signal back together in the other direction, and it is organised the
 * same way round: four front ends recover symbols from audio, and the framing
 * is undone by inverting the tables the encoders used rather than by writing
 * second copies of them. ITA2, the Morse alphabet, the PSK31 varicode and the
 * MF tone pairs are all read back out of modem-protocols.js at load time, so a
 * change to an encoder's alphabet cannot leave its decoder behind.
 *
 *   tone bank      DTMF, MF R1                 Goertzel over short blocks
 *   frequency      Bell 202, 103, V.21, V.23,  quadrature correlator pair,
 *                  RTTY, KCS, AX.25            then async framing or HDLC
 *   edge timing    SMPTE LTC, ZX, C64          intervals between zero crossings
 *   envelope       Morse                       keyed-tone magnitude and timing
 *   phase          PSK31                       differential BPSK and varicode
 *
 * Every decoder is a small state machine fed by push(), so the same code runs
 * over a whole file and over a microphone arriving a few thousand samples at a
 * time. Nothing here reaches for the length of the signal in advance.
 *
 * Depends on modem-protocols.js; exposed as window.ClackModemDecode.
 */
(function (global) {
'use strict';

const M = global.ClackModem;
const TAU = Math.PI * 2;

function num(p, key, dflt) {
  const v = parseFloat(p && p[key]);
  return Number.isFinite(v) ? v : dflt;
}

/* ------------------------------------------------------------------ *
 * A decoder's shape. Subclasses fill in feed() for one sample and may
 * override finish(); everything else — timestamps, text, the event log — is
 * the same for all of them.
 * ------------------------------------------------------------------ */
class Decoder {
  constructor(rate, params) {
    this.rate = rate;
    this.params = params || {};
    this.n = 0;               /* samples seen, for timestamps */
    this.text = '';
    this.events = [];
    this.notes = [];
    this.measured = {};
    this.locked = false;
    this.peak = 0;
  }

  get seconds() { return this.n / this.rate; }

  emit(label, text, ok, at) {
    this.events.push({
      t: at == null ? this.seconds : at,
      label: label,
      text: text == null ? '' : String(text),
      ok: ok !== false
    });
  }

  write(s) { this.text += s; }

  push(block) {
    for (let i = 0; i < block.length; i++) {
      const s = block[i];
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      this.feed(s);
      this.n++;
    }
  }

  feed() {}
  finish() {}

  flush() {
    this.finish();
    return { text: this.text, events: this.events, notes: this.notes,
      measured: this.measured, locked: this.locked, seconds: this.seconds };
  }
}

/* ------------------------------------------------------------------ *
 * A DC blocker. A recording off a sound card often sits a little off zero,
 * and every edge-timing decoder below counts sign changes.
 * ------------------------------------------------------------------ */
class DcBlock {
  constructor(rate) { this.a = 1 - 1 / (rate * 0.02); this.x1 = 0; this.y1 = 0; }
  run(x) {
    const y = x - this.x1 + this.a * this.y1;
    this.x1 = x; this.y1 = y;
    return y;
  }
}

/* ------------------------------------------------------------------ *
 * Goertzel over a fixed block — the tone bank behind DTMF and MF.
 * ------------------------------------------------------------------ */
class ToneBank {
  constructor(rate, freqs, blockN) {
    this.N = blockN;
    this.coeff = freqs.map(f => 2 * Math.cos(TAU * f / rate));
    this.s1 = new Float64Array(freqs.length);
    this.s2 = new Float64Array(freqs.length);
    this.mags = new Float64Array(freqs.length);
    this.energy = 0;
    this.i = 0;
  }

  /* Returns true on the sample that completes a block, leaving the powers in
   * this.mags and the block's total energy in this.energy. */
  feed(x) {
    for (let k = 0; k < this.coeff.length; k++) {
      const s = x + this.coeff[k] * this.s1[k] - this.s2[k];
      this.s2[k] = this.s1[k];
      this.s1[k] = s;
    }
    this.energy += x * x;
    if (++this.i < this.N) return false;
    for (let k = 0; k < this.coeff.length; k++) {
      this.mags[k] = (this.s1[k] * this.s1[k] + this.s2[k] * this.s2[k]
        - this.coeff[k] * this.s1[k] * this.s2[k]) / (this.N * this.N / 4);
      this.s1[k] = this.s2[k] = 0;
    }
    this.blockEnergy = this.energy / this.N;
    this.energy = 0;
    this.i = 0;
    return true;
  }
}

function topTwo(mags) {
  let a = -1, b = -1, ai = -1, bi = -1;
  for (let k = 0; k < mags.length; k++) {
    if (mags[k] > a) { b = a; bi = ai; a = mags[k]; ai = k; }
    else if (mags[k] > b) { b = mags[k]; bi = k; }
  }
  return { first: ai, firstMag: a, second: bi, secondMag: b };
}

/* ------------------------------------------------------------------ *
 * 1. DTMF — one row tone and one column tone, both present at once.
 * ------------------------------------------------------------------ */
const T = (M && M.tables) || {};
const DTMF_ROWS = T.DTMF_ROWS, DTMF_COLS = T.DTMF_COLS, DTMF_KEYS = T.DTMF_KEYS;

class DtmfDecoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    /* 16 ms blocks: long enough that 697 and 770 land in different bins,
     * short enough that four of them fit inside the shortest tone the
     * encoder will produce. */
    this.bank = new ToneBank(rate, DTMF_ROWS.concat(DTMF_COLS), Math.round(rate / 62.5));
    this.run = 0;
    this.last = -1;
    this.sent = -1;
    this.digits = 0;
  }

  feed(x) {
    if (!this.bank.feed(x)) return;
    const mags = this.bank.mags;
    const rows = topTwo(mags.slice(0, 4));
    const cols = topTwo(mags.slice(4, 8));
    const total = this.bank.blockEnergy + 1e-12;
    const ok = rows.firstMag > 0.06 * total && cols.firstMag > 0.06 * total &&
      rows.firstMag > 3 * rows.secondMag && cols.firstMag > 3 * cols.secondMag;
    const key = ok ? rows.first * 4 + cols.first : -1;

    if (key >= 0 && key === this.last) this.run++;
    else { this.run = key >= 0 ? 1 : 0; this.last = key; }

    /* two blocks agreeing before a digit counts, and the tone has to stop
     * before the same digit can be heard again */
    if (this.run === 2 && key !== this.sent) {
      this.sent = key;
      this.digits++;
      this.write(DTMF_KEYS[key]);
      this.locked = true;
      this.measured.row = DTMF_ROWS[rows.first] + ' Hz';
      this.measured.column = DTMF_COLS[cols.first] + ' Hz';
      this.measured.twist = (10 * Math.log10(cols.firstMag / (rows.firstMag + 1e-12))).toFixed(1) + ' dB';
      this.emit('DIGIT', DTMF_KEYS[key]);
    }
    if (key < 0) this.sent = -1;
  }

  finish() { this.notes.push(this.digits + ' digit' + (this.digits === 1 ? '' : 's') + ' decoded.'); }
}

/* ------------------------------------------------------------------ *
 * 2. MF R1 — two of six, plus the 2600 Hz supervisory tone on its own.
 * ------------------------------------------------------------------ */
const MF_FREQS = [700, 900, 1100, 1300, 1500, 1700];

/* The pair table read backwards out of the encoder, so the two cannot drift. */
const MF_BY_PAIR = (() => {
  const map = {};
  for (const k of Object.keys(T.MF_TONES || {})) {
    const [a, b] = T.MF_TONES[k];
    map[Math.min(a, b) + '/' + Math.max(a, b)] = k;
  }
  return map;
})();

class MfDecoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    this.bank = new ToneBank(rate, MF_FREQS.concat([2600]), Math.round(rate / 100));
    this.run = 0;
    this.last = null;
    this.sent = null;
    this.signals = 0;
  }

  feed(x) {
    if (!this.bank.feed(x)) return;
    const mags = this.bank.mags;
    const total = this.bank.blockEnergy + 1e-12;
    const six = topTwo(Array.from(mags).slice(0, 6));
    const superv = mags[6];
    let token = null;

    if (superv > 0.2 * total && superv > 3 * six.firstMag) {
      token = '2600';
    } else if (six.firstMag > 0.06 * total && six.secondMag > 0.06 * total) {
      const a = MF_FREQS[six.first], b = MF_FREQS[six.second];
      token = MF_BY_PAIR[Math.min(a, b) + '/' + Math.max(a, b)] || null;
    }

    if (token && token === this.last) this.run++;
    else { this.run = token ? 1 : 0; this.last = token; }

    if (this.run === 2 && token !== this.sent) {
      this.sent = token;
      this.signals++;
      this.write(this.text && !/[\s]$/.test(this.text) ? ' ' + token : token);
      this.locked = true;
      this.emit('SIGNAL', token);
    }
    if (!token) this.sent = null;
  }

  finish() { this.notes.push(this.signals + ' signal' + (this.signals === 1 ? '' : 's') + ' decoded.'); }
}

/* ------------------------------------------------------------------ *
 * The FSK front end: a quadrature correlator on each tone, integrated over one
 * bit time. The difference of the two magnitudes is the soft decision — above
 * zero is mark, below is space — and its magnitude says how sure it is.
 *
 * The integrator delays the answer by half a bit, but it delays both tones by
 * the same half bit, so every timing measurement below is taken from the
 * detector's own output and the delay cancels.
 * ------------------------------------------------------------------ */
class FskFront {
  constructor(rate, mark, space, baud) {
    this.n = Math.max(4, Math.round(rate / baud));
    this.wm = TAU * mark / rate;
    this.ws = TAU * space / rate;
    this.buf = new Float64Array(this.n * 4);
    this.pos = 0;
    this.sMc = 0; this.sMs = 0; this.sSc = 0; this.sSs = 0;
    this.t = 0;
    this.level = 0;
  }

  run(x) {
    const t = this.t++;
    const mc = x * Math.cos(this.wm * t), ms = x * Math.sin(this.wm * t);
    const sc = x * Math.cos(this.ws * t), ss = x * Math.sin(this.ws * t);
    const p = this.pos * 4;
    this.sMc += mc - this.buf[p];     this.buf[p] = mc;
    this.sMs += ms - this.buf[p + 1]; this.buf[p + 1] = ms;
    this.sSc += sc - this.buf[p + 2]; this.buf[p + 2] = sc;
    this.sSs += ss - this.buf[p + 3]; this.buf[p + 3] = ss;
    this.pos = (this.pos + 1) % this.n;
    const magM = Math.sqrt(this.sMc * this.sMc + this.sMs * this.sMs);
    const magS = Math.sqrt(this.sSc * this.sSc + this.sSs * this.sSs);
    this.level = (magM + magS) / this.n;
    return (magM - magS) / this.n;
  }
}

/* ------------------------------------------------------------------ *
 * Asynchronous framing over a soft stream: idle mark, a space start bit, N
 * data bits least significant first, then a mark stop element.
 *
 * The soft values are buffered because a character cannot be read until the
 * whole of it has arrived; the buffer is trimmed as characters are consumed,
 * so a three-minute recording never holds more than a character or two.
 * ------------------------------------------------------------------ */
class AsyncFramer {
  constructor(samplesPerBit, dataBits, stopLen, onByte) {
    this.sb = samplesPerBit;
    this.dataBits = dataBits;
    this.stopLen = stopLen;
    this.onByte = onByte;
    this.buf = [];
    this.base = 0;          /* absolute index of buf[0] */
    this.at = 0;            /* absolute index we have hunted up to */
    this.sawMark = false;
  }

  get end() { return this.base + this.buf.length; }
  valueAt(i) { return this.buf[i - this.base]; }

  push(soft) {
    this.buf.push(soft);
    this.drain();
  }

  drain() {
    const need = Math.ceil((this.dataBits + 1.5) * this.sb) + 2;
    while (this.at < this.end) {
      const v = this.valueAt(this.at);
      /* an idle mark has to be seen before a falling edge means anything, so
       * noise before the signal starts cannot be read as a start bit */
      if (!this.sawMark) {
        if (v > 0) this.sawMark = true;
        this.at++;
        continue;
      }
      if (v >= 0) { this.at++; continue; }

      const e = this.at;
      if (e + need > this.end) break;      /* wait for the rest of the character */

      const sample = k => this.valueAt(Math.round(e + k * this.sb));
      if (sample(0.5) >= 0) { this.at++; continue; }   /* not a real start bit */

      let byte = 0, bad = false;
      for (let k = 0; k < this.dataBits; k++) {
        const s = sample(k + 1.5);
        if (s == null) { bad = true; break; }
        if (s > 0) byte |= 1 << k;
      }
      const stop = sample(this.dataBits + 1.5);
      if (bad || !(stop > 0)) {
        /* framing error — step past this edge and hunt again rather than
         * trusting a byte the stop bit disagrees with */
        this.at = e + 1;
        this.sawMark = false;
        continue;
      }
      this.onByte(byte, e);
      this.at = Math.round(e + (this.dataBits + this.stopLen + 0.5) * this.sb);
      this.sawMark = false;
    }
    /* release everything the hunt has moved past */
    const keep = Math.max(0, this.at - this.base - 1);
    if (keep > 0 && this.buf.length > need * 4) {
      this.buf.splice(0, keep);
      this.base += keep;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3-6. Bell 202 async, Bell 103, V.21, V.23 and the Kansas City Standard —
 *      the same front end and framer with different numbers.
 * ------------------------------------------------------------------ */
class AsyncFskDecoder extends Decoder {
  constructor(rate, params, opts) {
    super(rate, params);
    const o = opts || {};
    const baud = o.baud || num(params, 'baud', 1200);
    const mark = o.mark || num(params, 'mark', 1200);
    const space = o.space || num(params, 'space', 2200);
    this.dataBits = o.dataBits || 8;
    this.front = new FskFront(rate, mark, space, baud);
    this.dc = new DcBlock(rate);
    this.bytes = 0;
    this.measured.mark = mark + ' Hz';
    this.measured.space = space + ' Hz';
    this.measured.baud = String(baud);
    const stopLen = o.stopLen == null ? num(params, 'stopBits', 1) : o.stopLen;
    this.framer = new AsyncFramer(rate / baud, this.dataBits, stopLen, b => this.byte(b));
  }

  byte(b) {
    this.bytes++;
    this.locked = true;
    this.write(String.fromCharCode(b));
  }

  feed(x) { this.framer.push(this.front.run(this.dc.run(x))); }

  finish() {
    this.notes.push(this.bytes + ' byte' + (this.bytes === 1 ? '' : 's') + ' decoded.');
  }
}

/* ------------------------------------------------------------------ *
 * 7. RTTY — five bits and a shift state.
 * ------------------------------------------------------------------ */
const ITA2_LTRS = T.ITA2_LTRS, ITA2_FIGS = T.ITA2_FIGS;
const RTTY_LTRS_CODE = T.RTTY_LTRS_CODE, RTTY_FIGS_CODE = T.RTTY_FIGS_CODE;

class RttyDecoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    const baud = num(params, 'baud', 45.45);
    const mark = num(params, 'mark', 2125), space = num(params, 'space', 2295);
    this.front = new FskFront(rate, mark, space, baud);
    this.dc = new DcBlock(rate);
    this.figs = false;
    this.chars = 0;
    this.measured.mark = mark + ' Hz';
    this.measured.space = space + ' Hz';
    this.measured.shift = Math.abs(mark - space).toFixed(0) + ' Hz';
    this.framer = new AsyncFramer(rate / baud, 5, num(params, 'stopBits', 1.5), c => this.code(c));
  }

  code(c) {
    this.locked = true;
    if (c === RTTY_LTRS_CODE) { this.figs = false; return; }
    if (c === RTTY_FIGS_CODE) { this.figs = true; return; }
    const ch = (this.figs ? ITA2_FIGS : ITA2_LTRS)[c];
    if (ch == null) return;
    this.chars++;
    this.write(ch);
  }

  feed(x) { this.framer.push(this.front.run(this.dc.run(x))); }
  finish() { this.notes.push(this.chars + ' character' + (this.chars === 1 ? '' : 's') + ' decoded.'); }
}

/* ------------------------------------------------------------------ *
 * 8. AX.25 over Bell 202 — synchronous HDLC, so this one needs a bit clock of
 *    its own rather than a start bit to line up against.
 * ------------------------------------------------------------------ */
function fcsOf(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >> 1) ^ 0x8408) : (crc >> 1);
  }
  crc ^= 0xffff;
  return [crc & 0xff, (crc >> 8) & 0xff];
}

class Ax25Decoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    const baud = num(params, 'baud', 1200);
    const mark = num(params, 'mark', 1200), space = num(params, 'space', 2200);
    this.front = new FskFront(rate, mark, space, baud);
    this.dc = new DcBlock(rate);
    this.inc = baud / rate;
    this.clock = 0;
    this.lastLevel = null;
    this.lastSign = 0;
    this.sr = 0;
    this.ones = 0;
    this.inFrame = false;
    this.cur = 0; this.bitCount = 0;
    this.frame = [];
    this.frames = 0; this.bad = 0;
    this.measured.mark = mark + ' Hz';
    this.measured.space = space + ' Hz';
    this.measured.baud = String(baud);
  }

  feed(x) {
    const soft = this.front.run(this.dc.run(x));
    const sign = soft > 0 ? 1 : -1;

    /* A transition should fall halfway between two sampling instants, so the
     * clock is nudged towards the middle of the eye whenever one arrives.
     * Small steps: a hard reset would chase noise on a weak signal. */
    if (this.lastSign && sign !== this.lastSign) this.clock += (0.5 - this.clock) * 0.18;
    this.lastSign = sign;

    this.clock += this.inc;
    if (this.clock < 1) return;
    this.clock -= 1;

    /* NRZI: no change is a one, a change is a zero */
    const level = sign > 0 ? 1 : 0;
    const bit = this.lastLevel == null ? 1 : (level === this.lastLevel ? 1 : 0);
    this.lastLevel = level;
    this.bit(bit);
  }

  bit(b) {
    this.sr = ((this.sr >> 1) | (b << 7)) & 0xff;
    if (this.sr === 0x7e) {          /* flag: 0 1111 11 0, oldest bit first */
      this.closeFrame();
      this.inFrame = true;
      this.cur = 0; this.bitCount = 0; this.ones = 0; this.frame = [];
      return;
    }
    if (this.ones === 5) {
      this.ones = 0;
      if (b === 0) return;           /* the stuffed zero, dropped */
      /* Six ones. In a well-formed stream this is the middle of a flag, which
       * the check above catches two bits later — so the bit is dropped and the
       * frame left open. A genuine abort (seven or more) simply produces a
       * frame whose check sequence fails, which is reported as such. */
      return;
    }
    this.ones = b ? this.ones + 1 : 0;
    if (!this.inFrame) return;
    if (b) this.cur |= 1 << this.bitCount;
    if (++this.bitCount === 8) {
      this.frame.push(this.cur);
      this.cur = 0; this.bitCount = 0;
      if (this.frame.length > 512) this.inFrame = false;   /* runaway */
    }
  }

  closeFrame() {
    const f = this.frame;
    this.frame = [];
    if (!this.inFrame || f.length < 17) return;
    const body = f.slice(0, f.length - 2);
    const want = fcsOf(body);
    const ok = want[0] === f[f.length - 2] && want[1] === f[f.length - 1];
    this.frames++;
    if (!ok) {
      this.bad++;
      this.emit('FRAME', 'frame check sequence failed — ' + f.length + ' bytes', false);
      return;
    }
    this.locked = true;

    /* addresses run until one has the end-of-address bit set */
    const addrs = [];
    let i = 0;
    for (; i + 6 < body.length && addrs.length < 10; i += 7) {
      let call = '';
      for (let k = 0; k < 6; k++) call += String.fromCharCode((body[i + k] >> 1) & 0x7f);
      const ssid = (body[i + 6] >> 1) & 0x0f;
      addrs.push(call.trim() + (ssid ? '-' + ssid : ''));
      if (body[i + 6] & 1) { i += 7; break; }
    }
    const payload = body.slice(i + 2)                 /* past control and PID */
      .map(b => String.fromCharCode(b)).join('');
    const route = addrs.length > 1
      ? addrs[1] + '>' + addrs[0] + (addrs.length > 2 ? ',' + addrs.slice(2).join(',') : '')
      : addrs.join(',');
    this.measured.frames = String(this.frames);
    this.write((this.text ? '\n' : '') + payload);
    this.emit('FRAME', route + '  ' + payload, true);
  }

  finish() {
    this.closeFrame();
    this.notes.push(this.frames + ' frame' + (this.frames === 1 ? '' : 's') + ' seen' +
      (this.bad ? ', ' + this.bad + ' with a bad checksum.' : ', all checksums good.'));
  }
}

/* ------------------------------------------------------------------ *
 * 9. Morse — the envelope of a keyed tone, timed against the dot length.
 * ------------------------------------------------------------------ */
const MORSE_BY_CODE = (() => {
  const map = {};
  const src = T.MORSE || {};
  for (const k of Object.keys(src)) map[src[k]] = k;
  return map;
})();

class MorseDecoder extends Decoder {
  constructor(rate, params, opts) {
    super(rate, params);
    const o = opts || {};
    const wpm = Math.max(3, num(params, 'wpm', 18));
    const farns = num(params, 'farnsworth', 0);
    const eff = Math.max(3, Math.min(wpm, farns || wpm));
    this.freq = o.freq || num(params, 'tone', 700);
    this.dit = 1.2 / wpm * rate;
    this.gap = 1.2 / eff * rate;

    /* a one-pole magnitude envelope at the keying tone, smoothed over about a
     * third of a dot — long enough to ignore the carrier, short enough to keep
     * the edges of the shortest element */
    this.w = TAU * this.freq / rate;
    this.t = 0;
    this.ai = 0; this.aq = 0;
    this.k = Math.exp(-1 / Math.max(2, this.dit / 3));
    this.env = 0;
    this.ref = 0;
    this.floor = 1e9;
    this.delay = new Float64Array(Math.max(1, Math.round(this.dit / 2)));
    this.dpos = 0;
    this.on = false;
    this.since = 0;
    this.pend = 0;
    this.minRun = Math.max(2, Math.round(this.dit / 4));
    this.code = '';
    this.letters = 0;
    this.measured.tone = this.freq + ' Hz';
    this.measured.speed = wpm.toFixed(0) + ' wpm';
  }

  feed(x) {
    const t = this.t++;
    const i = x * Math.cos(this.w * t), q = x * Math.sin(this.w * t);
    this.ai = this.ai * this.k + i * (1 - this.k);
    this.aq = this.aq * this.k + q * (1 - this.k);
    let mag = Math.sqrt(this.ai * this.ai + this.aq * this.aq);
    this.env = mag;
    /* Two followers: a peak that tracks the loudest recent keying and decays,
     * and a floor that tracks the quietest — which between elements is the
     * noise. Keying is only believed when the two are well apart, so hiss
     * before the first dot cannot be read as the start of it: with a single
     * threshold the reference starts out equal to the noise and everything
     * above it looks like a signal, which turned "LOW" into "ZOW". */
    if (mag > this.ref) this.ref = mag; else this.ref *= 0.99995;
    /* The floor falls at once and only creeps up between elements. Letting it
     * rise during a mark as well drags it up towards the tone over a long
     * dash, and the gate below then cuts the dash into pieces. */
    if (mag < this.floor) this.floor = mag;
    else if (!this.on) this.floor += (mag - this.floor) * 0.00002;

    /* The threshold is given half a dot of lookahead: the peak and floor above
     * are taken from the current sample, but the decision below is made on one
     * from half a dot ago. Without it the hiss just before an element is judged
     * against a reference that has only ever seen hiss, so the squelch opens
     * early and the element measures long — a dot arriving as a dash, which is
     * how "LOW" came back as "ZOW". Every element is delayed by the same half
     * dot, and only their relative lengths are ever used. */
    const cur = mag;
    mag = this.delay[this.dpos];
    this.delay[this.dpos] = cur;
    this.dpos = (this.dpos + 1) % this.delay.length;

    /* A Schmitt trigger rather than one threshold, and a transition has to
     * hold for a quarter of a dot before it is believed. Without both, an
     * envelope sitting near the threshold in the middle of a dash produces a
     * pair of zero-length runs, and a zero-length run reads as an extra dot —
     * which is how "SOS" came back as "SOH". */
    const gate = Math.max(this.floor * 3, this.ref * (this.on ? 0.35 : 0.55));
    const raw = this.ref > this.floor * 6 && mag > gate;
    this.since++;

    if (raw === this.on) { this.pend = 0; return; }
    if (++this.pend < this.minRun) return;
    this.mark(this.on, this.since - this.pend);
    this.on = raw;
    this.since = this.pend;
    this.pend = 0;
  }

  mark(wasOn, len) {
    if (!len) return;
    if (wasOn) {
      this.code += len > this.dit * 2 ? '-' : '.';
      this.locked = true;
    } else if (this.code) {
      if (len > this.gap * 5) { this.letter(); this.write(' '); }
      else if (len > this.gap * 2) this.letter();
    }
  }

  letter() {
    if (!this.code) return;
    const ch = MORSE_BY_CODE[this.code];
    if (ch) { this.write(ch); this.letters++; this.emit('LETTER', ch); }
    else this.emit('LETTER', '<' + this.code + '>', false);
    this.code = '';
  }

  finish() {
    this.mark(this.on, this.since);
    this.letter();
    this.notes.push(this.letters + ' character' + (this.letters === 1 ? '' : 's') + ' decoded.');
  }
}

/* ------------------------------------------------------------------ *
 * The edge-timing front end: intervals between zero crossings, in samples.
 * The tape formats and SMPTE timecode are all specified this way round.
 * ------------------------------------------------------------------ */
class EdgeTimer {
  constructor(rate, onInterval) {
    this.dc = new DcBlock(rate);
    this.onInterval = onInterval;
    this.sign = 0;
    this.since = 0;
    this.gate = 0;
  }

  feed(x) {
    const v = this.dc.run(x);
    const a = v < 0 ? -v : v;
    if (a > this.gate) this.gate = a;
    else this.gate *= 0.99995;
    this.since++;
    /* a little hysteresis, so a noisy zero crossing is one edge and not five */
    const hyst = this.gate * 0.25;
    const s = v > hyst ? 1 : v < -hyst ? -1 : 0;
    if (!s || s === this.sign) return;
    if (this.sign !== 0) this.onInterval(this.since);
    this.sign = s;
    this.since = 0;
  }
}

/* ------------------------------------------------------------------ *
 * 10. SMPTE linear timecode — biphase mark: an edge every bit, and a second
 *     edge in the middle of a one.
 * ------------------------------------------------------------------ */
const LTC_FPS = T.LTC_FPS;
const LTC_SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

class LtcDecoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    const sel = LTC_FPS[String(params.fps || 25)] || LTC_FPS[25];
    this.fps = sel[0];
    this.drop = sel[1];
    const fRate = this.drop ? 30000 / 1001 : this.fps;
    this.bitLen = rate / (fRate * 80);
    this.half = null;
    this.bits = [];
    this.frames = 0;
    this.measured.rate = (this.drop ? '29.97 drop-frame' : this.fps + ' fps');
    this.timer = new EdgeTimer(rate, iv => this.interval(iv));
  }

  interval(iv) {
    if (iv > this.bitLen * 0.75) { this.half = null; this.bit(0); return; }
    if (this.half == null) { this.half = iv; return; }
    this.half = null;
    this.bit(1);
  }

  bit(b) {
    this.bits.push(b);
    if (this.bits.length > 80) this.bits.shift();
    if (this.bits.length < 80) return;
    for (let i = 0; i < 16; i++) if (this.bits[64 + i] !== LTC_SYNC[i]) return;
    this.frame(this.bits);
    this.bits = [];
  }

  frame(bits) {
    const get = (at, count) => { let v = 0; for (let i = 0; i < count; i++) v |= bits[at + i] << i; return v; };
    const f = get(0, 4) + 10 * get(8, 2);
    const s = get(16, 4) + 10 * get(24, 3);
    const m = get(32, 4) + 10 * get(40, 3);
    const h = get(48, 4) + 10 * get(56, 2);
    const pad = n => String(n).padStart(2, '0');
    const tc = pad(h) + ':' + pad(m) + ':' + pad(s) + (bits[10] ? ';' : ':') + pad(f);
    this.frames++;
    this.locked = true;
    this.measured.timecode = tc;
    /* one line per frame would be 25 lines a second — the log carries every
     * frame, the text carries the first and the last */
    this.emit('FRAME', tc);
    if (this.frames === 1) this.first = tc;
    this.last = tc;
  }

  feed(x) { this.timer.feed(x); }

  finish() {
    if (this.frames) this.write(this.first + ' → ' + this.last);
    this.notes.push(this.frames + ' frame' + (this.frames === 1 ? '' : 's') +
      ' at ' + this.measured.rate + '.');
  }
}

/* ------------------------------------------------------------------ *
 * 11. ZX Spectrum tape — pulse-width keyed in Z80 T-states.
 * ------------------------------------------------------------------ */
const ZX_T = T.ZX_T, ZX_PILOT = T.ZX_PILOT, ZX_ZERO = T.ZX_ZERO, ZX_ONE = T.ZX_ONE;

class ZxDecoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    this.zero = ZX_ZERO * ZX_T * rate;
    this.one = ZX_ONE * ZX_T * rate;
    this.pilot = ZX_PILOT * ZX_T * rate;
    this.midZeroOne = (this.zero + this.one) / 2;
    this.midOnePilot = (this.one + this.pilot) / 2;
    this.state = 'pilot';
    this.pilots = 0;
    this.syncs = 0;
    this.pending = null;
    this.bits = [];
    this.blocks = 0;
    this.timer = new EdgeTimer(rate, iv => this.interval(iv));
  }

  interval(iv) {
    if (this.state === 'pilot') {
      if (iv > this.midOnePilot) { this.pilots++; return; }
      /* the first short pulse after a run of pilot is the first sync pulse */
      if (this.pilots > 200) { this.state = 'sync'; this.syncs = 1; }
      else this.pilots = 0;
      return;
    }
    if (this.state === 'sync') {
      if (++this.syncs >= 2) { this.state = 'data'; this.bits = []; this.pending = null; }
      return;
    }
    /* data: two equal pulses a bit, and a pilot-length pulse means the block
     * has ended and the next one is starting */
    if (iv > this.midOnePilot) { this.block(); this.state = 'pilot'; this.pilots = 1; return; }
    const b = iv > this.midZeroOne ? 1 : 0;
    if (this.pending == null) { this.pending = b; return; }
    this.bits.push(this.pending === 1 && b === 1 ? 1 : 0);
    this.pending = null;
  }

  block() {
    /* The last pulse of a block has no edge after it to be measured against —
     * the tape simply goes quiet — so the final half of the final bit never
     * arrives as an interval. Both pulses of a bit are the same length by
     * construction, so the dangling one completes it. */
    if (this.pending != null) { this.bits.push(this.pending); this.pending = null; }
    const bits = this.bits;
    this.bits = [];
    if (bits.length < 24) return;
    const bytes = [];
    for (let i = 0; i + 7 < bits.length; i += 8) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];   /* most significant first */
      bytes.push(v);
    }
    if (bytes.length < 3) return;
    let sum = 0;
    for (let i = 0; i < bytes.length - 1; i++) sum ^= bytes[i];
    const ok = sum === bytes[bytes.length - 1];
    const flag = bytes[0];
    const body = bytes.slice(1, bytes.length - 1);
    this.blocks++;
    this.locked = true;

    if (flag === 0x00 && body.length >= 17) {
      const name = body.slice(1, 11).map(b => String.fromCharCode(b)).join('').trim();
      const len = body[11] | (body[12] << 8);
      const addr = body[13] | (body[14] << 8);
      this.emit('HEADER', '"' + name + '" ' + len + ' bytes at ' + addr, ok);
      this.measured.file = name;
      this.measured.address = String(addr);
    } else {
      this.write(body.map(b => String.fromCharCode(b)).join(''));
      this.emit('DATA', body.length + ' bytes, checksum ' + (ok ? 'ok' : 'bad'), ok);
    }
  }

  feed(x) { this.timer.feed(x); }

  finish() {
    if (this.state === 'data') this.block();
    this.notes.push(this.blocks + ' block' + (this.blocks === 1 ? '' : 's') + ' read.');
  }
}

/* ------------------------------------------------------------------ *
 * 12. Commodore 64 tape — three pulse lengths, read in pairs.
 * ------------------------------------------------------------------ */

class C64Decoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    /* each pulse is written as two half-length runs, so the edge intervals
     * are half the pulse lengths the format is specified in */
    this.short = T.C64_SHORT * rate / 2;
    this.med = T.C64_MED * rate / 2;
    this.long = T.C64_LONG * rate / 2;
    this.aSM = (this.short + this.med) / 2;
    this.aML = (this.med + this.long) / 2;
    this.half = null;
    this.pulses = [];
    this.bytes = [];
    this.collect = [];
    this.collecting = false;
    this.nextCount = 9;
    this.xor = 0;
    this.state = 'idle';
    this.blocks = 0;
    this.timer = new EdgeTimer(rate, iv => this.interval(iv));
  }

  interval(iv) {
    const kind = iv > this.aML ? 'L' : iv > this.aSM ? 'M' : 'S';
    /* two equal halves make one pulse */
    if (this.half == null) { this.half = kind; return; }
    const pulse = this.half;
    this.half = null;
    this.pulse(pulse);
  }

  pulse(k) {
    this.pulses.push(k);
    if (this.pulses.length > 24) this.pulses.shift();
    if (this.state === 'idle') {
      const n = this.pulses.length;
      if (n >= 2 && this.pulses[n - 2] === 'L' && this.pulses[n - 1] === 'M') {
        this.state = 'byte';
        this.pairs = [];
      }
      return;
    }
    this.pairs.push(k);
    if (this.pairs.length < 18) return;              /* 8 data bits + parity */
    let v = 0, ones = 0, bad = false;
    for (let i = 0; i < 8; i++) {
      const a = this.pairs[i * 2], b = this.pairs[i * 2 + 1];
      if (a === 'M' && b === 'S') { v |= 1 << i; ones++; }
      else if (!(a === 'S' && b === 'M')) bad = true;
    }
    const pa = this.pairs[16], pb = this.pairs[17];
    const parity = pa === 'M' && pb === 'S' ? 1 : 0;
    if (!bad && ((ones % 2) ? 0 : 1) === parity) this.byte(v);
    this.state = 'idle';
    this.pulses = [];
  }

  /* Each copy of the block is introduced by the KERNAL's countdown — $89…$81
   * before the first pass and $09…$01 before the second — and ends when the
   * running XOR closes on the checksum byte. Following the countdown rather
   * than guessing at the checksum is what keeps a tab or a control character
   * in the data from being mistaken for framing. */
  byte(b) {
    const low = b & 0x7f;
    if (!this.collecting) {
      if (low === this.nextCount) {
        if (--this.nextCount === 0) {
          this.collecting = true;
          this.collect = [];
          this.xor = 0;
          this.nextCount = 9;
        }
      } else {
        this.nextCount = low === 9 ? 8 : 9;
      }
      return;
    }
    this.collect.push(b);
    this.xor ^= b;
    if (this.collect.length >= 2 && this.xor === 0) {
      this.collecting = false;
      this.nextCount = 9;
      /* the block is written twice; the first good copy is the answer */
      if (!this.bytes.length) this.bytes = this.collect.slice(0, -1);
      this.blocks++;
    }
  }

  feed(x) { this.timer.feed(x); }

  finish() {
    if (this.bytes.length) {
      this.locked = true;
      this.write(this.bytes.map(c => String.fromCharCode(c)).join(''));
      this.emit('BLOCK', this.bytes.length + ' bytes, XOR checksum verified');
    }
    this.notes.push(this.blocks
      ? this.blocks + ' cop' + (this.blocks === 1 ? 'y' : 'ies') + ' of the block read, checksum verified.'
      : 'No complete block found.');
  }
}

/* ------------------------------------------------------------------ *
 * 13. PSK31 — differential BPSK and a variable-length alphabet.
 * ------------------------------------------------------------------ */
const PSK_BY_CODE = (() => {
  const map = {};
  const table = T.PSK_VARICODE || null;
  if (table) for (let i = 0; i < table.length; i++) map[table[i]] = i;
  return map;
})();

class Psk31Decoder extends Decoder {
  constructor(rate, params) {
    super(rate, params);
    const baud = num(params, 'baud', 31.25);
    this.carrier = num(params, 'carrier', 1000);
    this.sps = rate / baud;
    this.w = TAU * this.carrier / rate;
    this.t = 0;

    /* A matched filter one symbol long, as running sums over a ring. The
     * length is `taps` rather than `n` because the base class counts samples
     * seen in `this.n`, and a filter that quietly grew by one every sample was
     * a long afternoon. */
    this.taps = Math.max(4, Math.round(this.sps));
    this.bufI = new Float64Array(this.taps);
    this.bufQ = new Float64Array(this.taps);
    this.pos = 0; this.sumI = 0; this.sumQ = 0;

    /* Acquisition: the idle preamble is a solid run of phase reversals, and
     * the envelope dips to nothing at every one of them, so the sampling
     * instant is simply the offset whose energy is highest. It is measured
     * once over the first couple of seconds and then held. */
    this.acqNeed = Math.ceil(this.sps * 40);
    this.acq = new Float64Array(Math.ceil(this.sps));
    this.acqCount = 0;
    this.offset = -1;
    this.since = 0;
    this.prevI = 0; this.prevQ = 0;
    this.havePrev = false;
    this.bits = '';
    this.chars = 0;
    this.measured.carrier = this.carrier + ' Hz';
    this.measured.baud = String(baud);
  }

  feed(x) {
    const t = this.t++;
    const i = x * Math.cos(this.w * t), q = -x * Math.sin(this.w * t);
    this.sumI += i - this.bufI[this.pos]; this.bufI[this.pos] = i;
    this.sumQ += q - this.bufQ[this.pos]; this.bufQ[this.pos] = q;
    this.pos = (this.pos + 1) % this.taps;
    const mag = this.sumI * this.sumI + this.sumQ * this.sumQ;

    if (this.offset < 0) {
      const slot = t % this.acq.length;
      this.acq[slot] += mag;
      if (++this.acqCount < this.acqNeed) return;
      let best = 0;
      for (let k = 1; k < this.acq.length; k++) if (this.acq[k] > this.acq[best]) best = k;
      this.offset = best;
      this.since = ((t - best) % this.sps + this.sps) % this.sps;
      this.measured.offset = 'locked';
      return;
    }

    if (++this.since < this.sps) return;
    this.since -= this.sps;
    this.symbol(this.sumI, this.sumQ);
  }

  symbol(i, q) {
    if (this.havePrev) {
      /* differential: the real part of z·conj(z') is positive when the phase
       * did not move, which is a one, and negative on a reversal, a zero */
      const dot = i * this.prevI + q * this.prevQ;
      this.bit(dot > 0 ? 1 : 0);
    }
    this.prevI = i; this.prevQ = q;
    this.havePrev = true;
  }

  bit(b) {
    this.bits += b ? '1' : '0';
    if (!this.bits.endsWith('00')) {
      if (this.bits.length > 24) this.bits = this.bits.slice(-24);
      return;
    }
    /* Every varicode starts with a one, so any zeros in front of this one are
     * the tail of the idle run. Stripping them matters because decoding starts
     * partway through that run, and whether an odd or an even number of idle
     * zeros has gone by is pure chance — without this the first character
     * after the preamble is lost about half the time. */
    const code = this.bits.slice(0, -2).replace(/^0+/, '');
    this.bits = '';
    if (!code) return;                 /* the idle run between overs */
    const c = PSK_BY_CODE[code];
    if (c == null) { this.emit('CHAR', '<' + code + '>', false); return; }
    this.locked = true;
    this.chars++;
    this.write(String.fromCharCode(c));
  }

  finish() { this.notes.push(this.chars + ' character' + (this.chars === 1 ? '' : 's') + ' decoded.'); }
}

/* ------------------------------------------------------------------ *
 * The catalogue: which decoder reads which protocol back.
 * ------------------------------------------------------------------ */
const BUILDERS = {
  dtmf: (rate, p) => new DtmfDecoder(rate, p),
  mf: (rate, p) => new MfDecoder(rate, p),
  bell202: (rate, p) => (p.framing === 'ax25'
    ? new Ax25Decoder(rate, p)
    : new AsyncFskDecoder(rate, p)),
  bell103: (rate, p) => new AsyncFskDecoder(rate, p),
  v21: (rate, p) => new AsyncFskDecoder(rate, p),
  v23: (rate, p) => new AsyncFskDecoder(rate, p),
  rtty: (rate, p) => new RttyDecoder(rate, p),
  morse: (rate, p) => new MorseDecoder(rate, p),
  kcs: (rate, p) => new AsyncFskDecoder(rate, p, {
    /* a one is a run of 2400 Hz and a zero the same time at 1200 Hz */
    mark: 2400, space: 1200, baud: num(p, 'baud', 300), stopLen: num(p, 'stopBits', 2)
  }),
  ltc: (rate, p) => new LtcDecoder(rate, p),
  zx: (rate, p) => new ZxDecoder(rate, p),
  c64: (rate, p) => new C64Decoder(rate, p),
  psk31: (rate, p) => new Psk31Decoder(rate, p)
};

function supports(id) { return Object.prototype.hasOwnProperty.call(BUILDERS, id); }

function create(id, params, rate) {
  const proto = M && M.get ? M.get(id) : null;
  if (!supports(id)) throw new Error('No decoder for ' + id + ' yet.');
  const p = proto && M.resolve ? M.resolve(proto, Object.assign(M.defaults(proto), params || {})) : (params || {});
  return BUILDERS[id](rate || (M && M.RATE) || 48000, p);
}

function decode(id, samples, rate, params) {
  const d = create(id, params, rate);
  /* pushed in blocks rather than in one go, so the offline path exercises the
   * same block boundaries the microphone will */
  const step = 8192;
  for (let i = 0; i < samples.length; i += step) d.push(samples.subarray(i, Math.min(samples.length, i + step)));
  return d.flush();
}

global.ClackModemDecode = {
  supports: supports,
  create: create,
  decode: decode,
  /* the ids this build can read back, in catalogue order */
  get ids() { return (M ? M.PROTOCOLS : []).map(p => p.id).filter(supports); }
};

})(window);
