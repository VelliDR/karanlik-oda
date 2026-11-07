import { PaperType } from '../types';
import {
  LINEAR_LUMA_WEIGHTS,
  PAPER_PROFILES,
  TONING_CONSTANTS
} from './constants';

/**
 * IEEE-754 binary32 (Float32) değerini binary16 (Uint16 / WebGPU r16float & rgba16float) bit dizisine dönüştürür.
 */
const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

export function float32ToFloat16Bits(val: number): number {
  f32Scratch[0] = val;
  const bits = u32Scratch[0];
  const sign = (bits >>> 16) & 0x8000;
  const exp = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x007fffff;

  if (exp <= 0) {
    if (exp < -10) {
      return sign;
    }
    mantissa = (mantissa | 0x00800000) >>> (1 - exp);
    return sign | ((mantissa + 0x00001000) >>> 13);
  }

  if (exp >= 31) {
    // NaN/Inf yerine maksimum sonlu half-float (65504.0) sınırına kenetle
    return sign | 0x7bff;
  }

  const rounded = mantissa + 0x00001000;
  return sign | (((exp << 10) + (rounded >>> 13)) & 0x7fff);
}

export function packFloat32ArrayToFloat16(src: Float32Array, dst?: Uint16Array): Uint16Array {
  const out = dst && dst.length === src.length ? dst : new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = float32ToFloat16Bits(src[i]);
  }
  return out;
}

export interface ToningLUT1D {
  readonly key: string;
  readonly size: number;
  /** 256 * 4 RGBA lineer çarpan tablosu (CPU 1:1 örnekleme için) */
  readonly floatData: Float32Array;
  /** 256 * 4 RGBA IEEE-754 binary16 tablosu (WebGPU rgba16float doku yüklemesi için) */
  readonly halfData: Uint16Array;
  readonly isNeutral: boolean;
}

let cachedToningLut: ToningLUT1D | null = null;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Selenyum (0–1), Sepya (0–1) ve Kağıt Tipine göre yoğunluktan (D_norm ∈ [0, 1]) lineer RGB
 * tonlama çarpanına eşlenen 256 girişli 1D LUT üretir.
 *
 * - Her iki sürgü 0 iken tam birim tablo (1, 1, 1) döner; gri rampada sıfır renk kayması garanti edilir.
 * - Selenyum koyu tonlarda (yüksek gümüş yoğunluğu) Dmax artışıyla birlikte mor-kahve (Ag2Se) kayması verir.
 * - Sepya açık ve orta tonlarda sıcak sülfür kahvesi (Ag2S) verir; gümüş olmayan saf kağıt beyazını (t=0) boyamaz.
 */
