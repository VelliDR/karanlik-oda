import { useRef, useEffect } from 'preact/hooks';
import {
  imageLoaded,
  isComparing,
  setComparing,
  isZoomed,
  toggleZoom,
  imageDimensions,
  isRaw,
  rawMetadata
} from '../store';


interface CanvasViewportProps {
  canvasRef: { current: HTMLCanvasElement | null };
  onFileDrop: (file: File) => void;
  onCanvasClick: (e: MouseEvent) => void;
  focusPoint?: { x: number; y: number } | null;
}

export function CanvasViewport({
  canvasRef,
  onFileDrop,
  onCanvasClick,
  focusPoint
}: CanvasViewportProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  const dims = imageDimensions.value;
  const raw = rawMetadata.value;

  // Handle Drag & Drop
  useEffect(() => {
    const el = dropzoneRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      el.classList.add('ring-2', 'ring-amber-500', 'bg-amber-950/20');
    };

    const onDragLeave = () => {
      el.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-950/20');
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-950/20');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        onFileDrop(file);
      }
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);

    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [onFileDrop]);

  // Spacebar compare listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && imageLoaded.value) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setComparing(true);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && imageLoaded.value) {
        setComparing(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div
      ref={dropzoneRef}
      class="bg-neutral-900/90 p-2 rounded-2xl border border-neutral-800 flex flex-col justify-center items-center min-h-[360px] lg:h-[640px] relative overflow-hidden select-none shadow-2xl group transition-all"
    >
      {/* Zoomable Canvas Wrapper */}
      <div
        ref={wrapperRef}
        class={`w-full h-full flex items-center justify-center overflow-auto transition-transform duration-200 relative ${
          isZoomed.value ? 'cursor-zoom-out' : 'cursor-zoom-in'
        }`}
        style={isZoomed.value ? { transform: 'scale(2.0)', transformOrigin: 'center center' } : undefined}
      >
        <canvas
          ref={canvasRef}
          id="editor-canvas"
          onClick={onCanvasClick}
          class="max-w-full max-h-[320px] lg:max-h-[600px] rounded-xl shadow-2xl bg-black/60 object-contain"
        />

        {/* 3D Depth Focus Indicator Ring */}
        {focusPoint && (
          <div
            class="pointer-events-none absolute w-10 h-10 -ml-5 -mt-5 rounded-full border-2 border-amber-400 bg-amber-400/20 shadow-lg shadow-amber-500/50 transition-all duration-300 z-30 animate-ping"
            style={{ left: `${focusPoint.x}px`, top: `${focusPoint.y}px` }}
          />
        )}
      </div>

      {/* Top Overlays: Compare & Zoom */}
      {imageLoaded.value && (
        <div class="absolute top-4 left-4 right-4 z-20 flex justify-between items-center pointer-events-none">
          {/* Karşılaştır Butonu */}
          <button
            type="button"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            class={`pointer-events-auto flex items-center gap-1 text-[10px] font-mono font-bold border px-3 py-1.5 rounded-xl backdrop-blur-md shadow-lg active:scale-95 transition-all cursor-pointer ${
              isComparing.value
                ? 'bg-amber-500 text-neutral-950 border-amber-400 ring-2 ring-amber-500/50'
                : 'bg-black/75 hover:bg-black/90 text-amber-300 border-neutral-700'
            }`}
            title="Orijinali görmek için basılı tutun (veya Boşluk tuşu)"
          >
            <span>👁️</span>
            <span>{isComparing.value ? 'ORİJİNAL NEGATİF' : 'Karşılaştır (Basılı Tut)'}</span>
          </button>

          {/* %100 Büyüteç Butonu */}
          <button
            type="button"
            onClick={toggleZoom}
            class={`pointer-events-auto flex items-center gap-1 text-[10px] font-mono font-bold border px-2.5 py-1.5 rounded-xl backdrop-blur-md shadow-lg active:scale-95 transition-all cursor-pointer ${
              isZoomed.value
                ? 'bg-amber-500 text-neutral-950 border-amber-400'
                : 'bg-black/75 hover:bg-black/90 text-neutral-300 hover:text-white border-neutral-700'
            }`}
            title="%100 Piksel Gren ve Netlik İnceleme"
          >
            <span>🔍</span>
            <span>{isZoomed.value ? '%100 Büyütüldü' : '%100 Büyüteç'}</span>
          </button>
        </div>
      )}

      {/* Resolution & Color Space Badge */}
      {imageLoaded.value && (
        <div class="absolute bottom-4 left-4 z-20 text-[9px] font-mono bg-black/75 text-neutral-300 px-2.5 py-1 rounded-lg border border-neutral-700 backdrop-blur-sm flex items-center gap-2">
          <span>{dims.width} × {dims.height}</span>
          <span class="text-neutral-500">•</span>
          <span class="text-emerald-400 font-bold">
            {isRaw.value ? 'RAW (16-BIT)' : 'Display P3'}
          </span>
          {isRaw.value && raw && (
            <>
              <span class="text-neutral-500">•</span>
              <span class="text-amber-400 font-semibold">{raw.model}</span>
            </>
          )}
        </div>
      )}

      {/* Empty State Dropzone Placeholder */}
      {!imageLoaded.value && (
        <div
          onClick={() => {
            const input = document.getElementById('global-file-input') as HTMLInputElement | null;
            input?.click();
          }}
          class="absolute inset-0 flex flex-col justify-center items-center text-center p-6 bg-neutral-900/95 rounded-2xl cursor-pointer hover:bg-neutral-900 transition-colors"
        >
          <div class="w-16 h-16 rounded-2xl bg-neutral-800 border border-neutral-700 flex items-center justify-center text-3xl mb-3 shadow-lg group-hover:scale-105 transition-transform">
            📸
          </div>
          <p class="text-xs font-bold text-white font-mono">
            Banyo edilecek bir fotoğraf seçin veya sürükleyip bırakın
          </p>
          <p class="text-[10px] text-amber-400/80 mt-1 font-mono">
            RAW (.DNG, .CR2, .CR3, .NEF, .ARW, .RAF), Apple HEIC, JPG, PNG
          </p>
          <span class="mt-4 px-3.5 py-2 rounded-xl text-[10px] font-mono font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-all flex items-center gap-1.5 shadow-sm">
            <span>📂</span> Bilgisayardan / Galeriden Seç
          </span>
        </div>
      )}
    </div>
  );
}
