import { useEffect, useRef, useState } from 'preact/hooks';
import { PhotoEditor } from '../core/editor';
import { HistoryManager } from '../core/history';
import { isHeicFile, convertHeicToLossless } from '../core/heic-loader';
import { isRawFile } from '../core/raw/libraw-types';
import { STRIP_MIN_FRAMES } from '../core/strip/constants';
import { showToast } from './toast';
import {
  registerEditor,
  syncFromEditor,
  activeTab,
  workspaceMode,
  setWorkspaceMode,
  imageLoaded,
  imageFileName,
  smartRecipeAnalyzing,
  smartRecipeSuggestion,
  depthProgress,
  depthStatus,
  depthAnalyzing,
  depthShowMap,
  addFilesToStrip,
  exportStripOrContactSheet,
  stripFrames,
  stripConfig
} from './store';

import { TopBar } from './components/TopBar';
import { CanvasViewport } from './components/CanvasViewport';
import { StripViewport } from './components/StripViewport';
import { WorkspaceModeBar } from './components/WorkspaceModeBar';
import { ToolRail } from './components/ToolRail';
import { PrintPanel } from './components/PrintPanel';
import { ContactStripPanel } from './components/ContactStripPanel';
import { LightTab } from './components/LightTab';
import { ColorTab } from './components/ColorTab';
import { FilmTab } from './components/FilmTab';
import { OpticsTab } from './components/OpticsTab';
import { Histogram } from './components/Histogram';
import { FinishingTab } from './components/FinishingTab';
import { HistogramIcon } from './components/Icons';

