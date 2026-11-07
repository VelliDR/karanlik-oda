import { DodgeBurnMap, PaperType, RenderTarget, SliderSettings } from '../types';
import { linearToSrgb, srgbToLinear } from '../lut3d';
import {
  computeHardLayerWeight,
  ENLARGER_CONSTANTS,
  LINEAR_LUMA_WEIGHTS,
  LN_10,
  LOG10_2,
  MM_PER_PIXEL_AT_300DPI,
  MULTIGRADE_EMULSION_CONSTANTS,
  NEGATIVE_FILM_CONSTANTS,
  PAPER_PROFILES
} from './constants';
import { hasActiveDodgeBurnData, sampleDodgeBurnBilinear } from './dodge-burn';
import { getOrBuildToningLUT1D, sampleToningLUT1D } from './toning-lut';

const INV_LN_10 = 1.0 / LN_10;
const NEG_INV_LOG_DENOM = 1.0 / (Math.log(1.0 + NEGATIVE_FILM_CONSTANTS.logCompressionK) * INV_LN_10);

const SRGB_8BIT_TO_LINEAR = (() => {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = srgbToLinear(i / 255);
  }
  return table;
})();

const LINEAR_TO_SRGB_8BIT = (() => {
  const table = new Uint8Array(65537);
  for (let i = 0; i <= 65536; i++) {
    table[i] = Math.round(linearToSrgb(i / 65536) * 255);
  }
  return table;
})();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * WGSL `hash_u32_2d` ile bit-bit özdeş 32-bit işaretsiz tam sayı örgü özet fonksiyonu.
 * Çıktı aralığı: [-1.0, +1.0].
 */
export function hashU32_2D(x: number, y: number): number {
  let h = (Math.imul(x >>> 0, 374761393) + Math.imul(y >>> 0, 668265263) + 1442695041) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const unit = (h >>> 8) * (1.0 / 16777215.0);
  return unit * 2.0 - 1.0;
}

/**
 * 2B Hermite yumuşatmalı değer gürültüsü (WGSL `value_noise_2d` ile birebir aynı).
 */
