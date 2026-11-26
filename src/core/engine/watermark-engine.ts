import { rgb, degrees } from 'pdf-lib';
import { binaryStore } from '@/core/storage/binary-store';
import {
  embedPreferredFont,
  hexToRgbValues,
  loadPdfLibSafe,
  sanitizeTextForFont,
  uint8ToArrayBuffer,
} from '@/core/pdf/pdf-helpers';

export interface WatermarkConfig {
  text: string;
  fontSize: number;
  color: string; // hex #rrggbb
  opacity: number; // 0.05 to 1.0
  rotation: number; // in degrees: 0, 45, 90, -45
  layout: 'center' | 'tiled';
  pages: 'all' | 'first' | 'custom';
  customPages?: string; // e.g. "1, 3-5"
}

export class WatermarkEngine {
  public static async applyWatermark(
    docId: string,
    config: WatermarkConfig
  ): Promise<ArrayBuffer> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('PDF döküman bellekte bulunamadı');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Filigran ekleme');
    const { font, isCustomFont } = await embedPreferredFont(pdfDoc, 'bold', true);

    const { r, g, b } = hexToRgbValues(config.color || '#64748b', {
      r: 0.39,
      g: 0.45,
      b: 0.55,
    });
    const pdfColor = rgb(r, g, b);
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    // Parse target page numbers (1-based)
    const targetPageSet = new Set<number>();
    if (config.pages === 'all') {
      for (let i = 1; i <= totalPages; i++) targetPageSet.add(i);
    } else if (config.pages === 'first') {
      targetPageSet.add(1);
    } else if (config.pages === 'custom' && config.customPages) {
      const parts = config.customPages.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map(Number);
          if (!Number.isNaN(start) && !Number.isNaN(end)) {
            for (let k = Math.min(start, end); k <= Math.max(start, end); k++) {
              if (k >= 1 && k <= totalPages) targetPageSet.add(k);
            }
          }
        } else {
          const num = Number(trimmed);
          if (!Number.isNaN(num) && num >= 1 && num <= totalPages) targetPageSet.add(num);
        }
      }
    }

    const rawText = config.text || 'GİZLİDİR';
    const text = sanitizeTextForFont(rawText, font, isCustomFont);
    const fontSize = config.fontSize || 48;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const rotationAngle = config.rotation ?? 45;
    const rad = (rotationAngle * Math.PI) / 180;

    pages.forEach((page, index) => {
      const pageNum = index + 1;
      if (!targetPageSet.has(pageNum)) return;

      const { width: pWidth, height: pHeight } = page.getSize();

      if (config.layout === 'tiled') {
        const stepX = Math.max(180, textWidth + 80);
        const stepY = Math.max(140, textHeight + 100);
        const tileOpacity = config.opacity ?? 0.15;

        for (let x = 40; x < pWidth + 100; x += stepX) {
          for (let y = 40; y < pHeight + 100; y += stepY) {
            page.drawText(text, {
              x,
              y,
              size: fontSize * 0.65,
              font,
              color: pdfColor,
              opacity: tileOpacity,
              rotate: degrees(rotationAngle),
            });
          }
        }
      } else {
        const centerX = pWidth / 2 - (textWidth / 2) * Math.cos(rad);
        const centerY = pHeight / 2 - (textHeight / 2) * Math.sin(rad);

        page.drawText(text, {
          x: Math.max(20, centerX),
          y: Math.max(20, centerY),
          size: fontSize,
          font,
          color: pdfColor,
          opacity: config.opacity ?? 0.2,
          rotate: degrees(rotationAngle),
        });
      }
    });

    const modifiedBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return uint8ToArrayBuffer(modifiedBytes);
  }
}
