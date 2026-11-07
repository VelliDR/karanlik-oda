import { PaperType } from '../types';

/**
 * Foton: Karanlık Oda — Faz 1 Fiziksel Kağıt, Multigrade Emülsiyon ve Kimyasal Toning Sabitleri.
 *
 * Tüm fiziksel ve sensitometrik sabitler kaynak referanslarıyla tek bir merkezde toplanmıştır:
 * - ISO 6:1993 (Siyah-beyaz negatif film duyarkaydı ve kontrast standartları)
 * - ISO 6846:1992 (Siyah-beyaz sürekli ton fotoğraf kağıtları — ISO hız ve ISO aralık R ölçümü)
 * - Ilford Photo Technical Data Sheets:
 *   - Ilford Multigrade V RC Deluxe (Parlak 1M & İnci/Mat 44M/25M)
 *   - Ilford Multigrade FB Classic (Fiber Baryta Parlak/Mat, 255 g/m²)
 *   - Ilford Harman Selenium Toner & Sulfide Sepia Toner teknik bültenleri
 * - Way Beyond Monochrome (Ralph Lambrecht & Chris Woodhouse, 2nd Ed.): H&D kağıt eğrileri ve Split-Grade sensitometrisi
 */

/** Standart arşivsel karanlık oda baskı çözünürlüğü (piksel / inç) — ISO/ラボ baskı standardı */
export const PRINT_STANDARD_DPI = 300;

/** 1 inç'in milimetre karşılığı (SI birim dönüşümü, tam değer) */
export const MM_PER_INCH = 25.4;

/** 300 DPI'da 1 tam çözünürlüklü pikselin kağıt üzerindeki fiziksel boyutu (~0.084667 mm/px) */
export const MM_PER_PIXEL_AT_300DPI = MM_PER_INCH / PRINT_STANDARD_DPI;

/** 1 EV / agrandizör stop'unun 10 tabanında logaritmik pozlama karşılığı: log10(2) ≈ 0.30102999566 */
export const LOG10_2 = Math.LN2 / Math.LN10;

/** ln(10) ≈ 2.302585093 — 10^x ve log10(x) türev/üstel dönüşümleri için */
export const LN_10 = Math.LN10;

/**
 * Siyah-Beyaz Gümüş-Jelatin Negatif Referans Parametreleri.
 * Kaynak: Ilford HP5 Plus 400 / Kodak Tri-X 400 (D-76 1+1, 20°C, Gbar ≈ 0.62) teknik veri sayfaları.
 * - Taban + Sis (Base + Fog) yoğunluğu triasetat taban için tipik olarak 0.10 – 0.14 D aralığındadır.
 * - Difüzör/kondansör agrandizör için ideal negatif maksimum yoğunluğu ~1.55 – 1.65 D aralığındadır (ΔD ≈ 1.50).
 * - K_neg = 24.0 logaritmik ölçek katsayısı, sahne-lineer %18 orta griyi (Y = 0.184) negatif yoğunluk
 *   aralığının merkezine (Zone V, D_neg ≈ 0.91) oturtur.
 */
export const NEGATIVE_FILM_CONSTANTS = {
  /** Film tabanı + kimyasal sis optik yoğunluğu (Base + Fog, D) */
  dBaseFog: 0.12,
  /** Tam pozlanmış yüksek ışık gümüş yoğunluğu (D_max,neg) */
  dMax: 1.62,
  /** Sahne-lineer parlaklıktan H&D logaritmik negatif yoğunluğuna geçiş ölçeği */
  logCompressionK: 24.0
} as const;

/**
 * Multigrade Değişken Kontrastlı Çift Emülsiyon Katmanı Sabitleri.
 * Kaynak: Ilford Multigrade IV / V & Lambrecht "Way Beyond Monochrome" Bölüm 7.
 *
 * Gerçek değişken kontrastlı kağıt iki gümüş-halojenür emülsiyonunun karışımıdır:
 * 1. Yumuşak katman (ortho/yeşil duyarlı, ~540 nm): Geniş pozlama ölçeği (ISO R ≈ 170–180), düşük eğim (g_soft).
 * 2. Sert katman (mavi duyarlı, ~450 nm): Dar pozlama ölçeği (ISO R ≈ 40–50), dik eğim (g_hard).
 * Yarı-yoğunluk hız noktaları (logE0_soft, logE0_hard) ISO Speed-Matched prensibine göre Zone V (%18 gri,
 * R ≈ 0.16–0.18) etrafında hizalanmıştır; böylece derece değiştiğinde orta gri pozlaması savrulmaz.
 */
