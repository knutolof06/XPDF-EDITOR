import * as pdfjsLib from 'pdfjs-dist';
import { SearchMatch } from '@/types/viewer';

export class PdfSearchEngine {
  /**
   * Searches for a given query across all pages in the PDF document.
   * matchIndex is counted SPAN-BY-SPAN so PageView can find the correct
   * span without joining text (which causes drift when words are split
   * across multiple spans).
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

      // Count matches per-span so PageView highlight logic stays in sync
      let matchIdx = 0;

      for (const item of textContent.items as any[]) {
        const raw: string = item.str || '';
        if (!raw) continue;

        const spanText = matchCase ? raw : raw.toLowerCase();
        let pos = 0;

        while ((pos = spanText.indexOf(trimmed, pos)) !== -1) {
          const startSnippet = Math.max(0, pos - 20);
          const endSnippet = Math.min(raw.length, pos + trimmed.length + 20);
          const snippet = raw.substring(startSnippet, endSnippet);

          results.push({
            pageIndex: pageNum - 1,
            matchIndex: matchIdx,
            text: snippet,
          });

          matchIdx++;
          pos += trimmed.length;
        }
      }
    }

    return results;
  }
}
