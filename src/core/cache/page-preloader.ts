/**
 * Smart Background Adjacent Page Pre-loader
 * - Renders N+1 and N-1 pages into memory during browser idle time.
 * - Generation token + single-task concurrency lock prevents stale finally races.
 * - Immediate abort at both idle timer and PDF.js RenderTask.cancel() levels.
 * - Cross-platform fallback for Safari/WebKit without native requestIdleCallback.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel, type PageLink } from '@/types/document';
import { FormWidgetModel } from '@/store/form-store';
import {
  pageBitmapCache,
  pageMetadataCache,
  makePageBitmapKey,
  makePageMetaKey,
  normalizeScale,
} from './render-cache';

interface IdleDeadlineLike {
  timeRemaining: () => number;
  didTimeout: boolean;
}

type IdleHandle = ReturnType<typeof setTimeout> | number;

// Cross-browser safe idle scheduling (Safari / WebKit fallback)
export const safeRequestIdleCallback: (cb: (deadline: IdleDeadlineLike) => void) => IdleHandle =
  typeof window !== 'undefined' &&
  typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === 'function'
    ? (window as unknown as { requestIdleCallback: (cb: (d: IdleDeadlineLike) => void) => IdleHandle })
        .requestIdleCallback.bind(window)
    : (cb: (deadline: IdleDeadlineLike) => void) =>
        setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 50);

export const safeCancelIdleCallback: (id: IdleHandle) => void =
  typeof window !== 'undefined' &&
  typeof (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback === 'function'
    ? (window as unknown as { cancelIdleCallback: (id: IdleHandle) => void }).cancelIdleCallback.bind(
        window
      )
    : (id: IdleHandle) => clearTimeout(id);

interface RenderTaskLike {
  promise: Promise<void>;
  cancel: () => void;
}

// Preloader state protected by monotonic generation token
let preloadGeneration = 0;
let isPreloading = false;
let activeIdleId: IdleHandle | null = null;
let activePreloadRenderTask: RenderTaskLike | null = null;
let hiddenCanvas: HTMLCanvasElement | null = null;

function getHiddenCanvas(): HTMLCanvasElement | null {
  if (!hiddenCanvas && typeof document !== 'undefined') {
    hiddenCanvas = document.createElement('canvas');
  }
  return hiddenCanvas;
}

function shrinkHiddenCanvas(): void {
  if (hiddenCanvas) {
    hiddenCanvas.width = 0;
    hiddenCanvas.height = 0;
  }
}

/**
 * Immediately cancels any scheduled or currently executing background preload task.
 * Aborts at both idle timer AND PDF.js RenderTask.cancel() levels.
 */
