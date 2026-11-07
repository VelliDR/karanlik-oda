import { signal, computed } from '@preact/signals';
import { DEFAULT_SETTINGS, PhotoEditor } from '../core/editor';
import { HistoryManager } from '../core/history';
import {
  DodgeBurnToolMode,
  ExportFormat,
  PaperType,
  PresetKey,
  RotationDegree,
  SliderSettings,
  StripConfig
} from '../core/types';
import { PAPER_PROFILES } from '../core/paper/constants';
import {
  DEFAULT_STRIP_CONFIG,
  STRIP_MAX_FRAMES
} from '../core/strip/constants';
import {
  clearStripCellCache,
  composeFilmStrip,
  resolveFrameEffectiveSettings,
  StripFrameSource,
  StripMemoryStats
} from '../core/strip/strip-compositor';
import {
  StripWorkerExportPayload,
  StripWorkerMessageToMain
} from '../core/strip/strip-export.worker';
import { getCustomCubeLUT } from '../core/lut3d';
import { inject300DpiAndExifToJpeg, inject300DpiToPng } from '../core/metadata';
import { convertHeicToLossless, isHeicFile } from '../core/heic-loader';
import { isRawFile, RawMetadata } from '../core/raw/libraw-types';
import { RawWorkerOutputMessage } from '../core/raw/raw.worker';
import { PrintSubTab, ToolTab, WorkspaceMode } from './types';
import { PRESETS } from '../core/presets';
import { SmartRecipeSuggestion } from '../core/smart-recipe';

export interface StripFrameUIItem extends StripFrameSource {
  thumbUrl: string;
  width: number;
  height: number;
}

// Active editor instance reference
let editorInstance: PhotoEditor | null = null;
let historyInstance: HistoryManager | null = null;
let nextStripFrameSeq = 1;

// Reactive signals
export const workspaceMode = signal<WorkspaceMode>('develop');
export const activeTab = signal<ToolTab>('light');
export const activePrintSubTab = signal<PrintSubTab>('enlarger');
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

// Faz 1: Dodge & Burn Brush Signals
export const dodgeBurnTool = signal<DodgeBurnToolMode>('off');
export const dodgeBurnRadius = signal<number>(12); // Kısa kenarın %'si (3 .. 35)
export const dodgeBurnStrength = signal<number>(12); // Darbe gücü %'si (2 .. 40)
export const hasDodgeBurnEdits = signal<boolean>(false);

// Faz 5: Film Strip & Contact Sheet Signals
export const stripFrames = signal<StripFrameUIItem[]>([]);
export const stripConfig = signal<StripConfig>({ ...DEFAULT_STRIP_CONFIG });
export const editingStripFrameId = signal<string | null>(null);
export const stripRenderRevision = signal<number>(0);

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

export function isMonoNegativePreset(preset: PresetKey): boolean {
  return preset === 'hp5' || preset === 'sb';
}

function bumpStripRevision(): void {
  stripRenderRevision.value = stripRenderRevision.value + 1;
}

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
  hasDodgeBurnEdits.value = editorInstance.hasDodgeBurnChanges;

  if (!editorInstance.settings.printEnabled && dodgeBurnTool.value !== 'off') {
    dodgeBurnTool.value = 'off';
  }

  // Faz 1 kağıt katmanı kapandığında Faz 5 Kontakt Baskı modu kilitlenir
  if (!editorInstance.settings.printEnabled && stripConfig.value.outputMode === 'contact') {
    stripConfig.value = {
      ...stripConfig.value,
      outputMode: 'positive'
    };
    bumpStripRevision();
  }

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

  if (key === 'aiDepthEnabled') {
    depthEnabled.value = Boolean(value);
  }
  if (key === 'printEnabled' && !value && stripConfig.value.outputMode === 'contact') {
    stripConfig.value = {
      ...stripConfig.value,
      outputMode: 'positive'
    };
  }
  bumpStripRevision();
}

export function commitSettingToHistory(): void {
  if (!editorInstance || !historyInstance) return;
  historyInstance.push(editorInstance.getSnapshot());
  canUndo.value = historyInstance.canUndo();
  canRedo.value = historyInstance.canRedo();

  // Eğer tekil bir şerit karesi düzenleniyorsa ayarları kareye geri yansıt
  syncActiveFrameIfEditing();
}

