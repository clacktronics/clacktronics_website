/*
 * audioGen model catalog.
 *
 * The UI and inference worker both consume this file. New models belong here;
 * model-family-specific behaviour belongs in an adapter in audiogen-worker.js.
 */
export const MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'meta-musicgen-small',
    label: 'Meta MusicGen Small',
    family: 'musicgen',
    repository: 'Xenova/musicgen-small',
    originalRepository: 'facebook/musicgen-small',
    description: 'A compact text-to-music model for instrumental loops, textures and short musical ideas.',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://huggingface.co/facebook/musicgen-small',
    modelUrl: 'https://huggingface.co/Xenova/musicgen-small',
    defaults: Object.freeze({ duration: 8, guidance: 3, temperature: 1 }),
    limits: Object.freeze({ minDuration: 2, maxDuration: 20 }),
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
]);

export function getModelBuild(model, device) {
  return model?.runtime?.[device] || null;
}

export function getModelDefinition(id) {
  return MODEL_CATALOG.find(model => model.id === id) || null;
}
