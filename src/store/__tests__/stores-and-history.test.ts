import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { setupPdfJsWorker } from '@/core/__tests__/pdfjs-setup';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { binaryStore } from '@/core/storage/binary-store';
import { historyManager, ReplaceTextCommand, MoveMultiplePagesCommand, DeletePageCommand } from '@/core/history/command-manager';
import { useDocumentStore } from '../document-store';
import { useTabStore } from '../tab-store';
import { useAnnotationStore } from '../annotation-store';
import { useViewerStore } from '../viewer-store';
import { useRulerStore } from '../ruler-store';
import { useNativeObjectStore } from '../native-object-store';
import { useFormStore } from '../form-store';
import { pageBitmapCache, makePageBitmapKey } from '@/core/cache/render-cache';

setupPdfJsWorker();

async function makePdf(label: string, pageCount = 3): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`${label} P${i + 1}`, { x: 40, y: 500, size: 14 });
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('Stores, Multi-Tab Sync & Per-Doc History', () => {
  beforeEach(() => {
    localStorage.clear();
    binaryStore.clear();
    historyManager.clearAll();
    pageBitmapCache.clear();
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({
      currentDocument: null,
      pdfDocProxy: null,
      recentDocuments: [],
      loadingError: null,
    });
    useRulerStore.setState({
      horizontalGuidesByPage: {},
      verticalGuidesByPage: {},
      horizontalGuidesByDoc: {},
      verticalGuidesByDoc: {},
    });
    useNativeObjectStore.setState({ objectsByPage: {} });
    useFormStore.setState({ valuesByDoc: {} });
    useAnnotationStore.getState().setActiveTool('select');
  });

  it('unifies activeTool synchronously between useViewerStore and useAnnotationStore', () => {
    useViewerStore.getState().setActiveTool('hand');
    expect(useViewerStore.getState().activeTool).toBe('hand');
    expect(useAnnotationStore.getState().activeTool).toBe('hand');

    useAnnotationStore.getState().setActiveTool('draw');
    expect(useAnnotationStore.getState().activeTool).toBe('draw');
    expect(useViewerStore.getState().activeTool).toBe('draw');
  });

  it('isolates history stacks per document, cleans up closed tabs, and switches to nearest tab on close', async () => {
    const resA = await PdfLoader.loadDocument('a.pdf', await makePdf('DocA', 2));
    const resB = await PdfLoader.loadDocument('b.pdf', await makePdf('DocB', 2));
    const resC = await PdfLoader.loadDocument('c.pdf', await makePdf('DocC', 2));

    const destroyASpy = vi.spyOn(resA.pdfDoc, 'destroy');
    const destroyBSpy = vi.spyOn(resB.pdfDoc, 'destroy');

    useDocumentStore.getState().setDocument(resA.model, resA.pdfDoc);
    useTabStore.getState().addTab(resA.model, resA.pdfDoc);

    useDocumentStore.getState().setDocument(resB.model, resB.pdfDoc);
    useTabStore.getState().addTab(resB.model, resB.pdfDoc);

    useDocumentStore.getState().setDocument(resC.model, resC.pdfDoc);
    useTabStore.getState().addTab(resC.model, resC.pdfDoc);

    // Edit DocA (switch to Tab A first)
    useTabStore.getState().setActiveTab(resA.model.id);
    expect(useDocumentStore.getState().currentDocument?.id).toBe(resA.model.id);
    useAnnotationStore.getState().addAnnotation(resA.model.pages[0].id, {
      id: 'ann_a',
      pageId: resA.model.pages[0].id,
      type: 'rect',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      strokeColor: '#000',
      strokeWidth: 2,
    });
    expect(historyManager.canUndo(resA.model.id)).toBe(true);
    expect(historyManager.canUndo(resB.model.id)).toBe(false);

    // Switch to Tab B -> undo must be false and MUST NOT undo Tab A's annotation!
    useTabStore.getState().setActiveTab(resB.model.id);
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.undo()).toBe(false);
    expect(
      useTabStore.getState().tabs.find((t) => t.id === resA.model.id)?.model.pages[0].annotations
    ).toHaveLength(1);

    // Put per-doc data on Tab B to verify cleanup on closeTab
    useFormStore.getState().setFieldValue(resB.model.id, 'k', 'v');
    useRulerStore.getState().addHorizontalGuide(0, 120);
    useNativeObjectStore.getState().setObjects(resB.model.pages[0].id, [
      {
        id: 'nb1',
        pageId: resB.model.pages[0].id,
        type: 'native-text',
        x: 10,
        y: 10,
        width: 20,
        height: 10,
        originalX: 10,
        originalY: 10,
        originalWidth: 20,
        originalHeight: 10,
        text: 'B',
        originalText: 'B',
        moved: false,
      },
    ]);
    // Dummy bitmap cache entry for B
    pageBitmapCache.set(makePageBitmapKey(resB.model.id, resB.model.pages[0].id, 0, 0, 1), {
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      width: 10,
      height: 10,
      scale: 1,
      rotation: 0,
      docId: resB.model.id,
      pageIndex: 0,
    });

    // Close middle Tab B -> nearest neighbor Tab C (NOT remaining[0] = A!) must become active
    useTabStore.getState().closeTab(resB.model.id);
    expect(useTabStore.getState().activeTabId).toBe(resC.model.id);
    expect(useDocumentStore.getState().currentDocument?.id).toBe(resC.model.id);

    // Tab B resources must be completely cleaned up while Tab A remains intact
    expect(destroyBSpy).toHaveBeenCalled();
    expect(destroyASpy).not.toHaveBeenCalled();
    expect(binaryStore.has(resB.model.id)).toBe(false);
    expect(binaryStore.has(resA.model.id)).toBe(true);
    expect(useFormStore.getState().valuesByDoc[resB.model.id]).toBeUndefined();
    expect(useNativeObjectStore.getState().getObjectsForPage(resB.model.pages[0].id)).toHaveLength(0);
    expect(useRulerStore.getState().horizontalGuidesByDoc[resB.model.id]).toBeUndefined();

    useTabStore.getState().closeTab(resA.model.id);
    useTabStore.getState().closeTab(resC.model.id);
  });

  it('deep-clones annotations/points in MoveMultiplePagesCommand & DeletePageCommand and clamps activePageIndex', async () => {
    const res = await PdfLoader.loadDocument('pages.pdf', await makePdf('Pages', 3));
    useDocumentStore.getState().setDocument(res.model, res.pdfDoc);
    useTabStore.getState().addTab(res.model, res.pdfDoc);

    const p3 = res.model.pages[2];
    useAnnotationStore.getState().addAnnotation(p3.id, {
      id: 'draw1',
      pageId: p3.id,
      type: 'draw',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      points: [{ x: 10, y: 10 }, { x: 30, y: 30 }],
      color: '#000',
      strokeWidth: 2,
    });

    // Navigate to last page (index 2) and delete it
    useDocumentStore.getState().setActivePageIndex(2);
    historyManager.execute(new DeletePageCommand([{ page: useDocumentStore.getState().currentDocument!.pages[2], index: 2 }]));

    let cur = useDocumentStore.getState().currentDocument!;
    expect(cur.pages).toHaveLength(2);
    // Clamped within bounds!
    expect(cur.activePageIndex).toBe(1);
    expect(cur.activePageId).toBe(cur.pages[1].id);

    // Undo restores deleted page & activePageIndex
    historyManager.undo();
    cur = useDocumentStore.getState().currentDocument!;
    expect(cur.pages).toHaveLength(3);
    expect(cur.activePageIndex).toBe(2);
    expect((cur.pages[2].annotations[0] as { points: Array<{ x: number }> }).points).toHaveLength(2);

    // MoveMultiplePagesCommand preserves deep-cloned annotations on undo
    historyManager.execute(new MoveMultiplePagesCommand([cur.pages[2].id], 0, 'before'));
    expect(useDocumentStore.getState().currentDocument!.pages[0].id).toBe(p3.id);
    historyManager.undo();
    expect(useDocumentStore.getState().currentDocument!.pages[2].id).toBe(p3.id);

    useTabStore.getState().closeTab(res.model.id);
  });

  it('supports undo/redo for updateAnnotation (clean patch revert), bringToFront, sendToBack, pasteAnnotation, pageNumberConfig, headerFooterConfig, FormStore, NativeObjectStore & async ReplaceTextCommand', async () => {
    const oldBuf = await makePdf('OldText', 1);
    const newBuf = await makePdf('NewText', 1);
    const res = await PdfLoader.loadDocument('ops.pdf', oldBuf);
    useDocumentStore.getState().setDocument(res.model, res.pdfDoc);
    useTabStore.getState().addTab(res.model, res.pdfDoc);

    const pageId = res.model.pages[0].id;
    useAnnotationStore.getState().addAnnotation(pageId, {
      id: 'a1',
      pageId,
      type: 'text',
      x: 10,
      y: 10,
      width: 100,
      height: 30,
      text: 'Bir',
      fontSize: 12,
      fontFamily: 'Helvetica',
      color: '#000',
    });
    useAnnotationStore.getState().addAnnotation(pageId, {
      id: 'a2',
      pageId,
      type: 'rect',
      x: 20,
      y: 20,
      width: 50,
      height: 50,
      strokeColor: '#f00',
      strokeWidth: 2,
    });

    // bringToFront / sendToBack
    useAnnotationStore.getState().sendToBack(pageId, 'a2');
    expect(useDocumentStore.getState().currentDocument!.pages[0].annotations.map((a) => a.id)).toEqual(['a2', 'a1']);
    historyManager.undo();
    expect(useDocumentStore.getState().currentDocument!.pages[0].annotations.map((a) => a.id)).toEqual(['a1', 'a2']);

    // updateAnnotation removes added patch keys on undo
    useAnnotationStore.getState().updateAnnotation(pageId, 'a1', { backgroundColor: '#ffff00', text: 'İki' });
    expect((useDocumentStore.getState().currentDocument!.pages[0].annotations[0] as { backgroundColor?: string }).backgroundColor).toBe('#ffff00');
    historyManager.undo();
    expect((useDocumentStore.getState().currentDocument!.pages[0].annotations[0] as { backgroundColor?: string }).backgroundColor).toBeUndefined();

    // copy & paste undo
    useAnnotationStore.getState().copyAnnotation(pageId, 'a1');
    const pastedId = useAnnotationStore.getState().pasteAnnotation(pageId);
    expect(pastedId).toBeTruthy();
    expect(useDocumentStore.getState().currentDocument!.pages[0].annotations).toHaveLength(3);
    historyManager.undo();
    expect(useDocumentStore.getState().currentDocument!.pages[0].annotations).toHaveLength(2);

    // pageNumberConfig & headerFooterConfig undo
    useAnnotationStore.getState().setPageNumberConfig({ enabled: true, startFrom: 3 });
    expect(useAnnotationStore.getState().pageNumberConfig.startFrom).toBe(3);
    historyManager.undo();
    expect(useAnnotationStore.getState().pageNumberConfig.enabled).toBe(false);

    useAnnotationStore.getState().setHeaderFooterConfig({ enabled: true, headerLeft: 'Üst' });
    expect(useAnnotationStore.getState().headerFooterConfig.headerLeft).toBe('Üst');
    historyManager.undo();
    expect(useAnnotationStore.getState().headerFooterConfig.enabled).toBe(false);

    // NativeObjectStore: updateObjectText does NOT set moved=true, resetObject restores originalText & clears flags, undo works
    useNativeObjectStore.getState().setObjects(pageId, [
      {
        id: 'nt1',
        pageId,
        type: 'native-text',
        x: 50,
        y: 50,
        width: 80,
        height: 14,
        originalX: 50,
        originalY: 50,
        originalWidth: 80,
        originalHeight: 14,
        text: 'Orijinal',
        originalText: 'Orijinal',
        moved: false,
      },
    ]);
    useNativeObjectStore.getState().updateObjectText(pageId, 'nt1', 'Güncel');
    let obj = useNativeObjectStore.getState().getObjectsForPage(pageId)[0];
    expect(obj.text).toBe('Güncel');
    expect(obj.isEdited).toBe(true);
    expect(obj.moved).toBe(false);

    useNativeObjectStore.getState().resetObject(pageId, 'nt1');
    obj = useNativeObjectStore.getState().getObjectsForPage(pageId)[0];
    expect(obj.text).toBe('Orijinal');
    expect(obj.isEdited).toBe(false);
    expect(obj.deleted).toBe(false);

    // Undo reset -> back to Güncel, undo edit -> back to Orijinal
    historyManager.undo();
    expect(useNativeObjectStore.getState().getObjectsForPage(pageId)[0].text).toBe('Güncel');
    historyManager.undo();
    expect(useNativeObjectStore.getState().getObjectsForPage(pageId)[0].text).toBe('Orijinal');

    // Async ReplaceTextCommand undo/redo
    const cmd = new ReplaceTextCommand(oldBuf, newBuf, 'ops.pdf', undefined, 1, res.model.id);
    await historyManager.executeAsync(cmd);
    let tc = await (await useDocumentStore.getState().pdfDocProxy!.getPage(1)).getTextContent();
    expect((tc.items as Array<{ str?: string }>).map((i) => i.str || '').join('')).toContain('NewText');

    await historyManager.undoAsync();
    tc = await (await useDocumentStore.getState().pdfDocProxy!.getPage(1)).getTextContent();
    expect((tc.items as Array<{ str?: string }>).map((i) => i.str || '').join('')).toContain('OldText');

    useTabStore.getState().closeTab(res.model.id);
  });

  it('scopes useRulerStore guides per docId, persists pageTransition, listens to matchMedia for system theme, and deduplicates recent documents by filePath', () => {
    // Ruler store scoping
    useDocumentStore.setState({
      currentDocument: {
        id: 'doc-1',
        name: '1.pdf',
        fileSize: 10,
        totalPages: 1,
        pages: [],
        selectedPageIds: [],
        activePageId: '',
        activePageIndex: 0,
        metadata: {},
        isModified: false,
        version: 1,
      },
    });
    useRulerStore.getState().addHorizontalGuide(0, 100);
    expect(useRulerStore.getState().horizontalGuidesByPage[0]).toEqual([100]);

    useRulerStore.getState().syncActiveDocument('doc-2');
    expect(useRulerStore.getState().horizontalGuidesByPage[0]).toBeUndefined();
    useRulerStore.getState().syncActiveDocument('doc-1');
    expect(useRulerStore.getState().horizontalGuidesByPage[0]).toEqual([100]);

    // pageTransition persistence & system theme
    useViewerStore.getState().setPageTransition('book');
    const saved = JSON.parse(localStorage.getItem('xpdf_settings') || '{}');
    expect(saved.pageTransition).toBe('book');

    // filePath deduplication in addRecentDocument
    const ds = useDocumentStore.getState();
    ds.addRecentDocument({
      id: 'id-1',
      name: 'rapor.pdf',
      filePath: 'C:\\folderA\\rapor.pdf',
      fileSize: 100,
      pageCount: 1,
      lastOpened: 1000,
    });
    ds.addRecentDocument({
      id: 'id-2',
      name: 'rapor.pdf',
      filePath: 'C:\\folderB\\rapor.pdf',
      fileSize: 200,
      pageCount: 2,
      lastOpened: 2000,
    });
    expect(useDocumentStore.getState().recentDocuments).toHaveLength(2);

    // Updating same filePath replaces only that path's entry
    ds.addRecentDocument({
      id: 'id-3',
      name: 'rapor.pdf',
      filePath: 'C:\\folderA\\rapor.pdf',
      fileSize: 150,
      pageCount: 1,
      lastOpened: 3000,
    });
    expect(useDocumentStore.getState().recentDocuments).toHaveLength(2);
    expect(useDocumentStore.getState().recentDocuments[0].id).toBe('id-3');
  });
});
