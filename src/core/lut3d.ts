import { CubeLUT3D, PresetKey, RenderTarget, SensitometryParams, SliderSettings } from './types';
import { PRESETS } from './presets';
import { resolveEffectivePushPull } from './chemistry/push-pull';

/**
 * 🎞️ 3D LUT (.cube), Tetrahedral Enterpolasyon ve Hurter & Driffield (H&D) Sensitometri Motoru.
 *
 * - CSS filtrelerini (brightness, contrast, saturate) ve düz renk örtülerini (overlay) %100 devre dışı bırakır.
 * - Giriş piksellerini sRGB'den lineer sahne radyansına (Scene-Linear) çevirir, EV pozlama ve Bradford kromatik sıcaklık uygular.
 * - Hurter & Driffield (H&D) karakteristik eğrisiyle dip tonlarda (toe) logaritmik uyanış, orta tonlarda lineer gamma geçişi
 *   ve yüksek ışıklarda (shoulder) yumuşak doygunluk sönümlenmesi (highlight roll-off) sağlar.
 * - 33x33x33 veya 65x65x65 boyutundaki 3D LUT küplerini 6-bölmeli Dörtyüzlü (Tetrahedral) Enterpolasyon ile örnekler.
 */

const LUT_CACHE = new Map<PresetKey, CubeLUT3D>();
let customCubeLUT: CubeLUT3D | null = null;

export function setCustomCubeLUT(lut: CubeLUT3D | null): void {
  customCubeLUT = lut;
}

export function getCustomCubeLUT(): CubeLUT3D | null {
  return customCubeLUT;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3.0 - 2.0 * t);
}

export function srgbToLinear(c: number): number {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
}

/**
 * Standart Adobe / Iridas .CUBE 3D LUT dosyasını ayrıştırır (33x33x33, 65x65x65 vb.).
 */
export function parseCubeLUT(cubeText: string, fallbackTitle = 'Custom .CUBE LUT'): CubeLUT3D {
  const lines = cubeText.split(/\r?\n/);
  let title = fallbackTitle;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];

  const rgbValues: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('TITLE')) {
      const match = line.match(/TITLE\s+"?([^"]+)"?/i);
      if (match && match[1]) title = match[1].trim();
      continue;
    }

    if (line.startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/);
      size = parseInt(parts[1], 10);
      if (!Number.isFinite(size) || size < 2 || size > 129) {
        throw new Error(`Geçersiz 3D LUT boyutu: ${parts[1]}`);
      }
      continue;
    }

    if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUT desteklenmiyor; lütfen 3D .cube (örn. 33x33x33 veya 65x65x65) dosyası yükleyin.');
    }

    if (line.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/);
      domainMin = [parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0];
      continue;
    }

    if (line.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/);
      domainMax = [parseFloat(parts[1]) || 1, parseFloat(parts[2]) || 1, parseFloat(parts[3]) || 1];
      continue;
    }

    // Veri satırı (R G B float üçlüsü)
    const firstChar = line.charCodeAt(0);
    if (
      (firstChar >= 48 && firstChar <= 57) ||
      firstChar === 45 || // '-'
      firstChar === 43 || // '+'
      firstChar === 46    // '.'
    ) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          rgbValues.push(r, g, b);
        }
      }
    }
  }

  if (size === 0) {
    // Boyut başlığı eksikse satır sayısının küp kökünden çıkar
    const totalTriplets = rgbValues.length / 3;
    const guessed = Math.round(Math.cbrt(totalTriplets));
    if (guessed >= 2 && guessed * guessed * guessed === totalTriplets) {
      size = guessed;
    } else {
      throw new Error('.CUBE dosyasında LUT_3D_SIZE bulunamadı.');
    }
  }

  const expectedTriplets = size * size * size;
  if (rgbValues.length < expectedTriplets * 3) {
    throw new Error(
      `.CUBE veri satırı eksik: ${expectedTriplets} nokta beklenirken ${Math.floor(rgbValues.length / 3)} bulundu.`
    );
  }

  const data = new Float32Array(expectedTriplets * 4);
  for (let i = 0; i < expectedTriplets; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 4;
    data[dstIdx] = clamp01(rgbValues[srcIdx]);
    data[dstIdx + 1] = clamp01(rgbValues[srcIdx + 1]);
    data[dstIdx + 2] = clamp01(rgbValues[srcIdx + 2]);
    data[dstIdx + 3] = 1.0;
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    data
  };
}