export function valueNoise2D(gx: number, gy: number): number {
  const safeGx = Math.max(0.0, gx);
  const safeGy = Math.max(0.0, gy);
  const flX = Math.floor(safeGx);
  const flY = Math.floor(safeGy);

  const ix0 = flX >>> 0;
  const iy0 = flY >>> 0;
  const ix1 = (ix0 + 1) >>> 0;
  const iy1 = (iy0 + 1) >>> 0;

  const fx = safeGx - flX;
  const fy = safeGy - flY;

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  const n00 = hashU32_2D(ix0, iy0);
  const n10 = hashU32_2D(ix1, iy0);
  const n01 = hashU32_2D(ix0, iy1);
  const n11 = hashU32_2D(ix1, iy1);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

/**
 * 300 DPI fiziksel milimetre koordinatlarında iki katmanlı (düşük + yüksek frekans) kağıt dokusu çarpanı üretir.
 * Çarpan [1 - amp, 1 + amp] aralığındadır ve amp <= 0.02 (%2) sınırı zorunludur.
 */
export function evaluatePaperTextureMultiplier(
  xMm: number,
  yMm: number,
  amplitude: number,
  lowWaveMm: number,
  highWaveMm: number,
  lowWeight: number
): number {
  const clampedAmp = clamp(amplitude, 0.0, 0.02);
  if (clampedAmp <= 1e-6) return 1.0;

  const nLow = valueNoise2D(xMm / Math.max(0.05, lowWaveMm), yMm / Math.max(0.05, lowWaveMm));
  const nHigh = valueNoise2D(
    xMm / Math.max(0.02, highWaveMm) + 31.7,
    yMm / Math.max(0.02, highWaveMm) + 19.3
  );

  const wLow = clamp(lowWeight, 0.0, 1.0);
  const combined = clamp(wLow * nLow + (1.0 - wLow) * nHigh, -1.0, 1.0);
  return 1.0 + clampedAmp * combined;
}

/**
 * Tekil lojistik kağıt emülsiyon katmanı yanıtı: 1 / (1 + 10^(-g * (logE - logE0))).
 */
export function evaluateEmulsionLogistic(logE: number, g: number, logE0: number): number {
  const exponent = clamp(-LN_10 * g * (logE - logE0), -40.0, 40.0);
  return 1.0 / (1.0 + Math.exp(exponent));
}

/**
 * Sahne/film-lineer parlaklıktan (Y_film ∈ [0, 1]) gümüş negatif yoğunluğunu hesaplar
 * ve log10(T_neg) geçirgenlik logaritmasını döndürür.
 */
export function evaluateNegativeLogTransmittance(linearFilmLuma: number): number {
  const y = clamp(linearFilmLuma, 0.0, 1.0);
  const normNeg =
    Math.log(1.0 + NEGATIVE_FILM_CONSTANTS.logCompressionK * y) *
    INV_LN_10 *
    NEG_INV_LOG_DENOM;
  const dNeg =
    NEGATIVE_FILM_CONSTANTS.dBaseFog +
    (NEGATIVE_FILM_CONSTANTS.dMax - NEGATIVE_FILM_CONSTANTS.dBaseFog) * normNeg;
  // T_neg = 10^(-dNeg) => log10(T_neg) = -dNeg
  return -dNeg;
}

/**
 * Multigrade (tek filtre) veya Split-Grade (Derece 00 + Derece 5 çift pozlama) modunda
 * kağıt optik yansıma yoğunluğunu D(logE) ∈ [dMin, dMax] hesaplar.
 */
export function evaluateMultigradePaperDensity(
  logEBase: number,
  dMin: number,
  dMax: number,
  hardWeight: number,
  splitGrade: boolean,
  splitHardRatio: number
): number {
  const { gSoft, logE0Soft, gHard, logE0Hard } = MULTIGRADE_EMULSION_CONSTANTS;
  const densitySpan = Math.max(0.0, dMax - dMin);

  if (!splitGrade) {
    const wHard = clamp(hardWeight, 0.0, 1.0);
    const wSoft = 1.0 - wHard;
    const sSoft = evaluateEmulsionLogistic(logEBase, gSoft, logE0Soft);
    const sHard = evaluateEmulsionLogistic(logEBase, gHard, logE0Hard);
    return dMin + densitySpan * (wSoft * sSoft + wHard * sHard);
  }

  // Split-Grade: Derece 00 ((1 - r) poz payı) ve Derece 5 (r poz payı) iki ayrı pozun net yoğunluk toplamı
  const r = clamp(splitHardRatio, 0.0, 1.0);
  const softShare = 1.0 - r;

  let netDensitySoft = 0.0;
  if (softShare > 1e-5) {
    const logESoft = logEBase + Math.log(softShare) * INV_LN_10;
    netDensitySoft = densitySpan * evaluateEmulsionLogistic(logESoft, gSoft, logE0Soft);
  }

  let netDensityHard = 0.0;
  if (r > 1e-5) {
    const logEHard = logEBase + Math.log(r) * INV_LN_10;
    netDensityHard = densitySpan * evaluateEmulsionLogistic(logEHard, gHard, logE0Hard);
  }

  return dMin + Math.min(densitySpan, netDensitySoft + netDensityHard);
}

/**
 * Kağıt tabanının lineer RGB yansıma çarpanını hesaplar (paperTone = 0 iken tam nötr [1, 1, 1]).
 */
export function computePaperBaseLinearRgb(
  paperType: PaperType,
  paperTone: number
): [number, number, number] {
  const profile = PAPER_PROFILES[paperType] || PAPER_PROFILES['rc-glossy'];
  const t = clamp(Number.isFinite(paperTone) ? paperTone : 0.0, 0.0, 1.0);
  if (t <= 1e-5) {
    return [1.0, 1.0, 1.0];
  }
  const [wr, wg, wb] = profile.warmBaseLinearRgb;
  return [
    1.0 + (wr - 1.0) * t,
    1.0 + (wg - 1.0) * t,
    1.0 + (wb - 1.0) * t
  ];
}

export interface PaperPrintRenderContext {
  dodgeBurnMap?: DodgeBurnMap | null;
  /** Orijinal tam çözünürlük boyutları (önizlemede fiziksel mm ölçeğini 300 DPI'a kilitlemek için) */
  fullDimensions?: { width: number; height: number } | null;
}

/**
 * WebGPU olmayan ortamlar veya yüksek çözünürlüklü dışa aktarma yedek hattı için
 * WGSL `PaperPrintWebGPUEngine` ile 1:1 aynı matematiği çalıştıran CPU Kağıda Baskı Motoru.
 */
export function applyPaperPrintCPU(
  target: RenderTarget,
  settings: SliderSettings,
  context?: PaperPrintRenderContext
): void {
  if (!settings.printEnabled) return;

  const { ctx, width: w, height: h } = target;
  if (w <= 0 || h <= 0) return;

  const paperType: PaperType =
    settings.printPaperType && PAPER_PROFILES[settings.printPaperType]
      ? settings.printPaperType
      : 'rc-glossy';
  const profile = PAPER_PROFILES[paperType];

  const exposureStops = clamp(
    settings.printExposure ?? ENLARGER_CONSTANTS.defaultExposureStops,
    ENLARGER_CONSTANTS.minExposureStops,
    ENLARGER_CONSTANTS.maxExposureStops
  );
  const grade = clamp(
    settings.printGrade ?? MULTIGRADE_EMULSION_CONSTANTS.defaultGrade,
    MULTIGRADE_EMULSION_CONSTANTS.minGrade,
    MULTIGRADE_EMULSION_CONSTANTS.maxGrade
  );
  const hardWeight = computeHardLayerWeight(grade);
  const splitGrade = Boolean(settings.printSplitGrade);
  const splitRatio = clamp(settings.printSplitRatio ?? 0.5, 0.0, 1.0);
  const paperTone = clamp(settings.printPaperTone ?? 0.0, 0.0, 1.0);
  const selenium = clamp(settings.printSelenium ?? 0.0, 0.0, 1.0);
  const sepia = clamp(settings.printSepia ?? 0.0, 0.0, 1.0);

  const [baseR, baseG, baseB] = computePaperBaseLinearRgb(paperType, paperTone);
  const toningLut = getOrBuildToningLUT1D(selenium, sepia, paperType);

  const dodgeBurnMap = context?.dodgeBurnMap ?? null;
  const useDodgeBurn = hasActiveDodgeBurnData(dodgeBurnMap);

  const fullW = context?.fullDimensions?.width && context.fullDimensions.width > 0
    ? context.fullDimensions.width
    : w;
  const fullH = context?.fullDimensions?.height && context.fullDimensions.height > 0
    ? context.fullDimensions.height
    : h;
  const fullWidthMm = fullW * MM_PER_PIXEL_AT_300DPI;
  const fullHeightMm = fullH * MM_PER_PIXEL_AT_300DPI;

  const { dMin, dMax } = profile;
  const invDensitySpan = dMax > dMin ? 1.0 / (dMax - dMin) : 1.0;
  const { amplitude, lowFreqWavelengthMm, highFreqWavelengthMm, lowFreqWeight } = profile.texture;
  const [lwR, lwG, lwB] = LINEAR_LUMA_WEIGHTS;
  const maxDbStops = ENLARGER_CONSTANTS.maxDodgeBurnStops;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const toneMul: [number, number, number] = [1.0, 1.0, 1.0];

  const invW = 1.0 / w;
  const invH = 1.0 / h;

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) * invH;
    const yMm = v * fullHeightMm;
    const rowOffset = py * w * 4;

    for (let px = 0; px < w; px++) {
      const idx = rowOffset + px * 4;
      const u = (px + 0.5) * invW;
      const xMm = u * fullWidthMm;

      // 0. Sahne/film-lineer uzaya açılım
      const lr = SRGB_8BIT_TO_LINEAR[data[idx]];
      const lg = SRGB_8BIT_TO_LINEAR[data[idx + 1]];
      const lb = SRGB_8BIT_TO_LINEAR[data[idx + 2]];
      const yFilm = lwR * lr + lwG * lg + lwB * lb;

      // 1. Negatif geçirgenliği ve Agrandizör + Dodge/Burn pozu
      const logTNeg = evaluateNegativeLogTransmittance(yFilm);
      const dbStops = useDodgeBurn
        ? clamp(sampleDodgeBurnBilinear(dodgeBurnMap, u, v), -maxDbStops, maxDbStops)
        : 0.0;
      const logE = logTNeg + (exposureStops + dbStops) * LOG10_2;

      // 2. Multigrade / Split-grade kağıt yoğunluğu
      const dPaper = evaluateMultigradePaperDensity(
        logE,
        dMin,
        dMax,
        hardWeight,
        splitGrade,
        splitRatio
      );

      // 3. Yoğunluktan lineer yansımaya dönüşüm: R = 10^(-D)
      const reflectance = Math.exp(-dPaper * LN_10);

      // 4. 1D Toning renk eşlemesi
      const normDensity = (dPaper - dMin) * invDensitySpan;
      sampleToningLUT1D(toningLut, normDensity, toneMul);

      // 5. Kağıt tabanı tonu ve 300 DPI prosedürel kağıt dokusu çarpanı
      const texMul = evaluatePaperTextureMultiplier(
        xMm,
        yMm,
        amplitude,
        lowFreqWavelengthMm,
        highFreqWavelengthMm,
        lowFreqWeight
      );

      const linOutR = clamp(reflectance * toneMul[0] * baseR * texMul, 0.0, 1.0);
      const linOutG = clamp(reflectance * toneMul[1] * baseG * texMul, 0.0, 1.0);
      const linOutB = clamp(reflectance * toneMul[2] * baseB * texMul, 0.0, 1.0);

      // 6. Tek noktada ekran dönüşümü
      data[idx] = LINEAR_TO_SRGB_8BIT[(linOutR * 65536 + 0.5) | 0];
      data[idx + 1] = LINEAR_TO_SRGB_8BIT[(linOutG * 65536 + 0.5) | 0];
      data[idx + 2] = LINEAR_TO_SRGB_8BIT[(linOutB * 65536 + 0.5) | 0];
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
