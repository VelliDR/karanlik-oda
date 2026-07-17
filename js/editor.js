import { PRESETS } from './presets.js';

export class PhotoEditor {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.originalImg = null;
        this.previewImg = null;
        this.activeImg = null;
        this.noisePattern = null;

        // KORUMA YAMASI: Bellek şişmesini önleyen sabit tuval havuzu
        this._cachedCanvas1 = document.createElement('canvas');
        this._cachedCanvas2 = document.createElement('canvas');

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
            chromatic: 0, 
            preset: 'none'
        };
    }

    // Boyut değişimi aynı zamanda tuvali (context state dahil) otomatik temizler
    _getTempCanvas1(w, h) {
        this._cachedCanvas1.width = w;
        this._cachedCanvas1.height = h;
        return this._cachedCanvas1;
    }

    _getTempCanvas2(w, h) {
        this._cachedCanvas2.width = w;
        this._cachedCanvas2.height = h;
        return this._cachedCanvas2;
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
        
        noiseCanvas.width = 0;
        noiseCanvas.height = 0;
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

        const tempCanvas = this._getTempCanvas1(w, h);
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
        
        // JPEG %100 kalite ile kayıpsız transfer
        pImg.src = tempCanvas.toDataURL('image/jpeg', 1.0);
    }

    rotate() {
        if (!this.originalImg) return;

        const tempCanvas = this._getTempCanvas1(this.originalImg.height, this.originalImg.width);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
        tempCtx.rotate(90 * Math.PI / 180);
        tempCtx.drawImage(this.originalImg, -this.originalImg.width / 2, -this.originalImg.height / 2);

        const rotatedImg = new Image();
        rotatedImg.onload = () => {
            this.loadImage(rotatedImg);
        };
        
        // Rotasyon sırasında da tam kalite koruması
        rotatedImg.src = tempCanvas.toDataURL('image/jpeg', 1.0);
    }

    applyChromaticAberration(intensity) {
        if (intensity === 0) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const shift = (intensity / 100) * (w * 0.012);
        const scale = 1 + (shift / w) * 2;

        const redCanvas = this._getTempCanvas1(w, h);
        const rCtx = redCanvas.getContext('2d');
        
        rCtx.save();
        rCtx.translate(w / 2, h / 2);
        rCtx.scale(scale, scale);
        rCtx.drawImage(this.canvas, -w / 2 - shift, -h / 2);
        rCtx.restore();
        
        rCtx.globalCompositeOperation = 'multiply';
        rCtx.fillStyle = '#ff0000';
        rCtx.fillRect(0, 0, w, h);

        const cyanCanvas = this._getTempCanvas2(w, h);
        const cCtx = cyanCanvas.getContext('2d');
        
        cCtx.save();
        cCtx.translate(w / 2, h / 2);
        cCtx.scale(scale, scale);
        cCtx.drawImage(this.canvas, -w / 2 + shift, -h / 2);
        cCtx.restore();
        
        cCtx.globalCompositeOperation = 'multiply';
        cCtx.fillStyle = '#00ffff';
        cCtx.fillRect(0, 0, w, h);

        this.ctx.save();
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.drawImage(redCanvas, 0, 0);
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.drawImage(cyanCanvas, 0, 0);
        this.ctx.restore();
    }

    applyHalation() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        const hlCanvas = this._getTempCanvas1(w, h);
        const hlCtx = hlCanvas.getContext('2d');
        hlCtx.drawImage(this.canvas, 0, 0);
        hlCtx.globalCompositeOperation = 'difference';
        hlCtx.filter = 'brightness(0.25) contrast(2.5) grayscale(100%)';
        hlCtx.drawImage(this.canvas, 0, 0);

        const glowCanvas = this._getTempCanvas2(w, h);
        const gCtx = glowCanvas.getContext('2d');
        
        const blurSize = Math.max(8, Math.round(w * 0.015)); 
        gCtx.filter = `blur(${blurSize}px) brightness(1.5)`;
        gCtx.drawImage(hlCanvas, 0, 0);
        gCtx.globalCompositeOperation = 'source-in';
        gCtx.fillStyle = '#ff3300'; 
        gCtx.fillRect(0, 0, w, h);

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

        const swirlCanvas = this._getTempCanvas1(w, h);
        const sCtx = swirlCanvas.getContext('2d');
        sCtx.drawImage(this.canvas, 0, 0);

        const steps = w > 2000 ? 2 : 4; 
        const angleStep = (intensity / 100) * (w > 2000 ? 3.6 : 1.8); 
        
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

        const maskCanvas = this._getTempCanvas2(w, h);
        const mCtx = maskCanvas.getContext('2d');
        const grad = mCtx.createRadialGradient(cx, cy, maxRadius * 0.4, cx, cy, maxRadius * 1.3);
        grad.addColorStop(0, 'rgba(0,0,0,0)'); 
        grad.addColorStop(1, 'rgba(0,0,0,1)'); 
        mCtx.fillStyle = grad;
        mCtx.fillRect(0, 0, w, h);

        sCtx.save();
        sCtx.globalCompositeOperation = 'destination-in';
        sCtx.drawImage(maskCanvas, 0, 0);
        sCtx.restore();

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.drawImage(swirlCanvas, 0, 0);
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

        if (this.settings.swirl > 0) {
            this.applySwirlyBokeh(this.settings.swirl);
        }

        if (this.settings.chromatic > 0) {
            this.applyChromaticAberration(this.settings.chromatic);
        }

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
