export type PresetKey =
  | 'none'
  | 'sb'
  | 'hp5'
  | 'analog'
  | 'kodachrome'
  | 'velvia'
  | 'reze'
  | 'vampir'
  | 'gotik'
  | 'nordic'
  | 'cinestill'
  | 'ccd'
  | 'ccd_y2k'
  | 'custom_lut';

export interface CubeLUT3D {
  title: string;
  size: number; // 33 (33x33x33) veya 65 (65x65x65)
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array; // size * size * size * 4 (RGBA f32)
}

export interface SensitometryParams {
  toeStrength: number;     // Dip tonlarda (toe) logaritmik uyanış
  gammaSlope: number;      // Orta tonlarda (straight-line) karakteristik eğim
  shoulderRollOff: number; // Yüksek ışıklarda (shoulder) yumuşak doygunluk sönümlenmesi
  dMin: number;            // Base + Fog taban yoğunluğu
  dMax: number;            // Maksimum yoğunluk tavanı
  highlightDesat: number;  // Omuz bölgesinde çapraz kanal doygunluk sönümlenmesi
}

export interface HeliosParams {
  intensity: number;      // 0 to 100
  focalDepth?: number;    // 0.0 to 1.0 (varsayılan 0.5)
  aperture?: number;      // 0 to 100 (varsayılan 50)
  catEye?: number;        // 0 to 100
  soapBubble?: number;    // 0 to 100 (Sabun köpüğü / parlak halka bokeh)
  loca?: number;          // 0 to 100 (Boyuna kromatik sapma / LoCA saçaklanması)
  apertureBlades?: number;// 0 = Dairesel (f/2), 6 = Helios 44M (6 Bıçak), 8 = Helios 44-2 (8 Bıçak)
  bladeCurvature?: number;// 0 to 100 (Bıçak kavis sertliği / düzlüğü)
}

export interface CcdParams {
  highlightClipping?: number; // Eşik değeri veya yoğunluk
  verticalSmear?: number;     // Dikey taşma yoğunluğu
  chromaNoise?: number;       // Gölgelerde dijital kroma gürültüsü
  unsharpAmount?: number;     // Unsharp mask halesi
  mode?: 'ccd' | 'ccd_y2k';
}

export type FilmBorder = 'none' | 'clean-white' | 'darkroom-black' | 'kodak-35mm';

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export type PaperType = 'rc-glossy' | 'rc-matte' | 'fiber-baryta';

export type DodgeBurnToolMode = 'off' | 'dodge' | 'burn' | 'erase';

export interface DodgeBurnMap {
  width: number;
  height: number;
  data: Float32Array; // Stop cinsinden yerel poz farkı [-3.0, +3.0]
  version: number;
}


export interface PresetDefinition {
  id: PresetKey;
  name: string;
  badge?: string;
  noise: number;
  defaultShoulder?: number;
  defaultHalation?: number;
  sensitometry: SensitometryParams;
  description?: string;
}

export interface SliderSettings {
  // Temel Banyo & H&D Sensitometri
  exposure: number;     // -100 to 100
  contrast: number;     // -100 to 100
  shoulder: number;     // 0 to 100 (H&D Film Omzu / Highlight Roll-off Sıkıştırması)
  saturation: number;   // -100 to 100
  warmth: number;       // -100 to 100 (Bradford K Sıcaklık)
  preset: PresetKey;

  // Lightroom İnce Ayarları (Faz 2 & Faz 4)
  highlights?: number;  // -100 to 100 (Vurgu Kurtarma)
  shadows?: number;     // -100 to 100 (Gölge Açma)
  whites?: number;      // -100 to 100 (Beyaz Noktası)
  blacks?: number;      // -100 to 100 (Siyah Noktası)
  tint?: number;        // -100 to 100 (Yeşil / Magenta Dengesi)
  vibrance?: number;    // -100 to 100 (Akıllı Doygunluk)
  texture?: number;     // 0 to 100 (Mikro Doku)
  clarity?: number;     // -100 to 100 (Orta Ton Lokal Kontrast)
  dehaze?: number;      // -100 to 100 (Pus Kırma)

  // Film Emülsiyonu & Kimyasal Kusurlar
  halation: number;     // 0 to 100 (650nm Spektral Kırılmalı Halasyon)
  grain: number;        // 0 to 100 (Ekstra manuel gren ayarı)
  lightLeak: number;    // 0 to 100 (Analog ışık sızıntısı)
  bleachBypass: number; // 0 to 100 (Gümüş tutma banyosu)
  skinProtection: number; // 0 to 100 (Akıllı En-Boy Oranı Korumalı Ten Kalkanı)

  // Vintage Optik Kusurlar
  swirl: number;        // 0 to 100 (Helios 44M dönen bokeh)
  soapBubble: number;   // 0 to 100 (Sabun köpüğü / parlak halka bokeh)
  loca: number;         // 0 to 100 (Boyuna kromatik sapma / LoCA yeşil-mor saçaklanması)
  apertureBlades: number; // 0 = Dairesel (f/2), 6 = Helios 44M (6 Bıçak), 8 = Helios 44-2 (8 Bıçak)
  bladeCurvature: number; // 0 to 100 (Bıçak kavis sertliği / düzlüğü)
  chromatic: number;    // 0 to 100 (Kromatik odak sapması)
  proMist: number;      // 0 to 100 (Black Pro-Mist difüzyonu)
  vignette: number;     // 0 to 100 (Mekanik vinyet)

  // 3D Fiziksel Alan Derinliği & Depth Anything AI
  aiDepthEnabled: boolean;     // 3D Alan Derinliği açık/kapalı
  aiDepthAperture: number;    // 0 to 100 (Diyafram açıklığı / alan derinliği toleransı)
  aiFocalDepth: number;       // 0.0 to 1.0 (Odak düzleminin derinliği)
  aiShowDepthMap: boolean;    // Derinlik haritası görsel önizleme modu (S/B)

  // Faz 1: Karanlık Oda Kağıda Baskı (Agrandizör & Multigrade Kağıt Katmanı)
  printEnabled?: boolean;      // Baskı katmanı açık/kapalı (kapalıyken 0 maliyet)
  printExposure?: number;      // -3.0 to +3.0 stop (Agrandizör pozu)
  printGrade?: number;         // -0.5 (00) to 5.0 (5), 0.5 adımlı Multigrade filtre derecesi
  printSplitGrade?: boolean;   // Split-grade (00 + 5 çift pozlama) modu
  printSplitRatio?: number;    // 0.0 to 1.0 (Sert katman poz oranı; 0 = %100 00, 1 = %100 5)
  printPaperType?: PaperType;  // 'rc-glossy' | 'rc-matte' | 'fiber-baryta'
  printPaperTone?: number;     // 0.0 (nötr beyaz) to 1.0 (sıcak krem)
  printSelenium?: number;      // 0.0 to 1.0 (Selenyum gölge yoğunluk ve mor-kahve tonlama)
  printSepia?: number;         // 0.0 to 1.0 (Sepya açık/orta ton sülfür sıcak kahve tonlama)

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
  dodgeBurnMap?: DodgeBurnMap | null;
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyRenderingContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderTarget {
  canvas: AnyCanvas;
  ctx: AnyRenderingContext2D;
  width: number;
  height: number;
}
