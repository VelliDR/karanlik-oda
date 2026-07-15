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
        overlayColor: '#ff1100', // Saf kan kırmızı süzgeç
        overlayOpacity: 0.25,
        blendMode: 'color-burn', // Beyazları ve gölgeleri kırmızıyla ezer
        noise: 0.12
    },
    gotik: {
        filter: 'contrast(135%) saturate(25%) brightness(80%)',
        overlayColor: '#05121a', // Soğuk Gotik karanlık
        overlayOpacity: 0.30,
        blendMode: 'multiply',
        noise: 0.08
    }
};