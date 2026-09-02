import React, { useRef, useState, useEffect } from 'react';
import { PdfPageModel } from '@/types/document';
import {
  AnyAnnotation,
  DrawingAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  WhiteoutAnnotation,
  ImageAnnotation,
} from '@/types/annotations';
import { useAnnotationStore } from '@/store/annotation-store';
import {
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface AnnotationLayerProps {
  page: PdfPageModel;
  scale: number;
}

type ResizeHandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const QUICK_COLORS = ['#0284c7', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#0f172a', '#ffffff'];

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({ page, scale }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    activeTool,
    toolStyles,
    selectedAnnotationId,
    setSelectedAnnotationId,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    cloneAnnotation,
    bringToFront,
    sendToBack,
    copyAnnotation,
    pasteAnnotation,
  } = useAnnotationStore();

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapeCurrent, setShapeCurrent] = useState<{ x: number; y: number } | null>(null);

  // Dragging & Moving state
  const [draggingAnnId, setDraggingAnnId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [initialAnnPos, setInitialAnnPos] = useState<{ x: number; y: number; points?: { x: number; y: number }[] }>({ x: 0, y: 0 });

  // Resizing state
  const [resizingHandle, setResizingHandle] = useState<ResizeHandleType | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [initialBounds, setInitialBounds] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const getPageCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const selectedAnnotation = page.annotations.find((a) => a.id === selectedAnnotationId);

  // Global Keyboard Shortcuts for selected annotation (Delete, Ctrl+D, Ctrl+C, Ctrl+V, Nudge)
  useEffect(() => {
    if (!selectedAnnotationId || !selectedAnnotation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing inside an input or contentEditable
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteAnnotation(page.id, selectedAnnotationId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        cloneAnnotation(page.id, selectedAnnotationId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyAnnotation(page.id, selectedAnnotationId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteAnnotation(page.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedAnnotationId(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        const newX = Math.max(0, (selectedAnnotation.x || 0) + dx);
        const newY = Math.max(0, (selectedAnnotation.y || 0) + dy);

        if (selectedAnnotation.type === 'draw' || selectedAnnotation.type === 'highlight') {
          const dr = selectedAnnotation as DrawingAnnotation;
          const updatedPoints = dr.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          updateAnnotation(page.id, selectedAnnotation.id, { x: newX, y: newY, points: updatedPoints });
        } else {
          updateAnnotation(page.id, selectedAnnotation.id, { x: newX, y: newY });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, selectedAnnotation, page.id, deleteAnnotation, cloneAnnotation, copyAnnotation, pasteAnnotation, updateAnnotation, setSelectedAnnotationId]);

  // Main Mouse Down (Creation & Deselection)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'select') {
      // If clicking directly on empty layer space in select mode, deselect
      if (e.target === containerRef.current) {
        setSelectedAnnotationId(null);
      }
      return;
    }

    if (e.button !== 0) return;
    const coords = getPageCoords(e);

    if (activeTool === 'draw' || activeTool === 'highlight') {
      setIsDrawing(true);
      setCurrentPoints([coords]);
    } else if (
      activeTool === 'rect' ||
      activeTool === 'circle' ||
      activeTool === 'line' ||
      activeTool === 'arrow' ||
      activeTool === 'whiteout'
    ) {
      setShapeStart(coords);
      setShapeCurrent(coords);
    } else if (activeTool === 'text-add') {
      const newText: TextAnnotation = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        pageId: page.id,
        type: 'text',
        x: coords.x,
        y: coords.y,
        width: 160,
        height: 40,
        text: 'Metin Girin',
        fontSize: toolStyles.fontSize,
        fontFamily: toolStyles.fontFamily,
        color: toolStyles.color,
        isBold: toolStyles.isBold,
        isItalic: toolStyles.isItalic,
        opacity: toolStyles.opacity,
      };
      addAnnotation(page.id, newText);
      setSelectedAnnotationId(newText.id);
    }
  };

  // Main Mouse Move (Creation, Dragging, Resizing)
  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getPageCoords(e);

    if (isDrawing && (activeTool === 'draw' || activeTool === 'highlight')) {
      setCurrentPoints((prev) => [...prev, coords]);
      return;
    }

    if (shapeStart) {
      setShapeCurrent(coords);
      return;
    }

    // Moving Annotation
    if (draggingAnnId) {
      const dx = coords.x - dragStartPos.x;
      const dy = coords.y - dragStartPos.y;
      const targetAnn = page.annotations.find((a) => a.id === draggingAnnId);

      if (targetAnn) {
        if (targetAnn.type === 'draw' || targetAnn.type === 'highlight') {
          const origPoints = initialAnnPos.points || [];
          const updatedPoints = origPoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
          updateAnnotation(page.id, draggingAnnId, {
            x: Math.max(0, initialAnnPos.x + dx),
            y: Math.max(0, initialAnnPos.y + dy),
            points: updatedPoints,
          });
        } else {
          updateAnnotation(page.id, draggingAnnId, {
            x: Math.max(0, initialAnnPos.x + dx),
            y: Math.max(0, initialAnnPos.y + dy),
          });
        }
      }
      return;
    }

    // Resizing Annotation
    if (resizingHandle && selectedAnnotation) {
      const dx = coords.x - resizeStartPos.x;
      const dy = coords.y - resizeStartPos.y;
      let { x, y, width, height } = initialBounds;

      if (resizingHandle.includes('e')) width = Math.max(15, initialBounds.width + dx);
      if (resizingHandle.includes('s')) height = Math.max(15, initialBounds.height + dy);
      if (resizingHandle.includes('w')) {
        const newW = Math.max(15, initialBounds.width - dx);
        x = initialBounds.x + (initialBounds.width - newW);
        width = newW;
      }
      if (resizingHandle.includes('n')) {
        const newH = Math.max(15, initialBounds.height - dy);
        y = initialBounds.y + (initialBounds.height - newH);
        height = newH;
      }

      updateAnnotation(page.id, selectedAnnotation.id, {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(15, width),
        height: Math.max(15, height),
      });
    }
  };

  // Main Mouse Up (Creation finish)
  const handleMouseUp = () => {
    if (isDrawing && currentPoints.length > 1) {
      const isHighlighter = activeTool === 'highlight';
      const xs = currentPoints.map((p) => p.x);
      const ys = currentPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      const newDraw: DrawingAnnotation = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        pageId: page.id,
        type: isHighlighter ? 'highlight' : 'draw',
        x: minX,
        y: minY,
        width: Math.max(10, maxX - minX),
        height: Math.max(10, maxY - minY),
        points: currentPoints,
        color: isHighlighter ? toolStyles.color || '#facc15' : toolStyles.color,
        strokeWidth: isHighlighter ? Math.max(16, toolStyles.strokeWidth * 4) : toolStyles.strokeWidth,
        opacity: isHighlighter ? 0.35 : toolStyles.opacity,
      };
      addAnnotation(page.id, newDraw);
      setSelectedAnnotationId(newDraw.id);
      setIsDrawing(false);
      setCurrentPoints([]);
    }

    if (shapeStart && shapeCurrent) {
      const minX = Math.min(shapeStart.x, shapeCurrent.x);
      const minY = Math.min(shapeStart.y, shapeCurrent.y);
      const width = Math.abs(shapeCurrent.x - shapeStart.x);
      const height = Math.abs(shapeCurrent.y - shapeStart.y);

      if (width > 5 || height > 5 || activeTool === 'line' || activeTool === 'arrow') {
        const newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

        if (activeTool === 'whiteout') {
          const newWhiteout: WhiteoutAnnotation = {
            id: newId,
            pageId: page.id,
            type: 'whiteout',
            x: minX,
            y: minY,
            width: Math.max(10, width),
            height: Math.max(10, height),
            color: '#ffffff',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            opacity: 1,
          };
          addAnnotation(page.id, newWhiteout);
          setSelectedAnnotationId(newId);
        } else {
          const newShape: ShapeAnnotation = {
            id: newId,
            pageId: page.id,
            type: activeTool as 'rect' | 'circle' | 'line' | 'arrow',
            x: minX,
            y: minY,
            width: Math.max(10, width),
            height: Math.max(10, height),
            strokeColor: toolStyles.color,
            fillColor: toolStyles.fillColor === 'transparent' ? undefined : toolStyles.fillColor,
            strokeWidth: toolStyles.strokeWidth,
            opacity: toolStyles.opacity,
          };
          addAnnotation(page.id, newShape);
          setSelectedAnnotationId(newId);
        }
      }

      setShapeStart(null);
      setShapeCurrent(null);
    }

    if (draggingAnnId) {
      setDraggingAnnId(null);
    }

    if (resizingHandle) {
      setResizingHandle(null);
    }
  };

  // Start dragging any annotation
  const handleStartDragAnn = (e: React.MouseEvent, ann: AnyAnnotation) => {
    e.stopPropagation();
    setSelectedAnnotationId(ann.id);
    if (activeTool === 'select') {
      const coords = getPageCoords(e);
      setDraggingAnnId(ann.id);
      setDragStartPos(coords);
      setInitialAnnPos({
        x: ann.x || 0,
        y: ann.y || 0,
        points: (ann as DrawingAnnotation).points ? JSON.parse(JSON.stringify((ann as DrawingAnnotation).points)) : undefined,
      });
    }
  };

  // Start resizing handle
  const handleStartResize = (e: React.MouseEvent, handle: ResizeHandleType, ann: AnyAnnotation) => {
    e.stopPropagation();
    const coords = getPageCoords(e);
    setResizingHandle(handle);
    setResizeStartPos(coords);
    setInitialBounds({
      x: ann.x || 0,
      y: ann.y || 0,
      width: ann.width || 40,
      height: ann.height || 40,
    });
  };

  const isSelectionTool = activeTool === 'select';

  // Helper to render Bounding Box & 8 Resize Handles on active selected annotation
  const renderSelectionFrame = (ann: AnyAnnotation) => {
    if (selectedAnnotationId !== ann.id || !isSelectionTool) return null;

    const x = (ann.x || 0) * scale;
    const y = (ann.y || 0) * scale;
    const w = (ann.width || 40) * scale;
    const h = (ann.height || 40) * scale;

    const handles: { type: ResizeHandleType; left: string; top: string; cursor: string }[] = [
      { type: 'nw', left: '-5px', top: '-5px', cursor: 'nwse-resize' },
      { type: 'n', left: 'calc(50% - 4px)', top: '-5px', cursor: 'ns-resize' },
      { type: 'ne', left: 'calc(100% - 3px)', top: '-5px', cursor: 'nesw-resize' },
      { type: 'e', left: 'calc(100% - 3px)', top: 'calc(50% - 4px)', cursor: 'ew-resize' },
      { type: 'se', left: 'calc(100% - 3px)', top: 'calc(100% - 3px)', cursor: 'nwse-resize' },
      { type: 's', left: 'calc(50% - 4px)', top: 'calc(100% - 3px)', cursor: 'ns-resize' },
      { type: 'sw', left: '-5px', top: 'calc(100% - 3px)', cursor: 'nesw-resize' },
      { type: 'w', left: '-5px', top: 'calc(50% - 4px)', cursor: 'ew-resize' },
    ];

    return (
      <div
        style={{
          left: `${x}px`,
          top: `${y}px`,
          width: `${w}px`,
          height: `${h}px`,
        }}
        className="absolute border-2 border-sky-500 rounded-sm pointer-events-none z-30 ring-4 ring-sky-500/20"
      >
        {/* Floating Quick Action Toolbar */}
        <div
          style={{
            transform: y < 50 ? 'translateY(110%)' : 'translateY(-110%)',
          }}
          className="absolute left-0 top-0 flex items-center gap-1 bg-slate-900/95 text-white p-1 rounded-xl shadow-2xl border border-slate-700/80 pointer-events-auto z-40 select-none animate-in fade-in zoom-in-95 duration-100 whitespace-nowrap"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Clone Button */}
          <button
            onClick={() => cloneAnnotation(page.id, ann.id)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-800 rounded-lg text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            title="Klonla / Çoğalt (Ctrl+D)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Klonla</span>
          </button>

          <div className="w-[1px] h-3.5 bg-slate-700" />

          {/* Layer Controls */}
          <button
            onClick={() => bringToFront(page.id, ann.id)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            title="En Öne Getir"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => sendToBack(page.id, ann.id)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            title="En Arkaya Gönder"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Quick Color Palette if applicable */}
          {(ann.type === 'rect' || ann.type === 'circle' || ann.type === 'text' || ann.type === 'draw' || ann.type === 'whiteout') && (
            <>
              <div className="w-[1px] h-3.5 bg-slate-700" />
              <div className="flex items-center gap-1 px-1">
                {QUICK_COLORS.slice(0, 5).map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      if (ann.type === 'text' || ann.type === 'draw') {
                        updateAnnotation(page.id, ann.id, { color: c });
                      } else if (ann.type === 'rect' || ann.type === 'circle') {
                        updateAnnotation(page.id, ann.id, { strokeColor: c });
                      } else if (ann.type === 'whiteout') {
                        updateAnnotation(page.id, ann.id, { color: c });
                      }
                    }}
                    style={{ backgroundColor: c }}
                    className="w-3.5 h-3.5 rounded-full border border-slate-600 hover:scale-125 transition-transform"
                    title={`Renk: ${c}`}
                  />
                ))}
              </div>
            </>
          )}

          <div className="w-[1px] h-3.5 bg-slate-700" />

          {/* Delete Button */}
          <button
            onClick={() => deleteAnnotation(page.id, ann.id)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg text-xs font-semibold transition-colors"
            title="Kaldır / Sil (Delete)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sil</span>
          </button>
        </div>

        {/* 8 Resize Handles */}
        {handles.map((h) => (
          <div
            key={h.type}
            onMouseDown={(e) => handleStartResize(e, h.type, ann)}
            style={{
              left: h.left,
              top: h.top,
              cursor: h.cursor,
            }}
            className="absolute w-2.5 h-2.5 bg-white border-2 border-sky-600 rounded-full shadow-md pointer-events-auto hover:scale-150 hover:bg-sky-400 transition-transform"
          />
        ))}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      id={`ann-layer-${page.id}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={cn(
        'absolute inset-0 z-10 select-none overflow-visible',
        isSelectionTool
          ? 'pointer-events-none'
          : activeTool === 'draw' || activeTool === 'highlight'
          ? 'cursor-crosshair pointer-events-auto'
          : activeTool === 'text-add'
          ? 'cursor-text pointer-events-auto'
          : activeTool === 'whiteout'
          ? 'cursor-crosshair pointer-events-auto'
          : 'cursor-crosshair pointer-events-auto'
      )}
    >
      {/* SVG Container for vector drawings and shapes */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        {page.annotations.map((ann) => {
          const isSelected = selectedAnnotationId === ann.id;

          if (ann.type === 'draw' || ann.type === 'highlight') {
            const dr = ann as DrawingAnnotation;
            const d = dr.points
              .map((p, idx) => (idx === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ');

            return (
              <g
                key={ann.id}
                onMouseDown={(e) => handleStartDragAnn(e, ann)}
                className="cursor-move pointer-events-auto"
              >
                <path
                  d={d}
                  stroke={ann.color}
                  strokeWidth={ann.strokeWidth * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={ann.opacity ?? 1}
                  className={cn(isSelected && 'filter drop-shadow-[0_0_6px_rgba(2,132,199,0.8)]')}
                />
              </g>
            );
          }

          if (ann.type === 'rect') {
            const sh = ann as ShapeAnnotation;
            return (
              <rect
                key={ann.id}
                x={sh.x * scale}
                y={sh.y * scale}
                width={sh.width * scale}
                height={sh.height * scale}
                stroke={sh.strokeColor}
                strokeWidth={sh.strokeWidth * scale}
                fill={sh.fillColor || 'none'}
                opacity={sh.opacity ?? 1}
                rx={4}
                onMouseDown={(e) => handleStartDragAnn(e, ann)}
                className="cursor-move pointer-events-auto"
              />
            );
          }

          if (ann.type === 'circle') {
            const sh = ann as ShapeAnnotation;
            const rx = (sh.width * scale) / 2;
            const ry = (sh.height * scale) / 2;
            const cx = sh.x * scale + rx;
            const cy = sh.y * scale + ry;
            return (
              <ellipse
                key={ann.id}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                stroke={sh.strokeColor}
                strokeWidth={sh.strokeWidth * scale}
                fill={sh.fillColor || 'none'}
                opacity={sh.opacity ?? 1}
                onMouseDown={(e) => handleStartDragAnn(e, ann)}
                className="cursor-move pointer-events-auto"
              />
            );
          }

          if (ann.type === 'line' || ann.type === 'arrow') {
            const sh = ann as ShapeAnnotation;
            const x1 = sh.x * scale;
            const y1 = sh.y * scale;
            const x2 = (sh.x + sh.width) * scale;
            const y2 = (sh.y + sh.height) * scale;
            return (
              <g
                key={ann.id}
                onMouseDown={(e) => handleStartDragAnn(e, ann)}
                className="cursor-move pointer-events-auto"
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={sh.strokeColor}
                  strokeWidth={Math.max(sh.strokeWidth * scale, 3)}
                  strokeLinecap="round"
                  opacity={sh.opacity ?? 1}
                />
              </g>
            );
          }

          return null;
        })}

        {/* Live Drawing Preview */}
        {isDrawing && currentPoints.length > 1 && (
          <path
            d={currentPoints
              .map((p, idx) => (idx === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ')}
            stroke={activeTool === 'highlight' ? toolStyles.color || '#facc15' : toolStyles.color}
            strokeWidth={(activeTool === 'highlight' ? Math.max(16, toolStyles.strokeWidth * 4) : toolStyles.strokeWidth) * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={activeTool === 'highlight' ? 0.35 : toolStyles.opacity}
          />
        )}

        {/* Live Shape Preview */}
        {shapeStart && shapeCurrent && (
          <rect
            x={Math.min(shapeStart.x, shapeCurrent.x) * scale}
            y={Math.min(shapeStart.y, shapeCurrent.y) * scale}
            width={Math.abs(shapeCurrent.x - shapeStart.x) * scale}
            height={Math.abs(shapeCurrent.y - shapeStart.y) * scale}
            stroke={activeTool === 'whiteout' ? '#0284c7' : toolStyles.color}
            strokeWidth={toolStyles.strokeWidth * scale}
            strokeDasharray="4 4"
            fill={activeTool === 'whiteout' ? '#ffffff' : 'none'}
          />
        )}
      </svg>

      {/* DOM Interactive Overlays for Text, Whiteout, Signatures, Stamps & Images */}
      {page.annotations.map((ann) => {
        const isSelected = selectedAnnotationId === ann.id;

        // 1. Text Annotation
        if (ann.type === 'text') {
          const textAnn = ann as TextAnnotation;
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, ann)}
              style={{
                left: `${textAnn.x * scale}px`,
                top: `${textAnn.y * scale}px`,
                width: textAnn.width ? `${textAnn.width * scale}px` : undefined,
                minHeight: `${(textAnn.height || 30) * scale}px`,
                fontSize: `${textAnn.fontSize * scale}px`,
                color: textAnn.color,
                fontWeight: textAnn.isBold ? 'bold' : 'normal',
                fontStyle: textAnn.isItalic ? 'italic' : 'normal',
                fontFamily: textAnn.fontFamily,
                opacity: textAnn.opacity ?? 1,
              }}
              className={cn(
                'absolute p-1 rounded cursor-move select-none group pointer-events-auto transition-shadow',
                isSelected ? 'ring-2 ring-sky-500 bg-sky-500/10 shadow-lg' : 'hover:ring-1 hover:ring-sky-400/60'
              )}
            >
              <span
                contentEditable={isSelectionTool}
                suppressContentEditableWarning
                onBlur={(e) =>
                  updateAnnotation(page.id, textAnn.id, {
                    text: e.currentTarget.textContent || '',
                  })
                }
                className="focus:outline-none min-w-[20px] inline-block w-full"
              >
                {textAnn.text}
              </span>
            </div>
          );
        }

        // 2. Whiteout / Redaction Block
        if (ann.type === 'whiteout') {
          const wh = ann as WhiteoutAnnotation;
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, ann)}
              style={{
                left: `${wh.x * scale}px`,
                top: `${wh.y * scale}px`,
                width: `${wh.width * scale}px`,
                height: `${wh.height * scale}px`,
                backgroundColor: wh.color || '#ffffff',
                opacity: wh.opacity ?? 1,
              }}
              className={cn(
                'absolute cursor-move rounded-sm shadow-sm select-none pointer-events-auto transition-all',
                isSelected ? 'ring-2 ring-sky-500' : 'hover:ring-1 hover:ring-sky-400/50'
              )}
            />
          );
        }

        // 3. Image / Signature / Stamp
        if (ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'image') {
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, ann)}
              style={{
                left: `${ann.x * scale}px`,
                top: `${ann.y * scale}px`,
                width: `${ann.width * scale}px`,
                height: `${ann.height * scale}px`,
                opacity: ann.opacity ?? 1,
              }}
              className={cn(
                'absolute cursor-move rounded transition-all select-none pointer-events-auto',
                isSelected ? 'ring-2 ring-sky-500 shadow-xl' : 'hover:ring-1 hover:ring-sky-400/50'
              )}
            >
              <img
                src={(ann as ImageAnnotation).dataUrl}
                alt={ann.type}
                className="w-full h-full object-contain pointer-events-none"
              />
            </div>
          );
        }

        return null;
      })}

      {/* Universal Selection Frame & 8 Resize Handles for Active Selected Object */}
      {selectedAnnotation && renderSelectionFrame(selectedAnnotation)}
    </div>
  );
};
