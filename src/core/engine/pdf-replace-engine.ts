import * as pdfjsLib from 'pdfjs-dist';
import {
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';
import { binaryStore } from '@/core/storage/binary-store';
import {
  embedPreferredFont,
  hexToPdfRgb,
  loadPdfLibSafe,
  sanitizeTextForFont,
  uint8ToArrayBuffer,
} from '@/core/pdf/pdf-helpers';

export interface TextMatchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  rects?: TextMatchRect[];
}

export interface FindReplaceOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  scope?: 'all' | 'current';
  currentPageIndex?: number;
}

export interface ApplyReplacementsOptions {
  mode?: 'replace' | 'redact';
  redactColor?: string;
}

interface IndexedSpan {
  raw: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
  width: number;
  fontHeight: number;
}

function escapePdfLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toAsciiHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += (str.charCodeAt(i) & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }
  return hex;
}

function stripLiteralTextFromPdfPageStreams(
  page: ReturnType<Awaited<ReturnType<typeof loadPdfLibSafe>>['getPages']>[number],
  termsToStrip: string[]
): void {
  const validTerms = termsToStrip.filter((t) => t && /^[\x20-\x7E]+$/.test(t));
  if (validTerms.length === 0) return;

  const rawContentsRef = page.node.get(PDFName.of('Contents'));
  const resolvedContents = page.node.lookup(PDFName.of('Contents'));
  if (!resolvedContents) return;

  const streamRefs: PDFRef[] = [];
  if (resolvedContents instanceof PDFRawStream && rawContentsRef instanceof PDFRef) {
    streamRefs.push(rawContentsRef);
  } else if (resolvedContents instanceof PDFArray) {
    for (let i = 0; i < resolvedContents.size(); i++) {
      const item = resolvedContents.get(i);
      if (item instanceof PDFRef) streamRefs.push(item);
    }
  }

  for (const ref of streamRefs) {
    try {
      const obj = page.doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;

      const decoded = decodePDFRawStream(obj).decode();
      let streamStr = new TextDecoder('latin1').decode(decoded);
      let modified = false;

      for (const term of validTerms) {
        // 1. Replace inside literal strings (...)
        const escaped = escapePdfLiteral(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const literalPattern = new RegExp(`\\(([^()\\\\]|\\\\.)*${escaped}([^()\\\\]|\\\\.)*\\)`, 'g');
        streamStr = streamStr.replace(literalPattern, (matchLiteral) => {
          const inner = matchLiteral.slice(1, -1);
          const replacedInner = inner.replace(
            new RegExp(escaped, 'g'),
            ' '.repeat(Math.min(term.length, 4))
          );
          if (replacedInner !== inner) {
            modified = true;
            return `(${replacedInner})`;
          }
          return matchLiteral;
        });

        // 2. Replace inside hex strings <...> (used by pdf-lib StandardFont/WinAnsi streams)
        const termHex = toAsciiHex(term);
        const spaceHex = '20'.repeat(term.length);
        streamStr = streamStr.replace(/<([0-9a-fA-F]+)>/g, (fullHex, hexBody: string) => {
          const upper = hexBody.toUpperCase();
          let idx = upper.indexOf(termHex);
          if (idx === -1) return fullHex;
          let updated = upper;
          while (idx !== -1) {
            if (idx % 2 === 0) {
              updated = updated.slice(0, idx) + spaceHex + updated.slice(idx + termHex.length);
              modified = true;
            }
            idx = updated.indexOf(termHex, idx + spaceHex.length);
          }
          return `<${updated}>`;
        });
      }

      if (modified) {
        const bytes = new Uint8Array(streamStr.length);
        for (let i = 0; i < streamStr.length; i++) {
          bytes[i] = streamStr.charCodeAt(i) & 0xff;
        }
        const flateStream = page.doc.context.flateStream(bytes);
        page.doc.context.assign(ref, flateStream);
      }
    } catch {
      // Leave custom-encoded streams untouched safely; visual opaque redaction box still covers the region
    }
  }
}

export class PdfReplaceEngine {
  /**
   * Searches for matching text occurrences across single or multiple text spans
   * and computes PDF-point bounding boxes.
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

    const startPage = scope === 'current' ? Math.max(1, currentPageIndex + 1) : 1;
    const endPage = scope === 'current' ? Math.min(pdfDoc.numPages, currentPageIndex + 1) : pdfDoc.numPages;

    let globalMatchIdx = 0;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const rawItems = textContent.items as Array<{
        str?: string;
        transform?: number[];
        width?: number;
        hasEOL?: boolean;
      }>;

      const spans: IndexedSpan[] = [];
      let fullPageText = '';
      let prevRawItem: (typeof rawItems)[number] | null = null;

      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        const rawStr = item?.str || '';
        if (!rawStr || !item.transform) continue;

        const transform = item.transform;
        const fontHeight = Math.hypot(transform[2], transform[3]) || 12;
        const itemWidth = item.width || fontHeight * rawStr.length * 0.6;

        if (fullPageText.length > 0 && spans.length > 0) {
          const prevSpan = spans[spans.length - 1];
          const prevEndsSpace = /\s$/.test(fullPageText);
          const curStartsSpace = /^\s/.test(rawStr);
          if (!prevEndsSpace && !curStartsSpace) {
            const yDiff = Math.abs(prevSpan.y - transform[5]);
            const xGap = transform[4] - (prevSpan.x + prevSpan.width);
            if ((prevRawItem?.hasEOL && yDiff > 2) || yDiff > fontHeight * 0.45 || xGap > fontHeight * 0.3) {
              fullPageText += ' ';
            }
          }
        }

        const startOffset = fullPageText.length;
        fullPageText += rawStr;
        spans.push({
          raw: rawStr,
          startOffset,
          endOffset: fullPageText.length,
          x: transform[4],
          y: transform[5],
          width: itemWidth,
          fontHeight,
        });
        prevRawItem = item;
      }

      if (!fullPageText) continue;

      const compareStr = matchCase ? fullPageText : fullPageText.toLocaleLowerCase('tr-TR');
      let pos = 0;

      while ((pos = compareStr.indexOf(searchStr, pos)) !== -1) {
        if (wholeWord) {
          const before = pos > 0 ? compareStr[pos - 1] : ' ';
          const after =
            pos + searchStr.length < compareStr.length
              ? compareStr[pos + searchStr.length]
              : ' ';
          const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
          if (isWordChar(before) || isWordChar(after)) {
            pos += searchStr.length;
            continue;
          }
        }

        const matchStart = pos;
        const matchEnd = pos + searchStr.length;
        const overlapping = spans.filter(
          (s) => s.endOffset > matchStart && s.startOffset < matchEnd
        );

        if (overlapping.length > 0) {
          const spanRects: TextMatchRect[] = overlapping.map((s) => {
            const localStart = Math.max(0, matchStart - s.startOffset);
            const localEnd = Math.min(s.raw.length, matchEnd - s.startOffset);
            const totalChars = Math.max(1, s.raw.length);
            const offsetX = (localStart / totalChars) * s.width;
            const rectWidth = Math.max(((localEnd - localStart) / totalChars) * s.width, 6);
            return {
              x: s.x + offsetX,
              y: s.y,
              width: rectWidth,
              height: s.fontHeight,
            };
          });

          // Merge rects on the same line (similar baseline y)
          const mergedRects: TextMatchRect[] = [];
          for (const r of spanRects) {
            const last = mergedRects[mergedRects.length - 1];
            if (last && Math.abs(last.y - r.y) <= Math.max(3, r.height * 0.4)) {
              const minX = Math.min(last.x, r.x);
              const maxX = Math.max(last.x + last.width, r.x + r.width);
              last.x = minX;
              last.width = maxX - minX;
              last.height = Math.max(last.height, r.height);
            } else {
              mergedRects.push({ ...r });
            }
          }

          const primary = mergedRects[0];
          const firstSpan = overlapping[0];
          results.push({
            id: `match_${pageNum}_${globalMatchIdx++}`,
            pageIndex: pageNum - 1,
            matchIndex: globalMatchIdx,
            matchedText: fullPageText.substring(matchStart, matchEnd),
            fullItemText:
              overlapping.length === 1 ? firstSpan.raw : fullPageText.substring(overlapping[0].startOffset, overlapping[overlapping.length - 1].endOffset),
            x: primary.x,
            y: primary.y,
            width: Math.max(primary.width, 6),
            height: primary.height,
            fontSize: primary.height,
            rects: mergedRects,
          });
        }

        pos += searchStr.length;
      }
    }

    return results;
  }

  /**
   * Applies replacements or permanent redactions to the PDF document.
   * Supports Unicode TTF font embedding (with safe WinAnsi fallback) and optional redaction mode.
   */
  public static async applyReplacements(
    docId: string,
    matchesToReplace: TextMatchItem[],
    replacementText: string,
    options: ApplyReplacementsOptions = {}
  ): Promise<ArrayBuffer> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('PDF döküman bellekte bulunamadı');

    const mode = options.mode ?? 'replace';
    const pdfDoc = await loadPdfLibSafe(
      rawBuffer,
      mode === 'redact' ? 'Metin karartma (Redaksiyon)' : 'Metin değiştirme'
    );

    const { font, isCustomFont } = await embedPreferredFont(pdfDoc, 'regular', true);
    const pages = pdfDoc.getPages();

    const matchesByPage = new Map<number, TextMatchItem[]>();
    for (const m of matchesToReplace) {
      if (!matchesByPage.has(m.pageIndex)) {
        matchesByPage.set(m.pageIndex, []);
      }
      matchesByPage.get(m.pageIndex)!.push(m);
    }

    const maskColor =
      mode === 'redact' ? hexToPdfRgb(options.redactColor || '#000000', rgb(0, 0, 0)) : rgb(1, 1, 1);

    for (const [pageIdx, pageMatches] of matchesByPage.entries()) {
      if (pageIdx < 0 || pageIdx >= pages.length) continue;
      const page = pages[pageIdx];

      if (mode === 'redact') {
        stripLiteralTextFromPdfPageStreams(
          page,
          pageMatches.map((m) => m.matchedText)
        );
      }

      for (const m of pageMatches) {
        const boxes = m.rects && m.rects.length > 0 ? m.rects : [{ x: m.x, y: m.y, width: m.width, height: m.height }];
        for (const box of boxes) {
          page.drawRectangle({
            x: Math.max(0, box.x - 1),
            y: Math.max(0, box.y - 2),
            width: box.width + 2,
            height: box.height + 4,
            color: maskColor,
          });
        }

        if (mode === 'replace' && replacementText && replacementText.length > 0) {
          const safeText = sanitizeTextForFont(replacementText, font, isCustomFont);
          page.drawText(safeText, {
            x: m.x,
            y: m.y,
            size: m.fontSize || m.height || 12,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
        }
      }
    }

    const modifiedBytes = await pdfDoc.save({ updateFieldAppearances: false });
    return uint8ToArrayBuffer(modifiedBytes);
  }
}
