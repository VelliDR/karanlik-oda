import * as ort from 'onnxruntime-web';

const CACHE_NAME = 'karanlik-oda-depth-v2';
const MODEL_PRIMARY_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx';
const MODEL_FALLBACK_URL = 'https://hf-mirror.com/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx';
const MODEL_EXPECTED_SIZE = 27258801; // ~26 MB

let session: ort.InferenceSession | null = null;
let isInitializing = false;

// WebAssembly ve multithreading ortam ayarları
// COOP/COEP başlıkları olmayan ortamlarda veya Safari'de SharedArrayBuffer desteklenmez.
// Bu durumda numThreads = 1 ayarlanarak kilitlenme ve thread çökmesi engellenir.
const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
ort.env.wasm.numThreads = hasSharedArrayBuffer
  ? Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2)
  : 1;

/**
 * Gizli sekme veya kısıtlı tarayıcı ortamlarında CacheStorage erişimini güvenli yapar.
 */
async function openCacheSafe(): Promise<Cache | null> {
  try {
    if (typeof caches !== 'undefined') {
      return await caches.open(CACHE_NAME);
    }
  } catch (err) {
    console.warn('CacheStorage erişilemedi (Gizli sekme veya kısıtlı ortam):', err);
  }
  return null;
}

/**
 * Modeli CacheStorage üzerinden çevrimdışı kalıcı olarak yükler veya
 * ilk seferde ilerleme yüzdesiyle indirip önbelleğe kaydeder.
 */
async function getModelBuffer(
  onProgress: (percent: number, loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const cache = await openCacheSafe();

  if (cache) {
    try {
      const cachedResponse = await cache.match(MODEL_PRIMARY_URL);
      if (cachedResponse) {
        const buffer = await cachedResponse.arrayBuffer();
        // Bütünlük kontrolü: Dosya en az 1 MB olmalı, aksi halde bozuk kayıt silinir
        if (buffer.byteLength > 1_000_000) {
          onProgress(100, buffer.byteLength, buffer.byteLength);
          return buffer;
        } else {
          console.warn('Bozuk model önbelleği siliniyor...');
          await cache.delete(MODEL_PRIMARY_URL);
        }
      }
    } catch (e) {
      console.warn('Önbellek okuma uyarısı:', e);
    }
  }

  // Çevrimdışı kontrolü
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Derinlik modeli henüz önbelleğe alınmamış ve cihazınız çevrimdışı. İlk indirme için internet bağlantısı gerekiyor.'
    );
  }

  // Birincil ve yedek sunucu indirme stratejisi
  let response: Response;
  try {
    response = await fetch(MODEL_PRIMARY_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  } catch (primaryErr) {
    console.warn('Birincil model kaynağından indirilemedi, yedek ayna sunucuya geçiliyor:', primaryErr);
    self.postMessage({ type: 'status', message: 'Yedek model sunucusuna bağlanılıyor...' });
    response = await fetch(MODEL_FALLBACK_URL);
    if (!response.ok) {
      throw new Error(`Model indirilemedi (HTTP ${response.status}: ${response.statusText})`);
    }
  }

  const contentLength = Number(response.headers.get('content-length')) || MODEL_EXPECTED_SIZE;
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (cache) {
      try {
        await cache.put(MODEL_PRIMARY_URL, new Response(buffer.slice(0), { headers: response.headers }));
      } catch (e) {
        console.warn('CacheStorage yazma uyarısı:', e);
      }
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
  if (cache) {
    try {
      const responseToCache = new Response(completeBuffer.buffer, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': loaded.toString()
        }
      });
      await cache.put(MODEL_PRIMARY_URL, responseToCache);
    } catch (err) {
      console.warn('CacheStorage kaydetme uyarısı:', err);
    }
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

    self.postMessage({ type: 'status', message: 'ONNX çalışma motoru hazırlanıyor...' });

    // Dayanıklı çift aşamalı başlatma zinciri:
    // Önce WebGPU denenir; GPU belleği veya sürücü hatası durumunda WASM SIMD'e düşer.
    try {
      self.postMessage({ type: 'status', message: 'WebGPU donanım hızlandırma deneniyor...' });
      session = await ort.InferenceSession.create(modelBuffer.slice(0), {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      self.postMessage({ type: 'status', message: 'WebGPU motoru aktif.' });
      return session;
    } catch (gpuErr) {
      console.warn('WebGPU başlatılamadı, WASM SIMD motoruna geçiliyor:', gpuErr);
      self.postMessage({ type: 'status', message: 'WASM SIMD motoru başlatılıyor...' });
      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      self.postMessage({ type: 'status', message: 'WASM SIMD motoru aktif.' });
      return session;
    }
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

      // Sıfır kopyalama ile ana iş parçacığına transfer et
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
