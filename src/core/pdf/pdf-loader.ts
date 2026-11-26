import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel, PdfPageModel, PdfMetadata } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { toSafeArrayBuffer } from './pdf-helpers';

// Helper to get local resource URL in Chrome extension, Electron, or browser
function getAssetUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(path);
  }
  // In Electron and web file:// protocol, use relative paths
  return './' + path.replace(/^\/+/, '');
}

// Configure local worker and fonts (100% offline & CSP compliant)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = getAssetUrl('pdfjs/pdf.worker.min.mjs');
}

export interface LoadedPdfResult {
  model: PdfDocumentModel;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
}

export interface LoadDocumentOptions {
  preserveDocId?: string;
}

function normalizeRotation(angle: number | undefined): number {
  return (((angle || 0) % 360) + 360) % 360;
}

function isDocumentStillOpen(docId: string): boolean {
  const currentId = useDocumentStore.getState().currentDocument?.id;
  if (currentId === docId) return true;
  return useTabStore.getState().tabs.some((t) => t.id === docId);
}

export class PdfLoader {
  /**
   * Loads a PDF file from an ArrayBuffer / Uint8Array and returns the normalized PdfDocumentModel
   */
  public static async loadDocument(
    name: string,
    data: unknown,
    filePath?: string,
    password?: string,
    options?: LoadDocumentOptions
  ): Promise<LoadedPdfResult> {
    const rawBuffer = toSafeArrayBuffer(data);
    const id =
      options?.preserveDocId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

    // Pass separate independent copy to pdfjs worker
    const workerCopy = new Uint8Array(rawBuffer.slice(0));

    const loadingTask = pdfjsLib.getDocument({
      data: workerCopy,
      cMapUrl: getAssetUrl('pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: getAssetUrl('pdfjs/standard_fonts/'),
      password: password || undefined,
    });

    let pdfDoc: pdfjsLib.PDFDocumentProxy;
    try {
      pdfDoc = await loadingTask.promise;
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'PasswordException' || e?.message?.toLowerCase().includes('password')) {
        const passErr = new Error('Bu PDF dökümanı parola ile korunmaktadır.') as Error & {
          isPasswordProtected: boolean;
          fileName: string;
          buffer: ArrayBuffer;
          filePath?: string;
        };
        passErr.isPasswordProtected = true;
        passErr.fileName = name;
        passErr.buffer = rawBuffer;
        passErr.filePath = filePath;
        throw passErr;
      }
      throw err;
    }

    // Store dedicated clone in binaryStore ONLY after PDF.js loads successfully
    binaryStore.set(id, rawBuffer.slice(0));
    binaryStore.associateProxy(pdfDoc, rawBuffer);

    const totalPages = pdfDoc.numPages;

    // Fast Page 1 extraction (Instant First Paint regardless of document size)
    let defaultWidth = 595.28;
    let defaultHeight = 841.89;
    let defaultRotation = 0;

    try {
      const page1 = await pdfDoc.getPage(1);
      const v1 = page1.getViewport({ scale: 1.0 });
      defaultWidth = v1.width || defaultWidth;
      defaultHeight = v1.height || defaultHeight;
      defaultRotation = normalizeRotation(page1.rotate);
    } catch {
      // Fallback to standard A4
    }

    // Build page models: resolve exact geometry immediately for <= 50 pages so mixed rotations/sizes
    // are never stale, and defer remaining pages > 50 to chunked background idle scan.
    const immediateScanLimit = Math.min(totalPages, 50);
    const pages: PdfPageModel[] = [];
    for (let i = 0; i < totalPages; i++) {
      pages.push({
        id: `${id}_page_${i + 1}`,
        sourceDocId: id,
        sourcePageIndex: i,
        displayPageNumber: i + 1,
        rotation: defaultRotation,
        width: defaultWidth,
        height: defaultHeight,
        aspectRatio: defaultWidth / (defaultHeight || 1),
        annotations: [],
      });
    }

    if (immediateScanLimit > 1) {
      await Promise.all(
        Array.from({ length: immediateScanLimit - 1 }, (_, offset) => offset + 1).map(
          async (pageIdx) => {
            try {
              const pg = await pdfDoc.getPage(pageIdx + 1);
              const pgRot = normalizeRotation(pg.rotate);
              const v = pg.getViewport({ scale: 1.0 });
              const w = v.width || defaultWidth;
              const h = v.height || defaultHeight;
              pages[pageIdx].width = w;
              pages[pageIdx].height = h;
              pages[pageIdx].rotation = pgRot;
              pages[pageIdx].aspectRatio = w / (h || 1);
            } catch {
              // keep page 1 fallback
            }
          }
        )
      );
    }

    // Extract metadata asynchronously without blocking
    const metadata: PdfMetadata = {
      fileSizeFormatted: `${(rawBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`,
      pageCount: totalPages,
    };

    pdfDoc
      .getMetadata()
      .then((meta) => {
        if (!isDocumentStillOpen(id)) return;
        const info = (meta?.info as Record<string, unknown>) || {};
        const metaObj: PdfMetadata = {
          title: (info.Title as string) || name.replace(/\.pdf$/i, ''),
          author: (info.Author as string) || undefined,
          subject: (info.Subject as string) || undefined,
          keywords: (info.Keywords as string) || undefined,
          creator: (info.Creator as string) || undefined,
          producer: (info.Producer as string) || undefined,
          creationDate: info.CreationDate ? String(info.CreationDate) : undefined,
          modificationDate: info.ModDate ? String(info.ModDate) : undefined,
          fileSizeFormatted: `${(rawBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`,
          pageCount: totalPages,
          isEncrypted: Boolean(info.IsAcroFormPresent === false ? false : false),
        };

        const cur = useDocumentStore.getState().currentDocument;
        if (cur && cur.id === id) {
          useDocumentStore.setState({
            currentDocument: { ...cur, metadata: { ...metaObj, ...cur.metadata, producer: metaObj.producer ?? cur.metadata.producer } },
          });
        } else {
          const tab = useTabStore.getState().tabs.find((t) => t.id === id);
          if (tab) {
            useTabStore.getState().updateTabModel({
              ...tab.model,
              metadata: { ...metaObj, ...tab.model.metadata },
            });
          }
        }
      })
      .catch(() => {
        // ignore metadata errors
      });

    // Chunked background idle scan for very large documents (> 50 pages)
    if (totalPages > 50 && typeof window !== 'undefined') {
      const idleCallback: (cb: (deadline?: { timeRemaining?: () => number }) => void) => unknown =
        (window as unknown as { requestIdleCallback?: (cb: (d: { timeRemaining?: () => number }) => void) => unknown })
          .requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 20 }), 100));

      let scanIndex = 50;
      const runGeometryChunk = async (deadline?: { timeRemaining?: () => number }) => {
        while (scanIndex < totalPages) {
          if (!isDocumentStillOpen(id)) return;
          if (
            deadline &&
            typeof deadline.timeRemaining === 'function' &&
            deadline.timeRemaining() < 4
          ) {
            idleCallback(runGeometryChunk);
            return;
          }
          const pageIdx = scanIndex++;
          try {
            const pg = await pdfDoc.getPage(pageIdx + 1);
            if (!isDocumentStillOpen(id)) return;
            const pgRot = normalizeRotation(pg.rotate);
            const v = pg.getViewport({ scale: 1.0 });
            if (
              pgRot !== defaultRotation ||
              Math.abs(v.width - defaultWidth) > 1 ||
              Math.abs(v.height - defaultHeight) > 1
            ) {
              const targetPageId = `${id}_page_${pageIdx + 1}`;
              const cur = useDocumentStore.getState().currentDocument;
              if (cur && cur.id === id) {
                useDocumentStore.getState().updatePageGeometry(targetPageId, {
                  width: v.width,
                  height: v.height,
                  rotation: pgRot,
                });
              } else {
                const tab = useTabStore.getState().tabs.find((t) => t.id === id);
                if (tab) {
                  const updatedPages = tab.model.pages.map((p) =>
                    p.id === targetPageId
                      ? {
                          ...p,
                          width: v.width,
                          height: v.height,
                          rotation: pgRot,
                          aspectRatio: v.width / (v.height || 1),
                        }
                      : p
                  );
                  useTabStore.getState().updateTabModel({ ...tab.model, pages: updatedPages });
                }
              }
            }
          } catch {
            return;
          }
        }
      };

      idleCallback(runGeometryChunk);
    }

    const model: PdfDocumentModel = {
      id,
      name,
      filePath,
      totalPages,
      pages,
      activePageIndex: 0,
      activePageId: pages[0]?.id || '',
      selectedPageIds: pages[0] ? [pages[0].id] : [],
      isModified: false,
      metadata,
      fileSize: rawBuffer.byteLength,
      version: 1,
    };

    return { model, pdfDoc };
  }
}
