import { BrowserFFmpegEngine, POPCORN } from './ffmpeg-engine.js';
import { FxPool } from './fx-pool.js';
import { catalogue, makeEntry, renderStack, fillPicker, previewBudget, updateDriven } from './fx-stack.js';
import { resolveStack, hasMotion, isMotion } from './fx-motion.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const player = $('#player');
const audioPreview = $('#audio-preview');

const state = {
  assets: new Map(),
  segments: [],
  nextAssetId: 1,
  currentTime: 0,
  segmentIndex: -1,
  playing: false,
  reverse: false,
  speed: 1,
  loop: false,
  bounce: false,
  /* the direction a bounce set off in, so a there-and-back can tell when it is
     back where it started and, without loop, stop there */
  bounceOrigin: false,
  markerA: null,
  markerB: null,
  audioLayer: null,
  canvasWidth: 1280,
  canvasHeight: 720,
  loadToken: 0,
  reverseFrame: 0,
  reverseLast: 0,
  exporting: false,
  insertMode: 'after',
  audioPickMode: 'mix',
  /* the filters applied to every frame, in order — see the effects section */
  effects: []
};

const engine = new BrowserFFmpegEngine({
  onState: value => { $('#engine-state').textContent = `ENGINE: ${value}`; },
  onProgress: value => setProgress(value, `Rendering… ${Math.round(value * 100)}%`)
});

