import { signal, computed } from '@preact/signals';
import { DEFAULT_SETTINGS, PhotoEditor } from '../core/editor';
import { HistoryManager } from '../core/history';
import { SliderSettings, PresetKey } from '../core/types';
import { ToolTab } from './types';
import { PRESETS } from '../core/presets';
import { RawMetadata } from '../core/raw/libraw-types';
import { SmartRecipeSuggestion } from '../core/smart-recipe';

// Active editor instance reference
let editorInstance: PhotoEditor | null = null;
let historyInstance: HistoryManager | null = null;

// Reactive signals
export const activeTab = signal<ToolTab>('light');
export const sliderSettings = signal<SliderSettings>({ ...DEFAULT_SETTINGS });
export const rotation = signal<number>(0);
export const imageLoaded = signal<boolean>(false);
export const imageFileName = signal<string>('foton_darkroom');
export const isRaw = signal<boolean>(false);
export const rawMetadata = signal<RawMetadata | null>(null);
export const imageDimensions = signal<{ width: number; height: number }>({ width: 0, height: 0 });
export const canUndo = signal<boolean>(false);
export const canRedo = signal<boolean>(false);
export const isComparing = signal<boolean>(false);
export const isZoomed = signal<boolean>(false);
export const printDimensionsText = signal<string>('Fotoğraf bekleniyor...');

// AI Depth Signals
export const depthEnabled = signal<boolean>(false);
export const depthAperture = signal<number>(50);
export const depthFocalDepth = signal<number>(0.5);
export const depthShowMap = signal<boolean>(false);
export const depthStatus = signal<string>('KAPALI');
export const depthProgress = signal<number>(0);
export const depthAnalyzing = signal<boolean>(false);

// Smart Recipe Signals
export const smartRecipeAnalyzing = signal<boolean>(false);
export const smartRecipeSuggestion = signal<SmartRecipeSuggestion | null>(null);

// Active preset description
export const activePresetDescription = computed(() => {
  const key = sliderSettings.value.preset;
  const p = PRESETS[key];
  if (!p) return 'Özel profil';
  return p.description || p.name;
});

export function registerEditor(editor: PhotoEditor, history: HistoryManager): void {
  editorInstance = editor;
  historyInstance = history;
  syncFromEditor();
}

export function syncFromEditor(): void {
  if (!editorInstance) return;
  sliderSettings.value = { ...editorInstance.settings };
  rotation.value = editorInstance.rotation;
  imageLoaded.value = editorInstance.hasImage;
  isRaw.value = editorInstance.isRawImage;
  rawMetadata.value = editorInstance.currentRawMetadata;

  const dims = editorInstance.originalDimensions;
  if (dims) {
    imageDimensions.value = dims;
  }

  if (editorInstance.hasImage) {
    const print = editorInstance.printDimensions;
    if (print) {
      printDimensionsText.value = `${print.widthCm.toFixed(1)} x ${print.heightCm.toFixed(1)} cm (${print.megapixels.toFixed(1)} MP)`;
    }
  } else {
    printDimensionsText.value = 'Fotoğraf bekleniyor...';
  }

  depthEnabled.value = editorInstance.settings.aiDepthEnabled;
  depthAperture.value = editorInstance.settings.aiDepthAperture;
  depthFocalDepth.value = editorInstance.settings.aiFocalDepth;
  depthShowMap.value = editorInstance.settings.aiShowDepthMap;
  depthStatus.value = editorInstance.depthStatusMessage || (editorInstance.settings.aiDepthEnabled ? 'AKTİF' : 'KAPALI');
  depthProgress.value = editorInstance.depthProgress;
  depthAnalyzing.value = editorInstance.isDepthAnalyzing;

  if (historyInstance) {
    canUndo.value = historyInstance.canUndo();
    canRedo.value = historyInstance.canRedo();
  }
}

export function updateSetting<K extends keyof SliderSettings>(key: K, value: SliderSettings[K]): void {
  if (!editorInstance) return;
  sliderSettings.value = { ...sliderSettings.value, [key]: value };
  editorInstance.settings[key] = value;
  editorInstance.scheduleRender();

  // If depth enabled toggled
  if (key === 'aiDepthEnabled') {
    depthEnabled.value = Boolean(value);
  }
}

export function commitSettingToHistory(): void {
  if (!editorInstance || !historyInstance) return;
  historyInstance.push(editorInstance.getSnapshot());
  canUndo.value = historyInstance.canUndo();
  canRedo.value = historyInstance.canRedo();
}

export function setPreset(key: PresetKey): void {
  if (!editorInstance) return;
  const p = PRESETS[key] || PRESETS.none;
  editorInstance.settings = {
    ...editorInstance.settings,
    preset: key,
    shoulder: p.defaultShoulder !== undefined ? p.defaultShoulder : editorInstance.settings.shoulder,
    halation: p.defaultHalation !== undefined ? p.defaultHalation : editorInstance.settings.halation
  };
  editorInstance.scheduleRender();
  syncFromEditor();
  commitSettingToHistory();
}

export function undo(): void {
  if (!editorInstance || !historyInstance) return;
  const snapshot = historyInstance.undo();
  if (snapshot) {
    editorInstance.applySnapshot(snapshot);
    syncFromEditor();
  }
}

export function redo(): void {
  if (!editorInstance || !historyInstance) return;
  const snapshot = historyInstance.redo();
  if (snapshot) {
    editorInstance.applySnapshot(snapshot);
    syncFromEditor();
  }
}

export function resetSettings(): void {
  if (!editorInstance || !historyInstance) return;
  editorInstance.resetSettings();
  syncFromEditor();
  commitSettingToHistory();
}

export function rotateImage(): void {
  if (!editorInstance || !historyInstance) return;
  editorInstance.rotateClockwise();
  syncFromEditor();
  commitSettingToHistory();
}

export function randomizeSettings(): void {
  if (!editorInstance || !historyInstance) return;
  const presetKeys: PresetKey[] = ['none', 'analog', 'kodachrome', 'velvia', 'cinestill', 'hp5', 'ccd', 'reze', 'vampir', 'gotik', 'nordic'];
  const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];
  const p = PRESETS[randomPreset] || PRESETS.none;

  editorInstance.settings = {
    ...editorInstance.settings,
    preset: randomPreset,
    shoulder: p.defaultShoulder ?? Math.floor(Math.random() * 40) + 20,
    halation: p.defaultHalation ?? Math.floor(Math.random() * 30),
    exposure: Math.floor(Math.random() * 20) - 10,
    contrast: Math.floor(Math.random() * 30) - 10,
    warmth: Math.floor(Math.random() * 30) - 15,
    saturation: Math.floor(Math.random() * 30) - 15,
    grain: Math.floor(Math.random() * 40) + 10,
    lightLeak: Math.random() > 0.6 ? Math.floor(Math.random() * 35) + 10 : 0
  };
  editorInstance.scheduleRender();
  syncFromEditor();
  commitSettingToHistory();
}

export function setComparing(val: boolean): void {
  if (!editorInstance) return;
  isComparing.value = val;
  editorInstance.setComparing(val);
}

export function toggleZoom(): void {
  isZoomed.value = !isZoomed.value;
}
