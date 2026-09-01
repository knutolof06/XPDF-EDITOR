import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { thumbnailCache } from '@/core/cache/render-cache';
import { enqueueThumbnail } from '@/core/cache/thumbnail-queue';
import { historyManager, MoveMultiplePagesCommand, RotatePageCommand, DeletePageCommand } from '@/core/history/command-manager';
import { binaryStore } from '@/core/storage/binary-store';
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
}

export const ThumbnailItem: React.FC<ThumbnailItemProps> = React.memo(({
  page,
  index = 0,
  isActive,
  isSelected,
  onPageClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dropLineLeftRef = useRef<HTMLDivElement>(null);
  const dropLineRightRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const dropPositionRef = useRef<'before' | 'after' | null>(null);

  const pdfDocProxy = useDocumentStore((s) => s.pdfDocProxy);

  // Lazy load thumbnails when they scroll into viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          // Scrolled away before rendering: cancel
          setIsVisible(false);
        }
      },
      {
        rootMargin: '150px 0px 150px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || isRendered) return;

    let isCancelled = false;

    async function renderThumbnail() {
      if (!pdfDocProxy || !canvasRef.current) return;

      const cacheKey = `thumb_${page.id}_rot${page.rotation}`;
      const cachedBitmap = thumbnailCache.get(cacheKey);

      // Instant hardware-accelerated GPU draw from ImageBitmap cache
      if (cachedBitmap && canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = cachedBitmap.width;
          canvas.height = cachedBitmap.height;
          ctx.drawImage(cachedBitmap, 0, 0);
          setIsRendered(true);
          return;
        }
      }

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

        setIsRendered(true);

        try {
          if (typeof createImageBitmap === 'function') {
            createImageBitmap(canvas).then((bmp) => {
              thumbnailCache.set(cacheKey, bmp);
            });
          }
        } catch { /* ignore */ }
      } catch (err) {
        if (!isCancelled) console.error('Thumbnail render error:', err);
      }
    }

    // Auto-prioritized: currently visible items get top priority (LIFO)
    const cancelQueue = enqueueThumbnail(renderThumbnail);

    return () => {
      isCancelled = true;
      cancelQueue();
    };
  }, [isVisible, pdfDocProxy, page.sourcePageIndex, page.rotation, page.id, isRendered]);

  // Instant Drag Start — Enables zero-latency drag mode + Native Drag-to-Desktop
  const handleDragStart = useCallback(async (e: React.DragEvent) => {
    document.body.classList.add('is-dragging-page');

    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const isPartOfSelection = doc.selectedPageIds.includes(page.id);
    const movingPageIds =
      isPartOfSelection && doc.selectedPageIds.length > 1
        ? doc.selectedPageIds
        : [page.id];

    e.dataTransfer.setData('application/json', JSON.stringify({ pageIds: movingPageIds }));
    e.dataTransfer.setData('text/plain', movingPageIds.join(','));
    e.dataTransfer.effectAllowed = 'copyMove';

    // Native Drag-Out to Desktop / File Explorer
    if (typeof window !== 'undefined' && (window as any).electronAPI?.startDragPage) {
      try {
        const raw = binaryStore.get(doc.id);
        if (raw) {
          const srcDoc = await PDFDocument.load(raw.slice(0));
          const outDoc = await PDFDocument.create();
          const selectedPages = doc.pages.filter((p) => movingPageIds.includes(p.id));
          const indices = selectedPages.map((p) => p.sourcePageIndex);
          const copiedPages = await outDoc.copyPages(srcDoc, indices);
          copiedPages.forEach((cp, i) => {
            const orig = selectedPages[i];
            if (orig && orig.rotation !== 0) {
              try {
                // @ts-ignore
                cp.setRotation({ type: 'degrees', angle: orig.rotation });
              } catch {
                // fallback
              }
            }
            outDoc.addPage(cp);
          });
          const bytes = await outDoc.save();
          const baseName = doc.name.replace(/\.pdf$/i, '');
          const fileName =
            movingPageIds.length === 1
              ? `${baseName}_sayfa_${page.displayPageNumber}.pdf`
              : `${baseName}_${movingPageIds.length}_sayfa.pdf`;

          (window as any).electronAPI.startDragPage({
            fileName,
            buffer: bytes,
          });
        }
      } catch (err) {
        console.error('Drag-to-desktop generation error:', err);
      }
    }
  }, [page.id, page.displayPageNumber]);

  const handleDragEnd = useCallback(() => {
    document.body.classList.remove('is-dragging-page');
    if (dropLineLeftRef.current) dropLineLeftRef.current.style.display = 'none';
    if (dropLineRightRef.current) dropLineRightRef.current.style.display = 'none';
    dropPositionRef.current = null;
  }, []);

  const handleQuickDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    try {
      const raw = binaryStore.get(doc.id);
      if (!raw) return;

      const srcDoc = await PDFDocument.load(raw.slice(0));
      const outDoc = await PDFDocument.create();
      const [cp] = await outDoc.copyPages(srcDoc, [page.sourcePageIndex]);
      outDoc.addPage(cp);

      const bytes = await outDoc.save();
      const rawBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([rawBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.name.replace(/\.pdf$/i, '')}_sayfa_${page.displayPageNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    }
  }, [page.sourcePageIndex, page.displayPageNumber]);

  // Ultra-Fast Zero-Reflow & State-Deduplicated Drag Over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    const offsetX = e.nativeEvent.offsetX;
    const targetWidth = containerRef.current?.offsetWidth || 140;
    const isBefore = offsetX < targetWidth / 2;
    const nextPos = isBefore ? 'before' : 'after';

    if (dropPositionRef.current !== nextPos) {
      dropPositionRef.current = nextPos;
      if (dropLineLeftRef.current) dropLineLeftRef.current.style.display = isBefore ? 'block' : 'none';
      if (dropLineRightRef.current) dropLineRightRef.current.style.display = isBefore ? 'none' : 'block';
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    dropPositionRef.current = null;
    if (dropLineLeftRef.current) dropLineLeftRef.current.style.display = 'none';
    if (dropLineRightRef.current) dropLineRightRef.current.style.display = 'none';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('is-dragging-page');

    const position = dropPositionRef.current || 'after';

    // Hide lines immediately
    if (dropLineLeftRef.current) dropLineLeftRef.current.style.display = 'none';
    if (dropLineRightRef.current) dropLineRightRef.current.style.display = 'none';
    dropPositionRef.current = null;

    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    // 1. External PDF drop
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

    // 2. Internal page reordering
    let pageIds: string[] = [];
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

    if (pageIds.length === 0) {
      const plainText = e.dataTransfer.getData('text/plain');
      if (plainText) {
        pageIds = plainText.split(',').filter(Boolean);
      }
    }

    if (pageIds.length === 0) return;

    const targetIndex = doc.pages.findIndex((p) => p.id === page.id);
    if (targetIndex !== -1) {
      historyManager.execute(new MoveMultiplePagesCommand(pageIds, targetIndex, position));
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
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={cn(
        'group relative flex flex-col items-center p-2 rounded-xl cursor-grab active:cursor-grabbing border-2 select-none min-h-[120px]',
        isActive
          ? 'bg-sky-500/10 border-sky-500 shadow-md shadow-sky-500/10'
          : isSelected
          ? 'bg-slate-200/80 dark:bg-slate-800/80 border-sky-500/70 shadow-sm'
          : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-transparent hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
      )}
    >
      {/* Drop indicator lines */}
      <div
        ref={dropLineLeftRef}
        style={{ display: 'none' }}
        className="absolute -left-2 top-0 bottom-0 w-1.5 bg-sky-500 rounded-full shadow-lg shadow-sky-500/50 z-30 pointer-events-none"
      />
      <div
        ref={dropLineRightRef}
        style={{ display: 'none' }}
        className="absolute -right-2 top-0 bottom-0 w-1.5 bg-sky-500 rounded-full shadow-lg shadow-sky-500/50 z-30 pointer-events-none"
      />

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
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-opacity z-20 shadow-sm">
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

        {/* Drag handle indicator */}
        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 text-slate-400">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Page Number Label */}
      <span className="mt-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
        {page.displayPageNumber}
      </span>
    </div>
  );
});

ThumbnailItem.displayName = 'ThumbnailItem';