function formatTime(seconds, compact = false) {
  if (!Number.isFinite(seconds)) seconds = 0;
  seconds = Math.max(0, seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  if (compact) {
    const decimalSeconds = (seconds % 60).toFixed(2).padStart(5, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${decimalSeconds}` : `${minutes}:${decimalSeconds}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function setStatus(message, kind = 'ready') {
  $('#status').textContent = message;
  $('#status-light').className = `status-light${kind === 'busy' ? ' busy' : kind === 'error' ? ' error' : ''}`;
}

function setProgress(value, label) {
  $('#progress-wrap').hidden = false;
  $('#progress-bar').style.width = `${Math.round(clamp(value, 0, 1) * 100)}%`;
  $('#progress-label').textContent = label;
}

function projectDuration() {
  return state.segments.reduce((total, segment) => total + segment.end - segment.start, 0);
}

function segmentOffset(index) {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += state.segments[i].end - state.segments[i].start;
  return offset;
}

function locate(globalTime) {
  if (!state.segments.length) return null;
  const total = projectDuration();
  const time = clamp(globalTime, 0, total);
  let offset = 0;
  for (let index = 0; index < state.segments.length; index += 1) {
    const segment = state.segments[index];
    const duration = segment.end - segment.start;
    if (time < offset + duration || index === state.segments.length - 1) {
      const local = clamp(time - offset, 0, duration);
      return { index, segment, offset, local, sourceTime: segment.start + local };
    }
    offset += duration;
  }
  return null;
}

function loopBounds() {
  const total = projectDuration();
  if (state.markerA !== null && state.markerB !== null && Math.abs(state.markerA - state.markerB) > 0.001) {
    return { start: Math.min(state.markerA, state.markerB), end: Math.max(state.markerA, state.markerB) };
  }
  return { start: 0, end: total };
}

function mediaMetadata(url) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('video');
    const timeout = setTimeout(() => finish(new Error('Timed out reading video metadata.')), 12000);
    const finish = value => {
      clearTimeout(timeout);
      probe.removeAttribute('src');
      probe.load();
      value instanceof Error ? reject(value) : resolve(value);
    };
    probe.preload = 'metadata';
    probe.muted = true;
    probe.onloadedmetadata = () => {
      if (!Number.isFinite(probe.duration) || probe.duration <= 0) finish(new Error('No usable video duration.'));
      else finish({ duration: probe.duration, width: probe.videoWidth || 1280, height: probe.videoHeight || 720 });
    };
    probe.onerror = () => finish(new Error('The browser cannot decode this file directly.'));
    probe.src = url;
    probe.load();
  });
}

function revokeAsset(asset) {
  if (asset.originalUrl) URL.revokeObjectURL(asset.originalUrl);
  if (asset.previewUrl && asset.previewUrl !== asset.originalUrl) URL.revokeObjectURL(asset.previewUrl);
}

function clearProject({ announce = true } = {}) {
  pausePlayback();
  discardPrerender();
  for (const asset of state.assets.values()) revokeAsset(asset);
  state.assets.clear();
  state.segments = [];
  state.currentTime = 0;
  state.segmentIndex = -1;
  state.markerA = null;
  state.markerB = null;
  state.loadToken += 1;
  player.removeAttribute('src');
  player.load();
  clearAudio();
  renderTimeline();
  updateUi();
  updateExportPanel();
  if (announce) setStatus('New empty project. Open or drop a video.');
}

async function prepareVideoAsset(file) {
  const asset = {
    id: state.nextAssetId++, file, name: file.name,
    originalUrl: URL.createObjectURL(file), previewUrl: null,
    duration: 0, width: 0, height: 0, hasAudio: null, normalized: false
  };
  asset.previewUrl = asset.originalUrl;
  try {
    Object.assign(asset, await mediaMetadata(asset.previewUrl));
  } catch {
    setStatus(`Converting ${file.name} to a browser preview locally…`, 'busy');
    $('#engine-state').textContent = 'ENGINE: COMPATIBILITY';
    try {
      const previewBlob = await engine.normalizeForPreview(asset);
      asset.previewUrl = URL.createObjectURL(previewBlob);
      asset.normalized = true;
      Object.assign(asset, await mediaMetadata(asset.previewUrl));
    } catch (error) {
      revokeAsset(asset);
      throw error;
    }
  }
  return asset;
}

async function openVideo(file, mode = 'open') {
  if (!file) return;
  if (file.size > 1024 * 1024 * 1024) setStatus('Large file: browser memory may be the limiting factor.', 'busy');
  else setStatus(`Reading ${file.name}…`, 'busy');
  try {
    const asset = await prepareVideoAsset(file);
    if (mode === 'open' || !state.segments.length) {
      clearProject({ announce: false });
      state.assets.set(asset.id, asset);
      state.segments = [{ assetId: asset.id, start: 0, end: asset.duration }];
      state.canvasWidth = asset.width % 2 ? asset.width + 1 : asset.width;
      state.canvasHeight = asset.height % 2 ? asset.height + 1 : asset.height;
      state.currentTime = 0;
    } else {
      state.assets.set(asset.id, asset);
      const active = locate(state.currentTime);
      const insertIndex = mode === 'before' ? active.index : active.index + 1;
      const insertAt = segmentOffset(insertIndex);
      state.segments.splice(insertIndex, 0, { assetId: asset.id, start: 0, end: asset.duration });
      if (state.markerA !== null && state.markerA >= insertAt) state.markerA += asset.duration;
      if (state.markerB !== null && state.markerB >= insertAt) state.markerB += asset.duration;
      if (state.audioLayer && state.audioLayer.startAt >= insertAt) state.audioLayer.startAt += asset.duration;
      state.currentTime = insertAt;
    }
    renderTimeline();
    updateUi();
    updateExportPanel();
    await loadAt(state.currentTime, false);
    setStatus(`${asset.name} ready${asset.normalized ? ' — compatibility preview created in browser.' : '.'}`);
  } catch (error) {
    setStatus(error.message || `Could not open ${file.name}.`, 'error');
  }
}

function renderTimeline() {
  const timeline = $('#clip-timeline');
  timeline.replaceChildren();
  if (!state.segments.length) {
    const empty = document.createElement('span');
    empty.className = 'timeline-empty';
    empty.textContent = 'Open a video to start a timeline.';
    timeline.append(empty);
    $('#clip-count').textContent = '0 clips';
    return;
  }
  const total = projectDuration();
  state.segments.forEach((segment, index) => {
    const asset = state.assets.get(segment.assetId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clip-segment';
    button.dataset.segmentIndex = index;
    button.style.flex = `${Math.max(0.05, (segment.end - segment.start) / total)} 1 0`;
    const name = document.createElement('b');
    name.textContent = asset.name;
    const detail = document.createElement('span');
    detail.textContent = `${formatTime(segment.end - segment.start, true)} · ${index + 1}`;
    button.append(name, detail);
    button.addEventListener('click', () => loadAt(segmentOffset(index), state.playing && !state.reverse));
    timeline.append(button);
  });
  const playhead = document.createElement('span');
  playhead.className = 'timeline-playhead';
  playhead.id = 'timeline-playhead';
  timeline.append(playhead);
  $('#clip-count').textContent = `${state.segments.length} clip${state.segments.length === 1 ? '' : 's'}`;
}

function updateUi() {
  const total = projectDuration();
  state.currentTime = clamp(state.currentTime, 0, total || 0);
  $('#current-time').textContent = formatTime(state.currentTime);
  $('#duration').textContent = formatTime(total);
  $('#project-duration').textContent = total ? formatTime(total, true) : '—';
  $('#project-size').textContent = state.segments.length ? `${state.canvasWidth} × ${state.canvasHeight}` : '—';
  $('#project-direction').textContent = state.bounce
    ? `Bounce · ${state.reverse ? 'back' : 'forward'}`
    : state.reverse ? 'Reverse' : 'Forward';
  $('#seek').disabled = !state.segments.length;
  $('#seek').value = total ? state.currentTime / total * 1000 : 0;
  $('#empty-state').hidden = !!state.segments.length;
  $('#viewer-badge').hidden = !state.segments.length;
  scheduleFxPreview();
  $('#reverse-btn').setAttribute('aria-pressed', String(state.reverse));
  $('#reverse-btn').textContent = state.reverse ? 'REV ON' : 'REV';
  $('#loop-btn').setAttribute('aria-pressed', String(state.loop));
  $('#bounce-btn').setAttribute('aria-pressed', String(state.bounce));
  $('#a-readout').textContent = state.markerA === null ? 'A —' : `A ${formatTime(state.markerA, true)}`;
  $('#b-readout').textContent = state.markerB === null ? 'B —' : `B ${formatTime(state.markerB, true)}`;
  updateMarker($('#marker-a'), state.markerA, total);
  updateMarker($('#marker-b'), state.markerB, total);
  const playhead = $('#timeline-playhead');
  if (playhead) playhead.style.left = `${total ? state.currentTime / total * 100 : 0}%`;
  const active = locate(state.currentTime);
  $$('.clip-segment').forEach((element, index) => element.classList.toggle('active', index === active?.index));
  if (active) {
    const asset = state.assets.get(active.segment.assetId);
    $('#viewer-badge').textContent = `${active.index + 1}/${state.segments.length} · ${asset.name}`;
  }
  if (state.audioLayer) {
    $('#audio-name').textContent = `${state.audioLayer.asset.name} @ ${formatTime(state.audioLayer.startAt, true)}`;
  }
}

function updateMarker(element, value, total) {
  element.hidden = value === null || !total;
  if (!element.hidden) element.style.left = `${clamp(value / total * 100, 0, 100)}%`;
}

async function waitForMetadata(token) {
  if (player.readyState >= 1) return;
  await new Promise((resolve, reject) => {
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Preview could not be loaded.')); };
    const cleanup = () => {
      player.removeEventListener('loadedmetadata', loaded);
      player.removeEventListener('error', failed);
    };
    player.addEventListener('loadedmetadata', loaded, { once: true });
    player.addEventListener('error', failed, { once: true });
  });
  if (token !== state.loadToken) throw new Error('Superseded preview load.');
}

async function loadAt(globalTime, autoplay = false) {
  const found = locate(globalTime);
  if (!found) return;
  state.currentTime = clamp(globalTime, 0, projectDuration());
  const asset = state.assets.get(found.segment.assetId);
  const token = ++state.loadToken;
  try {
    if (player.dataset.assetId !== String(asset.id)) {
      player.pause();
      player.src = asset.previewUrl;
      player.dataset.assetId = String(asset.id);
      player.load();
      await waitForMetadata(token);
    }
    if (token !== state.loadToken) return;
    state.segmentIndex = found.index;
    player.playbackRate = state.speed;
    player.muted = state.reverse || state.audioLayer?.mode === 'replace';
    if (Math.abs(player.currentTime - found.sourceTime) > 0.025) player.currentTime = found.sourceTime;
    updateUi();
    syncAudioPreview(autoplay);
    if (autoplay && !state.reverse) await player.play();
  } catch (error) {
    if (!/Superseded/.test(error.message)) setStatus(error.message, 'error');
  }
}

function pausePlayback() {
  state.playing = false;
  player.pause();
  audioPreview.pause();
  cancelAnimationFrame(state.reverseFrame);
  state.reverseFrame = 0;
  state.reverseLast = 0;
  $('#play-symbol').innerHTML = '<span class="pixel-icon" data-icon="play" aria-hidden="true"></span>';
}

async function startPlayback() {
  if (!state.segments.length || state.playing) return;
  const bounds = loopBounds();
  if (!state.reverse && state.currentTime >= bounds.end - 0.01) state.currentTime = bounds.start;
  if (state.reverse && state.currentTime <= bounds.start + 0.01) state.currentTime = bounds.end;
  state.bounceOrigin = state.reverse;
  state.playing = true;
  $('#play-symbol').innerHTML = '<span class="pause-bars" aria-hidden="true"></span>';
  if (state.reverse) {
    player.pause();
    audioPreview.pause();
    player.muted = true;
    state.reverseLast = 0;
    state.reverseFrame = requestAnimationFrame(reverseTick);
    setStatus(`Playing in reverse at ${state.speed}×. Reverse preview audio is muted.`);
  } else {
    await loadAt(state.currentTime, true);
    setStatus(`Playing at ${state.speed}×.`);
  }
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
    setStatus('Paused.');
  } else startPlayback();
}

/* A bounce turns round at each end of the loop range. The turn is refused once
   the run is back in the direction it began in and loop is off — that is one
   complete there-and-back, which is what bounce on its own means. */
function bounceTurnAllowed() {
  if (!state.bounce || !state.segments.length) return false;
  const bounds = loopBounds();
  if (bounds.end - bounds.start < 0.05) return false;
  const nextReverse = !state.reverse;
  return state.loop || nextReverse !== state.bounceOrigin;
}

/* Turn round mid-run without stopping: the transport stays "playing" and only
   the direction, and therefore which clock drives it, changes. */
function flipDirection() {
  state.reverse = !state.reverse;
  cancelAnimationFrame(state.reverseFrame);
  state.reverseFrame = 0;
  player.muted = state.reverse || state.audioLayer?.mode === 'replace';
  updateUi();
  if (state.reverse) {
    player.pause();
    audioPreview.pause();
    player.muted = true;
    state.reverseLast = 0;
    state.reverseFrame = requestAnimationFrame(reverseTick);
  } else {
    loadAt(state.currentTime, true);
  }
  setStatus(`Bouncing ${state.reverse ? 'back' : 'forward'} at ${state.speed}×.`);
}

function reverseTick(now) {
  if (!state.playing || !state.reverse) return;
  if (!state.reverseLast) state.reverseLast = now;
  const elapsed = Math.min(0.1, (now - state.reverseLast) / 1000);
  state.reverseLast = now;
  const bounds = loopBounds();
  let target = state.currentTime - elapsed * state.speed;
  if (target <= bounds.start) {
    if (bounceTurnAllowed()) {
      state.currentTime = bounds.start;
      flipDirection();
      return;
    }
    if (state.loop) target = bounds.end;
    else {
      state.currentTime = bounds.start;
      loadAt(state.currentTime, false);
      pausePlayback();
      setStatus(state.bounce ? 'Bounce complete.' : 'Reached the start.');
      return;
    }
  }
  const found = locate(target);
  if (found?.index === state.segmentIndex && player.readyState >= 1) {
    state.currentTime = target;
    if ('fastSeek' in player) player.fastSeek(found.sourceTime);
    else player.currentTime = found.sourceTime;
    updateUi();
  } else {
    loadAt(target, false);
  }
  state.reverseFrame = requestAnimationFrame(reverseTick);
}

function setReverse(value, play = false) {
  const wasPlaying = state.playing;
  pausePlayback();
  state.reverse = value;
  player.muted = value || state.audioLayer?.mode === 'replace';
  updateUi();
  if (play || wasPlaying) startPlayback();
  else setStatus(value ? 'Reverse playback armed. Press play.' : 'Forward playback armed.');
}

function syncAudioPreview(shouldPlay = state.playing && !state.reverse) {
  const layer = state.audioLayer;
  player.muted = state.reverse || layer?.mode === 'replace';
  if (!layer || state.reverse) {
    audioPreview.pause();
    return;
  }
  audioPreview.volume = Math.min(1, layer.gain);
  audioPreview.playbackRate = state.speed;
  const layerTime = state.currentTime - layer.startAt;
  if (layerTime < 0) {
    audioPreview.pause();
    audioPreview.currentTime = 0;
    return;
  }
  const sourceTime = layer.sourceStart + layerTime;
  if (Number.isFinite(audioPreview.duration) && sourceTime >= audioPreview.duration) {
    audioPreview.pause();
    return;
  }
  if (Math.abs(audioPreview.currentTime - sourceTime) > 0.25) audioPreview.currentTime = Math.max(0, sourceTime);
  if (shouldPlay) audioPreview.play().catch(() => {});
}

function advanceForward() {
  if (!state.playing || state.reverse) return;
  const found = locate(state.currentTime);
  const bounds = loopBounds();
  const atEnd = state.currentTime >= bounds.end - 0.035;
  if (atEnd && bounceTurnAllowed()) {
    /* stop a hair short of the end so the reverse leg has somewhere to go */
    state.currentTime = Math.max(bounds.start, bounds.end - 0.001);
    flipDirection();
  } else if (atEnd && state.loop) {
    loadAt(bounds.start, true);
  } else if (!atEnd && found && found.index < state.segments.length - 1) {
    loadAt(segmentOffset(found.index + 1), true);
  } else if (state.loop) {
    loadAt(bounds.start, true);
  } else {
    state.currentTime = bounds.end;
    pausePlayback();
    updateUi();
    setStatus(state.bounce ? 'Bounce complete.' : 'Playback complete.');
  }
}

player.addEventListener('timeupdate', () => {
  if (!state.playing || state.reverse || state.segmentIndex < 0) return;
  const segment = state.segments[state.segmentIndex];
  if (!segment) return;
  const offset = segmentOffset(state.segmentIndex);
  state.currentTime = clamp(offset + player.currentTime - segment.start, 0, projectDuration());
  const bounds = loopBounds();
  if ((state.loop && state.currentTime >= bounds.end - 0.035) || player.currentTime >= segment.end - 0.035) advanceForward();
  else {
    updateUi();
    syncAudioPreview(true);
  }
});
player.addEventListener('ended', advanceForward);

function setMarker(which) {
  if (!state.segments.length) return;
  if (which === 'a') state.markerA = state.currentTime;
  else state.markerB = state.currentTime;
  updateUi();
  setStatus(`${which.toUpperCase()} marker set at ${formatTime(state.currentTime)}.`);
}

function clearMarkers() {
  state.markerA = null;
  state.markerB = null;
  updateUi();
  setStatus('A/B markers cleared. Loop now uses the full timeline.');
}

function cutBefore() {
  const found = locate(state.currentTime);
  if (!found) return;
  pausePlayback();
  const removed = state.currentTime;
  const replacement = { ...found.segment, start: found.sourceTime };
  state.segments = [replacement, ...state.segments.slice(found.index + 1)].filter(segment => segment.end - segment.start > 0.001);
  if (state.markerA !== null) state.markerA = Math.max(0, state.markerA - removed);
  if (state.markerB !== null) state.markerB = Math.max(0, state.markerB - removed);
  if (state.audioLayer) {
    if (state.audioLayer.startAt >= removed) state.audioLayer.startAt -= removed;
    else {
      state.audioLayer.sourceStart += removed - state.audioLayer.startAt;
      state.audioLayer.startAt = 0;
    }
  }
  state.currentTime = 0;
  trimMarkers();
  renderTimeline();
  updateUi();
  updateExportPanel();
  loadAt(0, false);
  setStatus('Cut everything before the playhead.');
}

function cutAfter() {
  const found = locate(state.currentTime);
  if (!found) return;
  pausePlayback();
  const replacement = { ...found.segment, end: found.sourceTime };
  state.segments = [...state.segments.slice(0, found.index), replacement].filter(segment => segment.end - segment.start > 0.001);
  state.currentTime = projectDuration();
  trimMarkers();
  renderTimeline();
  updateUi();
  updateExportPanel();
  loadAt(state.currentTime, false);
  setStatus('Cut everything after the playhead.');
}

function trimMarkers() {
  const total = projectDuration();
  if (state.markerA !== null) state.markerA = clamp(state.markerA, 0, total);
  if (state.markerB !== null) state.markerB = clamp(state.markerB, 0, total);
}

function chooseInsert(mode) {
  if (!state.segments.length) return $('#video-picker').click();
  state.insertMode = mode;
  $('#insert-picker').click();
}

function chooseAudio(mode) {
  state.audioPickMode = mode;
  $(`input[name="audio-mode"][value="${mode}"]`).checked = true;
  $('#audio-picker').click();
}

function installAudio(file, mode) {
  if (!file) return;
  clearAudio();
  const asset = { id: state.nextAssetId++, file, name: file.name, hasAudio: null };
  const url = URL.createObjectURL(file);
  state.audioLayer = { asset, url, mode, gain: Number($('#audio-gain').value) / 100, startAt: state.currentTime, sourceStart: 0 };
  audioPreview.src = url;
  audioPreview.load();
  $('#audio-name').textContent = `${file.name} @ ${formatTime(state.currentTime, true)}`;
  $('#audio-drop').classList.add('has-audio');
  player.muted = mode === 'replace' || state.reverse;
  syncAudioPreview(false);
  setStatus(`${file.name} will ${mode === 'replace' ? 'replace' : 'mix over'} audio from the playhead.`);
}

function clearAudio() {
  if (state.audioLayer?.url) URL.revokeObjectURL(state.audioLayer.url);
  state.audioLayer = null;
  audioPreview.pause();
  audioPreview.removeAttribute('src');
  audioPreview.load();
  player.muted = state.reverse;
  $('#audio-name').textContent = 'No extra audio';
  $('#audio-drop').classList.remove('has-audio');
}

const humanBytes = bytes => {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/* An image sequence and a raw dump both grow with the length of the project,
   and a tab that runs out of memory does it after several minutes of work. So
   the panel says up front how big the render will be, and refuses outright
   past the point where it is not going to finish. */
const IMAGE_FRAME_LIMIT = 1200;
const RAW_BYTE_LIMIT = 700 * 1024 * 1024;

/* A filtered video export goes out to stills and back — see the engine's
   exportWithEffects — so it is governed by the frame count the way the image
   sequence is, and by the same memory ceiling. Thirty frames a second keeps
   ordinary motion; the limit is forty seconds of it. */
const EFFECT_RENDER_FPS = 30;
const EFFECT_FRAME_LIMIT = 1200;

function exportSettings() {
  const bake = $('#bake-playback').checked;
  return {
    target: $('#export-target').value,
    bake,
    speed: bake ? state.speed : 1,
    reverse: bake ? state.reverse : false,
    bounce: bake ? state.bounce : false,
    format: $('#format').value,
    extension: $('#custom-extension').value.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin',
    framing: $('#raw-framing').value,
    streams: $('#raw-streams').value,
    imageFormat: $('#image-format').value,
    fps: Number($('#image-fps').value),
    maxWidth: Number($('#image-width').value),
    baseName: ($('#export-name').value.trim() || 'clack-video').replace(/[<>:"/\\|?*]+/g, '-')
  };
}

/* How long the rendered result runs, which is not the timeline length once
   speed and bounce are in play. */
function renderedDuration(settings) {
  const speed = Math.abs(settings.speed) > 0.0001 ? Math.abs(settings.speed) : 1;
  return (projectDuration() / speed) * (settings.bounce ? 2 : 1);
}

function exportEstimate(settings) {
  if (!state.segments.length) return { text: 'Open a video to size the export.', heavy: false };
  const seconds = renderedDuration(settings);
  if (settings.target === 'raw') {
    const videoBytes = settings.streams === 'audio' ? 0 : seconds * POPCORN.videoBytesPerSecond;
    const audioBytes = settings.streams === 'video' ? 0 : seconds * POPCORN.audioBytesPerSecond;
    const total = videoBytes + audioBytes;
    const parts = [];
    if (videoBytes) parts.push(`${humanBytes(videoBytes)} of .rgb`);
    if (audioBytes) parts.push(`${humanBytes(audioBytes)} of .pcm`);
    return {
      text: `${formatTime(seconds, true)} at ${POPCORN.width}×${POPCORN.height}/${POPCORN.fps} → ${parts.join(' + ')}. ` +
        (total > RAW_BYTE_LIMIT ? 'Too big for one browser tab — cut the project shorter.' : 'Uncompressed, so it grows fast.'),
      heavy: total > RAW_BYTE_LIMIT
    };
  }
  if (settings.target === 'images') {
    const frames = Math.max(1, Math.ceil(seconds * settings.fps));
    const edge = settings.maxWidth || state.canvasWidth;
    /* rough: a PNG of this width lands near a third of a byte per pixel, JPEG
       nearer a tenth — enough to tell a sane export from a hopeless one */
    const perFrame = edge * (edge * 9 / 16) * (settings.imageFormat === 'jpg' ? 0.1 : 0.35);
    return {
      text: `${frames} frame${frames === 1 ? '' : 's'} at ${settings.fps} fps → roughly ${humanBytes(frames * perFrame)} zipped. ` +
        (frames > IMAGE_FRAME_LIMIT ? `Over the ${IMAGE_FRAME_LIMIT}-frame ceiling — drop the frame rate or cut the project shorter.` : 'Each frame is read out and dropped as it is written.'),
      heavy: frames > IMAGE_FRAME_LIMIT
    };
  }
  const label = settings.format === 'custom' ? settings.extension.toUpperCase() : settings.format.toUpperCase();
  const active = state.effects.filter(entry => !entry.bypass && !isMotion(entry.kind)).length;
  const audioOnly = ['mp3', 'wav', 'ogg'].includes(settings.format);
  if (active && !audioOnly) {
    const frames = Math.max(1, Math.ceil(seconds * EFFECT_RENDER_FPS));
    return {
      text: `${formatTime(seconds, true)} of ${label}, ${frames} frames through ${active} effect${active === 1 ? '' : 's'}. ` +
        (frames > EFFECT_FRAME_LIMIT
          ? `Over the ${EFFECT_FRAME_LIMIT}-frame ceiling a filtered render can hold — cut the project shorter.`
          : 'Filtered frames go out to stills and back, so this takes noticeably longer than an untouched export.'),
      heavy: frames > EFFECT_FRAME_LIMIT
    };
  }
  return { text: `${formatTime(seconds, true)} of ${label} rendered in this tab.`, heavy: false };
}

function updateExportPanel() {
  /* The pre-render plan is priced off the same things an export is — the clip,
     the markers, whether a render is already running — so it is refreshed from
     the same places rather than hooked up to each of them separately. */
  updatePrerenderNote();
  const settings = exportSettings();
  $('#video-options').hidden = settings.target !== 'video';
  $('#raw-options').hidden = settings.target !== 'raw';
  $('#image-options').hidden = settings.target !== 'images';
  $('#custom-extension-field').hidden = settings.target !== 'video' || settings.format !== 'custom';
  const estimate = exportEstimate(settings);
  $('#export-estimate').textContent = estimate.text;
  $('#export-estimate').classList.toggle('heavy', estimate.heavy);
  $('#export-note').textContent = settings.target === 'raw'
    ? `Popcorn's converter wants ${POPCORN.width}×${POPCORN.height} ${POPCORN.fps}fps rgb24 and ${POPCORN.sampleRate / 1000} kHz stereo s16le, which is what these two files are. Feed them to it as: converter movie.rgb movie.pcm movie.pl2`
    : 'The version-pinned FFmpeg core is about 31 MB and loads on first use. It runs in a browser worker; nothing is uploaded.';
}

function download(blob, name) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 30000);
  return name;
}

async function exportProject() {
  if (!state.segments.length || state.exporting) {
    if (!state.segments.length) setStatus('Open a video before exporting.', 'error');
    return;
  }
  const settings = exportSettings();
  const estimate = exportEstimate(settings);
  if (estimate.heavy) {
    setStatus(estimate.text, 'error');
    return;
  }
  const project = {
    segments: state.segments,
    assets: state.assets,
    audioLayer: state.audioLayer,
    width: state.canvasWidth,
    height: state.canvasHeight,
    speed: settings.speed,
    reverse: settings.reverse,
    bounce: settings.bounce
  };
  /* Every export route takes the same per-frame filter, so an effect stack
     applies to a video, an image sequence and a Popcorn dump alike. Full size,
     not the preview's reduced one. */
  const filters = fxStack().filter(entry => !isMotion(entry.kind));
  const colours = fxColours();
  /* Each export route hands its frames over at its own rate, so the filter is
     built knowing which one, and turns a frame number back into the project
     time the motion sources are written against. */
  const filterAt = fps => (image, index) =>
    ensureFxPool().render(image, stackAt(projectTimeFor(index / fps, settings)).stack, colours);
  const filterFrame = filters.length ? filterAt(EFFECT_RENDER_FPS) : null;

  state.exporting = true;
  $('.export-btn').disabled = true;
  $('#cancel-export').hidden = false;
  setProgress(0, 'Loading local FFmpeg engine…');
  setStatus(filters.length
    ? `Preparing browser-only export with ${filters.length} effect${filters.length === 1 ? '' : 's'} on every frame. This takes longer than an untouched export.`
    : 'Preparing browser-only export. This can take a while for long files.', 'busy');
  try {
    if (settings.target === 'raw') {
      const { files } = await engine.exportRaw({
        ...project, framing: settings.framing, streams: settings.streams,
        filterFrame: filters.length ? filterAt(POPCORN.fps) : null
      });
      setProgress(1, 'Export complete.');
      const written = files.map(file => download(file.blob, `${settings.baseName}.${file.name.split('.').pop()}`));
      setStatus(settings.streams === 'both'
        ? `Wrote ${written.join(' and ')}. Run: converter ${written[0]} ${written[1]} movie.pl2`
        : `Wrote ${written[0]}. Popcorn's converter needs the other half too — export it with Write set to ${settings.streams === 'video' ? 'audio' : 'video'} only.`);
    } else if (settings.target === 'images') {
      const result = await engine.exportImages({
        ...project,
        fps: settings.fps,
        imageFormat: settings.imageFormat,
        maxWidth: settings.maxWidth,
        maxFrames: IMAGE_FRAME_LIMIT,
        baseName: settings.baseName,
        filterFrame: filters.length ? filterAt(settings.fps) : null
      });
      setProgress(1, 'Export complete.');
      const name = download(result.blob, `${settings.baseName}-frames.zip`);
      setStatus(`Zipped ${result.frames} ${result.extension.toUpperCase()} frame${result.frames === 1 ? '' : 's'} into ${name}.`);
    } else if (filterFrame && settings.format !== 'mp3' && settings.format !== 'wav' && settings.format !== 'ogg') {
      /* A filtered video cannot go through the single FFmpeg graph, because the
         filters are not FFmpeg's — see exportWithEffects. Audio-only formats
         have no frames to filter, so they take the ordinary route. */
      const result = await engine.exportWithEffects({
        ...project,
        format: settings.format,
        extension: settings.extension,
        fps: EFFECT_RENDER_FPS,
        maxFrames: EFFECT_FRAME_LIMIT,
        filterFrame,
        onStage: message => setProgress(0, message)
      });
      setProgress(1, 'Export complete.');
      const name = download(result.blob, `${settings.baseName}.${result.extension}`);
      setStatus(`Exported ${name} — ${result.frames} frames through ${filters.length} effect${filters.length === 1 ? '' : 's'}, entirely in this browser.`);
    } else {
      const result = await engine.exportProject({ ...project, format: settings.format, extension: settings.extension });
      setProgress(1, 'Export complete.');
      const name = download(result.blob, `${settings.baseName}.${result.extension}`);
      setStatus(`Exported ${name} entirely in this browser.`);
    }
  } catch (error) {
    console.error('Video Lab export failed:', error);
    engine.cancel();
    setProgress(0, 'Export failed.');
    const message = error?.message || String(error) || 'Unknown export error';
    const detail = /memory|abort/i.test(message) ? 'The browser may have run out of memory; try a shorter clip or smaller source.' : message;
    setStatus(`Export failed: ${detail}`, 'error');
  } finally {
    state.exporting = false;
    $('.export-btn').disabled = false;
    $('#cancel-export').hidden = true;
  }
}

/* File → Export → … picks the target and then hands over to the panel, which
   is where the settings for it live. */
function chooseExportTarget(target) {
  $('#export-target').value = target;
  updateExportPanel();
  $('#export-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#export-target').focus({ preventScroll: true });
  setStatus(target === 'raw'
    ? 'Raw Popcorn export selected. Check the framing, then export.'
    : target === 'images' ? 'Image sequence selected. Check the frame rate and size, then export.'
      : 'Video export selected. Pick a format, then export.');
}

function cancelExport() {
  if (!state.exporting) return;
  engine.cancel();
  /* frames already queued for filtering would otherwise carry on arriving
     after the engine that asked for them has gone */
  fxPool?.cancel('Export cancelled.');
  state.exporting = false;
  $('.export-btn').disabled = false;
  $('#cancel-export').hidden = true;
  setProgress(0, 'Export cancelled.');
  setStatus('Export cancelled. The local engine was reset.');
}

/* ---- effects -------------------------------------------------------------
   The stack is a list of filters applied to every frame in order. Nothing is
   ever written back into the clip: the preview draws over the player and the
   export runs the same stack again at full size, so switching an effect off
   restores the original picture exactly.

   The preview runs at a fraction of the frame's size, because the filters cost
   what they cost — Pixel Sorting is around 85 ms for a 720p frame — and a
   preview that arrives after the frame it was meant for has already gone is
   worse than a smaller one that keeps up. previewBudget() works out how small
   from the filters in the stack and how many of them there are. */

const fxCanvas = $('#fx-canvas');
const fxContext = fxCanvas.getContext('2d', { willReadFrequently: true });
/* the frame is drawn here at preview size and read back; kept between frames
   so a render loop does not allocate a canvas per frame */
const fxScratch = document.createElement('canvas');
const fxScratchContext = fxScratch.getContext('2d', { willReadFrequently: true });

let fxPool = null;
let fxBusy = false;
let fxDirty = false;
let fxFailure = '';
let fxFrame = 0;

function fxStack() {
  return state.effects.filter(entry => !entry.bypass);
}

function fxColours() {
  return { fg: $('#fx-fg').value, bg: $('#fx-bg').value, palette: [] };
}

/* What the motion sources need to know beyond the clock: how long the project
   is, and which stretch a ramp should run across. */
function motionContext() {
  const marked = state.markerA !== null && state.markerB !== null;
  return {
    range: loopBounds(),
    duration: projectDuration(),
    marked,
    audio: null
  };
}

/* The stack as it stands at one instant of project time, with every motion card
   already folded into the numbers. This is the only thing the workers ever see;
   they are never told that motion exists.

   Called from the preview, the pre-render walk and the export alike, so all
   three agree by construction rather than by being kept in step. */
function stackAt(time) {
  return resolveStack(state.effects, time, motionContext());
}

/* An export measures time from the first rendered frame, which is not project
   time once speed, reverse or bounce have been baked in. Motion follows the
   picture rather than the render — slow the footage and a wobble slows with it
   — so output time is walked back through the same three steps the FFmpeg graph
   applies, in reverse order: bounce, then speed, then reverse. */
function projectTimeFor(outputTime, settings) {
  const total = projectDuration();
  const speed = Math.abs(settings.speed) > 0.0001 ? Math.abs(settings.speed) : 1;
  let time = outputTime;
  if (settings.bounce) {
    const oneWay = total / speed;
    if (time > oneWay) time = Math.max(0, 2 * oneWay - time);
  }
  time *= speed;
  if (settings.reverse) time = total - time;
  return Math.max(0, Math.min(total, time));
}

function ensureFxPool() {
  if (!fxPool) fxPool = new FxPool();
  return fxPool;
}

/* The preview frame's size: the clip's aspect, scaled until it fits the budget
   the stack can afford, and never larger than the frame itself. */
function previewSize() {
  const width = state.canvasWidth || 1280;
  const height = state.canvasHeight || 720;
  const budget = previewBudget(state.effects);
  const scale = Math.min(1, Math.sqrt(budget / (width * height)));
  return {
    width: Math.max(2, Math.round(width * scale / 2) * 2),
    height: Math.max(2, Math.round(height * scale / 2) * 2)
  };
}

async function drawFxPreview() {
  const stack = fxStack().filter(entry => !isMotion(entry.kind));
  if (!stack.length || !state.segments.length) return;

  /* A pre-rendered frame is just a bitmap to blit, so it is drawn before any of
     the filtering machinery is consulted — that is the whole point of it. */
  const held = usablePrerender();
  if (held) {
    const index = Math.round((state.currentTime - held.from) * held.fps);
    const frame = held.frames[Math.max(0, Math.min(held.frames.length - 1, index))];
    if (frame && state.currentTime >= held.from - 0.05 && state.currentTime <= held.to + 0.05) {
      if (fxCanvas.width !== held.width || fxCanvas.height !== held.height) {
        fxCanvas.width = held.width; fxCanvas.height = held.height;
      }
      fxContext.drawImage(frame, 0, 0);
      showMotion(stackAt(state.currentTime), state.currentTime);
      if (state.playing) scheduleFxPreview();
      return;
    }
  }

  if (fxBusy) { fxDirty = true; return; }
  if (player.readyState < 2) return;
  fxBusy = true;
  fxDirty = false;
  try {
    const { width, height } = previewSize();
    if (fxScratch.width !== width || fxScratch.height !== height) {
      fxScratch.width = width; fxScratch.height = height;
      fxCanvas.width = width; fxCanvas.height = height;
    }
    fxScratchContext.drawImage(player, 0, 0, width, height);
    const frame = fxScratchContext.getImageData(0, 0, width, height);
    const moment = stackAt(state.currentTime);
    const filtered = await ensureFxPool().render(frame, moment.stack, fxColours());
    fxContext.putImageData(filtered, 0, 0);
    showMotion(moment, state.currentTime);
    if (fxFailure) { fxFailure = ''; updateFxNote(); }
  } catch (error) {
    /* a filter that throws on one frame would otherwise throw on all of them,
       so it is reported once rather than every frame */
    const message = error?.message || String(error);
    if (message !== fxFailure && !/cancel/i.test(message)) {
      fxFailure = message;
      updateFxNote();
    }
  } finally {
    fxBusy = false;
    /* While the clip plays the preview keeps asking for the next frame the
       moment it has finished the last, which is what makes an expensive stack
       degrade into a slower preview rather than a stuck one. */
    if (fxDirty || state.playing) scheduleFxPreview();
  }
}

/* Called from the transport, the seek bar and the playback loops. While a clip
   plays this asks for a new preview as often as the filters can answer, which
   for a cheap stack is every frame and for an expensive one is not. */
function scheduleFxPreview() {
  if (!fxStack().length) return;
  /* a cached frame costs nothing to draw, so it never waits for the filter */
  if (fxBusy && !prerender) { fxDirty = true; return; }
  /* One frame in the air at a time. The cached path draws and immediately asks
     for the next, so without this every caller that schedules a preview would
     start a chain of its own and they would all keep running. */
  if (fxFrame) return;
  fxFrame = requestAnimationFrame(() => { fxFrame = 0; drawFxPreview(); });
}

/* The amber markers, the scope playheads and the live readouts. Written every
   preview frame; nothing here reads the layout, so it is cheap enough to. */
function showMotion(moment, time) {
  if (!state.effects.some(entry => isMotion(entry.kind))) return;
  updateDriven($('#fx-stack'), {
    effects: state.effects, drivers: moment.drivers, time, context: motionContext()
  });
}

function updateFxNote() {
  const note = $('#fx-note');
  const active = fxStack().length;
  if (fxFailure) {
    note.textContent = `That stack failed on this frame: ${fxFailure}`;
    note.classList.add('heavy');
    return;
  }
  note.classList.remove('heavy');
  if (!state.effects.length) {
    note.textContent = 'Effects run on every frame. The preview works at a reduced size to keep up; the export renders at full size.';
    return;
  }
  const { width, height } = previewSize();
  const live = prerender ? `Playing back pre-rendered frames at ${prerender.width} × ${prerender.height}` : `Previewing at ${width} × ${height}`;
  const filters = fxStack().filter(entry => !isMotion(entry.kind)).length;
  const motions = fxStack().filter(entry => isMotion(entry.kind)).length;
  if (!filters) {
    note.textContent = motions
      ? 'Nothing to render yet — motion cards move a filter\u2019s controls, so add a filter for them to drive.'
      : 'Every effect is switched off — the clip plays untouched.';
    return;
  }
  const moving = motions ? ` and ${motions} motion${motions === 1 ? '' : 's'}` : '';
  note.textContent = `${filters} effect${filters === 1 ? '' : 's'}${moving} on every frame. ${live}; the export renders at ${state.canvasWidth} × ${state.canvasHeight}.`;
}

/* ---- pre-rendering -------------------------------------------------------
   Some stacks are simply too slow to keep up with playback: Radial Blur is the
   better part of a second a frame, and no amount of shrinking the preview makes
   that into twenty-five frames a second. Pre-render walks the clip once, filters
   every frame at leisure and keeps the results, after which playback is just
   drawing bitmaps and runs at full speed.

   The frames are held as ImageBitmaps, which the compositor can draw without
   touching the main thread, and which is also what makes the size of the cache
   the thing that governs everything. A 1280 × 720 frame is 3.7 MB, so a
   ten-second clip of them at 25fps is nearly a gigabyte. Rather than offer a
   resolution control nobody can price in their head, the cache works out how
   large it can afford to be from how many frames it has been asked for, and
   says so before anything is rendered.

   Capture happens on a video element of its own rather than the one on screen.
   Seeking the player would fight whatever the person is doing with it, and this
   way the clip stays scrubbable while the render runs behind it. */

const PRERENDER_FPS = 25;
const PRERENDER_BYTE_BUDGET = 384 * 1024 * 1024;
/* Below this the cache is too coarse to be judging anything by, so a range that
   cannot be held at this width is refused rather than rendered into mud. */
const PRERENDER_MIN_WIDTH = 256;

const prerenderVideo = document.createElement('video');
prerenderVideo.muted = true;
prerenderVideo.preload = 'auto';
prerenderVideo.playsInline = true;

let prerender = null;      /* { frames, fps, from, to, width, height, signature } */
let prerenderToken = 0;
let prerendering = false;

/* Everything the filtered picture depends on. If any of it moves, the frames in
   hand are of something else and have to go. */
function prerenderSignature() {
  return JSON.stringify({
    stack: fxStack().map(entry => [entry.kind, entry.values]),
    colours: fxColours(),
    segments: state.segments.map(segment => [segment.assetId, segment.start, segment.end])
  });
}

function discardPrerender(reason = '') {
  if (prerender) {
    for (const frame of prerender.frames) frame?.close?.();
    prerender = null;
  }
  fxCanvas.classList.remove('cached');
  if (reason) setStatus(reason);
}

/* The cache, but only while it is still of the right thing. */
function usablePrerender() {
  if (!prerender) return null;
  if (prerender.signature !== prerenderSignature()) { discardPrerender(); updatePrerenderNote(); return null; }
  return prerender;
}

const prerenderRange = () => {
  const bounds = loopBounds();
  return { from: bounds.start, to: bounds.end };
};

/* How big a cache of this range would be, and whether it fits. */
function prerenderPlan() {
  const { from, to } = prerenderRange();
  const seconds = Math.max(0, to - from);
  const frames = Math.max(1, Math.round(seconds * PRERENDER_FPS));
  const full = { width: state.canvasWidth || 1280, height: state.canvasHeight || 720 };
  const perFrame = PRERENDER_BYTE_BUDGET / frames;
  const scale = Math.min(1, Math.sqrt(perFrame / (full.width * full.height * 4)));
  const width = Math.max(2, Math.round(full.width * scale / 2) * 2);
  const height = Math.max(2, Math.round(full.height * scale / 2) * 2);
  return {
    from, to, seconds, frames, width, height,
    bytes: frames * width * height * 4,
    tooLong: width < PRERENDER_MIN_WIDTH
  };
}

function updatePrerenderNote() {
  const note = $('#fx-prerender-note');
  const button = $('#fx-prerender-btn');
  const clear = $('#fx-prerender-clear');
  const live = fxStack().length > 0;

  button.disabled = !live || !state.segments.length || state.exporting;
  clear.hidden = !prerender;

  if (prerendering) return;
  button.innerHTML = '<span class="pixel-icon" data-icon="zap" aria-hidden="true"></span> Pre-render';

  if (!live || !state.segments.length) {
    note.textContent = '';
    note.classList.remove('ready');
    return;
  }
  const held = usablePrerender();
  if (held) {
    note.classList.add('ready');
    note.textContent = `Playing back ${held.frames.length} pre-rendered frames at ${held.width} × ${held.height}. ` +
      'Changing the stack or the clip throws them away.';
    return;
  }
  note.classList.remove('ready');
  const plan = prerenderPlan();
  const range = state.markerA !== null && state.markerB !== null ? 'between A and B' : 'the whole project';
  note.textContent = plan.tooLong
    ? `Too long to pre-render ${range} — ${plan.frames} frames would not fit in memory at a useful size. Set A and B markers around a shorter stretch.`
    : `Pre-render ${range}: ${plan.frames} frames at ${plan.width} × ${plan.height}, about ${humanBytes(plan.bytes)} held in memory. Playback is then full speed.`;
}

function loadPrerenderSource(url) {
  if (prerenderVideo.dataset.url === url) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); prerenderVideo.dataset.url = url; resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not open that clip for pre-rendering.')); };
    const cleanup = () => {
      prerenderVideo.removeEventListener('loadeddata', done);
      prerenderVideo.removeEventListener('error', fail);
    };
    prerenderVideo.addEventListener('loadeddata', done);
    prerenderVideo.addEventListener('error', fail);
    prerenderVideo.src = url;
    prerenderVideo.load();
  });
}

