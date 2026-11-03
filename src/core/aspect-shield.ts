import { AnyCanvas, AnyRenderingContext2D, RotationDegree } from './types';
import { createCompatibleCanvas } from './optics';

export interface AspectROI {
  scale: number;
  activeWidth: number;
  activeHeight: number;
  padX: number;
  padY: number;
  boxSize: number;
}

/**
 * En-boy oranı koruma kalkanı için ROI (İlgi Bölgesi) geometrisini hesaplar.
 * Görselin orijinal oranını (Aspect Ratio) sub-piksel hassasiyetle korur.
 */
export function computeAspectROI(
  sourceWidth: number,
  sourceHeight: number,
  boxSize: number = 512
): AspectROI {
  const scale = Math.min(boxSize / sourceWidth, boxSize / sourceHeight);
  const activeWidth = Math.max(1, Math.round(sourceWidth * scale));
  const activeHeight = Math.max(1, Math.round(sourceHeight * scale));
  const padX = Math.floor((boxSize - activeWidth) / 2);
  const padY = Math.floor((boxSize - activeHeight) / 2);

  return {
    scale,
    activeWidth,
    activeHeight,
    padX,
    padY,
    boxSize
  };
}

/**
 * Görseli en-boy oranını bozmadan (letterbox / pillarbox) AI işlem kutusuna yerleştirir.
 */
export function createLetterboxCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  boxSize: number = 512
): { canvas: AnyCanvas; ctx: AnyRenderingContext2D; roi: AspectROI } {
  const roi = computeAspectROI(sourceWidth, sourceHeight, boxSize);
  const canvas = createCompatibleCanvas(boxSize, boxSize);
  const ctx = canvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!ctx) throw new Error('Letterbox tuvali oluşturulamadı.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, roi.padX, roi.padY, roi.activeWidth, roi.activeHeight);

  return { canvas, ctx, roi };
}

/**
 * İşlenmiş kutudan yalnızca aktif alanı çıkarır (unpadding) ve hedef boyuta 1:1 piksel hassasiyetiyle projekte eder.
 * Böylece tek bir piksel bile önizlemedeki konumundan kaymaz.
 */
export function unpadAndProjectMask(
  processedBoxCanvas: AnyCanvas,
  roi: AspectROI,
  targetWidth: number,
  targetHeight: number
): AnyCanvas {
  // 1. Yalnızca aktif bölgeyi (padding'leri çöpe atarak) çıkar
  const unpadded = createCompatibleCanvas(roi.activeWidth, roi.activeHeight);
  const uCtx = unpadded.getContext('2d') as AnyRenderingContext2D | null;
  if (!uCtx) return processedBoxCanvas;

  uCtx.imageSmoothingEnabled = true;
  uCtx.imageSmoothingQuality = 'high';
  uCtx.drawImage(
    processedBoxCanvas as CanvasImageSource,
    roi.padX,
    roi.padY,
    roi.activeWidth,
    roi.activeHeight,
    0,
    0,
    roi.activeWidth,
    roi.activeHeight
  );

  // 2. Orijinal hedef çözünürlüğe (önizleme veya 48MP export) kayıpsız ölçekle
  const projected = createCompatibleCanvas(targetWidth, targetHeight);
  const pCtx = projected.getContext('2d') as AnyRenderingContext2D | null;
  if (!pCtx) return unpadded;

  pCtx.imageSmoothingEnabled = true;
  pCtx.imageSmoothingQuality = 'high';
  pCtx.drawImage(unpadded as CanvasImageSource, 0, 0, targetWidth, targetHeight);

  // VRAM temizliği
  unpadded.width = 0;
  unpadded.height = 0;

  return projected;
}

/**
 * 🛡️ Hızlı 1B ayrılabilir (separable) kayan pencere (sliding-window) maske yumuşatıcı.
 * Pikseller arasındaki sert geçişleri ve gürültüleri yok ederek fotoğrafik kenar yumuşatma (feathering) sağlar.
 */
export function featherMaskAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number = 3
): Uint8ClampedArray {
  if (width <= 0 || height <= 0 || radius <= 0) return alpha;
  const size = width * height;
  const temp = new Uint8ClampedArray(size);
  const result = new Uint8ClampedArray(size);
  const r = Math.min(radius, Math.floor((width - 1) / 2));
  if (r <= 0) return alpha;

  // 1. Yatay geçiş (Horizontal pass)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;
    let count = 0;

    for (let x = -r; x <= r; x++) {
      if (x >= 0 && x < width) {
        sum += alpha[rowOffset + x];
        count++;
      }
    }
    temp[rowOffset] = Math.round(sum / count);

    for (let x = 1; x < width; x++) {
      const left = x - r - 1;
      const right = x + r;
      if (left >= 0) {
        sum -= alpha[rowOffset + left];
        count--;
      }
      if (right < width) {
        sum += alpha[rowOffset + right];
        count++;
      }
      temp[rowOffset + x] = Math.round(sum / count);
    }
  }

  // 2. Dikey geçiş (Vertical pass)
  const ry = Math.min(radius, Math.floor((height - 1) / 2));
  if (ry <= 0) return temp;

  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;

    for (let y = -ry; y <= ry; y++) {
      if (y >= 0 && y < height) {
        sum += temp[y * width + x];
        count++;
      }
    }
    result[x] = Math.round(sum / count);

    for (let y = 1; y < height; y++) {
      const top = y - ry - 1;
      const bottom = y + ry;
      if (top >= 0) {
        sum -= temp[top * width + x];
        count--;
      }
      if (bottom < height) {
        sum += temp[bottom * width + x];
        count++;
      }
      result[y * width + x] = Math.round(sum / count);
    }
  }

  return result;
}

