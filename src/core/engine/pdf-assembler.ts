import { PDFDocument, PDFPage, degrees } from 'pdf-lib';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';
import { ImagesToPdfConverter } from './images-to-pdf';
import { loadPdfLibSafe, uint8ToArrayBuffer, isPdfEncryptedError } from '../pdf/pdf-helpers';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { useNativeObjectStore } from '@/store/native-object-store';
import { cloneAnnotation } from '@/core/history/command-manager';

function normalizeAngle(angle: number | undefined): number {
  return (((angle || 0) % 360) + 360) % 360;
}

function applyCropToPdfPage(
  pdfPage: PDFPage,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
): void {
  if (!crop || crop.width <= 0 || crop.height <= 0) return;
  const box = pdfPage.getCropBox() || pdfPage.getMediaBox();
  const cx = box.x;
  const cy = box.y;
  const cw = box.width;
  const ch = box.height;
  const rot = normalizeAngle(rotation);

  const toPdf = (vx: number, vy: number) => {
    if (rot === 90) return { x: cx + vy, y: cy + vx };
    if (rot === 180) return { x: cx + cw - vx, y: cy + vy };
    if (rot === 270) return { x: cx + cw - vy, y: cy + ch - vx };
    return { x: cx + vx, y: cy + ch - vy };
  };

  const p1 = toPdf(crop.x, crop.y);
  const p2 = toPdf(crop.x + crop.width, crop.y + crop.height);
  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  if (w > 1 && h > 1) {
    pdfPage.setCropBox(minX, minY, w, h);
  }
}

async function rebuildPageOrderPreservingAcroForm(
  pdfLibDoc: PDFDocument,
  orderedPages: PDFPage[]
): Promise<void> {
  while (pdfLibDoc.getPageCount() > 0) {
    pdfLibDoc.removePage(0);
  }
  for (const page of orderedPages) {
    pdfLibDoc.addPage(page);
  }
}

