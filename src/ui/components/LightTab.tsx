import { sliderSettings, updateSetting, commitSettingToHistory } from '../store';
import { PrecisionSlider } from './PrecisionSlider';

export function LightTab() {
  const settings = sliderSettings.value;

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
          <span>☀️</span> TEMEL IŞIK & TONLAMA (EV)
        </span>
        <span class="text-[8px] font-mono text-neutral-400">Çift tıkla: Sıfırla</span>
      </div>

      <PrecisionSlider
        label="POZLAMA (EV)"
        value={settings.exposure}
        min={-100}
        max={100}
        defaultValue={0}
        description="Fiziksel sensör / film pozlama telafisi"
        onChange={(v) => updateSetting('exposure', v)}
        onCommit={() => commitSettingToHistory()}
      />

      <PrecisionSlider
        label="KONTRAST"
        value={settings.contrast}
        min={-100}
        max={100}
        defaultValue={0}
        description="Hurter & Driffield %18 gri pivotlu eğim"
        onChange={(v) => updateSetting('contrast', v)}
        onCommit={() => commitSettingToHistory()}
      />

      <div class="border-t border-neutral-800/60 pt-2 space-y-3">
        <PrecisionSlider
          label="AÇIK TONLAR / VURGULAR"
          value={settings.highlights ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          description="Parlak alanların detaylarını kurtarır veya ışıtır"
          onChange={(v) => updateSetting('highlights', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="GÖLGELER"
          value={settings.shadows ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          description="Karanlık dip tonları çamurlaştırmadan kaldırır"
          onChange={(v) => updateSetting('shadows', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="BEYAZLAR"
          value={settings.whites ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          description="En üst parlaklık tavan noktasını belirler"
          onChange={(v) => updateSetting('whites', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="SİYAHLAR"
          value={settings.blacks ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          description="Sıfır taban noktasını kaldırır veya koyulaştırır"
          onChange={(v) => updateSetting('blacks', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>

      <div class="border-t border-neutral-800/60 pt-2">
        <PrecisionSlider
          label="📈 H&D FİLM OMZU (SHOULDER)"
          value={settings.shoulder ?? 0}
          min={0}
          max={100}
          defaultValue={0}
          accent="amber"
          description="C¹-sürekli film omzu sıkıştırmasıyla dijital kırpılmayı engeller"
          onChange={(v) => updateSetting('shoulder', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>
    </div>
  );
}
