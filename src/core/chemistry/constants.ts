/**
 * Faz 3: Karanlık Oda Negatif Banyo Kimyası — Fiziksel Sabitler ve Kalibrasyon Tabloları.
 *
 * Literatür ve Teknik Veri Kaynakları:
 * 1. C. E. K. Mees & T. H. James, "The Theory of the Photographic Process",
 *    4th ed., Macmillan, 1977:
 *    - Bölüm 3 ("Gelatin"): Termal şok ve pH değişiminde jelatin ağının şişme/büzüşme
 *      reticulation dalga boyu (~0.06–0.14 mm).
 *    - Bölüm 14 ("The Rate of Development"): Geliştirme süresi uzadıkça H&D gama eğiminin
 *      dikleşmesi, efektif gölge hızının (toe) geride kalması ve gümüş kümelenmesi.
 *    - Bölüm 21 ("Adjacency Effects in Development"): Kostinsky (1907) ve Eberhard (1926)
 *      yanal difüzyon uzunlukları; Mackie çizgisi kenar difüzyonu (~0.10–0.30 mm) ve
 *      durgun banyo (stand/semi-stand) makro geliştirici tükenmesi (~1.2–2.5 mm).
 * 2. C. N. Nelson, "Prediction of Densities in Fine Detail in Photographic Images",
 *    Photographic Science and Engineering, 15(1), 82–97, 1971 (Kimyasal yayılım çekirdekleri).
 * 3. G. Haist, "Modern Photographic Processing", Vol. 1, Wiley-Interscience, 1979, s. 510–518
 *    (Reticulation sırt oluşumu ve gümüş tanecik göçü).
 * 4. Ilford Photo Technical Information — "HP5 Plus 400 Contrast-Time Curves (ID-11 / Microphen)"
 *    & Eastman Kodak Pub. F-4017 — "Kodak Professional Tri-X 400 Film (D-76 Push Processing)".
 */

/** Standart 135-format (35mm) negatif pencere ölçüleri (ISO 1007, milimetre). */
export const NEGATIVE_35MM_WIDTH_MM = 36.0;
export const NEGATIVE_35MM_HEIGHT_MM = 24.0;
export const NEGATIVE_35MM_DIAGONAL_MM = Math.hypot(
  NEGATIVE_35MM_WIDTH_MM,
  NEGATIVE_35MM_HEIGHT_MM
); // 43.266615305567875 mm

/** Push / Pull sürgü sınırları (stop cinsinden). */
export const PUSH_PULL_MIN_STOPS = -2.0;
export const PUSH_PULL_MAX_STOPS = 3.0;

export interface PushPullCalibrationNode {
  /** Nominal banyoya göre stop farkı (-2 .. +3). */
  deltaStops: number;
  /** H&D orta ton eğimi (gammaSlope) çarpanı. */
  gammaMultiplier: number;
  /** Dip ton (toeStrength) ek kayması (negatif = ezilmiş derin siyahlar, pozitif = açık gölge). */
  toeDelta: number;
  /** Omuz sıkıştırma (shoulderRollOff) ek kayması. */
  shoulderDelta: number;
  /** Orta/açık ton efektif hız kazanımı (EV stop cinsinden). */
  exposureEvDelta: number;
  /** Base + fog taban yoğunluğu (dMin) kayması. */
  dMinDelta: number;
  /** Maksimum gümüş yoğunluğu (dMax) kayması. */
  dMaxDelta: number;
  /** Gümüş halojenür gren kümelenme çarpanı (Adım 6 film greni için). */
  grainMultiplier: number;
}

/**
 * S/B gümüş-jelatin negatifler (HP5+ / Tri-X 400, D-76 / ID-11 20°C) için
 * kalibre edilmiş Push / Pull H&D tepki tablosu.
 * deltaStops = 0 düğümü tam birim (identity) değerler taşır.
 */
export const PUSH_PULL_CALIBRATION_TABLE: readonly PushPullCalibrationNode[] = [
  {
    deltaStops: -2.0,
    gammaMultiplier: 0.74,
    toeDelta: 0.16,
    shoulderDelta: 0.10,
    exposureEvDelta: -0.16,
    dMinDelta: -0.004,
    dMaxDelta: -0.024,
    grainMultiplier: 0.78
  },
  {
    deltaStops: -1.0,
    gammaMultiplier: 0.86,
    toeDelta: 0.08,
    shoulderDelta: 0.05,
    exposureEvDelta: -0.08,
    dMinDelta: -0.002,
    dMaxDelta: -0.012,
    grainMultiplier: 0.88
  },
  {
    deltaStops: 0.0,
    gammaMultiplier: 1.0,
    toeDelta: 0.0,
    shoulderDelta: 0.0,
    exposureEvDelta: 0.0,
    dMinDelta: 0.0,
    dMaxDelta: 0.0,
    grainMultiplier: 1.0
  },
  {
    deltaStops: 1.0,
    gammaMultiplier: 1.15,
    toeDelta: -0.10,
    shoulderDelta: -0.04,
    exposureEvDelta: 0.10,
    dMinDelta: 0.003,
    dMaxDelta: 0.006,
    grainMultiplier: 1.16
  },
  {
    deltaStops: 2.0,
    gammaMultiplier: 1.32,
    toeDelta: -0.20,
    shoulderDelta: -0.08,
    exposureEvDelta: 0.19,
    dMinDelta: 0.007,
    dMaxDelta: 0.010,
    grainMultiplier: 1.35
  },
  {
    deltaStops: 3.0,
    gammaMultiplier: 1.48,
    toeDelta: -0.28,
    shoulderDelta: -0.12,
    exposureEvDelta: 0.27,
    dMinDelta: 0.012,
    dMaxDelta: 0.014,
    grainMultiplier: 1.56
  }
] as const;

