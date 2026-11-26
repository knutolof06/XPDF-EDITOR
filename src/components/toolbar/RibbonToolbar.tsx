import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
import {
  printDocumentWithAnnotations,
  saveDocument,
  syncActiveTool,
} from '@/components/common/pdf-actions';
import { useViewerUIState } from '@/components/viewer/viewer-ui-state';
import { ActiveTool } from '@/types/viewer';
import {
  FileText,
  Save,
  Printer,
  MousePointer,
  Hand,
  Type,
  Pen,
  Highlighter,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Eraser,
  ShieldAlert,
  FileSignature,
  Stamp,
  Hash,
  Scissors,
  Layers,
  FilePlus,
  RotateCcw,
  RotateCw,
  Search,
  Replace,
  Lock,
  ShieldCheck,
  Minimize2,
  ZoomIn,
  ZoomOut,
  FoldHorizontal,
  Droplet,
  SlidersHorizontal,
  Grid2X2,
  Rows,
  Columns,
  Crosshair,
  Move,
  LayoutGrid,
  FileOutput,
  Heading,
  BookCopy,
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/utils/cn';

type RibbonTab = 'home' | 'edit' | 'annotate' | 'pages' | 'tools';

export const RibbonToolbar: React.FC = () => {
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab>('home');
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const {
    zoom,
    zoomIn,
    zoomOut,
    fitMode,
    setFitMode,
    viewMode,
    setViewMode,
    openSearch,
    setPageManagerOpen,
  } = useViewerStore();

  const activeTool = useAnnotationStore((s) => s.activeTool);
  const { inlineNativeEdit, toggleInlineNativeEdit, twoPageCoverOffset, toggleTwoPageCoverOffset } =
    useViewerUIState();

  const {
    setMergeModalOpen,
    setSplitModalOpen,
    setInsertBlankPageModalOpen,
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
    setHeaderFooterModalOpen,
    setWatermarkModalOpen,
    setObjectEditorOpen,
    setCompressModalOpen,
    setExportImageModalOpen,
    setOcrModalOpen,
    setSnipOcrModalOpen,
    setSecurityModalOpen,
    setSignatureVerifyModalOpen,
    setFindReplaceModalOpen,
    setPageEqualizeModalOpen,
    setPageLayoutModalOpen,
    setExtractTextModalOpen,
  } = useUIStore();

  if (!currentDocument) return null;

  const handleRotate = (angle: number) => {
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

  return (
    <div
      role="toolbar"
      aria-label="Şerit Araç Çubuğu"
      className="no-print w-full bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col select-none transition-colors duration-200 shadow-sm"
    >
      {/* Ribbon Navigation Tabs Header */}
      <div
        role="tablist"
        aria-label="Şerit Sekmeleri"
        className="flex items-center px-3 pt-1 border-b border-slate-200/80 dark:border-slate-800/80 gap-1 bg-slate-100/70 dark:bg-slate-950/40"
      >
        {[
          { id: 'home', label: 'Giriş' },
          { id: 'edit', label: 'Düzenle & Çiz' },
          { id: 'annotate', label: 'Açıklama & İmza' },
          { id: 'pages', label: 'Sayfalar' },
          { id: 'tools', label: 'Araçlar & Güvenlik' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeRibbonTab === tab.id}
            onClick={() => setActiveRibbonTab(tab.id as RibbonTab)}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-t-lg transition-all relative border-t-2',
              activeRibbonTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 font-bold border-sky-500 shadow-sm -mb-[1px]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border-transparent hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ribbon Content Bar with Categorized Tool Groups */}
      <div className="px-3 py-2 flex items-stretch gap-3 overflow-x-auto min-h-[78px] bg-white dark:bg-slate-900">
        {/* ================= TAB 1: GİRİŞ ================= */}
        {activeRibbonTab === 'home' && (
          <>
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Belgeyi Kaydet (Ctrl+S)"
                  onClick={() => saveDocument(currentDocument, false)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-12"
                  title="PDF Olarak Kaydet (Ctrl+S)"
                >
                  <Save className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Kaydet</span>
                </button>
                <button
                  type="button"
                  aria-label="Farklı Kaydet (Ctrl+Shift+S)"
                  onClick={() => saveDocument(currentDocument, true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Farklı Kaydet (Ctrl+Shift+S)"
                >
                  <FileOutput className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">Farklı</span>
                </button>
                <button
                  type="button"
                  aria-label="Yazdır (Ctrl+P)"
                  onClick={() => printDocumentWithAnnotations(currentDocument)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-12"
                  title="Yazdır (Ctrl+P)"
                >
                  <Printer className="w-5 h-5 text-slate-600 dark:text-slate-400 mb-1" />
                  <span className="text-[10px] leading-tight">Yazdır</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Dosya</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Seçim Aracı (V)"
                  aria-pressed={activeTool === 'select'}
                  onClick={() => syncActiveTool('select')}
                  className={cn(
                    'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                    activeTool === 'select'
                      ? 'bg-sky-500 text-white font-bold shadow-sm'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="Seçim Aracı (V)"
                >
                  <MousePointer className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-tight">Seç</span>
                </button>
                <button
                  type="button"
                  aria-label="El (Kaydır) Aracı (Boşluk)"
                  aria-pressed={activeTool === 'hand'}
                  onClick={() => syncActiveTool('hand')}
                  className={cn(
                    'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                    activeTool === 'hand'
                      ? 'bg-sky-500 text-white font-bold shadow-sm'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="El (Kaydır) Aracı — Sürükleyerek gezinin (Boşluk tuşunu basılı tutun)"
                >
                  <Hand className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-tight">Kaydır</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">İmleç</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Uzaklaştır"
                  onClick={zoomOut}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  title="Uzaklaştır (Ctrl+-)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 px-1 min-w-[40px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Yakınlaştır"
                  onClick={zoomIn}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  title="Yakınlaştır (Ctrl++)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

                <button
                  type="button"
                  aria-label="Genişliğe Sığdır"
                  aria-pressed={fitMode === 'width'}
                  onClick={() => setFitMode(fitMode === 'width' ? 'none' : 'width')}
                  className={cn(
                    'px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors',
                    fitMode === 'width'
                      ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="Genişliğe Sığdır (Ctrl+2)"
                >
                  <FoldHorizontal className="w-4 h-4" />
                  <span>Genişlik</span>
                </button>
                <button
                  type="button"
                  aria-label="İçeriğe Sığdır"
                  aria-pressed={fitMode === 'content'}
                  onClick={() => setFitMode(fitMode === 'content' ? 'none' : 'content')}
                  className={cn(
                    'px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors',
                    fitMode === 'content'
                      ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="İçeriğe Sığdır (Ctrl+3)"
                >
                  <FileText className="w-4 h-4" />
                  <span>Metin Odaklı</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Görünüm &amp; Büyütme</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Sürekli Dikey Görünüm"
                  aria-pressed={viewMode === 'continuous'}
                  onClick={() => setViewMode('continuous')}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    viewMode === 'continuous' ? 'bg-sky-500/20 text-sky-500 font-bold' : 'text-slate-600 dark:text-slate-400'
                  )}
                  title="Sürekli Dikey"
                >
                  <Rows className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Tek Sayfa Görünümü"
                  aria-pressed={viewMode === 'single'}
                  onClick={() => setViewMode('single')}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    viewMode === 'single' ? 'bg-sky-500/20 text-sky-500 font-bold' : 'text-slate-600 dark:text-slate-400'
                  )}
                  title="Tek Sayfa"
                >
                  <Square className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="İki Sayfa Görünümü"
                  aria-pressed={viewMode === 'two-page'}
                  onClick={() => setViewMode('two-page')}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    viewMode === 'two-page' ? 'bg-sky-500/20 text-sky-500 font-bold' : 'text-slate-600 dark:text-slate-400'
                  )}
                  title="İki Sayfa"
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
                      'p-1.5 rounded-lg transition-colors',
                      twoPageCoverOffset ? 'bg-sky-500 text-white' : 'text-slate-600 dark:text-slate-400'
                    )}
                    title="Kapak Sayfasını Ayrı Göster"
                  >
                    <BookCopy className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dört Sayfa Izgara"
                  aria-pressed={viewMode === 'four-page'}
                  onClick={() => setViewMode('four-page')}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    viewMode === 'four-page' ? 'bg-sky-500/20 text-sky-500 font-bold' : 'text-slate-600 dark:text-slate-400'
                  )}
                  title="Dört Sayfa Izgara"
                >
                  <Grid2X2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Metin Ara (Ctrl+F)"
                  onClick={openSearch}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium ml-1"
                  title="Metin Ara (Ctrl+F)"
                >
                  <Search className="w-4 h-4 text-sky-500" />
                  <span>Metin Ara</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Sayfa Düzeni</span>
            </div>
          </>
        )}

        {/* ================= TAB 2: DÜZENLE & ÇİZ ================= */}
        {activeRibbonTab === 'edit' && (
          <>
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'draw', icon: Pen, label: 'Kalem' },
                    { id: 'highlight', icon: Highlighter, label: 'Fosforlu' },
                    { id: 'text-add', icon: Type, label: 'Metin' },
                    { id: 'whiteout', icon: ShieldAlert, label: 'Beyazlat' },
                    { id: 'eraser', icon: Eraser, label: 'Silgi' },
                  ] as { id: ActiveTool; icon: React.ComponentType<{ className?: string }>; label: string }[]
                ).map((tool) => {
                  const Icon = tool.icon;
                  const isActive = activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      aria-label={tool.label}
                      aria-pressed={isActive}
                      onClick={() => syncActiveTool(tool.id)}
                      className={cn(
                        'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                        isActive
                          ? 'bg-sky-500 text-white font-bold shadow-sm'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                      title={tool.label}
                    >
                      <Icon className="w-5 h-5 mb-1" />
                      <span className="text-[10px] leading-tight">{tool.label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="text-[9px] text-slate-400 font-medium">İşaretleme &amp; Çizim</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'rect', icon: Square, label: 'Kutu' },
                    { id: 'circle', icon: Circle, label: 'Daire' },
                    { id: 'line', icon: Minus, label: 'Çizgi' },
                    { id: 'arrow', icon: ArrowUpRight, label: 'Ok' },
                  ] as { id: ActiveTool; icon: React.ComponentType<{ className?: string }>; label: string }[]
                ).map((shape) => {
                  const Icon = shape.icon;
                  const isActive = activeTool === shape.id;
                  return (
                    <button
                      key={shape.id}
                      type="button"
                      aria-label={shape.label}
                      aria-pressed={isActive}
                      onClick={() => syncActiveTool(shape.id)}
                      className={cn(
                        'p-2 rounded-lg transition-colors',
                        isActive
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                      title={shape.label}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Vektör Şekiller</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Sayfa İçi Nesneleri Taşı"
                  aria-pressed={inlineNativeEdit}
                  onClick={() => {
                    const next = !inlineNativeEdit;
                    toggleInlineNativeEdit();
                    if (next) syncActiveTool('select');
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-16',
                    inlineNativeEdit
                      ? 'bg-amber-500 text-white font-bold shadow-sm'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="PDF İçi Metin Bloklarını Doğrudan Sayfa Üzerinde Taşı"
                >
                  <Move className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-tight">Sayfa İçi</span>
                </button>
                <button
                  type="button"
                  aria-label="Nesne Düzenleyici Penceresini Aç"
                  onClick={() => setObjectEditorOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="PDF İçi Görsel ve Nesneleri Düzenle"
                >
                  <SlidersHorizontal className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">Nesne Düzenle</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Görsel Katman</span>
            </div>
          </>
        )}

        {/* ================= TAB 3: AÇIKLAMA & İMZA ================= */}
        {activeRibbonTab === 'annotate' && (
          <>
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="İmza Ekle"
                  onClick={() => setSignatureModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Islak / Dijital İmza Ekle"
                >
                  <FileSignature className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">İmza Ekle</span>
                </button>
                <button
                  type="button"
                  aria-label="Kaşe Ekle"
                  onClick={() => setStampModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Resmi Kaşe / Onay Damgası"
                >
                  <Stamp className="w-5 h-5 text-amber-500 mb-1" />
                  <span className="text-[10px] leading-tight">Kaşe Ekle</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Resmi Onay</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Sayfa Numarası Ekle"
                  onClick={() => setPageNumberModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Sayfa Numarası Ekle"
                >
                  <Hash className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-[10px] leading-tight">Sayfa No</span>
                </button>
                <button
                  type="button"
                  aria-label="Üst ve Alt Bilgi Ekle"
                  onClick={() => setHeaderFooterModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Dinamik Üst ve Alt Bilgi Ekle"
                >
                  <Heading className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">Üst/Alt Bilgi</span>
                </button>
                <button
                  type="button"
                  aria-label="Filigran Ekle"
                  onClick={() => setWatermarkModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Gizli / Telif Filigranı Ekle"
                >
                  <Droplet className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Filigran</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Belge Damgası</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Bul ve Değiştir (Ctrl+H)"
                  onClick={() => setFindReplaceModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Bul ve Değiştir (Ctrl+H)"
                >
                  <Replace className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">Bul/Değiştir</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Metin İşlemleri</span>
            </div>
          </>
        )}

        {/* ================= TAB 4: SAYFALAR ================= */}
        {activeRibbonTab === 'pages' && (
          <>
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Sayfa Yöneticisini Aç"
                  onClick={() => setPageManagerOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Görsel Sayfa Düzenleyici"
                >
                  <Grid2X2 className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Yönetici</span>
                </button>
                <button
                  type="button"
                  aria-label="Boş Sayfa Ekle"
                  onClick={() => setInsertBlankPageModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Boş Sayfa Ekle"
                >
                  <FilePlus className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">Boş Sayfa</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Sayfa Organizasyonu</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Sola Döndür (-90 derece)"
                  onClick={() => handleRotate(-90)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sola Döndür (-90°)"
                >
                  <RotateCcw className="w-5 h-5 text-slate-600 dark:text-slate-400 mb-1" />
                  <span className="text-[10px] leading-tight">Sola Döndür</span>
                </button>
                <button
                  type="button"
                  aria-label="Sağa Döndür (+90 derece)"
                  onClick={() => handleRotate(90)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sağa Döndür (+90°)"
                >
                  <RotateCw className="w-5 h-5 text-slate-600 dark:text-slate-400 mb-1" />
                  <span className="text-[10px] leading-tight">Sağa Döndür</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Yönlendirme</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="PDF'leri Birleştir"
                  onClick={() => setMergeModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="PDF'leri Birleştir"
                >
                  <Layers className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Birleştir</span>
                </button>
                <button
                  type="button"
                  aria-label="PDF'i Böl"
                  onClick={() => setSplitModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="PDF'i Böl"
                >
                  <Scissors className="w-5 h-5 text-rose-500 mb-1" />
                  <span className="text-[10px] leading-tight">Böl</span>
                </button>
                <button
                  type="button"
                  aria-label="Sayfa Boyutlarını Eşitle"
                  onClick={() => setPageEqualizeModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sayfa Boyutlarını Eşitle"
                >
                  <Minimize2 className="w-5 h-5 text-amber-500 mb-1" />
                  <span className="text-[10px] leading-tight">Eşitle</span>
                </button>
                <button
                  type="button"
                  aria-label="Çoklu Sayfa Mizanpajı (N-up)"
                  onClick={() => setPageLayoutModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sayfaları N-up Izgarada Birleştir"
                >
                  <LayoutGrid className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-[10px] leading-tight">Mizanpaj</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Böl &amp; Birleştir</span>
            </div>
          </>
        )}

        {/* ================= TAB 5: ARAÇLAR & GÜVENLİK ================= */}
        {activeRibbonTab === 'tools' && (
          <>
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Parola ve İzinler"
                  onClick={() => setSecurityModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Parola ve İzinler"
                >
                  <Lock className="w-5 h-5 text-amber-500 mb-1" />
                  <span className="text-[10px] leading-tight">Şifrele</span>
                </button>
                <button
                  type="button"
                  aria-label="Dijital İmzaları Doğrula"
                  onClick={() => setSignatureVerifyModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Dijital İmzaları Doğrula"
                >
                  <ShieldCheck className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">Doğrula</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Güvenlik &amp; Gizlilik</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="PDF Sıkıştır"
                  onClick={() => setCompressModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="PDF Dosya Boyutunu Sıkıştır"
                >
                  <Minimize2 className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Sıkıştır</span>
                </button>
                <button
                  type="button"
                  aria-label="Metin Tanıma (OCR)"
                  onClick={() => setOcrModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Taranmış Belgelerde Metin Tanıma (OCR)"
                >
                  <FileText className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight font-medium">Metin Tanı (OCR)</span>
                </button>
                <button
                  type="button"
                  aria-label="Metin Çıkar (TXT / JSON)"
                  onClick={() => setExtractTextModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Belgedeki Tüm Metni TXT / JSON Olarak Çıkar"
                >
                  <FileOutput className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">Metin Çıkar</span>
                </button>
                <button
                  type="button"
                  aria-label="Sayfaları Görsel Olarak Dışa Aktar"
                  onClick={() => setExportImageModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Sayfaları Görsel Olarak Dışa Aktar"
                >
                  <ImageIcon className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-[10px] leading-tight">Görsel Aktar</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Dönüştürme &amp; Optimize</span>
            </div>

            <div className="flex flex-col justify-between items-center pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Bölge OCR"
                  onClick={() => setSnipOcrModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-sky-50 dark:hover:bg-sky-950/30 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16 border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20"
                  title="Seçilen bölgeden anında metin çıkar"
                >
                  <Crosshair className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight font-semibold text-sky-600 dark:text-sky-400">Bölge OCR</span>
                </button>
              </div>
              <span className="text-[9px] text-sky-500 dark:text-sky-400 font-semibold">Ekran Alıntısı</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