async function reloadWithPreservedState(
  docModel: PdfDocumentModel,
  updatedBuffer: ArrayBuffer,
  pageOriginals: Array<{
    sourceModel?: PdfPageModel;
    isClone?: boolean;
    width?: number;
    height?: number;
    rotation?: number;
  }>
): Promise<LoadedPdfResult> {
  clearDocumentCaches(docModel.id);

  const loaded = await PdfLoader.loadDocument(
    docModel.name,
    updatedBuffer,
    docModel.filePath,
    undefined,
    { preserveDocId: docModel.id }
  );

  loaded.model.isModified = true;
  loaded.model.metadata = {
    ...loaded.model.metadata,
    ...docModel.metadata,
    fileSizeFormatted: loaded.model.metadata.fileSizeFormatted,
    pageCount: loaded.model.totalPages,
  };

  loaded.model.pages = loaded.model.pages.map((newPage, idx) => {
    const meta = pageOriginals[idx];
    const origin = meta?.sourceModel;
    if (!origin) {
      const explicitW = meta?.width;
      const explicitH = meta?.height;
      const explicitRot = meta?.rotation;
      if (explicitW && explicitH) {
        const rot = normalizeAngle(explicitRot);
        const swapped = rot === 90 || rot === 270;
        const w = swapped ? explicitH : explicitW;
        const h = swapped ? explicitW : explicitH;
        return {
          ...newPage,
          width: w,
          height: h,
          rotation: rot,
          aspectRatio: w / (h || 1),
        };
      }
      return newPage;
    }

    const isClone = Boolean(pageOriginals[idx]?.isClone);
    if (!isClone && origin.id !== newPage.id) {
      useNativeObjectStore.getState().migratePageObjects(origin.id, newPage.id);
    }

    const clonedAnnotations = origin.annotations.map((ann) => {
      const copy = cloneAnnotation(ann);
      copy.pageId = newPage.id;
      if (isClone) {
        copy.id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      return copy;
    });

    return {
      ...newPage,
      rotation: normalizeAngle(origin.rotation),
      crop: origin.crop ? { ...origin.crop } : undefined,
      annotations: clonedAnnotations,
    };
  });

  const clampedActiveIdx = Math.max(
    0,
    Math.min(docModel.activePageIndex, Math.max(0, loaded.model.pages.length - 1))
  );
  loaded.model.activePageIndex = clampedActiveIdx;
  loaded.model.activePageId = loaded.model.pages[clampedActiveIdx]?.id || '';
  loaded.model.selectedPageIds = loaded.model.activePageId ? [loaded.model.activePageId] : [];

  return loaded;
}

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
      const srcDoc = await loadPdfLibSafe(file.buffer, `"${file.name}" birleştirme`);
      const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    }

    const mergedBytes = await mergedDoc.save();
    const rawBuffer = uint8ToArrayBuffer(mergedBytes);

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
    const srcDoc = await loadPdfLibSafe(sourceBuffer, 'PDF bölme');
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
      const subBuffer = uint8ToArrayBuffer(bytes);

      const rangeLabel = range.label || `Sayfa_${from}-${to}`;
      const subName = `${baseName.replace(/\.pdf$/i, '')}_${rangeLabel}.pdf`;

      results.push({ name: subName, buffer: subBuffer });
    }

    return results;
  }

  private static async getValidBuffer(docModel: PdfDocumentModel): Promise<ArrayBuffer> {
    let raw = binaryStore.get(docModel.id);
    if (!raw || raw.byteLength === 0) {
      const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (docModel.filePath && electron?.readFile) {
        try {
          const res = await electron.readFile(docModel.filePath);
          if (res && res.buffer) {
            const offset = typeof res.byteOffset === 'number' ? res.byteOffset : 0;
            const length =
              typeof res.byteLength === 'number' ? res.byteLength : res.buffer.byteLength;
            const fresh = res.buffer.slice(offset, offset + length);
            binaryStore.set(docModel.id, fresh.slice(0));
            raw = fresh;
          }
        } catch {
          // ignore read fallback errors
        }
      }
    }
    if (!raw || raw.byteLength === 0) {
      throw new Error('Döküman verisi bulunamadı veya bellekten boşaltıldı.');
    }
    return raw.slice(0);
  }

  private static async resolveBasePages(
    pdfLibDoc: PDFDocument,
    docModel: PdfDocumentModel
  ): Promise<PDFPage[]> {
    const physicalPages = pdfLibDoc.getPages();
    const usedIndices = new Set<number>();
    const resolved: PDFPage[] = [];

    for (const pm of docModel.pages) {
      const idx = pm.sourcePageIndex;
      if (idx < 0 || idx >= physicalPages.length) continue;

      let pageObj: PDFPage;
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx);
        pageObj = physicalPages[idx];
      } else {
        const [cloned] = await pdfLibDoc.copyPages(pdfLibDoc, [idx]);
        pageObj = cloned;
      }
      pageObj.setRotation(degrees(normalizeAngle(pm.rotation)));
      resolved.push(pageObj);
    }

    return resolved;
  }

  /**
   * Inserts selected pages from an incoming PDF into an existing loaded document
   * while preserving filePath, annotations, rotations, native objects, and form values.
   */
  public static async insertPagesIntoDocument(
    targetDocModel: PdfDocumentModel,
    sourceBuffer: ArrayBuffer,
    sourcePageIndices: number[], // 0-based
    insertAtIndex: number // index in logical pages array
  ): Promise<LoadedPdfResult> {
    const targetBuffer = await this.getValidBuffer(targetDocModel);

    const targetPdfLib = await loadPdfLibSafe(targetBuffer, 'Sayfa ekleme (hedef)');
    const sourcePdfLib = await loadPdfLibSafe(sourceBuffer, 'Sayfa ekleme (kaynak)');

    const existingPages = await this.resolveBasePages(targetPdfLib, targetDocModel);
    const copiedPages = await targetPdfLib.copyPages(sourcePdfLib, sourcePageIndices);

    const safeIndex = Math.max(0, Math.min(insertAtIndex, existingPages.length));
    const finalPdfPages = [
      ...existingPages.slice(0, safeIndex),
      ...copiedPages,
      ...existingPages.slice(safeIndex),
    ];

    const pageOriginals: Array<{
      sourceModel?: PdfPageModel;
      isClone?: boolean;
      width?: number;
      height?: number;
      rotation?: number;
    }> = [
      ...targetDocModel.pages.slice(0, safeIndex).map((p) => ({ sourceModel: p })),
      ...copiedPages.map((cp) => {
        const sz = cp.getSize();
        return { width: sz.width, height: sz.height, rotation: cp.getRotation().angle };
      }),
      ...targetDocModel.pages.slice(safeIndex).map((p) => ({ sourceModel: p })),
    ];

    await rebuildPageOrderPreservingAcroForm(targetPdfLib, finalPdfPages);

    const updatedBytes = await targetPdfLib.save({ updateFieldAppearances: false });
    const updatedBuffer = uint8ToArrayBuffer(updatedBytes);

    return await reloadWithPreservedState(targetDocModel, updatedBuffer, pageOriginals);
  }

  /**
   * Duplicates selected pages in the active document without index shifting
   * and preserves filePath, annotations, rotations, native objects, and form values.
   */
  public static async duplicatePages(
    docModel: PdfDocumentModel,
    pageIds: string[]
  ): Promise<LoadedPdfResult> {
    const rawBuffer = await this.getValidBuffer(docModel);
    const pdfLibDoc = await loadPdfLibSafe(rawBuffer, 'Sayfa çoğaltma');

    const selectedSet = new Set(pageIds);
    const pagesToDup = docModel.pages.filter((p) => selectedSet.has(p.id));
    if (pagesToDup.length === 0) {
      throw new Error('Çoğaltılacak sayfa seçilmedi.');
    }

    // Copy all pages to duplicate BEFORE modifying the PDF page tree (avoids index shifting)
    const clonedPdfPages = await pdfLibDoc.copyPages(
      pdfLibDoc,
      pagesToDup.map((p) => p.sourcePageIndex)
    );
    const cloneByPageId = new Map<string, PDFPage>();
    pagesToDup.forEach((p, i) => {
      const clone = clonedPdfPages[i];
      clone.setRotation(degrees(normalizeAngle(p.rotation)));
      cloneByPageId.set(p.id, clone);
    });

    const basePages = await this.resolveBasePages(pdfLibDoc, docModel);
    const finalPdfPages: PDFPage[] = [];
    const pageOriginals: Array<{ sourceModel?: PdfPageModel; isClone?: boolean }> = [];

    docModel.pages.forEach((p, idx) => {
      const origPage = basePages[idx];
      if (origPage) {
        finalPdfPages.push(origPage);
        pageOriginals.push({ sourceModel: p, isClone: false });
      }
      const dupPage = cloneByPageId.get(p.id);
      if (dupPage) {
        finalPdfPages.push(dupPage);
        pageOriginals.push({ sourceModel: p, isClone: true });
      }
    });

    await rebuildPageOrderPreservingAcroForm(pdfLibDoc, finalPdfPages);

    const bytes = await pdfLibDoc.save({ updateFieldAppearances: false });
    const updatedBuffer = uint8ToArrayBuffer(bytes);

    return await reloadWithPreservedState(docModel, updatedBuffer, pageOriginals);
  }

  /**
   * Inserts clean blank pages at the specified logical index while preserving
   * filePath, annotations, rotations, native objects, and form values.
   */
  public static async insertBlankPage(
    docModel: PdfDocumentModel,
    insertAtIndex: number,
    pageSize: 'a4' | 'letter' | 'match' = 'a4',
    orientation: 'portrait' | 'landscape' = 'portrait',
    count: number = 1
  ): Promise<LoadedPdfResult> {
    const rawBuffer = await this.getValidBuffer(docModel);
    const pdfLibDoc = await loadPdfLibSafe(rawBuffer, 'Boş sayfa ekleme');

    let width = 595.28; // Standard A4 in points
    let height = 841.89;

    if (pageSize === 'letter') {
      width = 612.0;
      height = 792.0;
    } else if (pageSize === 'match' && docModel.pages.length > 0) {
      const refIdx = Math.max(0, Math.min(insertAtIndex, docModel.pages.length - 1));
      const refModel = docModel.pages[refIdx];
      width = refModel.width || 595.28;
      height = refModel.height || 841.89;
    }

    if (orientation === 'landscape' && width < height) {
      [width, height] = [height, width];
    } else if (orientation === 'portrait' && width > height) {
      [width, height] = [height, width];
    }

    const existingPages = await this.resolveBasePages(pdfLibDoc, docModel);
    const safeIndex = Math.max(0, Math.min(insertAtIndex, existingPages.length));

    const blankPages: PDFPage[] = [];
    for (let c = 0; c < count; c++) {
      // Append temporarily then reorder cleanly
      blankPages.push(pdfLibDoc.addPage([width, height]));
    }

    const finalPdfPages = [
      ...existingPages.slice(0, safeIndex),
      ...blankPages,
      ...existingPages.slice(safeIndex),
    ];

    const pageOriginals: Array<{
      sourceModel?: PdfPageModel;
      isClone?: boolean;
      width?: number;
      height?: number;
      rotation?: number;
    }> = [
      ...docModel.pages.slice(0, safeIndex).map((p) => ({ sourceModel: p })),
      ...blankPages.map(() => ({ width, height, rotation: 0 })),
      ...docModel.pages.slice(safeIndex).map((p) => ({ sourceModel: p })),
    ];

    await rebuildPageOrderPreservingAcroForm(pdfLibDoc, finalPdfPages);

    const bytes = await pdfLibDoc.save({ updateFieldAppearances: false });
    const updatedBuffer = uint8ToArrayBuffer(bytes);

    return await reloadWithPreservedState(docModel, updatedBuffer, pageOriginals);
  }

  /**
   * Extracts specified pages from a document.
   * Sets exact final page rotation (avoiding double-rotation) and applies CropBox if present.
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
    const srcDoc = await loadPdfLibSafe(validBuffer, 'Sayfa ayıklama');
    const baseName = options.customBaseName || docModel.name.replace(/\.pdf$/i, '');

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

        const finalRot = normalizeAngle(page.rotation);
        copiedPage.setRotation(degrees(finalRot));
        if (page.crop) {
          applyCropToPdfPage(copiedPage, page.crop, finalRot);
        }
        singleDoc.addPage(copiedPage);

        const bytes = await singleDoc.save();
        const buffer = uint8ToArrayBuffer(bytes);

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
        const finalRot = normalizeAngle(page.rotation);
        cp.setRotation(degrees(finalRot));
        if (page.crop) {
          applyCropToPdfPage(cp, page.crop, finalRot);
        }
        combinedDoc.addPage(cp);
      }

      const bytes = await combinedDoc.save();
      const buffer = uint8ToArrayBuffer(bytes);

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
   * converting images to valid PDF buffers and validating PDF buffers.
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
          const doc = await loadPdfLibSafe(buffer, `"${file.name}" içe aktarma`);
          results.push({
            buffer,
            pageCount: doc.getPageCount(),
            name: file.name,
          });
        } catch (e) {
          if (isPdfEncryptedError(e)) {
            console.warn('Şifreli PDF dosyası atlandı:', file.name);
          } else {
            console.error('PDF yükleme hatası:', file.name, e);
          }
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
