import { AnyCanvas, AnyRenderingContext2D, CcdParams, FilmBorder, RenderTarget } from './types';
import { HeliosWebGPUEngine } from './webgpu/HeliosWebGPUEngine';


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

// 512x512 çok ölçekli (multi-scale) gümüş halojenür ve C-41 boya bulutu kristal tamponu
let sharedNoiseCanvas: AnyCanvas | null = null;

// Asimetrik Nutting-Weibull fotokimyasal granülarite tepki tablosu (Zone System)
const NUTTING_GRAIN_LUT = new Uint8Array(256);
for (let L = 0; L < 256; L++) {
  const norm = L / 255;
  // Koyu tonlarda (%15-%35 Zone III-V) zirve yapan, patlamış beyazlarda (%95+) yumuşak sönümlenen fotokimyasal yanıt
  const weight = Math.max(0, 4.2 * Math.pow(norm, 0.75) * Math.pow(1.0 - norm, 1.4));
  NUTTING_GRAIN_LUT[L] = Math.min(255, Math.round(weight * 255));
}

function getSharedNoiseCanvas(): AnyCanvas {
  if (!sharedNoiseCanvas) {
    const size = 512;
    sharedNoiseCanvas = createCompatibleCanvas(size, size);
    const ctx = sharedNoiseCanvas.getContext('2d') as AnyRenderingContext2D | null;
    if (ctx) {
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;

      // 1. Düşük frekanslı mezo kümelenme tablosu (128x128 -> toroidally dikişsiz kümelenme)
      const clumpGridSize = 128;
      const clumpGrid = new Float32Array(clumpGridSize * clumpGridSize);
      for (let i = 0; i < clumpGrid.length; i++) {
        let u1 = Math.random();
        while (u1 === 0) u1 = Math.random();
        const u2 = Math.random();
        clumpGrid[i] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      }

      // 2. Çok ölçekli kristal matrisi üretimi (%65 mikro tekil kristal + %35 mezo boya bulutu kümesi)
      for (let y = 0; y < size; y++) {
        const gy = (y / 4) % clumpGridSize;
        const gy0 = Math.floor(gy);
        const gy1 = (gy0 + 1) % clumpGridSize;
        const fy = gy - gy0;

        for (let x = 0; x < size; x++) {
          const gx = (x / 4) % clumpGridSize;
          const gx0 = Math.floor(gx);
          const gx1 = (gx0 + 1) % clumpGridSize;
          const fx = gx - gx0;

          // Çift doğrusal (bilinear) mezo kümelenme
          const c00 = clumpGrid[gy0 * clumpGridSize + gx0];
          const c10 = clumpGrid[gy0 * clumpGridSize + gx1];
          const c01 = clumpGrid[gy1 * clumpGridSize + gx0];
          const c11 = clumpGrid[gy1 * clumpGridSize + gx1];
          const meso = (1 - fy) * ((1 - fx) * c00 + fx * c10) + fy * ((1 - fx) * c01 + fx * c11);

          // Mikro kristal (Box-Muller Gauss)
          let u1 = Math.random();
          while (u1 === 0) u1 = Math.random();
          const u2 = Math.random();
          const micro = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

          const z = 0.65 * micro + 0.35 * meso;
          const baseVal = Math.min(255, Math.max(0, Math.round(128 + z * 52)));

          // C-41 renkli film boya bulutu mikro renk sapması (Sarı/Mavi katman saçılması)
          const chromaShift = Math.round(z * 3.5);
          const r = Math.min(255, Math.max(0, baseVal + chromaShift));
          const g = baseVal;
          const b = Math.min(255, Math.max(0, baseVal - chromaShift));

          const idx = (y * size + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
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
 * 🤖 3D Fiziksel Alan Derinliği (DoF) Maskesi Üretici.
 * Depth Anything V2 derinlik haritasını alır; seçilen odak düzlemi (focalDepth)
 * ve diyafram açıklığına (aperture) göre fiziksel lens bulanıklık maskesi üretir.
 */
export function generateDepthOfFieldMask(
  depthCanvas: AnyCanvas,
  width: number,
  height: number,
  focalDepth: number = 0.5,
  aperture: number = 50
): AnyCanvas {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));
  const safeFocalDepth = Math.max(0, Math.min(1.0, Number.isFinite(focalDepth) ? focalDepth : 0.5));
  const safeAperture = Math.max(0, Math.min(100, Number.isFinite(aperture) ? aperture : 50));

  const procW = Math.min(safeW, 1024);
  const procH = Math.max(1, Math.min(safeH, Math.round((procW * safeH) / safeW)));

  const sampleCanvas = createCompatibleCanvas(procW, procH);
  const sCtx = sampleCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!sCtx) return depthCanvas;

  sCtx.drawImage(depthCanvas as CanvasImageSource, 0, 0, procW, procH);
  const imgData = sCtx.getImageData(0, 0, procW, procH);
  const data = imgData.data;

  // Diyafram toleransı: aperture 100 (f/1.4 sığ DoF) -> tolerans 0.04
  // aperture 0 (f/16 geniş DoF) -> tolerans 0.35
  const apertureFactor = safeAperture / 100;
  const threshold = 0.35 - apertureFactor * 0.31;
  const falloff = 0.16;

  for (let i = 0; i < data.length; i += 4) {
    const z = data[i] / 255;
    const dist = Math.abs(z - safeFocalDepth);

    if (dist <= threshold) {
      data[i + 3] = 0;
    } else {
      const blurFactor = Math.min(1.0, (dist - threshold) / falloff);
      data[i + 3] = Math.round(255 * blurFactor);
    }
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }

  sCtx.putImageData(imgData, 0, 0);

  const outCanvas = createCompatibleCanvas(safeW, safeH);
  const oCtx = outCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!oCtx) return sampleCanvas;

  oCtx.imageSmoothingEnabled = true;
  oCtx.imageSmoothingQuality = 'high';
  oCtx.drawImage(sampleCanvas as CanvasImageSource, 0, 0, safeW, safeH);

  sampleCanvas.width = 0;
  sampleCanvas.height = 0;

  return outCanvas;
}

/**
 * 🤖 3D Fiziksel Alan Derinliği (DoF) Bulanıklık Motoru.
 * Odak dışındaki (arka plan ve ön plan) alanlara fiziksel diyafram toleransına göre
 * yumuşak, kremamsı optik bokeh uygular; odak noktasındaki özneyi iğne ucu kadar keskin tutar.
 */
export function applyDepthOfField(
  target: RenderTarget,
  depthMask: AnyCanvas,
  focalDepth: number = 0.5,
  aperture: number = 50
): void {
  // aperture 0 = f/16 (tüm sahne net, DoF etkisi sıfır)
  if (aperture <= 0) return;

  const { ctx, width: w, height: h } = target;
  const dofMask = generateDepthOfFieldMask(depthMask, w, h, focalDepth, aperture);

  const workCanvas = createCompatibleCanvas(w, h);
  const wCtx = workCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!wCtx) {
    dofMask.width = 0;
    dofMask.height = 0;
    return;
  }

  // Fiziksel lens CoC (Circle of Confusion) bulanıklığı
  const maxBlurPx = Math.max(3, Math.round(Math.min(w, h) * 0.022 * (aperture / 100)));

  wCtx.save();
  if ('filter' in wCtx) {
    wCtx.filter = `blur(${maxBlurPx}px)`;
  }
  wCtx.drawImage(target.canvas as CanvasImageSource, 0, 0);
  wCtx.restore();

  // Odak dışı maskesini uygula (Odaklanan nesne = alpha 0, arka/ön plan = alpha > 0)
  wCtx.globalCompositeOperation = 'destination-in';
  wCtx.drawImage(dofMask as CanvasImageSource, 0, 0);

  // Hedef tuvale pürüzsüzce mühürle
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(workCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // VRAM temizliği
  dofMask.width = 0;
  dofMask.height = 0;
  workCanvas.width = 0;
  workCanvas.height = 0;
}

/**
 * 🌀 Helios 44M-4 Merceğinin Kedi Gözü (Cat-Eye) ve Teğetsel Dönen Bokeh (Swirl) Optiği.
 * WebGPU donanım hızlandırması mevcutsa GPU shader ile sıfır vertex buffer tekniğiyle çalıştırır;
 * aksi takdirde tek çalışma tuvali, source-over koşu ortalaması (running average) ve
 * doğrudan destination-in ile %100 parlaklık korumalı, beyaz halkasız 2D yedek motoru işletir.
 */
export function applySwirlyBokeh(
  target: RenderTarget,
  intensity: number,
  depthMask?: AnyCanvas | null,
  focalDepth: number = 0.5,
  aperture: number = 50
): void {
  if (intensity <= 0) return;

  // 1. WebGPU Motoru: Donanım hızlandırmalı Vogel disk spiral bokeh
  const webgpuEngine = HeliosWebGPUEngine.getInstanceSync();
  if (webgpuEngine) {
    const success = webgpuEngine.renderToTarget(
      target,
      {
        intensity,
        focalDepth,
        aperture,
        catEye: 100
      },
      depthMask
    );
    if (success) return;
  }

  // 2. Optimize, Sıfır Beyaz Halka & VRAM Korumalı 2D Motor:
  const { ctx, width: w, height: h } = target;
  const cx = w / 2;
  const cy = h / 2;
  const minDim = Math.min(w, h);
  const centerRadius = minDim * 0.35;
  const maxRadius = Math.hypot(cx, cy);

  const workCanvas = createCompatibleCanvas(w, h);
  const wCtx = workCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!wCtx) return;

  // Teğetsel eliptik kayma parametreleri
  const steps = 4;
  const maxAngle = (intensity / 100) * (w > 2000 ? 3.0 : 2.2);
  const stretch = (intensity / 100) * 0.055;

  // 1. Temel katman (Orijinal görsel)
  wCtx.drawImage(target.canvas as CanvasImageSource, 0, 0);

  // 2. Çoklu açısal teğetsel & eliptik bükülme (Running Average ile %100 Parlaklık Koruması)
  // 'screen' harmanlama KULLANILMAZ! Screen modu pikselleri bembeyaz yakıp beyaz viynete yol açar.
  // Bunun yerine her örnek katmanı source-over ve 1/(k+1) normalizasyonuyla üst üste harmanlanır.
  let sampleCount = 1;
  for (let i = 1; i <= steps; i++) {
    const factor = i / steps;
    const angle = factor * maxAngle * (Math.PI / 180);
    const sX = 1.0 + factor * stretch;
    const sY = Math.max(0.72, 1.0 - factor * stretch);

    // Pozitif açısal kayma
    sampleCount++;
    wCtx.globalAlpha = 1.0 / sampleCount;
    wCtx.save();
    wCtx.translate(cx, cy);
    wCtx.rotate(angle);
    wCtx.scale(sX, sY);
    wCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
    wCtx.restore();

    // Negatif açısal kayma
    sampleCount++;
    wCtx.globalAlpha = 1.0 / sampleCount;
    wCtx.save();
    wCtx.translate(cx, cy);
    wCtx.rotate(-angle);
    wCtx.scale(sY, sX);
    wCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
    wCtx.restore();
  }

  // Opaklığı normale döndür
  wCtx.globalAlpha = 1.0;

  // 3. Odak Kalkanı / Maskeleme
  // 3D Derinlik haritası varsa fiziksel DoF maskesini kullan;
  // yoksa optik alan eğriliği (Field Curvature: merkez keskin, kenarlar dönen) radyal maskesini kullan.
  wCtx.globalCompositeOperation = 'destination-in';

  if (depthMask) {
    const dofMask = generateDepthOfFieldMask(depthMask, w, h, focalDepth, aperture);
    wCtx.drawImage(dofMask as CanvasImageSource, 0, 0);
    dofMask.width = 0;
    dofMask.height = 0;
  } else {
    const grad = wCtx.createRadialGradient(
      cx,
      cy,
      centerRadius * 0.45,
      cx,
      cy,
      maxRadius * 0.88
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.08)');
    grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.75)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 1.0)');

    wCtx.fillStyle = grad;
    wCtx.fillRect(0, 0, w, h);
  }

  // 4. Hedef tuvale pürüzsüzce mühürle
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(workCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // VRAM temizliği
  workCanvas.width = 0;
  workCanvas.height = 0;
}