export function cancelActivePreload(): void {
  preloadGeneration += 1;

  if (activeIdleId !== null) {
    safeCancelIdleCallback(activeIdleId);
    activeIdleId = null;
  }

  if (activePreloadRenderTask) {
    try {
      activePreloadRenderTask.cancel();
    } catch {
      // ignore cancellation error
    }
    activePreloadRenderTask = null;
  }

  isPreloading = false;
  shrinkHiddenCanvas();
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

  // Cancel any prior preload and advance generation token
  cancelActivePreload();
  const myGeneration = preloadGeneration;

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

  const processRemaining = (queue: number[]) => {
    if (queue.length === 0 || myGeneration !== preloadGeneration) return;

    activeIdleId = safeRequestIdleCallback(async (deadline: IdleDeadlineLike) => {
      if (myGeneration !== preloadGeneration) return;
      activeIdleId = null;

      for (let qIdx = 0; qIdx < queue.length; qIdx++) {
        if (myGeneration !== preloadGeneration) return;

        // If we already rendered a page in this idle slice and time is nearly out,
        // reschedule remaining candidates (e.g. N-1) cleanly instead of dropping them.
        if (
          qIdx > 0 &&
          deadline &&
          typeof deadline.timeRemaining === 'function' &&
          !deadline.didTimeout &&
          deadline.timeRemaining() < 5
        ) {
          processRemaining(queue.slice(qIdx));
          return;
        }

        if (isPreloading) return;

        const targetIndex = queue[qIdx];
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
          if (myGeneration !== preloadGeneration) return;

          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const viewport = pdfPage.getViewport({
            scale: normScale * dpr,
            rotation: pageModel.rotation,
          });

          const canvas = getHiddenCanvas();
          if (!canvas) continue;

          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));

          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) continue;

          const task = pdfPage.render({ canvasContext: ctx, viewport }) as unknown as RenderTaskLike;
          activePreloadRenderTask = task;

          await task.promise;
          if (myGeneration !== preloadGeneration) return;

          activePreloadRenderTask = null;

          if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(canvas);
            if (myGeneration !== preloadGeneration) {
              try {
                bitmap.close?.();
              } catch {
                // ignore
              }
              return;
            }
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

          shrinkHiddenCanvas();

          // Also pre-cache metadata (links, form widgets, textContent) keyed with normScale
          const metaKey = makePageMetaKey(
            documentModel.id,
            pageModel.id,
            pageModel.sourcePageIndex,
            pageModel.rotation,
            normScale
          );

          if (!pageMetadataCache.has(metaKey)) {
            const [textContent, annotations] = await Promise.all([
              pdfPage.getTextContent().catch(() => null),
              pdfPage.getAnnotations({ intent: 'display' }).catch(() => []),
            ]);

            if (myGeneration !== preloadGeneration) return;

            const cssViewport = pdfPage.getViewport({
              scale: normScale,
              rotation: pageModel.rotation,
            });

            const links: PageLink[] = [];
            const widgets: FormWidgetModel[] = [];

            for (const ann of (annotations as Array<Record<string, unknown>>) || []) {
              const annRect = ann.rect as number[] | undefined;
              if (ann.subtype === 'Link' && annRect) {
                const rect = cssViewport.convertToViewportRectangle(annRect);
                links.push({
                  id:
                    (ann.id as string) ||
                    `link_${pageModel.id}_${links.length}`,
                  left: Math.min(rect[0], rect[2]),
                  top: Math.min(rect[1], rect[3]),
                  width: Math.abs(rect[2] - rect[0]),
                  height: Math.abs(rect[3] - rect[1]),
                  url: (ann.url as string) || undefined,
                  dest: ann.dest || undefined,
                });
              } else if (ann.subtype === 'Widget' && annRect) {
                const rect = cssViewport.convertToViewportRectangle(annRect);
                widgets.push({
                  id:
                    (ann.id as string) ||
                    `widget_${pageModel.id}_${widgets.length}`,
                  pageIndex: targetIndex,
                  fieldName: (ann.fieldName as string) || `field_${String(ann.id || widgets.length)}`,
                  fieldType: (ann.fieldType as FormWidgetModel['fieldType']) || 'Tx',
                  fieldValue: (ann.fieldValue as string | boolean) ?? '',
                  defaultFieldValue: (ann.defaultFieldValue as string | boolean) ?? '',
                  checkBox: Boolean(ann.checkBox),
                  radioButton: Boolean(ann.radioButton),
                  buttonValue: ann.buttonValue as string | undefined,
                  options: ann.options as FormWidgetModel['options'],
                  readOnly: Boolean(ann.readOnly),
                  multiline: Boolean(ann.multiline),
                  left: Math.min(rect[0], rect[2]),
                  top: Math.min(rect[1], rect[3]),
                  width: Math.abs(rect[2] - rect[0]),
                  height: Math.abs(rect[3] - rect[1]),
                });
              }
            }

            if (myGeneration === preloadGeneration) {
              pageMetadataCache.set(metaKey, {
                textContent,
                links,
                widgets,
              });
            }
          }
        } catch (err: unknown) {
          const name = (err as { name?: string })?.name;
          if (name !== 'RenderingCancelledException') {
            // Silent catch for background preloader failures
          }
        } finally {
          if (myGeneration === preloadGeneration) {
            activePreloadRenderTask = null;
            isPreloading = false;
            shrinkHiddenCanvas();
          }
        }
      }
    });
  };

  processRemaining(pagesToPreload);
}
