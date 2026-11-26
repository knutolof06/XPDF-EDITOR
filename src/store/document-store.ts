import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { PdfDocumentModel, RecentDocumentItem } from '@/types/document';
import * as pdfjsLib from 'pdfjs-dist';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';
import { binaryStore } from '@/core/storage/binary-store';
import {
  historyManager,
  MovePageCommand,
  MoveMultiplePagesCommand,
  RotatePageCommand,
  DeletePageCommand,
} from '@/core/history/command-manager';
import { useTabStore } from './tab-store';
import { useAnnotationStore } from './annotation-store';
import { useRulerStore } from './ruler-store';
import { useNativeObjectStore } from './native-object-store';
import { useFormStore } from './form-store';

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
  updatePageGeometry: (pageId: string, geometry: { width: number; height: number; rotation: number }) => void;
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

export function cleanupClosedDocumentResources(
  docId: string,
  pageIds?: string[],
  pdfDocProxy?: pdfjsLib.PDFDocumentProxy | null
): void {
  if (!docId) return;

  const remainingTabs = useTabStore.getState().tabs;
  if (remainingTabs.some((t) => t.id === docId)) {
    return;
  }

  clearDocumentCaches(docId);
  binaryStore.delete(docId);
  historyManager.clear(docId);
  useNativeObjectStore.getState().clearDocObjects(docId, pageIds);
  useFormStore.getState().clearDocValues(docId);
  useAnnotationStore.getState().clearDocState(docId);
  useRulerStore.getState().clearDocGuides(docId);

  if (pdfDocProxy && !remainingTabs.some((t) => t.pdfDocProxy === pdfDocProxy)) {
    try {
      const destroyFn = (pdfDocProxy as { destroy?: () => unknown }).destroy;
      if (typeof destroyFn === 'function') {
        void Promise.resolve(destroyFn.call(pdfDocProxy)).catch(() => {});
      }
    } catch {
      // ignore pdfjs destroy errors
    }
  }
}

