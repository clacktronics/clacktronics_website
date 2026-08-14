/* RIFF/AVI surgery for ClackMosh.

   A mosher only needs three things from an AVI: the ordered list of frame
   chunks inside `movi`, a way to tell an I-frame from a P-frame without
   decoding anything, and a way to write the file back with the chunk list
   rearranged. Everything else — stream headers, extradata, frame rate — is
   copied through untouched, which is what keeps an edited file playable.

   This assumes the video-only MPEG-4 Part 2 AVI that mosh-engine.js
   normalises every import into, so `movi` holds nothing but video chunks. */

const AVIIF_KEYFRAME = 0x10;
const VOP_START = [0x00, 0x00, 0x01, 0xb6];

const fourcc = (bytes, offset) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/* Byte-pattern search. The payloads are tens of kilobytes, so the naive scan
   is far cheaper than building anything cleverer. */
function indexOfSeq(bytes, pattern, from = 0) {
  const limit = bytes.length - pattern.length;
  outer: for (let i = from; i <= limit; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/* MPEG-4 Part 2 stores the picture type in the two bits after the VOP start
   code, so the whole frame map is readable without a decoder. */
export function vopType(payload) {
  const at = indexOfSeq(payload, VOP_START);
  if (at < 0 || at + 4 >= payload.length) return '?';
  return 'IPBS'[(payload[at + 4] >> 6) & 3];
}

/* An I-frame chunk carries its own VOS/VO/VOL/GOV headers ahead of the VOP.
   Those headers describe the stream and encode the GOP's timecode, so a
   replacement frame keeps the original's header bytes and swaps only the
   picture that follows. */
export function splitVop(payload) {
  const at = indexOfSeq(payload, VOP_START);
  if (at < 0) return { header: new Uint8Array(0), vop: payload };
  return { header: payload.subarray(0, at), vop: payload.subarray(at) };
}

export function spliceVop(originalPayload, replacementPayload) {
  const { header } = splitVop(originalPayload);
  const { vop } = splitVop(replacementPayload);
  const out = new Uint8Array(header.length + vop.length);
  out.set(header, 0);
  out.set(vop, header.length);
  return out;
}

function walk(bytes, view) {
  const nodes = [];
  const end = 8 + view.getUint32(4, true);

  const recurse = (start, stop) => {
    let o = start;
    while (o + 8 <= stop) {
      const id = fourcc(bytes, o);
      const size = view.getUint32(o + 4, true);
      const body = o + 8;
      if (id === 'LIST' || id === 'RIFF') {
        const listType = fourcc(bytes, body);
        nodes.push({ id, listType, offset: body + 4, size: size - 4, headerAt: o });
        recurse(body + 4, Math.min(body + size, stop));
      } else {
        nodes.push({ id, listType: null, offset: body, size, headerAt: o });
      }
      o = body + size + (size & 1); // RIFF chunks are word aligned
    }
  };

  recurse(12, end);
  return nodes;
}

export function parseAvi(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'AVI ') {
    throw new Error('That is not an AVI file.');
  }
  const nodes = walk(bytes, view);

  const movi = nodes.find(node => node.listType === 'movi');
  if (!movi) throw new Error('This AVI has no movi list.');

  const avih = nodes.find(node => node.id === 'avih');
  const strh = nodes.find(node => node.id === 'strh');
  const strf = nodes.find(node => node.id === 'strf');

  const scale = strh ? view.getUint32(strh.offset + 20, true) : 1;
  const rate = strh ? view.getUint32(strh.offset + 24, true) : 25;

  const frames = [];
  let o = movi.offset;
  const stop = movi.offset + movi.size;
  while (o + 8 <= stop) {
    const id = fourcc(bytes, o);
    const size = view.getUint32(o + 4, true);
    if (id === 'LIST') { o += 12; continue; } // OpenDML 'rec ' grouping
    const payload = bytes.subarray(o + 8, o + 8 + size);
    frames.push({ id, payload, type: vopType(payload) });
    o += 8 + size + (size & 1);
  }

  return {
    nodes,
    frames,
    moviHeaderAt: movi.headerAt,
    width: strf ? view.getInt32(strf.offset + 4, true) : 0,
    height: strf ? Math.abs(view.getInt32(strf.offset + 8, true)) : 0,
    fps: scale ? rate / scale : 25,
    avihOffset: avih ? avih.offset : null,
    strhOffset: strh ? strh.offset : null
  };
}

/* Rebuild the file around a new chunk list.

   Everything up to the `movi` LIST header is copied verbatim so the stream
   headers survive; then the chunk list and a fresh idx1 are appended and the
   handful of size and frame-count fields are patched. Any real OpenDML index
   ahead of movi is neutralised to JUNK, because its offsets no longer mean
   anything once the chunks have moved. */
export function buildAvi(original, frames) {
  const parsed = parseAvi(original);
  const head = original.slice(0, parsed.moviHeaderAt + 12); // through the 'movi' fourcc
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);

  let bodyLength = 0;
  for (const frame of frames) bodyLength += 8 + frame.payload.length + (frame.payload.length & 1);

  const body = new Uint8Array(bodyLength);
  const bodyView = new DataView(body.buffer);
  const index = new Uint8Array(frames.length * 16);
  const indexView = new DataView(index.buffer);

  let write = 0;
  frames.forEach((frame, i) => {
    const size = frame.payload.length;
    /* idx1 offsets are measured from the 'movi' fourcc itself, and the chunk
       list starts 4 bytes past it. */
    const offset = write + 4;
    for (let c = 0; c < 4; c++) body[write + c] = frame.id.charCodeAt(c);
    bodyView.setUint32(write + 4, size, true);
    body.set(frame.payload, write + 8);
    write += 8 + size;
    if (size & 1) { body[write] = 0; write += 1; }

    for (let c = 0; c < 4; c++) index[i * 16 + c] = frame.id.charCodeAt(c);
    indexView.setUint32(i * 16 + 4, frame.type === 'I' ? AVIIF_KEYFRAME : 0, true);
    indexView.setUint32(i * 16 + 8, offset, true);
    indexView.setUint32(i * 16 + 12, size, true);
  });

  // movi LIST size counts its own 'movi' fourcc.
  headView.setUint32(parsed.moviHeaderAt + 4, bodyLength + 4, true);
  if (parsed.avihOffset !== null) headView.setUint32(parsed.avihOffset + 16, frames.length, true);
  if (parsed.strhOffset !== null) headView.setUint32(parsed.strhOffset + 32, frames.length, true);

  for (const node of parsed.nodes) {
    if (node.id === 'indx' && node.headerAt < head.length) {
      head.set([0x4a, 0x55, 0x4e, 0x4b], node.headerAt); // 'JUNK'
    }
    if (node.id === 'dmlh' && node.offset + 4 <= head.length) {
      headView.setUint32(node.offset, frames.length, true);
    }
  }

  const out = new Uint8Array(head.length + bodyLength + 8 + index.length);
  out.set(head, 0);
  out.set(body, head.length);
  const tail = head.length + bodyLength;
  out.set([0x69, 0x64, 0x78, 0x31], tail); // 'idx1'
  new DataView(out.buffer).setUint32(tail + 4, index.length, true);
  out.set(index, tail + 8);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/* Frame-map helpers the UI thinks in terms of. */
export function keyframeIndices(frames) {
  return frames.reduce((acc, frame, i) => (frame.type === 'I' ? (acc.push(i), acc) : acc), []);
}

/* The run of frames a given I-frame governs: itself plus every following
   frame up to the next I-frame. Editing an anchor changes exactly this span,
   which is why previews only ever need to render it. */
export function gopRange(frames, start) {
  let end = start + 1;
  while (end < frames.length && frames[end].type !== 'I') end++;
  return { start, end };
}

/* The span a preview has to decode to show frame `index` correctly: back to
   the nearest surviving I-frame, forward to the next one. Delete an anchor
   and this widens by itself to take in the previous GOP, which is exactly the
   bloom the edit was meant to produce. */
export function previewRange(frames, index) {
  let start = Math.min(index, frames.length - 1);
  while (start > 0 && frames[start].type !== 'I') start--;
  return gopRange(frames, start);
}
