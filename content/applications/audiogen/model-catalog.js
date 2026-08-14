/*
 * audioGen model catalog.
 *
 * The UI and the inference worker both consume this file. New models belong
 * here; model-family-specific behaviour belongs in an adapter in
 * audiogen-worker.js. Everything the interface shows is read from these
 * entries — the wording around the text box, the preset chips, and every
 * slider and dropdown under Generation controls — so a model family that needs
 * a voice picker rather than a temperature slider arrives with one instead of
 * with a new branch in app.js.
 *
 * Fields:
 *   kind         groups the model dropdown: music or speech.
 *   family       picks the worker adapter.
 *   repository   Hugging Face repo, or omit it and give `variants`, a list of
 *                repositories the same adapter can load (MMS ships one model
 *                per language). Loading is keyed on model *and* variant.
 *   prompt       wording for the text box, and the preset chips under it.
 *   controls     range and select controls; their values reach the adapter as
 *                options.controls, keyed by id.
 *   runtime      one build per device — its weights, its download size and
 *                what it wants in memory. A model with no `webgpu` build runs
 *                on the processor whatever the machine has.
 */

/* Seven x-vectors extracted from the CMU Arctic corpus, as used by the
 * Transformers.js text-to-speech demo. Each is 2 KB, so a voice change costs
 * nothing next to the model itself. */
const SPEAKER_EMBEDDING_BASE =
  'https://huggingface.co/datasets/Xenova/cmu-arctic-xvectors-extracted/resolve/main/';

const SPEECHT5_VOICES = [
  { value: 'cmu_us_slt_arctic-wav-arctic_a0001', label: 'US female 1' },
  { value: 'cmu_us_clb_arctic-wav-arctic_a0001', label: 'US female 2' },
  { value: 'cmu_us_bdl_arctic-wav-arctic_a0003', label: 'US male 1' },
  { value: 'cmu_us_rms_arctic-wav-arctic_a0003', label: 'US male 2' },
  { value: 'cmu_us_jmk_arctic-wav-arctic_a0002', label: 'Canadian male' },
  { value: 'cmu_us_awb_arctic-wav-arctic_b0002', label: 'Scottish male' },
  { value: 'cmu_us_ksp_arctic-wav-arctic_a0007', label: 'Indian male' },
];

/* MMS covers over a thousand languages; these are the ones Xenova has
 * converted to ONNX whose tokenizer takes the language's own script. The
 * others (Arabic, Hindi, Korean, Russian) expect text romanised with uroman
 * first, which is not something this app can do, so they are left out rather
 * than offered broken. */
const MMS_LANGUAGES = [
  { id: 'eng', label: 'English', repository: 'Xenova/mms-tts-eng' },
  { id: 'fra', label: 'French', repository: 'Xenova/mms-tts-fra' },
  { id: 'deu', label: 'German', repository: 'Xenova/mms-tts-deu' },
  { id: 'spa', label: 'Spanish', repository: 'Xenova/mms-tts-spa' },
  { id: 'por', label: 'Portuguese', repository: 'Xenova/mms-tts-por' },
  { id: 'ron', label: 'Romanian', repository: 'Xenova/mms-tts-ron' },
  { id: 'vie', label: 'Vietnamese', repository: 'Xenova/mms-tts-vie' },
  { id: 'yor', label: 'Yoruba', repository: 'Xenova/mms-tts-yor' },
];

/* Supertonic ships its voices as 50 KB style vectors beside the weights, and
 * gives them no names beyond a letter and a number. */
const SUPERTONIC_VOICES = [
  { value: 'F1', label: 'Female 1' },
  { value: 'F2', label: 'Female 2' },
  { value: 'F3', label: 'Female 3' },
  { value: 'F4', label: 'Female 4' },
  { value: 'F5', label: 'Female 5' },
  { value: 'M1', label: 'Male 1' },
  { value: 'M2', label: 'Male 2' },
  { value: 'M3', label: 'Male 3' },
  { value: 'M4', label: 'Male 4' },
  { value: 'M5', label: 'Male 5' },
];

/* SpeechT5 and VITS have no speed of their own — the rate is baked into the
 * weights — so for those two this is a tape transport, applied to the finished
 * waveform by the worker. Supertonic predicts its own durations and takes a
 * speed directly, so it declares its own control rather than sharing this. */
