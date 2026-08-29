import * as pdfjsLib from 'pdfjs-dist';
import { BookmarkItem } from '@/types/advanced';

export class PdfOutlineExtractor {
  /**
   * Extracts bookmarks/outlines tree from PDF.js document proxy
   */
  public static async extractOutline(
    pdfDoc: pdfjsLib.PDFDocumentProxy
  ): Promise<BookmarkItem[]> {
    try {
      const outline = await pdfDoc.getOutline();
      if (!outline || outline.length === 0) {
        return [];
      }

      return await this.processOutlineItems(pdfDoc, outline);
    } catch (err) {
      console.error('Outline extraction error:', err);
      return [];
    }
  }

  private static async processOutlineItems(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    items: any[]
  ): Promise<BookmarkItem[]> {
    const results: BookmarkItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let pageIndex = 0;

      if (item.dest) {
        try {
          if (typeof item.dest === 'string') {
            const destObj = await pdfDoc.getDestination(item.dest);
            if (destObj && destObj.length > 0) {
              const pageRef = destObj[0];
              const idx = await pdfDoc.getPageIndex(pageRef);
              pageIndex = idx >= 0 ? idx : 0;
            }
          } else if (Array.isArray(item.dest) && item.dest.length > 0) {
            const pageRef = item.dest[0];
            const idx = await pdfDoc.getPageIndex(pageRef);
            pageIndex = idx >= 0 ? idx : 0;
          }
        } catch {
          pageIndex = 0;
        }
      }

      let children: BookmarkItem[] | undefined;
      if (item.items && item.items.length > 0) {
        children = await this.processOutlineItems(pdfDoc, item.items);
      }

      results.push({
        id: 'bm_' + Math.random().toString(36).substring(2, 7),
        title: item.title || 'Başlıksız Bölüm',
        pageIndex,
        bold: item.bold,
        italic: item.italic,
        color: item.color ? `rgb(${item.color.join(',')})` : undefined,
        children,
      });
    }

    return results;
  }
}
