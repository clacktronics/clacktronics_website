/*
 * Fetching the Magenta RealTime 2 graphs, with a progress bar and a cache.
 *
 * Transformers.js does both of these for the models it loads, and does them
 * invisibly: a progress callback while it downloads, the Cache API so a second
 * visit is instant. MRT2 goes through ONNX Runtime directly, which does
 * neither — InferenceSession.create(url) fetches silently and keeps nothing.
 * At this size that is the difference between a usable app and an unusable
 * one, so both are done here.
 *
 * The graphs are fetched and turned into sessions one at a time rather than in
 * parallel. Together they are well over a gigabyte, and a browser holding all
 * of them as ArrayBuffers *and* copying them into the WebAssembly heap at the
 * same time is asking to be killed for it.
 */

const CACHE_NAME = 'audiogen-mrt2';

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    /* Private windows and storage-restricted contexts have no Cache API. The
     * models still load, they are simply fetched again next time. */
    return null;
  }
}

/* One graph, from the cache if it is there. `onChunk` is called with byte
 * counts as they arrive so the caller can drive a progress bar across the
 * whole set rather than per file. */
async function fetchGraph(url, cache, onChunk) {
  const cached = cache && await cache.match(url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    onChunk(buffer.byteLength, true);
    return new Uint8Array(buffer);
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url.split('/').pop()} (${response.status}).`);

  const declared = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onChunk(value.length, false);
  }

  const bytes = new Uint8Array(declared || received);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }

  if (cache) {
    try {
      await cache.put(url, new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) },
      }));
    } catch {
      /* Over quota, most likely. Not fatal: the model is already in hand. */
    }
  }
  return bytes;
}

/**
 * Fetch every graph the catalog lists and build a session for each.
 *
 * `graphs` is [{ key, path, sizeMB }]; the keys become the fields of the
 * returned sessions object, which is what the engine expects.
 */
export async function loadMrt2Sessions(ort, { baseUrl, graphs, device, onProgress, onDetail }) {
  const cache = await openCache();
  const total = graphs.reduce((sum, graph) => sum + graph.sizeMB * 1048576, 0);
  let loaded = 0;

  const sessions = {};
  for (const graph of graphs) {
    onDetail?.(`Fetching ${graph.path.split('/').pop()}...`);
    const bytes = await fetchGraph(`${baseUrl}${graph.path}`, cache, (count) => {
      loaded += count;
      onProgress?.(loaded, total);
    });
    onDetail?.(`Preparing ${graph.path.split('/').pop()}...`);
    sessions[graph.key] = await ort.InferenceSession.create(bytes, {
      executionProviders: [device || 'wasm'],
    });
    /* Nothing else holds this: the weights now live in the wasm heap. */
  }
  return sessions;
}

/** The SentencePiece model, which is a plain file rather than a graph. */
export async function fetchBytes(url) {
  const cache = await openCache();
  const cached = cache && await cache.match(url);
  if (cached) return cached.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url.split('/').pop()} (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (cache) {
    try { await cache.put(url, new Response(buffer)); } catch { /* over quota */ }
  }
  return buffer;
}
