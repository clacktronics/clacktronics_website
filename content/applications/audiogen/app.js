import {
  MODEL_CATALOG,
  MODEL_KINDS,
  defaultControlValues,
  getModelBuild,
  getModelDefinition,
  getVariant,
  supportsWebGPU,
} from './model-catalog.js';

const appRoot = window.ClackOSMountRoot || document;
const $ = selector => appRoot.querySelector(selector);
const $$ = selector => [...appRoot.querySelectorAll(selector)];

const promptInput = $('.ag-prompt');
const promptTitle = $('.ag-prompt-title');
const promptHelp = $('.ag-prompt-help');
const examples = $('.ag-examples');
const modelSelect = $('.ag-model-select');
const variantField = $('.ag-variant');
const variantSelect = $('.ag-variant-select');
const modelKind = $('.ag-kind');
const modelCopy = $('.ag-model-copy');
const modelMeta = $('.ag-model-meta');
const loadNote = $('.ag-load-note');
const loadButton = $('.ag-load');
const controlsCard = $('.ag-controls-card');
const controlsHost = $('.ag-controls');
const generateButtons = $$('[data-action="generate"]');
const stopButtons = $$('[data-action="stop"]');
const saveButtons = $$('[data-action="save"]');
const clearButtons = $$('[data-action="clear"]');
const status = $('.ag-status');
const progress = $('.ag-progress');
const progressFill = $('.ag-progress > div');
const emptyResult = $('.ag-empty');
const audio = $('.ag-audio');
const waveform = $('.ag-waveform');
const resultMeta = $('.ag-result-meta');
const aboutPanel = $('.ag-about');
const credit = $('.ag-credit');

let worker = null;
let loadedKey = null;
let phase = 'idle';
let resultUrl = null;
let resultBuffer = null;
let resultDetails = null;

/* One draft per model, so trying the sound-effect generator and coming back
 * does not cost the paragraph typed into the speech model. */
const drafts = new Map();
const controlInputs = new Map();

function selectedModel() {
  return getModelDefinition(modelSelect.value);
}

function selectedVariantId() {
  const model = selectedModel();
  return model?.variants?.length ? variantSelect.value : '';
}

function selectionKey() {
  return `${modelSelect.value}/${selectedVariantId()}`;
}

/* The worker decides for itself which build to fetch; this is the same
 * question asked again in the window, and only so the panel can name a
 * download size before anything is fetched. It stays null until the probe
 * answers, and the panel shows both figures rather than guessing while it
 * does. Models with a single build never wait on it. */
let gpuDevice = null;
let deviceProbed = false;
function probeDevice() {
  if (deviceProbed) return;
  deviceProbed = true;
  const settle = device => { gpuDevice = device; updateModelCopy(); };
  if (!('gpu' in navigator)) { settle('wasm'); return; }
  navigator.gpu.requestAdapter()
    .then(adapter => settle(adapter?.features.has('shader-f16') ? 'webgpu' : 'wasm'))
    .catch(() => settle('wasm'));
}

function buildFor(model) {
  if (!supportsWebGPU(model)) return getModelBuild(model, 'wasm');
  return gpuDevice ? getModelBuild(model, gpuDevice) : null;
}

function describeDownload(model) {
  const build = buildFor(model);
  if (build) return `${build.downloadSizeMB} MB`;
  return `${getModelBuild(model, 'wasm').downloadSizeMB}–${getModelBuild(model, 'webgpu').downloadSizeMB} MB`;
}

function controlValues() {
  const values = {};
  for (const [id, input] of controlInputs) {
    values[id] = input.type === 'range' ? Number(input.value) : input.value;
  }
  return values;
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

function setLoadLabel(text) {
  loadButton.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'pixel-icon';
  icon.dataset.icon = 'download';
  icon.setAttribute('aria-hidden', 'true');
  loadButton.append(icon, document.createTextNode(text));
}

function setPhase(nextPhase) {
  phase = nextPhase;
  const busy = phase === 'loading' || phase === 'generating';
  const ready = loadedKey === selectionKey();
  const model = selectedModel();
  modelSelect.disabled = busy;
  variantSelect.disabled = busy;
  const cached = Boolean(buildFor(model))
    && localStorage.getItem(cacheKey(model, selectedVariantId())) === '1';
  setLoadLabel(ready ? 'Model loaded' : cached ? 'Load cached model' : 'Download & load model');
  loadButton.disabled = busy || ready;
  generateButtons.forEach(button => { button.disabled = busy || !ready; });
  stopButtons.forEach(button => { button.hidden = !busy; });
  saveButtons.forEach(button => { button.disabled = !resultBuffer || busy; });
  clearButtons.forEach(button => { button.disabled = !resultBuffer || busy; });
  for (const input of controlInputs.values()) input.disabled = busy;
}

function createWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./audiogen-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', event => {
    setStatus(`Worker error: ${event.message || 'audio engine stopped unexpectedly.'}`);
    loadedKey = null;
    setProgress(0, false);
    setPhase('idle');
  });
  return worker;
}

