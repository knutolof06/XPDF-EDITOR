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
  Scissors,
  ChevronDown,
  FileUp,
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
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const preparedMultiDragPathRef = useRef<string | null>(null);

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
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

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
  const {
    setPageLayoutModalOpen,
    addToast,
    setInsertBlankPageModalOpen,
    setExtractPagesModalOpen,
  } = useUIStore();
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

  // Keyboard shortcut listener for Ctrl+Z, Ctrl+Y, Delete, Ctrl+A and Escape
  useEffect(() => {
    if (!isPageManagerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllPages();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (currentDocument && currentDocument.selectedPageIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (isAddMenuOpen) {
          setIsAddMenuOpen(false);
        } else if (contextMenu) {
          setContextMenu(null);
        } else {
          setPageManagerOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPageManagerOpen, contextMenu, isAddMenuOpen, currentDocument, addToast, selectAllPages, setPageManagerOpen]);

  // Dismiss context menu & dropdown on window click
  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenu) setContextMenu(null);
      if (isAddMenuOpen) setIsAddMenuOpen(false);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [contextMenu, isAddMenuOpen]);

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

  // Proactive Multi-Page Drag Pre-bundling
  const prepareMultiPagePdf = useCallback(async () => {
    if (!currentDocument || currentDocument.selectedPageIds.length === 0) {
      preparedMultiDragPathRef.current = null;
      return;
    }
    const electron = (window as any).electronAPI;
    if (!electron?.prepareDragFile) return;

    try {
      const res = await PdfAssembler.extractPages(
        currentDocument,
        currentDocument.selectedPageIds,
        { separateFiles: false }
      );
      if (res.mode === 'single') {
        const prepRes = await electron.prepareDragFile({
          fileName: res.name,
          buffer: res.buffer,
        });
        if (prepRes?.success && prepRes.filePath) {
          preparedMultiDragPathRef.current = prepRes.filePath;
        }
      }
    } catch {
      // silent fallback
    }
  }, [currentDocument]);

  // Debounced auto-preparation whenever selectedPageIds changes
  useEffect(() => {
    if (!isPageManagerOpen || !currentDocument || currentDocument.selectedPageIds.length === 0) {
      preparedMultiDragPathRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      prepareMultiPagePdf();
    }, 150);
    return () => clearTimeout(timer);
  }, [isPageManagerOpen, currentDocument?.selectedPageIds, prepareMultiPagePdf]);

  const handleMultiPageDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!currentDocument || currentDocument.selectedPageIds.length === 0) return;
      document.body.classList.add('is-dragging-page');

      const pageIds = currentDocument.selectedPageIds;
      (window as any).__xpdf_internal_drag = {
        pageIds,
        sourceDocId: currentDocument.id,
        filePath: preparedMultiDragPathRef.current,
      };

      e.dataTransfer.setData('application/json', JSON.stringify({ pageIds }));
      e.dataTransfer.setData('text/plain', pageIds.join(','));
      e.dataTransfer.effectAllowed = 'copyMove';

      // Start native Windows OLE drag to Desktop / Explorer
      if (preparedMultiDragPathRef.current && (window as any).electronAPI?.startDragFile) {
        (window as any).electronAPI.startDragFile({
          filePath: preparedMultiDragPathRef.current,
        });
      }

      // Drag ghost preview pill
      try {
        const ghost = document.createElement('div');
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.left = '-1000px';
        ghost.style.padding = '8px 16px';
        ghost.style.borderRadius = '14px';
        ghost.style.background = '#0284c7';
        ghost.style.color = '#ffffff';
        ghost.style.fontWeight = '700';
        ghost.style.fontSize = '12px';
        ghost.style.boxShadow = '0 12px 28px rgba(2, 132, 199, 0.45)';
        ghost.style.border = '2px solid rgba(255, 255, 255, 0.7)';
        ghost.style.display = 'flex';
        ghost.style.alignItems = 'center';
        ghost.style.gap = '8px';
        ghost.style.zIndex = '9999';
        ghost.innerHTML = `<span>📦</span> <span>${pageIds.length} Sayfa Taşınıyor (Masaüstüne Bırakın)</span>`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => ghost.remove(), 100);
      } catch {}
    },
    [currentDocument]
  );

  const handleMultiPageDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-page');
    (window as any).__xpdf_internal_drag = null;
  }, []);

  if (!isPageManagerOpen || !currentDocument) return null;

  const selectedCount = currentDocument.selectedPageIds.length;
  const isAllSelected = selectedCount === currentDocument.pages.length;

  const handleExportSelectedToDesktop = useCallback(async () => {
    if (!currentDocument || currentDocument.selectedPageIds.length === 0) return;
    try {
      addToast('Seçili sayfalar dışa aktarılıyor...', 'info');
      const res = await PdfAssembler.extractPages(
        currentDocument,
        currentDocument.selectedPageIds,
        { separateFiles: false }
      );
      if (res.mode === 'single') {
        const electron = (window as any).electronAPI;
        let saved = false;
        if (electron?.showSaveDialog && electron?.saveFile) {
          const dialogRes = await electron.showSaveDialog({
            title: 'Seçili Sayfaları PDF Olarak Kaydet',
            defaultPath: res.name,
            filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          });
          if (!dialogRes.canceled && dialogRes.filePath) {
            await electron.saveFile(dialogRes.filePath, res.buffer);
            saved = true;
            addToast(`PDF başarıyla kaydedildi: ${res.name}`, 'success');
          }
        }
        if (!saved && (!electron || !electron.showSaveDialog)) {
          const blob = new Blob([res.buffer], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = res.name;
          a.click();
          URL.revokeObjectURL(url);
          addToast(`PDF indirildi: ${res.name}`, 'success');
        }
      }
    } catch (err: any) {
      console.error('Export error:', err);
      addToast('Dışa aktarma sırasında hata oluştu.', 'error');
    }
  }, [currentDocument, addToast]);

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
    if (selectedCount >= currentDocument.pages.length) {
      addToast('Dökümandaki tüm sayfalar silinemez. En az bir sayfa kalmalıdır.', 'error');
      return;
    }

    const deleted = currentDocument.pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter((item) => currentDocument.selectedPageIds.includes(item.page.id));

    historyManager.execute(new DeletePageCommand(deleted));
    addToast(`${deleted.length} sayfa silindi. (Geri almak için Ctrl+Z)`, 'info');
  };

  // Extract Pages and Open directly as New PDF / Tab in editor
  const handleExtractAndOpenNewPdf = async () => {
    if (selectedCount === 0) {
      addToast('Lütfen açmak istediğiniz sayfaları seçin.', 'warning');
      return;
    }

    try {
      addToast('Seçili sayfalar yeni PDF olarak açılıyor...', 'info');
      const res = await PdfAssembler.extractPages(currentDocument, currentDocument.selectedPageIds, {
        separateFiles: false,
      });

      if (res.mode === 'single') {
        const loaded = await PdfLoader.loadDocument(res.name, res.buffer);
        setDocument(loaded.model, loaded.pdfDoc);
        addTab(loaded.model, loaded.pdfDoc);
        setPageManagerOpen(false);
        addToast(`${selectedCount} sayfa yeni sekmede açıldı!`, 'success');
      }
    } catch (err: any) {
      console.error(err);
      addToast('Yeni PDF açılırken hata oluştu.', 'error');
    }
  };

  // Add pages from external PDF or image files directly
  const handleAddPagesFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !currentDocument) return;
    try {
      addToast('Dosyalar dökümana ekleniyor...', 'info');
      const processed = await PdfAssembler.processDroppedFiles(Array.from(files));
      if (processed.length === 0) {
        addToast('Desteklenen dosya bulunamadı (PDF, PNG, JPEG, WEBP).', 'error');
        return;
      }
      let currentDoc = currentDocument;
      let currentInsertIndex = currentDoc.pages.length;
      let totalAdded = 0;

      for (const item of processed) {
        const indices = Array.from({ length: item.pageCount }, (_, idx) => idx);
        const result = await PdfAssembler.insertPagesIntoDocument(
          currentDoc,
          item.buffer,
          indices,
          currentInsertIndex
        );
        currentDoc = result.model;
        currentInsertIndex += indices.length;
        totalAdded += indices.length;
        setDocument(result.model, result.pdfDoc);
      }
      addToast(`${totalAdded} sayfa başarıyla eklendi!`, 'success');
    } catch (err: any) {
      console.error(err);
      addToast('Dosyalar eklenirken hata oluştu.', 'error');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  // Ultra-Fast Zero-Allocation Marquee Selection Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
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
      cachedBoundsRef.current.forEach((b) => {
        b.el.classList.remove('ring-2', 'ring-sky-500', 'scale-[0.98]');
      });

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
      selectPages([pageId], false);
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
      {/* Hidden File Input for "Dosyadan Sayfa Ekle" */}
      <input
        type="file"
        ref={addFileInputRef}
        onChange={handleAddPagesFromFile}
        accept=".pdf,image/png,image/jpeg,image/webp,image/bmp"
        multiple
        className="hidden"
      />

      {/* Top Header - Fluent 3-Part Toolbar */}
      <div className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between text-slate-800 dark:text-slate-100 select-none shadow-sm z-30">
        {/* Left Section: Info & Add Pages */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  Sayfa Düzenleyici
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {currentDocument.pages.length} sayfa
                </span>
                {selectedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-[11px] font-bold text-sky-700 dark:text-sky-300">
                    {selectedCount} seçili
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[200px] sm:max-w-xs">
                {currentDocument.name}
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:border-slate-800" />

          {/* Add Page Dropdown Menu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsAddMenuOpen((prev) => !prev);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold transition-all shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Sayfa Ekle</span>
              <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
            </button>

            {isAddMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 w-52 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    const selectedIdx =
                      selectedCount > 0
                        ? currentDocument.pages.findIndex(
                            (p) => p.id === currentDocument.selectedPageIds[0]
                          ) + 1
                        : currentDocument.pages.length;
                    setInsertBlankPageModalOpen(true, selectedIdx);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-600 transition-colors"
                >
                  <Plus className="w-4 h-4 text-emerald-500" />
                  <span>Boş Sayfa Ekle</span>
                </button>

                <button
                  onClick={() => {
                    setIsAddMenuOpen(false);
                    addFileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:text-sky-600 transition-colors"
                >
                  <FileUp className="w-4 h-4 text-sky-500" />
                  <span>PDF Dosyasından Ekle...</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center Section: Core Page Editing Actions */}
        <div className="flex items-center gap-1.5">
          {/* Rotate Left */}
          <button
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, -90));
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları 90° Sola Döndür"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span>Sola</span>
          </button>

          {/* Rotate Right */}
          <button
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, 90));
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları 90° Sağa Döndür"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span>Sağa</span>
          </button>

          {/* Extract Button */}
          <button
            onClick={() => setExtractPagesModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition-all shadow-sm shadow-sky-500/20 active:scale-95"
            title="Sayfaları Ayıkla (Yeni PDF, Ayrı Sayfalar veya ZIP)"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Ayıkla...</span>
          </button>

          {/* Duplicate Button */}
          <button
            onClick={handleDuplicate}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları Çoğalt"
          >
            <Copy className="w-3.5 h-3.5 text-amber-500" />
            <span>Çoğalt</span>
          </button>

          {/* Synthesize N-up button */}
          <button
            onClick={() => {
              setPageManagerOpen(false);
              setPageLayoutModalOpen(true);
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili sayfaları tek bir A4/A3 sayfada birleştir"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>Birleştir</span>
          </button>

          {/* Delete selected */}
          <button
            onClick={handleDeleteSelected}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 disabled:opacity-35 text-xs font-medium transition-colors"
            title="Seçili Sayfaları Sil (Delete/Backspace)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sil</span>
          </button>
        </div>

        {/* Right Section: View, Undo/Redo & Close */}
        <div className="flex items-center gap-3">
          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (historyManager.undo()) addToast('İşlem geri alındı.', 'info');
              }}
              disabled={!historyManager.canUndo()}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
              title="Geri Al (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (historyManager.redo()) addToast('İşlem yinelendi.', 'info');
              }}
              disabled={!historyManager.canRedo()}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
              title="Yinele (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:border-slate-800" />

          {/* Grid Size Switcher */}
          <div className="flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setThumbnailSize('small')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all',
                thumbnailSize === 'small'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Küçük Boyut"
            >
              Küçük
            </button>
            <button
              onClick={() => setThumbnailSize('medium')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all',
                thumbnailSize === 'medium'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Orta Boyut"
            >
              Orta
            </button>
            <button
              onClick={() => setThumbnailSize('large')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all',
                thumbnailSize === 'large'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              )}
              title="Büyük Boyut"
            >
              Büyük
            </button>
          </div>

          {/* Select all toggle */}
          <button
            onClick={isAllSelected ? clearPageSelection : selectAllPages}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title={isAllSelected ? 'Tüm seçimleri temizle' : 'Tüm sayfaları seç (Ctrl+A)'}
          >
            {isAllSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            <span>{isAllSelected ? 'Temizle' : 'Tümünü Seç'}</span>
          </button>

          {/* Close button */}
          <button
            onClick={() => setPageManagerOpen(false)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Kapat (ESC)"
          >
            <X className="w-4 h-4" />
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

          // If internal reorder drag was triggered, do NOT treat as external file insertion!
          if ((window as any).__xpdf_internal_drag) {
            (window as any).__xpdf_internal_drag = null;
            return;
          }

          if (!currentDocument || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          const droppedFiles = Array.from(e.dataTransfer.files);
          try {
            addToast('Harici dosya(lar) dökümana ekleniyor...', 'info');
            const processed = await PdfAssembler.processDroppedFiles(droppedFiles);
            if (processed.length === 0) {
              addToast('Desteklenen dosya bulunamadı (PDF, PNG, JPEG, WEBP).', 'error');
              return;
            }

            let currentDoc = currentDocument;
            let currentInsertIndex = currentDoc.pages.length;
            let totalAdded = 0;
            for (const item of processed) {
              const indices = Array.from({ length: item.pageCount }, (_, idx) => idx);
              const result = await PdfAssembler.insertPagesIntoDocument(
                currentDoc,
                item.buffer,
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
            console.error('Drop error:', err);
            addToast('Dosyalar eklenirken hata oluştu.', 'error');
          }
        }}
        className="relative flex-1 overflow-y-auto p-8 select-none bg-slate-100/80 dark:bg-slate-950/60 pb-24"
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
                isActive={false}
                isSelected={currentDocument.selectedPageIds.includes(page.id)}
                thumbnailSize={thumbnailSize}
                onPageClick={handlePageClick}
                onContextMenu={handleContextMenu}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Floating Action Dock (High-Contrast, Readable & Professional Dock) */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-950 border-2 border-slate-700 text-white shadow-[0_12px_45px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-bottom-5 duration-200 select-none">
          {/* Selected Count Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-500/20 border border-sky-400/40 text-xs font-bold text-sky-300">
            <CheckSquare className="w-4 h-4 text-sky-400" />
            <span>{selectedCount} sayfa seçildi</span>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          {/* Draggable + Clickable Badge for Desktop Drag or Direct Export */}
          <button
            type="button"
            draggable
            onMouseEnter={prepareMultiPagePdf}
            onMouseDown={prepareMultiPagePdf}
            onDragStart={handleMultiPageDragStart}
            onDragEnd={handleMultiPageDragEnd}
            onClick={handleExportSelectedToDesktop}
            title="Masaüstüne veya bir klasöre sürükleyin ya da doğrudan kaydetmek için tıklayın"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold text-xs cursor-grab active:cursor-grabbing transition-all shadow-md shadow-sky-600/40 border border-sky-400/50 hover:scale-105 active:scale-95"
          >
            <Download className="w-4 h-4 text-white" />
            <span>Masaüstüne Sürükleyin / Kaydet ↗</span>
          </button>

          <div className="h-5 w-px bg-slate-700" />

          {/* Quick Action: Extract */}
          <button
            onClick={() => setExtractPagesModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="Seçili Sayfaları Ayıkla"
          >
            <Scissors className="w-4 h-4 text-sky-400" />
            <span>Ayıkla</span>
          </button>

          {/* Quick Action: Rotate */}
          <button
            onClick={() => historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, 90))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="90° Sağa Döndür"
          >
            <RotateCw className="w-4 h-4 text-sky-400" />
            <span>Döndür</span>
          </button>

          {/* Quick Action: Duplicate */}
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="Seçili Sayfaları Çoğalt"
          >
            <Copy className="w-4 h-4 text-amber-400" />
            <span>Çoğalt</span>
          </button>

          {/* Quick Action: Delete */}
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-xs font-semibold text-rose-300 hover:text-rose-100 transition-colors border border-rose-800/80"
            title="Seçili Sayfaları Sil"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Sil</span>
          </button>

          <div className="h-5 w-px bg-slate-700" />

          {/* Clear Selection */}
          <button
            onClick={clearPageSelection}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-700"
            title="Seçimi Temizle"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
              setExtractPagesModalOpen(true);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Scissors className="w-3.5 h-3.5 text-sky-500" />
            <span>Sayfaları Ayıkla...</span>
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
