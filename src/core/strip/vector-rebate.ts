import { AnyRenderingContext2D, StripOrientation, StripOutputMode } from '../types';
import {
  CONTACT_SHEET_PAPER_MARGIN_MM,
  DEFAULT_STRIP_EDGE_TEXT,
  FILM_35MM_END_MARGIN_MM,
  FILM_35MM_FRAME_PITCH_MM,
  FILM_35MM_GATE_ACROSS_MM,
  FILM_35MM_GATE_ALONG_MM,
  FILM_35MM_REBATE_SIDE_MM,
  FILM_35MM_TOTAL_WIDTH_MM,
  PERF_KS_ACROSS_MM,
  PERF_KS_ALONG_MM,
  PERF_KS_OUTER_MARGIN_MM,
  PERF_KS_PITCH_MM,
  PERF_KS_RADIUS_MM,
  STRIP_COLORS
} from './constants';

export interface StripRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PerforationHole extends StripRect {
  r: number;
}

export interface StripLayoutGeometry {
  frameCount: number;
  orientation: StripOrientation;
  outputMode: StripOutputMode;
  pxPerMm: number;
  sheetWidth: number;
  sheetHeight: number;
  stripRect: StripRect;
  frameGates: StripRect[];
  perforations: PerforationHole[];
}

/**
 * Verilen kare sayısı, yönelim, çıktı modu ve hedef uzun kenar piksel değerine göre
 * 300 DPI ölçeklenebilir tam vektörel 35mm şerit geometrisini hesaplar.
 */
export function computeStripLayoutGeometry(
  frameCount: number,
  orientation: StripOrientation,
  outputMode: StripOutputMode,
  longEdgePx: number
): StripLayoutGeometry {
  const n = Math.max(1, frameCount);
  const stripLengthMm =
    FILM_35MM_END_MARGIN_MM * 2 +
    n * FILM_35MM_FRAME_PITCH_MM -
    (FILM_35MM_FRAME_PITCH_MM - FILM_35MM_GATE_ALONG_MM);
  const stripCrossMm = FILM_35MM_TOTAL_WIDTH_MM;

  const paperMarginMm = outputMode === 'contact' ? CONTACT_SHEET_PAPER_MARGIN_MM : 0.0;
  const totalAlongMm = stripLengthMm + paperMarginMm * 2;
  const totalAcrossMm = stripCrossMm + paperMarginMm * 2;

  const widthMm = orientation === 'horizontal' ? totalAlongMm : totalAcrossMm;
  const heightMm = orientation === 'horizontal' ? totalAcrossMm : totalAlongMm;

  const maxMm = Math.max(widthMm, heightMm);
  const pxPerMm = Math.max(2.0, longEdgePx / maxMm);

  const sheetWidth = Math.max(64, Math.round(widthMm * pxPerMm));
  const sheetHeight = Math.max(64, Math.round(heightMm * pxPerMm));

  const marginPx = Math.round(paperMarginMm * pxPerMm);
  const stripRect: StripRect =
    orientation === 'horizontal'
      ? {
          x: marginPx,
          y: marginPx,
          w: sheetWidth - marginPx * 2,
          h: sheetHeight - marginPx * 2
        }
      : {
          x: marginPx,
          y: marginPx,
          w: sheetWidth - marginPx * 2,
          h: sheetHeight - marginPx * 2
        };

  // Tüm kare pencereleri aynı tam sayı boyuta (gateW × gateH) yuvarlanır; böylece
  // kare sırası değiştirildiğinde her karenin piksel ızgarası bit-bazında %100 korunur.
  const gateAlongPx = Math.max(16, Math.round(FILM_35MM_GATE_ALONG_MM * pxPerMm));
  const gateAcrossPx = Math.max(16, Math.round(FILM_35MM_GATE_ACROSS_MM * pxPerMm));
  const rebateSidePx = Math.round(FILM_35MM_REBATE_SIDE_MM * pxPerMm);

  const frameGates: StripRect[] = [];
  for (let i = 0; i < n; i++) {
    const alongMm = FILM_35MM_END_MARGIN_MM + i * FILM_35MM_FRAME_PITCH_MM;
    const alongPx = Math.round(alongMm * pxPerMm);

    if (orientation === 'horizontal') {
      frameGates.push({
        x: stripRect.x + alongPx,
        y: stripRect.y + rebateSidePx,
        w: gateAlongPx,
        h: gateAcrossPx
      });
    } else {
      frameGates.push({
        x: stripRect.x + rebateSidePx,
        y: stripRect.y + alongPx,
        w: gateAcrossPx,
        h: gateAlongPx
      });
    }
  }

  // KS-1870 Perforasyon delikleri (boyunca kesintisiz 4.75 mm adım)
  const perforations: PerforationHole[] = [];
  const perfAlongPx = Math.max(2, PERF_KS_ALONG_MM * pxPerMm);
  const perfAcrossPx = Math.max(3, PERF_KS_ACROSS_MM * pxPerMm);
  const perfRadiusPx = Math.max(0.5, PERF_KS_RADIUS_MM * pxPerMm);
  const outerMarginPx = PERF_KS_OUTER_MARGIN_MM * pxPerMm;

  const firstPerfCenterMm = FILM_35MM_END_MARGIN_MM * 0.5 + PERF_KS_ALONG_MM * 0.5;
  const maxAlongMm = stripLengthMm - FILM_35MM_END_MARGIN_MM * 0.4;

  for (let posMm = firstPerfCenterMm; posMm <= maxAlongMm; posMm += PERF_KS_PITCH_MM) {
    const alongStartPx = posMm * pxPerMm - perfAlongPx * 0.5;
    if (orientation === 'horizontal') {
      const topY = stripRect.y + outerMarginPx;
      const botY = stripRect.y + stripRect.h - outerMarginPx - perfAcrossPx;
      perforations.push({
        x: stripRect.x + alongStartPx,
        y: topY,
        w: perfAlongPx,
        h: perfAcrossPx,
        r: perfRadiusPx
      });
      perforations.push({
        x: stripRect.x + alongStartPx,
        y: botY,
        w: perfAlongPx,
        h: perfAcrossPx,
        r: perfRadiusPx
      });
    } else {
      const leftX = stripRect.x + outerMarginPx;
      const rightX = stripRect.x + stripRect.w - outerMarginPx - perfAcrossPx;
      perforations.push({
        x: leftX,
        y: stripRect.y + alongStartPx,
        w: perfAcrossPx,
        h: perfAlongPx,
        r: perfRadiusPx
      });
      perforations.push({
        x: rightX,
        y: stripRect.y + alongStartPx,
        w: perfAcrossPx,
        h: perfAlongPx,
        r: perfRadiusPx
      });
    }
  }

  return {
    frameCount: n,
    orientation,
    outputMode,
    pxPerMm,
    sheetWidth,
    sheetHeight,
    stripRect,
    frameGates,
    perforations
  };
}