function destroyWorker() {
  if (worker) worker.terminate();
  worker = null;
  loadedKey = null;
}

function formatControl(control, value) {
  return `${Number(value).toFixed(control.decimals ?? 0)}${control.suffix || ''}`;
}

function buildControls(model) {
  controlsHost.replaceChildren();
  controlInputs.clear();
  const values = defaultControlValues(model);

  for (const control of model.controls) {
    const field = document.createElement('label');
    field.className = `ag-control ag-control-${control.type}`;
    field.htmlFor = `ag-control-${control.id}`;

    const top = document.createElement('span');
    top.className = 'ag-control-top';
    const label = document.createElement('span');
    label.className = 'ag-control-label';
    label.textContent = control.label;
    top.appendChild(label);

    let input;
    if (control.type === 'select') {
      input = document.createElement('select');
      for (const option of control.options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        input.appendChild(element);
      }
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = control.min;
      input.max = control.max;
      input.step = control.step;
      const readout = document.createElement('output');
      readout.textContent = formatControl(control, values[control.id]);
      input.addEventListener('input', () => {
        readout.textContent = formatControl(control, input.value);
      });
      top.appendChild(readout);
    }
    input.id = `ag-control-${control.id}`;
    input.value = values[control.id];

    field.append(top, input);
    if (control.help) {
      const help = document.createElement('span');
      help.className = 'ag-control-help';
      help.textContent = control.help;
      field.appendChild(help);
    }
    controlsHost.appendChild(field);
    controlInputs.set(control.id, input);
  }
  controlsCard.hidden = !model.controls.length;
}

function buildPrompt(model) {
  const draft = drafts.get(model.id);
  promptTitle.textContent = `// ${model.prompt.label}`;
  promptInput.maxLength = model.prompt.maxLength;
  promptInput.placeholder = model.prompt.placeholder;
  promptInput.value = draft === undefined ? model.prompt.value : draft;
  promptHelp.textContent = model.prompt.help || '';
  promptHelp.hidden = !model.prompt.help;

  examples.replaceChildren();
  for (const preset of model.prompt.presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ag-example';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      promptInput.value = preset.text;
      drafts.set(model.id, preset.text);
      promptInput.focus();
    });
    examples.appendChild(button);
  }
}

function buildVariants(model) {
  const variants = model.variants || [];
  variantField.hidden = !variants.length;
  if (!variants.length) return;
  variantField.querySelector('.ag-control-label').textContent = model.variantLabel || 'Variant';
  variantSelect.replaceChildren();
  for (const variant of variants) {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.label;
    variantSelect.appendChild(option);
  }
}

/* Cached per device as well as per model and variant: two builds are two sets
 * of files, and having fetched one says nothing about the other. */
function cacheKey(model, variantId, device) {
  return `audiogen-cached:${model.id}${variantId ? `:${variantId}` : ''}:${device || gpuDevice || 'wasm'}`;
}

function buildCredit(model) {
  const source = model.credit || { name: model.label, author: model.author, url: model.modelUrl };
  credit.replaceChildren(document.createTextNode('Model: '));

  const link = document.createElement('a');
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = source.name;
  credit.append(link, document.createTextNode(` by ${source.author}`));

  if (model.conversion) {
    const conversion = document.createElement('a');
    conversion.href = model.conversion.url;
    conversion.target = '_blank';
    conversion.rel = 'noopener';
    conversion.textContent = model.conversion.label;
    credit.append(document.createTextNode(' · ONNX conversion by '), conversion);
  }

  const licence = document.createElement('a');
  licence.href = model.licenseUrl;
  licence.target = '_blank';
  licence.rel = 'noopener';
  licence.textContent = model.license;
  credit.append(document.createTextNode(' · '), licence, document.createTextNode('.'));
}

/* Everything in the panel that depends on which build we will fetch, split out
 * so the WebGPU probe can settle late without putting the sliders back to
 * their defaults under someone who has already moved them. */
function updateModelCopy() {
  const model = selectedModel();
  const variant = getVariant(model, selectedVariantId());

  modelKind.textContent = MODEL_KINDS.find(kind => kind.id === model.kind)?.label || model.kind;
  modelCopy.textContent = model.description;
  modelMeta.replaceChildren();
  const tags = [`${describeDownload(model)} download`, model.license];
  for (const text of tags) {
    const tag = document.createElement('span');
    tag.className = 'ag-tag';
    tag.textContent = text;
    modelMeta.appendChild(tag);
  }

  loadNote.replaceChildren(document.createTextNode(
    `${(buildFor(model) || getModelBuild(model, 'wasm'))?.memoryNote || ''} `,
  ));
  const link = document.createElement('a');
  link.href = variant ? `https://huggingface.co/${variant.repository}` : model.modelUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Model details';
  loadNote.appendChild(link);
}

function updateModelDetails({ keepInputs = false } = {}) {
  const model = selectedModel();
  const variantId = selectedVariantId();

  probeDevice();
  updateModelCopy();
  buildCredit(model);
  if (!keepInputs) {
    buildPrompt(model);
    buildControls(model);
  }

  if (loadedKey !== selectionKey()) {
    destroyWorker();
    setStatus('Load the model when you are ready. Your text stays on this device.');
  }
  setProgress(0, false);
  setPhase('idle');
}