/**
 * 6-Bölmeli Dörtyüzlü (Tetrahedral) 3D LUT Enterpolasyonu.
 *
 * Trilinear enterpolasyon 8 köşe noktasını ortaladığı için diyagonal nötr gri ekseninde
 * renk kirlenmesine yol açar. Tetrahedral enterpolasyon ise birim küpü ana nötr eksen
 * (0,0,0 -> 1,1,1) etrafında 6 dörtyüzlüye (tetrahedra) böler ve yalnızca 4 köşe kullanır.
 */
export function sampleLUT3DTetrahedral(
  lut: CubeLUT3D,
  r: number,
  g: number,
  b: number,
  out: [number, number, number]
): void {
  const N = lut.size;
  const maxIdx = N - 1;
  const data = lut.data;

  const dMin = lut.domainMin;
  const dMax = lut.domainMax;
  const nr = clamp01((r - dMin[0]) / (dMax[0] - dMin[0] || 1));
  const ng = clamp01((g - dMin[1]) / (dMax[1] - dMin[1] || 1));
  const nb = clamp01((b - dMin[2]) / (dMax[2] - dMin[2] || 1));

  const fx = nr * maxIdx;
  const fy = ng * maxIdx;
  const fz = nb * maxIdx;

  const x0 = Math.min(maxIdx, Math.floor(fx));
  const y0 = Math.min(maxIdx, Math.floor(fy));
  const z0 = Math.min(maxIdx, Math.floor(fz));

  const x1 = Math.min(maxIdx, x0 + 1);
  const y1 = Math.min(maxIdx, y0 + 1);
  const z1 = Math.min(maxIdx, z0 + 1);

  const dr = fx - x0;
  const dg = fy - y0;
  const db = fz - z0;

  const strideY = N * 4;
  const strideZ = N * N * 4;

  // c000 = V(x0, y0, z0), c111 = V(x1, y1, z1)
  const i000 = x0 * 4 + y0 * strideY + z0 * strideZ;
  const i111 = x1 * 4 + y1 * strideY + z1 * strideZ;

  let c1: number;
  let c2: number;
  let w0: number;
  let w1: number;
  let w2: number;
  let w3: number;

  if (dr >= dg) {
    if (dg >= db) {
      // T1: dr >= dg >= db -> (1,0,0), (1,1,0)
      c1 = x1 * 4 + y0 * strideY + z0 * strideZ;
      c2 = x1 * 4 + y1 * strideY + z0 * strideZ;
      w0 = 1.0 - dr;
      w1 = dr - dg;
      w2 = dg - db;
      w3 = db;
    } else if (dr >= db) {
      // T2: dr >= db > dg -> (1,0,0), (1,0,1)
      c1 = x1 * 4 + y0 * strideY + z0 * strideZ;
      c2 = x1 * 4 + y0 * strideY + z1 * strideZ;
      w0 = 1.0 - dr;
      w1 = dr - db;
      w2 = db - dg;
      w3 = dg;
    } else {
      // T3: db > dr >= dg -> (0,0,1), (1,0,1)
      c1 = x0 * 4 + y0 * strideY + z1 * strideZ;
      c2 = x1 * 4 + y0 * strideY + z1 * strideZ;
      w0 = 1.0 - db;
      w1 = db - dr;
      w2 = dr - dg;
      w3 = dg;
    }
  } else {
    if (db > dg) {
      // T4: db > dg > dr -> (0,0,1), (0,1,1)
      c1 = x0 * 4 + y0 * strideY + z1 * strideZ;
      c2 = x0 * 4 + y1 * strideY + z1 * strideZ;
      w0 = 1.0 - db;
      w1 = db - dg;
      w2 = dg - dr;
      w3 = dr;
    } else if (db > dr) {
      // T5: dg >= db > dr -> (0,1,0), (0,1,1)
      c1 = x0 * 4 + y1 * strideY + z0 * strideZ;
      c2 = x0 * 4 + y1 * strideY + z1 * strideZ;
      w0 = 1.0 - dg;
      w1 = dg - db;
      w2 = db - dr;
      w3 = dr;
    } else {
      // T6: dg > dr >= db -> (0,1,0), (1,1,0)
      c1 = x0 * 4 + y1 * strideY + z0 * strideZ;
      c2 = x1 * 4 + y1 * strideY + z0 * strideZ;
      w0 = 1.0 - dg;
      w1 = dg - dr;
      w2 = dr - db;
      w3 = db;
    }
  }

  out[0] = w0 * data[i000] + w1 * data[c1] + w2 * data[c2] + w3 * data[i111];
  out[1] = w0 * data[i000 + 1] + w1 * data[c1 + 1] + w2 * data[c2 + 1] + w3 * data[i111 + 1];
  out[2] = w0 * data[i000 + 2] + w1 * data[c1 + 2] + w2 * data[c2 + 2] + w3 * data[i111 + 2];
}

