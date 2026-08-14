import { MODEL_CATALOG, getModelDefinition } from './model-catalog.js';

const appRoot = window.ClackOSMountRoot || document;
const $ = selector => appRoot.querySelector(selector);
const $$ = selector => [...appRoot.querySelectorAll(selector)];

const promptInput = $('.ag-prompt');
const modelSelect = $('.ag-model-select');
const modelCopy = $('.ag-model-copy');
const modelMeta = $('.ag-model-meta');
const loadNote = $('.ag-load-note');
const loadButton = $('[data-action="load"]');
const generateButton = $('[data-action="generate"]');
const stopButtons = $$('[data-action="stop"]');
const saveButtons = $$('[data-action="save"]');
const clearButtons = $$('[data-action="clear"]');
const status = $('.ag-status');
const progress = $('.ag-progress');
const progressFill = $('.ag-progress > div');
const resultCard = $('.ag-result');
const emptyResult = $('.ag-empty');
const audio = $('.ag-audio');
const waveform = $('.ag-waveform');
const resultMeta = $('.ag-result-meta');
const aboutPanel = $('.ag-about');

const controls = {
  duration: $('#ag-duration'),
  guidance: $('#ag-guidance'),
  temperature: $('#ag-temperature'),
};

let worker = null;
let loadedModelId = null;
let phase = 'idle';
let resultUrl = null;
let resultBuffer = null;
let resultDetails = null;

function selectedModel() {
  return getModelDefinition(modelSelect.value);
}

function setStatus(message) {
  status.textContent = message;
}

function setProgress(value, visible = true) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  progress.hidden = !visible;
  progressFill.style.width = `${percent}%`;
  progress.setAttribute('aria-valuenow', String(Math.round(percent)));
}

function setPhase(nextPhase) {
  phase = nextPhase;
  const loading = phase === 'loading';
  const generating = phase === 'generating';
  const busy = loading || generating;
  modelSelect.disabled = busy;
  loadButton.disabled = busy;
  generateButton.disabled = busy || loadedModelId !== modelSelect.value;
  stopButtons.forEach(button => { button.hidden = !busy; });
  saveButtons.forEach(button => { button.disabled = !resultBuffer || busy; });
  clearButtons.forEach(button => { button.disabled = !resultBuffer || busy; });
}

function createWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./audiogen-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', event => {
    setStatus(`Worker error: ${event.message || 'audio engine stopped unexpectedly.'}`);
    loadedModelId = null;
    setProgress(0, false);
    setPhase('idle');
  });
  return worker;
}

function destroyWorker() {
  if (worker) worker.terminate();
  worker = null;
  loadedModelId = null;
}

function updateModelDetails() {
  const model = selectedModel();
  modelCopy.textContent = model.description;
  modelMeta.replaceChildren();
  [model.family, `${model.downloadSizeMB} MB download`, model.license].forEach(text => {
    const tag = document.createElement('span');
    tag.className = 'ag-tag';
    tag.textContent = text;
    modelMeta.appendChild(tag);
  });
  const cached = localStorage.getItem(`audiogen-cached:${model.id}`) === '1';
  loadButton.innerHTML = `<span class="pixel-icon" data-icon="download" aria-hidden="true"></span>${cached ? 'Load cached model' : 'Download & load model'}`;
  loadNote.replaceChildren(
    document.createTextNode(`${model.memoryNote} Weights are fetched from Hugging Face and cached by your browser. `),
  );
  const link = document.createElement('a');
  link.href = model.modelUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Model details';
  loadNote.appendChild(link);

  controls.duration.min = model.limits.minDuration;
  controls.duration.max = model.limits.maxDuration;
  controls.duration.value = model.defaults.duration;
  controls.guidance.value = model.defaults.guidance;
  controls.temperature.value = model.defaults.temperature;
  updateOutputs();
  if (loadedModelId !== model.id) {
    destroyWorker();
    setStatus('Load the model when you are ready. Your prompt stays on this device.');
  }
  setProgress(0, false);
  setPhase('idle');
}

function updateOutputs() {
  $('#ag-duration-value').textContent = `${controls.duration.value}s`;
  $('#ag-guidance-value').textContent = Number(controls.guidance.value).toFixed(1);
  $('#ag-temperature-value').textContent = Number(controls.temperature.value).toFixed(1);
}

function loadModel() {
  if (phase !== 'idle') return;
  const model = selectedModel();
  setPhase('loading');
  setProgress(1);
  setStatus(`Preparing ${model.label}. The first load downloads about ${model.downloadSizeMB} MB...`);
  createWorker().postMessage({ type: 'load', modelId: model.id });
}

function generate() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus('Describe the audio you want to create first.');
    promptInput.focus();
    return;
  }
  if (loadedModelId !== modelSelect.value || phase !== 'idle') return;

  setPhase('generating');
  setProgress(1);
  setStatus('Generating locally. Short clips can still take a few minutes on CPU...');
  createWorker().postMessage({
    type: 'generate',
    options: {
      modelId: modelSelect.value,
      prompt,
      duration: Number(controls.duration.value),
      guidance: Number(controls.guidance.value),
      temperature: Number(controls.temperature.value),
    },
  });
}

function stop() {
  if (phase !== 'loading' && phase !== 'generating') return;
  const previousPhase = phase;
  destroyWorker();
  setProgress(0, false);
  setPhase('idle');
  setStatus(previousPhase === 'loading'
    ? 'Model loading stopped. You can resume from the browser cache.'
    : 'Generation stopped. Reload the model to make another clip.');
}

