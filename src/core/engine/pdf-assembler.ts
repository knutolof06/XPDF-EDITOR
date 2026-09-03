import { PDFDocument } from 'pdf-lib';
import { PdfDocumentModel } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';

export class PdfAssembler {
  /**
   * Merges multiple PDF ArrayBuffers in given order into a single PDF
   */
  public static async mergePdfs(
    files: { name: string; buffer: ArrayBuffer }[]
  ): Promise<{ name: string; buffer: ArrayBuffer }> {
    if (files.length === 0) {
      throw new Error('Birleştirilecek döküman bulunamadı.');
    }

    const mergedDoc = await PDFDocument.create();

    for (const file of files) {
      const srcDoc = await PDFDocument.load(file.buffer);
      const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    }

    const mergedBytes = await mergedDoc.save();
    const rawBuffer = mergedBytes.buffer.slice(
      mergedBytes.byteOffset,
      mergedBytes.byteOffset + mergedBytes.byteLength
    ) as ArrayBuffer;

    const outName =
      files.length > 1
        ? `${files[0].name.replace(/\.pdf$/i, '')}_ve_${files.length - 1}_diger_birlestirildi.pdf`
        : files[0].name;

    return { name: outName, buffer: rawBuffer };
  }

  /**
   * Splits a PDF into multiple distinct PDF files by page ranges
   */
  public static async splitPdf(
    sourceBuffer: ArrayBuffer,
    baseName: string,
    ranges: { from: number; to: number; label?: string }[]
  ): Promise<{ name: string; buffer: ArrayBuffer }[]> {
    const srcDoc = await PDFDocument.load(sourceBuffer);
    const totalPages = srcDoc.getPageCount();
    const results: { name: string; buffer: ArrayBuffer }[] = [];

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const from = Math.max(1, Math.min(range.from, totalPages));
      const to = Math.max(from, Math.min(range.to, totalPages));

      const pageIndices: number[] = [];
      for (let p = from - 1; p < to; p++) {
        pageIndices.push(p);
      }

      if (pageIndices.length === 0) continue;

      const subDoc = await PDFDocument.create();
      const copied = await subDoc.copyPages(srcDoc, pageIndices);
      copied.forEach((cp) => subDoc.addPage(cp));

      const bytes = await subDoc.save();
      const subBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      const rangeLabel = range.label || `Sayfa_${from}-${to}`;
      const subName = `${baseName.replace(/\.pdf$/i, '')}_${rangeLabel}.pdf`;

      results.push({ name: subName, buffer: subBuffer });
    }

    return results;
  }

  /**
   * Inserts selected pages from an incoming PDF into an existing loaded document
   */
  public static async insertPagesIntoDocument(
    targetDocModel: PdfDocumentModel,
    sourceBuffer: ArrayBuffer,
    sourcePageIndices: number[], // 0-based
    insertAtIndex: number // index in logical pages array
  ): Promise<LoadedPdfResult> {
    const targetBuffer = binaryStore.get(targetDocModel.id);
    if (!targetBuffer) {
      throw new Error('Hedef döküman verisi bulunamadı.');
    }

    const targetPdfLib = await PDFDocument.load(targetBuffer);
    const sourcePdfLib = await PDFDocument.load(sourceBuffer);

    // Copy selected pages from source
    const copiedPages = await targetPdfLib.copyPages(sourcePdfLib, sourcePageIndices);

    // If insertAtIndex is out of bounds, push at end
    const safeIndex = Math.max(0, Math.min(insertAtIndex, targetPdfLib.getPageCount()));

    copiedPages.forEach((cp, idx) => {
      targetPdfLib.insertPage(safeIndex + idx, cp);
    });

    const updatedBytes = await targetPdfLib.save();
    const updatedBuffer = updatedBytes.buffer.slice(
      updatedBytes.byteOffset,
      updatedBytes.byteOffset + updatedBytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(targetDocModel.name, updatedBuffer);
  }

  /**
   * Duplicates selected pages in the active document
   */
  public static async duplicatePages(
    docModel: PdfDocumentModel,
    pageIds: string[]
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docModel.id);
    if (!rawBuffer) throw new Error('Döküman bulunamadı.');

    const pdfLibDoc = await PDFDocument.load(rawBuffer);
    const pagesToDup = docModel.pages.filter((p) => pageIds.includes(p.id));

    for (const p of pagesToDup) {
      const [copied] = await pdfLibDoc.copyPages(pdfLibDoc, [p.sourcePageIndex]);
      pdfLibDoc.insertPage(p.sourcePageIndex + 1, copied);
    }

    const bytes = await pdfLibDoc.save();
    const updatedBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(docModel.name, updatedBuffer);
  }

  /**
   * Inserts a clean blank page (A4, Letter or matching current page) at the specified index
   */
  public static async insertBlankPage(
    docModel: PdfDocumentModel,
    insertAtIndex: number,
    pageSize: 'a4' | 'letter' | 'match' = 'a4',
    orientation: 'portrait' | 'landscape' = 'portrait',
    count: number = 1
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docModel.id);
    if (!rawBuffer) throw new Error('Döküman bulunamadı.');

    const pdfLibDoc = await PDFDocument.load(rawBuffer);

    let width = 595.28; // Standard A4 in points
    let height = 841.89;

    if (pageSize === 'letter') {
      width = 612.0;
      height = 792.0;
    } else if (pageSize === 'match' && pdfLibDoc.getPageCount() > 0) {
      const refIdx = Math.max(0, Math.min(insertAtIndex, pdfLibDoc.getPageCount() - 1));
      const refPage = pdfLibDoc.getPage(refIdx);
      width = refPage.getWidth();
      height = refPage.getHeight();
    }

    if (orientation === 'landscape' && width < height) {
      const tmp = width;
      width = height;
      height = tmp;
    } else if (orientation === 'portrait' && width > height) {
      const tmp = width;
      width = height;
      height = tmp;
    }

    const safeIndex = Math.max(0, Math.min(insertAtIndex, pdfLibDoc.getPageCount()));
    for (let c = 0; c < count; c++) {
      pdfLibDoc.insertPage(safeIndex + c, [width, height]);
    }

    const bytes = await pdfLibDoc.save();
    const updatedBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(docModel.name, updatedBuffer);
  }
}
