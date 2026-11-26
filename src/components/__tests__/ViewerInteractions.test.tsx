import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { BottomBar } from '../layout/BottomBar';
import { DropZone } from '../common/DropZone';
import { AnnotationLayer } from '../viewer/AnnotationLayer';
import { App } from '@/App';
import { useUIStore } from '@/store/ui-store';
import {
  resolveIsDark,
  applyThemeToDocument,
  getReadingFilter,
  getReadingThemeLabel,
} from '../common/theme-utils';
import { syncActiveTool } from '../common/pdf-actions';
import {
  addBookmarkNode,
  createBookmarkItem,
  deleteBookmarkNode,
  filterBookmarks,
  findActiveBookmarkId,
  moveBookmarkNode,
  updateBookmarkNode,
} from '../sidebar/bookmark-storage';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import { ShapeAnnotation } from '@/types/annotations';

function createPage(index = 0): PdfPageModel {
  return {
    id: `doc_page_${index + 1}`,
    sourceDocId: 'doc_1',
    sourcePageIndex: index,
    displayPageNumber: index + 1,
    rotation: 0,
    width: 600,
    height: 800,
    aspectRatio: 0.75,
    annotations: [],
  };
}

function createDoc(pageCount = 15): PdfDocumentModel {
  const pages = Array.from({ length: pageCount }, (_, i) => createPage(i));
  return {
    id: 'doc_1',
    name: 'belge.pdf',
    fileSize: 1024,
    totalPages: pageCount,
    pages,
    selectedPageIds: [pages[0].id],
    activePageId: pages[0].id,
    activePageIndex: 0,
    metadata: {},
    isModified: false,
    version: 1,
  };
}

