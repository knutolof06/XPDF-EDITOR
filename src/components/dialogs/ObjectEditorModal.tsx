import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { PdfNativeObject } from '@/types/annotations';
import { extractAllNativeObjects } from '@/core/pdf/pdf-native-extractor';
import { historyManager, GenericCommand } from '@/core/history/command-manager';
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
  Trash2,
  Edit3,
} from 'lucide-react';
import {
  useResolvedDarkMode,
  useModalEscape,
  markCurrentDocumentModified,
} from './modal-utils';

function cloneObjectsMap(
  source: Record<string, PdfNativeObject[]>
): Record<string, PdfNativeObject[]> {
  const copy: Record<string, PdfNativeObject[]> = {};
  for (const [k, list] of Object.entries(source)) {
    copy[k] = list.map((item) => ({
      ...item,
      transform: item.transform ? [...item.transform] : undefined,
    }));
  }
  return copy;
}

interface DisplayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toDisplayBox(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  unrotatedW: number,
  unrotatedH: number
): DisplayBox {
  const normRot = ((rotation % 360) + 360) % 360;
  if (normRot === 90) {
    return {
      x: unrotatedH - (y + height),
      y: x,
      width: height,
      height: width,
    };
  }
  if (normRot === 180) {
    return {
      x: unrotatedW - (x + width),
      y: unrotatedH - (y + height),
      width,
      height,
    };
  }
  if (normRot === 270) {
    return {
      x: y,
      y: unrotatedW - (x + width),
      width: height,
      height: width,
    };
  }
  return { x, y, width, height };
}

function toPdfDelta(drx: number, dry: number, rotation: number): { dx: number; dy: number } {
  const normRot = ((rotation % 360) + 360) % 360;
  if (normRot === 90) return { dx: dry, dy: -drx };
  if (normRot === 180) return { dx: -drx, dy: -dry };
  if (normRot === 270) return { dx: -dry, dy: drx };
  return { dx: drx, dy: dry };
}

