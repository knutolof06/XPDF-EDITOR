import React, { useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { ThumbnailItem } from '../viewer/ThumbnailItem';
import { historyManager, RotatePageCommand, DeletePageCommand } from '@/core/history/command-manager';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { binaryStore } from '@/core/storage/binary-store';
import { PDFDocument } from 'pdf-lib';
import {
  X,
  RotateCw,
  RotateCcw,
  CheckSquare,
  Square,
  LayoutGrid,
  Copy,
  Trash2,
  Sparkles,
  Download,
  FilePlus,
} from 'lucide-react';

interface CachedPageBound {
  id: string;
  el: HTMLElement;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const PageManagerModal: React.FC = () => {
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);

  const isSelectingRef = useRef(false);
  const isMultiSelectModeRef = useRef(false);
  const lastClickedIndexRef = useRef<number | null>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const cachedBoundsRef = useRef<CachedPageBound[]>([]);
  const currentSelectedSetRef = useRef<Set<string>>(new Set());

  const {
    currentDocument,
    selectAllPages,
    clearPageSelection,
    selectPages,
    setActivePageIndex,
    setDocument,
  } = useDocumentStore();

  const { addTab } = useTabStore();
  const { isPageManagerOpen, setPageManagerOpen } = useViewerStore();
  const { setPageLayoutModalOpen, addToast } = useUIStore();

  if (!isPageManagerOpen || !currentDocument) return null;

  const selectedCount = currentDocument.selectedPageIds.length;
  const isAllSelected = selectedCount === currentDocument.pages.length;

  const handleDuplicate = async () => {
    if (selectedCount === 0) return;
    try {
      addToast('Sayfalar çoğaltılıyor...', 'info');
      const result = await PdfAssembler.duplicatePages(
        currentDocument,
        currentDocument.selectedPageIds
      );
      setDocument(result.model, result.pdfDoc);
      addToast(`${selectedCount} sayfa başarıyla çoğaltıldı.`, 'success');
    } catch (err: any) {
      console.error(err);
      addToast('Çoğaltma sırasında hata oluştu.', 'error');
    }
  };

  const handleDeleteSelected = () => {
    if (selectedCount === 0) return;
    const deleted = currentDocument.pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter((item) => currentDocument.selectedPageIds.includes(item.page.id));

    historyManager.execute(new DeletePageCommand(deleted));
    addToast(`${deleted.length} sayfa silindi.`, 'info');
  };

  // Extract Pages to New PDF and Download
  const handleExtractAndDownload = async () => {
    if (selectedCount === 0) {
      addToast('Lütfen ayıklamak istediğiniz sayfaları seçin.', 'warning');
      return;
    }

    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    try {
      addToast('Seçili sayfalar yeni PDF olarak ayıklanıyor...', 'info');
      const srcDoc = await PDFDocument.load(rawBuffer.slice(0));
      const outDoc = await PDFDocument.create();

      const selectedPages = currentDocument.pages.filter((p) =>
        currentDocument.selectedPageIds.includes(p.id)
      );

      const indices = selectedPages.map((p) => p.sourcePageIndex);
      const copiedPages = await outDoc.copyPages(srcDoc, indices);
      copiedPages.forEach((p) => outDoc.addPage(p));

      const pdfBytes = await outDoc.save();
      const rawOut = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer;

      const blob = new Blob([rawOut], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_ayiklanan_${selectedCount}_sayfa.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      addToast(`${selectedCount} sayfa yeni bir PDF olarak indirildi!`, 'success');
    } catch (err: any) {
      console.error(err);
      addToast('Ayıklama sırasında hata oluştu.', 'error');
    }
  };

  // Extract Pages and Open directly as New PDF / Tab in editor
  const handleExtractAndOpenNewPdf = async () => {
    if (selectedCount === 0) {
      addToast('Lütfen açmak istediğiniz sayfaları seçin.', 'warning');
      return;
    }

    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    try {
      addToast('Seçili sayfalar yeni PDF olarak açılıyor...', 'info');
      const srcDoc = await PDFDocument.load(rawBuffer.slice(0));
      const outDoc = await PDFDocument.create();

      const selectedPages = currentDocument.pages.filter((p) =>
        currentDocument.selectedPageIds.includes(p.id)
      );

      const indices = selectedPages.map((p) => p.sourcePageIndex);
      const copiedPages = await outDoc.copyPages(srcDoc, indices);
      copiedPages.forEach((p) => outDoc.addPage(p));

      const pdfBytes = await outDoc.save();
      const rawOut = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer;

      const baseName = currentDocument.name.replace(/\.pdf$/i, '');
      const newFileName = `${baseName}_ayiklanan_${selectedCount}_sayfa.pdf`;

      const loaded = await PdfLoader.loadDocument(newFileName, rawOut);

      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      setPageManagerOpen(false);

      addToast(`${selectedCount} sayfa yeni sekmede açıldı!`, 'success');
    } catch (err: any) {
      console.error(err);
      addToast('Yeni PDF açılırken hata oluştu.', 'error');
    }
  };

  // Ultra-Fast Zero-Allocation Marquee Selection Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // If clicking quick buttons or drag handles, don't start box selection
    if ((e.target as HTMLElement).closest('button, [draggable="true"]')) return;
    if (e.button !== 0 || !gridContainerRef.current) return;

    const rect = gridContainerRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left + gridContainerRef.current.scrollLeft;
    const startY = e.clientY - rect.top + gridContainerRef.current.scrollTop;

    isSelectingRef.current = true;
    const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
    isMultiSelectModeRef.current = isMulti;
    startPosRef.current = { x: startX, y: startY };

    // Pre-cache DOM elements and their coordinates ONCE on mouse down
    const elements = gridContainerRef.current.querySelectorAll('[data-page-id]');
    cachedBoundsRef.current = Array.from(elements).map((el) => {
      const htmlEl = el as HTMLElement;
      return {
        id: el.getAttribute('data-page-id')!,
        el: htmlEl,
        left: htmlEl.offsetLeft,
        top: htmlEl.offsetTop,
        right: htmlEl.offsetLeft + htmlEl.offsetWidth,
        bottom: htmlEl.offsetTop + htmlEl.offsetHeight,
      };
    });

    currentSelectedSetRef.current = new Set(
      isMulti ? currentDocument.selectedPageIds : []
    );

    if (!isMulti) {
      clearPageSelection();
    }

    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.display = 'block';
      selectionBoxRef.current.style.left = `${startX}px`;
      selectionBoxRef.current.style.top = `${startY}px`;
      selectionBoxRef.current.style.width = '0px';
      selectionBoxRef.current.style.height = '0px';
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelectingRef.current || !gridContainerRef.current) return;

    const rect = gridContainerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left + gridContainerRef.current.scrollLeft;
    const currentY = e.clientY - rect.top + gridContainerRef.current.scrollTop;

    const startX = startPosRef.current.x;
    const startY = startPosRef.current.y;

    const boxLeft = Math.min(startX, currentX);
    const boxRight = Math.max(startX, currentX);
    const boxTop = Math.min(startY, currentY);
    const boxBottom = Math.max(startY, currentY);

    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.left = `${boxLeft}px`;
      selectionBoxRef.current.style.top = `${boxTop}px`;
      selectionBoxRef.current.style.width = `${boxRight - boxLeft}px`;
      selectionBoxRef.current.style.height = `${boxBottom - boxTop}px`;
    }

    // Pure math hit-testing over cached bounds (0 DOM queries)
    const bounds = cachedBoundsRef.current;
    const intersectingIds: string[] = [];

    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      const isInside =
        boxLeft < b.right &&
        boxRight > b.left &&
        boxTop < b.bottom &&
        boxBottom > b.top;

      if (isInside) {
        intersectingIds.push(b.id);
        b.el.classList.add('ring-2', 'ring-sky-500', 'scale-[0.98]');
      } else {
        b.el.classList.remove('ring-2', 'ring-sky-500', 'scale-[0.98]');
      }
    }

    currentSelectedSetRef.current = new Set(
      isMultiSelectModeRef.current
        ? [...currentDocument.selectedPageIds, ...intersectingIds]
        : intersectingIds
    );
  };

  const handleMouseUp = () => {
    if (isSelectingRef.current) {
      // Clear direct DOM highlights
      cachedBoundsRef.current.forEach((b) => {
        b.el.classList.remove('ring-2', 'ring-sky-500', 'scale-[0.98]');
      });

      // Commit final selection once
      const finalSelected = Array.from(currentSelectedSetRef.current);
      if (finalSelected.length > 0) {
        selectPages(finalSelected, false);
      }
    }

    isSelectingRef.current = false;
    isMultiSelectModeRef.current = false;
    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.display = 'none';
    }
  };

  const handlePageClick = (
    pageId: string,
    idx: number,
    isMulti: boolean,
    isShift: boolean
  ) => {
    if (!currentDocument) return;
    if (isShift && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, idx);
      const end = Math.max(lastClickedIndexRef.current, idx);
      const rangeIds = currentDocument.pages.slice(start, end + 1).map((p) => p.id);
      const combined = new Set(currentDocument.selectedPageIds);
      rangeIds.forEach((id) => combined.add(id));
      selectPages(Array.from(combined), false);
    } else if (isMulti) {
      selectPages([pageId], true);
      lastClickedIndexRef.current = idx;
    } else {
      setActivePageIndex(idx);
      lastClickedIndexRef.current = idx;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 flex flex-col animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between text-slate-800 dark:text-slate-100 select-none shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
            <LayoutGrid className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Sayfa Yöneticisi & Düzenleyici</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Toplam {currentDocument.totalPages} sayfa • {selectedCount} sayfa seçili (Alan çizerek toplu seçebilir veya sürükleyebilirsiniz)
            </p>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
          {/* Select all toggle */}
          <button
            onClick={isAllSelected ? clearPageSelection : selectAllPages}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
          >
            {isAllSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            {isAllSelected ? 'Seçimi Kaldır' : 'Tümünü Seç'}
          </button>

          {/* Extract and Open as New PDF / Tab */}
          <button
            onClick={handleExtractAndOpenNewPdf}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/70 hover:bg-sky-200 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-600/80 text-sky-700 dark:text-sky-300 hover:text-sky-900 dark:hover:text-white disabled:opacity-40 text-xs font-semibold transition-colors shadow-sm"
            title="Seçili sayfaları ayıklayıp doğrudan yeni bir PDF sekmesi olarak aç"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span>Yeni PDF Aç</span>
          </button>

          {/* Extract / Ayıkla & İndir button */}
          <button
            onClick={handleExtractAndDownload}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700/80 text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white disabled:opacity-40 text-xs font-medium transition-colors shadow-sm"
            title="Seçili sayfaları ayıklayıp ayrı bir PDF olarak indir"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Ayıkla & İndir</span>
          </button>

          {/* Rotate actions */}
          <button
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, -90));
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            Sola (-90°)
          </button>
          <button
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, 90));
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            Sağa (+90°)
          </button>

          {/* Duplicate */}
          <button
            onClick={handleDuplicate}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
            title="Seçili Sayfaları Çoğalt"
          >
            <Copy className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            Çoğalt
          </button>

          {/* Synthesize N-up button */}
          <button
            onClick={() => {
              setPageManagerOpen(false);
              setPageLayoutModalOpen(true);
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 hover:bg-purple-200 dark:hover:bg-purple-900 border border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-white disabled:opacity-40 text-xs font-medium transition-colors"
            title="Seçili sayfaları tek bir A4/A3 sayfada birleştir"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            Tek Sayfada Birleştir
          </button>

          {/* Delete selected */}
          <button
            onClick={handleDeleteSelected}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/50 hover:bg-rose-200 dark:hover:bg-rose-900/80 border border-rose-300 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 disabled:opacity-40 text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Sil
          </button>

          {/* Close button */}
          <button
            onClick={() => setPageManagerOpen(false)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200 dark:border-slate-700 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Grid of Pages with High Performance Marquee Selection */}
      <div
        ref={gridContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!currentDocument || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          const files = Array.from(e.dataTransfer.files).filter(
            (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
          );
          if (files.length === 0) return;
          try {
            addToast('Harici PDF sayfaları dökümana ekleniyor...', 'info');
            let currentDoc = currentDocument;
            let currentInsertIndex = currentDoc.pages.length;
            let totalAdded = 0;
            for (const file of files) {
              const buffer = await file.arrayBuffer();
              const srcDoc = await PDFDocument.load(buffer);
              const count = srcDoc.getPageCount();
              const indices = Array.from({ length: count }, (_, i) => i);
              const result = await PdfAssembler.insertPagesIntoDocument(
                currentDoc,
                buffer,
                indices,
                currentInsertIndex
              );
              currentDoc = result.model;
              currentInsertIndex += indices.length;
              totalAdded += indices.length;
              setDocument(result.model, result.pdfDoc);
            }
            addToast(`${totalAdded} sayfa döküman sonuna başarıyla eklendi!`, 'success');
          } catch (err: any) {
            console.error(err);
            addToast('PDF eklenirken hata oluştu.', 'error');
          }
        }}
        className="relative flex-1 overflow-y-auto p-8 select-none bg-slate-100/80 dark:bg-slate-950/60"
      >
        {/* Direct DOM Marquee Rectangle */}
        <div
          ref={selectionBoxRef}
          style={{ display: 'none' }}
          className="absolute z-30 border-2 border-sky-500 bg-sky-500/20 rounded-md pointer-events-none transition-none"
        />

        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {currentDocument.pages.map((page, index) => (
            <div key={page.id} data-page-id={page.id}>
              <ThumbnailItem
                page={page}
                index={index}
                isActive={currentDocument.activePageIndex === index}
                isSelected={currentDocument.selectedPageIds.includes(page.id)}
                onPageClick={handlePageClick}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