/**
 * Görseli rotasyonunu da hesaba katarak en-boy oranını bozmadan 
 * (letterbox/pillarbox) AI işlem kutusuna yerleştirir.
 */
export function createLetterboxCanvasWithRotation(
  source: CanvasImageSource,
  targetWidth: number,
  targetHeight: number,
  rotation: RotationDegree = 0,
  boxSize: number = 512
): { canvas: AnyCanvas; ctx: AnyRenderingContext2D; roi: AspectROI } {
  const roi = computeAspectROI(targetWidth, targetHeight, boxSize);
  const canvas = createCompatibleCanvas(boxSize, boxSize);
  const ctx = canvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!ctx) throw new Error('Letterbox tuvali oluşturulamadı.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (rotation === 0) {
    ctx.drawImage(source, roi.padX, roi.padY, roi.activeWidth, roi.activeHeight);
  } else {
    ctx.save();
    ctx.translate(roi.padX + roi.activeWidth / 2, roi.padY + roi.activeHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const drawW = rotation === 90 || rotation === 270 ? roi.activeHeight : roi.activeWidth;
    const drawH = rotation === 90 || rotation === 270 ? roi.activeWidth : roi.activeHeight;
    ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  return { canvas, ctx, roi };
}

/**
 * 🛡️ En-Boy Oranı Koruma Kalkanı ile Akıllı Ten ve Özne Maskesi Üretici.
 * İnsan ten tonlarını YCbCr ve RGB kromatik düzleminde analiz eder, 
 * letterbox/unpad kalkanı ve optik kenar yumuşatma sayesinde piksel kayması olmadan maske döndürür.
 */
export function generateSkinProtectionMask(
  source: CanvasImageSource,
  targetWidth: number,
  targetHeight: number,
  rotationOrIntensity: RotationDegree | number = 0,
  boxSize: number = 512
): AnyCanvas | null {
  if (targetWidth <= 0 || targetHeight <= 0) return null;

  const rotation: RotationDegree =
    rotationOrIntensity === 90 || rotationOrIntensity === 180 || rotationOrIntensity === 270
      ? rotationOrIntensity
      : 0;

  // 1. En-boy oranını ve rotasyonu bozmadan 512px AI kutusuna al
  const { canvas: lbCanvas, ctx: lbCtx, roi } = createLetterboxCanvasWithRotation(
    source,
    targetWidth,
    targetHeight,
    rotation,
    boxSize
  );

  const imgData = lbCtx.getImageData(roi.padX, roi.padY, roi.activeWidth, roi.activeHeight);
  const data = imgData.data;

  const numPixels = roi.activeWidth * roi.activeHeight;
  const rawAlpha = new Uint8ClampedArray(numPixels);

  // Maske tamponu
  const maskImgData = lbCtx.createImageData(roi.activeWidth, roi.activeHeight);
  const maskData = maskImgData.data;

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // YCbCr ten kromatik kromotogramı (Rec. 601 / JPEG standart)
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    // Fotoğrafik ten koşulları:
    // 1. Cr (Kırmızı farkı) 130 - 180 arasında
    // 2. Cb (Mavi farkı) 76 - 134 arasında
    // 3. R kanalının üstünlüğü: r > g ve r > b (Sıcak ten çizgisi)
    // 4. Eşikler: r - g >= 3 ve r - b >= 5 (Nötr gri/beyaz nesnelerin elenmesi)
    // 5. Aydınlık sınırları: y in [20, 248]
    // 6. Doygunluk sınırları: delta in [8, 215]
    if (
      cr >= 130 &&
      cr <= 180 &&
      cb >= 76 &&
      cb <= 134 &&
      r > g &&
      r > b &&
      r - g >= 3 &&
      r - b >= 5 &&
      g >= b - 15 &&
      y >= 20 &&
      y <= 248 &&
      delta >= 8 &&
      delta <= 215
    ) {
      // Eliptik ten kümesi uzaklık modeli (Merkez: Cr 152, Cb 105)
      const u = (cr - 152) / 22;
      const v = (cb - 105) / 24;
      const distSq = u * u + v * v;

      let conf = 1.0;
      if (distSq > 1.0) {
        conf = Math.max(0, 1.0 - (distSq - 1.0) / 0.65);
      }

      // Nötr sınırlarda kademeli yumuşak geçiş
      if (r - g < 8) {
        conf *= (r - g - 2) / 6;
      }
      if (r - b < 10) {
        conf *= (r - b - 4) / 6;
      }

      rawAlpha[i] = Math.round(255 * Math.max(0, Math.min(1.0, conf)));
    } else {
      rawAlpha[i] = 0;
    }
  }

  // Kenar yumuşatma (Spatial feathering) ile saç, çene ve ten sınırlarında yumuşak geçiş
  const feathered = featherMaskAlpha(rawAlpha, roi.activeWidth, roi.activeHeight, 3);

  // Maske tamponuna yaz (RGB: 255, Alpha: yumuşatılmış değer)
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    maskData[idx] = 255;
    maskData[idx + 1] = 255;
    maskData[idx + 2] = 255;
    maskData[idx + 3] = feathered[i];
  }

  // İşlenmiş maskeyi kutuya yaz
  const maskBoxCanvas = createCompatibleCanvas(boxSize, boxSize);
  const mbCtx = maskBoxCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mbCtx) {
    lbCanvas.width = 0;
    lbCanvas.height = 0;
    return null;
  }

  mbCtx.putImageData(maskImgData, roi.padX, roi.padY);

  // 2. Unpad ve hedef tam çözünürlüğe (1:1 piksel hizasıyla) aktar
  const finalMask = unpadAndProjectMask(maskBoxCanvas, roi, targetWidth, targetHeight);

  maskBoxCanvas.width = 0;
  maskBoxCanvas.height = 0;
  lbCanvas.width = 0;
  lbCanvas.height = 0;

  return finalMask;
}

