import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { AnnotationLayer } from './AnnotationLayer';
import { enqueuePageRender } from '@/core/cache/thumbnail-queue';
import { cn } from '@/utils/cn';

interface PageViewProps {
  page: PdfPageModel;
  index: number;
  scale: number;
  customPdfDocProxy?: pdfjsLib.PDFDocumentProxy;
}

export const PageView: React.FC<PageViewProps> = ({
  page,
  index,
  scale,
  customPdfDocProxy,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [renderScale, setRenderScale] = useState(scale);
  const { pdfDocProxy: globalPdfDocProxy } = useDocumentStore();
  const pdfDocProxy = customPdfDocProxy || globalPdfDocProxy;
  const { pageTransition, searchState } = useViewerStore();

  // Debounce renderScale: update 200ms after scale stops changing
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setRenderScale(scale);
    }, 200);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [scale]);

  // IntersectionObserver: Only render pages that are near/inside viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          setIsVisible(false);
        }
      },
      {
        rootMargin: '200px 0px 200px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Main Page Render Effect
  useEffect(() => {
    let isCancelled = false;
    let cancelQueue: (() => void) | null = null;

    if (!isVisible) return;

    async function renderPage() {
      if (!pdfDocProxy || !canvasRef.current) return;

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      }

      try {
        const pdfPage = await pdfDocProxy.getPage(page.sourcePageIndex + 1);
        if (isCancelled) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const viewport = pdfPage.getViewport({
          scale: renderScale * dpr,
          rotation: page.rotation,
        });

        const cssViewport = pdfPage.getViewport({
          scale: renderScale,
          rotation: page.rotation,
        });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        if (isCancelled) return;

        setIsRendered(true);

        // Precise Text Layer Rendering (100% pixel matching with PDF canvas)
        if (textLayerRef.current) {
          const container = textLayerRef.current;
          container.innerHTML = '';
          container.style.width = `${Math.floor(cssViewport.width)}px`;
          container.style.height = `${Math.floor(cssViewport.height)}px`;
          container.style.setProperty('--scale-factor', `${renderScale}`);
          container.style.setProperty('--main-color', 'transparent');

          const textContent = await pdfPage.getTextContent();
          if (isCancelled || !textLayerRef.current) return;

          let renderedWithOfficial = false;
          try {
            // @ts-ignore
            if (typeof pdfjsLib.TextLayer === 'function') {
              // @ts-ignore
              const textLayer = new pdfjsLib.TextLayer({
                textContentSource: textContent,
                container,
                viewport: cssViewport,
              });
              await textLayer.render();
              renderedWithOfficial = true;
            }
          } catch (tErr) {
            console.warn('TextLayer render error:', tErr);
          }

          // Fallback if official TextLayer unavailable: precise manual glyph positioning
          if (!renderedWithOfficial && textLayerRef.current) {
            container.innerHTML = '';
            const fragment = document.createDocumentFragment();
            textContent.items.forEach((item: any) => {
              if (!item.str) return;
              const span = document.createElement('span');
              span.textContent = item.str;

              const tx = pdfjsLib.Util.transform(
                cssViewport.transform,
                item.transform
              );

              const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
              const itemWidth = (item.width || 0) * renderScale;
              span.style.fontSize = `${fontHeight}px`;
              span.style.fontFamily = item.fontName || 'sans-serif';
              span.style.left = `${tx[4]}px`;
              span.style.top = `${tx[5] - fontHeight}px`;
              if (itemWidth > 0) {
                span.style.width = `${itemWidth}px`;
              }
              span.style.height = `${fontHeight}px`;
              span.style.lineHeight = `${fontHeight}px`;

              fragment.appendChild(span);

              if (item.hasEOL) {
                const br = document.createElement('br');
                fragment.appendChild(br);
              }
            });

            const endOfContent = document.createElement('div');
            endOfContent.className = 'endOfContent';
            fragment.appendChild(endOfContent);

            container.appendChild(fragment);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`Page ${index + 1} render error:`, err);
        }
      }
    }

    // Auto-prioritized: currently visible page gets highest priority immediately (LIFO)
    cancelQueue = enqueuePageRender(renderPage);

    return () => {
      isCancelled = true;
      cancelQueue?.();
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      }
    };
  }, [isVisible, pdfDocProxy, page.sourcePageIndex, page.rotation, renderScale]);

  // Search Highlighting Effect: Highlight matching keywords visibly on the page!
  useEffect(() => {
    if (!isRendered || !textLayerRef.current) return;
    const container = textLayerRef.current;

    // Clear existing highlights
    const existingHighlights = container.querySelectorAll('.search-highlight');
    existingHighlights.forEach((el) => {
      el.classList.remove('search-highlight', 'search-highlight-active');
    });

    if (!searchState.isOpen || !searchState.query || searchState.query.trim().length === 0) {
      return;
    }

    const query = searchState.matchCase ? searchState.query : searchState.query.toLowerCase();
    const currentGlobalMatch = searchState.results[searchState.currentIndex];
    const isCurrentPage = currentGlobalMatch && currentGlobalMatch.pageIndex === index;
    const activeMatchIndexOnPage = isCurrentPage ? currentGlobalMatch.matchIndex : -1;

    const spans = Array.from(container.querySelectorAll('span'));
    let pageMatchCounter = 0;

    for (const span of spans) {
      const rawText = span.textContent || '';
      const text = searchState.matchCase ? rawText : rawText.toLowerCase();

      if (text.includes(query)) {
        const isActive = pageMatchCounter === activeMatchIndexOnPage;
        span.classList.add('search-highlight');

        if (isActive) {
          span.classList.add('search-highlight-active');
          // Smooth scroll to highlight if active
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        pageMatchCounter++;
      }
    }
  }, [isRendered, searchState.isOpen, searchState.query, searchState.matchCase, searchState.currentIndex, searchState.results, index]);

  const transitionClass = {
    classic: 'page-transition-classic',
    slide: 'page-transition-slide',
    smooth: 'page-transition-smooth',
    stack: 'page-transition-stack',
    book: 'page-transition-stack',
    zoom: 'page-transition-zoom',
    instant: '',
  }[pageTransition] || '';

  const baseWidth = (page.width || 595.28) * scale;
  const baseHeight = (page.height || 841.89) * scale;

  return (
    <div
      ref={containerRef}
      id={`page-container-${index}`}
      data-page-index={index}
      style={{
        width: `${Math.floor(baseWidth)}px`,
        minHeight: `${Math.floor(baseHeight)}px`,
        height: `${Math.floor(baseHeight)}px`,
      }}
      className={cn(
        'relative bg-white shadow-2xl rounded-sm overflow-hidden my-4 transition-transform duration-200 contain-paint',
        transitionClass
      )}
    >
      {isVisible ? (
        <>
          <canvas
            ref={canvasRef}
            className={cn(
              'absolute left-0 top-0 block select-none pointer-events-none transition-opacity duration-150',
              isRendered ? 'opacity-100' : 'opacity-0'
            )}
          />

          {/* PDF.js Text Layer with Exact Pixel Alignment */}
          <div
            ref={textLayerRef}
            className="textLayer absolute left-0 top-0 select-text cursor-text z-[2]"
          />

          {/* V3 Interactive Annotation Layer */}
          <AnnotationLayer page={page} scale={scale} />

          {/* Loading Skeleton while canvas is computing */}
          {!isRendered && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 text-slate-400 z-20">
              <div className="w-7 h-7 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mb-2" />
              <span className="text-xs font-semibold text-slate-500">Sayfa {index + 1} Yükleniyor...</span>
            </div>
          )}
        </>
      ) : (
        /* Offscreen Placeholder */
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-300">
          <span className="text-xs font-bold text-slate-400">Sayfa {index + 1}</span>
        </div>
      )}
    </div>
  );
};
