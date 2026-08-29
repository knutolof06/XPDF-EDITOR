import * as pdfjsLib from 'pdfjs-dist';
import { SearchMatch } from '@/types/viewer';

export class PdfSearchEngine {
  /**
   * Searches for a given query across all pages in the PDF document
   */
  public static async search(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    query: string,
    matchCase: boolean = false
  ): Promise<SearchMatch[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmed = matchCase ? query : query.toLowerCase();
    const results: SearchMatch[] = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ');

      const normalizedText = matchCase ? pageText : pageText.toLowerCase();
      let pos = 0;
      let matchIdx = 0;

      while ((pos = normalizedText.indexOf(trimmed, pos)) !== -1) {
        // Grab a context snippet
        const startSnippet = Math.max(0, pos - 20);
        const endSnippet = Math.min(pageText.length, pos + trimmed.length + 20);
        const snippet = pageText.substring(startSnippet, endSnippet);

        results.push({
          pageIndex: pageNum - 1,
          matchIndex: matchIdx++,
          text: snippet,
        });

        pos += trimmed.length;
      }
    }

    return results;
  }
}
