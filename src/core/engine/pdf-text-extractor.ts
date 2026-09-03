import type { PDFDocumentProxy } from 'pdfjs-dist';

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

export class PdfTextExtractor {
  /**
   * Extracts clean, structured text from all or specified pages with natural layout sorting.
   */
  public static async extractText(
    pdfDocProxy: PDFDocumentProxy,
    onProgress?: (current: number, total: number) => void
  ): Promise<ExtractedDocumentText> {
    const totalPages = pdfDocProxy.numPages;
    const pages: ExtractedPageText[] = [];
    let fullTextBuilder = '';
    let totalWords = 0;
    let totalChars = 0;
    let totalLines = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (onProgress) onProgress(pageNum, totalPages);

      const pdfPage = await pdfDocProxy.getPage(pageNum);
      const textContent = await pdfPage.getTextContent();

      // Sort items: Reading order top-to-bottom (Y desc), then left-to-right (X asc)
      const items = (textContent.items as any[]).filter(
        (item) => typeof item.str === 'string' && item.str.trim().length > 0
      );

      items.sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 4) {
          return yDiff; // Higher Y is higher on page in PDF coordinates
        }
        return a.transform[4] - b.transform[4]; // Left to right
      });

      let pageText = '';
      let lastY: number | null = null;
      let lastX: number | null = null;

      for (const item of items) {
        const currentX = item.transform[4];
        const currentY = item.transform[5];

        if (lastY !== null) {
          const yDiff = Math.abs(lastY - currentY);
          if (yDiff > 6) {
            // New line
            pageText += '\n';
          } else if (lastX !== null && currentX - lastX > 3 && !pageText.endsWith(' ')) {
            pageText += ' ';
          }
        }

        pageText += item.str;
        lastY = currentY;
        lastX = currentX + (item.width || 0);
      }

      const trimmedPageText = pageText.trim();
      const words = trimmedPageText ? trimmedPageText.split(/\s+/).filter(Boolean).length : 0;
      const chars = trimmedPageText.length;
      const lines = trimmedPageText ? trimmedPageText.split('\n').length : 0;

      totalWords += words;
      totalChars += chars;
      totalLines += lines;

      pages.push({
        pageNumber: pageNum,
        text: trimmedPageText,
        wordCount: words,
        charCount: chars,
        lineCount: lines,
      });

      fullTextBuilder += `--- Sayfa ${pageNum} ---\n${trimmedPageText}\n\n`;
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
    URL.revokeObjectURL(url);
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
    URL.revokeObjectURL(url);
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
