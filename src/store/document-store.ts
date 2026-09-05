import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { PdfDocumentModel, RecentDocumentItem } from '@/types/document';
import * as pdfjsLib from 'pdfjs-dist';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';

interface DocumentState {
  currentDocument: PdfDocumentModel | null;
  pdfDocProxy: pdfjsLib.PDFDocumentProxy | null;
  recentDocuments: RecentDocumentItem[];
  isLoading: boolean;
  loadingProgress: number;
  loadingError: string | null;

  // Actions
  setDocument: (model: PdfDocumentModel, pdfDoc: pdfjsLib.PDFDocumentProxy) => void;
  closeDocument: () => void;
  setActivePageIndex: (index: number) => void;
  setActivePageId: (id: string) => void;
  selectPages: (pageIds: string[], multi?: boolean) => void;
  selectAllPages: () => void;
  clearPageSelection: () => void;
  rotatePage: (pageId: string, angle: number) => void;
  rotateSelectedPages: (angle: number) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  moveMultiplePages: (pageIds: string[], targetIndex: number, position: 'before' | 'after') => void;
  deletePage: (pageId: string) => void;
  setLoading: (isLoading: boolean, progress?: number) => void;
  setError: (error: string | null) => void;
  addRecentDocument: (item: RecentDocumentItem) => void;
  removeRecentDocument: (id: string) => void;
  clearRecentDocuments: () => void;
}

const loadRecentDocuments = (): RecentDocumentItem[] => {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem('xpdf_recent_documents');
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return [];
};

