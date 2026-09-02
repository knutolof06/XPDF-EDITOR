import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { PdfNativeObject } from '@/types/annotations';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { extractNativeTextObjects } from '@/core/pdf/pdf-native-extractor';
import { cn } from '@/utils/cn';
import { RotateCcw, Move } from 'lucide-react';

interface NativeObjectLayerProps {
  page: PdfPageModel;
  scale: number;
  pdfPage: pdfjsLib.PDFPageProxy | null;
}

/**
 * NativeObjectLayer renders selectable/draggable overlays over existing PDF content.
 * Only active when activeTool === 'select'.
 *
 * Architecture:
 *  1. On mount (or pdfPage change): call extractNativeTextObjects → store in NativeObjectStore
 *  2. Render each PdfNativeObject as a transparent hover-reveal overlay
 *  3. On drag: call moveObject(pageId, id, newX, newY)
 *  4. Moved objects show a "Sıfırla" (reset) badge
 */
export const NativeObjectLayer: React.FC<NativeObjectLayerProps> = ({
  page,
  scale,
  pdfPage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { activeTool } = useAnnotationStore();
  const { objectsByPage, setObjects, moveObject, resetObject } = useNativeObjectStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Drag state (ref-based to avoid re-renders during drag)
  const dragRef = useRef<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    startObjX: number;
    startObjY: number;
  } | null>(null);

  const objects: PdfNativeObject[] = objectsByPage[page.id] ?? [];

  // Extract native objects when pdfPage becomes available (once per page instance)
  useEffect(() => {
    if (!pdfPage) return;
    // Only extract if not already done for this page
    if (objectsByPage[page.id] && objectsByPage[page.id].length > 0) return;

    extractNativeTextObjects(pdfPage, page.id).then((objs) => {
      setObjects(page.id, objs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPage, page.id]);

  // Only render in select tool mode
  if (activeTool !== 'select') return null;
  if (objects.length === 0) return null;

  const handleMouseDown = (e: React.MouseEvent, obj: PdfNativeObject) => {
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
      const newX = Math.max(0, dragRef.current.startObjX + dx);
      const newY = Math.max(0, dragRef.current.startObjY + dy);
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
      className="absolute inset-0 z-20 pointer-events-none overflow-visible"
    >
      {objects.map((obj) => {
        const isSelected = selectedId === obj.id;
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
              'hover:bg-sky-400/10 hover:ring-1 hover:ring-sky-400/60 rounded-sm',
              isSelected && 'bg-sky-400/15 ring-2 ring-sky-500 rounded-sm shadow-md'
            )}
            onMouseDown={(e) => handleMouseDown(e, obj)}
            onClick={(e) => { e.stopPropagation(); setSelectedId(obj.id); }}
            title={obj.text ? `"${obj.text.slice(0, 40)}" — taşımak için sürükle` : 'Taşımak için sürükle'}
          >
            {/* Move icon hint on hover */}
            {!obj.moved && (
              <div className="absolute -top-5 left-0 hidden group-hover:flex items-center gap-1 bg-slate-900/90 text-white text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap shadow-lg z-30 pointer-events-none">
                <Move className="w-2.5 h-2.5 text-sky-400" />
                <span>Taşı</span>
              </div>
            )}

            {/* Moved badge + Reset button */}
            {obj.moved && (
              <div
                className="absolute -top-6 left-0 flex items-center gap-1 bg-amber-500/90 text-white text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap shadow-lg z-30 pointer-events-auto"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="font-semibold">Taşındı</span>
                <button
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
