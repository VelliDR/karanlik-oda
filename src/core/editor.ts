import {
  AnyCanvas,
  EditorSnapshot,
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
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';

import {
  AspectROI,
  generateSkinProtectionMask,
  prepareDepthInputTensor,
  projectDepthMapFromRaw
} from './aspect-shield';
import {
  calculatePrintDimensions,
  extractJpegMetadataSegments,
  inject300DpiAndExifToJpeg,
  inject300DpiToPng,
  PrintDimensions
} from './metadata';
import { analyzeAndRecommendRecipe, SmartRecipeSuggestion } from './smart-recipe';

export const DEFAULT_SETTINGS: SliderSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  preset: 'none',

  grain: 0,
  lightLeak: 0,
  bleachBypass: 0,
  skinProtection: 0,

  swirl: 0,
  chromatic: 0,
  proMist: 0,
  vignette: 0,

  aiDepthEnabled: false,
  aiDepthAperture: 50,
  aiFocalDepth: 0.5,
  aiShowDepthMap: false,

  quartzDate: false,
  quartzDateText: "'98 10 24",
  filmBorder: 'none',
  exportFormat: 'image/png', // Varsayılan %100 kayıpsız format
  exportQuality: 1.0         // %100 maksimum kalite
};

function getOptimal2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const isP3Supported =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(color-gamut: p3)').matches;

  if (isP3Supported) {
    try {
      const p3Ctx = canvas.getContext('2d', {
        colorSpace: 'display-p3'
      });
      if (p3Ctx) return p3Ctx;
    } catch {
      // P3 desteklenmiyorsa sRGB'ye devam et
    }
  }

  const srgbCtx = canvas.getContext('2d');
  if (!srgbCtx) {
    throw new Error('Canvas 2D bağlamı oluşturulamadı.');
  }
  return srgbCtx;
}

