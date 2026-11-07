import { CubeLUT3D, ExportFormat, SliderSettings, StripConfig } from '../types';
import { setCustomCubeLUT } from '../lut3d';
import { inject300DpiAndExifToJpeg, inject300DpiToPng } from '../metadata';
import { ColorLutWebGPUEngine } from '../webgpu/ColorLutWebGPUEngine';
import { FilmChemistryWebGPUEngine } from '../webgpu/FilmChemistryWebGPUEngine';
import { HeliosWebGPUEngine } from '../webgpu/HeliosWebGPUEngine';
import { PaperPrintWebGPUEngine } from '../webgpu/PaperPrintWebGPUEngine';
import {
  composeFilmStrip,
  StripFrameSource,
  StripMemoryStats
} from './strip-compositor';

export interface StripWorkerExportPayload {
  frames: StripFrameSource[];
  sharedSettings: SliderSettings;
  stripConfig: StripConfig;
  format: ExportFormat;
  quality: number;
  dpi: number;
  customLut?: CubeLUT3D | null;
}

export type StripWorkerMessageToMain =
  | { type: 'progress'; percent: number; message: string }
  | {
      type: 'success';
      blob: Blob;
      extension: string;
      mimeType: string;
      stats: StripMemoryStats;
    }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<StripWorkerExportPayload>) => {
  const {
    frames,
    sharedSettings,
    stripConfig,
    format,
    quality,
    dpi = 300,
    customLut = null
  } = e.data;

  let composedCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  try {
    self.postMessage({
      type: 'progress',
      percent: 5,
      message: '35mm şerit ve karanlık oda motorları hazırlanıyor...'
    } as StripWorkerMessageToMain);

    if (customLut) {
      setCustomCubeLUT(customLut);
    }

    await Promise.all([
      HeliosWebGPUEngine.getOrCreate(),
      ColorLutWebGPUEngine.getOrCreate(),
      FilmChemistryWebGPUEngine.getOrCreate(),
      PaperPrintWebGPUEngine.getOrCreate()
    ]);

    const result = await composeFilmStrip({
      frames,
      sharedSettings,
      stripConfig,
      customLut,
      useCellCache: false,
      onProgress: (percent, message) => {
        self.postMessage({
          type: 'progress',
          percent,
          message
        } as StripWorkerMessageToMain);
      }
    });

    composedCanvas = result.canvas;
    if (!('convertToBlob' in composedCanvas)) {
      throw new Error('Worker içinde OffscreenCanvas.convertToBlob kullanılamadı.');
    }

    self.postMessage({
      type: 'progress',
      percent: 96,
      message: '300 DPI metaveri başlıkları mühürleniyor...'
    } as StripWorkerMessageToMain);

    let blob = await composedCanvas.convertToBlob({ type: format, quality });

    // Birleşik şerit tuvalini metaveri enjeksiyonu öncesinde hemen serbest bırak
    composedCanvas.width = 0;
    composedCanvas.height = 0;
    composedCanvas = null;

    if (format === 'image/jpeg') {
      blob = await inject300DpiAndExifToJpeg(blob, [], dpi);
    } else if (format === 'image/png') {
      blob = await inject300DpiToPng(blob, dpi);
    }

    const extensionMap: Record<ExportFormat, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp'
    };

    self.postMessage({
      type: 'progress',
      percent: 100,
      message: 'Film şeridi hazır!'
    } as StripWorkerMessageToMain);

    self.postMessage({
      type: 'success',
      blob,
      extension: extensionMap[format] || 'png',
      mimeType: format,
      stats: result.stats
    } as StripWorkerMessageToMain);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Film şeridi arka plan dışa aktarma hatası.';
    self.postMessage({
      type: 'error',
      message
    } as StripWorkerMessageToMain);
  } finally {
    if (composedCanvas) {
      composedCanvas.width = 0;
      composedCanvas.height = 0;
      composedCanvas = null;
    }
    FilmChemistryWebGPUEngine.getInstanceSync()?.releaseScratchResources();
    PaperPrintWebGPUEngine.getInstanceSync()?.releaseScratchResources();
  }
};