function loadModel() {
  if (phase !== 'idle') return;
  const model = selectedModel();
  setPhase('loading');
  setProgress(1);
  setStatus(`Preparing ${model.label}. The first load downloads about ${describeDownload(model)}...`);
  createWorker().postMessage({ type: 'load', modelId: model.id, variantId: selectedVariantId() });
}

function generate() {
  const model = selectedModel();
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus(model.kind === 'speech'
      ? 'Type the text you want spoken first.'
      : 'Describe the audio you want to create first.');
    promptInput.focus();
    return;
  }
  if (loadedKey !== selectionKey() || phase !== 'idle') return;

  setPhase('generating');
  setProgress(1);
  setStatus(model.kind === 'music'
    ? 'Generating locally. Short clips can still take a few minutes on CPU...'
    : 'Generating locally...');
  createWorker().postMessage({
    type: 'generate',
    options: {
      modelId: model.id,
      variantId: selectedVariantId(),
      prompt,
      controls: controlValues(),
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
    : 'Generation stopped. Reload the model to try again.');
}

function clearResult() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  resultBuffer = null;
  resultDetails = null;
  emptyResult.hidden = false;
  waveform.hidden = true;
  audio.hidden = true;
  resultMeta.textContent = '';
  setPhase(phase);
}

function safeFilename(model, prompt) {
  const stem = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `audiogen-${model.kind}-${stem || 'clip'}.wav`;
}

function saveResult() {
  if (!resultBuffer) return;
  const link = document.createElement('a');
  link.href = resultUrl;
  link.download = safeFilename(selectedModel(), promptInput.value);
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
  emptyResult.hidden = true;
  waveform.hidden = false;
  audio.hidden = false;
  const seconds = message.frames / message.sampleRate;
  resultMeta.textContent = `${seconds.toFixed(1)} s · ${(message.sampleRate / 1000).toFixed(1)} kHz · ${message.channels === 1 ? 'mono' : `${message.channels} channels`} · WAV`;
  requestAnimationFrame(() => drawWave(resultBuffer, message.channels));
  setProgress(100);
  setStatus(selectedModel().kind === 'speech'
    ? 'Speech ready. Play it back or save the WAV file.'
    : 'Audio ready. Preview it or save the WAV file.');
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
    /* The GPU build did not survive its session build. The worker that tried is
     * left holding whatever state that failure made, so it is discarded rather
     * than asked again, and a fresh one is told which device to use. */
    case 'retry-on-cpu':
      gpuDevice = 'wasm';
      updateModelCopy();
      destroyWorker();
      setProgress(1);
      setStatus('The graphics adapter would not take the model. Loading the processor build instead...');
      createWorker().postMessage({
        type: 'load', modelId: message.modelId, variantId: message.variantId, device: 'wasm',
      });
      break;
    case 'model-ready': {
      loadedKey = `${message.modelId}/${message.variantId || ''}`;
      const model = getModelDefinition(message.modelId);
      localStorage.setItem(cacheKey(model, message.variantId, message.device), '1');
      /* The worker has the last word on the device — it may have started on
       * the adapter and finished on the processor — so take its answer rather
       * than the probe's, and say which one it landed on. Minutes separate the
       * two and it should not be a mystery why. */
      if (message.device) gpuDevice = message.device;
      setProgress(100);
      setStatus(`${model.label} is ready on the ${message.device === 'webgpu' ? 'graphics adapter' : 'processor'}. Select Generate audio when you are.`);
      setPhase('idle');
      break;
    }
    case 'generation-progress':
      setProgress(message.progress * 100);
      setStatus(`Generating locally: ${Math.round(message.progress * 100)}%...`);
      break;
    case 'result':
      installResult(message);
      break;
    case 'error':
      setProgress(0, false);
      if (message.phase === 'load') loadedKey = null;
      setStatus(`Could not ${message.phase === 'load' ? 'load the model' : 'generate audio'}: ${message.message}`);
      setPhase('idle');
      break;
  }
}

/* Model options come from the catalog, not hard-coded markup. */
for (const kind of MODEL_KINDS) {
  const models = MODEL_CATALOG.filter(model => model.kind === kind.id);
  if (!models.length) continue;
  const group = document.createElement('optgroup');
  group.label = kind.label;
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    group.appendChild(option);
  }
  modelSelect.appendChild(group);
}

promptInput.addEventListener('input', () => drafts.set(modelSelect.value, promptInput.value));
modelSelect.addEventListener('change', () => {
  buildVariants(selectedModel());
  updateModelDetails();
});
/* A different language is a different download, so it goes through the same
 * path as a different model — but the text already typed is worth keeping. */
variantSelect.addEventListener('change', () => updateModelDetails({ keepInputs: true }));

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

progress.hidden = true;
aboutPanel.hidden = true;
waveform.hidden = true;
audio.hidden = true;
buildVariants(selectedModel());
updateModelDetails();
