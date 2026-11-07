import { PresetDefinition, PresetKey } from './types';

export const PRESETS: Record<PresetKey, PresetDefinition> = {
  none: {
    id: 'none',
    name: 'Orijinal',
    badge: '3D RAW',
    noise: 0,
    defaultShoulder: 0,
    defaultHalation: 0,
    sensitometry: {
      toeStrength: 0.0,
      gammaSlope: 1.0,
      shoulderRollOff: 0.55,
      dMin: 0.0,
      dMax: 1.0,
      highlightDesat: 0.45
    },
    description: 'Birebir saf orijinal negatif (H&D omuz sürgüsüyle yüksek ışıklar manuel sıkıştırılabilir)'
  },
  analog: {
    id: 'analog',
    name: 'Kodak Portra',
    badge: '400',
    noise: 0.08,
    defaultShoulder: 68,
    defaultHalation: 12,
    sensitometry: {
      toeStrength: 0.42,
      gammaSlope: 0.96,
      shoulderRollOff: 0.80,
      dMin: 0.016,
      dMax: 0.986,
      highlightDesat: 0.62
    },
    description: 'C-41 renkli negatif 3D LUT: Geniş H&D omuz toleransı, kadifemsi sıcak ten ve pastel açık tonlar'
  },
  kodachrome: {
    id: 'kodachrome',
    name: 'Kodachrome 64',
    badge: 'KR64',
    noise: 0.06,
    defaultShoulder: 58,
    defaultHalation: 8,
    sensitometry: {
      toeStrength: 0.28,
      gammaSlope: 1.15,
      shoulderRollOff: 0.68,
      dMin: 0.008,
      dMax: 0.992,
      highlightDesat: 0.48
    },
    description: 'Efsanevi K-14 dia 3D LUT: Arşivsel zengin kırmızılar, derin kobalt maviler ve kehribar-bronz ten'
  },
  velvia: {
    id: 'velvia',
    name: 'Fuji Velvia 50',
    badge: 'RVP50',
    noise: 0.05,
    defaultShoulder: 52,
    defaultHalation: 10,
    sensitometry: {
      toeStrength: 0.24,
      gammaSlope: 1.22,
      shoulderRollOff: 0.64,
      dMin: 0.005,
      dMax: 0.995,
      highlightDesat: 0.42
    },
    description: 'E-6 saydam 3D LUT: Yüksek klorofil zümrüt yeşili, derin alacakaranlık mavisi ve zengin gün batımı'
  },
  hp5: {
    id: 'hp5',
    name: 'Ilford HP5+',
    badge: '400 B&W',
    noise: 0.13,
    defaultShoulder: 66,
    defaultHalation: 14,
    sensitometry: {
      toeStrength: 0.46,
      gammaSlope: 1.04,
      shoulderRollOff: 0.82,
      dMin: 0.020,
      dMax: 0.982,
      highlightDesat: 1.0
    },
    description: 'Klasik İngiliz pankromatik S/B negatif 3D LUT: Geniş gümüş gri ton geçişi ve yumuşak omuz sönümlenmesi'
  },
  sb: {
    id: 'sb',
    name: 'Moriyama S/B',
    badge: 'Tri-X',
    noise: 0.18,
    defaultShoulder: 56,
    defaultHalation: 18,
    sensitometry: {
      toeStrength: 0.20,
      gammaSlope: 1.38,
      shoulderRollOff: 0.72,
      dMin: 0.006,
      dMax: 0.992,
      highlightDesat: 1.0
    },
    description: 'Daido Moriyama tarzı D-76 zorlama banyo (Push 1600) S/B 3D LUT: Dik H&D eğrisi ve gümüş kontrast'
  },
  cinestill: {
    id: 'cinestill',
    name: 'CineStill 800T',
    badge: '500T',
    noise: 0.14,
    defaultShoulder: 64,
    defaultHalation: 68,
    sensitometry: {
      toeStrength: 0.38,
      gammaSlope: 1.06,
      shoulderRollOff: 0.76,
      dMin: 0.014,
      dMax: 0.988,
      highlightDesat: 0.55
    },
    description: 'Kodak Vision3 500T tungsten 3D LUT + Rem-jet’siz 650nm spektral kırılmalı kırmızı halasyon'
  },
  nordic: {
    id: 'nordic',
    name: 'Leica Nordic',
    badge: 'NORDIC',
    noise: 0.06,
    defaultShoulder: 62,
    defaultHalation: 8,
    sensitometry: {
      toeStrength: 0.44,
      gammaSlope: 0.96,
      shoulderRollOff: 0.74,
      dMin: 0.018,
      dMax: 0.984,
      highlightDesat: 0.58
    },
    description: 'İskandinav arduvaz-lacivert gölgeler, adaçayı yeşilleri ve sıcak korunan parşömen açık tonlar'
  },
  reze: {
    id: 'reze',
    name: 'CSM Reze',
    badge: 'Pro400H',
    noise: 0.05,
    defaultShoulder: 76,
    defaultHalation: 22,
    sensitometry: {
      toeStrength: 0.52,
      gammaSlope: 0.90,
      shoulderRollOff: 0.86,
      dMin: 0.024,
      dMax: 0.980,
      highlightDesat: 0.70
    },
    description: 'Fuji Pro 400H aşırı pozlanmış pastel 3D LUT: Seladon-nane açık tonlar ve kremsi film omzu'
  },
  vampir: {
    id: 'vampir',
    name: 'Vampir',
    badge: 'E-6',
    noise: 0.12,
    defaultShoulder: 54,
    defaultHalation: 42,
    sensitometry: {
      toeStrength: 0.22,
      gammaSlope: 1.30,
      shoulderRollOff: 0.66,
      dMin: 0.008,
      dMax: 0.990,
      highlightDesat: 0.45
    },
    description: 'Çapraz banyo (Cross-Process) 3D LUT: Kan kırmızısı gölge boya kuplajı ve gotik gümüş kontrast'
  },
  gotik: {
    id: 'gotik',
    name: 'Gotik',
    badge: 'ENR',
    noise: 0.09,
    defaultShoulder: 58,
    defaultHalation: 10,
    sensitometry: {
      toeStrength: 0.30,
      gammaSlope: 1.18,
      shoulderRollOff: 0.70,
      dMin: 0.012,
      dMax: 0.978,
      highlightDesat: 0.75
    },
    description: 'Gümüş tutmalı ENR karanlık oda 3D LUT: Prusya mavisi soğuk gölgeler ve solgun metalik tonlar'
  },
  ccd: {
    id: 'ccd',
    name: 'Digicam 2004',
    badge: 'CCD',
    noise: 0,
    defaultShoulder: 14,
    defaultHalation: 0,
    sensitometry: {
      toeStrength: 0.14,
      gammaSlope: 1.14,
      shoulderRollOff: 0.28,
      dMin: 0.004,
      dMax: 0.998,
      highlightDesat: 0.18
    },
    description: '2000’ler ICX Bayer CCD 3D LUT: Kobalt gökyüzü mavisi, doygun birincil renkler ve kroma gürültüsü'
  },
  ccd_y2k: {
    id: 'ccd_y2k',
    name: 'Cyber Flash',
    badge: 'Y2K',
    noise: 0,
    defaultShoulder: 10,
    defaultHalation: 0,
    sensitometry: {
      toeStrength: 0.10,
      gammaSlope: 1.24,
      shoulderRollOff: 0.22,
      dMin: 0.003,
      dMax: 1.0,
      highlightDesat: 0.12
    },
    description: 'Y2K Xenon flaş 3D LUT: Dik CCD tepkisi, soğuk gümüş vurgular ve dikey elektron taşması'
  },
  custom_lut: {
    id: 'custom_lut',
    name: 'Özel .CUBE LUT',
    badge: '.CUBE',
    noise: 0.06,
    defaultShoulder: 62,
    defaultHalation: 12,
    sensitometry: {
      toeStrength: 0.32,
      gammaSlope: 1.0,
      shoulderRollOff: 0.70,
      dMin: 0.008,
      dMax: 0.992,
      highlightDesat: 0.50
    },
    description: 'Kullanıcı tarafından yüklenen harici 33³ / 65³ Adobe .CUBE 3D LUT profili ve tetrahedral eşleme'
  }
};
