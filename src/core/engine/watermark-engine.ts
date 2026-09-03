import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { binaryStore } from '@/core/storage/binary-store';

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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

export class WatermarkEngine {
  public static async applyWatermark(
    docId: string,
    config: WatermarkConfig
  ): Promise<ArrayBuffer> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('PDF döküman bellekte bulunamadı');

    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    pdfDoc.registerFontkit(fontkit);

    // Try loading custom Unicode font for full Turkish support
    let font: any;
    const candidatePaths = ['./fonts/font-bold.ttf', '/fonts/font-bold.ttf', 'fonts/font-bold.ttf'];
    for (const p of candidatePaths) {
      try {
        const resp = await fetch(p);
        if (resp.ok) {
          const fontBytes = await resp.arrayBuffer();
          font = await pdfDoc.embedFont(fontBytes);
          break;
        }
      } catch {}
    }

    // Fallback to standard Helvetica Bold if custom font fails to fetch
    if (!font) {
      font = await pdfDoc.embedFont('Helvetica-Bold');
    }

    const { r, g, b } = hexToRgb(config.color || '#64748b');
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
          if (!isNaN(start) && !isNaN(end)) {
            for (let k = Math.min(start, end); k <= Math.max(start, end); k++) {
              if (k >= 1 && k <= totalPages) targetPageSet.add(k);
            }
          }
        } else {
          const num = Number(trimmed);
          if (!isNaN(num) && num >= 1 && num <= totalPages) targetPageSet.add(num);
        }
      }
    }

    const text = config.text || 'GİZLİDİR';
    const fontSize = config.fontSize || 48;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    pages.forEach((page, index) => {
      const pageNum = index + 1;
      if (!targetPageSet.has(pageNum)) return;

      const { width: pWidth, height: pHeight } = page.getSize();

      if (config.layout === 'tiled') {
        // Repeated tiled watermark across page
        const stepX = Math.max(180, textWidth + 80);
        const stepY = Math.max(140, textHeight + 100);

        for (let x = 40; x < pWidth + 100; x += stepX) {
          for (let y = 40; y < pHeight + 100; y += stepY) {
            page.drawText(text, {
              x,
              y,
              size: fontSize * 0.65,
              font,
              color: pdfColor,
              opacity: config.opacity || 0.15,
              rotate: degrees(config.rotation ?? 45),
            });
          }
        }
      } else {
        // Centered watermark
        const centerX = pWidth / 2 - (textWidth / 2) * Math.cos((config.rotation * Math.PI) / 180);
        const centerY = pHeight / 2 - (textHeight / 2) * Math.sin((config.rotation * Math.PI) / 180);

        page.drawText(text, {
          x: Math.max(20, centerX),
          y: Math.max(20, centerY),
          size: fontSize,
          font,
          color: pdfColor,
          opacity: config.opacity || 0.2,
          rotate: degrees(config.rotation ?? 45),
        });
      }
    });

    const modifiedBytes = await pdfDoc.save();
    return modifiedBytes.buffer as ArrayBuffer;
  }
}
