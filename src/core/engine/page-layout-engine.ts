import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';
import {
  embedPreferredFont,
  loadPdfLibSafe,
  sanitizeTextForFont,
  uint8ToArrayBuffer,
} from '../pdf/pdf-helpers';

export interface LayoutSlot {
  sourceDocId: string;
  sourcePageIndex: number;
  rotation?: number;
}

export interface SynthesisOptions {
  layout: '2-up' | '4-up' | '6-up' | '8-up' | 'grid';
  pageSize: 'A4' | 'A3' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margin: number; // in points (0 allowed!)
  spacing: number; // in points (0 allowed!)
  drawBorder: boolean;
  headerText?: string;
  gridCols?: number;
  gridRows?: number;
}

function normalizeAngle(angle: number | undefined): number {
  return (((angle || 0) % 360) + 360) % 360;
}

function resolveGridDimensions(
  options: SynthesisOptions,
  slotCount: number
): { cols: number; rows: number } {
  if (options.layout === '2-up') {
    return options.orientation === 'landscape'
      ? { cols: 2, rows: 1 }
      : { cols: 1, rows: 2 };
  }
  if (options.layout === '4-up') {
    return { cols: 2, rows: 2 };
  }
  if (options.layout === '6-up') {
    return options.orientation === 'landscape'
      ? { cols: 3, rows: 2 }
      : { cols: 2, rows: 3 };
  }
  if (options.layout === '8-up') {
    return options.orientation === 'landscape'
      ? { cols: 4, rows: 2 }
      : { cols: 2, rows: 4 };
  }

  // 'grid' layout: use explicit gridCols/gridRows if given, else compute balanced grid
  if (options.gridCols && options.gridRows) {
    return {
      cols: Math.max(1, options.gridCols),
      rows: Math.max(1, options.gridRows),
    };
  }
  const capped = Math.max(1, Math.min(slotCount, 16));
  if (options.orientation === 'landscape') {
    const cols = Math.ceil(Math.sqrt(capped));
    const rows = Math.ceil(capped / cols);
    return { cols, rows };
  }
  const cols = Math.max(1, Math.floor(Math.sqrt(capped)));
  const rows = Math.ceil(capped / cols);
  return { cols, rows };
}

