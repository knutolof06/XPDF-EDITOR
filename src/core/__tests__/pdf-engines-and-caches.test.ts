import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { setupPdfJsWorker } from './pdfjs-setup';
import { PdfLoader } from '../pdf/pdf-loader';
import { PdfCompressor } from '../engine/pdf-compressor';
import { PdfReplaceEngine } from '../engine/pdf-replace-engine';
import { PdfSearchEngine } from '../pdf/pdf-search';
import { PageLayoutEngine } from '../engine/page-layout-engine';
import { PdfTextExtractor } from '../engine/pdf-text-extractor';
import { PdfImageExporter } from '../engine/pdf-image-exporter';
import { extractNativeImageObjects } from '../pdf/pdf-native-extractor';
import { WatermarkEngine } from '../engine/watermark-engine';
import { ImagesToPdfConverter } from '../engine/images-to-pdf';
import {
  makePageMetaKey,
  pageRenderCache,
  pageBlobCache,
  pageBitmapCache,
  clearDocumentCaches,
} from '../cache/render-cache';
import { preloadAdjacentPages, cancelActivePreload } from '../cache/page-preloader';
import { enqueueThumbnail, clearThumbnailQueue } from '../cache/thumbnail-queue';
import { openRecentDocument } from '@/utils/recent-document-opener';
import { binaryStore } from '../storage/binary-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';

setupPdfJsWorker();