export const useDocumentStore = create<DocumentState>()(
  immer((set, get) => ({
    currentDocument: null,
    pdfDocProxy: null,
    recentDocuments: loadRecentDocuments(),
    isLoading: false,
    loadingProgress: 0,
    loadingError: null,

    setDocument: (model, pdfDoc) => {
      const prevDocId = get().currentDocument?.id;
      set((state) => {
        state.currentDocument = model;
        (state as unknown as { pdfDocProxy: pdfjsLib.PDFDocumentProxy | null }).pdfDocProxy = pdfDoc;
        state.isLoading = false;
        state.loadingError = null;
      });

      const tabStore = useTabStore.getState();
      const matchingTab = tabStore.tabs.find((t) => t.id === model.id);
      if (matchingTab) {
        tabStore.updateTabModel(model);
        if (matchingTab.pdfDocProxy !== pdfDoc) {
          useTabStore.setState((s) => {
            const tab = s.tabs.find((t) => t.id === model.id);
            if (tab) {
              (tab as unknown as { pdfDocProxy: pdfjsLib.PDFDocumentProxy }).pdfDocProxy = pdfDoc;
            }
          });
        }
      }

      if (prevDocId !== model.id) {
        useAnnotationStore.getState().syncActiveDocument(model.id);
        useRulerStore.getState().syncActiveDocument(model.id);
      }
    },

    closeDocument: () => {
      const closingDoc = get().currentDocument;
      const closingProxy = get().pdfDocProxy;

      cancelActivePreload();
      set((state) => {
        state.currentDocument = null;
        state.pdfDocProxy = null;
        state.loadingError = null;
      });

      useAnnotationStore.getState().syncActiveDocument(null);
      useRulerStore.getState().syncActiveDocument(null);

      if (closingDoc) {
        cleanupClosedDocumentResources(
          closingDoc.id,
          closingDoc.pages.map((p) => p.id),
          closingProxy
        );
      }
    },

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

    rotatePage: (pageId, angle) => {
      const doc = get().currentDocument;
      if (!doc) return;
      if (!historyManager.isApplying()) {
        historyManager.execute(new RotatePageCommand([pageId], angle, doc.id), doc.id);
        return;
      }
      set((state) => {
        if (!state.currentDocument) return;
        const page = state.currentDocument.pages.find((p) => p.id === pageId);
        if (page) {
          page.rotation = ((page.rotation + angle) % 360 + 360) % 360;
          state.currentDocument.isModified = true;
        }
      });
    },

    rotateSelectedPages: (angle) => {
      const doc = get().currentDocument;
      if (!doc || doc.selectedPageIds.length === 0) return;
      if (!historyManager.isApplying()) {
        historyManager.execute(new RotatePageCommand([...doc.selectedPageIds], angle, doc.id), doc.id);
        return;
      }
      set((state) => {
        if (!state.currentDocument) return;
        const selected = new Set(state.currentDocument.selectedPageIds);
        state.currentDocument.pages.forEach((p) => {
          if (selected.has(p.id)) {
            p.rotation = ((p.rotation + angle) % 360 + 360) % 360;
          }
        });
        state.currentDocument.isModified = true;
      });
    },

    reorderPages: (fromIndex, toIndex) => {
      const doc = get().currentDocument;
      if (!doc) return;
      const len = doc.pages.length;
      if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len || fromIndex === toIndex) {
        return;
      }

      set((state) => {
        if (!state.currentDocument) return;
        const pages = state.currentDocument.pages;
        const activeId = state.currentDocument.activePageId;

        const [moved] = pages.splice(fromIndex, 1);
        pages.splice(toIndex, 0, moved);

        pages.forEach((p, idx) => {
          p.displayPageNumber = idx + 1;
        });

        const newActiveIdx = pages.findIndex((p) => p.id === activeId);
        if (newActiveIdx !== -1) {
          state.currentDocument.activePageIndex = newActiveIdx;
        }
        state.currentDocument.isModified = true;
      });

      if (!historyManager.isApplying()) {
        historyManager.push(new MovePageCommand(fromIndex, toIndex, doc.id), doc.id);
      }
    },

    moveMultiplePages: (pageIds, targetIndex, position) => {
      const doc = get().currentDocument;
      if (!doc || pageIds.length === 0) return;
      if (!historyManager.isApplying()) {
        historyManager.execute(
          new MoveMultiplePagesCommand(pageIds, targetIndex, position, doc.id),
          doc.id
        );
        return;
      }

      set((state) => {
        if (!state.currentDocument || pageIds.length === 0) return;
        const pages = state.currentDocument.pages;
        const targetPage = pages[targetIndex];
        if (!targetPage) return;

        const activeId = state.currentDocument.activePageId;
        const movingPages = pages.filter((p) => pageIds.includes(p.id));
        const remainingPages = pages.filter((p) => !pageIds.includes(p.id));

        let insertIndex = remainingPages.findIndex((p) => p.id === targetPage.id);
        if (insertIndex === -1) {
          insertIndex = Math.max(0, Math.min(targetIndex, remainingPages.length));
        } else if (position === 'after') {
          insertIndex += 1;
        }

        remainingPages.splice(insertIndex, 0, ...movingPages);

        remainingPages.forEach((p, idx) => {
          p.displayPageNumber = idx + 1;
        });

        const nextActiveIdx = remainingPages.findIndex((p) => p.id === activeId);
        state.currentDocument.pages = remainingPages;
        if (nextActiveIdx !== -1) {
          state.currentDocument.activePageIndex = nextActiveIdx;
        }
        state.currentDocument.selectedPageIds = pageIds;
        state.currentDocument.isModified = true;
      });
    },

    deletePage: (pageId) => {
      const doc = get().currentDocument;
      if (!doc) return;
      const idx = doc.pages.findIndex((p) => p.id === pageId);
      if (idx === -1) return;

      if (!historyManager.isApplying()) {
        historyManager.execute(
          new DeletePageCommand([{ page: doc.pages[idx], index: idx }], doc.id),
          doc.id
        );
        return;
      }

      set((state) => {
        if (!state.currentDocument) return;
        const deleteIdx = state.currentDocument.pages.findIndex((p) => p.id === pageId);
        if (deleteIdx !== -1) {
          state.currentDocument.pages.splice(deleteIdx, 1);
          state.currentDocument.totalPages = state.currentDocument.pages.length;

          state.currentDocument.pages.forEach((p, i) => {
            p.displayPageNumber = i + 1;
          });

          if (state.currentDocument.pages.length > 0) {
            const nextIdx = Math.min(deleteIdx, state.currentDocument.pages.length - 1);
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
      });
    },

    updatePageGeometry: (pageId, geometry) =>
      set((state) => {
        if (!state.currentDocument) return;
        const p = state.currentDocument.pages.find((pg) => pg.id === pageId);
        if (p) {
          if (
            Math.abs(p.width - geometry.width) > 0.5 ||
            Math.abs(p.height - geometry.height) > 0.5 ||
            p.rotation !== geometry.rotation
          ) {
            p.width = geometry.width;
            p.height = geometry.height;
            p.rotation = geometry.rotation;
            p.aspectRatio = geometry.width / (geometry.height || 1);
          }
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
        const filtered = state.recentDocuments.filter((d) => {
          if (d.id === item.id) return false;
          if (item.filePath && d.filePath) {
            return d.filePath !== item.filePath;
          }
          if (!item.filePath && !d.filePath) {
            return d.name !== item.name;
          }
          return true;
        });
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

// Automatically mirror ANY mutation to currentDocument (including external setState calls)
// back into the matching tab in useTabStore so tabs never drift out of sync.
useDocumentStore.subscribe((state, prevState) => {
  if (!state.currentDocument || state.currentDocument === prevState.currentDocument) {
    return;
  }
  const tabStore = useTabStore.getState();
  const matchingTab = tabStore.tabs.find((t) => t.id === state.currentDocument!.id);
  if (matchingTab && matchingTab.model !== state.currentDocument) {
    tabStore.updateTabModel(state.currentDocument);
  }
});
