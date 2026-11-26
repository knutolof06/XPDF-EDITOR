import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfDocumentModel } from '@/types/document';
import type * as pdfjsLib from 'pdfjs-dist';

const makeMockDoc = (id: string, name: string): PdfDocumentModel => ({
  id,
  name,
  fileSize: 1024,
  totalPages: 1,
  pages: [
    {
      id: `${id}_page_1`,
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
  selectedPageIds: [`${id}_page_1`],
  activePageId: `${id}_page_1`,
  activePageIndex: 0,
  metadata: {},
  isModified: false,
  version: 1,
});

const ThrowingChild: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Render crash simulation');
  }
  return <div>Sağlıklı içerik</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useTabStore.setState({ tabs: [], activeTabId: null, clipboardPages: [] });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Turkish crash recovery UI on error and recovers on retry', () => {
    let shouldThrow = true;
    const ControlledChild = () => <ThrowingChild shouldThrow={shouldThrow} />;

    const { rerender } = render(
      <ErrorBoundary scope="viewer">
        <ControlledChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Beklenmeyen Bir Hata Oluştu')).toBeTruthy();
    expect(screen.getByText('Render crash simulation')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Tekrar Dene'));
    rerender(
      <ErrorBoundary scope="viewer">
        <ControlledChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Sağlıklı içerik')).toBeTruthy();
  });

  it('closes crashed tab and switches to remaining tab when "Sekmeyi Kapat" is clicked', () => {
    const doc1 = makeMockDoc('doc1', 'ilk.pdf');
    const doc2 = makeMockDoc('doc2', 'bozuk.pdf');
    const fakeProxy = {} as unknown as pdfjsLib.PDFDocumentProxy;

    useTabStore.getState().addTab(doc1, fakeProxy);
    useTabStore.getState().addTab(doc2, fakeProxy);
    useDocumentStore.getState().setDocument(doc2, fakeProxy);

    render(
      <ErrorBoundary scope="viewer">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );

    const closeTabBtn = screen.getByText('Sekmeyi Kapat');
    fireEvent.click(closeTabBtn);

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['doc1']);
    expect(useDocumentStore.getState().currentDocument?.id).toBe('doc1');
  });
});
