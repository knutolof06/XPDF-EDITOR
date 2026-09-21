import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { thumbnailCache } from '@/core/cache/render-cache';
import { enqueueThumbnail } from '@/core/cache/thumbnail-queue';
import {
  historyManager,
  MoveMultiplePagesCommand,
  RotatePageCommand,
  DeletePageCommand,
} from '@/core/history/command-manager';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PDFDocument } from 'pdf-lib';
import { Trash2, RotateCw, GripVertical, Download } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ThumbnailItemProps {
  page: PdfPageModel;
  index?: number;
  isActive: boolean;
  isSelected: boolean;
  onPageClick: (pageId: string, index: number, isMulti: boolean, isShift: boolean) => void;
  onContextMenu?: (e: React.MouseEvent, pageId: string, index: number) => void;
}

export const ThumbnailItem: React.FC<ThumbnailItemProps> = React.memo(({
  page,
  index = 0,
  isActive,
  isSelected,
  onPageClick,
  onContextMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedKeyRef = useRef<string>('');
  const dropPositionRef = useRef<'before' | 'after' | null>(null);
  const preparedFilePathRef = useRef<string | null>(null);

  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(null);

  const pdfDocProxy = useDocumentStore((s) => s.pdfDocProxy);
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme) || 'fluent';

  // Viewport IntersectionObserver: Only render thumbnails visibly on screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
        }
      },
      {
        rootMargin: '300px 0px 300px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pre-generate PDF file ahead of drag (single or multi-selected pages)
  const prepareSinglePagePdf = useCallback(async () => {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc || !(window as any).electronAPI?.prepareDragFile) return;
    try {
      const isPartOfSelection = doc.selectedPageIds.includes(page.id);
      const movingPageIds =
        isPartOfSelection && doc.selectedPageIds.length > 1
          ? doc.selectedPageIds
          : [page.id];

      const res = await PdfAssembler.extractPages(doc, movingPageIds, { separateFiles: false });
      if (res.mode === 'single') {
        const prepRes = await (window as any).electronAPI.prepareDragFile({
          fileName: res.name,
          buffer: res.buffer,
        });
        if (prepRes?.success && prepRes.filePath) {
          preparedFilePathRef.current = prepRes.filePath;
        }
      }
    } catch (err) {
      // silent
    }
  }, [page.id]);

  // Render or restore thumbnail from cache
  useEffect(() => {
    if (!isVisible) return;

    const cacheKey = `thumb_${page.id}_p${page.sourcePageIndex}_rot${page.rotation}`;

    // Already rendered for this exact page and rotation
    if (renderedKeyRef.current === cacheKey) {
      return;
    }

    if (!pdfDocProxy || !canvasRef.current) return;

    // SYNCHRONOUS CACHE HIT CHECK:
    // If cached in ImageBitmap LRU, paint immediately (<0.1ms) without entering the async queue!
    const cachedBitmap = thumbnailCache.get(cacheKey);
    if (cachedBitmap && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = cachedBitmap.width;
        canvas.height = cachedBitmap.height;
        ctx.drawImage(cachedBitmap, 0, 0);
        renderedKeyRef.current = cacheKey;
        setIsRendered(true);
        return;
      }
    }

    let isCancelled = false;

    async function renderThumbnail() {
      if (!pdfDocProxy || !canvasRef.current || isCancelled) return;

      try {
        const pdfPage = await pdfDocProxy.getPage(page.sourcePageIndex + 1);
        if (isCancelled || !canvasRef.current) return;

        const targetWidth = 140;
        const unscaledViewport = pdfPage.getViewport({ scale: 1.0, rotation: page.rotation });
        const scale = targetWidth / unscaledViewport.width;
        const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });

        if (isCancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (isCancelled) return;

        renderedKeyRef.current = cacheKey;
        setIsRendered(true);

        try {
          if (typeof createImageBitmap === 'function') {
            createImageBitmap(canvas).then((bmp) => {
              thumbnailCache.set(cacheKey, bmp);
            });
          }
        } catch {
          // ignore cache bitmap failure
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Thumbnail render error:', err);
        }
      }
    }

    // Auto-prioritized thumbnail render queue (lowest page index first)
    const cancelQueue = enqueueThumbnail(renderThumbnail, page.sourcePageIndex);

    return () => {
      isCancelled = true;
      cancelQueue();
    };
  }, [pdfDocProxy, page.id, page.sourcePageIndex, page.rotation, isVisible]);

  // Global cleanup: clear stale ring/highlight artifacts when any drag ends
  useEffect(() => {
    const clearDragState = () => {
      dropPositionRef.current = null;
      setDragOverPosition(null);
    };
    // dragend fires on the dragged element; drop fires on the target element.
    // Both together guarantee all cards are cleaned up regardless of which
    // card was being dragged over when the user released the mouse.
    window.addEventListener('dragend', clearDragState);
    window.addEventListener('drop', clearDragState);
    // pointerup catches cases where the drag was cancelled (e.g., Escape key)
    window.addEventListener('pointerup', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('drop', clearDragState);
      window.removeEventListener('pointerup', clearDragState);
    };
  }, []);

  // Drag Start
  const handleDragStart = useCallback((e: React.DragEvent) => {
    document.body.classList.add('is-dragging-page');

    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const isPartOfSelection = doc.selectedPageIds.includes(page.id);
    const movingPageIds =
      isPartOfSelection && doc.selectedPageIds.length > 1
        ? doc.selectedPageIds
        : [page.id];

    // Coordinate internal drag flag
    (window as any).__xpdf_internal_drag = {
      pageIds: movingPageIds,
      sourceDocId: doc.id,
      filePath: preparedFilePathRef.current,
    };

    e.dataTransfer.setData('application/json', JSON.stringify({ pageIds: movingPageIds }));
    e.dataTransfer.setData('text/plain', movingPageIds.join(','));
    e.dataTransfer.effectAllowed = 'copyMove';

    // Start native Windows OLE drag to Desktop / Explorer
    if (preparedFilePathRef.current && (window as any).electronAPI?.startDragFile) {
      (window as any).electronAPI.startDragFile({ filePath: preparedFilePathRef.current });
    }

    // Create high-contrast floating drag ghost pill
    try {
      const ghost = document.createElement('div');
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.style.left = '-1000px';
      ghost.style.padding = '8px 14px';
      ghost.style.borderRadius = '12px';
      ghost.style.background = '#0284c7';
      ghost.style.color = '#ffffff';
      ghost.style.fontWeight = '700';
      ghost.style.fontSize = '12px';
      ghost.style.boxShadow = '0 10px 25px rgba(2, 132, 199, 0.5)';
      ghost.style.border = '2px solid rgba(255, 255, 255, 0.6)';
      ghost.style.display = 'flex';
      ghost.style.alignItems = 'center';
      ghost.style.gap = '6px';
      ghost.style.zIndex = '9999';
      ghost.innerHTML = `<span>📄</span> <span>${
        movingPageIds.length > 1
          ? `${movingPageIds.length} Sayfa Taşınıyor`
          : `Sayfa ${page.displayPageNumber} Taşınıyor`
      }</span>`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 20);
      setTimeout(() => ghost.remove(), 100);
    } catch {}
  }, [page.id, page.displayPageNumber]);

  const handleDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-page');
    (window as any).__xpdf_internal_drag = null;
    dropPositionRef.current = null;
    setDragOverPosition(null);
  }, []);

  const handleQuickDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    try {
      const res = await PdfAssembler.extractPages(doc, [page.id], { separateFiles: false });
      if (res.mode === 'single') {
        const blob = new Blob([res.buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Download error:', err);
    }
  }, [page.id]);

  // High-Precision Drag Over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const isBefore = e.clientX < rect.left + rect.width / 2;
    const nextPos: 'before' | 'after' = isBefore ? 'before' : 'after';

    dropPositionRef.current = nextPos;
    setDragOverPosition((prev) => (prev !== nextPos ? nextPos : prev));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      dropPositionRef.current = null;
      setDragOverPosition(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('is-dragging-page');

    const position = dropPositionRef.current || 'after';
    dropPositionRef.current = null;
    setDragOverPosition(null);

    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    // 1. Internal page reordering (Check internal coordinator or JSON first)
    const internalDrag = (window as any).__xpdf_internal_drag;
    let pageIds: string[] = internalDrag?.pageIds || [];

    if (pageIds.length === 0) {
      try {
        const jsonStr = e.dataTransfer.getData('application/json');
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed?.pageIds)) {
            pageIds = parsed.pageIds;
          }
        }
      } catch {
        // fallback
      }
    }

    if (pageIds.length === 0) {
      const plainText = e.dataTransfer.getData('text/plain');
      if (plainText) {
        pageIds = plainText.split(',').filter(Boolean);
      }
    }

    if (pageIds.length > 0) {
      // Clear internal coordinator
      (window as any).__xpdf_internal_drag = null;
      const targetIndex = doc.pages.findIndex((p) => p.id === page.id);
      if (targetIndex !== -1) {
        historyManager.execute(new MoveMultiplePagesCommand(pageIds, targetIndex, position));
      }
      return;
    }

    // 2. External PDF file drop from Desktop or Explorer
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );

      if (files.length > 0) {
        const targetIndex = doc.pages.findIndex((p) => p.id === page.id);
        if (targetIndex !== -1) {
          const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
          try {
            useUIStore.getState().addToast('Harici PDF sayfaları ekleniyor...', 'info');
            let currentDoc = doc;
            let currentInsertIndex = insertAt;
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
              useDocumentStore.getState().setDocument(result.model, result.pdfDoc);
            }

            useUIStore.getState().addToast(`${totalAdded} sayfa başarıyla eklendi!`, 'success');
          } catch (err: any) {
            console.error('External PDF insertion error:', err);
            useUIStore.getState().addToast('PDF eklenirken hata oluştu.', 'error');
          }
          return;
        }
      }
    }
  }, [page.id]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const isMulti = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      onPageClick(page.id, index, isMulti, isShift);
    },
    [onPageClick, page.id, index]
  );

  return (
    <div
      ref={containerRef}
      draggable
      onMouseEnter={prepareSinglePagePdf}
      onMouseDown={prepareSinglePagePdf}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onContextMenu={(e) => {
        if (onContextMenu) {
          onContextMenu(e, page.id, index);
        }
      }}
      className={cn(
        'group relative flex flex-col items-center p-2 cursor-grab active:cursor-grabbing select-none min-h-[120px] transition-all duration-150',
        appDesignTheme === 'linear' && [
          'rounded-lg border bg-[#0E1015]',
          dragOverPosition
            ? 'ring-2 ring-cyan-400 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)] scale-[1.02]'
            : isActive
            ? 'border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)] bg-cyan-950/20'
            : isSelected
            ? 'border-cyan-700/80 bg-cyan-950/40'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]',
        ],
        appDesignTheme === 'cupertino' && [
          'rounded-2xl border transition-all duration-200',
          dragOverPosition
            ? 'ring-2 ring-sky-500 border-sky-400 shadow-xl scale-[1.02]'
            : isActive
            ? 'border-sky-500/80 bg-sky-500/10 shadow-lg'
            : isSelected
            ? 'border-sky-400/60 bg-sky-500/15'
            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-xs hover:shadow-md',
        ],
        appDesignTheme === 'fluent' && [
          'rounded-xl border-2',
          dragOverPosition
            ? 'ring-2 ring-sky-500 border-sky-400 bg-sky-500/5 shadow-md scale-[1.02]'
            : isActive
            ? 'bg-sky-500/10 border-sky-500 shadow-md shadow-sky-500/10'
            : isSelected
            ? 'bg-slate-200/80 dark:bg-slate-800/80 border-sky-500/70 shadow-sm'
            : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-transparent hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70',
        ],
        appDesignTheme === 'ribbon' && [
          'rounded-md border-2',
          dragOverPosition
            ? 'ring-2 ring-blue-600 border-blue-500 bg-blue-50/20 scale-[1.02]'
            : isActive
            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-600 shadow-xs'
            : isSelected
            ? 'bg-slate-200 dark:bg-slate-800 border-blue-500'
            : 'bg-white dark:bg-slate-800/60 border-slate-300 dark:border-slate-700 hover:border-slate-400',
        ]
      )}
    >
      {/* Sleek Minimalist Insertion Indicator on the LEFT */}
      {dragOverPosition === 'before' && (
        <div className="absolute -left-3 top-0 bottom-0 w-1.5 bg-sky-500 rounded-full shadow-[0_0_12px_rgba(14,165,233,0.9)] z-50 pointer-events-none flex flex-col justify-between items-center py-0.5">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
        </div>
      )}

      {/* Sleek Minimalist Insertion Indicator on the RIGHT */}
      {dragOverPosition === 'after' && (
        <div className="absolute -right-3 top-0 bottom-0 w-1.5 bg-sky-500 rounded-full shadow-[0_0_12px_rgba(14,165,233,0.9)] z-50 pointer-events-none flex flex-col justify-between items-center py-0.5">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
        </div>
      )}

      {/* Thumbnail Canvas Container */}
      <div className="relative w-full aspect-[1/1.414] bg-slate-100 dark:bg-slate-900/60 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700/50 shadow-sm">
        <canvas
          ref={canvasRef}
          className={cn(
            'max-w-full max-h-full object-contain',
            isRendered ? 'opacity-100' : 'opacity-0'
          )}
        />

        {!isRendered && (
          <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
        )}

        {/* Selected Badge */}
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-black shadow z-10">
            ✓
          </div>
        )}

        {/* Hover Quick Actions */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-opacity z-20 shadow-sm">
          <button
            onClick={handleQuickDownload}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-500 dark:hover:text-emerald-400 rounded transition-colors"
            title="Bu Sayfayı PDF Olarak İndir / Ayıkla"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              historyManager.execute(new RotatePageCommand([page.id], 90));
            }}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-white rounded transition-colors"
            title="Döndür (+90°)"
          >
            <RotateCw className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const doc = useDocumentStore.getState().currentDocument;
              if (doc) {
                const idx = doc.pages.findIndex((p) => p.id === page.id);
                historyManager.execute(new DeletePageCommand([{ page, index: idx }]));
              }
            }}
            className="p-1 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-slate-600 dark:text-slate-300 hover:text-rose-500 dark:hover:text-rose-400 rounded transition-colors"
            title="Sayfayı Sil"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Native Drag-to-Desktop Handle */}
        <div
          draggable
          onMouseEnter={prepareSinglePagePdf}
          onMouseDown={prepareSinglePagePdf}
          onDragStart={(e) => {
            e.stopPropagation();
            const doc = useDocumentStore.getState().currentDocument;
            const movingPageIds =
              doc && doc.selectedPageIds.includes(page.id) && doc.selectedPageIds.length > 1
                ? doc.selectedPageIds
                : [page.id];

            (window as any).__xpdf_internal_drag = {
              pageIds: movingPageIds,
              sourceDocId: doc?.id,
              filePath: preparedFilePathRef.current,
            };

            if (preparedFilePathRef.current && (window as any).electronAPI?.startDragFile) {
              (window as any).electronAPI.startDragFile({ filePath: preparedFilePathRef.current });
            }
          }}
          className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-white/95 dark:bg-slate-800/95 text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-700 shadow-xs border border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing transition-all z-20"
          title="Masaüstüne veya Klasöre Sürükle (Yeni PDF Olarak Çıkart)"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Page Number Label / Badge */}
      {appDesignTheme === 'cupertino' ? (
        <span className="mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-black/60 dark:bg-black/70 text-white backdrop-blur-md shadow-xs">
          {page.displayPageNumber}
        </span>
      ) : appDesignTheme === 'linear' ? (
        <span className="mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider bg-cyan-950/60 text-cyan-400 border border-cyan-800/50">
          #{page.displayPageNumber < 10 ? `0${page.displayPageNumber}` : page.displayPageNumber}
        </span>
      ) : appDesignTheme === 'ribbon' ? (
        <span className="mt-1.5 px-2 py-0.5 rounded text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {page.displayPageNumber}
        </span>
      ) : (
        <span className="mt-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
          {page.displayPageNumber}
        </span>
      )}
    </div>
  );
});

ThumbnailItem.displayName = 'ThumbnailItem';
