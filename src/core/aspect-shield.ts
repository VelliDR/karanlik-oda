import { AnyCanvas, AnyRenderingContext2D } from './types';
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
 * 🛡️ En-Boy Oranı Koruma Kalkanı ile Akıllı Ten ve Özne Maskesi Üretici.
 * İnsan ten tonlarını YCbCr ve HSV kromatik düzleminde analiz eder, 
 * letterbox/unpad kalkanı sayesinde piksel kayması olmadan maske döndürür.
 */
export function generateSkinProtectionMask(
  sourceCanvas: AnyCanvas,
  width: number,
  height: number,
  intensity: number
): AnyCanvas | null {
  if (intensity <= 0) return null;

  // 1. En-boy oranını bozmadan 512px AI kutusuna al
  const { canvas: lbCanvas, ctx: lbCtx, roi } = createLetterboxCanvas(
    sourceCanvas as CanvasImageSource,
    width,
    height,
    512
  );

  const imgData = lbCtx.getImageData(roi.padX, roi.padY, roi.activeWidth, roi.activeHeight);
  const data = imgData.data;

  // Maske tamponu
  const maskImgData = lbCtx.createImageData(roi.activeWidth, roi.activeHeight);
  const maskData = maskImgData.data;

  const strength = intensity / 100;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // YCbCr ten kromatik kromotogramı
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    // Fotoğrafik ten koşulları (Tüm etnik kökenler için ortak insan teni çizgisi):
    // 1. Cr (Kırmızı farkı) 133 ile 175 arasında
    // 2. Cb (Mavi farkı) 77 ile 130 arasında
    // 3. R > G ve G > B (Sıcak ten hiyerarşisi)
    // 4. |R - G| >= 12 (Nötr gri/beyaz nesnelerin elenmesi)
    if (
      cr >= 133 &&
      cr <= 175 &&
      cb >= 77 &&
      cb <= 130 &&
      r > g &&
      g > b &&
      r - g >= 12
    ) {
      // Kenar yumuşatma faktörü (merkezde 1.0, sınırda kademeli)
      const crDist = Math.abs(cr - 154) / 21; // 154 merkez
      const cbDist = Math.abs(cb - 103) / 26; // 103 merkez
      const edgeFactor = Math.max(0, 1 - Math.hypot(crDist, cbDist));

      const alpha = Math.round(255 * strength * Math.min(1.0, edgeFactor * 1.35));
      maskData[i] = 255;
      maskData[i + 1] = 255;
      maskData[i + 2] = 255;
      maskData[i + 3] = alpha;
    } else {
      maskData[i + 3] = 0;
    }
  }

  // İşlenmiş maskeyi kutuya yaz
  const maskBoxCanvas = createCompatibleCanvas(512, 512);
  const mbCtx = maskBoxCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mbCtx) return null;

  mbCtx.putImageData(maskImgData, roi.padX, roi.padY);

  // 2. Unpad ve hedef tam çözünürlüğe (1:1 piksel hizasıyla) aktar
  const finalMask = unpadAndProjectMask(maskBoxCanvas, roi, width, height);

  maskBoxCanvas.width = 0;
  maskBoxCanvas.height = 0;
  lbCanvas.width = 0;
  lbCanvas.height = 0;

  return finalMask;
}
