/* ClackMosh — the editor around avi.js and mosh-engine.js.

   The model is deliberately small. A project is the normalised AVI plus a
   parallel array of frame records, one per chunk, each holding its current
   payload and the original it can be put back to. Nothing is ever removed from
   that array — a deleted frame is flagged and filtered out when the file is
   written — so frame indices, filmstrip positions and anchor thumbnails stay
   lined up for the whole session however much gets cut.

   Anchors (I-frames) are the only editable thing. The motion between them is
   never touched, which is the entire point: it goes on describing the movement
   of a picture that is no longer there. */

import { parseAvi, buildAvi, spliceVop, keyframeIndices, previewRange } from './avi.js';
import { MoshEngine, playablePreviewFormat } from './mosh-engine.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const canvas = $('#editor-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
const video = $('#preview-video');

/* A hard ceiling on the frame list. Adding clips is the only way to get near
   it, and past roughly this many frames a rebuild-and-render cycle stops
   feeling like an edit and starts risking the tab. */
const MAX_FRAMES = 3000;

/* Each frame carries its own thumbnail rather than the strip keeping a
   parallel array of them. Half the operations below reorder, duplicate or
   splice the frame list, and a picture that travels with its frame cannot
   fall out of step with it. */
const project = {
  file: null,
  sourcePath: null,
  bytes: null,
  frames: [],
  anchors: [],
  clips: [],
  settings: { width: 480, height: 360, fps: 25, gop: 25, quality: 5, meRange: 0, mv4: false, qpel: false, gray: false },
  hasAudio: false
};

/* Most of the Mosh menu is destructive in ways "reset" cannot reach — it puts
   payloads back, but it cannot un-duplicate or un-reverse a frame list. So
   every bulk operation takes a snapshot first. Frame records are copied
   shallowly; payloads and stills are shared, so a step costs a few hundred
   small objects rather than the video again. */
const UNDO_DEPTH = 12;
const undoStack = [];

function pushUndo(label) {
  undoStack.push({ label, frames: project.frames.map(frame => ({ ...frame })) });
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
}

function undo() {
  const step = undoStack.pop();
  if (!step) { setStatus('Nothing left to undo.', 'READY'); return; }
  project.frames = step.frames;
  reindex();
  buildFilmstrip();
  selectFrame(Math.min(edit.frameIndex ?? 0, project.frames.length - 1));
  setStatus(`Undone: ${step.label}.`, 'READY');
}

/* Anchor positions change whenever the list does, so everything that touches
   it ends here. */
function reindex() {
  project.anchors = keyframeIndices(project.frames);
}

/* Slider state is a scratch pad for the selected anchor, not part of the
   project: an edit only exists once it has been encoded and spliced in. */
const edit = {
  frameIndex: null,
  anchorIndex: null,
  image: null,
  sourceLabel: 'original',
  scale: 100, x: 0, y: 0, rotate: 0,
  hue: 0, sat: 100, contrast: 100, bright: 100,
  flipH: false, flipV: false, invert: false,
  dirty: false
};

let busy = false;
let previewURL = null;
const PREVIEW_FORMAT = playablePreviewFormat();

/* ---------- status ---------- */

function setStatus(text, state) {
  if (text !== undefined) $('#status-text').textContent = text;
  if (state) {
    $('#status-state').textContent = state;
    $('#status-state').dataset.state = state;
  }
}

function setProgress(value) {
  const bar = $('#progress');
  if (value === null) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#progress-fill').style.width = `${Math.round(value * 100)}%`;
}

const engine = new MoshEngine({
  onState: state => { if (!busy) setStatus(undefined, state); },
  onProgress: value => { if (busy) setProgress(value); }
});

async function withBusy(label, task) {
  if (busy) return;
  busy = true;
  setStatus(label, 'WORKING');
  setProgress(0);
  syncControls();
  try {
    return await task();
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Something went wrong.', 'ERROR');
    throw error;
  } finally {
    busy = false;
    setProgress(null);
    syncControls();
  }
}

/* ---------- opening ---------- */

/* What the toolbar currently asks for. Read fresh on every import, because
   these only ever take effect as a clip comes in. */
function importSettings() {
  return {
    width: Math.max(128, Number($('#opt-width').value) || 480),
    fps: Math.max(5, Number($('#opt-fps').value) || 25),
    gop: Math.max(2, Number($('#opt-gop').value) || 25),
    maxSeconds: Math.max(1, Number($('#opt-seconds').value) || 20),
    quality: Math.min(31, Math.max(1, Number($('#opt-quality').value) || 5)),
    meRange: Math.max(0, Number($('#opt-merange').value) || 0),
    mv4: $('#opt-mv4').checked,
    qpel: $('#opt-qpel').checked,
    gray: $('#opt-gray').checked
  };
}

/* The encoder settings a frame must have been made with to be spliceable into
   this project — everything that lands in the VOL header, plus the ones that
   simply ought to match so an added clip looks like it belongs. */
function projectEncode() {
  const { gop, quality, meRange, mv4, qpel, gray } = project.settings;
  return { gop, quality, meRange, mv4, qpel, gray };
}

function makeFrames(parsed) {
  return parsed.frames.map(frame => {
    const payload = frame.payload.slice();
    return { id: frame.id, type: frame.type, payload, original: payload,
             deleted: false, edited: false, join: false };
  });
}

