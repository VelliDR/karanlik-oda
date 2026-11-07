import {
  imageLoaded,
  isRaw,
  rawMetadata,
  imageDimensions,
  canUndo,
  canRedo,
  undo,
  redo,
  resetSettings,
  rotateImage,
  randomizeSettings
} from '../store';
import {
  CameraIcon,
  FolderIcon,
  SaveIcon,
  UndoIcon,
  RedoIcon,
  RotateIcon,
  ShuffleIcon,
  ResetIcon
} from './Icons';

interface TopBarProps {
  onOpenFileSelect: () => void;
  onQuickSave: () => void;
  isSaving?: boolean;
}

export function TopBar({ onOpenFileSelect, onQuickSave, isSaving }: TopBarProps) {
  const hasImg = imageLoaded.value;
  const isRawFile = isRaw.value;
  const raw = rawMetadata.value;
  const dims = imageDimensions.value;

  return (
    <header class="p-2.5 sm:px-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-950/90 backdrop-blur sticky top-0 z-30">
      {/* Brand & Version */}
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-amber-950/70 border border-amber-600/40 flex items-center justify-center text-amber-400 shadow-inner">
          <CameraIcon class="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <h1 class="text-xs font-bold tracking-widest uppercase text-white font-mono">
              FOTON <span class="text-amber-400">: KARANLIK ODA</span>
            </h1>
            <span class="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold hidden sm:inline-block">
              v3.2
            </span>
          </div>
          <p class="text-[9px] text-neutral-400 font-mono hidden xs:block">
            {isRawFile && raw ? (
              <span class="text-amber-300 font-semibold flex items-center gap-1">
                <CameraIcon class="w-3 h-3 inline" /> {raw.make} {raw.model} • ISO {raw.iso} • {raw.shutter}s • f/{raw.aperture.toFixed(1)}
              </span>
            ) : hasImg ? (
              <span>{dims.width} × {dims.height} px • %100 Çevrimdışı WebGPU</span>
            ) : (
              <span>Wabi-Sabi Analog Banyo & Helios Optik</span>
            )}
          </p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div class="flex items-center gap-1.5">
        {/* Fotoğraf Yükle Butonu */}
        <button
          type="button"
          onClick={onOpenFileSelect}
          class="bg-amber-950/70 hover:bg-amber-900/60 text-amber-300 border border-amber-600/40 py-1.5 px-2.5 rounded-xl text-xs font-mono font-semibold tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <FolderIcon class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Fotoğraf</span>
        </button>

        {/* Kör Makara (Randomize) */}
        <button
          type="button"
          disabled={!hasImg}
          onClick={randomizeSettings}
          class="border border-amber-900/50 hover:bg-amber-950/30 text-amber-400 p-1.5 rounded-xl text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer flex items-center justify-center"
          title="Kör Makara: Rastgele Analog Banyo"
        >
          <ShuffleIcon class="w-3.5 h-3.5" />
        </button>

        {/* 90° Döndür */}
        <button
          type="button"
          disabled={!hasImg}
          onClick={rotateImage}
          class="border border-neutral-800 hover:bg-neutral-800 text-neutral-300 p-1.5 rounded-xl text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer flex items-center justify-center"
          title="90° Saat Yönünde Döndür"
        >
          <RotateIcon class="w-3.5 h-3.5" />
        </button>

        {/* Geri Al (Undo) */}
        <button
          type="button"
          disabled={!canUndo.value}
          onClick={undo}
          class="border border-neutral-800 hover:bg-neutral-800 text-neutral-300 p-1.5 rounded-xl text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer flex items-center justify-center"
          title="Geri Al (Ctrl+Z)"
        >
          <UndoIcon class="w-3.5 h-3.5" />
        </button>

        {/* İleri Al (Redo) */}
        <button
          type="button"
          disabled={!canRedo.value}
          onClick={redo}
          class="border border-neutral-800 hover:bg-neutral-800 text-neutral-300 p-1.5 rounded-xl text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer flex items-center justify-center"
          title="İleri Al (Ctrl+Y)"
        >
          <RedoIcon class="w-3.5 h-3.5" />
        </button>

        {/* Sıfırla */}
        <button
          type="button"
          disabled={!hasImg}
          onClick={resetSettings}
          class="border border-neutral-800 hover:bg-neutral-800 text-neutral-300 p-1.5 rounded-xl text-xs disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer flex items-center justify-center"
          title="Tüm Ayarları Sıfırla"
        >
          <ResetIcon class="w-3.5 h-3.5" />
        </button>

        {/* Hızlı Kaydet Butonu */}
        <button
          type="button"
          disabled={!hasImg || isSaving}
          onClick={onQuickSave}
          class="ml-1 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold font-mono py-1.5 px-3 rounded-xl text-xs tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5 cursor-pointer"
        >
          <SaveIcon class="w-3.5 h-3.5" />
          <span class="hidden md:inline">Kaydet</span>
        </button>
      </div>
    </header>
  );
}
