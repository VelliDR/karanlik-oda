import { StripConfig, StripResolutionPreset } from '../types';

/**
 * Faz 5: 35mm Film Şeridi ve Kontakt Baskı — Fiziksel Ölçüler, Sabitler ve Bellek Bütçesi.
 *
 * Standart Kaynaklar:
 * 1. ISO 1007:2000 — "Photography — 135-size film and magazine — Specifications":
 *    - Toplam şerit genişliği: 35.0 mm (±0.03 mm)
 *    - Standart tam kare (Leica/Barnack 24x36) görüntü penceresi: 36.0 mm × 24.0 mm
 *    - Kare adımı (frame pitch): 38.0 mm (8 × 4.75 mm perforasyon adımı, 2.0 mm kare arası bar)
 * 2. SMPTE ST 102 — "35-mm Motion-Picture Film — Perforations (KS-1870 Kodak Standard)":
 *    - Delik genişliği (film akış yönü): 1.98 mm
 *    - Delik yüksekliği (enine yön): 2.79 mm
 *    - Köşe yarıçapı (fillet radius): 0.51 mm
 *    - Delik adımı (perforation pitch): 4.75 mm (kare başına tam 8 delik)
 *    - Dış kenardan delik dış kenarına mesafe: ~1.92 mm (kenar yazısı ve kare numarası bandı)
 */

export const STRIP_MIN_FRAMES = 3;
export const STRIP_MAX_FRAMES = 6;

/** ISO 1007 35mm fiziksel şerit boyutları (milimetre). */
export const FILM_35MM_TOTAL_WIDTH_MM = 35.0;
export const FILM_35MM_GATE_ALONG_MM = 36.0;
export const FILM_35MM_GATE_ACROSS_MM = 24.0;
export const FILM_35MM_FRAME_PITCH_MM = 38.0;
export const FILM_35MM_INTERFRAME_GAP_MM = FILM_35MM_FRAME_PITCH_MM - FILM_35MM_GATE_ALONG_MM; // 2.0 mm
export const FILM_35MM_END_MARGIN_MM = 3.5;
export const FILM_35MM_REBATE_SIDE_MM = (FILM_35MM_TOTAL_WIDTH_MM - FILM_35MM_GATE_ACROSS_MM) * 0.5; // 5.5 mm

/** SMPTE ST 102 KS-1870 perforasyon ölçüleri (milimetre). */
export const PERF_KS_PITCH_MM = 4.75;
export const PERF_KS_ALONG_MM = 1.98;
export const PERF_KS_ACROSS_MM = 2.79;
export const PERF_KS_RADIUS_MM = 0.51;
export const PERF_KS_OUTER_MARGIN_MM = 1.92;
export const PERFS_PER_FRAME = 8;

/** Kontakt baskı modunda 35mm şerit etrafındaki fotoğraf kağıdı kenar payı (milimetre). */
export const CONTACT_SHEET_PAPER_MARGIN_MM = 6.5;

/**
 * Varsayılan kenar yazısı (gerçek film markası veya üretici adı içermez;
 * tamamen kurgusal karanlık oda emülsiyon kodudur).
 */
export const DEFAULT_STRIP_EDGE_TEXT = 'FOTON PANKRO 400';

/**
 * Çıktı çözünürlüğü seçenekleri ve bellek ölçümüne dayalı varsayılan seçim gerekçesi:
 * - Varsayılan 3600 px uzun kenar (300 DPI'da 30.48 cm / 12 inç baskı boyutu):
 *   6×24 MP (6000×4000 = 96 MB RGBA) girdi sıralı işlenirken herhangi bir anda bellekte
 *   yalnızca 1 kaynak kare (96 MB) + 1 ara banyo tuvali (96 MB) + 1 birleşik şerit/kontakt tuvali
 *   (8–41.5 MB) bulunur (~200–233 MB tepe bellek). Mobil Safari 384 MB tuval tavanının
 *   güvenle altında kalarak 300 DPI vektörel keskinlik sağlar.
 */
export const DEFAULT_STRIP_LONG_EDGE_PX: StripResolutionPreset = 3600;

export const DEFAULT_PREVIEW_LONG_EDGE_PX = 1600;

export interface StripResolutionOption {
  longEdgePx: StripResolutionPreset;
  label: string;
  printCmAt300Dpi: string;
  estimatedSheetPeakMb: number;
}

export const STRIP_RESOLUTION_OPTIONS: readonly StripResolutionOption[] = [
  {
    longEdgePx: 2400,
    label: '2400 px • Hızlı Arşiv',
    printCmAt300Dpi: '20.3 cm @ 300 DPI',
    estimatedSheetPeakMb: 18
  },
  {
    longEdgePx: 3600,
    label: '3600 px • Standart 8×10" (Varsayılan)',
    printCmAt300Dpi: '30.5 cm @ 300 DPI',
    estimatedSheetPeakMb: 41
  },
  {
    longEdgePx: 4800,
    label: '4800 px • Galeri Baskısı',
    printCmAt300Dpi: '40.6 cm @ 300 DPI',
    estimatedSheetPeakMb: 73
  },
  {
    longEdgePx: 6000,
    label: '6000 px • Müze Arşivi',
    printCmAt300Dpi: '50.8 cm @ 300 DPI',
    estimatedSheetPeakMb: 115
  }
] as const;

export const DEFAULT_STRIP_CONFIG: StripConfig = {
  orientation: 'horizontal',
  outputMode: 'positive',
  edgeText: DEFAULT_STRIP_EDGE_TEXT,
  sprocketHalation: false,
  greasePencilMark: true,
  markedFrameIds: [],
  longEdgePx: DEFAULT_STRIP_LONG_EDGE_PX
};

/**
 * Film tabanı fiziksel sRGB renk sabitleri:
 * - Pozitif şerit: Arşivsel mat siyah film taşıyıcı ve fildişi ışıklı masa perforasyonu.
 * - Negatif şerit (C-41 renkli): Turuncu kuplör maskeli selüloz triasetat taban (Dmin).
 * - Negatif şerit (S/B): Gümüş-jelatin saydam gri selüloz triasetat taban (Dmin).
 */
export const STRIP_COLORS = {
  positiveBase: '#0A0B0E',
  positiveGateBorder: 'rgba(255, 255, 255, 0.08)',
  positivePerforation: '#F5F2EA',
  positiveRebateText: 'rgba(242, 169, 59, 0.90)',

  negativeColorMaskRgb: [208, 114, 56] as const,
  negativeMonoBaseRgb: [198, 200, 195] as const,
  negativePerforation: '#FAF8F2',
  negativeColorRebateText: 'rgba(64, 24, 10, 0.88)',
  negativeMonoRebateText: 'rgba(22, 24, 26, 0.88)',

  contactPaperPrePrintWhite: '#FBF9F4',
  contactStripMaskPrePrint: '#0E0F12',
  contactRebateExposureText: 'rgba(246, 242, 232, 0.86)',
  greasePencilPrimary: '#E63B24',
  greasePencilHighlight: '#F48C2E'
} as const;
