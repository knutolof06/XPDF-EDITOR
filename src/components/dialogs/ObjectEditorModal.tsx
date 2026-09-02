import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { PdfNativeObject } from '@/types/annotations';
import { extractAllNativeObjects } from '@/core/pdf/pdf-native-extractor';
import { cn } from '@/utils/cn';
import {
  X,
  RotateCcw,
  Loader2,
  Type,
  Move,
  Info,
  CheckCircle2,
  CheckSquare,
  QrCode,
} from 'lucide-react';

export const ObjectEditorModal: React.FC = () => {
  const { isObjectEditorOpen, setObjectEditorOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);
  const {
    objectsByPage,
    setObjects,
    moveMultipleObjects,
    resetObject,
    resetMultipleObjects,
    resetAllOnPage,
  } = useNativeObjectStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);

  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [isLoading, setIsLoading] = useState(false);

  // Multi-selection state: Set of selected object IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter for sidebar list ('all' | 'text' | 'image' | 'moved')
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'text' | 'image' | 'moved'>('all');

  // Dragging group state
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  // Marquee (Area Selection) state
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const totalPages = currentDocument?.pages.length || 0;
  const activePage = currentDocument?.pages[pageIndex];
  const pageId = activePage?.id || '';
  const objects: PdfNativeObject[] = objectsByPage[pageId] ?? [];
  const movedCount = objects.filter((o) => o.moved).length;

  const isDark = theme === 'dark';

  // Render canvas when page or scale changes
  useEffect(() => {
    if (!isObjectEditorOpen || !pdfDocProxy || !activePage || !canvasRef.current) return;

    let isCancelled = false;

    const render = async () => {
      setIsLoading(true);
      setSelectedIds(new Set());

      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const pdfPage = await pdfDocProxy.getPage(activePage.sourcePageIndex + 1);
        if (isCancelled) return;

        const viewport = pdfPage.getViewport({ scale, rotation: activePage.rotation });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (isCancelled) return;

        setIsLoading(false);

        // Extract objects for this page if not done yet
        if (!objectsByPage[pageId] || objectsByPage[pageId].length === 0) {
          const objs = await extractAllNativeObjects(pdfPage, pageId);
          if (!isCancelled) setObjects(pageId, objs);
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('ObjectEditor render error:', err);
          setIsLoading(false);
        }
      }
    };

    render();

    return () => {
      isCancelled = true;
    };
  }, [isObjectEditorOpen, pageIndex, pdfDocProxy, activePage, scale]);

  // Object Selection Handler
  const handleObjectClick = (e: React.MouseEvent, obj: PdfNativeObject) => {
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      // Toggle selection in multi-select mode
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(obj.id)) {
          next.delete(obj.id);
        } else {
          next.add(obj.id);
        }
        return next;
      });
    } else {
      // Single select
      setSelectedIds(new Set([obj.id]));
    }
  };

  // Group Dragging Handler
  const handleDragStart = useCallback(
    (e: React.MouseEvent, obj: PdfNativeObject) => {
      e.stopPropagation();
      e.preventDefault();

      let currentSelected = selectedIds;
      // If clicked object is not in current selection, select it exclusively (unless shift/ctrl)
      if (!selectedIds.has(obj.id)) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          currentSelected = new Set(selectedIds).add(obj.id);
          setSelectedIds(currentSelected);
        } else {
          currentSelected = new Set([obj.id]);
          setSelectedIds(currentSelected);
        }
      }

      // Record starting positions for all selected objects
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of currentSelected) {
        const targetObj = objects.find((o) => o.id === id);
        if (targetObj) {
          startPositions.set(id, { x: targetObj.x, y: targetObj.y });
        }
      }

      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPositions,
      };

      const onMouseMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = (me.clientX - dragRef.current.startMouseX) / scale;
        const dy = (me.clientY - dragRef.current.startMouseY) / scale;

        const updates: { id: string; x: number; y: number }[] = [];
        dragRef.current.startPositions.forEach((startPos, id) => {
          updates.push({
            id,
            x: Math.max(0, startPos.x + dx),
            y: Math.max(0, startPos.y + dy),
          });
        });

        moveMultipleObjects(pageId, updates);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [scale, pageId, selectedIds, objects, moveMultipleObjects]
  );

  // Marquee Area Selection on Workspace / Canvas
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Clicking on canvas clears selection unless ctrl/shift is pressed
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelectedIds(new Set());
    }

    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const startX = (e.clientX - canvasRect.left) / scale;
    const startY = (e.clientY - canvasRect.top) / scale;

    setMarquee({ startX, startY, currentX: startX, currentY: startY });

    const onMouseMove = (me: MouseEvent) => {
      const currentX = (me.clientX - canvasRect.left) / scale;
      const currentY = (me.clientY - canvasRect.top) / scale;
      setMarquee((m) => (m ? { ...m, currentX, currentY } : null));

      // Calculate bounding box in PDF points
      const minX = Math.min(startX, currentX);
      const maxX = Math.max(startX, currentX);
      const minY = Math.min(startY, currentY);
      const maxY = Math.max(startY, currentY);

      // Find all objects inside or intersecting the marquee
      const enclosed = objects.filter((o) => {
        const oMaxX = o.x + o.width;
        const oMaxY = o.y + o.height;
        return o.x < maxX && oMaxX > minX && o.y < maxY && oMaxY > minY;
      });

      setSelectedIds((prev) => {
        const next = me.ctrlKey || me.shiftKey ? new Set(prev) : new Set<string>();
        enclosed.forEach((o) => next.add(o.id));
        return next;
      });
    };

    const onMouseUp = () => {
      setMarquee(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleApply = () => {
    if (movedCount > 0) {
      useDocumentStore.setState((state) => {
        if (!state.currentDocument) return state;
        return {
          currentDocument: {
            ...state.currentDocument,
            isModified: true,
          },
        };
      });
    }
    addToast(`${movedCount} nesne taşıması dökümana uygulandı.`, 'success');
    setObjectEditorOpen(false);
  };

  const handleClose = () => {
    setObjectEditorOpen(false);
  };

  // Filtered sidebar objects
  const filteredObjects = objects.filter((o) => {
    if (sidebarFilter === 'text') return o.type === 'native-text';
    if (sidebarFilter === 'image') return o.type === 'native-image';
    if (sidebarFilter === 'moved') return o.moved;
    return true;
  });

  const selectedList = objects.filter((o) => selectedIds.has(o.id));

  if (!isObjectEditorOpen || !currentDocument) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col backdrop-blur-sm select-none animate-in fade-in duration-150',
        isDark ? 'bg-slate-950/95 text-slate-100' : 'bg-slate-900/60 text-slate-800'
      )}
    >
      {/* ── Top Header Toolbar ── */}
      <div
        className={cn(
          'h-13 shrink-0 border-b flex items-center px-4 gap-3 z-30 transition-colors',
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        )}
      >
        <div className="flex items-center gap-2 font-bold text-sm">
          <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-500 flex items-center justify-center">
            <Move className="w-4 h-4" />
          </div>
          <span className={isDark ? 'text-white' : 'text-slate-900'}>PDF Nesne Düzenleyici</span>
        </div>

        <div className={cn('h-5 w-[1px] mx-1', isDark ? 'bg-slate-800' : 'bg-slate-200')} />

        <span className={cn('text-xs truncate max-w-[200px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
          {currentDocument.name}
        </span>

        {/* Selected / Moved status badges */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 bg-sky-500/15 text-sky-600 dark:text-sky-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-sky-500/30">
            <CheckSquare className="w-3.5 h-3.5" />
            {selectedIds.size} nesne seçili
          </div>
        )}

        {movedCount > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {movedCount} taşındı
          </div>
        )}

        {/* Action Controls */}
        <div className="ml-auto flex items-center gap-2">
          {/* Zoom controls */}
          <div
            className={cn(
              'flex items-center rounded-lg px-2 py-1 text-xs border font-medium',
              isDark ? 'bg-slate-800/90 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
            )}
          >
            <button
              onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.2).toFixed(2))))}
              className="px-1.5 hover:text-sky-500 transition-colors font-bold"
            >
              −
            </button>
            <span className="w-12 text-center font-mono">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale((s) => Math.min(3, Number((s + 0.2).toFixed(2))))}
              className="px-1.5 hover:text-sky-500 transition-colors font-bold"
            >
              +
            </button>
          </div>

          {/* Reset Selected or All */}
          {selectedIds.size > 0 ? (
            <button
              onClick={() => resetMultipleObjects(pageId, Array.from(selectedIds))}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium',
                isDark
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
              )}
              title="Seçili nesnelerin konumunu sıfırla"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Seçilenleri Sıfırla
            </button>
          ) : (
            <button
              onClick={() => resetAllOnPage(pageId)}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium',
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              )}
              title="Sayfadaki tüm taşımaları sıfırla"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Tümünü Sıfırla
            </button>
          )}

          {/* Select All */}
          <button
            onClick={() => setSelectedIds(new Set(objects.map((o) => o.id)))}
            className={cn(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium',
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            )}
            title="Bu sayfadaki tüm nesneleri seç"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Tümünü Seç
          </button>

          {/* Apply & Close */}
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors shadow-md hover:shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            Uygula & Kapat
          </button>

          <button
            onClick={handleClose}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
            )}
            title="Kapat (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Main Workspace Body ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Page Navigator ── */}
        <div
          className={cn(
            'w-48 shrink-0 border-r flex flex-col overflow-y-auto py-3 gap-1 px-2.5 transition-colors',
            isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
          )}
        >
          <p className={cn('text-[11px] font-bold uppercase tracking-wider px-2 pb-1.5', isDark ? 'text-slate-400' : 'text-slate-500')}>
            Sayfalar ({totalPages})
          </p>
          {currentDocument.pages.map((pg, i) => {
            const pgObjs = objectsByPage[pg.id] ?? [];
            const pgMoved = pgObjs.filter((o) => o.moved).length;
            const isActive = pageIndex === i;

            return (
              <button
                key={pg.id}
                onClick={() => setPageIndex(i)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all text-left font-medium',
                  isActive
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/40 shadow-sm font-semibold'
                    : isDark
                    ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <span
                  className={cn(
                    'w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[11px] font-bold',
                    isActive
                      ? 'bg-sky-500 text-white'
                      : isDark
                      ? 'bg-slate-800 text-slate-400'
                      : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate">Sayfa {i + 1}</span>
                {pgMoved > 0 && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-md px-1.5 py-0.5">
                    {pgMoved}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Center: Canvas & Interactive Overlays ── */}
        <div
          ref={workspaceRef}
          onMouseDown={handleCanvasMouseDown}
          className={cn(
            'flex-1 overflow-auto flex items-start justify-center p-8 transition-colors cursor-crosshair select-none relative',
            isDark ? 'bg-slate-950' : 'bg-slate-200/90'
          )}
        >
          <div
            style={{
              width: canvasRef.current?.style.width || 'auto',
              height: canvasRef.current?.style.height || 'auto',
            }}
            className="relative inline-block shadow-2xl rounded-sm transition-all"
          >
            {/* Base PDF Canvas */}
            <canvas ref={canvasRef} className="block bg-white rounded-sm pointer-events-none" />

            {/* Loading Indicator */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 dark:bg-slate-900/70 rounded-sm z-40 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin mb-2" />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Sayfa ve nesneler taranıyor...
                </span>
              </div>
            )}

            {/* Interactive Object Layer */}
            {!isLoading && (
              <div className="absolute inset-0 pointer-events-none overflow-visible">
                {/* 1. Whiteout Masks for Original Spots of Moved Objects */}
                {objects.map((obj) => {
                  if (!obj.moved) return null;
                  return (
                    <div
                      key={`mask_${obj.id}`}
                      style={{
                        left: `${obj.originalX * scale - 1}px`,
                        top: `${obj.originalY * scale - 1}px`,
                        width: `${obj.originalWidth * scale + 2}px`,
                        height: `${obj.originalHeight * scale + 2}px`,
                      }}
                      className="absolute bg-white z-10 border border-dashed border-amber-400/60 rounded-[2px]"
                      title="Orijinal konum (beyazla kapatıldı)"
                    />
                  );
                })}

                {/* 2. Interactive Draggable Objects */}
                {objects.map((obj) => {
                  const isSelected = selectedIds.has(obj.id);
                  const isText = obj.type === 'native-text';
                  const x = obj.x * scale;
                  const y = obj.y * scale;
                  const w = Math.max(obj.width * scale, 14);
                  const h = Math.max(obj.height * scale, 14);

                  return (
                    <div
                      key={obj.id}
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${w}px`,
                        height: `${h}px`,
                      }}
                      onMouseDown={(e) => handleDragStart(e, obj)}
                      onClick={(e) => handleObjectClick(e, obj)}
                      className={cn(
                        'absolute pointer-events-auto cursor-move select-none transition-all duration-75 flex items-center overflow-visible',
                        // Unselected styling
                        !isSelected && !obj.moved && (isText
                          ? 'hover:bg-sky-500/10 hover:ring-1 hover:ring-sky-500/60'
                          : 'hover:bg-emerald-500/15 hover:ring-1 hover:ring-emerald-500/80 bg-emerald-500/5'
                        ),
                        // Selected styling
                        isSelected && (isText
                          ? 'bg-sky-500/20 ring-2 ring-sky-500 z-30 shadow-lg'
                          : 'bg-emerald-500/25 ring-2 ring-emerald-500 z-30 shadow-lg'
                        ),
                        // Moved styling
                        obj.moved && 'ring-2 ring-amber-500 bg-amber-500/10 z-20 shadow-md'
                      )}
                      title={
                        isText
                          ? `Metin: "${(obj.text || '').slice(0, 50)}"`
                          : `Görsel / QR Kod (${Math.round(obj.width)}x${Math.round(obj.height)})`
                      }
                    >
                      {/* Live moving preview for text if moved or selected */}
                      {isText && obj.moved && (
                        <div
                          style={{
                            fontSize: `${(obj.fontSize || 12) * scale}px`,
                            fontFamily: obj.fontName || 'sans-serif',
                            color: obj.color || '#000000',
                            lineHeight: 1,
                          }}
                          className="w-full h-full flex items-center px-0.5 bg-white/95 rounded-[2px] shadow-sm font-normal whitespace-pre"
                        >
                          {obj.text}
                        </div>
                      )}

                      {/* Live moving preview for image/QR if moved */}
                      {!isText && obj.moved && (
                        <div className="w-full h-full bg-emerald-50 border border-emerald-400 rounded flex flex-col items-center justify-center p-1 text-emerald-800 shadow-sm">
                          <QrCode className="w-4 h-4 text-emerald-600 mb-0.5" />
                          <span className="text-[9px] font-bold">Görsel / QR</span>
                        </div>
                      )}

                      {/* Moved Badge */}
                      {obj.moved && (
                        <div
                          className="absolute -top-6 left-0 flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg z-40 whitespace-nowrap pointer-events-auto"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <span>Taşındı</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resetObject(pageId, obj.id);
                            }}
                            className="hover:bg-amber-600 rounded px-1 transition-colors flex items-center gap-0.5"
                            title="Orijinal yerine sıfırla"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 3. Marquee Selection Rubber-Band */}
                {marquee && (
                  <div
                    style={{
                      left: `${Math.min(marquee.startX, marquee.currentX) * scale}px`,
                      top: `${Math.min(marquee.startY, marquee.currentY) * scale}px`,
                      width: `${Math.abs(marquee.currentX - marquee.startX) * scale}px`,
                      height: `${Math.abs(marquee.currentY - marquee.startY) * scale}px`,
                    }}
                    className="absolute bg-sky-500/20 border-2 border-sky-500 border-dashed rounded pointer-events-none z-40"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Properties & Object List Panel ── */}
        <div
          className={cn(
            'w-72 shrink-0 border-l flex flex-col p-4 gap-3 overflow-y-auto transition-colors',
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
          )}
        >
          <div className="flex items-center justify-between">
            <p className={cn('text-[11px] font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>
              Nesneler ({objects.length})
            </p>

            {/* Multi-selection count */}
            {selectedIds.size > 0 && (
              <span className="text-xs font-semibold text-sky-500">{selectedIds.size} Seçili</span>
            )}
          </div>

          {/* Filter Pills */}
          <div
            className={cn(
              'flex items-center p-0.5 rounded-lg border text-[11px]',
              isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'
            )}
          >
            {[
              { id: 'all', label: 'Tümü' },
              { id: 'text', label: 'Metin' },
              { id: 'image', label: 'Görsel/QR' },
              { id: 'moved', label: 'Taşınan' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSidebarFilter(tab.id as any)}
                className={cn(
                  'flex-1 py-1 rounded-md transition-all font-medium text-center',
                  sidebarFilter === tab.id
                    ? isDark
                      ? 'bg-sky-600 text-white shadow font-semibold'
                      : 'bg-white text-sky-600 shadow font-semibold'
                    : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Selected Object Info Card */}
          {selectedList.length === 1 ? (
            <div
              className={cn(
                'rounded-xl p-3 border space-y-2.5 shadow-sm',
                isDark ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-50 border-slate-200'
              )}
            >
              <div className="flex items-center justify-between">
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold',
                    selectedList[0].type === 'native-text'
                      ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                      : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  )}
                >
                  {selectedList[0].type === 'native-text' ? (
                    <>
                      <Type className="w-3.5 h-3.5" /> Metin
                    </>
                  ) : (
                    <>
                      <QrCode className="w-3.5 h-3.5" /> Görsel / QR
                    </>
                  )}
                </div>

                {selectedList[0].moved && (
                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded">
                    Taşındı
                  </span>
                )}
              </div>

              {/* Text preview */}
              {selectedList[0].text && (
                <div>
                  <p className={cn('text-[10px] font-semibold mb-0.5', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    İçerik:
                  </p>
                  <p
                    className={cn(
                      'text-xs p-2 rounded-lg border break-all line-clamp-3 font-mono',
                      isDark ? 'bg-slate-900/80 border-slate-700/80 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                    )}
                  >
                    "{selectedList[0].text}"
                  </p>
                </div>
              )}

              {/* Coordinates */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className={cn('p-1.5 rounded-md border', isDark ? 'bg-slate-900/60 border-slate-700/60' : 'bg-white border-slate-200')}>
                  <span className="text-slate-400 block text-[10px]">X Konumu:</span>
                  <span className="font-semibold">{Math.round(selectedList[0].x)} pt</span>
                </div>
                <div className={cn('p-1.5 rounded-md border', isDark ? 'bg-slate-900/60 border-slate-700/60' : 'bg-white border-slate-200')}>
                  <span className="text-slate-400 block text-[10px]">Y Konumu:</span>
                  <span className="font-semibold">{Math.round(selectedList[0].y)} pt</span>
                </div>
                <div className={cn('p-1.5 rounded-md border', isDark ? 'bg-slate-900/60 border-slate-700/60' : 'bg-white border-slate-200')}>
                  <span className="text-slate-400 block text-[10px]">Genişlik:</span>
                  <span className="font-semibold">{Math.round(selectedList[0].width)} pt</span>
                </div>
                <div className={cn('p-1.5 rounded-md border', isDark ? 'bg-slate-900/60 border-slate-700/60' : 'bg-white border-slate-200')}>
                  <span className="text-slate-400 block text-[10px]">Yükseklik:</span>
                  <span className="font-semibold">{Math.round(selectedList[0].height)} pt</span>
                </div>
              </div>

              {selectedList[0].moved && (
                <button
                  onClick={() => resetObject(pageId, selectedList[0].id)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-semibold border border-amber-500/30 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Orijinal Konuma Geri Al
                </button>
              )}
            </div>
          ) : selectedList.length > 1 ? (
            <div
              className={cn(
                'rounded-xl p-3 border space-y-2 shadow-sm',
                isDark ? 'bg-slate-800/70 border-slate-700' : 'bg-sky-50/80 border-sky-200'
              )}
            >
              <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-bold text-xs">
                <CheckSquare className="w-4 h-4" />
                {selectedList.length} Nesne Birlikte Seçildi
              </div>
              <p className={cn('text-[11px]', isDark ? 'text-slate-400' : 'text-slate-600')}>
                Herhangi birini tutup sürüklediğinizde <strong>tümü grup halinde birlikte taşınır</strong>.
              </p>
              <button
                onClick={() => resetMultipleObjects(pageId, Array.from(selectedIds))}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-semibold border border-amber-500/30 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Seçilenleri Orijinal Konuma Al
              </button>
            </div>
          ) : (
            <div
              className={cn(
                'p-3 rounded-xl border flex items-center gap-2 text-xs',
                isDark ? 'bg-slate-800/40 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
              )}
            >
              <Info className="w-4 h-4 shrink-0 text-sky-500" />
              <span>
                Sayfadaki nesneleri tek tek tıklayarak veya <strong>fareyle alan çizerek</strong> çoklu seçebilirsiniz.
              </span>
            </div>
          )}

          {/* List of Objects on Current Page */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-[120px]">
            {filteredObjects.map((obj) => {
              const isSelected = selectedIds.has(obj.id);
              const isText = obj.type === 'native-text';

              return (
                <div
                  key={obj.id}
                  onClick={(e) => handleObjectClick(e, obj)}
                  className={cn(
                    'p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-center gap-2 select-none',
                    isSelected
                      ? 'bg-sky-500/20 border-sky-500 text-sky-700 dark:text-sky-300 font-semibold shadow-sm'
                      : isDark
                      ? 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                      : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                  )}
                >
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      isText ? 'bg-sky-500' : 'bg-emerald-500',
                      obj.moved && 'ring-2 ring-amber-400'
                    )}
                  />

                  <div className="flex-1 truncate">
                    {isText ? (
                      <span>"{obj.text}"</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Görsel / QR</span>
                    )}
                  </div>

                  {obj.moved && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.5 rounded shrink-0">
                      Taşındı
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick Legend & Help */}
          <div
            className={cn(
              'border-t pt-3 space-y-1.5 text-[11px]',
              isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              <span>Metin Blokları</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Görseller & QR Kodlar</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Taşınmış Öğeler</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Status Bar ── */}
      <div
        className={cn(
          'h-8 shrink-0 border-t flex items-center px-4 gap-4 text-xs select-none transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-600'
        )}
      >
        <span>
          Sayfa {pageIndex + 1} / {totalPages}
        </span>
        <span>•</span>
        <span>{objects.length} nesne algılandı</span>
        <span>•</span>
        <span className="text-sky-600 dark:text-sky-400 font-medium">{selectedIds.size} seçili</span>
        {movedCount > 0 && (
          <>
            <span>•</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">{movedCount} nesne taşındı</span>
          </>
        )}
        <span className={cn('ml-auto text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
          💡 İpucu: Boşluğa tıklayıp kutu çizerek veya Ctrl/Shift ile iç içe ve çoklu nesneleri birlikte taşıyabilirsiniz.
        </span>
      </div>
    </div>
  );
};