/* A seek to where the video already is fires no `seeked`, which would hang the
   walk on the first frame of every segment. */
function seekPrerenderSource(time) {
  if (Math.abs(prerenderVideo.currentTime - time) < 0.0005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not seek that clip while pre-rendering.')); };
    const cleanup = () => {
      prerenderVideo.removeEventListener('seeked', done);
      prerenderVideo.removeEventListener('error', fail);
    };
    prerenderVideo.addEventListener('seeked', done, { once: true });
    prerenderVideo.addEventListener('error', fail, { once: true });
    prerenderVideo.currentTime = time;
  });
}

async function startPrerender() {
  if (prerendering) { prerenderToken += 1; return; }
  if (!fxStack().some(entry => !isMotion(entry.kind))) { setStatus('Add an effect before pre-rendering.', 'error'); return; }
  if (!state.segments.length) { setStatus('Open a video before pre-rendering.', 'error'); return; }
  if (state.exporting) { setStatus('Wait for the export to finish before pre-rendering.', 'error'); return; }

  const plan = prerenderPlan();
  if (plan.tooLong) { setStatus('That range is too long to pre-render — set A and B markers around a shorter stretch.', 'error'); return; }

  discardPrerender();
  pausePlayback();

  const token = prerenderToken += 1;
  const signature = prerenderSignature();
  const colours = fxColours();
  prerendering = true;
  $('#fx-prerender-btn').innerHTML = '<span class="pixel-icon" data-icon="close" aria-hidden="true"></span> Cancel';
  $('#fx-prerender-note').classList.remove('ready');
  setStatus(`Pre-rendering ${plan.frames} frames. The clip stays scrubbable while this runs.`, 'busy');

  const scratch = document.createElement('canvas');
  scratch.width = plan.width; scratch.height = plan.height;
  const context = scratch.getContext('2d', { willReadFrequently: true });

  const frames = new Array(plan.frames);
  const pool = ensureFxPool();
  /* Seeking is serial and filtering is not, so the walk hands each frame off
     and carries on, holding only enough in flight to keep the pool busy. */
  const inFlight = new Set();
  const limit = Math.max(2, pool.size);
  let done = 0;

  const settle = async () => {
    while (inFlight.size >= limit) await Promise.race(inFlight);
  };

  try {
    for (let index = 0; index < plan.frames; index += 1) {
      if (token !== prerenderToken) throw new Error('cancelled');
      const time = Math.min(plan.to - 0.0001, plan.from + index / PRERENDER_FPS);
      const spot = locate(time);
      if (!spot) break;
      const asset = state.assets.get(spot.segment.assetId);
      if (!asset) break;
      await loadPrerenderSource(asset.previewUrl);
      await seekPrerenderSource(spot.sourceTime);
      if (token !== prerenderToken) throw new Error('cancelled');

      context.drawImage(prerenderVideo, 0, 0, plan.width, plan.height);
      const image = context.getImageData(0, 0, plan.width, plan.height);

      await settle();
      /* resolved at this frame's own time, so a pre-rendered clip carries the
         motion rather than four hundred copies of one instant */
      const job = pool.render(image, stackAt(time).stack, colours)
        .then(async filtered => {
          if (token !== prerenderToken) return;
          frames[index] = await createImageBitmap(filtered);
          done += 1;
          setProgress(done / plan.frames, `Pre-rendering… ${done} of ${plan.frames} frames`);
        })
        .finally(() => inFlight.delete(job));
      inFlight.add(job);
    }
    await Promise.all(inFlight);
    if (token !== prerenderToken) throw new Error('cancelled');

    prerender = {
      frames: frames.filter(Boolean), fps: PRERENDER_FPS,
      from: plan.from, to: plan.to, width: plan.width, height: plan.height, signature
    };
    fxCanvas.width = plan.width;
    fxCanvas.height = plan.height;
    fxCanvas.classList.add('cached');
    setProgress(1, 'Pre-render complete.');
    setStatus(`Pre-rendered ${prerender.frames.length} frames — playback runs at full speed until the stack changes.`);
  } catch (error) {
    for (const frame of frames) frame?.close?.();
    const message = error?.message || String(error);
    if (/cancel/i.test(message)) {
      setProgress(0, 'Pre-render cancelled.');
      setStatus('Pre-render cancelled.');
    } else {
      setProgress(0, 'Pre-render failed.');
      setStatus(`Pre-render failed: ${message}`, 'error');
    }
  } finally {
    prerendering = false;
    prerenderVideo.removeAttribute('src');
    delete prerenderVideo.dataset.url;
    prerenderVideo.load();
    updateFxNote();
    updatePrerenderNote();
    scheduleFxPreview();
  }
}

