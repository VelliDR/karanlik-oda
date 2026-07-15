import { PRESETS } from './presets.js';

export class PhotoEditor {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.originalImg = null;  // 16MP+ Orijinal
        this.previewImg = null;   // 1000px Akıcı Önizleme
        this.activeImg = null;    // O an çizilen resim referansı
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
            swirl: 0, // Helios Swirly Bokeh (0 - 100)
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

    // GÜVENLİ ASYNC YÜKLEME: .onload her zaman .src'den önce tanımlanır
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

    // KUSURSUZ OPAK BOKEH MOTORU (Radial Mask & Spin Blur)
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

        // Önce sızıntıyı önlemek için zemine %100 opak keskin görüntüyü basıyoruz
        sCtx.drawImage(this.canvas, 0, 0);

        const steps = 4; 
        const angleStep = (intensity / 100) * 1.8; // Maksimum 7.2 derecelik dairesel bükülme
        
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

        // Maske tuvali (Merkez şeffaf, kenarlar opak siyah)
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mCtx = maskCanvas.getContext('2d');

        const grad = mCtx.createRadialGradient(cx, cy, maxRadius * 0.4, cx, cy, maxRadius * 1.3);
        grad.addColorStop(0, 'rgba(0,0,0,0)'); 
        grad.addColorStop(1, 'rgba(0,0,0,1)'); 

        mCtx.fillStyle = grad;
        mCtx.fillRect(0, 0, w, h);

        // Birleştirme tuvali
        const blendCanvas = document.createElement('canvas');
        blendCanvas.width = w;
        blendCanvas.height = h;
        const bCtx = blendCanvas.getContext('2d');
        
        bCtx.drawImage(swirlCanvas, 0, 0);
        bCtx.globalCompositeOperation = 'destination-in';
        bCtx.drawImage(maskCanvas, 0, 0);

        // Sonucu ana tuvale giydiriyoruz
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

        // Helios bükülmesi renk ve pozlama katmanlarından hemen sonra, grenden önce tetiklenir
        if (this.settings.swirl > 0) {
            this.applySwirlyBokeh(this.settings.swirl);
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