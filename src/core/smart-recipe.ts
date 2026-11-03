import { AnyCanvas, PresetKey, SliderSettings } from './types';
import { PRESETS } from './presets';
import { createCompatibleCanvas } from './optics';

export interface PhotoFeatures {
  meanLuminance: number;            // 0.0 - 1.0 (Ortalama parlaklık)
  rmsContrast: number;              // 0.0 - 1.0 (Standart sapma / dinamik kontrast)
  shadowRatio: number;              // 0.0 - 1.0 (Zone 0-II gölge oranı)
  midtoneRatio: number;             // 0.0 - 1.0 (Zone III-VI orta ton oranı)
  highlightRatio: number;           // 0.0 - 1.0 (Zone VII-IX açık ton oranı)
  specularRatio: number;            // 0.0 - 1.0 (Noktasal ışık/parlak patlama oranı)
  skinRatio: number;                // 0.0 - 1.0 (İnsan ten rengi oranı)
  colorTempKelvin: number;          // Tahmini renk sıcaklığı (Kelvin)
  colorTempName: string;            // Örn: "3400K Sıcak Altın Saat"
  meanSaturation: number;           // 0.0 - 1.0 (Ortalama renk doygunluğu)
  redBias: number;                  // 0.0 - 1.0 (Kırmızı spektrum ağırlığı)
  greenBias: number;                // 0.0 - 1.0 (Yeşil spektrum ağırlığı)
  blueBias: number;                 // 0.0 - 1.0 (Mavi spektrum ağırlığı)
  centerLuminanceRatio: number;     // Merkez ışık / çevre ışık oranı
  hasStrongDepthSeparation: boolean;// 3D derinlik haritasında ön/arka plan ayrımı
  dominantSubjectDepth: number;     // 0.0 (sonsuz/arka plan) - 1.0 (ön plan)
}

export type SmartSceneId =
  | 'night_neon'
  | 'crimson_drama'
  | 'golden_hour'
  | 'golden_portrait'
  | 'nature_foliage'
  | 'summer_coastal'
  | 'cozy_tungsten'
  | 'street_contrast'
  | 'nordic_cold'
  | 'highkey_pastel'
  | 'moody_gothic'
  | 'wide_landscape'
  | 'classic_analog';

export interface SmartRecipeSuggestion {
  sceneId: SmartSceneId;
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
 * Histogram, kontrast, renk spektrum dağılımı, ten pigmenti ve 3D derinlik metriklerini çıkarır.
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

  // Merkez vs çevre ışık analizi
  let centerSumL = 0;
  let centerPixelCount = 0;
  let outerSumL = 0;
  let outerPixelCount = 0;
  const centerRadius = sampleSize * 0.28;

  try {
    ctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, sampleSize, sampleSize);
    const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const data = imgData.data;

    for (let y = 0; y < sampleSize; y++) {
      for (let x = 0; x < sampleSize; x++) {
        const idx = (y * sampleSize + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        sumR += r;
        sumG += g;
        sumB += b;

        // Photometric Luminance (Rec. 709)
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        sumL += l;
        sumL2 += l * l;

        const distFromCenter = Math.hypot(x - sampleSize / 2, y - sampleSize / 2);
        if (distFromCenter <= centerRadius) {
          centerSumL += l;
          centerPixelCount++;
        } else {
          outerSumL += l;
          outerPixelCount++;
        }

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

        const isSkin =
          cr >= 130 &&
          cr <= 180 &&
          cb >= 76 &&
          cb <= 134 &&
          r > g &&
          r > b &&
          r - g >= 3 &&
          r - b >= 5 &&
          g >= b - 15 &&
          l >= 0.08 &&
          l <= 0.96;
        if (isSkin) {
          skinCount++;
        }
      }
    }
  } catch (err) {
    console.warn('Görsel piksel analizi hatası, varsayılan değerlere geçiliyor:', err);
  } finally {
    sampleCanvas.width = 0;
    sampleCanvas.height = 0;
  }

  const meanL = sumL / numPixels;
  const variance = Math.max(0, sumL2 / numPixels - meanL * meanL);
  const rmsContrast = Math.sqrt(variance);

  const avgR = sumR / numPixels;
  const avgB = sumB / numPixels;

  const totalChannels = sumR + sumG + sumB || 1;
  const redBias = sumR / totalChannels;
  const greenBias = sumG / totalChannels;
  const blueBias = sumB / totalChannels;

