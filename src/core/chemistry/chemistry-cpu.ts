import { RenderTarget, SliderSettings } from '../types';
import {
  CHEMISTRY_GAUSS_MAX_RADIUS,
  computeChemistryGridSpec,
  computeNegativePxPerMm,
  EXHAUSTION_GRID_PX_PER_MM,
  EXHAUSTION_MACRO_SIGMA_MM,
  EXHAUSTION_MAX_GRID_DIM,
  EXHAUSTION_MAX_KAPPA,
  KOSTINSKY_EDGE_MAX_ALPHA,
  KOSTINSKY_EDGE_SIGMA_MM,
  KOSTINSKY_GRID_PX_PER_MM,
  KOSTINSKY_MAX_GRID_DIM,
  RETICULATION_CELL_PITCH_MM,
  RETICULATION_MAX_DENSITY_MOD,
  RETICULATION_MAX_DISPLACEMENT_MM,
  RETICULATION_RIDGE_BIAS,
  RETICULATION_RIDGE_WIDTH,
  RETICULATION_SECONDARY_FREQ,
  RETICULATION_SECONDARY_WEIGHT
} from './constants';

/**
 * Faz 3 Banyo Kimyası — 1:1 CPU Yedek Motoru (Web Worker ve Headless Uyumlu).
 *
 * FilmChemistryWebGPUEngine WGSL shader'ları ile aynı tam sayı/kayan nokta basamaklarını,
 * aynı milimetre-kilitli ızgara boyutlarını, aynı 1B ayrılabilir Gauss çekirdeklerini ve
 * aynı PCG2D Worley hücresel gürültü aritmetiğini paylaşır.
 */

const SRGB_8BIT_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    table[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return table;
})();

const LINEAR_TO_SRGB_8BIT = (() => {
  const table = new Uint8Array(65537);
  for (let i = 0; i <= 65536; i++) {
    const v = i / 65536;
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
    table[i] = Math.min(255, Math.max(0, Math.round(s * 255)));
  }
  return table;
})();

const LOG10_INV = 0.4342944819032518; // 1 / ln(10)

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function softShoulderChannel(c: number): number {
  const v = Math.max(0.0, c);
  if (v <= 0.92) return v;
  return 0.92 + 0.08 * (1.0 - Math.exp(-(v - 0.92) / 0.08));
}

function linearToSrgbByte(c: number): number {
  if (c <= 0.0) return 0;
  if (c >= 1.0) return 255;
  return LINEAR_TO_SRGB_8BIT[(c * 65536 + 0.5) | 0];
}

function pixelOpticalDensity(data: Uint8ClampedArray, pxIdx4: number): number {
  const lr = SRGB_8BIT_TO_LINEAR[data[pxIdx4]];
  const lg = SRGB_8BIT_TO_LINEAR[data[pxIdx4 + 1]];
  const lb = SRGB_8BIT_TO_LINEAR[data[pxIdx4 + 2]];
  const yLin = Math.max(1e-4, 0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  return -Math.log(yLin) * LOG10_INV;
}

/**
 * Kaynak RGBA tampondan (w x h) hedef (gridW x gridH) optik yoğunluk ızgarasına
 * WGSL `fs_downsample_density` ile birebir aynı 4x4 alt-hücre kutu ortalaması alır.
 */
function downsampleOpticalDensity4x4(
  srcData: Uint8ClampedArray,
  w: number,
  h: number,
  gridW: number,
  gridH: number
): Float32Array {
  const out = new Float32Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    const rowOff = gy * gridW;
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0.0;
      for (let sy = 0; sy < 4; sy++) {
        const vSub = (gy + (sy + 0.5) * 0.25) / gridH;
        const iy = clampInt(Math.floor(vSub * h), 0, h - 1);
        const srcRow = iy * w;
        for (let sx = 0; sx < 4; sx++) {
          const uSub = (gx + (sx + 0.5) * 0.25) / gridW;
          const ix = clampInt(Math.floor(uSub * w), 0, w - 1);
          sum += pixelOpticalDensity(srcData, (srcRow + ix) * 4);
        }
      }
      out[rowOff + gx] = sum * 0.0625;
    }
  }
  return out;
}

/**
 * 1B ayrılabilir (yatay + dikey) tam Gauss konvolüsyonu (WGSL `fs_blur_1d` ile birebir aynı).
 */
