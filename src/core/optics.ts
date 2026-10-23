import { FilmBorder, RenderTarget } from './types';

// Paylaşılan tek bir 128x128 gren tuvali (sadece 64KB bellek harcar ve desen geçersiz kalmaz)
let sharedNoiseCanvas: HTMLCanvasElement | null = null;

function getSharedNoiseCanvas(): HTMLCanvasElement {
  if (!sharedNoiseCanvas) {
    sharedNoiseCanvas = document.createElement('canvas');
    sharedNoiseCanvas.width = 128;
    sharedNoiseCanvas.height = 128;
    const ctx = sharedNoiseCanvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.createImageData(128, 128);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const val = Math.floor(Math.random() * 255);
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 18;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }
  return sharedNoiseCanvas;
}

export function createNoisePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const noiseCanvas = getSharedNoiseCanvas();
  return ctx.createPattern(noiseCanvas, 'repeat');
}

/**
 * Helios 44M-4 merceğinin dairesel bükülme (Swirly Bokeh) optiğini simüle eder.
 */
export function applySwirlyBokeh(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(w, h) * 0.35;

  const swirlCanvas = document.createElement('canvas');
  swirlCanvas.width = w;
  swirlCanvas.height = h;
  const sCtx = swirlCanvas.getContext('2d');
  if (!sCtx) return;

  sCtx.drawImage(target.canvas, 0, 0);

  const steps = w > 2000 ? 2 : 4;
  const angleStep = (intensity / 100) * (w > 2000 ? 3.6 : 1.8);

  sCtx.globalAlpha = 0.25;
  for (let i = -steps; i <= steps; i++) {
    if (i === 0) continue;
    sCtx.save();
    sCtx.translate(cx, cy);
    sCtx.rotate((i * angleStep * Math.PI) / 180);
    sCtx.drawImage(target.canvas, -cx, -cy);
    sCtx.restore();
  }
  sCtx.globalAlpha = 1.0;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mCtx = maskCanvas.getContext('2d');
  if (!mCtx) return;

  const grad = mCtx.createRadialGradient(cx, cy, maxRadius * 0.4, cx, cy, maxRadius * 1.3);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');

  mCtx.fillStyle = grad;
  mCtx.fillRect(0, 0, w, h);

  const blendCanvas = document.createElement('canvas');
  blendCanvas.width = w;
  blendCanvas.height = h;
  const bCtx = blendCanvas.getContext('2d');
  if (!bCtx) return;

  bCtx.drawImage(swirlCanvas, 0, 0);
  bCtx.globalCompositeOperation = 'destination-in';
  bCtx.drawImage(maskCanvas, 0, 0);

  ctx.save();
  ctx.drawImage(blendCanvas, 0, 0);
  ctx.restore();

  // VRAM temizliği
  swirlCanvas.width = 0;
  swirlCanvas.height = 0;
  maskCanvas.width = 0;
  maskCanvas.height = 0;
  blendCanvas.width = 0;
  blendCanvas.height = 0;
}

/**
 * Eski manuel lenslerin odak ve renk sapması (Chromatic Aberration) etkisini canlandırır.
 */