describe('Theme utilities, activeTool sync, Bookmarks, BottomBar, and AnnotationLayer', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    useViewerStore.setState({ activeTool: 'select', theme: 'dark', zoom: 1.0, fitMode: 'none' });
    useAnnotationStore.setState({ activeTool: 'select', selectedAnnotationId: null });
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('resolveIsDark respects system theme via matchMedia', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(resolveIsDark('system')).toBe(true);
    expect(applyThemeToDocument('system')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(getReadingFilter('dark')).toContain('invert(0.9)');
    expect(getReadingThemeLabel('high-contrast')).toBe('Yüksek Kontrast');
  });

  it('syncActiveTool updates both useViewerStore and useAnnotationStore', () => {
    syncActiveTool('highlight');
    expect(useViewerStore.getState().activeTool).toBe('highlight');
    expect(useAnnotationStore.getState().activeTool).toBe('highlight');

    syncActiveTool('hand');
    expect(useViewerStore.getState().activeTool).toBe('hand');
    expect(useAnnotationStore.getState().activeTool).toBe('hand');
  });

  it('bookmark-storage supports add, rename, move, indent, filter, active lookup, and delete', () => {
    const b1 = createBookmarkItem('Bölüm 1: Giriş', 0);
    const b2 = createBookmarkItem('Bölüm 2: Gelişme', 4);
    let tree = addBookmarkNode([], null, b1);
    tree = addBookmarkNode(tree, null, b2);
    expect(tree).toHaveLength(2);

    tree = updateBookmarkNode(tree, b1.id, { title: 'Bölüm 1: Başlangıç' });
    expect(tree[0].title).toBe('Bölüm 1: Başlangıç');

    tree = moveBookmarkNode(tree, b2.id, 'indent');
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);

    expect(findActiveBookmarkId(tree, 5)).toBe(b2.id);
    expect(filterBookmarks(tree, 'gelişme')).toHaveLength(1);

    tree = deleteBookmarkNode(tree, b2.id);
    expect(tree[0].children).toHaveLength(0);
  });

  it('BottomBar lets users type multi-digit page numbers and displays zoom %', () => {
    const doc = createDoc(25);
    useDocumentStore.setState({ currentDocument: doc });
    useViewerStore.setState({ zoom: 1.25 });

    render(<BottomBar />);
    expect(screen.getByText('125%')).toBeTruthy();

    const input = screen.getByLabelText('Sayfa Numarası') as HTMLInputElement;
    expect(input.value).toBe('1');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '14' } });
    expect(input.value).toBe('14');
    // Has not jumped before Enter/blur
    expect(useDocumentStore.getState().currentDocument?.activePageIndex).toBe(0);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useDocumentStore.getState().currentDocument?.activePageIndex).toBe(13);
  });

  it('AnnotationLayer renders directional arrows with markers and erases shapes with eraser tool', () => {
    const arrowAnn: ShapeAnnotation = {
      id: 'arr_1',
      pageId: 'doc_page_1',
      type: 'arrow',
      x: 200,
      y: 200,
      width: -100,
      height: -80,
      strokeColor: '#ef4444',
      strokeWidth: 3,
      opacity: 1,
    };
    const doc = createDoc(1);
    doc.pages[0].annotations = [arrowAnn];
    useDocumentStore.setState({ currentDocument: doc });

    const { container, rerender } = render(<AnnotationLayer page={doc.pages[0]} scale={1} pageIndex={0} />);

    const marker = container.querySelector('#arrow-head-doc_page_1-arr_1');
    expect(marker).toBeTruthy();

    const lines = container.querySelectorAll('line');
    const visibleLine = lines[lines.length - 1];
    expect(visibleLine.getAttribute('x1')).toBe('200');
    expect(visibleLine.getAttribute('y1')).toBe('200');
    expect(visibleLine.getAttribute('x2')).toBe('100');
    expect(visibleLine.getAttribute('y2')).toBe('120');

    // Switch to eraser tool and click along the arrow path (150, 160)
    act(() => {
      syncActiveTool('eraser');
    });
    const layer = container.querySelector('#ann-layer-doc_page_1') as HTMLElement;
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    rerender(<AnnotationLayer page={useDocumentStore.getState().currentDocument!.pages[0]} scale={1} pageIndex={0} />);
    fireEvent.mouseDown(layer, { button: 0, clientX: 150, clientY: 160 });

    expect(useDocumentStore.getState().currentDocument?.pages[0].annotations).toHaveLength(0);
  });

  it('DropZone ignores internal thumbnail drags and does not show external drop overlay', () => {
    render(
      <DropZone>
        <div>workspace</div>
      </DropZone>
    );

    const root = screen.getByText('workspace').parentElement!;
    fireEvent.dragOver(root, {
      dataTransfer: { types: ['text/plain'] },
    });
    expect(screen.queryByText('PDF Dosyasını Buraya Bırakın')).toBeNull();

    fireEvent.dragOver(root, {
      dataTransfer: { types: ['Files'] },
    });
    expect(screen.getByText('PDF Dosyasını Buraya Bırakın')).toBeTruthy();
  });

  it('App Escape closes HeaderFooterModal, ExtractTextModal, SettingsModal and exits fullscreen without blocking', () => {
    if (typeof globalThis.matchMedia === 'undefined') {
      vi.stubGlobal('matchMedia', () => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }

    render(<App />);

    act(() => {
      useUIStore.getState().setHeaderFooterModalOpen(true);
      useUIStore.getState().setExtractTextModalOpen(true);
      useUIStore.getState().setSettingsModalOpen(true);
    });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useUIStore.getState().isHeaderFooterModalOpen).toBe(false);
    expect(useUIStore.getState().isExtractTextModalOpen).toBe(false);
    expect(useUIStore.getState().isSettingsModalOpen).toBe(false);

    act(() => {
      useUIStore.getState().setFullscreenPresentation(true);
    });
    expect(useUIStore.getState().isFullscreenPresentation).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUIStore.getState().isFullscreenPresentation).toBe(false);
  });
});
