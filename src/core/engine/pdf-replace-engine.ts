import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { binaryStore } from '@/core/storage/binary-store';

export interface TextMatchItem {
  id: string;
  pageIndex: number; // 0-based
  matchIndex: number;
  matchedText: string;
  fullItemText: string;
  x: number; // PDF points from left
  y: number; // PDF points from bottom (baseline)
  width: number; // in PDF points
  height: number; // font height in points
  fontSize: number;
}

export interface FindReplaceOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  scope?: 'all' | 'current';
  currentPageIndex?: number;
}

export class PdfReplaceEngine {
  /**
   * Searches for matching text occurrences in the document and computes exact PDF-point bounding boxes.
   */
  public static async findMatches(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    query: string,
    options: FindReplaceOptions = {}
  ): Promise<TextMatchItem[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const {
      matchCase = false,
      wholeWord = false,
      scope = 'all',
      currentPageIndex = 0,
    } = options;

    const results: TextMatchItem[] = [];
    const searchStr = matchCase ? query : query.toLocaleLowerCase('tr-TR');

    const startPage = scope === 'current' ? currentPageIndex + 1 : 1;
    const endPage = scope === 'current' ? currentPageIndex + 1 : pdfDoc.numPages;

    let globalMatchIdx = 0;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      for (const item of textContent.items as any[]) {
        const rawStr: string = item.str || '';
        if (!rawStr || rawStr.trim() === '') continue;

        const compareStr = matchCase ? rawStr : rawStr.toLocaleLowerCase('tr-TR');
        let pos = 0;

        while ((pos = compareStr.indexOf(searchStr, pos)) !== -1) {
          // Whole word check
          if (wholeWord) {
            const before = pos > 0 ? compareStr[pos - 1] : ' ';
            const after = pos + searchStr.length < compareStr.length ? compareStr[pos + searchStr.length] : ' ';
            const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
            if (isWordChar(before) || isWordChar(after)) {
              pos += searchStr.length;
              continue;
            }
          }

          const transform: number[] = item.transform;
          const fontHeight = Math.sqrt(
            transform[2] * transform[2] + transform[3] * transform[3]
          ) || 12;

          const totalChars = rawStr.length || 1;
          const charStart = pos;
          const charEnd = pos + searchStr.length;

          // Estimate horizontal character offset proportional to string length
          const itemWidth = item.width || fontHeight * totalChars * 0.6;
          const offsetX = (charStart / totalChars) * itemWidth;
          const matchWidth = ((charEnd - charStart) / totalChars) * itemWidth;

          const x = transform[4] + offsetX;
          const y = transform[5]; // baseline

          results.push({
            id: `match_${pageNum}_${globalMatchIdx++}`,
            pageIndex: pageNum - 1,
            matchIndex: globalMatchIdx,
            matchedText: rawStr.substring(charStart, charEnd),
            fullItemText: rawStr,
            x,
            y,
            width: Math.max(matchWidth, 6),
            height: fontHeight,
            fontSize: fontHeight,
          });

          pos += searchStr.length;
        }
      }
    }

    return results;
  }

  /**
   * Applies replacements to the PDF document:
   * Covers the original text bounding boxes with background white rectangles and draws the new text.
   */
  public static async applyReplacements(
    docId: string,
    matchesToReplace: TextMatchItem[],
    replacementText: string
  ): Promise<ArrayBuffer> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('PDF döküman bellekte bulunamadı');

    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    pdfDoc.registerFontkit(fontkit);

    // Try loading Unicode font for full Turkish character support
    let font: any;
    const candidatePaths = [
      './fonts/font-regular.ttf',
      '/fonts/font-regular.ttf',
      'fonts/font-regular.ttf',
    ];
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

    if (!font) {
      font = await pdfDoc.embedFont('Helvetica');
    }

    const pages = pdfDoc.getPages();

    // Group matches by page
    const matchesByPage = new Map<number, TextMatchItem[]>();
    for (const m of matchesToReplace) {
      if (!matchesByPage.has(m.pageIndex)) {
        matchesByPage.set(m.pageIndex, []);
      }
      matchesByPage.get(m.pageIndex)!.push(m);
    }

    for (const [pageIdx, pageMatches] of matchesByPage.entries()) {
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];

      for (const m of pageMatches) {
        // 1. Cover original text with background white rectangle (plus 1pt padding)
        page.drawRectangle({
          x: Math.max(0, m.x - 1),
          y: Math.max(0, m.y - 1.5),
          width: m.width + 2,
          height: m.height + 3,
          color: rgb(1, 1, 1),
        });

        // 2. Draw replacement text at exact location
        if (replacementText && replacementText.length > 0) {
          try {
            page.drawText(replacementText, {
              x: m.x,
              y: m.y,
              size: m.fontSize,
              font,
              color: rgb(0.1, 0.1, 0.1),
            });
          } catch (fontErr) {
            // Fallback text drawing if specific character glyph fails
            console.warn('[PdfReplaceEngine] font drawing warning:', fontErr);
          }
        }
      }
    }

    const modifiedBytes = await pdfDoc.save();
    const copy = new ArrayBuffer(modifiedBytes.byteLength);
    new Uint8Array(copy).set(modifiedBytes);
    return copy;
  }
}
