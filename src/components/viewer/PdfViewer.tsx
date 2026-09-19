import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useTabStore } from '@/store/tab-store';
import { PageView } from './PageView';
import { SearchOverlay } from './SearchOverlay';
import { updateDynamicBitmapCapacity } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';
import { cn } from '@/utils/cn';

export const PdfViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelTimeRef = useRef<number>(0);
  const lastDocIdRef = useRef<string | null>(null);
  const isTabSwitchingRef = useRef<boolean>(false);
  const isZoomingRef = useRef<boolean>(false);
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { currentDocument, setActivePageIndex } = useDocumentStore();
  const { zoom, setZoom, fitMode, viewMode, readingTheme, activeTool, setActiveTool } = useViewerStore();
  const { updateActiveTabState, tabs } = useTabStore();

  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const zoomAnchorRef = useRef<{
    contentX: number;
    contentY: number;
    viewportX: number;
    viewportY: number;
    oldZoom: number;
  } | null>(null);

  const [marqueeRect, setMarqueeRect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [laserPos, setLaserPos] = useState<{ x: number; y: number } | null>(null);

  // Calculate ideal scale for fit-to-width or fit-to-page
  const computeFitScale = useCallback(() => {
    if (!containerRef.current || !currentDocument) return null;
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (containerWidth <= 100 || containerHeight <= 100) return null;

    const activePage =
      currentDocument.pages[currentDocument.activePageIndex] ||
      currentDocument.pages[0];
    const pageWidth = activePage?.width || 595.28;
    const pageHeight = activePage?.height || 841.89;

    const horizontalPadding = 56;
    const verticalPadding = 48;

    let targetWidth = pageWidth;
    let targetHeight = pageHeight;

    if (viewMode === 'two-page') {
      targetWidth = pageWidth * 2 + 24;
    } else if (viewMode === 'four-page') {
      targetWidth = pageWidth * 2 + 24;
      targetHeight = pageHeight * 2 + 24;
    }

    const availableWidth = Math.max(100, containerWidth - horizontalPadding);
    const availableHeight = Math.max(100, containerHeight - verticalPadding);

    const currentFit = fitModeRef.current;
    if (currentFit === 'width') {
      const scale = availableWidth / targetWidth;
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    } else if (currentFit === 'content') {
      // Smart crop margins (~14% left/right => 72% effective width) to enlarge text body
      const contentWidth = targetWidth * 0.72;
      const scale = availableWidth / contentWidth;
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    } else if (currentFit === 'page') {
      const scaleW = availableWidth / targetWidth;
      const scaleH = availableHeight / targetHeight;
      const scale = Math.min(scaleW, scaleH);
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    }

    return null;
  }, [currentDocument, viewMode]);

  // Responsive ResizeObserver: automatically recalculate scale when container/window resizes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (fitModeRef.current !== 'none') {
          const newScale = computeFitScale();
          if (newScale !== null && Math.abs(newScale - zoomRef.current) >= 0.01) {
            setZoom(newScale, true);
          }
        }
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [computeFitScale, setZoom]);

  // When fitMode, active document or viewMode changes, adjust scale immediately
  useEffect(() => {
    if (fitMode !== 'none') {
      const newScale = computeFitScale();
      if (newScale !== null && Math.abs(newScale - zoom) >= 0.01) {
        setZoom(newScale, true);
      }
    }
  }, [fitMode, currentDocument?.id, viewMode, computeFitScale, setZoom]);

  // On Tab switch / document change: scroll container to this tab's own active page/scroll position
  useEffect(() => {
    if (!currentDocument || !containerRef.current) return;

    if (lastDocIdRef.current !== currentDocument.id) {
      lastDocIdRef.current = currentDocument.id;
      isTabSwitchingRef.current = true;

      // Find saved state of active tab
      const currentTab = tabs.find((t) => t.id === currentDocument.id);
      const targetPage = currentTab?.activePageIndex ?? currentDocument.activePageIndex ?? 0;

      // Quick scroll reset then focus on active page
      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const pageElement = document.getElementById(`page-container-${targetPage}`);
        if (pageElement) {
          containerRef.current.scrollTo({
            top: Math.max(0, pageElement.offsetTop - 16),
            behavior: 'auto',
          });
        } else {
          containerRef.current.scrollTop = currentTab?.scrollTop || 0;
        }

        setTimeout(() => {
          isTabSwitchingRef.current = false;
        }, 150);
      });
    }
  }, [currentDocument?.id, tabs]);

  // Scroll to active page when programmatically changed within same document (BottomBar, Bookmarks, Search)
  useEffect(() => {
    if (!currentDocument || !containerRef.current || isTabSwitchingRef.current) return;

    const pageElement = document.getElementById(
      `page-container-${currentDocument.activePageIndex}`
    );
    if (pageElement && containerRef.current) {
      const targetTop = Math.max(0, pageElement.offsetTop - 16);
      const currentTop = containerRef.current.scrollTop;
      const diff = Math.abs(targetTop - currentTop);

      if (diff < 30) return; // Already there

      // For large jumps (>3 page heights ≈ 2500px), use instant scroll.
      // Smooth scroll through 50 pages renders ALL intermediate pages → 1 min wait.
      const behavior: ScrollBehavior = diff > 2500 ? 'auto' : 'smooth';

      containerRef.current.scrollTo({ top: targetTop, behavior });
    }

    // Cancel any outdated background preloads when user explicitly navigates to a new page
    cancelActivePreload();
  }, [currentDocument?.activePageIndex]);

  // Sub-pixel focal-point zoom adjustment: keeps the mouse cursor (or center) stationary on screen
  useEffect(() => {
    if (!currentDocument || !containerRef.current) return;
    const container = containerRef.current;

    isZoomingRef.current = true;
    if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);

    if (zoomAnchorRef.current) {
      const { contentX, contentY, viewportX, viewportY, oldZoom } = zoomAnchorRef.current;
      zoomAnchorRef.current = null;

      if (oldZoom > 0) {
        const scaleRatio = zoom / oldZoom;
        const newContentX = contentX * scaleRatio;
        const newContentY = contentY * scaleRatio;

        const targetScrollLeft = Math.max(0, newContentX - viewportX);
        const targetScrollTop = Math.max(0, newContentY - viewportY);

        container.scrollTo({
          left: targetScrollLeft,
          top: targetScrollTop,
          behavior: 'auto',
        });
      }
    } else if (fitModeRef.current !== 'none') {
      // Zoom changed from window resize or fit toggle: align active page top
      requestAnimationFrame(() => {
        const pageEl = document.getElementById(`page-container-${currentDocument.activePageIndex}`);
        if (pageEl && containerRef.current) {
          containerRef.current.scrollTo({
            top: Math.max(0, pageEl.offsetTop - 16),
            behavior: 'auto',
          });
        }
      });
    }

    zoomEndTimerRef.current = setTimeout(() => {
      isZoomingRef.current = false;
    }, 140);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const [scrollState, setScrollState] = useState({ scrollTop: 0, clientHeight: 1000 });

  // Track scroll position to update tab state & virtualization window
  const handleScroll = useCallback(() => {
    if (isTabSwitchingRef.current || isZoomingRef.current || !containerRef.current || !currentDocument) return;
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;

    updateActiveTabState(currentDocument.activePageIndex, scrollTop, zoom);

    setScrollState((prev) => {
      if (Math.abs(prev.scrollTop - scrollTop) > 30 || Math.abs(prev.clientHeight - clientHeight) > 20) {
        return { scrollTop, clientHeight };
      }
      return prev;
    });
  }, [currentDocument, zoom, updateActiveTabState]);

  // Handle Ctrl + Wheel for zoom & Normal Wheel in Single-Page view for page switching
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!containerRef.current) return;
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const viewportX = e.clientX - rect.left;
        const viewportY = e.clientY - rect.top;

        const contentX = container.scrollLeft + viewportX;
        const contentY = container.scrollTop + viewportY;

        zoomAnchorRef.current = {
          contentX,
          contentY,
          viewportX,
          viewportY,
          oldZoom: zoomRef.current,
        };

        const delta = -e.deltaY * 0.0025;
        setZoom((prev) => Math.max(0.2, Math.min(5.0, prev + delta)));
        return;
      }

      // In single-page mode or fit-page mode, mouse wheel navigates between pages smoothly
      if (
        (viewMode === 'single' || viewMode === 'fit-page') &&
        currentDocument
      ) {
        const now = Date.now();
        if (now - lastWheelTimeRef.current > 200) {
          if (e.deltaY > 25) {
            if (currentDocument.activePageIndex < currentDocument.totalPages - 1) {
              lastWheelTimeRef.current = now;
              setActivePageIndex(currentDocument.activePageIndex + 1);
            }
          } else if (e.deltaY < -25) {
            if (currentDocument.activePageIndex > 0) {
              lastWheelTimeRef.current = now;
              setActivePageIndex(currentDocument.activePageIndex - 1);
            }
          }
        }
      }
    },
    [setZoom, viewMode, currentDocument, setActivePageIndex]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'marquee-zoom' || e.shiftKey) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMarqueeRect({ startX: x, startY: y, currentX: x, currentY: y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'laser') {
      setLaserPos({ x, y });
    }

    if (marqueeRect) {
      setMarqueeRect((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));
    }
  };

  const handleMouseUp = () => {
    if (marqueeRect && containerRef.current) {
      const container = containerRef.current;
      const boxW = Math.abs(marqueeRect.currentX - marqueeRect.startX);
      const boxH = Math.abs(marqueeRect.currentY - marqueeRect.startY);

      if (boxW > 20 && boxH > 20) {
        const usableW = container.clientWidth - 48;
        const usableH = container.clientHeight - 48;
        const scaleMultiplier = Math.min(usableW / boxW, usableH / boxH);
        const targetZoom = Math.max(
          0.2,
          Math.min(5.0, parseFloat((zoomRef.current * scaleMultiplier * 0.95).toFixed(2)))
        );

        const boxCenterContentX =
          container.scrollLeft + Math.min(marqueeRect.startX, marqueeRect.currentX) + boxW / 2;
        const boxCenterContentY =
          container.scrollTop + Math.min(marqueeRect.startY, marqueeRect.currentY) + boxH / 2;

        zoomAnchorRef.current = {
          contentX: boxCenterContentX,
          contentY: boxCenterContentY,
          viewportX: container.clientWidth / 2,
          viewportY: container.clientHeight / 2,
          oldZoom: zoomRef.current,
        };

        setZoom(targetZoom);
        if (activeTool === 'marquee-zoom') {
          setActiveTool('select');
        }
      }
      setMarqueeRect(null);
    }
  };

  if (!currentDocument) return null;

  const pages = currentDocument.pages;

  // Filter pages according to viewMode
  let renderedPages = pages;
  if (viewMode === 'single') {
    renderedPages = [pages[currentDocument.activePageIndex] || pages[0]];
  } else if (viewMode === 'two-page') {
    const startIdx = Math.floor(currentDocument.activePageIndex / 2) * 2;
    renderedPages = pages.slice(startIdx, startIdx + 2);
  } else if (viewMode === 'four-page') {
    const startIdx = Math.floor(currentDocument.activePageIndex / 4) * 4;
    renderedPages = pages.slice(startIdx, startIdx + 4);
  }

  // Precalculate cumulative offsets for 60 FPS continuous virtual windowing
  const pageOffsets = useMemo(() => {
    if (!currentDocument) return [];
    const offsets: { top: number; bottom: number; height: number; width: number }[] = [];
    let accTop = 32; // py-8
    const gap = 24; // gap-6
    for (let i = 0; i < currentDocument.pages.length; i++) {
      const p = currentDocument.pages[i];
      const h = Math.floor((p.height || 841.89) * zoom);
      const w = Math.floor((p.width || 595.28) * zoom);
      offsets.push({
        top: accTop,
        bottom: accTop + h,
        height: h,
        width: w,
      });
      accTop += h + gap;
    }
    return offsets;
  }, [currentDocument, zoom]);

  // Check if a page should have its full PageView mounted
  const isPageMounted = useCallback(
    (index: number) => {
      if (viewMode !== 'continuous' && viewMode !== 'fit-width') return true;
      if (!currentDocument || currentDocument.pages.length <= 6) return true; // Small docs mount all directly
      const offset = pageOffsets[index];
      if (!offset) return true;

      // Generous buffer: 1.5 screen heights above and below
      const buffer = Math.max(1200, scrollState.clientHeight * 1.5);
      const viewTop = Math.max(0, scrollState.scrollTop - buffer);
      const viewBottom = scrollState.scrollTop + scrollState.clientHeight + buffer;

      return offset.bottom >= viewTop && offset.top <= viewBottom;
    },
    [viewMode, currentDocument, pageOffsets, scrollState.scrollTop, scrollState.clientHeight]
  );

  // Dynamically update bitmap cache capacity to prevent thrashing in multi-page view modes
  useEffect(() => {
    updateDynamicBitmapCapacity(renderedPages.length);
  }, [renderedPages.length]);

  const gridClass = {
    continuous: 'flex flex-col items-center gap-6 py-8',
    'continuous-horizontal': 'flex flex-row items-center gap-6 px-8 py-4 overflow-x-auto',
    single: 'flex items-center justify-center min-h-full py-8',
    'two-page': 'grid grid-cols-2 gap-6 p-8 place-items-center min-h-full',
    'four-page': 'grid grid-cols-2 gap-6 p-8 place-items-center min-h-full',
    'fit-width': 'flex flex-col items-center gap-6 py-8 w-full',
    'fit-page': 'flex items-center justify-center min-h-full py-8',
  }[viewMode] || 'flex flex-col items-center gap-6 py-8';

  const readingFilter = {
    default: 'none',
    dark: 'invert(0.9) hue-rotate(180deg)',
    sepia: 'sepia(0.38) contrast(0.95) brightness(0.96)',
    'high-contrast': 'contrast(1.3) brightness(1.05)',
  }[readingTheme] || 'none';

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={cn(
        'relative flex-1 overflow-auto bg-slate-900/50 dark:bg-slate-950/70 p-4 transition-colors flex justify-center select-none',
        activeTool === 'marquee-zoom'
          ? 'cursor-crosshair'
          : activeTool === 'laser'
          ? 'cursor-none'
          : activeTool === 'hand'
          ? 'cursor-grab'
          : 'cursor-default'
      )}
      tabIndex={0}
    >
      <SearchOverlay />

      {/* Marquee Zoom Selection Box */}
      {marqueeRect && (
        <div
          className="absolute pointer-events-none border-2 border-sky-400 bg-sky-500/20 rounded shadow-lg z-50 border-dashed animate-in fade-in duration-75"
          style={{
            left: Math.min(marqueeRect.startX, marqueeRect.currentX),
            top: Math.min(marqueeRect.startY, marqueeRect.currentY),
            width: Math.abs(marqueeRect.currentX - marqueeRect.startX),
            height: Math.abs(marqueeRect.currentY - marqueeRect.startY),
          }}
        />
      )}

      {/* Presentation Laser Pointer Overlay */}
      {laserPos && activeTool === 'laser' && (
        <div
          className="absolute pointer-events-none z-50 transition-transform duration-75"
          style={{
            left: laserPos.x - 7,
            top: laserPos.y - 7,
          }}
        >
          <div className="w-3.5 h-3.5 rounded-full bg-red-500 shadow-[0_0_14px_4px_rgba(239,68,68,0.9)] animate-pulse" />
        </div>
      )}

      <div
        className={cn('w-full max-w-full transition-[filter] duration-200', gridClass)}
        style={{ filter: readingFilter }}
      >
        {renderedPages.map((page) => {
          const originalIndex = pages.findIndex((p) => p.id === page.id);
          const idx = originalIndex !== -1 ? originalIndex : 0;
          const shouldMount = isPageMounted(idx);

          if (!shouldMount) {
            const offset = pageOffsets[idx];
            return (
              <div
                key={page.id}
                id={`page-container-${idx}`}
                style={{
                  width: offset?.width || Math.floor((page.width || 595.28) * zoom),
                  height: offset?.height || Math.floor((page.height || 841.89) * zoom),
                }}
                className="bg-white/80 dark:bg-slate-900/40 rounded-lg shadow-md border border-slate-200 dark:border-slate-800/80 shrink-0 flex items-center justify-center text-xs text-slate-400 select-none pointer-events-none"
              >
                Sayfa {page.displayPageNumber}
              </div>
            );
          }

          return (
            <PageView
              key={page.id}
              page={page}
              index={idx}
              scale={zoom}
            />
          );
        })}
      </div>
    </div>
  );
};