// 256x256 toroidally dikişsiz dijital CCD kroma gürültüsü deseni
let sharedChromaCanvas: AnyCanvas | null = null;

function getSharedChromaCanvas(): AnyCanvas {
  if (!sharedChromaCanvas) {
    const size = 256;
    sharedChromaCanvas = createCompatibleCanvas(size, size);
    const ctx = sharedChromaCanvas.getContext('2d') as AnyRenderingContext2D | null;
    if (ctx) {
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Bağımsız dijital RGB kroma saçılması (mor, camgöbeği, yeşil ve mavi piksel benekleri)
        const nr = Math.min(255, Math.max(0, 128 + Math.round((Math.random() - 0.5) * 110)));
        const ng = Math.min(255, Math.max(0, 128 + Math.round((Math.random() - 0.5) * 80)));
        const nb = Math.min(255, Math.max(0, 128 + Math.round((Math.random() - 0.5) * 120)));
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
        data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }
  return sharedChromaCanvas;
}

/**
 * 📷 Erken Dönem CCD Sensör Simülatörü (Digicam 2004 & Cyber Flash Y2K).
 * 
 * 1. Sert Kırpılma (Hard Highlight Clipping): Eşik üzerindeki (luma > 230-240) pikselleri saf beyaza kenetleme.
 * 2. Dikey Elektron Taşması (Vertical CCD Smear): Aşırı parlak noktalardan geçen ince, mor/eflatun ve beyaz düşey ışık çizgileri.
 * 3. Kroma Gürültüsü (Chroma Speckle): Gölgelerde analog gren yerine mor/yeşil/mavi dijital piksel gürültüsü.
 * 4. Unsharp Mask Halesi: Kontrast kenarlarında yüksek geçiren filtre saçılması.
 */
export function applyCcdAesthetic(target: RenderTarget, params?: CcdParams): void {
  const { ctx, width: w, height: h } = target;
  const mode = params?.mode || 'ccd';
  const isY2K = mode === 'ccd_y2k';

  const clipThreshold = params?.highlightClipping ?? (isY2K ? 228 : 236);
  const smearIntensity = params?.verticalSmear ?? (isY2K ? 0.95 : 0.65);
  const chromaNoiseAmt = params?.chromaNoise ?? (isY2K ? 0.28 : 0.22);
  const unsharpAmount = params?.unsharpAmount ?? (isY2K ? 0.35 : 0.25);

  // 1. Parlaklık Analizi ve Dikey Smear Tespiti (Ölçeklenmiş hızlı analiz tuvali)
  const maxAnalysisDim = 1024;
  const scale = Math.min(1.0, maxAnalysisDim / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * scale));
  const ah = Math.max(1, Math.round(h * scale));

  const scratchCanvas = createCompatibleCanvas(aw, ah);
  const sCtx = scratchCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!sCtx) return;

  sCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, aw, ah);
  const imgData = sCtx.getImageData(0, 0, aw, ah);
  const data = imgData.data;

  // Dikey kolon doygunluk biriktiricisi (Smear çizgileri için)
  const colSaturation = new Float32Array(aw);

  // Hard clipping maskesi ve gölge kroma maskesi
  const clipMask = sCtx.createImageData(aw, ah);
  const clipData = clipMask.data;

  const shadowMask = sCtx.createImageData(aw, ah);
  const shadowData = shadowMask.data;

  for (let y = 0; y < ah; y++) {
    const rowOffset = y * aw;
    for (let x = 0; x < aw; x++) {
      const idx = (rowOffset + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Fotometrik lüminans
      const luma = (r * 54 + g * 183 + b * 19) >> 8;

      // 1. Sert Kırpılma (Hard Highlight Clipping)
      if (luma >= clipThreshold) {
        const excess = (luma - clipThreshold) / (255 - clipThreshold);
        colSaturation[x] += excess;

        clipData[idx] = 255;
        clipData[idx + 1] = 255;
        clipData[idx + 2] = 255;
        clipData[idx + 3] = 255; // Tam beyaz kenetlenme
      }

      // 3. Gölgelerde Kroma Benek Maskesi (luma < 75)
      if (luma < 75) {
        const shadowFactor = (75 - luma) / 75;
        shadowData[idx] = 255;
        shadowData[idx + 1] = 255;
        shadowData[idx + 2] = 255;
        shadowData[idx + 3] = Math.round(shadowFactor * 255);
      }
    }
  }

  // --- Adım 1: Sert Kırpılmış Beyazları Tuvale Bas ---
  sCtx.putImageData(clipMask, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratchCanvas as CanvasImageSource, 0, 0, w, h);
  ctx.restore();

  // --- Adım 2: Dikey Elektron Taşması (Vertical CCD Smear) ---
  // Aşırı doymuş piksellerin üzerinden geçen düşey mor/eflatun ve beyaz şeritler
  const smearMinEnergy = ah * 0.04;
  const smearPositions: { x: number; strength: number }[] = [];

  for (let x = 1; x < aw - 1; x++) {
    const energy = colSaturation[x];
    if (
      energy > smearMinEnergy &&
      energy >= colSaturation[x - 1] &&
      energy >= colSaturation[x + 1]
    ) {
      const strength = Math.min(1.0, energy / (ah * 0.22));
      smearPositions.push({ x: (x / aw) * w, strength });
    }
  }

  if (smearPositions.length > 0 && smearIntensity > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (const smear of smearPositions) {
      const alpha = smear.strength * smearIntensity;
      const lineWidth = Math.max(1.5, Math.round(w * 0.0018));

      // Dış halesi: Parlak magenta / eflatun CCD sızıntısı
      ctx.strokeStyle = `rgba(235, 40, 200, ${Math.min(0.75, alpha * 0.65)})`;
      ctx.lineWidth = lineWidth * 2.5;
      ctx.beginPath();
      ctx.moveTo(smear.x, 0);
      ctx.lineTo(smear.x, h);
      ctx.stroke();

      // İç çekirdek: Doymuş saf beyaz ışık yolu
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.9, alpha * 0.85)})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(smear.x, 0);
      ctx.lineTo(smear.x, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Adım 3: Gölgelerde Kroma Gürültüsü (Chroma Speckle) ---
  if (chromaNoiseAmt > 0) {
    sCtx.putImageData(shadowMask, 0, 0);

    const noiseCanvas = createCompatibleCanvas(w, h);
    const nCtx = noiseCanvas.getContext('2d') as AnyRenderingContext2D | null;
    if (nCtx) {
      const chromaPattern = nCtx.createPattern(getSharedChromaCanvas() as CanvasImageSource, 'repeat');
      if (chromaPattern) {
        nCtx.fillStyle = chromaPattern;
        nCtx.fillRect(0, 0, w, h);

        nCtx.globalCompositeOperation = 'destination-in';
        nCtx.drawImage(scratchCanvas as CanvasImageSource, 0, 0, w, h);

        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = chromaNoiseAmt;
        ctx.drawImage(noiseCanvas as CanvasImageSource, 0, 0);
        ctx.restore();
      }
      noiseCanvas.width = 0;
      noiseCanvas.height = 0;
    }
  }

  // --- Adım 4: Unsharp Mask Halesi (High-Pass Kenar Saçılması) ---
  if (unsharpAmount > 0) {
    ctx.save();
    ctx.filter = `contrast(${Math.round(100 + unsharpAmount * 60)}%) brightness(102%)`;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = unsharpAmount * 0.65;
    ctx.drawImage(target.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  // Bellek temizliği
  scratchCanvas.width = 0;
  scratchCanvas.height = 0;
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

  // Ayrışma katsayısı: merkez optik eksende 0, kenarlara doğru radyal kedi gözü prizma sapması
  const factor = (intensity / 100) * 0.014;
  if (factor <= 0) return;

  const redScale = 1.0 + factor;
  const cyanScale = Math.max(0.986, 1.0 - factor);

  // Kırmızı kanal tuvali (dışa genleşmiş)
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

  // Cyan kanal tuvali (içe büzülmüş)
  const cyanCanvas = createCompatibleCanvas(w, h);
  const cCtx = cyanCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!cCtx) {
    redCanvas.width = 0;
    redCanvas.height = 0;
    return;
  }

  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.scale(cyanScale, cyanScale);
  cCtx.drawImage(target.canvas as CanvasImageSource, -cx, -cy);
  cCtx.restore();

  cCtx.globalCompositeOperation = 'multiply';
  cCtx.fillStyle = '#00ffff';
  cCtx.fillRect(0, 0, w, h);

  // Kırmızı tuval üzerinde iki kanalı screen ile birleştir
  rCtx.globalCompositeOperation = 'screen';
  rCtx.drawImage(cyanCanvas as CanvasImageSource, 0, 0);

  cyanCanvas.width = 0;
  cyanCanvas.height = 0;

  // Merkez netliğini %100 koruyan radyal maske (Merkez çemberinde CA = 0)
  // Dış sınırda sert kenar kesilmesi olmaması için gradyan kenara doğru yumuşatılır
  const grad = rCtx.createRadialGradient(
    cx,
    cy,
    maxRadius * 0.25,
    cx,
    cy,
    maxRadius * 0.95
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.05)');
  grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.7)');
  grad.addColorStop(0.92, 'rgba(0, 0, 0, 0.95)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.5)'); // Kenarda tek kanal kalıntısını önle

  rCtx.globalCompositeOperation = 'destination-in';
  rCtx.fillStyle = grad;
  rCtx.fillRect(0, 0, w, h);

  // Hedefe mühürle
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(redCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  redCanvas.width = 0;
  redCanvas.height = 0;
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

  // Donanım hızlandırmalı difüzyon: 384px ara tuval bilinear filtreleme ile
  // ctx.filter desteklenmeyen tarayıcılarda bile yumuşak rüya parlaklığı sağlar
  const mistWidth = Math.min(384, Math.max(128, Math.round(w * 0.25)));
  const mistHeight = Math.max(1, Math.round((h * mistWidth) / w));
  const mistCanvas = createCompatibleCanvas(mistWidth, mistHeight);
  const mCtx = mistCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mCtx) return;

  mCtx.imageSmoothingEnabled = true;
  mCtx.imageSmoothingQuality = 'high';

  if ('filter' in mCtx) {
    mCtx.filter = 'brightness(0.9) contrast(2.4)';
  }
  mCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, mistWidth, mistHeight);

  const blurPx = Math.max(6, Math.round(w * 0.016 * (intensity / 100)));

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (intensity / 100) * 0.45;
  if ('filter' in ctx) {
    ctx.filter = `blur(${blurPx}px)`;
  }
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
  ctx.globalCompositeOperation = 'source-over';
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
 * 🌾 35mm Analog Film Greni (Asimetrik Nutting-Weibull Çan Eğrisi & Çözünürlükten Bağımsız Ölçekleme).
 * Siyahlarda ve patlamış beyazlarda sönümlenir, orta-koyu tonlarda (%18 gri Zone IV-V) organik kristal dokusu üretir.
 * 35mm negatif oranını koruyarak 48 MP baskı çıktısında da önizleme ile 1:1 aynı görsel sıklığı sağlar.
 */