function syncActiveFrameIfEditing(): void {
  const frameId = editingStripFrameId.value;
  if (!frameId || !editorInstance) return;

  const s = editorInstance.settings;
  const rot = editorInstance.rotation;
  stripFrames.value = stripFrames.value.map((item) => {
    if (item.id !== frameId) return item;
    return {
      ...item,
      rotation: rot,
      presetOverride: s.preset,
      settingsOverride: {
        ...s,
        printEnabled: false,
        filmBorder: 'none',
        quartzDate: false
      }
    };
  });
  bumpStripRevision();
}

export function setWorkspaceMode(mode: WorkspaceMode): { switchedToMonoPreset: boolean } {
  if (workspaceMode.value !== 'strip' && mode === 'strip' && editingStripFrameId.value) {
    syncActiveFrameIfEditing();
    editingStripFrameId.value = null;
  }

  workspaceMode.value = mode;

  if (mode === 'develop') {
    dodgeBurnTool.value = 'off';
    return { switchedToMonoPreset: false };
  }

  if (mode === 'strip') {
    dodgeBurnTool.value = 'off';
    if (!sliderSettings.value.printEnabled && stripConfig.value.outputMode === 'contact') {
      stripConfig.value = {
        ...stripConfig.value,
        outputMode: 'positive'
      };
    }
    bumpStripRevision();
    return { switchedToMonoPreset: false };
  }

  if (!editorInstance) {
    return { switchedToMonoPreset: false };
  }

  let changed = false;
  let switchedToMonoPreset = false;

  if (!isMonoNegativePreset(editorInstance.settings.preset)) {
    const hp5 = PRESETS.hp5;
    editorInstance.settings = {
      ...editorInstance.settings,
      preset: 'hp5',
      shoulder: hp5.defaultShoulder ?? editorInstance.settings.shoulder,
      halation: hp5.defaultHalation ?? editorInstance.settings.halation,
      devPushPull: hp5.defaultPushPull
    };
    switchedToMonoPreset = true;
    changed = true;
  }

  if (!editorInstance.settings.printEnabled) {
    editorInstance.settings = {
      ...editorInstance.settings,
      printEnabled: true
    };
    changed = true;
  }

  if (editorInstance.settings.aiShowDepthMap) {
    editorInstance.settings.aiShowDepthMap = false;
    depthShowMap.value = false;
    changed = true;
  }

  if (changed) {
    editorInstance.scheduleRender();
    syncFromEditor();
    commitSettingToHistory();
  }

  return { switchedToMonoPreset };
}

export function setPrintLayerEnabled(enabled: boolean): { switchedToMonoPreset: boolean } {
  if (!editorInstance) return { switchedToMonoPreset: false };

  let switchedToMonoPreset = false;
  const nextSettings: SliderSettings = {
    ...editorInstance.settings,
    printEnabled: enabled
  };

  if (enabled && !isMonoNegativePreset(nextSettings.preset)) {
    const hp5 = PRESETS.hp5;
    nextSettings.preset = 'hp5';
    nextSettings.shoulder = hp5.defaultShoulder ?? nextSettings.shoulder;
    nextSettings.halation = hp5.defaultHalation ?? nextSettings.halation;
    nextSettings.devPushPull = hp5.defaultPushPull;
    switchedToMonoPreset = true;
  }

  if (!enabled) {
    dodgeBurnTool.value = 'off';
    if (stripConfig.value.outputMode === 'contact') {
      stripConfig.value = {
        ...stripConfig.value,
        outputMode: 'positive'
      };
    }
  }

  editorInstance.settings = nextSettings;
  editorInstance.scheduleRender();
  syncFromEditor();
  commitSettingToHistory();
  bumpStripRevision();

  return { switchedToMonoPreset };
}

export function setPaperType(paperType: PaperType): void {
  if (!editorInstance) return;
  const profile = PAPER_PROFILES[paperType] || PAPER_PROFILES['rc-glossy'];
  editorInstance.settings = {
    ...editorInstance.settings,
    printPaperType: paperType,
    printPaperTone: profile.defaultPaperTone
  };
  editorInstance.scheduleRender();
  syncFromEditor();
  commitSettingToHistory();
  bumpStripRevision();
}