async function openVideo(file) {
  const settings = importSettings();

  await withBusy(`Re-encoding “${file.name}” into moshable frames…`, async () => {
    if (project.sourcePath) await engine.quiet(project.sourcePath);
    releaseImages();

    const result = await engine.normalise(file, settings);
    const parsed = parseAvi(result.bytes);
    if (!parsed.frames.length) throw new Error('No frames came out of that file.');

    project.file = file;
    project.bytes = result.bytes;
    project.sourcePath = result.sourcePath;
    project.hasAudio = result.hasAudio;
    project.settings = {
      width: parsed.width, height: parsed.height, fps: parsed.fps,
      gop: settings.gop, quality: settings.quality,
      meRange: settings.meRange, mv4: settings.mv4, qpel: settings.qpel,
      gray: settings.gray
    };
    project.frames = makeFrames(parsed);
    project.clips = [{ name: file.name, frames: parsed.frames.length }];
    undoStack.length = 0;
    reindex();

    canvas.width = parsed.width;
    canvas.height = parsed.height;

    setStatus(`Pulling out ${project.anchors.length} anchor frames…`);
    const stills = await engine.keyframeThumbnails(
      result.bytes, project.anchors.length, parsed.width
    );
    project.anchors.forEach((index, n) => { project.frames[index].still = stills[n]; });

    $('#audio-toggle-wrap').hidden = !project.hasAudio;
    $('#editor-empty').hidden = true;
    $('#editor-controls').hidden = false;
    canvas.hidden = false;

    buildFilmstrip();
    await selectFrame(project.anchors[0] ?? 0);

    setStatus(
      `${project.frames.length} frames, ${project.anchors.length} anchors, ` +
      `${parsed.width}×${parsed.height} at ${Math.round(parsed.fps)}fps.`,
      'READY'
    );
  });
}

/* Bringing a second video in.

   The incoming clip is put through exactly the settings the project was built
   with — same frame, same rate, same encoder — so its chunks are the same
   currency as the ones already there and can simply be spliced into the list.
   Its first frame is flagged as a join, because that anchor is the one worth
   deleting: drop it and the new clip's motion is applied to the last picture
   of the old one, which is how two videos mosh into each other rather than
   just being cut together. */
async function addClip(file, where) {
  if (!project.frames.length) return;

  await withBusy(`Bringing “${file.name}” in to match the project…`, async () => {
    const result = await engine.normalise(file, {
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      maxSeconds: Math.max(1, Number($('#opt-seconds').value) || 20),
      ...projectEncode()
    });
    const parsed = parseAvi(result.bytes);
    if (!parsed.frames.length) throw new Error('No frames came out of that file.');

    if (project.frames.length + parsed.frames.length > MAX_FRAMES) {
      await engine.quiet(result.sourcePath);
      throw new Error(
        `That would make ${project.frames.length + parsed.frames.length} frames; ` +
        `the ceiling is ${MAX_FRAMES}. Shorten it with Max seconds and try again.`
      );
    }

    const incoming = makeFrames(parsed);

    const at = where === 'front' ? 0
      : where === 'end' ? project.frames.length
      : (edit.anchorIndex ?? 0);

    /* Thumbnails are held one per anchor in order, so the incoming clip's
       stills go in at the same ordinal the frames themselves do. */
    const stills = await engine.keyframeThumbnails(
      result.bytes, keyframeIndices(parsed.frames).length, project.settings.width
    );
    keyframeIndices(incoming).forEach((index, n) => { incoming[index].still = stills[n]; });

    pushUndo(`adding “${file.name}”`);
    project.frames.splice(at, 0, ...incoming);

    /* A join is an anchor that has another clip's picture in front of it —
       delete it and that picture is what the motion carries on from. Dropping
       a clip in creates one wherever something now precedes something else,
       which is both ends of a middle insert and neither the very start of the
       video (there is nothing before it to mosh into) nor past the very end. */
    const after = at + incoming.length;
    if (at > 0) project.frames[at].join = true;
    if (after < project.frames.length) project.frames[after].join = true;
    const joinAt = at > 0 ? at : after;

    reindex();
    project.clips.push({ name: file.name, frames: incoming.length });

    // Only the first clip's audio is kept, so this one's source is not needed.
    await engine.quiet(result.sourcePath);

    buildFilmstrip();
    await selectFrame(joinAt);
    setStatus(
      `“${file.name}” added — ${incoming.length} frames. ` +
      'Delete the anchor at the join to mosh the two together.',
      'READY'
    );
  });
}

function moshJoins() {
  const joins = project.frames.filter(frame => frame.join && !frame.deleted);
  if (!joins.length) { setStatus('No clip joins left to mosh.', 'READY'); return; }
  pushUndo('moshing the clip joins');
  joins.forEach(frame => { frame.deleted = true; });
  refreshStripState();
  syncControls();
  setStatus(
    `${joins.length} join${joins.length > 1 ? 's' : ''} moshed — each clip now lands on the picture before it.`,
    'READY'
  );
}

function releaseImages() {
  project.frames.forEach(frame => {
    if (frame.still && frame.still.startsWith('blob:')) URL.revokeObjectURL(frame.still);
  });
  if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
  video.removeAttribute('src');
  video.load();
}

/* ---------- filmstrip ---------- */

function anchorNumber(frameIndex) {
  let n = -1;
  for (let i = 0; i <= frameIndex && i < project.frames.length; i++) {
    if (project.frames[i].type === 'I') n++;
  }
  return n;
}

function buildFilmstrip() {
  const strip = $('#filmstrip');
  strip.textContent = '';
  const fragment = document.createDocumentFragment();

  project.frames.forEach((frame, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.index = String(index);
    button.className = `frame ${frame.type === 'I' ? 'i' : 'p'}`;
    button.setAttribute('role', 'option');

    if (frame.type === 'I') {
      const n = anchorNumber(index);
      const url = frame.still;
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        button.append(img);
      }
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(n + 1);
      button.append(badge);
      button.title = `Anchor ${n + 1} — frame ${index}`;
    } else {
      button.title = `Motion — frame ${index}`;
    }
    fragment.append(button);
  });

  strip.append(fragment);
  refreshStripState();
}

function refreshStripState() {
  const live = project.frames.filter(frame => !frame.deleted).length;
  const anchorsLeft = project.frames.filter(frame => frame.type === 'I' && !frame.deleted).length;
  const edited = project.frames.filter(frame => frame.edited).length;
  const clips = project.clips.length > 1 ? ` · ${project.clips.length} clips` : '';
  $('#strip-note').textContent = project.frames.length
    ? `${live} of ${project.frames.length} kept · ${anchorsLeft} anchors · ${edited} edited${clips}`
    : '—';

  $$('#filmstrip .frame').forEach(button => {
    const frame = project.frames[Number(button.dataset.index)];
    button.classList.toggle('deleted', frame.deleted);
    button.classList.toggle('edited', frame.edited);
    button.classList.toggle('join', frame.join);
    button.classList.toggle('selected', Number(button.dataset.index) === edit.frameIndex);
  });
}

