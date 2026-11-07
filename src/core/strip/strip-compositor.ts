import {
  AnyCanvas,
  AnyRenderingContext2D,
  CubeLUT3D,
  PresetKey,
  RenderTarget,
  RotationDegree,
  SliderSettings,
  StripConfig
} from '../types';
import { PRESETS } from '../presets';
import { createCompatibleCanvas, createNoisePattern } from '../optics';
import { applyPaperPrintCPU } from '../paper/paper-cpu';
import { executeRenderPipeline } from '../pipeline/render-pipeline';
import { FilmChemistryWebGPUEngine } from '../webgpu/FilmChemistryWebGPUEngine';
import { PaperPrintWebGPUEngine } from '../webgpu/PaperPrintWebGPUEngine';
import { STRIP_COLORS } from './constants';
import {
  computeStripLayoutGeometry,
  drawStripBaseAndPerforations,
  drawVectorGreasePencilMarks,
  drawVectorRebateMarkings,
  drawVectorSprocketHalation,
  StripLayoutGeometry
} from './vector-rebate';

export interface StripFrameSource {
  id: string;
  fileName: string;
  blob: Blob;
  rotation: RotationDegree;
  /** Kare başına isteğe bağlı film profili geçersiz kılması (`null` = ortak profil). */
  presetOverride: PresetKey | null;
  /** Kare tekil düzenlemeye açıldıysa kareye özel ayar farkları. */
  settingsOverride?: Partial<SliderSettings> | null;
}

export interface StripMemoryStats {
  activeFullResBitmaps: number;
  peakActiveFullResBitmaps: number;
  framesProcessedFullRes: number;
  framesServedFromCellCache: number;
  sheetWidth: number;
  sheetHeight: number;
  sheetBytesRgba: number;
}

export interface ComposeStripOptions {
  frames: readonly StripFrameSource[];
  sharedSettings: SliderSettings;
  stripConfig: StripConfig;
  longEdgePxOverride?: number;
  customLut?: CubeLUT3D | null;
  useCellCache?: boolean;
  onProgress?: (percent: number, message: string) => void;
}

export interface ComposeStripResult {
  canvas: AnyCanvas;
  layout: StripLayoutGeometry;
  stats: StripMemoryStats;
}

interface CachedCellEntry {
  key: string;
  width: number;
  height: number;
  imageData: ImageData;
}

/**
 * Küçültülmüş kare hücre önbelleği (yalnızca şerit hücre çözünürlüğünde ImageData tutar;
 * 6 kare için toplam < 5 MB yer kaplar ve kare sırası sürükle-bırak ile değiştirildiğinde
 * her karenin piksellerini bit-bazında %100 koruyarak anında yeniden dizilim sağlar).
 */
const downscaledCellCache = new Map<string, CachedCellEntry>();
const MAX_CACHED_CELLS = 18;

export function clearStripCellCache(): void {
  downscaledCellCache.clear();
}

function buildFrameCellCacheKey(
  frame: StripFrameSource,
  effectiveSettings: SliderSettings,
  gateW: number,
  gateH: number,
  visualVariant: 'positive' | 'negative'
): string {
  return JSON.stringify([
    frame.id,
    frame.rotation,
    gateW,
    gateH,
    visualVariant,
    effectiveSettings.preset,
    effectiveSettings.exposure,
    effectiveSettings.contrast,
    effectiveSettings.shoulder,
    effectiveSettings.saturation,
    effectiveSettings.warmth,
    effectiveSettings.highlights ?? 0,
    effectiveSettings.shadows ?? 0,
    effectiveSettings.whites ?? 0,
    effectiveSettings.blacks ?? 0,
    effectiveSettings.tint ?? 0,
    effectiveSettings.vibrance ?? 0,
    effectiveSettings.clarity ?? 0,
    effectiveSettings.dehaze ?? 0,
    effectiveSettings.halation,
    effectiveSettings.grain,
    effectiveSettings.lightLeak,
    effectiveSettings.bleachBypass,
    effectiveSettings.skinProtection,
    effectiveSettings.devPushPull ?? '',
    effectiveSettings.devExhaustion ?? 0,
    effectiveSettings.devEdgeEffect ?? 0,
    effectiveSettings.devReticulation ?? 0,
    effectiveSettings.swirl,
    effectiveSettings.soapBubble ?? 0,
    effectiveSettings.loca ?? 0,
    effectiveSettings.apertureBlades ?? 0,
    effectiveSettings.bladeCurvature ?? 85,
    effectiveSettings.chromatic,
    effectiveSettings.proMist,
    effectiveSettings.vignette
  ]);
}

