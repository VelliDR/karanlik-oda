import {
  ExportFormat,
  PresetKey,
  StripOrientation,
  StripOutputMode,
  StripResolutionPreset
} from '../../core/types';
import { PRESETS } from '../../core/presets';
import { formatMultigradeLabel, PAPER_PROFILES } from '../../core/paper/constants';
import {
  DEFAULT_STRIP_EDGE_TEXT,
  STRIP_MAX_FRAMES,
  STRIP_MIN_FRAMES,
  STRIP_RESOLUTION_OPTIONS
} from '../../core/strip/constants';
import {
  addCurrentEditorPhotoToStrip,
  clearStripFrames,
  commitSettingToHistory,
  imageLoaded,
  setPreset,
  setPrintLayerEnabled,
  setWorkspaceMode,
  sliderSettings,
  stripConfig,
  stripFrames,
  updateSetting,
  updateStripConfig
} from '../store';
import { showToast } from '../toast';
import {
  CameraIcon,
  ContactSheetIcon,
  EnlargerIcon,
  FilmIcon,
  FilmStripIcon,
  PencilMarkIcon,
  PlusIcon,
  PrinterIcon,
  ResetIcon,
  SaveIcon
} from './Icons';

interface ContactStripPanelProps {
  onOpenStripFilePicker: () => void;
  onExportStrip: () => void;
  isExporting?: boolean;
  isAddingFiles?: boolean;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'image/png', label: 'PNG (Kayıpsız)' },
  { value: 'image/jpeg', label: 'JPEG (%100)' },
  { value: 'image/webp', label: 'WebP' }
];