/* ---------- selection and the editor canvas ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = src;
  });
}

/* Clicking the motion between anchors selects the anchor it belongs to —
   there is nothing to edit on a P-frame, but it is a natural thing to aim at
   when you are looking for the run it is part of. */
function anchorGoverning(index) {
  let at = Math.min(index, project.frames.length - 1);
  while (at > 0 && project.frames[at].type !== 'I') at--;
  return at;
}

/* Two positions, not one. `frameIndex` is exactly what was clicked, because
   the motion operations need to be aimed at a particular P-frame; the anchor
   editor works on `anchorIndex`, the anchor governing it, because a P-frame
   has no picture to edit. Clicking motion therefore still loads its anchor
   into the editor, while giving the Mosh menu a precise target. */
async function selectFrame(index) {
  if (!project.frames.length) return;
  const at = Math.max(0, Math.min(index, project.frames.length - 1));
  const anchor = anchorGoverning(at);
  edit.frameIndex = at;
  edit.anchorIndex = anchor;
  resetSliders();
  edit.sourceLabel = 'original';

  const n = anchorNumber(anchor);
  const url = project.frames[anchor].still;
  edit.image = url ? await loadImage(url).catch(() => null) : null;

  const frame = project.frames[anchor];
  const here = at === anchor ? '' : ` · at motion frame ${at}`;
  $('#anchor-label').textContent =
    `anchor ${n + 1} of ${project.anchors.length} · frame ${anchor}` +
    (frame.deleted ? ' · deleted' : frame.edited ? ' · edited' : '') + here;

  drawEditor();
  refreshStripState();
  syncControls();

  const button = $(`#filmstrip .frame[data-index="${at}"]`);
  button?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function resetSliders() {
  Object.assign(edit, {
    scale: 100, x: 0, y: 0, rotate: 0,
    hue: 0, sat: 100, contrast: 100, bright: 100,
    flipH: false, flipV: false, invert: false, dirty: false
  });
  $('#ed-scale').value = 100; $('#ed-x').value = 0; $('#ed-y').value = 0;
  $('#ed-rotate').value = 0; $('#ed-hue').value = 0; $('#ed-sat').value = 100;
  $('#ed-contrast').value = 100; $('#ed-bright').value = 100;
  $('#ed-flip-h').checked = false; $('#ed-flip-v').checked = false; $('#ed-invert').checked = false;
  $('#apply-button').classList.remove('dirty');
  $('#adjustments').classList.remove('touched');
  syncOutputs();
}

function syncOutputs() {
  $('#out-scale').textContent = `${edit.scale}%`;
  $('#out-x').textContent = String(edit.x);
  $('#out-y').textContent = String(edit.y);
  $('#out-rotate').textContent = `${edit.rotate}°`;
  $('#out-hue').textContent = `${edit.hue}°`;
  $('#out-sat').textContent = `${edit.sat}%`;
  $('#out-contrast').textContent = `${edit.contrast}%`;
  $('#out-bright').textContent = `${edit.bright}%`;
}

function drawEditor() {
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (!edit.image) return;

  const filters = [
    `hue-rotate(${edit.hue}deg)`,
    `saturate(${edit.sat}%)`,
    `contrast(${edit.contrast}%)`,
    `brightness(${edit.bright}%)`
  ];
  if (edit.invert) filters.push('invert(1)');
  ctx.filter = filters.join(' ');

  /* Fit the picture inside the frame first, so an imported image of any shape
     lands sensibly, then apply what the sliders asked for on top. */
  const fit = Math.min(width / edit.image.naturalWidth, height / edit.image.naturalHeight);
  const drawWidth = edit.image.naturalWidth * fit;
  const drawHeight = edit.image.naturalHeight * fit;

  ctx.translate(width / 2 + (edit.x / 100) * width, height / 2 + (edit.y / 100) * height);
  ctx.rotate((edit.rotate * Math.PI) / 180);
  ctx.scale((edit.flipH ? -1 : 1) * (edit.scale / 100), (edit.flipV ? -1 : 1) * (edit.scale / 100));
  ctx.drawImage(edit.image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
}

function markDirty() {
  edit.dirty = true;
  $('#apply-button').classList.add('dirty');
  $('#adjustments').classList.add('touched');
}

/* ---------- committing an edit ---------- */

function canvasToPng() {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) { reject(new Error('The frame could not be read off the canvas.')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

async function applyEdit() {
  if (edit.anchorIndex === null) return;
  const index = edit.anchorIndex;

  await withBusy('Encoding the anchor…', async () => {
    const png = await canvasToPng();
    const payload = await engine.encodeStill(png, {
      width: project.settings.width,
      height: project.settings.height,
      ...projectEncode()
    });

    const frame = project.frames[index];
    /* The original chunk's header bytes are kept — they carry the stream
       configuration and this GOP's timecode — and only the picture after the
       VOP start code is swapped. */
    frame.payload = spliceVop(frame.original, payload);
    frame.edited = true;
    frame.deleted = false;

    const n = anchorNumber(index);
    const old = frame.still;
    frame.still = canvas.toDataURL('image/jpeg', 0.82);
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);

    const img = $(`#filmstrip .frame[data-index="${index}"] img`);
    if (img) img.src = frame.still;
    else buildFilmstrip();

    edit.dirty = false;
    $('#apply-button').classList.remove('dirty');
    $('#adjustments').classList.remove('touched');
    $('#anchor-label').textContent = `anchor ${n + 1} of ${project.anchors.length} · frame ${index} · edited`;
    refreshStripState();
    setStatus(`Anchor ${n + 1} replaced. Preview the run to see the motion take it.`, 'READY');
  });
}

function deleteAnchor() {
  if (edit.anchorIndex === null) return;
  pushUndo('deleting an anchor');
  const frame = project.frames[edit.anchorIndex];
  frame.deleted = true;
  refreshStripState();
  syncControls();
  const n = anchorNumber(edit.anchorIndex);
  $('#anchor-label').textContent = `anchor ${n + 1} of ${project.anchors.length} · frame ${edit.anchorIndex} · deleted`;
  setStatus(`Anchor ${n + 1} deleted — the previous picture now runs on through it.`, 'READY');
}

function restoreAnchor() {
  if (edit.anchorIndex === null) return;
  project.frames[edit.anchorIndex].deleted = false;
  refreshStripState();
  syncControls();
  selectFrame(edit.anchorIndex);
  setStatus('Anchor restored.', 'READY');
}

/* Re-reading a picture out of the stream, rather than off the source file:
   with clips added, the frames no longer all come from one import, but they
   are all in the frame list, and an anchor decodes on its own. */
async function stillFor(frame) {
  const one = buildAvi(project.bytes, [{ ...frame, payload: frame.original, deleted: false }]);
  const [url] = await engine.keyframeThumbnails(one, 1, project.settings.width);
  return url;
}

function replaceStill(frame, url) {
  const old = frame.still;
  frame.still = url;
  if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
}

async function resetFrame() {
  if (edit.anchorIndex === null) return;
  const index = edit.anchorIndex;
  const frame = project.frames[index];
  frame.payload = frame.original;
  frame.edited = false;
  frame.deleted = false;

  await withBusy('Putting the original picture back…', async () => {
    replaceStill(frame, await stillFor(frame));
    buildFilmstrip();
    await selectFrame(index);
    setStatus('Anchor reset.', 'READY');
  });
}

async function resetAll() {
  if (!project.frames.length) return;
  project.frames.forEach(frame => {
    frame.payload = frame.original;
    frame.edited = false;
    frame.deleted = false;
  });
  await withBusy('Reloading the anchors…', async () => {
    const restored = buildAvi(project.bytes, project.frames);
    const urls = await engine.keyframeThumbnails(
      restored, project.anchors.length, project.settings.width
    );
    project.anchors.forEach((index, n) => replaceStill(project.frames[index], urls[n]));
    buildFilmstrip();
    await selectFrame(project.anchors[0] ?? 0);
    setStatus('Every edit undone.', 'READY');
  });
}

/* Bloom from here on: every anchor after the selected frame goes, so the
   selected picture is the last one that ever resets and everything following
   it is motion applied to whatever is already on screen. bloomAll is this with
   the first anchor selected; this is the version you can aim. */
function stripAnchors() {
  if (edit.frameIndex === null) return;
  pushUndo('deleting the anchors after this point');
  let gone = 0;
  for (let i = edit.frameIndex + 1; i < project.frames.length; i++) {
    const frame = project.frames[i];
    if (frame.type === 'I' && !frame.deleted) { frame.deleted = true; gone++; }
  }
  if (!gone) { setStatus('There are no anchors left after this point.', 'READY'); return; }
  refreshStripState();
  syncControls();
  setStatus(
    `${gone} anchor${gone > 1 ? 's' : ''} deleted — from here on the picture never resets.`,
    'READY'
  );
}

/* Muddle the anchors: every anchor keeps its place in the stream, and its own
   header bytes with it, but is given a different anchor's picture. The motion
   is untouched, so each run drags the wrong picture through the right
   movement — the transplant the anchor editor does by hand, applied to the
   whole video at once, and with every picture still coming from the footage,
   so it reads as coherent-but-wrong rather than as noise.

   No encoding: the pictures already exist as chunks, so this is the same
   payload splice as an edit and happens instantly. The thumbnails are
   permuted the same way rather than pulled out again. */
function shuffleAnchors() {
  const slots = project.anchors;
  if (slots.length < 2) { setStatus('There is only one anchor to muddle.', 'READY'); return; }

  const order = slots.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  /* Leaving a picture where it started is a wasted anchor, so any that the
     shuffle left in place trades with its neighbour. */
  order.forEach((from, i) => {
    if (from !== i) return;
    const swap = (i + 1) % order.length;
    [order[i], order[swap]] = [order[swap], order[i]];
  });

  pushUndo('shuffling the anchor pictures');
  const pictures = slots.map(index => project.frames[index].payload);
  const stills = slots.map(index => project.frames[index].still);

  slots.forEach((index, n) => {
    const frame = project.frames[index];
    frame.payload = spliceVop(frame.original, pictures[order[n]]);
    frame.edited = true;
    frame.still = stills[order[n]];
  });

  buildFilmstrip();
  selectFrame(edit.frameIndex ?? slots[0]);
  setStatus(
    `${slots.length} anchor pictures muddled — the motion is untouched, so each run ` +
    'now drags the wrong picture. Muddle again for a different draw.',
    'READY'
  );
}

/* The opposite bulk move to bloomAll: that one takes the anchors out and
   leaves nothing but motion, this one takes the motion out and leaves nothing
   but anchors. From the selected frame onwards each run collapses to its own
   single picture, so the tail of the video becomes a hard slideshow. */
function stripMotion() {
  if (edit.frameIndex === null) return;
  pushUndo('deleting the motion after this anchor');
  let gone = 0;
  for (let i = edit.frameIndex + 1; i < project.frames.length; i++) {
    const frame = project.frames[i];
    if (frame.type === 'P' && !frame.deleted) { frame.deleted = true; gone++; }
  }
  if (!gone) { setStatus('There is no motion left after this anchor.', 'READY'); return; }

  const anchorsLeft = project.frames
    .slice(edit.frameIndex)
    .filter(frame => frame.type === 'I' && !frame.deleted).length;
  refreshStripState();
  syncControls();
  setStatus(
    `${gone} motion frames deleted — from here on the video is ${anchorsLeft} ` +
    'anchors, one frame each.',
    'READY'
  );
}

function bloomAll() {
  if (!project.frames.length) return;
  pushUndo('deleting every anchor but the first');
  project.anchors.forEach((index, n) => {
    if (n > 0) project.frames[index].deleted = true;
  });
  refreshStripState();
  syncControls();
  setStatus('Every anchor after the first is gone — the opening picture now has to last the whole video.', 'READY');
}

/* ---------- wrecking the stream ----------

   Everything here is chunk surgery: reordering, duplicating, trimming or
   corrupting payloads that already exist. None of it re-encodes, so all of it
   lands instantly however long the video is. The one thing that cannot be
   done this way is scaling the motion vectors themselves — MPEG-4 Part 2
   codes them with variable-length codes and predicts each from its
   neighbours, so there is no byte to multiply. */

const clone = frame => ({ ...frame });

function afterCursor(predicate) {
  const out = [];
  for (let i = (edit.frameIndex ?? 0) + 1; i < project.frames.length; i++) {
    if (predicate(project.frames[i])) out.push(i);
  }
  return out;
}

/* Repeat one frame. On a P-frame this is the classic slide: the same motion
   vectors are applied again and again, so whatever is on screen keeps being
   pushed the same way and shears further with every repeat. */
function holdFrame(times) {
  if (edit.frameIndex === null) return;
  const at = edit.frameIndex;
  const frame = project.frames[at];
  pushUndo(`holding frame ${at}`);
  const copies = Array.from({ length: times - 1 }, () => ({ ...clone(frame), join: false }));
  project.frames.splice(at + 1, 0, ...copies);
  reindex();
  buildFilmstrip();
  selectFrame(at);
  setStatus(
    `Frame ${at} held for ${times}${frame.type === 'P'
      ? ' — its motion is now applied that many times over.'
      : ' — the picture simply sits there.'}`,
    'READY'
  );
}

/* Repeat the run of motion belonging to the selected anchor. Where holding one
   frame slides in a straight line, looping a whole run replays a gesture, so
   the picture drifts in a rhythm instead. */
function loopRun(times) {
  if (edit.anchorIndex === null) return;
  const { start, end } = previewRange(project.frames, edit.anchorIndex);
  const run = project.frames.slice(start + 1, end);
  if (!run.length) { setStatus('This anchor has no motion to loop.', 'READY'); return; }
  pushUndo('looping the motion of a run');
  const extra = [];
  for (let n = 1; n < times; n++) extra.push(...run.map(f => ({ ...clone(f), join: false })));
  project.frames.splice(end, 0, ...extra);
  reindex();
  buildFilmstrip();
  selectFrame(edit.anchorIndex);
  setStatus(`${run.length} motion frames looped ${times} times over.`, 'READY');
}

/* Thin the motion out. The movement still happens, but in bigger jumps. */
function dropAlternateMotion() {
  const targets = afterCursor(frame => frame.type === 'P' && !frame.deleted);
  if (!targets.length) { setStatus('There is no motion after this point.', 'READY'); return; }
  pushUndo('dropping alternate motion frames');
  targets.filter((_, n) => n % 2 === 1).forEach(i => { project.frames[i].deleted = true; });
  refreshStripState();
  syncControls();
  setStatus(`${Math.floor(targets.length / 2)} motion frames dropped — the movement now jumps.`, 'READY');
}

/* Reverse the whole chunk list. The first frame is then whatever used to be
   last, which is usually motion rather than an anchor, so the video opens on
   whatever the decoder makes of a delta with nothing behind it. */
function reverseAll() {
  if (project.frames.length < 2) return;
  pushUndo('reversing every frame');
  project.frames.reverse();
  reindex();
  buildFilmstrip();
  selectFrame(0);
  setStatus('Every frame reversed — the motion now runs backwards against the pictures.', 'READY');
}

/* Muddle the motion, the mirror of muddling the anchors. There the picture was
   wrong and the movement right; here the picture is right and the movement
   wrong, and because each P-frame's error feeds the next the damage builds
   through a run and then snaps back at the anchor. */
function shuffleMotion(scope) {
  const groups = scope === 'global'
    ? [project.frames.map((f, i) => i).filter(i => project.frames[i].type === 'P')]
    : project.anchors.map((start, n) => {
        const end = n + 1 < project.anchors.length ? project.anchors[n + 1] : project.frames.length;
        const out = [];
        for (let i = start + 1; i < end; i++) if (project.frames[i].type === 'P') out.push(i);
        return out;
      });

  const usable = groups.filter(group => group.length > 1);
  if (!usable.length) { setStatus('There is not enough motion to muddle.', 'READY'); return; }
  pushUndo(scope === 'reverse' ? 'reversing the motion in each run' : 'shuffling the motion');

  let moved = 0;
  usable.forEach(group => {
    const order = scope === 'reverse'
      ? group.map((_, i) => group.length - 1 - i)
      : (() => {
          const o = group.map((_, i) => i);
          for (let i = o.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [o[i], o[j]] = [o[j], o[i]];
          }
          return o;
        })();
    const payloads = group.map(i => project.frames[i].payload);
    group.forEach((index, n) => {
      project.frames[index].payload = payloads[order[n]];
      project.frames[index].edited = true;
      moved++;
    });
  });

  refreshStripState();
  syncControls();
  const what = scope === 'reverse' ? 'reversed within their runs'
    : scope === 'global' ? 'muddled across the whole video'
    : 'muddled within their own runs';
  setStatus(
    `${moved} motion frames ${what} — the pictures are untouched, so each run tears itself ` +
    'apart and resets at the next anchor.',
    'READY'
  );
}

/* Damage the payloads themselves. Flipping bytes inside a P-frame desynchronises
   the variable-length codes, so the decoder conceals its way through a frame
   that no longer means anything and the picture rots block by block. */
function corruptMotion(perFrame) {
  const targets = project.frames
    .map((frame, i) => i)
    .filter(i => project.frames[i].type === 'P' && project.frames[i].payload.length > 80);
  if (!targets.length) { setStatus('There is no motion to damage.', 'READY'); return; }
  pushUndo('corrupting the motion');

  targets.forEach(i => {
    const frame = project.frames[i];
    const bytes = frame.payload.slice();
    for (let n = 0; n < perFrame; n++) {
      /* Past the VOP header, so the frame still announces itself as motion and
         the decoder commits to reading it before finding the mess. */
      const at = 40 + Math.floor(Math.random() * (bytes.length - 40));
      bytes[at] ^= 1 + Math.floor(Math.random() * 255);
    }
    frame.payload = bytes;
    frame.edited = true;
  });

  refreshStripState();
  syncControls();
  setStatus(
    `${targets.length} motion frames damaged, ${perFrame} bytes each — the picture will rot ` +
    'through each run and recover at every anchor.',
    'READY'
  );
}

/* Cut the motion short. The decoder updates the macroblocks it was given and
   leaves the rest of the frame as it was, so the picture updates in a band
   down to where the data ran out. */
function truncateMotion(keep) {
  const targets = project.frames.filter(frame => frame.type === 'P' && frame.payload.length > 60);
  if (!targets.length) { setStatus('There is no motion to cut short.', 'READY'); return; }
  pushUndo('truncating the motion');
  targets.forEach(frame => {
    frame.payload = frame.payload.slice(0, Math.max(24, Math.floor(frame.payload.length * keep)));
    frame.edited = true;
  });
  refreshStripState();
  syncControls();
  setStatus(
    `${targets.length} motion frames cut to ${Math.round(keep * 100)}% — each one now updates ` +
    'only part of the picture.',
    'READY'
  );
}

/* ---------- operations that need a second video ---------- */

async function normaliseCompanion(file) {
  const result = await engine.normalise(file, {
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    maxSeconds: Math.max(1, Number($('#opt-seconds').value) || 20),
    ...projectEncode()
  });
  const parsed = parseAvi(result.bytes);
  if (!parsed.frames.length) throw new Error('No frames came out of that file.');
  await engine.quiet(result.sourcePath);
  return { parsed, bytes: result.bytes };
}

/* This video's pictures, another video's movement. The anchors stay exactly
   where they are and keep their own pictures; every P-frame is replaced by one
   from the other clip, so each run is this footage being pushed around by
   something that was never filmed with it. */
async function transferMotion(file) {
  await withBusy(`Taking the motion out of “${file.name}”…`, async () => {
    const { parsed } = await normaliseCompanion(file);
    const donor = parsed.frames.filter(frame => frame.type === 'P');
    if (!donor.length) throw new Error('That clip has no motion frames in it.');

    pushUndo('transferring motion from another clip');
    let n = 0;
    project.frames.forEach(frame => {
      if (frame.type !== 'P') return;
      frame.payload = donor[n % donor.length].payload.slice();
      frame.edited = true;
      n++;
    });
    refreshStripState();
    syncControls();
    setStatus(
      `${n} motion frames taken from “${file.name}” — this video's pictures, that video's movement.`,
      'READY'
    );
  });
}

/* Alternate frames from the two clips. Both streams' motion is applied to one
   shared picture, so they fight over it and neither wins. */
async function interleaveClip(file) {
  await withBusy(`Interleaving “${file.name}”…`, async () => {
    const { parsed, bytes } = await normaliseCompanion(file);
    const incoming = makeFrames(parsed);
    if (project.frames.length + incoming.length > MAX_FRAMES) {
      throw new Error(
        `That would make ${project.frames.length + incoming.length} frames; ` +
        `the ceiling is ${MAX_FRAMES}.`
      );
    }
    const incomingAnchors = keyframeIndices(incoming);
    const stills = await engine.keyframeThumbnails(
      bytes, incomingAnchors.length, project.settings.width
    );
    incomingAnchors.forEach((index, n) => { incoming[index].still = stills[n]; });

    pushUndo(`interleaving “${file.name}”`);
    const woven = [];
    const most = Math.max(project.frames.length, incoming.length);
    for (let i = 0; i < most; i++) {
      if (i < project.frames.length) woven.push(project.frames[i]);
      if (i < incoming.length) woven.push(incoming[i]);
    }
    project.frames = woven;
    project.clips.push({ name: file.name, frames: incoming.length });
    reindex();
    buildFilmstrip();
    await selectFrame(0);
    setStatus(
      `“${file.name}” woven in frame by frame — ${project.frames.length} frames, two sets of ` +
      'motion fighting over one picture.',
      'READY'
    );
  });
}

/* ---------- building and rendering ---------- */

function liveFrames() {
  return project.frames.filter(frame => !frame.deleted);
}

function livePosition(index) {
  let position = 0;
  for (let i = 0; i < index; i++) if (!project.frames[i].deleted) position++;
  return position;
}

function moshedBytes(range = null) {
  const live = liveFrames();
  if (!live.length) throw new Error('Every frame has been deleted.');
  const slice = range ? live.slice(range.start, range.end) : live;
  return buildAvi(project.bytes, slice);
}

async function previewRun() {
  if (edit.frameIndex === null) return;
  await withBusy('Rendering this run…', async () => {
    const live = liveFrames();
    const position = Math.min(livePosition(edit.frameIndex), live.length - 1);
    const range = previewRange(live, position);
    const blob = await engine.render(moshedBytes(range), { crf: 22, format: PREVIEW_FORMAT });
    showPreview(blob, `${range.end - range.start} frames from the selected anchor`);
  });
}

async function renderAll() {
  await withBusy('Rendering the whole video…', async () => {
    const keepAudio = project.hasAudio && $('#opt-audio').checked;
    const blob = await engine.render(moshedBytes(), {
      audioFrom: keepAudio ? project.sourcePath : null,
      format: PREVIEW_FORMAT
    });
    showPreview(blob, `whole video · ${liveFrames().length} frames`, { silent: !keepAudio });
  });
}

/* Autoplay is refused for anything with sound, and a preview that sits on a
   black rectangle until it is clicked is no use when the whole point is to
   watch the motion take hold. So a silent render plays muted straight away,
   and one carrying audio falls back to muted rather than not playing. */
function showPreview(blob, note, { silent = true } = {}) {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = URL.createObjectURL(blob);
  video.src = previewURL;
  video.muted = silent;
  video.load();
  video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => { /* the controls still work */ });
  });
  $('#preview-empty').hidden = true;
  $('#preview-note').textContent = note;
  setStatus('Rendered.', 'READY');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName() {
  const name = project.file?.name || 'clackmosh';
  return name.replace(/\.[^.]+$/, '') || 'clackmosh';
}

async function exportMp4() {
  await withBusy('Rendering for export…', async () => {
    const keepAudio = project.hasAudio && $('#opt-audio').checked;
    const blob = await engine.render(moshedBytes(), {
      audioFrom: keepAudio ? project.sourcePath : null
    });
    download(blob, `${baseName()}-moshed.mp4`);
    setStatus('MP4 saved.', 'READY');
  });
}

function exportAvi() {
  if (!project.frames.length) return;
  /* The AVI is the authentic artefact — the edited frames and the untouched
     motion, still broken. Browsers will not play it; VLC and FFmpeg will. */
  download(new Blob([moshedBytes()], { type: 'video/x-msvideo' }), `${baseName()}-moshed.avi`);
  setStatus('Moshed AVI saved. Browsers cannot play it — try VLC.', 'READY');
}

/* ---------- picking a picture from elsewhere ---------- */

async function replaceWithImage() {
  $('#image-input').click();
}

async function replaceWithAnchor() {
  const grid = $('#picker-grid');
  grid.textContent = '';
  project.anchors.forEach((frameIndex, n) => {
    const url = project.frames[frameIndex].still;
    if (!url) return;
    const button = document.createElement('button');
    button.type = 'button';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = `Anchor ${n + 1}`;
    button.append(img, caption);
    button.addEventListener('click', async () => {
      $('#anchor-picker').close();
      edit.image = await loadImage(url).catch(() => null);
      edit.sourceLabel = `anchor ${n + 1}`;
      markDirty();
      drawEditor();
      setStatus(`Using the picture from anchor ${n + 1}. Apply it to commit.`);
    });
    grid.append(button);
  });
  $('#anchor-picker').showModal();
}

/* ---------- control state ---------- */

function syncControls() {
  const loaded = project.frames.length > 0;
  const selected = edit.frameIndex !== null;
  const frame = edit.anchorIndex !== null ? project.frames[edit.anchorIndex] : null;

  const enable = (selector, on) => $$(selector).forEach(button => { button.disabled = !on; });
  enable('[data-action="preview"]', loaded && selected && !busy);
  enable('[data-action="render"]', loaded && !busy);
  enable('[data-action="export-mp4"]', loaded && !busy);
  enable('[data-action="export-avi"]', loaded && !busy);
  enable('[data-action="apply"]', loaded && selected && !busy);
  enable('[data-action="delete"]', loaded && selected && !busy && !frame?.deleted);
  enable('[data-action="restore"]', loaded && selected && !busy && !!frame?.deleted);
  enable('[data-action="reset-frame"]', loaded && selected && !busy);
  enable('[data-action="reset-all"]', loaded && !busy);
  enable('[data-action="replace-image"]', loaded && selected && !busy);
  enable('[data-action="replace-anchor"]', loaded && selected && !busy);
  enable('[data-action="revert-source"]', loaded && selected && !busy);
  enable('[data-action="bloom-all"]', loaded && !busy);
  enable('[data-action="strip-motion"]', loaded && selected && !busy);
  enable('[data-action="strip-anchors"]', loaded && selected && !busy);
  enable('[data-action="shuffle-anchors"]', loaded && !busy && project.anchors.length > 1);
  enable('[data-action="undo"]', !busy && undoStack.length > 0);
  const motion = loaded && !busy;
  ['hold-2', 'hold-4', 'hold-8', 'hold-16', 'hold-32'].forEach(a =>
    enable(`[data-action="${a}"]`, motion && selected));
  ['loop-2', 'loop-3', 'loop-4'].forEach(a => enable(`[data-action="${a}"]`, motion && selected));
  ['drop-alternate', 'reverse-all', 'shuffle-motion-global', 'shuffle-motion-run',
   'reverse-motion-run', 'corrupt-light', 'corrupt-medium', 'corrupt-heavy',
   'truncate-75', 'truncate-50', 'truncate-25', 'transfer-motion', 'interleave-clip'
  ].forEach(a => enable(`[data-action="${a}"]`, motion));
  enable('[data-action="reimport"]', !!project.file && !busy);
  enable('[data-action="open"]', !busy);
  enable('[data-action="add-front"]', loaded && !busy);
  enable('[data-action="add-here"]', loaded && selected && !busy);
  enable('[data-action="add-end"]', loaded && !busy);
  enable('[data-action="mosh-joins"]', !busy && project.frames.some(frame => frame.join && !frame.deleted));
}

/* ---------- actions, menus, input ---------- */

let pendingClipPosition = 'end';
let pendingCompanion = 'transfer';

const actions = {
  open: () => $('#file-input').click(),
  reimport: () => { if (project.file) openVideo(project.file); },
  'add-front': () => { pendingClipPosition = 'front'; $('#clip-input').click(); },
  'add-here': () => { pendingClipPosition = 'here'; $('#clip-input').click(); },
  'add-end': () => { pendingClipPosition = 'end'; $('#clip-input').click(); },
  'mosh-joins': () => moshJoins(),
  'export-mp4': () => exportMp4(),
  'export-avi': () => exportAvi(),
  'replace-image': () => replaceWithImage(),
  'replace-anchor': () => replaceWithAnchor(),
  'revert-source': () => selectFrame(edit.frameIndex),
  apply: () => applyEdit(),
  delete: () => deleteAnchor(),
  restore: () => restoreAnchor(),
  'reset-frame': () => resetFrame(),
  'reset-all': () => resetAll(),
  preview: () => previewRun(),
  render: () => renderAll(),
  'bloom-all': () => bloomAll(),
  'strip-motion': () => stripMotion(),
  'strip-anchors': () => stripAnchors(),
  'shuffle-anchors': () => shuffleAnchors(),
  undo: () => undo(),
  'hold-2': () => holdFrame(2),
  'hold-4': () => holdFrame(4),
  'hold-8': () => holdFrame(8),
  'hold-16': () => holdFrame(16),
  'hold-32': () => holdFrame(32),
  'loop-2': () => loopRun(2),
  'loop-3': () => loopRun(3),
  'loop-4': () => loopRun(4),
  'drop-alternate': () => dropAlternateMotion(),
  'reverse-all': () => reverseAll(),
  'shuffle-motion-global': () => shuffleMotion('global'),
  'shuffle-motion-run': () => shuffleMotion('run'),
  'reverse-motion-run': () => shuffleMotion('reverse'),
  'corrupt-light': () => corruptMotion(2),
  'corrupt-medium': () => corruptMotion(6),
  'corrupt-heavy': () => corruptMotion(20),
  'truncate-75': () => truncateMotion(0.75),
  'truncate-50': () => truncateMotion(0.5),
  'truncate-25': () => truncateMotion(0.25),
  'transfer-motion': () => { pendingCompanion = 'transfer'; $('#companion-input').click(); },
  'interleave-clip': () => { pendingCompanion = 'interleave'; $('#companion-input').click(); },
  about: () => $('#about-dialog').showModal()
};

function closeSubMenus() {
  $$('.rm-sub').forEach(sub => {
    sub.classList.remove('open');
    sub.querySelector(':scope > .rm-sub-open').setAttribute('aria-expanded', 'false');
  });
}

function closeMenus() {
  closeSubMenus();
  $$('.rm').forEach(menu => {
    menu.classList.remove('open');
    menu.querySelector(':scope > .rm-dd').style.transform = '';
  });
}

/* A menu is anchored to its own button, which on a phone puts the right-hand
   ones off the edge of the screen; an opened menu is measured and slid back
   until it fits. */
function positionMenu(panel) {
  panel.style.transform = '';
  const margin = 6;
  const rect = panel.getBoundingClientRect();
  const overflowRight = rect.right - (window.innerWidth - margin);
  const shift = overflowRight > 0 ? -Math.min(overflowRight, Math.max(0, rect.left - margin)) : 0;
  if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) {
    if (!button.disabled) actions[button.dataset.action]?.();
    closeMenus();
  } else if (!event.target.closest('.rm')) {
    /* the shared bar script closes .rm on a click away; the fly-outs inside
       one are this app's own, so they are closed here */
    closeMenus();
  }
});