export const useDocumentStore = create<DocumentState>()(
  immer((set) => ({
    currentDocument: null,
    pdfDocProxy: null,
    recentDocuments: loadRecentDocuments(),
    isLoading: false,
    loadingProgress: 0,
    loadingError: null,

    setDocument: (model, pdfDoc) =>
      set((state) => {
        state.currentDocument = model;
        (state as any).pdfDocProxy = pdfDoc;
        state.isLoading = false;
        state.loadingError = null;
      }),

    closeDocument: () =>
      set((state) => {
        if (state.currentDocument) {
          clearDocumentCaches(state.currentDocument.id);
        }
        cancelActivePreload();
        state.currentDocument = null;
        state.pdfDocProxy = null;
        state.loadingError = null;
      }),

    setActivePageIndex: (index) =>
      set((state) => {
        if (!state.currentDocument) return;
        if (index >= 0 && index < state.currentDocument.pages.length) {
          state.currentDocument.activePageIndex = index;
          state.currentDocument.activePageId = state.currentDocument.pages[index].id;
          state.currentDocument.selectedPageIds = [state.currentDocument.pages[index].id];
        }
      }),

    setActivePageId: (id) =>
      set((state) => {
        if (!state.currentDocument) return;
        const idx = state.currentDocument.pages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          state.currentDocument.activePageIndex = idx;
          state.currentDocument.activePageId = id;
          state.currentDocument.selectedPageIds = [id];
        }
      }),

    selectPages: (pageIds, multi = false) =>
      set((state) => {
        if (!state.currentDocument) return;
        if (multi) {
          const current = new Set(state.currentDocument.selectedPageIds);
          pageIds.forEach((id) => {
            if (current.has(id)) current.delete(id);
            else current.add(id);
          });
          state.currentDocument.selectedPageIds = Array.from(current);
        } else {
          state.currentDocument.selectedPageIds = pageIds;
        }
      }),

    selectAllPages: () =>
      set((state) => {
        if (!state.currentDocument) return;
        state.currentDocument.selectedPageIds = state.currentDocument.pages.map((p) => p.id);
      }),

    clearPageSelection: () =>
      set((state) => {
        if (!state.currentDocument) return;
        state.currentDocument.selectedPageIds = [];
      }),

    rotatePage: (pageId, angle) =>
      set((state) => {
        if (!state.currentDocument) return;
        const page = state.currentDocument.pages.find((p) => p.id === pageId);
        if (page) {
          page.rotation = (page.rotation + angle + 360) % 360;
          state.currentDocument.isModified = true;
        }
      }),

    rotateSelectedPages: (angle) =>
      set((state) => {
        if (!state.currentDocument) return;
        const selected = new Set(state.currentDocument.selectedPageIds);
        state.currentDocument.pages.forEach((p) => {
          if (selected.has(p.id)) {
            p.rotation = (p.rotation + angle + 360) % 360;
          }
        });
        state.currentDocument.isModified = true;
      }),

    reorderPages: (fromIndex, toIndex) =>
      set((state) => {
        if (!state.currentDocument) return;
        const pages = state.currentDocument.pages;
        if (
          fromIndex < 0 ||
          fromIndex >= pages.length ||
          toIndex < 0 ||
          toIndex >= pages.length
        )
          return;

        const [moved] = pages.splice(fromIndex, 1);
        pages.splice(toIndex, 0, moved);

        pages.forEach((p, idx) => {
          p.displayPageNumber = idx + 1;
        });

        state.currentDocument.isModified = true;
      }),

    moveMultiplePages: (pageIds, targetIndex, position) =>
      set((state) => {
        if (!state.currentDocument || pageIds.length === 0) return;
        const pages = state.currentDocument.pages;
        const targetPage = pages[targetIndex];
        if (!targetPage) return;

        // Preserve relative order of moved pages
        const movingPages = pages.filter((p) => pageIds.includes(p.id));
        const remainingPages = pages.filter((p) => !pageIds.includes(p.id));

        // Find new index of targetPage in remainingPages
        let insertIndex = remainingPages.findIndex((p) => p.id === targetPage.id);
        if (insertIndex === -1) {
          insertIndex = targetIndex;
        } else if (position === 'after') {
          insertIndex += 1;
        }

        remainingPages.splice(insertIndex, 0, ...movingPages);

        remainingPages.forEach((p, idx) => {
          p.displayPageNumber = idx + 1;
        });

        state.currentDocument.pages = remainingPages;
        state.currentDocument.selectedPageIds = pageIds;
        state.currentDocument.isModified = true;
      }),

    deletePage: (pageId) =>
      set((state) => {
        if (!state.currentDocument) return;
        const idx = state.currentDocument.pages.findIndex((p) => p.id === pageId);
        if (idx !== -1) {
          state.currentDocument.pages.splice(idx, 1);
          state.currentDocument.totalPages = state.currentDocument.pages.length;
          
          state.currentDocument.pages.forEach((p, i) => {
            p.displayPageNumber = i + 1;
          });

          if (state.currentDocument.pages.length > 0) {
            const nextIdx = Math.min(idx, state.currentDocument.pages.length - 1);
            state.currentDocument.activePageIndex = nextIdx;
            state.currentDocument.activePageId = state.currentDocument.pages[nextIdx].id;
            state.currentDocument.selectedPageIds = [state.currentDocument.pages[nextIdx].id];
          } else {
            state.currentDocument.activePageIndex = 0;
            state.currentDocument.activePageId = '';
            state.currentDocument.selectedPageIds = [];
          }

          state.currentDocument.isModified = true;
        }
      }),

    setLoading: (isLoading, progress = 0) =>
      set((state) => {
        state.isLoading = isLoading;
        state.loadingProgress = progress;
      }),

    setError: (error) =>
      set((state) => {
        state.loadingError = error;
        state.isLoading = false;
      }),

    addRecentDocument: (item) =>
      set((state) => {
        const filtered = state.recentDocuments.filter((d) => d.name !== item.name && d.id !== item.id);
        const updated = [item, ...filtered].slice(0, 15);
        state.recentDocuments = updated;
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('xpdf_recent_documents', JSON.stringify(updated));
          } catch {
            // ignore
          }
        }
      }),

    removeRecentDocument: (id) =>
      set((state) => {
        const updated = state.recentDocuments.filter((d) => d.id !== id);
        state.recentDocuments = updated;
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('xpdf_recent_documents', JSON.stringify(updated));
          } catch {
            // ignore
          }
        }
      }),

    clearRecentDocuments: () =>
      set((state) => {
        state.recentDocuments = [];
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.removeItem('xpdf_recent_documents');
          } catch {
            // ignore
          }
        }
      }),
  }))
);
