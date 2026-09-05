import React, { useRef, useEffect, useCallback } from 'react';
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
  const { zoom, setZoom, fitMode, viewMode } = useViewerStore();
  const { updateActiveTabState, tabs } = useTabStore();

  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

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
      return Math.max(0.2, Math.min(4.0, parseFloat(scale.toFixed(2))));
    } else if (currentFit === 'page') {
      const scaleW = availableWidth / targetWidth;
      const scaleH = availableHeight / targetHeight;
      const scale = Math.min(scaleW, scaleH);
      return Math.max(0.2, Math.min(4.0, parseFloat(scale.toFixed(2))));
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

  // FIX: When zoom changes, suppress scroll-handler and restore scroll to the active page
  // This prevents the page-jump bug where growing/shrinking page heights shift the visible page
  useEffect(() => {
    if (!currentDocument || !containerRef.current) return;

    // Mark as zooming so handleScroll won't reassign activePageIndex mid-resize
    isZoomingRef.current = true;
    if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);

    // Two rAFs: first lets React commit new page sizes, second lets browser re-layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const pageEl = document.getElementById(`page-container-${currentDocument.activePageIndex}`);
        if (pageEl && containerRef.current) {
          containerRef.current.scrollTo({
            top: Math.max(0, pageEl.offsetTop - 16),
            behavior: 'auto',
          });
        }
        // Keep suppression briefly to absorb the scroll event fired by scrollTo above
        zoomEndTimerRef.current = setTimeout(() => {
          isZoomingRef.current = false;
        }, 120);
      });
    });
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track scroll position to update tab state
  const handleScroll = useCallback(() => {
    // Suppress during tab switch AND during zoom restore
    if (isTabSwitchingRef.current || isZoomingRef.current || !containerRef.current || !currentDocument) return;
    const scrollTop = containerRef.current.scrollTop;
    updateActiveTabState(currentDocument.activePageIndex, scrollTop, zoom);
  }, [currentDocument, zoom, updateActiveTabState]);

  // Handle Ctrl + Wheel for zoom & Normal Wheel in Single-Page view for page switching
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.002;
        setZoom((prev) => Math.max(0.2, Math.min(4.0, prev + delta)));
        return;
      }

      // In single-page mode, mouse wheel navigates between pages smoothly
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

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onScroll={handleScroll}
      className="relative flex-1 overflow-auto bg-slate-900/50 dark:bg-slate-950/70 p-4 transition-colors flex justify-center"
      tabIndex={0}
    >
      <SearchOverlay />

      <div className={cn('w-full max-w-full', gridClass)}>
        {renderedPages.map((page) => {
          const originalIndex = pages.findIndex((p) => p.id === page.id);
          return (
            <PageView
              key={page.id}
              page={page}
              index={originalIndex !== -1 ? originalIndex : 0}
              scale={zoom}
            />
          );
        })}
      </div>
    </div>
  );
};
