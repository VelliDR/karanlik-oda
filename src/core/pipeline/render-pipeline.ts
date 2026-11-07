import {
  AnyCanvas,
  CubeLUT3D,
  PresetDefinition,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from '../types';
import { PRESETS } from '../presets';
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
  createCompatibleCanvas
} from '../optics';
import { applySensitometryAndLUTCPU, getCustomCubeLUT } from '../lut3d';
import { ColorLutWebGPUEngine } from '../webgpu/ColorLutWebGPUEngine';
import { AspectROI, generateSkinProtectionMask, projectDepthMapFromRaw } from '../aspect-shield';

export interface PipelineRenderOptions {
  target: RenderTarget;
  sourceImg: HTMLImageElement | ImageBitmap;
  settings: SliderSettings;
  rotation: RotationDegree;
  noisePattern: CanvasPattern | null;
  depthCanvas?: AnyCanvas | null;
  depthBitmap?: ImageBitmap | null;
  rawDepth?: Float32Array | null;
  depthRoi?: AspectROI | null;
  customLut?: CubeLUT3D | null;
  skinMask?: AnyCanvas | null;
}

/**
 * Tuval üzerine yönlendirme derecesine göre görseli ortalayarak çizer.
 */
export function drawImageWithRotation(
  target: RenderTarget,
  sourceImg: HTMLImageElement | ImageBitmap,
  rotation: RotationDegree
): void {
  const { ctx, width: w, height: h } = target;
  const srcW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth : sourceImg.width;
  const srcH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight : sourceImg.height;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(sourceImg, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
}

/**
 * Akıllı en-boy oranı korumalı ten kalkanı uygulaması.
 */
export function applySkinToneProtection(
  target: RenderTarget,
  sourceImg: HTMLImageElement | ImageBitmap,
  rotation: RotationDegree,
  settings: SliderSettings,
  preset: PresetDefinition,
  providedSkinMask?: AnyCanvas | null
): void {
  const { ctx, width: w, height: h } = target;

  const skinMask =
    providedSkinMask || generateSkinProtectionMask(sourceImg, w, h, rotation, 512);
  if (!skinMask) return;

  const cleanSkinCanvas = createCompatibleCanvas(w, h);
  const sCtx = cleanSkinCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sCtx) {
    if (!providedSkinMask) {
      skinMask.width = 0;
      skinMask.height = 0;
    }
    return;
  }

  const skinTarget: RenderTarget = {
    canvas: cleanSkinCanvas,
    ctx: sCtx,
    width: w,
    height: h
  };

  // Ham görüntüyü çiz ve aşırı kontrast/soğuk kaymadan arındırılmış H&D Portra/Pankromatik 3D LUT uygula
  drawImageWithRotation(skinTarget, sourceImg, rotation);

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

  if (!providedSkinMask) {
    skinMask.width = 0;
    skinMask.height = 0;
  }
}

/**
 * Karanlık Oda Tekil İşleme Hattı (Unified Render Pipeline)
 *
 * Fiziksel Işık Yolu:
 * 1. Ham Görsel & Mercek Optiği (3D DoF, Helios 44M Swirl, Chromatic Aberration, Black Pro-Mist)
 * 2. Film Emülsiyonu & Taban Kırılması (650nm Spektral Halasyon + H&D S-Eğrisi + 3D LUT Tetrahedral Enterpolasyon)
 * 3. Kimyasal Banyo & Koruma Kalkanları (Bleach Bypass, Akıllı Ten Kalkanı)
 * 4. Sonlandırıcı Vinyet & Optik Işık Düşümü (Pozlama/gölge ayarları vinyeti bozmaz)
 * 5. CCD Sensör Kusurları veya 35mm Nutting-Weibull Film Greni (Gren vinyetin üzerine doğal oturur)
 * 6. Film Çerçevesi & 90'lar Quartz Date LED Tarih Damgası
 */
