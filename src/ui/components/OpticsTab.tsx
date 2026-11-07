import {
  sliderSettings,
  updateSetting,
  commitSettingToHistory,
  depthEnabled,
  depthFocalDepth,

  depthShowMap,
  depthStatus,
  depthProgress,
  depthAnalyzing,
  imageLoaded
} from '../store';
import { PrecisionSlider } from './PrecisionSlider';
import { showToast } from '../toast';

interface OpticsTabProps {
  onToggleDepth?: (enabled: boolean) => Promise<void>;
  onToggleDepthMap?: () => void;
}

export function OpticsTab({ onToggleDepth, onToggleDepthMap }: OpticsTabProps) {
  const settings = sliderSettings.value;
  const isDepthOn = depthEnabled.value;
  const isAnalyzing = depthAnalyzing.value;
  const progress = depthProgress.value;
  const statusMsg = depthStatus.value;
  const isShowMap = depthShowMap.value;

  const focalPercent = Math.round(depthFocalDepth.value * 100);
  const focalRegion =
    depthFocalDepth.value > 0.65
      ? 'Ön Plan'
      : depthFocalDepth.value > 0.35
      ? 'Orta Alan'
      : 'Arka Plan';

  const handleDepthCheckbox = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!imageLoaded.value) {
      input.checked = false;
      showToast('Lütfen önce banyo edilecek bir fotoğraf yükleyin.', 'error', 3000);
      return;
    }
    if (onToggleDepth) {
      await onToggleDepth(input.checked);
    }
  };

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
          <span>🔍</span> VINTAGE MERCEK & OPTİK KUSURLAR
        </span>
        <span class="text-[8px] font-mono text-neutral-400">Helios & Pro-Mist</span>
      </div>

      {/* Helios 44M Swirl */}
      <PrecisionSlider
        label="🌀 HELIOS 44M DÖNEN BOKEH"
        value={settings.swirl}
        min={0}
        max={100}
        defaultValue={0}
        accent="amber"
        description="Kenar dairesel astigmatizm ve optik bükülme kusuru"
        onChange={(v) => updateSetting('swirl', v)}
        onCommit={() => commitSettingToHistory()}
      />

      {/* 🤖 3D Fiziksel Alan Derinliği (Depth Anything V2) */}
      <div class="border-t border-neutral-800/80 pt-2.5 pb-1 space-y-2.5 bg-neutral-950/70 p-2.5 rounded-xl border border-neutral-800">
        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isDepthOn}
              disabled={isAnalyzing}
              onChange={handleDepthCheckbox}
              class="accent-amber-500 rounded"
            />
            <span class="text-[10px] font-mono font-bold text-amber-300">
              🤖 3D FİZİKSEL ALAN DERİNLİĞİ
            </span>
          </label>
          <span
            class={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
              isDepthOn
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {statusMsg}
          </span>
        </div>

        {/* Loading Progress Bar */}
        {isAnalyzing && (
          <div class="space-y-1 bg-black/40 p-2 rounded-xl border border-white/10 animate-fade-in">
            <div class="flex justify-between text-[8px] font-mono text-amber-200">
              <span>{statusMsg || 'Model hazırlanıyor...'}</span>
              <span>%{progress}</span>
            </div>
            <div class="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div
                class="bg-amber-400 h-full transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* AI Depth Controls */}
        {isDepthOn && (
          <div class="space-y-2.5 pl-2 border-l-2 border-amber-500/40">
            <p class="text-[8px] text-neutral-400 font-mono">
              🎯 <strong>Dokunarak Odakla:</strong> Fotoğrafta netlemek istediğiniz alana tıklayın.
            </p>

            <PrecisionSlider
              label="DİYAFRAM DERİNLİĞİ (DoF)"
              value={settings.aiDepthAperture}
              min={0}
              max={100}
              defaultValue={50}
              accent="amber"
              description="f/16 (Tüm Sahne Net) <—> f/1.4 (Sığ Sinematik Bokeh)"
              onChange={(v) => updateSetting('aiDepthAperture', v)}
              onCommit={() => commitSettingToHistory()}
            />

            <div class="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onToggleDepthMap}
                class={`flex-1 py-1.5 px-2 text-[9px] font-mono font-semibold rounded-lg border transition-colors cursor-pointer ${
                  isShowMap
                    ? 'bg-amber-500/30 text-amber-300 border-amber-400'
                    : 'border-neutral-700 bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300'
                }`}
              >
                👁️ DERİNLİK HARİTASI
              </button>
              <div class="text-[8px] font-mono px-2 py-1.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                Odak: %{focalPercent} ({focalRegion})
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Black Pro-Mist */}
      <div class="border-t border-neutral-800/60 pt-2 space-y-3">
        <PrecisionSlider
          label="🌫️ BLACK PRO-MIST (SİSLİ PARLAMA)"
          value={settings.proMist}
          min={0}
          max={100}
          defaultValue={0}
          accent="purple"
          description="Sert dijital kenarları kıran rüya difüzyonu ve parlama halesi"
          onChange={(v) => updateSetting('proMist', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="⚡ CHROMATIC ABERRATION"
          value={settings.chromatic}
          min={0}
          max={100}
          defaultValue={0}
          accent="cyan"
          description="Manuel odak kaçırma ve radyal kırmızı/camgöbeği renk saçılması"
          onChange={(v) => updateSetting('chromatic', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="MEKANİK VİNYET"
          value={settings.vignette}
          min={0}
          max={100}
          defaultValue={0}
          description="Mercek kenarlarındaki doğal ışık düşmesi ve optik gölgeleme"
          onChange={(v) => updateSetting('vignette', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>
    </div>
  );
}
