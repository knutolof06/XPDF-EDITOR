import React, { useRef, useState, useEffect, useReducer, useCallback } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { ThumbnailItem } from '../viewer/ThumbnailItem';
import {
  historyManager,
  RotatePageCommand,
  DeletePageCommand,
  DocumentStateSnapshotCommand,
} from '@/core/history/command-manager';
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
  Undo2,
  Redo2,
  Plus,
} from 'lucide-react';
import { cn } from '@/utils/cn';

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
  const rafIdRef = useRef<number | null>(null);
  const pendingMousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);

  const [thumbnailSize, setThumbnailSize] = useState<'small' | 'medium' | 'large'>('medium');

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
  const { setPageLayoutModalOpen, addToast, setInsertBlankPageModalOpen } = useUIStore();
  const pdfDocProxy = useDocumentStore((s) => s.pdfDocProxy);

  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    pageId: string;
    pageIndex: number;
  } | null>(null);

  // Subscribe to historyManager mutations to force re-render
  useEffect(() => {
    return historyManager.subscribe(() => forceUpdate());
  }, []);

  // Keyboard shortcut listener for Ctrl+Z and Ctrl+Y in Page Manager
  useEffect(() => {
    if (!isPageManagerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyManager.canUndo()) {
          historyManager.undo();
          addToast('İşlem geri alındı.', 'info');
        }
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        if (historyManager.canRedo()) {
          historyManager.redo();
          addToast('İşlem yinelendi.', 'info');
        }
      } else if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else {
          setPageManagerOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPageManagerOpen, contextMenu, addToast, setPageManagerOpen]);

  // Dismiss context menu on window click
  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  // Proximity auto-scrolling during drag
  const startAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current) return;
    const step = () => {
      if (autoScrollSpeedRef.current !== 0 && gridContainerRef.current) {
        gridContainerRef.current.scrollTop += autoScrollSpeedRef.current;
      }
      autoScrollRafRef.current = requestAnimationFrame(step);
    };
    autoScrollRafRef.current = requestAnimationFrame(step);
  }, []);

  const stopAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollSpeedRef.current = 0;
  }, []);

  useEffect(() => {
    const handleDragEndGlobal = () => stopAutoScrollLoop();
    window.addEventListener('dragend', handleDragEndGlobal);
    window.addEventListener('mouseup', handleDragEndGlobal);
    return () => {
      window.removeEventListener('dragend', handleDragEndGlobal);
      window.removeEventListener('mouseup', handleDragEndGlobal);
      stopAutoScrollLoop();
    };
  }, [stopAutoScrollLoop]);

  if (!isPageManagerOpen || !currentDocument) return null;

  const selectedCount = currentDocument.selectedPageIds.length;
  const isAllSelected = selectedCount === currentDocument.pages.length;

  const handleDuplicate = async () => {
    if (selectedCount === 0) return;
    try {
      addToast('Sayfalar çoğaltılıyor...', 'info');
      const prevDocModel = currentDocument;
      const prevPdfProxy = pdfDocProxy;

      const result = await PdfAssembler.duplicatePages(
        currentDocument,
        currentDocument.selectedPageIds
      );

      historyManager.push(
        new DocumentStateSnapshotCommand(
          `${selectedCount} sayfa çoğaltıldı`,
          prevDocModel,
          prevPdfProxy,
          result.model,
          result.pdfDoc
        )
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
    pendingMousePosRef.current = { clientX: e.clientX, clientY: e.clientY };

    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (!isSelectingRef.current || !gridContainerRef.current || !pendingMousePosRef.current) return;

        const { clientX, clientY } = pendingMousePosRef.current;
        const rect = gridContainerRef.current.getBoundingClientRect();
        const currentX = clientX - rect.left + gridContainerRef.current.scrollLeft;
        const currentY = clientY - rect.top + gridContainerRef.current.scrollTop;

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

        // Pure math hit-testing over cached bounds with guarded DOM mutations
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
            if (!b.el.classList.contains('ring-2')) {
              b.el.classList.add('ring-2', 'ring-sky-500', 'scale-[0.98]');
            }
          } else {
            if (b.el.classList.contains('ring-2')) {
              b.el.classList.remove('ring-2', 'ring-sky-500', 'scale-[0.98]');
            }
          }
        }

        currentSelectedSetRef.current = new Set(
          isMultiSelectModeRef.current
            ? [...currentDocument.selectedPageIds, ...intersectingIds]
            : intersectingIds
        );
      });
    }
  };

  const handleMouseUp = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

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

  const handleContextMenu = (e: React.MouseEvent, pageId: string, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentDocument.selectedPageIds.includes(pageId)) {
      selectPages([pageId], false);
    }
    setContextMenu({
      x: Math.min(window.innerWidth - 230, Math.max(10, e.clientX)),
      y: Math.min(window.innerHeight - 320, Math.max(10, e.clientY)),
      pageId,
      pageIndex: idx,
    });
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
          {/* Undo / Redo */}
          <div className="flex items-center gap-1 border-r border-slate-200 dark:border-slate-800 pr-2 mr-1">
            <button
              onClick={() => {
                if (historyManager.undo()) {
                  addToast('İşlem geri alındı.', 'info');
                }
              }}
              disabled={!historyManager.canUndo()}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
              title="Son İşlemi Geri Al (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (historyManager.redo()) {
                  addToast('Son işlem yinelendi.', 'info');
                }
              }}
              disabled={!historyManager.canRedo()}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
              title="Son İşlemi Yinele (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Insert Blank Page button */}
          <button
            onClick={() => {
              const selectedIdx = currentDocument.selectedPageIds.length > 0
                ? currentDocument.pages.findIndex((p) => p.id === currentDocument.selectedPageIds[0]) + 1
                : currentDocument.pages.length;
              setInsertBlankPageModalOpen(true, selectedIdx);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 hover:bg-emerald-200 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700/80 text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white text-xs font-semibold transition-colors shadow-xs"
            title="Dökümana yeni bir boş sayfa ekle"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Boş Sayfa</span>
          </button>

          {/* Zoom / Grid Size Toggle */}
          <div className="flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setThumbnailSize('small')}
              className={cn(
                'px-2 py-1 rounded-md text-[11px] font-semibold transition-all',
                thumbnailSize === 'small'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Kompakt Görünüm (Daha Fazla Sayfa)"
            >
              Küçük
            </button>
            <button
              onClick={() => setThumbnailSize('medium')}
              className={cn(
                'px-2 py-1 rounded-md text-[11px] font-semibold transition-all',
                thumbnailSize === 'medium'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Standart Görünüm"
            >
              Orta
            </button>
            <button
              onClick={() => setThumbnailSize('large')}
              className={cn(
                'px-2 py-1 rounded-md text-[11px] font-semibold transition-all',
                thumbnailSize === 'large'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Büyük Görünüm (Detaylı Önizleme)"
            >
              Büyük
            </button>
          </div>

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
        onWheel={(e) => {
          if (gridContainerRef.current) {
            gridContainerRef.current.scrollTop += e.deltaY;
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';

          if (gridContainerRef.current) {
            const rect = gridContainerRef.current.getBoundingClientRect();
            const topThreshold = rect.top + 90;
            const bottomThreshold = rect.bottom - 90;

            if (e.clientY < topThreshold) {
              const ratio = Math.min(1, Math.max(0.1, (topThreshold - e.clientY) / 90));
              autoScrollSpeedRef.current = -Math.round(ratio * 24);
              startAutoScrollLoop();
            } else if (e.clientY > bottomThreshold) {
              const ratio = Math.min(1, Math.max(0.1, (e.clientY - bottomThreshold) / 90));
              autoScrollSpeedRef.current = Math.round(ratio * 24);
              startAutoScrollLoop();
            } else {
              autoScrollSpeedRef.current = 0;
            }
          }
        }}
        onDragLeave={(e) => {
          if (!gridContainerRef.current?.contains(e.relatedTarget as Node)) {
            stopAutoScrollLoop();
          }
        }}
        onDrop={async (e) => {
          stopAutoScrollLoop();
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

        <div
          className={cn(
            'max-w-7xl mx-auto grid gap-6 transition-all',
            thumbnailSize === 'small' && 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
            thumbnailSize === 'medium' && 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
            thumbnailSize === 'large' && 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
          )}
        >
          {currentDocument.pages.map((page, index) => (
            <div
              key={page.id}
              data-page-id={page.id}
              className="relative"
            >
              <ThumbnailItem
                page={page}
                index={index}
                isActive={currentDocument.activePageIndex === index}
                isSelected={currentDocument.selectedPageIds.includes(page.id)}
                onPageClick={handlePageClick}
                onContextMenu={handleContextMenu}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-60 rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-2xl p-1.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 text-xs select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800 mb-1">
            Sayfa {contextMenu.pageIndex + 1} İşlemleri
          </div>

          <button
            onClick={() => {
              historyManager.execute(new RotatePageCommand([contextMenu.pageId], 90));
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:text-sky-600 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500" />
            <span>90° Sağa Döndür</span>
          </button>

          <button
            onClick={() => {
              historyManager.execute(new RotatePageCommand([contextMenu.pageId], -90));
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:text-sky-600 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500" />
            <span>90° Sola Döndür</span>
          </button>

          <button
            onClick={() => {
              const insertIdx = contextMenu.pageIndex + 1;
              setInsertBlankPageModalOpen(true, insertIdx);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            <span>Sonrasına Boş Sayfa Ekle</span>
          </button>

          <button
            onClick={() => {
              handleDuplicate();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/60 hover:text-amber-600 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-amber-500" />
            <span>Sayfayı Çoğalt</span>
          </button>

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

          <button
            onClick={() => {
              handleExtractAndDownload();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-emerald-500" />
            <span>Yeni PDF Olarak Ayıkla</span>
          </button>

          <button
            onClick={() => {
              handleExtractAndOpenNewPdf();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-500" />
            <span>Yeni Sekmede Aç</span>
          </button>

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

          <button
            onClick={() => {
              handleDeleteSelected();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sayfayı Sil</span>
          </button>
        </div>
      )}
    </div>
  );
};
