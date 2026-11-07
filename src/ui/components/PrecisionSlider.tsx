import { useState, useRef } from 'preact/hooks';

interface PrecisionSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  accent?: 'amber' | 'emerald' | 'cyan' | 'red' | 'purple';
  description?: string;
  bipolar?: boolean;
  disabled?: boolean;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
}

function roundToStep(val: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0 || Number.isInteger(step)) {
    return val;
  }
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  return Number(val.toFixed(decimals));
}

export function PrecisionSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  unit = '',
  accent = 'amber',
  description,
  bipolar,
  disabled = false,
  formatValue,
  onChange,
  onCommit
}: PrecisionSliderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editInput, setEditInput] = useState(String(value));
  const prevValRef = useRef(value);

  const isBipolar = bipolar !== undefined ? bipolar : min < 0;

  // Haptic feedback when crossing 0
  const handleInput = (e: Event) => {
    if (disabled) return;
    const newVal = roundToStep(parseFloat((e.target as HTMLInputElement).value), step);
    if (isBipolar && ((prevValRef.current < 0 && newVal >= 0) || (prevValRef.current > 0 && newVal <= 0))) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(8); } catch {}
      }
    }
    prevValRef.current = newVal;
    onChange(newVal);
  };

  const handleChange = (e: Event) => {
    if (disabled) return;
    const newVal = roundToStep(parseFloat((e.target as HTMLInputElement).value), step);
    if (onCommit) onCommit(newVal);
  };

  // Double click / tap to reset
  const handleReset = () => {
    if (disabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    onChange(defaultValue);
    if (onCommit) onCommit(defaultValue);
  };

  // Inline numeric input
  const handleValueClick = () => {
    if (disabled) return;
    setEditInput(String(roundToStep(value, step)));
    setIsEditing(true);
  };

  const handleEditSubmit = () => {
    setIsEditing(false);
    if (disabled) return;
    const parsed = parseFloat(editInput);
    if (!isNaN(parsed)) {
      const clamped = roundToStep(Math.max(min, Math.min(max, parsed)), step);
      onChange(clamped);
      if (onCommit) onCommit(clamped);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  // Calculate track highlight percent for custom bipolar fill
  const range = Math.max(1e-6, max - min);
  let fillLeft = 0;
  let fillWidth = 0;
  if (isBipolar) {
    const centerPct = ((0 - min) / range) * 100;
    const curPct = ((value - min) / range) * 100;
    if (value >= 0) {
      fillLeft = centerPct;
      fillWidth = curPct - centerPct;
    } else {
      fillLeft = curPct;
      fillWidth = centerPct - curPct;
    }
  } else {
    fillLeft = 0;
    fillWidth = ((value - min) / range) * 100;
  }

  // Accent color themes
  const accentClasses = {
    amber: 'text-amber-400 bg-amber-500',
    emerald: 'text-emerald-400 bg-emerald-500',
    cyan: 'text-cyan-400 bg-cyan-500',
    red: 'text-rose-400 bg-rose-500',
    purple: 'text-purple-400 bg-purple-500'
  }[accent];

  const isModified = Math.abs(value - defaultValue) > 1e-5;
  const valueColor = isModified ? 'text-amber-400 font-bold' : 'text-neutral-400';

  const renderedValue = formatValue
    ? formatValue(value)
    : `${value > 0 && isBipolar ? `+${roundToStep(value, step)}` : roundToStep(value, step)}${unit}`;

  return (
    <div class={`space-y-1.5 select-none py-1 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div class="flex justify-between items-center text-[10px] font-mono">
        <span 
          class="text-neutral-300 font-medium cursor-pointer hover:text-white transition-colors flex items-center gap-1"
          onDblClick={handleReset}
          title="Sıfırlamak için çift tıklayın"
        >
          {label}
          {isModified && (
            <span class="w-1 h-1 rounded-full bg-amber-400"></span>
          )}
        </span>

        {isEditing ? (
          <input
            type="number"
            step={step}
            class="w-16 px-1 py-0.5 bg-neutral-900 border border-amber-500 rounded text-amber-400 font-mono text-[10px] text-right outline-none"
            value={editInput}
            onInput={(e) => setEditInput((e.target as HTMLInputElement).value)}
            onBlur={handleEditSubmit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            class={`cursor-pointer px-1.5 py-0.5 rounded hover:bg-neutral-800 transition-colors ${valueColor}`}
            onClick={handleValueClick}
            onDblClick={handleReset}
            title="Sayı girmek için tıklayın, sıfırlamak için çift tıklayın"
          >
            {renderedValue}
          </span>
        )}
      </div>

      {/* Custom styled slider with center notch for bipolar */}
      <div class="relative flex items-center h-5 group">
        {/* Background track */}
        <div class="absolute w-full h-1 bg-neutral-800 rounded-full overflow-hidden pointer-events-none">
          {/* Active fill segment */}
          <div
            class={`absolute h-full ${accentClasses.split(' ')[1]} opacity-80 group-hover:opacity-100 transition-opacity`}
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          />
        </div>

        {/* Center notch indicator for bipolar sliders */}
        {isBipolar && (
          <div 
            class="absolute top-1/2 -translate-y-1/2 w-0.5 h-2 bg-neutral-600 rounded pointer-events-none z-10"
            style={{ left: `${((0 - min) / range) * 100}%` }}
          />
        )}

        {/* Invisible native range input on top for full accessibility and touch handling */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onInput={handleInput}
          onChange={handleChange}
          onDblClick={handleReset}
          class="w-full h-5 opacity-0 cursor-pointer z-20"
        />

        {/* Custom draggable thumb visual */}
        <div
          class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-neutral-950 border-2 border-amber-400 rounded-full shadow-md pointer-events-none z-15 transition-transform group-hover:scale-125"
          style={{ left: `${((value - min) / range) * 100}%` }}
        />
      </div>

      {description && (
        <p class="text-[8px] text-neutral-500 font-mono leading-tight">
          {description}
        </p>
      )}
    </div>
  );
}