export class PageLayoutEngine {
  /**
   * Synthesizes selected PDF pages onto one or more multi-up / grid output pages.
   * Honors 0 margins/spacing, grid layout, multi-page overflow splitting, headerText, and slot rotations.
   */
  public static async synthesizeSinglePage(
    slots: LayoutSlot[],
    options: SynthesisOptions,
    docName: string
  ): Promise<LoadedPdfResult> {
    if (slots.length === 0) {
      throw new Error('Birleştirilecek sayfa seçilmedi.');
    }

    const outDoc = await PDFDocument.create();

    let pageWidth = 595.28; // A4 Portrait
    let pageHeight = 841.89;

    if (options.pageSize === 'A3') {
      pageWidth = 841.89;
      pageHeight = 1190.55;
    } else if (options.pageSize === 'Letter') {
      pageWidth = 612;
      pageHeight = 792;
    }

    if (options.orientation === 'landscape') {
      [pageWidth, pageHeight] = [pageHeight, pageWidth];
    }

    const { cols, rows } = resolveGridDimensions(options, slots.length);
    const perPage = cols * rows;

    const margin = options.margin ?? 20;
    const spacing = options.spacing ?? 15;
    const headerReserve = options.headerText && options.headerText.trim().length > 0 ? 22 : 0;

    const availableWidth = Math.max(20, pageWidth - margin * 2 - (cols - 1) * spacing);
    const availableHeight = Math.max(
      20,
      pageHeight - margin * 2 - headerReserve - (rows - 1) * spacing
    );

    const cellWidth = availableWidth / cols;
    const cellHeight = availableHeight / rows;

    const { font: headerFont, isCustomFont } =
      headerReserve > 0
        ? await embedPreferredFont(outDoc, 'bold', true)
        : { font: null, isCustomFont: false };

    const docCache = new Map<string, PDFDocument>();

    for (let pageStart = 0; pageStart < slots.length; pageStart += perPage) {
      const chunk = slots.slice(pageStart, pageStart + perPage);
      const newPage = outDoc.addPage([pageWidth, pageHeight]);

      if (headerReserve > 0 && headerFont && options.headerText) {
        const safeHeader = sanitizeTextForFont(options.headerText.trim(), headerFont, isCustomFont);
        const headerFontSize = 11;
        let textW = safeHeader.length * headerFontSize * 0.5;
        try {
          textW = headerFont.widthOfTextAtSize(safeHeader, headerFontSize);
        } catch {
          // fallback
        }
        newPage.drawText(safeHeader, {
          x: Math.max(margin, (pageWidth - textW) / 2),
          y: pageHeight - margin - 14,
          size: headerFontSize,
          font: headerFont,
          color: rgb(0.2, 0.25, 0.35),
        });
      }

      for (let i = 0; i < chunk.length; i++) {
        const slot = chunk[i];
        let srcDoc = docCache.get(slot.sourceDocId);

        if (!srcDoc) {
          const rawBuffer = binaryStore.get(slot.sourceDocId);
          if (!rawBuffer) continue;
          srcDoc = await loadPdfLibSafe(rawBuffer.slice(0), 'Sayfa mizanpajı');
          docCache.set(slot.sourceDocId, srcDoc);
        }

        if (slot.sourcePageIndex < 0 || slot.sourcePageIndex >= srcDoc.getPageCount()) {
          continue;
        }

        const [embeddedPage] = await outDoc.embedPdf(srcDoc, [slot.sourcePageIndex]);

        const col = i % cols;
        const row = Math.floor(i / cols);

        const cellX = margin + col * (cellWidth + spacing);
        const cellY =
          pageHeight - margin - headerReserve - (row + 1) * cellHeight - row * spacing;

        const rot = normalizeAngle(slot.rotation);
        const effW = rot === 90 || rot === 270 ? embeddedPage.height : embeddedPage.width;
        const effH = rot === 90 || rot === 270 ? embeddedPage.width : embeddedPage.height;

        const scale = Math.min(cellWidth / effW, cellHeight / effH);
        const drawWidth = embeddedPage.width * scale;
        const drawHeight = embeddedPage.height * scale;
        const visW = effW * scale;
        const visH = effH * scale;

        const boxX = cellX + (cellWidth - visW) / 2;
        const boxY = cellY + (cellHeight - visH) / 2;

        if (options.drawBorder) {
          newPage.drawRectangle({
            x: cellX,
            y: cellY,
            width: cellWidth,
            height: cellHeight,
            borderColor: rgb(0.8, 0.85, 0.9),
            borderWidth: 0.75,
          });
        }

        // Convert clockwise slot rotation into pdf-lib counter-clockwise coordinates
        let drawX = boxX;
        let drawY = boxY;
        let pdfRotate = 0;
        if (rot === 90) {
          drawX = boxX;
          drawY = boxY + drawWidth;
          pdfRotate = -90;
        } else if (rot === 180) {
          drawX = boxX + drawWidth;
          drawY = boxY + drawHeight;
          pdfRotate = 180;
        } else if (rot === 270) {
          drawX = boxX + drawHeight;
          drawY = boxY;
          pdfRotate = 90;
        }

        newPage.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
          ...(pdfRotate !== 0 ? { rotate: degrees(pdfRotate) } : {}),
        });
      }
    }

    const pdfBytes = await outDoc.save();
    const rawBuffer = uint8ToArrayBuffer(pdfBytes);

    return await PdfLoader.loadDocument(
      `${docName.replace(/\.pdf$/i, '')}_birlestirilmis_sayfa.pdf`,
      rawBuffer
    );
  }

  public static async synthesizeMultiPage(
    slots: LayoutSlot[],
    options: SynthesisOptions,
    docName: string
  ): Promise<LoadedPdfResult> {
    return await this.synthesizeSinglePage(slots, options, docName);
  }
}