function getBrushParams() {
  const radiusNorm = Math.max(0.02, Math.min(0.35, dodgeBurnRadius.value / 100));
  const strengthStops = Math.max(0.01, Math.min(0.35, (dodgeBurnStrength.value / 100) * 0.6));
  return { radiusNorm, strengthStops };
}

export function paintDodgeBurnStrokeStart(
  normX: number,
  normY: number,
  pressure: number
): void {
  if (!editorInstance || !editorInstance.hasImage || !editorInstance.settings.printEnabled) return;
  const mode = dodgeBurnTool.value;
  if (mode === 'off') return;

  const { radiusNorm, strengthStops } = getBrushParams();
  editorInstance.paintDodgeBurnDab({
    normX,
    normY,
    radiusNorm,
    mode,
    strengthStops,
    pressure
  });
  hasDodgeBurnEdits.value = editorInstance.hasDodgeBurnChanges;
}

export function paintDodgeBurnStrokeMove(
  fromNormX: number,
  fromNormY: number,
  toNormX: number,
  toNormY: number,
  pressure: number
): void {
  if (!editorInstance || !editorInstance.hasImage || !editorInstance.settings.printEnabled) return;
  const mode = dodgeBurnTool.value;
  if (mode === 'off') return;

  const { radiusNorm, strengthStops } = getBrushParams();
  editorInstance.paintDodgeBurnSegment(fromNormX, fromNormY, toNormX, toNormY, {
    radiusNorm,
    mode,
    strengthStops,
    pressure
  });
  hasDodgeBurnEdits.value = editorInstance.hasDodgeBurnChanges;
}

export function finishDodgeBurnStroke(): void {
  if (!editorInstance) return;
  hasDodgeBurnEdits.value = editorInstance.hasDodgeBurnChanges;
  commitSettingToHistory();
}

export function clearDodgeBurn(): void {
  if (!editorInstance) return;
  editorInstance.clearDodgeBurnMap();
  hasDodgeBurnEdits.value = false;
  commitSettingToHistory();
}

export function setPreset(key: PresetKey): void {
  if (!editorInstance) return;
  const p = PRESETS[key] || PRESETS.none;
  editorInstance.settings = {
    ...editorInstance.settings,
    preset: key,
    shoulder: p.defaultShoulder !== undefined ? p.defaultShoulder : editorInstance.settings.shoulder,
    halation: p.defaultHalation !== undefined ? p.defaultHalation : editorInstance.settings.halation,
    devPushPull: p.defaultPushPull
  };
  editorInstance.scheduleRender();
  syncFromEditor();
  commitSettingToHistory();
  bumpStripRevision();
}

export function undo(): void {
  if (!editorInstance || !historyInstance) return;
  const snapshot = historyInstance.undo();
  if (snapshot) {
    editorInstance.applySnapshot(snapshot);
    syncFromEditor();
    syncActiveFrameIfEditing();
  }
}

export function redo(): void {
  if (!editorInstance || !historyInstance) return;
  const snapshot = historyInstance.redo();
  if (snapshot) {
    editorInstance.applySnapshot(snapshot);
    syncFromEditor();
    syncActiveFrameIfEditing();
  }
}

export function resetSettings(): void {
  if (!editorInstance || !historyInstance) return;
  dodgeBurnTool.value = 'off';
  editingStripFrameId.value = null;
  workspaceMode.value = 'develop';
  editorInstance.resetSettings();
  syncFromEditor();
  commitSettingToHistory();
  bumpStripRevision();
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
    devPushPull: p.defaultPushPull,
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
  bumpStripRevision();
}

export function setComparing(val: boolean): void {
  if (!editorInstance) return;
  isComparing.value = val;
  editorInstance.setComparing(val);
}

export function toggleZoom(): void {
  isZoomed.value = !isZoomed.value;
}

// ============================================================================
// FAZ 5: FİLM ŞERİDİ VE KONTAKT BASKI DURUM YÖNETİMİ
// ============================================================================

