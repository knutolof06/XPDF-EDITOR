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
import {
  saveBinaryOrBlobFile,
  syncReplacedActiveDocument,
} from '@/components/dialogs/modal-utils';

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
  const preparedSignatureRef = useRef<string>('');
  const isPreparingDragRef = useRef<boolean>(false);

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
  const marqueeListenersRef = useRef<{
    move: (ev: MouseEvent) => void;
    up: () => void;
  } | null>(null);

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

  useEffect(() => {
    return historyManager.subscribe(() => forceUpdate());
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    const selectedCount = doc.selectedPageIds.length;
    if (selectedCount === 0) return;
    if (selectedCount >= doc.pages.length) {
      addToast('Dökümandaki tüm sayfalar silinemez. En az bir sayfa kalmalıdır.', 'error');
      return;
    }

    const deleted = doc.pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter((item) => doc.selectedPageIds.includes(item.page.id));

    historyManager.execute(new DeletePageCommand(deleted));
    const updated = useDocumentStore.getState().currentDocument;
    if (updated) {
      useTabStore.getState().updateTabModel(updated);
    }
    addToast(`${deleted.length} sayfa silindi. (Geri almak için Ctrl+Z)`, 'info');
  }, [addToast]);

  // Capture-phase keyboard shortcut listener so Escape handles submenus cleanly and avoids closing behind child modals
  useEffect(() => {
    if (!isPageManagerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const uiState = useUIStore.getState();
      if (
        uiState.isExtractPagesModalOpen ||
        uiState.isInsertBlankPageModalOpen ||
        uiState.isPageLayoutModalOpen
      ) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isAddMenuOpen) {
          setIsAddMenuOpen(false);
        } else if (contextMenu) {
          setContextMenu(null);
        } else {
          setPageManagerOpen(false);
        }
        return;
      }

      if (inEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (historyManager.canUndo()) {
          historyManager.undo();
          const updated = useDocumentStore.getState().currentDocument;
          if (updated) useTabStore.getState().updateTabModel(updated);
          addToast('İşlem geri alındı.', 'info');
        }
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (historyManager.canRedo()) {
          historyManager.redo();
          const updated = useDocumentStore.getState().currentDocument;
          if (updated) useTabStore.getState().updateTabModel(updated);
          addToast('İşlem yinelendi.', 'info');
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        selectAllPages();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const doc = useDocumentStore.getState().currentDocument;
        if (doc && doc.selectedPageIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    isPageManagerOpen,
    contextMenu,
    isAddMenuOpen,
    addToast,
    selectAllPages,
    setPageManagerOpen,
    handleDeleteSelected,
  ]);

  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenu) setContextMenu(null);
      if (isAddMenuOpen) setIsAddMenuOpen(false);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [contextMenu, isAddMenuOpen]);

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

  const detachMarqueeListeners = useCallback(() => {
    if (marqueeListenersRef.current) {
      window.removeEventListener('mousemove', marqueeListenersRef.current.move);
      window.removeEventListener('mouseup', marqueeListenersRef.current.up);
      marqueeListenersRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleDragEndGlobal = () => stopAutoScrollLoop();
    window.addEventListener('dragend', handleDragEndGlobal);
    window.addEventListener('mouseup', handleDragEndGlobal);
    return () => {
      window.removeEventListener('dragend', handleDragEndGlobal);
      window.removeEventListener('mouseup', handleDragEndGlobal);
      stopAutoScrollLoop();
      detachMarqueeListeners();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [stopAutoScrollLoop, detachMarqueeListeners]);

  const computeDragSignature = useCallback(() => {
    if (!currentDocument || currentDocument.selectedPageIds.length === 0) return '';
    const rotMap = new Map(currentDocument.pages.map((p) => [p.id, p.rotation]));
    return (
      `${currentDocument.id}:${currentDocument.version}:` +
      currentDocument.selectedPageIds.map((id) => `${id}@${rotMap.get(id) ?? 0}`).join(',')
    );
  }, [currentDocument]);

  // Prepare multi-page drag file lazily and deduplicated by selection+rotation signature
  const prepareMultiPagePdf = useCallback(async () => {
    if (!currentDocument || currentDocument.selectedPageIds.length === 0) {
      preparedMultiDragPathRef.current = null;
      preparedSignatureRef.current = '';
      return;
    }
    const electron = window.electronAPI;
    if (!electron?.prepareDragFile) return;

    const sig = computeDragSignature();
    if (!sig || sig === preparedSignatureRef.current || isPreparingDragRef.current) {
      return;
    }

    isPreparingDragRef.current = true;
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
          preparedSignatureRef.current = sig;
        }
      }
    } catch {
      // silent fallback
    } finally {
      isPreparingDragRef.current = false;
    }
  }, [currentDocument, computeDragSignature]);

  // Reset cached drag path whenever selection changes, and only auto-prebundle small selections
  useEffect(() => {
    const sig = computeDragSignature();
    if (sig !== preparedSignatureRef.current) {
      preparedMultiDragPathRef.current = null;
      preparedSignatureRef.current = '';
    }
    if (
      !isPageManagerOpen ||
      !currentDocument ||
      currentDocument.selectedPageIds.length === 0 ||
      currentDocument.selectedPageIds.length > 20
    ) {
      return;
    }
    const timer = setTimeout(() => {
      prepareMultiPagePdf();
    }, 250);
    return () => clearTimeout(timer);
  }, [isPageManagerOpen, currentDocument, computeDragSignature, prepareMultiPagePdf]);

  const handleMultiPageDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!currentDocument || currentDocument.selectedPageIds.length === 0) return;
      document.body.classList.add('is-dragging-page');

      const pageIds = currentDocument.selectedPageIds;
      (window as unknown as Record<string, unknown>).__xpdf_internal_drag = {
        pageIds,
        sourceDocId: currentDocument.id,
        filePath: preparedMultiDragPathRef.current,
      };

      e.dataTransfer.setData('application/json', JSON.stringify({ pageIds }));
      e.dataTransfer.setData('text/plain', pageIds.join(','));
      e.dataTransfer.effectAllowed = 'copyMove';

      if (preparedMultiDragPathRef.current && window.electronAPI?.startDragFile) {
        window.electronAPI.startDragFile({
          filePath: preparedMultiDragPathRef.current,
        });
      }

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
        ghost.textContent = `${pageIds.length} Sayfa Taşınıyor (Masaüstüne Bırakın)`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => ghost.remove(), 100);
      } catch {
        // ignore drag image error
      }
    },
    [currentDocument]
  );

  const handleMultiPageDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-page');
    (window as unknown as Record<string, unknown>).__xpdf_internal_drag = null;
  }, []);

  if (!isPageManagerOpen || !currentDocument) return null;

  const selectedCount = currentDocument.selectedPageIds.length;
  const isAllSelected = selectedCount === currentDocument.pages.length;

  const handleExportSelectedToDesktop = async () => {
    if (!currentDocument || currentDocument.selectedPageIds.length === 0) return;
    try {
      addToast('Seçili sayfalar dışa aktarılıyor...', 'info');
      const res = await PdfAssembler.extractPages(
        currentDocument,
        currentDocument.selectedPageIds,
        { separateFiles: false }
      );
      if (res.mode === 'single') {
        const saveRes = await saveBinaryOrBlobFile({
          data: res.buffer,
          defaultName: res.name,
          dialogTitle: 'Seçili Sayfaları PDF Olarak Kaydet',
          filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          mimeType: 'application/pdf',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }
        addToast(`PDF başarıyla kaydedildi: ${res.name}`, 'success');
      }
    } catch (err: unknown) {
      console.error('Export error:', err);
      const msg = err instanceof Error ? err.message : 'Dışa aktarma sırasında hata oluştu.';
      addToast(msg, 'error');
    }
  };

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

      const syncedModel = syncReplacedActiveDocument(
        result.model,
        result.pdfDoc,
        prevDocModel,
        { isModified: true }
      );

      historyManager.push(
        new DocumentStateSnapshotCommand(
          `${selectedCount} sayfa çoğaltıldı`,
          prevDocModel,
          prevPdfProxy,
          syncedModel,
          result.pdfDoc
        )
      );

      addToast(`${selectedCount} sayfa başarıyla çoğaltıldı.`, 'success');
    } catch (err: unknown) {
      console.error(err);
      addToast('Çoğaltma sırasında hata oluştu.', 'error');
    }
  };

  const handleExtractAndOpenNewPdf = async () => {
    if (selectedCount === 0) {
      addToast('Lütfen açmak istediğiniz sayfaları seçin.', 'warning');
      return;
    }

    try {
      addToast('Seçili sayfalar yeni PDF olarak açılıyor...', 'info');
      const res = await PdfAssembler.extractPages(
        currentDocument,
        currentDocument.selectedPageIds,
        { separateFiles: false }
      );

      if (res.mode === 'single') {
        const loaded = await PdfLoader.loadDocument(res.name, res.buffer);
        setDocument(loaded.model, loaded.pdfDoc);
        addTab(loaded.model, loaded.pdfDoc);
        setPageManagerOpen(false);
        addToast(`${selectedCount} sayfa yeni sekmede açıldı!`, 'success');
      }
    } catch (err: unknown) {
      console.error(err);
      addToast('Yeni PDF açılırken hata oluştu.', 'error');
    }
  };

  const insertExternalFiles = async (files: File[], toastPrefix: string) => {
    if (!files.length || !currentDocument) return;
    try {
      addToast(toastPrefix, 'info');
      const processed = await PdfAssembler.processDroppedFiles(files);
      if (processed.length === 0) {
        addToast('Desteklenen dosya bulunamadı (PDF, PNG, JPEG, WEBP).', 'error');
        return;
      }

      const prevDocModel = currentDocument;
      const prevPdfProxy = pdfDocProxy;
      let workingDoc = currentDocument;
      let workingProxy: typeof pdfDocProxy = null;
      let currentInsertIndex = workingDoc.pages.length;
      let totalAdded = 0;

      for (const item of processed) {
        const indices = Array.from({ length: item.pageCount }, (_, idx) => idx);
        const result = await PdfAssembler.insertPagesIntoDocument(
          workingDoc,
          item.buffer,
          indices,
          currentInsertIndex
        );
        if (workingProxy && workingProxy !== prevPdfProxy) {
          try {
            await workingProxy.destroy();
          } catch {
            // ignore cleanup errors
          }
        }
        workingDoc = result.model;
        workingProxy = result.pdfDoc;
        currentInsertIndex += indices.length;
        totalAdded += indices.length;
      }

      if (workingProxy) {
        const finalModel = syncReplacedActiveDocument(
          workingDoc,
          workingProxy,
          prevDocModel,
          { isModified: true }
        );

        historyManager.push(
          new DocumentStateSnapshotCommand(
            `${totalAdded} harici sayfa eklendi`,
            prevDocModel,
            prevPdfProxy,
            finalModel,
            workingProxy
          )
        );

        addToast(`${totalAdded} sayfa dökümana başarıyla eklendi!`, 'success');
      }
    } catch (err: unknown) {
      console.error('External page insert error:', err);
      addToast('Dosyalar eklenirken hata oluştu.', 'error');
    }
  };

  const handleAddPagesFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    await insertExternalFiles(files, 'Dosyalar dökümana ekleniyor...');
  };

  const finalizeMarqueeSelection = () => {
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
    pendingMousePosRef.current = null;
    if (selectionBoxRef.current) {
      selectionBoxRef.current.style.display = 'none';
    }
    detachMarqueeListeners();
  };

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

    const initialSelection = isMulti ? [...currentDocument.selectedPageIds] : [];
    currentSelectedSetRef.current = new Set(initialSelection);

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

    const onWindowMouseMove = (me: MouseEvent) => {
      if (!isSelectingRef.current || !gridContainerRef.current) return;
      pendingMousePosRef.current = { clientX: me.clientX, clientY: me.clientY };

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (!isSelectingRef.current || !gridContainerRef.current || !pendingMousePosRef.current) {
            return;
          }

          const { clientX, clientY } = pendingMousePosRef.current;
          const containerRect = gridContainerRef.current.getBoundingClientRect();
          const currentX = clientX - containerRect.left + gridContainerRef.current.scrollLeft;
          const currentY = clientY - containerRect.top + gridContainerRef.current.scrollTop;

          const sX = startPosRef.current.x;
          const sY = startPosRef.current.y;

          const boxLeft = Math.min(sX, currentX);
          const boxRight = Math.max(sX, currentX);
          const boxTop = Math.min(sY, currentY);
          const boxBottom = Math.max(sY, currentY);

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
            } else if (b.el.classList.contains('ring-2')) {
              b.el.classList.remove('ring-2', 'ring-sky-500', 'scale-[0.98]');
            }
          }

          currentSelectedSetRef.current = new Set(
            isMultiSelectModeRef.current
              ? [...initialSelection, ...intersectingIds]
              : intersectingIds
          );
        });
      }
    };

    const onWindowMouseUp = () => {
      finalizeMarqueeSelection();
    };

    detachMarqueeListeners();
    marqueeListenersRef.current = { move: onWindowMouseMove, up: onWindowMouseUp };
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
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

  const isMultiContextSelection =
    contextMenu !== null &&
    selectedCount > 1 &&
    currentDocument.selectedPageIds.includes(contextMenu.pageId);
  const contextTargetIds =
    contextMenu === null
      ? []
      : isMultiContextSelection
        ? currentDocument.selectedPageIds
        : [contextMenu.pageId];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 flex flex-col animate-in fade-in duration-150">
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

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Add Page Dropdown Menu */}
          <div className="relative">
            <button
              type="button"
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
                  type="button"
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
                  type="button"
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
          <button
            type="button"
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, -90));
                const updated = useDocumentStore.getState().currentDocument;
                if (updated) useTabStore.getState().updateTabModel(updated);
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları 90° Sola Döndür"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span>Sola</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (selectedCount > 0) {
                historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, 90));
                const updated = useDocumentStore.getState().currentDocument;
                if (updated) useTabStore.getState().updateTabModel(updated);
              }
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları 90° Sağa Döndür"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span>Sağa</span>
          </button>

          <button
            type="button"
            onClick={() => setExtractPagesModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition-all shadow-sm shadow-sky-500/20 active:scale-95"
            title="Sayfaları Ayıkla (Yeni PDF, Ayrı Sayfalar veya ZIP)"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Ayıkla...</span>
          </button>

          <button
            type="button"
            onClick={handleDuplicate}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili Sayfaları Çoğalt"
          >
            <Copy className="w-3.5 h-3.5 text-amber-500" />
            <span>Çoğalt</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPageManagerOpen(false);
              setPageLayoutModalOpen(true);
            }}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-35 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Seçili sayfaları N-up ızgara düzeninde birleştir"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>Birleştir</span>
          </button>

          <button
            type="button"
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (historyManager.undo()) {
                  const updated = useDocumentStore.getState().currentDocument;
                  if (updated) useTabStore.getState().updateTabModel(updated);
                  addToast('İşlem geri alındı.', 'info');
                }
              }}
              disabled={!historyManager.canUndo()}
              aria-label="Geri Al"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
              title="Geri Al (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (historyManager.redo()) {
                  const updated = useDocumentStore.getState().currentDocument;
                  if (updated) useTabStore.getState().updateTabModel(updated);
                  addToast('İşlem yinelendi.', 'info');
                }
              }}
              disabled={!historyManager.canRedo()}
              aria-label="Yinele"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
              title="Yinele (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />

          <div className="flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              type="button"
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
              type="button"
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
              type="button"
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

          <button
            type="button"
            onClick={isAllSelected ? clearPageSelection : selectAllPages}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title={isAllSelected ? 'Tüm seçimleri temizle' : 'Tüm sayfaları seç (Ctrl+A)'}
          >
            {isAllSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            <span>{isAllSelected ? 'Temizle' : 'Tümünü Seç'}</span>
          </button>

          <button
            type="button"
            onClick={() => setPageManagerOpen(false)}
            aria-label="Kapat"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200/80 dark:border-slate-700/80"
            title="Kapat (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid of Pages with Native Scroll & Window-Bound Marquee Selection */}
      <div
        ref={gridContainerRef}
        onMouseDown={handleMouseDown}
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

          const win = window as unknown as Record<string, unknown>;
          if (win.__xpdf_internal_drag) {
            win.__xpdf_internal_drag = null;
            return;
          }

          if (!currentDocument || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          const droppedFiles = Array.from(e.dataTransfer.files);
          await insertExternalFiles(droppedFiles, 'Harici dosya(lar) dökümana ekleniyor...');
        }}
        className="relative flex-1 overflow-y-auto p-8 select-none bg-slate-100/80 dark:bg-slate-950/60 pb-24"
      >
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
            <div key={page.id} data-page-id={page.id} className="relative">
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

      {/* Floating Action Dock */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-950 border-2 border-slate-700 text-white shadow-[0_12px_45px_rgba(0,0,0,0.85)] animate-in fade-in slide-in-from-bottom-5 duration-200 select-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-500/20 border border-sky-400/40 text-xs font-bold text-sky-300">
            <CheckSquare className="w-4 h-4 text-sky-400" />
            <span>{selectedCount} sayfa seçildi</span>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          <button
            type="button"
            draggable
            onMouseDown={prepareMultiPagePdf}
            onDragStart={handleMultiPageDragStart}
            onDragEnd={handleMultiPageDragEnd}
            onClick={handleExportSelectedToDesktop}
            title="Masaüstüne veya bir klasöre sürükleyin ya da doğrudan kaydetmek için tıklayın"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold text-xs cursor-grab active:cursor-grabbing transition-all shadow-md shadow-sky-600/40 border border-sky-400/50 hover:scale-105 active:scale-95"
          >
            <Download className="w-4 h-4 text-white" />
            <span>Masaüstüne Sürükleyin / Kaydet</span>
          </button>

          <div className="h-5 w-px bg-slate-700" />

          <button
            type="button"
            onClick={() => setExtractPagesModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="Seçili Sayfaları Ayıkla"
          >
            <Scissors className="w-4 h-4 text-sky-400" />
            <span>Ayıkla</span>
          </button>

          <button
            type="button"
            onClick={() => {
              historyManager.execute(new RotatePageCommand(currentDocument.selectedPageIds, 90));
              const updated = useDocumentStore.getState().currentDocument;
              if (updated) useTabStore.getState().updateTabModel(updated);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="90° Sağa Döndür"
          >
            <RotateCw className="w-4 h-4 text-sky-400" />
            <span>Döndür</span>
          </button>

          <button
            type="button"
            onClick={handleDuplicate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors border border-slate-700"
            title="Seçili Sayfaları Çoğalt"
          >
            <Copy className="w-4 h-4 text-amber-400" />
            <span>Çoğalt</span>
          </button>

          <button
            type="button"
            onClick={handleDeleteSelected}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-xs font-semibold text-rose-300 hover:text-rose-100 transition-colors border border-rose-800/80"
            title="Seçili Sayfaları Sil"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Sil</span>
          </button>

          <div className="h-5 w-px bg-slate-700" />

          <button
            type="button"
            onClick={clearPageSelection}
            aria-label="Seçimi Temizle"
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
            {isMultiContextSelection
              ? `Seçili ${selectedCount} Sayfa İşlemleri`
              : `Sayfa ${contextMenu.pageIndex + 1} İşlemleri`}
          </div>

          <button
            type="button"
            onClick={() => {
              historyManager.execute(new RotatePageCommand(contextTargetIds, 90));
              const updated = useDocumentStore.getState().currentDocument;
              if (updated) useTabStore.getState().updateTabModel(updated);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:text-sky-600 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500" />
            <span>
              {isMultiContextSelection
                ? `${selectedCount} Sayfayı 90° Sağa Döndür`
                : '90° Sağa Döndür'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              historyManager.execute(new RotatePageCommand(contextTargetIds, -90));
              const updated = useDocumentStore.getState().currentDocument;
              if (updated) useTabStore.getState().updateTabModel(updated);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/60 hover:text-sky-600 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500" />
            <span>
              {isMultiContextSelection
                ? `${selectedCount} Sayfayı 90° Sola Döndür`
                : '90° Sola Döndür'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              const insertIdx = contextMenu.pageIndex + 1;
              setInsertBlankPageModalOpen(true, insertIdx);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            <span>Sayfa {contextMenu.pageIndex + 1} Sonrasına Boş Sayfa Ekle</span>
          </button>

          <button
            type="button"
            onClick={() => {
              handleDuplicate();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/60 hover:text-amber-600 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {isMultiContextSelection ? `${selectedCount} Sayfayı Çoğalt` : 'Sayfayı Çoğalt'}
            </span>
          </button>

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

          <button
            type="button"
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
            type="button"
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
            type="button"
            onClick={() => {
              handleDeleteSelected();
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {isMultiContextSelection ? `${selectedCount} Sayfayı Sil` : 'Sayfayı Sil'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
