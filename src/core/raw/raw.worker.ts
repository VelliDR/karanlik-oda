import { LibRawSession } from './libraw-client';
import { RawDecodedImage, RawMetadata } from './libraw-types';

export type RawWorkerInputMessage =
  | { type: 'decode'; buffer: ArrayBuffer; halfSize?: boolean }
  | { type: 'export_full'; buffer: ArrayBuffer };

export type RawWorkerOutputMessage =
  | { type: 'metadata'; metadata: RawMetadata }
  | { type: 'thumbnail'; blob: Blob; metadata: RawMetadata }
  | {
      type: 'preview_ready';
      imageBitmap: ImageBitmap;
      linearData?: ArrayBuffer;
      width: number;
      height: number;
      bits: number;
      metadata: RawMetadata;
    }
  | {
      type: 'full_ready';
      imageBitmap: ImageBitmap;
      width: number;
      height: number;
      bits: number;
    }
  | { type: 'progress'; percent: number; message: string }
  | { type: 'error'; message: string };

function convertRawToImageData(decoded: RawDecodedImage): ImageData {
  const { width, height, colors, bits, data } = decoded;
  const numPixels = width * height;
  const rgba = new Uint8ClampedArray(numPixels * 4);

  if (bits === 16) {
    const u16 = data as Uint16Array;
    let srcIdx = 0;
    let dstIdx = 0;

    for (let i = 0; i < numPixels; i++) {
      // 16-bit'ten 8-bit'e ölçekleme (val >> 8)
      rgba[dstIdx] = u16[srcIdx] >> 8;
      rgba[dstIdx + 1] = u16[srcIdx + 1] >> 8;
      rgba[dstIdx + 2] = u16[srcIdx + 2] >> 8;
      rgba[dstIdx + 3] = 255;

      srcIdx += colors;
      dstIdx += 4;
    }
  } else {
    const u8 = data as Uint8Array;
    let srcIdx = 0;
    let dstIdx = 0;

    for (let i = 0; i < numPixels; i++) {
      rgba[dstIdx] = u8[srcIdx];
      rgba[dstIdx + 1] = u8[srcIdx + 1];
      rgba[dstIdx + 2] = u8[srcIdx + 2];
      rgba[dstIdx + 3] = 255;

      srcIdx += colors;
      dstIdx += 4;
    }
  }

  return new ImageData(rgba, width, height);
}

self.onmessage = async (e: MessageEvent<RawWorkerInputMessage>) => {
  const msg = e.data;

  try {
    if (msg.type === 'decode') {
      self.postMessage({
        type: 'progress',
        percent: 10,
        message: 'LibRaw WASM motoru başlatılıyor...'
      } as RawWorkerOutputMessage);

      const session = await LibRawSession.open(msg.buffer);

      try {
        const metadata = session.getMetadata();
        self.postMessage({
          type: 'metadata',
          metadata
        } as RawWorkerOutputMessage);

        // 1. Aşama: Anlık Gömülü JPEG Önizlemesini Çıkar (< 300 ms)
        self.postMessage({
          type: 'progress',
          percent: 25,
          message: 'Gömülü önizleme görüntüsü taranıyor...'
        } as RawWorkerOutputMessage);

        const thumb = session.extractThumbnail();
        if (thumb && thumb.format === 'jpeg') {
          const blob = new Blob([thumb.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
          self.postMessage({
            type: 'thumbnail',
            blob,
            metadata
          } as RawWorkerOutputMessage);
        }

        // 2. Aşama: 16-bit Lineer Bayer Demosaicing (Hızlı Önizleme)
        self.postMessage({
          type: 'progress',
          percent: 50,
          message: '16-bit Lineer Bayer demosaic hesaplanıyor...'
        } as RawWorkerOutputMessage);

        const halfSize = msg.halfSize !== undefined ? msg.halfSize : true;
        const decoded = session.process(halfSize, 16, 1);

        self.postMessage({
          type: 'progress',
          percent: 85,
          message: 'Tuval bitmap dokusu oluşturuluyor...'
        } as RawWorkerOutputMessage);

        const imgData = convertRawToImageData(decoded);
        const bitmap = await createImageBitmap(imgData);

        (self as any).postMessage(
          {
            type: 'preview_ready',
            imageBitmap: bitmap,
            linearData: (decoded.data as Uint16Array).buffer,
            width: decoded.width,
            height: decoded.height,
            bits: decoded.bits,
            metadata
          } as RawWorkerOutputMessage,
          [bitmap, (decoded.data as Uint16Array).buffer]
        );
      } finally {
        session.close();
      }
    } else if (msg.type === 'export_full') {
      self.postMessage({
        type: 'progress',
        percent: 20,
        message: 'Tam çözünürlüklü 16-bit demosaic başlatılıyor...'
      } as RawWorkerOutputMessage);

      const session = await LibRawSession.open(msg.buffer);
      try {
        const decoded = session.process(false, 16, 1);
        const imgData = convertRawToImageData(decoded);
        const bitmap = await createImageBitmap(imgData);

        (self as any).postMessage(
          {
            type: 'full_ready',
            imageBitmap: bitmap,
            width: decoded.width,
            height: decoded.height,
            bits: decoded.bits
          } as RawWorkerOutputMessage,
          [bitmap]
        );
      } finally {
        session.close();
      }
    }
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: err?.message || 'RAW çözümleme sırasında hata oluştu.'
    } as RawWorkerOutputMessage);
  }
};
