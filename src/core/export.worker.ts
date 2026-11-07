import {
  CubeLUT3D,
  DodgeBurnMap,
  ExportFormat,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from './types';
import { createNoisePattern } from './optics';
import { setCustomCubeLUT } from './lut3d';
import { ColorLutWebGPUEngine } from './webgpu/ColorLutWebGPUEngine';
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';
import { PaperPrintWebGPUEngine } from './webgpu/PaperPrintWebGPUEngine';
import { AspectROI } from './aspect-shield';
import { inject300DpiAndExifToJpeg, inject300DpiToPng } from './metadata';
import { executeRenderPipeline } from './pipeline/render-pipeline';

export interface WorkerExportPayload {
  imageBitmap: ImageBitmap;
  settings: SliderSettings;
  rotation: RotationDegree;
  format: ExportFormat;
  quality: number;
  originalMetadataSegments: Uint8Array[];
  dpi: number;
  depthBitmap?: ImageBitmap | null;
  rawDepth?: Float32Array | null;
  depthRoi?: AspectROI | null;
  customLut?: CubeLUT3D | null;
  dodgeBurnMap?: DodgeBurnMap | null;
}

export type WorkerMessageToMain =
  | { type: 'progress'; step: string; percent: number; message: string }
  | { type: 'success'; blob: Blob; extension: string; mimeType: string }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerExportPayload>) => {
  const {
    imageBitmap,
    settings,
    rotation,
    format,
    quality,
    originalMetadataSegments,
    dpi = 300,
    depthBitmap,
    rawDepth,
    depthRoi,
    customLut,
    dodgeBurnMap
  } = e.data;

  let offscreenCanvas: OffscreenCanvas | null = null;

  try {
    self.postMessage({
      type: 'progress',
      step: 'init',
      percent: 15,
      message: 'Tam çözünürlüklü tuval ve 3D LUT motoru hazırlanıyor...'
    } as WorkerMessageToMain);

    if (customLut) {
      setCustomCubeLUT(customLut);
    }

    // Worker içinde WebGPU destekleniyorsa motorları hazırla
    await Promise.all([
      HeliosWebGPUEngine.getOrCreate(),
      ColorLutWebGPUEngine.getOrCreate(),
      PaperPrintWebGPUEngine.getOrCreate()
    ]);

    const isTransposed = rotation === 90 || rotation === 270;
    const targetWidth = isTransposed ? imageBitmap.height : imageBitmap.width;
    const targetHeight = isTransposed ? imageBitmap.width : imageBitmap.height;

    offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = offscreenCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('OffscreenCanvas 2D bağlamı oluşturulamadı.');
    }

    const noisePattern = createNoisePattern(ctx);
    const target: RenderTarget = {
      canvas: offscreenCanvas,
      ctx,
      width: targetWidth,
      height: targetHeight
    };

    self.postMessage({
      type: 'progress',
      step: 'pipeline',
      percent: 40,
      message: '3D LUT tetrahedral eşleme, H&D eğrisi ve optik kusurlar işleniyor...'
    } as WorkerMessageToMain);

    // Çekirdek birleşik pipeline'ı çalıştır
    executeRenderPipeline({
      target,
      sourceImg: imageBitmap,
      settings,
      rotation,
      noisePattern,
      depthBitmap,
      rawDepth,
      depthRoi,
      customLut,
      dodgeBurnMap: dodgeBurnMap ?? null,
      fullDimensions: { width: targetWidth, height: targetHeight }
    });

    self.postMessage({
      type: 'progress',
      step: 'converting',
      percent: 75,
      message: '300 DPI ve metaveri enjekte ediliyor...'
    } as WorkerMessageToMain);

    let blob = await offscreenCanvas.convertToBlob({ type: format, quality });

    // 24MP OffscreenCanvas arka plan tamponunu metaveri enjeksiyonu öncesinde hemen serbest bırak
    offscreenCanvas.width = 0;
    offscreenCanvas.height = 0;

    if (format === 'image/jpeg') {
      blob = await inject300DpiAndExifToJpeg(blob, originalMetadataSegments, dpi);
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
      step: 'done',
      percent: 100,
      message: 'Banyo tamamlandı!'
    } as WorkerMessageToMain);

    self.postMessage({
      type: 'success',
      blob,
      extension: extensionMap[format] || 'png',
      mimeType: format
    } as WorkerMessageToMain);
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: err?.message || 'Arka plan render işlemi başarısız oldu.'
    } as WorkerMessageToMain);
  } finally {
    if (offscreenCanvas) {
      offscreenCanvas.width = 0;
      offscreenCanvas.height = 0;
      offscreenCanvas = null;
    }
    PaperPrintWebGPUEngine.getInstanceSync()?.releaseScratchResources();
    imageBitmap.close();
    if (depthBitmap) {
      try {
        depthBitmap.close();
      } catch {}
    }
  }
};
