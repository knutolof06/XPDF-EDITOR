import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useTabStore } from '@/store/tab-store';
import { PageView } from './PageView';
import { SearchOverlay } from './SearchOverlay';
import { useViewerUIState } from './viewer-ui-state';
import { syncActiveTool } from '@/components/common/pdf-actions';
import { updateDynamicBitmapCapacity } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';
import { cn } from '@/utils/cn';

export const PdfViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelTimeRef = useRef<number>(0);
  const lastDocIdRef = useRef<string | null>(null);
  const isTabSwitchingRef = useRef<boolean>(false);
  const isZoomingRef = useRef<boolean>(false);
  const isScrollSyncingActivePageRef = useRef<boolean>(false);
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { currentDocument, setActivePageIndex } = useDocumentStore();
  const { zoom, setZoom, fitMode, setFitMode, viewMode, activeTool } = useViewerStore();
  const { updateActiveTabState, tabs } = useTabStore();
  const twoPageCoverOffset = useViewerUIState((s) => s.twoPageCoverOffset);

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
  const [isPanning, setIsPanning] = useState(false);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, clientHeight: 1000 });

  const panStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  // Sync legacy viewMode ('fit-width' | 'fit-page') with fitMode
  useEffect(() => {
    if (viewMode === 'fit-page' && fitMode !== 'page') {
      setFitMode('page');
    } else if (viewMode === 'fit-width' && fitMode !== 'width') {
      setFitMode('width');
    }
  }, [viewMode, fitMode, setFitMode]);

  // Listen to native print lifecycle so all pages mount if window.print() is triggered directly
  useEffect(() => {
    const onBeforePrint = () => setIsPreparingPrint(true);
    const onAfterPrint = () => setIsPreparingPrint(false);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

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
      const isSingleCover = twoPageCoverOffset && currentDocument.activePageIndex === 0;
      targetWidth = isSingleCover ? pageWidth : pageWidth * 2 + 24;
    } else if (viewMode === 'four-page') {
      targetWidth = pageWidth * 2 + 24;
      targetHeight = pageHeight * 2 + 24;
    }

    const availableWidth = Math.max(100, containerWidth - horizontalPadding);
    const availableHeight = Math.max(100, containerHeight - verticalPadding);

    const effectiveFit =
      viewMode === 'fit-page'
        ? 'page'
        : viewMode === 'fit-width'
        ? 'width'
        : fitModeRef.current;

    if (effectiveFit === 'width') {
      const scale = availableWidth / targetWidth;
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    } else if (effectiveFit === 'content') {
      const contentWidth = targetWidth * 0.72;
      const scale = availableWidth / contentWidth;
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    } else if (effectiveFit === 'page') {
      const scaleW = availableWidth / targetWidth;
      const scaleH = availableHeight / targetHeight;
      const scale = Math.min(scaleW, scaleH);
      return Math.max(0.2, Math.min(5.0, parseFloat(scale.toFixed(2))));
    }

    return null;
  }, [currentDocument, viewMode, twoPageCoverOffset]);

  // Responsive ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (fitModeRef.current !== 'none' || viewMode === 'fit-page' || viewMode === 'fit-width') {
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
  }, [computeFitScale, setZoom, viewMode]);

  // Adjust scale immediately when fitMode, active document, viewMode, or cover offset changes
  useEffect(() => {
    if (fitMode !== 'none' || viewMode === 'fit-page' || viewMode === 'fit-width') {
      const newScale = computeFitScale();
      if (newScale !== null && Math.abs(newScale - zoom) >= 0.01) {
        setZoom(newScale, true);
      }
    }
  }, [fitMode, currentDocument?.id, viewMode, twoPageCoverOffset, computeFitScale, setZoom, zoom]);

  // Precalculate cumulative offsets (including PageView's my-4 = 32px vertical margin + gap-6 = 24px)
  const pageOffsets = useMemo(() => {
    if (!currentDocument) return [];
    const offsets: { top: number; bottom: number; height: number; width: number }[] = [];
    let accTop = 32 + 16; // py-8 (32px) + first page top margin (16px)
    const verticalGap = 24 + 32; // flex gap-6 (24px) + bottom margin (16px) + next top margin (16px)
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
      accTop += h + verticalGap;
    }
    return offsets;
  }, [currentDocument, zoom]);

  // Check if a page should have its full PageView mounted
  const isPageMounted = useCallback(
    (index: number) => {
      if (isPreparingPrint) return true;
      if (viewMode !== 'continuous' && viewMode !== 'fit-width') return true;
      if (!currentDocument || currentDocument.pages.length <= 6) return true;
      const offset = pageOffsets[index];
      if (!offset) return true;

      const buffer = Math.max(1200, scrollState.clientHeight * 1.5);
      const viewTop = Math.max(0, scrollState.scrollTop - buffer);
      const viewBottom = scrollState.scrollTop + scrollState.clientHeight + buffer;

      return offset.bottom >= viewTop && offset.top <= viewBottom;
    },
    [isPreparingPrint, viewMode, currentDocument, pageOffsets, scrollState.scrollTop, scrollState.clientHeight]
  );

  const pages = useMemo(() => currentDocument?.pages || [], [currentDocument]);

  const renderedPages = useMemo(() => {
    if (!currentDocument || pages.length === 0) return [];
    if (viewMode === 'single' || viewMode === 'fit-page') {
      return [pages[currentDocument.activePageIndex] || pages[0]];
    }
    if (viewMode === 'two-page') {
      if (twoPageCoverOffset) {
        if (currentDocument.activePageIndex === 0) {
          return [pages[0]];
        }
        const pairStart = 1 + Math.floor((currentDocument.activePageIndex - 1) / 2) * 2;
        return pages.slice(pairStart, pairStart + 2);
      }
      const startIdx = Math.floor(currentDocument.activePageIndex / 2) * 2;
      return pages.slice(startIdx, startIdx + 2);
    }
    if (viewMode === 'four-page') {
      const startIdx = Math.floor(currentDocument.activePageIndex / 4) * 4;
      return pages.slice(startIdx, startIdx + 4);
    }
    return pages;
  }, [currentDocument, pages, viewMode, twoPageCoverOffset]);

  // Dynamically update bitmap cache capacity to prevent thrashing
  useEffect(() => {
    updateDynamicBitmapCapacity(renderedPages.length);
  }, [renderedPages.length]);

  // On Tab switch / document change: restore scroll position & zoom cleanly
  useEffect(() => {
    if (!currentDocument || !containerRef.current) return;

    if (lastDocIdRef.current !== currentDocument.id) {
      lastDocIdRef.current = currentDocument.id;
      isTabSwitchingRef.current = true;

      const currentTab = tabs.find((t) => t.id === currentDocument.id);
      const targetPage = currentTab?.activePageIndex ?? currentDocument.activePageIndex ?? 0;

      if (fitModeRef.current === 'none' && currentTab?.zoom && Math.abs(currentTab.zoom - zoomRef.current) >= 0.01) {
        setZoom(currentTab.zoom, true);
      }

      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        if (currentTab && currentTab.scrollTop > 0) {
          containerRef.current.scrollTop = currentTab.scrollTop;
          setScrollState({
            scrollTop: currentTab.scrollTop,
            clientHeight: containerRef.current.clientHeight || 1000,
          });
        } else {
          const pageElement = document.getElementById(`page-container-${targetPage}`);
          if (pageElement) {
            const top = Math.max(0, pageElement.offsetTop - 16);
            containerRef.current.scrollTo({ top, behavior: 'auto' });
            setScrollState({
              scrollTop: top,
              clientHeight: containerRef.current.clientHeight || 1000,
            });
          } else {
            containerRef.current.scrollTop = 0;
          }
        }

        setTimeout(() => {
          isTabSwitchingRef.current = false;
        }, 150);
      });
    }
  }, [currentDocument, tabs, setZoom]);

  // Scroll to active page when programmatically changed within same document
  useEffect(() => {
    if (!currentDocument || !containerRef.current || isTabSwitchingRef.current) return;

    if (isScrollSyncingActivePageRef.current) {
      isScrollSyncingActivePageRef.current = false;
      return;
    }

    const targetIdx = currentDocument.activePageIndex;
    const pageElement = document.getElementById(`page-container-${targetIdx}`);
    const fallbackOffset = pageOffsets[targetIdx];
    const targetTop = pageElement
      ? Math.max(0, pageElement.offsetTop - 16)
      : fallbackOffset
      ? Math.max(0, fallbackOffset.top - 16)
      : null;

    if (targetTop !== null && containerRef.current) {
      const currentTop = containerRef.current.scrollTop;
      const diff = Math.abs(targetTop - currentTop);

      if (diff >= 30) {
        const behavior: ScrollBehavior = diff > 2500 ? 'auto' : 'smooth';
        containerRef.current.scrollTo({ top: targetTop, behavior });
      }
    }

    cancelActivePreload();
  }, [currentDocument?.activePageIndex, currentDocument, pageOffsets]);

  // Sub-pixel focal-point zoom adjustment
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

        container.scrollTo({
          left: Math.max(0, newContentX - viewportX),
          top: Math.max(0, newContentY - viewportY),
          behavior: 'auto',
        });
      }
    } else if (fitModeRef.current !== 'none') {
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

  // Window capture for Marquee Zoom and Hand Pan
  useEffect(() => {
    if (!marqueeRect && !isPanning) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (isPanning && panStateRef.current) {
        const dx = e.clientX - panStateRef.current.startX;
        const dy = e.clientY - panStateRef.current.startY;
        container.scrollLeft = panStateRef.current.startScrollLeft - dx;
        container.scrollTop = panStateRef.current.startScrollTop - dy;
        return;
      }

      if (marqueeRect) {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft;
        const y = e.clientY - rect.top + container.scrollTop;
        setMarqueeRect((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));
      }
    };

    const handleWindowMouseUp = () => {
      if (isPanning) {
        panStateRef.current = null;
        setIsPanning(false);
      }

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
            Math.min(marqueeRect.startX, marqueeRect.currentX) + boxW / 2;
          const boxCenterContentY =
            Math.min(marqueeRect.startY, marqueeRect.currentY) + boxH / 2;

          zoomAnchorRef.current = {
            contentX: boxCenterContentX,
            contentY: boxCenterContentY,
            viewportX: container.clientWidth / 2,
            viewportY: container.clientHeight / 2,
            oldZoom: zoomRef.current,
          };

          setZoom(targetZoom);
          if (activeTool === 'marquee-zoom') {
            syncActiveTool('select');
          }
        }
        setMarqueeRect(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [marqueeRect, isPanning, activeTool, setZoom]);

  // Track scroll position -> update activePageIndex, tab state & virtualization window
  const handleScroll = useCallback(() => {
    if (isTabSwitchingRef.current || isZoomingRef.current || !containerRef.current || !currentDocument) return;
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;

    let nextActiveIndex = currentDocument.activePageIndex;

    if (viewMode === 'continuous' || viewMode === 'fit-width') {
      const probeY = scrollTop + clientHeight * 0.35;
      let matched = -1;

      for (let i = 0; i < pageOffsets.length; i++) {
        const el = document.getElementById(`page-container-${i}`);
        const top = el ? el.offsetTop : pageOffsets[i].top;
        const bottom = el ? top + el.offsetHeight : pageOffsets[i].bottom;
        if (probeY >= top - 28 && probeY <= bottom + 28) {
          matched = i;
          break;
        }
        if (top <= probeY) {
          matched = i;
        }
      }

      if (matched !== -1 && matched !== currentDocument.activePageIndex) {
        nextActiveIndex = matched;
        isScrollSyncingActivePageRef.current = true;
        setActivePageIndex(matched);
      }
    }

    updateActiveTabState(nextActiveIndex, scrollTop, zoom);

    setScrollState((prev) => {
      if (Math.abs(prev.scrollTop - scrollTop) > 30 || Math.abs(prev.clientHeight - clientHeight) > 20) {
        return { scrollTop, clientHeight };
      }
      return prev;
    });
  }, [currentDocument, viewMode, pageOffsets, zoom, setActivePageIndex, updateActiveTabState]);

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

        zoomAnchorRef.current = {
          contentX: container.scrollLeft + viewportX,
          contentY: container.scrollTop + viewportY,
          viewportX,
          viewportY,
          oldZoom: zoomRef.current,
        };

        const delta = -e.deltaY * 0.0025;
        setZoom((prev) => Math.max(0.2, Math.min(5.0, prev + delta)));
        return;
      }

      if ((viewMode === 'single' || viewMode === 'fit-page') && currentDocument && containerRef.current) {
        const container = containerRef.current;
        const canScrollVertically = container.scrollHeight > container.clientHeight + 4;
        const atTop = container.scrollTop <= 6;
        const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 6;

        const now = Date.now();
        if (now - lastWheelTimeRef.current > 200) {
          if (e.deltaY > 25 && (!canScrollVertically || atBottom)) {
            if (currentDocument.activePageIndex < currentDocument.totalPages - 1) {
              lastWheelTimeRef.current = now;
              setActivePageIndex(currentDocument.activePageIndex + 1);
              container.scrollTop = 0;
            }
          } else if (e.deltaY < -25 && (!canScrollVertically || atTop)) {
            if (currentDocument.activePageIndex > 0) {
              lastWheelTimeRef.current = now;
              setActivePageIndex(currentDocument.activePageIndex - 1);
              container.scrollTop = 0;
            }
          }
        }
      }
    },
    [setZoom, viewMode, currentDocument, setActivePageIndex]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    if (activeTool === 'marquee-zoom' || e.shiftKey) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left + container.scrollLeft;
      const y = e.clientY - rect.top + container.scrollTop;
      setMarqueeRect({ startX: x, startY: y, currentX: x, currentY: y });
      return;
    }

    if ((activeTool === 'hand' && e.button === 0) || e.button === 1) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)) {
        return;
      }
      e.preventDefault();
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: container.scrollLeft,
        startScrollTop: container.scrollTop,
      };
      setIsPanning(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;

    if (activeTool === 'laser') {
      setLaserPos({ x, y });
    } else if (laserPos) {
      setLaserPos(null);
    }
  };

  const handleMouseLeave = () => {
    if (laserPos) setLaserPos(null);
  };

  if (!currentDocument) return null;

  const gridClass =
    {
      continuous: 'flex flex-col gap-6 py-8 min-w-full w-max mx-auto',
      'continuous-horizontal': 'flex flex-row items-center gap-6 px-8 py-4 min-h-full w-max',
      single: 'flex min-h-full min-w-full w-max mx-auto py-8 px-4',
      'two-page': 'grid grid-cols-2 gap-6 p-8 place-items-center min-h-full min-w-full w-max mx-auto',
      'four-page': 'grid grid-cols-2 gap-6 p-8 place-items-center min-h-full min-w-full w-max mx-auto',
      'fit-width': 'flex flex-col gap-6 py-8 min-w-full w-max mx-auto',
      'fit-page': 'flex min-h-full min-w-full w-max mx-auto py-8 px-4',
    }[viewMode] || 'flex flex-col gap-6 py-8 min-w-full w-max mx-auto';

  const isSingleLike = viewMode === 'single' || viewMode === 'fit-page';

  return (
    <div id="pdf-viewer-root" className="relative flex-1 flex flex-col overflow-hidden">
      <SearchOverlay />

      <div
        id="pdf-viewer-scroll"
        ref={containerRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'relative flex-1 overflow-auto bg-slate-200/70 dark:bg-slate-950/75 p-4 transition-colors block select-none',
          activeTool === 'marquee-zoom'
            ? 'cursor-crosshair'
            : activeTool === 'laser'
            ? 'cursor-none'
            : activeTool === 'hand'
            ? isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-default'
        )}
        tabIndex={0}
      >
        {/* Marquee Zoom Selection Box (content coordinates) */}
        {marqueeRect && (
          <div
            className="no-print absolute pointer-events-none border-2 border-sky-400 bg-sky-500/20 rounded shadow-lg z-50 border-dashed"
            style={{
              left: Math.min(marqueeRect.startX, marqueeRect.currentX),
              top: Math.min(marqueeRect.startY, marqueeRect.currentY),
              width: Math.abs(marqueeRect.currentX - marqueeRect.startX),
              height: Math.abs(marqueeRect.currentY - marqueeRect.startY),
            }}
          />
        )}

        {/* Presentation Laser Pointer Overlay (content coordinates) */}
        {laserPos && activeTool === 'laser' && (
          <div
            className="no-print absolute pointer-events-none z-50"
            style={{
              left: laserPos.x - 7,
              top: laserPos.y - 7,
            }}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-red-500 shadow-[0_0_14px_4px_rgba(239,68,68,0.9)] animate-pulse" />
          </div>
        )}

        <div className={gridClass}>
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
                  className={cn(
                    'bg-white/85 dark:bg-slate-900/50 rounded-lg shadow-md border border-slate-200 dark:border-slate-800/80 shrink-0 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 select-none pointer-events-none my-4 mx-auto',
                    isSingleLike && 'm-auto'
                  )}
                >
                  Sayfa {page.displayPageNumber}
                </div>
              );
            }

            return (
              <div key={page.id} className={cn(isSingleLike ? 'm-auto' : 'mx-auto')}>
                <PageView
                  page={page}
                  index={idx}
                  scale={zoom}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
