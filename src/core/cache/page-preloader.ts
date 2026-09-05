/**
 * Smart Background Adjacent Page Pre-loader
 * - Renders N+1 and N-1 pages into memory during browser idle time.
 * - Single-task concurrency lock prevents main thread/GPU choking.
 * - Immediate abort at both idle timer and PDF.js RenderTask.cancel() levels.
 * - Cross-platform fallback for Safari/WebKit without native requestIdleCallback.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel } from '@/types/document';
import {
  pageBitmapCache,
  pageMetadataCache,
  makePageBitmapKey,
  makePageMetaKey,
  normalizeScale,
} from './render-cache';

// Cross-browser safe idle scheduling (Safari / WebKit fallback)
export const safeRequestIdleCallback =
  typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function'
    ? (window as any).requestIdleCallback.bind(window)
    : (cb: (deadline: { timeRemaining: () => number; didTimeout: boolean }) => void) =>
        setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 50);

export const safeCancelIdleCallback =
  typeof window !== 'undefined' && typeof (window as any).cancelIdleCallback === 'function'
    ? (window as any).cancelIdleCallback.bind(window)
    : (id: any) => clearTimeout(id);

// Preloader state
let isPreloading = false;
let activeIdleId: any = null;
let activePreloadRenderTask: any = null;
let hiddenCanvas: HTMLCanvasElement | null = null;

function getHiddenCanvas(): HTMLCanvasElement {
  if (!hiddenCanvas && typeof document !== 'undefined') {
    hiddenCanvas = document.createElement('canvas');
  }
  return hiddenCanvas!;
}

/**
 * Immediately cancels any scheduled or currently executing background preload task.
 * Aborts at both idle timer AND PDF.js RenderTask.cancel() levels.
 */
export function cancelActivePreload(): void {
  if (activeIdleId !== null) {
    safeCancelIdleCallback(activeIdleId);
    activeIdleId = null;
  }

  if (activePreloadRenderTask) {
    try {
      activePreloadRenderTask.cancel();
    } catch {}
    activePreloadRenderTask = null;
  }

  isPreloading = false;
}

/**
 * Schedules background pre-rendering for adjacent pages (N+1, then N-1).
 * High visible priority: Automatically yields if a visible page starts rendering.
 */
export function preloadAdjacentPages(
  pdfDocProxy: pdfjsLib.PDFDocumentProxy | null,
  documentModel: PdfDocumentModel | null,
  activePageIndex: number,
  scale: number
): void {
  if (!pdfDocProxy || !documentModel || typeof window === 'undefined') return;

  // Cancel any prior unstarted preload to focus on the latest page's neighbors
  cancelActivePreload();

  const totalPages = documentModel.totalPages;
  const normScale = normalizeScale(scale);
  const candidates: number[] = [];

  // 1. Forward neighbor (N+1) gets primary priority
  if (activePageIndex + 1 < totalPages) {
    candidates.push(activePageIndex + 1);
  }
  // 2. Backward neighbor (N-1) gets secondary priority
  if (activePageIndex - 1 >= 0) {
    candidates.push(activePageIndex - 1);
  }

  // Filter out already-cached candidates
  const pagesToPreload = candidates.filter((pIndex) => {
    const pageModel = documentModel.pages[pIndex];
    if (!pageModel) return false;
    const cacheKey = makePageBitmapKey(
      documentModel.id,
      pageModel.id,
      pageModel.sourcePageIndex,
      pageModel.rotation,
      normScale
    );
    return !pageBitmapCache.has(cacheKey);
  });

  if (pagesToPreload.length === 0) return;

  activeIdleId = safeRequestIdleCallback(async (deadline: any) => {
    activeIdleId = null;

    for (const targetIndex of pagesToPreload) {
      // If time remaining is too low or cancellation happened, stop
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 5) {
        break;
      }

      if (isPreloading) break; // Strict concurrency lock (max 1 preload at a time)

      const pageModel = documentModel.pages[targetIndex];
      if (!pageModel) continue;

      const cacheKey = makePageBitmapKey(
        documentModel.id,
        pageModel.id,
        pageModel.sourcePageIndex,
        pageModel.rotation,
        normScale
      );

      if (pageBitmapCache.has(cacheKey)) continue;

      isPreloading = true;

      try {
        const pdfPage = await pdfDocProxy.getPage(pageModel.sourcePageIndex + 1);

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const viewport = pdfPage.getViewport({
          scale: normScale * dpr,
          rotation: pageModel.rotation,
        });

        const canvas = getHiddenCanvas();
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          isPreloading = false;
          continue;
        }

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        activePreloadRenderTask = task;

        await task.promise;
        activePreloadRenderTask = null;

        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(canvas);
          pageBitmapCache.set(cacheKey, {
            bitmap,
            width: canvas.width,
            height: canvas.height,
            scale: normScale,
            rotation: pageModel.rotation,
            docId: documentModel.id,
            pageIndex: targetIndex,
          });
        }

        // Also pre-cache metadata (links, form widgets, textContent)
        const metaKey = makePageMetaKey(
          documentModel.id,
          pageModel.id,
          pageModel.sourcePageIndex,
          pageModel.rotation
        );

        if (!pageMetadataCache.has(metaKey)) {
          const [textContent, annotations] = await Promise.all([
            pdfPage.getTextContent().catch(() => null),
            pdfPage.getAnnotations({ intent: 'display' }).catch(() => []),
          ]);

          const cssViewport = pdfPage.getViewport({
            scale: normScale,
            rotation: pageModel.rotation,
          });

          const links: any[] = [];
          const widgets: any[] = [];

          for (const ann of annotations || []) {
            if (ann.subtype === 'Link' && ann.rect) {
              const rect = cssViewport.convertToViewportRectangle(ann.rect);
              links.push({
                id: ann.id || `link_${pageModel.id}_${Math.random().toString(36).substring(2, 7)}`,
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
                id: ann.id || `widget_${pageModel.id}_${Math.random().toString(36).substring(2, 7)}`,
                pageIndex: targetIndex,
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
                left: Math.min(rect[0], rect[2]),
                top: Math.min(rect[1], rect[3]),
                width: Math.abs(rect[2] - rect[0]),
                height: Math.abs(rect[3] - rect[1]),
              });
            }
          }

          pageMetadataCache.set(metaKey, {
            textContent,
            links,
            widgets,
          });
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          // Silent catch for background preloader failures
        }
      } finally {
        activePreloadRenderTask = null;
        isPreloading = false;
      }
    }
  });
}