$$('.rm-sub').forEach(sub => {
  const opener = sub.querySelector(':scope > .rm-sub-open');
  opener.addEventListener('click', event => {
    event.stopPropagation();
    const wasOpen = sub.classList.contains('open');
    closeSubMenus();
    if (!wasOpen) {
      sub.classList.add('open');
      opener.setAttribute('aria-expanded', 'true');
    }
  });
});

$$('.rm').forEach(menu => {
  menu.querySelector(':scope > button').addEventListener('click', event => {
    event.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) {
      menu.classList.add('open');
      positionMenu(menu.querySelector(':scope > .rm-dd'));
    }
  });
});

$('#filmstrip').addEventListener('click', event => {
  const button = event.target.closest('.frame');
  if (button && !busy) selectFrame(Number(button.dataset.index));
});

$('#filmstrip').addEventListener('keydown', event => {
  if (!project.anchors.length || busy) return;
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const current = project.anchors.indexOf(anchorGoverning(edit.frameIndex ?? 0));
  const next = Math.max(0, Math.min(project.anchors.length - 1, current + step));
  selectFrame(project.anchors[next]);
});

const sliders = [
  ['#ed-scale', 'scale'], ['#ed-x', 'x'], ['#ed-y', 'y'], ['#ed-rotate', 'rotate'],
  ['#ed-hue', 'hue'], ['#ed-sat', 'sat'], ['#ed-contrast', 'contrast'], ['#ed-bright', 'bright']
];
sliders.forEach(([selector, key]) => {
  $(selector).addEventListener('input', event => {
    edit[key] = Number(event.target.value);
    syncOutputs();
    markDirty();
    drawEditor();
  });
});

