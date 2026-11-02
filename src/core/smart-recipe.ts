import { AnyCanvas, PresetKey, SliderSettings } from './types';
import { PRESETS } from './presets';
import { createCompatibleCanvas } from './optics';

export interface PhotoFeatures {
  meanLuminance: number;       // 0.0 - 1.0 (Ortalama parlaklık)
  rmsContrast: number;         // 0.0 - 1.0 (Standart sapma / dinamik kontrast)
  shadowRatio: number;         // 0.0 - 1.0 (Zone 0-II gölge oranı)
  midtoneRatio: number;        // 0.0 - 1.0 (Zone III-VI orta ton oranı)
  highlightRatio: number;      // 0.0 - 1.0 (Zone VII-IX açık ton oranı)
  specularRatio: number;       // 0.0 - 1.0 (Noktasal ışık/parlak patlama oranı)
  skinRatio: number;           // 0.0 - 1.0 (İnsan ten rengi oranı)
  colorTempKelvin: number;     // Tahmini renk sıcaklığı (Kelvin)
  colorTempName: string;       // Örn: "3400K Sıcak Tungsten"
  meanSaturation: number;      // 0.0 - 1.0 (Ortalama renk doygunluğu)
  hasStrongDepthSeparation: boolean; // Ön/arka plan ayrımı belirgin mi?
}

export interface SmartRecipeSuggestion {
  sceneId: 'night_neon' | 'golden_portrait' | 'street_contrast' | 'nordic_cold' | 'highkey_pastel' | 'moody_gothic' | 'classic_analog';
  sceneTitle: string;
  confidencePercent: number;
  colorTempKelvin: number;
  colorTempName: string;
  lightingCondition: string;
  recommendedPreset: PresetKey;
  presetName: string;
  badge: string;
  explanation: string;
  sliderTweaks: Partial<SliderSettings>;
}

/**
 * Fotoğrafın piksel değerlerini 512px optimize tuval üzerinde analiz eder.
 * Histogram, kontrast, renk sıcaklığı ve ten pigmenti metriklerini çıkarır.
 */
