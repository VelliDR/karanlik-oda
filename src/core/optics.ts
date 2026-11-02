import { AnyCanvas, AnyRenderingContext2D, FilmBorder, RenderTarget } from './types';

/**
 * Tarayıcı penceresinde HTMLCanvasElement, Web Worker içinde ise OffscreenCanvas üretir.
 */
export function createCompatibleCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  throw new Error('Tuval oluşturulamadı: Ortamda ne OffscreenCanvas ne de DOM mevcut.');
}

// 512x512 organik gümüş halojenür kristal gren tamponu (Box-Muller Gauss dağılımı)
let sharedNoiseCanvas: AnyCanvas | null = null;

function getSharedNoiseCanvas(): AnyCanvas {
  if (!sharedNoiseCanvas) {
    const size = 512;
    sharedNoiseCanvas = createCompatibleCanvas(size, size);
    const ctx = sharedNoiseCanvas.getContext('2d') as AnyRenderingContext2D | null;
    if (ctx) {
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;

      // Box-Muller Gaussian dağılımı: Dijital beyaz gürültü yerine otantik gümüş kristal yoğunluğu
      for (let i = 0; i < data.length; i += 8) {
        let u1 = Math.random();
        let u2 = Math.random();
        while (u1 === 0) u1 = Math.random();

        const mag = Math.sqrt(-2.0 * Math.log(u1));
        const z0 = mag * Math.cos(2.0 * Math.PI * u2);
        const z1 = mag * Math.sin(2.0 * Math.PI * u2);

        // Ortalama 128, standart sapma ~42
        const val0 = Math.min(255, Math.max(0, Math.round(128 + z0 * 42)));
        const val1 = Math.min(255, Math.max(0, Math.round(128 + z1 * 42)));

        data[i] = val0;
        data[i + 1] = val0;
        data[i + 2] = val0;
        data[i + 3] = 36; // Doğal kristal opaklığı

        if (i + 4 < data.length) {
          data[i + 4] = val1;
          data[i + 5] = val1;
          data[i + 6] = val1;
          data[i + 7] = 36;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }
  return sharedNoiseCanvas;
}

export function createNoisePattern(ctx: AnyRenderingContext2D): CanvasPattern | null {
  const noiseCanvas = getSharedNoiseCanvas();
  return ctx.createPattern(noiseCanvas as CanvasImageSource, 'repeat');
}

/**
 * 🌀 Helios 44M-4 Merceğinin Kedi Gözü (Cat-Eye) ve Teğetsel Dönen Bokeh (Swirl) Optiği.
 * Merkezdeki nesneyi keskin korurken, kenarlardaki optik vinyet ve astigmatizm bükülmesini simüle eder.
 */
export function applySwirlyBokeh(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  const cx = w / 2;
  const cy = h / 2;
  const minDim = Math.min(w, h);
  const centerRadius = minDim * 0.35;
  const maxRadius = Math.hypot(cx, cy);

  const swirlCanvas = createCompatibleCanvas(w, h);
  const sCtx = swirlCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!sCtx) return;

  sCtx.drawImage(target.canvas as CanvasImageSource, 0, 0);

  // Kedi gözü astigmatizmi: Açısal teğetsel eliptik kayma
  const steps = 4;
  const maxAngle = (intensity / 100) * (w > 2000 ? 3.0 : 1.8);
  const stretch = (intensity / 100) * 0.045;

  sCtx.globalAlpha = 0.22;
  for (let i = -steps; i <= steps; i++) {
    if (i === 0) continue;
    const angle = (i / steps) * maxAngle * (Math.PI / 180);
    const sX = 1.0 + (Math.abs(i) / steps) * stretch;
    const sY = Math.max(0.88, 1.0 - (Math.abs(i) / steps) * stretch);

    sCtx.save();
    sCtx.translate(cx, cy);
    sCtx.rotate(angle);
    sCtx.scale(sX, sY); // Anamorfik kedi gözü elips deformasyonu
    sCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
    sCtx.restore();
  }
  sCtx.globalAlpha = 1.0;

  // Merkez netliğini koruyan, kenarlarda yumuşakça devreye giren radyal maske
  const maskCanvas = createCompatibleCanvas(w, h);
  const mCtx = maskCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mCtx) {
    swirlCanvas.width = 0;
    swirlCanvas.height = 0;
    return;
  }

  const grad = mCtx.createRadialGradient(
    cx,
    cy,
    centerRadius * 0.5,
    cx,
    cy,
    maxRadius * 0.85
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.08)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,1.0)');

  mCtx.fillStyle = grad;
  mCtx.fillRect(0, 0, w, h);

  const blendCanvas = createCompatibleCanvas(w, h);
  const bCtx = blendCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!bCtx) {
    swirlCanvas.width = 0;
    swirlCanvas.height = 0;
    maskCanvas.width = 0;
    maskCanvas.height = 0;
    return;
  }

  bCtx.drawImage(swirlCanvas as CanvasImageSource, 0, 0);
  bCtx.globalCompositeOperation = 'destination-in';
  bCtx.drawImage(maskCanvas as CanvasImageSource, 0, 0);

  ctx.save();
  ctx.drawImage(blendCanvas as CanvasImageSource, 0, 0);
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
 * ⚡ Radyal Kromatik Odak Sapması (Lateral Chromatic Aberration).
 * Merkez optik eksende netliği korur, kenarlara doğru prizmatik kırmızı/cyan ayrışması oluşturur.
 */
