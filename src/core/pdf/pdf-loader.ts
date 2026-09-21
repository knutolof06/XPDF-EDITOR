import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel, PdfPageModel, PdfMetadata } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { useDocumentStore } from '@/store/document-store';

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

function toArrayBuffer(input: any): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input.slice(0);
  }
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  if (input && input.type === 'Buffer' && Array.isArray(input.data)) {
    return new Uint8Array(input.data).buffer.slice(0);
  }
  if (input && input.buffer instanceof ArrayBuffer) {
    const offset = input.byteOffset || 0;
    const length = input.byteLength || input.buffer.byteLength;
    return input.buffer.slice(offset, offset + length);
  }
  return input;
}

export class PdfLoader {
  /**
   * Loads a PDF file from an ArrayBuffer / Uint8Array and returns the normalized PdfDocumentModel
   */
  public static async loadDocument(
    name: string,
    data: any,
    filePath?: string,
    password?: string
  ): Promise<LoadedPdfResult> {
    const rawBuffer = toArrayBuffer(data);
    const id = crypto.randomUUID ? crypto.randomUUID() : 'doc_' + Date.now();
    
    // Store dedicated clone in binaryStore so web worker transfer cannot detach it
    binaryStore.set(id, rawBuffer.slice(0));

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
    } catch (err: any) {
      if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
        const passErr: any = new Error('Bu PDF dökümanı parola ile korunmaktadır.');
        passErr.isPasswordProtected = true;
        passErr.fileName = name;
        passErr.buffer = rawBuffer;
        passErr.filePath = filePath;
        throw passErr;
      }
      throw err;
    }

    const totalPages = pdfDoc.numPages;

    // Fast Page 1 extraction (Instant First Paint in < 50ms regardless of document size!)
    let defaultWidth = 595.28;
    let defaultHeight = 841.89;
    let defaultRotation = 0;

    try {
      const page1 = await pdfDoc.getPage(1);
      const v1 = page1.getViewport({ scale: 1.0 });
      defaultWidth = v1.width || defaultWidth;
      defaultHeight = v1.height || defaultHeight;
      defaultRotation = page1.rotate || 0;
    } catch {
      // Fallback to standard A4
    }

    // Build all page models instantaneously from document geometry template
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

    // Extract metadata asynchronously without blocking
    let metadata: PdfMetadata = {
      fileSizeFormatted: `${(rawBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`,
    };
    pdfDoc
      .getMetadata()
      .then((meta) => {
        const info = (meta?.info as Record<string, any>) || {};
        const metaObj: PdfMetadata = {
          title: info.Title || name.replace(/\.pdf$/i, ''),
          author: info.Author || undefined,
          subject: info.Subject || undefined,
          keywords: info.Keywords || undefined,
          creator: info.Creator || undefined,
          producer: info.Producer || undefined,
          creationDate: info.CreationDate ? String(info.CreationDate) : undefined,
          modificationDate: info.ModDate ? String(info.ModDate) : undefined,
          fileSizeFormatted: `${(rawBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`,
        };
        const cur = useDocumentStore.getState().currentDocument;
        if (cur && cur.id === id) {
          useDocumentStore.setState({
            currentDocument: { ...cur, metadata: metaObj },
          });
        }
      })
      .catch(() => {});

    // Low-priority background idle scan for pages with non-standard dimensions/rotations
    if (totalPages > 1 && typeof window !== 'undefined') {
      const idleCallback =
        (window as any).requestIdleCallback ||
        ((cb: any) => setTimeout(cb, 300));
      idleCallback(async () => {
        for (let i = 1; i < totalPages; i++) {
          try {
            const pg = await pdfDoc.getPage(i + 1);
            const v = pg.getViewport({ scale: 1.0 });
            if (
              pg.rotate !== defaultRotation ||
              Math.abs(v.width - defaultWidth) > 1 ||
              Math.abs(v.height - defaultHeight) > 1
            ) {
              useDocumentStore.getState().updatePageGeometry(`${id}_page_${i + 1}`, {
                width: v.width,
                height: v.height,
                rotation: pg.rotate || 0,
              });
            }
          } catch {
            break;
          }
        }
      });
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
