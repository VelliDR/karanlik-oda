import {
  AnyCanvas,
  CubeLUT3D,
  DodgeBurnMap,
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
import {
  applyDodgeBurnBrushDab,
  applyDodgeBurnStrokeSegment,
  BrushDabOptions,
  cloneDodgeBurnMap,
  createDodgeBurnMap,
  hasActiveDodgeBurnData,
  rotateDodgeBurnMapClockwise
} from './paper/dodge-burn';
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';
import { ColorLutWebGPUEngine } from './webgpu/ColorLutWebGPUEngine';
import { PaperPrintWebGPUEngine } from './webgpu/PaperPrintWebGPUEngine';

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
  soapBubble: 0,
  loca: 0,
  apertureBlades: 0,
  bladeCurvature: 85,
  chromatic: 0,
  proMist: 0,
  vignette: 0,

  aiDepthEnabled: false,
  aiDepthAperture: 50,
  aiFocalDepth: 0.5,
  aiShowDepthMap: false,

  printEnabled: false,
  printExposure: 0,
  printGrade: 2.0,
  printSplitGrade: false,
  printSplitRatio: 0.5,
  printPaperType: 'rc-glossy',
  printPaperTone: 0,
  printSelenium: 0,
  printSepia: 0,

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

  // 🖨️ Faz 1 Kağıda Baskı: 1/4 Çözünürlüklü Dodge & Burn Poz Haritası
  private dodgeBurnMap: DodgeBurnMap | null = null;

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
      ColorLutWebGPUEngine.getOrCreate(),
      PaperPrintWebGPUEngine.getOrCreate()
    ]).then(([helios, colorLut, paperPrint]) => {
      if ((helios || colorLut || paperPrint) && this.hasImage) {
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
    this.dodgeBurnMap = null;

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
    this.dodgeBurnMap = null;

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
    this.dodgeBurnMap = null;
  }

  public rotateClockwise(): void {
    if (!this.hasImage) return;
    this.rotation = ((this.rotation + 90) % 360) as RotationDegree;
    this.cleanupSkinMask();
    this.rotateDepthCanvasClockwise();
    if (this.dodgeBurnMap) {
      this.dodgeBurnMap = rotateDodgeBurnMapClockwise(this.dodgeBurnMap);
    }
    this.scheduleRender();
  }

  private getCurrentPreviewDimensions(): { width: number; height: number } | null {
    const source = this.previewImg || this.originalImg;
    if (!source) return null;
    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height;
    return {
      width: isTransposed ? srcH : srcW,
      height: isTransposed ? srcW : srcH
    };
  }

  private ensureDodgeBurnMap(): DodgeBurnMap | null {
    const dims = this.getCurrentPreviewDimensions();
    if (!dims || dims.width <= 0 || dims.height <= 0) return null;
    if (!this.dodgeBurnMap) {
      this.dodgeBurnMap = createDodgeBurnMap(dims.width, dims.height);
    }
    return this.dodgeBurnMap;
  }

  public getDodgeBurnMap(): DodgeBurnMap | null {
    return this.dodgeBurnMap;
  }

  public get hasDodgeBurnChanges(): boolean {
    return hasActiveDodgeBurnData(this.dodgeBurnMap);
  }

  public paintDodgeBurnDab(opts: BrushDabOptions): void {
    const map = this.ensureDodgeBurnMap();
    if (!map) return;
    applyDodgeBurnBrushDab(map, opts);
    this.scheduleRender();
  }

  public paintDodgeBurnSegment(
    fromNormX: number,
    fromNormY: number,
    toNormX: number,
    toNormY: number,
    opts: Omit<BrushDabOptions, 'normX' | 'normY'>
  ): void {
    const map = this.ensureDodgeBurnMap();
    if (!map) return;
    applyDodgeBurnStrokeSegment(map, fromNormX, fromNormY, toNormX, toNormY, opts);
    this.scheduleRender();
  }

  public clearDodgeBurnMap(): void {
    if (!this.dodgeBurnMap) return;
    this.dodgeBurnMap = null;
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
      rotation: this.rotation,
      dodgeBurnMap: cloneDodgeBurnMap(this.dodgeBurnMap)
    };
  }

  public applySnapshot(snapshot: EditorSnapshot): void {
    const rotationDelta = ((snapshot.rotation - this.rotation + 360) % 360) as RotationDegree;
    this.settings = { ...snapshot.settings };
    this.rotation = snapshot.rotation;
    this.dodgeBurnMap = cloneDodgeBurnMap(snapshot.dodgeBurnMap ?? null);

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

          // 🎯 Akıllı Otomatik Odak: Eğer odak henüz varsayılan 0.5 ise,
          // sahnedeki ana özneyi (portre / nesne) otomatik tespit et ve kilitlen
          if (this.settings.aiFocalDepth === 0.5) {
            const detectedZ = this.detectPrimarySubjectDepth();
            this.settings.aiFocalDepth = detectedZ;
          }

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
   * 7x7 Bilateral Gauss uzamsal çekirdeği ile sınır artefaktlarını ve tek piksel gürültülerini filtreler.
   */
  public sampleDepthAt(normalizedX: number, normalizedY: number): number {
    if (!this.depthCanvas) return 0.5;
    const w = this.depthCanvas.width;
    const h = this.depthCanvas.height;
    if (w <= 0 || h <= 0) return 0.5;

    const clampedNormX = Math.max(0, Math.min(1.0, normalizedX));
    const clampedNormY = Math.max(0, Math.min(1.0, normalizedY));

    const cx = Math.min(w - 1, Math.max(0, Math.floor(clampedNormX * w)));
    const cy = Math.min(h - 1, Math.max(0, Math.floor(clampedNormY * h)));

    const ctx = this.depthCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return 0.5;

    try {
      const radius = 3; // 7x7 pencere
      const startX = Math.max(0, cx - radius);
      const startY = Math.max(0, cy - radius);
      const endX = Math.min(w - 1, cx + radius);
      const endY = Math.min(h - 1, cy + radius);
      const boxW = endX - startX + 1;
      const boxH = endY - startY + 1;

      const imgData = ctx.getImageData(startX, startY, boxW, boxH).data;
      const centerIdx = ((cy - startY) * boxW + (cx - startX)) * 4;
      const centerZ = imgData[centerIdx] / 255;

      let sumWeight = 0;
      let sumDepth = 0;

      for (let py = 0; py < boxH; py++) {
        for (let px = 0; px < boxW; px++) {
          const curX = startX + px;
          const curY = startY + py;
          const dx = curX - cx;
          const dy = curY - cy;
          const d2 = dx * dx + dy * dy;

          // Uzamsal Gauss ağırlığı (sigma ~ 1.8)
          const spatialWeight = Math.exp(-d2 / 6.48);

          const idx = (py * boxW + px) * 4;
          const sampleZ = imgData[idx] / 255;

          // Bilateral menzil ağırlığı: Keskin kenarlarda arka planın ön plana sızmasını engeller
          const zDiff = sampleZ - centerZ;
          const rangeWeight = Math.exp(-(zDiff * zDiff) / 0.045);

          const totalWeight = spatialWeight * rangeWeight;
          sumDepth += sampleZ * totalWeight;
          sumWeight += totalWeight;
        }
      }

      const robustZ = sumWeight > 0.001 ? sumDepth / sumWeight : centerZ;
      return Number.isFinite(robustZ) ? Math.max(0, Math.min(1.0, robustZ)) : 0.5;
    } catch {
      return 0.5;
    }
  }

  /**
   * 🤖 Sahnedeki birincil öznenin (portre / insan / ön plan objesi) derinlik katmanını tespit eder.
   * Merkez ağırlıklı histogram analizi ile ana nesnenin odak düzlemini bulur.
   */
  public detectPrimarySubjectDepth(): number {
    if (!this.depthCanvas) return 0.5;
    const w = this.depthCanvas.width;
    const h = this.depthCanvas.height;
    if (w <= 0 || h <= 0) return 0.5;

    const ctx = this.depthCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return 0.5;

    try {
      // Merkezin %60'lık alanını tara (kenar vinyetlerini ve boş arka planı eler)
      const minX = Math.floor(w * 0.20);
      const maxX = Math.floor(w * 0.80);
      const minY = Math.floor(h * 0.15);
      const maxY = Math.floor(h * 0.85);
      const regionW = maxX - minX;
      const regionH = maxY - minY;

      const imgData = ctx.getImageData(minX, minY, regionW, regionH).data;

      // 32-kutu derinlik histogramı
      const BINS = 32;
      const hist = new Float32Array(BINS);

      const midX = regionW / 2;
      const midY = regionH / 2;

      // Performans için her 3 pikselde bir örnekle
      const step = Math.max(1, Math.floor(Math.min(regionW, regionH) / 120));

      for (let y = 0; y < regionH; y += step) {
        for (let x = 0; x < regionW; x += step) {
          const idx = (y * regionW + x) * 4;
          const z = imgData[idx] / 255;

          // Merkeze yakın piksellere hafif ilave öncelik
          const ndx = (x - midX) / midX;
          const ndy = (y - midY) / midY;
          const centerWeight = 1.0 - 0.45 * (ndx * ndx + ndy * ndy);

          const bin = Math.min(BINS - 1, Math.max(0, Math.floor(z * BINS)));
          hist[bin] += Math.max(0.1, centerWeight);
        }
      }

      // Ön/orta plandaki (bin >= 8, yani Z >= 0.25) en yüksek tepe noktasını ara
      let bestBin = -1;
      let maxCount = -1;

      // 1. Önce ön/orta plandaki tepeye bak (Z >= 0.35)
      for (let b = Math.floor(BINS * 0.35); b < BINS; b++) {
        if (hist[b] > maxCount) {
          maxCount = hist[b];
          bestBin = b;
        }
      }

      // Eğer ön planda belirgin bir tepe yoksa tüm sahnenin tepesine bak
      if (bestBin < 0 || maxCount < 10) {
        for (let b = 0; b < BINS; b++) {
          if (hist[b] > maxCount) {
            maxCount = hist[b];
            bestBin = b;
          }
        }
      }

      if (bestBin >= 0) {
        // Kutu merkezini döndür
        const detectedZ = (bestBin + 0.5) / BINS;
        return Math.max(0.05, Math.min(0.95, detectedZ));
      }
      return 0.5;
    } catch {
      return 0.5;
    }
  }

  /**
   * Sahnedeki ana özneye otomatik olarak kilitlenir (AF).
   */
  public autoFocusOnSubject(): number {
    const autoZ = this.detectPrimarySubjectDepth();
    this.setAiFocalDepth(autoZ);
    return autoZ;
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

      const clonedDodgeBurn = cloneDodgeBurnMap(this.dodgeBurnMap);

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
        customLut: getCustomCubeLUT(),
        dodgeBurnMap: clonedDodgeBurn
      };

      // bitmap, derinlik bitmap ve dodge/burn tamponunu transfer et (zero-copy memory transfer!)
      const transferList: Transferable[] = [bitmap];
      if (depthBitmap) {
        transferList.push(depthBitmap);
      }
      if (clonedDodgeBurn) {
        transferList.push(clonedDodgeBurn.data.buffer);
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
   * 4. Faz 1 Kağıda Baskı (Multigrade / Split-Grade, Dodge/Burn, Selenyum/Sepya Toning, 300 DPI Kağıt Dokusu)
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
      settings.skinProtection > 0 || settings.swirl > 0
        ? this.getOrCreateSkinMask(sourceImg, rotation, w, h)
        : null;

    executeRenderPipeline({
      target,
      sourceImg,
      settings,
      rotation,
      noisePattern,
      depthCanvas: this.depthCanvas,
      skinMask,
      dodgeBurnMap: this.dodgeBurnMap,
      fullDimensions: this.originalDimensions || { width: w, height: h }
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
    this.dodgeBurnMap = null;
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