export function applyChromaticAberration(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.hypot(cx, cy);

  // Ayrışma katsayısı: merkezde 0, kenarlarda radyal artış
  const factor = (intensity / 100) * 0.015;
  const redScale = 1 + factor;
  const blueScale = Math.max(0.985, 1 - factor);

  // Kırmızı kanal tuvali (Dışa doğru hafifçe genleşir)
  const redCanvas = createCompatibleCanvas(w, h);
  const rCtx = redCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!rCtx) return;

  rCtx.save();
  rCtx.translate(cx, cy);
  rCtx.scale(redScale, redScale);
  rCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
  rCtx.restore();

  rCtx.globalCompositeOperation = 'multiply';
  rCtx.fillStyle = '#ff0000';
  rCtx.fillRect(0, 0, w, h);

  // Cyan kanal tuvali (İçe doğru hafifçe küçülür)
  const cyanCanvas = createCompatibleCanvas(w, h);
  const cCtx = cyanCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!cCtx) {
    redCanvas.width = 0;
    redCanvas.height = 0;
    return;
  }

  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.scale(blueScale, blueScale);
  cCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
  cCtx.restore();

  cCtx.globalCompositeOperation = 'multiply';
  cCtx.fillStyle = '#00ffff';
  cCtx.fillRect(0, 0, w, h);

  // İki kanalı birleştir (Merkezde üst üste biner, tam beyaz/orijinal renk kalır)
  const caCanvas = createCompatibleCanvas(w, h);
  const caCtx = caCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!caCtx) {
    redCanvas.width = 0;
    redCanvas.height = 0;
    cyanCanvas.width = 0;
    cyanCanvas.height = 0;
    return;
  }

  caCtx.drawImage(redCanvas as CanvasImageSource, 0, 0);
  caCtx.globalCompositeOperation = 'screen';
  caCtx.drawImage(cyanCanvas as CanvasImageSource, 0, 0);

  // Merkez netliğini %100 koruyan radyal maske (Merkez çemberinde CA = 0)
  const maskCanvas = createCompatibleCanvas(w, h);
  const mCtx = maskCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (mCtx) {
    const grad = mCtx.createRadialGradient(
      cx,
      cy,
      maxRadius * 0.25, // İç %25 bölge kesinlikle sıfır sapma
      cx,
      cy,
      maxRadius * 0.95
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.05)');
    grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 1.0)');

    mCtx.fillStyle = grad;
    mCtx.fillRect(0, 0, w, h);

    caCtx.globalCompositeOperation = 'destination-in';
    caCtx.drawImage(maskCanvas as CanvasImageSource, 0, 0);

    maskCanvas.width = 0;
    maskCanvas.height = 0;
  }

  ctx.save();
  ctx.drawImage(caCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // VRAM temizliği
  redCanvas.width = 0;
  redCanvas.height = 0;
  cyanCanvas.width = 0;
  cyanCanvas.height = 0;
  caCanvas.width = 0;
  caCanvas.height = 0;
}

