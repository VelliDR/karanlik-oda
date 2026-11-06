import {
  AnyCanvas,
  CubeLUT3D,
  ExportFormat,
  PresetDefinition,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from './types';
import { PRESETS } from './presets';
import {
  applyBlackProMist,
  applyBleachBypass,
  applyCcdAesthetic,
  applyChromaticAberration,
  applyDepthOfField,
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
import { applySensitometryAndLUTCPU, setCustomCubeLUT } from './lut3d';
import { ColorLutWebGPUEngine } from './webgpu/ColorLutWebGPUEngine';
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';
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
  customLut?: CubeLUT3D | null;
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
    customLut
  } = e.data;

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
      ColorLutWebGPUEngine.getOrCreate()
    ]);

    const isTransposed = rotation === 90 || rotation === 270;
    const targetWidth = isTransposed ? imageBitmap.height : imageBitmap.width;
    const targetHeight = isTransposed ? imageBitmap.width : imageBitmap.height;

    const offscreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
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

    // Çekirdek pipeline'ı çalıştır
    renderPipelineInWorker(
      target,
      imageBitmap,
      settings,
      rotation,
      noisePattern,
      depthBitmap,
      rawDepth,
      depthRoi,
      customLut
    );

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
  depthRoi?: AspectROI | null,
  customLut?: CubeLUT3D | null
): void {
  const { ctx, width: w, height: h } = target;
  ctx.clearRect(0, 0, w, h);

  const preset = PRESETS[settings.preset] || PRESETS.none;
  const isCcd = settings.preset === 'ccd' || settings.preset === 'ccd_y2k';

  // 1. Ham Görsel Çizimi (Sıfır CSS filtresi)
  ctx.save();
  ctx.filter = 'none';
  drawImageWithRotationInWorker(target, sourceImg, rotation);
  ctx.restore();

  // 2. MERCEK OPTİĞİ
  // 🤖 3D Fiziksel Alan Derinliği & Helios 44M Swirl Optiği
  let fullDepthCanvas: AnyCanvas | null = null;
  if (settings.aiDepthEnabled) {
    const maxDepthDim = 1536;
    const depthW = Math.min(w, maxDepthDim);
    const depthH = Math.max(1, Math.round((h * depthW) / w));

    if (depthBitmap) {
      fullDepthCanvas = new OffscreenCanvas(depthW, depthH);
      const dCtx = fullDepthCanvas.getContext('2d');
      if (dCtx) {
        dCtx.imageSmoothingEnabled = true;
        dCtx.imageSmoothingQuality = 'high';
        dCtx.drawImage(depthBitmap, 0, 0, depthW, depthH);
      }
    } else if (rawDepth && depthRoi) {
      fullDepthCanvas = projectDepthMapFromRaw(rawDepth, depthRoi, depthW, depthH);
    }
  }

  if (settings.aiDepthEnabled && fullDepthCanvas && settings.swirl === 0) {
    applyDepthOfField(
      target,
      fullDepthCanvas,
      settings.aiFocalDepth,
      settings.aiDepthAperture
    );
  } else if (settings.swirl > 0) {
    applySwirlyBokeh(
      target,
      settings.swirl,
      fullDepthCanvas,
      settings.aiFocalDepth,
      settings.aiDepthAperture
    );
  }

  if (fullDepthCanvas) {
    fullDepthCanvas.width = 0;
    fullDepthCanvas.height = 0;
  }

  // Chromatic Aberration
  if (settings.chromatic > 0) {
    applyChromaticAberration(target, settings.chromatic);
  }

  // Black Pro-Mist
  if (settings.proMist > 0) {
    applyBlackProMist(target, settings.proMist);
  }

  // Mekanik Vinyet
  if (settings.vignette > 0) {
    applyVignette(target, settings.vignette);
  }

  // 3. FİLM EMÜLSİYONU: 650nm Spektral Halasyon + H&D Sensitometri & Omuz Sıkıştırması + 3D LUT Tetrahedral Enterpolasyon
  const colorGpuEngine = ColorLutWebGPUEngine.getInstanceSync();
  let gpuColorApplied = false;

  if (colorGpuEngine) {
    gpuColorApplied = colorGpuEngine.renderToTarget(target, settings, customLut);
  }

  if (!gpuColorApplied) {
    if (!isCcd && settings.halation > 0) {
      applyHalation(target, settings.halation);
    }
    applySensitometryAndLUTCPU(target, settings, customLut);
  }

  // 4. KİMYASAL BANYO & KORUMA KALKANLARI
  // Bleach Bypass
  if (settings.bleachBypass > 0) {
    applyBleachBypass(target, settings.bleachBypass);
  }

  // 🛡️ AKILLI EN-BOY ORANI KORUMALI TEN KALKANI
  if (settings.skinProtection > 0) {
    applySkinToneProtectionInWorker(target, sourceImg, rotation, settings, preset);
  }

  // 5. CCD Sensör Kusurları veya Analog Film Sızıntı & Gren Katmanı
  if (isCcd) {
    if (settings.lightLeak > 0) {
      applyLightLeak(target, settings.lightLeak);
    }
    applyCcdAesthetic(target, { mode: settings.preset as 'ccd' | 'ccd_y2k' });
  } else {
    // Light Leak
    if (settings.lightLeak > 0) {
      applyLightLeak(target, settings.lightLeak);
    }

    // 35mm Analog Film Greni
    const activeNoise = (preset.noise || 0) + (settings.grain / 100) * 0.22;
    if (activeNoise > 0 && noisePattern) {
      applyFilmGrain(target, noisePattern, activeNoise);
    }
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

function applySkinToneProtectionInWorker(
  target: RenderTarget,
  sourceImg: ImageBitmap,
  rotation: RotationDegree,
  settings: SliderSettings,
  preset: PresetDefinition
): void {
  const { ctx, width: w, height: h } = target;
  const skinMask = generateSkinProtectionMask(sourceImg, w, h, rotation, 512);
  if (!skinMask) return;

  const cleanSkinCanvas = createCompatibleCanvas(w, h);
  const sCtx = cleanSkinCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!sCtx) {
    skinMask.width = 0;
    skinMask.height = 0;
    return;
  }

  const skinTarget: RenderTarget = {
    canvas: cleanSkinCanvas,
    ctx: sCtx,
    width: w,
    height: h
  };

  drawImageWithRotationInWorker(skinTarget, sourceImg, rotation);

  const isMono = preset.id === 'sb' || preset.id === 'hp5';
  const skinSettings: SliderSettings = {
    ...settings,
    preset: isMono ? 'hp5' : 'analog',
    contrast: Math.round(settings.contrast * 0.35),
    shoulder: Math.max(65, settings.shoulder ?? 55),
    saturation: isMono ? 0 : Math.max(-10, Math.min(12, Math.round(settings.saturation * 0.35))),
    warmth: isMono ? 0 : Math.max(0, Math.min(18, Math.round(settings.warmth * 0.45))),
    halation: 0
  };

  const colorGpuEngine = ColorLutWebGPUEngine.getInstanceSync();
  const gpuOk = colorGpuEngine ? colorGpuEngine.renderToTarget(skinTarget, skinSettings, null) : false;
  if (!gpuOk) {
    applySensitometryAndLUTCPU(skinTarget, skinSettings, null);
  }

  // Maskeyi uygulayarak yalnızca ten alanlarını izole et
  sCtx.globalCompositeOperation = 'destination-in';
  sCtx.drawImage(skinMask as CanvasImageSource, 0, 0);

  // İzole edilen doğal teni hedef tuvale koruma gücü oranında (%0 - %100) harmanla
  ctx.save();
  ctx.globalAlpha = Math.min(1.0, Math.max(0, settings.skinProtection / 100));
  ctx.drawImage(cleanSkinCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  cleanSkinCanvas.width = 0;
  cleanSkinCanvas.height = 0;
  skinMask.width = 0;
  skinMask.height = 0;
}

