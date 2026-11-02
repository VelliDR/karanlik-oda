import * as ort from 'onnxruntime-web';

const CACHE_NAME = 'karanlik-oda-depth-v2';
const MODEL_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx';
const MODEL_EXPECTED_SIZE = 27258801; // ~26 MB

let session: ort.InferenceSession | null = null;
let isInitializing = false;

// WebAssembly ve multithreading ortam ayarları
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
ort.env.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2);

/**
 * Modeli CacheStorage üzerinden çevrimdışı kalıcı olarak yükler veya
 * ilk seferde ilerleme yüzdesiyle indirip önbelleğe kaydeder.
 */
async function getModelBuffer(
  onProgress: (percent: number, loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(MODEL_URL);

  if (cachedResponse) {
    onProgress(100, MODEL_EXPECTED_SIZE, MODEL_EXPECTED_SIZE);
    return await cachedResponse.arrayBuffer();
  }

  // Çevrimdışı kontrolü
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Derinlik modeli henüz önbelleğe alınmamış ve cihazınız çevrimdışı. İlk indirme için internet bağlantısı gerekiyor.'
    );
  }

  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Model indirilemedi (HTTP ${response.status}: ${response.statusText})`);
  }

  const contentLength = Number(response.headers.get('content-length')) || MODEL_EXPECTED_SIZE;
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = await response.arrayBuffer();
    try {
      await cache.put(MODEL_URL, new Response(buffer.slice(0), { headers: response.headers }));
    } catch (e) {
      console.warn('CacheStorage yazma uyarısı:', e);
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      const percent = Math.min(99, Math.round((loaded / contentLength) * 100));
      onProgress(percent, loaded, contentLength);
    }
  }

  const completeBuffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    completeBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress(100, loaded, contentLength);

  // Kalıcı CacheStorage'a yaz
  try {
    const responseToCache = new Response(completeBuffer.buffer, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': loaded.toString()
      }
    });
    await cache.put(MODEL_URL, responseToCache);
  } catch (err) {
    console.warn('CacheStorage kaydetme uyarısı:', err);
  }

  return completeBuffer.buffer;
}

async function getOrInitSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (session) return session;
  }

  isInitializing = true;
  try {
    self.postMessage({ type: 'status', message: 'Derinlik modeli önbellekten okunuyor...' });

    const modelBuffer = await getModelBuffer((percent, loaded, total) => {
      self.postMessage({
        type: 'download-progress',
        percent,
        loaded,
        total
      });
    });

    self.postMessage({ type: 'status', message: 'ONNX çalışma motoru hazırlanıyor (WebGPU/Wasm)...' });

    // Önce WebGPU dener, desteklenmiyorsa güvenli WASM SIMD'e döner
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all'
    });

    self.postMessage({ type: 'status', message: 'Model hazır.' });
    return session;
  } finally {
    isInitializing = false;
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, floatArray } = e.data || {};

  if (type === 'run') {
    try {
      if (!floatArray || !(floatArray instanceof Float32Array)) {
        throw new Error('Geçersiz tensör verisi.');
      }

      const activeSession = await getOrInitSession();

      self.postMessage({ type: 'status', message: '3D derinlik haritası taranıyor...' });

      // NCHW tensör oluştur: [1, 3, 518, 518]
      const inputTensor = new ort.Tensor('float32', floatArray, [1, 3, 518, 518]);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[activeSession.inputNames[0]] = inputTensor;

      const results = await activeSession.run(feeds);
      const outTensor = results[activeSession.outputNames[0]];

      if (!outTensor || !outTensor.data) {
        throw new Error('Modelden derinlik tensörü alınamadı.');
      }

      const rawDepth = new Float32Array(outTensor.data as Float32Array);

      // Sıfır kopyalama ile transfer et
      (self as unknown as Worker).postMessage(
        {
          type: 'success',
          rawDepth
        },
        [rawDepth.buffer]
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', message: errMsg });
    }
  }
};
