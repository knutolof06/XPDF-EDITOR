import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { AnnotationLayer } from './AnnotationLayer';
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
  // renderScale is debounced: layout uses immediate `scale`, canvas renders after zoom settles
  const [renderScale, setRenderScale] = useState(scale);
  const { pdfDocProxy: globalPdfDocProxy } = useDocumentStore();
  const pdfDocProxy = customPdfDocProxy || globalPdfDocProxy;
  const { pageTransition } = useViewerStore();

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

  // IntersectionObserver: Only render pages that are near/inside viewport (Rule 2)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          // If page is far away, keep rendered state or unload to save memory
          setIsVisible(false);
        }
      },
      {
        rootMargin: '500px 0px 500px 0px', // Preload 500px before appearing
        threshold: 0.01,
      }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function renderPage() {
      if (!isVisible || !pdfDocProxy || !canvasRef.current) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }

      try {
        const pdfPage = await pdfDocProxy.getPage(page.sourcePageIndex + 1);
        if (isCancelled) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for high performance
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

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const task = pdfPage.render(renderContext);
        renderTaskRef.current = task;

        await task.promise;
        if (isCancelled) return;

        setIsRendered(true);

        if (textLayerRef.current) {
          textLayerRef.current.innerHTML = '';
          textLayerRef.current.style.width = `${Math.floor(cssViewport.width)}px`;
          textLayerRef.current.style.height = `${Math.floor(cssViewport.height)}px`;

          const textContent = await pdfPage.getTextContent();
          if (isCancelled || !textLayerRef.current) return;

          let renderedWithOfficial = false;
          try {
            // @ts-ignore
            if (typeof pdfjsLib.TextLayer === 'function') {
              // @ts-ignore
              const textLayer = new pdfjsLib.TextLayer({
                textContentSource: textContent,
                container: textLayerRef.current,
                viewport: cssViewport,
              });
              await textLayer.render();
              renderedWithOfficial = true;
            }
          } catch (tErr) {
            console.warn('TextLayer render error:', tErr);
          }

          if (!renderedWithOfficial && textLayerRef.current) {
            textLayerRef.current.innerHTML = '';
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

            textLayerRef.current.appendChild(fragment);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`Page ${index + 1} render error:`, err);
        }
      }
    }

    if (isVisible) {
      renderPage();
    }

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isVisible, pdfDocProxy, page.sourcePageIndex, page.rotation, renderScale, index]);

  const transitionClass = {
    classic: 'page-transition-classic',
    slide: 'page-transition-slide',
    smooth: 'page-transition-smooth',
    stack: 'page-transition-stack',
    book: 'page-transition-stack',
    zoom: 'page-transition-zoom',
    instant: '',
  }[pageTransition] || 'page-transition-smooth';

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
        'relative bg-white shadow-2xl rounded-sm overflow-hidden flex items-center justify-center my-4 transition-transform duration-200 contain-paint',
        transitionClass
      )}
    >
      {isVisible ? (
        <>
          <canvas
            ref={canvasRef}
            className={cn(
              'block select-none pointer-events-none transition-opacity duration-150',
              isRendered ? 'opacity-100' : 'opacity-0'
            )}
          />

          {/* PDF.js Text Layer */}
          <div
            ref={textLayerRef}
            className="textLayer absolute inset-0 select-text cursor-text z-[2]"
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
        /* Offscreen Placeholder (Zero CPU cost, maintains exact scroll layout) */
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-300">
          <span className="text-xs font-bold text-slate-400">Sayfa {index + 1}</span>
        </div>
      )}
    </div>
  );
};
