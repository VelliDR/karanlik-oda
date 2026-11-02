import { registerSW } from 'virtual:pwa-register';
import { PhotoEditor } from './core/editor';
import { PRESETS } from './core/presets';
import { HistoryManager } from './core/history';
import { convertHeicToLossless, isHeicFile } from './core/heic-loader';
import { ICONS } from './ui/icons';
import { showToast } from './ui/toast';
import { ExportFormat, FilmBorder, PresetKey, SliderSettings } from './core/types';

// Register PWA service worker with auto-update
registerSW({
  immediate: true,
  onNeedRefresh() {
    showToast('Yeni bir versiyon mevcut. Sayfa yenileniyor...', 'info', 2000);
  },
  onOfflineReady() {
    showToast('Karanlık Oda çevrimdışı kullanıma hazır!', 'success', 3000);
  }
});

// DOM Elements
const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const canvasWrapper = document.getElementById('canvas-wrapper') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const btnUpload = document.getElementById('btn-upload') as HTMLButtonElement;
const btnRotate = document.getElementById('btn-rotate') as HTMLButtonElement;
const btnRandomize = document.getElementById('btn-randomize') as HTMLButtonElement;
const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const btnCompare = document.getElementById('btn-compare') as HTMLButtonElement;
const btnZoomToggle = document.getElementById('btn-zoom-toggle') as HTMLButtonElement;
const canvasOverlayControls = document.getElementById('canvas-overlay-controls') as HTMLDivElement;
const placeholder = document.getElementById('no-image-placeholder') as HTMLDivElement;
const canvasDropzone = document.getElementById('canvas-dropzone') as HTMLDivElement;
const resolutionBadge = document.getElementById('resolution-badge') as HTMLDivElement;
const activePresetDesc = document.getElementById('active-preset-desc') as HTMLSpanElement;
const presetsContainer = document.getElementById('presets-container') as HTMLDivElement;
const btnPwaInstall = document.getElementById('btn-pwa-install') as HTMLButtonElement;
const saveBtnText = document.getElementById('save-btn-text') as HTMLSpanElement;
const formatBadge = document.getElementById('format-badge') as HTMLSpanElement;
const printDimensionsText = document.getElementById('print-dimensions-text') as HTMLSpanElement | null;

// Quartz date controls
const checkQuartzDate = document.getElementById('check-quartz-date') as HTMLInputElement;
const inputQuartzText = document.getElementById('input-quartz-text') as HTMLInputElement;
const quartzDateControls = document.getElementById('quartz-date-controls') as HTMLDivElement;

// Populate SVG icons
document.getElementById('icon-upload')!.innerHTML = ICONS.upload;
document.getElementById('icon-rotate')!.innerHTML = ICONS.rotate;
document.getElementById('icon-dice')!.innerHTML = ICONS.dice;
document.getElementById('icon-undo')!.innerHTML = ICONS.undo;
document.getElementById('icon-redo')!.innerHTML = ICONS.redo;
document.getElementById('icon-reset')!.innerHTML = ICONS.reset;
document.getElementById('icon-compare')!.innerHTML = ICONS.compare;
document.getElementById('icon-zoom')!.innerHTML = ICONS.zoom;
document.getElementById('icon-save')!.innerHTML = ICONS.save;
document.getElementById('pwa-install-icon')!.innerHTML = ICONS.install;

// Slider Registry
type NumericSliderKey = keyof Omit<
  SliderSettings,
  'preset' | 'quartzDate' | 'quartzDateText' | 'filmBorder' | 'exportFormat' | 'exportQuality'
>;

const sliders: Record<NumericSliderKey, HTMLInputElement> = {
  exposure: document.getElementById('slider-exposure') as HTMLInputElement,
  contrast: document.getElementById('slider-contrast') as HTMLInputElement,
  saturation: document.getElementById('slider-saturation') as HTMLInputElement,
  warmth: document.getElementById('slider-warmth') as HTMLInputElement,
  grain: document.getElementById('slider-grain') as HTMLInputElement,
  lightLeak: document.getElementById('slider-lightLeak') as HTMLInputElement,
  bleachBypass: document.getElementById('slider-bleachBypass') as HTMLInputElement,
  swirl: document.getElementById('slider-swirl') as HTMLInputElement,
  proMist: document.getElementById('slider-proMist') as HTMLInputElement,
  chromatic: document.getElementById('slider-chromatic') as HTMLInputElement,
  vignette: document.getElementById('slider-vignette') as HTMLInputElement
};