/**
 * 🎬 CineStill 800T Çift Loblu (Dual-Lobe) Halasyon Algoritması.
 * Parlak ışıkların film tabanından geri sekerek kırmızı emülsiyonu yakmasını taklit eder.
 * Çekirdek ışığı beyaz korurken, sınır çizgilerine sıcak turuncu-kızıl kor ve dış kırmızı hare bırakır.
 */
export function applyHalation(target: RenderTarget): void {
  const { ctx, width: w, height: h } = target;

  // Adım 1: Yüksek parlaklıkları ve ışık kaynaklarını izole et (Thresholding)
  const hlWidth = Math.min(w, 1920);
  const hlHeight = Math.round((h * hlWidth) / w);
  const hlCanvas = createCompatibleCanvas(hlWidth, hlHeight);
  const hlCtx = hlCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!hlCtx) return;

  // Parlaklığı izole eden yüksek kontrastlı eşikleme
  hlCtx.filter = 'brightness(0.7) contrast(3.6)';
  hlCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, hlWidth, hlHeight);

  // Adım 2: Çift Kademeli Saçılma (Dual-Lobe Scatter)
  const glowCanvas = createCompatibleCanvas(w, h);
  const gCtx = glowCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!gCtx) {
    hlCanvas.width = 0;
    hlCanvas.height = 0;
    return;
  }

  // Lobe 1: İç Çekirdek Saçılması (Dar yarıçap, yoğun kehribar/turuncu-kırmızı)
  const innerBlur = Math.max(5, Math.round(w * 0.007));
  const innerCanvas = createCompatibleCanvas(w, h);
  const inCtx = innerCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (inCtx) {
    inCtx.filter = `blur(${innerBlur}px) brightness(1.6)`;
    inCtx.drawImage(hlCanvas as CanvasImageSource, 0, 0, w, h);
    inCtx.globalCompositeOperation = 'source-in';
    inCtx.fillStyle = '#ff4d00'; // Sıcak alev kırmızısı
    inCtx.fillRect(0, 0, w, h);

    gCtx.drawImage(innerCanvas as CanvasImageSource, 0, 0);
    innerCanvas.width = 0;
    innerCanvas.height = 0;
  }

  // Lobe 2: Dış Atmosferik Saçılma (Geniş yarıçap, derin kantaşı kırmızısı)
  const outerBlur = Math.max(14, Math.round(w * 0.022));
  const outerCanvas = createCompatibleCanvas(w, h);
  const outCtx = outerCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (outCtx) {
    outCtx.filter = `blur(${outerBlur}px) brightness(1.3)`;
    outCtx.drawImage(hlCanvas as CanvasImageSource, 0, 0, w, h);
    outCtx.globalCompositeOperation = 'source-in';
    outCtx.fillStyle = '#cc0022'; // Derin sinema kırmızı halesi
    outCtx.fillRect(0, 0, w, h);

    gCtx.globalCompositeOperation = 'screen';
    gCtx.globalAlpha = 0.75;
    gCtx.drawImage(outerCanvas as CanvasImageSource, 0, 0);
    outerCanvas.width = 0;
    outerCanvas.height = 0;
  }

  // Adım 3: Orijinal görsele yumuşak screen harmanlamasıyla mühürle
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.55;
  ctx.drawImage(glowCanvas as CanvasImageSource, 0, 0);
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
 * 🌫️ Black Pro-Mist / CineBloom: Sert dijital parlaklıkları kıran, gölgeleri çamurlaştırmadan koruyan sinematik difüzyon
 */