/**
 * Hurter & Driffield (H&D) Sensitometrik Eğri Transfer Fonksiyonu.
 *
 * - Giriş: Lineer sahne radyansı E (0..∞)
 * - Dip tonlar (Toe): Logaritmik uyanış (karanlık bölgeleri çamurlaştırmadan taban yoğunluğu Dmin üzerinde uyandırır).
 * - Orta tonlar (Linear): 18% gri (E = 0.18) etrafında karakteristik film eğimi (gammaSlope).
 * - Yüksek ışıklar (Shoulder): Asimptotik rasyonel sönümlenme (Michaelis-Menten / H&D omuz sıkıştırması) ile
 *   parlak yüzeylerin (örn. güneş vuran sandalye veya bulutlar) dijital kırpılmasını (clipping) tamamen önler.
 */
export function evaluateHDCurveChannel(
  linearE: number,
  gamma: number,
  toeStrength: number,
  shoulderCompression: number,
  dMin: number,
  dMax: number
): number {
  const e = Math.max(0, linearE);

  // 1. Toe (Dip ton logaritmik uyanış): Karanlık bölgeleri ezmeden taban yoğunluğuna bağlar
  const toeLift = toeStrength * 0.014;
  const eToe = (e + toeLift * (1.0 - Math.exp(-e * 18.0))) / (1.0 + toeLift);

  // 2. Orta ton (18% gri pivot E0 = 0.184 etrafında doğrusal H&D kontrast eğimi)
  const pivot = 0.184;
  const eContrast = eToe <= 0.0 ? 0.0 : pivot * Math.pow(eToe / pivot, gamma);

  // 3. Shoulder (Yüksek ışıklarda C¹-sürekli üstel H&D film omzu sıkıştırması)
  // y(knee) = knee, y'(knee) = 1.0 (sıfır kırılma), lim(x->∞) y(x) = ceiling <= 1.0 (sıfır patlama)
  let linearOut = eContrast;
  if (shoulderCompression > 0.001) {
    const knee = 0.86 - shoulderCompression * 0.42;
    const ceiling = 1.0 - shoulderCompression * 0.02;
    if (eContrast > knee) {
      const delta = eContrast - knee;
      const headroom = Math.max(0.05, ceiling - knee);
      linearOut = knee + headroom * (1.0 - Math.exp(-delta / headroom));
    }
  }

  const perceptual = linearToSrgb(clamp01(linearOut));
  return clamp01(dMin + perceptual * (dMax - dMin));
}

/**
 * Üç kanallı RGB üzerinde H&D Sensitometri, Bradford Sıcaklık ve Omuz Doygunluk Sönümlenmesi uygular.
 */
