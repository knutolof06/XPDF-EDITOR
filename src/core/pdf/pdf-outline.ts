import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { BookmarkItem } from '@/types/advanced';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from './pdf-loader';
import { loadPdfLibSafe, uint8ToArrayBuffer, hexToRgbValues } from './pdf-helpers';
import { useDocumentStore } from '@/store/document-store';
import { clearDocumentCaches } from '@/core/cache/render-cache';

export interface BookmarkOutlineItem extends BookmarkItem {
  url?: string;
}

interface RawOutlineNode {
  title?: string;
  dest?: unknown;
  url?: string;
  unsafeUrl?: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray | number[];
  items?: RawOutlineNode[];
}

function buildDeterministicId(path: number[], title: string): string {
  const slug = (title || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9çğıöşü]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  return `bm_${path.join('_')}${slug ? `_${slug}` : ''}`;
}

export class PdfOutlineExtractor {
  /**
   * Extracts bookmarks/outlines tree from PDF.js document proxy with deterministic IDs
   * and external URI link preservation.
   */
  public static async extractOutline(
    pdfDoc: pdfjsLib.PDFDocumentProxy
  ): Promise<BookmarkOutlineItem[]> {
    try {
      const outline = (await pdfDoc.getOutline()) as RawOutlineNode[] | null;
      if (!outline || outline.length === 0) {
        return [];
      }

      return await this.processOutlineItems(pdfDoc, outline, []);
    } catch (err) {
      console.error('Outline extraction error:', err);
      return [];
    }
  }

  private static async processOutlineItems(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    items: RawOutlineNode[],
    parentPath: number[]
  ): Promise<BookmarkOutlineItem[]> {
    const results: BookmarkOutlineItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const currentPath = [...parentPath, i];
      let pageIndex = 0;

      if (item.dest) {
        try {
          if (typeof item.dest === 'string') {
            const destObj = await pdfDoc.getDestination(item.dest);
            if (destObj && destObj.length > 0) {
              const pageRef = destObj[0];
              const idx = await pdfDoc.getPageIndex(pageRef as Parameters<typeof pdfDoc.getPageIndex>[0]);
              pageIndex = idx >= 0 ? idx : 0;
            }
          } else if (Array.isArray(item.dest) && item.dest.length > 0) {
            const pageRef = item.dest[0];
            const idx = await pdfDoc.getPageIndex(pageRef as Parameters<typeof pdfDoc.getPageIndex>[0]);
            pageIndex = idx >= 0 ? idx : 0;
          }
        } catch {
          pageIndex = 0;
        }
      }

      const resolvedUrl = item.url || item.unsafeUrl || undefined;

      let children: BookmarkOutlineItem[] | undefined;
      if (item.items && item.items.length > 0) {
        children = await this.processOutlineItems(pdfDoc, item.items, currentPath);
      }

      const title = item.title || 'Başlıksız Bölüm';
      results.push({
        id: buildDeterministicId(currentPath, title),
        title,
        pageIndex,
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        color: item.color ? `rgb(${Array.from(item.color).join(',')})` : undefined,
        dest: item.dest ?? (resolvedUrl ? { url: resolvedUrl } : undefined),
        url: resolvedUrl,
        children,
      });
    }

    return results;
  }
}

const modifiedOutlinesByDoc = new Map<string, BookmarkOutlineItem[]>();

function countVisibleDescendants(item: BookmarkOutlineItem): number {
  if (!item.children || item.children.length === 0 || item.expanded === false) {
    return 0;
  }
  let count = 0;
  for (const child of item.children) {
    count += 1 + countVisibleDescendants(child);
  }
  return count;
}

function parseColorString(color?: string): [number, number, number] | null {
  if (!color) return null;
  if (color.startsWith('#')) {
    const rgbVals = hexToRgbValues(color);
    return [rgbVals.r, rgbVals.g, rgbVals.b];
  }
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return [
      Math.min(1, parseInt(rgbMatch[1], 10) / 255),
      Math.min(1, parseInt(rgbMatch[2], 10) / 255),
      Math.min(1, parseInt(rgbMatch[3], 10) / 255),
    ];
  }
  return null;
}

function getExternalUrlFromBookmark(item: BookmarkOutlineItem): string | undefined {
  if (item.url) return item.url;
  if (item.dest && typeof item.dest === 'object' && !Array.isArray(item.dest)) {
    const url = (item.dest as { url?: unknown }).url;
    if (typeof url === 'string' && url.length > 0) return url;
  }
  return undefined;
}

export class PdfOutlineWriter {
  public static setModifiedOutline(docId: string, items: BookmarkOutlineItem[]): void {
    modifiedOutlinesByDoc.set(docId, items);
  }

  public static getModifiedOutline(docId: string): BookmarkOutlineItem[] | undefined {
    return modifiedOutlinesByDoc.get(docId);
  }

  public static clearModifiedOutline(docId: string): void {
    modifiedOutlinesByDoc.delete(docId);
  }

