import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type * as pdfjsLib from 'pdfjs-dist';
import { ExtractPagesModal } from '../../page-manager/ExtractPagesModal';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { historyManager } from '@/core/history/command-manager';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PdfDocumentModel } from '@/types/document';

function makeMultiPageDoc(): PdfDocumentModel {
  return {
    id: 'src_doc',
    name: 'kaynak.pdf',
    fileSize: 4096,
    totalPages: 3,
    pages: [1, 2, 3].map((num, idx) => ({
      id: `src_doc_p${num}`,
      sourceDocId: 'src_doc',
      sourcePageIndex: idx,
      displayPageNumber: num,
      rotation: 0,
      width: 595,
      height: 842,
      aspectRatio: 595 / 842,
      annotations: [],
    })),
    selectedPageIds: ['src_doc_p2'],
    activePageId: 'src_doc_p2',
    activePageIndex: 1,
    metadata: {},
    isModified: false,
    version: 1,
  };
}

const dummyProxy = { numPages: 3 } as unknown as pdfjsLib.PDFDocumentProxy;

describe('ExtractPagesModal', () => {
  const originalElectronAPI = window.electronAPI;

  beforeEach(() => {
    historyManager.clear();
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
    useUIStore.setState({ isExtractPagesModalOpen: false, toasts: [] });
  });

  afterEach(() => {
    cleanup();
    window.electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('does NOT fall back to anchor download or delete source pages when Electron save is canceled', async () => {
    const srcDoc = makeMultiPageDoc();
    useDocumentStore.getState().setDocument(srcDoc, dummyProxy);
    useTabStore.getState().addTab(srcDoc, dummyProxy);
    useUIStore.getState().setExtractPagesModalOpen(true);

    vi.spyOn(PdfAssembler, 'extractPages').mockResolvedValue({
      mode: 'single',
      name: 'kaynak_sayfa_2.pdf',
      buffer: new ArrayBuffer(16),
      pageCount: 1,
    });

    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true, filePath: null });
    const saveFile = vi.fn();
    window.electronAPI = {
      isElectron: true,
      platform: 'win32',
      showSaveDialog,
      saveFile,
    } as unknown as typeof window.electronAPI;

    render(<ExtractPagesModal />);

    // Enable deleteAfter checkbox
    const deleteCheckbox = screen.getByRole('checkbox');
    fireEvent.click(deleteCheckbox);
    expect((deleteCheckbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByText('PDF Olarak Kaydet'));

    await waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1));
    expect(saveFile).not.toHaveBeenCalled();
    // Source document still has all 3 pages and modal stays open
    expect(useDocumentStore.getState().currentDocument?.pages).toHaveLength(3);
    expect(useUIStore.getState().isExtractPagesModalOpen).toBe(true);
  });

  it('deletes extracted page from SOURCE doc BEFORE switching active doc/tab on new-tab + deleteAfter', async () => {
    const srcDoc = makeMultiPageDoc();
    useDocumentStore.getState().setDocument(srcDoc, dummyProxy);
    useTabStore.getState().addTab(srcDoc, dummyProxy);
    useUIStore.getState().setExtractPagesModalOpen(true);

    vi.spyOn(PdfAssembler, 'extractPages').mockResolvedValue({
      mode: 'single',
      name: 'kaynak_sayfa_2.pdf',
      buffer: new ArrayBuffer(16),
      pageCount: 1,
    });

    const newModel: PdfDocumentModel = {
      id: 'new_doc',
      name: 'kaynak_sayfa_2.pdf',
      fileSize: 512,
      totalPages: 1,
      pages: [
        {
          id: 'new_doc_p1',
          sourceDocId: 'new_doc',
          sourcePageIndex: 0,
          displayPageNumber: 1,
          rotation: 0,
          width: 595,
          height: 842,
          aspectRatio: 595 / 842,
          annotations: [],
        },
      ],
      selectedPageIds: ['new_doc_p1'],
      activePageId: 'new_doc_p1',
      activePageIndex: 0,
      metadata: {},
      isModified: false,
      version: 1,
    };
    const newProxy = { numPages: 1 } as unknown as pdfjsLib.PDFDocumentProxy;
    vi.spyOn(PdfLoader, 'loadDocument').mockResolvedValue({
      model: newModel,
      pdfDoc: newProxy,
    });

    render(<ExtractPagesModal />);
    fireEvent.click(screen.getByRole('checkbox')); // deleteAfter = true
    fireEvent.click(screen.getByText('Yeni Sekmede Aç'));

    await waitFor(() => expect(useTabStore.getState().tabs).toHaveLength(2));

    const sourceTab = useTabStore.getState().tabs.find((t) => t.id === 'src_doc');
    const extractedTab = useTabStore.getState().tabs.find((t) => t.id === 'new_doc');

    // Source tab had page 2 deleted (2 pages remaining), new extracted tab kept its 1 page cleanly
    expect(sourceTab?.model.pages.map((p) => p.id)).toEqual(['src_doc_p1', 'src_doc_p3']);
    expect(extractedTab?.model.pages).toHaveLength(1);
    expect(extractedTab?.model.isModified).toBe(false);
  });
});
