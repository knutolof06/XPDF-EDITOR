import * as pdfjsLib from 'pdfjs-dist';
import { SearchMatch } from '@/types/viewer';

interface SpanSegment {
  raw: string;
  startOffset: number;
  endOffset: number;
}

export class PdfSearchEngine {
  /**
   * Searches for a given query across all pages in the PDF document.
   * Uses tr-TR locale-aware case folding and supports BOTH single-span
   * and cross-span phrase matches while keeping per-page matchIndex aligned.
   */
  public static async search(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    query: string,
    matchCase: boolean = false
  ): Promise<SearchMatch[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmed = matchCase ? query : query.toLocaleLowerCase('tr-TR');
    const results: SearchMatch[] = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{
        str?: string;
        hasEOL?: boolean;
        transform?: number[];
        width?: number;
      }>;

      // Build concatenated page text + span boundary map for cross-span search
      const segments: SpanSegment[] = [];
      let fullText = '';
      let prevNonEmptyItem: (typeof items)[number] | null = null;

      for (let i = 0; i < items.length; i++) {
        const raw = items[i]?.str || '';
        if (!raw) continue;

        if (fullText.length > 0 && prevNonEmptyItem) {
          const prevEndsSpace = /\s$/.test(fullText);
          const curStartsSpace = /^\s/.test(raw);
          if (!prevEndsSpace && !curStartsSpace) {
            let needSpace = false;
            if (prevNonEmptyItem.transform && items[i]?.transform) {
              const prevEndX = prevNonEmptyItem.transform[4] + (prevNonEmptyItem.width || 0);
              const curStartX = items[i].transform![4];
              const yDiff = Math.abs(prevNonEmptyItem.transform[5] - items[i].transform![5]);
              const fontH = Math.hypot(items[i].transform![2], items[i].transform![3]) || 10;
              if (yDiff > fontH * 0.45 || curStartX - prevEndX > fontH * 0.3 || (prevNonEmptyItem.hasEOL && yDiff > 2)) {
                needSpace = true;
              }
            } else if (prevNonEmptyItem.hasEOL) {
              needSpace = true;
            }
            if (needSpace) {
              fullText += ' ';
            }
          }
        }

        const startOffset = fullText.length;
        fullText += raw;
        segments.push({
          raw,
          startOffset,
          endOffset: fullText.length,
        });
        prevNonEmptyItem = items[i];
      }

      if (!fullText) continue;

      // First count single-span matches in order so PageView single-span highlight indices stay exact
      const matchedRanges: Array<{ start: number; end: number; matchIndex: number; snippet: string }> = [];
      let matchIdx = 0;

      for (const seg of segments) {
        const spanText = matchCase ? seg.raw : seg.raw.toLocaleLowerCase('tr-TR');
        let pos = 0;
        while ((pos = spanText.indexOf(trimmed, pos)) !== -1) {
          const globalStart = seg.startOffset + pos;
          const globalEnd = globalStart + trimmed.length;
          const startSnippet = Math.max(0, pos - 20);
          const endSnippet = Math.min(seg.raw.length, pos + trimmed.length + 20);
          matchedRanges.push({
            start: globalStart,
            end: globalEnd,
            matchIndex: matchIdx,
            snippet: seg.raw.substring(startSnippet, endSnippet),
          });
          matchIdx++;
          pos += trimmed.length;
        }
      }

      // Also scan fullText for cross-span matches that didn't already occur within a single span
      const compareFull = matchCase ? fullText : fullText.toLocaleLowerCase('tr-TR');
      let crossPos = 0;
      const crossMatches: Array<{ start: number; end: number; snippet: string }> = [];

      while ((crossPos = compareFull.indexOf(trimmed, crossPos)) !== -1) {
        const end = crossPos + trimmed.length;
        const alreadySingleSpan = matchedRanges.some(
          (r) => crossPos >= r.start && end <= r.end
        );
        if (!alreadySingleSpan) {
          const startSnippet = Math.max(0, crossPos - 20);
          const endSnippet = Math.min(fullText.length, end + 20);
          crossMatches.push({
            start: crossPos,
            end,
            snippet: fullText.substring(startSnippet, endSnippet),
          });
        }
        crossPos += trimmed.length;
      }

      // Emit single-span matches first (preserving matchIdx 0..N-1 for PageView spans), then cross-span matches
      for (const m of matchedRanges) {
        results.push({
          pageIndex: pageNum - 1,
          matchIndex: m.matchIndex,
          text: m.snippet,
        });
      }
      for (const cm of crossMatches) {
        results.push({
          pageIndex: pageNum - 1,
          matchIndex: matchIdx++,
          text: cm.snippet,
        });
      }
    }

    return results;
  }
}
