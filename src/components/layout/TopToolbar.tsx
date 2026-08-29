import React, { useRef, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
import { FormFieldsModal } from '../dialogs/FormFieldsModal';
import { CompareModal } from '../dialogs/CompareModal';
import {
  FolderOpen,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Search,
  LayoutGrid,
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
  Layers,
  Scissors,
  Sparkles,
  CheckSquare,
} from 'lucide-react';
import { PageTransitionType } from '@/types/document';
import { cn } from '@/utils/cn';

export const TopToolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFormsModalOpen, setIsFormsModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

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
    zoomIn,
    zoomOut,
    viewMode,
    setViewMode,
    pageTransition,
    setPageTransition,
    theme,
    setTheme,
    openSearch,
    isPageManagerOpen,
    setPageManagerOpen,
  } = useViewerStore();

  const {
    setPropertiesModalOpen,
    setShortcutsModalOpen,
    setMergeModalOpen,
    setSplitModalOpen,
    setPageLayoutModalOpen,
    addToast,
  } = useUIStore();

  const handleOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      addToast(`"${file.name}" yükleniyor...`, 'info');
      const arrayBuffer = await file.arrayBuffer();
      const { model, pdfDoc } = await PdfLoader.loadDocument(file.name, arrayBuffer);
      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });
      addToast(`"${file.name}" başarıyla açıldı.`, 'success');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'PDF yüklenemedi.');
      addToast('PDF açılamadı.', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportPdf = async () => {
    if (!currentDocument) return;
    try {
      addToast('PDF ve tüm düzenlemeler dışa aktarılıyor...', 'info');
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);
      const blob = new Blob([rawOut], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = currentDocument.name.replace(/\.pdf$/i, '') + '_edited.pdf';
      a.click();
      URL.revokeObjectURL(url);

      addToast('PDF başarıyla kaydedildi!', 'success');
    } catch (err: any) {
      console.error('Export error:', err);
      addToast('PDF kaydedilirken hata oluştu.', 'error');
    }
  };

  return (
    <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 flex items-center justify-between text-slate-700 dark:text-slate-200 select-none z-30 shrink-0 shadow-sm transition-colors duration-200">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleOpenFile}
        accept="application/pdf"
        className="hidden"
      />

      {/* Modals for Form and Compare */}
      <FormFieldsModal isOpen={isFormsModalOpen} onClose={() => setIsFormsModalOpen(false)} />
      <CompareModal isOpen={isCompareModalOpen} onClose={() => setIsCompareModalOpen(false)} />

      {/* Left Section: Logo, File Ops, Tools */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 mr-1">
          <img src="./logo.png" alt="XPDF" className="w-8 h-8 object-contain rounded-lg shadow-sm" />
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

        {/* Save / Export */}
        {currentDocument && (
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors shadow-sm shadow-sky-600/30"
            title="Değişiklikleri Kaydet / Dışa Aktar (Ctrl + S)"
          >
            Kaydet
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

        {/* Merge, Split, Compare, Forms buttons */}
        <div className="hidden lg:flex items-center gap-1 ml-1">
          <button
            onClick={() => setMergeModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
            title="Birden Fazla PDF'i Birleştir"
          >
            <Layers className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span>Birleştir</span>
          </button>

          {currentDocument && (
            <button
              onClick={() => setSplitModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
              title="PDF'i Parçala / Sayfaları Ayır"
            >
              <Scissors className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
              <span>Böl</span>
            </button>
          )}

          {currentDocument && (
            <button
              onClick={() => setIsCompareModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
              title="İki Belgeyi Yan Yana Karşılaştır"
            >
              <Columns className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
              <span>Karşılaştır</span>
            </button>
          )}

          {currentDocument && (
            <button
              onClick={() => setIsFormsModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/80"
              title="PDF Form Alanları"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span>Formlar</span>
            </button>
          )}

          {currentDocument && (
            <button
              onClick={() => setPageLayoutModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/40 hover:bg-purple-200 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 transition-colors border border-purple-200 dark:border-purple-800/60 text-xs font-medium"
              title="Sayfaları Birleştirip Tek Sayfa Yap (N-up Layout)"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>N-up</span>
            </button>
          )}
        </div>

        {/* Page Manager Toggle */}
        {currentDocument && (
          <button
            onClick={() => setPageManagerOpen(!isPageManagerOpen)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border',
              isPageManagerOpen
                ? 'bg-sky-500/20 border-sky-500/40 text-sky-600 dark:text-sky-300'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300'
            )}
            title="Gelişmiş Sayfa Düzenleyici (Grid Görünümü)"
          >
            <LayoutGrid className="w-4 h-4 text-sky-500 dark:text-sky-400" />
            <span className="hidden xl:inline">Düzenleyici</span>
          </button>
        )}
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
            <button
              onClick={() => setZoom(1.0)}
              className="px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-[50px] text-center"
              title="Yakınlaştırmayı Sıfırla"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
              title="Yakınlaştır (Ctrl + +)"
            >
              <ZoomIn className="w-4 h-4" />
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

        {/* Transition selector */}
        <select
          value={pageTransition}
          onChange={(e) => setPageTransition(e.target.value as PageTransitionType)}
          className="hidden 2xl:inline-block bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none"
          title="Sayfa Geçiş Animasyonu"
        >
          <option value="smooth">Animasyon: Smooth</option>
          <option value="slide">Animasyon: Slide</option>
          <option value="classic">Animasyon: Classic Fade</option>
          <option value="zoom">Animasyon: Zoom</option>
          <option value="instant">Animasyon: Kapalı</option>
        </select>

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
      </div>
    </header>
  );
};