[['#ed-flip-h', 'flipH'], ['#ed-flip-v', 'flipV'], ['#ed-invert', 'invert']].forEach(([selector, key]) => {
  $(selector).addEventListener('change', event => {
    edit[key] = event.target.checked;
    markDirty();
    drawEditor();
  });
});

$('#file-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) openVideo(file);
});

$('#clip-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) addClip(file, pendingClipPosition);
});

$('#companion-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (pendingCompanion === 'transfer') transferMotion(file);
  else interleaveClip(file);
});

/* The encoding readouts. Motion reach reads "default" at zero rather than 0,
   because leaving it alone is not the same as asking for a search range of
   nothing. */
$('#opt-quality').addEventListener('input', event => {
  $('#out-quality').textContent = event.target.value;
});
$('#opt-merange').addEventListener('input', event => {
  const value = Number(event.target.value);
  $('#out-merange').textContent = value ? String(value) : 'default';
});

$('#image-input').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    edit.image = await loadImage(url);
    edit.sourceLabel = file.name;
    markDirty();
    drawEditor();
    setStatus(`Using “${file.name}”. Apply it to commit.`);
  } catch (error) {
    setStatus(error.message, 'ERROR');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
});

/* Drag a video onto the window to open it. */
['dragover', 'drop'].forEach(type => {
  document.addEventListener(type, event => {
    event.preventDefault();
    if (type === 'drop' && !busy) {
      const file = event.dataTransfer?.files?.[0];
      if (file) openVideo(file);
    }
  });
});

