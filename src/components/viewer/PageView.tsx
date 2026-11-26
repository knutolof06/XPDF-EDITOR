import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { PdfPageModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { AnnotationLayer } from './AnnotationLayer';
import { NativeObjectLayer } from './NativeObjectLayer';
import { RulerGuideOverlay } from './RulerGuideOverlay';
import { useViewerUIState } from './viewer-ui-state';
import { getReadingFilter } from '@/components/common/theme-utils';
import { enqueuePageRender } from '@/core/cache/thumbnail-queue';
import {
  pageBitmapCache,
  pageMetadataCache,
  makePageBitmapKey,
  makePageMetaKey,
  normalizeScale,
} from '@/core/cache/render-cache';
import { preloadAdjacentPages, cancelActivePreload } from '@/core/cache/page-preloader';
import { useFormStore, FormWidgetModel } from '@/store/form-store';
import { Copy, Sparkles, Type, X } from 'lucide-react';
import { OcrTextTransfer } from '@/core/ocr/ocr-text-transfer';
import type { OcrPageResult } from '@/core/ocr/ocr-service';
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
  dest?: unknown;
}

type ScaleAwareMetaKeyFn = (
  docId: string,
  pageId: string,
  sourcePageIndex: number,
  rotation: number,
  scale: number
) => string;

type PdfTextContent = Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>;