export function extractPhotoFeatures(
  sourceCanvas: AnyCanvas,
  _width: number,
  _height: number,
  depthCanvas?: AnyCanvas | null
): PhotoFeatures {
  const sampleSize = 512;
  const sampleCanvas = createCompatibleCanvas(sampleSize, sampleSize);
  const ctx = sampleCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!ctx) {
    throw new Error('Görsel analiz tuvali oluşturulamadı.');
  }

  ctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, sampleSize, sampleSize);
  const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
  const data = imgData.data;
  const numPixels = sampleSize * sampleSize;

  let sumL = 0;
  let sumL2 = 0;
  let shadowCount = 0;
  let midtoneCount = 0;
  let highlightCount = 0;
  let specularCount = 0;
  let skinCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSat = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    sumR += r;
    sumG += g;
    sumB += b;

    // Photometric Luminance (Rec. 709)
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    sumL += l;
    sumL2 += l * l;

    if (l < 0.20) shadowCount++;
    else if (l > 0.85) {
      highlightCount++;
      if (l > 0.94) specularCount++;
    } else {
      midtoneCount++;
    }

    // Renk Doygunluğu (HSV S)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const sat = max > 0 ? delta / max : 0;
    sumSat += sat;

    // YCbCr İnsan Ten Kromotogramı
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    if (
      cr >= 133 &&
      cr <= 175 &&
      cb >= 77 &&
      cb <= 130 &&
      r > g &&
      g > b &&
      r - g >= 10
    ) {
      skinCount++;
    }
  }

  sampleCanvas.width = 0;
  sampleCanvas.height = 0;

  const meanL = sumL / numPixels;
  const variance = Math.max(0, sumL2 / numPixels - meanL * meanL);
  const rmsContrast = Math.sqrt(variance);

  const avgR = sumR / numPixels;
  const avgB = sumB / numPixels;

  // Renk Sıcaklığı (Kelvin) Yaklaşımı:
  // Kırmızı/Mavi oranına göre analog fotoğrafçılık Kelvin skalası
  const rbRatio = avgR / (avgB || 1);
  let colorTempKelvin = 5500;
  let colorTempName = '5500K Gün Işığı';

  if (rbRatio >= 1.6) {
    colorTempKelvin = 2800;
    colorTempName = '2800K Tungsten & Gece Işığı';
  } else if (rbRatio >= 1.35) {
    colorTempKelvin = 3400;
    colorTempName = '3400K Sıcak Altın Saat';
  } else if (rbRatio >= 1.15) {
    colorTempKelvin = 4500;
    colorTempName = '4500K Sıcak Gün Işığı';
  } else if (rbRatio >= 0.95) {
    colorTempKelvin = 5500;
    colorTempName = '5500K Nötr Gün Işığı';
  } else if (rbRatio >= 0.82) {
    colorTempKelvin = 6800;
    colorTempName = '6800K Bulutlu & Gölge';
  } else {
    colorTempKelvin = 8500;
    colorTempName = '8500K Soğuk Mavi Saat';
  }

  // Derinlik ayrımı kontrolü (Depth haritası varsa)
  let hasStrongDepthSeparation = false;
  if (depthCanvas) {
    try {
      const dCanvas = createCompatibleCanvas(128, 128);
      const dCtx = dCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (dCtx) {
        dCtx.drawImage(depthCanvas as CanvasImageSource, 0, 0, 128, 128);
        const dData = dCtx.getImageData(0, 0, 128, 128).data;
        let nearCount = 0;
        let farCount = 0;
        for (let i = 0; i < dData.length; i += 4) {
          const z = dData[i] / 255;
          if (z > 0.65) nearCount++;
          else if (z < 0.35) farCount++;
        }
        const total = 128 * 128;
        if (nearCount / total > 0.15 && farCount / total > 0.25) {
          hasStrongDepthSeparation = true;
        }
        dCanvas.width = 0;
        dCanvas.height = 0;
      }
    } catch {
      hasStrongDepthSeparation = false;
    }
  }

  return {
    meanLuminance: meanL,
    rmsContrast,
    shadowRatio: shadowCount / numPixels,
    midtoneRatio: midtoneCount / numPixels,
    highlightRatio: highlightCount / numPixels,
    specularRatio: specularCount / numPixels,
    skinRatio: skinCount / numPixels,
    colorTempKelvin,
    colorTempName,
    meanSaturation: sumSat / numPixels,
    hasStrongDepthSeparation
  };
}

/**
 * Çıkarılan metrikleri analog fotoğraf kurallarıyla değerlendirir,
 * en uygun film reçetesini ve ince ayarlanmış slider konfigürasyonunu üretir.
 */