/**
 * Tüm tarayıcı ve Worker OffscreenCanvas ortamlarında %100 vektörel yuvarlatılmış dikdörtgen yolu.
 */
export function traceVectorRoundedRect(
  ctx: AnyRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * 35mm film şeridi tabanını, kağıt marjını (kontakt modunda) ve vektörel KS-1870
 * perforasyon deliklerini çizer. Hiçbir bitmap şablon kullanılmaz.
 */
export function drawStripBaseAndPerforations(
  ctx: AnyRenderingContext2D,
  layout: StripLayoutGeometry,
  isMonoBase: boolean
): void {
  const { sheetWidth, sheetHeight, stripRect, perforations, outputMode } = layout;

  ctx.save();
  if (outputMode === 'contact') {
    // Kontakt baskıda kağıt zemini (agrandizör ışığı almayan/az alan kenar bölgesi vs karanlık şerit gölgesi)
    // Kağıt katmanı (Faz 1) tüm sayfaya uygulanacağı için agrandizör öncesi poz haritasına uygun tonlar kullanılır:
    ctx.fillStyle = '#141518'; // Doğrudan agrandizör ışığı alan açıkta kalmış kağıt kenarı -> baskıda derin siyah çerçeve
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);

    // 35mm film şeridi kağıt üzerinde dururken opak/yarı-saydam taban ışığı tutar -> baskıda koyu gri/siyah şerit gövdesi
    ctx.fillStyle = STRIP_COLORS.contactStripMaskPrePrint;
    traceVectorRoundedRect(
      ctx,
      stripRect.x,
      stripRect.y,
      stripRect.w,
      stripRect.h,
      layout.pxPerMm * 0.8
    );
    ctx.fill();
  } else if (outputMode === 'negative') {
    const rgb = isMonoBase
      ? STRIP_COLORS.negativeMonoBaseRgb
      : STRIP_COLORS.negativeColorMaskRgb;
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);
  } else {
    ctx.fillStyle = STRIP_COLORS.positiveBase;
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);
  }

  // Perforasyon delikleri
  if (outputMode === 'contact') {
    // Kontakt baskıda deliklerden agrandizör ışığı doğrudan kağıda geçer -> kağıtta tam siyah delikler!
    ctx.fillStyle = '#030304';
  } else if (outputMode === 'negative') {
    ctx.fillStyle = STRIP_COLORS.negativePerforation;
  } else {
    ctx.fillStyle = STRIP_COLORS.positivePerforation;
  }

  for (const hole of perforations) {
    traceVectorRoundedRect(ctx, hole.x, hole.y, hole.w, hole.h, hole.r);
    ctx.fill();

    // Mikro-optik kesim kenarı çizgisi (vektörel)
    ctx.strokeStyle =
      outputMode === 'contact'
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = Math.max(0.75, layout.pxPerMm * 0.06);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * İsteğe bağlı Perforasyon Halasyonu:
 * Delik kenarlarından selüloz triasetat tabana sızan 650nm kırmızı/kehribar foton saçılmasını
 * vektörel radyal gradyanlarla üretir.
 */
export function drawVectorSprocketHalation(
  ctx: AnyRenderingContext2D,
  layout: StripLayoutGeometry
): void {
  const { perforations, pxPerMm, outputMode } = layout;
  ctx.save();
  ctx.globalCompositeOperation = outputMode === 'negative' ? 'multiply' : 'screen';

  const haloRadius = pxPerMm * 2.35;
  for (const hole of perforations) {
    const cx = hole.x + hole.w * 0.5;
    const cy = hole.y + hole.h * 0.5;
    const innerR = Math.min(hole.w, hole.h) * 0.35;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, haloRadius);

    if (outputMode === 'negative') {
      // Negatif görünümde sızan ışık gümüş yoğunluğunu artırır (daha koyu siyan/gri hale)
      grad.addColorStop(0.0, 'rgba(90, 150, 175, 0.42)');
      grad.addColorStop(0.45, 'rgba(130, 185, 205, 0.20)');
      grad.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');
    } else if (outputMode === 'contact') {
      // Kontakt baskı kağıt katmanı öncesinde gri-nötr saçılma (tonlama kağıt katmanından gelir)
      grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
      grad.addColorStop(0.42, 'rgba(210, 210, 210, 0.14)');
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    } else {
      // Pozitif şerit görünümünde 650nm kehribar-kızıl ışık sızıntısı
      grad.addColorStop(0.0, 'rgba(255, 195, 110, 0.34)');
      grad.addColorStop(0.42, 'rgba(235, 78, 28, 0.22)');
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawVectorTriangleMarker(
  ctx: AnyRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  direction: 'right' | 'down'
): void {
  const half = size * 0.5;
  ctx.beginPath();
  if (direction === 'right') {
    ctx.moveTo(cx - half, cy - half * 0.82);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + half * 0.82);
  } else {
    ctx.moveTo(cx - half * 0.82, cy - half);
    ctx.lineTo(cx + half * 0.82, cy - half);
    ctx.lineTo(cx, cy + half);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * 300 DPI saf vektörel kenar yazısı, hizalama üçgenleri ve kare numaraları (`1`, `1A`, `2`, `2A`...).
 */
export function drawVectorRebateMarkings(
  ctx: AnyRenderingContext2D,
  layout: StripLayoutGeometry,
  edgeText: string,
  isMonoBase: boolean
): void {
  const { frameGates, orientation, outputMode, pxPerMm, stripRect } = layout;
  const cleanLabel = (edgeText.trim() || DEFAULT_STRIP_EDGE_TEXT).slice(0, 40).toUpperCase();

  const fontSizePx = Math.max(7, pxPerMm * 1.12);
  const numFontSizePx = Math.max(7.5, pxPerMm * 1.22);
  const outerBandCenterOffsetPx = PERF_KS_OUTER_MARGIN_MM * 0.5 * pxPerMm;

  let textColor: string = STRIP_COLORS.positiveRebateText;
  if (outputMode === 'negative') {
    textColor = isMonoBase
      ? STRIP_COLORS.negativeMonoRebateText
      : STRIP_COLORS.negativeColorRebateText;
  } else if (outputMode === 'contact') {
    textColor = STRIP_COLORS.contactRebateExposureText;
  }

  ctx.save();
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';

  for (let i = 0; i < frameGates.length; i++) {
    const gate = frameGates[i];
    const frameNo = `${i + 1}`;
    const halfFrameNo = `${i + 1}A`;

    if (orientation === 'horizontal') {
      const topBandY = stripRect.y + outerBandCenterOffsetPx;
      const botBandY = stripRect.y + stripRect.h - outerBandCenterOffsetPx;

      // Üst kenar: Kurgusal/özel emülsiyon kodu + vektörel üçgen işaretçi
      ctx.font = `700 ${fontSizePx.toFixed(2)}px "JetBrains Mono", "Courier New", monospace`;
      ctx.textAlign = 'left';
      drawVectorTriangleMarker(ctx, gate.x + pxPerMm * 1.4, topBandY, pxPerMm * 0.95, 'right');
      ctx.fillText(cleanLabel, gate.x + pxPerMm * 2.6, topBandY);

      // Alt kenar: Kare numarası (merkez-sol) ve ara numara (1A, 2A... sağ)
      ctx.font = `800 ${numFontSizePx.toFixed(2)}px "JetBrains Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(frameNo, gate.x + gate.w * 0.28, botBandY);
      ctx.fillText(halfFrameNo, gate.x + gate.w * 0.76, botBandY);
    } else {
      // Dikey şerit: Metinler şerit akış yönüne paralel 90° döndürülerek vektörel çizilir
      const leftBandX = stripRect.x + outerBandCenterOffsetPx;
      const rightBandX = stripRect.x + stripRect.w - outerBandCenterOffsetPx;

      ctx.save();
      ctx.translate(leftBandX, gate.y + pxPerMm * 2.6);
      ctx.rotate(Math.PI * 0.5);
      ctx.font = `700 ${fontSizePx.toFixed(2)}px "JetBrains Mono", "Courier New", monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(cleanLabel, 0, 0);
      ctx.restore();

      drawVectorTriangleMarker(
        ctx,
        leftBandX,
        gate.y + pxPerMm * 1.3,
        pxPerMm * 0.95,
        'down'
      );

      ctx.save();
      ctx.translate(rightBandX, gate.y + gate.h * 0.28);
      ctx.rotate(Math.PI * 0.5);
      ctx.font = `800 ${numFontSizePx.toFixed(2)}px "JetBrains Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(frameNo, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(rightBandX, gate.y + gate.h * 0.76);
      ctx.rotate(Math.PI * 0.5);
      ctx.font = `800 ${numFontSizePx.toFixed(2)}px "JetBrains Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(halfFrameNo, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Kontakt Baskı Modu: Seçilen kare(ler) etrafına karanlık oda mumlu seçim kalemi
 * (Chinagraph / Grease Pencil) vektörel el çizimi halkası uygular.
 * Faz 1 kağıt baskısı tamamlandıktan SONRA kağıt yüzeyinin üstüne çizilir.
 */
export function drawVectorGreasePencilMarks(
  ctx: AnyRenderingContext2D,
  layout: StripLayoutGeometry,
  markedIndices: readonly number[]
): void {
  if (markedIndices.length === 0) return;

  const { frameGates, pxPerMm } = layout;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const idx of markedIndices) {
    const gate = frameGates[idx];
    if (!gate) continue;

    const pad = pxPerMm * 1.35;
    const x0 = gate.x - pad;
    const y0 = gate.y - pad;
    const x1 = gate.x + gate.w + pad;
    const y1 = gate.y + gate.h + pad;
    const over = pxPerMm * 1.65; // Karanlık oda kaleminin köşelerde hafif taşan el hareketi

    // 1. Katman: Ana mumlu kırmızı-turuncu kalem darbesi
    ctx.strokeStyle = STRIP_COLORS.greasePencilPrimary;
    ctx.lineWidth = Math.max(2.0, pxPerMm * 0.62);
    ctx.globalAlpha = 0.88;

    ctx.beginPath();
    // Üst kenar (hafif organik kavis)
    ctx.moveTo(x0 - over, y0 + pxPerMm * 0.22);
    ctx.bezierCurveTo(
      x0 + gate.w * 0.32,
      y0 - pxPerMm * 0.35,
      x0 + gate.w * 0.72,
      y0 + pxPerMm * 0.28,
      x1 + over,
      y0 - pxPerMm * 0.14
    );
    // Sağ kenar
    ctx.moveTo(x1 - pxPerMm * 0.15, y0 - over * 0.8);
    ctx.bezierCurveTo(
      x1 + pxPerMm * 0.32,
      y0 + gate.h * 0.35,
      x1 - pxPerMm * 0.24,
      y0 + gate.h * 0.72,
      x1 + pxPerMm * 0.18,
      y1 + over
    );
    // Alt kenar
    ctx.moveTo(x1 + over, y1 - pxPerMm * 0.18);
    ctx.bezierCurveTo(
      x0 + gate.w * 0.68,
      y1 + pxPerMm * 0.38,
      x0 + gate.w * 0.28,
      y1 - pxPerMm * 0.22,
      x0 - over,
      y1 + pxPerMm * 0.20
    );
    // Sol kenar
    ctx.moveTo(x0 + pxPerMm * 0.16, y1 + over * 0.85);
    ctx.bezierCurveTo(
      x0 - pxPerMm * 0.30,
      y0 + gate.h * 0.65,
      x0 + pxPerMm * 0.22,
      y0 + gate.h * 0.28,
      x0 - pxPerMm * 0.14,
      y0 - over * 0.75
    );
    ctx.stroke();

    // 2. Katman: İnce mum dokusu iç vurgu çizgisi
    ctx.strokeStyle = STRIP_COLORS.greasePencilHighlight;
    ctx.lineWidth = Math.max(1.0, pxPerMm * 0.24);
    ctx.globalAlpha = 0.55;
    ctx.stroke();
  }

  ctx.restore();
}
