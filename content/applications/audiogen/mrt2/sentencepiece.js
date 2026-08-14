/*
 * A SentencePiece Unigram tokenizer, enough of one for MusicCoCa.
 *
 * MusicCoCa's text tower is the one model in audioGen that does not arrive
 * with a Hugging Face tokenizer.json — it ships Google's original `spm.model`
 * protobuf instead, which nothing in the vendored runtime can read. This
 * parses that file directly (the pieces, and the normaliser flags that decide
 * how text is prepared) and runs the Viterbi segmentation SentencePiece
 * describes: the piece sequence with the best total score, with any character
 * the vocabulary does not cover falling back to its UTF-8 bytes.
 *
 * Verified piece-for-piece against Google's `sentencepiece` Python package
 * across prompt-shaped text; see scripts/check_musiccoca_tokenizer.py.
 */

const WHITESPACE = '▁';

function readVarint(bytes, offset) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[offset];
    offset += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, offset];
    shift += 7;
  }
}

/* Walks the top level of the protobuf, keeping the repeated `pieces` field and
 * the normaliser flags, and stepping over everything else — the precompiled
 * character map among it, which is 233 KB of NFKC table this tokenizer does
 * not need for prompt text. */
function parseModel(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const pieces = [];
  let addDummyPrefix = true;
  let removeExtraWhitespaces = true;
  let offset = 0;

  const skip = (wire, at) => {
    if (wire === 0) return readVarint(bytes, at)[1];
    if (wire === 5) return at + 4;
    if (wire === 1) return at + 8;
    const [length, next] = readVarint(bytes, at);
    return next + length;
  };

  while (offset < bytes.length) {
    const [key, afterKey] = readVarint(bytes, offset);
    const field = key >> 3;
    const wire = key & 7;
    if (wire !== 2) { offset = skip(wire, afterKey); continue; }

    const [length, afterLength] = readVarint(bytes, afterKey);
    const end = afterLength + length;

    if (field === 1) {
      /* SentencePiece { 1: piece, 2: score, 3: type } */
      let inner = afterLength;
      let piece = '';
      let score = 0;
      let type = 1;
      while (inner < end) {
        const [innerKey, afterInnerKey] = readVarint(bytes, inner);
        const innerField = innerKey >> 3;
        const innerWire = innerKey & 7;
        if (innerWire === 2) {
          const [innerLength, afterInnerLength] = readVarint(bytes, afterInnerKey);
          if (innerField === 1) {
            piece = new TextDecoder().decode(bytes.subarray(afterInnerLength, afterInnerLength + innerLength));
          }
          inner = afterInnerLength + innerLength;
        } else if (innerWire === 5) {
          if (innerField === 2) score = view.getFloat32(afterInnerKey, true);
          inner = afterInnerKey + 4;
        } else if (innerWire === 0) {
          const [value, afterValue] = readVarint(bytes, afterInnerKey);
          if (innerField === 3) type = value;
          inner = afterValue;
        } else {
          inner = skip(innerWire, afterInnerKey);
        }
      }
      pieces.push({ piece, score, type });
    } else if (field === 3) {
      /* NormalizerSpec { 3: add_dummy_prefix, 4: remove_extra_whitespaces } */
      let inner = afterLength;
      while (inner < end) {
        const [innerKey, afterInnerKey] = readVarint(bytes, inner);
        const innerField = innerKey >> 3;
        const innerWire = innerKey & 7;
        if (innerWire === 0) {
          const [value, afterValue] = readVarint(bytes, afterInnerKey);
          if (innerField === 3) addDummyPrefix = Boolean(value);
          if (innerField === 4) removeExtraWhitespaces = Boolean(value);
          inner = afterValue;
        } else {
          inner = skip(innerWire, afterInnerKey);
        }
      }
    }
    offset = end;
  }
  return { pieces, addDummyPrefix, removeExtraWhitespaces };
}

export function loadSentencePiece(buffer) {
  const { pieces, addDummyPrefix, removeExtraWhitespaces } = parseModel(buffer);

  const vocabulary = new Map();
  const bytePieces = new Int32Array(256).fill(-1);
  let minScore = Infinity;
  let longest = 1;

  pieces.forEach(({ piece, score, type }, id) => {
    if (type === 6) {
      /* Byte pieces are spelled <0xNN> and are only reachable as a fallback,
       * so they stay out of the segmentation vocabulary. */
      bytePieces[parseInt(piece.slice(3, 5), 16)] = id;
      return;
    }
    if (type !== 1 && type !== 4) return;
    vocabulary.set(piece, { id, score });
    if (score < minScore) minScore = score;
    longest = Math.max(longest, [...piece].length);
  });

  /* SentencePiece scores an unknown character at the worst piece score minus
   * ten, which is what keeps segmentation preferring any real piece over a
   * fallback without making a fallback impossible. */
  const unknownScore = minScore - 10;

  function normalise(text) {
    let normalised = text.normalize('NFKC');
    if (removeExtraWhitespaces) normalised = normalised.replace(/\s+/g, ' ').trim();
    else normalised = normalised.replace(/\s/g, ' ');
    if (addDummyPrefix) normalised = ` ${normalised}`;
    return normalised.replaceAll(' ', WHITESPACE);
  }

  function encode(text) {
    /* Empty in, empty out — the dummy prefix must not become a token of its own. */
    if (!text.trim()) return [];
    const characters = [...normalise(text)];
    if (!characters.length) return [];

    /* Viterbi: best[i] is the best-scoring segmentation of the first i
     * characters, and back[i] the piece that ends there. */
    const best = new Float64Array(characters.length + 1).fill(-Infinity);
    const back = new Array(characters.length + 1).fill(null);
    best[0] = 0;

    for (let end = 1; end <= characters.length; end += 1) {
      for (let start = Math.max(0, end - longest); start < end; start += 1) {
        if (best[start] === -Infinity) continue;
        const candidate = characters.slice(start, end).join('');
        const entry = vocabulary.get(candidate);
        if (!entry) continue;
        const score = best[start] + entry.score;
        if (score > best[end]) { best[end] = score; back[end] = { start, id: entry.id }; }
      }
      /* Every position must remain reachable, so a character no piece covers
       * gets a single-character fallback node. */
      const fallback = best[end - 1] + unknownScore;
      if (best[end] === -Infinity || (back[end] === null && fallback > best[end])) {
        if (fallback > best[end]) { best[end] = fallback; back[end] = { start: end - 1, id: -1 }; }
      }
    }

    const ids = [];
    for (let at = characters.length; at > 0;) {
      const step = back[at];
      if (!step) break;
      if (step.id >= 0) {
        ids.push(step.id);
      } else {
        /* Fallback: the character's UTF-8 bytes, pushed in reverse because the
         * walk is backwards. */
        const encoded = new TextEncoder().encode(characters[step.start]);
        for (let i = encoded.length - 1; i >= 0; i -= 1) ids.push(bytePieces[encoded[i]]);
      }
      at = step.start;
    }
    return ids.reverse();
  }

  return { encode, size: pieces.length };
}
