/* MIDI messages in words — shared by the apps that show MIDI traffic.
 *
 * ClackTerm reads MIDI as bytes off a UART (DIN MIDI at 31250 baud) and
 * MIDIterm reads it off a MIDI port, so the same vocabulary and the same
 * running-status parser serve both:
 *
 *   ClackMIDI.describe(bytes)   → { text, kind, channel, cls }
 *   ClackMIDI.splitter()        → feed(bytes) → [Uint8Array, …]
 *
 * The splitter keeps its state between calls, so a message split across two
 * reads — or a channel running its status on from the message before — still
 * comes out whole.
 */
(() => {
  const hex2 = byte => byte.toString(16).toUpperCase().padStart(2, '0');
  const hexOf = bytes => Array.from(bytes, hex2).join(' ');

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = note => NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);

  const CC_NAMES = {
    0: 'bank select MSB', 1: 'modulation', 2: 'breath', 4: 'foot', 5: 'portamento time',
    6: 'data entry MSB', 7: 'volume', 8: 'balance', 10: 'pan', 11: 'expression',
    12: 'effect 1', 13: 'effect 2', 32: 'bank select LSB', 38: 'data entry LSB',
    64: 'sustain', 65: 'portamento', 66: 'sostenuto', 67: 'soft', 68: 'legato',
    69: 'hold 2', 70: 'sound variation', 71: 'resonance', 72: 'release', 73: 'attack',
    74: 'cutoff', 75: 'decay', 76: 'vibrato rate', 77: 'vibrato depth', 78: 'vibrato delay',
    84: 'portamento control', 91: 'reverb', 92: 'tremolo', 93: 'chorus', 94: 'detune',
    95: 'phaser', 96: 'data increment', 97: 'data decrement',
    98: 'NRPN LSB', 99: 'NRPN MSB', 100: 'RPN LSB', 101: 'RPN MSB',
    120: 'all sound off', 121: 'reset controllers', 122: 'local control',
    123: 'all notes off', 124: 'omni off', 125: 'omni on', 126: 'mono on', 127: 'poly on'
  };

  const REALTIME = {
    0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop',
    0xfe: 'active sensing', 0xff: 'system reset'
  };

  /* enough of the registry to name what turns up on a bench */
  const MAKERS = {
    '01': 'Sequential', '04': 'Moog', '06': 'Lexicon', '07': 'Kurzweil', '0F': 'Ensoniq',
    '10': 'Oberheim', '18': 'E-mu', '1A': 'ART', '3E': 'Waldorf', '40': 'Kawai',
    '41': 'Roland', '42': 'Korg', '43': 'Yamaha', '44': 'Casio', '47': 'Akai',
    '52': 'Zoom', '7D': 'non-commercial', '7E': 'universal non-realtime', '7F': 'universal realtime'
  };
  const THREE_BYTE = {
    '00 20 29': 'Focusrite / Novation', '00 21 1D': 'Ableton', '00 01 61': 'Arturia',
    '00 02 0C': 'Elektron', '00 21 27': 'Teenage Engineering', '00 01 3F': 'Behringer'
  };

  const UNIVERSAL = {
    '06 01': 'identity request', '06 02': 'identity reply', '08 01': 'bulk tuning dump request',
    '09 01': 'GM system on', '09 02': 'GM system off', '7B': 'end of file'
  };

  /* how many data bytes a status byte is waiting for */
  function wants(status) {
    if (status >= 0xf4) return 0;
    if (status === 0xf1 || status === 0xf3) return 1;
    if (status === 0xf2) return 2;
    const type = status & 0xf0;
    return type === 0xc0 || type === 0xd0 ? 1 : 2;
  }

  function sysexDetail(bytes) {
    const id = hex2(bytes[1] ?? 0);
    if (id === '00') {
      const three = `${hex2(bytes[1] ?? 0)} ${hex2(bytes[2] ?? 0)} ${hex2(bytes[3] ?? 0)}`;
      return THREE_BYTE[three] || `manufacturer ${three}`;
    }
    const maker = MAKERS[id] || `manufacturer 0x${id}`;
    if (id === '7E' || id === '7F') {
      const sub = `${hex2(bytes[3] ?? 0)} ${hex2(bytes[4] ?? 0)}`;
      const named = UNIVERSAL[sub];
      return named ? `${maker} · ${named}` : maker;
    }
    return maker;
  }

  /* One complete message in words. `kind` is what the filters switch on. */
  function describe(bytes) {
    const status = bytes[0];
    if (status === undefined) return { text: '(empty)', kind: 'other', cls: 'bad' };
    if (status >= 0xf8) {
      const name = REALTIME[status] || `system 0x${hex2(status)}`;
      return { text: name, kind: status === 0xf8 ? 'clock' : status === 0xfe ? 'sensing' : 'realtime', cls: 'note' };
    }
    if (status === 0xf0) {
      const tail = bytes.length > 12 ? ' …' : '';
      return {
        text: `SysEx · ${sysexDetail(bytes)} · ${bytes.length} bytes · ${hexOf(Array.from(bytes).slice(0, 12))}${tail}`,
        kind: 'sysex', cls: 'note'
      };
    }
    if (status === 0xf1) {
      const value = bytes[1] ?? 0;
      return { text: `MTC quarter frame · piece ${value >> 4} · ${value & 0x0f}`, kind: 'common', cls: 'note' };
    }
    if (status === 0xf2) {
      const beats = ((bytes[2] ?? 0) << 7) | (bytes[1] ?? 0);
      return { text: `song position ${beats} beats (bar ${Math.floor(beats / 16) + 1})`, kind: 'common', cls: 'note' };
    }
    if (status === 0xf3) return { text: `song select ${bytes[1] ?? 0}`, kind: 'common', cls: 'note' };
    if (status === 0xf6) return { text: 'tune request', kind: 'common', cls: 'note' };
    if (status === 0xf7) return { text: 'end of SysEx', kind: 'sysex', cls: 'note' };

    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const at = `ch${String(channel).padStart(2, ' ')}`;
    const a = bytes[1] ?? 0;
    const b = bytes[2] ?? 0;
    switch (type) {
      case 0x80:
        return { text: `${at}  note off   ${noteName(a).padEnd(4)} (${a})  vel ${b}`, kind: 'note-off', channel, note: a, value: b };
      case 0x90:
        return b === 0
          ? { text: `${at}  note off   ${noteName(a).padEnd(4)} (${a})  vel 0`, kind: 'note-off', channel, note: a, value: 0 }
          : { text: `${at}  note on    ${noteName(a).padEnd(4)} (${a})  vel ${b}`, kind: 'note-on', channel, note: a, value: b };
      case 0xa0:
        return { text: `${at}  aftertouch ${noteName(a).padEnd(4)} (${a})  ${b}`, kind: 'aftertouch', channel, note: a, value: b };
      case 0xb0:
        return {
          text: `${at}  control    ${String(a).padStart(3)}${CC_NAMES[a] ? ' ' + CC_NAMES[a] : ''} = ${b}`,
          kind: a >= 120 ? 'mode' : 'cc', channel, controller: a, value: b
        };
      case 0xc0:
        return { text: `${at}  program    ${a}`, kind: 'program', channel, value: a };
      case 0xd0:
        return { text: `${at}  channel pressure ${a}`, kind: 'aftertouch', channel, value: a };
      case 0xe0: {
        const bend = ((b << 7) | a) - 8192;
        return { text: `${at}  pitch bend ${bend > 0 ? '+' : ''}${bend}`, kind: 'bend', channel, value: bend };
      }
      default:
        return { text: `0x${hex2(status)} ${hexOf(Array.from(bytes).slice(1))}`, kind: 'other', cls: 'bad' };
    }
  }

  /* A byte stream in, whole messages out: running status, interleaved realtime
   * bytes and SysEx of any length all handled. */
  function splitter() {
    let message = [];
    let status = 0;
    let sysex = null;
    return function feed(bytes) {
      const out = [];
      for (const byte of bytes) {
        if (byte >= 0xf8) { out.push(Uint8Array.of(byte)); continue; }   /* realtime cuts in anywhere */
        if (sysex) {
          sysex.push(byte);
          if (byte === 0xf7) { out.push(Uint8Array.from(sysex)); sysex = null; }
          else if (sysex.length > 65536) sysex = null;                   /* runaway dump */
          continue;
        }
        if (byte === 0xf0) { sysex = [byte]; message = []; continue; }
        if (byte & 0x80) {
          status = byte < 0xf0 ? byte : 0;                               /* system messages clear it */
          message = [byte];
          if (wants(byte) === 0) { out.push(Uint8Array.from(message)); message = []; }
          continue;
        }
        if (!message.length) {
          if (!status) continue;                                         /* data with nothing to belong to */
          message = [status];
        }
        message.push(byte);
        if (message.length > wants(message[0])) { out.push(Uint8Array.from(message)); message = []; }
      }
      return out;
    };
  }

  /* Bytes for the messages the send panels build. */
  const build = {
    noteOn: (channel, note, velocity) => Uint8Array.of(0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f),
    noteOff: (channel, note) => Uint8Array.of(0x80 | (channel & 0x0f), note & 0x7f, 0),
    control: (channel, controller, value) => Uint8Array.of(0xb0 | (channel & 0x0f), controller & 0x7f, value & 0x7f),
    program: (channel, program) => Uint8Array.of(0xc0 | (channel & 0x0f), program & 0x7f),
    bend: (channel, bend) => {
      const value = Math.max(0, Math.min(16383, bend + 8192));
      return Uint8Array.of(0xe0 | (channel & 0x0f), value & 0x7f, value >> 7);
    },
    identityRequest: () => Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7)
  };

  window.ClackMIDI = { describe, splitter, wants, build, noteName, NOTE_NAMES, CC_NAMES, REALTIME };
})();