export function applyHDSensitometryRGB(
  srgbR: number,
  srgbG: number,
  srgbB: number,
  exposure: number,
  contrast: number,
  shoulderSlider: number,
  warmth: number,
  saturation: number,
  sensitometry: SensitometryParams,
  out: [number, number, number],
  highlights = 0,
  shadows = 0,
  whites = 0,
  blacks = 0,
  tint = 0
): void {
  // 1. sRGB -> Scene Linear
  let lr = srgbToLinear(srgbR);
  let lg = srgbToLinear(srgbG);
  let lb = srgbToLinear(srgbB);

  // 2. Fiziksel EV Pozlama (Exposure Stops)
  const evStops = (exposure / 100) * 1.65;
  const expGain = Math.pow(2.0, evStops);
  lr *= expGain;
  lg *= expGain;
  lb *= expGain;

  // 3. Lightroom İnce Ton Kontrolleri (Lineer Foton Uzayında)
  const lumaLin = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;

  // Siyah Noktası (Blacks)
  if (blacks !== 0) {
    const bWeight = Math.pow(1.0 - Math.min(1.0, Math.max(0.0, lumaLin / 0.28)), 2.0);
    const bOffset = (blacks / 100) * 0.075;
    lr = Math.max(0.0, lr + bOffset * bWeight);
    lg = Math.max(0.0, lg + bOffset * bWeight);
    lb = Math.max(0.0, lb + bOffset * bWeight);
  }

  // Gölgeler (Shadows)
  if (shadows !== 0) {
    const sWeight = 1.0 - smoothstep(0.0, 0.45, lumaLin);
    const sGain = Math.pow(2.0, (shadows / 100) * 1.35);
    const sBlend = 1.0 + (sGain - 1.0) * sWeight;
    lr *= sBlend;
    lg *= sBlend;
    lb *= sBlend;
  }

  // Vurgular (Highlights)
  if (highlights !== 0) {
    const hWeight = smoothstep(0.22, 1.0, lumaLin);
    const hGain = Math.pow(2.0, (highlights / 100) * 1.25);
    const hBlend = 1.0 + (hGain - 1.0) * hWeight;
    lr *= hBlend;
    lg *= hBlend;
    lb *= hBlend;
  }

  // Beyazlar (Whites)
  if (whites !== 0) {
    const wWeight = smoothstep(0.60, 1.0, lumaLin);
    const wGain = 1.0 + (whites / 100) * 0.45;
    const wBlend = 1.0 + (wGain - 1.0) * wWeight;
    lr *= wBlend;
    lg *= wBlend;
    lb *= wBlend;
  }

  // 4. Bradford / Planckian Kromatik Sıcaklık & Tint Adaptasyonu
  if (warmth !== 0) {
    const w = warmth / 100;
    lr *= 1.0 + w * 0.24;
    lg *= 1.0 + w * 0.03;
    lb *= Math.max(0.55, 1.0 - w * 0.26);
  }

  if (tint !== 0) {
    const t = (tint / 100) * 0.16;
    lr *= 1.0 + t * 0.5;
    lg *= 1.0 - t;
    lb *= 1.0 + t * 0.5;
  }


  // 4. H&D Karakteristik Eğri Parametreleri
  const contrastFactor = Math.pow(2.0, (contrast / 100) * 0.58);
  const effectiveGamma = Math.max(0.55, Math.min(2.1, sensitometry.gammaSlope * contrastFactor));
  const userShoulder = clamp01(shoulderSlider / 100);
  const effectiveShoulder =
    userShoulder <= 0.001
      ? 0.0
      : clamp01(userShoulder * (0.65 + 0.45 * sensitometry.shoulderRollOff));

  let sr = evaluateHDCurveChannel(
    lr,
    effectiveGamma,
    sensitometry.toeStrength,
    effectiveShoulder,
    sensitometry.dMin,
    sensitometry.dMax
  );
  let sg = evaluateHDCurveChannel(
    lg,
    effectiveGamma,
    sensitometry.toeStrength,
    effectiveShoulder,
    sensitometry.dMin,
    sensitometry.dMax
  );
  let sb = evaluateHDCurveChannel(
    lb,
    effectiveGamma,
    sensitometry.toeStrength,
    effectiveShoulder,
    sensitometry.dMin,
    sensitometry.dMax
  );

  // 5. Film Omzunda Çapraz Kanal Doygunluk Sönümlenmesi (Highlight Shoulder Desaturation)
  // Gerçek emülsiyonlarda yüksek ışıklarda tüm katmanlar maksimum yoğunluğa yaklaşırken
  // tekil kanalların plastik sarı/camgöbeği patlaması yapmasını önler, kremsi film beyazına kavuşturur.
  const maxCh = Math.max(sr, sg, sb);
  const luma = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
  const shoulderZone = smoothstep(0.66, 0.98, maxCh);
  const desatAmount = shoulderZone * clamp01(sensitometry.highlightDesat * effectiveShoulder * 1.25);

  if (desatAmount > 0) {
    // Sıcak kağıt bazlı kremsi nötr vurgu hedefi
    const warmLumaR = Math.min(1.0, luma * 1.006);
    const warmLumaG = luma;
    const warmLumaB = luma * 0.988;
    sr = sr + (warmLumaR - sr) * desatAmount;
    sg = sg + (warmLumaG - sg) * desatAmount;
    sb = sb + (warmLumaB - sb) * desatAmount;
  }

  // 6. Fotometrik Lüminans Korumalı Doygunluk (Oklab/Rec.709 uyumlu)
  if (saturation !== 0) {
    const satFactor = Math.max(0, 1.0 + (saturation / 100) * 0.85);
    const postLuma = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
    // Omuz bölgesinde aşırı doygunluk artışını frenle (plastikleşmeyi önler)
    const effectiveSat = satFactor > 1.0 ? 1.0 + (satFactor - 1.0) * (1.0 - shoulderZone * 0.65) : satFactor;
    sr = clamp01(postLuma + (sr - postLuma) * effectiveSat);
    sg = clamp01(postLuma + (sg - postLuma) * effectiveSat);
    sb = clamp01(postLuma + (sb - postLuma) * effectiveSat);
  }

  out[0] = sr;
  out[1] = sg;
  out[2] = sb;
}

