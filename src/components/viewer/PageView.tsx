import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { AnnotationLayer } from './AnnotationLayer';
import { RulerGuideOverlay } from './RulerGuideOverlay';
import { enqueuePageRender } from '@/core/cache/thumbnail-queue';
import { useFormStore, FormWidgetModel } from '@/store/form-store';
import { Copy } from 'lucide-react';
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
  const [pageFormWidgets, setPageFormWidgets] = useState<FormWidgetModel[]>([]);
  const { currentDocument, pdfDocProxy: globalPdfDocProxy, setActivePageIndex } = useDocumentStore();
  const pdfDocProxy = customPdfDocProxy || globalPdfDocProxy;
  const pageTransition = useViewerStore((s) => s.pageTransition);
  const searchState = useViewerStore((s) => s.searchState);

  const docId = currentDocument?.id || '';
  const formValues = useFormStore((s) => s.valuesByDoc[docId]) || {};
  const setFieldValue = useFormStore((s) => s.setFieldValue);

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
            const widgets: FormWidgetModel[] = [];

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
              } else if (ann.subtype === 'Widget' && ann.rect) {
                const rect = cssViewport.convertToViewportRectangle(ann.rect);
                const left = Math.min(rect[0], rect[2]);
                const top = Math.min(rect[1], rect[3]);
                const width = Math.abs(rect[2] - rect[0]);
                const height = Math.abs(rect[3] - rect[1]);

                widgets.push({
                  id: ann.id || `widget_${page.id}_${Math.random().toString(36).substring(2, 7)}`,
                  pageIndex: index,
                  fieldName: ann.fieldName || `field_${ann.id}`,
                  fieldType: ann.fieldType,
                  fieldValue: ann.fieldValue ?? '',
                  defaultFieldValue: ann.defaultFieldValue ?? '',
                  checkBox: Boolean(ann.checkBox),
                  radioButton: Boolean(ann.radioButton),
                  buttonValue: ann.buttonValue,
                  options: ann.options,
                  readOnly: Boolean(ann.readOnly),
                  multiline: Boolean(ann.multiline),
                  left,
                  top,
                  width,
                  height,
                });
              }
            }
            setPageLinks(links);
            setPageFormWidgets(widgets);
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

  // Floating Text Selection Markup Menu
  const [floatingMenu, setFloatingMenu] = useState<{
    x: number;
    y: number;
    selectedText: string;
    pdfRects: { x: number; y: number; width: number; height: number }[];
  } | null>(null);

  const handleMouseUp = () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setFloatingMenu(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setFloatingMenu(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (!textLayerRef.current || !containerRef.current || !textLayerRef.current.contains(range.commonAncestorContainer)) {
        setFloatingMenu(null);
        return;
      }

      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) {
        setFloatingMenu(null);
        return;
      }

      const pageRect = containerRef.current.getBoundingClientRect();
      const pdfRects = clientRects.map((r) => ({
        x: (r.left - pageRect.left) / scale,
        y: (r.top - pageRect.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      }));

      const firstRect = clientRects[0];
      const menuX = Math.max(10, Math.min(pageRect.width - 240, (firstRect.left + firstRect.right) / 2 - pageRect.left - 110));
      const menuY = Math.max(8, firstRect.top - pageRect.top - 42);

      setFloatingMenu({
        x: menuX,
        y: menuY,
        selectedText: text,
        pdfRects,
      });
    }, 20);
  };

  const handleHighlight = (color = '#fef08a') => {
    if (!floatingMenu) return;
    const { addAnnotation } = useAnnotationStore.getState();
    floatingMenu.pdfRects.forEach((r) => {
      addAnnotation(page.id, {
        id: `hl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.id,
        type: 'rect',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        strokeColor: 'transparent',
        fillColor: color,
        strokeWidth: 0,
        opacity: 0.45,
      });
    });
    window.getSelection()?.removeAllRanges();
    setFloatingMenu(null);
    useUIStore.getState().addToast('Metin vurgulandı', 'success', 1500);
  };

  const handleUnderline = (color = '#ef4444') => {
    if (!floatingMenu) return;
    const { addAnnotation } = useAnnotationStore.getState();
    floatingMenu.pdfRects.forEach((r) => {
      addAnnotation(page.id, {
        id: `ul_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.id,
        type: 'line',
        x: r.x,
        y: r.y + r.height - 1.5,
        width: r.width,
        height: 0,
        strokeColor: color,
        strokeWidth: 1.5,
        opacity: 1,
      });
    });
    window.getSelection()?.removeAllRanges();
    setFloatingMenu(null);
    useUIStore.getState().addToast('Metnin altı çizildi', 'success', 1500);
  };

  const handleStrikethrough = (color = '#dc2626') => {
    if (!floatingMenu) return;
    const { addAnnotation } = useAnnotationStore.getState();
    floatingMenu.pdfRects.forEach((r) => {
      addAnnotation(page.id, {
        id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.id,
        type: 'line',
        x: r.x,
        y: r.y + r.height / 2,
        width: r.width,
        height: 0,
        strokeColor: color,
        strokeWidth: 1.5,
        opacity: 1,
      });
    });
    window.getSelection()?.removeAllRanges();
    setFloatingMenu(null);
    useUIStore.getState().addToast('Metnin üstü çizildi', 'success', 1500);
  };

  const handleCopy = () => {
    if (!floatingMenu) return;
    navigator.clipboard.writeText(floatingMenu.selectedText);
    window.getSelection()?.removeAllRanges();
    setFloatingMenu(null);
    useUIStore.getState().addToast('Metin panoya kopyalandı', 'success', 1500);
  };

  const baseWidth = (page.width || 595.28) * scale;
  const baseHeight = (page.height || 841.89) * scale;

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
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

          {/* Interactive In-Page AcroForm Widgets Layer */}
          {pageFormWidgets.length > 0 && (
            <div className="absolute left-0 top-0 w-full h-full pointer-events-none z-[3]">
              {pageFormWidgets.map((widget) => {
                const currentVal = formValues[widget.fieldName] !== undefined
                  ? formValues[widget.fieldName]
                  : widget.fieldValue;

                // 1. Checkbox
                if (widget.checkBox) {
                  return (
                    <div
                      key={widget.id}
                      style={{
                        left: `${widget.left}px`,
                        top: `${widget.top}px`,
                        width: `${widget.width}px`,
                        height: `${widget.height}px`,
                      }}
                      className="absolute pointer-events-auto flex items-center justify-center bg-sky-500/10 hover:bg-sky-500/20 rounded-[2px] border border-sky-400/50 transition-colors"
                      title={`Form Alanı: ${widget.fieldName}`}
                    >
                      <input
                        type="checkbox"
                        disabled={widget.readOnly}
                        checked={Boolean(currentVal)}
                        onChange={(e) => setFieldValue(docId, widget.fieldName, e.target.checked)}
                        className="w-full h-full text-sky-600 rounded cursor-pointer accent-sky-500 opacity-90"
                      />
                    </div>
                  );
                }

                // 2. Radio Button
                if (widget.radioButton) {
                  const isChecked = widget.buttonValue
                    ? currentVal === widget.buttonValue
                    : Boolean(currentVal);

                  return (
                    <div
                      key={widget.id}
                      style={{
                        left: `${widget.left}px`,
                        top: `${widget.top}px`,
                        width: `${widget.width}px`,
                        height: `${widget.height}px`,
                      }}
                      className="absolute pointer-events-auto flex items-center justify-center bg-sky-500/10 hover:bg-sky-500/20 rounded-full border border-sky-400/50 transition-colors"
                      title={`Form Alanı: ${widget.fieldName}`}
                    >
                      <input
                        type="radio"
                        disabled={widget.readOnly}
                        name={widget.fieldName}
                        checked={isChecked}
                        onChange={() => setFieldValue(docId, widget.fieldName, widget.buttonValue || true)}
                        className="w-full h-full text-sky-600 cursor-pointer accent-sky-500"
                      />
                    </div>
                  );
                }

                // 3. Dropdown / Choice
                if (widget.fieldType === 'Ch' && widget.options) {
                  return (
                    <select
                      key={widget.id}
                      disabled={widget.readOnly}
                      value={String(currentVal ?? '')}
                      onChange={(e) => setFieldValue(docId, widget.fieldName, e.target.value)}
                      style={{
                        left: `${widget.left}px`,
                        top: `${widget.top}px`,
                        width: `${widget.width}px`,
                        height: `${widget.height}px`,
                        fontSize: `${Math.max(10, Math.min(16, widget.height * 0.6))}px`,
                      }}
                      className="absolute pointer-events-auto bg-sky-500/10 hover:bg-sky-500/20 focus:bg-white focus:ring-2 focus:ring-sky-500 text-slate-900 border border-sky-400/50 rounded-[2px] px-1 font-sans transition-all outline-none"
                      title={`Form Alanı: ${widget.fieldName}`}
                    >
                      {widget.options.map((opt, oIdx) => (
                        <option key={oIdx} value={opt.exportValue}>
                          {opt.displayValue || opt.exportValue}
                        </option>
                      ))}
                    </select>
                  );
                }

                // 4. Multiline Text Field
                if (widget.multiline) {
                  return (
                    <textarea
                      key={widget.id}
                      disabled={widget.readOnly}
                      value={String(currentVal ?? '')}
                      onChange={(e) => setFieldValue(docId, widget.fieldName, e.target.value)}
                      style={{
                        left: `${widget.left}px`,
                        top: `${widget.top}px`,
                        width: `${widget.width}px`,
                        height: `${widget.height}px`,
                        fontSize: `${Math.max(10, Math.min(16, widget.height * 0.45))}px`,
                      }}
                      className="absolute pointer-events-auto bg-sky-500/10 hover:bg-sky-500/20 focus:bg-white focus:ring-2 focus:ring-sky-500 text-slate-900 border border-sky-400/50 rounded-[2px] p-1 font-sans transition-all resize-none outline-none leading-tight"
                      title={`Form Alanı: ${widget.fieldName}`}
                    />
                  );
                }

                // 5. Standard Text Input
                return (
                  <input
                    key={widget.id}
                    type="text"
                    disabled={widget.readOnly}
                    value={String(currentVal ?? '')}
                    onChange={(e) => setFieldValue(docId, widget.fieldName, e.target.value)}
                    style={{
                      left: `${widget.left}px`,
                      top: `${widget.top}px`,
                      width: `${widget.width}px`,
                      height: `${widget.height}px`,
                      fontSize: `${Math.max(10, Math.min(18, widget.height * 0.65))}px`,
                    }}
                    className="absolute pointer-events-auto bg-sky-500/10 hover:bg-sky-500/20 focus:bg-white focus:ring-2 focus:ring-sky-500 text-slate-900 border border-sky-400/50 rounded-[2px] px-1.5 py-0 font-sans transition-all outline-none leading-none"
                    title={`Form Alanı: ${widget.fieldName}`}
                  />
                );
              })}
            </div>
          )}

          {/* V3 Interactive Annotation Layer */}
          <AnnotationLayer page={page} scale={scale} />

          {/* FAZ 5 Acrobat Rulers, Guides & Grid Overlay */}
          <RulerGuideOverlay
            pageIndex={index}
            widthPt={page.width}
            heightPt={page.height}
            scale={scale}
          />

          {/* Acrobat-Style Floating Text Markup Toolbar */}
          {floatingMenu && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                left: `${floatingMenu.x}px`,
                top: `${floatingMenu.y}px`,
              }}
              className="absolute z-50 flex items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none text-slate-700 dark:text-slate-200"
            >
              {/* Highlight Yellow */}
              <button
                onClick={() => handleHighlight('#fef08a')}
                className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                title="Vurgula (Sarı)"
              >
                <span className="w-3.5 h-3.5 rounded-full bg-yellow-300 border border-yellow-400 shadow-xs" />
              </button>
              {/* Highlight Green */}
              <button
                onClick={() => handleHighlight('#bbf7d0')}
                className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                title="Vurgula (Yeşil)"
              >
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-300 border border-emerald-400 shadow-xs" />
              </button>
              {/* Highlight Blue */}
              <button
                onClick={() => handleHighlight('#bae6fd')}
                className="p-1.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/40 text-sky-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                title="Vurgula (Mavi)"
              >
                <span className="w-3.5 h-3.5 rounded-full bg-sky-300 border border-sky-400 shadow-xs" />
              </button>

              <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* Underline */}
              <button
                onClick={() => handleUnderline('#ef4444')}
                className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold underline decoration-red-500 decoration-2 transition-colors"
                title="Altını Çiz"
              >
                U
              </button>

              {/* Strikethrough */}
              <button
                onClick={() => handleStrikethrough('#dc2626')}
                className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold line-through decoration-red-500 decoration-2 transition-colors"
                title="Üstünü Çiz"
              >
                S
              </button>

              <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* Copy */}
              <button
                onClick={handleCopy}
                className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1"
                title="Kopyala"
              >
                <Copy className="w-3 h-3" />
                <span className="text-[11px]">Kopyala</span>
              </button>
            </div>
          )}

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
