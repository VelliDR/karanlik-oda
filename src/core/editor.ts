import {
  AnyCanvas,
  CubeLUT3D,
  EditorSnapshot,
  ExportFormat,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from './types';
import { PRESETS } from './presets';
import {
  createCompatibleCanvas,
  createNoisePattern
} from './optics';
import { executeRenderPipeline, drawImageWithRotation } from './pipeline/render-pipeline';
import {
  getCustomCubeLUT,
  parseCubeLUT,
  setCustomCubeLUT
} from './lut3d';
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';
import { ColorLutWebGPUEngine } from './webgpu/ColorLutWebGPUEngine';

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
import { RawMetadata } from './raw/libraw-types';
import { RawWorkerOutputMessage } from './raw/raw.worker';

export const DEFAULT_SETTINGS: SliderSettings = {
  exposure: 0,
  contrast: 0,
  shoulder: 0,
  saturation: 0,
  warmth: 0,
  preset: 'none',

  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  tint: 0,
  vibrance: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,

  halation: 0,
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

  // 📸 RAW Görsel Durumu
  private isRaw = false;
  private rawBuffer: ArrayBuffer | null = null;
  private rawMetadata: RawMetadata | null = null;

  public get isRawImage(): boolean {
    return this.isRaw;
  }

  public get currentRawMetadata(): RawMetadata | null {
    return this.rawMetadata;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = getOptimal2DContext(canvas);
    // WebGPU motorlarını arka planda erkenden hazırla
    Promise.all([
      HeliosWebGPUEngine.getOrCreate(),
      ColorLutWebGPUEngine.getOrCreate()
    ]).then(([helios, colorLut]) => {
      if ((helios || colorLut) && this.hasImage) {
        this.scheduleRender();
      }
    });
  }

  /**
   * Harici .CUBE (33x33x33 veya 65x65x65) 3D LUT dosyasını ayrıştırır ve aktif eder.
   */
  public loadCustomCubeLUT(cubeText: string, fileName?: string): CubeLUT3D {
    const cleanTitle = fileName ? fileName.replace(/\.cube$/i, '') : 'Özel .CUBE LUT';
    const lut = parseCubeLUT(cubeText, cleanTitle);
    setCustomCubeLUT(lut);
    PRESETS.custom_lut.name = lut.title.slice(0, 18);
    PRESETS.custom_lut.badge = `${lut.size}³`;
    PRESETS.custom_lut.description = `${lut.title} (${lut.size}×${lut.size}×${lut.size} Tetrahedral 3D LUT & H&D Omuz Koruması)`;
    this.settings.preset = 'custom_lut';
    if (this.settings.shoulder === 0) {
      this.settings.shoulder = PRESETS.custom_lut.defaultShoulder ?? 62;
    }
    this.scheduleRender();
    return lut;
  }

  public get hasImage(): boolean {
    return this.originalImg !== null || this.previewImg !== null || this.rawBuffer !== null;
  }

  public get originalDimensions(): { width: number; height: number } | null {
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    if (this.isRaw && this.rawMetadata) {
      return {
        width: isTransposed ? this.rawMetadata.height : this.rawMetadata.width,
        height: isTransposed ? this.rawMetadata.width : this.rawMetadata.height
      };
    }
    if (!this.originalImg && !this.previewImg) return null;
    const imgW = this.originalImg ? this.originalImg.naturalWidth : (this.previewImg as ImageBitmap).width;
    const imgH = this.originalImg ? this.originalImg.naturalHeight : (this.previewImg as ImageBitmap).height;
    return {
      width: isTransposed ? imgH : imgW,
      height: isTransposed ? imgW : imgH
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

    this.isRaw = false;
    this.rawBuffer = null;
    this.rawMetadata = null;

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

  /**
   * RAW (.dng, .cr2, .cr3, .nef, .arw, .raf vb.) dosyasını LibRaw Web Worker ile arka planda çözer.
   */
  public async loadRawFile(
    file: File,
    onProgress?: (percent: number, message: string) => void
  ): Promise<RawMetadata> {
    this.cleanupUrls();
    this.cleanupDepth();
    this.cleanupSkinMask();

    this.isRaw = true;
    const rawBuf = await file.arrayBuffer();
    this.rawBuffer = rawBuf;

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./raw/raw.worker.ts', import.meta.url), {
        type: 'module'
      });

      const cleanup = () => {
        worker.terminate();
      };

      worker.onmessage = async (e: MessageEvent<RawWorkerOutputMessage>) => {
        const data = e.data;
        if (data.type === 'progress') {
          if (onProgress) onProgress(data.percent, data.message);
        } else if (data.type === 'metadata') {
          this.rawMetadata = data.metadata;
        } else if (data.type === 'thumbnail') {
          // Gömülü JPEG önizlemesi (< 300 ms)
          try {
            if (!this.previewImg) {
              this.previewImg = await createImageBitmap(data.blob);
              this.rotation = 0;
              this.scheduleRender();
            }
          } catch {}
        } else if (data.type === 'preview_ready') {
          cleanup();
          if (this.previewImg && 'close' in this.previewImg) {
            this.previewImg.close();
          }
          this.previewImg = data.imageBitmap;
          this.rawMetadata = data.metadata;
          this.rotation = 0;
          this.resetSettings();
          this.scheduleRender();
          resolve(data.metadata);
        } else if (data.type === 'error') {
          cleanup();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        reject(err);
      };

      const transferBuf = rawBuf.slice(0);
      worker.postMessage(
        {
          type: 'decode',
          buffer: transferBuf
        },
        [transferBuf]
      );
    });
  }

  public async getRawFullResBitmap(
    onProgress?: (percent: number, message: string) => void
  ): Promise<ImageBitmap> {
    if (!this.rawBuffer) throw new Error('RAW dosya tamponu bulunamadı.');

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./raw/raw.worker.ts', import.meta.url), {
        type: 'module'
      });

      worker.onmessage = (e: MessageEvent<RawWorkerOutputMessage>) => {
        const data = e.data;
        if (data.type === 'progress') {
          if (onProgress) onProgress(data.percent, data.message);
        } else if (data.type === 'full_ready') {
          worker.terminate();
          resolve(data.imageBitmap);
        } else if (data.type === 'error') {
          worker.terminate();
          reject(new Error(data.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      const transferBuf = this.rawBuffer!.slice(0);
      worker.postMessage(
        {
          type: 'export_full',
          buffer: transferBuf
        },
        [transferBuf]
      );
    });
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
    if (!this.hasImage) {
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
    let bitmap: ImageBitmap;
    if (this.isRaw && this.rawBuffer) {
      if (onProgress) onProgress(10, 'RAW sensör verisi tam çözünürlükte demosaic ediliyor...');
      bitmap = await this.getRawFullResBitmap(onProgress);
    } else if (this.originalImg) {
      if (onProgress) onProgress(10, 'Görsel Web Worker belleğine aktarılıyor...');
      bitmap = await createImageBitmap(this.originalImg);
    } else if (this.previewImg) {
      if (onProgress) onProgress(10, 'Görsel Web Worker belleğine aktarılıyor...');
      bitmap = await createImageBitmap(this.previewImg);
    } else {
      throw new Error('Görsel bulunamadı.');
    }

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
        depthRoi: this.depthRoi,
        customLut: getCustomCubeLUT()
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
    let sourceImg: ImageBitmap | HTMLImageElement;
    let shouldCloseSource = false;

    if (this.isRaw && this.rawBuffer) {
      sourceImg = await this.getRawFullResBitmap();
      shouldCloseSource = true;
    } else if (this.originalImg) {
      sourceImg = this.originalImg;
    } else if (this.previewImg) {
      sourceImg = this.previewImg as ImageBitmap;
    } else {
      throw new Error('İşlenecek görsel bulunamadı.');
    }

    const srcW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth : sourceImg.width;
    const srcH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight : sourceImg.height;
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const targetWidth = isTransposed ? srcH : srcW;
    const targetHeight = isTransposed ? srcW : srcH;

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
      this.renderPipeline(target, sourceImg, exportSettings, this.rotation, noisePattern);

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
      if (shouldCloseSource && 'close' in sourceImg) {
        (sourceImg as ImageBitmap).close();
      }
    }
  }

  /**
   * Çekirdek banyo, mercek optiği ve 3D LUT / H&D sensitometri işleme hattı.
   *
   * Fiziksel Işık Yolu:
   * 1. Sahne & Mercek Optiği (3D DoF, Helios 44M Swirl, Chromatic Aberration, Black Pro-Mist, Mekanik Vinyet)
   * 2. Film Emülsiyonu & Taban Kırılması (650nm Spektral Kırılmalı Halasyon + Hurter & Driffield (H&D)
   *    Toe/Shoulder Karakteristik Eğrisi + 33³/65³ 3D LUT Tetrahedral Enterpolasyon)
   * 3. Kimyasal Banyo & Son Katmanlar (Bleach Bypass, Ten Kalkanı, Işık Sızıntısı, 35mm Nutting-Weibull Gren)
   */
  private renderPipeline(
    target: RenderTarget,
    sourceImg: HTMLImageElement | ImageBitmap,
    settings: SliderSettings,
    rotation: RotationDegree,
    noisePattern: CanvasPattern | null
  ): void {
    const isTransposed = rotation === 90 || rotation === 270;
    const srcW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth : sourceImg.width;
    const srcH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight : sourceImg.height;
    const w = isTransposed ? srcH : srcW;
    const h = isTransposed ? srcW : srcH;

    const skinMask =
      settings.skinProtection > 0
        ? this.getOrCreateSkinMask(sourceImg, rotation, w, h)
        : null;

    executeRenderPipeline({
      target,
      sourceImg,
      settings,
      rotation,
      noisePattern,
      depthCanvas: this.depthCanvas,
      skinMask
    });
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
    drawImageWithRotation(target, sourceImg, rotation);
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
    this.rawBuffer = null;
    this.rawMetadata = null;
    this.isRaw = false;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

}
