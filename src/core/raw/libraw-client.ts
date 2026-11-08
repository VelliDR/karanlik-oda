import { RawDecodedImage, RawMetadata, RawThumbnail } from './libraw-types';

export interface LibRawWasmModule {
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _raw_create(): number;
  _raw_open_buffer(handle: number, bufPtr: number, size: number): number;
  _raw_get_metadata(handle: number, outPtr: number): number;
  _raw_extract_thumbnail(handle: number, outPtr: number): number;
  _raw_process_image(
    handle: number,
    halfSize: number,
    outputBps: number,
    outputColor: number,
    highlightMode: number,
    outPtr: number
  ): number;
  _raw_free_image(outPtr: number): void;
  _raw_free_thumbnail(outPtr: number): void;
  _raw_close(handle: number): void;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  UTF8ToString(ptr: number, maxBytes?: number): string;
}

let wasmModulePromise: Promise<LibRawWasmModule> | null = null;

function getWasmUrls(): { jsUrl: string; wasmUrl: string } {
  let origin = 'http://localhost:5173';
  if (typeof self !== 'undefined' && self.location && self.location.origin) {
    origin = self.location.origin;
  }
  return {
    jsUrl: new URL('/wasm/libraw.js', origin).href,
    wasmUrl: new URL('/wasm/libraw.wasm', origin).href
  };
}

export async function getLibRawModule(): Promise<LibRawWasmModule> {
  if (wasmModulePromise) return wasmModulePromise;

  wasmModulePromise = (async () => {
    const { jsUrl, wasmUrl } = getWasmUrls();
    // Vite üzerinden public/wasm/libraw.js dinamik yükleme
    // @ts-ignore
    const moduleFactory = (await import(/* @vite-ignore */ jsUrl)).default;
    const mod: LibRawWasmModule = await moduleFactory({
      locateFile(path: string) {
        if (path.endsWith('.wasm')) {
          return wasmUrl;
        }
        return path;
      }
    });
    return mod;
  })();

  return wasmModulePromise;
}

export class LibRawSession {
  private mod: LibRawWasmModule;
  private handle: number;
  private isClosed = false;

  private constructor(mod: LibRawWasmModule, handle: number) {
    this.mod = mod;
    this.handle = handle;
  }

  public static async open(buffer: ArrayBuffer): Promise<LibRawSession> {
    const mod = await getLibRawModule();
    const handle = mod._raw_create();
    if (!handle) {
      throw new Error('LibRaw instance oluşturulamadı.');
    }

    const byteLen = buffer.byteLength;
    const bufPtr = mod._malloc(byteLen);
    mod.HEAPU8.set(new Uint8Array(buffer), bufPtr);

    const ret = mod._raw_open_buffer(handle, bufPtr, byteLen);
    mod._free(bufPtr);

    if (ret !== 0) {
      mod._raw_close(handle);
      throw new Error(`LibRaw dosya çözümleme hatası (kod: ${ret})`);
    }

    return new LibRawSession(mod, handle);
  }

