import React, { useRef, useEffect, useCallback } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { PageView } from './PageView';
import { SearchOverlay } from './SearchOverlay';
import { cn } from '@/utils/cn';

export const PdfViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelTimeRef = useRef<number>(0);
  const { currentDocument, setActivePageIndex } = useDocumentStore();
  const { zoom, setZoom, viewMode } = useViewerStore();

  // Scroll to active page when changed from sidebar / bottom bar
  useEffect(() => {
    if (!currentDocument || !containerRef.current) return;

    const pageElement = document.getElementById(
      `page-container-${currentDocument.activePageIndex}`
    );
    if (pageElement) {
      pageElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }, [currentDocument?.activePageIndex]);

  // Handle Ctrl + Wheel for zoom & Normal Wheel in Single-Page view for page switching (Rule 7)
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