async function decodeRawFileToPngBlob(file: File): Promise<Blob> {
  const rawBuffer = await file.arrayBuffer();
  const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
    const worker = new Worker(new URL('../core/raw/raw.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = (e: MessageEvent<RawWorkerOutputMessage>) => {
      const data = e.data;
      if (data.type === 'full_ready') {
        worker.terminate();
        resolve(data.imageBitmap);
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ type: 'export_full', buffer: rawBuffer }, [rawBuffer]);
  });

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('RAW dönüştürme tuvali oluşturulamadı.');
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('RAW PNG oluşturulamadı.'))), 'image/png');
    });
    canvas.width = 0;
    canvas.height = 0;
    return pngBlob;
  } finally {
    bitmap.close();
  }
}

async function buildTinyThumbnailAndDimensions(
  blob: Blob
): Promise<{ thumbUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const width = bmp.width;
  const height = bmp.height;
  try {
    const maxThumb = 180;
    const scale = Math.min(1.0, maxThumb / Math.max(1, Math.max(width, height)));
    const tw = Math.max(16, Math.round(width * scale));
    const th = Math.max(16, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Küçük önizleme tuvali oluşturulamadı.');
    ctx.drawImage(bmp, 0, 0, tw, th);
    const thumbBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Küçük önizleme üretilemedi.'))),
        'image/jpeg',
        0.82
      );
    });
    canvas.width = 0;
    canvas.height = 0;
    return {
      thumbUrl: URL.createObjectURL(thumbBlob),
      width,
      height
    };
  } finally {
    // Tam çözünürlüklü ImageBitmap anında kapatılır! Bellekte yalnızca sıkıştırılmış Blob kalır.
    bmp.close();
  }
}

/**
 * Seçilen dosyaları (RAW, HEIC, JPEG, PNG, WebP) sırayla (bellekte aynı anda en fazla 1 kare açarak)
 * şerit listesine ekler. Maksimum 6 kare sınırını uygular.
 */
export async function addFilesToStrip(
  files: FileList | File[],
  onStatus?: (msg: string) => void
): Promise<{ added: number; skippedMax: boolean }> {
  const list = Array.from(files);
  const current = [...stripFrames.value];
  let added = 0;
  let skippedMax = false;

  for (const file of list) {
    if (current.length >= STRIP_MAX_FRAMES) {
      skippedMax = true;
      break;
    }

    const cleanName = file.name.replace(/\.[^/.]+$/, '') || `kare_${nextStripFrameSeq}`;
    if (onStatus) {
      onStatus(`${file.name} şeride hazırlanıyor...`);
    }

    let normalizedBlob: Blob = file;
    if (isRawFile(file)) {
      normalizedBlob = await decodeRawFileToPngBlob(file);
    } else if (isHeicFile(file)) {
      normalizedBlob = await convertHeicToLossless(file);
    }

    const { thumbUrl, width, height } = await buildTinyThumbnailAndDimensions(normalizedBlob);
    const id = `strip-frame-${Date.now()}-${nextStripFrameSeq++}`;

    current.push({
      id,
      fileName: cleanName,
      blob: normalizedBlob,
      rotation: 0,
      presetOverride: null,
      settingsOverride: null,
      thumbUrl,
      width,
      height
    });
    added++;
  }

  if (added > 0) {
    stripFrames.value = current;
    bumpStripRevision();
  }

  return { added, skippedMax };
}

/**
 * Düzenleyicide halihazırda açık olan fotoğrafı tek tıkla film şeridine ekler.
 */
export async function addCurrentEditorPhotoToStrip(): Promise<boolean> {
  if (!editorInstance || !editorInstance.currentSourceBlob) return false;
  if (stripFrames.value.length >= STRIP_MAX_FRAMES) return false;

  const srcBlob = editorInstance.currentSourceBlob;
  let normalizedBlob: Blob = srcBlob;
  if (srcBlob instanceof File && isRawFile(srcBlob)) {
    normalizedBlob = await decodeRawFileToPngBlob(srcBlob);
  } else if (srcBlob instanceof File && isHeicFile(srcBlob)) {
    normalizedBlob = await convertHeicToLossless(srcBlob);
  }

  const { thumbUrl, width, height } = await buildTinyThumbnailAndDimensions(normalizedBlob);
  const id = `strip-frame-${Date.now()}-${nextStripFrameSeq++}`;

  stripFrames.value = [
    ...stripFrames.value,
    {
      id,
      fileName: imageFileName.value || `kare_${nextStripFrameSeq}`,
      blob: normalizedBlob,
      rotation: editorInstance.rotation,
      presetOverride: null,
      settingsOverride: null,
      thumbUrl,
      width,
      height
    }
  ];
  bumpStripRevision();
  return true;
}

