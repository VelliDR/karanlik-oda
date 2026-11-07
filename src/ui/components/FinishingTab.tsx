import {
  sliderSettings,
  updateSetting,
  commitSettingToHistory,
  printDimensionsText,
  imageLoaded,
  isRaw
} from '../store';
import { FilmBorder, ExportFormat } from '../../core/types';
import { StampIcon, CalendarIcon, PrinterIcon, SaveIcon } from './Icons';

interface FinishingTabProps {
  onExport: () => void;
  isExporting?: boolean;
}

export function FinishingTab({ onExport, isExporting }: FinishingTabProps) {
  const settings = sliderSettings.value;
  const isQuartz = settings.quartzDate;
  const activeBorder = settings.filmBorder;
  const activeFormat = settings.exportFormat;

  const borders: { id: FilmBorder; label: string }[] = [
    { id: 'none', label: 'Çerçevesiz' },
    { id: 'clean-white', label: 'Galeri Beyaz' },
    { id: 'darkroom-black', label: 'Sergi Siyah' },
    { id: 'kodak-35mm', label: 'Kodak 35mm' }
  ];

  const formats: { id: ExportFormat; label: string; badge: string }[] = [
    { id: 'image/png', label: 'PNG', badge: 'Kayıpsız' },
    { id: 'image/jpeg', label: 'JPG', badge: 'Maks. Kalite' },
    { id: 'image/webp', label: 'WebP', badge: 'Hafif & Hızlı' }
  ];

  return (
    <div class="space-y-3.5 p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <span class="text-[10px] font-mono tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
          <StampIcon class="w-3.5 h-3.5 text-amber-400" /> BASKI & DIŞA AKTARMA (300 DPI)
        </span>
        <span class="text-[8px] font-mono text-emerald-400">Arşivsel Fine-Art</span>
      </div>

      {/* 90'lar Quartz Date Damgası */}
      <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-mono font-semibold text-amber-400 flex items-center gap-1.5">
            <CalendarIcon class="w-3 h-3 text-amber-400" /> 90'LAR QUARTZ DATE DAMGASI
          </span>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isQuartz}
              onChange={(e) => {
                updateSetting('quartzDate', (e.target as HTMLInputElement).checked);
                commitSettingToHistory();
              }}
              class="sr-only peer"
            />
            <div class="w-8 h-4 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600" />
          </label>
        </div>

        <div class={`space-y-1.5 transition-opacity ${isQuartz ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <input
            type="text"
            value={settings.quartzDateText}
            maxLength={12}
            onChange={(e) => {
              updateSetting('quartzDateText', (e.target as HTMLInputElement).value);
              commitSettingToHistory();
            }}
            class="w-full bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-xl text-xs font-mono text-amber-400 tracking-widest focus:border-amber-500 focus:outline-none"
          />
          <p class="text-[8px] text-neutral-400 font-mono">
            Sağ alt köşeye basılan 7-segment nostaljik turuncu LED tarih damgası
          </p>
        </div>
      </div>

      {/* Film ve Sergi Çerçevesi */}
      <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
        <span class="text-[9px] block text-neutral-400 font-mono tracking-wider font-semibold">
          FİLM VE BASKI ÇERÇEVESİ
        </span>

        <div class="grid grid-cols-2 gap-1.5">
          {borders.map((b) => {
            const isActive = activeBorder === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  updateSetting('filmBorder', b.id);
                  commitSettingToHistory();
                }}
                class={`p-2 rounded-xl text-xs font-mono border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold shadow-sm'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-white'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 300 DPI Laboratuvar Baskı Hesaplayıcısı */}
      <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-mono font-semibold text-emerald-400 flex items-center gap-1.5">
            <PrinterIcon class="w-3.5 h-3.5 text-emerald-400" /> 300 DPI BASKI HESAPLAYICISI
          </span>
          <span class="text-[8px] px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-mono font-bold">
            Arşivsel Standart
          </span>
        </div>

        <div class="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800/80 space-y-1.5 font-mono text-[9px]">
          <div class="flex justify-between text-neutral-400">
            <span>Baskı Çözünürlüğü:</span>
            <span class="text-emerald-400 font-bold">300 DPI (118.1 px/cm)</span>
          </div>
          <div class="flex justify-between text-neutral-400">
            <span>Fiziksel Boyut:</span>
            <span class="text-white font-bold">{printDimensionsText.value}</span>
          </div>
          <div class="flex justify-between text-neutral-400">
            <span>Renk Uzayı & EXIF:</span>
            <span class="text-amber-400 font-bold">
              {isRaw.value ? '16-bit Doğrusal Demosaic' : 'Tam Metadata Korunur'}
            </span>
          </div>
        </div>
      </div>

      {/* Çıktı Formatı Seçimi */}
      <div class="bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2">
        <div class="flex justify-between items-center text-[10px] font-mono">
          <span class="text-neutral-300">DIŞA AKTARMA FORMATI</span>
          <span class="text-[9px] px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-bold">
            {activeFormat === 'image/png'
              ? 'PNG (Kayıpsız)'
              : activeFormat === 'image/jpeg'
              ? 'JPG (300 DPI)'
              : 'WebP'}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-1.5">
          {formats.map((f) => {
            const isActive = activeFormat === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  updateSetting('exportFormat', f.id);
                  commitSettingToHistory();
                }}
                class={`p-2 rounded-xl text-xs font-mono border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold shadow-sm'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-emerald-600/40 hover:text-white'
                }`}
              >
                <div>{f.label}</div>
                <div class="text-[7px] text-neutral-400 mt-0.5">{f.badge}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Full-Res Kaydet Butonu */}
      <button
        type="button"
        disabled={!imageLoaded.value || isExporting}
        onClick={onExport}
        class="w-full py-3.5 px-4 rounded-xl text-xs font-mono font-bold tracking-wider transition-all shadow-lg active:scale-98 cursor-pointer disabled:opacity-30 disabled:pointer-events-none bg-amber-500 hover:bg-amber-400 text-neutral-950 flex items-center justify-center gap-2"
      >
        <SaveIcon class="w-4 h-4 text-neutral-950" />
        <span>
          {isExporting ? 'İŞLENİYOR & MÜHÜRLENİYOR...' : 'TAM ÇÖZÜNÜRLÜKTE KAYDET (300 DPI)'}
        </span>
      </button>
    </div>
  );
}
