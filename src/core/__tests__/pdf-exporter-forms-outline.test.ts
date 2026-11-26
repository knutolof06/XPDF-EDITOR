import { describe, it, expect, beforeEach } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { setupPdfJsWorker } from './pdfjs-setup';
import { PdfLoader } from '../pdf/pdf-loader';
import { PdfExporter } from '../engine/pdf-exporter';
import { PdfFormsEngine } from '../pdf/pdf-forms';
import { PdfOutlineExtractor, PdfOutlineWriter } from '../pdf/pdf-outline';
import { binaryStore } from '../storage/binary-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useFormStore } from '@/store/form-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useDocumentStore } from '@/store/document-store';

setupPdfJsWorker();

async function createSamplePdf(pages = 2, rotatePage0 = 0): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`Sayfa ${i + 1}`, { x: 40, y: 520, size: 16 });
    if (i === 0 && rotatePage0) {
      p.setRotation(degrees(rotatePage0));
    }
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('PdfExporter, PdfFormsEngine & PdfOutline', () => {
  beforeEach(() => {
    binaryStore.clear();
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
    useFormStore.setState({ valuesByDoc: {} });
    useNativeObjectStore.setState({ objectsByPage: {} });
    useAnnotationStore.setState({
      pageNumberConfigByDoc: {},
      headerFooterConfigByDoc: {},
      pageNumberConfig: {
        enabled: false,
        position: 'bottom-center',
        format: 'page-x-of-y',
        fontSize: 10,
        color: '#475569',
        startFrom: 1,
      },
      headerFooterConfig: {
        enabled: false,
        fontSize: 9,
        color: '#64748b',
      },
    });
  });

  it('exports crop, rotation (no double-rotation), Turkish text/metadata, arrows, underline/strikethrough, single-point draw, page numbers & header/footer', async () => {
    const buf = await createSamplePdf(2, 90);
    const loaded = await PdfLoader.loadDocument('export-test.pdf', buf, 'C:\\export-test.pdf');
    expect(loaded.model.pages[0].rotation).toBe(90);

    loaded.model.metadata = {
      ...loaded.model.metadata,
      title: 'Türkçe Rapor ğĞşŞıİ',
      author: 'XPDF Yazar',
      subject: 'Denetim',
      keywords: 'pdf, test, türkçe',
      creator: 'XPDF Studio',
    };

    // Crop page 2
    loaded.model.pages[1].crop = { x: 20, y: 20, width: 300, height: 400 };

    // Add diverse annotations onto page 1 (which is 90° rotated) and page 2
    loaded.model.pages[1].annotations.push(
      {
        id: 'txt_tr',
        pageId: loaded.model.pages[1].id,
        type: 'text',
        x: 40,
        y: 60,
        width: 180,
        height: 40,
        text: 'Türkçe Başlık ğĞşŞıİ₺\nİkinci satır',
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#0f172a',
        backgroundColor: '#fef08a',
        isBold: true,
        isItalic: true,
        isUnderline: true,
        textAlign: 'center',
        rotation: 10,
      },
      {
        id: 'arr_1',
        pageId: loaded.model.pages[1].id,
        type: 'arrow',
        x: 50,
        y: 120,
        width: 120,
        height: 40,
        strokeColor: '#ef4444',
        strokeWidth: 2,
      },
      {
        id: 'dot_1',
        pageId: loaded.model.pages[1].id,
        type: 'draw',
        x: 80,
        y: 200,
        width: 2,
        height: 2,
        points: [{ x: 80, y: 200 }],
        color: '#0284c7',
        strokeWidth: 4,
      },
      {
        id: 'ul_1',
        pageId: loaded.model.pages[1].id,
        type: 'underline',
        x: 40,
        y: 250,
        width: 100,
        height: 14,
      } as never,
      {
        id: 'st_1',
        pageId: loaded.model.pages[1].id,
        type: 'strikethrough',
        x: 40,
        y: 280,
        width: 100,
        height: 14,
      } as never,
      {
        id: 'pn_1',
        pageId: loaded.model.pages[1].id,
        type: 'page-number',
        x: 300,
        y: 550,
        width: 40,
        height: 20,
      } as never
    );

    useDocumentStore.getState().setDocument(loaded.model, loaded.pdfDoc);
    useAnnotationStore.getState().setPageNumberConfig({
      enabled: true,
      format: 'custom',
      prefix: 'No {page}/{total}',
      startFrom: 5,
      color: '#1e293b',
      position: 'bottom-right',
    });
    useAnnotationStore.getState().setHeaderFooterConfig({
      enabled: true,
      headerLeft: 'Üst Sol {title}',
      headerRight: 'Sayfa {page}',
      footerCenter: 'Alt Orta {pages}',
      color: '#334155',
    });

    const outBuf = await PdfExporter.exportDocumentWithAnnotations(loaded.model);
    const outDoc = await PDFDocument.load(outBuf);

    // Rotation on page 0 must remain 90 (not 180!)
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);

    // CropBox on page 1 applied
    const cropBox = outDoc.getPage(1).getCropBox();
    expect(Math.round(cropBox.width)).toBe(300);
    expect(Math.round(cropBox.height)).toBe(400);

    // Metadata written
    expect(outDoc.getTitle()).toBe('Türkçe Rapor ğĞşŞıİ');
    expect(outDoc.getAuthor()).toBe('XPDF Yazar');
    expect(outDoc.getSubject()).toBe('Denetim');
    expect(outDoc.getCreator()).toBe('XPDF Studio');

    // Text rendered cleanly in PDF.js
    const outProxy = await pdfjsLib.getDocument({ data: new Uint8Array(outBuf) }).promise;
    const p2 = await outProxy.getPage(2);
    const tc = await p2.getTextContent();
    const p2Text = (tc.items as Array<{ str?: string }>).map((x) => x.str || '').join(' ');
    expect(p2Text).toContain('Türkçe Başlık');
    expect(p2Text).toContain('No 6/2');
    expect(p2Text).toContain('Üst Sol');
    expect(p2Text).toContain('Alt Orta 2');

    await outProxy.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('preserves AcroForm fields & Turkish values across structural page deletion/reordering on export', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([400, 600]);
    const p2 = doc.addPage([400, 600]);
    const form = doc.getForm();
    const f1 = form.createTextField('ad_soyad');
    f1.addToPage(p1, { x: 50, y: 500, width: 200, height: 24 });
    const f2 = form.createCheckBox('onay');
    f2.addToPage(p2, { x: 50, y: 450, width: 20, height: 20 });

    const bytes = await doc.save();
    const loaded = await PdfLoader.loadDocument(
      'form.pdf',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );

    useFormStore.getState().setFieldValue(loaded.model.id, 'ad_soyad', 'Çağrı Şahin');
    useFormStore.getState().setFieldValue(loaded.model.id, 'onay', true);

    // Reorder pages [1, 0] (structure changed!)
    loaded.model.pages = [loaded.model.pages[1], loaded.model.pages[0]];

    const exportedBuf = await PdfExporter.exportDocumentWithAnnotations(loaded.model);
    const verifyDoc = await PDFDocument.load(exportedBuf);
    const verifyForm = verifyDoc.getForm();
    expect(verifyForm.getTextField('ad_soyad').getText()).toBe('Çağrı Şahin');
    expect(verifyForm.getCheckBox('onay').isChecked()).toBe(true);

    await loaded.pdfDoc.destroy();
  });

  it('PdfFormsEngine creates, inspects (real pageIndex & rect), fills, removes, and flattens fields preserving filePath & annotations', async () => {
    const buf = await createSamplePdf(2);
    const loaded = await PdfLoader.loadDocument('interactive.pdf', buf, 'C:\\forms\\interactive.pdf');
    loaded.model.pages[0].annotations.push({
      id: 'keep_me',
      pageId: loaded.model.pages[0].id,
      type: 'rect',
      x: 10,
      y: 10,
      width: 30,
      height: 30,
      strokeColor: '#000',
      strokeWidth: 1,
    });
    useDocumentStore.getState().setDocument(loaded.model, loaded.pdfDoc);

    // Create text field on page index 1 (page 2!)
    const afterCreate = await PdfFormsEngine.createFormField(
      loaded.model.id,
      loaded.model.name,
      {
        name: 'sehir',
        type: 'text',
        pageIndex: 1,
        rect: { x: 75, y: 310, width: 180, height: 26 },
        defaultValue: 'İstanbul',
      },
      loaded.model
    );

    expect(afterCreate.model.filePath).toBe('C:\\forms\\interactive.pdf');
    expect(afterCreate.model.pages[0].annotations).toHaveLength(1);
    expect(afterCreate.model.isModified).toBe(true);

    const fields = await PdfFormsEngine.getFormFields(afterCreate.model.id);
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('sehir');
    expect(fields[0].pageIndex).toBe(1);
    expect(Math.round(fields[0].rect.x)).toBe(75);
    expect(Math.round(fields[0].rect.y)).toBe(310);
    expect(fields[0].rect.width).toBeGreaterThanOrEqual(180);
    expect(fields[0].rect.width).toBeLessThanOrEqual(182);
    expect(fields[0].value).toBe('İstanbul');

    const filled = await PdfFormsEngine.fillFormFields(
      afterCreate.model.id,
      afterCreate.model.name,
      { sehir: 'Eskişehir' },
      afterCreate.model
    );
    const afterFillFields = await PdfFormsEngine.getFormFields(filled.model.id);
    expect(afterFillFields[0].value).toBe('Eskişehir');

    const removed = await PdfFormsEngine.removeFormField(
      filled.model.id,
      filled.model.name,
      'sehir',
      filled.model
    );
    const remainingFields = await PdfFormsEngine.getFormFields(removed.model.id);
    expect(remainingFields).toHaveLength(0);

    await removed.pdfDoc.destroy();
    await filled.pdfDoc.destroy();
    await afterCreate.pdfDoc.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('PdfOutlineWriter writes hierarchical Unicode /Outlines and PdfOutlineExtractor reads deterministic IDs & external URLs', async () => {
    const buf = await createSamplePdf(3);
    const loaded = await PdfLoader.loadDocument('outline.pdf', buf);

    const updated = await PdfOutlineWriter.updateOutline(loaded.model.id, loaded.model.name, [
      {
        id: 'tmp1',
        title: 'Bölüm 1: Giriş',
        pageIndex: 0,
        bold: true,
        children: [
          {
            id: 'tmp2',
            title: 'Alt Başlık',
            pageIndex: 2,
          },
        ],
      },
      {
        id: 'tmp3',
        title: 'Harici Bağlantı',
        pageIndex: 0,
        url: 'https://example.org/docs',
      },
    ]);

    const firstExtract = await PdfOutlineExtractor.extractOutline(updated.pdfDoc);
    const secondExtract = await PdfOutlineExtractor.extractOutline(updated.pdfDoc);

    expect(firstExtract).toHaveLength(2);
    expect(firstExtract[0].title).toBe('Bölüm 1: Giriş');
    expect(firstExtract[0].pageIndex).toBe(0);
    expect(firstExtract[0].children?.[0].title).toBe('Alt Başlık');
    expect(firstExtract[0].children?.[0].pageIndex).toBe(2);
    expect(firstExtract[1].url).toBe('https://example.org/docs');
    expect(firstExtract[0].id).toBe(secondExtract[0].id);
    expect(firstExtract[0].children?.[0].id).toBe(secondExtract[0].children?.[0].id);

    PdfOutlineWriter.clearModifiedOutline(loaded.model.id);
    await updated.pdfDoc.destroy();
    await loaded.pdfDoc.destroy();
  });
});