export function reorderStripFrames(fromIndex: number, toIndex: number): void {
  const arr = [...stripFrames.value];
  if (
    fromIndex < 0 ||
    fromIndex >= arr.length ||
    toIndex < 0 ||
    toIndex >= arr.length ||
    fromIndex === toIndex
  ) {
    return;
  }
  const [moved] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, moved);
  stripFrames.value = arr;
  bumpStripRevision();
}

export function removeStripFrame(id: string): void {
  const target = stripFrames.value.find((f) => f.id === id);
  if (target?.thumbUrl) {
    try {
      URL.revokeObjectURL(target.thumbUrl);
    } catch {}
  }
  if (editingStripFrameId.value === id) {
    editingStripFrameId.value = null;
  }
  stripFrames.value = stripFrames.value.filter((f) => f.id !== id);
  stripConfig.value = {
    ...stripConfig.value,
    markedFrameIds: stripConfig.value.markedFrameIds.filter((m) => m !== id)
  };
  bumpStripRevision();
}

export function clearStripFrames(): void {
  for (const f of stripFrames.value) {
    if (f.thumbUrl) {
      try {
        URL.revokeObjectURL(f.thumbUrl);
      } catch {}
    }
  }
  editingStripFrameId.value = null;
  stripFrames.value = [];
  stripConfig.value = {
    ...stripConfig.value,
    markedFrameIds: []
  };
  clearStripCellCache();
  bumpStripRevision();
}

export function setStripFramePresetOverride(id: string, preset: PresetKey | null): void {
  stripFrames.value = stripFrames.value.map((f) =>
    f.id === id ? { ...f, presetOverride: preset } : f
  );
  bumpStripRevision();
}

export function rotateStripFrameClockwise(id: string): void {
  stripFrames.value = stripFrames.value.map((f) =>
    f.id === id
      ? { ...f, rotation: (((f.rotation + 90) % 360) as RotationDegree) }
      : f
  );
  bumpStripRevision();
}

export function toggleStripFrameGreaseMark(id: string): void {
  const cur = stripConfig.value.markedFrameIds;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  stripConfig.value = {
    ...stripConfig.value,
    markedFrameIds: next
  };
  bumpStripRevision();
}

export function updateStripConfig<K extends keyof StripConfig>(
  key: K,
  value: StripConfig[K]
): boolean {
  // Spesifikasyon Kabul Kriteri: Faz 1 (printEnabled) kapalıyken Kontakt Baskı seçilemez!
  if (key === 'outputMode' && value === 'contact' && !sliderSettings.value.printEnabled) {
    return false;
  }
  stripConfig.value = {
    ...stripConfig.value,
    [key]: value
  };
  bumpStripRevision();
  return true;
}

/**
 * Şeritteki bir kareye tıklandığında o kareyi tek başına `Negatif Banyo` düzenlemesine açar.
 */
export async function openStripFrameForSingleEdit(id: string): Promise<boolean> {
  if (!editorInstance || !historyInstance) return false;
  const frame = stripFrames.value.find((f) => f.id === id);
  if (!frame) return false;

  const effectiveSettings = resolveFrameEffectiveSettings(frame, sliderSettings.value);
  // Mevcut kağıt baskı durumunu koru ki şeride dönüldüğünde Faz 1 kapanmasın
  const keepPrintEnabled = Boolean(sliderSettings.value.printEnabled);

  await editorInstance.loadImageFromBlob(frame.blob);
  editorInstance.rotation = frame.rotation;
  editorInstance.settings = {
    ...effectiveSettings,
    printEnabled: keepPrintEnabled,
    printPaperType: sliderSettings.value.printPaperType,
    printGrade: sliderSettings.value.printGrade,
    printExposure: sliderSettings.value.printExposure,
    printSplitGrade: sliderSettings.value.printSplitGrade,
    printSplitRatio: sliderSettings.value.printSplitRatio,
    printPaperTone: sliderSettings.value.printPaperTone,
    printSelenium: sliderSettings.value.printSelenium,
    printSepia: sliderSettings.value.printSepia
  };

  imageFileName.value = frame.fileName;
  editingStripFrameId.value = frame.id;
  workspaceMode.value = 'develop';

  editorInstance.scheduleRender();
  syncFromEditor();
  historyInstance.reset(editorInstance.getSnapshot());
  syncFromEditor();
  return true;
}

