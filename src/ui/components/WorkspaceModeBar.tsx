import { workspaceMode, setWorkspaceMode, sliderSettings } from '../store';
import { showToast } from '../toast';
import { EnlargerIcon, FilmIcon } from './Icons';

export function WorkspaceModeBar() {
  const mode = workspaceMode.value;
  const printActive = Boolean(sliderSettings.value.printEnabled);

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

  return (
    <div class="bg-neutral-900/95 p-1 rounded-2xl border border-neutral-800 grid grid-cols-2 gap-1 shadow-md select-none">
      <button
        type="button"
        onClick={handleSelectDevelop}
        class={`py-2 px-3 rounded-xl text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
          mode === 'develop'
            ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
            : 'text-neutral-400 hover:text-white hover:bg-neutral-800/70'
        }`}
      >
        <FilmIcon class="w-3.5 h-3.5" />
        <span>Negatif Banyo</span>
      </button>

      <button
        type="button"
        onClick={handleSelectPrint}
        class={`py-2 px-3 rounded-xl text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 relative ${
          mode === 'print'
            ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
            : 'text-neutral-400 hover:text-white hover:bg-neutral-800/70'
        }`}
      >
        <EnlargerIcon class="w-3.5 h-3.5" />
        <span>Kağıda Baskı</span>
        {printActive && (
          <span
            class={`w-1.5 h-1.5 rounded-full ${
              mode === 'print' ? 'bg-neutral-950' : 'bg-amber-400'
            }`}
            title="Kağıda Baskı Katmanı Aktif"
          />
        )}
      </button>
    </div>
  );
}