function refreshFx({ redraw = true } = {}) {
  if (redraw) {
    renderStack($('#fx-stack'), state.effects, {
      onChange: () => { updateFxNote(); scheduleFxPreview(); },
      /* aiming a motion card changes what every other card's controls are
         called and what its own ramp is measured in, so the panel is redrawn */
      onRetarget: () => refreshFx(),
      onBypass: entry => { entry.bypass = !entry.bypass; refreshFx(); },
      onMove: (entry, by) => {
        const from = state.effects.indexOf(entry);
        const to = from + by;
        if (to < 0 || to >= state.effects.length) return;
        state.effects.splice(to, 0, ...state.effects.splice(from, 1));
        refreshFx();
      },
      onRemove: entry => {
        state.effects.splice(state.effects.indexOf(entry), 1);
        refreshFx();
      }
    });
  }
  const live = fxStack().length > 0;
  fxCanvas.hidden = !live;
  $('#drop-zone').classList.toggle('fx-live', live);
  if (!live) { fxContext.clearRect(0, 0, fxCanvas.width, fxCanvas.height); discardPrerender(); }
  usablePrerender();
  updateFxNote();
  updatePrerenderNote();
  updateExportPanel();
  scheduleFxPreview();
}

function addEffect(kind) {
  const entry = makeEntry(kind);
  if (!entry) return;
  state.effects.push(entry);
  refreshFx();
  setStatus(`${entry.title} added — it runs on every frame from here on.`);
}