const RESAMPLE_SPEED_CONTROL = {
  id: 'speed',
  type: 'range',
  label: 'Speed',
  min: 0.7,
  max: 1.4,
  step: 0.05,
  value: 1,
  decimals: 2,
  suffix: '×',
  help: 'Resamples the finished clip, so the pitch moves with it.',
};

export const MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'meta-musicgen-small',
    label: 'Meta MusicGen Small',
    kind: 'music',
    family: 'musicgen',
    repository: 'Xenova/musicgen-small',
    originalRepository: 'facebook/musicgen-small',
    author: 'Meta',
    credit: Object.freeze({ name: 'MusicGen Small', author: 'Meta', url: 'https://huggingface.co/facebook/musicgen-small' }),
    conversion: Object.freeze({ label: 'Xenova', url: 'https://huggingface.co/Xenova/musicgen-small' }),
    description: 'Text-to-music: instrumental loops, textures and short musical ideas. Prompts describing a sound rather than a tune work too, so it doubles as a sound-design tool.',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://huggingface.co/facebook/musicgen-small',
    modelUrl: 'https://huggingface.co/Xenova/musicgen-small',
    prompt: Object.freeze({
      label: 'Describe the sound',
      maxLength: 500,
      placeholder: 'Example: Warm analog synth arpeggios, dusty drum machine, slow cinematic build...',
      value: 'Warm analog synth arpeggios, crisp drum machine, hopeful retro-futurist soundtrack, 105 BPM',
      presets: Object.freeze([
        Object.freeze({ label: 'Lo-fi beat', text: 'Lo-fi hip hop beat, dusty vinyl, mellow electric piano, relaxed and instrumental' }),
        Object.freeze({ label: 'Synthwave', text: 'Bright 1980s synthwave, pulsing bass, gated drums, triumphant night drive, 118 BPM' }),
        Object.freeze({ label: 'Acoustic', text: 'Gentle finger-picked acoustic guitar with soft strings, intimate and reflective, no vocals' }),
        Object.freeze({ label: 'Industrial', text: 'Industrial machine rhythm, metallic percussion, tense electronic ambience, cinematic sound design' }),
        Object.freeze({ label: 'Rain', text: 'Heavy rain on a tin roof, distant thunder, no music, field recording ambience' }),
      ]),
    }),
    controls: Object.freeze([
      Object.freeze({
        id: 'duration', type: 'range', label: 'Duration',
        min: 2, max: 20, step: 1, value: 8, decimals: 0, suffix: 's',
        help: 'Longer clips take proportionally longer.',
      }),
      Object.freeze({
        id: 'guidance', type: 'range', label: 'Prompt guidance',
        min: 1, max: 6, step: 0.1, value: 3, decimals: 1,
        help: 'Higher values follow the description more closely.',
      }),
      Object.freeze({
        id: 'temperature', type: 'range', label: 'Variation',
        min: 0.5, max: 1.5, step: 0.1, value: 1, decimals: 1,
        help: 'Higher values produce less predictable ideas.',
      }),
    ]),
    /* One build per device rather than one build run on whichever device is
     * going, because the sensible weights differ by more than a flag. MusicGen
     * decodes autoregressively — about fifty audio tokens for every second of
     * output — so the decoder runs a thousand times for a twenty second clip
     * and is worth putting on an adapter. But the 8-bit weights that make that
     * bearable on a CPU are the wrong ones to send there: the WebGPU backend
     * has no integer matmul, so it widens them back out on every dispatch and
     * lands slower than the CPU build it replaced. The adapter gets fp16, and
     * pays for it in download. */
    runtime: Object.freeze({
      webgpu: Object.freeze({
        downloadSizeMB: 1127,
        memoryNote: 'Allow roughly 2.5 GB of free graphics memory while generating.',
        dtype: Object.freeze({
          text_encoder: 'fp16',
          decoder_model_merged: 'fp16',
          encodec_decode: 'fp16',
        }),
      }),
      wasm: Object.freeze({
        downloadSizeMB: 656,
        memoryNote: 'Allow roughly 1.5 GB of free memory while generating.',
        dtype: Object.freeze({
          text_encoder: 'q8',
          decoder_model_merged: 'q8',
          encodec_decode: 'fp32',
        }),
      }),
    }),
  }),

  Object.freeze({
    id: 'supertone-supertonic',
    label: 'Supertone Supertonic',
    kind: 'speech',
    family: 'supertonic',
    repository: 'onnx-community/Supertonic-TTS-ONNX',
    originalRepository: 'Supertone/supertonic',
    author: 'Supertone',
    credit: Object.freeze({ name: 'Supertonic', author: 'Supertone', url: 'https://huggingface.co/Supertone/supertonic' }),
    conversion: Object.freeze({ label: 'onnx-community', url: 'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX' }),
    description: 'The best English voice here, and the only one that comes out at 44.1 kHz. It predicts its own timing, so the speed control changes the delivery rather than the pitch.',
    license: 'OpenRAIL',
    licenseUrl: 'https://huggingface.co/Supertone/supertonic',
    modelUrl: 'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX',
    prompt: Object.freeze({
      label: 'Text to speak',
      maxLength: 1000,
      placeholder: 'Type the words you want spoken...',
      value: 'Good afternoon. ClackOS is running the whole speech engine inside this browser tab, so nothing you type here leaves the machine.',
      presets: Object.freeze([
        Object.freeze({ label: 'Greeting', text: 'Good afternoon, and welcome to Clacktronics.' }),
        Object.freeze({ label: 'Announcement', text: 'The next demonstration will begin in five minutes. Please take your seats.' }),
        Object.freeze({ label: 'Countdown', text: 'Five. Four. Three. Two. One. Ignition.' }),
        Object.freeze({ label: 'Robot', text: 'System check complete. All subsystems nominal. Awaiting further instructions.' }),
      ]),
    }),
    controls: Object.freeze([
      Object.freeze({
        id: 'voice', type: 'select', label: 'Voice',
        value: SUPERTONIC_VOICES[0].value,
        options: Object.freeze(SUPERTONIC_VOICES.map(voice => Object.freeze(voice))),
        help: 'Ten style vectors published with the weights, fetched on demand.',
      }),
      Object.freeze({
        id: 'speed', type: 'range', label: 'Speed',
        min: 0.7, max: 1.5, step: 0.05, value: 1.05, decimals: 2, suffix: '×',
        help: 'Given to the model, which stretches the delivery and leaves the pitch alone.',
      }),
      Object.freeze({
        id: 'steps', type: 'range', label: 'Refinement',
        min: 2, max: 12, step: 1, value: 5, decimals: 0,
        help: 'Passes through the latent denoiser. Above five buys little.',
      }),
    ]),
    speech: Object.freeze({ voiceBase: 'https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/', sentenceLength: 300 }),
    runtime: Object.freeze({
      wasm: Object.freeze({
        downloadSizeMB: 263,
        memoryNote: 'Allow roughly 700 MB of free memory while speaking.',
        /* The repository publishes one build, in full precision, with the
         * weights in external data files beside each graph. */
        dtype: 'fp32',
      }),
    }),
  }),

  Object.freeze({
    id: 'microsoft-speecht5',
    label: 'Microsoft SpeechT5',
    kind: 'speech',
    family: 'speecht5',
    repository: 'Xenova/speecht5_tts',
    originalRepository: 'microsoft/speecht5_tts',
    author: 'Microsoft',
    credit: Object.freeze({ name: 'SpeechT5', author: 'Microsoft', url: 'https://huggingface.co/microsoft/speecht5_tts' }),
    conversion: Object.freeze({ label: 'Xenova', url: 'https://huggingface.co/Xenova/speecht5_tts' }),
    description: 'Reads English text aloud in one of seven voices taken from the CMU Arctic corpus. Long passages are spoken a sentence at a time and joined up.',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/microsoft/speecht5_tts',
    modelUrl: 'https://huggingface.co/Xenova/speecht5_tts',
    prompt: Object.freeze({
      label: 'Text to speak',
      maxLength: 1000,
      placeholder: 'Type the words you want spoken...',
      value: 'Good afternoon. ClackOS is running the whole speech engine inside this browser tab, so nothing you type here leaves the machine.',
      presets: Object.freeze([
        Object.freeze({ label: 'Greeting', text: 'Good afternoon, and welcome to Clacktronics.' }),
        Object.freeze({ label: 'Announcement', text: 'The next demonstration will begin in five minutes. Please take your seats.' }),
        Object.freeze({ label: 'Countdown', text: 'Five. Four. Three. Two. One. Ignition.' }),
        Object.freeze({ label: 'Robot', text: 'System check complete. All subsystems nominal. Awaiting further instructions.' }),
      ]),
    }),
    controls: Object.freeze([
      Object.freeze({
        id: 'voice', type: 'select', label: 'Voice',
        value: SPEECHT5_VOICES[0].value,
        options: Object.freeze(SPEECHT5_VOICES.map(voice => Object.freeze(voice))),
        help: 'Each voice is a 2 KB speaker embedding, fetched on demand.',
      }),
      Object.freeze(RESAMPLE_SPEED_CONTROL),
    ]),
    speech: Object.freeze({ speakerEmbeddingBase: SPEAKER_EMBEDDING_BASE, sentenceLength: 70 }),
    vocoder: 'Xenova/speecht5_hifigan',
    runtime: Object.freeze({
      wasm: Object.freeze({
        downloadSizeMB: 230,
        memoryNote: 'Allow roughly 600 MB of free memory while speaking.',
        dtype: Object.freeze({
          model: 'q8',
          decoder_model_merged: 'q8',
          /* The vocoder turns the spectrogram into the waveform it plays, and
           * is the one part quantisation is plainly audible in, so fp32. */
          vocoder: 'fp32',
        }),
      }),
    }),
  }),

  Object.freeze({
    id: 'meta-mms-tts',
    label: 'Meta MMS TTS',
    kind: 'speech',
    family: 'vits',
    variantLabel: 'Language',
    variants: Object.freeze(MMS_LANGUAGES.map(language => Object.freeze(language))),
    originalRepository: 'facebook/mms-tts',
    author: 'Meta',
    credit: Object.freeze({ name: 'MMS TTS', author: 'Meta', url: 'https://huggingface.co/facebook/mms-tts' }),
    conversion: Object.freeze({ label: 'Xenova', url: 'https://huggingface.co/Xenova/mms-tts-eng' }),
    description: 'A single-speaker VITS voice per language, from the Massively Multilingual Speech project. Smaller and quicker than SpeechT5, and it speaks eight languages.',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://huggingface.co/facebook/mms-tts',
    modelUrl: 'https://huggingface.co/models?search=Xenova/mms-tts',
    prompt: Object.freeze({
      label: 'Text to speak',
      maxLength: 1000,
      placeholder: 'Type the words you want spoken, in the language selected above...',
      value: 'This voice runs entirely in the browser, with no server and no account.',
      presets: Object.freeze([
        Object.freeze({ label: 'Greeting', text: 'Hello, and welcome to Clacktronics.' }),
        Object.freeze({ label: 'Weather', text: 'Tomorrow will be bright and cold, with a light wind from the north.' }),
        Object.freeze({ label: 'Numbers', text: 'One, two, three, four, five, six, seven, eight, nine, ten.' }),
      ]),
    }),
    controls: Object.freeze([Object.freeze(RESAMPLE_SPEED_CONTROL)]),
    speech: Object.freeze({ sentenceLength: 180 }),
    runtime: Object.freeze({
      wasm: Object.freeze({
        downloadSizeMB: 109,
        memoryNote: 'Allow roughly 400 MB of free memory while speaking. Each language is a separate download.',
        dtype: 'fp32',
      }),
    }),
  }),

]);

export const MODEL_KINDS = Object.freeze([
  Object.freeze({ id: 'music', label: 'Music' }),
  Object.freeze({ id: 'speech', label: 'Speech' }),
]);

/* Which weights this model would fetch for a given device, and what that costs
 * in download and memory. A model with no build for the device has none: the
 * worker only ever asks for a device the catalog offers. */
export function getModelBuild(model, device) {
  return model?.runtime?.[device] || null;
}

export function supportsWebGPU(model) {
  return Boolean(model?.runtime?.webgpu);
}

export function getModelDefinition(id) {
  return MODEL_CATALOG.find(model => model.id === id) || null;
}

/* A model either names one repository or offers a list of them. Both the UI
 * and the worker need the same answer to "which repository is this?", and the
 * worker caches on the pair, so the lookup lives here. */
export function getVariant(model, variantId) {
  if (!model?.variants?.length) return null;
  return model.variants.find(variant => variant.id === variantId) || model.variants[0];
}

export function getRepository(model, variantId) {
  return getVariant(model, variantId)?.repository || model?.repository || null;
}

export function defaultControlValues(model) {
  const values = {};
  for (const control of model?.controls || []) values[control.id] = control.value;
  return values;
}