/**
 * Gerçek Film Emülsiyonlarının Spektral Renk Tepkisini 33x33x33 3D LUT Küpü Olarak Üretir.
 */
function buildEmulsion3DLUT(presetKey: PresetKey, size = 33): CubeLUT3D {
  const totalPoints = size * size * size;
  const data = new Float32Array(totalPoints * 4);
  const maxIdx = size - 1;

  for (let bIdx = 0; bIdx < size; bIdx++) {
    const bIn = bIdx / maxIdx;
    for (let gIdx = 0; gIdx < size; gIdx++) {
      const gIn = gIdx / maxIdx;
      for (let rIdx = 0; rIdx < size; rIdx++) {
        const rIn = rIdx / maxIdx;

        let r = rIn;
        let g = gIn;
        let b = bIn;

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const shadowWeight = Math.pow(1.0 - luma, 1.8);
        const midWeight = 4.0 * luma * (1.0 - luma);
        const highWeight = Math.pow(luma, 1.6);

        switch (presetKey) {
          case 'none':
          case 'custom_lut':
            break;

          case 'analog': {
            // Kodak Portra 400 (C-41): DIR kuplör matrisi, sıcak altın orta tonlar, korunan şeftali tenler, kremsi açık tonlar
            const mr = 0.94 * r + 0.05 * g + 0.01 * b;
            const mg = 0.03 * r + 0.94 * g + 0.03 * b;
            const mb = 0.01 * r + 0.05 * g + 0.94 * b;
            r = mr + 0.018 * midWeight + 0.012 * highWeight - 0.008 * shadowWeight;
            g = mg + 0.008 * midWeight + 0.006 * highWeight;
            b = mb - 0.022 * midWeight - 0.015 * highWeight + 0.012 * shadowWeight;
            break;
          }

          case 'kodachrome': {
            // Kodachrome 64 (KR64 K-14 Dia): İkonik zengin kırmızılar, derin arşivsel kobalt gökyüzü mavisi, bronz-kehribar ten
            const mr = 1.04 * r - 0.03 * g - 0.01 * b;
            const mg = 0.02 * r + 0.96 * g + 0.02 * b;
            const mb = -0.03 * r + 0.06 * g + 0.97 * b;
            // K-14 boya kuplaj karakteristiği
            const redRichness = Math.max(0, r - g) * 0.16;
            const blueDepth = Math.max(0, b - r) * 0.14;
            r = mr + redRichness + 0.024 * midWeight + 0.014 * highWeight;
            g = mg + 0.006 * midWeight - blueDepth * 0.18;
            b = mb - blueDepth * 0.12 - 0.024 * midWeight + 0.010 * shadowWeight;
            break;
          }

          case 'velvia': {
            // Fuji Velvia 50 (RVP50 E-6 Dia): Yüksek klorofil zümrüt yeşili, derin eflatun-mavi gökyüzü, sıcak gün batımı
            const mr = 1.08 * r - 0.06 * g - 0.02 * b;
            const mg = -0.03 * r + 1.07 * g - 0.04 * b;
            const mb = -0.03 * r - 0.04 * g + 1.07 * b;
            const foliage = Math.max(0, g - Math.max(r, b)) * 0.22;
            const sky = Math.max(0, b - g) * 0.18;
            r = mr + 0.016 * highWeight - foliage * 0.15 + sky * 0.08;
            g = mg + foliage * 0.28 + 0.005 * midWeight;
            b = mb + sky * 0.22 + 0.018 * shadowWeight - foliage * 0.12;
            break;
          }

          case 'hp5': {
            // Ilford HP5 Plus 400: Pankromatik sarı-yeşil ağırlıklı gümüş halojenür spektral duyarlık
            const panLuma = clamp01(0.25 * r + 0.66 * g + 0.09 * b);
            // Gümüş jelatin kağıt üzerinde çok hafif sıcak-nötr baryta tonu
            const baryta = panLuma + 0.014 * Math.sin(panLuma * Math.PI);
            r = baryta * 1.004;
            g = baryta * 1.001;
            b = baryta * 0.992;
            break;
          }

          case 'sb': {
            // Daido Moriyama S/B (Kodak Tri-X 400 Push D-76): Yüksek kırmızı/mavi kontrastlı pankromatik tepki
            const trixLuma = clamp01(0.32 * r + 0.59 * g + 0.09 * b);
            // Push banyosu: derin gümüş siyahlar ve parlak baryta kağıt beyazı
            const pushed = smoothstep(0.03, 0.97, trixLuma);
            const curve = 0.65 * pushed + 0.35 * trixLuma;
            r = curve;
            g = curve;
            b = curve;
            break;
          }

          case 'cinestill': {
            // CineStill 800T (Kodak Vision3 500T 5219): 3200K tungsten dengesi, camgöbeği-petrol gölgeler, kehribar vurgular
            const mr = 0.96 * r + 0.03 * g + 0.01 * b;
            const mg = 0.02 * r + 0.97 * g + 0.01 * b;
            const mb = -0.02 * r + 0.06 * g + 0.96 * b;
            r = mr - 0.032 * shadowWeight + 0.030 * highWeight + 0.010 * midWeight;
            g = mg + 0.008 * shadowWeight + 0.012 * highWeight;
            b = mb + 0.042 * shadowWeight - 0.026 * highWeight;
            break;
          }

          case 'nordic': {
            // Leica Nordic: İskandinav arduvaz-lacivert gölgeler, adaçayı yeşili, sıcak parşömen açık tonlar
            const mr = 0.91 * r + 0.06 * g + 0.03 * b;
            const mg = 0.04 * r + 0.93 * g + 0.03 * b;
            const mb = 0.03 * r + 0.06 * g + 0.91 * b;
            r = mr - 0.024 * shadowWeight + 0.022 * highWeight;
            g = mg - 0.006 * shadowWeight + 0.012 * highWeight;
            b = mb + 0.038 * shadowWeight - 0.014 * highWeight;
            break;
          }

          case 'reze': {
            // CSM Reze (Fuji Pro 400H Overexposed): Seladon-nane açık tonlar, şeftali-pembe vurgulama, havadar gölgeler
            const mr = 0.95 * r + 0.03 * g + 0.02 * b;
            const mg = 0.02 * r + 0.96 * g + 0.02 * b;
            const mb = 0.02 * r + 0.04 * g + 0.94 * b;
            r = mr + 0.020 * shadowWeight + 0.024 * highWeight;
            g = mg + 0.014 * shadowWeight + 0.026 * highWeight + 0.010 * midWeight;
            b = mb + 0.024 * shadowWeight + 0.018 * highWeight;
            break;
          }

          case 'vampir': {
            // Vampir (E-6/C-41 Çapraz Banyo): Kan kırmızısı gölge boya kuplajı ve gotik gümüş kontrast
            const crimsonDominance = Math.max(0, r - 0.5 * (g + b));
            r = clamp01(luma * 0.45 + r * 0.68 + 0.065 * shadowWeight + crimsonDominance * 0.35);
            g = clamp01(luma * 0.52 + g * 0.36 - 0.035 * shadowWeight - crimsonDominance * 0.15);
            b = clamp01(luma * 0.50 + b * 0.38 - 0.028 * shadowWeight - crimsonDominance * 0.15);
            break;
          }

          case 'gotik': {
            // Gotik (ENR Gümüş Tutma Banyosu): Düşük doygunluk, Prusya mavisi soğuk gölgeler ve metalik gümüş orta tonlar
            const silver = 0.24 * r + 0.64 * g + 0.12 * b;
            r = silver * 0.72 + r * 0.28 - 0.022 * shadowWeight;
            g = silver * 0.72 + g * 0.28 - 0.004 * shadowWeight;
            b = silver * 0.70 + b * 0.30 + 0.036 * shadowWeight;
            break;
          }

          case 'ccd': {
            // Digicam 2004 (ICX Bayer CCD): Kobalt gökyüzü mavisi ve canlı birincil RGB matrisi
            r = 1.06 * r - 0.04 * g - 0.02 * b;
            g = -0.02 * r + 1.04 * g - 0.02 * b;
            b = -0.03 * r + 0.02 * g + 1.05 * b + 0.018 * midWeight;
            break;
          }

          case 'ccd_y2k': {
            // Cyber Flash Y2K: Xenon flaş soğuk gümüş vurgular ve yüksek kroma
            r = 1.04 * r - 0.02 * g - 0.02 * b + 0.015 * highWeight;
            g = -0.02 * r + 1.04 * g - 0.02 * b + 0.018 * highWeight;
            b = -0.02 * r + 0.03 * g + 1.04 * b + 0.028 * highWeight;
            break;
          }
        }

        const dstIdx = (rIdx + gIdx * size + bIdx * size * size) * 4;
        data[dstIdx] = clamp01(r);
        data[dstIdx + 1] = clamp01(g);
        data[dstIdx + 2] = clamp01(b);
        data[dstIdx + 3] = 1.0;
      }
    }
  }

  return {
    title: PRESETS[presetKey]?.name || presetKey,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data
  };
}

