import { useEffect, useRef, useState } from 'preact/hooks';
import { PresetKey } from '../../core/types';
import { PRESETS } from '../../core/presets';
import { getCustomCubeLUT } from '../../core/lut3d';
import {
  DEFAULT_PREVIEW_LONG_EDGE_PX,
  STRIP_MAX_FRAMES,
  STRIP_MIN_FRAMES
} from '../../core/strip/constants';
import { composeFilmStrip } from '../../core/strip/strip-compositor';
import { StripLayoutGeometry } from '../../core/strip/vector-rebate';
import {
  openStripFrameForSingleEdit,
  removeStripFrame,
  reorderStripFrames,
  rotateStripFrameClockwise,
  setStripFramePresetOverride,
  sliderSettings,
  stripConfig,
  stripFrames,
  stripRenderRevision,
  toggleStripFrameGreaseMark
} from '../store';
import { showToast } from '../toast';
import {
  CloseIcon,
  FilmIcon,
  FilmStripIcon,
  FolderIcon,
  GripIcon,
  PencilMarkIcon,
  PlusIcon,
  RotateIcon
} from './Icons';

interface StripViewportProps {
  onFilesDrop: (files: FileList | File[]) => void;
  onOpenStripFilePicker: () => void;
  isAddingFiles?: boolean;
  addingStatusText?: string;
}

