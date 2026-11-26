import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { PdfViewer } from '../viewer/PdfViewer';
import { isAcroCheckboxChecked, isAllowedExternalUrl } from '../viewer/PageView';
import { snapCoordinatesToGuides } from '../viewer/RulerGuideOverlay';
import { useViewerUIState } from '../viewer/viewer-ui-state';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useRulerStore } from '@/store/ruler-store';
import { PdfDocumentModel } from '@/types/document';
import type * as pdfjsLib from 'pdfjs-dist';

function installBrowserPolyfills() {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function () {};
  }
}

function makeDoc(pageCount: number): PdfDocumentModel {
  const pages = Array.from({ length: pageCount }, (_, idx) => ({
    id: `doc_p_${idx + 1}`,
    sourceDocId: 'doc_1',
    sourcePageIndex: idx,
    displayPageNumber: idx + 1,
    rotation: 0,
    width: 595.28,
    height: 841.89,
    aspectRatio: 595.28 / 841.89,
    annotations: [],
  }));
  return {
    id: 'doc_1',
    name: 'test.pdf',
    fileSize: 2048,
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

describe('PdfViewer hook safety, view modes, and PageView security helpers', () => {
  beforeEach(() => {
    installBrowserPolyfills();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useDocumentStore.setState({ currentDocument: null, pdfDocProxy: null });
    useViewerStore.setState({
      viewMode: 'continuous',
      fitMode: 'none',
      zoom: 1.0,
      readingTheme: 'default',
      activeTool: 'select',
    });
    useViewerUIState.setState({ twoPageCoverOffset: false, inlineNativeEdit: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('transitions cleanly from null document to loaded document and back without violating Rules of Hooks', () => {
    const { container, rerender } = render(<PdfViewer />);
    expect(container.innerHTML).toBe('');

    const doc = makeDoc(3);
    const fakeProxy = {
      numPages: 3,
      getPage: vi.fn().mockRejectedValue(new Error('not needed in stub')),
    } as unknown as pdfjsLib.PDFDocumentProxy;

    act(() => {
      useDocumentStore.getState().setDocument(doc, fakeProxy);
    });
    rerender(<PdfViewer />);
    expect(container.querySelector('#pdf-viewer-root')).toBeTruthy();

    act(() => {
      useDocumentStore.getState().closeDocument();
    });
    rerender(<PdfViewer />);
    expect(container.innerHTML).toBe('');
  });

  it('supports cover-page offset in two-page view mode', () => {
    const doc = makeDoc(4);
    const fakeProxy = {
      numPages: 4,
      getPage: vi.fn().mockRejectedValue(new Error('stub')),
    } as unknown as pdfjsLib.PDFDocumentProxy;

    useViewerStore.setState({ viewMode: 'two-page' });
    useDocumentStore.getState().setDocument(doc, fakeProxy);

    const { container } = render(<PdfViewer />);
    // Default two-page without cover offset on page 0 renders pages 0 and 1
    expect(container.querySelectorAll('[data-page-index]').length).toBe(2);

    // Enable cover offset on page 0 -> renders only cover page 0
    act(() => {
      useViewerUIState.getState().setTwoPageCoverOffset(true);
    });
    expect(container.querySelectorAll('[data-page-index]').length).toBe(1);
    expect(container.querySelector('[data-page-index="0"]')).toBeTruthy();

    // Advance to page 1 -> pairs pages 1 and 2
    act(() => {
      useDocumentStore.getState().setActivePageIndex(1);
    });
    expect(container.querySelectorAll('[data-page-index]').length).toBe(2);
    expect(container.querySelector('[data-page-index="1"]')).toBeTruthy();
    expect(container.querySelector('[data-page-index="2"]')).toBeTruthy();
  });

  it('isAcroCheckboxChecked handles PDF.js Off string and booleans accurately', () => {
    expect(isAcroCheckboxChecked('Off')).toBe(false);
    expect(isAcroCheckboxChecked('off')).toBe(false);
    expect(isAcroCheckboxChecked('')).toBe(false);
    expect(isAcroCheckboxChecked(false)).toBe(false);
    expect(isAcroCheckboxChecked('false')).toBe(false);
    expect(isAcroCheckboxChecked('Yes')).toBe(true);
    expect(isAcroCheckboxChecked('On')).toBe(true);
    expect(isAcroCheckboxChecked(true)).toBe(true);
  });

  it('isAllowedExternalUrl allows only http/https and rejects javascript/file/data protocols', () => {
    expect(isAllowedExternalUrl('https://example.com/path?a=1')).toBe('https://example.com/path?a=1');
    expect(isAllowedExternalUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBeNull();
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBeNull();
    expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('snapCoordinatesToGuides snaps to guides, center, and grid when enabled', () => {
    useRulerStore.setState({
      snapToGuides: true,
      snapToGrid: true,
      gridSizePt: 20,
      horizontalGuidesByPage: { 0: [120] },
      verticalGuidesByPage: { 0: [80] },
    });

    const snappedGuide = snapCoordinatesToGuides(83, 117, 0, 500, 700);
    expect(snappedGuide).toEqual({ xPt: 80, yPt: 120 });

    const snappedGrid = snapCoordinatesToGuides(42, 63, 0, 500, 700);
    expect(snappedGrid).toEqual({ xPt: 40, yPt: 60 });
  });
});