function clearEffects() {
  if (!state.effects.length) { setStatus('There are no effects to remove.'); return; }
  const count = state.effects.length;
  state.effects.length = 0;
  refreshFx();
  setStatus(`Removed ${count} effect${count === 1 ? '' : 's'}.`);
}

function bypassAllEffects() {
  if (!state.effects.length) { setStatus('There are no effects to switch off.'); return; }
  const anyLive = state.effects.some(entry => !entry.bypass);
  state.effects.forEach(entry => { entry.bypass = anyLive; });
  refreshFx();
  setStatus(anyLive ? 'All effects switched off.' : 'All effects switched back on.');
}

/* The Effects menu and the picker are both built from the shared catalogue, so
   a filter added to ClackPaint appears in Video Lab without being listed by
   hand in either place. */
function buildFxMenus() {
  const { effects, dithers, mattes, motions } = catalogue();
  fillPicker($('#fx-picker'));
  const fill = (container, items) => {
    container.textContent = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.fxAdd = item.kind;
      button.innerHTML = `<span class="menu-item-label">${item.title}</span>`;
      container.append(button);
    }
  };
  fill($('#fx-menu-effects'), effects);
  fill($('#fx-menu-dithers'), dithers);
  fill($('#fx-menu-mattes'), mattes);
  fill($('#fx-menu-motions'), motions);
}

