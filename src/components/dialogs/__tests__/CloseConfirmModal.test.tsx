import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type * as pdfjsLib from 'pdfjs-dist';
import { CloseConfirmModal } from '../CloseConfirmModal';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { PdfDocumentModel } from '@/types/document';

function makeDoc(id: string, name: string, filePath?: string): PdfDocumentModel {
  return {
    id,
    name,
    filePath,
    fileSize: 1024,
    totalPages: 1,
    pages: [
      {
        id: `${id}_p1`,
        sourceDocId: id,
        sourcePageIndex: 0,
        displayPageNumber: 1,
        rotation: 0,
        width: 595,
        height: 842,
        aspectRatio: 595 / 842,
        annotations: [],
      },
    ],
    selectedPageIds: [`${id}_p1`],
    activePageId: `${id}_p1`,
    activePageIndex: 0,
    metadata: {},
    isModified: true,
    version: 1,
  };
}

const dummyProxy = { numPages: 1 } as unknown as pdfjsLib.PDFDocumentProxy;

describe('CloseConfirmModal', () => {
  const originalElectronAPI = window.electronAPI;

  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
    useUIStore.setState({
      isCloseConfirmModalOpen: false,
      pendingCloseTabId: null,
      toasts: [],
    });
  });

  afterEach(() => {
    cleanup();
    window.electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('keeps dirty tab open when Electron save dialog is canceled or save fails', async () => {
    const doc1 = makeDoc('doc1', 'unsaved.pdf');
    useTabStore.getState().addTab(doc1, dummyProxy);
    useDocumentStore.getState().setDocument(doc1, dummyProxy);
    useUIStore.getState().setCloseConfirmModalOpen(true, 'doc1');

    vi.spyOn(PdfExporter, 'exportDocumentWithAnnotations').mockResolvedValue(new ArrayBuffer(8));
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true, filePath: null });
    const saveFile = vi.fn();

    window.electronAPI = {
      isElectron: true,
      platform: 'win32',
      showSaveDialog,
      saveFile,
    } as unknown as typeof window.electronAPI;

    render(<CloseConfirmModal />);

    fireEvent.click(screen.getByText('Kaydet ve Kapat'));

    await waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1));
    expect(saveFile).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useDocumentStore.getState().currentDocument?.id).toBe('doc1');
    expect(useUIStore.getState().isCloseConfirmModalOpen).toBe(true);

    // Now test saveFile failure
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\out.pdf' });
    saveFile.mockResolvedValue({ success: false, error: 'Disk hatası' });

    fireEvent.click(screen.getByText('Kaydet ve Kapat'));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useUIStore.getState().isCloseConfirmModalOpen).toBe(true);
  });

  it('does not hijack active document when discarding an inactive tab', () => {
    const doc1 = makeDoc('doc1', 'birinci.pdf');
    const doc2 = makeDoc('doc2', 'ikinci.pdf');
    useTabStore.getState().addTab(doc1, dummyProxy);
    useTabStore.getState().addTab(doc2, dummyProxy);
    // Active tab is doc2; close doc1
    useDocumentStore.getState().setDocument(doc2, dummyProxy);
    useUIStore.getState().setCloseConfirmModalOpen(true, 'doc1');

    render(<CloseConfirmModal />);
    fireEvent.click(screen.getByText('Kaydetmeden Kapat'));

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['doc2']);
    expect(useDocumentStore.getState().currentDocument?.id).toBe('doc2');
  });

  it('switches to adjacent tab rather than remaining[0] when closing active tab', () => {
    const doc1 = makeDoc('doc1', 'bir.pdf');
    const doc2 = makeDoc('doc2', 'iki.pdf');
    const doc3 = makeDoc('doc3', 'uc.pdf');
    useTabStore.getState().addTab(doc1, dummyProxy);
    useTabStore.getState().addTab(doc2, dummyProxy);
    useTabStore.getState().addTab(doc3, dummyProxy);
    // Active is doc3 (index 2); closing doc3 should switch to doc2 (adjacent index 1), not doc1
    useDocumentStore.getState().setDocument(doc3, dummyProxy);
    useUIStore.getState().setCloseConfirmModalOpen(true, 'doc3');

    render(<CloseConfirmModal />);
    fireEvent.click(screen.getByText('Kaydetmeden Kapat'));

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['doc1', 'doc2']);
    expect(useDocumentStore.getState().currentDocument?.id).toBe('doc2');
  });
});
