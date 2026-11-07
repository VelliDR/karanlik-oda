import { useRef } from 'preact/hooks';
import { PRESETS } from '../../core/presets';
import { sliderSettings, setPreset, activePresetDescription } from '../store';


interface PresetDeckProps {
  onLoadCubeLut?: (file: File) => void;
}

export function PresetDeck({ onLoadCubeLut }: PresetDeckProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeKey = sliderSettings.value.preset;

  const handleCubeUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && onLoadCubeLut) {
      onLoadCubeLut(file);
    }
    input.value = '';
  };

  const presetList = Object.values(PRESETS);

  return (
    <div class="space-y-2.5">
      <div class="flex justify-between items-center">
        <span class="text-[9px] text-amber-400 font-mono tracking-wider font-bold">
          3D LUT EMÜLSİYONLAR (33³ TETRAHEDRAL)
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          class="px-2 py-0.5 text-[9px] font-mono font-bold bg-amber-950/80 hover:bg-amber-900/60 text-amber-300 border border-amber-600/60 rounded-lg cursor-pointer transition-colors shadow-sm"
          title="Harici 33x33x33 veya 65x65x65 .CUBE 3D LUT profili yükle"
        >
          🧊 .CUBE Yükle
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".cube,text/plain"
          onChange={handleCubeUpload}
          class="hidden"
        />
      </div>

      <p class="text-[8px] text-neutral-400 font-mono line-clamp-2 min-h-[22px] bg-neutral-950/60 p-1.5 rounded-lg border border-neutral-800/80">
        {activePresetDescription.value}
      </p>

      {/* Preset Grid Chips */}
      <div class="grid grid-cols-2 gap-1.5">
        {presetList.map((preset) => {
          const isActive = activeKey === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPreset(preset.id)}
              class={`p-2 rounded-xl text-left border transition-all cursor-pointer relative overflow-hidden ${
                isActive
                  ? 'bg-amber-950/60 border-amber-500 shadow-md shadow-amber-950/40 text-amber-300'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-white'
              }`}
            >
              <div class="flex justify-between items-center mb-0.5">
                <span class="text-[10px] font-bold font-mono tracking-wide truncate">
                  {preset.name}
                </span>
                {preset.badge && (
                  <span
                    class={`text-[7px] px-1 py-0.2 rounded font-mono font-semibold ${
                      isActive
                        ? 'bg-amber-400 text-black'
                        : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {preset.badge}
                  </span>
                )}
              </div>
              <div class="text-[8px] text-neutral-500 font-mono truncate">
                {preset.description || preset.id}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
