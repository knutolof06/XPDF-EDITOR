import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { binaryStore } from '@/core/storage/binary-store';
import { loadPdfLibSafe, uint8ToArrayBuffer } from '@/core/pdf/pdf-helpers';

export type CompressionLevel = 'extreme' | 'recommended' | 'less';
export type CompressionMode = 'smart' | 'lossless' | 'rasterize';

export interface CompressionOptions {
  mode?: CompressionMode;
  signal?: AbortSignal;
}

export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  reductionPercentage: number;
  compressedBuffer: ArrayBuffer;
  blob: Blob;
  modeUsed: 'lossless-optimize' | 'rasterize';
  preservedTextAndForms: boolean;
}

function getCompressionTargets(level: CompressionLevel): {
  jpegQuality: number;
  maxDimension: number;
  rasterDpiScale: number;
} {
  if (level === 'extreme') {
    return { jpegQuality: 0.48, maxDimension: 1100, rasterDpiScale: 1.0 };
  }
  if (level === 'less') {
    return { jpegQuality: 0.85, maxDimension: 2000, rasterDpiScale: 1.8 };
  }
  return { jpegQuality: 0.7, maxDimension: 1500, rasterDpiScale: 1.35 };
}

async function recompressJpegBytes(
  jpegBytes: Uint8Array,
  origWidth: number,
  origHeight: number,
  quality: number,
  maxDimension: number
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  const blob = new Blob([uint8ToArrayBuffer(jpegBytes)], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error('Image decode timeout')), 2000);
      el.onload = () => {
        clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Image decode failed'));
      };
      el.src = url;
    });

    const w = img.naturalWidth || origWidth;
    const h = img.naturalHeight || origHeight;
    if (w <= 0 || h <= 0) return null;

    const maxCurrent = Math.max(w, h);
    const scaleFactor = maxCurrent > maxDimension ? maxDimension / maxCurrent : 1;
    const targetW = Math.max(1, Math.round(w * scaleFactor));
    const targetH = Math.max(1, Math.round(h * scaleFactor));

    const canvas = document.createElement('canvas');
    try {
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) return null;

      const binary = atob(dataUrl.slice(commaIdx + 1));
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
      }

      return { bytes: out, width: targetW, height: targetH };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class PdfCompressor {
  /**
   * Compresses a PDF:
   * - Default 'smart' mode preserves all selectable text, vector graphics, links, outlines,
   *   and AcroForm fields while re-packing object streams and selectively downsampling/recompressing
   *   embedded JPEG Image XObjects when smaller.
   * - 'lossless' mode re-packs streams/objects with zero image re-encoding.
   * - 'rasterize' mode explicitly rasterizes pages to JPEG when requested for heavy scanned docs.
   */
  public static async compressPdf(
    docId: string,
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    level: CompressionLevel = 'recommended',
    onProgress?: (current: number, total: number) => void,
    options?: CompressionOptions
  ): Promise<CompressionResult> {
    const mode: CompressionMode = options?.mode ?? 'smart';
    const signal = options?.signal;
    const originalBuffer = binaryStore.get(docId);
    const originalSize = originalBuffer ? originalBuffer.byteLength : 1;
    const targets = getCompressionTargets(level);

    if (signal?.aborted) {
      throw new DOMException('Sıkıştırma iptal edildi.', 'AbortError');
    }

    if (mode !== 'rasterize' && originalBuffer) {
      const pdfDoc = await loadPdfLibSafe(originalBuffer, 'PDF sıkıştırma');
      const totalPages = pdfDoc.getPageCount();
      if (onProgress) onProgress(1, Math.max(1, totalPages));

      if (mode === 'smart') {
        const objects = pdfDoc.context.enumerateIndirectObjects();
        const imageEntries: Array<{ stream: PDFRawStream; width: number; height: number }> = [];

        for (const [, obj] of objects) {
          if (!(obj instanceof PDFRawStream)) continue;
          const dict = obj.dict;
          const subtype = dict.get(PDFName.of('Subtype'));
          if (subtype !== PDFName.of('Image')) continue;

          // Only touch plain DCTDecode (JPEG) streams without alpha SMask/Decode/Mask risks
          const filter = dict.get(PDFName.of('Filter'));
          const isDct = filter === PDFName.of('DCTDecode');
          const hasSMask = dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'));
          const colorSpace = dict.get(PDFName.of('ColorSpace'));
          const isSafeColor =
            !colorSpace ||
            colorSpace === PDFName.of('DeviceRGB') ||
            colorSpace === PDFName.of('DeviceGray');

          if (!isDct || hasSMask || !isSafeColor) continue;

          const widthObj = dict.get(PDFName.of('Width'));
          const heightObj = dict.get(PDFName.of('Height'));
          const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
          const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;
          if (width <= 0 || height <= 0) continue;

          imageEntries.push({ stream: obj, width, height });
        }

        for (let idx = 0; idx < imageEntries.length; idx++) {
          if (signal?.aborted) {
            throw new DOMException('Sıkıştırma iptal edildi.', 'AbortError');
          }
          const entry = imageEntries[idx];
          const originalStreamBytes = entry.stream.contents;
          const recompressed = await recompressJpegBytes(
            originalStreamBytes,
            entry.width,
            entry.height,
            targets.jpegQuality,
            targets.maxDimension
          );

          if (recompressed && recompressed.bytes.byteLength < originalStreamBytes.byteLength) {
            const replacementStream = PDFRawStream.of(entry.stream.dict, recompressed.bytes);
            entry.stream.dict.set(PDFName.of('Width'), PDFNumber.of(recompressed.width));
            entry.stream.dict.set(PDFName.of('Height'), PDFNumber.of(recompressed.height));
            entry.stream.dict.set(PDFName.of('Length'), PDFNumber.of(recompressed.bytes.byteLength));
            entry.stream.dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
            entry.stream.dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
            entry.stream.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
            // Mutate contents cleanly by replacing underlying stream entry in context
            const ref = pdfDoc.context.getObjectRef(entry.stream);
            if (ref) {
              pdfDoc.context.assign(ref, replacementStream);
            }
          }
        }
      }

      if (onProgress) onProgress(totalPages, Math.max(1, totalPages));

      const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,
        updateFieldAppearances: false,
      });
      const compressedBuffer = uint8ToArrayBuffer(compressedBytes);
      const compressedSize = compressedBuffer.byteLength;
      const savedBytes = originalSize - compressedSize;
      const reductionPercentage =
        originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

      return {
        originalSize,
        compressedSize,
        savedBytes,
        reductionPercentage,
        compressedBuffer,
        blob: new Blob([compressedBuffer], { type: 'application/pdf' }),
        modeUsed: 'lossless-optimize',
        preservedTextAndForms: true,
      };
    }

    // Explicit rasterize mode (e.g., scanned documents)
    const numPages = pdfDocProxy.numPages;
    const outPdf = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (signal?.aborted) {
        throw new DOMException('Sıkıştırma iptal edildi.', 'AbortError');
      }
      if (onProgress) {
        onProgress(pageNum, numPages);
      }

      const pdfPage = await pdfDocProxy.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: targets.rasterDpiScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });

      try {
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await pdfPage.render({
            canvasContext: ctx,
            viewport,
          }).promise;

          const jpegDataUrl = canvas.toDataURL('image/jpeg', targets.jpegQuality);
          const base64Data = jpegDataUrl.split(',')[1];
          const binaryStr = atob(base64Data);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let j = 0; j < len; j++) {
            bytes[j] = binaryStr.charCodeAt(j);
          }

          const embeddedImage = await outPdf.embedJpg(bytes);
          const originalViewport = pdfPage.getViewport({ scale: 1.0 });
          const newPage = outPdf.addPage([originalViewport.width, originalViewport.height]);

          newPage.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: originalViewport.width,
            height: originalViewport.height,
          });
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    const compressedBytes = await outPdf.save({ useObjectStreams: true });
    const compressedBuffer = uint8ToArrayBuffer(compressedBytes);
    const compressedSize = compressedBuffer.byteLength;
    const savedBytes = originalSize - compressedSize;
    const reductionPercentage =
      originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

    return {
      originalSize,
      compressedSize,
      savedBytes,
      reductionPercentage,
      compressedBuffer,
      blob: new Blob([compressedBuffer], { type: 'application/pdf' }),
      modeUsed: 'rasterize',
      preservedTextAndForms: false,
    };
  }
}
