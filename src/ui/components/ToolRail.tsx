import { activeTab } from '../store';
import { ToolTab } from '../types';
import {
  SunIcon,
  PaletteIcon,
  FilmIcon,
  ApertureIcon,
  HistogramIcon,
  StampIcon
} from './Icons';
import { ComponentChildren } from 'preact';

export function ToolRail() {
  const currentTab = activeTab.value;

  const tabs: { id: ToolTab; label: string; icon: ComponentChildren }[] = [
    { id: 'light', label: 'Işık', icon: <SunIcon class="w-3.5 h-3.5" /> },
    { id: 'color', label: 'Renk', icon: <PaletteIcon class="w-3.5 h-3.5" /> },
    { id: 'film', label: 'Film', icon: <FilmIcon class="w-3.5 h-3.5" /> },
    { id: 'optics', label: 'Optik', icon: <ApertureIcon class="w-3.5 h-3.5" /> },
    { id: 'histogram', label: 'Histogram', icon: <HistogramIcon class="w-3.5 h-3.5" /> },
    { id: 'finishing', label: 'Bitiş', icon: <StampIcon class="w-3.5 h-3.5" /> }
  ];

  return (
    <div class="bg-neutral-900/95 p-1 rounded-2xl border border-neutral-800 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-md shrink-0">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              activeTab.value = tab.id;
            }}
            class={`flex-1 min-w-[54px] sm:min-w-[64px] py-1.5 px-1.5 sm:px-2 text-[9px] sm:text-[10px] font-mono font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap ${
              isActive
                ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            <span class="flex items-center justify-center">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
