/**
 * HAZIR PRESET REÇETELERİ - SIFIR SPAGETTİ MİMARİSİ
 */
export const PRESETS = {
    none: {
        filter: 'none',
        overlayColor: null,
        overlayOpacity: 0,
        blendMode: 'normal',
        noise: 0
    },
    sb: {
        filter: 'grayscale(100%) contrast(165%) brightness(92%)',
        overlayColor: null,
        overlayOpacity: 0,
        blendMode: 'normal',
        noise: 0.16
    },
    analog: {
        filter: 'contrast(102%) saturate(85%) sepia(10%) brightness(98%)',
        overlayColor: '#f5e6cc',
        overlayOpacity: 0.12,
        blendMode: 'multiply',
        noise: 0.08
    },
    reze: {
        filter: 'contrast(95%) saturate(108%) brightness(102%)',
        overlayColor: '#ffebd8',
        overlayOpacity: 0.22,
        blendMode: 'screen',
        noise: 0.04
    },
    vampir: {
        filter: 'contrast(150%) saturate(220%) brightness(85%)',
        overlayColor: '#ff1100',
        overlayOpacity: 0.25,
        blendMode: 'color-burn',
        noise: 0.12
    },
    gotik: {
        filter: 'contrast(135%) saturate(25%) brightness(80%)',
        overlayColor: '#05121a',
        overlayOpacity: 0.30,
        blendMode: 'multiply',
        noise: 0.08
    },
    nordic: {
        // LEICA NORDIC COOL: Gölgeleri laciverte boyar, cildi sıcak korumak için kontrastı yumuşatır
        filter: 'contrast(92%) saturate(88%) brightness(102%)',
        overlayColor: '#002244', 
        overlayOpacity: 0.14,
        blendMode: 'soft-light', // Cilt tonunu bozmadan gölgeleri dondurur
        noise: 0.05
    },
    cinestill: {
        // CINESTILL 800T: Tungsten renk dengesi (maviye kayma) ve kırmızı halasyon desteği
        filter: 'contrast(108%) saturate(115%) brightness(95%) hue-rotate(-8deg)',
        overlayColor: '#003366',
        overlayOpacity: 0.10,
        blendMode: 'color-burn',
        noise: 0.14 // Sinematik yoğun gren
    }
};