async function createTextPdf(lines: string[], pageCount = 1): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([500, 700]);
    lines.forEach((line, idx) => {
      page.drawText(line, { x: 50, y: 620 - idx * 24, size: 14, font });
    });
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('PDF Engines, Caches & Recent Opener', () => {
  beforeEach(() => {
    binaryStore.clear();
    pageRenderCache.clear();
    pageBlobCache.clear();
    pageBitmapCache.clear();
    clearThumbnailQueue();
    useTabStore.setState({ tabs: [], activeTabId: null });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
  });

  it('PdfCompressor smart mode preserves selectable text and AcroForms with honest size reporting', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    page.drawText('Selectable Vector Text Preserved', { x: 40, y: 500, size: 16 });
    const tf = doc.getForm().createTextField('test_field');
    tf.setText('KeepForm');
    tf.addToPage(page, { x: 40, y: 400, width: 160, height: 24 });
    const bytes = await doc.save({ useObjectStreams: false });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const loaded = await PdfLoader.loadDocument('comp.pdf', buf);
    const res = await PdfCompressor.compressPdf(loaded.model.id, loaded.pdfDoc, 'recommended');

    expect(res.modeUsed).toBe('lossless-optimize');
    expect(res.preservedTextAndForms).toBe(true);
    expect(res.savedBytes).toBe(res.originalSize - res.compressedSize);
    expect(res.compressedBuffer.byteLength).toBe(res.compressedSize);

    // Verify selectable text & AcroForm still exist in compressed PDF
    const checkLib = await PDFDocument.load(res.compressedBuffer);
    expect(checkLib.getForm().getTextField('test_field').getText()).toBe('KeepForm');

    const checkProxy = await pdfjsLib.getDocument({ data: new Uint8Array(res.compressedBuffer) }).promise;
    const tc = await (await checkProxy.getPage(1)).getTextContent();
    const extracted = (tc.items as Array<{ str?: string }>).map((i) => i.str || '').join('');
    expect(extracted).toContain('Selectable Vector Text Preserved');

    await checkProxy.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('PdfSearchEngine uses tr-TR locale and finds cross-span phrases; PdfReplaceEngine supports replace and redact', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 700]);
    page.drawText('ISTANBUL', { x: 50, y: 600, size: 14 });
    page.drawText('Merha', { x: 50, y: 560, size: 14 });
    page.drawText('ba Dunya', { x: 89.68, y: 560, size: 14 });
    page.drawText('GizliKod123', { x: 50, y: 520, size: 14 });
    const bytes = await doc.save();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const loaded = await PdfLoader.loadDocument('search.pdf', buf);

    const trMatches = await PdfSearchEngine.search(loaded.pdfDoc, 'ıstanbul', false);
    expect(trMatches).toHaveLength(1);

    const crossMatches = await PdfSearchEngine.search(loaded.pdfDoc, 'merhaba dunya', false);
    expect(crossMatches.length).toBeGreaterThanOrEqual(1);

    const replaceMatches = await PdfReplaceEngine.findMatches(loaded.pdfDoc, 'GizliKod123');
    expect(replaceMatches).toHaveLength(1);

    // Redact mode strips literal text and draws redaction box
    const redactedBuf = await PdfReplaceEngine.applyReplacements(
      loaded.model.id,
      replaceMatches,
      '',
      { mode: 'redact', redactColor: '#000000' }
    );
    const redactedProxy = await pdfjsLib.getDocument({ data: new Uint8Array(redactedBuf) }).promise;
    const afterTc = await (await redactedProxy.getPage(1)).getTextContent();
    const afterText = (afterTc.items as Array<{ str?: string }>).map((i) => i.str || '').join(' ');
    expect(afterText).not.toContain('GizliKod123');

    await redactedProxy.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('PageLayoutEngine supports grid layout, multi-page overflow splitting, 0 margin, headerText, and slot rotation', async () => {
    const buf = await createTextPdf(['SlotContent'], 5);
    const loaded = await PdfLoader.loadDocument('layout.pdf', buf);

    const slots = loaded.model.pages.map((p, idx) => ({
      sourceDocId: loaded.model.id,
      sourcePageIndex: p.sourcePageIndex,
      rotation: idx === 0 ? 90 : 0,
    }));

    const out4Up = await PageLayoutEngine.synthesizeSinglePage(
      slots,
      {
        layout: '4-up',
        pageSize: 'A4',
        orientation: 'portrait',
        margin: 0,
        spacing: 0,
        drawBorder: true,
        headerText: 'Özet Başlık ğĞşŞ',
      },
      'layout.pdf'
    );
    // 5 slots in 4-up must split across 2 pages instead of dropping slot 5
    expect(out4Up.model.totalPages).toBe(2);

    const outGrid = await PageLayoutEngine.synthesizeSinglePage(
      slots,
      {
        layout: 'grid',
        pageSize: 'A4',
        orientation: 'landscape',
        margin: 0,
        spacing: 4,
        drawBorder: false,
        gridCols: 3,
        gridRows: 2,
      },
      'grid.pdf'
    );
    expect(outGrid.model.totalPages).toBe(1);

    await out4Up.pdfDoc.destroy();
    await outGrid.pdfDoc.destroy();
    await loaded.pdfDoc.destroy();
  });

  it('WatermarkEngine handles Turkish default text, invalid hex NaN guard, and returns sliced ArrayBuffer', async () => {
    const buf = await createTextPdf(['Clean Page'], 2);
    const loaded = await PdfLoader.loadDocument('wm.pdf', buf);

    // Even if custom font fetch fails in jsdom/browser fallback, must never crash on 'GİZLİDİR'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      const outBuf = await WatermarkEngine.applyWatermark(loaded.model.id, {
        text: 'GİZLİDİR ğşİ',
        fontSize: 36,
        color: 'invalid-hex',
        opacity: 0.25,
        rotation: 45,
        layout: 'center',
        pages: 'all',
      });
      expect(outBuf).toBeInstanceOf(ArrayBuffer);
      expect(outBuf.byteLength).toBeGreaterThan(100);
      const checkDoc = await PDFDocument.load(outBuf);
      expect(checkDoc.getPageCount()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      await loaded.pdfDoc.destroy();
    }
  });

  it('ImagesToPdfConverter revokes objectUrl on error and guards zero-dimension images', async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const revokeSpy = vi.fn();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-img-url');
    URL.revokeObjectURL = revokeSpy;

    class FailingImage {
      onload: (() => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_val: string) {
        queueMicrotask(() => this.onerror?.(new Error('decode failed')));
      }
    }
    vi.stubGlobal('Image', FailingImage);

    try {
      const pngFile = new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' });
      await expect(ImagesToPdfConverter.loadImageData(pngFile)).rejects.toThrow();
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-img-url');

      // Zero-dimension image throws clean error instead of dividing by zero
      class ZeroDimImage {
        onload: (() => void) | null = null;
        onerror: ((err: unknown) => void) | null = null;
        naturalWidth = 0;
        naturalHeight = 0;
        set src(_val: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
      vi.stubGlobal('Image', ZeroDimImage);
      await expect(ImagesToPdfConverter.loadImageData(pngFile)).rejects.toThrow(/0x0/);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      vi.unstubAllGlobals();
    }
  });

  it('render-cache, page-preloader & thumbnail-queue isolate scales, revoke URLs, and prevent stale races', async () => {
    const k1 = makePageMetaKey('doc1', 'p1', 0, 0, 1.0);
    const k2 = makePageMetaKey('doc1', 'p1', 0, 0, 1.5);
    expect(k1).not.toBe(k2);

    const origRevoke = URL.revokeObjectURL;
    const revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    try {
      const canvas = document.createElement('canvas');
      pageRenderCache.set('doc1_p1', canvas);
      pageBlobCache.set('doc1_p1', 'blob:doc1-page');

      clearDocumentCaches('doc1');
      expect(pageRenderCache.size()).toBe(0);
      expect(pageBlobCache.size).toBe(0);
      expect(revokeSpy).toHaveBeenCalledWith('blob:doc1-page');
    } finally {
      URL.revokeObjectURL = origRevoke;
    }

    // ThumbnailQueue deduplication by key
    const executed: string[] = [];
    let releaseFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      releaseFirst = r;
    });
    for (let i = 0; i < 8; i++) {
      enqueueThumbnail(async () => blocker, 0);
    }
    enqueueThumbnail(async () => {
      executed.push('first');
    }, 1, 'same-key');
    enqueueThumbnail(async () => {
      executed.push('second');
    }, 1, 'same-key');
    releaseFirst();
    await new Promise((r) => setTimeout(r, 40));
    expect(executed).toEqual(['second']);

    // Preloader generation safety check
    const buf = await createTextPdf(['Preload'], 3);
    const loaded = await PdfLoader.loadDocument('preload.pdf', buf);
    preloadAdjacentPages(loaded.pdfDoc, loaded.model, 1, 1.0);
    cancelActivePreload();
    await new Promise((r) => setTimeout(r, 30));
    await loaded.pdfDoc.destroy();
  });

  it('openRecentDocument handles { canceled, filePaths, files } from Electron showOpenDialog safely', async () => {
    const buf = await createTextPdf(['Relocated']);
    const readFileMock = vi.fn().mockRejectedValueOnce(new Error('ENOENT'));
    const showOpenDialogMock = vi.fn().mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:\\moved\\doc.pdf'],
      files: [{ name: 'doc.pdf', path: 'C:\\moved\\doc.pdf', buffer: buf, byteOffset: 0, byteLength: buf.byteLength }],
    });

    vi.stubGlobal('electronAPI', {
      isElectron: true,
      platform: 'win32',
      readFile: readFileMock,
      showOpenDialog: showOpenDialogMock,
    });

    try {
      const ok = await openRecentDocument({
        id: 'old-id',
        name: 'doc.pdf',
        filePath: 'C:\\missing\\doc.pdf',
        fileSize: 100,
        pageCount: 1,
        lastOpened: Date.now(),
      });
      expect(ok).toBe(true);
      expect(showOpenDialogMock).toHaveBeenCalledTimes(1);
      expect(useDocumentStore.getState().currentDocument?.filePath).toBe('C:\\moved\\doc.pdf');

      // Cancel case must cleanly return false without crashing
      showOpenDialogMock.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      readFileMock.mockRejectedValueOnce(new Error('ENOENT'));
      const cancelled = await openRecentDocument({
        id: 'old-id-2',
        name: 'missing.pdf',
        filePath: 'C:\\missing\\missing.pdf',
        fileSize: 100,
        pageCount: 1,
        lastOpened: Date.now(),
      });
      expect(cancelled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      const doc = useDocumentStore.getState().currentDocument;
      if (doc) {
        useTabStore.getState().closeTab(doc.id);
      }
    }
  });

  it('extractNativeImageObjects handles rotated/flipped CTM transforms and extracts dataUrl; PdfTextExtractor handles 2-column and deleted/reordered pages', async () => {
    // 1. Mock PDFPageProxy with rotated image CTM (ctm[0] = 0, ctm[3] = 0 -> 90° rotated image!)
    const fakePage = {
      getViewport: () => ({
        width: 400,
        height: 600,
        transform: [1, 0, 0, -1, 0, 600],
      }),
      getOperatorList: async () => ({
        fnArray: [
          10, // save
          12, // transform (rotated 90 deg: [0, 80, -120, 0, 200, 300])
          85, // paintImageXObject
          11, // restore
        ],
        argsArray: [
          [],
          [0, 80, -120, 0, 200, 300],
          ['img_0'],
          [],
        ],
      }),
      objs: {
        has: () => true,
        get: () => ({
          width: 2,
          height: 2,
          data: new Uint8ClampedArray([
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 0, 255,
          ]),
        }),
      },
      commonObjs: { has: () => false, get: () => null },
    } as unknown as Parameters<typeof extractNativeImageObjects>[0];

    const origOps = await import('pdfjs-dist');
    const fnArr = [
      origOps.OPS.save,
      origOps.OPS.transform,
      origOps.OPS.paintImageXObject,
      origOps.OPS.restore,
    ];
    (fakePage as unknown as { getOperatorList: () => Promise<unknown> }).getOperatorList = async () => ({
      fnArray: fnArr,
      argsArray: [[], [0, 80, -120, 0, 200, 300], ['img_0'], []],
    });

    const imgs = await extractNativeImageObjects(fakePage, 'page_1');
    expect(imgs).toHaveLength(1);
    expect(Math.round(imgs[0].width)).toBe(120);
    expect(Math.round(imgs[0].height)).toBe(80);
    expect(imgs[0].x).toBe(80);

    // 2. PdfTextExtractor honors deleted/reordered pages and column-aware sorting
    const buf = await createTextPdf(['FirstPageText'], 2);
    const loaded = await PdfLoader.loadDocument('text-ext.pdf', buf);
    // Reorder to [page 2, page 1] and drop page 1 -> only 1 page remains
    loaded.model.pages = [loaded.model.pages[1]];
    const extracted = await PdfTextExtractor.extractText(loaded.pdfDoc, undefined, loaded.model);
    expect(extracted.pages).toHaveLength(1);
    expect(extracted.pages[0].text).toContain('FirstPageText');

    // 3. PdfImageExporter.exportSinglePage cleans up canvas dimensions
    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 100;
    mockCanvas.height = 100;
    mockCanvas.toBlob = (cb) => cb(new Blob(['png'], { type: 'image/png' }));
    const renderSpy = vi.spyOn(PdfImageExporter, 'renderPageToCanvas').mockResolvedValueOnce(mockCanvas);
    const expRes = await PdfImageExporter.exportSinglePage(loaded.pdfDoc, 1, { format: 'png', scale: 1 });
    expect(expRes.filename).toBe('sayfa-1.png');
    expect(mockCanvas.width).toBe(0);
    expect(mockCanvas.height).toBe(0);
    renderSpy.mockRestore();

    await loaded.pdfDoc.destroy();
  });
});