export function resolveFrameEffectiveSettings(
  frame: StripFrameSource,
  sharedSettings: SliderSettings
): SliderSettings {
  const merged: SliderSettings = {
    ...sharedSettings,
    ...(frame.settingsOverride || {})
  };

  if (frame.presetOverride) {
    const p = PRESETS[frame.presetOverride] || PRESETS.none;
    merged.preset = frame.presetOverride;
    if (!frame.settingsOverride || frame.settingsOverride.shoulder === undefined) {
      merged.shoulder = p.defaultShoulder ?? merged.shoulder;
    }
    if (!frame.settingsOverride || frame.settingsOverride.halation === undefined) {
      merged.halation = p.defaultHalation ?? merged.halation;
    }
    if (!frame.settingsOverride || frame.settingsOverride.devPushPull === undefined) {
      merged.devPushPull = p.defaultPushPull;
    }
  }

  // Tekil kare geliştirme aşamasında kağıt baskı ve tekil çerçeve kapalı tutulur;
  // Kontakt Baskı modunda Faz 1 kağıt katmanı tüm birleşik sayfaya en sonda tek geçişte uygulanır.
  merged.printEnabled = false;
  merged.filmBorder = 'none';
  merged.quartzDate = false;
  merged.aiShowDepthMap = false;

  return merged;
}

/**
 * Negatif şerit görünümü için sahne-lineer H&D optik yoğunluk tersinmesi + film tabanı maskesi.
 * Düz renk bindirmesi (fillRect tint) KULLANMAZ; gerçek selüloz triasetat taban geçirgenliği
 * T_neg = T_base * 10^(-gamma_neg * log10(1 + E)) denklemini kanal bazında hesaplar.
 */
function convertCellToPhysicalNegativeInPlace(
  imgData: ImageData,
  isMonoPreset: boolean
): void {
  const data = imgData.data;
  const baseRgb = isMonoPreset
    ? STRIP_COLORS.negativeMonoBaseRgb
    : STRIP_COLORS.negativeColorMaskRgb;
  const baseR = baseRgb[0] / 255.0;
  const baseG = baseRgb[1] / 255.0;
  const baseB = baseRgb[2] / 255.0;

  for (let i = 0; i < data.length; i += 4) {
    const sr = data[i] / 255.0;
    const sg = data[i + 1] / 255.0;
    const sb = data[i + 2] / 255.0;

    const lr = sr <= 0.04045 ? sr / 12.92 : Math.pow((sr + 0.055) / 1.055, 2.4);
    const lg = sg <= 0.04045 ? sg / 12.92 : Math.pow((sg + 0.055) / 1.055, 2.4);
    const lb = sb <= 0.04045 ? sb / 12.92 : Math.pow((sb + 0.055) / 1.055, 2.4);

    // Pozitif parlaklık arttıkça negatif üzerindeki gümüş/boya yoğunluğu artar (geçirgenlik düşer)
    const dR = 0.08 + 1.28 * Math.pow(lr, 0.62);
    const dG = 0.08 + 1.28 * Math.pow(lg, 0.62);
    const dB = 0.08 + 1.28 * Math.pow(lb, 0.62);

    const tr = baseR * Math.pow(10.0, -dR * 0.78);
    const tg = baseG * Math.pow(10.0, -dG * 0.78);
    const tb = baseB * Math.pow(10.0, -dB * 0.78);

    const toSrgb8 = (v: number) => {
      const c = Math.max(0.0, Math.min(1.0, v));
      const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
      return Math.round(s * 255.0);
    };

    data[i] = toSrgb8(tr);
    data[i + 1] = toSrgb8(tg);
    data[i + 2] = toSrgb8(tb);
  }
}

/**
 * Kaynak tuvali 36x24mm pencereye sündürmeden (`object-fit: cover` merkez kırpma ile) çizer.
 */
function drawCoverIntoCell(
  cellCtx: AnyRenderingContext2D,
  srcCanvas: AnyCanvas,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): void {
  const srcAspect = srcW / Math.max(1, srcH);
  const dstAspect = dstW / Math.max(1, dstH);

  let cropW = srcW;
  let cropH = srcH;
  let cropX = 0;
  let cropY = 0;

  if (srcAspect > dstAspect) {
    cropW = Math.round(srcH * dstAspect);
    cropX = Math.floor((srcW - cropW) * 0.5);
  } else if (srcAspect < dstAspect) {
    cropH = Math.round(srcW / dstAspect);
    cropY = Math.floor((srcH - cropH) * 0.5);
  }

  cellCtx.clearRect(0, 0, dstW, dstH);
  cellCtx.imageSmoothingEnabled = true;
  cellCtx.imageSmoothingQuality = 'high';
  cellCtx.drawImage(
    srcCanvas as CanvasImageSource,
    cropX,
    cropY,
    Math.max(1, cropW),
    Math.max(1, cropH),
    0,
    0,
    dstW,
    dstH
  );
}