export class PhotoEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private originalImg: HTMLImageElement | null = null;
  private previewImg: HTMLImageElement | ImageBitmap | null = null;
  private currentObjectUrl: string | null = null;
  private previewObjectUrl: string | null = null;
  private originalMetadataSegments: Uint8Array[] = [];

  public settings: SliderSettings = { ...DEFAULT_SETTINGS };
  public rotation: RotationDegree = 0;
  public isComparingOriginal = false;

  private isRenderPending = false;
  private noisePattern: CanvasPattern | null = null;

  // 🤖 3D Alan Derinliği & Depth Anything V2 Durumları
  private depthWorker: Worker | null = null;
  private depthRaw: Float32Array | null = null;
  private depthRoi: AspectROI | null = null;
  private depthCanvas: AnyCanvas | null = null;
  private currentDepthJobId = 0;
  public isDepthAnalyzing = false;
  public depthStatusMessage = '';
  public depthProgress = 0;

  // 🛡️ Akıllı Ten Koruma Kalkanı Önbelleği
  private skinMaskCanvas: AnyCanvas | null = null;
  private skinMaskRotation: RotationDegree | null = null;
  private skinMaskTargetWidth = 0;
  private skinMaskTargetHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = getOptimal2DContext(canvas);
    // WebGPU motorunu arka planda erkenden hazırla
    HeliosWebGPUEngine.getOrCreate();
  }


  public get hasImage(): boolean {
    return this.originalImg !== null;
  }

  public get originalDimensions(): { width: number; height: number } | null {
    if (!this.originalImg) return null;
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    return {
      width: isTransposed ? this.originalImg.naturalHeight : this.originalImg.naturalWidth,
      height: isTransposed ? this.originalImg.naturalWidth : this.originalImg.naturalHeight
    };
  }

  /**
   * 300 DPI baskı boyutlarını (cm, inç, megapiksel) döndürür.
   */
  public get printDimensions(): PrintDimensions | null {
    const dims = this.originalDimensions;
    if (!dims) return null;
    return calculatePrintDimensions(dims.width, dims.height, 300);
  }

  /**
   * Sıfır kopyalı Blob/File nesnesini yükler, metaverilerini ayıklar ve kayıpsız net önizleme oluşturur.
   */
  public async loadImageFromBlob(blob: Blob): Promise<void> {
    this.cleanupUrls();
    this.cleanupDepth();
    this.cleanupSkinMask();

    // 1. Orijinal dosyanın EXIF ve ICC profil segmentlerini koruma için çıkar
    try {
      const buffer = await blob.arrayBuffer();
      this.originalMetadataSegments = extractJpegMetadataSegments(buffer);
    } catch {
      this.originalMetadataSegments = [];
    }

    // 2. Tam çözünürlüklü görseli yükle
    this.currentObjectUrl = URL.createObjectURL(blob);
    const img = await this.loadImageElement(this.currentObjectUrl);
    this.originalImg = img;

    // 3. Akıcı ve kayıpsız 1600px önizleme görseli oluştur (JPEG bloklanması olmadan)
    const maxDim = 1600;
    let pw = img.naturalWidth;
    let ph = img.naturalHeight;

    if (pw > maxDim || ph > maxDim) {
      if (pw > ph) {
        ph = Math.round((ph * maxDim) / pw);
        pw = maxDim;
      } else {
        pw = Math.round((pw * maxDim) / ph);
        ph = maxDim;
      }
    }

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = pw;
    previewCanvas.height = ph;
    const pCtx = getOptimal2DContext(previewCanvas);
    pCtx.imageSmoothingEnabled = true;
    pCtx.imageSmoothingQuality = 'high';
    pCtx.drawImage(img, 0, 0, pw, ph);

    // Önizleme görselini çift kod çözme gecikmesi olmadan doğrudan GPU dokusu (ImageBitmap) olarak al
    if (this.previewImg && 'close' in this.previewImg) {
      this.previewImg.close();
    }
    this.previewImg = await createImageBitmap(previewCanvas);

    previewCanvas.width = 0;
    previewCanvas.height = 0;

    this.rotation = 0;
    this.resetSettings();
    this.scheduleRender();
  }


  private loadImageElement(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Görsel çözümlenemedi.'));
      img.src = url;
    });
  }

  public resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  public rotateClockwise(): void {
    if (!this.hasImage) return;
    this.rotation = ((this.rotation + 90) % 360) as RotationDegree;
    this.cleanupSkinMask();
    this.rotateDepthCanvasClockwise();
    this.scheduleRender();
  }

  private rotateDepthCanvasClockwise(): void {
    if (!this.depthCanvas) return;
    const oldW = this.depthCanvas.width;
    const oldH = this.depthCanvas.height;
    if (oldW <= 0 || oldH <= 0) return;

    const newCanvas = createCompatibleCanvas(oldH, oldW);
    const nCtx = newCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!nCtx) return;

    nCtx.translate(oldH / 2, oldW / 2);
    nCtx.rotate(Math.PI / 2);
    nCtx.drawImage(this.depthCanvas as CanvasImageSource, -oldW / 2, -oldH / 2);

    this.depthCanvas.width = 0;
    this.depthCanvas.height = 0;
    this.depthCanvas = newCanvas;
  }

  public setComparing(comparing: boolean): void {
    if (this.isComparingOriginal === comparing) return;
    this.isComparingOriginal = comparing;
    this.scheduleRender();
  }

  public getSnapshot(): EditorSnapshot {
    return {
      settings: { ...this.settings },
      rotation: this.rotation
    };
  }

  public applySnapshot(snapshot: EditorSnapshot): void {
    const rotationDelta = ((snapshot.rotation - this.rotation + 360) % 360) as RotationDegree;
    this.settings = { ...snapshot.settings };
    this.rotation = snapshot.rotation;

    if (this.depthCanvas && rotationDelta !== 0) {
      const turns = rotationDelta / 90;
      for (let i = 0; i < turns; i++) {
        this.rotateDepthCanvasClockwise();
      }
    }

    this.scheduleRender();
  }

  /**
   * Derinlik haritasının hazır olup olmadığını bildirir.
   */
  public get hasDepthMap(): boolean {
    return this.depthCanvas !== null;
  }

  /**
   * 🤖 Depth Anything V2 modelini Web Worker üzerinden izole çalıştırır.
   * Model indirme ilerlemesini ve tensör hesaplamasını yönetir.
   */
  public async analyzeDepth(
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    if (!this.previewImg && !this.originalImg) return;
    if (this.isDepthAnalyzing) return;

    const jobId = ++this.currentDepthJobId;
    this.isDepthAnalyzing = true;
    this.depthProgress = 0;
    this.depthStatusMessage = 'AI tensörü hazırlanıyor...';
    if (onProgress) onProgress(0, this.depthStatusMessage);

    const sourceImg = this.previewImg || this.originalImg!;
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const srcW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth : sourceImg.width;
    const srcH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight : sourceImg.height;
    const w = isTransposed ? srcH : srcW;
    const h = isTransposed ? srcW : srcH;

    const sourceCanvas = createCompatibleCanvas(w, h);
    const sCtx = sourceCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!sCtx) {
      this.isDepthAnalyzing = false;
      return;
    }

    if (this.rotation !== 0) {
      sCtx.translate(w / 2, h / 2);
      sCtx.rotate((this.rotation * Math.PI) / 180);
      sCtx.drawImage(
        sourceImg,
        -srcW / 2,
        -srcH / 2
      );
    } else {
      sCtx.drawImage(sourceImg, 0, 0);
    }


    const { floatArray, roi } = prepareDepthInputTensor(sourceCanvas, w, h, 518);
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;

    return new Promise((resolve, reject) => {
      if (!this.depthWorker) {
        this.depthWorker = new Worker(new URL('./depth.worker.ts', import.meta.url), {
          type: 'module'
        });
      }

      const worker = this.depthWorker;

      const cleanupListeners = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
      };

      const handleError = (errEvent: ErrorEvent) => {
        cleanupListeners();
        if (this.currentDepthJobId !== jobId) return;
        this.isDepthAnalyzing = false;
        this.depthStatusMessage = errEvent.message || 'Worker hatası oluştu.';
        if (onProgress) onProgress(0, this.depthStatusMessage);
        reject(new Error(this.depthStatusMessage));
      };

      const handleMessage = (e: MessageEvent) => {
        if (this.currentDepthJobId !== jobId) {
          cleanupListeners();
          return;
        }

        const data = e.data || {};
        if (data.type === 'download-progress') {
          this.depthProgress = data.percent;
          this.depthStatusMessage = `Model indiriliyor (%${data.percent})...`;
          if (onProgress) onProgress(data.percent, this.depthStatusMessage);
        } else if (data.type === 'status') {
          this.depthStatusMessage = data.message;
          if (onProgress) onProgress(this.depthProgress, data.message);
        } else if (data.type === 'success') {
          cleanupListeners();
          this.depthRaw = data.rawDepth;
          this.depthRoi = roi;
          this.depthCanvas = projectDepthMapFromRaw(this.depthRaw!, roi, w, h, 518);
          this.isDepthAnalyzing = false;
          this.depthProgress = 100;
          this.depthStatusMessage = '3D Alan Derinliği Aktif';
          if (onProgress) onProgress(100, this.depthStatusMessage);
          this.render();
          resolve();
        } else if (data.type === 'error') {
          cleanupListeners();
          this.isDepthAnalyzing = false;
          this.depthStatusMessage = data.message;
          if (onProgress) onProgress(0, data.message);
          reject(new Error(data.message));
        }
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage({ type: 'run', floatArray }, [floatArray.buffer]);
    });
  }

  /**
   * Tuval üzerinde tıklanan koordinattaki (0.0 - 1.0 aralığında) derinlik değerini döndürür.
   */
  public sampleDepthAt(normalizedX: number, normalizedY: number): number {
    if (!this.depthCanvas) return 0.5;
    const w = this.depthCanvas.width;
    const h = this.depthCanvas.height;
    if (w <= 0 || h <= 0) return 0.5;

    const clampedNormX = Math.max(0, Math.min(1.0, normalizedX));
    const clampedNormY = Math.max(0, Math.min(1.0, normalizedY));

    const x = Math.min(w - 1, Math.max(0, Math.floor(clampedNormX * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(clampedNormY * h)));

    const ctx = this.depthCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return 0.5;

    try {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const sampled = pixel[0] / 255;
      return Number.isFinite(sampled) ? Math.max(0, Math.min(1.0, sampled)) : 0.5;
    } catch {
      return 0.5;
    }
  }

  public async setAiDepthEnabled(
    enabled: boolean,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    this.settings.aiDepthEnabled = enabled;
    if (!enabled) {
      if (this.isDepthAnalyzing) {
        this.currentDepthJobId++;
        this.isDepthAnalyzing = false;
        if (this.depthWorker) {
          this.depthWorker.terminate();
          this.depthWorker = null;
        }
      }
      this.render();
      return;
    }

    if (!this.depthCanvas && (this.previewImg || this.originalImg)) {
      await this.analyzeDepth(onProgress);
    } else {
      this.render();
    }
  }

  public setAiDepthAperture(val: number): void {
    this.settings.aiDepthAperture = Math.max(0, Math.min(100, val));
    this.render();
  }

  public setAiFocalDepth(val: number): void {
    this.settings.aiFocalDepth = Math.max(0, Math.min(1.0, val));
    this.render();
  }

  public setAiShowDepthMap(show: boolean): void {
    this.settings.aiShowDepthMap = show;
    this.render();
  }

  /**
   * 🤖 Fotoğrafın ışık, kontrast, renk sıcaklığı ve ten pigmentlerini analiz ederek
   * en uygun analog film reçetesini ve ince slider ayarlarını önerir.
   */
  public getSmartRecipeSuggestion(): SmartRecipeSuggestion | null {
    if (!this.previewImg && !this.originalImg) return null;

    const sourceImg = this.previewImg || this.originalImg!;
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const srcW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth : sourceImg.width;
    const srcH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight : sourceImg.height;
    const w = isTransposed ? srcH : srcW;
    const h = isTransposed ? srcW : srcH;

    const sourceCanvas = createCompatibleCanvas(w, h);
    const sCtx = sourceCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!sCtx) return null;

    if (this.rotation !== 0) {
      sCtx.translate(w / 2, h / 2);
      sCtx.rotate((this.rotation * Math.PI) / 180);
      sCtx.drawImage(
        sourceImg,
        -srcW / 2,
        -srcH / 2
      );
    } else {
      sCtx.drawImage(sourceImg, 0, 0);
    }


    const suggestion = analyzeAndRecommendRecipe(sourceCanvas, w, h, this.depthCanvas);
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;

    return suggestion;
  }

  public applySmartRecipe(suggestion: SmartRecipeSuggestion): void {
    this.settings = {
      ...this.settings,
      ...suggestion.sliderTweaks,
      aiShowDepthMap: false
    };
    this.scheduleRender();
  }

  public scheduleRender(): void {
    if (this.isRenderPending) return;
    this.isRenderPending = true;

    requestAnimationFrame(() => {
      this.isRenderPending = false;
      this.render();
    });
  }

  public render(): void {
    if (!this.previewImg) return;

    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const srcW = 'naturalWidth' in this.previewImg ? this.previewImg.naturalWidth : this.previewImg.width;
    const srcH = 'naturalHeight' in this.previewImg ? this.previewImg.naturalHeight : this.previewImg.height;
    const targetWidth = isTransposed ? srcH : srcW;
    const targetHeight = isTransposed ? srcW : srcH;


    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this.noisePattern = createNoisePattern(this.ctx);
    }

    if (!this.noisePattern) {
      this.noisePattern = createNoisePattern(this.ctx);
    }

    const target: RenderTarget = {
      canvas: this.canvas,
      ctx: this.ctx,
      width: targetWidth,
      height: targetHeight
    };

    if (this.isComparingOriginal) {
      this.renderRawImage(target, this.previewImg, this.rotation);
      this.drawComparingWatermark(target);
      return;
    }

    this.renderPipeline(target, this.previewImg, this.settings, this.rotation, this.noisePattern);
  }

  /**
   * Tam çözünürlüklü, 300 DPI onaylı ve EXIF korumalı dışa aktarma.
   * Web Worker + OffscreenCanvas destekleniyorsa arayüzü dondurmadan arka planda çalıştırır.
   */
  public async exportHighRes(
    customFormat?: ExportFormat,
    customQuality?: number,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ blob: Blob; extension: string; mimeType: string }> {
    if (!this.originalImg) {
      throw new Error('İşlenecek görsel bulunamadı.');
    }

    const format = customFormat || this.settings.exportFormat;
    const quality = customQuality !== undefined ? customQuality : this.settings.exportQuality;

    // 1. Web Worker & OffscreenCanvas ile arka planda çalıştır (Arayüz 0ms bile donmaz)
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        return await this.exportWithWebWorker(format, quality, onProgress);
      } catch (workerError) {
        console.warn('Web Worker banyosu başarısız oldu, ana iş parçacığına dönülüyor:', workerError);
      }
    }

    // 2. Yedek: Ana iş parçacığında çalıştır (Fallback)
    return this.exportOnMainThread(format, quality);
  }

  private async exportWithWebWorker(
    format: ExportFormat,
    quality: number,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ blob: Blob; extension: string; mimeType: string }> {
    if (!this.originalImg) throw new Error('Görsel bulunamadı.');

    if (onProgress) onProgress(10, 'Görsel Web Worker belleğine aktarılıyor...');
    const bitmap = await createImageBitmap(this.originalImg);
    const depthBitmap = this.depthCanvas
      ? await createImageBitmap(this.depthCanvas as CanvasImageSource)
      : null;

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./export.worker.ts', import.meta.url), {
        type: 'module'
      });

      worker.onmessage = (e: MessageEvent<any>) => {
        const data = e.data;
        if (data.type === 'progress') {
          if (onProgress) onProgress(data.percent, data.message);
        } else if (data.type === 'success') {
          worker.terminate();
          resolve({
            blob: data.blob,
            extension: data.extension,
            mimeType: data.mimeType
          });
        } else if (data.type === 'error') {
          worker.terminate();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      const payload = {
        imageBitmap: bitmap,
        settings: { ...this.settings, aiShowDepthMap: false },
        rotation: this.rotation,
        format,
        quality,
        originalMetadataSegments: this.originalMetadataSegments,
        dpi: 300,
        depthBitmap,
        rawDepth: this.depthRaw ? this.depthRaw.slice(0) : null,
        depthRoi: this.depthRoi
      };

      // bitmap ve derinlik bitmap nesnelerini transfer et (zero-copy memory transfer!)
      const transferList: Transferable[] = [bitmap];
      if (depthBitmap) {
        transferList.push(depthBitmap);
      }
      worker.postMessage(payload, transferList);
    });
  }

  private async exportOnMainThread(
    format: ExportFormat,
    quality: number
  ): Promise<{ blob: Blob; extension: string; mimeType: string }> {
    if (!this.originalImg) {
      throw new Error('İşlenecek görsel bulunamadı.');
    }

    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const targetWidth = isTransposed ? this.originalImg.naturalHeight : this.originalImg.naturalWidth;
    const targetHeight = isTransposed ? this.originalImg.naturalWidth : this.originalImg.naturalHeight;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;
    const exportCtx = getOptimal2DContext(exportCanvas);

    const noisePattern = createNoisePattern(exportCtx);
    const target: RenderTarget = {
      canvas: exportCanvas,
      ctx: exportCtx,
      width: targetWidth,
      height: targetHeight
    };

    const exportSettings: SliderSettings = {
      ...this.settings,
      aiShowDepthMap: false
    };

    try {
      this.renderPipeline(target, this.originalImg, exportSettings, this.rotation, noisePattern);

      let blob = await new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Görsel Blob oluşturulamadı.'));
          },
          format,
          quality
        );
      });

      // 300 DPI ve Metaveri Enjeksiyonu
      if (format === 'image/jpeg') {
        blob = await inject300DpiAndExifToJpeg(blob, this.originalMetadataSegments, 300);
      } else if (format === 'image/png') {
        blob = await inject300DpiToPng(blob, 300);
      }

      const extensionMap: Record<ExportFormat, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp'
      };

      return {
        blob,
        extension: extensionMap[format] || 'png',
        mimeType: format
      };
    } finally {
      exportCanvas.width = 0;
      exportCanvas.height = 0;
    }
  }

  /**
   * Çekirdek banyo ve optik işleme hattı.
   */
  private renderPipeline(
    target: RenderTarget,
    sourceImg: HTMLImageElement | ImageBitmap,
    settings: SliderSettings,
    rotation: RotationDegree,
    noisePattern: CanvasPattern | null
  ): void {
    const { ctx, width: w, height: h } = target;
    ctx.clearRect(0, 0, w, h);

    // 👁️ 3D Derinlik Haritası İnceleme Modu (Siyah-Beyaz)
    if (settings.aiShowDepthMap && this.depthCanvas) {
      ctx.drawImage(this.depthCanvas as CanvasImageSource, 0, 0, w, h);
      return;
    }

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
    this.drawImageWithRotation(target, sourceImg, rotation);
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

    // Preset Renk Örtüsü (Overlay & Split-Toning)
    if (preset.overlayColor && preset.overlayOpacity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = preset.blendMode;
      ctx.globalAlpha = preset.overlayOpacity;
      ctx.fillStyle = preset.overlayColor;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Bleach Bypass (Gümüş Koruma Banyosu)
    if (settings.bleachBypass > 0) {
      applyBleachBypass(target, settings.bleachBypass);
    }

    // 🛡️ AKILLI EN-BOY ORANI KORUMALI TEN KALKANI (Skin Tone Protection Shield)
    if (settings.skinProtection > 0) {
      this.applySkinToneProtection(target, sourceImg, rotation, settings, preset);
    }

    // Black Pro-Mist (Yumuşak Sisli Parlama & Gölge Koruması)
    if (settings.proMist > 0) {
      applyBlackProMist(target, settings.proMist);
    }

    // Helios 44M Swirl Bokeh (Kedi Gözü & 3D Derinlik Koruması)
    if (settings.swirl > 0) {
      applySwirlyBokeh(
        target,
        settings.swirl,
        settings.aiDepthEnabled ? this.depthCanvas : null,
        settings.aiFocalDepth,
        settings.aiDepthAperture
      );
    }

    // Radyal Chromatic Aberration (Merkez Netliği Koruması)
    if (settings.chromatic > 0) {
      applyChromaticAberration(target, settings.chromatic);
    }

    // CCD Estetiği veya Klasik Analog Film Banyo Zinciri
    const isCcd = settings.preset === 'ccd' || settings.preset === 'ccd_y2k';
    if (isCcd) {
      if (settings.lightLeak > 0) {
        applyLightLeak(target, settings.lightLeak);
      }
      applyCcdAesthetic(target, { mode: settings.preset as 'ccd' | 'ccd_y2k' });

      if (settings.vignette > 0) {
        applyVignette(target, settings.vignette);
      }
      // CCD presetlerinde analog film greni ve halasyon tamamen atlanır (Bypass Kuralı)
    } else {
      // CineStill 800T Çift Loblu Halasyon
      if (settings.preset === 'cinestill') {
        applyHalation(target);
      }

      // Işık Sızıntısı (Light Leak)
      if (settings.lightLeak > 0) {
        applyLightLeak(target, settings.lightLeak);
      }

      // Mekanik Vinyet: Optik kusur olduğu için daima grenden ÖNCE uygulanmalıdır
      if (settings.vignette > 0) {
        applyVignette(target, settings.vignette);
      }

      // 35mm Analog Film Greni: Çerçeve ve tarih damgasından önceki mutlak son katman
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

  private drawImageWithRotation(
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

  private applySkinToneProtection(
    target: RenderTarget,
    sourceImg: HTMLImageElement | ImageBitmap,
    rotation: RotationDegree,
    settings: SliderSettings,
    preset: PresetDefinition
  ): void {
    const { ctx, width: w, height: h } = target;
    const skinMask = this.getOrCreateSkinMask(sourceImg, rotation, w, h);
    if (!skinMask) return;

    const exp = 100 + settings.exposure;
    const cleanSkinCanvas = createCompatibleCanvas(w, h);
    const sCtx = cleanSkinCanvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!sCtx) return;

    // Ten tonu filtresi: Aşırı kontrast, yapay renk kayması ve soğukluktan arındırılmış saf ten
    const skinFilter =
      preset.id === 'sb'
        ? `grayscale(100%) brightness(${exp}%) contrast(${Math.round(100 + settings.contrast * 0.35)}%)`
        : `brightness(${exp}%) contrast(${Math.round(100 + settings.contrast * 0.35)}%) saturate(${Math.max(90, Math.min(115, 100 + settings.saturation * 0.35))}%)`;

    sCtx.save();
    sCtx.filter = skinFilter;
    this.drawImageWithRotation({ ctx: sCtx, width: w, height: h, canvas: cleanSkinCanvas }, sourceImg, rotation);
    sCtx.filter = 'none';
    sCtx.restore();

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
  }

  private getOrCreateSkinMask(
    sourceImg: HTMLImageElement | ImageBitmap,
    rotation: RotationDegree,
    width: number,
    height: number
  ): AnyCanvas | null {
    if (
      this.skinMaskCanvas &&
      this.skinMaskRotation === rotation &&
      this.skinMaskTargetWidth === width &&
      this.skinMaskTargetHeight === height
    ) {
      return this.skinMaskCanvas;
    }

    this.cleanupSkinMask();

    const mask = generateSkinProtectionMask(sourceImg, width, height, rotation, 512);
    if (mask) {
      this.skinMaskCanvas = mask;
      this.skinMaskRotation = rotation;
      this.skinMaskTargetWidth = width;
      this.skinMaskTargetHeight = height;
    }
    return mask;
  }

  private cleanupSkinMask(): void {
    if (this.skinMaskCanvas) {
      this.skinMaskCanvas.width = 0;
      this.skinMaskCanvas.height = 0;
      this.skinMaskCanvas = null;
    }
    this.skinMaskRotation = null;
    this.skinMaskTargetWidth = 0;
    this.skinMaskTargetHeight = 0;
  }

  private renderRawImage(
    target: RenderTarget,
    sourceImg: HTMLImageElement | ImageBitmap,
    rotation: RotationDegree
  ): void {

    const { ctx, width: w, height: h } = target;
    ctx.clearRect(0, 0, w, h);
    this.drawImageWithRotation(target, sourceImg, rotation);
  }

  private drawComparingWatermark(target: RenderTarget): void {
    const { ctx } = target;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(16, 16, 120, 32);
    ctx.strokeStyle = '#FF8A80';
    ctx.lineWidth = 1;
    ctx.strokeRect(16, 16, 120, 32);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('ORİJİNAL', 38, 36);
    ctx.restore();
  }

  private cleanupUrls(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
  }

  private cleanupDepth(): void {
    this.currentDepthJobId++;
    this.isDepthAnalyzing = false;
    this.depthRaw = null;
    this.depthRoi = null;
    if (this.depthCanvas) {
      this.depthCanvas.width = 0;
      this.depthCanvas.height = 0;
      this.depthCanvas = null;
    }
    if (this.depthWorker) {
      this.depthWorker.terminate();
      this.depthWorker = null;
    }
  }

  public destroy(): void {
    this.cleanupUrls();
    this.cleanupDepth();
    this.cleanupSkinMask();
    if (this.depthWorker) {
      this.depthWorker.terminate();
      this.depthWorker = null;
    }
    this.originalImg = null;
    if (this.previewImg && 'close' in this.previewImg) {
      this.previewImg.close();
    }
    this.previewImg = null;
    this.originalMetadataSegments = [];
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

}
