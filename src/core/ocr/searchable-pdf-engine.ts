import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { OcrPageResult } from './ocr-service';

export interface SearchablePdfOptions {
  invisibleOpacity?: number; // default 0.001
}

export class SearchablePdfEngine {
  /**
   * Embeds invisible searchable text layer into the original PDF buffer matching exact word coordinates.
   * Follows PDF24 Creator and Adobe Acrobat Pro "Searchable PDF" standards.
   */
  public static async createSearchablePdf(
    originalBuffer: ArrayBuffer,
    ocrPages: OcrPageResult[],
    options: SearchablePdfOptions = {}
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalBuffer);
    pdfDoc.registerFontkit(fontkit);

    let font: PDFFont | null = null;
    let isUnicodeFont = false;

    // Try loading Unicode font
    const fontCandidates = [
      './fonts/font-regular.ttf',
      'fonts/font-regular.ttf',
      '/fonts/font-regular.ttf',
    ];

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
        // next candidate
      }
    }

    if (!font) {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const opacity = options.invisibleOpacity ?? 0.001;

    for (const ocrPage of ocrPages) {
      const pageIndex = ocrPage.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

      const page = pdfDoc.getPage(pageIndex);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const itemsToDraw =
        ocrPage.words && ocrPage.words.length > 0
          ? ocrPage.words
          : (ocrPage.lines || []).flatMap((l) => l.words || []);

      for (const item of itemsToDraw) {
        const text = (item.text || '').trim();
        if (!text) continue;

        const normBbox = item.normBbox;
        if (!normBbox) continue;

        const x = normBbox.x * pageWidth;
        const boxHeight = normBbox.height * pageHeight;
        const y = pageHeight - (normBbox.y * pageHeight + boxHeight);
        const fontSize = Math.max(4, Math.min(60, boxHeight * 0.85));

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
            font,
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
              font,
              color: rgb(0, 0, 0),
              opacity,
            });
          } catch {
            // ignore non-renderable characters
          }
        }
      }
    }

    return await pdfDoc.save();
  }
}
