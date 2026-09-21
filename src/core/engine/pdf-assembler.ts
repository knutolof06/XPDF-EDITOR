import { PDFDocument, degrees } from 'pdf-lib';
import { PdfDocumentModel } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';
import { ImagesToPdfConverter } from './images-to-pdf';

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

  private static async getValidBuffer(docModel: PdfDocumentModel): Promise<ArrayBuffer> {
    let raw = binaryStore.get(docModel.id);
    if (!raw || raw.byteLength === 0) {
      if (docModel.filePath && (window as any).electronAPI?.readFile) {
        try {
          const res = await (window as any).electronAPI.readFile(docModel.filePath);
          if (res && res.buffer) {
            const fresh = res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength);
            binaryStore.set(docModel.id, fresh.slice(0));
            raw = fresh;
          }
        } catch {}
      }
    }
    if (!raw || raw.byteLength === 0) {
      throw new Error('Döküman verisi bulunamadı veya bellekten boşaltıldı.');
    }
    return raw.slice(0);
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
    const targetBuffer = await this.getValidBuffer(targetDocModel);

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
    const rawBuffer = await this.getValidBuffer(docModel);

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
    const rawBuffer = await this.getValidBuffer(docModel);

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

  /**
   * Extracts specified pages from a document.
   * Can return a single combined PDF or separate individual PDFs.
   * Accurately preserves user rotation for each page.
   */
  public static async extractPages(
    docModel: PdfDocumentModel,
    pageIds: string[],
    options: {
      separateFiles?: boolean;
      customBaseName?: string;
    } = {}
  ): Promise<
    | { mode: 'single'; name: string; buffer: ArrayBuffer; pageCount: number }
    | { mode: 'separate'; files: { name: string; buffer: ArrayBuffer; pageNumber: number }[] }
  > {
    const validBuffer = await this.getValidBuffer(docModel);
    const srcDoc = await PDFDocument.load(validBuffer);
    const baseName = options.customBaseName || docModel.name.replace(/\.pdf$/i, '');

    // Map page IDs to page models in order
    const pagesToExtract = pageIds
      .map((id) => docModel.pages.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    if (pagesToExtract.length === 0) {
      throw new Error('Ayıklanacak geçerli sayfa bulunamadı.');
    }

    if (options.separateFiles) {
      const separateResults: { name: string; buffer: ArrayBuffer; pageNumber: number }[] = [];

      for (let i = 0; i < pagesToExtract.length; i++) {
        const page = pagesToExtract[i];
        const singleDoc = await PDFDocument.create();
        const [copiedPage] = await singleDoc.copyPages(srcDoc, [page.sourcePageIndex]);

        const currentRot = copiedPage.getRotation().angle || 0;
        const finalRot = (currentRot + (page.rotation || 0)) % 360;
        copiedPage.setRotation(degrees(finalRot));
        singleDoc.addPage(copiedPage);

        const bytes = await singleDoc.save();
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        const fileName = `${baseName}_sayfa_${page.displayPageNumber}.pdf`;
        separateResults.push({
          name: fileName,
          buffer,
          pageNumber: page.displayPageNumber,
        });
      }

      return { mode: 'separate', files: separateResults };
    } else {
      const combinedDoc = await PDFDocument.create();
      const indices = pagesToExtract.map((p) => p.sourcePageIndex);
      const copiedPages = await combinedDoc.copyPages(srcDoc, indices);

      for (let i = 0; i < copiedPages.length; i++) {
        const cp = copiedPages[i];
        const page = pagesToExtract[i];
        const currentRot = cp.getRotation().angle || 0;
        const finalRot = (currentRot + (page.rotation || 0)) % 360;
        cp.setRotation(degrees(finalRot));
        combinedDoc.addPage(cp);
      }

      const bytes = await combinedDoc.save();
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      const fileName =
        pagesToExtract.length === 1
          ? `${baseName}_sayfa_${pagesToExtract[0].displayPageNumber}.pdf`
          : `${baseName}_${pagesToExtract.length}_sayfa.pdf`;

      return {
        mode: 'single',
        name: fileName,
        buffer,
        pageCount: pagesToExtract.length,
      };
    }
  }

  /**
   * Processes a list of external files (PDFs and/or images) dropped or selected by the user,
   * converting images to valid PDF buffers and reading PDF buffers.
   */
  public static async processDroppedFiles(
    files: File[]
  ): Promise<{ buffer: ArrayBuffer; pageCount: number; name: string }[]> {
    const results: { buffer: ArrayBuffer; pageCount: number; name: string }[] = [];
    const imageFiles: File[] = [];

    for (const file of files) {
      const name = file.name.toLowerCase();
      const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
      const isImage =
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(name);

      if (isPdf) {
        try {
          const buffer = await file.arrayBuffer();
          const doc = await PDFDocument.load(buffer);
          results.push({
            buffer,
            pageCount: doc.getPageCount(),
            name: file.name,
          });
        } catch (e) {
          console.error('PDF yükleme hatası:', file.name, e);
        }
      } else if (isImage) {
        imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      try {
        const imageItems = imageFiles.map((file) => ({
          id: Math.random().toString(36).substring(2, 9),
          file,
          previewUrl: '',
          width: 0,
          height: 0,
        }));
        const imgPdfBuffer = await ImagesToPdfConverter.convertImagesToPdf(
          imageItems,
          { pageSize: 'original', orientation: 'auto', margin: 0 }
        );
        const doc = await PDFDocument.load(imgPdfBuffer);
        results.push({
          buffer: imgPdfBuffer,
          pageCount: doc.getPageCount(),
          name:
            imageFiles.length === 1
              ? imageFiles[0].name.replace(/\.[^/.]+$/, '') + '.pdf'
              : 'Görseller.pdf',
        });
      } catch (e) {
        console.error('Görseller PDF formatına dönüştürülürken hata oluştu:', e);
      }
    }

    return results;
  }
}