export function StripViewport({
  onFilesDrop,
  onOpenStripFilePicker,
  isAddingFiles,
  addingStatusText
}: StripViewportProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  const lastLayoutRef = useRef<StripLayoutGeometry | null>(null);

  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const frames = stripFrames.value;
  const cfg = stripConfig.value;
  const sharedSettings = sliderSettings.value;
  const revision = stripRenderRevision.value;

  // Çoklu dosya sürükle-bırak dinleyicisi (kart sıralama sürüklemelerini ayırt eder)
  useEffect(() => {
    const el = dropzoneRef.current;
    if (!el) return;

    const hasFilePayload = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      return Boolean(types && Array.from(types).includes('Files'));
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      el.classList.add('ring-2', 'ring-amber-500', 'bg-amber-950/20');
    };

    const onDragLeave = () => {
      el.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-950/20');
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFilePayload(e)) return;
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-950/20');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        onFilesDrop(files);
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
  }, [onFilesDrop]);

  // Şerit / Kontakt önizleme tuvalini sıralı olarak üret
  useEffect(() => {
    const currentFrames = stripFrames.value;
    if (currentFrames.length === 0) {
      lastLayoutRef.current = null;
      setIsRenderingPreview(false);
      return;
    }

    let cancelled = false;
    setIsRenderingPreview(true);

    const timer = window.setTimeout(async () => {
      try {
        const result = await composeFilmStrip({
          frames: currentFrames,
          sharedSettings: { ...sliderSettings.value },
          stripConfig: { ...stripConfig.value },
          longEdgePxOverride: DEFAULT_PREVIEW_LONG_EDGE_PX,
          customLut: getCustomCubeLUT(),
          useCellCache: true
        });

        if (cancelled) {
          result.canvas.width = 0;
          result.canvas.height = 0;
          return;
        }

        const dst = previewCanvasRef.current;
        if (dst) {
          dst.width = result.canvas.width;
          dst.height = result.canvas.height;
          const ctx = dst.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, dst.width, dst.height);
            ctx.drawImage(result.canvas as CanvasImageSource, 0, 0);
          }
        }
        lastLayoutRef.current = result.layout;
        result.canvas.width = 0;
        result.canvas.height = 0;
      } catch (err) {
        console.error('Şerit önizleme hatası:', err);
      } finally {
        if (!cancelled) {
          setIsRenderingPreview(false);
        }
      }
    }, 35);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [revision]);

  // Şerit önizleme tuvalindeki kareye tıklayınca o kareyi tekil banyoya aç
  const handlePreviewCanvasClick = async (e: MouseEvent) => {
    const canvas = previewCanvasRef.current;
    const layout = lastLayoutRef.current;
    if (!canvas || !layout || frames.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const sx = ((e.clientX - rect.left) / rect.width) * layout.sheetWidth;
    const sy = ((e.clientY - rect.top) / rect.height) * layout.sheetHeight;

    for (let i = 0; i < layout.frameGates.length; i++) {
      const g = layout.frameGates[i];
      if (sx >= g.x && sx <= g.x + g.w && sy >= g.y && sy <= g.y + g.h) {
        const targetFrame = frames[i];
        if (targetFrame) {
          const opened = await openStripFrameForSingleEdit(targetFrame.id);
          if (opened) {
            showToast(
              `Kare #${i + 1} (${targetFrame.fileName}) tekil banyoda açıldı.`,
              'info',
              2400
            );
          }
        }
        return;
      }
    }
  };

  const sharedPresetName = PRESETS[sharedSettings.preset]?.name || 'Ortak Profil';

  return (
    <div class="flex flex-col gap-2.5 sm:gap-3 select-none h-full min-h-0 overflow-y-auto overscroll-contain pr-1 custom-scrollbar">
      {/* Ana Işıklı Masa / Kontakt Baskı Önizleme Alanı */}
      <div
        ref={dropzoneRef}
        class="relative shrink-0 min-h-[260px] h-[34dvh] sm:h-[40dvh] lg:h-[48dvh] bg-neutral-900/60 border border-neutral-800 rounded-2xl flex items-center justify-center p-2 sm:p-4 overflow-hidden shadow-inner transition-all"
      >
        {frames.length === 0 ? (
          <div class="max-w-md text-center space-y-3 py-8 px-4">
            <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-950/60 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <FilmStripIcon class="w-6 h-6" />
            </div>
            <div class="space-y-1">
              <h2 class="text-sm font-mono font-bold tracking-wider text-white uppercase">
                35mm Film Şeridi & Kontakt Baskı Masası
              </h2>
              <p class="text-[11px] font-mono text-neutral-400 leading-relaxed">
                {STRIP_MIN_FRAMES} ila {STRIP_MAX_FRAMES} fotoğrafı (RAW, HEIC, JPEG, PNG, WebP) buraya sürükleyip bırakın veya seçin. Her kare bellekte sırayla tek tek banyo edilir ve ISO 1007 vektörel 35mm şerit üzerine dizilir.
              </p>
            </div>
            <div class="pt-1 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={Boolean(isAddingFiles)}
                onClick={onOpenStripFilePicker}
                class="py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-mono font-bold text-xs flex items-center gap-2 shadow-md cursor-pointer transition-colors disabled:opacity-40"
              >
                <FolderIcon class="w-4 h-4" />
                <span>{isAddingFiles ? 'Kareler Hazırlanıyor...' : 'Fotoğrafları Seç (3–6 Kare)'}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Üst Bilgi Rozetleri */}
            <div class="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5 pointer-events-none">
              <span class="px-2 py-0.5 rounded-lg bg-neutral-950/85 border border-neutral-800 text-[9px] font-mono font-bold text-amber-300">
                ISO 1007 VEKTÖR • {frames.length} KARE
              </span>
              <span class="px-2 py-0.5 rounded-lg bg-neutral-950/80 border border-neutral-800 text-[9px] font-mono text-neutral-300 hidden sm:inline-block">
                Kareye dokun: Tekil Banyo
              </span>
            </div>

            {(isRenderingPreview || isAddingFiles) && (
              <div class="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg bg-amber-950/90 border border-amber-500/40 text-[9px] font-mono font-semibold text-amber-200">
                {isAddingFiles
                  ? addingStatusText || 'Kareler şeride ekleniyor...'
                  : 'Şerit banyo ediliyor...'}
              </div>
            )}

            <div class="w-full h-full min-h-0 flex items-center justify-center pt-7 pb-1 overflow-auto">
              <canvas
                ref={previewCanvasRef}
                id="strip-preview-canvas"
                onClick={handlePreviewCanvasClick}
                title="Kareyi tek başına düzenlemek için üzerine tıklayın"
                class={`max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-neutral-800/80 cursor-pointer transition-opacity ${
                  isRenderingPreview ? 'opacity-80' : 'opacity-100'
                }`}
              />
            </div>
          </>
        )}
      </div>

      {/* Kare Sıralama, Profil Atama ve Tekil Düzenleme Tepsisi */}
      {frames.length > 0 && (
        <div class="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl space-y-2.5 shadow-md">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[10px] font-mono font-bold text-amber-400 tracking-wider flex items-center gap-1.5">
              <GripIcon class="w-3.5 h-3.5 text-amber-400" />
              <span>KARE TEPSİSİ — SÜRÜKLE SIRALA VEYA KAREYE DOKUN</span>
            </div>
            {frames.length < STRIP_MAX_FRAMES && (
              <button
                type="button"
                disabled={Boolean(isAddingFiles)}
                onClick={onOpenStripFilePicker}
                class="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-amber-300 border border-amber-500/40 text-[9px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <PlusIcon class="w-3 h-3" />
                <span>Kare Ekle</span>
              </button>
            )}
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {frames.map((frame, index) => {
              const isMarked = cfg.markedFrameIds.includes(frame.id);
              const isDragTarget = dragOverIndex === index && draggedIndex !== index;

              return (
                <div
                  key={frame.id}
                  data-frame-card-index={index}
                  draggable
                  onDragStart={(e) => {
                    setDraggedIndex(index);
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }
                  }}
                  onDragOver={(e) => {
                    if (draggedIndex === null) return;
                    e.preventDefault();
                    setDragOverIndex(index);
                  }}
                  onDrop={(e) => {
                    if (draggedIndex === null) return;
                    e.preventDefault();
                    reorderStripFrames(draggedIndex, index);
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  class={`p-2 rounded-xl border transition-all flex flex-col gap-2 ${
                    isDragTarget
                      ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400'
                      : 'bg-neutral-950/85 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <div
                      class="text-neutral-500 hover:text-amber-400 cursor-grab active:cursor-grabbing shrink-0"
                      title="Sıralamak için sürükleyin"
                    >
                      <GripIcon class="w-3.5 h-3.5" />
                    </div>

                    <button
                      type="button"
                      onClick={() => openStripFrameForSingleEdit(frame.id)}
                      title="Tekil düzenlemeye aç"
                      class="w-12 h-9 rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 shrink-0 relative cursor-pointer group"
                    >
                      <img
                        src={frame.thumbUrl}
                        alt={frame.fileName}
                        class="w-full h-full object-cover"
                      />
                      <span class="absolute bottom-0.5 left-0.5 px-1 rounded bg-neutral-950/85 text-[7px] font-mono font-bold text-amber-300">
                        #{index + 1}
                      </span>
                    </button>

                    <div class="min-w-0 flex-1">
                      <div class="text-[9px] font-mono font-bold text-neutral-200 truncate">
                        {frame.fileName}
                      </div>
                      <div class="text-[8px] font-mono text-neutral-500 flex items-center gap-1.5">
                        <span>
                          {frame.width}×{frame.height}
                        </span>
                        {frame.rotation !== 0 && (
                          <span class="text-amber-400">{frame.rotation}°</span>
                        )}
                        {frame.settingsOverride && (
                          <span class="text-amber-300 font-semibold">• Özel Banyo</span>
                        )}
                      </div>
                    </div>

                    <div class="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => reorderStripFrames(index, index - 1)}
                        title="Önceki sıraya taşı"
                        class="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 text-[9px] font-mono text-neutral-400 hover:text-white disabled:opacity-25 cursor-pointer"
                      >
                        &lt;
                      </button>
                      <button
                        type="button"
                        disabled={index === frames.length - 1}
                        onClick={() => reorderStripFrames(index, index + 1)}
                        title="Sonraki sıraya taşı"
                        class="px-1.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 text-[9px] font-mono text-neutral-400 hover:text-white disabled:opacity-25 cursor-pointer"
                      >
                        &gt;
                      </button>
                    </div>
                  </div>

                  {/* Kare Başına Film Profili Seçici */}
                  <select
                    value={frame.presetOverride ?? ''}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      setStripFramePresetOverride(
                        frame.id,
                        val === '' ? null : (val as PresetKey)
                      );
                    }}
                    class="w-full px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-[9px] font-mono text-neutral-300 focus:border-amber-500/60 focus:outline-none cursor-pointer"
                  >
                    <option value="">Ortak: {sharedPresetName}</option>
                    {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                      <option key={key} value={key}>
                        Kare Özel: {PRESETS[key].name}
                      </option>
                    ))}
                  </select>

                  {/* Kare Eylem Çubuğu */}
                  <div class="flex items-center justify-between gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={async () => {
                        const opened = await openStripFrameForSingleEdit(frame.id);
                        if (opened) {
                          showToast(
                            `Kare #${index + 1} tekil düzenlemeye açıldı.`,
                            'info',
                            2200
                          );
                        }
                      }}
                      class="flex-1 py-1 px-2 rounded-lg bg-neutral-900 hover:bg-amber-950/60 text-amber-300 border border-neutral-800 hover:border-amber-500/40 text-[8px] font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <FilmIcon class="w-3 h-3" />
                      <span>Tekil Düzenle</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => rotateStripFrameClockwise(frame.id)}
                      title="Kareyi 90° döndür"
                      class="p-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 cursor-pointer transition-colors"
                    >
                      <RotateIcon class="w-3 h-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleStripFrameGreaseMark(frame.id)}
                      title="Kontakt baskıda mumlu seçim kalemi ile işaretle"
                      class={`p-1 rounded-lg border cursor-pointer transition-colors ${
                        isMarked
                          ? 'bg-red-950/70 border-red-500/70 text-amber-300'
                          : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-neutral-400'
                      }`}
                    >
                      <PencilMarkIcon class="w-3 h-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => removeStripFrame(frame.id)}
                      title="Kareyi şeritten çıkar"
                      class="p-1 rounded-lg bg-neutral-900 hover:bg-red-950/50 text-neutral-400 hover:text-red-300 border border-neutral-800 cursor-pointer transition-colors"
                    >
                      <CloseIcon class="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