  const meanCenterL = centerPixelCount > 0 ? centerSumL / centerPixelCount : 0.5;
  const meanOuterL = outerPixelCount > 0 ? outerSumL / outerPixelCount : 0.5;
  const centerLuminanceRatio = meanCenterL / (meanOuterL || 0.01);

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

  // 3D Derinlik Haritası Uzamsal Analizi (Varsa)
  let hasStrongDepthSeparation = false;
  let dominantSubjectDepth = 0.5;

  if (depthCanvas) {
    try {
      const dCanvas = createCompatibleCanvas(128, 128);
      const dCtx = dCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (dCtx) {
        dCtx.drawImage(depthCanvas as CanvasImageSource, 0, 0, 128, 128);
        const dData = dCtx.getImageData(0, 0, 128, 128).data;
        let nearCount = 0;
        let farCount = 0;
        let centerDepthSum = 0;
        let centerDepthCount = 0;

        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const z = dData[idx] / 255;
            if (z > 0.65) nearCount++;
            else if (z < 0.35) farCount++;

            // Merkez odak bölgesi derinliği
            if (x >= 44 && x <= 84 && y >= 44 && y <= 84) {
              centerDepthSum += z;
              centerDepthCount++;
            }
          }
        }

        const totalD = 128 * 128;
        if (nearCount / totalD > 0.12 && farCount / totalD > 0.22) {
          hasStrongDepthSeparation = true;
        }

        if (centerDepthCount > 0) {
          dominantSubjectDepth = centerDepthSum / centerDepthCount;
        }

        dCanvas.width = 0;
        dCanvas.height = 0;
      }
    } catch {
      hasStrongDepthSeparation = false;
      dominantSubjectDepth = 0.5;
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
    redBias,
    greenBias,
    blueBias,
    centerLuminanceRatio,
    hasStrongDepthSeparation,
    dominantSubjectDepth
  };
}

/**
 * Çıkarılan çok boyutlu metrikleri analog fotoğraf kurallarıyla değerlendirir,
 * en odaklı isabetle en uygun film reçetesini ve ince ayarlanmış slider konfigürasyonunu üretir.
 */
