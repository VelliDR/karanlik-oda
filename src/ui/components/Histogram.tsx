import { useEffect, useRef, useState } from 'preact/hooks';
import { isRaw } from '../store';

interface HistogramProps {
  canvasElement?: HTMLCanvasElement | null;
  refreshKey?: any;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  showOnDesktopByDefault?: boolean;
}

export function Histogram({
  canvasElement,
  refreshKey,
  collapsible = false,
  defaultCollapsed = false,
  showOnDesktopByDefault = false
}: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasClippingShadows, setHasClippingShadows] = useState(false);
  const [hasClippingHighlights, setHasClippingHighlights] = useState(false);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (!collapsible) return false;
    if (typeof window !== 'undefined' && showOnDesktopByDefault && window.innerWidth >= 1024) {
      return false;
    }
    return defaultCollapsed;
  });

  useEffect(() => {
    const targetCanvas = canvasElement || (document.getElementById('editor-canvas') as HTMLCanvasElement | null);
    const histCanvas = canvasRef.current;
    if (!targetCanvas || !histCanvas || targetCanvas.width === 0 || targetCanvas.height === 0) return;

    const ctx = histCanvas.getContext('2d');
    if (!ctx) return;

    // Fast pixel downsampling to compute histogram without locking main thread
    const sampleSize = 128;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = sampleSize;
    offCanvas.height = sampleSize;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;

    try {
      offCtx.drawImage(targetCanvas, 0, 0, sampleSize, sampleSize);
      const imgData = offCtx.getImageData(0, 0, sampleSize, sampleSize);
      const data = imgData.data;

      const rHist = new Uint32Array(256);
      const gHist = new Uint32Array(256);
      const bHist = new Uint32Array(256);
      const lumaHist = new Uint32Array(256);

      let shadowClipped = 0;
      let highlightClipped = 0;
      const totalPixels = sampleSize * sampleSize;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

        rHist[r]++;
        gHist[g]++;
        bHist[b]++;
        lumaHist[luma]++;

        if (r === 0 && g === 0 && b === 0) shadowClipped++;
        if (r >= 254 && g >= 254 && b >= 254) highlightClipped++;
      }

      setHasClippingShadows(shadowClipped / totalPixels > 0.005);
      setHasClippingHighlights(highlightClipped / totalPixels > 0.005);

      // Find max bucket for scaling (ignore isolated spikes at 0 and 255)
      let maxVal = 1;
      for (let i = 2; i < 254; i++) {
        if (lumaHist[i] > maxVal) maxVal = lumaHist[i];
        if (rHist[i] > maxVal) maxVal = rHist[i];
        if (gHist[i] > maxVal) maxVal = gHist[i];
        if (bHist[i] > maxVal) maxVal = bHist[i];
      }

      const w = histCanvas.width;
      const h = histCanvas.height;

      ctx.clearRect(0, 0, w, h);

      // Background grid lines (EV stops / zones)
      ctx.strokeStyle = '#1F222E';
      ctx.lineWidth = 1;
      for (let step = 1; step <= 3; step++) {
        const x = (w / 4) * step;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Draw RGB channels with screen blending
      const drawChannel = (hist: Uint32Array, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * w;
          const y = h - (hist[i] / maxVal) * (h * 0.92);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      };

      ctx.globalCompositeOperation = 'screen';
      drawChannel(rHist, 'rgba(239, 68, 68, 0.45)');
      drawChannel(gHist, 'rgba(34, 197, 94, 0.45)');
      drawChannel(bHist, 'rgba(59, 130, 246, 0.45)');

      // Draw Luma outline
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * w;
        const y = h - (lumaHist[i] / maxVal) * (h * 0.92);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

    } catch (err) {
      // Canvas might be tainted or empty
    }
  }, [canvasElement, refreshKey]);

  return (
    <div class="relative bg-neutral-950 p-2 rounded-xl border border-neutral-800 overflow-hidden shadow-inner">
      <div
        class={`flex justify-between items-center text-[9px] font-mono text-neutral-400 px-1 ${
          collapsible ? 'cursor-pointer hover:text-neutral-200 select-none' : 'mb-1'
        }`}
        onClick={collapsible ? () => setIsCollapsed((c) => !c) : undefined}
      >
        <span class="flex items-center gap-1.5 font-bold">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          RGB / LUMA HİSTOGRAM
        </span>
        <div class="flex items-center gap-1.5">
          {isRaw.value && (
            <span class="px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-600/50 text-amber-300 font-bold text-[8px]">
              16-BIT RAW
            </span>
          )}
          {collapsible && (
            <span class="text-[8px] text-amber-400/90 font-mono bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded hover:bg-neutral-800 transition-colors">
              {isCollapsed ? '▼ Aç' : '▲ Gizle'}
            </span>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div class="mt-1.5 space-y-1">
          <div class="relative w-full h-16 sm:h-20 bg-neutral-900/60 rounded-lg overflow-hidden flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={256}
              height={80}
              class="w-full h-full object-fill"
            />

            {/* Shadow clipping indicator */}
            <div 
              class={`absolute bottom-1 left-1 w-2.5 h-2.5 rounded-sm transition-colors ${
                hasClippingShadows ? 'bg-blue-500 shadow-sm shadow-blue-400' : 'bg-neutral-800/40'
              }`}
              title={hasClippingShadows ? 'Gölge Detay Kaybı (Siyah Kırpılma Var)' : 'Gölgeler Güvende'}
            />

            {/* Highlight clipping indicator */}
            <div 
              class={`absolute top-1 right-1 w-2.5 h-2.5 rounded-sm transition-colors ${
                hasClippingHighlights ? 'bg-red-500 shadow-sm shadow-red-400 animate-pulse' : 'bg-neutral-800/40'
              }`}
              title={hasClippingHighlights ? 'Yüksek Işık Patlaması (Beyaz Kırpılma Var)' : 'Vurgular Güvende'}
            />
          </div>

          <div class="flex justify-between text-[7px] font-mono text-neutral-500 px-1">
            <span>Siyahlar (0)</span>
            <span>Gölgeler</span>
            <span>%18 Gri</span>
            <span>Açık Ton</span>
            <span>Beyazlar (255)</span>
          </div>
        </div>
      )}
    </div>
  );
}