export function applyFilmGrain(
  target: RenderTarget,
  noisePattern: CanvasPattern | null,
  opacity: number
): void {
  if (opacity <= 0 || !noisePattern) return;

  const { ctx, width: w, height: h } = target;

  // 1. Asimetrik Nutting-Weibull lüminans maskesi
  const maskWidth = Math.min(w, 800);
  const maskHeight = Math.max(1, Math.round((h * maskWidth) / w));
  const maskCanvas = createCompatibleCanvas(maskWidth, maskHeight);
  const mCtx = maskCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!mCtx) return;

  mCtx.drawImage(target.canvas as CanvasImageSource, 0, 0, maskWidth, maskHeight);
  const imgData = mCtx.getImageData(0, 0, maskWidth, maskHeight);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Rec. 709 Fotometrik Lüminans (Hızlı tam sayı çarpanları: 54*R + 183*G + 19*B >> 8)
    const lum = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
    const weight = NUTTING_GRAIN_LUT[lum];
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = weight;
  }
  mCtx.putImageData(imgData, 0, 0);

  // 2. Çözünürlükten bağımsız ölçekli gren tuvali
  // Standart 35mm negatif karesinde eni boyunca yaklaşık 1800 kristal kümesi yer alır.
  const grainCanvas = createCompatibleCanvas(w, h);
  const gCtx = grainCanvas.getContext('2d') as AnyRenderingContext2D | null;
  if (!gCtx) {
    maskCanvas.width = 0;
    maskCanvas.height = 0;
    return;
  }

  const grainScale = Math.max(1, Math.round(w / 1800));
  if (grainScale > 1) {
    gCtx.save();
    gCtx.scale(grainScale, grainScale);
    gCtx.fillStyle = noisePattern;
    gCtx.fillRect(0, 0, Math.ceil(w / grainScale), Math.ceil(h / grainScale));
    gCtx.restore();
  } else {
    gCtx.fillStyle = noisePattern;
    gCtx.fillRect(0, 0, w, h);
  }

  // Greni fotokimyasal lüminans maskesi ile sınırla
  gCtx.globalCompositeOperation = 'destination-in';
  gCtx.drawImage(maskCanvas as CanvasImageSource, 0, 0, w, h);

  // 3. Hedefe overlay moduyla yedir
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1.0, opacity * 1.6);
  ctx.drawImage(grainCanvas as CanvasImageSource, 0, 0);
  ctx.restore();

  // Bellek temizliği
  maskCanvas.width = 0;
  maskCanvas.height = 0;
  grainCanvas.width = 0;
  grainCanvas.height = 0;
}
