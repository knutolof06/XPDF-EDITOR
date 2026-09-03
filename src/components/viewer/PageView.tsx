import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
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

interface PdfLinkItem {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  url?: string;
  dest?: any;
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
  const [pageLinks, setPageLinks] = useState<PdfLinkItem[]>([]);
  const { pdfDocProxy: globalPdfDocProxy, setActivePageIndex } = useDocumentStore();
  const pdfDocProxy = customPdfDocProxy || globalPdfDocProxy;
  const pageTransition = useViewerStore((s) => s.pageTransition);
  const searchState = useViewerStore((s) => s.searchState);

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

        // Precise Text Layer Rendering (Exact glyph mapping & font scaling)
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
            if (typeof TextLayer === 'function') {
              const textLayer = new TextLayer({
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

          // Fallback if official TextLayer is unavailable: precise manual glyph transforms
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

        // Extract native PDF Links (Hyperlinks and Internal Page Navigation)
        try {
          const annotations = await pdfPage.getAnnotations({ intent: 'display' });
          if (!isCancelled) {
            const links: PdfLinkItem[] = [];
            for (const ann of annotations) {
              if (ann.subtype === 'Link' && ann.rect) {
                const rect = cssViewport.convertToViewportRectangle(ann.rect);
                const left = Math.min(rect[0], rect[2]);
                const top = Math.min(rect[1], rect[3]);
                const width = Math.abs(rect[2] - rect[0]);
                const height = Math.abs(rect[3] - rect[1]);

                links.push({
                  id: ann.id || `link_${page.id}_${Math.random().toString(36).substring(2, 7)}`,
                  left,
                  top,
                  width,
                  height,
                  url: ann.url || undefined,
                  dest: ann.dest || undefined,
                });
              }
            }
            setPageLinks(links);
          }
        } catch (linkErr) {
          console.warn('Link extraction error:', linkErr);
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

  // Native Text Selection on Search: select the exact text without any custom overlays/boxes
  useEffect(() => {
    if (!isRendered || !textLayerRef.current) return;
    const container = textLayerRef.current;

    if (!searchState.isOpen || !searchState.query || searchState.query.trim().length === 0) {
      return;
    }

    const currentGlobalMatch = searchState.results[searchState.currentIndex];
    const isCurrentPage = currentGlobalMatch && currentGlobalMatch.pageIndex === index;
    if (!isCurrentPage) return;

    const query = searchState.matchCase ? searchState.query : searchState.query.toLowerCase();
    const activeMatchIndexOnPage = currentGlobalMatch.matchIndex;

    const allSpans = Array.from(container.children).filter(
      (el): el is HTMLElement => el.tagName === 'SPAN'
    );

    let matchCounter = 0;

    for (const span of allSpans) {
      const raw = span.textContent || '';
      const compText = searchState.matchCase ? raw : raw.toLowerCase();
      if (!compText.includes(query)) continue;

      let pos = 0;
      while ((pos = compText.indexOf(query, pos)) !== -1) {
        if (matchCounter === activeMatchIndexOnPage) {
          // Select this exact matching word using native browser selection
          try {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              const range = document.createRange();
              const textNode = span.firstChild || span;
              if (textNode.nodeType === Node.TEXT_NODE) {
                const textLen = (textNode.textContent || '').length;
                range.setStart(textNode, Math.min(pos, textLen));
                range.setEnd(textNode, Math.min(pos + query.length, textLen));
              } else {
                range.selectNodeContents(span);
              }
              selection.addRange(range);
            }
          } catch (e) {
            console.warn('Selection error:', e);
          }

          // Smooth scroll into view
          requestAnimationFrame(() => {
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return;
        }
        matchCounter++;
        pos += query.length;
      }
    }
  }, [
    isRendered,
    searchState.isOpen,
    searchState.query,
    searchState.matchCase,
    searchState.currentIndex,
    searchState.results,
    index,
  ]);


  const transitionClass = {
    classic: 'page-transition-classic',
    slide: 'page-transition-slide',
    smooth: 'page-transition-smooth',
    stack: 'page-transition-stack',
    book: 'page-transition-stack',
    zoom: 'page-transition-zoom',
    instant: '',
  }[pageTransition] || '';

  // Handle clicking on links
  const handleLinkClick = async (e: React.MouseEvent, link: PdfLinkItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (link.url) {
      window.open(link.url, '_blank');
    } else if (link.dest && pdfDocProxy) {
      try {
        let dest = link.dest;
        if (typeof dest === 'string') {
          dest = await pdfDocProxy.getDestination(dest);
        }
        if (Array.isArray(dest) && dest[0]) {
          const targetPageIndex = await pdfDocProxy.getPageIndex(dest[0]);
          if (targetPageIndex >= 0) {
            setActivePageIndex(targetPageIndex);
          }
        }
      } catch (err) {
        console.warn('Internal destination navigation error:', err);
      }
    }
  };

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

          {/* Native Clickable PDF Links & Navigation Layer */}
          {pageLinks.length > 0 && (
            <div className="absolute left-0 top-0 w-full h-full pointer-events-none z-[3]">
              {pageLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url || '#'}
                  onClick={(e) => handleLinkClick(e, link)}
                  style={{
                    left: `${link.left}px`,
                    top: `${link.top}px`,
                    width: `${link.width}px`,
                    height: `${link.height}px`,
                  }}
                  className="absolute pointer-events-auto cursor-pointer rounded-[2px] hover:bg-sky-500/20 hover:ring-1 hover:ring-sky-500 transition-all"
                  title={link.url ? `Bağlantıyı Aç: ${link.url}` : 'Sayfaya Git'}
                />
              ))}
            </div>
          )}

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
