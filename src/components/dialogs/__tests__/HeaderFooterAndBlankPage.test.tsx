import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import type * as pdfjsLib from 'pdfjs-dist';
import { HeaderFooterModal } from '../HeaderFooterModal';
import { InsertBlankPageModal } from '../InsertBlankPageModal';
import { useUIStore } from '@/store/ui-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfDocumentModel } from '@/types/document';

function makeDoc(id: string): PdfDocumentModel {
  return {
    id,
    name: 'belge.pdf',
    fileSize: 2048,
    totalPages: 3,
    pages: [1, 2, 3].map((n, idx) => ({
      id: `${id}_p${n}`,
      sourceDocId: id,
      sourcePageIndex: idx,
      displayPageNumber: n,
      rotation: 0,
      width: 595,
      height: 842,
      aspectRatio: 595 / 842,
      annotations: [],
    })),
    selectedPageIds: [`${id}_p1`],
    activePageId: `${id}_p1`,
    activePageIndex: 0,
    metadata: {},
    isModified: false,
    version: 1,
  };
}

const dummyProxy = { numPages: 3 } as unknown as pdfjsLib.PDFDocumentProxy;

describe('HeaderFooterModal & InsertBlankPageModal', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
    useUIStore.setState({
      isHeaderFooterModalOpen: false,
      isInsertBlankPageModalOpen: false,
      pendingBlankPageInsertIndex: null,
      toasts: [],
    });
    useAnnotationStore.setState({
      headerFooterConfig: {
        enabled: false,
        fontSize: 9,
        color: '#64748b',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('HeaderFooterModal updates headerFooterConfig and marks document modified, and resets cleanly', () => {
    const doc = makeDoc('hf_doc');
    useDocumentStore.getState().setDocument(doc, dummyProxy);
    useTabStore.getState().addTab(doc, dummyProxy);
    useUIStore.getState().setHeaderFooterModalOpen(true);

    render(<HeaderFooterModal />);

    const headerCenterInput = screen.getByPlaceholderText('Örn: Yıllık Rapor');
    fireEvent.change(headerCenterInput, { target: { value: 'Gizli Rapor' } });
    fireEvent.click(screen.getByText('Uygula'));

    expect(useAnnotationStore.getState().headerFooterConfig.enabled).toBe(true);
    expect(useAnnotationStore.getState().headerFooterConfig.headerCenter).toBe('Gizli Rapor');
    expect(useDocumentStore.getState().currentDocument?.isModified).toBe(true);
    expect(useUIStore.getState().isHeaderFooterModalOpen).toBe(false);

    // Reopen and reset/disable
    act(() => {
      useUIStore.getState().setHeaderFooterModalOpen(true);
    });
    fireEvent.click(screen.getByText('Kaldır / Sıfırla'));
    expect(useAnnotationStore.getState().headerFooterConfig.enabled).toBe(false);
    expect(useAnnotationStore.getState().headerFooterConfig.headerCenter).toBeUndefined();
  });

  it('InsertBlankPageModal respects user clicking "En Başa" even when pendingBlankPageInsertIndex is set', async () => {
    const doc = makeDoc('ins_doc');
    useDocumentStore.getState().setDocument(doc, dummyProxy);
    useTabStore.getState().addTab(doc, dummyProxy);
    useUIStore.getState().setInsertBlankPageModalOpen(true, 2);

    const insertSpy = vi.spyOn(PdfAssembler, 'insertBlankPage').mockResolvedValue({
      model: doc,
      pdfDoc: dummyProxy,
    });

    render(<InsertBlankPageModal />);

    fireEvent.click(screen.getByText('En Başa'));
    fireEvent.click(screen.getByText(/Boş Sayfa Ekle \(Konum: 1\. sıra\)/));

    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1));
    expect(insertSpy.mock.calls[0][1]).toBe(0);
  });
});
