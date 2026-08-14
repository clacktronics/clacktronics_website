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
    downloadSizeMB: 656,
    memoryNote: 'Allow roughly 1.5 GB of free memory while generating.',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://huggingface.co/facebook/musicgen-small',
    modelUrl: 'https://huggingface.co/Xenova/musicgen-small',
    defaults: Object.freeze({ duration: 8, guidance: 3, temperature: 1 }),
    limits: Object.freeze({ minDuration: 2, maxDuration: 20 }),
    runtime: Object.freeze({
      device: 'wasm',
      dtype: Object.freeze({
        text_encoder: 'q8',
        decoder_model_merged: 'q8',
        encodec_decode: 'fp32',
      }),
    }),
  }),
]);

export function getModelDefinition(id) {
  return MODEL_CATALOG.find(model => model.id === id) || null;
}
