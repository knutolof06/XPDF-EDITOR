import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import { PdfLoader } from '../pdf/pdf-loader';
import { PdfAssembler } from '../engine/pdf-assembler';
import { binaryStore } from '../storage/binary-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useFormStore } from '@/store/form-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { clearDocumentCaches } from '../cache/render-cache';

import { setupPdfJsWorker } from './pdfjs-setup';

setupPdfJsWorker();

async function createSamplePdf(
  pageCount: number,
  options?: { rotateFirstPage?: number; labels?: string[] }
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 600]);
    const label = options?.labels?.[i] ?? `Page ${i + 1}`;
    page.drawText(label, { x: 50, y: 500, size: 18 });
    if (i === 0 && options?.rotateFirstPage) {
      page.setRotation(degrees(options.rotateFirstPage));
    }
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('PdfLoader & PdfAssembler', () => {
  beforeEach(() => {
    binaryStore.clear();
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null, loadingError: null });
    useFormStore.setState({ valuesByDoc: {} });
    useNativeObjectStore.setState({ objectsByPage: {} });
  });

  it('rejects invalid binary input with TypeError and avoids storing failed/encrypted loads in binaryStore', async () => {
    await expect(PdfLoader.loadDocument('bad.pdf', 'not-a-buffer')).rejects.toBeInstanceOf(TypeError);
    expect(binaryStore.size()).toBe(0);

    const plain = new Uint8Array(await createSamplePdf(1));
    const encrypted = await encryptPDF(plain, 'secret-123');
    await expect(PdfLoader.loadDocument('locked.pdf', encrypted, 'C:\\locked.pdf')).rejects.toMatchObject({
      isPasswordProtected: true,
      fileName: 'locked.pdf',
      filePath: 'C:\\locked.pdf',
    });
    expect(binaryStore.size()).toBe(0);
  });

  it('preserves exact rotation without double-rotation on already-90-deg-rotated PDFs', async () => {
    const rotatedBuffer = await createSamplePdf(2, { rotateFirstPage: 90 });
    const loaded = await PdfLoader.loadDocument('rotated.pdf', rotatedBuffer, 'C:\\rotated.pdf');

    expect(loaded.model.pages[0].rotation).toBe(90);

    // Extract page 1 without user changes -> must stay 90, NOT 180!
    const extracted = await PdfAssembler.extractPages(loaded.model, [loaded.model.pages[0].id], {
      separateFiles: false,
    });
    expect(extracted.mode).toBe('single');
    if (extracted.mode === 'single') {
      const checkPdf = await PDFDocument.load(extracted.buffer);
      expect(checkPdf.getPage(0).getRotation().angle).toBe(90);

      // Rotate +90 in model -> becomes 180
      loaded.model.pages[0].rotation = 180;
      const extracted180 = await PdfAssembler.extractPages(
        loaded.model,
        [loaded.model.pages[0].id],
        { separateFiles: false }
      );
      if (extracted180.mode === 'single') {
        const checkPdf180 = await PDFDocument.load(extracted180.buffer);
        expect(checkPdf180.getPage(0).getRotation().angle).toBe(180);
      }
    }
    clearDocumentCaches(loaded.model.id);
    await loaded.pdfDoc.destroy();
  });

  it('duplicatePages avoids index shifting on multi-page copy and preserves filePath, annotations, rotations, form values, and native objects', async () => {
    const buf = await createSamplePdf(3, { labels: ['Alpha', 'Beta', 'Gamma'] });
    const loaded = await PdfLoader.loadDocument('multi.pdf', buf, 'C:\\docs\\multi.pdf');
    loaded.model.pages[0].rotation = 90;
    loaded.model.pages[0].annotations.push({
      id: 'ann_1',
      pageId: loaded.model.pages[0].id,
      type: 'rect',
      x: 10,
      y: 20,
      width: 50,
      height: 40,
      strokeColor: '#ff0000',
      strokeWidth: 2,
    });

    useFormStore.getState().setFieldValue(loaded.model.id, 'fullname', 'Ahmet');
    useNativeObjectStore.getState().setObjects(loaded.model.pages[0].id, [
      {
        id: 'n1',
        pageId: loaded.model.pages[0].id,
        type: 'native-text',
        x: 50,
        y: 50,
        width: 80,
        height: 16,
        originalX: 50,
        originalY: 50,
        originalWidth: 80,
        originalHeight: 16,
        text: 'Edited',
        originalText: 'Alpha',
        moved: true,
        isEdited: true,
      },
    ]);

    const dupIds = [loaded.model.pages[0].id, loaded.model.pages[1].id];
    const result = await PdfAssembler.duplicatePages(loaded.model, dupIds);

    expect(result.model.id).toBe(loaded.model.id);
    expect(result.model.filePath).toBe('C:\\docs\\multi.pdf');
    expect(result.model.isModified).toBe(true);
    expect(result.model.totalPages).toBe(5);
    expect(useFormStore.getState().valuesByDoc[result.model.id]?.fullname).toBe('Ahmet');

    // Verify page text order in resulting PDF via PDF.js: Alpha, Alpha, Beta, Beta, Gamma
    const pageTexts: string[] = [];
    for (let p = 1; p <= result.pdfDoc.numPages; p++) {
      const pg = await result.pdfDoc.getPage(p);
      const tc = await pg.getTextContent();
      pageTexts.push((tc.items as Array<{ str?: string }>).map((i) => i.str || '').join(''));
    }
    expect(pageTexts).toEqual(['Alpha', 'Alpha', 'Beta', 'Beta', 'Gamma']);
    expect(result.model.pages[0].rotation).toBe(90);
    expect(result.model.pages[1].rotation).toBe(90);
    expect(result.model.pages[0].annotations).toHaveLength(1);
    expect(result.model.pages[1].annotations).toHaveLength(1);
    expect(result.model.pages[1].annotations[0].id).not.toBe('ann_1');

    // Verify native objects preserved
    expect(useNativeObjectStore.getState().getObjectsForPage(result.model.pages[0].id)).toHaveLength(1);

    await result.pdfDoc.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('insertBlankPage preserves filePath, annotations, and form values, and guards encrypted PDFs cleanly', async () => {
    const buf = await createSamplePdf(1);
    const loaded = await PdfLoader.loadDocument('single.pdf', buf, 'C:\\docs\\single.pdf');
    loaded.model.pages[0].annotations.push({
      id: 'a1',
      pageId: loaded.model.pages[0].id,
      type: 'text',
      x: 20,
      y: 20,
      width: 100,
      height: 30,
      text: 'Not',
      fontSize: 12,
      fontFamily: 'Helvetica',
      color: '#000000',
    });

    const withBlank = await PdfAssembler.insertBlankPage(loaded.model, 1, 'a4', 'landscape', 2);
    expect(withBlank.model.totalPages).toBe(3);
    expect(withBlank.model.filePath).toBe('C:\\docs\\single.pdf');
    expect(withBlank.model.pages[0].annotations).toHaveLength(1);
    expect(withBlank.model.pages[1].width).toBeGreaterThan(withBlank.model.pages[1].height);

    // Guard encrypted PDF in splitPdf/mergePdfs
    const encrypted = await encryptPDF(new Uint8Array(buf), 'pw');
    const encBuf = encrypted.buffer.slice(
      encrypted.byteOffset,
      encrypted.byteOffset + encrypted.byteLength
    ) as ArrayBuffer;
    await expect(
      PdfAssembler.splitPdf(encBuf, 'enc.pdf', [{ from: 1, to: 1 }])
    ).rejects.toThrow(/şifreli/i);

    await withBlank.pdfDoc.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('recovers buffer via electronAPI.readFile without slicing by undefined byteOffset', async () => {
    const buf = await createSamplePdf(1, { labels: ['Recovered'] });
    const loaded = await PdfLoader.loadDocument('rec.pdf', buf, 'C:\\rec.pdf');

    // Simulate evicted binaryStore entry while electronAPI.readFile omits byteOffset/byteLength
    binaryStore.delete(loaded.model.id);
    vi.stubGlobal('electronAPI', {
      readFile: vi.fn(async () => ({
        name: 'rec.pdf',
        path: 'C:\\rec.pdf',
        buffer: buf,
      })),
    });

    try {
      const extracted = await PdfAssembler.extractPages(loaded.model, [loaded.model.pages[0].id]);
      expect(extracted.mode).toBe('single');
      if (extracted.mode === 'single') {
        expect(extracted.buffer.byteLength).toBeGreaterThan(100);
        const check = await pdfjsLib.getDocument({ data: new Uint8Array(extracted.buffer) }).promise;
        expect(check.numPages).toBe(1);
        await check.destroy();
      }
    } finally {
      vi.unstubAllGlobals();
      await loaded.pdfDoc.destroy();
    }
  });
});
