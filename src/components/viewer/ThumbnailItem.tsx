import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
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
import { useResolvedDarkTheme } from '../common/theme-utils';
import { Trash2, RotateCw, GripVertical, Download } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ThumbnailItemProps {
  page: PdfPageModel;
  index?: number;
  isActive: boolean;
  isSelected: boolean;
  thumbnailSize?: 'small' | 'medium' | 'large';
  onPageClick: (pageId: string, index: number, isMulti: boolean, isShift: boolean) => void;
  onContextMenu?: (e: React.MouseEvent, pageId: string, index: number) => void;
}

type InternalDragPayload = {
  pageIds: string[];
  sourceDocId?: string;
  filePath?: string | null;
};

type WindowWithInternalDrag = Window & {
  __xpdf_internal_drag?: InternalDragPayload | null;
};

export const ThumbnailItem: React.FC<ThumbnailItemProps> = React.memo(({
  page,
  index = 0,
  isActive,
  isSelected,
  thumbnailSize = 'medium',
  onPageClick,
  onContextMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderedKeyRef = useRef<string>('');
  const dropPositionRef = useRef<'before' | 'after' | null>(null);
  const preparedFilePathRef = useRef<string | null>(null);
  const prepareInFlightRef = useRef<boolean>(false);

  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | null>(null);

  const pdfDocProxy = useDocumentStore((s) => s.pdfDocProxy);
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme) || 'fluent';
  const isDark = useResolvedDarkTheme();

  // Viewport IntersectionObserver: Proactive high-margin rendering (1000px)
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
        rootMargin: '1000px 0px 1000px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pre-generate PDF file only on pointer down / drag start (never on hover)
  const prepareSinglePagePdf = useCallback(async () => {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc || !window.electronAPI?.prepareDragFile || prepareInFlightRef.current) return;
    prepareInFlightRef.current = true;
    try {
      const isPartOfSelection = doc.selectedPageIds.includes(page.id);
      const movingPageIds =
        isPartOfSelection && doc.selectedPageIds.length > 1
          ? doc.selectedPageIds
          : [page.id];

      const res = await PdfAssembler.extractPages(doc, movingPageIds, { separateFiles: false });
      if (res.mode === 'single') {
        const prepRes = await window.electronAPI.prepareDragFile({
          fileName: res.name,
          buffer: res.buffer,
        });
        if (prepRes?.success && prepRes.filePath) {
          preparedFilePathRef.current = prepRes.filePath;
        }
      }
    } catch {
      // silent
    } finally {
      prepareInFlightRef.current = false;
    }
  }, [page.id]);

  // Render or restore thumbnail from cache
  useEffect(() => {
    if (!isVisible) return;

    const cacheKey = `thumb_${page.id}_p${page.sourcePageIndex}_rot${page.rotation}_${thumbnailSize}`;

    if (renderedKeyRef.current === cacheKey) {
      return;
    }

    if (!pdfDocProxy || !canvasRef.current) return;

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

        const targetWidth = thumbnailSize === 'large' ? 320 : thumbnailSize === 'small' ? 110 : 175;
        const unscaledViewport = pdfPage.getViewport({ scale: 1.0, rotation: page.rotation });
        const scale = targetWidth / (unscaledViewport.width || 1);
        const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });

        if (isCancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    const cancelQueue = enqueueThumbnail(renderThumbnail, 0);

    return () => {
      isCancelled = true;
      cancelQueue();
    };
  }, [pdfDocProxy, page.id, page.sourcePageIndex, page.rotation, thumbnailSize, isVisible]);

  // Global cleanup: clear stale ring/highlight artifacts when any drag ends
  useEffect(() => {
    const clearDragState = () => {
      dropPositionRef.current = null;
      setDragOverPosition(null);
    };
    window.addEventListener('dragend', clearDragState);
    window.addEventListener('drop', clearDragState);
    window.addEventListener('pointerup', clearDragState);
    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('drop', clearDragState);
      window.removeEventListener('pointerup', clearDragState);
    };
  }, []);

  const startInternalOrExternalDrag = useCallback(
    (e: React.DragEvent) => {
      document.body.classList.add('is-dragging-page');

      const doc = useDocumentStore.getState().currentDocument;
      if (!doc) return;

      const isPartOfSelection = doc.selectedPageIds.includes(page.id);
      const movingPageIds =
        isPartOfSelection && doc.selectedPageIds.length > 1
          ? doc.selectedPageIds
          : [page.id];

      (window as WindowWithInternalDrag).__xpdf_internal_drag = {
        pageIds: movingPageIds,
        sourceDocId: doc.id,
        filePath: preparedFilePathRef.current,
      };

      e.dataTransfer.setData('application/json', JSON.stringify({ pageIds: movingPageIds }));
      e.dataTransfer.setData('text/plain', movingPageIds.join(','));
      e.dataTransfer.effectAllowed = 'copyMove';

      if (preparedFilePathRef.current && window.electronAPI?.startDragFile) {
        window.electronAPI.startDragFile({ filePath: preparedFilePathRef.current });
      }

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
        ghost.textContent =
          movingPageIds.length > 1
            ? `${movingPageIds.length} Sayfa Taşınıyor`
            : `Sayfa ${page.displayPageNumber} Taşınıyor`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(() => ghost.remove(), 100);
      } catch {
        // ignore drag ghost failures
      }
    },
    [page.id, page.displayPageNumber]
  );

  const handleDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-page');
    (window as WindowWithInternalDrag).__xpdf_internal_drag = null;
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
        const electron = window.electronAPI;
        if (electron?.showSaveDialog && electron?.saveFile) {
          const dialogRes = await electron.showSaveDialog({
            title: 'Sayfayı Kaydet',
            defaultPath: res.name,
            filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
          });
          if (dialogRes.canceled || !dialogRes.filePath) return;
          const saveRes = await electron.saveFile(dialogRes.filePath, res.buffer);
          if (saveRes?.success) {
            useUIStore.getState().addToast(`Sayfa ${page.displayPageNumber} kaydedildi.`, 'success');
          } else {
            useUIStore.getState().addToast('Kaydetme hatası oluştu.', 'error');
          }
          return;
        }

        const blob = new Blob([res.buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      console.error('Download error:', err);
      useUIStore.getState().addToast('Sayfa dışa aktarılamadı.', 'error');
    }
  }, [page.id, page.displayPageNumber]);

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

    const internalDrag = (window as WindowWithInternalDrag).__xpdf_internal_drag;
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
      (window as WindowWithInternalDrag).__xpdf_internal_drag = null;
      const targetIndex = doc.pages.findIndex((p) => p.id === page.id);
      if (targetIndex !== -1) {
        historyManager.execute(new MoveMultiplePagesCommand(pageIds, targetIndex, position));
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const targetIndex = doc.pages.findIndex((p) => p.id === page.id);
      if (targetIndex !== -1) {
        const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
        try {
          useUIStore.getState().addToast('Harici dosya(lar) ekleniyor...', 'info');
          const processed = await PdfAssembler.processDroppedFiles(droppedFiles);
          if (processed.length === 0) {
            useUIStore.getState().addToast('Desteklenen dosya bulunamadı (PDF, PNG, JPEG, WEBP).', 'error');
            return;
          }

          let currentDoc = doc;
          let currentInsertIndex = insertAt;
          let totalAdded = 0;

          for (const item of processed) {
            const indices = Array.from({ length: item.pageCount }, (_, i) => i);
            const result = await PdfAssembler.insertPagesIntoDocument(
              currentDoc,
              item.buffer,
              indices,
              currentInsertIndex
            );
            currentDoc = result.model;
            currentInsertIndex += indices.length;
            totalAdded += indices.length;
            useDocumentStore.getState().setDocument(result.model, result.pdfDoc);
            useTabStore.getState().replaceActiveTab(result.model, result.pdfDoc);
          }

          useUIStore.getState().addToast(`${totalAdded} sayfa başarıyla eklendi!`, 'success');
        } catch (err) {
          console.error('External file drop error:', err);
          useUIStore.getState().addToast('Dosyalar eklenirken hata oluştu.', 'error');
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

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <div
      ref={containerRef}
      draggable
      onMouseDown={(e) => {
        if (e.button === 0) {
          prepareSinglePagePdf();
        }
      }}
      onDragStart={startInternalOrExternalDrag}
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
        isLinearDark && [
          'rounded-lg border bg-[#0E1015]',
          dragOverPosition
            ? 'ring-2 ring-cyan-400 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)] scale-[1.02]'
            : isSelected
            ? 'border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)] bg-cyan-950/40 ring-2 ring-cyan-500'
            : isActive
            ? 'border-cyan-500/50 bg-cyan-950/20'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]',
        ],
        isLinearLight && [
          'rounded-lg border bg-white',
          dragOverPosition
            ? 'ring-2 ring-sky-500 border-sky-400 scale-[1.02]'
            : isSelected
            ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500'
            : isActive
            ? 'border-sky-400/60 bg-sky-50/40'
            : 'border-slate-200 hover:border-slate-300',
        ],
        appDesignTheme === 'cupertino' && [
          'rounded-2xl border transition-all duration-200',
          dragOverPosition
            ? 'ring-2 ring-sky-500 border-sky-400 shadow-xl scale-[1.02]'
            : isSelected
            ? 'ring-2 ring-sky-500 border-sky-400 bg-sky-500/20 shadow-lg'
            : isActive
            ? 'border-sky-500/50 bg-sky-500/10'
            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-sm hover:shadow-md',
        ],
        appDesignTheme === 'fluent' && [
          'rounded-xl border-2',
          dragOverPosition
            ? 'ring-2 ring-sky-500 border-sky-400 bg-sky-500/5 shadow-md scale-[1.02]'
            : isSelected
            ? 'ring-2 ring-sky-500 border-sky-500 bg-sky-500/15 shadow-md shadow-sky-500/20'
            : isActive
            ? 'border-sky-400/60 bg-sky-500/5'
            : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-transparent hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70',
        ],
        appDesignTheme === 'ribbon' && [
          'rounded-md border-2',
          dragOverPosition
            ? 'ring-2 ring-blue-600 border-blue-500 bg-blue-50/20 scale-[1.02]'
            : isSelected
            ? 'ring-2 ring-blue-600 border-blue-600 bg-blue-100 dark:bg-blue-900/40'
            : isActive
            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
            : 'bg-white dark:bg-slate-800/60 border-slate-300 dark:border-slate-700 hover:border-slate-400',
        ]
      )}
    >
      {/* Insertion Indicator LEFT */}
      {dragOverPosition === 'before' && (
        <div className="absolute -left-3 top-0 bottom-0 w-1.5 bg-sky-500 rounded-full shadow-[0_0_12px_rgba(14,165,233,0.9)] z-50 pointer-events-none flex flex-col justify-between items-center py-0.5">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md ring-2 ring-white dark:ring-slate-900" />
        </div>
      )}

      {/* Insertion Indicator RIGHT */}
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
            'max-w-full max-h-full object-contain bg-white',
            isRendered ? 'opacity-100' : 'opacity-0'
          )}
        />

        {!isRendered && (
          <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
        )}

        {/* Selected Badge (bottom-right so it never collides with top-right hover actions) */}
        {isSelected && (
          <div
            aria-label="Seçili sayfa"
            className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-black shadow z-10"
          >
            ✓
          </div>
        )}

        {/* Hover Quick Actions */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-opacity z-20 shadow-sm">
          <button
            type="button"
            aria-label={`Sayfa ${page.displayPageNumber} dışa aktar`}
            onClick={handleQuickDownload}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-emerald-500 dark:hover:text-emerald-400 rounded transition-colors"
            title="Bu Sayfayı PDF Olarak İndir / Ayıkla"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label={`Sayfa ${page.displayPageNumber} sağa döndür`}
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
            type="button"
            aria-label={`Sayfa ${page.displayPageNumber} sil`}
            onClick={(e) => {
              e.stopPropagation();
              const doc = useDocumentStore.getState().currentDocument;
              if (doc && doc.pages.length > 1) {
                const idx = doc.pages.findIndex((p) => p.id === page.id);
                historyManager.execute(new DeletePageCommand([{ page, index: idx }]));
              } else {
                useUIStore.getState().addToast('Belgede en az 1 sayfa kalmalıdır.', 'warning');
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
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) {
              prepareSinglePagePdf();
            }
          }}
          onDragStart={(e) => {
            e.stopPropagation();
            startInternalOrExternalDrag(e);
          }}
          onDragEnd={handleDragEnd}
          className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-white/95 dark:bg-slate-800/95 text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 cursor-grab active:cursor-grabbing transition-all z-20"
          title="Masaüstüne veya Klasöre Sürükle (Yeni PDF Olarak Çıkart)"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Page Number Label / Badge */}
      {appDesignTheme === 'cupertino' ? (
        <span className="mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-black/60 dark:bg-black/70 text-white backdrop-blur-md shadow-sm">
          {page.displayPageNumber}
        </span>
      ) : isLinearDark ? (
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