export function applyBlackProMist(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;

  const mistWidth = Math.min(w, 1600);
  const mistHeight = Math.round((h * mistWidth) / w);
  const mistCanvas = createCompatibleCanvas(mistWidth, mistHeight);
  const mCtx = mistCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mCtx) return;

  // Sadece orta ve yüksek ışıkları izole et, derin gölgeleri keserek kontrastı koru
  mCtx.filter = 'brightness(0.85) contrast(2.2)';
  mCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, mistWidth, mistHeight);

  const blurPx = Math.max(8, Math.round(w * 0.018 * (intensity / 100)));

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (intensity / 100) * 0.42;
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(mistCanvas as CanvasImageSource, 0, 0, w, h);
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

  const bwCanvas = createCompatibleCanvas(w, h);
  const bCtx = bwCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!bCtx) return;

  bCtx.filter = 'grayscale(100%) contrast(140%) brightness(105%)';
  bCtx.drawImage(target.canvas as CanvasImageSource, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.drawImage(bwCanvas as CanvasImageSource, 0, 0);
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
    const bSize = Math.max(12, Math.round(minDim * 0.04));
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);
  } else if (border === 'darkroom-black') {
    const bSize = Math.max(12, Math.round(minDim * 0.045));
    ctx.strokeStyle = '#050507';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bSize, bSize, w - bSize * 2, h - bSize * 2);
  } else if (border === 'kodak-35mm') {
    const bSize = Math.max(16, Math.round(minDim * 0.055));
    
    ctx.strokeStyle = '#0a0a0c';
    ctx.lineWidth = bSize;
    ctx.strokeRect(bSize / 2, bSize / 2, w - bSize, h - bSize);

    ctx.strokeStyle = 'rgba(255, 140, 20, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bSize - 2, bSize - 2, w - (bSize - 2) * 2, h - (bSize - 2) * 2);

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
 * 🕶️ Doğal Optik Vinyet Kararması (cos⁴(θ) düşüş kanunu).
 */
export function applyVignette(target: RenderTarget, intensity: number): void {
  if (intensity <= 0) return;

  const { ctx, width: w, height: h } = target;
  ctx.save();
  const radius = Math.hypot(w, h) * 0.58;
  const grad = ctx.createRadialGradient(
    w / 2,
    h / 2,
    radius * (1 - (intensity / 100) * 0.75),
    w / 2,
    h / 2,
    radius
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, `rgba(0,0,0,${(intensity / 100) * 0.25})`);
  grad.addColorStop(1, `rgba(0,0,0,${(intensity / 100) * 0.85})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * 🌾 35mm Analog Film Greni (Luminans-Uyarlamalı Çan Eğrisi).
 * Siyahlarda ve patlamış beyazlarda sönümlenir, orta tonlarda (%18 gri Zone V) organik kristal dokusu üretir.
 */
export function applyFilmGrain(
  target: RenderTarget,
  noisePattern: CanvasPattern | null,
  opacity: number
): void {
  if (opacity <= 0 || !noisePattern) return;

  const { ctx, width: w, height: h } = target;

  // 1. Luminans orta ton maskesi (L * (1 - L) çan eğrisi)
  const maskWidth = Math.min(w, 1920);
  const maskHeight = Math.round((h * maskWidth) / w);
  const maskCanvas = createCompatibleCanvas(maskWidth, maskHeight);
  const mCtx = maskCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mCtx) return;

  // Temel parlaklık (L)
  mCtx.filter = 'grayscale(100%)';
  mCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, maskWidth, maskHeight);

  // L * (1 - L) çarpımı: Siyah (0) ve beyaz (1) bölgeler 0'a iner, orta tonlar (0.5) 0.25'e çıkar
  mCtx.globalCompositeOperation = 'multiply';
  mCtx.filter = 'grayscale(100%) invert(100%) brightness(350%)';
  mCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, maskWidth, maskHeight);

  // 2. Gren tuvali
  const grainCanvas = createCompatibleCanvas(w, h);
  const gCtx = grainCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!gCtx) {
    maskCanvas.width = 0;
    maskCanvas.height = 0;
    return;
  }

  gCtx.fillStyle = noisePattern;
  gCtx.fillRect(0, 0, w, h);

  // Greni orta ton maskesi ile sınırla
  gCtx.globalCompositeOperation = 'destination-in';
  gCtx.drawImage(maskCanvas as CanvasImageSource, 0, 0, w, h);

  // 3. Hedefe overlay moduyla yedir
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1.0, opacity * 1.35);
  ctx.drawImage(grainCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // Bellek temizliği
  maskCanvas.width = 0;
  maskCanvas.height = 0;
  grainCanvas.width = 0;
  grainCanvas.height = 0;
}