export function buildGaussianWeights1D(sigma: number, radius: number): Float32Array {
  const r = clampInt(radius, 1, CHEMISTRY_GAUSS_MAX_RADIUS);
  const weights = new Float32Array(2 * r + 1);
  const inv2Sigma2 = 0.5 / Math.max(1e-4, sigma * sigma);
  let sum = 0.0;
  for (let k = -r; k <= r; k++) {
    const w = Math.exp(-(k * k) * inv2Sigma2);
    weights[k + r] = w;
    sum += w;
  }
  const invSum = 1.0 / sum;
  for (let i = 0; i < weights.length; i++) {
    weights[i] *= invSum;
  }
  return weights;
}

function blurGridGaussianSeparable(
  src: Float32Array,
  gridW: number,
  gridH: number,
  sigma: number,
  radius: number
): Float32Array {
  const r = clampInt(radius, 1, CHEMISTRY_GAUSS_MAX_RADIUS);
  const weights = buildGaussianWeights1D(sigma, r);
  const temp = new Float32Array(gridW * gridH);
  const dst = new Float32Array(gridW * gridH);

  // Yatay geçiş
  for (let y = 0; y < gridH; y++) {
    const rowOff = y * gridW;
    for (let x = 0; x < gridW; x++) {
      let acc = 0.0;
      for (let k = -r; k <= r; k++) {
        const sx = clampInt(x + k, 0, gridW - 1);
        acc += src[rowOff + sx] * weights[k + r];
      }
      temp[rowOff + x] = acc;
    }
  }

  // Dikey geçiş
  for (let y = 0; y < gridH; y++) {
    const rowOff = y * gridW;
    for (let x = 0; x < gridW; x++) {
      let acc = 0.0;
      for (let k = -r; k <= r; k++) {
        const sy = clampInt(y + k, 0, gridH - 1);
        acc += temp[sy * gridW + x] * weights[k + r];
      }
      dst[rowOff + x] = acc;
    }
  }

  return dst;
}

