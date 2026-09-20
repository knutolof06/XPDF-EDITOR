import React, { useRef, useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore, ReadingTheme, ZOOM_STEPS } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
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
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const TopToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    currentDocument,
    setDocument,
    setLoading,
    setError,
    addRecentDocument,
  } = useDocumentStore();

  const { addTab } = useTabStore();

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
    setActiveTool,
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

  const handleOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      addToast(`"${file.name}" yükleniyor...`, 'info');
      const arrayBuffer = await file.arrayBuffer();
      const filePath = (file as any).path || undefined;
      const { model, pdfDoc } = await PdfLoader.loadDocument(file.name, arrayBuffer, filePath);
      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        filePath,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });
      addToast(`"${file.name}" başarıyla açıldı.`, 'success');
    } catch (err: any) {
      console.error(err);
      if (err?.isPasswordProtected) {
        useUIStore.getState().setPasswordModalOpen(true, {
          name: err.fileName || file.name,
          buffer: err.buffer,
          filePath: err.filePath,
        });
        addToast('Bu PDF parola ile korunmaktadır. Lütfen parolayı girin.', 'warning');
      } else {
        setError(err?.message || 'PDF yüklenemedi.');
        addToast('PDF açılamadı.', 'error');
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Kaydet: Orijinal dosyanın üzerine yaz (filePath varsa), yoksa Farklı Kaydet'e düşer
  const handleSave = async () => {
    if (!currentDocument) return;
    const electron = (window as any).electronAPI;
    try {
      addToast('Kaydediliyor...', 'info');
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);

      if (electron?.saveFile && currentDocument.filePath) {
        // Electron: Doğrudan orijinal dosyanın üzerine yaz
        const result = await electron.saveFile(currentDocument.filePath, rawOut);
        if (result?.success) {
          addToast(`"${currentDocument.name}" kaydedildi!`, 'success');
        } else {
          addToast('Kaydetme hatası: ' + (result?.error || 'bilinmeyen hata'), 'error');
        }
      } else {
        // Tarayıcı / dosya yolu yok → indirme olarak kaydet (aynı isim)
        const blob = new Blob([rawOut], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentDocument.name;
        a.click();
        URL.revokeObjectURL(url);
        addToast(`"${currentDocument.name}" kaydedildi!`, 'success');
      }
    } catch (err: any) {
      console.error('Save error:', err);
      addToast('Kaydetme hatası oluştu.', 'error');
    }
  };

  // Farklı Kaydet: Her zaman kayıt konumu sor
  const handleSaveAs = async () => {
    if (!currentDocument) return;
    const electron = (window as any).electronAPI;
    try {
      addToast('Dışa aktarılıyor...', 'info');
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);

      if (electron?.showSaveDialog) {
        // Electron: Yerel Windows kayıt diyaloğu
        const defaultName = currentDocument.name.replace(/\.pdf$/i, '') + '_edited.pdf';
        const savePath = await electron.showSaveDialog({ defaultPath: defaultName });
        if (!savePath) return; // İptal edildi
        const result = await electron.saveFile(savePath, rawOut);
        if (result?.success) {
          addToast(`"${savePath.split('\\').pop()}" kaydedildi!`, 'success');
        } else {
          addToast('Kaydetme hatası: ' + (result?.error || ''), 'error');
        }
      } else {
        // Tarayıcı fallback: indir
        const blob = new Blob([rawOut], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentDocument.name.replace(/\.pdf$/i, '') + '_edited.pdf';
        a.click();
        URL.revokeObjectURL(url);
        addToast('PDF başarıyla dışa aktarıldı!', 'success');
      }
    } catch (err: any) {
      console.error('SaveAs error:', err);
      addToast('Dışa aktarma hatası oluştu.', 'error');
    }
  };

  // Yazdır (Print: Tüm sayfaları vektör kalitesinde ve açıklamalarla birlikte yazdırır)
  const handlePrint = async () => {
    if (!currentDocument) return;
    const electron = (window as any).electronAPI;
    try {
      addToast('Yazdırma hazırlanıyor...', 'info', 2000);
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);
      const blob = new Blob([rawOut], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);

      const printIframe = document.createElement('iframe');
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      printIframe.src = blobUrl;
      document.body.appendChild(printIframe);

      printIframe.onload = () => {
        try {
          printIframe.contentWindow?.focus();
          printIframe.contentWindow?.print();
        } catch {
          if (electron?.printDocument) {
            electron.printDocument();
          } else {
            window.print();
          }
        }
        setTimeout(() => {
          try {
            document.body.removeChild(printIframe);
            URL.revokeObjectURL(blobUrl);
          } catch {
            // ignore
          }
        }, 60000);
      };
    } catch (err: any) {
      console.error('Print error:', err);
      if (electron?.printDocument) {
        electron.printDocument();
      } else {
        window.print();
      }
    }
  };

  return (
    <header
      className={cn(
        'flex items-center justify-between text-slate-700 dark:text-slate-200 select-none z-30 shrink-0 transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-12 mx-3 my-1.5 rounded-2xl cupertino-glass px-4 shadow-md border',
        appDesignTheme === 'linear' && 'h-10 bg-[#08090a] border-b border-white/10 px-3 text-xs shadow-none',
        appDesignTheme === 'ribbon' && 'h-10 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-3 text-xs shadow-none',
        appDesignTheme === 'fluent' && 'h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 shadow-sm'
      )}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleOpenFile}
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
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700/80"
          title="PDF Aç (Ctrl + O)"
        >
          <FolderOpen className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          <span className="hidden md:inline">Aç</span>
        </button>

        {/* Images to PDF */}
        <button
          onClick={() => setImagesToPdfModalOpen(true)}
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
              onClick={handleSave}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
              title={currentDocument.filePath ? `Kaydet — ${currentDocument.filePath} (Ctrl+S)` : 'Kaydet (Ctrl+S)'}
            >
              Kaydet
            </button>
            <div className="w-px h-full bg-sky-500/40" />
            <button
              onClick={handleSaveAs}
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
            onClick={handlePrint}
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
              onClick={() => {
                if (historyManager.undo()) {
                  addToast('Geri alındı (Undo)', 'info', 1500);
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Geri Al (Ctrl + Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (historyManager.redo()) {
                  addToast('Yinelendi (Redo)', 'info', 1500);
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Yinele (Ctrl + Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Adobe Acrobat Style "Tüm Araçlar" (Tools) Panel Toggle */}
        <button
          onClick={() => setRightToolsSidebarOpen((prev: boolean) => !prev)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-xs ml-1.5',
            isRightToolsSidebarOpen
              ? 'bg-sky-500 text-white border-sky-600 shadow-sky-500/20'
              : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
          )}
          title="Adobe Acrobat Tarzı Tüm Araçlar Panelini Aç / Kapat"
        >
          <SlidersHorizontal className="w-4 h-4 text-sky-400" />
          <span className="hidden sm:inline">Tüm Araçlar</span>
        </button>
      </div>

      {/* Center Section: Zoom & View Controls */}
      {currentDocument ? (
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
              onClick={zoomOut}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Uzaklaştır (Ctrl + -)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            {/* Zoom Popover Trigger */}
            <div className="relative" ref={zoomPopoverRef}>
              <button
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
              onClick={zoomIn}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Yakınlaştır (Ctrl + +)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

            <button
              onClick={() => setFitMode(fitMode === 'width' ? 'none' : 'width')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                fitMode === 'width'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Genişliğe Sığdır (Pencere boyutlandıkça sayfayı otomatik sığdırır) - Ctrl+2"
            >
              <FoldHorizontal className="w-4 h-4" />
            </button>

            <button
              onClick={() => setFitMode(fitMode === 'page' ? 'none' : 'page')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                fitMode === 'page'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Sayfaya Sığdır (Tüm sayfayı ekrana sığdırır) - Ctrl+0"
            >
              <Minimize2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => setActiveTool(activeTool === 'marquee-zoom' ? 'select' : 'marquee-zoom')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                activeTool === 'marquee-zoom'
                  ? 'bg-sky-500 text-white font-semibold shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Alan Yakınlaştırma (Kutu içine aldığınız alanı tam ekrana sığdırır) - Z / Shift+Sürükle"
            >
              <Scan className="w-4 h-4" />
            </button>

            <button
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

            {/* Bölge OCR (Windows Snipping Tool Tarzı) */}
            <button
              onClick={() => useUIStore.getState().setSnipOcrModalOpen(true)}
              className="px-2 py-1 rounded-md text-xs font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 transition-colors flex items-center gap-1.5 shadow-xs"
              title="Bölge OCR — Windows Ekran Alıntısı tarzı alandan metin tara"
            >
              <Crosshair className="w-3.5 h-3.5 text-sky-500" />
              <span className="hidden lg:inline">Bölge OCR</span>
            </button>
          </div>

          {/* View Mode Select */}
          <div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
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
            <button
              onClick={() => setViewMode('four-page')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'four-page'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Dört Sayfa Grid Görünümü"
            >
              <Grid2X2 className="w-4 h-4" />
            </button>
          </div>

          {/* Rotate actions */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/80">
            <button
              onClick={() => {
                const selected = currentDocument.selectedPageIds;
                if (selected.length > 0) {
                  historyManager.execute(new RotatePageCommand(selected, -90));
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Sola Döndür (-90°)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const selected = currentDocument.selectedPageIds;
                if (selected.length > 0) {
                  historyManager.execute(new RotatePageCommand(selected, 90));
                }
              }}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Sağa Döndür (+90°)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Lütfen bir PDF dosyası açın</div>
      )}

      {/* Right Section: Search, Settings, Info */}
      <div className="flex items-center gap-1.5">
        {currentDocument && (
          <button
            onClick={openSearch}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Dökümanda Ara (Ctrl + F)"
          >
            <Search className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          </button>
        )}

        {/* Reading Theme Selector */}
        {currentDocument && (
          <div className="relative" ref={readingThemeRef}>
            <button
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
                {readingTheme === 'default'
                  ? 'Okuma Modu'
                  : readingTheme === 'dark'
                  ? 'Gece'
                  : readingTheme === 'sepia'
                  ? 'Sepya'
                  : 'Kontrast'}
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
                      <span className={cn('w-3.5 h-3.5 rounded-full border shadow-xs shrink-0', item.color)} />
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

        {/* Theme Toggle (Güneş / Ay) */}
        <button
          onClick={() => {
            const nextTheme = theme === 'dark' ? 'light' : 'dark';
            setTheme(nextTheme);
            addToast(`Tema değiştirildi: ${nextTheme === 'dark' ? 'Karanlık Mod' : 'Aydınlık Mod'}`, 'info', 1200);
          }}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80 shadow-sm"
          title={theme === 'dark' ? 'Açık Temaya Geç' : 'Karanlık Temaya Geç'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-sky-600" />
          )}
        </button>

        {/* Properties Modal */}
        {currentDocument && (
          <button
            onClick={() => setPropertiesModalOpen(true)}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Döküman Bilgileri"
          >
            <Info className="w-4 h-4" />
          </button>
        )}

        {/* Shortcuts */}
        <button
          onClick={() => setShortcutsModalOpen(true)}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-700/80"
          title="Klavye Kısayolları"
        >
          <Keyboard className="w-4 h-4" />
        </button>

        {/* Settings Center */}
        <button
          onClick={() => setSettingsModalOpen(true)}
          className="p-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 transition-colors border border-sky-500/30 shadow-xs group"
          title="Ayarlar Merkezi & Tasarımlar (Ctrl + ,)"
        >
          <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
        </button>
      </div>
    </header>
  );
};