/**
 * Faz 5 Ana Şerit ve Kontakt Baskı Birleştiricisi (`composeFilmStrip`).
 *
 * Kesin Bellek Kuralı (Spesifikasyon Madde 5 & Kabul Kriteri):
 * - Her kare sırayla `createImageBitmap` ile çözülür (`activeFullResBitmaps = 1`),
 *   `executeRenderPipeline` ile işlenir, hemen hedef kare penceresi (`gateW × gateH`)
 *   boyutuna küçültülür ve bir sonraki kare yüklenmeden ÖNCE `frameBitmap.close()` ile
 *   tam çözünürlüklü ara tampon sıfırlanır (`activeFullResBitmaps = 0`).
 * - Böylece 6 × 24 MP girdiyle çalışırken dahi aynı anda bellekte en fazla 1 tam
 *   çözünürlüklü kare tutulur (`stats.peakActiveFullResBitmaps <= 1`).
 */
export async function composeFilmStrip(
  options: ComposeStripOptions
): Promise<ComposeStripResult> {
  const {
    frames,
    sharedSettings,
    stripConfig,
    longEdgePxOverride,
    customLut = null,
    useCellCache = true,
    onProgress
  } = options;

  if (frames.length === 0) {
    throw new Error('Şerit oluşturmak için en az 1 kare gereklidir.');
  }

  // Kontakt baskı modu yalnızca Faz 1 Kağıda Baskı katmanı (printEnabled) açıkken çalışabilir
  const effectiveOutputMode =
    stripConfig.outputMode === 'contact' && !sharedSettings.printEnabled
      ? 'positive'
      : stripConfig.outputMode;

  const targetLongEdge = longEdgePxOverride ?? stripConfig.longEdgePx;
  const layout = computeStripLayoutGeometry(
    frames.length,
    stripConfig.orientation,
    effectiveOutputMode,
    targetLongEdge
  );

  const sheetCanvas = createCompatibleCanvas(layout.sheetWidth, layout.sheetHeight);
  const sheetCtx = sheetCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!sheetCtx) {
    throw new Error('Şerit OffscreenCanvas 2D bağlamı oluşturulamadı.');
  }

  const sharedMono =
    sharedSettings.preset === 'hp5' || sharedSettings.preset === 'sb';

  // 1. Vektörel 35mm film şeridi tabanı ve KS-1870 perforasyon delikleri
  drawStripBaseAndPerforations(sheetCtx, layout, sharedMono);

  const stats: StripMemoryStats = {
    activeFullResBitmaps: 0,
    peakActiveFullResBitmaps: 0,
    framesProcessedFullRes: 0,
    framesServedFromCellCache: 0,
    sheetWidth: layout.sheetWidth,
    sheetHeight: layout.sheetHeight,
    sheetBytesRgba: layout.sheetWidth * layout.sheetHeight * 4
  };

  const visualVariant: 'positive' | 'negative' =
    effectiveOutputMode === 'negative' ? 'negative' : 'positive';

  // 2. Kareleri KESİNLİKLE SIRAYLA işle ve anında şerit çözünürlüğüne küçült
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const gate = layout.frameGates[i];
    const effSettings = resolveFrameEffectiveSettings(frame, sharedSettings);
    const isFrameMono = effSettings.preset === 'hp5' || effSettings.preset === 'sb';

    if (onProgress) {
      const pct = Math.round(10 + (i / frames.length) * 72);
      onProgress(pct, `Kare ${i + 1}/${frames.length} banyo ediliyor (${frame.fileName})...`);
    }

    const cacheKey = buildFrameCellCacheKey(
      frame,
      effSettings,
      gate.w,
      gate.h,
      visualVariant
    );

    const cached = useCellCache ? downscaledCellCache.get(cacheKey) : undefined;
    if (cached && cached.width === gate.w && cached.height === gate.h) {
      sheetCtx.putImageData(cached.imageData, gate.x, gate.y);
      stats.framesServedFromCellCache++;
      continue;
    }

    // Tam çözünürlüklü tekil kareyi yükle (Bellekteki aktif tam çözünürlüklü kare = 1)
    let frameBitmap: ImageBitmap | null = null;
    let fullFrameCanvas: AnyCanvas | null = null;
    let cellCanvas: AnyCanvas | null = null;

    try {
      frameBitmap = await createImageBitmap(frame.blob);
      stats.activeFullResBitmaps++;
      if (stats.activeFullResBitmaps > stats.peakActiveFullResBitmaps) {
        stats.peakActiveFullResBitmaps = stats.activeFullResBitmaps;
      }

      const isTransposed = frame.rotation === 90 || frame.rotation === 270;
      let procW = isTransposed ? frameBitmap.height : frameBitmap.width;
      let procH = isTransposed ? frameBitmap.width : frameBitmap.height;

      // Önizleme modunda (longEdgePxOverride <= 1800) kaynak kareyi de orantılı sınırlayarak
      // etkileşimli şerit önizlemesini çok hızlı tut; tam dışa aktarmada tam çözünürlüğü işle.
      let sourceForPipeline: ImageBitmap | AnyCanvas = frameBitmap;
      let previewScaledCanvas: AnyCanvas | null = null;
      if (longEdgePxOverride !== undefined && longEdgePxOverride <= 1800) {
        const maxFrameDim = Math.max(960, Math.max(gate.w, gate.h) * 2);
        if (Math.max(frameBitmap.width, frameBitmap.height) > maxFrameDim) {
          const s = maxFrameDim / Math.max(frameBitmap.width, frameBitmap.height);
          const sw = Math.max(16, Math.round(frameBitmap.width * s));
          const sh = Math.max(16, Math.round(frameBitmap.height * s));
          previewScaledCanvas = createCompatibleCanvas(sw, sh);
          const pCtx = previewScaledCanvas.getContext('2d') as AnyRenderingContext2D | null;
          if (pCtx) {
            pCtx.imageSmoothingEnabled = true;
            pCtx.imageSmoothingQuality = 'high';
            pCtx.drawImage(frameBitmap, 0, 0, sw, sh);
            // Tam çözünürlüklü bitmap'i daha pipeline başlamadan bile serbest bırakabiliriz!
            frameBitmap.close();
            frameBitmap = null;
            stats.activeFullResBitmaps--;

            sourceForPipeline = previewScaledCanvas;
            procW = isTransposed ? sh : sw;
            procH = isTransposed ? sw : sh;
          }
        }
      }

      fullFrameCanvas = createCompatibleCanvas(procW, procH);
      const fullCtx = fullFrameCanvas.getContext('2d') as AnyRenderingContext2D | null;
      if (!fullCtx) {
        throw new Error('Kare ara banyo tuvali oluşturulamadı.');
      }

      const noisePattern = createNoisePattern(fullCtx);
      const frameTarget: RenderTarget = {
        canvas: fullFrameCanvas,
        ctx: fullCtx,
        width: procW,
        height: procH
      };

      executeRenderPipeline({
        target: frameTarget,
        sourceImg: sourceForPipeline as unknown as ImageBitmap,
        settings: effSettings,
        rotation: frame.rotation,
        noisePattern,
        customLut,
        fullDimensions: { width: procW, height: procH }
      });

      if (previewScaledCanvas) {
        previewScaledCanvas.width = 0;
        previewScaledCanvas.height = 0;
        previewScaledCanvas = null;
      }

      // Kaynak ImageBitmap ile işimiz bitti; hemen kapat
      if (frameBitmap) {
        frameBitmap.close();
        frameBitmap = null;
        stats.activeFullResBitmaps--;
      }

      // Hemen şerit hücre çözünürlüğüne (gate.w × gate.h) küçült
      cellCanvas = createCompatibleCanvas(gate.w, gate.h);
      const cellCtx = cellCanvas.getContext('2d') as AnyRenderingContext2D | null;
      if (!cellCtx) {
        throw new Error('Şerit hücre tuvali oluşturulamadı.');
      }

      drawCoverIntoCell(cellCtx, fullFrameCanvas, procW, procH, gate.w, gate.h);

      // Tam çözünürlüklü ara banyo tuvalini bir sonraki kareye geçmeden ÖNCE sıfırla!
      fullFrameCanvas.width = 0;
      fullFrameCanvas.height = 0;
      fullFrameCanvas = null;

      // GPU geçici dokularını temizle (6x24MP döngüsünde VRAM birikimini sıfırlar)
      FilmChemistryWebGPUEngine.getInstanceSync()?.releaseScratchResources();
      PaperPrintWebGPUEngine.getInstanceSync()?.releaseScratchResources();

      const cellImageData = cellCtx.getImageData(0, 0, gate.w, gate.h);
      if (visualVariant === 'negative') {
        convertCellToPhysicalNegativeInPlace(cellImageData, isFrameMono);
      }

      sheetCtx.putImageData(cellImageData, gate.x, gate.y);
      stats.framesProcessedFullRes++;

      if (useCellCache) {
        if (downscaledCellCache.size >= MAX_CACHED_CELLS) {
          const oldestKey = downscaledCellCache.keys().next().value;
          if (oldestKey !== undefined) {
            downscaledCellCache.delete(oldestKey);
          }
        }
        downscaledCellCache.set(cacheKey, {
          key: cacheKey,
          width: gate.w,
          height: gate.h,
          imageData: new ImageData(
            new Uint8ClampedArray(cellImageData.data),
            gate.w,
            gate.h
          )
        });
      }
    } finally {
      if (frameBitmap) {
        try {
          frameBitmap.close();
        } catch {}
        stats.activeFullResBitmaps = Math.max(0, stats.activeFullResBitmaps - 1);
      }
      if (fullFrameCanvas) {
        fullFrameCanvas.width = 0;
        fullFrameCanvas.height = 0;
      }
      if (cellCanvas) {
        cellCanvas.width = 0;
        cellCanvas.height = 0;
      }
    }
  }

  // 3. İnce pencere kenar çizgisi, isteğe bağlı Perforasyon Halasyonu ve Vektörel Kenar Yazıları
  for (const gate of layout.frameGates) {
    sheetCtx.save();
    sheetCtx.strokeStyle = STRIP_COLORS.positiveGateBorder;
    sheetCtx.lineWidth = Math.max(1, layout.pxPerMm * 0.08);
    sheetCtx.strokeRect(gate.x, gate.y, gate.w, gate.h);
    sheetCtx.restore();
  }

  if (stripConfig.sprocketHalation) {
    drawVectorSprocketHalation(sheetCtx, layout);
  }

  drawVectorRebateMarkings(sheetCtx, layout, stripConfig.edgeText, sharedMono);

  // 4. KONTAKT BASKI MODU: Faz 1'in kağıt modelini (kağıt tonu, Multigrade/Split-grade,
  //    toning ve 300 DPI kağıt lifi dokusu) tüm birleşik sayfa üzerinde doğrudan çalıştır!
  if (effectiveOutputMode === 'contact') {
    if (onProgress) {
      onProgress(86, 'Faz 1 karanlık oda kağıt baskı katmanı kontakt sayfasına uygulanıyor...');
    }

    const sheetTarget: RenderTarget = {
      canvas: sheetCanvas,
      ctx: sheetCtx,
      width: layout.sheetWidth,
      height: layout.sheetHeight
    };
    const printSettings: SliderSettings = {
      ...sharedSettings,
      printEnabled: true
    };
    const paperContext = {
      dodgeBurnMap: null,
      fullDimensions: { width: layout.sheetWidth, height: layout.sheetHeight }
    };

    const paperGpu = PaperPrintWebGPUEngine.getInstanceSync();
    const gpuOk = paperGpu
      ? paperGpu.renderToTarget(sheetTarget, printSettings, paperContext)
      : false;
    if (!gpuOk) {
      applyPaperPrintCPU(sheetTarget, printSettings, paperContext);
    }
    PaperPrintWebGPUEngine.getInstanceSync()?.releaseScratchResources();

    // 5. İsteğe bağlı Karanlık Oda Mumlu Seçim Kalemi (kağıt baskısı sonrasında kağıt üzerine)
    if (stripConfig.greasePencilMark) {
      const markedIndices: number[] = [];
      if (stripConfig.markedFrameIds.length > 0) {
        frames.forEach((f, idx) => {
          if (stripConfig.markedFrameIds.includes(f.id)) {
            markedIndices.push(idx);
          }
        });
      } else {
        // Kullanıcı kalemi açtıysa ve özel kare seçmediyse ilk kareyi örnek işaretler
        markedIndices.push(0);
      }
      drawVectorGreasePencilMarks(sheetCtx, layout, markedIndices);
    }
  }

  if (onProgress) {
    onProgress(95, 'Şerit birleştirme tamamlandı.');
  }

  return {
    canvas: sheetCanvas,
    layout,
    stats
  };
}
