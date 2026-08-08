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

const project = {
  file: null,
  sourcePath: null,
  bytes: null,
  frames: [],
  anchors: [],
  anchorImages: [],
  clips: [],
  settings: { width: 480, height: 360, fps: 25, gop: 25, quality: 5, meRange: 0, mv4: false, qpel: false },
  hasAudio: false
};

/* Slider state is a scratch pad for the selected anchor, not part of the
   project: an edit only exists once it has been encoded and spliced in. */
const edit = {
  frameIndex: null,
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
    qpel: $('#opt-qpel').checked
  };
}

/* The encoder settings a frame must have been made with to be spliceable into
   this project — everything that lands in the VOL header, plus the ones that
   simply ought to match so an added clip looks like it belongs. */
function projectEncode() {
  const { gop, quality, meRange, mv4, qpel } = project.settings;
  return { gop, quality, meRange, mv4, qpel };
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
      meRange: settings.meRange, mv4: settings.mv4, qpel: settings.qpel
    };
    project.frames = makeFrames(parsed);
    project.clips = [{ name: file.name, frames: parsed.frames.length }];
    project.anchors = keyframeIndices(parsed.frames);

    canvas.width = parsed.width;
    canvas.height = parsed.height;

    setStatus(`Pulling out ${project.anchors.length} anchor frames…`);
    project.anchorImages = await engine.keyframeThumbnails(
      result.bytes, project.anchors.length, parsed.width
    );

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
      : (edit.frameIndex ?? 0);

    /* Thumbnails are held one per anchor in order, so the incoming clip's
       stills go in at the same ordinal the frames themselves do. */
    const ordinal = project.frames.slice(0, at).filter(frame => frame.type === 'I').length;
    const stills = await engine.keyframeThumbnails(
      result.bytes, keyframeIndices(parsed.frames).length, project.settings.width
    );

    project.frames.splice(at, 0, ...incoming);
    project.anchorImages.splice(ordinal, 0, ...stills);

    /* A join is an anchor that has another clip's picture in front of it —
       delete it and that picture is what the motion carries on from. Dropping
       a clip in creates one wherever something now precedes something else,
       which is both ends of a middle insert and neither the very start of the
       video (there is nothing before it to mosh into) nor past the very end. */
    const after = at + incoming.length;
    if (at > 0) project.frames[at].join = true;
    if (after < project.frames.length) project.frames[after].join = true;
    const joinAt = at > 0 ? at : after;

    project.anchors = keyframeIndices(project.frames);
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
  joins.forEach(frame => { frame.deleted = true; });
  refreshStripState();
  syncControls();
  setStatus(
    `${joins.length} join${joins.length > 1 ? 's' : ''} moshed — each clip now lands on the picture before it.`,
    'READY'
  );
}

function releaseImages() {
  project.anchorImages.forEach(url => { if (url) URL.revokeObjectURL(url); });
  project.anchorImages = [];
  if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
  video.removeAttribute('src');
  video.load();
}

/* ---------- filmstrip ---------- */

function anchorNumber(frameIndex) {
  return project.anchors.indexOf(frameIndex);
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
      const url = project.anchorImages[n];
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

async function selectFrame(index) {
  if (!project.frames.length) return;
  const anchor = anchorGoverning(index);
  edit.frameIndex = anchor;
  resetSliders();
  edit.sourceLabel = 'original';

  const n = anchorNumber(anchor);
  const url = project.anchorImages[n];
  edit.image = url ? await loadImage(url).catch(() => null) : null;

  const frame = project.frames[anchor];
  $('#anchor-label').textContent =
    `anchor ${n + 1} of ${project.anchors.length} · frame ${anchor}` +
    (frame.deleted ? ' · deleted' : frame.edited ? ' · edited' : '');

  drawEditor();
  refreshStripState();
  syncControls();

  const button = $(`#filmstrip .frame[data-index="${anchor}"]`);
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
  if (edit.frameIndex === null) return;
  const index = edit.frameIndex;

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
    const old = project.anchorImages[n];
    project.anchorImages[n] = canvas.toDataURL('image/jpeg', 0.82);
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);

    const img = $(`#filmstrip .frame[data-index="${index}"] img`);
    if (img) img.src = project.anchorImages[n];
    else buildFilmstrip();

    edit.dirty = false;
    $('#apply-button').classList.remove('dirty');
    $('#anchor-label').textContent = `anchor ${n + 1} of ${project.anchors.length} · frame ${index} · edited`;
    refreshStripState();
    setStatus(`Anchor ${n + 1} replaced. Preview the run to see the motion take it.`, 'READY');
  });
}

function deleteAnchor() {
  if (edit.frameIndex === null) return;
  const frame = project.frames[edit.frameIndex];
  frame.deleted = true;
  refreshStripState();
  syncControls();
  const n = anchorNumber(edit.frameIndex);
  $('#anchor-label').textContent = `anchor ${n + 1} of ${project.anchors.length} · frame ${edit.frameIndex} · deleted`;
  setStatus(`Anchor ${n + 1} deleted — the previous picture now runs on through it.`, 'READY');
}

function restoreAnchor() {
  if (edit.frameIndex === null) return;
  project.frames[edit.frameIndex].deleted = false;
  refreshStripState();
  syncControls();
  selectFrame(edit.frameIndex);
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

function replaceStill(ordinal, url) {
  const old = project.anchorImages[ordinal];
  project.anchorImages[ordinal] = url;
  if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
}

async function resetFrame() {
  if (edit.frameIndex === null) return;
  const index = edit.frameIndex;
  const frame = project.frames[index];
  frame.payload = frame.original;
  frame.edited = false;
  frame.deleted = false;

  await withBusy('Putting the original picture back…', async () => {
    replaceStill(anchorNumber(index), await stillFor(frame));
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
    project.anchorImages.forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    project.anchorImages = urls;
    buildFilmstrip();
    await selectFrame(project.anchors[0] ?? 0);
    setStatus('Every edit undone.', 'READY');
  });
}

function bloomAll() {
  if (!project.frames.length) return;
  project.anchors.forEach((index, n) => {
    if (n > 0) project.frames[index].deleted = true;
  });
  refreshStripState();
  syncControls();
  setStatus('Every anchor after the first is gone — the opening picture now has to last the whole video.', 'READY');
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
    const url = project.anchorImages[n];
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
  const frame = selected ? project.frames[edit.frameIndex] : null;

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
  enable('[data-action="reimport"]', !!project.file && !busy);
  enable('[data-action="open"]', !busy);
  enable('[data-action="add-front"]', loaded && !busy);
  enable('[data-action="add-here"]', loaded && selected && !busy);
  enable('[data-action="add-end"]', loaded && !busy);
  enable('[data-action="mosh-joins"]', !busy && project.frames.some(frame => frame.join && !frame.deleted));
}

/* ---------- actions, menus, input ---------- */

let pendingClipPosition = 'end';

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
  about: () => $('#about-dialog').showModal()
};

function closeMenus() {
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
    closeMenus();
  }
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

  if (meta && event.key === 'o') { event.preventDefault(); actions.open(); }
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