function clearResult() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  resultBuffer = null;
  resultDetails = null;
  resultCard.hidden = true;
  emptyResult.hidden = false;
  setPhase(phase);
}

function safeFilename(prompt) {
  const stem = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `audiogen-${stem || 'clip'}.wav`;
}

function saveResult() {
  if (!resultBuffer) return;
  const link = document.createElement('a');
  link.href = resultUrl;
  link.download = safeFilename(promptInput.value);
  link.click();
}

function drawWave(buffer, channels) {
  const view = new DataView(buffer);
  const dataOffset = 44;
  const totalSamples = Math.max(0, (buffer.byteLength - dataOffset) / 2);
  const frames = Math.floor(totalSamples / channels);
  const rect = waveform.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  waveform.width = Math.max(1, Math.round(rect.width * ratio));
  waveform.height = Math.max(1, Math.round(rect.height * ratio));
  const context = waveform.getContext('2d');
  const width = waveform.width;
  const height = waveform.height;
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#09140d';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-hover').trim() || '#6fcf9a';
  context.lineWidth = Math.max(1, ratio);
  context.beginPath();
  const samplesPerPixel = Math.max(1, Math.floor(frames / width));
  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel;
    const end = Math.min(frames, start + samplesPerPixel);
    let min = 1;
    let max = -1;
    for (let frame = start; frame < end; frame += 1) {
      let mixed = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const sampleIndex = frame * channels + channel;
        mixed += view.getInt16(dataOffset + sampleIndex * 2, true) / 0x8000;
      }
      mixed /= channels;
      min = Math.min(min, mixed);
      max = Math.max(max, mixed);
    }
    context.moveTo(x + .5, (1 - max) * height / 2);
    context.lineTo(x + .5, (1 - min) * height / 2);
  }
  context.stroke();
}

function installResult(message) {
  clearResult();
  resultBuffer = message.buffer;
  resultDetails = message;
  resultUrl = URL.createObjectURL(new Blob([resultBuffer], { type: 'audio/wav' }));
  audio.src = resultUrl;
  resultCard.hidden = false;
  emptyResult.hidden = true;
  const seconds = message.frames / message.sampleRate;
  resultMeta.textContent = `${seconds.toFixed(1)} seconds · ${message.sampleRate.toLocaleString()} Hz · ${message.channels === 1 ? 'mono' : `${message.channels} channels`} · WAV`;
  requestAnimationFrame(() => drawWave(resultBuffer, message.channels));
  setProgress(100);
  setStatus('Audio ready. Preview it or save the WAV file.');
  setPhase('idle');
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  switch (message.type) {
    case 'worker-ready':
      document.documentElement.dataset.audiogenWorker = 'ready';
      break;
    case 'load-detail':
      setStatus(message.detail);
      break;
    case 'load-progress': {
      const percent = message.total ? message.loaded / message.total * 100 : 1;
      setProgress(percent);
      const loadedMB = message.loaded / 1048576;
      const totalMB = message.total / 1048576;
      setStatus(message.total
        ? `Downloading model: ${loadedMB.toFixed(0)} / ${totalMB.toFixed(0)} MB (cached for next time)...`
        : 'Downloading model files...');
      break;
    }
    case 'model-ready':
      loadedModelId = message.modelId;
      localStorage.setItem(`audiogen-cached:${message.modelId}`, '1');
      setProgress(100);
      setStatus(`${selectedModel().label} is ready. Describe a clip and select Generate audio.`);
      setPhase('idle');
      break;
    case 'generation-progress':
      setProgress(message.progress * 100);
      setStatus(`Generating locally: ${Math.round(message.progress * 100)}%...`);
      break;
    case 'result':
      installResult(message);
      break;
    case 'error':
      setProgress(0, false);
      if (message.phase === 'load') loadedModelId = null;
      setStatus(`Could not ${message.phase === 'load' ? 'load the model' : 'generate audio'}: ${message.message}`);
      setPhase('idle');
      break;
  }
}

/* Model options come from the catalog, not hard-coded markup. */
for (const model of MODEL_CATALOG) {
  const option = document.createElement('option');
  option.value = model.id;
  option.textContent = model.label;
  modelSelect.appendChild(option);
}

$$('.ag-example').forEach(button => button.addEventListener('click', () => {
  promptInput.value = button.dataset.prompt;
  promptInput.focus();
}));
Object.values(controls).forEach(control => control.addEventListener('input', updateOutputs));
modelSelect.addEventListener('change', updateModelDetails);

appRoot.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const actions = {
    load: loadModel,
    generate,
    stop,
    save: saveResult,
    clear: clearResult,
    about: () => { aboutPanel.hidden = !aboutPanel.hidden; },
  };
  actions[button.dataset.action]?.();
  closeMenus();
});

const menus = $$('.rm');
const closeMenus = () => menus.forEach(menu => menu.classList.remove('open'));
menus.forEach(menu => {
  menu.querySelector(':scope > button').addEventListener('click', event => {
    event.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
  });
});
appRoot.addEventListener('click', event => {
  if (!event.target.closest('.rm')) closeMenus();
});

window.addEventListener('beforeunload', () => {
  destroyWorker();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
window.addEventListener('resize', () => {
  if (resultBuffer && resultDetails) drawWave(resultBuffer, resultDetails.channels);
});

resultCard.hidden = true;
progress.hidden = true;
aboutPanel.hidden = true;
updateModelDetails();
createWorker();