export function analyzeAndRecommendRecipe(
  sourceCanvas: AnyCanvas,
  width: number,
  height: number,
  depthCanvas?: AnyCanvas | null
): SmartRecipeSuggestion {
  const f = extractPhotoFeatures(sourceCanvas, width, height, depthCanvas);

  // 1. Gece Şehir Işıkları / Neon Sahnesi (CineStill 800T)
  if (
    (f.meanLuminance < 0.42 && f.specularRatio >= 0.0012) ||
    (f.meanLuminance < 0.32 && f.shadowRatio > 0.45 && f.specularRatio > 0.0006)
  ) {
    const conf = Math.min(98, Math.round(76 + f.specularRatio * 2800 + f.shadowRatio * 15));
    return {
      sceneId: 'night_neon',
      sceneTitle: 'Gece & Neon Şehir Işıkları',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Düşük ortam ışığı ve noktasal parlak yapay ışık kaynakları',
      recommendedPreset: 'cinestill',
      presetName: PRESETS.cinestill.name,
      badge: '🎬 CineStill 800T',
      explanation:
        'Karanlık gölgeler içinde noktasal yapay ışık patlamaları saptandı. Rem-jet katmanı eksikliğinden doğan sıcak kızıl halasyon saçılması ve sinematik gece atmosferi için CineStill 800T reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'cinestill',
        exposure: 0,
        contrast: 6,
        saturation: 10,
        warmth: 8,
        bleachBypass: 0,
        lightLeak: 0,
        swirl: f.hasStrongDepthSeparation ? 35 : 15,
        proMist: 32,
        grain: 26,
        chromatic: 12,
        vignette: 24,
        skinProtection: f.skinRatio > 0.02 ? 55 : 0
      }
    };
  }

  // 2. Koyu Sinematik Crimson & Gece Dramı (Vampir)
  if (
    f.meanLuminance < 0.42 &&
    f.redBias >= 0.38 &&
    f.redBias > f.blueBias * 1.30 &&
    f.redBias > f.greenBias * 1.20
  ) {
    const conf = Math.min(97, Math.round(74 + (f.redBias - 0.33) * 160 + f.shadowRatio * 15));
    return {
      sceneId: 'crimson_drama',
      sceneTitle: 'Koyu Sinematik Crimson & Gece Dramı',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Ağır loş ortam ve yoğun kırmızı dalga boyu hakimiyeti',
      recommendedPreset: 'vampir',
      presetName: PRESETS.vampir.name,
      badge: '🩸 Vampir Crimson',
      explanation:
        'Koyu gölgeler ve baskın kırmızı ışık enerjisi analiz edildi. Dramatik gotik kontrast, kan kırmızısı renk banyosu ve sinematik karanlık tonlama için Vampir reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'vampir',
        exposure: -2,
        contrast: 14,
        saturation: 15,
        warmth: 10,
        bleachBypass: 10,
        lightLeak: 0,
        swirl: f.hasStrongDepthSeparation ? 30 : 15,
        proMist: 20,
        grain: 30,
        chromatic: 15,
        vignette: 32,
        skinProtection: 35
      }
    };
  }

  // 3. Sıcak Altın Saat & Gün Batımı (Kodak Portra Altın Saat)
  if (
    f.colorTempKelvin <= 3600 &&
    f.redBias >= 0.37 &&
    f.meanLuminance >= 0.35 &&
    f.shadowRatio < 0.42 &&
    (f.highlightRatio > 0.08 || f.midtoneRatio > 0.45)
  ) {
    const conf = Math.min(97, Math.round(78 + (3800 - f.colorTempKelvin) * 0.012 + f.redBias * 25));
    return {
      sceneId: 'golden_hour',
      sceneTitle: 'Altın Saat & Gün Batımı Sıcaklığı',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Düşük açılı sıcak güneş ışığı, zengin kehribar parlaması',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '🌅 Altın Saat Portra',
      explanation:
        'Düşük açılı altın saat ışığı, zengin kehribar sıcaklığı ve yumuşak geçişli gölgeler belirlendi. Güneş arkadan vurduğunda oluşan organik ışık sızıntısı ve kadifemsi analog sıcaklık için Kodak Portra (Altın Saat) reçetesi tavsiye ediliyor.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 2,
        contrast: 2,
        saturation: 8,
        warmth: 20,
        lightLeak: 24,
        bleachBypass: 0,
        proMist: 26,
        grain: 16,
        swirl: f.hasStrongDepthSeparation ? 38 : 20,
        chromatic: 8,
        vignette: 16,
        skinProtection: 75
      }
    };
  }

  // 4. Doğal Işık Portre & İnsan (Kodak Portra 400)
  if (
    f.skinRatio >= 0.035 ||
    (f.skinRatio >= 0.016 && (f.hasStrongDepthSeparation || f.dominantSubjectDepth > 0.55))
  ) {
    const conf = Math.min(98, Math.round(80 + f.skinRatio * 280 + (f.hasStrongDepthSeparation ? 8 : 0)));
    return {
      sceneId: 'golden_portrait',
      sceneTitle: 'Doğal Işık Portre & Ten Tonu',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Belirgin insan öznesi ve dengeli doğal portre ışığı',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '🎞️ Kodak Portra 400',
      explanation:
        'Fotoğrafta insan ten pigmentleri ve odaklanmış özne dengesi saptandı. Ten tonlarını soğuk filtrelere karşı korumak, kadifemsi yumuşaklık ve Helios kedi gözü portre bokehi katmak için Kodak Portra 400 reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 2,
        contrast: 0,
        saturation: 2,
        warmth: 10,
        bleachBypass: 0,
        lightLeak: 0,
        skinProtection: 80,
        swirl: f.hasStrongDepthSeparation ? 42 : 22,
        proMist: 20,
        grain: 14,
        chromatic: 0,
        vignette: 15
      }
    };
  }

  // 5. Yemyeşil Doğa & Botanik Orman (Leica Nordic Botanik)
  if (
    f.greenBias >= 0.36 &&
    f.greenBias > f.redBias * 1.05 &&
    f.greenBias > f.blueBias * 1.05 &&
    f.skinRatio < 0.03
  ) {
    const conf = Math.min(96, Math.round(75 + (f.greenBias - 0.33) * 180 + f.meanSaturation * 20));
    return {
      sceneId: 'nature_foliage',
      sceneTitle: 'Yemyeşil Doğa & Botanik Orman',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Ağaçlık, yaprak veya botanik bitki örtüsü ağırlıklı doğal ışık',
      recommendedPreset: 'nordic',
      presetName: PRESETS.nordic.name,
      badge: '🌿 Leica Botanik',
      explanation:
        'Yoğun bitki örtüsü ve klorofil yeşili renk tonları analiz edildi. Yaprak detaylarındaki mikro-kontrastı artıran hafif gümüş tutma ve İskandinav laciverti derin gölge dengesi için Leica Nordic (Botanik) reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'nordic',
        exposure: 1,
        contrast: 6,
        saturation: 6,
        warmth: -4,
        bleachBypass: 8,
        lightLeak: 0,
        grain: 18,
        proMist: 14,
        vignette: 18,
        swirl: f.hasStrongDepthSeparation ? 30 : 8,
        chromatic: 0,
        skinProtection: 20
      }
    };
  }

  // 6. Güneşli Sahil & Berrak Deniz (Kodak Portra Sahil)
  if (
    f.blueBias >= 0.36 &&
    f.blueBias > f.redBias * 1.08 &&
    f.meanLuminance >= 0.48 &&
    f.highlightRatio > 0.14 &&
    f.skinRatio < 0.04
  ) {
    const conf = Math.min(95, Math.round(76 + (f.blueBias - 0.33) * 160 + f.meanLuminance * 20));
    return {
      sceneId: 'summer_coastal',
      sceneTitle: 'Güneşli Sahil & Berrak Deniz',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Açık deniz mavisi, berrak gökyüzü ve yüksek gün ışığı enerjisi',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '🌊 Ege / Sahil 35mm',
      explanation:
        'Turkuaz deniz tonları, açık gökyüzü ve canlı açık ton enerjisi saptandı. Açık tonları yumuşatan, gökyüzü mavisini koruyan ve nostaljik yaz günleri hissi veren 35mm sahil banyosu tavsiye ediliyor.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 2,
        contrast: 4,
        saturation: 8,
        warmth: 4,
        bleachBypass: 0,
        lightLeak: 15,
        proMist: 16,
        grain: 14,
        swirl: 18,
        chromatic: 0,
        vignette: 10,
        skinProtection: 65
      }
    };
  }

  // 7. Loş İç Mekan & Kafe Işığı (Kodak Portra Tungsten)
  if (
    f.colorTempKelvin <= 3200 &&
    f.meanLuminance < 0.48 &&
    f.redBias >= 0.37 &&
    f.skinRatio < 0.045 &&
    f.shadowRatio > 0.22
  ) {
    const conf = Math.min(94, Math.round(74 + (3400 - f.colorTempKelvin) * 0.01 + f.shadowRatio * 20));
    return {
      sceneId: 'cozy_tungsten',
      sceneTitle: 'Loş İç Mekan & Kafe Işığı',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Sarı-turuncu yapay tungsten aydınlatma ve loş iç mekan ambiyansı',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '☕ Sıcak Kafe & İç Mekan',
      explanation:
        'Sarı-turuncu yapay tungsten aydınlatma ve loş iç mekan ambiyansı belirlendi. Sıcak kahve tonları, samimi gölge yumuşatması ve Black Pro-Mist ışık yayılımı için Kodak Portra (Kafe) reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 1,
        contrast: 3,
        saturation: 4,
        warmth: 16,
        bleachBypass: 0,
        lightLeak: 0,
        grain: 22,
        swirl: f.hasStrongDepthSeparation ? 35 : 18,
        proMist: 24,
        chromatic: 0,
        vignette: 22,
        skinProtection: 50
      }
    };
  }

  // 8. Daido Moriyama Sert Sokak & Yüksek Kontrast (Moriyama S/B)
  if (f.rmsContrast >= 0.24 && f.shadowRatio >= 0.26 && f.skinRatio < 0.035) {
    const conf = Math.min(97, Math.round(74 + f.rmsContrast * 85));
    return {
      sceneId: 'street_contrast',
      sceneTitle: 'Sert Sokak & Yüksek Kontrast',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Derin gölgeler, sert ışık kırılmaları ve yüksek dinamik aralık',
      recommendedPreset: 'sb',
      presetName: PRESETS.sb.name,
      badge: '🖤 Moriyama S/B',
      explanation:
        'Yüksek dinamik aralık ve grafiksel gölge formları analiz edildi. Daido Moriyama tarzı dramatik sokak estetiği, derin gümüş siyahları ve keskin analog gren dokusu için Moriyama S/B reçetesi öneriliyor.',
      sliderTweaks: {
        preset: 'sb',
        exposure: -2,
        contrast: 18,
        saturation: 0,
        warmth: 0,
        bleachBypass: 0,
        lightLeak: 0,
        skinProtection: 0,
        grain: 45,
        vignette: 30,
        swirl: 15,
        proMist: 0,
        chromatic: 22
      }
    };
  }

  // 9. Sisli Kuzey Manzarası & Soğuk Mimari (Leica Nordic)
  if (f.colorTempKelvin >= 6400 && f.meanSaturation < 0.24 && f.skinRatio < 0.05) {
    const conf = Math.min(95, Math.round(74 + (f.colorTempKelvin - 6000) * 0.007));
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
        contrast: 6,
        saturation: -6,
        warmth: -12,
        bleachBypass: 16,
        lightLeak: 0,
        grain: 16,
        proMist: 18,
        vignette: 16,
        swirl: f.hasStrongDepthSeparation ? 20 : 8,
        chromatic: 0,
        skinProtection: 40
      }
    };
  }

  // 10. Aydınlık High-Key & Pastel Rüyamsı (CSM Reze)
  if (f.meanLuminance >= 0.54 && f.shadowRatio < 0.16) {
    const conf = Math.min(95, Math.round(75 + f.meanLuminance * 30));
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
        contrast: -4,
        saturation: 6,
        warmth: 6,
        bleachBypass: 0,
        lightLeak: 0,
        proMist: 28,
        grain: 12,
        skinProtection: 60,
        swirl: 22,
        chromatic: 0,
        vignette: 8
      }
    };
  }

  // 11. Melankoli & Gotik Atmosfer (Gotik)
  if (f.meanLuminance < 0.36 && f.meanSaturation < 0.22 && f.skinRatio < 0.04) {
    const conf = Math.min(94, Math.round(74 + (0.4 - f.meanLuminance) * 55));
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
        'Koyu ton yoğunluğu ve solgun renk yapısı analiz edildi. Ağır gümüş tutma hissi (Bleach Bypass) ve dondurucu siyahlar oluşturmak için Gotik banyo öneriliyor.',
      sliderTweaks: {
        preset: 'gotik',
        exposure: -3,
        contrast: 14,
        saturation: -18,
        warmth: -8,
        bleachBypass: 25,
        lightLeak: 0,
        grain: 26,
        proMist: 15,
        vignette: 34,
        swirl: 10,
        chromatic: 16,
        skinProtection: 30
      }
    };
  }

  // 12. Geniş Manzara & Sonsuz Odak (Portra Manzara)
  if (
    (f.dominantSubjectDepth < 0.34 || !f.hasStrongDepthSeparation) &&
    f.rmsContrast >= 0.17 &&
    f.skinRatio < 0.02 &&
    f.meanLuminance >= 0.35
  ) {
    const conf = Math.min(93, Math.round(76 + f.rmsContrast * 50));
    return {
      sceneId: 'wide_landscape',
      sceneTitle: 'Geniş Manzara & Sonsuz Derinlik',
      confidencePercent: conf,
      colorTempKelvin: f.colorTempKelvin,
      colorTempName: f.colorTempName,
      lightingCondition: 'Geniş açık alan, sonsuz derinlik ve zengin ufuk çizgisi',
      recommendedPreset: 'analog',
      presetName: PRESETS.analog.name,
      badge: '🏞️ 35mm Manzara',
      explanation:
        'Geniş ufuk çizgisi ve sonsuz netlik düzlemi tespit edildi. Manzara ufkunun bozulmaması için lens girdabı (swirl) sıfırlandı; zengin doğa dinamizmi, f/11 alan derinliği ve dengeli analog gren sağlandı.',
      sliderTweaks: {
        preset: 'analog',
        exposure: 1,
        contrast: 5,
        saturation: 4,
        warmth: 4,
        bleachBypass: 6,
        lightLeak: 0,
        grain: 14,
        swirl: 0,
        proMist: 10,
        chromatic: 0,
        vignette: 14,
        skinProtection: 20
      }
    };
  }

  // 13. Genel Analog Günlük Fotoğraf (Portra 400 Dengeli)
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
      'Dengeli orta ton dağılımı ve doğal gün ışığı yapısı belirlendi. Fotoğrafın dijital katılığını kırıp nostaljik 35mm film sıcaklığı kazandırmak için Kodak Portra reçetesi tavsiye ediliyor.',
    sliderTweaks: {
      preset: 'analog',
      exposure: 0,
      contrast: 0,
      saturation: 0,
      warmth: 8,
      bleachBypass: 0,
      lightLeak: 0,
      grain: 20,
      swirl: f.hasStrongDepthSeparation ? 30 : 15,
      proMist: 18,
      chromatic: 0,
      vignette: 15,
      skinProtection: 50
    }
  };
}
