export type PresetKey =
  | 'none'
  | 'sb'
  | 'analog'
  | 'reze'
  | 'vampir'
  | 'gotik'
  | 'nordic'
  | 'cinestill';

export type FilmBorder = 'none' | 'clean-white' | 'darkroom-black' | 'kodak-35mm';

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface PresetDefinition {
  id: PresetKey;
  name: string;
  badge?: string;
  filter: string;
  overlayColor: string | null;
  overlayOpacity: number;
  blendMode: GlobalCompositeOperation;
  noise: number;
  description?: string;
}

export interface SliderSettings {
  // Temel Banyo
  exposure: number;     // -100 to 100
  contrast: number;     // -100 to 100
  saturation: number;   // -100 to 100
  warmth: number;       // -100 to 100
  preset: PresetKey;

  // Film Emülsiyonu & Kimyasal Kusurlar
  grain: number;        // 0 to 100 (Ekstra manuel gren ayarı)
  lightLeak: number;    // 0 to 100 (Analog ışık sızıntısı)
  bleachBypass: number; // 0 to 100 (Gümüş tutma banyosu)
  skinProtection: number; // 0 to 100 (Akıllı En-Boy Oranı Korumalı Ten Kalkanı)

  // Vintage Optik Kusurlar
  swirl: number;        // 0 to 100 (Helios 44M dönen bokeh)
  chromatic: number;    // 0 to 100 (Kromatik odak sapması)
  proMist: number;      // 0 to 100 (Black Pro-Mist difüzyonu)
  vignette: number;     // 0 to 100 (Mekanik vinyet)

  // 3D Fiziksel Alan Derinliği & Depth Anything AI
  aiDepthEnabled: boolean;     // 3D Alan Derinliği açık/kapalı
  aiDepthAperture: number;    // 0 to 100 (Diyafram açıklığı / alan derinliği toleransı)
  aiFocalDepth: number;       // 0.0 to 1.0 (Odak düzleminin derinliği)
  aiShowDepthMap: boolean;    // Derinlik haritası görsel önizleme modu (S/B)

  // Baskı & Çıktı Formatı
  quartzDate: boolean;
  quartzDateText: string;
  filmBorder: FilmBorder;
  exportFormat: ExportFormat;
  exportQuality: number; // 0.8 - 1.0 (varsayılan 1.0 maks)
}

export type RotationDegree = 0 | 90 | 180 | 270;

export interface EditorSnapshot {
  settings: SliderSettings;
  rotation: RotationDegree;
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyRenderingContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderTarget {
  canvas: AnyCanvas;
  ctx: AnyRenderingContext2D;
  width: number;
  height: number;
}