export function getOrBuildToningLUT1D(
  selenium: number,
  sepia: number,
  paperType: PaperType
): ToningLUT1D {
  const sel = clamp01(Number.isFinite(selenium) ? selenium : 0);
  const sep = clamp01(Number.isFinite(sepia) ? sepia : 0);
  const safePaper: PaperType = PAPER_PROFILES[paperType] ? paperType : 'rc-glossy';

  const key = `${safePaper}:${sel.toFixed(4)}:${sep.toFixed(4)}`;
  if (cachedToningLut && cachedToningLut.key === key) {
    return cachedToningLut;
  }

  const N = TONING_CONSTANTS.lutSize; // 256
  const floatData = new Float32Array(N * 4);
  const isNeutral = sel <= 1e-4 && sep <= 1e-4;

  if (isNeutral) {
    for (let i = 0; i < N; i++) {
      const idx = i * 4;
      floatData[idx] = 1.0;
      floatData[idx + 1] = 1.0;
      floatData[idx + 2] = 1.0;
      floatData[idx + 3] = 1.0;
    }
  } else {
    const profile = PAPER_PROFILES[safePaper];
    const sens = profile.toningSensitivity;
    const effSel = sel * sens;
    const effSep = sep * sens;

    const [selShiftR, selShiftG, selShiftB] = TONING_CONSTANTS.selenium.chromaticShiftLinearRgb;
    const [sepShiftR, sepShiftG, sepShiftB] = TONING_CONSTANTS.sepia.chromaticShiftLinearRgb;
    const [lwR, lwG, lwB] = LINEAR_LUMA_WEIGHTS;

    const maxIdx = N - 1;
    for (let i = 0; i < N; i++) {
      // t = normalize edilmiş gümüş yoğunluğu: 0.0 (Dmin kağıt beyazı) -> 1.0 (Dmax tam siyah)
      const t = i / maxIdx;

      // 1. Selenyum ağırlığı (koyu ton / yüksek yoğunluk odaklı)
      const wSel = effSel > 0 ? Math.pow(t, TONING_CONSTANTS.selenium.densityExponent) : 0;
      const deltaDSel = effSel * wSel * TONING_CONSTANTS.selenium.maxShadowDensityBoost;

      // 2. Sepya ağırlığı (açık ve orta gümüş tonlarda zirve yapar, t=0'da sıfırdır, selenyum varsa gölgede çekilir)
      let wSep = 0;
      if (effSep > 0 && t > 0) {
        const phase = Math.min(0.82, Math.pow(t, TONING_CONSTANTS.sepia.highlightSkewExponent) * 0.82);
        const shadowProtect = 1.0 - TONING_CONSTANTS.sepia.deepShadowRolloff * sel * t;
        wSep = Math.sin(Math.PI * phase) * Math.max(0.2, shadowProtect);
      }
      const deltaDSep = -effSep * wSep * (1.0 - t) * TONING_CONSTANTS.sepia.bleachDensityRelief;

      // 3. Birleşik kromatik renk kayması (lüminans korumalı)
      let cR = 1.0 + effSel * wSel * selShiftR + effSep * wSep * sepShiftR;
      let cG = 1.0 + effSel * wSel * selShiftG + effSep * wSep * sepShiftG;
      let cB = 1.0 + effSel * wSel * selShiftB + effSep * wSep * sepShiftB;

      cR = Math.max(0.05, cR);
      cG = Math.max(0.05, cG);
      cB = Math.max(0.05, cB);

      const chromaLuma = lwR * cR + lwG * cG + lwB * cB;
      const invLuma = chromaLuma > 1e-5 ? 1.0 / chromaLuma : 1.0;

      // 4. Selenyum yoğunluk artışı ve sepya mikro ağartma yoğunluk çarpanı: 10^(-ΔD)
      const densityGain = Math.pow(10.0, -(deltaDSel + deltaDSep));
      const scale = invLuma * densityGain;

      const idx = i * 4;
      floatData[idx] = cR * scale;
      floatData[idx + 1] = cG * scale;
      floatData[idx + 2] = cB * scale;
      floatData[idx + 3] = 1.0;
    }
  }

  const halfData = packFloat32ArrayToFloat16(floatData);
  cachedToningLut = {
    key,
    size: N,
    floatData,
    halfData,
    isNeutral
  };

  return cachedToningLut;
}

/**
 * CPU yedeği için 256 girişli 1D Toning LUT tablosundan doğrusal (linear) enterpolasyonla örnek alır.
 * WebGPU'daki `textureSampleLevel(toningTex, linearSampler, vec2(u, 0.5), 0.0)` ile birebir eşdeğerdir.
 */
export function sampleToningLUT1D(
  lut: ToningLUT1D,
  normalizedDensity: number,
  outRgb: [number, number, number]
): void {
  if (lut.isNeutral) {
    outRgb[0] = 1.0;
    outRgb[1] = 1.0;
    outRgb[2] = 1.0;
    return;
  }

  const t = clamp01(normalizedDensity);
  const maxIdx = lut.size - 1;
  const pos = t * maxIdx;
  const i0 = Math.min(maxIdx, Math.floor(pos));
  const i1 = Math.min(maxIdx, i0 + 1);
  const frac = pos - i0;

  const base0 = i0 * 4;
  const base1 = i1 * 4;
  const d = lut.floatData;

  outRgb[0] = d[base0] + (d[base1] - d[base0]) * frac;
  outRgb[1] = d[base0 + 1] + (d[base1 + 1] - d[base0 + 1]) * frac;
  outRgb[2] = d[base0 + 2] + (d[base1 + 2] - d[base0 + 2]) * frac;
}
