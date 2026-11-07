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
import { ApertureIcon, EyeIcon, TargetIcon, CubeIcon } from './Icons';

interface OpticsTabProps {
  onToggleDepth?: (enabled: boolean) => Promise<void>;
  onToggleDepthMap?: () => void;
  onAutoFocus?: () => void;
}

export function OpticsTab({ onToggleDepth, onToggleDepthMap, onAutoFocus }: OpticsTabProps) {
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

  const applyLensProfile = (profile: 'biotar' | 'helios44m' | 'helios44_2' | 'modern' | 'reset') => {
    if (profile === 'biotar') {
      updateSetting('swirl', 85);
      updateSetting('soapBubble', 75);
      updateSetting('loca', 65);
      updateSetting('apertureBlades', 0);
      commitSettingToHistory();
      showToast('Carl Zeiss Jena Biotar 58mm f/2 Profili Uygulandı', 'info', 2500);
    } else if (profile === 'helios44m') {
      updateSetting('swirl', 90);
      updateSetting('soapBubble', 45);
      updateSetting('loca', 40);
      updateSetting('apertureBlades', 6);
      updateSetting('bladeCurvature', 85);
      commitSettingToHistory();
      showToast('Helios 44M (6 Bıçak / Altıgen) Profili Uygulandı', 'info', 2500);
    } else if (profile === 'helios44_2') {
      updateSetting('swirl', 80);
      updateSetting('soapBubble', 60);
      updateSetting('loca', 50);
      updateSetting('apertureBlades', 8);
      updateSetting('bladeCurvature', 75);
      commitSettingToHistory();
      showToast('Helios 44-2 Silver (8 Bıçak / Sekizgen) Profili Uygulandı', 'info', 2500);
    } else if (profile === 'modern') {
      updateSetting('swirl', 35);
      updateSetting('soapBubble', 15);
      updateSetting('loca', 0);
      updateSetting('apertureBlades', 0);
      commitSettingToHistory();
      showToast('Modern Yumuşak Portre Profili Uygulandı', 'info', 2500);
    } else if (profile === 'reset') {
      updateSetting('swirl', 0);
      updateSetting('soapBubble', 0);
      updateSetting('loca', 0);
      updateSetting('apertureBlades', 0);
      updateSetting('bladeCurvature', 85);
      commitSettingToHistory();
      showToast('Tüm optik ayarları sıfırlandı.', 'info', 2000);
    }
  };

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
          <ApertureIcon class="w-3.5 h-3.5 text-amber-400" /> VINTAGE MERCEK & OPTİK KUSURLAR
        </span>
        <span class="text-[8px] font-mono text-neutral-400">Helios & Pro-Mist</span>
      </div>

      {/* Hızlı Lens Karakteristiği Presetleri */}
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-[8px] font-mono text-neutral-400">LENS PROFİLİ:</span>
          <button
            type="button"
            onClick={() => applyLensProfile('reset')}
            class="text-[8px] font-mono text-neutral-500 hover:text-amber-400 transition-colors cursor-pointer"
          >
            ↺ Sıfırla
          </button>
        </div>
        <div class="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => applyLensProfile('biotar')}
            class="py-1 px-1 text-[8px] font-mono font-semibold rounded border border-neutral-800 bg-neutral-900/80 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 transition-all cursor-pointer text-center truncate"
            title="Carl Zeiss Jena Biotar 58mm f/2 (Kremamsı Dairesel Swirl + LoCA)"
          >
            Zeiss Biotar
          </button>
          <button
            type="button"
            onClick={() => applyLensProfile('helios44m')}
            class="py-1 px-1 text-[8px] font-mono font-semibold rounded border border-neutral-800 bg-neutral-900/80 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 transition-all cursor-pointer text-center truncate"
            title="Helios 44M (6 Diyafram Bıçağı / Altıgen Bokeh)"
          >
            Helios 44M
          </button>
          <button
            type="button"
            onClick={() => applyLensProfile('helios44_2')}
            class="py-1 px-1 text-[8px] font-mono font-semibold rounded border border-neutral-800 bg-neutral-900/80 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 transition-all cursor-pointer text-center truncate"
            title="Helios 44-2 Silver (8 Diyafram Bıçağı / Sekizgen Bokeh)"
          >
            Helios 44-2
          </button>
          <button
            type="button"
            onClick={() => applyLensProfile('modern')}
            class="py-1 px-1 text-[8px] font-mono font-semibold rounded border border-neutral-800 bg-neutral-900/80 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 transition-all cursor-pointer text-center truncate"
            title="Modern Temiz Dairesel Portre Bokeh"
          >
            Modern
          </button>
        </div>
      </div>

      {/* Helios 44M Swirl */}
      <PrecisionSlider
        label="HELIOS 44M DÖNEN BOKEH"
        value={settings.swirl}
        min={0}
        max={100}
        defaultValue={0}
        accent="amber"
        description="Kenar dairesel astigmatizm ve optik bükülme kusuru"
        onChange={(v) => updateSetting('swirl', v)}
        onCommit={() => commitSettingToHistory()}
      />

      {/* Sabun Köpüğü Halka Bokeh */}
      <PrecisionSlider
        label="SABUN KÖPÜĞÜ (SOAP BUBBLE)"
        value={settings.soapBubble ?? 0}
        min={0}
        max={100}
        defaultValue={0}
        accent="amber"
        description="Küresel sapma ile bokeh toplarının dış çeperinde parıldayan parlak halka"
        onChange={(v) => updateSetting('soapBubble', v)}
        onCommit={() => commitSettingToHistory()}
      />

      {/* Boyuna Kromatik Sapma (LoCA / Fringing) */}
      <PrecisionSlider
        label="BOKEH FRINGING (LoCA)"
        value={settings.loca ?? 0}
        min={0}
        max={100}
        defaultValue={0}
        accent="purple"
        description="Boyuna renk saçılması: Arka planda yeşil, ön planda mor/macenta çeper"
        onChange={(v) => updateSetting('loca', v)}
        onCommit={() => commitSettingToHistory()}
      />

      {/* Diyafram Bıçak Geometrisi (Aperture Blades) */}
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between">
          <label class="text-[9px] font-mono tracking-wider font-semibold text-neutral-300">
            DİYAFRAM BIÇAKLARI
          </label>
          <span class="text-[8px] font-mono text-amber-400">
            {(settings.apertureBlades ?? 0) === 6
              ? 'Helios 44M (6 Bıçak / Altıgen)'
              : (settings.apertureBlades ?? 0) === 8
              ? 'Helios 44-2 (8 Bıçak / Sekizgen)'
              : 'Dairesel (f/2 Açık Diyafram)'}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => {
              updateSetting('apertureBlades', 0);
              commitSettingToHistory();
            }}
            class={`py-1.5 px-2 text-[9px] font-mono font-semibold rounded-lg border transition-all cursor-pointer ${
              (settings.apertureBlades ?? 0) === 0
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Dairesel
          </button>
          <button
            type="button"
            onClick={() => {
              updateSetting('apertureBlades', 6);
              commitSettingToHistory();
            }}
            class={`py-1.5 px-2 text-[9px] font-mono font-semibold rounded-lg border transition-all cursor-pointer ${
              (settings.apertureBlades ?? 0) === 6
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            44M (6 Bıçak)
          </button>
          <button
            type="button"
            onClick={() => {
              updateSetting('apertureBlades', 8);
              commitSettingToHistory();
            }}
            class={`py-1.5 px-2 text-[9px] font-mono font-semibold rounded-lg border transition-all cursor-pointer ${
              (settings.apertureBlades ?? 0) === 8
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            44-2 (8 Bıçak)
          </button>
        </div>

        {/* Poligon bıçak seçiliyse kavis düzlüğü ayarı */}
        {(settings.apertureBlades ?? 0) > 0 && (
          <div class="pt-1.5 pl-2 border-l border-amber-500/30">
            <PrecisionSlider
              label="BIÇAK KAVİS SERTLİĞİ"
              value={settings.bladeCurvature ?? 85}
              min={20}
              max={100}
              defaultValue={85}
              accent="amber"
              description="Bıçak kenarının düzlüğü (100 = keskin poligon, 20 = hafif kavisli)"
              onChange={(v) => updateSetting('bladeCurvature', v)}
              onCommit={() => commitSettingToHistory()}
            />
          </div>
        )}
      </div>

      {/* 3D Fiziksel Alan Derinliği (Depth Anything V2) */}
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
            <span class="text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1.5">
              <CubeIcon class="w-3.5 h-3.5 text-amber-400" /> 3D FİZİKSEL ALAN DERİNLİĞİ
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
              <strong>Dokunarak Odakla:</strong> Fotoğrafta netlemek istediğiniz alana tıklayın veya aşağıdaki odak halkasını kaydırın.
            </p>

            {/* Manuel Odak Düzlemi Slider'ı (Focus Distance Ring) */}
            <PrecisionSlider
              label="ODAK DÜZLEMİ (FOCUS DISTANCE)"
              value={focalPercent}
              min={0}
              max={100}
              defaultValue={50}
              accent="amber"
              description={`Netleme mesafesi: %${focalPercent} (${focalRegion}) - Kaydırın veya fotoğrafa tıklayın`}
              onChange={(v) => {
                const normalized = v / 100;
                updateSetting('aiFocalDepth', normalized);
                depthFocalDepth.value = normalized;
              }}
              onCommit={() => commitSettingToHistory()}
            />

            {/* Hızlı Odak Bölgeleri ve Akıllı AF Butonu */}
            <div class="grid grid-cols-4 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  updateSetting('aiFocalDepth', 0.20);
                  depthFocalDepth.value = 0.20;
                  commitSettingToHistory();
                }}
                class={`py-1 px-1 text-[8px] font-mono rounded-lg border transition-all cursor-pointer text-center ${
                  focalPercent <= 35
                    ? 'bg-amber-500/25 text-amber-300 border-amber-500/60 shadow-sm font-bold ring-1 ring-amber-500/40'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Sonsuz / Arka Plan Netleme"
              >
                Arka Plan
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSetting('aiFocalDepth', 0.55);
                  depthFocalDepth.value = 0.55;
                  commitSettingToHistory();
                }}
                class={`py-1 px-1 text-[8px] font-mono rounded-lg border transition-all cursor-pointer text-center ${
                  focalPercent > 35 && focalPercent <= 65
                    ? 'bg-amber-500/25 text-amber-300 border-amber-500/60 shadow-sm font-bold ring-1 ring-amber-500/40'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Portre / Orta Alan Netleme"
              >
                Orta Alan
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSetting('aiFocalDepth', 0.85);
                  depthFocalDepth.value = 0.85;
                  commitSettingToHistory();
                }}
                class={`py-1 px-1 text-[8px] font-mono rounded-lg border transition-all cursor-pointer text-center ${
                  focalPercent > 65
                    ? 'bg-amber-500/25 text-amber-300 border-amber-500/60 shadow-sm font-bold ring-1 ring-amber-500/40'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Ön Plan / Yakın Obje Netleme"
              >
                Ön Plan
              </button>
              <button
                type="button"
                onClick={onAutoFocus}
                class="py-1 px-1 text-[8px] font-mono font-bold rounded-lg border border-amber-400/50 bg-amber-500/30 text-amber-200 hover:bg-amber-500/40 transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm active:scale-95 text-center"
                title="Sahnedeki Ana Nesneyi / İnsanı Otomatik Tespit Et"
              >
                <TargetIcon class="w-3 h-3 text-amber-300" />
                <span>Akıllı AF</span>
              </button>
            </div>

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
                class={`flex-1 py-1.5 px-2 text-[9px] font-mono font-semibold rounded-lg border transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                  isShowMap
                    ? 'bg-amber-500/30 text-amber-300 border-amber-400'
                    : 'border-neutral-700 bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300'
                }`}
              >
                <EyeIcon class="w-3.5 h-3.5" />
                <span>DERİNLİK HARİTASI</span>
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
          label="BLACK PRO-MIST (SİSLİ PARLAMA)"
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
          label="CHROMATIC ABERRATION"
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
