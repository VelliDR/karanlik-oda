import { ComponentChildren } from 'preact';
import {
  activePrintSubTab,
  clearDodgeBurn,
  commitSettingToHistory,
  dodgeBurnRadius,
  dodgeBurnStrength,
  dodgeBurnTool,
  hasDodgeBurnEdits,
  setPaperType,
  setPreset,
  setPrintLayerEnabled,
  sliderSettings,
  updateSetting
} from '../store';
import { DodgeBurnToolMode, PaperType, PresetKey } from '../../core/types';
import {
  formatMultigradeLabel,
  PAPER_PROFILES
} from '../../core/paper/constants';
import { PrintSubTab } from '../types';
import { showToast } from '../toast';
import { PrecisionSlider } from './PrecisionSlider';
import { FinishingTab } from './FinishingTab';
import {
  BurnIcon,
  CheckIcon,
  DodgeIcon,
  EnlargerIcon,
  EraserIcon,
  FilmIcon,
  FlaskIcon,
  PaperSheetIcon,
  ResetIcon,
  StampIcon
} from './Icons';

interface PrintPanelProps {
  onExport: () => void;
  isExporting?: boolean;
}

const QUICK_GRADES: { label: string; value: number }[] = [
  { label: '00', value: -0.5 },
  { label: '1', value: 1.0 },
  { label: '2', value: 2.0 },
  { label: '3', value: 3.0 },
  { label: '4', value: 4.0 },
  { label: '5', value: 5.0 }
];

const MONO_NEGATIVES: { key: PresetKey; label: string; sub: string }[] = [
  { key: 'hp5', label: 'Ilford HP5+ 400', sub: 'Klasik Gümüş Pankromatik' },
  { key: 'sb', label: 'Moriyama S/B', sub: 'Yüksek Kontrast Sokak Negatifi' }
];

const PAPER_TYPES: PaperType[] = ['rc-glossy', 'rc-matte', 'fiber-baryta'];