export function returnToStripFromSingleEdit(): void {
  syncActiveFrameIfEditing();
  editingStripFrameId.value = null;
  workspaceMode.value = 'strip';
  bumpStripRevision();
}

/**
 * Faz 5 Film Şeridi veya Kontakt Baskıyı 300 DPI (pHYs / JFIF) metaverisiyle
 * arka plan Web Worker üzerinden dışa aktarır.
 */
export async function exportStripOrContactSheet(
  onProgress?: (percent: number, message: string) => void
): Promise<{
  blob: Blob;
  extension: string;
  mimeType: string;
  stats: StripMemoryStats;
}> {
  const frames = stripFrames.value;
  if (frames.length === 0) {
    throw new Error('Dışa aktarmak için şeritte kare bulunmuyor.');
  }

  const shared = { ...sliderSettings.value };
  const cfg: StripConfig = {
    ...stripConfig.value,
    outputMode:
      stripConfig.value.outputMode === 'contact' && !shared.printEnabled
        ? 'positive'
        : stripConfig.value.outputMode
  };
  const format: ExportFormat = shared.exportFormat || 'image/png';
  const quality = shared.exportQuality ?? 1.0;
  const customLut = getCustomCubeLUT();

  const plainFrames: StripFrameSource[] = frames.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    blob: f.blob,
    rotation: f.rotation,
    presetOverride: f.presetOverride,
    settingsOverride: f.settingsOverride ? { ...f.settingsOverride } : null
  }));

  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL('../core/strip/strip-export.worker.ts', import.meta.url),
          { type: 'module' }
        );
        worker.onmessage = (e: MessageEvent<StripWorkerMessageToMain>) => {
          const msg = e.data;
          if (msg.type === 'progress') {
            if (onProgress) onProgress(msg.percent, msg.message);
          } else if (msg.type === 'success') {
            worker.terminate();
            resolve({
              blob: msg.blob,
              extension: msg.extension,
              mimeType: msg.mimeType,
              stats: msg.stats
            });
          } else if (msg.type === 'error') {
            worker.terminate();
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };

        const payload: StripWorkerExportPayload = {
          frames: plainFrames,
          sharedSettings: shared,
          stripConfig: cfg,
          format,
          quality,
          dpi: 300,
          customLut
        };
        worker.postMessage(payload);
      });
    } catch (workerErr) {
      console.warn('Strip worker başarısız oldu, ana iş parçacığı yedeğine geçiliyor:', workerErr);
    }
  }

  // Ana iş parçacığı sıralı yedek (yine 1 kare/an bellek kuralıyla)
  const composed = await composeFilmStrip({
    frames: plainFrames,
    sharedSettings: shared,
    stripConfig: cfg,
    customLut,
    useCellCache: false,
    onProgress
  });

  try {
    let blob: Blob;
    if ('convertToBlob' in composed.canvas) {
      blob = await composed.canvas.convertToBlob({ type: format, quality });
    } else {
      const htmlCanvas = composed.canvas as HTMLCanvasElement;
      blob = await new Promise<Blob>((resolve, reject) => {
        htmlCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Şerit Blob oluşturulamadı.'))),
          format,
          quality
        );
      });
    }

    composed.canvas.width = 0;
    composed.canvas.height = 0;

    if (format === 'image/jpeg') {
      blob = await inject300DpiAndExifToJpeg(blob, [], 300);
    } else if (format === 'image/png') {
      blob = await inject300DpiToPng(blob, 300);
    }

    const extMap: Record<ExportFormat, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp'
    };

    return {
      blob,
      extension: extMap[format] || 'png',
      mimeType: format,
      stats: composed.stats
    };
  } finally {
    composed.canvas.width = 0;
    composed.canvas.height = 0;
  }
}