document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea')) return;
  if ($('#about-dialog').open || $('#anchor-picker').open) return;
  const meta = event.ctrlKey || event.metaKey;

  if (meta && event.key === 'z') { event.preventDefault(); undo(); }
  else if (meta && event.key === 'o') { event.preventDefault(); actions.open(); }
  else if (meta && event.key === 'e') { event.preventDefault(); actions['export-mp4'](); }
  else if (meta && event.key === 'Enter') { event.preventDefault(); actions.apply(); }
  else if (meta && event.key === 'p') { event.preventDefault(); actions.preview(); }
  else if (meta && event.key === 'r') { event.preventDefault(); actions.render(); }
  else if (!meta && (event.key === 'Delete' || event.key === 'Backspace')) {
    if (edit.frameIndex !== null) { event.preventDefault(); deleteAnchor(); }
  }
});

/* Opened straight onto a clip, the same way Video Lab is:
   clackmosh/index.html?src=content%2Fmedia%2Fdemo.mp4 */
async function openFromQuery() {
  const src = new URL(location.href).searchParams.get('src');
  if (!src) return;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Could not fetch that video (${response.status}).`);
    const blob = await response.blob();
    await openVideo(new File([blob], src.split('/').pop() || 'video.mp4', { type: blob.type }));
  } catch (error) {
    setStatus(error.message, 'ERROR');
  }
}

/* A preview that cannot be decoded would otherwise just sit there black. */
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  setStatus('This browser will not play the rendered preview — export the file and play it elsewhere.', 'ERROR');
});

syncControls();
setStatus('Open a video to begin. Nothing leaves this tab.', 'IDLE');
openFromQuery();
