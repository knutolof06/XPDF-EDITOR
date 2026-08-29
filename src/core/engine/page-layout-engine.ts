import { PDFDocument, rgb } from 'pdf-lib';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';

export interface LayoutSlot {
  sourceDocId: string;
  sourcePageIndex: number;
  rotation?: number;
}

export interface SynthesisOptions {
  layout: '2-up' | '4-up' | '6-up' | '8-up' | 'grid';
  pageSize: 'A4' | 'A3' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margin: number; // in points
  spacing: number; // in points
  drawBorder: boolean;
  headerText?: string;
}

export class PageLayoutEngine {
  /**
   * Synthesizes multiple selected PDF pages into a single newly assembled PDF page
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

    // Page dimensions (points)
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
      const temp = pageWidth;
      pageWidth = pageHeight;
      pageHeight = temp;
    }

    const newPage = outDoc.addPage([pageWidth, pageHeight]);

    // Grid row and col count
    let cols = 1;
    let rows = 2;

    if (options.layout === '2-up') {
      cols = options.orientation === 'landscape' ? 2 : 1;
      rows = options.orientation === 'landscape' ? 1 : 2;
    } else if (options.layout === '4-up') {
      cols = 2;
      rows = 2;
    } else if (options.layout === '6-up') {
      cols = options.orientation === 'landscape' ? 3 : 2;
      rows = options.orientation === 'landscape' ? 2 : 3;
    } else if (options.layout === '8-up') {
      cols = options.orientation === 'landscape' ? 4 : 2;
      rows = options.orientation === 'landscape' ? 2 : 4;
    }

    const margin = options.margin || 20;
    const spacing = options.spacing || 15;

    const availableWidth = pageWidth - margin * 2 - (cols - 1) * spacing;
    const availableHeight = pageHeight - margin * 2 - (rows - 1) * spacing;

    const cellWidth = availableWidth / cols;
    const cellHeight = availableHeight / rows;

    // Cache loaded source documents
    const docCache = new Map<string, PDFDocument>();

    for (let i = 0; i < slots.length && i < cols * rows; i++) {
      const slot = slots[i];
      let srcDoc = docCache.get(slot.sourceDocId);

      if (!srcDoc) {
        const rawBuffer = binaryStore.get(slot.sourceDocId);
        if (!rawBuffer) continue;
        // Always pass a sliced clone to avoid detaching source buffer
        srcDoc = await PDFDocument.load(rawBuffer.slice(0));
        docCache.set(slot.sourceDocId, srcDoc);
      }

      // Embed the source page
      const [embeddedPage] = await outDoc.embedPdf(srcDoc, [slot.sourcePageIndex]);

      const col = i % cols;
      const row = Math.floor(i / cols);

      // Cell bounds
      const cellX = margin + col * (cellWidth + spacing);
      // PDF y-coordinates start from bottom
      const cellY = pageHeight - margin - (row + 1) * cellHeight - row * spacing;

      // Fit embedded page inside cell maintaining aspect ratio
      const scale = Math.min(
        cellWidth / embeddedPage.width,
        cellHeight / embeddedPage.height
      );

      const drawWidth = embeddedPage.width * scale;
      const drawHeight = embeddedPage.height * scale;

      // Center in cell
      const drawX = cellX + (cellWidth - drawWidth) / 2;
      const drawY = cellY + (cellHeight - drawHeight) / 2;

      // Optional cell border
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

      newPage.drawPage(embeddedPage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
    }

    const pdfBytes = await outDoc.save();
    const rawBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(
      `${docName.replace(/\.pdf$/i, '')}_birlestirilmis_sayfa.pdf`,
      rawBuffer
    );
  }
}