export function ContactStripPanel({
  onOpenStripFilePicker,
  onExportStrip,
  isExporting,
  isAddingFiles
}: ContactStripPanelProps) {
  const frames = stripFrames.value;
  const cfg = stripConfig.value;
  const settings = sliderSettings.value;
  const printEnabled = Boolean(settings.printEnabled);
  const hasActiveSinglePhoto = imageLoaded.value;

  const activePaper = PAPER_PROFILES[settings.printPaperType ?? 'rc-glossy'] || PAPER_PROFILES['rc-glossy'];

  const handleSelectOutputMode = (mode: StripOutputMode) => {
    if (mode === 'contact' && !printEnabled) {
      showToast(
        'Kontakt Baskı modu için önce Faz 1 Kağıda Baskı katmanını etkinleştirin.',
        'error',
        2800
      );
      return;
    }
    updateStripConfig('outputMode', mode);
  };

  const handleEnablePrintAndContact = () => {
    const { switchedToMonoPreset } = setPrintLayerEnabled(true);
    updateStripConfig('outputMode', 'contact');
    if (switchedToMonoPreset) {
      showToast(
        'Kağıda Baskı katmanı ve Ilford HP5+ profili etkinleştirildi; Kontakt Baskı hazır.',
        'info',
        3000
      );
    } else {
      showToast('Kağıda Baskı katmanı açıldı; Kontakt Baskı aktif.', 'info', 2200);
    }
  };

  const handleAddActivePhoto = async () => {
    const ok = await addCurrentEditorPhotoToStrip();
    if (ok) {
      showToast('Aktif düzenleyici fotoğrafı şeride eklendi.', 'success', 2000);
    } else {
      showToast('Fotoğraf şeride eklenemedi (maksimum 6 kare).', 'error', 2400);
    }
  };

  return (
    <div class="space-y-3 select-none">
      {/* 1. Fotoğraf Seçimi (3–6 Kare) */}
      <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-2.5 shadow-md">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FilmStripIcon class="w-4 h-4 text-amber-400" />
            <div>
              <div class="text-[10px] font-mono font-bold tracking-wider text-amber-400">
                35MM FİLM ŞERİDİ & KONTAKT
              </div>
              <div class="text-[8px] font-mono text-neutral-400">
                ISO 1007 Tam Vektörel Rebate • Sıralı Bellek Mimarisi
              </div>
            </div>
          </div>
          <span
            class={`px-2 py-0.5 rounded-lg text-[9px] font-mono font-bold border ${
              frames.length >= STRIP_MIN_FRAMES
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-neutral-950 text-neutral-400 border-neutral-800'
            }`}
          >
            {frames.length} / {STRIP_MAX_FRAMES} Kare
          </span>
        </div>

        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={frames.length >= STRIP_MAX_FRAMES || Boolean(isAddingFiles)}
            onClick={onOpenStripFilePicker}
            class="py-2 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-[10px] font-mono font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
          >
            <PlusIcon class="w-3.5 h-3.5" />
            <span>Kare Ekle (3–6)</span>
          </button>

          <button
            type="button"
            disabled={!hasActiveSinglePhoto || frames.length >= STRIP_MAX_FRAMES || Boolean(isAddingFiles)}
            onClick={handleAddActivePhoto}
            class="py-2 px-2.5 rounded-xl bg-neutral-950/90 hover:bg-neutral-800 text-amber-300 border border-amber-600/40 text-[10px] font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none"
            title="Düzenleyicide açık olan fotoğrafı şeride ekle"
          >
            <CameraIcon class="w-3.5 h-3.5" />
            <span>Aktif Kareyi Ekle</span>
          </button>
        </div>

        {frames.length > 0 && (
          <div class="flex items-center justify-between pt-1 border-t border-neutral-800/80">
            <span class="text-[8px] font-mono text-neutral-400">
              {frames.length < STRIP_MIN_FRAMES
                ? `Standart şerit için en az ${STRIP_MIN_FRAMES} kare seçin (${STRIP_MIN_FRAMES - frames.length} kare kaldı).`
                : 'Kareleri sürükleyerek sıralayabilir veya dokunarak tekil düzenleyebilirsiniz.'}
            </span>
            <button
              type="button"
              disabled={Boolean(isAddingFiles)}
              onClick={() => {
                clearStripFrames();
                showToast('Film şeridi temizlendi.', 'info', 1800);
              }}
              class="px-2 py-1 rounded-lg text-[9px] font-mono text-neutral-400 hover:text-red-300 hover:bg-red-950/30 border border-neutral-800 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <ResetIcon class="w-3 h-3" />
              <span>Temizle</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. Çıktı Modu: Film Şeridi (Pozitif / Negatif) ve Kontakt Baskı */}
      <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-2.5 shadow-md">
        <span class="text-[10px] font-mono font-bold text-amber-400 flex items-center gap-1.5">
          <ContactSheetIcon class="w-3.5 h-3.5 text-amber-400" />
          <span>BASKI & GÖRÜNÜM MODU</span>
        </span>

        <div class="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            data-strip-output="positive"
            onClick={() => handleSelectOutputMode('positive')}
            class={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
              cfg.outputMode === 'positive'
                ? 'bg-amber-950/60 border-amber-500/80 text-amber-300'
                : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            }`}
          >
            <div class="text-[9px] font-mono font-bold">Pozitif Şerit</div>
            <div class="text-[7px] font-mono opacity-80 mt-0.5">Taranmış Slayt</div>
          </button>

          <button
            type="button"
            data-strip-output="negative"
            onClick={() => handleSelectOutputMode('negative')}
            class={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
              cfg.outputMode === 'negative'
                ? 'bg-amber-950/60 border-amber-500/80 text-amber-300'
                : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
            }`}
          >
            <div class="text-[9px] font-mono font-bold">Negatif Şerit</div>
            <div class="text-[7px] font-mono opacity-80 mt-0.5">Turuncu/Gümüş</div>
          </button>

          <button
            type="button"
            data-strip-output="contact"
            disabled={!printEnabled}
            onClick={() => handleSelectOutputMode('contact')}
            title={
              printEnabled
                ? 'Tüm şeridi Faz 1 fotoğraf kağıdına kontakt bas'
                : 'Kontakt Baskı için Kağıda Baskı katmanı aktif olmalıdır'
            }
            class={`p-2 rounded-xl border text-left transition-all ${
              !printEnabled
                ? 'bg-neutral-950/40 border-neutral-800/60 text-neutral-600 opacity-50 cursor-not-allowed'
                : cfg.outputMode === 'contact'
                  ? 'bg-amber-950/60 border-amber-500/80 text-amber-300 cursor-pointer'
                  : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 cursor-pointer'
            }`}
          >
            <div class="text-[9px] font-mono font-bold">Kontakt Baskı</div>
            <div class="text-[7px] font-mono opacity-80 mt-0.5">
              {printEnabled ? 'Faz 1 Kağıt' : 'Kağıt Kapalı'}
            </div>
          </button>
        </div>

        {!printEnabled && (
          <div class="p-2.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between gap-2">
            <span class="text-[8px] font-mono text-neutral-400 leading-relaxed">
              Kontakt Baskı, şeridi Faz 1 Multigrade fotoğraf kağıdı üzerine cam altında pozlar. Seçmek için Kağıda Baskı katmanını açın.
            </span>
            <button
              type="button"
              onClick={handleEnablePrintAndContact}
              class="px-2.5 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900/70 text-amber-300 border border-amber-500/40 text-[8px] font-mono font-bold shrink-0 cursor-pointer transition-colors"
            >
              Kağıdı Aç
            </button>
          </div>
        )}

        {printEnabled && cfg.outputMode === 'contact' && (
          <div class="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 flex items-center justify-between gap-2">
            <div class="text-[8px] font-mono text-amber-200/90">
              <span class="font-bold text-amber-300">{activePaper.name}</span> • Derece{' '}
              {formatMultigradeLabel(settings.printGrade ?? 2.0)}
            </div>
            <button
              type="button"
              onClick={() => setWorkspaceMode('print')}
              class="px-2 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-amber-300 border border-amber-500/30 text-[8px] font-mono font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <EnlargerIcon class="w-3 h-3" />
              <span>Kağıt Ayarı</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Şerit Düzeni, Kenar Yazısı ve Karanlık Oda Etkileri */}
      <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-3 shadow-md">
        <div class="space-y-1.5">
          <span class="text-[9px] font-mono font-bold text-neutral-300 uppercase">
            Şerit Yönelimi
          </span>
          <div class="grid grid-cols-2 gap-1.5">
            {(['horizontal', 'vertical'] as StripOrientation[]).map((orient) => {
              const active = cfg.orientation === orient;
              return (
                <button
                  key={orient}
                  type="button"
                  onClick={() => updateStripConfig('orientation', orient)}
                  class={`py-1.5 px-2.5 rounded-xl border text-[9px] font-mono font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-amber-500 text-neutral-950 border-amber-400'
                      : 'bg-neutral-950/70 text-neutral-400 border-neutral-800 hover:text-neutral-200'
                  }`}
                >
                  {orient === 'horizontal' ? 'Yatay Şerit (35mm)' : 'Dikey Şerit (35mm)'}
                </button>
              );
            })}
          </div>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label
              for="strip-edge-text-input"
              class="text-[9px] font-mono font-bold text-neutral-300 uppercase"
            >
              Kenar Yazısı (Rebate Metni)
            </label>
            {cfg.edgeText !== DEFAULT_STRIP_EDGE_TEXT && (
              <button
                type="button"
                onClick={() => updateStripConfig('edgeText', DEFAULT_STRIP_EDGE_TEXT)}
                class="text-[8px] font-mono text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                Varsayılana Dön
              </button>
            )}
          </div>
          <input
            id="strip-edge-text-input"
            type="text"
            maxLength={32}
            value={cfg.edgeText}
            placeholder={DEFAULT_STRIP_EDGE_TEXT}
            onInput={(e) =>
              updateStripConfig('edgeText', (e.target as HTMLInputElement).value)
            }
            class="w-full px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 focus:border-amber-500/70 focus:outline-none text-[10px] font-mono text-amber-200 tracking-wider uppercase"
          />
        </div>

        <div class="space-y-2 pt-1 border-t border-neutral-800/80">
          <label class="flex items-center justify-between cursor-pointer">
            <div>
              <div class="text-[9px] font-mono font-semibold text-neutral-200">
                Perforasyon Deliklerine Halasyon
              </div>
              <div class="text-[8px] font-mono text-neutral-500">
                KS-1870 delik çevresinde optik saçılma sızıntısı
              </div>
            </div>
            <input
              type="checkbox"
              checked={cfg.sprocketHalation}
              onChange={(e) =>
                updateStripConfig('sprocketHalation', (e.target as HTMLInputElement).checked)
              }
              class="w-4 h-4 accent-amber-500 rounded cursor-pointer"
            />
          </label>

          <label class="flex items-center justify-between cursor-pointer">
            <div class="flex items-center gap-1.5">
              <PencilMarkIcon class="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div>
                <div class="text-[9px] font-mono font-semibold text-neutral-200">
                  Mumlu Seçim Kalemi (Chinagraph)
                </div>
                <div class="text-[8px] font-mono text-neutral-500">
                  Kontakt baskıda işaretlenen kareleri çember içine alır
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={cfg.greasePencilMark}
              onChange={(e) =>
                updateStripConfig('greasePencilMark', (e.target as HTMLInputElement).checked)
              }
              class="w-4 h-4 accent-amber-500 rounded cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* 4. Ortak Film Emülsiyonu Seçimi */}
      <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-2 shadow-md">
        <div class="flex items-center justify-between">
          <span class="text-[9px] font-mono font-bold text-amber-400 flex items-center gap-1.5">
            <FilmIcon class="w-3.5 h-3.5 text-amber-400" />
            <span>ORTAK FİLM EMÜLSİYONU</span>
          </span>
        </div>

        <select
          value={settings.preset}
          onChange={(e) => setPreset((e.target as HTMLSelectElement).value as PresetKey)}
          class="w-full px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-[10px] font-mono text-neutral-200 focus:border-amber-500/70 focus:outline-none cursor-pointer"
        >
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
            <option key={key} value={key}>
              {PRESETS[key].name}
            </option>
          ))}
        </select>
        <p class="text-[8px] font-mono text-neutral-500 leading-relaxed">
          Ortak profil tüm şeride uygulanır. Aşağıdaki kare tepsisinden her kareye ayrı bir emülsiyon atayabilir veya kareye dokunarak tekil banyo yapabilirsiniz.
        </p>
      </div>

      {/* 5. 300 DPI Çıktı Çözünürlüğü ve Dışa Aktarma */}
      <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-2.5 shadow-md">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono font-bold text-amber-400 flex items-center gap-1.5">
            <PrinterIcon class="w-3.5 h-3.5 text-amber-400" />
            <span>300 DPI ŞERİT / KONTAKT ÇIKTISI</span>
          </span>
        </div>

        <div class="space-y-1.5">
          <label class="text-[8px] font-mono text-neutral-400 uppercase block">
            Uzun Kenar Çözünürlüğü (Bellek Korumalı)
          </label>
          <select
            value={cfg.longEdgePx}
            onChange={(e) =>
              updateStripConfig(
                'longEdgePx',
                Number((e.target as HTMLSelectElement).value) as StripResolutionPreset
              )
            }
            class="w-full px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800 text-[10px] font-mono text-neutral-200 focus:border-amber-500/70 focus:outline-none cursor-pointer"
          >
            {STRIP_RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.longEdgePx} value={opt.longEdgePx}>
                {opt.label} — {opt.printCmAt300Dpi} (~{opt.estimatedSheetPeakMb} MB)
              </option>
            ))}
          </select>
        </div>

        <div class="grid grid-cols-3 gap-1">
          {FORMAT_OPTIONS.map((fmt) => {
            const active = (settings.exportFormat || 'image/png') === fmt.value;
            return (
              <button
                key={fmt.value}
                type="button"
                onClick={() => {
                  updateSetting('exportFormat', fmt.value);
                  commitSettingToHistory();
                }}
                class={`py-1.5 px-2 rounded-lg text-[8px] font-mono font-bold border transition-colors cursor-pointer ${
                  active
                    ? 'bg-amber-950/70 border-amber-500/70 text-amber-300'
                    : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {fmt.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={frames.length < STRIP_MIN_FRAMES || Boolean(isExporting)}
          onClick={onExportStrip}
          class="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-mono font-extrabold text-[11px] tracking-wider shadow-lg transition-all active:scale-[0.99] disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
        >
          <SaveIcon class="w-4 h-4" />
          <span>
            {isExporting
              ? '300 DPI ŞERİT İŞLENİYOR...'
              : cfg.outputMode === 'contact'
                ? '300 DPI KONTAKT BASKIYI İNDİR'
                : '300 DPI FİLM ŞERİDİNİ İNDİR'}
          </span>
        </button>
      </div>
    </div>
  );
}
