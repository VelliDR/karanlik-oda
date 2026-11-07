import {
  sliderSettings,
  updateSetting,
  commitSettingToHistory,
  smartRecipeAnalyzing,
  smartRecipeSuggestion,
  imageLoaded
} from '../store';
import { PRESETS } from '../../core/presets';
import { isPushPullSupportedPreset } from '../../core/chemistry/push-pull';
import { PresetDeck } from './PresetDeck';
import { PrecisionSlider } from './PrecisionSlider';
import { SparklesIcon, CheckIcon, FlaskIcon } from './Icons';

interface FilmTabProps {
  onLoadCubeLut?: (file: File) => void;
  onAnalyzeSmartRecipe?: () => void;
  onApplySmartRecipe?: () => void;
}

export function FilmTab({
  onLoadCubeLut,
  onAnalyzeSmartRecipe,
  onApplySmartRecipe
}: FilmTabProps) {
  const settings = sliderSettings.value;
  const suggestion = smartRecipeSuggestion.value;
  const isAnalyzing = smartRecipeAnalyzing.value;

  const isMonoPreset = isPushPullSupportedPreset(settings.preset);
  const presetDef = PRESETS[settings.preset] || PRESETS.none;
  const defaultPushStops = presetDef.defaultPushPull ?? 0;
  const activePushStops = isMonoPreset
    ? (settings.devPushPull ?? defaultPushStops)
    : 0;

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      {/* AKILLI REÇETE AI ASİSTANI */}
      <div class="bg-gradient-to-br from-neutral-900 to-neutral-950 p-2.5 rounded-xl border border-amber-500/30 space-y-2 shadow-inner">
        <div class="flex justify-between items-center">
          <span class="text-[9px] text-amber-300 font-mono tracking-wider font-bold flex items-center gap-1.5">
            <SparklesIcon class="w-3.5 h-3.5 text-amber-400" /> AKILLI REÇETE ASİSTANI (AI)
          </span>
          <button
            type="button"
            disabled={!imageLoaded.value || isAnalyzing}
            onClick={onAnalyzeSmartRecipe}
            class="px-2.5 py-1 text-[9px] font-mono font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg cursor-pointer transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
          >
            <SparklesIcon class="w-3 h-3 text-amber-300" />
            <span>{isAnalyzing ? 'Analiz Ediliyor...' : 'Sahneyi Analiz Et'}</span>
          </button>
        </div>

        {suggestion && (
          <div class="space-y-1.5 bg-black/40 p-2.5 rounded-xl border border-white/10 animate-fade-in">
            <div class="flex items-center justify-between text-[9px] font-mono">
              <span class="font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                {suggestion.sceneTitle}
              </span>
              <span class="text-white/60">
                %{suggestion.confidencePercent} Uyum
              </span>
            </div>

            <p class="text-[8px] text-neutral-300 font-mono leading-relaxed border-t border-neutral-800 pt-1">
              {suggestion.explanation}
            </p>

            <button
              type="button"
              onClick={onApplySmartRecipe}
              class="w-full py-1.5 px-3 text-[10px] font-mono font-bold bg-amber-500 hover:bg-amber-400 text-black rounded-lg transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <CheckIcon class="w-3.5 h-3.5" /> REÇETEYİ VE OPTİK AYARLARI UYGULA
            </button>
          </div>
        )}
      </div>

      {/* 3D LUT Presets */}
      <div class="border-t border-neutral-800/60 pt-2.5">
        <PresetDeck onLoadCubeLut={onLoadCubeLut} />
      </div>

      {/* FAZ 3: KARANLIK ODA NEGATİF BANYO KİMYASI */}
      <div class="border-t border-neutral-800/60 pt-2.5 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-[9px] text-amber-400 font-mono tracking-wider font-bold flex items-center gap-1.5">
            <FlaskIcon class="w-3.5 h-3.5 text-amber-400" />
            <span>NEGATİF BANYO KİMYASI (FAZ 3)</span>
          </span>
          <span
            class={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
              isMonoPreset
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-neutral-800/80 text-neutral-400 border-neutral-700'
            }`}
          >
            {isMonoPreset ? 'S/B PUSH AKTİF' : 'RENKLİ / DİA'}
          </span>
        </div>

        <PrecisionSlider
          label="PUSH / PULL SÜRESİ"
          value={activePushStops}
          min={-2}
          max={3}
          step={0.25}
          defaultValue={defaultPushStops}
          unit=" stop"
          disabled={!isMonoPreset}
          formatValue={(val) => {
            if (!isMonoPreset) return 'S/B GEREKLİ';
            const rounded = Number(val.toFixed(2));
            return `${rounded > 0 ? `+${rounded}` : rounded} stop`;
          }}
          description={
            isMonoPreset
              ? 'Geliştirme süresiyle H&D gama eğimini ve dip/omuz kaymasını kalibre eder (Moriyama varsayılan: +2 stop)'
              : 'Push/Pull yalnızca S/B negatif profillerinde (Ilford HP5+ ve Moriyama S/B) etkindir'
          }
          onChange={(v) => updateSetting('devPushPull', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="DEVELOPER TÜKENMESİ"
          value={settings.devExhaustion ?? 0}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          accent="amber"
          description="Yoğun gümüş bölgelerinde yerel geliştirici tükenmesiyle komşu kazancı düşürür (35mm negatifte 1.85 mm difüzyon)"
          onChange={(v) => updateSetting('devExhaustion', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="KENAR ETKİSİ (KOSTINSKY)"
          value={settings.devEdgeEffect ?? 0}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          accent="emerald"
          description="Yüksek kontrast sınırlarında yanal geliştirici difüzyonuyla Mackie mikro-keskinlik halesi üretir (0.20 mm DoG)"
          onChange={(v) => updateSetting('devEdgeEffect', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="RETICULATION (TERMAL ŞOK)"
          value={settings.devReticulation ?? 0}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          accent="cyan"
          description="Sıcaklık şokuyla jelatini hücresel Worley sırtlarında çatlatır ve film grenini kümelendirir (gren sonrası)"
          onChange={(v) => updateSetting('devReticulation', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>

      {/* Spektral Emülsiyon & Optik Sızıntı Sliders */}
      <div class="border-t border-neutral-800/60 pt-2.5 space-y-3">
        <span class="text-[9px] block text-amber-400 font-mono tracking-wider font-bold">
          SPEKTRAL EMÜLSİYON & GÜMÜŞ KATMANLARI
        </span>

        <PrecisionSlider
          label="650NM SPEKTRAL HALASYON"
          value={settings.halation}
          min={0}
          max={100}
          defaultValue={0}
          accent="red"
          description="450/550/650nm dalga boyuna göre dağılan fiziksel film tabanı tam yansıması"
          onChange={(v) => updateSetting('halation', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="IŞIK SIZINTISI (LIGHT LEAK)"
          value={settings.lightLeak}
          min={0}
          max={100}
          defaultValue={0}
          accent="amber"
          description="Analog makine kapağından sızan turuncu/kızıl film yanması"
          onChange={(v) => updateSetting('lightLeak', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="35MM FİLM GRENİ"
          value={settings.grain}
          min={0}
          max={100}
          defaultValue={0}
          description="Gümüş halojenür kristal gren yoğunluğu"
          onChange={(v) => updateSetting('grain', v)}
          onCommit={() => commitSettingToHistory()}
        />

        <PrecisionSlider
          label="BLEACH BYPASS (GÜMÜŞ KORUMA)"
          value={settings.bleachBypass}
          min={0}
          max={100}
          defaultValue={0}
          accent="cyan"
          description="Ağartma banyosunu atlayarak gümüşü tutar; sert, desatüre sinematik kontrast üretir"
          onChange={(v) => updateSetting('bleachBypass', v)}
          onCommit={() => commitSettingToHistory()}
        />
      </div>
    </div>
  );
}