export const MULTIGRADE_EMULSION_CONSTANTS = {
  /** En düşük filtre derecesi: '00' sayısal olarak -0.5 ile temsil edilir */
  minGrade: -0.5,
  /** En yüksek filtre derecesi: '5' sayısal olarak 5.0 ile temsil edilir */
  maxGrade: 5.0,
  /** Standart referans filtre derecesi (Derece 2 — filtresiz beyaz ışık eşdeğeri) */
  defaultGrade: 2.0,
  /** Yarım derecelik standart karanlık oda filtre adımı */
  gradeStep: 0.5,
  /** Yeşil duyarlı yumuşak emülsiyon lojistik eğim katsayısı (Derece 00 karakteristiği) */
  gSoft: 1.68,
  /** Yeşil duyarlı yumuşak emülsiyon yarı-yoğunluk log10(E) merkezi */
  logE0Soft: -0.78,
  /** Mavi duyarlı sert emülsiyon lojistik eğim katsayısı (Derece 5 karakteristiği) */
  gHard: 5.35,
  /** Mavi duyarlı sert emülsiyon yarı-yoğunluk log10(E) merkezi (Zone V hız eşleşmeli) */
  logE0Hard: -0.86
} as const;

/**
 * Agrandizör Pozlama ve Dodge/Burn Sınır Sabitleri.
 * Kaynak: Standart f-stop karanlık oda zamanlayıcıları (1/12 – 1/20 stop hassasiyet, ±3 stop aralık).
 */
export const ENLARGER_CONSTANTS = {
  minExposureStops: -3.0,
  maxExposureStops: 3.0,
  defaultExposureStops: 0.0,
  /** Dodge/burn haritasında izin verilen maksimum yerel poz sapması (±3.0 stop) */
  maxDodgeBurnStops: 3.0,
  /** Giriş çözünürlüğüne göre dodge/burn doku küçültme oranı (~1/4 genişlik ve yükseklik) */
  dodgeBurnDownsampleFactor: 4,
  /** Çok küçük önizlemelerde minimum harita kenar pikseli */
  minDodgeBurnDim: 64
} as const;

/**
 * Kağıt Tabağı (Substrate) Fiziksel ve Yüzey Profili.
 */
export interface PaperStockProfile {
  id: PaperType;
  name: string;
  badge: string;
  description: string;
  /** Kağıt tabanı + minimum sis yansıma yoğunluğu (Status A D_min) */
  dMin: number;
  /** Geliştirilmiş maksimum gümüş yansıma yoğunluğu (Status A D_max) */
  dMax: number;
  /** Kullanıcı kağıt tipini seçtiğinde önerilen varsayılan sıcaklık sürgüsü (0 = nötr, 1 = sıcak krem) */
  defaultPaperTone: number;
  /** Sıcak ton sürgüsü = 1.0 olduğunda ulaşılan lineer RGB kağıt taban yansıma çarpanı */
  warmBaseLinearRgb: readonly [number, number, number];
  /** Kimyasal toning (selenyum/sepya) tepki duyarlılığı çarpanı (Fiber baryta en duyarlıdır) */
  toningSensitivity: number;
  /** Prosedürel yüzey dokusu parametreleri (300 DPI milimetre ölçekli, genlik <= 0.02) */
  texture: {
    /** Maksimum yansıma modülasyon genliği (kesin kural: <= 0.02 yani %2) */
    amplitude: number;
    /** Düşük frekanslı selüloz/lif dalga boyu (mm) */
    lowFreqWavelengthMm: number;
    /** Yüksek frekanslı yüzey gözenek dalga boyu (mm) */
    highFreqWavelengthMm: number;
    /** Düşük frekans katman ağırlığı (highWeight = 1 - lowWeight) */
    lowFreqWeight: number;
  };
}

/**
 * Karanlık Oda Kağıt Tipleri Tablosu.
 * Kaynaklar:
 * - RC Parlak: Ilford Multigrade V RC Deluxe Glossy (1M) — Dmax ≈ 2.05–2.10, nötr optik beyazlatıcılı polietilen taban.
 * - RC Mat: Ilford Multigrade V RC Matte (25M) — Dmax ≈ 1.55–1.60, dağınık yüzey yansıması nedeniyle daha açık/gri gölgeler.
 * - Fiber Baryta: Ilford Multigrade FB Classic / Warmtone — Dmax ≈ 2.00–2.05, baryum sülfat (BaSO4) astarlı lifli selüloz, yüksek toning duyarlılığı.
 */