export function analyzeAndRecommendRecipe(
  sourceCanvas: AnyCanvas,
  width: number,
  height: number,
  depthCanvas?: AnyCanvas | null
): SmartRecipeSuggestion {
  const f = extractPhotoFeatures(sourceCanvas, width, height, depthCanvas);

  // 1. Gece Şehir Işıkları / Neon Sahnesi (CineStill 800T Adayı)
  if (
    (f.meanLuminance < 0.42 && f.specularRatio >= 0.002) ||
    (f.meanLuminance < 0.30 && f.shadowRatio > 0.45 && f.specularRatio > 0.001)
  ) {
    const conf = Math.min(97, Math.round(75 + f.specularRatio * 2500 + f.shadowRatio * 15));
    return {
      sceneId: 'night_neon',
      sceneTitle: 'Gece & Neon Şehir Işıkları',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Düşük ortam ışığı ve noktasal parlak ışık kaynakları',
      recommendedPreset: 'cinestill',
      presetName: PRESETS.cinestill.name,
      badge: '🎬 CineStill 800T',
      explanation:
        'Koyu gölgeler içinde noktasal yapay ışık kaynakları saptandı. Rem-jet katmanı eksikliğinden doğan sıcak kızıl halasyon saçılması ve sinematik gece atmosferi için CineStill 800T reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'cinestill',
        exposure: 0,
        contrast: 5,
        saturation: 10,
        warmth: 8,
        bleachBypass: 0,
        lightLeak: 0,
        swirl: f.hasStrongDepthSeparation ? 35 : 15,
        proMist: 32,
        grain: 28,
        chromatic: 10,
        vignette: 24,
        skinProtection: f.skinRatio > 0.02 ? 50 : 0
      }
    };
  }

  // 2. Doğal Işık Portre & İnsan (Kodak Portra 400 Adayı)
  if (f.skinRatio >= 0.035 || (f.skinRatio >= 0.015 && f.hasStrongDepthSeparation)) {
    const conf = Math.min(96, Math.round(78 + f.skinRatio * 300));
    return {
      sceneId: 'golden_portrait',
      sceneTitle: 'Doğal Işık Portre & Ten Tonu',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Belirgin insan öznesi ve dengeli doğal ışık geçişi',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '🎞️ Kodak Portra 400',
      explanation:
        'Fotoğrafta insan ten pigmentleri ve odaklanmış özne dengesi tespit edildi. Ten tonlarını kadifemsi yumuşaklıkta korumak ve 35mm klasik sıcaklık katmak için Kodak Portra 400 reçetesi tavsiye ediliyor.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 2,
        contrast: 0,
        saturation: 0,
        warmth: 12,
        bleachBypass: 0,
        lightLeak: 0,
        skinProtection: 70,
        swirl: f.hasStrongDepthSeparation ? 40 : 20,
        proMist: 22,
        grain: 16,
        chromatic: 0,
        vignette: 14
      }
    };
  }

  // 3. Sert Sokak & Yüksek Dinamik Aralık (Daido Moriyama S/B Adayı)
  if (f.rmsContrast >= 0.25 && f.shadowRatio >= 0.28 && f.skinRatio < 0.04) {
    const conf = Math.min(95, Math.round(72 + f.rmsContrast * 80));
    return {
      sceneId: 'street_contrast',
      sceneTitle: 'Sert Sokak & Yüksek Kontrast',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Derin gölgeler, sert ışık kırılmaları ve yüksek kontrast',
      recommendedPreset: 'sb',
      presetName: PRESETS.sb.name,
      badge: '🖤 Moriyama S/B',
      explanation:
        'Yüksek kontrast aralığı ve grafiksel gölge formları analiz edildi. Daido Moriyama tarzı dramatik sokak estetiği, derin gümüş siyahları ve keskin analog gren dokusu için Moriyama S/B reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'sb',
        exposure: -2,
        contrast: 15,
        saturation: 0,
        warmth: 0,
        bleachBypass: 0,
        lightLeak: 0,
        skinProtection: 0,
        grain: 42,
        vignette: 28,
        swirl: 15,
        proMist: 0,
        chromatic: 20
      }
    };
  }

  // 4. Soğuk İskandinav Gün Işığı / Minimal Doğa (Leica Nordic Adayı)
  if (f.colorTempKelvin >= 6500 && f.rmsContrast < 0.24 && f.skinRatio < 0.05) {
    const conf = Math.min(93, Math.round(74 + (f.colorTempKelvin - 6000) * 0.006));
    return {
      sceneId: 'nordic_cold',
      sceneTitle: 'Kuzey Işığı & Dingin Doğa/Mimari',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Dağınık bulutlu gün ışığı ve soğuk mavi-gri ton ağırlığı',
      recommendedPreset: 'nordic',
      presetName: PRESETS.nordic.name,
      badge: '🌾 Leica Nordic',
      explanation:
        'Düşük renk doygunluğu ve serin gölge tonlaması saptandı. İskandinav laciverti derin gölgeler, saf beyazlar ve dingin melankoli için Leica Nordic reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'nordic',
        exposure: 0,
        contrast: 5,
        saturation: -5,
        warmth: -10,
        bleachBypass: 14,
        lightLeak: 0,
        grain: 16,
        proMist: 18,
        vignette: 16,
        swirl: 15,
        chromatic: 0,
        skinProtection: 40
      }
    };
  }

  // 5. Yüksek Anahtar & Pastel Rüyamsı (CSM Reze Adayı)
  if (f.meanLuminance >= 0.54 && f.shadowRatio < 0.16) {
    const conf = Math.min(94, Math.round(75 + f.meanLuminance * 30));
    return {
      sceneId: 'highkey_pastel',
      sceneTitle: 'Aydınlık High-Key & Pastel Işık',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Geniş aydınlık yüzeyler ve gölgesiz yumuşak geçişler',
      recommendedPreset: 'reze',
      presetName: PRESETS.reze.name,
      badge: '🌸 CSM Reze',
      explanation:
        'Geniş aydınlık alanlar ve yumuşak ton geçişleri tespit edildi. Rüyamsı sinematik pastel parlama ve açık ton zarafeti için CSM Reze reçetesi tavsiye ediliyor.',
      sliderTweaks: {
        preset: 'reze',
        exposure: 4,
        contrast: -5,
        saturation: 5,
        warmth: 6,
        bleachBypass: 0,
        lightLeak: 0,
        proMist: 28,
        grain: 12,
        skinProtection: 55,
        swirl: 20,
        chromatic: 0,
        vignette: 8
      }
    };
  }

  // 6. Karanlık Melankolik & Düşük Doygunluk (Gotik Adayı)
  if (f.meanLuminance < 0.36 && f.meanSaturation < 0.22) {
    const conf = Math.min(92, Math.round(72 + (0.4 - f.meanLuminance) * 60));
    return {
      sceneId: 'moody_gothic',
      sceneTitle: 'Melankoli & Gotik Atmosfer',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Ağır loş ortam ve düşük kromatik canlılık',
      recommendedPreset: 'gotik',
      presetName: PRESETS.gotik.name,
      badge: '❄️ Gotik',
      explanation:
        'Koyu ton yoğunluğu ve solgun renk yapısı analiz edildi. Ağır gümüş tutma hissi ve dondurucu siyahlar oluşturmak için Gotik banyo öneriliyor.',
      sliderTweaks: {
        preset: 'gotik',
        exposure: -3,
        contrast: 12,
        saturation: -15,
        warmth: -8,
        bleachBypass: 22,
        lightLeak: 0,
        grain: 24,
        proMist: 15,
        vignette: 32,
        swirl: 10,
        chromatic: 15,
        skinProtection: 30
      }
    };
  }

  // 7. Genel Analog Günlük Fotoğraf (Portra Dengeli Reçetesi)
  return {
    sceneId: 'classic_analog',
    sceneTitle: 'Klasik Günlük Işık & 35mm',
    confidencePercent: 88,
    colorTempKelvin: f.colorTempKelvin,
    colorTempName: f.colorTempName,
    lightingCondition: 'Doğal dengeli dinamik aralık ve orta ton zenginliği',
    recommendedPreset: 'analog',
    presetName: PRESETS.analog.name,
    badge: '🎞️ Kodak Portra 400',
    explanation:
      'Dengeli orta ton dağılımı ve doğal ışık yapısı belirlendi. Fotoğrafın dijital katılığını kırıp nostaljik 35mm film sıcaklığı kazandırmak için Kodak Portra reçetesi tavsiye ediliyor.',
    sliderTweaks: {
      preset: 'analog',
      exposure: 0,
      contrast: 0,
      saturation: 0,
      warmth: 8,
      bleachBypass: 0,
      lightLeak: 0,
      grain: 20,
      swirl: 25,
      proMist: 18,
      chromatic: 0,
      vignette: 15,
      skinProtection: 50
    }
  };
}
