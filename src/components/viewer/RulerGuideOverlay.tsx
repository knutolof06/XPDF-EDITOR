import React, { useRef, useState, useEffect } from 'react';
import { useRulerStore, ptToUnit, unitToPt } from '@/store/ruler-store';
import { useResolvedDarkTheme } from '@/components/common/theme-utils';
import { cn } from '@/utils/cn';

interface RulerGuideOverlayProps {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  scale: number;
  pageContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function snapCoordinatesToGuides(
  xPt: number,
  yPt: number,
  pageIndex: number,
  widthPt: number,
  heightPt: number,
  thresholdPt = 6
): { xPt: number; yPt: number } {
  const { snapToGuides, snapToGrid, gridSizePt, horizontalGuidesByPage, verticalGuidesByPage } =
    useRulerStore.getState();

  let snappedX = xPt;
  let snappedY = yPt;

  if (snapToGuides) {
    const vGuides = [...(verticalGuidesByPage[pageIndex] || []), widthPt / 2];
    for (const gx of vGuides) {
      if (Math.abs(snappedX - gx) <= thresholdPt) {
        snappedX = gx;
        break;
      }
    }

    const hGuides = [...(horizontalGuidesByPage[pageIndex] || []), heightPt / 2];
    for (const gy of hGuides) {
      if (Math.abs(snappedY - gy) <= thresholdPt) {
        snappedY = gy;
        break;
      }
    }
  }

  if (snapToGrid && gridSizePt > 0) {
    const gridX = Math.round(snappedX / gridSizePt) * gridSizePt;
    const gridY = Math.round(snappedY / gridSizePt) * gridSizePt;
    if (Math.abs(snappedX - gridX) <= thresholdPt) snappedX = gridX;
    if (Math.abs(snappedY - gridY) <= thresholdPt) snappedY = gridY;
  }

  return { xPt: snappedX, yPt: snappedY };
}

export const RulerGuideOverlay: React.FC<RulerGuideOverlayProps> = ({
  pageIndex,
  widthPt,
  heightPt,
  scale,
  pageContainerRef,
}) => {
  const {
    showRulers,
    showGrid,
    unit,
    gridSizePt,
    snapToGuides,
    snapToGrid,
    horizontalGuidesByPage,
    verticalGuidesByPage,
    addHorizontalGuide,
    addVerticalGuide,
    removeHorizontalGuide,
    removeVerticalGuide,
    mousePosition,
    setMousePosition,
  } = useRulerStore();

  const isDark = useResolvedDarkTheme();

  const [draggingGuide, setDraggingGuide] = useState<{
    type: 'h' | 'v';
    initialValPt: number;
    currentValPt: number;
    index?: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const hGuides = horizontalGuidesByPage[pageIndex] || [];
  const vGuides = verticalGuidesByPage[pageIndex] || [];

  const pageWidthPx = widthPt * scale;
  const pageHeightPx = heightPt * scale;

  // Attach mouse tracking directly to pageContainerRef because this overlay is pointer-events-none
  useEffect(() => {
    if (!showRulers) return;
    const target = pageContainerRef?.current || containerRef.current?.parentElement;
    if (!target) return;

    const handleMove = (e: MouseEvent) => {
      const rect = target.getBoundingClientRect();
      const xPt = (e.clientX - rect.left) / scale;
      const yPt = (e.clientY - rect.top) / scale;
      setMousePosition({ xPt, yPt });
    };

    const handleLeave = () => {
      setMousePosition(null);
    };

    target.addEventListener('mousemove', handleMove);
    target.addEventListener('mouseleave', handleLeave);
    return () => {
      target.removeEventListener('mousemove', handleMove);
      target.removeEventListener('mouseleave', handleLeave);
    };
  }, [showRulers, pageContainerRef, scale, setMousePosition]);

  // Handle dragging guides
  useEffect(() => {
    if (!draggingGuide) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (draggingGuide.type === 'h') {
        const yPx = e.clientY - rect.top;
        let yPt = yPx / scale;

        if (snapToGuides && Math.abs(yPt - heightPt / 2) < 6) {
          yPt = heightPt / 2;
        } else if (snapToGrid && gridSizePt > 0) {
          const gridY = Math.round(yPt / gridSizePt) * gridSizePt;
          if (Math.abs(yPt - gridY) < 6) yPt = gridY;
        }

        setDraggingGuide((prev) => (prev ? { ...prev, currentValPt: yPt } : null));
      } else {
        const xPx = e.clientX - rect.left;
        let xPt = xPx / scale;

        if (snapToGuides && Math.abs(xPt - widthPt / 2) < 6) {
          xPt = widthPt / 2;
        } else if (snapToGrid && gridSizePt > 0) {
          const gridX = Math.round(xPt / gridSizePt) * gridSizePt;
          if (Math.abs(xPt - gridX) < 6) xPt = gridX;
        }

        setDraggingGuide((prev) => (prev ? { ...prev, currentValPt: xPt } : null));
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!containerRef.current) {
        setDraggingGuide(null);
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();

      if (draggingGuide.type === 'h') {
        const yPx = e.clientY - rect.top;
        const yPt = yPx / scale;

        if (yPt < -20 || yPt > heightPt + 20) {
          if (draggingGuide.index !== undefined) {
            removeHorizontalGuide(pageIndex, draggingGuide.index);
          }
        } else {
          if (draggingGuide.index !== undefined) {
            removeHorizontalGuide(pageIndex, draggingGuide.index);
          }
          addHorizontalGuide(pageIndex, draggingGuide.currentValPt);
        }
      } else {
        const xPx = e.clientX - rect.left;
        const xPt = xPx / scale;

        if (xPt < -20 || xPt > widthPt + 20) {
          if (draggingGuide.index !== undefined) {
            removeVerticalGuide(pageIndex, draggingGuide.index);
          }
        } else {
          if (draggingGuide.index !== undefined) {
            removeVerticalGuide(pageIndex, draggingGuide.index);
          }
          addVerticalGuide(pageIndex, draggingGuide.currentValPt);
        }
      }

      setDraggingGuide(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    draggingGuide,
    scale,
    widthPt,
    heightPt,
    pageIndex,
    snapToGuides,
    snapToGrid,
    gridSizePt,
    addHorizontalGuide,
    addVerticalGuide,
    removeHorizontalGuide,
    removeVerticalGuide,
  ]);

  const formatUnitValue = (pt: number) => {
    const val = ptToUnit(pt, unit);
    return `${val.toFixed(1)} ${unit}`;
  };

  const renderHorizontalRulerTicks = () => {
    const ticks: JSX.Element[] = [];
    const maxUnits = ptToUnit(widthPt, unit);
    const stepUnit = unit === 'mm' ? 10 : unit === 'cm' ? 1 : unit === 'in' ? 0.5 : 50;

    for (let u = 0; u <= maxUnits; u += stepUnit) {
      const pt = unitToPt(u, unit);
      const px = pt * scale;
      if (px > pageWidthPx) break;

      ticks.push(
        <div
          key={u}
          style={{ left: `${px}px` }}
          className="absolute top-0 h-full flex flex-col justify-between border-l border-slate-400/60 dark:border-slate-600/60"
        >
          <span className="text-[8px] font-mono select-none pl-0.5 leading-none text-slate-500 dark:text-slate-400">
            {u}
          </span>
        </div>
      );
    }
    return ticks;
  };

  const renderVerticalRulerTicks = () => {
    const ticks: JSX.Element[] = [];
    const maxUnits = ptToUnit(heightPt, unit);
    const stepUnit = unit === 'mm' ? 10 : unit === 'cm' ? 1 : unit === 'in' ? 0.5 : 50;

    for (let u = 0; u <= maxUnits; u += stepUnit) {
      const pt = unitToPt(u, unit);
      const py = pt * scale;
      if (py > pageHeightPx) break;

      ticks.push(
        <div
          key={u}
          style={{ top: `${py}px` }}
          className="absolute left-0 w-full flex items-start border-t border-slate-400/60 dark:border-slate-600/60"
        >
          <span className="text-[8px] font-mono select-none pt-0.5 leading-none text-slate-500 dark:text-slate-400">
            {u}
          </span>
        </div>
      );
    }
    return ticks;
  };

  if (!showRulers && !showGrid && hGuides.length === 0 && vGuides.length === 0 && !draggingGuide) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="no-print absolute inset-0 pointer-events-none select-none z-[18] overflow-visible"
    >
      {/* 1. Subtle Grid Overlay */}
      {showGrid && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-25"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id={`grid-pattern-${pageIndex}`}
              width={gridSizePt * scale}
              height={gridSizePt * scale}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSizePt * scale} 0 L 0 0 0 ${gridSizePt * scale}`}
                fill="none"
                stroke={isDark ? '#38bdf8' : '#0284c7'}
                strokeWidth="0.75"
                strokeDasharray="2,2"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#grid-pattern-${pageIndex})`} />
        </svg>
      )}

      {/* Corner Origin Box when Rulers Visible */}
      {showRulers && (
        <div
          className={cn(
            'ruler-overlay-strip absolute -top-5 -left-5 w-5 h-5 border-r border-b flex items-center justify-center text-[7px] font-mono font-bold z-20',
            isDark
              ? 'bg-slate-800 border-slate-700 text-slate-400'
              : 'bg-slate-100 border-slate-300 text-slate-600'
          )}
        >
          {unit}
        </div>
      )}

      {/* 2. Top Horizontal Ruler */}
      {showRulers && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            const rect = containerRef.current?.getBoundingClientRect();
            const initialYPt = rect ? Math.max(0, (e.clientY - rect.top) / scale) : 0;
            setDraggingGuide({ type: 'h', initialValPt: initialYPt, currentValPt: initialYPt });
          }}
          style={{ width: `${pageWidthPx}px` }}
          className={cn(
            'ruler-overlay-strip absolute -top-5 left-0 h-5 border-b pointer-events-auto cursor-ns-resize shadow-sm overflow-hidden transition-colors',
            isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
          )}
          title="Yatay Kılavuz Çizgisi Çekmek İçin Aşağı Sürükleyin"
        >
          {renderHorizontalRulerTicks()}

