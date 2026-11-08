import {
  editingStripFrameId,
  returnToStripFromSingleEdit,
  setWorkspaceMode,
  sliderSettings,
  stripFrames,
  workspaceMode
} from '../store';
import { showToast } from '../toast';
import { EnlargerIcon, FilmIcon, FilmStripIcon, UndoIcon } from './Icons';

export function WorkspaceModeBar() {
  const mode = workspaceMode.value;
  const printActive = Boolean(sliderSettings.value.printEnabled);
  const frameCount = stripFrames.value.length;
  const editingFrameId = editingStripFrameId.value;
  const editingFrameIndex = editingFrameId
    ? stripFrames.value.findIndex((f) => f.id === editingFrameId)
    : -1;

  const handleSelectDevelop = () => {
    if (mode === 'develop') return;
    setWorkspaceMode('develop');
  };

  const handleSelectPrint = () => {
    if (mode === 'print') return;
    const { switchedToMonoPreset } = setWorkspaceMode('print');
    if (switchedToMonoPreset) {
      showToast(
        'Kağıda Baskı modu için Ilford HP5+ siyah-beyaz negatif profili etkinleştirildi.',
        'info',
        3000
      );
    }
  };

  const handleSelectStrip = () => {
    if (mode === 'strip') return;
    setWorkspaceMode('strip');
  };

  return (
    <div class="space-y-1.5 select-none shrink-0">
      <div class="bg-neutral-900/95 p-1 rounded-2xl border border-neutral-800 grid grid-cols-3 gap-1 shadow-md">
        <button
          type="button"
          data-mode="develop"
          onClick={handleSelectDevelop}
          class={`py-1.5 sm:py-2 px-1.5 sm:px-2 rounded-xl text-[9px] sm:text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
            mode === 'develop'
              ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/70'
          }`}
        >
          <FilmIcon class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">Negatif Banyo</span>
        </button>

        <button
          type="button"
          data-mode="print"
          onClick={handleSelectPrint}
          class={`py-1.5 sm:py-2 px-1.5 sm:px-2 rounded-xl text-[9px] sm:text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1 relative ${
            mode === 'print'
              ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/70'
          }`}
        >
          <EnlargerIcon class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">Kağıda Baskı</span>
          {printActive && (
            <span
              class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                mode === 'print' ? 'bg-neutral-950' : 'bg-amber-400'
              }`}
              title="Kağıda Baskı Katmanı Aktif"
            />
          )}
        </button>

        <button
          type="button"
          data-mode="strip"
          onClick={handleSelectStrip}
          class={`py-1.5 sm:py-2 px-1.5 sm:px-2 rounded-xl text-[9px] sm:text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
            mode === 'strip'
              ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/70'
          }`}
        >
          <FilmStripIcon class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">Kontakt & Şerit</span>
          {frameCount > 0 && (
            <span
              class={`px-1 py-0.2 rounded text-[8px] font-mono font-bold shrink-0 ${
                mode === 'strip'
                  ? 'bg-neutral-950/25 text-neutral-950'
                  : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {frameCount}
            </span>
          )}
        </button>
      </div>

      {editingFrameId && mode !== 'strip' && (
        <div class="px-3 py-2 rounded-xl bg-amber-950/50 border border-amber-500/40 flex items-center justify-between gap-2">
          <div class="text-[9px] font-mono text-amber-200 truncate">
            <span class="font-bold text-amber-400">
              ŞERİT KARESİ #{editingFrameIndex >= 0 ? editingFrameIndex + 1 : '?'}
            </span>{' '}
            tekil banyoda düzenleniyor
          </div>
          <button
            type="button"
            onClick={() => {
              returnToStripFromSingleEdit();
              showToast('Kare ayarları şeride aktarıldı.', 'info', 2000);
            }}
            class="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-[9px] font-mono font-bold flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
          >
            <UndoIcon class="w-3 h-3" />
            <span>Şeride Dön</span>
          </button>
        </div>
      )}
    </div>
  );
}
