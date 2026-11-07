import { sliderSettings, updateSetting, commitSettingToHistory } from '../store';
import { PrecisionSlider } from './PrecisionSlider';
import { PaletteIcon } from './Icons';

export function ColorTab() {
  const settings = sliderSettings.value;

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
          <PaletteIcon class="w-3.5 h-3.5 text-amber-400" /> RENK DENGESİ & WB
        </span>
        <span class="text-[8px] font-mono text-neutral-400">Bradford & Oklab</span>
      </div>

      <PrecisionSlider
        label="SICAKLIK (BRADFORD K)"
        value={settings.warmth}
        min={-100}
        max={100}
        defaultValue={0}
        description="Lineer Planckian radyasyon sıcaklığı (Mavi <-> Kehribar)"
        onChange={(v) => updateSetting('warmth', v)}
        onCommit={() => commitSettingToHistory()}
      />

      <PrecisionSlider
        label="RENK TONU (TINT)"
        value={settings.tint ?? 0}
        min={-100}
        max={100}
        defaultValue={0}
        description="Spektral yeşil ile magenta dengesi"
        onChange={(v) => updateSetting('tint', v)}
        onCommit={() => commitSettingToHistory()}
      />

      <div class="border-t border-neutral-800/60 pt-2 space-y-3">
        <PrecisionSlider
          label="AKILLI CANLILIK (VIBRANCE)"
          value={settings.vibrance ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          description="Aşırı doymuş alanları ve teni koruyarak cansız renkleri canlandırır"
          onChange={(v) => updateSetting('vibrance', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="DOYGUNLUK"
          value={settings.saturation}
          min={-100}
          max={100}
          defaultValue={0}
          description="Omuz korumalı genel renk doygunluğu"
          onChange={(v) => updateSetting('saturation', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>

      <div class="border-t border-neutral-800/60 pt-2">
        <PrecisionSlider
          label="AKILLI TEN KORUMA KALKANI"
          value={settings.skinProtection}
          min={0}
          max={100}
          defaultValue={0}
          accent="emerald"
          description="En-boy oranını 1:1 koruyarak insan tenini Portra emülsiyonuyla korur"
          onChange={(v) => updateSetting('skinProtection', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>
    </div>
  );
}
