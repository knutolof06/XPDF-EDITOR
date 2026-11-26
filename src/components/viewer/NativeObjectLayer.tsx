import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { PdfNativeObject } from '@/types/annotations';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { extractAllNativeObjects } from '@/core/pdf/pdf-native-extractor';
import { cn } from '@/utils/cn';
import { RotateCcw, Move, Trash2 } from 'lucide-react';

interface NativeObjectLayerProps {
  page: PdfPageModel;
  scale: number;
  pdfPage: pdfjsLib.PDFPageProxy | null;
}

/**
 * NativeObjectLayer renders selectable/draggable/editable overlays over existing PDF content.
 * Active when inline native-edit mode is enabled and activeTool === 'select'.
 */
export const NativeObjectLayer: React.FC<NativeObjectLayerProps> = ({
  page,
  scale,
  pdfPage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const extractedKeyRef = useRef<string | null>(null);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const { objectsByPage, setObjects, moveObject, resetObject, updateObjectText, deleteObject } =
    useNativeObjectStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string>('');

  const dragRef = useRef<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    startObjX: number;
    startObjY: number;
  } | null>(null);

  const objects: PdfNativeObject[] = objectsByPage[page.id] ?? [];

  useEffect(() => {
    if (!pdfPage) return;
    const extractKey = `${page.id}_rot${page.rotation}`;
    if (extractedKeyRef.current === extractKey) return;
    extractedKeyRef.current = extractKey;

    let cancelled = false;
    extractAllNativeObjects(pdfPage, page.id).then((objs) => {
      if (cancelled) return;
      // Normalize coordinates when page is rotated relative to unrotated PDF.js extraction
      const baseZero = pdfPage.getViewport({ scale: 1, rotation: 0 });
      const w0 = baseZero.width || 595.28;
      const h0 = baseZero.height || 841.89;
      const rot = ((page.rotation % 360) + 360) % 360;

      const transformed =
        rot === 0
          ? objs
          : objs.map((obj) => {
              let nx = obj.x;
              let ny = obj.y;
              let nw = obj.width;
              let nh = obj.height;
              if (rot === 90) {
                nx = h0 - obj.y - obj.height;
                ny = obj.x;
                nw = obj.height;
                nh = obj.width;
              } else if (rot === 180) {
                nx = w0 - obj.x - obj.width;
                ny = h0 - obj.y - obj.height;
              } else if (rot === 270) {
                nx = obj.y;
                ny = w0 - obj.x - obj.width;
                nw = obj.height;
                nh = obj.width;
              }
              return {
                ...obj,
                originalText: obj.originalText ?? obj.text,
                x: nx,
                y: ny,
                width: nw,
                height: nh,
                originalX: nx,
                originalY: ny,
                originalWidth: nw,
                originalHeight: nh,
              };
            });

      setObjects(page.id, transformed);
    });

    return () => {
      cancelled = true;
    };
  }, [pdfPage, page.id, page.rotation, setObjects]);

  if (activeTool !== 'select') return null;

  const visibleObjects = objects.filter((o) => !o.deleted);
  if (visibleObjects.length === 0) return null;

  const pageWidthPt = page.width || 595.28;
  const pageHeightPt = page.height || 841.89;

  const handleMouseDown = (e: React.MouseEvent, obj: PdfNativeObject) => {
    if (editingId === obj.id) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(obj.id);

    dragRef.current = {
      id: obj.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startObjX: obj.x,
      startObjY: obj.y,
    };

    const onMouseMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (me.clientX - dragRef.current.startMouseX) / scale;
      const dy = (me.clientY - dragRef.current.startMouseY) / scale;
      const newX = Math.max(0, Math.min(pageWidthPt, dragRef.current.startObjX + dx));
      const newY = Math.max(0, Math.min(pageHeightPt, dragRef.current.startObjY + dy));
      moveObject(page.id, dragRef.current.id, newX, newY);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      ref={containerRef}
      className="no-print absolute inset-0 z-20 pointer-events-none overflow-visible"
    >
      {visibleObjects.map((obj) => {
        const isSelected = selectedId === obj.id;
        const isEditing = editingId === obj.id;
        const x = obj.x * scale;
        const y = obj.y * scale;
        const w = obj.width * scale;
        const h = obj.height * scale;

        return (
          <div
            key={obj.id}
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: `${Math.max(w, 12)}px`,
              height: `${Math.max(h, 12)}px`,
            }}
            className={cn(
              'absolute pointer-events-auto cursor-move group select-none transition-all duration-75',
              'hover:bg-sky-400/15 hover:ring-1 hover:ring-sky-400/70 rounded-sm',
              isSelected && 'bg-sky-400/20 ring-2 ring-sky-500 rounded-sm shadow-md'
            )}
            onMouseDown={(e) => handleMouseDown(e, obj)}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(obj.id);
            }}
            onDoubleClick={(e) => {
              if (obj.type === 'native-text') {
                e.stopPropagation();
                setSelectedId(obj.id);
                setEditingId(obj.id);
                setDraftText(obj.text || '');
              }
            }}
            title={
              obj.type === 'native-text' && obj.text
                ? `"${obj.text.slice(0, 40)}" — taşımak için sürükleyin, düzenlemek için çift tıklayın`
                : 'Görsel nesne — taşımak için sürükleyin'
            }
          >
            {/* Inline Edit Input */}
            {isEditing && (
              <input
                type="text"
                aria-label="Yerel metin içeriğini düzenle"
                value={draftText}
                autoFocus
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setDraftText(e.target.value)}
                onBlur={() => {
                  setEditingId(null);
                  if (draftText !== obj.text) {
                    updateObjectText(page.id, obj.id, draftText);
                  }
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    setEditingId(null);
                    if (draftText !== obj.text) {
                      updateObjectText(page.id, obj.id, draftText);
                    }
                  } else if (e.key === 'Escape') {
                    setEditingId(null);
                    setDraftText(obj.text || '');
                  }
                }}
                className="w-full h-full min-w-[80px] bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-sky-500 rounded px-1 text-xs focus:outline-none shadow-lg"
              />
            )}

            {/* Move icon hint on hover */}
            {!obj.moved && !obj.isEdited && !isEditing && (
              <div className="absolute -top-5 left-0 hidden group-hover:flex items-center gap-1 bg-slate-900/90 text-white text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap shadow-lg z-30 pointer-events-none">
                <Move className="w-2.5 h-2.5 text-sky-400" />
                <span>{obj.type === 'native-image' ? 'Görsel Taşı' : 'Taşı / Çift Tıkla'}</span>
              </div>
            )}

            {/* Moved/Edited badge + Reset + Delete actions */}
            {(obj.moved || obj.isEdited || isSelected) && !isEditing && (
              <div
                className="absolute -top-6 left-0 flex items-center gap-1 bg-amber-500/95 text-white text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap shadow-lg z-30 pointer-events-auto"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="font-semibold">
                  {obj.isEdited ? 'Düzenlendi' : obj.moved ? 'Taşındı' : 'Seçili'}
                </span>
                {(obj.moved || obj.isEdited) && (
                  <button
                    type="button"
                    aria-label="Orijinal konuma sıfırla"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetObject(page.id, obj.id);
                      if (selectedId === obj.id) setSelectedId(null);
                    }}
                    className="flex items-center gap-0.5 hover:bg-amber-700/60 rounded px-1 transition-colors"
                    title="Orijinal konuma geri al"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Sıfırla
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Nesneyi sil"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteObject(page.id, obj.id);
                    setSelectedId(null);
                  }}
                  className="flex items-center gap-0.5 hover:bg-rose-600/80 rounded px-1 transition-colors"
                  title="Nesneyi Sil (Gizle)"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