export function applyChromaticAberration(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  const shift = (intensity / 100) * (w * 0.012);
  const scale = 1 + (shift / w) * 2;

  const redCanvas = document.createElement('canvas');
  redCanvas.width = w;
  redCanvas.height = h;
  const rCtx = redCanvas.getContext('2d');
  if (!rCtx) return;

  rCtx.save();
  rCtx.translate(w / 2, h / 2);
  rCtx.scale(scale, scale);
  rCtx.drawImage(target.canvas, -w / 2 - shift, -h / 2);
  rCtx.restore();

  rCtx.globalCompositeOperation = 'multiply';
  rCtx.fillStyle = '#ff0000';
  rCtx.fillRect(0, 0, w, h);

  const cyanCanvas = document.createElement('canvas');
  cyanCanvas.width = w;
  cyanCanvas.height = h;
  const cCtx = cyanCanvas.getContext('2d');
  if (!cCtx) return;

  cCtx.save();
  cCtx.translate(w / 2, h / 2);
  cCtx.scale(scale, scale);
  cCtx.drawImage(target.canvas, -w / 2 + shift, -h / 2);
  cCtx.restore();

  cCtx.globalCompositeOperation = 'multiply';
  cCtx.fillStyle = '#00ffff';
  cCtx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(redCanvas, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(cyanCanvas, 0, 0);
  ctx.restore();

  // VRAM temizliği
  redCanvas.width = 0;
  redCanvas.height = 0;
  cyanCanvas.width = 0;
  cyanCanvas.height = 0;
}

/**
 * CineStill 800T filmindeki rem-jet katmanının olmamasından kaynaklanan kırmızı halasyon parlaması.
 */
export function applyHalation(target: RenderTarget): void {
  const { ctx, width: w, height: h } = target;

  const hlCanvas = document.createElement('canvas');
  hlCanvas.width = w;
  hlCanvas.height = h;
  const hlCtx = hlCanvas.getContext('2d');
  if (!hlCtx) return;

  hlCtx.drawImage(target.canvas, 0, 0);
  hlCtx.globalCompositeOperation = 'difference';
  hlCtx.filter = 'brightness(0.25) contrast(2.5) grayscale(100%)';
  hlCtx.drawImage(target.canvas, 0, 0);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = w;
  glowCanvas.height = h;
  const gCtx = glowCanvas.getContext('2d');
  if (!gCtx) return;

  const blurSize = Math.max(8, Math.round(w * 0.015));
  gCtx.filter = `blur(${blurSize}px) brightness(1.5)`;
  gCtx.drawImage(hlCanvas, 0, 0);
  gCtx.globalCompositeOperation = 'source-in';
  gCtx.fillStyle = '#ff3300';
  gCtx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.4;
  ctx.drawImage(glowCanvas, 0, 0);
  ctx.restore();

  // VRAM temizliği
  hlCanvas.width = 0;
  hlCanvas.height = 0;
  glowCanvas.width = 0;
  glowCanvas.height = 0;
}

/**
 * ☀️ Işık Sızıntısı (Light Leaks) - Arka kapak süngerlerinin aşınmasıyla oluşan turuncu/kızıl ışık şeritleri
 */
export function applyLightLeak(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  ctx.save();

  const alpha = (intensity / 100) * 0.75;

  // Ana köşe patlaması (Sol üst / sol kenar ışık girişi)
  const leakRadius = Math.max(w, h) * 0.85;
  const mainGrad = ctx.createRadialGradient(-w * 0.1, h * 0.2, 0, -w * 0.1, h * 0.2, leakRadius);
  mainGrad.addColorStop(0, `rgba(255, 230, 160, ${alpha * 0.9})`);
  mainGrad.addColorStop(0.25, `rgba(255, 120, 20, ${alpha * 0.75})`);
  mainGrad.addColorStop(0.55, `rgba(255, 40, 0, ${alpha * 0.45})`);
  mainGrad.addColorStop(0.85, `rgba(180, 0, 60, ${alpha * 0.15})`);
  mainGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = mainGrad;
  ctx.fillRect(0, 0, w, h);

  // İkincil organik şerit (Film aralığı sızıntısı)
  const streakGrad = ctx.createLinearGradient(0, 0, w * 0.6, h);
  streakGrad.addColorStop(0, `rgba(255, 90, 0, ${alpha * 0.4})`);
  streakGrad.addColorStop(0.3, `rgba(255, 170, 50, ${alpha * 0.25})`);
  streakGrad.addColorStop(0.7, 'rgba(255, 50, 0, 0)');
  streakGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = streakGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

/**
 * 🌫️ Black Pro-Mist / CineBloom: Sert dijital parlaklıkları kıran, sinematik rüya difüzyonu
 */
export function applyBlackProMist(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;

  const mistCanvas = document.createElement('canvas');
  mistCanvas.width = Math.round(w / 2);
  mistCanvas.height = Math.round(h / 2);
  const mCtx = mistCanvas.getContext('2d');
  if (!mCtx) return;

  // Sadece en parlak alanları izole et
  mCtx.filter = 'brightness(0.9) contrast(1.6)';
  mCtx.drawImage(target.canvas, 0, 0, mistCanvas.width, mistCanvas.height);

  const blurPx = Math.max(6, Math.round(w * 0.02 * (intensity / 100)));

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (intensity / 100) * 0.45;
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(mistCanvas, 0, 0, w, h);
  ctx.restore();

  mistCanvas.width = 0;
  mistCanvas.height = 0;
}

/**
 * 🧪 Bleach Bypass (Gümüş Koruma): Düşük doygunluk, derin metalik gümüş kontrastı
 */
export function applyBleachBypass(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  const alpha = (intensity / 100) * 0.6;

  const bwCanvas = document.createElement('canvas');
  bwCanvas.width = w;
  bwCanvas.height = h;
  const bCtx = bwCanvas.getContext('2d');
  if (!bCtx) return;

  bCtx.filter = 'grayscale(100%) contrast(140%) brightness(105%)';
  bCtx.drawImage(target.canvas, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.drawImage(bwCanvas, 0, 0);
  ctx.restore();

  bwCanvas.width = 0;
  bwCanvas.height = 0;
}

/**
 * 📅 90'lar Quartz Date (Turuncu LED Tarih Damgası)
 */
export function applyQuartzDate(
  target: RenderTarget,
  enabled: boolean,
  dateText: string
): void {
  if (!enabled || !dateText.trim()) return;

  const { ctx, width: w, height: h } = target;
  ctx.save();

  // Dinamik ölçekleme (Görsel çözünürlüğüne orantılı)
  const fontSize = Math.max(14, Math.round(Math.min(w, h) * 0.032));
  const paddingX = Math.round(w * 0.04);
  const paddingY = Math.round(h * 0.04);

  ctx.font = `bold ${fontSize}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';

  const x = w - paddingX;
  const y = h - paddingY;

  // Turuncu LED ışıldaması (Glow effect)
  ctx.shadowColor = '#FF5500';
  ctx.shadowBlur = Math.max(4, Math.round(fontSize * 0.4));
  ctx.fillStyle = '#FF9933';
  ctx.fillText(dateText, x, y);

  // Merkez daha parlak kehribar çekirdek
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFCC66';
  ctx.fillText(dateText, x, y);

  ctx.restore();
}

/**
 * 🎞️ Çerçeve & 35mm Negatif Kenarlık (Film Borders)
 */
export function applyFilmBorder(target: RenderTarget, border: FilmBorder): void {
  if (border === 'none') return;

  const { ctx, width: w, height: h } = target;
  ctx.save();

  const minDim = Math.min(w, h);

  if (border === 'clean-white') {
    // Galeri beyaz paspartu çerçevesi
    const bSize = Math.max(12, Math.round(minDim * 0.04));
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);
  } else if (border === 'darkroom-black') {
    // Klasik sergi siyah çerçevesi
    const bSize = Math.max(12, Math.round(minDim * 0.045));
    ctx.strokeStyle = '#050507';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);

    // İnce beyaz iç paspartu çizgisi
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bSize, bSize, w - bSize * 2, h - bSize * 2);
  } else if (border === 'kodak-35mm') {
    // 35mm Negatif Film Şeridi Kenarlığı
    const bSize = Math.max(16, Math.round(minDim * 0.055));
    
    ctx.strokeStyle = '#0a0a0c';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);

    // Negatif çerçeve çizgisi
    ctx.strokeStyle = 'rgba(255, 140, 20, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bSize - 2, bSize - 2, w - (bSize - 2) * 2, h - (bSize - 2) * 2);

    // Üst ve alt kenar kodları (KODAK 400 - 24A)
    const codeFontSize = Math.max(9, Math.round(bSize * 0.42));
    ctx.font = `bold ${codeFontSize}px monospace`;
    ctx.fillStyle = 'rgba(255, 160, 40, 0.85)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.fillText('🎞️ KODAK 400 • DX-SAFETY', bSize + 8, bSize / 2);
    ctx.textAlign = 'right';
    ctx.fillText('▶ 24A', w - bSize - 8, h - bSize / 2);
  }

  ctx.restore();
}

/**
 * Mekanik vinyet kararması.
 */
export function applyVignette(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  ctx.save();
  const radius = Math.sqrt(w * w + h * h) * 0.55;
  const grad = ctx.createRadialGradient(
    w / 2,
    h / 2,
    radius * (1 - intensity / 100),
    w / 2,
    h / 2,
    radius
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${(intensity / 100) * 0.8})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * 35mm analog film greni kaplaması.
 */
export function applyFilmGrain(
  target: RenderTarget,
  noisePattern: CanvasPattern | null,
  opacity: number
): void {
  if (opacity <= 0 || !noisePattern) return;

  const { ctx, width: w, height: h } = target;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1.0, opacity);
  ctx.fillStyle = noisePattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
