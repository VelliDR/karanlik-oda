import { activeTab } from '../store';
import { ToolTab } from '../types';

export function ToolRail() {
  const currentTab = activeTab.value;

  const tabs: { id: ToolTab; label: string; icon: string }[] = [
    { id: 'light', label: 'Işık', icon: '☀️' },
    { id: 'color', label: 'Renk', icon: '🎨' },
    { id: 'film', label: 'Film', icon: '🎞️' },
    { id: 'optics', label: 'Optik', icon: '🔍' },
    { id: 'histogram', label: 'Histogram', icon: '📊' },
    { id: 'finishing', label: 'Baskı', icon: '🏷️' }
  ];

  return (
    <div class="bg-neutral-900/90 p-1 rounded-2xl border border-neutral-800 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-md">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              activeTab.value = tab.id;
            }}
            class={`flex-1 min-w-[64px] py-1.5 px-2 text-[10px] font-mono font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
              isActive
                ? 'bg-amber-500 text-neutral-950 shadow-md font-extrabold'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