export const PAPER_PROFILES: Record<PaperType, PaperStockProfile> = {
  'rc-glossy': {
    id: 'rc-glossy',
    name: 'RC Parlak',
    badge: 'Dmax 2.08',
    description: 'Reçine kaplı parlak yüzey: en derin siyahlar, nötr beyaz taban ve en geniş kontrast aralığı',
    dMin: 0.022,
    dMax: 2.08,
    defaultPaperTone: 0.0,
    warmBaseLinearRgb: [1.0, 0.962, 0.895],
    toningSensitivity: 0.95,
    texture: {
      amplitude: 0.0018, // %0.18 — neredeyse tamamen pürüzsüz parlak polietilen yüzey
      lowFreqWavelengthMm: 1.60,
      highFreqWavelengthMm: 0.24,
      lowFreqWeight: 0.70
    }
  },
  'rc-matte': {
    id: 'rc-matte',
    name: 'RC Mat',
    badge: 'Dmax 1.56',
    description: 'Yansımasız ince mat doku: yumuşak kadifemsi gri gölgeler ve düzgün mikro granül yüzey',
    dMin: 0.028,
    dMax: 1.56,
    defaultPaperTone: 0.0,
    warmBaseLinearRgb: [1.0, 0.960, 0.892],
    toningSensitivity: 0.90,
    texture: {
      amplitude: 0.0085, // %0.85 — ince, homojen mat yüzey kırılması
      lowFreqWavelengthMm: 0.85,
      highFreqWavelengthMm: 0.16,
      lowFreqWeight: 0.45
    }
  },
  'fiber-baryta': {
    id: 'fiber-baryta',
    name: 'Fiber Baryta',
    badge: 'FB 255g',
    description: 'Baryum sülfat kaplı saf selüloz lifli sergi kağıdı: hafif sıcak krem taban, selenyum ve sepyaya en duyarlı emülsiyon',
    dMin: 0.024,
    dMax: 2.02,
    defaultPaperTone: 0.35,
    warmBaseLinearRgb: [1.0, 0.954, 0.876],
    toningSensitivity: 1.22,
    texture: {
      amplitude: 0.0175, // %1.75 (<= %2 üst sınırı içinde) — belirgin organik selüloz lif dokusu
      lowFreqWavelengthMm: 1.35,
      highFreqWavelengthMm: 0.21,
      lowFreqWeight: 0.68
    }
  }
};

/**
 * Kimyasal Toning (1D LUT) Fiziksel Model Sabitleri.
 * Kaynak:
 * - Selenyum (Kodak Rapid Selenium Toner 1+9 .. 1+3): Metalik gümüşü gümüş selenüre (Ag2Se) dönüştürür;
 *   yüksek yoğunluklarda (gölgelerde) Dmax'ı +0.12..0.18 D artırır ve soğuk patlıcan/mor-kahve ton kayması üretir.
 * - Sepya (Potasyum ferrisiyanür ağartma + Sodyum sülfür yeniden geliştirme, Ag2S): Açık ve orta tonlardaki
 *   küçük gümüş taneciklerinden başlayarak sıcak kehribar/sülfür kahvesi üretir.
 */
export const TONING_CONSTANTS = {
  /** 1D Toning renk eşleme tablosu örnek sayısı */
  lutSize: 256,
  selenium: {
    /** Tam selenyum tonlamada (duyarlılık=1) gölge maksimum yoğunluk artışı (ΔD) */
    maxShadowDensityBoost: 0.16,
    /** Yoğunluğa bağlı gölge ağırlık üssü (yüksek yoğunluklara odaklanır) */
    densityExponent: 1.75,
    /** Gümüş selenür (Ag2Se) lineer RGB kromatik kayma vektörü (mor-kahve / aubergine) */
    chromaticShiftLinearRgb: [0.15, -0.085, 0.105] as const
  },
  sepia: {
    /** Sülfür sepya açık-orta ton tepe konumu için yoğunluk eğrilik üssü */
    highlightSkewExponent: 0.62,
    /** Derin gölgelerde (duo-toning uyumu için) sönümlenme katsayısı */
    deepShadowRolloff: 0.32,
    /** Gümüş sülfür (Ag2S) hafif ağartma kaynaklı yoğunluk azalması (açık tonlarda havadarlık) */
    bleachDensityRelief: 0.035,
    /** Gümüş sülfür (Ag2S) lineer RGB kromatik kayma vektörü (sıcak sülfür kahvesi) */
    chromaticShiftLinearRgb: [0.34, 0.035, -0.31] as const
  }
} as const;

/**
 * Rec.709 / sRGB sahne-lineer fotometrik lüminans katsayıları (ITU-R BT.709-6).
 */
export const LINEAR_LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

/**
 * Sayısal multigrade derecesini (-0.5 .. 5.0) karanlık oda gösterimine ('00', '0', '0.5', ..., '5') çevirir.
 */
export function formatMultigradeLabel(grade: number): string {
  const snapped = Math.round(grade * 2) / 2;
  if (snapped <= -0.5) return '00';
  return Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(1);
}

/**
 * Derece (-0.5 = '00' .. 5.0 = '5') değerinden sert katman ağırlığını (w_hard ∈ [0, 1]) hesaplar.
 * w_soft = 1 - w_hard.
 */
export function computeHardLayerWeight(grade: number): number {
  const { minGrade, maxGrade } = MULTIGRADE_EMULSION_CONSTANTS;
  const t = (grade - minGrade) / (maxGrade - minGrade);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
