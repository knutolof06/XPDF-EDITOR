import React, { useRef, useState, useEffect, useCallback } from 'react';
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
import { snapCoordinatesToGuides } from './RulerGuideOverlay';
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
  pageIndex?: number;
}

type ResizeHandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const QUICK_COLORS = ['#0284c7', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#0f172a', '#ffffff'];

const INTERACTIVE_TOOLS = new Set([
  'draw',
  'highlight',
  'text-add',
  'rect',
  'circle',
  'line',
  'arrow',
  'whiteout',
  'eraser',
]);

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTestAnnotation(ann: AnyAnnotation, pt: { x: number; y: number }, radius: number): boolean {
  if (ann.type === 'draw' || ann.type === 'highlight') {
    const dr = ann as DrawingAnnotation;
    const tol = radius + (dr.strokeWidth || 3) / 2;
    if (dr.points.length === 0) return false;
    if (dr.points.length === 1) {
      return Math.hypot(pt.x - dr.points[0].x, pt.y - dr.points[0].y) <= tol;
    }
    for (let i = 0; i < dr.points.length - 1; i++) {
      const p1 = dr.points[i];
      const p2 = dr.points[i + 1];
      if (pointToSegmentDistance(pt.x, pt.y, p1.x, p1.y, p2.x, p2.y) <= tol) {
        return true;
      }
    }
    return false;
  }

  if (ann.type === 'line' || ann.type === 'arrow') {
    const sh = ann as ShapeAnnotation;
    const tol = radius + (sh.strokeWidth || 3) / 2;
    return (
      pointToSegmentDistance(pt.x, pt.y, sh.x, sh.y, sh.x + sh.width, sh.y + sh.height) <= tol
    );
  }

  const minX = Math.min(ann.x, ann.x + ann.width) - radius;
  const maxX = Math.max(ann.x, ann.x + ann.width) + radius;
  const minY = Math.min(ann.y, ann.y + ann.height) - radius;
  const maxY = Math.max(ann.y, ann.y + ann.height) + radius;
  return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({ page, scale, pageIndex = 0 }) => {
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
  const [isErasing, setIsErasing] = useState(false);
  const erasedInSweepRef = useRef<Set<string>>(new Set());
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [shapeCurrent, setShapeCurrent] = useState<{ x: number; y: number } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Local transient drag preview (committed once on mouseup for clean undo history)
  const [dragState, setDragState] = useState<{
    id: string;
    startCoords: { x: number; y: number };
    initialX: number;
    initialY: number;
    initialPoints?: { x: number; y: number }[];
    previewX: number;
    previewY: number;
    previewPoints?: { x: number; y: number }[];
    moved: boolean;
  } | null>(null);

  // Local transient resize preview (committed once on mouseup)
  const [resizeState, setResizeState] = useState<{
    id: string;
    handle: ResizeHandleType;
    startCoords: { x: number; y: number };
    initialBounds: { x: number; y: number; width: number; height: number };
    initialPoints?: { x: number; y: number }[];
    isVectorLine: boolean;
    initialLineEndpoints?: { x1: number; y1: number; x2: number; y2: number };
    previewX: number;
    previewY: number;
    previewWidth: number;
    previewHeight: number;
    previewPoints?: { x: number; y: number }[];
  } | null>(null);

  const pageWidthPt = page.width || 595.28;
  const pageHeightPt = page.height || 841.89;

  const getPageCoords = useCallback(
    (e: React.MouseEvent | MouseEvent, clamp = true) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      let x = (e.clientX - rect.left) / scale;
      let y = (e.clientY - rect.top) / scale;
      if (clamp) {
        x = Math.max(0, Math.min(pageWidthPt, x));
        y = Math.max(0, Math.min(pageHeightPt, y));
      }
      return { x, y };
    },
    [scale, pageWidthPt, pageHeightPt]
  );

  const selectedAnnotation = page.annotations.find((a) => a.id === selectedAnnotationId);

  const eraseAtPoint = useCallback(
    (coords: { x: number; y: number }) => {
      const eraserRadius = Math.max(8, toolStyles.strokeWidth * 2);
      const targets = page.annotations.filter(
        (ann) => !erasedInSweepRef.current.has(ann.id) && hitTestAnnotation(ann, coords, eraserRadius)
      );
      for (const target of targets) {
        erasedInSweepRef.current.add(target.id);
        deleteAnnotation(page.id, target.id);
      }
    },
    [page.annotations, page.id, toolStyles.strokeWidth, deleteAnnotation]
  );

  // Global Keyboard Shortcuts for selected annotation
  useEffect(() => {
    if (!selectedAnnotationId || !selectedAnnotation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
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
        setEditingTextId(null);
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

        const newX = Math.max(0, Math.min(pageWidthPt, (selectedAnnotation.x || 0) + dx));
        const newY = Math.max(0, Math.min(pageHeightPt, (selectedAnnotation.y || 0) + dy));

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
  }, [
    selectedAnnotationId,
    selectedAnnotation,
    page.id,
    pageWidthPt,
    pageHeightPt,
    deleteAnnotation,
    cloneAnnotation,
    copyAnnotation,
    pasteAnnotation,
    updateAnnotation,
    setSelectedAnnotationId,
  ]);

  // Window capture for active draw / shape / drag / resize / eraser sweep
  useEffect(() => {
    const isInteracting =
      isDrawing || Boolean(shapeStart) || Boolean(dragState) || Boolean(resizeState) || isErasing;
    if (!isInteracting) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const coords = getPageCoords(e, true);

      if (isErasing) {
        eraseAtPoint(coords);
        return;
      }

      if (isDrawing && (activeTool === 'draw' || activeTool === 'highlight')) {
        setCurrentPoints((prev) => [...prev, coords]);
        return;
      }

      if (shapeStart) {
        setShapeCurrent(coords);
        return;
      }

      if (dragState) {
        const dx = coords.x - dragState.startCoords.x;
        const dy = coords.y - dragState.startCoords.y;
        const rawX = Math.max(0, Math.min(pageWidthPt, dragState.initialX + dx));
        const rawY = Math.max(0, Math.min(pageHeightPt, dragState.initialY + dy));
        const snapped = snapCoordinatesToGuides(rawX, rawY, pageIndex, pageWidthPt, pageHeightPt);
        const effDx = snapped.xPt - dragState.initialX;
        const effDy = snapped.yPt - dragState.initialY;

        setDragState((prev) =>
          prev
            ? {
                ...prev,
                previewX: snapped.xPt,
                previewY: snapped.yPt,
                previewPoints: prev.initialPoints
                  ? prev.initialPoints.map((pt) => ({ x: pt.x + effDx, y: pt.y + effDy }))
                  : undefined,
                moved: prev.moved || Math.abs(effDx) > 0.5 || Math.abs(effDy) > 0.5,
              }
            : null
        );
        return;
      }

      if (resizeState) {
        const dx = coords.x - resizeState.startCoords.x;
        const dy = coords.y - resizeState.startCoords.y;
        const { initialBounds, handle, isVectorLine, initialLineEndpoints } = resizeState;
        let { x, y, width, height } = initialBounds;

        if (handle.includes('e')) width = Math.max(10, initialBounds.width + dx);
        if (handle.includes('s')) height = Math.max(10, initialBounds.height + dy);
        if (handle.includes('w')) {
          const newW = Math.max(10, initialBounds.width - dx);
          x = Math.max(0, initialBounds.x + (initialBounds.width - newW));
          width = newW;
        }
        if (handle.includes('n')) {
          const newH = Math.max(10, initialBounds.height - dy);
          y = Math.max(0, initialBounds.y + (initialBounds.height - newH));
          height = newH;
        }

        if (isVectorLine && initialLineEndpoints) {
          const oldW = initialBounds.width || 1;
          const oldH = initialBounds.height || 1;
          const nx1 = x + ((initialLineEndpoints.x1 - initialBounds.x) / oldW) * width;
          const ny1 = y + ((initialLineEndpoints.y1 - initialBounds.y) / oldH) * height;
          const nx2 = x + ((initialLineEndpoints.x2 - initialBounds.x) / oldW) * width;
          const ny2 = y + ((initialLineEndpoints.y2 - initialBounds.y) / oldH) * height;
          setResizeState((prev) =>
            prev
              ? {
                  ...prev,
                  previewX: nx1,
                  previewY: ny1,
                  previewWidth: nx2 - nx1,
                  previewHeight: ny2 - ny1,
                }
              : null
          );
          return;
        }

        let previewPoints: { x: number; y: number }[] | undefined;
        if (resizeState.initialPoints && resizeState.initialPoints.length > 0) {
          const scaleX = width / (initialBounds.width || 1);
          const scaleY = height / (initialBounds.height || 1);
          previewPoints = resizeState.initialPoints.map((pt) => ({
            x: x + (pt.x - initialBounds.x) * scaleX,
            y: y + (pt.y - initialBounds.y) * scaleY,
          }));
        }

        setResizeState((prev) =>
          prev
            ? {
                ...prev,
                previewX: x,
                previewY: y,
                previewWidth: width,
                previewHeight: height,
                previewPoints,
              }
            : null
        );
      }
    };

    const handleWindowMouseUp = () => {
      if (isErasing) {
        setIsErasing(false);
        erasedInSweepRef.current.clear();
      }

      if (isDrawing) {
        if (currentPoints.length >= 1) {
          const isHighlighter = activeTool === 'highlight';
          const normalizedPoints =
            currentPoints.length === 1
              ? [currentPoints[0], { x: currentPoints[0].x + 0.5, y: currentPoints[0].y + 0.5 }]
              : currentPoints;

          const xs = normalizedPoints.map((p) => p.x);
          const ys = normalizedPoints.map((p) => p.y);
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
            points: normalizedPoints,
            color: isHighlighter ? toolStyles.color || '#facc15' : toolStyles.color,
            strokeWidth: isHighlighter ? Math.max(16, toolStyles.strokeWidth * 4) : toolStyles.strokeWidth,
            opacity: isHighlighter ? 0.35 : toolStyles.opacity,
          };
          addAnnotation(page.id, newDraw);
          setSelectedAnnotationId(newDraw.id);
        }
        setIsDrawing(false);
        setCurrentPoints([]);
      }

      if (shapeStart && shapeCurrent) {
        const dx = shapeCurrent.x - shapeStart.x;
        const dy = shapeCurrent.y - shapeStart.y;
        const isLineLike = activeTool === 'line' || activeTool === 'arrow';
        const dist = Math.hypot(dx, dy);

        if ((isLineLike && dist > 4) || Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          const newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

          if (activeTool === 'whiteout') {
            const newWhiteout: WhiteoutAnnotation = {
              id: newId,
              pageId: page.id,
              type: 'whiteout',
              x: Math.min(shapeStart.x, shapeCurrent.x),
              y: Math.min(shapeStart.y, shapeCurrent.y),
              width: Math.max(10, Math.abs(dx)),
              height: Math.max(10, Math.abs(dy)),
              color: '#ffffff',
              borderColor: '#e2e8f0',
              borderWidth: 1,
              opacity: 1,
            };
            addAnnotation(page.id, newWhiteout);
            setSelectedAnnotationId(newId);
          } else if (isLineLike) {
            const newLine: ShapeAnnotation = {
              id: newId,
              pageId: page.id,
              type: activeTool as 'line' | 'arrow',
              x: shapeStart.x,
              y: shapeStart.y,
              width: dx,
              height: dy,
              strokeColor: toolStyles.color,
              strokeWidth: toolStyles.strokeWidth,
              opacity: toolStyles.opacity,
            };
            addAnnotation(page.id, newLine);
            setSelectedAnnotationId(newId);
          } else {
            const newShape: ShapeAnnotation = {
              id: newId,
              pageId: page.id,
              type: activeTool as 'rect' | 'circle',
              x: Math.min(shapeStart.x, shapeCurrent.x),
              y: Math.min(shapeStart.y, shapeCurrent.y),
              width: Math.max(10, Math.abs(dx)),
              height: Math.max(10, Math.abs(dy)),
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

      if (dragState) {
        if (dragState.moved) {
          if (dragState.previewPoints) {
            updateAnnotation(page.id, dragState.id, {
              x: dragState.previewX,
              y: dragState.previewY,
              points: dragState.previewPoints,
            });
          } else {
            updateAnnotation(page.id, dragState.id, {
              x: dragState.previewX,
              y: dragState.previewY,
            });
          }
        }
        setDragState(null);
      }

      if (resizeState) {
        if (resizeState.previewPoints) {
          updateAnnotation(page.id, resizeState.id, {
            x: resizeState.previewX,
            y: resizeState.previewY,
            width: resizeState.previewWidth,
            height: resizeState.previewHeight,
            points: resizeState.previewPoints,
          });
        } else {
          updateAnnotation(page.id, resizeState.id, {
            x: resizeState.previewX,
            y: resizeState.previewY,
            width: resizeState.previewWidth,
            height: resizeState.previewHeight,
          });
        }
        setResizeState(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [
    isDrawing,
    isErasing,
    shapeStart,
    shapeCurrent,
    currentPoints,
    dragState,
    resizeState,
    activeTool,
    page.id,
    pageIndex,
    pageWidthPt,
    pageHeightPt,
    toolStyles,
    getPageCoords,
    eraseAtPoint,
    addAnnotation,
    updateAnnotation,
    setSelectedAnnotationId,
  ]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'select') {
      if (e.target === containerRef.current) {
        setEditingTextId(null);
        setSelectedAnnotationId(null);
      }
      return;
    }

    if (!INTERACTIVE_TOOLS.has(activeTool) || e.button !== 0) return;

    const coords = getPageCoords(e, true);

    if (activeTool === 'eraser') {
      erasedInSweepRef.current.clear();
      setIsErasing(true);
      eraseAtPoint(coords);
      return;
    }

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
      const snapped = snapCoordinatesToGuides(coords.x, coords.y, pageIndex, pageWidthPt, pageHeightPt);
      setShapeStart({ x: snapped.xPt, y: snapped.yPt });
      setShapeCurrent({ x: snapped.xPt, y: snapped.yPt });
    } else if (activeTool === 'text-add') {
      const snapped = snapCoordinatesToGuides(coords.x, coords.y, pageIndex, pageWidthPt, pageHeightPt);
      const newText: TextAnnotation = {
        id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        pageId: page.id,
        type: 'text',
        x: snapped.xPt,
        y: snapped.yPt,
        width: 160,
        height: 40,
        text: 'Metin Girin',
        fontSize: toolStyles.fontSize,
        fontFamily: toolStyles.fontFamily,
        color: toolStyles.color,
        isBold: toolStyles.isBold,
        isItalic: toolStyles.isItalic,
        isUnderline: toolStyles.isUnderline,
        opacity: toolStyles.opacity,
      };
      addAnnotation(page.id, newText);
      setSelectedAnnotationId(newText.id);
      setEditingTextId(newText.id);
    }
  };

  const handleStartDragAnn = (e: React.MouseEvent, ann: AnyAnnotation) => {
    if (activeTool === 'eraser') {
      e.stopPropagation();
      deleteAnnotation(page.id, ann.id);
      return;
    }

    if (editingTextId === ann.id) {
      e.stopPropagation();
      return;
    }

    e.stopPropagation();
    setSelectedAnnotationId(ann.id);
    if (editingTextId && editingTextId !== ann.id) {
      setEditingTextId(null);
    }

    if (activeTool === 'select') {
      const coords = getPageCoords(e, true);
      const origPoints =
        ann.type === 'draw' || ann.type === 'highlight'
          ? (ann as DrawingAnnotation).points.map((pt) => ({ ...pt }))
          : undefined;

      setDragState({
        id: ann.id,
        startCoords: coords,
        initialX: ann.x || 0,
        initialY: ann.y || 0,
        initialPoints: origPoints,
        previewX: ann.x || 0,
        previewY: ann.y || 0,
        previewPoints: origPoints,
        moved: false,
      });
    }
  };

  const handleStartResize = (e: React.MouseEvent, handle: ResizeHandleType, ann: AnyAnnotation) => {
    e.stopPropagation();
    const coords = getPageCoords(e, true);
    const isVectorLine = ann.type === 'line' || ann.type === 'arrow';

    if (isVectorLine) {
      const x1 = ann.x;
      const y1 = ann.y;
      const x2 = ann.x + ann.width;
      const y2 = ann.y + ann.height;
      const boxX = Math.min(x1, x2);
      const boxY = Math.min(y1, y2);
      const boxW = Math.max(Math.abs(ann.width), 8);
      const boxH = Math.max(Math.abs(ann.height), 8);

      setResizeState({
        id: ann.id,
        handle,
        startCoords: coords,
        initialBounds: { x: boxX, y: boxY, width: boxW, height: boxH },
        isVectorLine: true,
        initialLineEndpoints: { x1, y1, x2, y2 },
        previewX: ann.x,
        previewY: ann.y,
        previewWidth: ann.width,
        previewHeight: ann.height,
      });
      return;
    }

    const origPoints =
      ann.type === 'draw' || ann.type === 'highlight'
        ? (ann as DrawingAnnotation).points.map((pt) => ({ ...pt }))
        : undefined;

    setResizeState({
      id: ann.id,
      handle,
      startCoords: coords,
      initialBounds: {
        x: ann.x || 0,
        y: ann.y || 0,
        width: ann.width ?? 40,
        height: ann.height ?? 40,
      },
      initialPoints: origPoints,
      isVectorLine: false,
      previewX: ann.x || 0,
      previewY: ann.y || 0,
      previewWidth: ann.width ?? 40,
      previewHeight: ann.height ?? 40,
      previewPoints: origPoints,
    });
  };

  const getEffectiveAnnotation = (ann: AnyAnnotation): AnyAnnotation => {
    if (dragState && dragState.id === ann.id) {
      if (dragState.previewPoints && (ann.type === 'draw' || ann.type === 'highlight')) {
        return {
          ...ann,
          x: dragState.previewX,
          y: dragState.previewY,
          points: dragState.previewPoints,
        };
      }
      return { ...ann, x: dragState.previewX, y: dragState.previewY };
    }

    if (resizeState && resizeState.id === ann.id) {
      if (resizeState.previewPoints && (ann.type === 'draw' || ann.type === 'highlight')) {
        return {
          ...ann,
          x: resizeState.previewX,
          y: resizeState.previewY,
          width: resizeState.previewWidth,
          height: resizeState.previewHeight,
          points: resizeState.previewPoints,
        };
      }
      return {
        ...ann,
        x: resizeState.previewX,
        y: resizeState.previewY,
        width: resizeState.previewWidth,
        height: resizeState.previewHeight,
      };
    }

    return ann;
  };

  const isSelectionTool = activeTool === 'select' || activeTool === 'text-select';
  const isLayerInteractive = INTERACTIVE_TOOLS.has(activeTool);

  const renderSelectionFrame = (rawAnn: AnyAnnotation) => {
    if (selectedAnnotationId !== rawAnn.id || !isSelectionTool) return null;
    const ann = getEffectiveAnnotation(rawAnn);

    const isLineLike = ann.type === 'line' || ann.type === 'arrow';
    const boxX = isLineLike ? Math.min(ann.x, ann.x + ann.width) : ann.x || 0;
    const boxY = isLineLike ? Math.min(ann.y, ann.y + ann.height) : ann.y || 0;
    const boxW = isLineLike ? Math.max(Math.abs(ann.width), 8) : Math.max(ann.width ?? 40, 8);
    const boxH = isLineLike ? Math.max(Math.abs(ann.height), 8) : Math.max(ann.height ?? 40, 8);

    const x = boxX * scale;
    const y = boxY * scale;
    const w = boxW * scale;
    const h = boxH * scale;

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
        className="no-print absolute border-2 border-sky-500 rounded-sm pointer-events-none z-30 ring-4 ring-sky-500/20"
      >
        {/* Floating Quick Action Toolbar */}
        <div
          style={{
            transform: y < 50 ? 'translateY(110%)' : 'translateY(-110%)',
          }}
          className="absolute left-0 top-0 flex items-center gap-1 bg-slate-900/95 text-white p-1 rounded-xl shadow-2xl border border-slate-700/80 pointer-events-auto z-40 select-none whitespace-nowrap"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Klonla"
            onClick={() => cloneAnnotation(page.id, rawAnn.id)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-800 rounded-lg text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            title="Klonla / Çoğalt (Ctrl+D)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Klonla</span>
          </button>

          <div className="w-[1px] h-3.5 bg-slate-700" />

          <button
            type="button"
            aria-label="En Öne Getir"
            onClick={() => bringToFront(page.id, rawAnn.id)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            title="En Öne Getir"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label="En Arkaya Gönder"
            onClick={() => sendToBack(page.id, rawAnn.id)}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            title="En Arkaya Gönder"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {(rawAnn.type === 'rect' ||
            rawAnn.type === 'circle' ||
            rawAnn.type === 'line' ||
            rawAnn.type === 'arrow' ||
            rawAnn.type === 'text' ||
            rawAnn.type === 'draw' ||
            rawAnn.type === 'whiteout') && (
            <>
              <div className="w-[1px] h-3.5 bg-slate-700" />
              <div className="flex items-center gap-1 px-1">
                {QUICK_COLORS.slice(0, 5).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Renk ${c}`}
                    onClick={() => {
                      if (rawAnn.type === 'text' || rawAnn.type === 'draw') {
                        updateAnnotation(page.id, rawAnn.id, { color: c });
                      } else if (
                        rawAnn.type === 'rect' ||
                        rawAnn.type === 'circle' ||
                        rawAnn.type === 'line' ||
                        rawAnn.type === 'arrow'
                      ) {
                        updateAnnotation(page.id, rawAnn.id, { strokeColor: c });
                      } else if (rawAnn.type === 'whiteout') {
                        updateAnnotation(page.id, rawAnn.id, { color: c });
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

          <button
            type="button"
            aria-label="Sil"
            onClick={() => deleteAnnotation(page.id, rawAnn.id)}
            className="flex items-center gap-1 px-2 py-1 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg text-xs font-semibold transition-colors"
            title="Kaldır / Sil (Delete)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sil</span>
          </button>
        </div>

        {/* 8 Resize Handles */}
        {handles.map((hItem) => (
          <div
            key={hItem.type}
            onMouseDown={(e) => handleStartResize(e, hItem.type, rawAnn)}
            style={{
              left: hItem.left,
              top: hItem.top,
              cursor: hItem.cursor,
            }}
            className="absolute w-2.5 h-2.5 bg-white border-2 border-sky-600 rounded-full shadow-md pointer-events-auto hover:scale-150 hover:bg-sky-400 transition-transform"
          />
        ))}
      </div>
    );
  };

  const arrowAnnotations = page.annotations.filter((a) => a.type === 'arrow') as ShapeAnnotation[];

  return (
    <div
      ref={containerRef}
      id={`ann-layer-${page.id}`}
      onMouseDown={handleMouseDown}
      className={cn(
        'absolute inset-0 z-10 select-none overflow-visible',
        !isLayerInteractive
          ? 'pointer-events-none'
          : activeTool === 'text-add'
          ? 'cursor-text pointer-events-auto'
          : 'cursor-crosshair pointer-events-auto'
      )}
    >
      {/* SVG Container for vector drawings and shapes */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <defs>
          {arrowAnnotations.map((arr) => (
            <marker
              key={`marker-${arr.id}`}
              id={`arrow-head-${page.id}-${arr.id}`}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={arr.strokeColor} />
            </marker>
          ))}
          <marker
            id={`arrow-head-preview-${page.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={toolStyles.color} />
          </marker>
        </defs>

        {page.annotations.map((rawAnn) => {
          const ann = getEffectiveAnnotation(rawAnn);
          const isSelected = selectedAnnotationId === ann.id;

          if (ann.type === 'draw' || ann.type === 'highlight') {
            const dr = ann as DrawingAnnotation;
            const d = dr.points
              .map((p, idx) => (idx === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ');

            return (
              <g
                key={ann.id}
                onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
                className={cn(
                  'pointer-events-auto',
                  activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move'
                )}
              >
                <path
                  d={d}
                  stroke={dr.color}
                  strokeWidth={dr.strokeWidth * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={dr.opacity ?? 1}
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
                onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
                className={cn(
                  'pointer-events-auto',
                  activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move'
                )}
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
                onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
                className={cn(
                  'pointer-events-auto',
                  activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move'
                )}
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
                onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
                className={cn(
                  'pointer-events-auto',
                  activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move'
                )}
              >
                {/* Invisible wider hit target for easy selection */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={Math.max(12, sh.strokeWidth * scale + 8)}
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={sh.strokeColor}
                  strokeWidth={Math.max(sh.strokeWidth * scale, 1.5)}
                  strokeLinecap="round"
                  opacity={sh.opacity ?? 1}
                  markerEnd={
                    ann.type === 'arrow' ? `url(#arrow-head-${page.id}-${ann.id})` : undefined
                  }
                />
              </g>
            );
          }

          return null;
        })}

        {/* Live Drawing Preview */}
        {isDrawing && currentPoints.length > 0 && (
          <path
            d={(currentPoints.length === 1
              ? [currentPoints[0], { x: currentPoints[0].x + 0.5, y: currentPoints[0].y + 0.5 }]
              : currentPoints
            )
              .map((p, idx) => (idx === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ')}
            stroke={activeTool === 'highlight' ? toolStyles.color || '#facc15' : toolStyles.color}
            strokeWidth={
              (activeTool === 'highlight' ? Math.max(16, toolStyles.strokeWidth * 4) : toolStyles.strokeWidth) * scale
            }
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={activeTool === 'highlight' ? 0.35 : toolStyles.opacity}
          />
        )}

        {/* Live Shape Preview matching exact shape */}
        {shapeStart && shapeCurrent && (
          activeTool === 'circle' ? (
            <ellipse
              cx={((shapeStart.x + shapeCurrent.x) / 2) * scale}
              cy={((shapeStart.y + shapeCurrent.y) / 2) * scale}
              rx={(Math.abs(shapeCurrent.x - shapeStart.x) / 2) * scale}
              ry={(Math.abs(shapeCurrent.y - shapeStart.y) / 2) * scale}
              stroke={toolStyles.color}
              strokeWidth={toolStyles.strokeWidth * scale}
              strokeDasharray="4 4"
              fill="none"
            />
          ) : activeTool === 'line' || activeTool === 'arrow' ? (
            <line
              x1={shapeStart.x * scale}
              y1={shapeStart.y * scale}
              x2={shapeCurrent.x * scale}
              y2={shapeCurrent.y * scale}
              stroke={toolStyles.color}
              strokeWidth={Math.max(toolStyles.strokeWidth * scale, 1.5)}
              strokeDasharray="4 4"
              markerEnd={activeTool === 'arrow' ? `url(#arrow-head-preview-${page.id})` : undefined}
            />
          ) : (
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
          )
        )}
      </svg>

      {/* DOM Interactive Overlays for Text, Whiteout, Signatures, Stamps & Images */}
      {page.annotations.map((rawAnn) => {
        const ann = getEffectiveAnnotation(rawAnn);
        const isSelected = selectedAnnotationId === ann.id;

        if (ann.type === 'text') {
          const textAnn = ann as TextAnnotation;
          const isEditing = editingTextId === textAnn.id;
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setSelectedAnnotationId(textAnn.id);
                setEditingTextId(textAnn.id);
              }}
              style={{
                left: `${textAnn.x * scale}px`,
                top: `${textAnn.y * scale}px`,
                width: textAnn.width ? `${textAnn.width * scale}px` : undefined,
                minHeight: `${(textAnn.height || 30) * scale}px`,
                fontSize: `${textAnn.fontSize * scale}px`,
                color: textAnn.color,
                backgroundColor: textAnn.backgroundColor,
                fontWeight: textAnn.isBold ? 'bold' : 'normal',
                fontStyle: textAnn.isItalic ? 'italic' : 'normal',
                textDecoration: textAnn.isUnderline ? 'underline' : 'none',
                textAlign: textAnn.textAlign || 'left',
                fontFamily: textAnn.fontFamily,
                opacity: textAnn.opacity ?? 1,
              }}
              className={cn(
                'absolute p-1 rounded group pointer-events-auto transition-shadow',
                isEditing ? 'cursor-text select-text ring-2 ring-sky-500 bg-white/80 dark:bg-slate-900/60' : 'cursor-move select-none',
                !isEditing && isSelected ? 'ring-2 ring-sky-500 bg-sky-500/10 shadow-lg' : !isEditing && 'hover:ring-1 hover:ring-sky-400/60'
              )}
              title={isEditing ? undefined : 'Düzenlemek için çift tıklayın, taşımak için sürükleyin'}
            >
              <div
                contentEditable={isEditing}
                suppressContentEditableWarning
                ref={(el) => {
                  if (el && isEditing && document.activeElement !== el) {
                    el.focus();
                  }
                }}
                onMouseDown={(e) => {
                  if (isEditing) {
                    e.stopPropagation();
                  }
                }}
                onBlur={(e) => {
                  const nextText = (e.currentTarget.innerText || '').replace(/\r\n/g, '\n');
                  setEditingTextId(null);
                  if (nextText !== textAnn.text) {
                    updateAnnotation(page.id, textAnn.id, { text: nextText });
                  }
                }}
                className="focus:outline-none min-w-[20px] w-full whitespace-pre-wrap break-words leading-snug"
              >
                {textAnn.text}
              </div>
            </div>
          );
        }

        if (ann.type === 'whiteout') {
          const wh = ann as WhiteoutAnnotation;
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
              style={{
                left: `${wh.x * scale}px`,
                top: `${wh.y * scale}px`,
                width: `${wh.width * scale}px`,
                height: `${wh.height * scale}px`,
                backgroundColor: wh.color || '#ffffff',
                opacity: wh.opacity ?? 1,
              }}
              className={cn(
                'absolute rounded-sm shadow-sm select-none pointer-events-auto transition-all',
                activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move',
                isSelected ? 'ring-2 ring-sky-500' : 'hover:ring-1 hover:ring-sky-400/50'
              )}
            />
          );
        }

        if (ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'image') {
          return (
            <div
              key={ann.id}
              onMouseDown={(e) => handleStartDragAnn(e, rawAnn)}
              style={{
                left: `${ann.x * scale}px`,
                top: `${ann.y * scale}px`,
                width: `${ann.width * scale}px`,
                height: `${ann.height * scale}px`,
                opacity: ann.opacity ?? 1,
              }}
              className={cn(
                'absolute rounded transition-all select-none pointer-events-auto',
                activeTool === 'eraser' ? 'cursor-crosshair' : 'cursor-move',
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

      {/* Universal Selection Frame & 8 Resize Handles */}
      {selectedAnnotation && renderSelectionFrame(selectedAnnotation)}
    </div>
  );
};
