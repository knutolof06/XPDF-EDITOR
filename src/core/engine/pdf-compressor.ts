import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { binaryStore } from '@/core/storage/binary-store';

export type CompressionLevel = 'extreme' | 'recommended' | 'less';

export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  reductionPercentage: number;
  compressedBuffer: ArrayBuffer;
  blob: Blob;
}

export class PdfCompressor {
  /**
   * Compresses a PDF by re-encoding pages with optimal JPEG compression
   * and enabling compressed object streams in pdf-lib.
   */
  public static async compressPdf(
    docId: string,
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    level: CompressionLevel = 'recommended',
    onProgress?: (current: number, total: number) => void
  ): Promise<CompressionResult> {
    const originalBuffer = binaryStore.get(docId);
    const originalSize = originalBuffer ? originalBuffer.byteLength : 1;

    // Quality and scale parameters based on compression level
    let quality = 0.72;
    let dpiScale = 1.35; // ~100-120 DPI, balanced clarity and small file size

    if (level === 'extreme') {
      quality = 0.50;
      dpiScale = 1.0; // ~72-96 DPI, maximum size reduction
    } else if (level === 'less') {
      quality = 0.85;
      dpiScale = 1.8; // ~150-200 DPI, high fidelity
    }

    const numPages = pdfDocProxy.numPages;
    const outPdf = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) {
        onProgress(pageNum, numPages);
      }

      const pdfPage = await pdfDocProxy.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: dpiScale });

      // Create offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });

      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await pdfPage.render({
          canvasContext: ctx,
          viewport,
        }).promise;

        // Convert to compressed JPEG data
        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = jpegDataUrl.split(',')[1];
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = binaryStr.charCodeAt(j);
        }

        const embeddedImage = await outPdf.embedJpg(bytes);

        // Standard PDF points (72 DPI) dimensions
        const originalViewport = pdfPage.getViewport({ scale: 1.0 });
        const newPage = outPdf.addPage([originalViewport.width, originalViewport.height]);

        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: originalViewport.width,
          height: originalViewport.height,
        });
      }

      // Cleanup canvas memory
      canvas.width = 0;
      canvas.height = 0;
    }

    // Save with object streams enabled to compress dictionary data
    const compressedBytes = await outPdf.save({ useObjectStreams: true });
    const compressedBuffer = compressedBytes.buffer as ArrayBuffer;
    const compressedSize = compressedBuffer.byteLength;

    const savedBytes = Math.max(0, originalSize - compressedSize);
    const reductionPercentage = Math.max(0, Math.round((savedBytes / originalSize) * 100));

    const blob = new Blob([compressedBuffer], { type: 'application/pdf' });

    return {
      originalSize,
      compressedSize,
      savedBytes,
      reductionPercentage,
      compressedBuffer,
      blob,
    };
  }
}