/**
 * Seçili emülsiyonun 33x33x33 (veya özel yüklenmiş .cube ise 33³/65³) 3D LUT verisini döner.
 */
export function getActiveLUT3D(presetKey: PresetKey): CubeLUT3D {
  if (presetKey === 'custom_lut' && customCubeLUT) {
    return customCubeLUT;
  }

  let cached = LUT_CACHE.get(presetKey);
  if (!cached) {
    cached = buildEmulsion3DLUT(presetKey, 33);
    LUT_CACHE.set(presetKey, cached);
  }
  return cached;
}

/**
 * WebGPU olmayan ortamlar veya 2D yedek işleme hattı için:
 * H&D Sensitometri Eğrisi + Omuz Sıkıştırması + 3D LUT Tetrahedral Enterpolasyonu uygular.
 */
export function applySensitometryAndLUTCPU(
  target: RenderTarget,
  settings: SliderSettings,
  customLutOverride?: CubeLUT3D | null
): void {
  const { ctx, width: w, height: h } = target;
  if (w <= 0 || h <= 0) return;

  const exp = settings.exposure;
  const con = settings.contrast;
  const shld = settings.shoulder ?? 0;
  const warm = settings.warmth;
  const sat = settings.saturation;
  const hl = settings.highlights ?? 0;
  const sh = settings.shadows ?? 0;
  const wh = settings.whites ?? 0;
  const bl = settings.blacks ?? 0;
  const tint = settings.tint ?? 0;
  const vib = settings.vibrance ?? 0;

  if (
    settings.preset === 'none' &&
    exp === 0 &&
    con === 0 &&
    shld === 0 &&
    warm === 0 &&
    sat === 0 &&
    hl === 0 &&
    sh === 0 &&
    wh === 0 &&
    bl === 0 &&
    tint === 0 &&
    vib === 0
  ) {
    return;
  }

  const preset = PRESETS[settings.preset] || PRESETS.none;
  const pushPull = resolveEffectivePushPull(settings, preset);
  const effExp = pushPull.effectiveExposureSlider;
  const lut =
    settings.preset === 'custom_lut' && customLutOverride
      ? customLutOverride
      : getActiveLUT3D(settings.preset);
  const sensitometry = pushPull.sensitometry;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const hdOut: [number, number, number] = [0, 0, 0];
  const lutOut: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < data.length; i += 4) {
    const rIn = data[i] / 255;
    const gIn = data[i + 1] / 255;
    const bIn = data[i + 2] / 255;

    // 1. H&D Sensitometri, Ton Ayarları & Film Omzu Sıkıştırması
    applyHDSensitometryRGB(rIn, gIn, bIn, effExp, con, shld, warm, 0, sensitometry, hdOut, hl, sh, wh, bl, tint);

    // 2. 3D LUT Dörtyüzlü (Tetrahedral) Enterpolasyon
    sampleLUT3DTetrahedral(lut, hdOut[0], hdOut[1], hdOut[2], lutOut);

    // 3. Akıllı Canlılık (Vibrance) ve Doygunluk Kontrolü (Omuz korumalı)
    let rOut = lutOut[0];
    let gOut = lutOut[1];
    let bOut = lutOut[2];

    if (vib !== 0) {
      const maxC = Math.max(rOut, gOut, bOut);
      const minC = Math.min(rOut, gOut, bOut);
      const curSat = (maxC - minC) / Math.max(0.001, maxC);
      const vibWeight = 1.0 - curSat;
      const vibGain = 1.0 + (vib / 100) * 0.85 * vibWeight;
      const lumaV = 0.2126 * rOut + 0.7152 * gOut + 0.0722 * bOut;
      rOut = clamp01(lumaV + (rOut - lumaV) * vibGain);
      gOut = clamp01(lumaV + (gOut - lumaV) * vibGain);
      bOut = clamp01(lumaV + (bOut - lumaV) * vibGain);
    }

    if (sat !== 0) {
      const luma = 0.2126 * rOut + 0.7152 * gOut + 0.0722 * bOut;
      const maxCh = Math.max(rOut, gOut, bOut);
      const shoulderMask = smoothstep(0.66, 0.98, maxCh);
      const rawSat = Math.max(0, 1.0 + (sat / 100) * 0.85);
      const effSat = rawSat > 1.0 ? 1.0 + (rawSat - 1.0) * (1.0 - shoulderMask * 0.65) : rawSat;
      rOut = clamp01(luma + (rOut - luma) * effSat);
      gOut = clamp01(luma + (gOut - luma) * effSat);
      bOut = clamp01(luma + (bOut - luma) * effSat);
    }

    data[i] = Math.round(rOut * 255);
    data[i + 1] = Math.round(gOut * 255);
    data[i + 2] = Math.round(bOut * 255);
  }

  ctx.putImageData(imgData, 0, 0);
}
