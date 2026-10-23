import {
  EditorSnapshot,
  ExportFormat,
  RenderTarget,
  RotationDegree,
  SliderSettings
} from './types';
import { PRESETS } from './presets';
import {
  applyBlackProMist,
  applyBleachBypass,
  applyChromaticAberration,
  applyFilmBorder,
  applyFilmGrain,
  applyHalation,
  applyLightLeak,
  applyQuartzDate,
  applySwirlyBokeh,
  applyVignette,
  createNoisePattern
} from './optics';

export const DEFAULT_SETTINGS: SliderSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  preset: 'none',

  grain: 0,
  lightLeak: 0,
  bleachBypass: 0,

  swirl: 0,
  chromatic: 0,
  proMist: 0,
  vignette: 0,

  quartzDate: false,
  quartzDateText: "'98 10 24",
  filmBorder: 'none',
  exportFormat: 'image/png', // Varsayılan %100 kayıpsız format
  exportQuality: 1.0         // %100 maksimum kalite
};

export class PhotoEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private originalImg: HTMLImageElement | null = null;
  private previewImg: HTMLImageElement | null = null;
  private currentObjectUrl: string | null = null;
  private previewObjectUrl: string | null = null;

  public settings: SliderSettings = { ...DEFAULT_SETTINGS };
  public rotation: RotationDegree = 0;
  public isComparingOriginal = false;

  private isRenderPending = false;
  private noisePattern: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D bağlamı oluşturulamadı.');
    }
    this.ctx = ctx;
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
   * Sıfır kopyalı Blob/File nesnesini yükler ve düşük bellekli önizleme oluşturur.
   */
  public async loadImageFromBlob(blob: Blob): Promise<void> {
    this.cleanupUrls();

    this.currentObjectUrl = URL.createObjectURL(blob);
    const img = await this.loadImageElement(this.currentObjectUrl);
    this.originalImg = img;

    // 1200px sınırında akıcı önizleme görseli oluştur
    const maxDim = 1200;
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
    const pCtx = previewCanvas.getContext('2d');
    if (!pCtx) throw new Error('Önizleme tuvali oluşturulamadı.');

    pCtx.drawImage(img, 0, 0, pw, ph);

    const previewBlob = await new Promise<Blob>((resolve) => {
      previewCanvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.90);
    });

    previewCanvas.width = 0;
    previewCanvas.height = 0;

    this.previewObjectUrl = URL.createObjectURL(previewBlob);
    this.previewImg = await this.loadImageElement(this.previewObjectUrl);

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
    this.scheduleRender();
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
    this.settings = { ...snapshot.settings };
    this.rotation = snapshot.rotation;
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
    const targetWidth = isTransposed ? this.previewImg.naturalHeight : this.previewImg.naturalWidth;
    const targetHeight = isTransposed ? this.previewImg.naturalWidth : this.previewImg.naturalHeight;

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
   * Tam çözünürlüklü, %100 kayıpsız veya en yüksek kaliteli dışa aktarma.
   */
  public async exportHighRes(
    customFormat?: ExportFormat,
    customQuality?: number
  ): Promise<{ blob: Blob; extension: string; mimeType: string }> {
    if (!this.originalImg) {
      throw new Error('İşlenecek görsel bulunamadı.');
    }

    const format = customFormat || this.settings.exportFormat;
    const quality = customQuality !== undefined ? customQuality : this.settings.exportQuality;

    const isTransposed = this.rotation === 90 || this.rotation === 270;
    const targetWidth = isTransposed ? this.originalImg.naturalHeight : this.originalImg.naturalWidth;
    const targetHeight = isTransposed ? this.originalImg.naturalWidth : this.originalImg.naturalHeight;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });

    if (!exportCtx) {
      throw new Error('Dışa aktarım tuvali oluşturulamadı.');
    }

    const noisePattern = createNoisePattern(exportCtx);
    const target: RenderTarget = {
      canvas: exportCanvas,
      ctx: exportCtx,
      width: targetWidth,
      height: targetHeight
    };

    try {
      this.renderPipeline(target, this.originalImg, this.settings, this.rotation, noisePattern);

      const blob = await new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Görsel Blob oluşturulamadı.'));
          },
          format,
          quality
        );
      });

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
      // VRAM temizliği
      exportCanvas.width = 0;
      exportCanvas.height = 0;
    }
  }

  /**
   * Çekirdek banyo ve optik işleme hattı.
   */
  private renderPipeline(
    target: RenderTarget,
    sourceImg: HTMLImageElement,
    settings: SliderSettings,
    rotation: RotationDegree,
    noisePattern: CanvasPattern | null
  ): void {
    const { ctx, width: w, height: h } = target;
    ctx.clearRect(0, 0, w, h);

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

    // Black Pro-Mist (Yumuşak Sisli Parlama)
    if (settings.proMist > 0) {
      applyBlackProMist(target, settings.proMist);
    }

    // Helios 44M Swirl Bokeh
    if (settings.swirl > 0) {
      applySwirlyBokeh(target, settings.swirl);
    }

    // Chromatic Aberration
    if (settings.chromatic > 0) {
      applyChromaticAberration(target, settings.chromatic);
    }

    // CineStill 800T Halation
    if (settings.preset === 'cinestill') {
      applyHalation(target);
    }

    // Işık Sızıntısı (Light Leak)
    if (settings.lightLeak > 0) {
      applyLightLeak(target, settings.lightLeak);
    }

    // 35mm Analog Film Greni
    const activeNoise = (preset.noise || 0) + (settings.grain / 100) * 0.22;
    if (activeNoise > 0 && noisePattern) {
      applyFilmGrain(target, noisePattern, activeNoise);
    }

    // Mekanik Vinyet
    if (settings.vignette > 0) {
      applyVignette(target, settings.vignette);
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
    sourceImg: HTMLImageElement,
    rotation: RotationDegree
  ): void {
    const { ctx, width: w, height: h } = target;
    const srcW = sourceImg.naturalWidth;
    const srcH = sourceImg.naturalHeight;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(sourceImg, -srcW / 2, -srcH / 2, srcW, srcH);
    ctx.restore();
  }

  private renderRawImage(
    target: RenderTarget,
    sourceImg: HTMLImageElement,
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

  public destroy(): void {
    this.cleanupUrls();
    this.originalImg = null;
    this.previewImg = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
