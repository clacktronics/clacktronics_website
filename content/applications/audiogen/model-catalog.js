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
     * lands slower than the CPU build it replaced.
     *
     * The decoder is q4 rather than fp16 for two separate reasons, and either
     * one alone would decide it. decoder_model_merged_fp16.onnx does not load
     * at all: both branches of its If node return outer scope values straight
     * through — logits and all forty-eight cache tensors — which ONNX Runtime
     * rejects while it is still parsing the graph, on any backend. The export
     * is wrong rather than unsupported, and no flag here gets round it. And q4
     * is the better weight regardless, because it lands on MatMulNBits, which
     * is the block-quantized path the WebGPU backend actually has kernels for.
     *
     * encodec_decode stays on the processor, for the same reason
     * prepare_inputs_embeds does in the Text to Image worker: it turns the
     * codes into a waveform once per clip, where the decoder above it has just
     * run a thousand times, so what the adapter would win is a fraction of a
     * second against one more session's worth of graphics memory held for the
     * whole generation. Keeping it here also keeps the build on the fp32 file
     * the CPU path already uses — a file this app has actually run, rather
     * than the fp16 export, which nothing here has ever exercised. It is
     * shared between the two builds, so it costs nothing to fetch twice. */
    runtime: Object.freeze({
      webgpu: Object.freeze({
        downloadSizeMB: 640,
        memoryNote: 'Allow roughly 1.5 GB of free memory, most of it on the graphics adapter, while generating.',
        device: Object.freeze({
          text_encoder: 'webgpu',
          decoder_model_merged: 'webgpu',
          encodec_decode: 'wasm',
        }),
        dtype: Object.freeze({
          text_encoder: 'fp16',
          decoder_model_merged: 'q4',
          encodec_decode: 'fp32',
        }),
      }),
      wasm: Object.freeze({
        downloadSizeMB: 656,
        memoryNote: 'Allow roughly 1.5 GB of free memory while generating.',
        device: 'wasm',
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
