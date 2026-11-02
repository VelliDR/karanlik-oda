import {
  AnyCanvas,
  ExportFormat,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from './types';
import { PRESETS } from './presets';
import {
  applyBlackProMist,
  applyBleachBypass,
  applyChromaticAberration,
  applyFilmBorder,
  applyFilmGrain,
  applyHalation,
  applyLightLeak,
  applyQuartzDate,
  applySwirlyBokeh,
  applyVignette,
  createCompatibleCanvas,
  createNoisePattern
} from './optics';
import { AspectROI, generateSkinProtectionMask, projectDepthMapFromRaw } from './aspect-shield';
import { inject300DpiAndExifToJpeg, inject300DpiToPng } from './metadata';

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
    depthRoi
  } = e.data;

  try {
    self.postMessage({
      type: 'progress',
      step: 'init',
      percent: 15,
      message: 'Tam çözünürlüklü tuval hazırlanıyor...'
    } as WorkerMessageToMain);

    const isTransposed = rotation === 90 || rotation === 270;
    const targetWidth = isTransposed ? imageBitmap.height : imageBitmap.width;
    const targetHeight = isTransposed ? imageBitmap.width : imageBitmap.height;

    const offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

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
      message: 'Analog banyo ve optik kusurlar işleniyor...'
    } as WorkerMessageToMain);

    // Çekirdek pipeline'ı çalıştır
    renderPipelineInWorker(target, imageBitmap, settings, rotation, noisePattern, depthBitmap, rawDepth, depthRoi);

    self.postMessage({
      type: 'progress',
      step: 'converting',
      percent: 75,
      message: '300 DPI ve metaveri enjekte ediliyor...'
    } as WorkerMessageToMain);

    let blob = await offscreenCanvas.convertToBlob({ type: format, quality });

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
    imageBitmap.close();
    if (depthBitmap) {
      try {
        depthBitmap.close();
      } catch {}
    }
  }
};

function renderPipelineInWorker(
  target: RenderTarget,
  sourceImg: ImageBitmap,
  settings: SliderSettings,
  rotation: RotationDegree,
  noisePattern: CanvasPattern | null,
  depthBitmap?: ImageBitmap | null,
  rawDepth?: Float32Array | null,
  depthRoi?: AspectROI | null
): void {
  const { ctx, width: w, height: h } = target;
  ctx.clearRect(0, 0, w, h);

  const preset = PRESETS[settings.preset] || PRESETS.none;

  const exp = 100 + settings.exposure;
  const con = 100 + settings.contrast;
  const sat = 100 + settings.saturation;

  let filterString = `brightness(${exp}%) contrast(${con}%) saturate(${sat}%)`;
  if (preset.filter !== 'none') {
    filterString += ` ${preset.filter}`;
  }

  ctx.save();
  ctx.filter = filterString;
  drawImageWithRotationInWorker(target, sourceImg, rotation);
  ctx.filter = 'none';
  ctx.restore();

  // Renk Sıcaklığı (Warmth)
  if (settings.warmth !== 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = Math.abs(settings.warmth) / 250;
    ctx.fillStyle = settings.warmth > 0 ? '#ffb300' : '#00b3ff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Preset Renk Örtüsü - En-Boy Oranı Korumalı Ten Kalkanı ile
  if (preset.overlayColor && preset.overlayOpacity > 0) {
    if (settings.skinProtection > 0) {
      const skinMask = generateSkinProtectionMask(target.canvas, w, h, settings.skinProtection);
      if (skinMask) {
        const overlayCanvas = createCompatibleCanvas(w, h);
        const oCtx = overlayCanvas.getContext('2d');
        if (oCtx) {
          oCtx.fillStyle = preset.overlayColor;
          oCtx.fillRect(0, 0, w, h);
          oCtx.globalCompositeOperation = 'destination-out';
          oCtx.drawImage(skinMask as CanvasImageSource, 0, 0);

          ctx.save();
          ctx.globalCompositeOperation = preset.blendMode;
          ctx.globalAlpha = preset.overlayOpacity;
          ctx.drawImage(overlayCanvas as CanvasImageSource, 0, 0);
          ctx.restore();

          overlayCanvas.width = 0;
          overlayCanvas.height = 0;
        }
        skinMask.width = 0;
        skinMask.height = 0;
      } else {
        ctx.save();
        ctx.globalCompositeOperation = preset.blendMode;
        ctx.globalAlpha = preset.overlayOpacity;
        ctx.fillStyle = preset.overlayColor;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    } else {
      ctx.save();
      ctx.globalCompositeOperation = preset.blendMode;
      ctx.globalAlpha = preset.overlayOpacity;
      ctx.fillStyle = preset.overlayColor;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // Bleach Bypass
  if (settings.bleachBypass > 0) {
    applyBleachBypass(target, settings.bleachBypass);
  }

  // Black Pro-Mist
  if (settings.proMist > 0) {
    applyBlackProMist(target, settings.proMist);
  }

  // Helios 44M Swirl Bokeh (Kedi Gözü & 3D Derinlik Kalkanı)
  if (settings.swirl > 0) {
    let fullDepthCanvas: AnyCanvas | null = null;
    if (settings.aiDepthEnabled) {
      if (depthBitmap) {
        fullDepthCanvas = new OffscreenCanvas(w, h);
        const dCtx = fullDepthCanvas.getContext('2d');
        if (dCtx) {
          dCtx.imageSmoothingEnabled = true;
          dCtx.imageSmoothingQuality = 'high';
          dCtx.drawImage(depthBitmap, 0, 0, w, h);
        }
      } else if (rawDepth && depthRoi) {
        fullDepthCanvas = projectDepthMapFromRaw(rawDepth, depthRoi, w, h);
      }
    }
    applySwirlyBokeh(
      target,
      settings.swirl,
      fullDepthCanvas,
      settings.aiFocalDepth,
      settings.aiDepthAperture
    );
    if (fullDepthCanvas) {
      fullDepthCanvas.width = 0;
      fullDepthCanvas.height = 0;
    }
  }

  // Chromatic Aberration
  if (settings.chromatic > 0) {
    applyChromaticAberration(target, settings.chromatic);
  }

  // CineStill 800T Halation
  if (settings.preset === 'cinestill') {
    applyHalation(target);
  }

  // Light Leak
  if (settings.lightLeak > 0) {
    applyLightLeak(target, settings.lightLeak);
  }

  // Film Grain
  const activeNoise = (preset.noise || 0) + (settings.grain / 100) * 0.22;
  if (activeNoise > 0 && noisePattern) {
    applyFilmGrain(target, noisePattern, activeNoise);
  }

  // Vignette
  if (settings.vignette > 0) {
    applyVignette(target, settings.vignette);
  }

  // Film Border
  if (settings.filmBorder !== 'none') {
    applyFilmBorder(target, settings.filmBorder);
  }

  // Quartz Date
  if (settings.quartzDate) {
    applyQuartzDate(target, settings.quartzDate, settings.quartzDateText);
  }
}

function drawImageWithRotationInWorker(
  target: RenderTarget,
  sourceImg: ImageBitmap,
  rotation: RotationDegree
): void {
  const { ctx, width: w, height: h } = target;
  const srcW = sourceImg.width;
  const srcH = sourceImg.height;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(sourceImg, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
}
