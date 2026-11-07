import {
  ExportFormat,
  FilmBorder,
  PaperType,
  PresetKey
} from '../types';

/**
 * EditSettings v2 - Modüler Lightroom & Wabi-Sabi Karanlık Oda Ayar Şeması
 */
export interface EditSettingsDevelop {
  // Temel Işık
  exposure: number;     // -5.0 to +5.0 EV (UI: -100 to 100)
  contrast: number;     // -100 to 100
  highlights: number;   // -100 to 100 (Vurgu / Highlight Roll-off & Ton Haritalama)
  shadows: number;      // -100 to 100 (Gölge Detay Kurtarma)
  whites: number;       // -100 to 100 (Beyaz Kesilme Noktası)
  blacks: number;       // -100 to 100 (Siyah Taban Noktası)

  // Temel Renk
  temp: number;         // -100 to 100 (veya RAW'da Kelvin)
  kelvin?: number;      // 2000 to 50000 Kelvin (RAW doğrudan WB)
  tint: number;         // -100 to 100 (Yeşil <-> Magenta)
  vibrance: number;     // -100 to 100 (Akıllı Doygunluk / Ten Korumalı)
  saturation: number;   // -100 to 100 (Genel Doygunluk)
}

export interface EditSettingsEffects {
  texture: number;      // 0 to 100 (Yüksek frekans detay)
  clarity: number;      // -100 to 100 (Orta ton lokal kontrast)
  dehaze: number;       // -100 to 100 (Pus kırma)
  vignette: number;     // 0 to 100 (Mekanik vinyet)
  grain: number;        // 0 to 100 (35mm Nutting-Weibull kristal gren)
}

export interface EditSettingsAnalog {
  preset: PresetKey;
  presetAmount: number; // 0 to 100 (Emülsiyon karışım gücü)
  shoulder: number;     // 0 to 100 (H&D Film Omzu)
  halation: number;     // 0 to 100 (650nm Spektral Halasyon)
  lightLeak: number;    // 0 to 100 (Işık Sızıntısı)
  bleachBypass: number; // 0 to 100 (Gümüş Tutma)
  skinProtection: number; // 0 to 100 (Ten Kalkanı)
}

export interface EditSettingsOptics {
  swirl: number;        // 0 to 100 (Helios 44M)
  soapBubble: number;   // 0 to 100 (Sabun Köpüğü Halka Bokeh)
  loca: number;         // 0 to 100 (Boyuna Kromatik Sapma / LoCA)
  apertureBlades: number; // 0 = Dairesel, 6 = 44M, 8 = 44-2
  bladeCurvature: number; // 0 to 100
  chromatic: number;    // 0 to 100 (Kromatik Sapma)
  proMist: number;      // 0 to 100 (Black Pro-Mist)
  depth: {
    enabled: boolean;
    aperture: number;   // 0 to 100
    focalDepth: number; // 0.0 to 1.0
    showMap: boolean;
  };
}

export interface EditSettingsPaperPrint {
  enabled: boolean;
  exposure: number;       // -3.0 to +3.0 stop
  grade: number;          // -0.5 (00) to 5.0 (5)
  splitGrade: boolean;
  splitRatio: number;     // 0.0 to 1.0
  paperType: PaperType;
  paperTone: number;      // 0.0 to 1.0
  selenium: number;       // 0.0 to 1.0
  sepia: number;          // 0.0 to 1.0
}

export interface EditSettingsOutput {
  quartzDate: boolean;
  quartzDateText: string;
  filmBorder: FilmBorder;
  exportFormat: ExportFormat;
  exportQuality: number;
  dpi: number;
}

export interface EditSettings {
  version: 2;
  develop: EditSettingsDevelop;
  effects: EditSettingsEffects;
  analog: EditSettingsAnalog;
  optics: EditSettingsOptics;
  paperPrint: EditSettingsPaperPrint;
  output: EditSettingsOutput;
}

export const DEFAULT_EDIT_SETTINGS: EditSettings = {
  version: 2,
  develop: {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0
  },
  effects: {
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vignette: 0,
    grain: 0
  },
  analog: {
    preset: 'none',
    presetAmount: 100,
    shoulder: 0,
    halation: 0,
    lightLeak: 0,
    bleachBypass: 0,
    skinProtection: 0
  },
  optics: {
    swirl: 0,
    soapBubble: 0,
    loca: 0,
    apertureBlades: 0,
    bladeCurvature: 85,
    chromatic: 0,
    proMist: 0,
    depth: {
      enabled: false,
      aperture: 50,
      focalDepth: 0.5,
      showMap: false
    }
  },
  paperPrint: {
    enabled: false,
    exposure: 0,
    grade: 2.0,
    splitGrade: false,
    splitRatio: 0.5,
    paperType: 'rc-glossy',
    paperTone: 0,
    selenium: 0,
    sepia: 0
  },
  output: {
    quartzDate: false,
    quartzDateText: "'98 10 24",
    filmBorder: 'none',
    exportFormat: 'image/png',
    exportQuality: 1.0,
    dpi: 300
  }
};
