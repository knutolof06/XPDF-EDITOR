import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

export interface ImageExportOptions {
  format: ImageExportFormat;
  scale: number; // 1 = 72 DPI, 2 = 150 DPI, 3 = 300 DPI
  quality?: number; // 0.1 to 1.0 (for jpeg/webp)
}

export class PdfImageExporter {
  /**
   * Renders a specific page to a Canvas element at given scale
   */
  public static async renderPageToCanvas(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    scale: number = 2.0
  ): Promise<HTMLCanvasElement> {
    const page = await pdfDocProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get canvas 2d context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return canvas;
  }

  /**
   * Exports a single page as a Blob
   */
  public static async exportSinglePage(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    options: ImageExportOptions
  ): Promise<{ blob: Blob; filename: string }> {
    const canvas = await this.renderPageToCanvas(pdfDocProxy, pageNumber, options.scale);
    const mimeType = options.format === 'png' ? 'image/png' : options.format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = options.quality ?? 0.92;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed'));
        },
        mimeType,
        quality
      );
    });

    const ext = options.format === 'jpeg' ? 'jpg' : options.format;
    const filename = `sayfa-${pageNumber}.${ext}`;

    return { blob, filename };
  }

  /**
   * Exports multiple pages packaged into a single ZIP file
   */
  public static async exportPagesAsZip(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    docName: string,
    options: ImageExportOptions,
    pageIndices?: number[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob> {
    const zip = new JSZip();
    const totalPages = pdfDocProxy.numPages;
    const targetPages = pageIndices && pageIndices.length > 0
      ? pageIndices.filter(p => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    const mimeType = options.format === 'png' ? 'image/png' : options.format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = options.quality ?? 0.92;
    const ext = options.format === 'jpeg' ? 'jpg' : options.format;

    for (let idx = 0; idx < targetPages.length; idx++) {
      const pageNum = targetPages[idx];
      if (onProgress) {
        onProgress(idx + 1, targetPages.length);
      }

      const canvas = await this.renderPageToCanvas(pdfDocProxy, pageNum, options.scale);
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64Data = dataUrl.split(',')[1];

      const paddedIndex = String(pageNum).padStart(3, '0');
      zip.file(`${docName.replace(/\.pdf$/i, '')}_sayfa_${paddedIndex}.${ext}`, base64Data, { base64: true });

      // Free canvas memory
      canvas.width = 0;
      canvas.height = 0;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return zipBlob;
  }
}
