import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
import { PdfExporter } from '@/core/engine/pdf-exporter';
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
  FileSignature,
  Stamp,
  Image as ImageIcon,
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

  const {
    activeTool,
    setActiveTool,
  } = useAnnotationStore();

  const {
    setMergeModalOpen,
    setSplitModalOpen,
    setInsertBlankPageModalOpen,
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
    setWatermarkModalOpen,
    setObjectEditorOpen,
    setCompressModalOpen,
    setExportImageModalOpen,
    setExtractTextModalOpen,
    setSecurityModalOpen,
    setSignatureVerifyModalOpen,
    setFindReplaceModalOpen,
    setPageEqualizeModalOpen,
    addToast,
  } = useUIStore();

  const handleSave = async () => {
    if (!currentDocument) return;
    const electron = (window as any).electronAPI;
    try {
      addToast('Döküman kaydediliyor...', 'info', 1000);
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);
      if (electron?.saveFile && currentDocument.filePath) {
        const result = await electron.saveFile(currentDocument.filePath, rawOut);
        if (result?.success) {
          addToast(`"${currentDocument.name}" kaydedildi!`, 'success');
        } else {
          addToast('Kaydetme hatası: ' + (result?.error || 'bilinmeyen hata'), 'error');
        }
      } else {
        const blob = new Blob([rawOut], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentDocument.name;
        a.click();
        URL.revokeObjectURL(url);
        addToast(`"${currentDocument.name}" kaydedildi!`, 'success');
      }
    } catch (err) {
      console.error(err);
      addToast('Kayıt sırasında hata oluştu.', 'error');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!currentDocument) return null;

  return (
    <div className="w-full bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col select-none transition-colors duration-200 shadow-xs">
      {/* Ribbon Navigation Tabs Header */}
      <div className="flex items-center px-3 pt-1 border-b border-slate-200/80 dark:border-slate-800/80 gap-1 bg-slate-100/70 dark:bg-slate-950/40">
        {[
          { id: 'home', label: 'Giriş (Home)' },
          { id: 'edit', label: 'Düzenle & Çiz' },
          { id: 'annotate', label: 'Açıklama & İmza' },
          { id: 'pages', label: 'Sayfalar' },
          { id: 'tools', label: 'Araçlar & Güvenlik' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveRibbonTab(tab.id as RibbonTab)}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-t-lg transition-all relative border-t-2',
              activeRibbonTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 font-bold border-sky-500 shadow-xs -mb-[1px]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border-transparent hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ribbon Content Bar with Categorized Tool Groups */}
      <div className="px-3 py-2 flex items-stretch gap-3 overflow-x-auto min-h-[78px] bg-white dark:bg-slate-900">
        {/* ================= TAB 1: GİRİŞ (HOME) ================= */}
        {activeRibbonTab === 'home' && (
          <>
            {/* Group: Temel Dosya */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-12"
                  title="PDF Olarak Kaydet (Ctrl+S)"
                >
                  <Save className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Kaydet</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-12"
                  title="Yazdır (Ctrl+P)"
                >
                  <Printer className="w-5 h-5 text-slate-600 dark:text-slate-400 mb-1" />
                  <span className="text-[10px] leading-tight">Yazdır</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Dosya</span>
            </div>

            {/* Group: Seçim ve Gezinme */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTool('select')}
                  className={cn(
                    'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                    activeTool === 'select'
                      ? 'bg-sky-500 text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="Seçim Aracı (V)"
                >
                  <MousePointer className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-tight">Seç</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('hand')}
                  className={cn(
                    'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                    activeTool === 'hand'
                      ? 'bg-sky-500 text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                  title="El (Pan) Aracı (H)"
                >
                  <Hand className="w-5 h-5 mb-1" />
                  <span className="text-[10px] leading-tight">Kaydır</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">İmleç</span>
            </div>

            {/* Group: Yakınlaştırma & Sığdırma */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={zoomOut}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  title="Uzaklaştır"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 px-1 min-w-[40px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomIn}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  title="Yakınlaştır"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

                <button
                  type="button"
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
              <span className="text-[9px] text-slate-400 font-medium">Görünüm & Büyütme</span>
            </div>

            {/* Group: Görünüm Modları & Arama */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
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
                  onClick={() => setViewMode('two-page')}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    viewMode === 'two-page' ? 'bg-sky-500/20 text-sky-500 font-bold' : 'text-slate-600 dark:text-slate-400'
                  )}
                  title="İki Sayfa"
                >
                  <Grid2X2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
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
            {/* Group: Çizim Araçları */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                {[
                  { id: 'draw', icon: Pen, label: 'Kalem' },
                  { id: 'highlight', icon: Highlighter, label: 'Fosforlu' },
                  { id: 'text-add', icon: Type, label: 'Metin' },
                  { id: 'eraser', icon: Eraser, label: 'Silgi' },
                ].map((tool) => {
                  const Icon = tool.icon;
                  const isActive = activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => setActiveTool(tool.id as any)}
                      className={cn(
                        'flex flex-col items-center justify-center p-1.5 rounded-lg transition-colors w-12',
                        isActive
                          ? 'bg-sky-500 text-white font-bold shadow-xs'
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
              <span className="text-[9px] text-slate-400 font-medium">İşaretleme & Çizim</span>
            </div>

            {/* Group: Şekiller */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1">
                {[
                  { id: 'rect', icon: Square, label: 'Kutu' },
                  { id: 'circle', icon: Circle, label: 'Daire' },
                  { id: 'line', icon: Minus, label: 'Çizgi' },
                  { id: 'arrow', icon: ArrowUpRight, label: 'Ok' },
                ].map((shape) => {
                  const Icon = shape.icon;
                  const isActive = activeTool === shape.id;
                  return (
                    <button
                      key={shape.id}
                      type="button"
                      onClick={() => setActiveTool(shape.id as any)}
                      className={cn(
                        'p-2 rounded-lg transition-colors',
                        isActive
                          ? 'bg-sky-500 text-white shadow-xs'
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

            {/* Group: Nesne Düzenleyici */}
            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setObjectEditorOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="PDF İçi Görsel ve Nesneleri Düzenle"
                >
                  <SlidersHorizontal className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">Nesne Edit</span>
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
                  onClick={() => setSignatureModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Islak / Dijital İmza Ekle"
                >
                  <FileSignature className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">İmza Ekle</span>
                </button>
                <button
                  type="button"
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
                  onClick={() => setPageNumberModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Sayfa Numarası Ekle"
                >
                  <Hash className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-[10px] leading-tight">Sayfa No</span>
                </button>
                <button
                  type="button"
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
                  onClick={() => setPageManagerOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Görsel Sayfa Düzenleyici"
                >
                  <Grid2X2 className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Yönetici</span>
                </button>
                <button
                  type="button"
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
                  onClick={() => {
                    const selected = currentDocument.selectedPageIds;
                    if (selected.length > 0) {
                      historyManager.execute(new RotatePageCommand(selected, -90));
                    }
                  }}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sola Döndür (-90°)"
                >
                  <RotateCcw className="w-5 h-5 text-slate-600 dark:text-slate-400 mb-1" />
                  <span className="text-[10px] leading-tight">Sola Döndür</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const selected = currentDocument.selectedPageIds;
                    if (selected.length > 0) {
                      historyManager.execute(new RotatePageCommand(selected, 90));
                    }
                  }}
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
                  onClick={() => setMergeModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="PDF'leri Birleştir"
                >
                  <Layers className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Birleştir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSplitModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="PDF'i Böl"
                >
                  <Scissors className="w-5 h-5 text-rose-500 mb-1" />
                  <span className="text-[10px] leading-tight">Böl</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPageEqualizeModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-14"
                  title="Sayfa Boyutlarını Eşitle"
                >
                  <Minimize2 className="w-5 h-5 text-amber-500 mb-1" />
                  <span className="text-[10px] leading-tight">Eşitle</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Böl & Birleştir</span>
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
                  onClick={() => setSecurityModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Parola ve İzinler"
                >
                  <Lock className="w-5 h-5 text-amber-500 mb-1" />
                  <span className="text-[10px] leading-tight">Şifrele</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSignatureVerifyModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Dijital İmzaları Doğrula"
                >
                  <ShieldCheck className="w-5 h-5 text-emerald-500 mb-1" />
                  <span className="text-[10px] leading-tight">Doğrula</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Güvenlik & Gizlilik</span>
            </div>

            <div className="flex flex-col justify-between items-center border-r border-slate-200 dark:border-slate-800 pr-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCompressModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="PDF Dosya Boyutunu Sıkıştır"
                >
                  <Minimize2 className="w-5 h-5 text-sky-500 mb-1" />
                  <span className="text-[10px] leading-tight">Sıkıştır</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExtractTextModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Metin ve OCR Çıkar"
                >
                  <FileText className="w-5 h-5 text-indigo-500 mb-1" />
                  <span className="text-[10px] leading-tight">OCR Metin</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExportImageModalOpen(true)}
                  className="flex flex-col items-center justify-center p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors w-16"
                  title="Sayfaları Görsel Olarak Dışa Aktar"
                >
                  <ImageIcon className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-[10px] leading-tight">Görsel Aktar</span>
                </button>
              </div>
              <span className="text-[9px] text-slate-400 font-medium">Dönüştürme & Optimize</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
