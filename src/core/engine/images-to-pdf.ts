import { PDFDocument } from 'pdf-lib';
import { uint8ToArrayBuffer } from '@/core/pdf/pdf-helpers';

export interface ImageToPdfItem {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

export interface ImageToPdfConfig {
  pageSize: 'a4' | 'letter' | 'original';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number; // in points (e.g. 0, 20, 36)
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return await file.arrayBuffer();
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Görsel dosyası okunamadı.'));
    reader.readAsArrayBuffer(file);
  });
}

export class ImagesToPdfConverter {
  /**
   * Helper to load an image File and get its intrinsic dimensions and ArrayBuffer
   */
  public static async loadImageData(file: File): Promise<{
    bytes: Uint8Array;
    width: number;
    height: number;
    isPng: boolean;
  }> {
    const isPng = file.type === 'image/png';
    const isJpg = file.type === 'image/jpeg' || file.type === 'image/jpg';

    if (isPng || isJpg) {
      const buffer = await readFileAsArrayBuffer(file);
      const bytes = new Uint8Array(buffer);

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (err) => reject(err instanceof Error ? err : new Error('Görsel yüklenemedi.'));
          img.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL?.(objectUrl);
      }

      if (!img.naturalWidth || !img.naturalHeight) {
        throw new Error('Görsel boyutları geçersiz (0x0).');
      }

      return {
        bytes,
        width: img.naturalWidth,
        height: img.naturalHeight,
        isPng,
      };
    }

    // For other formats like webp/gif/bmp, convert to PNG via Canvas
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new Error('Görsel boyutları geçersiz (0x0).'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context error'));
            return;
          }

          ctx.drawImage(img, 0, 0);
          const pngDataUrl = canvas.toDataURL('image/png');
          const base64 = pngDataUrl.split(',')[1];
          const binaryStr = atob(base64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }

          resolve({
            bytes,
            width: img.naturalWidth,
            height: img.naturalHeight,
            isPng: true,
          });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        reject(e instanceof Error ? e : new Error('Görsel yüklenemedi.'));
      };
      img.src = objectUrl;
    });
  }

  /**
   * Converts multiple images into a unified PDFDocument
   */
  public static async convertImagesToPdf(
    images: ImageToPdfItem[],
    config: ImageToPdfConfig,
    onProgress?: (current: number, total: number) => void
  ): Promise<ArrayBuffer> {
    const pdfDoc = await PDFDocument.create();

    const standardSizes: Record<string, [number, number]> = {
      a4: [595.28, 841.89],
      letter: [612.0, 792.0],
    };

    for (let i = 0; i < images.length; i++) {
      if (onProgress) {
        onProgress(i + 1, images.length);
      }

      const item = images[i];
      const { bytes, width, height, isPng } = await this.loadImageData(item.file);
      if (width <= 0 || height <= 0) {
        throw new Error('Görsel boyutları geçersiz (0x0).');
      }

      const embeddedImage = isPng
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      let pageWidth: number;
      let pageHeight: number;

      if (config.pageSize === 'original') {
        pageWidth = width;
        pageHeight = height;
      } else {
        const [w, h] = standardSizes[config.pageSize] || standardSizes.a4;
        let isLandscape = false;
        if (config.orientation === 'auto') {
          isLandscape = width > height;
        } else if (config.orientation === 'landscape') {
          isLandscape = true;
        }

        pageWidth = isLandscape ? Math.max(w, h) : Math.min(w, h);
        pageHeight = isLandscape ? Math.min(w, h) : Math.max(w, h);
      }

      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      const margin = config.margin ?? 0;
      const availableWidth = Math.max(10, pageWidth - margin * 2);
      const availableHeight = Math.max(10, pageHeight - margin * 2);

      const imageAspect = width / height;
      const boxAspect = availableWidth / availableHeight;

      let drawWidth: number;
      let drawHeight: number;

      if (imageAspect > boxAspect) {
        drawWidth = availableWidth;
        drawHeight = availableWidth / imageAspect;
      } else {
        drawHeight = availableHeight;
        drawWidth = availableHeight * imageAspect;
      }

      const drawX = margin + (availableWidth - drawWidth) / 2;
      const drawY = margin + (availableHeight - drawHeight) / 2;

      page.drawImage(embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return uint8ToArrayBuffer(pdfBytes);
  }
}
