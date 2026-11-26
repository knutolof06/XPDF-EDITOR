import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfDocumentModel } from '@/types/document';
import { useDocumentStore } from '@/store/document-store';

export interface ExtractedPageText {
  pageNumber: number;
  text: string;
  wordCount: number;
  charCount: number;
  lineCount: number;
}

export interface ExtractedDocumentText {
  fullText: string;
  pages: ExtractedPageText[];
  totalWords: number;
  totalChars: number;
  totalLines: number;
}

interface RawTextItem {
  str: string;
  transform: number[];
  width?: number;
  hasEOL?: boolean;
}

const Y_LINE_TOLERANCE = 5;

function detectTwoColumnGutter(items: RawTextItem[]): number | null {
  if (items.length < 8) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const it of items) {
    const x1 = it.transform[4];
    const x2 = x1 + (it.width || 0);
    if (x1 < minX) minX = x1;
    if (x2 > maxX) maxX = x2;
  }

  const contentSpan = maxX - minX;
  if (contentSpan < 180) return null;

  const midX = minX + contentSpan / 2;
  const gutterHalf = Math.max(8, contentSpan * 0.03);
  let leftCount = 0;
  let rightCount = 0;
  let crossingCount = 0;

  for (const it of items) {
    const x1 = it.transform[4];
    const x2 = x1 + (it.width || 0);
    if (x2 <= midX - gutterHalf) {
      leftCount++;
    } else if (x1 >= midX + gutterHalf) {
      rightCount++;
    } else if (x2 - x1 < contentSpan * 0.65) {
      crossingCount++;
    }
  }

  if (leftCount >= 3 && rightCount >= 3 && crossingCount === 0) {
    return midX;
  }
  return null;
}

function sortItemsReadingOrder(items: RawTextItem[]): RawTextItem[] {
  const gutterX = detectTwoColumnGutter(items);

  const compareWithinColumn = (a: RawTextItem, b: RawTextItem): number => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > Y_LINE_TOLERANCE) {
      return yDiff;
    }
    return a.transform[4] - b.transform[4];
  };

  if (gutterX === null) {
    return [...items].sort(compareWithinColumn);
  }

  const leftCol: RawTextItem[] = [];
  const rightCol: RawTextItem[] = [];
  const fullSpanItems: RawTextItem[] = [];

  for (const it of items) {
    const x1 = it.transform[4];
    const x2 = x1 + (it.width || 0);
    if (x2 <= gutterX) leftCol.push(it);
    else if (x1 >= gutterX) rightCol.push(it);
    else fullSpanItems.push(it);
  }

  fullSpanItems.sort(compareWithinColumn);
  leftCol.sort(compareWithinColumn);
  rightCol.sort(compareWithinColumn);

  const maxLeftY = leftCol[0]?.transform[5] ?? -Infinity;
  const maxRightY = rightCol[0]?.transform[5] ?? -Infinity;
  const bodyTopY = Math.max(maxLeftY, maxRightY);
  const topHeaders = fullSpanItems.filter((it) => it.transform[5] > bodyTopY + Y_LINE_TOLERANCE);
  const bottomFooters = fullSpanItems.filter(
    (it) => it.transform[5] <= bodyTopY + Y_LINE_TOLERANCE
  );

  return [...topHeaders, ...leftCol, ...rightCol, ...bottomFooters];
}

export class PdfTextExtractor {
  /**
   * Extracts clean, structured text with consistent column-aware sorting
   * and honors deleted/reordered pages when a PdfDocumentModel is active or supplied.
   */
  public static async extractText(
    pdfDocProxy: PDFDocumentProxy,
    onProgress?: (current: number, total: number) => void,
    docModel?: PdfDocumentModel
  ): Promise<ExtractedDocumentText> {
    const docState = useDocumentStore.getState();
    const activeModel =
      docModel || (docState.pdfDocProxy === pdfDocProxy ? docState.currentDocument : null);

    const pageEntries: Array<{ logicalPageNumber: number; sourcePageIndex: number }> =
      activeModel
        ? activeModel.pages.map((p, idx) => ({
            logicalPageNumber: idx + 1,
            sourcePageIndex: p.sourcePageIndex,
          }))
        : Array.from({ length: pdfDocProxy.numPages }, (_, idx) => ({
            logicalPageNumber: idx + 1,
            sourcePageIndex: idx,
          }));

    const totalPages = pageEntries.length;
    const pages: ExtractedPageText[] = [];
    let fullTextBuilder = '';
    let totalWords = 0;
    let totalChars = 0;
    let totalLines = 0;

    for (let i = 0; i < totalPages; i++) {
      const entry = pageEntries[i];
      if (onProgress) onProgress(i + 1, totalPages);

      const pdfPage = await pdfDocProxy.getPage(entry.sourcePageIndex + 1);
      const textContent = await pdfPage.getTextContent();

      const rawItems = (textContent.items as RawTextItem[]).filter(
        (item) => typeof item.str === 'string' && item.str.trim().length > 0 && Array.isArray(item.transform)
      );

      const sortedItems = sortItemsReadingOrder(rawItems);

      let pageText = '';
      let lastY: number | null = null;
      let lastEndX: number | null = null;
      let prevHadEol = false;

      for (const item of sortedItems) {
        const currentX = item.transform[4];
        const currentY = item.transform[5];

        if (lastY !== null) {
          const yDiff = Math.abs(lastY - currentY);
          if (prevHadEol || yDiff > Y_LINE_TOLERANCE) {
            pageText += '\n';
          } else if (lastEndX !== null && currentX - lastEndX > 3 && !pageText.endsWith(' ')) {
            pageText += ' ';
          }
        }

        pageText += item.str;
        lastY = currentY;
        lastEndX = currentX + (item.width || 0);
        prevHadEol = Boolean(item.hasEOL);
      }

      const trimmedPageText = pageText.trim();
      const words = trimmedPageText ? trimmedPageText.split(/\s+/).filter(Boolean).length : 0;
      const chars = trimmedPageText.length;
      const lines = trimmedPageText ? trimmedPageText.split('\n').length : 0;

      totalWords += words;
      totalChars += chars;
      totalLines += lines;

      pages.push({
        pageNumber: entry.logicalPageNumber,
        text: trimmedPageText,
        wordCount: words,
        charCount: chars,
        lineCount: lines,
      });

      fullTextBuilder += `--- Sayfa ${entry.logicalPageNumber} ---\n${trimmedPageText}\n\n`;
    }

    return {
      fullText: fullTextBuilder.trim(),
      pages,
      totalWords,
      totalChars,
      totalLines,
    };
  }

  /**
   * Triggers download of extracted text as a clean UTF-8 .txt file
   */
  public static downloadAsTxt(docName: string, text: string): void {
    const baseName = docName.replace(/\.[^/.]+$/, '');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}_metin.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Triggers download of structured page text and stats as a .json file
   */
  public static downloadAsJson(docName: string, extracted: ExtractedDocumentText): void {
    const baseName = docName.replace(/\.[^/.]+$/, '');
    const jsonStr = JSON.stringify(extracted, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}_metin_verisi.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Copies text to clipboard
   */
  public static async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
