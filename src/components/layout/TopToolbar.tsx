import React, { useRef, useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore, ReadingTheme, ZOOM_STEPS } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
import {
  openPdfFileDialog,
  openPdfFiles,
  printDocumentWithAnnotations,
  saveDocument,
  syncActiveTool,
} from '@/components/common/pdf-actions';
import { useResolvedDarkTheme, getReadingThemeLabel } from '@/components/common/theme-utils';
import { useViewerUIState } from '@/components/viewer/viewer-ui-state';
import {
  FolderOpen,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Search,
  Sun,
  Moon,
  Info,
  Keyboard,
  Columns,
  Square,
  Grid2X2,
  Rows,
  Undo2,
  Redo2,
  Printer,
  FileImage,
  SlidersHorizontal,
  FoldHorizontal,
  Minimize2,
  BookOpen,
  Check,
  Scan,
  Maximize2,
  FileText,
  ChevronDown,
  Settings,
  Crosshair,
  BookCopy,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const TopToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const isDark = useResolvedDarkTheme();
  const { twoPageCoverOffset, toggleTwoPageCoverOffset } = useViewerUIState();

  const {
    zoom,
    setZoom,
    fitMode,
    setFitMode,
    readingTheme,
    setReadingTheme,
    zoomIn,
    zoomOut,
    activeTool,
    viewMode,
    setViewMode,
    theme,
    setTheme,
    openSearch,
    appDesignTheme,
  } = useViewerStore();

  const [isReadingThemeOpen, setIsReadingThemeOpen] = useState(false);
  const readingThemeRef = useRef<HTMLDivElement>(null);

  const [isZoomPopoverOpen, setIsZoomPopoverOpen] = useState(false);
  const [customZoomInput, setCustomZoomInput] = useState('');
  const zoomPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (readingThemeRef.current && !readingThemeRef.current.contains(e.target as Node)) {
        setIsReadingThemeOpen(false);
      }
      if (zoomPopoverRef.current && !zoomPopoverRef.current.contains(e.target as Node)) {
        setIsZoomPopoverOpen(false);
      }
    };
    if (isReadingThemeOpen || isZoomPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isReadingThemeOpen, isZoomPopoverOpen]);

  const handleCustomZoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(customZoomInput);
    if (!isNaN(val) && val >= 20 && val <= 500) {
      setFitMode('none');
      setZoom(val / 100);
      setIsZoomPopoverOpen(false);
      setCustomZoomInput('');
    }
  };

  const {
    setPropertiesModalOpen,
    setShortcutsModalOpen,
    setSettingsModalOpen,
    setImagesToPdfModalOpen,
    isRightToolsSidebarOpen,
    setRightToolsSidebarOpen,
    addToast,
  } = useUIStore();

  const handleRotate = (angle: number) => {
    if (!currentDocument) return;
    const selected = currentDocument.selectedPageIds;
    const targetIds =
      selected.length > 0
        ? selected
        : currentDocument.pages[currentDocument.activePageIndex]
        ? [currentDocument.pages[currentDocument.activePageIndex].id]
        : [];
    if (targetIds.length > 0) {
      historyManager.execute(new RotatePageCommand(targetIds, angle));
    }
  };

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <header
      role="toolbar"
      aria-label="Ana Araç Çubuğu"
      className={cn(
        'no-print flex items-center justify-between select-none z-30 shrink-0 transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-12 mx-3 my-1.5 rounded-2xl cupertino-glass px-4 shadow-md border text-slate-700 dark:text-slate-200',
        isLinearDark && 'h-10 bg-[#08090a] border-b border-white/10 px-3 text-xs text-slate-200 shadow-none',
        isLinearLight && 'h-10 bg-white border-b border-slate-200 px-3 text-xs text-slate-800 shadow-none',
        appDesignTheme === 'ribbon' && 'h-10 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-3 text-xs text-slate-700 dark:text-slate-200 shadow-none',
        appDesignTheme === 'fluent' && 'h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 text-slate-700 dark:text-slate-200 shadow-sm'
      )}
    >
      <input
        type="file"
        ref={fileInputRef}
        multiple
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await openPdfFiles(e.target.files);
          }
          e.target.value = '';
        }}
        accept="application/pdf"
        className="hidden"
      />

      {/* Left Section: Logo, File Ops, Tools */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 mr-1">
          <img src="./icons/icon48.png" alt="XPDF" className="w-8 h-8 object-contain" />
          <span className="font-bold text-base text-slate-900 dark:text-white tracking-tight hidden sm:inline">
            XPDF <span className="text-sky-500 dark:text-sky-400 font-medium text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/30">PRO</span>
          </span>
        </div>

        {/* File Open */}
        <button
          type="button"
          onClick={() => openPdfFileDialog(fileInputRef.current)}
          aria-label="PDF Aç (Ctrl + O)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700/80"
          title="PDF Aç (Ctrl + O)"
        >
          <FolderOpen className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          <span className="hidden md:inline">Aç</span>
        </button>

        {/* Images to PDF */}
        <button
          type="button"
          onClick={() => setImagesToPdfModalOpen(true)}
          aria-label="Görsellerden PDF Oluştur"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-xs font-semibold text-purple-700 dark:text-purple-300 transition-colors border border-purple-200 dark:border-purple-800/60"
          title="Görsellerden (JPG, PNG) Yeni PDF Oluştur"
        >
          <FileImage className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="hidden xl:inline">Görselden PDF</span>
        </button>

        {/* Save / Save As */}
        {currentDocument && (
          <div className="flex items-center rounded-lg overflow-hidden border border-sky-600/60 shadow-sm shadow-sky-600/20">
            <button
              type="button"
              onClick={() => saveDocument(currentDocument, false)}
              aria-label="Belgeyi Kaydet (Ctrl + S)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
              title={currentDocument.filePath ? `Kaydet — ${currentDocument.filePath} (Ctrl+S)` : 'Kaydet (Ctrl+S)'}
            >
              Kaydet
            </button>
            <div className="w-px h-full bg-sky-500/40" />
            <button
              type="button"
              onClick={() => saveDocument(currentDocument, true)}
              aria-label="Farklı Kaydet (Ctrl + Shift + S)"
              className="flex items-center gap-1 px-2 py-1.5 bg-sky-700 hover:bg-sky-600 text-xs font-semibold text-white transition-colors"
              title="Farklı Kaydet — yeni konuma kaydet (Ctrl+Shift+S)"
            >
              <span className="hidden sm:inline text-sky-200">Farklı</span>
              <span className="text-sky-100">↓</span>
            </button>
          </div>
        )}

        {/* Print */}
        {currentDocument && (
          <button
            type="button"
            onClick={() => printDocumentWithAnnotations(currentDocument)}
            aria-label="Yazdır (Ctrl + P)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Yazdır (Ctrl + P)"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
            <span className="hidden md:inline">Yazdır</span>
          </button>
        )}

        {/* Undo / Redo */}
        {currentDocument && (
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80 ml-1">
            <button
              type="button"
              aria-label="Geri Al (Ctrl + Z)"
              onClick={() => {
                if (historyManager.undo()) {
                  addToast('İşlem geri alındı', 'info', 1500);
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Geri Al (Ctrl + Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Yinele (Ctrl + Y)"
              onClick={() => {
                if (historyManager.redo()) {
                  addToast('İşlem yinelendi', 'info', 1500);
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Yinele (Ctrl + Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tools Panel Toggle (document-only) */}
        {currentDocument && (
          <button
            type="button"
            aria-label="Tüm Araçlar Panelini Aç veya Kapat"
            aria-pressed={isRightToolsSidebarOpen}
            onClick={() => setRightToolsSidebarOpen((prev: boolean) => !prev)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-sm ml-1.5',
              isRightToolsSidebarOpen
                ? 'bg-sky-600 text-white border-sky-700 shadow-sky-500/20'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            )}
            title="Tüm Araçlar Panelini Aç / Kapat"
          >
            <SlidersHorizontal
              className={cn(
                'w-4 h-4',
                isRightToolsSidebarOpen ? 'text-white' : 'text-sky-600 dark:text-sky-400'
              )}
            />
            <span className="hidden sm:inline">Tüm Araçlar</span>
          </button>
        )}
      </div>

      {/* Center Section: Zoom & View Controls */}
      {currentDocument ? (
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
              type="button"
              aria-label="Uzaklaştır (Ctrl + -)"
              onClick={zoomOut}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Uzaklaştır (Ctrl + -)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            {/* Zoom Popover Trigger */}
            <div className="relative" ref={zoomPopoverRef}>
              <button
                type="button"
                aria-label="Yakınlaştırma Seçenekleri"
                aria-expanded={isZoomPopoverOpen}
                onClick={() => setIsZoomPopoverOpen(!isZoomPopoverOpen)}
                className={cn(
                  'px-2 py-1 text-xs font-semibold rounded min-w-[56px] flex items-center justify-center gap-1 transition-colors',
                  fitMode !== 'none'
                    ? 'text-sky-600 dark:text-sky-400 bg-sky-500/15'
                    : 'text-slate-800 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                )}
                title="Yakınlaştırma Seçenekleri & Hazır Adımlar"
              >
                <span>{Math.round(zoom * 100)}%</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {isZoomPopoverOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  {/* Custom % Input */}
                  <form onSubmit={handleCustomZoomSubmit} className="flex items-center gap-1.5 mb-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 font-semibold">%</span>
                    <input
                      type="number"
                      aria-label="Özel Yakınlaştırma Yüzdesi"
                      min={20}
                      max={500}
                      placeholder={String(Math.round(zoom * 100))}
                      value={customZoomInput}
                      onChange={(e) => setCustomZoomInput(e.target.value)}
                      className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-sky-500"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 bg-sky-500 hover:bg-sky-600 text-white rounded text-[11px] font-semibold transition-colors"
                    >
                      Uygula
                    </button>
                  </form>

                  {/* Quick Fit Actions */}
                  <div className="space-y-0.5 mb-2 pb-2 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('width');
                        setIsZoomPopoverOpen(false);
                      }}
                      className={cn(
                        'w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                        fitMode === 'width' && 'text-sky-600 dark:text-sky-400 font-bold bg-sky-500/10'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <FoldHorizontal className="w-3.5 h-3.5" />
                        Genişliğe Sığdır
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Ctrl+2</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('page');
                        setIsZoomPopoverOpen(false);
                      }}
                      className={cn(
                        'w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                        fitMode === 'page' && 'text-sky-600 dark:text-sky-400 font-bold bg-sky-500/10'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Minimize2 className="w-3.5 h-3.5" />
                        Sayfaya Sığdır
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Ctrl+0</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('content');
                        setIsZoomPopoverOpen(false);
                      }}
                      className={cn(
                        'w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                        fitMode === 'content' && 'text-sky-600 dark:text-sky-400 font-bold bg-sky-500/10'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5" />
                        İçeriğe Sığdır (Metin)
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Ctrl+3</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFitMode('none');
                        setZoom(1.0);
                        setIsZoomPopoverOpen(false);
                      }}
                      className={cn(
                        'w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                        Math.abs(zoom - 1.0) < 0.01 && fitMode === 'none' && 'text-sky-600 dark:text-sky-400 font-bold bg-sky-500/10'
                      )}
                    >
                      <span>Gerçek Boyut (%100)</span>
                      <span className="text-[10px] text-slate-400 font-normal">Ctrl+1</span>
                    </button>
                  </div>

                  {/* Standard Zoom Percentages Grid */}
                  <div className="grid grid-cols-3 gap-1">
                    {ZOOM_STEPS.slice(0, 9).map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => {
                          setFitMode('none');
                          setZoom(step);
                          setIsZoomPopoverOpen(false);
                        }}
                        className={cn(
                          'py-1 rounded text-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors',
                          Math.abs(zoom - step) < 0.02 && fitMode === 'none'
                            ? 'bg-sky-500 text-white font-bold'
                            : 'text-slate-700 dark:text-slate-300'
                        )}
                      >
                        {Math.round(step * 100)}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              aria-label="Yakınlaştır (Ctrl + +)"
              onClick={zoomIn}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Yakınlaştır (Ctrl + +)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

            <button
              type="button"
              aria-label="Genişliğe Sığdır"
              aria-pressed={fitMode === 'width'}
              onClick={() => setFitMode(fitMode === 'width' ? 'none' : 'width')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                fitMode === 'width'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Genişliğe Sığdır (Ctrl+2)"
            >
              <FoldHorizontal className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Sayfaya Sığdır"
              aria-pressed={fitMode === 'page'}
              onClick={() => setFitMode(fitMode === 'page' ? 'none' : 'page')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                fitMode === 'page'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Sayfaya Sığdır (Ctrl+0)"
            >
              <Minimize2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Alan Yakınlaştırma"
              aria-pressed={activeTool === 'marquee-zoom'}
              onClick={() => syncActiveTool(activeTool === 'marquee-zoom' ? 'select' : 'marquee-zoom')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                activeTool === 'marquee-zoom'
                  ? 'bg-sky-500 text-white font-semibold shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Alan Yakınlaştırma (Z / Shift+Sürükle)"
            >
              <Scan className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Tam Ekran Sunum Modu"
              onClick={() => {
                useUIStore.getState().setFullscreenPresentation(true);
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }}
              className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              title="Tam Ekran Sunum Modu (F11 / Ctrl + L)"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

            <button
              type="button"
              aria-label="Bölge OCR"
              onClick={() => useUIStore.getState().setSnipOcrModalOpen(true)}
              className="px-2 py-1 rounded-md text-xs font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 transition-colors flex items-center gap-1.5 shadow-sm"
              title="Bölge OCR — Seçilen alandan metin tara"
            >
              <Crosshair className="w-3.5 h-3.5 text-sky-500" />
              <span className="hidden lg:inline">Bölge OCR</span>
            </button>
          </div>

          {/* View Mode Select */}
          <div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
              type="button"
              aria-label="Sürekli Dikey Görünüm"
              aria-pressed={viewMode === 'continuous'}
              onClick={() => setViewMode('continuous')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'continuous'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Sürekli Dikey Görünüm"
            >
              <Rows className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Tek Sayfa Görünümü"
              aria-pressed={viewMode === 'single'}
              onClick={() => setViewMode('single')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'single'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Tek Sayfa Görünümü"
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="İki Sayfa Yan Yana"
              aria-pressed={viewMode === 'two-page'}
              onClick={() => setViewMode('two-page')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'two-page'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="İki Sayfa Yan Yana"
            >
              <Columns className="w-4 h-4" />
            </button>
            {viewMode === 'two-page' && (
              <button
                type="button"
                aria-label="Kapak Sayfasını Ayrı Göster"
                aria-pressed={twoPageCoverOffset}
                onClick={toggleTwoPageCoverOffset}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  twoPageCoverOffset
                    ? 'bg-sky-500 text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
                title="İki Sayfa Görünümünde Kapak Sayfasını Tek Göster"
              >
                <BookCopy className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              aria-label="Dört Sayfa Grid Görünümü"
              aria-pressed={viewMode === 'four-page'}
              onClick={() => setViewMode('four-page')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'four-page'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Dört Sayfa Izgara Görünümü"
            >
              <Grid2X2 className="w-4 h-4" />
            </button>
          </div>

          {/* Rotate actions */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
              type="button"
              aria-label="Sola Döndür (-90 derece)"
              onClick={() => handleRotate(-90)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Sola Döndür (-90°)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Sağa Döndür (+90 derece)"
              onClick={() => handleRotate(90)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Sağa Döndür (+90°)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Lütfen bir PDF belgesi açın</div>
      )}

      {/* Right Section: Search, Reading Mode, Theme, Properties, Shortcuts, Settings */}
      <div className="flex items-center gap-1.5">
        {currentDocument && (
          <button
            type="button"
            aria-label="Belgede Ara (Ctrl + F)"
            onClick={openSearch}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Belgede Ara (Ctrl + F)"
          >
            <Search className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          </button>
        )}

        {/* Reading Theme Selector */}
        {currentDocument && (
          <div className="relative" ref={readingThemeRef}>
            <button
              type="button"
              aria-label="Okuma Modu Seçimi"
              aria-expanded={isReadingThemeOpen}
              onClick={() => setIsReadingThemeOpen(!isReadingThemeOpen)}
              className={cn(
                'p-2 rounded-lg transition-colors border shadow-sm flex items-center gap-1.5 text-xs font-medium',
                readingTheme !== 'default'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80'
              )}
              title="Okuma Modu (Varsayılan, Gece, Sepya, Yüksek Kontrast)"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden xl:inline text-[11px]">
                {readingTheme === 'default' ? 'Okuma Modu' : getReadingThemeLabel(readingTheme)}
              </span>
            </button>

            {isReadingThemeOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Okuma Teması
                </div>
                {[
                  { id: 'default', label: 'Varsayılan (Normal)', desc: 'Orijinal sayfa renkleri', color: 'bg-white border-slate-300' },
                  { id: 'dark', label: 'Gece Modu', desc: 'Göz yormayan koyu kağıt', color: 'bg-slate-900 border-slate-700' },
                  { id: 'sepia', label: 'Sepya Kitap', desc: 'Sıcak dinlendirici ton', color: 'bg-[#f4ecd8] border-amber-300' },
                  { id: 'high-contrast', label: 'Yüksek Kontrast', desc: 'Daha net siyah/beyaz', color: 'bg-black border-white' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setReadingTheme(item.id as ReadingTheme);
                      setIsReadingThemeOpen(false);
                      addToast(`Okuma Modu: ${item.label}`, 'info', 1000);
                    }}
                    className={cn(
                      'w-full px-3 py-1.5 text-left flex items-center justify-between text-xs hover:bg-slate-100 dark:hover:bg-slate-700/70 transition-colors',
                      readingTheme === item.id ? 'font-semibold text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('w-3.5 h-3.5 rounded-full border shadow-sm shrink-0', item.color)} />
                      <div>
                        <div className="text-xs leading-snug">{item.label}</div>
                        <div className="text-[10px] text-slate-400 font-normal leading-tight">{item.desc}</div>
                      </div>
                    </div>
                    {readingTheme === item.id && <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Theme Toggle */}
        <button
          type="button"
          aria-label={isDark ? 'Açık Temaya Geç' : 'Karanlık Temaya Geç'}
          onClick={() => {
            const nextTheme = isDark ? 'light' : 'dark';
            setTheme(nextTheme);
            addToast(`Tema değiştirildi: ${nextTheme === 'dark' ? 'Karanlık Mod' : 'Aydınlık Mod'}`, 'info', 1200);
          }}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80 shadow-sm"
          title={
            theme === 'system'
              ? `Sistem Teması (${isDark ? 'Koyu' : 'Açık'}) — Değiştir`
              : isDark
              ? 'Açık Temaya Geç'
              : 'Karanlık Temaya Geç'
          }
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-sky-600" />}
        </button>

        {/* Properties Modal */}
        {currentDocument && (
          <button
            type="button"
            aria-label="Belge Özellikleri"
            onClick={() => setPropertiesModalOpen(true)}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Belge Bilgileri"
          >
            <Info className="w-4 h-4" />
          </button>
        )}

        {/* Shortcuts */}
        <button
          type="button"
          aria-label="Klavye Kısayolları"
          onClick={() => setShortcutsModalOpen(true)}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-700/80"
          title="Klavye Kısayolları"
        >
          <Keyboard className="w-4 h-4" />
        </button>

        {/* Settings Center */}
        <button
          type="button"
          aria-label="Ayarlar Merkezi"
          onClick={() => setSettingsModalOpen(true)}
          className="p-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 transition-colors border border-sky-500/30 shadow-sm group"
          title="Ayarlar Merkezi & Tasarımlar (Ctrl + ,)"
        >
          <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
        </button>
      </div>
    </header>
  );
};