interface TextContentItem {
  str?: string;
  transform: number[];
  width?: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface PdfAnnotationLike {
  id?: string;
  subtype?: string;
  rect?: number[];
  url?: string;
  dest?: unknown;
  fieldName?: string;
  fieldType?: 'Tx' | 'Btn' | 'Ch' | 'Sig';
  fieldValue?: string | boolean;
  defaultFieldValue?: string | boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  options?: Array<{ displayValue: string; exportValue: string }>;
  readOnly?: boolean;
  multiline?: boolean;
}

export function isAcroCheckboxChecked(val: unknown): boolean {
  if (val === true) return true;
  if (val === false || val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    return normalized !== '' && normalized !== 'off' && normalized !== 'false' && normalized !== '0';
  }
  return Boolean(val);
}

export function isAllowedExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

async function renderTextLayerContent(
  container: HTMLDivElement,
  textContent: PdfTextContent,
  cssViewport: pdfjsLib.PageViewport,
  renderScale: number
) {
  if (!container || !textContent) return;
  container.innerHTML = '';
  container.style.width = `${Math.floor(cssViewport.width)}px`;
  container.style.height = `${Math.floor(cssViewport.height)}px`;
  container.style.setProperty('--scale-factor', `${renderScale}`);
  container.style.setProperty('--main-color', 'transparent');

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

  if (!renderedWithOfficial) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    (textContent.items as TextContentItem[]).forEach((item) => {
      if (!item.str) return;
      const span = document.createElement('span');
      span.textContent = item.str;

      const tx = pdfjsLib.Util.transform(cssViewport.transform, item.transform);
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

export const PageView: React.FC<PageViewProps> = ({
  page,
  index,
  scale,
  customPdfDocProxy,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [renderScale, setRenderScale] = useState(scale);
  const [pageLinks, setPageLinks] = useState<PdfLinkItem[]>([]);
  const [pageFormWidgets, setPageFormWidgets] = useState<FormWidgetModel[]>([]);
  const [renderedPdfPage, setRenderedPdfPage] = useState<pdfjsLib.PDFPageProxy | null>(null);

  const { currentDocument, pdfDocProxy: globalPdfDocProxy, setActivePageIndex } = useDocumentStore();
  const pdfDocProxy = customPdfDocProxy || globalPdfDocProxy;
  const pageTransition = useViewerStore((s) => s.pageTransition);
  const readingTheme = useViewerStore((s) => s.readingTheme);
  const searchState = useViewerStore((s) => s.searchState);
  const ocrHighlightPulse = useViewerStore((s) => s.ocrHighlightPulse);
  const setOcrHighlightPulse = useViewerStore((s) => s.setOcrHighlightPulse);
  const inlineNativeEdit = useViewerUIState((s) => s.inlineNativeEdit);

  useEffect(() => {
    if (ocrHighlightPulse && ocrHighlightPulse.pageIndex === index) {
      const timer = setTimeout(() => {
        setOcrHighlightPulse(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [ocrHighlightPulse, index, setOcrHighlightPulse]);

  const handleConvertToEditable = (pageResult: OcrPageResult) => {
    if (!pageResult) return;
    const res = OcrTextTransfer.transferSinglePage(pageResult, {
      mode: 'paragraph',
      hideOriginalScan: true,
      fontSizeMultiplier: 1.0,
      fontColor: '#0f172a',
      fontFamily: 'Helvetica, Arial, sans-serif',
    });
    setOcrHighlightPulse(null);
    if (res.success) {
      useUIStore.getState().addToast(
        `Sayfa ${pageResult.pageNumber}'deki ${res.count} metin bloğu düzenlenebilir metne dönüştürüldü!`,
        'success'
      );
    }
  };

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
        rootMargin: '600px 0px 600px 0px',
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
    if (!pdfDocProxy || !canvasRef.current) return;

    const normScale = normalizeScale(renderScale);
    const cacheKey = makePageBitmapKey(
      docId,
      page.id,
      page.sourcePageIndex,
      page.rotation,
      normScale
    );
    const metaKey = (makePageMetaKey as ScaleAwareMetaKeyFn)(
      docId,
      page.id,
      page.sourcePageIndex,
      page.rotation,
      normScale
    );

    // 1. FAST PATH: Synchronous cache hit
    const cachedEntry = pageBitmapCache.get(cacheKey);
    if (cachedEntry && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = cachedEntry.width;
      canvas.height = cachedEntry.height;

      canvas.style.width = '100%';
      canvas.style.height = '100%';

      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (ctx) {
        ctx.drawImage(cachedEntry.bitmap, 0, 0);
        setIsRendered(true);

        const cachedMeta = pageMetadataCache.get(metaKey);
        if (cachedMeta) {
          setPageLinks((cachedMeta.links as PdfLinkItem[]) || []);
          setPageFormWidgets((cachedMeta.widgets as FormWidgetModel[]) || []);
        }

        pdfDocProxy
          .getPage(page.sourcePageIndex + 1)
          .then((p) => {
            if (isCancelled) return;
            setRenderedPdfPage(p);
            if (textLayerRef.current && cachedMeta?.textContent) {
              const cssViewport = p.getViewport({
                scale: renderScale,
                rotation: page.rotation,
              });
              renderTextLayerContent(
                textLayerRef.current,
                cachedMeta.textContent as PdfTextContent,
                cssViewport,
                renderScale
              );
            }
          })
          .catch(() => {});

        preloadAdjacentPages(pdfDocProxy, currentDocument, index, renderScale);
        return;
      }
    }

    // 2. SLOW PATH: First render or scale changed
    async function renderPage() {
      if (!pdfDocProxy || !canvasRef.current || isCancelled) return;

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        for (const [, entry] of pageBitmapCache.entries()) {
          if (
            entry.docId === docId &&
            entry.pageIndex === index &&
            entry.rotation === page.rotation
          ) {
            const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
            if (ctx) {
              canvas.width = entry.width;
              canvas.height = entry.height;
              ctx.drawImage(entry.bitmap, 0, 0);
              break;
            }
          }
        }
      }

      cancelActivePreload();

      try {
        const pdfPage = await pdfDocProxy.getPage(page.sourcePageIndex + 1);
        if (isCancelled) return;
        setRenderedPdfPage(pdfPage);

        // Pass page.rotation into baseV so 90/270 rotated pages update geometry properly
        const baseV = pdfPage.getViewport({ scale: 1.0, rotation: page.rotation });
        if (
          Math.abs(baseV.width - page.width) > 1 ||
          Math.abs(baseV.height - page.height) > 1
        ) {
          useDocumentStore.getState().updatePageGeometry(page.id, {
            width: baseV.width,
            height: baseV.height,
            rotation: page.rotation,
          });
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const viewport = pdfPage.getViewport({
          scale: renderScale * dpr,
          rotation: page.rotation,
        });

        const cssViewport = pdfPage.getViewport({
          scale: renderScale,
          rotation: page.rotation,
        });

        if (!canvasRef.current || isCancelled) return;
        const currentCanvas = canvasRef.current;
        const ctx = currentCanvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!ctx) return;

        currentCanvas.width = Math.floor(viewport.width);
        currentCanvas.height = Math.floor(viewport.height);
        currentCanvas.style.width = '100%';
        currentCanvas.style.height = '100%';

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        if (isCancelled) return;

        setIsRendered(true);

        if (typeof createImageBitmap === 'function') {
          createImageBitmap(currentCanvas)
            .then((bmp) => {
              pageBitmapCache.set(cacheKey, {
                bitmap: bmp,
                width: currentCanvas.width,
                height: currentCanvas.height,
                scale: normScale,
                rotation: page.rotation,
                docId,
                pageIndex: index,
              });
            })
            .catch(() => {});
        }

        const [textContent, annotations] = await Promise.all([
          pdfPage.getTextContent().catch(() => null),
          pdfPage.getAnnotations({ intent: 'display' }).catch(() => []),
        ]);

        if (isCancelled) return;

        if (textLayerRef.current && textContent) {
          renderTextLayerContent(
            textLayerRef.current,
            textContent,
            cssViewport,
            renderScale
          );
        }

        const links: PdfLinkItem[] = [];
        const widgets: FormWidgetModel[] = [];

        for (const ann of (annotations as PdfAnnotationLike[]) || []) {
          if (ann.subtype === 'Link' && ann.rect) {
            const rect = cssViewport.convertToViewportRectangle(ann.rect);
            links.push({
              id:
                ann.id ||
                `link_${page.id}_${Math.random().toString(36).substring(2, 7)}`,
              left: Math.min(rect[0], rect[2]),
              top: Math.min(rect[1], rect[3]),
              width: Math.abs(rect[2] - rect[0]),
              height: Math.abs(rect[3] - rect[1]),
              url: ann.url || undefined,
              dest: ann.dest || undefined,
            });
          } else if (ann.subtype === 'Widget' && ann.rect) {
            const rect = cssViewport.convertToViewportRectangle(ann.rect);
            widgets.push({
              id:
                ann.id ||
                `widget_${page.id}_${Math.random().toString(36).substring(2, 7)}`,
              pageIndex: index,
              fieldName: ann.fieldName || `field_${ann.id}`,
              fieldType: ann.fieldType || 'Tx',
              fieldValue: ann.fieldValue ?? '',
              defaultFieldValue: ann.defaultFieldValue ?? '',
              checkBox: Boolean(ann.checkBox),
              radioButton: Boolean(ann.radioButton),
              buttonValue: ann.buttonValue,
              options: ann.options,
              readOnly: Boolean(ann.readOnly),
              multiline: Boolean(ann.multiline),
              left: Math.min(rect[0], rect[2]),
              top: Math.min(rect[1], rect[3]),
              width: Math.abs(rect[2] - rect[0]),
              height: Math.abs(rect[3] - rect[1]),
            });
          }
        }

        setPageLinks(links);
        setPageFormWidgets(widgets);

        pageMetadataCache.set(metaKey, {
          textContent,
          links,
          widgets,
        });

        preloadAdjacentPages(pdfDocProxy, currentDocument, index, renderScale);
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name !== 'RenderingCancelledException') {
          console.error(`Page ${index + 1} render error:`, err);
        }
      }
    }

    cancelQueue = enqueuePageRender(renderPage);

    return () => {
      isCancelled = true;
      cancelQueue?.();
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [
    isVisible,
    pdfDocProxy,
    page.id,
    page.sourcePageIndex,
    page.rotation,
    renderScale,
    docId,
    index,
    page.width,
    page.height,
    currentDocument,
  ]);

  // Multi-span Search Highlighting & Active Match Native Selection
  useEffect(() => {
    if (!isRendered || !textLayerRef.current) return;
    const container = textLayerRef.current;

    const allSpans = Array.from(container.children).filter(
      (el): el is HTMLElement => el.tagName === 'SPAN'
    );

    // Clear previous search highlights
    for (const span of allSpans) {
      if (span.dataset.xpdfSearchHit) {
        span.style.backgroundColor = '';
        span.style.borderRadius = '';
        delete span.dataset.xpdfSearchHit;
      }
    }

    if (!searchState.isOpen || !searchState.query || searchState.query.trim().length === 0) {
      return;
    }

    const rawQuery = searchState.query;
    const query = searchState.matchCase ? rawQuery : rawQuery.toLocaleLowerCase('tr-TR');
    const currentGlobalMatch = searchState.results[searchState.currentIndex];
    const isCurrentPage = Boolean(currentGlobalMatch && currentGlobalMatch.pageIndex === index);
    const activeMatchIndexOnPage = isCurrentPage ? currentGlobalMatch.matchIndex : -1;

    // 1. Collect single-span matches (aligned with PdfSearchEngine)
    interface SpanMatchRange {
      startSpan: HTMLElement;
      startOffset: number;
      endSpan: HTMLElement;
      endOffset: number;
      spans: HTMLElement[];
    }
    const matches: SpanMatchRange[] = [];

    for (const span of allSpans) {
      const raw = span.textContent || '';
      const compText = searchState.matchCase ? raw : raw.toLocaleLowerCase('tr-TR');
      if (!compText.includes(query)) continue;

      let pos = 0;
      while ((pos = compText.indexOf(query, pos)) !== -1) {
        matches.push({
          startSpan: span,
          startOffset: pos,
          endSpan: span,
          endOffset: pos + query.length,
          spans: [span],
        });
        pos += Math.max(1, query.length);
      }
    }

    // 2. Fallback / supplement: cross-span phrase matches across adjacent spans
    if (matches.length === 0 && allSpans.length > 1) {
      const spanEntries: { span: HTMLElement; start: number; end: number; raw: string }[] = [];
      let cursor = 0;
      let joined = '';
      for (const span of allSpans) {
        const raw = span.textContent || '';
        const start = cursor;
        const end = start + raw.length;
        spanEntries.push({ span, start, end, raw });
        joined += raw;
        cursor = end;
      }

      const compJoined = searchState.matchCase ? joined : joined.toLocaleLowerCase('tr-TR');
      let pos = 0;
      while ((pos = compJoined.indexOf(query, pos)) !== -1) {
        const matchEnd = pos + query.length;
        const involved = spanEntries.filter((se) => se.end > pos && se.start < matchEnd);
        if (involved.length > 0) {
          const first = involved[0];
          const last = involved[involved.length - 1];
          matches.push({
            startSpan: first.span,
            startOffset: Math.max(0, pos - first.start),
            endSpan: last.span,
            endOffset: Math.max(0, matchEnd - last.start),
            spans: involved.map((x) => x.span),
          });
        }
        pos += Math.max(1, query.length);
      }
    }

    // Apply subtle yellow highlight to all matches on this page
    matches.forEach((m, idx) => {
      const isActive = isCurrentPage && idx === activeMatchIndexOnPage;
      for (const sp of m.spans) {
        sp.dataset.xpdfSearchHit = isActive ? 'active' : 'hit';
        sp.style.backgroundColor = isActive
          ? 'rgba(249, 115, 22, 0.45)'
          : 'rgba(250, 204, 21, 0.35)';
        sp.style.borderRadius = '2px';
      }
    });

    if (isCurrentPage) {
      const activeMatch = matches[activeMatchIndexOnPage] || matches[0];
      if (activeMatch) {
        try {
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            const range = document.createRange();
            const startNode = activeMatch.startSpan.firstChild || activeMatch.startSpan;
            const endNode = activeMatch.endSpan.firstChild || activeMatch.endSpan;
            if (startNode.nodeType === Node.TEXT_NODE && endNode.nodeType === Node.TEXT_NODE) {
              const sLen = (startNode.textContent || '').length;
              const eLen = (endNode.textContent || '').length;
              range.setStart(startNode, Math.min(activeMatch.startOffset, sLen));
              range.setEnd(endNode, Math.min(activeMatch.endOffset, eLen));
            } else {
              range.selectNodeContents(activeMatch.startSpan);
            }
            selection.addRange(range);
          }
        } catch (e) {
          console.warn('Selection error:', e);
        }

        requestAnimationFrame(() => {
          activeMatch.startSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
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

  const transitionClass =
    {
      classic: 'page-transition-classic',
      slide: 'page-transition-slide',
      smooth: 'page-transition-smooth',
      stack: 'page-transition-stack',
      book: 'page-transition-stack',
      zoom: 'page-transition-zoom',
      instant: '',
    }[pageTransition] || '';

  const handleLinkClick = async (e: React.MouseEvent, link: PdfLinkItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (link.url) {
      const safeUrl = isAllowedExternalUrl(link.url);
      if (safeUrl) {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      } else {
        useUIStore.getState().addToast('Güvenlik nedeniyle bu bağlantı protokolü engellendi.', 'warning');
      }
    } else if (link.dest && pdfDocProxy) {
      try {
        let dest: unknown = link.dest;
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
      if (
        !textLayerRef.current ||
        !containerRef.current ||
        !textLayerRef.current.contains(range.commonAncestorContainer)
      ) {
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
      const menuX = Math.max(
        10,
        Math.min(pageRect.width - 240, (firstRect.left + firstRect.right) / 2 - pageRect.left - 110)
      );
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
  const canvasReadingFilter = getReadingFilter(readingTheme);

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
        'relative my-4 transition-transform duration-200 overflow-visible',
        transitionClass
      )}
    >
      {/* Clipped inner page paper for PDF canvas, text layer, links, forms & annotations */}
      <div className="relative w-full h-full bg-white dark:bg-slate-900 shadow-2xl rounded-sm overflow-hidden contain-paint">
        {isVisible ? (
          <>
            <canvas
              ref={canvasRef}
              style={{ filter: canvasReadingFilter }}
              className={cn(
                'absolute left-0 top-0 w-full h-full block select-none pointer-events-none transition-opacity duration-150',
                isRendered ? 'opacity-100' : 'opacity-0'
              )}
            />

            {/* PDF.js Text Layer */}
            <div
              ref={textLayerRef}
              className="textLayer absolute left-0 top-0 select-text cursor-text z-[2]"
            />

            {/* Clickable PDF Links & Navigation Layer */}
            {pageLinks.length > 0 && (
              <div className="absolute left-0 top-0 w-full h-full pointer-events-none z-[3]">
                {pageLinks.map((link) => {
                  const safeExternal = link.url ? isAllowedExternalUrl(link.url) : null;
                  return (
                    <a
                      key={link.id}
                      href={safeExternal || '#'}
                      rel={safeExternal ? 'noopener noreferrer' : undefined}
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
                  );
                })}
              </div>
            )}

            {/* Interactive In-Page AcroForm Widgets Layer */}
            {pageFormWidgets.length > 0 && (
              <div className="absolute left-0 top-0 w-full h-full pointer-events-none z-[3]">
                {pageFormWidgets.map((widget) => {
                  const currentVal =
                    formValues[widget.fieldName] !== undefined
                      ? formValues[widget.fieldName]
                      : widget.fieldValue;

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
                          aria-label={widget.fieldName}
                          disabled={widget.readOnly}
                          checked={isAcroCheckboxChecked(currentVal)}
                          onChange={(e) => setFieldValue(docId, widget.fieldName, e.target.checked)}
                          className="w-full h-full text-sky-600 rounded cursor-pointer accent-sky-500 opacity-90"
                        />
                      </div>
                    );
                  }

                  if (widget.radioButton) {
                    const isChecked = widget.buttonValue
                      ? String(currentVal) === String(widget.buttonValue)
                      : isAcroCheckboxChecked(currentVal);

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
                          aria-label={widget.fieldName}
                          disabled={widget.readOnly}
                          name={widget.fieldName}
                          checked={isChecked}
                          onChange={() => setFieldValue(docId, widget.fieldName, widget.buttonValue || true)}
                          className="w-full h-full text-sky-600 cursor-pointer accent-sky-500"
                        />
                      </div>
                    );
                  }

                  if (widget.fieldType === 'Ch' && widget.options) {
                    return (
                      <select
                        key={widget.id}
                        aria-label={widget.fieldName}
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

                  if (widget.multiline) {
                    return (
                      <textarea
                        key={widget.id}
                        aria-label={widget.fieldName}
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

                  return (
                    <input
                      key={widget.id}
                      type="text"
                      aria-label={widget.fieldName}
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

            {/* Interactive Annotation Layer */}
            <AnnotationLayer page={page} scale={scale} pageIndex={index} />

            {/* Native Object Layer (mounted when inline native edit mode is active) */}
            {inlineNativeEdit && renderedPdfPage && (
              <NativeObjectLayer page={page} scale={scale} pdfPage={renderedPdfPage} />
            )}

            {/* Visual Highlight Pulse for OCR Recognized Words */}
            {ocrHighlightPulse && ocrHighlightPulse.pageIndex === index && (
              <div className="no-print absolute inset-0 pointer-events-none z-[25] animate-in fade-in duration-300">
                {ocrHighlightPulse.words.map((w, wIdx) => (
                  <div
                    key={wIdx}
                    style={{
                      left: `${w.normBbox.x * 100}%`,
                      top: `${w.normBbox.y * 100}%`,
                      width: `${w.normBbox.width * 100}%`,
                      height: `${w.normBbox.height * 100}%`,
                    }}
                    className="absolute bg-sky-400/20 border border-sky-400/60 rounded-[2px] shadow-[0_0_8px_rgba(56,189,248,0.4)] animate-pulse"
                  />
                ))}

                <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white px-4 py-2 rounded-2xl shadow-2xl border border-sky-500/40 flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 select-none">
                  <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs">
                    <span className="font-bold text-sky-300">OCR Başarılı:</span>{' '}
                    <span>{ocrHighlightPulse.wordCount} kelime aranabilir &amp; seçilebilir yapıldı!</span>
                  </div>

                  {ocrHighlightPulse.lastOcrPageResult && (
                    <button
                      type="button"
                      onClick={() => handleConvertToEditable(ocrHighlightPulse.lastOcrPageResult as OcrPageResult)}
                      className="ml-1 px-2.5 py-1 bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-600 hover:to-sky-600 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                    >
                      <Type className="w-3 h-3" />
                      <span>Düzenlenebilir Metne Çevir</span>
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label="OCR bildirimini kapat"
                    onClick={() => setOcrHighlightPulse(null)}
                    className="p-1 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
                    title="Kapat"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Floating Text Markup Toolbar */}
            {floatingMenu && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  left: `${floatingMenu.x}px`,
                  top: `${floatingMenu.y}px`,
                }}
                className="no-print absolute z-50 flex items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none text-slate-700 dark:text-slate-200"
              >
                <button
                  type="button"
                  aria-label="Sarı ile vurgula"
                  onClick={() => handleHighlight('#fef08a')}
                  className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                  title="Vurgula (Sarı)"
                >
                  <span className="w-3.5 h-3.5 rounded-full bg-yellow-300 border border-yellow-400 shadow-sm" />
                </button>
                <button
                  type="button"
                  aria-label="Yeşil ile vurgula"
                  onClick={() => handleHighlight('#bbf7d0')}
                  className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                  title="Vurgula (Yeşil)"
                >
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-300 border border-emerald-400 shadow-sm" />
                </button>
                <button
                  type="button"
                  aria-label="Mavi ile vurgula"
                  onClick={() => handleHighlight('#bae6fd')}
                  className="p-1.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/40 text-sky-500 transition-colors flex items-center gap-1 text-xs font-semibold"
                  title="Vurgula (Mavi)"
                >
                  <span className="w-3.5 h-3.5 rounded-full bg-sky-300 border border-sky-400 shadow-sm" />
                </button>

                <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                <button
                  type="button"
                  aria-label="Altını çiz"
                  onClick={() => handleUnderline('#ef4444')}
                  className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold underline decoration-red-500 decoration-2 transition-colors"
                  title="Altını Çiz"
                >
                  U
                </button>

                <button
                  type="button"
                  aria-label="Üstünü çiz"
                  onClick={() => handleStrikethrough('#dc2626')}
                  className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold line-through decoration-red-500 decoration-2 transition-colors"
                  title="Üstünü Çiz"
                >
                  S
                </button>

                <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

                <button
                  type="button"
                  aria-label="Seçili metni kopyala"
                  onClick={handleCopy}
                  className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1"
                  title="Kopyala"
                >
                  <Copy className="w-3 h-3" />
                  <span className="text-[11px]">Kopyala</span>
                </button>
              </div>
            )}

            {/* Loading Skeleton */}
            {!isRendered && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-500 z-20">
                <div className="w-7 h-7 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mb-2" />
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Sayfa {index + 1} Yükleniyor...
                </span>
              </div>
            )}
          </>
        ) : (
          /* Offscreen Placeholder */
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900/70 text-slate-300 dark:text-slate-600">
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Sayfa {index + 1}</span>
          </div>
        )}
      </div>

      {/* Non-clipped Rulers, Guides & Grid Overlay */}
      {isVisible && (
        <RulerGuideOverlay
          pageIndex={index}
          widthPt={page.width}
          heightPt={page.height}
          scale={scale}
          pageContainerRef={containerRef}
        />
      )}
    </div>
  );
};
