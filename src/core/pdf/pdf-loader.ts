import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentModel, PdfPageModel, PdfMetadata } from '@/types/document';
import { binaryStore } from '../storage/binary-store';

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
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  if (input && input.type === 'Buffer' && Array.isArray(input.data)) {
    return new Uint8Array(input.data).buffer;
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
    data: any
  ): Promise<LoadedPdfResult> {
    const rawBuffer = toArrayBuffer(data);
    const id = crypto.randomUUID ? crypto.randomUUID() : 'doc_' + Date.now();
    
    // Save an untouched cloned copy in binary store (prevent detached buffer issues)
    binaryStore.set(id, rawBuffer.slice(0));

    // Pass a fresh clone to PDF.js worker so original binaryStore buffer is NEVER detached
    const workerBuffer = rawBuffer.slice(0);

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(workerBuffer),
      cMapUrl: getAssetUrl('pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: getAssetUrl('pdfjs/standard_fonts/'),
    });

    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;

    // Extract metadata
    let metadata: PdfMetadata = {};
    try {
      const meta = await pdfDoc.getMetadata();
      const info = (meta?.info as Record<string, any>) || {};
      metadata = {
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
    } catch {
      // Fallback
    }

    // Build page models
    const pages: PdfPageModel[] = [];
    for (let i = 0; i < totalPages; i++) {
      const pdfPage = await pdfDoc.getPage(i + 1);
      const viewport = pdfPage.getViewport({ scale: 1.0 });

      pages.push({
        id: `${id}_page_${i + 1}`,
        sourceDocId: id,
        sourcePageIndex: i,
        displayPageNumber: i + 1,
        rotation: pdfPage.rotate || 0,
        width: viewport.width,
        height: viewport.height,
        aspectRatio: viewport.width / viewport.height,
        annotations: [],
      });
    }

    const model: PdfDocumentModel = {
      id,
      name,
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
