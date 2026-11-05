import { PresetDefinition, PresetKey } from './types';

export const PRESETS: Record<PresetKey, PresetDefinition> = {
  none: {
    id: 'none',
    name: 'Orijinal',
    badge: 'RAW',
    filter: 'none',
    overlayColor: null,
    overlayOpacity: 0,
    blendMode: 'source-over',
    noise: 0,
    description: 'Ham fotoğraf, herhangi bir kimyasal banyo uygulanmamış'
  },
  sb: {
    id: 'sb',
    name: 'Moriyama S/B',
    badge: 'B&W',
    filter: 'grayscale(100%) contrast(165%) brightness(92%)',
    overlayColor: null,
    overlayOpacity: 0,
    blendMode: 'source-over',
    noise: 0.16,
    description: 'Daido Moriyama tarzı yüksek kontrastlı, sokak grenli siyah-beyaz'
  },
  analog: {
    id: 'analog',
    name: 'Kodak Portra',
    badge: '400',
    filter: 'contrast(102%) saturate(85%) sepia(10%) brightness(98%)',
    overlayColor: '#f5e6cc',
    overlayOpacity: 0.12,
    blendMode: 'multiply',
    noise: 0.08,
    description: 'Doğal ve yumuşak ten tonları, klasik 35mm film sıcaklığı'
  },
  reze: {
    id: 'reze',
    name: 'CSM Reze',
    badge: 'Anime',
    filter: 'contrast(95%) saturate(108%) brightness(102%)',
    overlayColor: '#ffebd8',
    overlayOpacity: 0.22,
    blendMode: 'screen',
    noise: 0.04,
    description: 'Pastel vurgular, rüya benzeri sinematik aydınlık'
  },
  vampir: {
    id: 'vampir',
    name: 'Vampir',
    badge: '🩸',
    filter: 'contrast(150%) saturate(220%) brightness(85%)',
    overlayColor: '#ff1100',
    overlayOpacity: 0.25,
    blendMode: 'color-burn',
    noise: 0.12,
    description: 'Kan kırmızısı gölgeler ve koyu gotik kontrast'
  },
  gotik: {
    id: 'gotik',
    name: 'Gotik',
    badge: '❄️',
    filter: 'contrast(135%) saturate(25%) brightness(80%)',
    overlayColor: '#05121a',
    overlayOpacity: 0.30,
    blendMode: 'multiply',
    noise: 0.08,
    description: 'Düşük doygunluk, dondurucu siyahlar ve melankoli'
  },
  nordic: {
    id: 'nordic',
    name: 'Leica Nordic',
    badge: '🌾',
    filter: 'contrast(92%) saturate(88%) brightness(102%)',
    overlayColor: '#002244',
    overlayOpacity: 0.14,
    blendMode: 'soft-light',
    noise: 0.05,
    description: 'İskandinav laciverti gölgeler, sıcak korunan ten tonları'
  },
  cinestill: {
    id: 'cinestill',
    name: 'CineStill 800T',
    badge: '🎬',
    filter: 'contrast(108%) saturate(115%) brightness(95%) hue-rotate(-8deg)',
    overlayColor: '#003366',
    overlayOpacity: 0.10,
    blendMode: 'color-burn',
    noise: 0.14,
    description: 'Tungsten film dengesi, gece ışıkları için kırmızı halasyon'
  },
  ccd: {
    id: 'ccd',
    name: 'Digicam 2004',
    badge: 'CCD',
    filter: 'contrast(115%) saturate(135%) brightness(102%)',
    overlayColor: '#0044aa',
    overlayOpacity: 0.08,
    blendMode: 'soft-light',
    noise: 0,
    description: '2000’ler Digicam CCD sensörü: Doygun renkler, derin gökyüzü mavisi ve kroma gürültüsü'
  },
  ccd_y2k: {
    id: 'ccd_y2k',
    name: 'Cyber Flash',
    badge: 'Y2K',
    filter: 'contrast(140%) saturate(110%) brightness(112%)',
    overlayColor: '#ffffff',
    overlayOpacity: 0.12,
    blendMode: 'screen',
    noise: 0,
    description: 'Y2K sert flaş estetiği: Patlamış parlaklıklar, sert kontrast ve dikey CCD taşması'
  }
};