export function PrintPanel({ onExport, isExporting }: PrintPanelProps) {
  const settings = sliderSettings.value;
  const subTab = activePrintSubTab.value;
  const printEnabled = Boolean(settings.printEnabled);
  const paperType: PaperType = settings.printPaperType ?? 'rc-glossy';
  const activePaperProfile = PAPER_PROFILES[paperType] || PAPER_PROFILES['rc-glossy'];
  const splitGrade = Boolean(settings.printSplitGrade);
  const currentBrush = dodgeBurnTool.value;

  const subTabs: { id: PrintSubTab; label: string; icon: ComponentChildren }[] = [
    { id: 'enlarger', label: 'Agrandizör', icon: <EnlargerIcon class="w-3.5 h-3.5" /> },
    { id: 'paper', label: 'Kağıt & Ton', icon: <FlaskIcon class="w-3.5 h-3.5" /> },
    { id: 'dodgeburn', label: 'Dodge/Burn', icon: <DodgeIcon class="w-3.5 h-3.5" /> },
    { id: 'finishing', label: 'Bitiş', icon: <StampIcon class="w-3.5 h-3.5" /> }
  ];

  const brushTools: {
    id: DodgeBurnToolMode;
    label: string;
    sub: string;
    icon?: ComponentChildren;
  }[] = [
    { id: 'off', label: 'İzleme', sub: 'Fırça Kapalı' },
    {
      id: 'dodge',
      label: 'Dodge',
      sub: '−Poz (Aç)',
      icon: <DodgeIcon class="w-3.5 h-3.5" />
    },
    {
      id: 'burn',
      label: 'Burn',
      sub: '+Poz (Karart)',
      icon: <BurnIcon class="w-3.5 h-3.5" />
    },
    {
      id: 'erase',
      label: 'Silgi',
      sub: 'Yumuşat',
      icon: <EraserIcon class="w-3.5 h-3.5" />
    }
  ];

  const handleToggleLayer = (checked: boolean) => {
    const { switchedToMonoPreset } = setPrintLayerEnabled(checked);
    if (switchedToMonoPreset) {
      showToast(
        'Kağıda Baskı katmanı için Ilford HP5+ siyah-beyaz negatif profili seçildi.',
        'info',
        2600
      );
    }
  };

  return (
    <div class="space-y-3">
      {/* Üst Durum ve S/B Negatif Seçici Kartı */}
      <div class="p-3 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-2.5 shadow-md">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <EnlargerIcon class="w-4 h-4 text-amber-400" />
            <div>
              <div class="text-[10px] font-mono font-bold tracking-wider text-amber-400">
                KARANLIK ODA KAĞIDA BASKI
              </div>
              <div class="text-[8px] font-mono text-neutral-400">
                {printEnabled
                  ? `Multigrade ${
                      splitGrade
                        ? `Split (00+5: %${Math.round((settings.printSplitRatio ?? 0.5) * 100)})`
                        : `Derece ${formatMultigradeLabel(settings.printGrade ?? 2.0)}`
                    } • ${activePaperProfile.name}`
                  : 'Katman devre dışı — boru hattı maliyeti 0 ms'}
              </div>
            </div>
          </div>

          <label class="relative inline-flex items-center cursor-pointer" title="Kağıda Baskı Katmanını Aç / Kapat">
            <input
              type="checkbox"
              checked={printEnabled}
              onChange={(e) => handleToggleLayer((e.target as HTMLInputElement).checked)}
              class="sr-only peer"
            />
            <div class="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-neutral-950 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-200 peer-checked:after:bg-neutral-950 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500" />
          </label>
        </div>

        {/* Siyah-Beyaz Negatif Taşıyıcı Seçimi */}
        <div class="grid grid-cols-2 gap-1.5 pt-1 border-t border-neutral-800/80">
          {MONO_NEGATIVES.map((neg) => {
            const isSelected = settings.preset === neg.key;
            return (
              <button
                key={neg.key}
                type="button"
                onClick={() => setPreset(neg.key)}
                class={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-950/60 border-amber-500/80 text-amber-300'
                    : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <div class="flex items-center justify-between text-[9px] font-mono font-bold">
                  <span class="flex items-center gap-1">
                    <FilmIcon class="w-3 h-3" />
                    <span>{neg.label}</span>
                  </span>
                  {isSelected && <CheckIcon class="w-3 h-3 text-amber-400" />}
                </div>
                <div class="text-[7.5px] font-mono text-neutral-500 mt-0.5 truncate">
                  {neg.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Kağıda Baskı Alt Sekme Şeridi */}
      <div class="bg-neutral-900/90 p-1 rounded-2xl border border-neutral-800 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-md">
        {subTabs.map((t) => {
          const isActive = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                activePrintSubTab.value = t.id;
                if (t.id !== 'dodgeburn' && dodgeBurnTool.value !== 'off') {
                  dodgeBurnTool.value = 'off';
                }
              }}
              class={`flex-1 min-w-[68px] py-1.5 px-2 text-[10px] font-mono font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                isActive
                  ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
              }`}
            >
              <span class="flex items-center justify-center">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Alt Sekme İçerikleri */}
      {subTab === 'enlarger' && (
        <div
          class={`space-y-3 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md transition-opacity ${
            printEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'
          }`}
        >
          <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
              <EnlargerIcon class="w-3.5 h-3.5 text-amber-400" />
              <span>AGRANDİZÖR & MULTIGRADE FİLTRE</span>
            </span>
            <span class="text-[8px] font-mono text-neutral-400">ISO 6846 Sensitometri</span>
          </div>

          {/* 1. Poz (Stop) */}
          <PrecisionSlider
            label="Poz (Stop)"
            value={settings.printExposure ?? 0}
            min={-3}
            max={3}
            step={0.05}
            defaultValue={0}
            bipolar={true}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} st`}
            description="Agrandizör f-stop zamanlayıcı pozu (+stop kağıdı karartır, −stop açar)"
            onChange={(v) => updateSetting('printExposure', v)}
            onCommit={() => commitSettingToHistory()}
          />

          {/* 2. Kontrast Derecesi (00–5) */}
          <div class="space-y-2 pt-1 border-t border-neutral-800/60">
            <PrecisionSlider
              label="Kontrast Derecesi (00–5)"
              value={settings.printGrade ?? 2.0}
              min={-0.5}
              max={5.0}
              step={0.5}
              defaultValue={2.0}
              bipolar={false}
              disabled={splitGrade}
              formatValue={(v) => `Derece ${formatMultigradeLabel(v)}`}
              description="Ilford Multigrade çift emülsiyon filtresi (00 yumuşak yeşil ↔ 5 sert mavi)"
              onChange={(v) => updateSetting('printGrade', v)}
              onCommit={() => commitSettingToHistory()}
            />

            <div class={`grid grid-cols-6 gap-1 ${splitGrade ? 'opacity-40 pointer-events-none' : ''}`}>
              {QUICK_GRADES.map((g) => {
                const isSelected = Math.abs((settings.printGrade ?? 2.0) - g.value) < 0.01;
                return (
                  <button
                    key={g.label}
                    type="button"
                    onClick={() => {
                      updateSetting('printGrade', g.value);
                      commitSettingToHistory();
                    }}
                    class={`py-1 rounded-lg text-[9px] font-mono font-bold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-neutral-950 border-amber-400'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Split-Grade Çift Pozlama */}
          <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[10px] font-mono font-bold text-amber-400">
                  SPLIT-GRADE ÇİFT POZLAMA
                </div>
                <div class="text-[8px] font-mono text-neutral-400">
                  Derece 00 (yumuşak vurgu) + Derece 5 (derin siyah) ardışık poz toplamı
                </div>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={splitGrade}
                  onChange={(e) => {
                    updateSetting('printSplitGrade', (e.target as HTMLInputElement).checked);
                    commitSettingToHistory();
                  }}
                  class="sr-only peer"
                />
                <div class="w-8 h-4 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-neutral-950 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white peer-checked:after:bg-neutral-950 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500" />
              </label>
            </div>

            <PrecisionSlider
              label="Sert Katman Oranı (00 ↔ 5)"
              value={settings.printSplitRatio ?? 0.5}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.5}
              bipolar={false}
              disabled={!splitGrade}
              formatValue={(v) => `%${Math.round((1 - v) * 100)} [00] / %${Math.round(v * 100)} [5]`}
              onChange={(v) => updateSetting('printSplitRatio', v)}
              onCommit={() => commitSettingToHistory()}
            />
          </div>
        </div>
      )}

      {subTab === 'paper' && (
        <div
          class={`space-y-3 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md transition-opacity ${
            printEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'
          }`}
        >
          <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
              <PaperSheetIcon class="w-3.5 h-3.5 text-amber-400" />
              <span>KAĞIT TABANI & KİMYASAL TONING</span>
            </span>
            <span class="text-[8px] font-mono text-neutral-400">1D Fiziksel LUT</span>
          </div>

          {/* 4. Kağıt Tipi */}
          <div class="space-y-1.5">
            <span class="text-[9px] font-mono font-semibold text-neutral-400 block">
              KAĞIT TİPİ (Dmin / Dmax & 300 DPI Yüzey Dokusu)
            </span>
            <div class="grid grid-cols-3 gap-1.5">
              {PAPER_TYPES.map((pt) => {
                const prof = PAPER_PROFILES[pt];
                const isSelected = paperType === pt;
                return (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setPaperType(pt)}
                    class={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-950/75 border-amber-500 text-amber-300 shadow-sm'
                        : 'bg-neutral-950/80 border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <div class="text-[10px] font-mono font-bold truncate">{prof.name}</div>
                    <div class="text-[8px] font-mono text-amber-400/90 mt-0.5">{prof.badge}</div>
                  </button>
                );
              })}
            </div>
            <p class="text-[8px] font-mono text-neutral-500 leading-relaxed">
              {activePaperProfile.description}
            </p>
          </div>

          {/* 5. Kağıt Tonu (Nötr -> Sıcak) */}
          <div class="pt-1 border-t border-neutral-800/60">
            <PrecisionSlider
              label="Kağıt Tonu (Nötr → Sıcak)"
              value={settings.printPaperTone ?? 0}
              min={0}
              max={1}
              step={0.01}
              defaultValue={activePaperProfile.defaultPaperTone}
              bipolar={false}
              formatValue={(v) => v.toFixed(2)}
              description="0.00 iken tam nötr optik beyaz taban; artırıldıkça baryum sülfat fildişi krem yansıma"
              onChange={(v) => updateSetting('printPaperTone', v)}
              onCommit={() => commitSettingToHistory()}
            />
          </div>

          {/* 6. Selenyum & Sepya Kimyasal Toning */}
          <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[9px] font-mono font-bold text-amber-400 flex items-center gap-1.5">
                <FlaskIcon class="w-3 h-3 text-amber-400" />
                <span>KİMYASAL TONING BANYOSU (DUO-TONE UYUMLU)</span>
              </span>
            </div>

            <PrecisionSlider
              label="Selenyum (Ag₂Se)"
              value={settings.printSelenium ?? 0}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0}
              bipolar={false}
              accent="purple"
              formatValue={(v) => v.toFixed(2)}
              description="Koyu gümüş yoğunluklarında Dmax derinliği ve arşivsel soğuk patlıcan/mor-kahve tonu"
              onChange={(v) => updateSetting('printSelenium', v)}
              onCommit={() => commitSettingToHistory()}
            />

            <PrecisionSlider
              label="Sepya (Ag₂S)"
              value={settings.printSepia ?? 0}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0}
              bipolar={false}
              accent="amber"
              formatValue={(v) => v.toFixed(2)}
              description="Potasyum ferrisiyanür ağartma + sülfür banyosu: açık ve orta tonlarda sıcak kehribar"
              onChange={(v) => updateSetting('printSepia', v)}
              onCommit={() => commitSettingToHistory()}
            />
          </div>
        </div>
      )}

      {subTab === 'dodgeburn' && (
        <div
          class={`space-y-3 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md transition-opacity ${
            printEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'
          }`}
        >
          <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
              <DodgeIcon class="w-3.5 h-3.5 text-amber-400" />
              <span>DODGE & BURN YEREL POZLAMA</span>
            </span>
            <span class="text-[8px] font-mono text-neutral-400">±3.0 Stop Harita</span>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            {brushTools.map((tool) => {
              const isSelected = currentBrush === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    dodgeBurnTool.value = tool.id;
                  }}
                  class={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md'
                      : 'bg-neutral-950/80 border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <div class="flex items-center gap-1.5 text-[10px] font-mono font-bold">
                    {tool.icon}
                    <span>{tool.label}</span>
                  </div>
                  <div
                    class={`text-[8px] font-mono mt-0.5 ${
                      isSelected ? 'text-neutral-900 font-semibold' : 'text-neutral-500'
                    }`}
                  >
                    {tool.sub}
                  </div>
                </button>
              );
            })}
          </div>

          <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
            <PrecisionSlider
              label="Fırça Boyutu"
              value={dodgeBurnRadius.value}
              min={3}
              max={35}
              step={1}
              defaultValue={12}
              unit="%"
              bipolar={false}
              description="Kısa kenara oranla yumuşak C² tüylü karanlık oda maske çapı"
              onChange={(v) => {
                dodgeBurnRadius.value = v;
              }}
            />

            <PrecisionSlider
              label="Fırça Gücü"
              value={dodgeBurnStrength.value}
              min={2}
              max={40}
              step={1}
              defaultValue={12}
              unit="%"
              bipolar={false}
              description="Darbe başına yerel poz değişimi (kalem basıncı ile orantılı)"
              onChange={(v) => {
                dodgeBurnStrength.value = v;
              }}
            />
          </div>

          <div class="flex items-center justify-between gap-2 pt-1">
            <span class="text-[8px] font-mono text-neutral-400 leading-tight">
              {currentBrush === 'off'
                ? 'Fotoğraf üzerinde yerel pozlama yapmak için Dodge veya Burn aracını seçin.'
                : 'Fotoğrafın üzerinde sürükleyerek yerel pozlamayı doğrudan uygulayın.'}
            </span>

            <button
              type="button"
              disabled={!hasDodgeBurnEdits.value}
              onClick={() => {
                clearDodgeBurn();
                showToast('Dodge & Burn pozlama haritası temizlendi.', 'info', 2000);
              }}
              class="shrink-0 px-2.5 py-1.5 rounded-xl text-[9px] font-mono font-bold border border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center gap-1"
            >
              <ResetIcon class="w-3 h-3" />
              <span>Haritayı Temizle</span>
            </button>
          </div>
        </div>
      )}

      {subTab === 'finishing' && (
        <FinishingTab onExport={onExport} isExporting={isExporting} />
      )}
    </div>
  );
}