function showDialog(kind) {
  const title = $('#dialog-title');
  const content = $('#dialog-content');
  if (kind === 'shortcuts') {
    title.textContent = '// Keyboard shortcuts';
    content.innerHTML = `<ul>
      <li><code>Space</code> play / pause</li><li><code>J</code> reverse playback</li>
      <li><code>K</code> pause</li><li><code>L</code> forward playback</li>
      <li><code>B</code> bounce on / off</li>
      <li><code>I</code> set A marker</li><li><code>O</code> set B marker</li>
      <li><code>,</code> / <code>.</code> step one frame</li>
      <li><code>Ctrl+O</code> open video</li><li><code>Ctrl+E</code> export</li>
    </ul>`;
  } else {
    title.textContent = '// Formats & browser limits';
    content.innerHTML = `<p>Native MP4, WebM, Ogg and browser-supported MOV files preview immediately. MKV, AVI, MPEG, MTS, VOB, FLV, WMV and other FFmpeg-readable files are converted to a temporary MP4 preview on this device.</p>
      <p>Exports include MP4, WebM, MOV, MKV, AVI, GIF, MP3, WAV, Ogg and a custom container option.
      <b>File → Export → Raw</b> writes the pair Popcorn's converter wants for the RP2040: ${POPCORN.width}&nbsp;×&nbsp;${POPCORN.height} ${POPCORN.fps}fps 24-bit RGB as <code>.rgb</code>, and ${POPCORN.sampleRate / 1000}&nbsp;kHz stereo signed 16-bit little-endian PCM as <code>.pcm</code>. Neither is compressed, so a second of video is ${humanBytes(POPCORN.videoBytesPerSecond)} — the panel estimates the total before you start.
      <b>File → Export → Images</b> zips one still per frame at a frame rate and size you pick.</p>
      <p>Proprietary codecs omitted from the FFmpeg WebAssembly build and DRM-protected media cannot be decoded. Files are never uploaded. The practical limit is browser memory: short and medium projects work best; multi-gigabyte, long reverse and bounce renders can exceed the tab's memory allowance.</p>`;
  }
  $('#info-dialog').showModal();
}