  /**
   * Writes a complete PDF /Outlines tree directly into a pdf-lib PDFDocument.
   */
  public static writeOutline(pdfDoc: PDFDocument, items: BookmarkOutlineItem[]): void {
    if (!items || items.length === 0) {
      pdfDoc.catalog.delete(PDFName.of('Outlines'));
      return;
    }

    const pages = pdfDoc.getPages();
    const context = pdfDoc.context;

    const rootDict = context.obj({
      Type: 'Outlines',
    });
    const rootRef = context.register(rootDict);

    const buildLevel = (
      levelItems: BookmarkOutlineItem[],
      parentRef: PDFRef
    ): { firstRef: PDFRef; lastRef: PDFRef; visibleCount: number } | null => {
      if (levelItems.length === 0) return null;

      const refs: PDFRef[] = [];
      const dicts: PDFDict[] = [];

      for (let i = 0; i < levelItems.length; i++) {
        const dict = context.obj({});
        const ref = context.register(dict);
        dicts.push(dict);
        refs.push(ref);
      }

      let visibleTotal = 0;

      for (let i = 0; i < levelItems.length; i++) {
        const item = levelItems[i];
        const dict = dicts[i];
        const ref = refs[i];

        dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title || 'Başlıksız'));
        dict.set(PDFName.of('Parent'), parentRef);

        if (i > 0) {
          dict.set(PDFName.of('Prev'), refs[i - 1]);
        }
        if (i < refs.length - 1) {
          dict.set(PDFName.of('Next'), refs[i + 1]);
        }

        const externalUrl = getExternalUrlFromBookmark(item);
        if (externalUrl) {
          const actionDict = context.obj({
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(externalUrl),
          });
          dict.set(PDFName.of('A'), actionDict);
        } else if (pages.length > 0) {
          const safeIdx = Math.max(0, Math.min(item.pageIndex || 0, pages.length - 1));
          const destArr = PDFArray.withContext(context);
          destArr.push(pages[safeIdx].ref);
          destArr.push(PDFName.of('Fit'));
          dict.set(PDFName.of('Dest'), destArr);
        }

        const flags = (item.italic ? 1 : 0) | (item.bold ? 2 : 0);
        if (flags !== 0) {
          dict.set(PDFName.of('F'), PDFNumber.of(flags));
        }

        const parsedColor = parseColorString(item.color);
        if (parsedColor) {
          const cArr = PDFArray.withContext(context);
          cArr.push(PDFNumber.of(parsedColor[0]));
          cArr.push(PDFNumber.of(parsedColor[1]));
          cArr.push(PDFNumber.of(parsedColor[2]));
          dict.set(PDFName.of('C'), cArr);
        }

        visibleTotal += 1;

        if (item.children && item.children.length > 0) {
          const childInfo = buildLevel(item.children, ref);
          if (childInfo) {
            dict.set(PDFName.of('First'), childInfo.firstRef);
            dict.set(PDFName.of('Last'), childInfo.lastRef);
            const isExpanded = item.expanded !== false;
            const totalDescendants = item.children.reduce(
              (acc, ch) => acc + 1 + countVisibleDescendants(ch),
              0
            );
            dict.set(
              PDFName.of('Count'),
              PDFNumber.of(isExpanded ? childInfo.visibleCount : -totalDescendants)
            );
            if (isExpanded) {
              visibleTotal += childInfo.visibleCount;
            }
          }
        }
      }

      return {
        firstRef: refs[0],
        lastRef: refs[refs.length - 1],
        visibleCount: visibleTotal,
      };
    };

    const topLevel = buildLevel(items, rootRef);
    if (topLevel) {
      rootDict.set(PDFName.of('First'), topLevel.firstRef);
      rootDict.set(PDFName.of('Last'), topLevel.lastRef);
      rootDict.set(PDFName.of('Count'), PDFNumber.of(topLevel.visibleCount));
      pdfDoc.catalog.set(PDFName.of('Outlines'), rootRef);
    } else {
      pdfDoc.catalog.delete(PDFName.of('Outlines'));
    }
  }

  /**
   * Updates the PDF document's /Outlines in-memory and returns a refreshed LoadedPdfResult.
   */
  public static async updateOutline(
    docId: string,
    docName: string,
    items: BookmarkOutlineItem[]
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'İçindekiler (yer imi) güncelleme');
    this.writeOutline(pdfDoc, items);
    this.setModifiedOutline(docId, items);

    const bytes = await pdfDoc.save({ updateFieldAppearances: false });
    const outBuffer = uint8ToArrayBuffer(bytes);
    const currentDoc = useDocumentStore.getState().currentDocument;

    clearDocumentCaches(docId);
    const loaded = await PdfLoader.loadDocument(
      docName,
      outBuffer,
      currentDoc?.id === docId ? currentDoc.filePath : undefined,
      undefined,
      { preserveDocId: docId }
    );
    loaded.model.isModified = true;
    return loaded;
  }
}
