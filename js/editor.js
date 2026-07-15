import { PRESETS } from './presets.js';

export class PhotoEditor {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.originalImg = null;
        this.previewImg = null;
        this.activeImg = null;
        this.noisePattern = null;

        this.resetSettings();
        this.initNoisePattern();
    }

    resetSettings() {
        this.settings = {
            exposure: 0,
            contrast: 0,
            saturation: 0,
            warmth: 0,
            vignette: 0,
            swirl: 0,
            chromatic: 0, // Renk Saçılması (0 - 100)
            preset: 'none'
        };
    }

    initNoisePattern() {
        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = 128;
        noiseCanvas.height = 128;
        const ctx = noiseCanvas.getContext('2d');
        const imgData = ctx.createImageData(128, 128);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            const val = Math.floor(Math.random() * 255);
            data[i] = val; data[i+1] = val; data[i+2] = val;
            data[i+3] = 15;
        }
        ctx.putImageData(imgData, 0, 0);
        this.noisePattern = this.ctx.createPattern(noiseCanvas, 'repeat');
    }

    loadImage(img, callback) {
        this.originalImg = img;
        const maxDim = 1000;
        let w = img.width;
        let h = img.height;

        if (w > maxDim || h > maxDim) {
            if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
            } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, w, h);

        const pImg = new Image();
        pImg.onload = () => {
            this.previewImg = pImg;
            this.activeImg = pImg; 
            this.canvas.width = w;
            this.canvas.height = h;
            this.render();
            if (callback) callback();
        };
        pImg.src = tempCanvas.toDataURL('image/jpeg', 0.85);
    }

    rotate() {
        if (!this.originalImg) return;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.originalImg.height;
        tempCanvas.height = this.originalImg.width;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
        tempCtx.rotate(90 * Math.PI / 180);
        tempCtx.drawImage(this.originalImg, -this.originalImg.width / 2, -this.originalImg.height / 2);

        const rotatedImg = new Image();
        rotatedImg.onload = () => {
            this.loadImage(rotatedImg);
        };
        rotatedImg.src = tempCanvas.toDataURL('image/jpeg');
    }

    // DONANIM HIZLANDIRMALI KROMATİK ABERSAYON (GPU Channel Shifting)
    applyChromaticAberration(intensity) {
        if (intensity === 0) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        // Çözünürlüğe duyarlı dinamik kayma miktarı (Max genliğin %1.2'si)
        const shift = (intensity / 100) * (w * 0.012);

        // 1. Kırmızı Kanal Tuvali (Sola Kaymış)
        const redCanvas = document.createElement('canvas');
        redCanvas.width = w;
        redCanvas.height = h;
        const rCtx = redCanvas.getContext('2d');
        rCtx.drawImage(this.canvas, -shift, 0);
        rCtx.globalCompositeOperation = 'multiply';
        rCtx.fillStyle = '#ff0000';
        rCtx.fillRect(0, 0, w, h);

        // 2. Cyan Kanal Tuvali (Sağa Kaymış)
        const cyanCanvas = document.createElement('canvas');
        cyanCanvas.width = w;
        cyanCanvas.height = h;
        const cCtx = cyanCanvas.getContext('2d');
        cCtx.drawImage(this.canvas, shift, 0);
        cCtx.globalCompositeOperation = 'multiply';
        cCtx.fillStyle = '#00ffff';
        cCtx.fillRect(0, 0, w, h);

        // 3. Kanalları screen harmanlamasıyla ana ekranda birleştir (Sıfır Piksel Döngüsü!)
        this.ctx.save();
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(redCanvas, 0, 0);
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.drawImage(cyanCanvas, 0, 0);
        this.ctx.restore();
    }

    // CINESTILL 800T KIRMIZI HALASYON (Highlights Detection & Screen Glow)
    applyHalation() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // 1. Parlak Işıkları İzole Et (Highlight Mask)
        const hlCanvas = document.createElement('canvas');
        hlCanvas.width = w;
        hlCanvas.height = h;
        const hlCtx = hlCanvas.getContext('2d');
        hlCtx.drawImage(this.canvas, 0, 0);
        hlCtx.globalCompositeOperation = 'difference';
        hlCtx.filter = 'brightness(0.25) contrast(2.5) grayscale(100%)';
        hlCtx.drawImage(this.canvas, 0, 0);

        // 2. Işıkları CineStill Kırmızısına Boya ve Flulaştır
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = w;
        glowCanvas.height = h;
        const gCtx = glowCanvas.getContext('2d');
        
        const blurSize = Math.max(8, Math.round(w * 0.015)); // Çözünürlükle ölçeklenen blur
        gCtx.filter = `blur(${blurSize}px) brightness(1.5)`;
        gCtx.drawImage(hlCanvas, 0, 0);
        gCtx.globalCompositeOperation = 'source-in';
        gCtx.fillStyle = '#ff3300'; // Sınırda patlayan gaz kırmızısı
        gCtx.fillRect(0, 0, w, h);

        // 3. Haleyi orijinal görselin üzerine mühürle
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.globalAlpha = 0.40;
        this.ctx.drawImage(glowCanvas, 0, 0);
        this.ctx.restore();
    }

    applySwirlyBokeh(intensity) {
        if (intensity === 0) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const maxRadius = Math.min(w, h) * 0.35; 

        const swirlCanvas = document.createElement('canvas');
        swirlCanvas.width = w;
        swirlCanvas.height = h;
        const sCtx = swirlCanvas.getContext('2d');

        sCtx.drawImage(this.canvas, 0, 0);

        const steps = 4; 
        const angleStep = (intensity / 100) * 1.8; 
        
        sCtx.globalAlpha = 0.25; 
        for (let i = -steps; i <= steps; i++) {
            if (i === 0) continue;
            sCtx.save();
            sCtx.translate(cx, cy);
            sCtx.rotate(i * angleStep * Math.PI / 180);
            sCtx.drawImage(this.canvas, -cx, -cy);
            sCtx.restore();
        }
        sCtx.globalAlpha = 1.0;

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mCtx = maskCanvas.getContext('2d');

        const grad = mCtx.createRadialGradient(cx, cy, maxRadius * 0.4, cx, cy, maxRadius * 1.3);
        grad.addColorStop(0, 'rgba(0,0,0,0)'); 
        grad.addColorStop(1, 'rgba(0,0,0,1)'); 

        mCtx.fillStyle = grad;
        mCtx.fillRect(0, 0, w, h);

        const blendCanvas = document.createElement('canvas');
        blendCanvas.width = w;
        blendCanvas.height = h;
        const bCtx = blendCanvas.getContext('2d');
        
        bCtx.drawImage(swirlCanvas, 0, 0);
        bCtx.globalCompositeOperation = 'destination-in';
        bCtx.drawImage(maskCanvas, 0, 0);

        this.ctx.save();
        this.ctx.drawImage(blendCanvas, 0, 0);
        this.ctx.restore();
    }

    render() {
        if (!this.activeImg) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.clearRect(0, 0, w, h);
        
        const preset = PRESETS[this.settings.preset] || PRESETS.none;

        const exp = 100 + this.settings.exposure;
        const con = 100 + this.settings.contrast;
        const sat = 100 + this.settings.saturation;

        let filterString = `brightness(${exp}%) contrast(${con}%) saturate(${sat}%)`;
        if (preset.filter !== 'none') {
            filterString += ` ${preset.filter}`;
        }

        this.ctx.filter = filterString;
        this.ctx.drawImage(this.activeImg, 0, 0, w, h);
        this.ctx.filter = 'none';

        if (this.settings.warmth !== 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'color';
            this.ctx.globalAlpha = Math.abs(this.settings.warmth) / 250;
            this.ctx.fillStyle = this.settings.warmth > 0 ? '#ffb300' : '#00b3ff';
            this.ctx.fillRect(0, 0, w, h);
            this.ctx.restore();
        }

        if (preset.overlayColor && preset.overlayOpacity > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = preset.blendMode;
            this.ctx.globalAlpha = preset.overlayOpacity;
            this.ctx.fillStyle = preset.overlayColor;
            this.ctx.fillRect(0, 0, w, h);
            this.ctx.restore();
        }

        // 1. Optik Kusur: Helios Swirl
        if (this.settings.swirl > 0) {
            this.applySwirlyBokeh(this.settings.swirl);
        }

        // 2. Optik Kusur: Chromatic Aberration
        if (this.settings.chromatic > 0) {
            this.applyChromaticAberration(this.settings.chromatic);
        }

        // 3. Film Etkisi: CineStill Halation (Yalnızca cinestill seçildiğinde otomatik devreye girer)
        if (this.settings.preset === 'cinestill') {
            this.applyHalation();
        }

        const activeNoise = preset.noise || 0;
        if (activeNoise > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'overlay';
            this.ctx.globalAlpha = activeNoise;
            this.ctx.fillStyle = this.noisePattern;
            this.ctx.fillRect(0, 0, w, h);
            this.ctx.restore();
        }

        if (this.settings.vignette > 0) {
            this.ctx.save();
            const radius = Math.sqrt(w*w + h*h) * 0.55;
            const grad = this.ctx.createRadialGradient(w/2, h/2, radius * (1 - this.settings.vignette / 100), w/2, h/2, radius);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, `rgba(0,0,0,${this.settings.vignette / 100 * 0.8})`);
            
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, w, h);
            this.ctx.restore();
        }
    }
}