  public getMetadata(): RawMetadata {
    this.assertOpen();
    const metaSize = 232;
    const ptr = this.mod._malloc(metaSize);
    this.mod.HEAPU8.fill(0, ptr, ptr + metaSize);

    try {
      const ret = this.mod._raw_get_metadata(this.handle, ptr);
      if (ret !== 0) {
        throw new Error('RAW metaverisi okunamadı.');
      }

      const p32 = ptr >> 2;
      const width = this.mod.HEAP32[p32 + 0];
      const height = this.mod.HEAP32[p32 + 1];
      const rawWidth = this.mod.HEAP32[p32 + 2];
      const rawHeight = this.mod.HEAP32[p32 + 3];
      const flip = this.mod.HEAP32[p32 + 4];
      const colors = this.mod.HEAP32[p32 + 5];

      const iso = this.mod.HEAPF32[p32 + 6];
      const shutter = this.mod.HEAPF32[p32 + 7];
      const aperture = this.mod.HEAPF32[p32 + 8];
      const focalLength = this.mod.HEAPF32[p32 + 9];

      const camMul: [number, number, number, number] = [
        this.mod.HEAPF32[p32 + 10],
        this.mod.HEAPF32[p32 + 11],
        this.mod.HEAPF32[p32 + 12],
        this.mod.HEAPF32[p32 + 13]
      ];

      const rgbCam: [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number]
      ] = [
        [
          this.mod.HEAPF32[p32 + 14],
          this.mod.HEAPF32[p32 + 15],
          this.mod.HEAPF32[p32 + 16],
          this.mod.HEAPF32[p32 + 17]
        ],
        [
          this.mod.HEAPF32[p32 + 18],
          this.mod.HEAPF32[p32 + 19],
          this.mod.HEAPF32[p32 + 20],
          this.mod.HEAPF32[p32 + 21]
        ],
        [
          this.mod.HEAPF32[p32 + 22],
          this.mod.HEAPF32[p32 + 23],
          this.mod.HEAPF32[p32 + 24],
          this.mod.HEAPF32[p32 + 25]
        ]
      ];

      const make = this.mod.UTF8ToString(ptr + 104, 64);
      const model = this.mod.UTF8ToString(ptr + 168, 64);

      return {
        width,
        height,
        rawWidth,
        rawHeight,
        flip,
        colors,
        iso,
        shutter,
        aperture,
        focalLength,
        camMul,
        rgbCam,
        make,
        model
      };
    } finally {
      this.mod._free(ptr);
    }
  }

  /**
   * Gömülü JPEG veya küçük önizleme görselini çıkarır.
   * < 200 ms sürer; kullanıcıya ilk anlık görüntüyü vermek için idealdir.
   */
  public extractThumbnail(): RawThumbnail | null {
    this.assertOpen();
    const thumbStructSize = 16;
    const ptr = this.mod._malloc(thumbStructSize);
    this.mod.HEAPU8.fill(0, ptr, ptr + thumbStructSize);

    try {
      const ret = this.mod._raw_extract_thumbnail(this.handle, ptr);
      if (ret !== 0) {
        return null;
      }

      const p32 = ptr >> 2;
      const formatNum = this.mod.HEAP32[p32 + 0];
      const dataSize = this.mod.HEAP32[p32 + 1] >>> 0;
      const dataPtr = this.mod.HEAP32[p32 + 2];

      if (!dataPtr || dataSize === 0) {
        this.mod._raw_free_thumbnail(ptr);
        return null;
      }

      // Buffer kopyasını al
      const dataCopy = new Uint8Array(dataSize);
      dataCopy.set(this.mod.HEAPU8.subarray(dataPtr, dataPtr + dataSize));

      this.mod._raw_free_thumbnail(ptr);

      return {
        format: formatNum === 1 ? 'jpeg' : 'bitmap',
        data: dataCopy
      };
    } finally {
      this.mod._free(ptr);
    }
  }

  /**
   * RAW verisini demosaic eder ve hafıza dizisi olarak döner.
   * @param halfSize Hızlı %50 boyutlu Bayer önizleme için true
   * @param outputBps 16 (Lineer 16-bit uint16) veya 8 (uint8)
   * @param outputColor 0 = RAW Camera, 1 = sRGB, 2 = AdobeRGB, 4 = ProPhotoRGB
   */
  public process(
    halfSize: boolean = true,
    outputBps: 16 | 8 = 16,
    outputColor: number = 1
  ): RawDecodedImage {
    this.assertOpen();
    const imgStructSize = 28;
    const ptr = this.mod._malloc(imgStructSize);
    this.mod.HEAPU8.fill(0, ptr, ptr + imgStructSize);

    try {
      const ret = this.mod._raw_process_image(
        this.handle,
        halfSize ? 1 : 0,
        outputBps,
        outputColor,
        0, // highlight: clip
        ptr
      );

      if (ret !== 0) {
        throw new Error(`LibRaw demosaic hatası (kod: ${ret})`);
      }

      const p32 = ptr >> 2;
      const width = this.mod.HEAP32[p32 + 0];
      const height = this.mod.HEAP32[p32 + 1];
      const colors = this.mod.HEAP32[p32 + 2];
      const bits = this.mod.HEAP32[p32 + 3];
      const dataSize = this.mod.HEAP32[p32 + 4] >>> 0;
      const dataPtr = this.mod.HEAP32[p32 + 5];

      if (!dataPtr || dataSize === 0) {
        this.mod._raw_free_image(ptr);
        throw new Error('Demosaic verisi boş döndü.');
      }

      let dataArray: Uint16Array | Uint8Array;
      if (bits === 16) {
        const u16Len = dataSize >> 1;
        const u16Offset = dataPtr >> 1;
        dataArray = new Uint16Array(u16Len);
        dataArray.set(this.mod.HEAPU16.subarray(u16Offset, u16Offset + u16Len));
      } else {
        dataArray = new Uint8Array(dataSize);
        dataArray.set(this.mod.HEAPU8.subarray(dataPtr, dataPtr + dataSize));
      }

      this.mod._raw_free_image(ptr);

      return {
        width,
        height,
        colors,
        bits,
        data: dataArray
      };
    } finally {
      this.mod._free(ptr);
    }
  }

  public close(): void {
    if (!this.isClosed && this.handle) {
      this.mod._raw_close(this.handle);
      this.handle = 0;
      this.isClosed = true;
    }
  }

  private assertOpen(): void {
    if (this.isClosed || !this.handle) {
      throw new Error('LibRaw oturumu kapatılmış.');
    }
  }
}
