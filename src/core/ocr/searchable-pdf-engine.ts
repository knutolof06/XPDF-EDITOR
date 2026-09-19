import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { OcrPageResult } from './ocr-service';

export interface SearchablePdfOptions {
  invisibleOpacity?: number; // default 0.001
}

function toArrayBuffer(input: any): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  if (input && input.buffer instanceof ArrayBuffer) {
    const offset = input.byteOffset || 0;
    const length = input.byteLength || input.buffer.byteLength;
    return input.buffer.slice(offset, offset + length);
  }
  return input;
}

export class SearchablePdfEngine {
  /**
   * Embeds invisible searchable text layer into the original PDF buffer matching exact word coordinates.
   * Follows PDF24 Creator and Adobe Acrobat Pro "Searchable PDF" standards.
   */
  public static async createSearchablePdf(
    originalBuffer: ArrayBuffer | Uint8Array,
    ocrPages: OcrPageResult[],
    options: SearchablePdfOptions = {}
  ): Promise<Uint8Array> {
    const rawBuffer = toArrayBuffer(originalBuffer);
    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    pdfDoc.registerFontkit(fontkit);

    let font: PDFFont | null = null;
    let isUnicodeFont = false;

    // Try loading Unicode font for full Turkish & Latin glyph fidelity
    const fontCandidates = [
      './fonts/font-regular.ttf',
      'fonts/font-regular.ttf',
      '/fonts/font-regular.ttf',
    ];

    if (typeof window !== 'undefined' && window.location?.origin) {
      fontCandidates.unshift(`${window.location.origin}/fonts/font-regular.ttf`);
    }

    for (const url of fontCandidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const fontBuffer = await res.arrayBuffer();
          font = await pdfDoc.embedFont(fontBuffer, { subset: true });
          isUnicodeFont = true;
          break;
        }
      } catch {
        // continue to next candidate
      }
    }

    if (!font) {
      try {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      } catch {
        font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
      }
    }

    const opacity = options.invisibleOpacity ?? 0.001;

    for (const ocrPage of ocrPages) {
      const pageIndex = ocrPage.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

      const page = pdfDoc.getPage(pageIndex);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      // Collect items to draw: prioritize word-level bounding boxes for exact word selection
      const itemsToDraw: {
        text: string;
        normBbox: { x: number; y: number; width: number; height: number };
      }[] = [];

      if (ocrPage.words && ocrPage.words.length > 0) {
        for (const w of ocrPage.words) {
          if (w.text && w.normBbox && w.text.trim().length > 0) {
            itemsToDraw.push({ text: w.text.trim(), normBbox: w.normBbox });
          }
        }
      } else if (ocrPage.lines && ocrPage.lines.length > 0) {
        // Fallback to lines if words are not granularly available
        const cWidth = ocrPage.width || pageWidth;
        const cHeight = ocrPage.height || pageHeight;
        for (const l of ocrPage.lines) {
          if (l.text && l.text.trim().length > 0 && l.bbox) {
            itemsToDraw.push({
              text: l.text.trim(),
              normBbox: {
                x: l.bbox.x0 / cWidth,
                y: l.bbox.y0 / cHeight,
                width: Math.max(0.01, (l.bbox.x1 - l.bbox.x0) / cWidth),
                height: Math.max(0.01, (l.bbox.y1 - l.bbox.y0) / cHeight),
              },
            });
          }
        }
      }

      for (const item of itemsToDraw) {
        const text = item.text;
        if (!text) continue;

        const normBbox = item.normBbox;
        const x = normBbox.x * pageWidth;
        const boxHeight = normBbox.height * pageHeight;
        // Text baseline in PDF coordinates (origin at bottom-left):
        // Standard typography baseline is ~15% above the bottom of the bounding box
        const y = Math.max(0, pageHeight - (normBbox.y * pageHeight + boxHeight) + (boxHeight * 0.15));
        const fontSize = Math.max(4, Math.min(60, boxHeight * 0.82));

        const textToDraw = isUnicodeFont
          ? text
          : text
              .replace(/ğ/g, 'g')
              .replace(/Ğ/g, 'G')
              .replace(/ş/g, 's')
              .replace(/Ş/g, 'S')
              .replace(/ı/g, 'i')
              .replace(/İ/g, 'I');

        try {
          page.drawText(textToDraw, {
            x: Math.max(0, x),
            y: Math.max(0, y),
            size: fontSize,
            font: font!,
            color: rgb(0, 0, 0),
            opacity,
          });
        } catch {
          try {
            const asciiText = textToDraw.replace(/[^\x00-\x7F]/g, '?');
            page.drawText(asciiText, {
              x: Math.max(0, x),
              y: Math.max(0, y),
              size: fontSize,
              font: font!,
              color: rgb(0, 0, 0),
              opacity,
            });
          } catch {
            // ignore non-renderable characters to avoid breaking document creation
          }
        }
      }
    }

    return await pdfDoc.save();
  }
}