export function executeRenderPipeline(options: PipelineRenderOptions): void {
  const {
    target,
    sourceImg,
    settings,
    rotation,
    noisePattern,
    customLut = getCustomCubeLUT(),
    skinMask = null
  } = options;

  const { ctx, width: w, height: h } = target;
  ctx.clearRect(0, 0, w, h);

  // 👁️ 3D Derinlik Haritası İnceleme Modu (Siyah-Beyaz)
  if (settings.aiShowDepthMap && options.depthCanvas) {
    ctx.drawImage(options.depthCanvas as CanvasImageSource, 0, 0, w, h);
    return;
  }

  const preset = PRESETS[settings.preset] || PRESETS.none;
  const isCcd = settings.preset === 'ccd' || settings.preset === 'ccd_y2k';

  // 1. Ham Görsel Çizimi
  ctx.save();
  ctx.filter = 'none';
  drawImageWithRotation(target, sourceImg, rotation);
  ctx.restore();

  // 2. MERCEK OPTİĞİ
  let activeDepthCanvas: AnyCanvas | null = options.depthCanvas || null;
  let tempDepthCanvasCreated = false;

  if (settings.aiDepthEnabled && !activeDepthCanvas) {
    const maxDepthDim = 1536;
    const depthW = Math.min(w, maxDepthDim);
    const depthH = Math.max(1, Math.round((h * depthW) / w));

    if (options.depthBitmap) {
      activeDepthCanvas = new OffscreenCanvas(depthW, depthH);
      tempDepthCanvasCreated = true;
      const dCtx = activeDepthCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (dCtx) {
        dCtx.imageSmoothingEnabled = true;
        dCtx.imageSmoothingQuality = 'high';
        dCtx.drawImage(options.depthBitmap, 0, 0, depthW, depthH);
      }
    } else if (options.rawDepth && options.depthRoi) {
      activeDepthCanvas = projectDepthMapFromRaw(options.rawDepth, options.depthRoi, depthW, depthH);
      tempDepthCanvasCreated = true;
    }
  }

  // 🤖 3D Fiziksel Alan Derinliği & Helios 44M Swirl Optiği
  if (settings.aiDepthEnabled && activeDepthCanvas && settings.swirl === 0) {
    applyDepthOfField(
      target,
      activeDepthCanvas,
      settings.aiFocalDepth,
      settings.aiDepthAperture
    );
  } else if (settings.swirl > 0) {
    applySwirlyBokeh(
      target,
      settings.swirl,
      settings.aiDepthEnabled ? activeDepthCanvas : null,
      settings.aiFocalDepth,
      settings.aiDepthAperture,
      settings.soapBubble ?? 0,
      settings.loca ?? 0,
      settings.apertureBlades ?? 0,
      settings.bladeCurvature ?? 85
    );
  }

  if (tempDepthCanvasCreated && activeDepthCanvas) {
    activeDepthCanvas.width = 0;
    activeDepthCanvas.height = 0;
    activeDepthCanvas = null;
  }

  // Radyal Kromatik Sapma
  if (settings.chromatic > 0) {
    applyChromaticAberration(target, settings.chromatic);
  }

  // Black Pro-Mist Sisli Parlama
  if (settings.proMist > 0) {
    applyBlackProMist(target, settings.proMist);
  }

  // 3. FİLM EMÜLSİYONU: 650nm Spektral Halasyon + H&D Sensitometri + 3D LUT Tetrahedral Eşleme
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
  // Bleach Bypass (Gümüş Tutma Banyosu)
  if (settings.bleachBypass > 0) {
    applyBleachBypass(target, settings.bleachBypass);
  }

  // 🛡️ Akıllı Ten Kalkanı
  if (settings.skinProtection > 0) {
    applySkinToneProtection(target, sourceImg, rotation, settings, preset, skinMask);
  }

  // 5. SONLANDIRICI VİNYET & IŞIK DÜŞÜMÜ (Lens Edge Falloff)
  // Renk derecelendirmesi ve ten kalkanından sonra, ancak film greni ve CCD gürültüsünden ÖNCE uygulanır.
  // Bu sayede pozlama/gölge ayarları vinyeti bozmaz; film greni vinyetin üzerine doğal doku örer.
  if (settings.vignette > 0) {
    applyVignette(target, settings.vignette);
  }

  // 6. CCD Sensör Kusurları veya Analog Film Sızıntı & Gren Katmanı
  if (isCcd) {
    if (settings.lightLeak > 0) {
      applyLightLeak(target, settings.lightLeak);
    }
    applyCcdAesthetic(target, { mode: settings.preset as 'ccd' | 'ccd_y2k' });
  } else {
    // Işık Sızıntısı (Light Leak)
    if (settings.lightLeak > 0) {
      applyLightLeak(target, settings.lightLeak);
    }

    // 35mm Analog Film Greni
    const activeNoise = (preset.noise || 0) + (settings.grain / 100) * 0.22;
    if (activeNoise > 0 && noisePattern) {
      applyFilmGrain(target, noisePattern, activeNoise);
    }
  }

  // Çerçeve (Film Border)
  if (settings.filmBorder !== 'none') {
    applyFilmBorder(target, settings.filmBorder);
  }

  // 90'lar Quartz Date Tarih Damgası
  if (settings.quartzDate) {
    applyQuartzDate(target, settings.quartzDate, settings.quartzDateText);
  }
}