const ACCEPTED_IMAGE_TYPES =
  'image/jpeg, image/jpg, image/png, image/webp, image/heic, image/heif, .dng, .cr2, .cr3, .nef, .nrw, .arw, .srf, .sr2, .raf, .orf, .rw2, .raw, .pef, .srw, .3fr, .iiq, .x3f';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stripFileInputRef = useRef<HTMLInputElement | null>(null);

  const [editor, setEditor] = useState<PhotoEditor | null>(null);
  const [history, setHistory] = useState<HistoryManager | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isAddingStripFiles, setIsAddingStripFiles] = useState(false);
  const [addingStripStatus, setAddingStripStatus] = useState<string>('');
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; depth?: number } | null>(null);
  const [refreshHistogramKey, setRefreshHistogramKey] = useState(0);

  // Initialize Core PhotoEditor
  useEffect(() => {
    if (!canvasRef.current) return;
    const ed = new PhotoEditor(canvasRef.current);
    const hist = new HistoryManager(ed.getSnapshot());

    setEditor(ed);
    setHistory(hist);
    registerEditor(ed, hist);

    // Refresh histogram on each render
    const origSchedule = ed.scheduleRender.bind(ed);
    ed.scheduleRender = () => {
      origSchedule();
      setRefreshHistogramKey((k) => k + 1);
    };

    window.addEventListener('resize', () => {
      ed.scheduleRender();
    });
  }, []);

  const restorePrintModeIfActiveOnLoad = () => {
    if (workspaceMode.value === 'print') {
      setWorkspaceMode('print');
    }
  };

  // Process File Loading (RAW, HEIC, JPG, PNG, WebP)
  const handleFile = async (file: File) => {
    if (!editor || !history) return;

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    imageFileName.value = baseName;

    // 1. RAW Dosyası Kontrolü (.DNG, .CR2, .CR3, .NEF, .ARW, .RAF, vb.)
    if (isRawFile(file)) {
      showToast(`RAW algılandı: ${file.name}. LibRaw motoru başlatılıyor...`, 'info', 2500);
      try {
        const metadata = await editor.loadRawFile(file, (_percent, msg) => {
          showToast(msg, 'info', 1200);
        });

        syncFromEditor();
        restorePrintModeIfActiveOnLoad();
        history.reset(editor.getSnapshot());
        syncFromEditor();
        showToast(
          `RAW başarıyla banyo edildi: ${metadata.make} ${metadata.model} (${metadata.width}×${metadata.height})`,
          'success',
          4000
        );
      } catch (err: unknown) {
        console.error('RAW yükleme hatası:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`RAW dosyası okunamadı: ${msg}`, 'error', 4500);
      }
      return;
    }

    // 2. Apple HEIC / HEIF Dosyası Kontrolü
    if (isHeicFile(file)) {
      showToast('Apple HEIC dosyası algılandı. Kayıpsız PNG formatına dönüştürülüyor...', 'info', 2500);
      try {
        const converted = await convertHeicToLossless(file);
        await editor.loadImageFromBlob(converted);
        syncFromEditor();
        restorePrintModeIfActiveOnLoad();
        history.reset(editor.getSnapshot());
        syncFromEditor();
        showToast('HEIC görseli başarıyla banyo istasyonuna alındı!', 'success', 3000);
      } catch (err: unknown) {
        console.error('HEIC yükleme hatası:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`HEIC dönüştürülemedi: ${msg}`, 'error', 4000);
      }
      return;
    }

    // 3. Standart Görsel (JPG, PNG, WebP)
    try {
      await editor.loadImageFromBlob(file);
      syncFromEditor();
      restorePrintModeIfActiveOnLoad();
      history.reset(editor.getSnapshot());
      syncFromEditor();
      showToast(`${file.name} başarıyla yüklendi.`, 'info', 2500);
    } catch (err: unknown) {
      console.error('Görsel yükleme hatası:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Görsel yüklenemedi: ${msg}`, 'error', 4000);
    }
  };

  // Faz 5: Çoklu Kare Şeride Ekleme
  const handleAddStripFiles = async (files: FileList | File[]) => {
    setIsAddingStripFiles(true);
    setAddingStripStatus('Kareler hazırlanıyor...');
    try {
      const { added, skippedMax } = await addFilesToStrip(files, (msg) => {
        setAddingStripStatus(msg);
      });
      if (added > 0) {
        showToast(
          `${added} fotoğraf film şeridine eklendi${skippedMax ? ' (maksimum 6 kare sınırı uygulandı)' : ''}.`,
          'success',
          2600
        );
      } else if (skippedMax) {
        showToast('Film şeridinde en fazla 6 kare bulunabilir.', 'error', 2600);
      }
    } catch (err: unknown) {
      console.error('Şerit dosya yükleme hatası:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Kare şeride eklenemedi: ${msg}`, 'error', 4000);
    } finally {
      setIsAddingStripFiles(false);
      setAddingStripStatus('');
    }
  };

  // Full-Resolution Single Export with 300 DPI & EXIF
  const handleExport = async () => {
    if (!editor || !imageLoaded.value) return;

    setIsExporting(true);
    showToast('300 DPI Fine-Art banyosu hazırlanıyor...', 'info', 2000);

    try {
      const result = await editor.exportHighRes(undefined, undefined, (percent, msg) => {
        showToast(`%${percent} — ${msg}`, 'info', 1000);
      });

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${imageFileName.value}_foton_300dpi.${result.extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('Tam çözünürlüklü 300 DPI görsel başarıyla mühürlendi ve indirildi!', 'success', 4000);
    } catch (err: unknown) {
      console.error('Dışa aktarma hatası:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Dışa aktarma başarısız: ${msg}`, 'error', 4500);
    } finally {
      setIsExporting(false);
    }
  };

  // Faz 5: 300 DPI Film Şeridi / Kontakt Baskı Dışa Aktarımı
  const handleStripExport = async () => {
    if (stripFrames.value.length < STRIP_MIN_FRAMES) {
      showToast(`Şerit çıktısı için en az ${STRIP_MIN_FRAMES} fotoğraf ekleyin.`, 'error', 2600);
      return;
    }

    setIsExporting(true);
    const isContact = stripConfig.value.outputMode === 'contact';
    showToast(
      isContact
        ? '300 DPI Kontakt Baskı kağıda pozlanıyor...'
        : '300 DPI 35mm Film Şeridi banyo ediliyor...',
      'info',
      2200
    );

    try {
      const result = await exportStripOrContactSheet((percent, msg) => {
        showToast(`%${percent} — ${msg}`, 'info', 900);
      });

      const suffix = isContact ? 'kontakt_300dpi' : 'serit_300dpi';
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `foton_${suffix}.${result.extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(
        `300 DPI ${isContact ? 'Kontakt Baskı' : '35mm Film Şeridi'} başarıyla indirildi!`,
        'success',
        3800
      );
    } catch (err: unknown) {
      console.error('Şerit dışa aktarma hatası:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Şerit dışa aktarılamadı: ${msg}`, 'error', 4500);
    } finally {
      setIsExporting(false);
    }
  };

  // 3D Depth Toggle
  const handleToggleDepth = async (enabled: boolean) => {
    if (!editor || !history) return;

    if (enabled) {
      depthAnalyzing.value = true;
      depthStatus.value = 'YÜKLENİYOR';
      try {
        await editor.setAiDepthEnabled(true, (percent, msg) => {
          depthProgress.value = percent;
          depthStatus.value = msg;
        });
        depthStatus.value = 'AKTİF';
        showToast('3D Fiziksel Alan Derinliği Hazır! Fotoğrafa dokunarak odaklayabilirsiniz.', 'info', 3500);
      } catch (err: unknown) {
        depthStatus.value = 'HATA';
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Derinlik motoru başlatılamadı: ${msg}`, 'error', 4000);
      } finally {
        depthAnalyzing.value = false;
        syncFromEditor();
        history.push(editor.getSnapshot());
      }
    } else {
      editor.setAiDepthEnabled(false);
      editor.setAiShowDepthMap(false);
      depthStatus.value = 'KAPALI';
      syncFromEditor();
      history.push(editor.getSnapshot());
    }
  };

  // Toggle Depth Map Visualizer
  const handleToggleDepthMap = () => {
    if (!editor) return;
    const show = !editor.settings.aiShowDepthMap;
    editor.setAiShowDepthMap(show);
    depthShowMap.value = show;
    showToast(show ? '3D Derinlik Haritası İnceleme Modu' : 'Normal Görünüm', 'info', 1800);
  };

  // Canvas Tap-to-Focus (only active in Develop Mode)
  const handleCanvasClick = (e: MouseEvent) => {
    if (workspaceMode.value !== 'develop') return;
    if (!editor || !editor.hasImage || !editor.settings.aiDepthEnabled || !editor.hasDepthMap) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const normX = Math.min(1.0, Math.max(0, clickX / rect.width));
    const normY = Math.min(1.0, Math.max(0, clickY / rect.height));

    const wrapper = canvas.parentElement;
    const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : rect;
    const ringX = e.clientX - wrapperRect.left;
    const ringY = e.clientY - wrapperRect.top;

    const sampledZ = editor.sampleDepthAt(normX, normY);
    editor.setAiFocalDepth(sampledZ);
    syncFromEditor();

    if (history) history.push(editor.getSnapshot());

    // Show cinematic viewfinder AF reticle animation
    setFocusRing({ x: ringX, y: ringY, depth: sampledZ });
    setTimeout(() => setFocusRing(null), 1200);

    const percent = Math.round(sampledZ * 100);
    const regionName = sampledZ > 0.65 ? 'Ön Plan' : sampledZ > 0.35 ? 'Orta Alan' : 'Arka Plan';
    showToast(`Odak Kilitlendi: %${percent} (${regionName})`, 'info', 1600);
  };

  // Smart Auto-Focus on Subject
  const handleAutoFocus = () => {
    if (!editor || !editor.hasImage || !editor.hasDepthMap) {
      showToast('Önce 3D derinlik analizini açın.', 'error', 2500);
      return;
    }
    const autoZ = editor.autoFocusOnSubject();
    syncFromEditor();
    if (history) history.push(editor.getSnapshot());

    const percent = Math.round(autoZ * 100);
    const regionName = autoZ > 0.65 ? 'Ön Plan' : autoZ > 0.35 ? 'Orta Alan' : 'Arka Plan';
    showToast(`Akıllı AF Kilitlendi: %${percent} (${regionName})`, 'success', 2500);
  };

  // Custom .CUBE 3D LUT loader
  const handleLoadCubeLut = async (file: File) => {
    if (!editor || !history) return;
    try {
      const text = await file.text();
      const lut = editor.loadCustomCubeLUT(text, file.name);
      syncFromEditor();
      history.push(editor.getSnapshot());
      showToast(`3D LUT yüklendi: ${lut.title} (${lut.size}×${lut.size}×${lut.size} Tetrahedral)`, 'success', 3500);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '.CUBE okunamadı.';
      showToast(msg, 'error', 4000);
    }
  };

  // Smart Recipe AI
  const handleAnalyzeSmartRecipe = () => {
    if (!editor) return;
    smartRecipeAnalyzing.value = true;
    try {
      const suggestion = editor.getSmartRecipeSuggestion();
      smartRecipeSuggestion.value = suggestion;
      if (suggestion) {
        showToast(`Reçete Önerisi: ${suggestion.presetName} (${suggestion.sceneTitle})`, 'info', 3000);
      }
    } catch (err) {
      showToast('Sahne analiz edilemedi.', 'error', 3000);
    } finally {
      smartRecipeAnalyzing.value = false;
    }
  };

  const handleApplySmartRecipe = () => {
    const sug = smartRecipeSuggestion.value;
    if (!editor || !history || !sug) return;
    editor.applySmartRecipe(sug);
    syncFromEditor();
    history.push(editor.getSnapshot());
    showToast(`${sug.presetName} reçetesi ve optik ayarları uygulandı!`, 'success', 3000);
  };

  const currentTab = activeTab.value;
  const currentMode = workspaceMode.value;

  return (
    <div class="h-dvh max-h-dvh flex flex-col justify-between bg-neutral-950 text-neutral-200 selection:bg-amber-500 selection:text-neutral-950 overflow-hidden">
      {/* Top Bar */}
      <TopBar
        onOpenFileSelect={() => {
          if (currentMode === 'strip') {
            stripFileInputRef.current?.click();
          } else {
            fileInputRef.current?.click();
          }
        }}
        onQuickSave={currentMode === 'strip' ? handleStripExport : handleExport}
        isSaving={isExporting}
      />

      {/* Main Workspace Layout */}
      <main class="flex-1 min-h-0 w-full max-w-7xl mx-auto p-2 sm:p-3 lg:p-4 flex flex-col landscape:flex-row lg:flex-row gap-2 sm:gap-3 lg:gap-4 overflow-hidden items-stretch">
        {/* Left: Viewport (Takes full height & flex-1 on landscape/desktop; pinned top area on mobile portrait) */}
        <div class="w-full h-[38dvh] xs:h-[40dvh] landscape:h-full lg:h-full landscape:w-auto lg:w-auto landscape:flex-1 lg:flex-1 shrink-0 landscape:shrink min-h-0 min-w-0 flex flex-col overflow-hidden">
          {/* CanvasViewport her zaman DOM'da tutularak PhotoEditor ve WebGPU bağlamı korunur */}
          <div class={currentMode === 'strip' ? 'hidden' : 'w-full h-full min-h-0 flex flex-col'}>
            <CanvasViewport
              canvasRef={canvasRef}
              onFileDrop={handleFile}
              onCanvasClick={handleCanvasClick}
              focusPoint={focusRing}
            />
          </div>

          {currentMode === 'strip' && (
            <div class="w-full h-full min-h-0 flex flex-col">
              <StripViewport
                onFilesDrop={handleAddStripFiles}
                onOpenStripFilePicker={() => stripFileInputRef.current?.click()}
                isAddingFiles={isAddingStripFiles}
                addingStatusText={addingStripStatus}
              />
            </div>
          )}
        </div>

        {/* Right: Controls Dock (Scrolls independently; image never moves!) */}
        <div class="w-full flex-1 landscape:w-[320px] sm:landscape:w-[360px] lg:w-[380px] xl:w-[420px] landscape:h-full lg:h-full shrink-0 flex flex-col min-h-0 overflow-hidden bg-neutral-950/70 rounded-2xl border border-neutral-900/80 p-2 sm:p-2.5 shadow-2xl">
          {/* Dock Header: Collapsible Histogram + Workspace Mode Bar + ToolRail */}
          <div class="shrink-0 space-y-2 mb-2">
            {/* Histogram Display (Collapsible, starts collapsed on mobile, visible on desktop with collapse option) */}
            {currentMode !== 'strip' && (
              <Histogram
                canvasElement={canvasRef.current}
                refreshKey={refreshHistogramKey}
                collapsible={true}
                defaultCollapsed={true}
                showOnDesktopByDefault={true}
              />
            )}

            {/* Top-Level Workspace Mode Switcher: Negatif Banyo <-> Kağıda Baskı <-> Kontakt & Şerit */}
            <WorkspaceModeBar />

            {/* Tool Category Selector Strip (ToolRail) */}
            {currentMode === 'develop' && <ToolRail />}
          </div>

          {/* Dedicated Scrollable Tool Panel Area: ONLY this area scrolls when adjusting settings! */}
          <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 custom-scrollbar">
            {currentMode === 'develop' ? (
              <div class="transition-all duration-150">
                {currentTab === 'light' && <LightTab />}
                {currentTab === 'color' && <ColorTab />}
                {currentTab === 'film' && (
                  <FilmTab
                    onLoadCubeLut={handleLoadCubeLut}
                    onAnalyzeSmartRecipe={handleAnalyzeSmartRecipe}
                    onApplySmartRecipe={handleApplySmartRecipe}
                  />
                )}
                {currentTab === 'optics' && (
                  <OpticsTab
                    onToggleDepth={handleToggleDepth}
                    onToggleDepthMap={handleToggleDepthMap}
                    onAutoFocus={handleAutoFocus}
                  />
                )}
                {currentTab === 'histogram' && (
                  <div class="p-3.5 bg-neutral-900/90 rounded-2xl border border-neutral-800 space-y-3 shadow-md">
                    <Histogram
                      canvasElement={canvasRef.current}
                      refreshKey={refreshHistogramKey}
                      collapsible={false}
                    />
                    <div class="space-y-1.5 pt-1 border-t border-neutral-800/80">
                      <span class="text-[10px] font-mono font-bold text-amber-400 flex items-center gap-1.5">
                        <HistogramIcon class="w-3.5 h-3.5 text-amber-400" />
                        <span>HİSTOGRAM & KANAL DAĞILIMI</span>
                      </span>
                      <p class="text-[9px] text-neutral-400 font-mono leading-relaxed">
                        Histogram, fotoğrafınızdaki ışık ve renk dalga boylarının 0 (mutlak siyah) ile 255 (mutlak beyaz) arasındaki dağılımını gösterir. Sol alt köşedeki mavi kare gölge detay kaybını (underexposure), sağ üstteki kırmızı kare ise parlak ton patlamasını (blown highlights) belirtir.
                      </p>
                    </div>
                  </div>
                )}
                {currentTab === 'finishing' && (
                  <FinishingTab
                    onExport={handleExport}
                    isExporting={isExporting}
                  />
                )}
              </div>
            ) : currentMode === 'print' ? (
              <PrintPanel
                onExport={handleExport}
                isExporting={isExporting}
              />
            ) : (
              <ContactStripPanel
                onOpenStripFilePicker={() => stripFileInputRef.current?.click()}
                onExportStrip={handleStripExport}
                isExporting={isExporting}
                isAddingFiles={isAddingStripFiles}
              />
            )}
          </div>
        </div>
      </main>

      {/* Hidden File Input for Single RAW, HEIC, JPG, PNG */}
      <input
        ref={fileInputRef}
        id="global-file-input"
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) handleFile(file);
          (e.target as HTMLInputElement).value = '';
        }}
        class="hidden"
      />

      {/* Hidden Multi-File Input for Faz 5 Film Strip & Contact Sheet */}
      <input
        ref={stripFileInputRef}
        id="strip-file-input"
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={(e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files && files.length > 0) {
            handleAddStripFiles(files);
          }
          (e.target as HTMLInputElement).value = '';
        }}
        class="hidden"
      />

      {/* Toast Notification Container */}
      <div id="toast-container" class="fixed bottom-10 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none" />

      {/* Darkroom Footer */}
      <footer class="shrink-0 text-center text-[8px] sm:text-[9px] text-neutral-500 font-mono py-1.5 bg-neutral-950 border-t border-neutral-900 hidden xs:block landscape:hidden sm:landscape:block">
        Foton: Karanlık Oda • LibRaw 16-Bit Linear WASM • WebGPU 3D LUT, Kimya & Kontakt Baskı Motoru • Preact Signals
      </footer>
    </div>
  );
}