/**
 * Kostinsky / Mackie Çizgisi Kenar Etkisi (Adjacency Effect) fiziksel sabitleri.
 * Yarıçap 36x24mm negatif üzerinde milimetre cinsinden tanımlıdır (Nelson 1971, Mees & James Ch. 21).
 */
export const KOSTINSKY_EDGE_SIGMA_MM = 0.20;
export const KOSTINSKY_EDGE_MAX_ALPHA = 0.72;
export const KOSTINSKY_GRID_PX_PER_MM = 20.0; // ~720x480 fiziksel ızgara (sigma ≈ 4.0 px)
export const KOSTINSKY_MAX_GRID_DIM = 960;

/**
 * Eberhard / Durgun Banyo Developer Tükenmesi (Developer Exhaustion) fiziksel sabitleri.
 * Yoğun gümüş bölgelerinin çevredeki geliştiriciyi tüketerek lokal kazancı düşürme yarıçapı (mm).
 */
export const EXHAUSTION_MACRO_SIGMA_MM = 1.85;
export const EXHAUSTION_MAX_KAPPA = 0.36;
export const EXHAUSTION_GRID_PX_PER_MM = 4.0; // ~144x96 fiziksel ızgara (sigma ≈ 7.4 px)
export const EXHAUSTION_MAX_GRID_DIM = 256;

/** Ayrılabilir 1B Gauss çekirdeği maksimum yarıçap sınırı (ızgara pikseli cinsinden). */
export const CHEMISTRY_GAUSS_MAX_RADIUS = 24;

/**
 * Reticulation (Termal Şok Jelatin Çatlaması & Gren Kümelenmesi) fiziksel sabitleri.
 * Dalga boyu ve maksimum jelatin mikro-kayma genliği 36x24mm negatif üzerinde mm cinsindendir.
 */
export const RETICULATION_CELL_PITCH_MM = 0.11;
export const RETICULATION_SECONDARY_FREQ = 2.17;
export const RETICULATION_SECONDARY_WEIGHT = 0.30;
export const RETICULATION_MAX_DISPLACEMENT_MM = 0.026;
export const RETICULATION_MAX_DENSITY_MOD = 0.22;
export const RETICULATION_RIDGE_WIDTH = 0.52;
export const RETICULATION_RIDGE_BIAS = 0.32;

/**
 * Verilen görüntü çözünürlüğü için 35mm negatif üzerindeki piksel/milimetre oranını döndürür.
 * Köşegen normalizasyonu sayesinde yatay/dikey rotasyon ve farklı megapiksellerde (12MP vs 40MP)
 * fiziksel yarıçaplar tam olarak aynı kadraj oranına karşılık gelir.
 */
export function computeNegativePxPerMm(width: number, height: number): number {
  const diagPx = Math.hypot(Math.max(1, width), Math.max(1, height));
  return diagPx / NEGATIVE_35MM_DIAGONAL_MM;
}

/**
 * Milimetre-kilitli difüzyon ızgarası boyutlarını ve ızgara üzerindeki Gauss sigma değerini hesaplar.
 */
export function computeChemistryGridSpec(
  width: number,
  height: number,
  targetPxPerMm: number,
  sigmaMm: number,
  maxGridDim: number
): { gridW: number; gridH: number; sigmaGridPx: number; radiusGridPx: number } {
  const pxPerMm = computeNegativePxPerMm(width, height);
  const frameWidthMm = width / pxPerMm;
  const frameHeightMm = height / pxPerMm;

  let idealW = Math.max(16, Math.round(frameWidthMm * targetPxPerMm));
  let idealH = Math.max(16, Math.round(frameHeightMm * targetPxPerMm));

  const maxAllowedW = Math.min(Math.max(16, width), maxGridDim);
  const maxAllowedH = Math.min(Math.max(16, height), maxGridDim);
  const clampScale = Math.min(1.0, maxAllowedW / idealW, maxAllowedH / idealH);

  const gridW = Math.max(8, Math.round(idealW * clampScale));
  const gridH = Math.max(8, Math.round(idealH * clampScale));

  const gridPxPerMm = Math.hypot(gridW, gridH) / NEGATIVE_35MM_DIAGONAL_MM;
  const sigmaGridPx = Math.max(0.65, sigmaMm * gridPxPerMm);
  const radiusGridPx = Math.min(
    CHEMISTRY_GAUSS_MAX_RADIUS,
    Math.max(1, Math.ceil(sigmaGridPx * 3.0))
  );

  return { gridW, gridH, sigmaGridPx, radiusGridPx };
}