export const ObjectEditorModal: React.FC = () => {
  const { isObjectEditorOpen, setObjectEditorOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const isDark = useResolvedDarkMode();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel?: () => void; promise: Promise<void> } | null>(null);
  const extractedPagesRef = useRef<Set<string>>(new Set());
  const cancelledEditRef = useRef<boolean>(false);
  const dragRafRef = useRef<number | null>(null);
  const marqueeRafRef = useRef<number | null>(null);
  const activeListenersRef = useRef<Array<{ type: 'mousemove' | 'mouseup'; fn: (ev: MouseEvent) => void }>>([]);

  // Transactional draft store per pageId (discarded on Cancel / Esc)
  const [draftByPage, setDraftByPage] = useState<Record<string, PdfNativeObject[]>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [isLoading, setIsLoading] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [unrotatedSize, setUnrotatedSize] = useState<{ width: number; height: number }>({
    width: 595.28,
    height: 841.89,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'text' | 'image' | 'moved'>('all');

  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTextValue, setEditTextValue] = useState<string>('');

  const clearWindowDragListeners = useCallback(() => {
    for (const item of activeListenersRef.current) {
      window.removeEventListener(item.type, item.fn);
    }
    activeListenersRef.current = [];
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (marqueeRafRef.current) {
      cancelAnimationFrame(marqueeRafRef.current);
      marqueeRafRef.current = null;
    }
  }, []);

  // Initialize local draft snapshot and sync pageIndex on modal open or document switch
  const docId = currentDocument?.id;

  useEffect(() => {
    if (!isObjectEditorOpen || !docId) return;
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;

    const initialStoreObjects = useNativeObjectStore.getState().objectsByPage;
    setDraftByPage(cloneObjectsMap(initialStoreObjects));

    const preExtracted = new Set<string>();
    for (const pg of doc.pages) {
      if (pg.id in initialStoreObjects) {
        preExtracted.add(pg.id);
      }
    }
    extractedPagesRef.current = preExtracted;

    const clampedPageIdx = Math.max(
      0,
      Math.min(doc.activePageIndex || 0, Math.max(0, doc.pages.length - 1))
    );
    setPageIndex(clampedPageIdx);
    setSelectedIds(new Set());
    setEditingId(null);
    setMarquee(null);
    setSidebarFilter('all');

    return () => {
      clearWindowDragListeners();
    };
  }, [isObjectEditorOpen, docId, clearWindowDragListeners]);

  const totalPages = currentDocument?.pages.length || 0;
  const safePageIndex = totalPages > 0 ? Math.max(0, Math.min(pageIndex, totalPages - 1)) : 0;
  const activePage = currentDocument?.pages[safePageIndex];
  const pageId = activePage?.id || '';
  const pageRotation = activePage?.rotation || 0;
  const objects = useMemo<PdfNativeObject[]>(
    () => draftByPage[pageId] ?? [],
    [draftByPage, pageId]
  );

  const movedCount = objects.filter((o) => o.moved).length;
  const deletedCount = objects.filter((o) => o.deleted).length;
  const editedCount = objects.filter((o) => o.isEdited).length;

  const totalModifiedAcrossDoc = Object.values(draftByPage).reduce(
    (sum, list) => sum + list.filter((o) => o.moved || o.deleted || o.isEdited).length,
    0
  );

  // Draft mutation helpers
  const draftMoveMultiple = useCallback(
    (targetPageId: string, updates: { id: string; x: number; y: number }[]) => {
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      setDraftByPage((prev) => {
        const list = prev[targetPageId];
        if (!list) return prev;
        return {
          ...prev,
          [targetPageId]: list.map((obj) => {
            const u = updateMap.get(obj.id);
            return u ? { ...obj, x: u.x, y: u.y, moved: true } : obj;
          }),
        };
      });
    },
    []
  );

  const draftUpdateText = useCallback(
    (targetPageId: string, id: string, newText: string) => {
      setDraftByPage((prev) => {
        const list = prev[targetPageId];
        if (!list) return prev;
        return {
          ...prev,
          [targetPageId]: list.map((obj) =>
            obj.id === id
              ? {
                  ...obj,
                  text: newText,
                  originalText: obj.originalText ?? obj.text,
                  moved: true,
                  isEdited: true,
                }
              : obj
          ),
        };
      });
    },
    []
  );

  const draftDeleteMultiple = useCallback((targetPageId: string, ids: string[]) => {
    const idSet = new Set(ids);
    setDraftByPage((prev) => {
      const list = prev[targetPageId];
      if (!list) return prev;
      return {
        ...prev,
        [targetPageId]: list.map((obj) =>
          idSet.has(obj.id) ? { ...obj, deleted: true } : obj
        ),
      };
    });
  }, []);

  const draftRestoreObject = useCallback((targetPageId: string, id: string) => {
    setDraftByPage((prev) => {
      const list = prev[targetPageId];
      if (!list) return prev;
      return {
        ...prev,
        [targetPageId]: list.map((obj) =>
          obj.id === id ? { ...obj, deleted: false } : obj
        ),
      };
    });
  }, []);

  const draftResetObjects = useCallback((targetPageId: string, ids: string[] | 'all') => {
    const idSet = ids === 'all' ? null : new Set(ids);
    setDraftByPage((prev) => {
      const list = prev[targetPageId];
      if (!list) return prev;
      return {
        ...prev,
        [targetPageId]: list.map((obj) =>
          idSet === null || idSet.has(obj.id)
            ? {
                ...obj,
                x: obj.originalX,
                y: obj.originalY,
                text: obj.originalText ?? obj.text,
                moved: false,
                deleted: false,
                isEdited: false,
              }
            : obj
        ),
      };
    });
  }, []);

  const handleClose = useCallback(() => {
    clearWindowDragListeners();
    setEditingId(null);
    setObjectEditorOpen(false);
  }, [clearWindowDragListeners, setObjectEditorOpen]);

  // Capture-phase Escape: cancel inline edit first, otherwise cleanly discard draft and close modal
  useModalEscape(isObjectEditorOpen, handleClose, {
    onInterceptEscape: () => {
      if (editingId) {
        cancelledEditRef.current = true;
        setEditingId(null);
        return true;
      }
      return false;
    },
  });

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0 || !pageId) return;
    draftDeleteMultiple(pageId, Array.from(selectedIds));
    addToast(`${selectedIds.size} nesne silindi (Uygula ile kalıcı olarak maskelenecek).`, 'info');
  }, [selectedIds, pageId, draftDeleteMultiple, addToast]);

  const handleStartEdit = useCallback((obj: PdfNativeObject) => {
    if (obj.type === 'native-text') {
      cancelledEditRef.current = false;
      setEditingId(obj.id);
      setEditTextValue(obj.text || '');
    }
  }, []);

  useEffect(() => {
    if (!isObjectEditorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        handleDeleteSelected();
      } else if (e.key.toLowerCase() === 'e' && selectedIds.size === 1) {
        const selObj = objects.find((o) => selectedIds.has(o.id) && !o.deleted);
        if (selObj && selObj.type === 'native-text') {
          e.preventDefault();
          handleStartEdit(selObj);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isObjectEditorOpen, selectedIds, objects, handleDeleteSelected, handleStartEdit]);

  // Render canvas & extract objects once per pageId (never loop on 0-object scanned pages)
  useEffect(() => {
    if (!isObjectEditorOpen || !pdfDocProxy || !activePage || !canvasRef.current) return;

    let isCancelled = false;

    const render = async () => {
      setIsLoading(true);
      setSelectedIds(new Set());
      setEditingId(null);

      try {
        if (renderTaskRef.current?.cancel) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
        }

        const pdfPage = await pdfDocProxy.getPage(activePage.sourcePageIndex + 1);
        if (isCancelled) return;

        const baseUnrotated = pdfPage.getViewport({ scale: 1, rotation: 0 });
        setUnrotatedSize({ width: baseUnrotated.width, height: baseUnrotated.height });

        const viewport = pdfPage.getViewport({ scale, rotation: activePage.rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        const vpW = Math.floor(viewport.width);
        const vpH = Math.floor(viewport.height);
        canvas.width = vpW;
        canvas.height = vpH;
        canvas.style.width = `${vpW}px`;
        canvas.style.height = `${vpH}px`;
        setViewportSize({ width: vpW, height: vpH });

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (isCancelled) return;

        setIsLoading(false);

        if (!extractedPagesRef.current.has(pageId)) {
          extractedPagesRef.current.add(pageId);
          const objs = await extractAllNativeObjects(pdfPage, pageId);
          if (!isCancelled) {
            const withOriginals = objs.map((o) => ({
              ...o,
              originalText: o.originalText ?? o.text,
            }));
            setDraftByPage((prev) => {
              if (pageId in prev) return prev;
              return { ...prev, [pageId]: withOriginals };
            });
          }
        }
      } catch (err: unknown) {
        const errObj = err as { name?: string };
        if (errObj?.name !== 'RenderingCancelledException') {
          console.error('ObjectEditor render error:', err);
          setIsLoading(false);
        }
      }
    };

    render();

    return () => {
      isCancelled = true;
    };
  }, [isObjectEditorOpen, safePageIndex, pdfDocProxy, activePage, pageId, scale]);

  const handleObjectClick = (e: React.MouseEvent, obj: PdfNativeObject) => {
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(obj.id)) next.delete(obj.id);
        else next.add(obj.id);
        return next;
      });
    } else {
      setSelectedIds(new Set([obj.id]));
    }
  };

  const handleDragStart = useCallback(
    (e: React.MouseEvent, obj: PdfNativeObject) => {
      e.stopPropagation();
      e.preventDefault();

      let currentSelected = selectedIds;
      if (!selectedIds.has(obj.id)) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          currentSelected = new Set(selectedIds).add(obj.id);
          setSelectedIds(currentSelected);
        } else {
          currentSelected = new Set([obj.id]);
          setSelectedIds(currentSelected);
        }
      }

      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of currentSelected) {
        const targetObj = objects.find((o) => o.id === id && !o.deleted);
        if (targetObj) {
          startPositions.set(id, { x: targetObj.x, y: targetObj.y });
        }
      }

      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPositions,
      };

      let pendingMouse: { clientX: number; clientY: number } | null = null;

      const onMouseMove = (me: MouseEvent) => {
        pendingMouse = { clientX: me.clientX, clientY: me.clientY };
        if (dragRafRef.current) return;

        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          if (!dragRef.current || !pendingMouse) return;

          const drx = (pendingMouse.clientX - dragRef.current.startMouseX) / scale;
          const dry = (pendingMouse.clientY - dragRef.current.startMouseY) / scale;
          const { dx, dy } = toPdfDelta(drx, dry, pageRotation);

          const updates: { id: string; x: number; y: number }[] = [];
          dragRef.current.startPositions.forEach((startPos, id) => {
            updates.push({
              id,
              x: Math.max(0, startPos.x + dx),
              y: Math.max(0, startPos.y + dy),
            });
          });

          draftMoveMultiple(pageId, updates);
        });
      };

      const onMouseUp = () => {
        dragRef.current = null;
        clearWindowDragListeners();
      };

      clearWindowDragListeners();
      activeListenersRef.current = [
        { type: 'mousemove', fn: onMouseMove },
        { type: 'mouseup', fn: onMouseUp },
      ];
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [scale, pageId, pageRotation, selectedIds, objects, draftMoveMultiple, clearWindowDragListeners]
  );

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !canvasRef.current) return;
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelectedIds(new Set());
    }

    const initialRect = canvasRef.current.getBoundingClientRect();
    const startX = (e.clientX - initialRect.left) / scale;
    const startY = (e.clientY - initialRect.top) / scale;

    setMarquee({ startX, startY, currentX: startX, currentY: startY });

    let pendingEvent: { clientX: number; clientY: number; multi: boolean } | null = null;

    const onMouseMove = (me: MouseEvent) => {
      pendingEvent = {
        clientX: me.clientX,
        clientY: me.clientY,
        multi: me.ctrlKey || me.metaKey || me.shiftKey,
      };
      if (marqueeRafRef.current) return;

      marqueeRafRef.current = requestAnimationFrame(() => {
        marqueeRafRef.current = null;
        if (!pendingEvent || !canvasRef.current) return;

        // Read fresh canvas rect inside rAF so scroll never makes it stale
        const liveRect = canvasRef.current.getBoundingClientRect();
        const currentX = (pendingEvent.clientX - liveRect.left) / scale;
        const currentY = (pendingEvent.clientY - liveRect.top) / scale;
        setMarquee((m) => (m ? { ...m, currentX, currentY } : null));

        const minX = Math.min(startX, currentX);
        const maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY);
        const maxY = Math.max(startY, currentY);

        const enclosed = objects.filter((o) => {
          if (o.deleted) return false;
          const box = toDisplayBox(
            o.x,
            o.y,
            o.width,
            o.height,
            pageRotation,
            unrotatedSize.width,
            unrotatedSize.height
          );
          return (
            box.x < maxX &&
            box.x + box.width > minX &&
            box.y < maxY &&
            box.y + box.height > minY
          );
        });

        setSelectedIds((prev) => {
          const next = pendingEvent?.multi ? new Set(prev) : new Set<string>();
          enclosed.forEach((o) => next.add(o.id));
          return next;
        });
      });
    };

    const onMouseUp = () => {
      setMarquee(null);
      clearWindowDragListeners();
    };

    clearWindowDragListeners();
    activeListenersRef.current = [
      { type: 'mousemove', fn: onMouseMove },
      { type: 'mouseup', fn: onMouseUp },
    ];
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleApply = () => {
    const prevSnapshot = cloneObjectsMap(useNativeObjectStore.getState().objectsByPage);
    const nextSnapshot = cloneObjectsMap(draftByPage);

    const applySnapshot = (snapshot: Record<string, PdfNativeObject[]>) => {
      useNativeObjectStore.setState({ objectsByPage: cloneObjectsMap(snapshot) });
      markCurrentDocumentModified();
    };

    if (totalModifiedAcrossDoc > 0) {
      historyManager.execute(
        new GenericCommand(
          `${totalModifiedAcrossDoc} nesne düzenlemesi uygulandı`,
          () => applySnapshot(nextSnapshot),
          () => applySnapshot(prevSnapshot)
        )
      );
      addToast(`${totalModifiedAcrossDoc} nesne değişikliği dökümana uygulandı.`, 'success');
    } else {
      useNativeObjectStore.setState({ objectsByPage: nextSnapshot });
      addToast('Değişiklik yapılmadı.', 'info');
    }

    clearWindowDragListeners();
    setObjectEditorOpen(false);
  };

  const filteredObjects = objects.filter((o) => {
    if (sidebarFilter === 'text') return o.type === 'native-text';
    if (sidebarFilter === 'image') return o.type === 'native-image';
    if (sidebarFilter === 'moved') return o.moved || o.isEdited || o.deleted;
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
      {/* Top Header Toolbar */}
      <div
        className={cn(
          'h-14 shrink-0 border-b flex items-center px-4 gap-3 z-30 transition-colors',
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

        <span className={cn('text-xs truncate max-w-[180px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
          {currentDocument.name}
        </span>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 bg-sky-500/15 text-sky-600 dark:text-sky-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-sky-500/30">
            <CheckSquare className="w-3.5 h-3.5" />
            {selectedIds.size} seçili
          </div>
        )}

        {movedCount > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {movedCount} taşındı
          </div>
        )}

        {editedCount > 0 && (
          <div className="flex items-center gap-1.5 bg-blue-500/15 text-blue-600 dark:text-blue-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-blue-500/30">
            <Edit3 className="w-3.5 h-3.5" />
            {editedCount} düzenlendi
          </div>
        )}

        {deletedCount > 0 && (
          <div className="flex items-center gap-1.5 bg-rose-500/15 text-rose-600 dark:text-rose-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-rose-500/30">
            <Trash2 className="w-3.5 h-3.5" />
            {deletedCount} silindi
          </div>
        )}

        {/* Action Controls */}
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size === 1 && (() => {
            const selObj = objects.find((o) => selectedIds.has(o.id) && !o.deleted);
            if (selObj?.type === 'native-text') {
              return (
                <button
                  type="button"
                  onClick={() => handleStartEdit(selObj)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-sm transition-colors"
                  title="Metni Düzenle (E tuşu veya çift tık)"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Metni Düzenle
                </button>
              );
            }
            return null;
          })()}

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-sm transition-colors"
              title="Seçili nesneleri sil (Delete tuşu)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Sil ({selectedIds.size})
            </button>
          )}

          {/* Zoom controls */}
          <div
            className={cn(
              'flex items-center rounded-lg px-2 py-1 text-xs border font-medium',
              isDark ? 'bg-slate-800/90 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
            )}
          >
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.2).toFixed(2))))}
              className="px-1.5 hover:text-sky-500 transition-colors font-bold"
            >
              −
            </button>
            <span className="w-12 text-center font-mono">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3, Number((s + 0.2).toFixed(2))))}
              className="px-1.5 hover:text-sky-500 transition-colors font-bold"
            >
              +
            </button>
          </div>

          {selectedIds.size > 0 ? (
            <button
              type="button"
              onClick={() => draftResetObjects(pageId, Array.from(selectedIds))}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium',
                isDark
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
              )}
              title="Seçili nesnelerin konumunu ve durumunu sıfırla"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Seçilenleri Sıfırla
            </button>
          ) : (
            <button
              type="button"
              onClick={() => draftResetObjects(pageId, 'all')}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium',
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              )}
              title="Sayfadaki tüm değişiklikleri sıfırla"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Tümünü Sıfırla
            </button>
          )}

          <button
            type="button"
            onClick={() => setSelectedIds(new Set(objects.filter((o) => !o.deleted).map((o) => o.id)))}
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

          <button
            type="button"
            onClick={handleClose}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border',
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            )}
          >
            İptal
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors shadow-md hover:shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            Uygula & Kapat
          </button>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Kapat"
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
            )}
            title="İptal Et ve Kapat (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Page Navigator */}
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
            const pgObjs = draftByPage[pg.id] ?? [];
            const pgMoved = pgObjs.filter((o) => o.moved || o.isEdited || o.deleted).length;
            const isActive = safePageIndex === i;

            return (
              <button
                key={pg.id}
                type="button"
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

        {/* Center: Canvas & Interactive Overlays */}
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
              width: viewportSize.width > 0 ? `${viewportSize.width}px` : 'auto',
              height: viewportSize.height > 0 ? `${viewportSize.height}px` : 'auto',
            }}
            className="relative inline-block shadow-2xl rounded-sm transition-all"
          >
            <canvas ref={canvasRef} className="block bg-white rounded-sm pointer-events-none" />

            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 dark:bg-slate-900/70 rounded-sm z-40 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin mb-2" />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Sayfa ve nesneler taranıyor...
                </span>
              </div>
            )}

            {!isLoading && (
              <div className="absolute inset-0 pointer-events-none overflow-visible">
                {/* 1. Whiteout Masks for Original Spots */}
                {objects.map((obj) => {
                  if (!obj.moved && !obj.deleted && !obj.isEdited) return null;
                  const origBox = toDisplayBox(
                    obj.originalX,
                    obj.originalY,
                    obj.originalWidth,
                    obj.originalHeight,
                    pageRotation,
                    unrotatedSize.width,
                    unrotatedSize.height
                  );
                  return (
                    <div
                      key={`mask_${obj.id}`}
                      style={{
                        left: `${origBox.x * scale - 1}px`,
                        top: `${origBox.y * scale - 1}px`,
                        width: `${origBox.width * scale + 2}px`,
                        height: `${origBox.height * scale + 2}px`,
                      }}
                      className={cn(
                        'absolute bg-white z-10 border border-dashed rounded-[2px]',
                        obj.deleted ? 'border-rose-400/80 bg-rose-50/60' : 'border-amber-400/60'
                      )}
                      title={obj.deleted ? 'Silindi (beyazla kapatıldı)' : 'Orijinal konum (beyazla kapatıldı)'}
                    />
                  );
                })}

                {/* 2. Interactive Objects */}
                {objects.map((obj) => {
                  const isSelected = selectedIds.has(obj.id);
                  const isText = obj.type === 'native-text';
                  const isEditing = editingId === obj.id;
                  const dispBox = toDisplayBox(
                    obj.x,
                    obj.y,
                    obj.width,
                    obj.height,
                    pageRotation,
                    unrotatedSize.width,
                    unrotatedSize.height
                  );
                  const origDispBox = toDisplayBox(
                    obj.originalX,
                    obj.originalY,
                    obj.originalWidth,
                    obj.originalHeight,
                    pageRotation,
                    unrotatedSize.width,
                    unrotatedSize.height
                  );
                  const x = dispBox.x * scale;
                  const y = dispBox.y * scale;
                  const w = Math.max(dispBox.width * scale, 14);
                  const h = Math.max(dispBox.height * scale, 14);

                  if (obj.deleted) {
                    return (
                      <div
                        key={obj.id}
                        style={{
                          left: `${origDispBox.x * scale}px`,
                          top: `${origDispBox.y * scale}px`,
                          width: `${Math.max(origDispBox.width * scale, 40)}px`,
                          height: `${Math.max(origDispBox.height * scale, 20)}px`,
                        }}
                        className="absolute pointer-events-auto z-20 border-2 border-dashed border-rose-500/70 bg-rose-500/10 rounded flex items-center justify-between px-2 text-[10px] text-rose-600 dark:text-rose-400 font-bold"
                      >
                        <span className="line-through truncate opacity-70">
                          {isText ? obj.text : 'Görsel'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            draftRestoreObject(pageId, obj.id);
                          }}
                          className="ml-1 px-1.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors text-[9px] shadow"
                          title="Silmeyi geri al"
                        >
                          Kurtar
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={obj.id}
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${w}px`,
                        height: `${h}px`,
                      }}
                      onMouseDown={(e) => !isEditing && handleDragStart(e, obj)}
                      onClick={(e) => handleObjectClick(e, obj)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (isText) handleStartEdit(obj);
                      }}
                      className={cn(
                        'absolute pointer-events-auto cursor-move select-none transition-all duration-75 flex items-center overflow-visible',
                        !isSelected && !obj.moved && !obj.isEdited && (isText
                          ? 'hover:bg-sky-500/10 hover:ring-1 hover:ring-sky-500/60'
                          : 'hover:bg-emerald-500/15 hover:ring-1 hover:ring-emerald-500/80 bg-emerald-500/5'
                        ),
                        isSelected && (isText
                          ? 'bg-sky-500/20 ring-2 ring-sky-500 z-30 shadow-lg'
                          : 'bg-emerald-500/25 ring-2 ring-emerald-500 z-30 shadow-lg'
                        ),
                        (obj.moved || obj.isEdited) && 'ring-2 ring-amber-500 bg-amber-500/10 z-20 shadow-md'
                      )}
                      title={
                        isText
                          ? `Metin: "${(obj.text || '').slice(0, 50)}" (Düzenlemek için çift tıklayın)`
                          : `Görsel / QR Kod (${Math.round(obj.width)}x${Math.round(obj.height)})`
                      }
                    >
                      {isEditing ? (
                        <div
                          className="absolute inset-0 z-50 flex items-center bg-white rounded shadow-xl p-0.5 min-w-[140px] min-h-[26px]"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editTextValue}
                            onChange={(e) => setEditTextValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelledEditRef.current = false;
                                draftUpdateText(pageId, obj.id, editTextValue);
                                setEditingId(null);
                                addToast('Metin güncellendi.', 'success', 1500);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelledEditRef.current = true;
                                setEditingId(null);
                              }
                            }}
                            onBlur={() => {
                              if (!cancelledEditRef.current) {
                                draftUpdateText(pageId, obj.id, editTextValue);
                              }
                              cancelledEditRef.current = false;
                              setEditingId(null);
                            }}
                            className="w-full h-full text-xs font-medium border border-sky-500 rounded px-1.5 py-0.5 text-slate-900 bg-sky-50/50 focus:outline-none"
                          />
                        </div>
                      ) : (
                        <>
                          {isText && (obj.moved || obj.isEdited) && (
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

                          {!isText && obj.moved && (
                            <div className="w-full h-full bg-emerald-50 border border-emerald-400 rounded flex flex-col items-center justify-center p-1 text-emerald-800 shadow-sm">
                              <QrCode className="w-4 h-4 text-emerald-600 mb-0.5" />
                              <span className="text-[9px] font-bold">Görsel / QR</span>
                            </div>
                          )}

                          {(obj.moved || obj.isEdited) && (
                            <div
                              className="absolute -top-6 left-0 flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg z-40 whitespace-nowrap pointer-events-auto"
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <span>{obj.isEdited ? 'Düzenlendi' : 'Taşındı'}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  draftResetObjects(pageId, [obj.id]);
                                }}
                                className="hover:bg-amber-600 rounded px-1 transition-colors flex items-center gap-0.5"
                                title="Orijinal haline sıfırla"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

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

        {/* Right: Properties & Object List Panel */}
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
            {selectedIds.size > 0 && (
              <span className="text-xs font-semibold text-sky-500">{selectedIds.size} Seçili</span>
            )}
          </div>

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
              { id: 'moved', label: 'Değişen' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSidebarFilter(tab.id as 'all' | 'text' | 'image' | 'moved')}
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

              {(selectedList[0].moved || selectedList[0].isEdited || selectedList[0].deleted) && (
                <button
                  type="button"
                  onClick={() => draftResetObjects(pageId, [selectedList[0].id])}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-semibold border border-amber-500/30 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Orijinal Haline Al
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
                type="button"
                onClick={() => draftResetObjects(pageId, Array.from(selectedIds))}
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
                Değişiklikler <strong>Uygula & Kapat</strong> basılana kadar taslak olarak tutulur; İptal veya Esc ile geri alınır.
              </span>
            </div>
          )}

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
                      (obj.moved || obj.isEdited) && 'ring-2 ring-amber-400'
                    )}
                  />

                  <div className="flex-1 truncate">
                    {isText ? (
                      <span className={obj.deleted ? 'line-through opacity-50' : ''}>
                        "{obj.text}"
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Görsel / QR
                      </span>
                    )}
                  </div>

                  {obj.deleted ? (
                    <span className="text-[10px] bg-rose-500/20 text-rose-500 font-bold px-1.5 py-0.5 rounded shrink-0">
                      Silindi
                    </span>
                  ) : (obj.moved || obj.isEdited) && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.5 rounded shrink-0">
                      {obj.isEdited ? 'Düzenlendi' : 'Taşındı'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

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
              <span>Taşınmış / Düzenlenmiş Öğeler</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div
        className={cn(
          'h-8 shrink-0 border-t flex items-center px-4 gap-4 text-xs select-none transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-600'
        )}
      >
        <span>
          Sayfa {safePageIndex + 1} / {totalPages}
        </span>
        <span>•</span>
        <span>{objects.length} nesne algılandı</span>
        <span>•</span>
        <span className="text-sky-600 dark:text-sky-400 font-medium">{selectedIds.size} seçili</span>
        {totalModifiedAcrossDoc > 0 && (
          <>
            <span>•</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">
              {totalModifiedAcrossDoc} taslak değişiklik
            </span>
          </>
        )}
        <span className={cn('ml-auto text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
          İpucu: Boşluğa tıklayıp kutu çizerek çoklu seçebilir, metne çift tıklayarak düzenleyebilirsiniz.
        </span>
      </div>
    </div>
  );
};