const actions = {
  open: () => $('#video-picker').click(),
  new: () => clearProject(),
  export: exportProject,
  'export-video': () => chooseExportTarget('video'),
  'export-raw': () => chooseExportTarget('raw'),
  'export-images': () => chooseExportTarget('images'),
  'cancel-export': cancelExport,
  'insert-before': () => chooseInsert('before'),
  'insert-after': () => chooseInsert('after'),
  'cut-before': cutBefore,
  'cut-after': cutAfter,
  play: togglePlayback,
  stop: () => { pausePlayback(); loadAt(loopBounds().start, false); setStatus('Stopped.'); },
  'to-start': () => { pausePlayback(); loadAt(loopBounds().start, false); },
  'to-end': () => { pausePlayback(); loadAt(loopBounds().end, false); },
  'frame-back': () => { pausePlayback(); loadAt(state.currentTime - 1 / 30, false); },
  'frame-forward': () => { pausePlayback(); loadAt(state.currentTime + 1 / 30, false); },
  'toggle-reverse': () => setReverse(!state.reverse),
  'toggle-loop': () => {
    state.loop = !state.loop;
    updateUi();
    updateExportPanel();
    const range = state.markerA !== null && state.markerB !== null ? ' between A and B' : '';
    setStatus(state.loop
      ? `Loop enabled${range}${state.bounce ? ' — bouncing back and forth for ever.' : '.'}`
      : `Loop disabled${state.bounce ? ' — bounce now runs there and back once.' : '.'}`);
  },
  'toggle-bounce': () => {
    state.bounce = !state.bounce;
    state.bounceOrigin = state.reverse;
    updateUi();
    updateExportPanel();
    setStatus(state.bounce
      ? `Bounce enabled — plays to the end, then back to the start${state.loop ? ', for ever while loop is on.' : '. Turn loop on to keep it going.'}`
      : 'Bounce disabled.');
  },
  'marker-a': () => setMarker('a'),
  'marker-b': () => setMarker('b'),
  'clear-markers': clearMarkers,
  'audio-mix': () => chooseAudio('mix'),
  'audio-replace': () => chooseAudio('replace'),
  'audio-remove': () => { clearAudio(); setStatus('Extra audio removed.'); },
  help: () => showDialog('formats'),
  shortcuts: () => showDialog('shortcuts'),
  'fx-focus': () => {
    $('#fx-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#fx-picker').focus({ preventScroll: true });
  },
  'fx-clear': clearEffects,
  'fx-bypass-all': bypassAllEffects,
  'fx-prerender': startPrerender,
  'fx-prerender-clear': () => { discardPrerender('Pre-rendered frames discarded.'); updateFxNote(); updatePrerenderNote(); scheduleFxPreview(); }
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
   ones off the edge of the screen. Nothing about the layout can prevent that,
   so an opened menu is measured and slid back until it fits. */
function positionMenu(panel) {
  panel.style.transform = '';
  const margin = 6;
  const rect = panel.getBoundingClientRect();
  const overflowRight = rect.right - (window.innerWidth - margin);
  const shift = overflowRight > 0 ? -Math.min(overflowRight, Math.max(0, rect.left - margin)) : 0;
  if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
}

document.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actions[actionButton.dataset.action];
    if (action && !actionButton.disabled) action();
    closeMenus();
  } else if (!event.target.closest('.rm')) {
    /* the shared bar script closes .rm on a click away; the fly-out inside one
       is this app's own, so it is closed here */
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

/* The Export fly-out opens on hover like a desktop menu and on tap for touch,
   where there is no hover to open it with. */
$$('.rm-sub').forEach(sub => {
  const opener = sub.querySelector(':scope > .rm-sub-open');
  const panel = sub.querySelector(':scope > .rm-sub-dd');
  const openSub = () => {
    closeSubMenus();
    sub.classList.add('open');
    opener.setAttribute('aria-expanded', 'true');
    if (getComputedStyle(panel).position !== 'static') positionMenu(panel);
  };
  opener.addEventListener('click', event => {
    event.stopPropagation();
    if (sub.classList.contains('open')) closeSubMenus();
    else openSub();
  });
  sub.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') openSub(); });
  /* leaving the whole dropdown, not just the item, so the pointer can travel
     across the gap into the fly-out */
  sub.parentElement.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') closeSubMenus(); });
});

window.addEventListener('resize', () => {
  const open = document.querySelector('.rm.open > .rm-dd');
  if (open) positionMenu(open);
});

$('#video-picker').addEventListener('change', event => {
  openVideo(event.target.files[0], 'open');
  event.target.value = '';
});
$('#insert-picker').addEventListener('change', event => {
  openVideo(event.target.files[0], state.insertMode);
  event.target.value = '';
});
$('#audio-picker').addEventListener('change', event => {
  installAudio(event.target.files[0], state.audioPickMode);
  event.target.value = '';
});

$('#seek').addEventListener('input', event => {
  const wasPlaying = state.playing;
  pausePlayback();
  loadAt(Number(event.target.value) / 1000 * projectDuration(), false);
  if (wasPlaying) startPlayback();
});
$('#speed').addEventListener('change', event => {
  state.speed = Number(event.target.value);
  player.playbackRate = state.speed;
  audioPreview.playbackRate = state.speed;
  updateExportPanel();
  setStatus(`Playback speed set to ${state.speed}×.`);
});
$('#bake-playback').addEventListener('change', updateExportPanel);
$('#audio-gain').addEventListener('input', event => {
  const gain = Number(event.target.value) / 100;
  $('#audio-gain-value').textContent = `${event.target.value}%`;
  if (state.audioLayer) {
    state.audioLayer.gain = gain;
    audioPreview.volume = Math.min(1, gain);
  }
});
$$('input[name="audio-mode"]').forEach(radio => radio.addEventListener('change', event => {
  if (state.audioLayer) {
    state.audioLayer.mode = event.target.value;
    player.muted = state.reverse || event.target.value === 'replace';
    setStatus(`Extra audio mode changed to ${event.target.value}.`);
  }
}));
['#export-target', '#format', '#custom-extension', '#raw-framing', '#raw-streams', '#image-format', '#image-fps', '#image-width']
  .forEach(selector => $(selector).addEventListener('change', updateExportPanel));

function installDropTarget(element, handler) {
  ['dragenter', 'dragover'].forEach(type => element.addEventListener(type, event => {
    event.preventDefault();
    element.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => element.addEventListener(type, event => {
    event.preventDefault();
    element.classList.remove('dragging');
  }));
  element.addEventListener('drop', event => handler(event.dataTransfer.files[0]));
}

installDropTarget($('#drop-zone'), file => {
  if (!file) return;
  if (file.type.startsWith('audio/')) installAudio(file, 'mix');
  else openVideo(file, state.segments.length ? 'after' : 'open');
});
installDropTarget($('#audio-drop'), file => { if (file) installAudio(file, $('input[name="audio-mode"]:checked').value); });

async function openLinkedVideo(source) {
  const siteRoot = new URL('../../../', location.href);
  const url = new URL(source, siteRoot);
  if (!['http:', 'https:', 'data:'].includes(url.protocol)) {
    throw new Error(`Linked videos cannot use the ${url.protocol} protocol.`);
  }
  setStatus(`Fetching linked video from ${url.hostname || 'the document'}…`, 'busy');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch linked video (${response.status}).`);
  const blob = await response.blob();
  let name = 'linked-video';
  try { name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop()) || name; } catch {}
  await openVideo(new File([blob], name, { type: blob.type }), 'open');
}

document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea') || $('#info-dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault(); $('#video-picker').click(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
    event.preventDefault(); exportProject(); return;
  }
  if (event.key === 'Escape') { closeMenus(); return; }
  const keyActions = {
    ' ': () => togglePlayback(),
    j: () => setReverse(true, true),
    k: () => pausePlayback(),
    l: () => { setReverse(false); startPlayback(); },
    b: () => actions['toggle-bounce'](),
    i: () => setMarker('a'),
    o: () => setMarker('b'),
    ',': () => actions['frame-back'](),
    '.': () => actions['frame-forward']()
  };
  const action = keyActions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

window.addEventListener('beforeunload', () => {
  for (const asset of state.assets.values()) revokeAsset(asset);
  if (state.audioLayer?.url) URL.revokeObjectURL(state.audioLayer.url);
  fxPool?.destroy();
  discardPrerender();
});

/* Adding an effect from the menu carries the filter's name in the button, which
   the shared data-action dispatch has no way to pass along. */
document.addEventListener('click', event => {
  const button = event.target.closest('[data-fx-add]');
  if (!button) return;
  addEffect(button.dataset.fxAdd);
  closeMenus();
});

$('#fx-picker').addEventListener('change', event => {
  const kind = event.target.value;
  if (!kind) return;
  event.target.value = '';
  addEffect(kind);
});

for (const id of ['#fx-fg', '#fx-bg']) {
  $(id).addEventListener('input', () => { usablePrerender(); updateFxNote(); scheduleFxPreview(); });
}

/* A seek lands a new frame without a timeupdate, so the filtered picture would
   otherwise keep showing the frame before it. */
player.addEventListener('seeked', () => scheduleFxPreview());
player.addEventListener('loadeddata', () => scheduleFxPreview());

renderTimeline();
buildFxMenus();
refreshFx();
updateUi();
updateExportPanel();
const linkedSource = new URLSearchParams(location.search).get('src');
if (linkedSource) openLinkedVideo(linkedSource).catch(error => setStatus(error.message, 'error'));