// Initialize Core Engine
const editor = new PhotoEditor(canvas);
const history = new HistoryManager(editor.getSnapshot());
let currentOriginalFileName = 'foton_darkroom';
let isZoomedIn = false;

// Setup Segmented Tool Deck Tabs
function setupDeckTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.deck-tab');
  const panels = document.querySelectorAll<HTMLDivElement>('.deck-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      if (!targetId) return;

      tabs.forEach((t) => {
        t.className =
          'deck-tab flex-1 py-1.5 text-[10px] font-mono font-semibold rounded-xl transition-all cursor-pointer text-white/60 hover:text-white';
      });
      tab.className =
        'deck-tab flex-1 py-1.5 text-[10px] font-mono font-bold rounded-xl transition-all cursor-pointer bg-m3-red-dark text-m3-red shadow';

      panels.forEach((p) => {
        if (p.id === targetId) {
          p.classList.remove('hidden');
        } else {
          p.classList.add('hidden');
        }
      });
    });
  });
}

// Render Presets
function setupPresetsUI(): void {
  presetsContainer.innerHTML = '';
  Object.values(PRESETS).forEach((preset) => {
    const btn = document.createElement('button');
    btn.setAttribute('data-preset', preset.id);
    const isActive = editor.settings.preset === preset.id;

    btn.className = `btn-preset flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer border ${
      isActive
        ? 'bg-m3-red-dark border-m3-red font-bold text-m3-red'
        : 'bg-m3-bg border-m3-border hover:border-m3-red/70 text-white/80'
    }`;

    btn.innerHTML = `
      <span class="truncate">${preset.name}</span>
      ${preset.badge ? `<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-m3-red/80 border border-m3-border/40">${preset.badge}</span>` : ''}
    `;

    btn.addEventListener('click', () => {
      editor.settings.preset = preset.id;
      updatePresetSelectionUI();
      editor.scheduleRender();
      history.push(editor.getSnapshot());
      updateHistoryButtons();
    });

    presetsContainer.appendChild(btn);
  });
}

function updatePresetSelectionUI(): void {
  const activeId = editor.settings.preset;
  const presetDef = PRESETS[activeId] || PRESETS.none;
  activePresetDesc.innerText = presetDef.description || presetDef.name;

  document.querySelectorAll<HTMLButtonElement>('.btn-preset').forEach((btn) => {
    const id = btn.getAttribute('data-preset');
    const isCurrent = id === activeId;
    if (isCurrent) {
      btn.className =
        'btn-preset flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer border bg-m3-red-dark border-m3-red font-bold text-m3-red';
    } else {
      btn.className =
        'btn-preset flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer border bg-m3-bg border-m3-border hover:border-m3-red/70 text-white/80';
    }
  });
}

function updateBorderButtonsUI(): void {
  const activeBorder = editor.settings.filmBorder;
  document.querySelectorAll<HTMLButtonElement>('.btn-border').forEach((btn) => {
    const bId = btn.getAttribute('data-border');
    if (bId === activeBorder) {
      btn.className =
        'btn-border p-2 rounded-xl text-xs font-mono border bg-m3-red-dark border-m3-red text-m3-red font-bold';
    } else {
      btn.className =
        'btn-border p-2 rounded-xl text-xs font-mono border bg-m3-bg border-m3-border text-white/80 hover:border-m3-red/70';
    }
  });
}

function updateFormatUI(): void {
  const format = editor.settings.exportFormat;
  const labels: Record<ExportFormat, string> = {
    'image/png': '💎 PNG (%100 Kayıpsız)',
    'image/jpeg': '📸 JPG (%100 Maksimum)',
    'image/webp': '⚡ WebP (Kayıpsız)'
  };
  if (formatBadge) {
    formatBadge.innerText = labels[format];
  }

  document.querySelectorAll<HTMLButtonElement>('.btn-format').forEach((btn) => {
    const f = btn.getAttribute('data-format') as ExportFormat;
    if (f === format) {
      btn.className =
        'btn-format p-2 rounded-xl text-xs font-mono border bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold';
    } else {
      btn.className =
        'btn-format p-2 rounded-xl text-xs font-mono border bg-m3-bg border-m3-border text-white/70 hover:border-emerald-600/50';
    }
  });
}

function syncAllControlsUI(): void {
  (Object.keys(sliders) as NumericSliderKey[]).forEach((key) => {
    const val = editor.settings[key];
    if (sliders[key]) {
      sliders[key].value = val.toString();
      const valLabel = document.getElementById(`val-${key}`);
      if (valLabel) {
        valLabel.innerText = val > 0 ? `+${val}` : val.toString();
      }
    }
  });

  checkQuartzDate.checked = editor.settings.quartzDate;
  inputQuartzText.value = editor.settings.quartzDateText;
  if (editor.settings.quartzDate) {
    quartzDateControls.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    quartzDateControls.classList.add('opacity-50', 'pointer-events-none');
  }

  updatePresetSelectionUI();
  updateBorderButtonsUI();
  updateFormatUI();
}

function updateHistoryButtons(): void {
  btnUndo.disabled = !history.canUndo();
  btnRedo.disabled = !history.canRedo();
}

function updateResolutionBadge(): void {
  const dims = editor.originalDimensions;
  const printDims = editor.printDimensions;
  if (dims && printDims) {
    resolutionBadge.innerText = `${dims.width} × ${dims.height} (${printDims.megapixels} MP) • 300 DPI`;
    resolutionBadge.classList.remove('hidden');
    saveBtnText.innerText = `300 DPI İLE KAYDET (${dims.width}×${dims.height})`;

    if (printDimensionsText) {
      printDimensionsText.innerText = `${printDims.widthCm} × ${printDims.heightCm} cm (${printDims.widthInches} × ${printDims.heightInches} in)`;
    }
  } else {
    resolutionBadge.classList.add('hidden');
    saveBtnText.innerText = 'TAM ÇÖZÜNÜRLÜKTE KAYDET (300 DPI)';
    if (printDimensionsText) {
      printDimensionsText.innerText = 'Fotoğraf bekleniyor...';
    }
  }
}

function enableEditorUI(): void {
  btnRotate.disabled = false;
  btnRandomize.disabled = false;
  btnReset.disabled = false;
  btnSave.disabled = false;
  placeholder.classList.add('hidden');
  canvasOverlayControls.classList.remove('hidden');

  btnSave.className =
    'w-full bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 py-3 rounded-xl text-xs font-bold tracking-wider transition-all flex items-center justify-center cursor-pointer shadow-lg active:scale-[0.99]';

  updateHistoryButtons();
  updateResolutionBadge();
}

// File Loading Handler
async function handleFile(file: File): Promise<void> {
  let processedBlob: Blob = file;
  currentOriginalFileName = file.name.replace(/\.[^/.]+$/, '');

  if (isHeicFile(file)) {
    showToast('Apple HEIC/HEIF görseli %100 kayıpsız çözümleniyor...', 'info', 4000);
    try {
      processedBlob = await convertHeicToLossless(file);
      showToast('HEIF başarıyla kayıpsız PNG olarak aktarıldı.', 'success');
    } catch (err) {
      console.error(err);
      showToast('HEIF çözümlenirken hata oluştu.', 'error');
      return;
    }
  }

  try {
    await editor.loadImageFromBlob(processedBlob);
    history.reset(editor.getSnapshot());
    syncAllControlsUI();
    enableEditorUI();
    showToast('Fotoğraf banyo istasyonuna alındı.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Fotoğraf yüklenemedi.', 'error');
  }
}

// Event Listeners for Upload & Dropzone
btnUpload.addEventListener('click', () => fileInput.click());
placeholder.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files[0]) {
    handleFile(files[0]);
  }
});

canvasDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvasDropzone.classList.add('ring-2', 'ring-m3-red');
});
canvasDropzone.addEventListener('dragleave', () => {
  canvasDropzone.classList.remove('ring-2', 'ring-m3-red');
});
canvasDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  canvasDropzone.classList.remove('ring-2', 'ring-m3-red');
  if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// Slider Interactions
(Object.keys(sliders) as NumericSliderKey[]).forEach((key) => {
  const slider = sliders[key];
  if (!slider) return;

  slider.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    const label = document.getElementById(`val-${key}`);
    if (label) label.innerText = val > 0 ? `+${val}` : val.toString();

    editor.settings[key] = val;
    editor.scheduleRender();
  });

  slider.addEventListener('change', () => {
    history.push(editor.getSnapshot());
    updateHistoryButtons();
  });
});

// Format Selection Buttons
document.querySelectorAll<HTMLButtonElement>('.btn-format').forEach((btn) => {
  btn.addEventListener('click', () => {
    const f = btn.getAttribute('data-format') as ExportFormat;
    if (f) {
      editor.settings.exportFormat = f;
      updateFormatUI();
      history.push(editor.getSnapshot());
      updateHistoryButtons();
    }
  });
});

// Finishing Controls: Quartz Date
checkQuartzDate.addEventListener('change', () => {
  editor.settings.quartzDate = checkQuartzDate.checked;
  if (editor.settings.quartzDate) {
    quartzDateControls.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    quartzDateControls.classList.add('opacity-50', 'pointer-events-none');
  }
  editor.scheduleRender();
  history.push(editor.getSnapshot());
  updateHistoryButtons();
});

inputQuartzText.addEventListener('input', () => {
  editor.settings.quartzDateText = inputQuartzText.value;
  editor.scheduleRender();
});

inputQuartzText.addEventListener('change', () => {
  history.push(editor.getSnapshot());
  updateHistoryButtons();
});

// Finishing Controls: Border Selection
document.querySelectorAll<HTMLButtonElement>('.btn-border').forEach((btn) => {
  btn.addEventListener('click', () => {
    const bId = btn.getAttribute('data-border') as FilmBorder;
    if (bId) {
      editor.settings.filmBorder = bId;
      updateBorderButtonsUI();
      editor.scheduleRender();
      history.push(editor.getSnapshot());
      updateHistoryButtons();
    }
  });
});

// 🎲 Kör Makara (Analog Serendipity / Rastgele Banyo)
btnRandomize.addEventListener('click', () => {
  if (!editor.hasImage) return;

  const presetKeys = Object.keys(PRESETS) as PresetKey[];
  const randomPreset = presetKeys[Math.floor(Math.random() * presetKeys.length)];

  editor.settings = {
    ...editor.settings,
    preset: randomPreset,
    exposure: Math.floor(Math.random() * 25) - 10,
    contrast: Math.floor(Math.random() * 30) - 10,
    saturation: Math.floor(Math.random() * 30) - 15,
    warmth: Math.floor(Math.random() * 50) - 20,
    grain: Math.floor(Math.random() * 45) + 10,
    lightLeak: Math.random() > 0.4 ? Math.floor(Math.random() * 40) + 15 : 0,
    bleachBypass: Math.random() > 0.6 ? Math.floor(Math.random() * 35) : 0,
    swirl: Math.random() > 0.5 ? Math.floor(Math.random() * 45) + 10 : 0,
    proMist: Math.random() > 0.4 ? Math.floor(Math.random() * 40) + 10 : 0,
    chromatic: Math.random() > 0.5 ? Math.floor(Math.random() * 30) : 0,
    vignette: Math.floor(Math.random() * 45) + 10
  };

  syncAllControlsUI();
  editor.scheduleRender();
  history.push(editor.getSnapshot());
  updateHistoryButtons();
  showToast('🎲 Kör makara banyo edildi! (Analog Sürpriz)', 'info', 2500);
});

// 🔍 %100 Büyüteç (Loupe Zoom)
function toggleZoom(): void {
  isZoomedIn = !isZoomedIn;
  if (isZoomedIn) {
    canvasWrapper.classList.add('scale-[2.0]', 'cursor-zoom-out');
    canvasWrapper.classList.remove('cursor-zoom-in');
    btnZoomToggle.classList.add('bg-m3-red', 'text-m3-bg');
    showToast('%100 Gren ve Odak Büyüteci Aktif', 'info', 2000);
  } else {
    canvasWrapper.classList.remove('scale-[2.0]', 'cursor-zoom-out');
    canvasWrapper.classList.add('cursor-zoom-in');
    btnZoomToggle.classList.remove('bg-m3-red', 'text-m3-bg');
  }
}

btnZoomToggle.addEventListener('click', toggleZoom);
canvas.addEventListener('dblclick', toggleZoom);

// Rotate Action
btnRotate.addEventListener('click', () => {
  editor.rotateClockwise();
  history.push(editor.getSnapshot());
  updateHistoryButtons();
  updateResolutionBadge();
});

// Reset Action
btnReset.addEventListener('click', () => {
  editor.resetSettings();
  syncAllControlsUI();
  editor.scheduleRender();
  history.push(editor.getSnapshot());
  updateHistoryButtons();
  showToast('Ayarlar sıfırlandı.', 'info');
});

// Undo & Redo Actions
btnUndo.addEventListener('click', () => {
  const previous = history.undo();
  if (previous) {
    editor.applySnapshot(previous);
    syncAllControlsUI();
    updateHistoryButtons();
    updateResolutionBadge();
  }
});

btnRedo.addEventListener('click', () => {
  const next = history.redo();
  if (next) {
    editor.applySnapshot(next);
    syncAllControlsUI();
    updateHistoryButtons();
    updateResolutionBadge();
  }
});

// Compare (Before / After) Hold Mechanism
const startComparing = () => editor.setComparing(true);
const stopComparing = () => editor.setComparing(false);

btnCompare.addEventListener('mousedown', startComparing);
btnCompare.addEventListener('mouseup', stopComparing);
btnCompare.addEventListener('mouseleave', stopComparing);
btnCompare.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startComparing();
});
btnCompare.addEventListener('touchend', stopComparing);
btnCompare.addEventListener('touchcancel', stopComparing);

// Save Full-Res Action (Web Worker + Screen Wake Lock Destekli)
btnSave.addEventListener('click', async () => {
  if (!editor.hasImage) return;

  const originalContent = btnSave.innerHTML;
  btnSave.disabled = true;
  btnSave.innerHTML = `<span>⏳ Hazırlanıyor...</span>`;

  // Uzun süreli banyoda mobil ekranın kapanmasını önle
  let wakeLock: any = null;
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
    } catch {
      // Wake Lock opsiyoneldir
    }
  }

  try {
    const result = await editor.exportHighRes(undefined, undefined, (percent, message) => {
      btnSave.innerHTML = `<span>⏳ Banyo: %${percent} (${message})</span>`;
    });

    const url = URL.createObjectURL(result.blob);
    const downloadLink = document.createElement('a');
    downloadLink.download = `${currentOriginalFileName}_foton_300dpi_${Date.now()}.${result.extension}`;
    downloadLink.href = url;
    downloadLink.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Görsel 300 DPI (${result.extension.toUpperCase()}) kalitesinde başarıyla kaydedildi!`, 'success', 3500);
  } catch (err) {
    console.error(err);
    showToast('Görsel dışa aktarılırken hata oluştu.', 'error');
  } finally {
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {}
    }
    btnSave.disabled = false;
    btnSave.innerHTML = originalContent;
  }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;

  // Undo (Ctrl+Z / Cmd+Z)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    btnUndo.click();
  }
  // Redo (Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y)
  if (
    ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
    ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
  ) {
    e.preventDefault();
    btnRedo.click();
  }
  // Compare on Spacebar Hold
  if (e.code === 'Space' && !e.repeat && editor.hasImage) {
    e.preventDefault();
    startComparing();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    stopComparing();
  }
});

// PWA Install Prompt Support
let deferredPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnPwaInstall.classList.remove('hidden');
  btnPwaInstall.classList.add('flex');
});

btnPwaInstall.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    btnPwaInstall.classList.add('hidden');
    showToast('Uygulama ana ekrana eklendi!', 'success');
  }
  deferredPrompt = null;
});

// PWA Masaüstü File Handling API (İşletim sisteminden "Birlikte Aç" / Çift tıklama desteği)
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (launchParams: any) => {
    if (!launchParams.files || launchParams.files.length === 0) return;
    try {
      const fileHandle = launchParams.files[0];
      const file = await fileHandle.getFile();
      if (file) {
        showToast(`Görsel açılıyor: ${file.name}`, 'info');
        await handleFile(file);
      }
    } catch (e) {
      console.warn('Dosya açma hatası:', e);
    }
  });
}

// Initialize
setupDeckTabs();
setupPresetsUI();
syncAllControlsUI();
updateHistoryButtons();
