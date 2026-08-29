import React, { useRef, useState } from 'react';
import { PdfPageModel } from '@/types/document';
import { AnyAnnotation, DrawingAnnotation, ShapeAnnotation, TextAnnotation } from '@/types/annotations';
import { useAnnotationStore } from '@/store/annotation-store';
import { Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';

interface AnnotationLayerProps {
  page: PdfPageModel;
  scale: number;
}

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
  } = useAnnotationStore();

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapeCurrent, setShapeCurrent] = useState<{ x: number; y: number } | null>(null);
  const [draggingAnnId, setDraggingAnnId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const getPageCoords = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'select') return; // Let clicks and selections pass through to native text layer
    if (e.button !== 0) return;
    const coords = getPageCoords(e);

    if (activeTool === 'draw' || activeTool === 'highlight') {
      setIsDrawing(true);
      setCurrentPoints([coords]);
    } else if (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'line' || activeTool === 'arrow') {
      setShapeStart(coords);
      setShapeCurrent(coords);
    } else if (activeTool === 'text-add') {
      const newText: TextAnnotation = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
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

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getPageCoords(e);

    if (isDrawing && (activeTool === 'draw' || activeTool === 'highlight')) {
      setCurrentPoints((prev) => [...prev, coords]);
    } else if (shapeStart) {
      setShapeCurrent(coords);
    } else if (draggingAnnId) {
      const ann = page.annotations.find((a) => a.id === draggingAnnId);
      if (ann) {
        updateAnnotation(page.id, draggingAnnId, {
          x: Math.max(0, coords.x - dragOffset.x),
          y: Math.max(0, coords.y - dragOffset.y),
        });
      }
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentPoints.length > 1) {
      const isHighlighter = activeTool === 'highlight';
      const newDraw: DrawingAnnotation = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        pageId: page.id,
        type: isHighlighter ? 'highlight' : 'draw',
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
        points: currentPoints,
        color: isHighlighter ? (toolStyles.color || '#facc15') : toolStyles.color,
        strokeWidth: isHighlighter ? Math.max(16, toolStyles.strokeWidth * 4) : toolStyles.strokeWidth,
        opacity: isHighlighter ? 0.35 : toolStyles.opacity,
      };
      addAnnotation(page.id, newDraw);
      setIsDrawing(false);
      setCurrentPoints([]);
    }

    if (shapeStart && shapeCurrent) {
      const minX = Math.min(shapeStart.x, shapeCurrent.x);
      const minY = Math.min(shapeStart.y, shapeCurrent.y);
      const width = Math.abs(shapeCurrent.x - shapeStart.x);
      const height = Math.abs(shapeCurrent.y - shapeStart.y);

      if (width > 5 || height > 5 || activeTool === 'line' || activeTool === 'arrow') {
        const newShape: ShapeAnnotation = {
          id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
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
      }

      setShapeStart(null);
      setShapeCurrent(null);
    }

    if (draggingAnnId) {
      setDraggingAnnId(null);
    }
  };

  const handleStartDragAnn = (e: React.MouseEvent, ann: AnyAnnotation) => {
    e.stopPropagation();
    setSelectedAnnotationId(ann.id);
    if (activeTool === 'select') {
      const coords = getPageCoords(e);
      setDraggingAnnId(ann.id);
      setDragOffset({
        x: coords.x - ann.x,
        y: coords.y - ann.y,
      });
    }
  };

  const isSelectionTool = activeTool === 'select';

  return (
    <div
      ref={containerRef}
      id={`ann-layer-${page.id}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={cn(
        'absolute inset-0 z-10 select-none overflow-hidden',
        isSelectionTool
          ? 'pointer-events-none' // Transparent to allow native text selection
          : activeTool === 'draw' || activeTool === 'highlight'
          ? 'cursor-crosshair pointer-events-auto'
          : activeTool === 'text-add'
          ? 'cursor-text pointer-events-auto'
          : 'cursor-crosshair pointer-events-auto'
      )}
    >
      {/* SVG Container for vector drawings and shapes */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {page.annotations.map((ann) => {
          if (ann.type === 'draw' || ann.type === 'highlight') {
            const d = (ann as DrawingAnnotation).points
              .map((p, idx) => (idx === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ');

            return (
              <path
                key={ann.id}
                d={d}
                stroke={ann.color}
                strokeWidth={ann.strokeWidth * scale}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={ann.opacity ?? 1}
              />
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
              <g key={ann.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={sh.strokeColor}
                  strokeWidth={sh.strokeWidth * scale}
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
            stroke={activeTool === 'highlight' ? (toolStyles.color || '#facc15') : toolStyles.color}
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
            stroke={toolStyles.color}
            strokeWidth={toolStyles.strokeWidth * scale}
            strokeDasharray="4 4"
            fill="none"
          />
        )}
      </svg>

      {/* DOM Interactive Overlays for Text, Signatures, Stamps & Images */}
      {page.annotations.map((ann) => {
        const isSelected = selectedAnnotationId === ann.id;

        if (ann.type === 'text') {
          const textAnn = ann as TextAnnotation;
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, ann)}
              style={{
                left: `${textAnn.x * scale}px`,
                top: `${textAnn.y * scale}px`,
                fontSize: `${textAnn.fontSize * scale}px`,
                color: textAnn.color,
                fontWeight: textAnn.isBold ? 'bold' : 'normal',
                fontStyle: textAnn.isItalic ? 'italic' : 'normal',
                fontFamily: textAnn.fontFamily,
                opacity: textAnn.opacity ?? 1,
              }}
              className={cn(
                'absolute p-1 rounded cursor-move transition-shadow select-none group pointer-events-auto',
                isSelected ? 'ring-2 ring-sky-500 bg-sky-500/10' : 'hover:ring-1 hover:ring-sky-400/50'
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
                className="focus:outline-none min-w-[20px] inline-block"
              >
                {textAnn.text}
              </span>

              {/* Quick Delete Badge */}
              {isSelected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAnnotation(page.id, ann.id);
                  }}
                  className="absolute -top-3 -right-3 p-1 rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-500 pointer-events-auto"
                  title="Metni Sil"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        }

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
                isSelected ? 'ring-2 ring-sky-500 shadow-lg' : 'hover:ring-1 hover:ring-sky-400/50'
              )}
            >
              <img
                src={(ann as any).dataUrl}
                alt={ann.type}
                className="w-full h-full object-contain pointer-events-none"
              />

              {isSelected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAnnotation(page.id, ann.id);
                  }}
                  className="absolute -top-3 -right-3 p-1 rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-500 pointer-events-auto"
                  title="Sil"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};