function sampleGridBilinear(
  grid: Float32Array,
  gridW: number,
  gridH: number,
  u: number,
  v: number
): number {
  const fx = u * gridW - 0.5;
  const fy = v * gridH - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const ix0 = clampInt(x0, 0, gridW - 1);
  const ix1 = clampInt(x0 + 1, 0, gridW - 1);
  const iy0 = clampInt(y0, 0, gridH - 1);
  const iy1 = clampInt(y0 + 1, 0, gridH - 1);

  const v00 = grid[iy0 * gridW + ix0];
  const v10 = grid[iy0 * gridW + ix1];
  const v01 = grid[iy1 * gridW + ix0];
  const v11 = grid[iy1 * gridW + ix1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

/**
 * Adım 3.5: Kostinsky Kenar Etkisi (Adjacency) + Eberhard Developer Tükenmesi (CPU 1:1).
 */
export function applyDeveloperChemistryCPU(
  target: RenderTarget,
  settings: SliderSettings
): void {
  const exhaustion = clamp(settings.devExhaustion ?? 0, 0.0, 1.0);
  const edgeEffect = clamp(settings.devEdgeEffect ?? 0, 0.0, 1.0);
  if (exhaustion <= 1e-5 && edgeEffect <= 1e-5) return;

  const { ctx, width: w, height: h } = target;
  if (w <= 0 || h <= 0) return;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let edgeBlur: Float32Array | null = null;
  let edgeW = 1;
  let edgeH = 1;
  if (edgeEffect > 1e-5) {
    const spec = computeChemistryGridSpec(
      w,
      h,
      KOSTINSKY_GRID_PX_PER_MM,
      KOSTINSKY_EDGE_SIGMA_MM,
      KOSTINSKY_MAX_GRID_DIM
    );
    edgeW = spec.gridW;
    edgeH = spec.gridH;
    const rawGrid = downsampleOpticalDensity4x4(data, w, h, edgeW, edgeH);
    edgeBlur = blurGridGaussianSeparable(rawGrid, edgeW, edgeH, spec.sigmaGridPx, spec.radiusGridPx);
  }

  let exhBlur: Float32Array | null = null;
  let exhW = 1;
  let exhH = 1;
  if (exhaustion > 1e-5) {
    const spec = computeChemistryGridSpec(
      w,
      h,
      EXHAUSTION_GRID_PX_PER_MM,
      EXHAUSTION_MACRO_SIGMA_MM,
      EXHAUSTION_MAX_GRID_DIM
    );
    exhW = spec.gridW;
    exhH = spec.gridH;
    const rawGrid = downsampleOpticalDensity4x4(data, w, h, exhW, exhH);
    exhBlur = blurGridGaussianSeparable(rawGrid, exhW, exhH, spec.sigmaGridPx, spec.radiusGridPx);
  }

  const alphaEdge = edgeEffect * KOSTINSKY_EDGE_MAX_ALPHA;
  const kappaExh = exhaustion * EXHAUSTION_MAX_KAPPA;
  const invW = 1.0 / w;
  const invH = 1.0 / h;

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) * invH;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) * invW;
      const idx = (rowOff + x) * 4;

      const lr = SRGB_8BIT_TO_LINEAR[data[idx]];
      const lg = SRGB_8BIT_TO_LINEAR[data[idx + 1]];
      const lb = SRGB_8BIT_TO_LINEAR[data[idx + 2]];
      const yLin = Math.max(1e-4, 0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
      const dOrig = -Math.log(yLin) * LOG10_INV;

      let dNext = dOrig;
      if (edgeBlur) {
        const dBlurEdge = sampleGridBilinear(edgeBlur, edgeW, edgeH, u, v);
        dNext = dNext + alphaEdge * (dOrig - dBlurEdge);
      }
      if (exhBlur) {
        const dBlurExh = sampleGridBilinear(exhBlur, exhW, exhH, u, v);
        dNext = dNext / (1.0 + kappaExh * dBlurExh);
      }

      const dClamped = clamp(dNext, 0.0, 4.0);
      const yOut = Math.pow(10.0, -dClamped);
      const gain = yOut / yLin;

      data[idx] = linearToSrgbByte(softShoulderChannel(lr * gain));
      data[idx + 1] = linearToSrgbByte(softShoulderChannel(lg * gain));
      data[idx + 2] = linearToSrgbByte(softShoulderChannel(lb * gain));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * WGSL `pcg_hash_pair` ile bit-bazında birebir 32-bit deterministik özetleme.
 * [0, 1) aralığında 2 adet f32 uyumlu rastgele çekirdek ofseti üretir.
 */
function hashCell2D(ix: number, iy: number, seedSalt: number): [number, number] {
  let h1 = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + (seedSalt | 0)) >>> 0;
  h1 = Math.imul(h1 ^ (h1 >>> 13), 1274126177) >>> 0;
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;

  let h2 = (Math.imul(ix | 0, 2246822519) + Math.imul(iy | 0, 3266489917) + ((seedSalt ^ 0x9e3779b9) | 0)) >>> 0;
  h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;

  // 24-bit mantissa ölçeği (WGSL f32(u32 >> 8u) * (1.0 / 16777216.0) ile tam eşlik)
  const rx = (h1 >>> 8) * (1.0 / 16777216.0);
  const ry = (h2 >>> 8) * (1.0 / 16777216.0);
  return [rx, ry];
}

function evalWorleyOctave(
  cx: number,
  cy: number,
  seedSalt: number
): { f1: number; f2: number; dirX: number; dirY: number } {
  const baseX = Math.floor(cx);
  const baseY = Math.floor(cy);

  let d1Sq = 1e9;
  let d2Sq = 1e9;
  let bestDx = 0.0;
  let bestDy = 0.0;

  for (let oy = -1; oy <= 1; oy++) {
    const ny = baseY + oy;
    for (let ox = -1; ox <= 1; ox++) {
      const nx = baseX + ox;
      const [jx, jy] = hashCell2D(nx, ny, seedSalt);
      // Jitter [0.12, 0.88] aralığında tutularak dejenere çakışmalar önlenir
      const fx = nx + 0.12 + jx * 0.76;
      const fy = ny + 0.12 + jy * 0.76;
      const dx = fx - cx;
      const dy = fy - cy;
      const distSq = dx * dx + dy * dy;

      if (distSq < d1Sq) {
        d2Sq = d1Sq;
        d1Sq = distSq;
        bestDx = dx;
        bestDy = dy;
      } else if (distSq < d2Sq) {
        d2Sq = distSq;
      }
    }
  }

  const f1 = Math.sqrt(d1Sq);
  const f2 = Math.sqrt(d2Sq);
  const invLen = 1.0 / Math.max(1e-4, f1);
  return {
    f1,
    f2,
    dirX: bestDx * invLen,
    dirY: bestDy * invLen
  };
}

function sampleRgbaLinearBilinear(
  srcData: Uint8ClampedArray,
  w: number,
  h: number,
  fx: number,
  fy: number,
  outLin: [number, number, number]
): void {
  const cx = clamp(fx, 0.0, w - 1.0);
  const cy = clamp(fy, 0.0, h - 1.0);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const tx = cx - x0;
  const ty = cy - y0;
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  for (let c = 0; c < 3; c++) {
    // WGSL textureLoad srgb_to_linear sonrasındaki enterpolasyonla birebir aynı olması için
    // önce normalize [0,1] sRGB enterpole edilir, ardından srgbToLinear uygulanır:
    const s00 = srcData[i00 + c] / 255.0;
    const s10 = srcData[i10 + c] / 255.0;
    const s01 = srcData[i01 + c] / 255.0;
    const s11 = srcData[i11 + c] / 255.0;
    const top = s00 + (s10 - s00) * tx;
    const bot = s01 + (s11 - s01) * tx;
    const sVal = clamp(top + (bot - top) * ty, 0.0, 1.0);
    outLin[c] = sVal <= 0.04045 ? sVal / 12.92 : Math.pow((sVal + 0.055) / 1.055, 2.4);
  }
}

/**
 * Adım 6.5: Reticulation — Termal Şok Jelatin Çatlaması ve Gümüş Gren Kümelenmesi (CPU 1:1).
 * Yalnızca `settings.devReticulation > 0` olduğunda çalışır; gren geçişinden sonra uygulanır.
 */
export function applyReticulationCPU(
  target: RenderTarget,
  settings: SliderSettings
): void {
  const retic = clamp(settings.devReticulation ?? 0, 0.0, 1.0);
  if (retic <= 1e-5) return;

  const { ctx, width: w, height: h } = target;
  if (w <= 0 || h <= 0) return;

  const srcImg = ctx.getImageData(0, 0, w, h);
  const srcData = new Uint8ClampedArray(srcImg.data);
  const dstData = srcImg.data;

  const pxPerMm = computeNegativePxPerMm(w, h);
  const invPxPerMm = Math.fround(1.0 / pxPerMm);
  const invPitch = Math.fround(1.0 / RETICULATION_CELL_PITCH_MM);
  const dispScalePx = Math.fround(retic * RETICULATION_MAX_DISPLACEMENT_MM * pxPerMm);
  const densityAmp = Math.fround(retic * RETICULATION_MAX_DENSITY_MOD);
  const secFreq = Math.fround(RETICULATION_SECONDARY_FREQ);

  const linRgb: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < h; y++) {
    const mmY = Math.fround((y + 0.5) * invPxPerMm);
    const vCell = Math.fround(mmY * invPitch);
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const mmX = Math.fround((x + 0.5) * invPxPerMm);
      const uCell = Math.fround(mmX * invPitch);

      const w1 = evalWorleyOctave(uCell, vCell, 0x27d4eb2d);
      const w2 = evalWorleyOctave(
        Math.fround(uCell * secFreq),
        Math.fround(vCell * secFreq),
        0x165667b1
      );

      const ridge1 = 1.0 - smoothstep(0.0, RETICULATION_RIDGE_WIDTH, w1.f2 - w1.f1);
      const ridge2 = 1.0 - smoothstep(0.0, RETICULATION_RIDGE_WIDTH, w2.f2 - w2.f1);
      const ridge = (ridge1 + RETICULATION_SECONDARY_WEIGHT * ridge2) / (1.0 + RETICULATION_SECONDARY_WEIGHT);

      const dirX = w1.dirX * (1.0 - ridge1) * 0.78 + w2.dirX * (1.0 - ridge2) * 0.22;
      const dirY = w1.dirY * (1.0 - ridge1) * 0.78 + w2.dirY * (1.0 - ridge2) * 0.22;

      const sampleX = Math.fround(x + Math.fround(dispScalePx * dirX));
      const sampleY = Math.fround(y + Math.fround(dispScalePx * dirY));

      sampleRgbaLinearBilinear(srcData, w, h, sampleX, sampleY, linRgb);

      const yLin = Math.max(1e-4, 0.2126 * linRgb[0] + 0.7152 * linRgb[1] + 0.0722 * linRgb[2]);
      const toneWeight = Math.max(0.0, 4.0 * yLin * (1.0 - 0.75 * yLin));
      const deltaD = densityAmp * (ridge - RETICULATION_RIDGE_BIAS) * toneWeight;
      const gain = Math.pow(10.0, -deltaD);

      const idx = (rowOff + x) * 4;
      dstData[idx] = linearToSrgbByte(softShoulderChannel(linRgb[0] * gain));
      dstData[idx + 1] = linearToSrgbByte(softShoulderChannel(linRgb[1] * gain));
      dstData[idx + 2] = linearToSrgbByte(softShoulderChannel(linRgb[2] * gain));
    }
  }

  ctx.putImageData(srcImg, 0, 0);
}