/**
 * Depth Anything V2 için giriş tensörünü (1x3x518x518, NCHW, ImageNet normalizasyonu) hazırlar.
 * En-boy oranını bozmadan 518px letterbox içine çeker.
 */
export function prepareDepthInputTensor(
  sourceCanvas: AnyCanvas,
  width: number,
  height: number,
  boxSize: number = 518
): { floatArray: Float32Array; roi: AspectROI } {
  const { canvas: lbCanvas, ctx: lbCtx, roi } = createLetterboxCanvas(
    sourceCanvas as CanvasImageSource,
    width,
    height,
    boxSize
  );

  const imgData = lbCtx.getImageData(0, 0, boxSize, boxSize);
  const data = imgData.data;
  const planeSize = boxSize * boxSize;
  const floatArray = new Float32Array(1 * 3 * planeSize);

  // ImageNet standart normalizasyonu (DPTImageProcessor)
  const meanR = 0.485, meanG = 0.456, meanB = 0.406;
  const stdR = 0.229, stdG = 0.224, stdB = 0.225;

  for (let i = 0; i < planeSize; i++) {
    const idx = i * 4;
    const r = data[idx] / 255;
    const g = data[idx + 1] / 255;
    const b = data[idx + 2] / 255;

    floatArray[i] = (r - meanR) / stdR;                       // Kanal 0 (Kırmızı)
    floatArray[planeSize + i] = (g - meanG) / stdG;            // Kanal 1 (Yeşil)
    floatArray[2 * planeSize + i] = (b - meanB) / stdB;        // Kanal 2 (Mavi)
  }

  // VRAM temizliği
  lbCanvas.width = 0;
  lbCanvas.height = 0;

  return { floatArray, roi };
}

/**
 * Modelden çıkan 518x518 ham Float32 derinlik matrisini min-max normalize eder,
 * letterbox dolgularını atar ve hedef tuval boyutuna 1:1 piksel hassasiyetiyle projekte eder.
 */
export function projectDepthMapFromRaw(
  rawDepth: Float32Array,
  roi: AspectROI,
  targetWidth: number,
  targetHeight: number,
  boxSize: number = 518
): AnyCanvas {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < rawDepth.length; i++) {
    const val = rawDepth[i];
    if (Number.isFinite(val)) {
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = 1;
  }

  const range = max - min || 1;
  const depthBoxCanvas = createCompatibleCanvas(boxSize, boxSize);
  const ctx = depthBoxCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!ctx) return depthBoxCanvas;

  const imgData = ctx.createImageData(boxSize, boxSize);
  const data = imgData.data;

  for (let i = 0; i < rawDepth.length; i++) {
    const val = rawDepth[i];
    const finiteVal = Number.isFinite(val) ? val : min;
    const norm = Math.max(0, Math.min(1.0, (finiteVal - min) / range));
    const byteVal = Math.round(norm * 255);
    const idx = i * 4;
    data[idx] = byteVal;
    data[idx + 1] = byteVal;
    data[idx + 2] = byteVal;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);

  // Kalkan üzerinden unpad ve projeksiyon
  const safeTargetW = Math.max(1, targetWidth);
  const safeTargetH = Math.max(1, targetHeight);
  const projected = unpadAndProjectMask(depthBoxCanvas, roi, safeTargetW, safeTargetH);
  depthBoxCanvas.width = 0;
  depthBoxCanvas.height = 0;

  return projected;
}