          {mousePosition && mousePosition.xPt >= 0 && mousePosition.xPt <= widthPt && (
            <div
              style={{ left: `${mousePosition.xPt * scale}px` }}
              className="absolute top-0 bottom-0 w-[1.5px] bg-rose-500 z-10"
            />
          )}
        </div>
      )}

      {/* 3. Left Vertical Ruler */}
      {showRulers && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            const rect = containerRef.current?.getBoundingClientRect();
            const initialXPt = rect ? Math.max(0, (e.clientX - rect.left) / scale) : 0;
            setDraggingGuide({ type: 'v', initialValPt: initialXPt, currentValPt: initialXPt });
          }}
          style={{ height: `${pageHeightPx}px` }}
          className={cn(
            'ruler-overlay-strip absolute -left-5 top-0 w-5 border-r pointer-events-auto cursor-ew-resize shadow-sm overflow-hidden transition-colors',
            isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'
          )}
          title="Dikey Kılavuz Çizgisi Çekmek İçin Sağa Sürükleyin"
        >
          {renderVerticalRulerTicks()}

          {mousePosition && mousePosition.yPt >= 0 && mousePosition.yPt <= heightPt && (
            <div
              style={{ top: `${mousePosition.yPt * scale}px` }}
              className="absolute left-0 right-0 h-[1.5px] bg-rose-500 z-10"
            />
          )}
        </div>
      )}

      {/* 4. Horizontal Guides */}
      {hGuides.map((yPt, gIdx) => {
        const topPx = yPt * scale;
        return (
          <div
            key={gIdx}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDraggingGuide({ type: 'h', initialValPt: yPt, currentValPt: yPt, index: gIdx });
            }}
            style={{ top: `${topPx}px` }}
            className="absolute left-0 w-full h-[1.5px] bg-sky-500 pointer-events-auto cursor-ns-resize group z-20 hover:h-[3px] transition-all"
            title={`Yatay Kılavuz: ${formatUnitValue(yPt)} (Kaldırmak için belge dışına sürükleyin)`}
          >
            <span className="hidden group-hover:block absolute left-2 -top-5 text-[9px] font-mono font-bold bg-sky-600 text-white px-1.5 py-0.5 rounded shadow-sm">
              Y: {formatUnitValue(yPt)}
            </span>
          </div>
        );
      })}

      {/* 5. Vertical Guides */}
      {vGuides.map((xPt, gIdx) => {
        const leftPx = xPt * scale;
        return (
          <div
            key={gIdx}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDraggingGuide({ type: 'v', initialValPt: xPt, currentValPt: xPt, index: gIdx });
            }}
            style={{ left: `${leftPx}px` }}
            className="absolute top-0 h-full w-[1.5px] bg-sky-500 pointer-events-auto cursor-ew-resize group z-20 hover:w-[3px] transition-all"
            title={`Dikey Kılavuz: ${formatUnitValue(xPt)} (Kaldırmak için belge dışına sürükleyin)`}
          >
            <span className="hidden group-hover:block absolute top-2 left-2 text-[9px] font-mono font-bold bg-sky-600 text-white px-1.5 py-0.5 rounded shadow-sm">
              X: {formatUnitValue(xPt)}
            </span>
          </div>
        );
      })}

      {/* 6. Currently Dragging Guide Indicator */}
      {draggingGuide && (
        <div
          style={{
            ...(draggingGuide.type === 'h'
              ? {
                  top: `${draggingGuide.currentValPt * scale}px`,
                  left: 0,
                  width: '100%',
                  height: '2px',
                }
              : {
                  left: `${draggingGuide.currentValPt * scale}px`,
                  top: 0,
                  height: '100%',
                  width: '2px',
                }),
          }}
          className="absolute bg-rose-500 pointer-events-none z-30 shadow-md"
        >
          <span
            className={cn(
              'absolute text-[10px] font-mono font-extrabold bg-rose-600 text-white px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap',
              draggingGuide.type === 'h' ? 'left-6 -top-6' : 'top-6 left-2'
            )}
          >
            {draggingGuide.type === 'h' ? 'Y: ' : 'X: '}
            {formatUnitValue(draggingGuide.currentValPt)}
          </span>
        </div>
      )}
    </div>
  );
};
