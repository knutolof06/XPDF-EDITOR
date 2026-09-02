import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ActiveTool, ToolStyleOptions } from '@/types/viewer';
import { AnyAnnotation, PageNumberConfig, HeaderFooterConfig } from '@/types/annotations';
import { useDocumentStore } from './document-store';

interface AnnotationState {
  activeTool: ActiveTool;
  toolStyles: ToolStyleOptions;
  selectedAnnotationId: string | null;
  copiedAnnotation: AnyAnnotation | null;
  pageNumberConfig: PageNumberConfig;
  headerFooterConfig: HeaderFooterConfig;

  setActiveTool: (tool: ActiveTool) => void;
  setToolStyles: (styles: Partial<ToolStyleOptions>) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  addAnnotation: (pageId: string, annotation: AnyAnnotation) => void;
  updateAnnotation: (pageId: string, annotationId: string, patch: Partial<AnyAnnotation>) => void;
  deleteAnnotation: (pageId: string, annotationId: string) => void;
  cloneAnnotation: (pageId: string, annotationId: string) => string | null;
  bringToFront: (pageId: string, annotationId: string) => void;
  sendToBack: (pageId: string, annotationId: string) => void;
  copyAnnotation: (pageId: string, annotationId: string) => void;
  pasteAnnotation: (targetPageId: string) => string | null;
  setPageNumberConfig: (config: Partial<PageNumberConfig>) => void;
  setHeaderFooterConfig: (config: Partial<HeaderFooterConfig>) => void;
}

export const useAnnotationStore = create<AnnotationState>()(
  immer((set, get) => ({
    activeTool: 'select',
    toolStyles: {
      color: '#0284c7', // Sky-600
      fillColor: 'transparent',
      strokeWidth: 3,
      fontSize: 16,
      fontFamily: 'Helvetica, Arial, sans-serif',
      opacity: 1,
      isBold: false,
      isItalic: false,
      isUnderline: false,
    },
    selectedAnnotationId: null,
    copiedAnnotation: null,

    pageNumberConfig: {
      enabled: false,
      position: 'bottom-center',
      format: 'page-x-of-y',
      fontSize: 10,
      color: '#475569',
      startFrom: 1,
    },

    headerFooterConfig: {
      fontSize: 9,
      color: '#64748b',
    },

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
        if (tool !== 'select') {
          state.selectedAnnotationId = null;
        }
      }),

    setToolStyles: (styles) =>
      set((state) => {
        state.toolStyles = { ...state.toolStyles, ...styles };
      }),

    setSelectedAnnotationId: (id) =>
      set((state) => {
        state.selectedAnnotationId = id;
      }),

    addAnnotation: (pageId, annotation) => {
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (page) {
          page.annotations = [...page.annotations, annotation];
          docState.currentDocument.isModified = true;
        }
      });
    },

    updateAnnotation: (pageId, annotationId, patch) => {
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (page) {
          page.annotations = page.annotations.map((ann) =>
            ann.id === annotationId ? ({ ...ann, ...patch } as AnyAnnotation) : ann
          );
          docState.currentDocument.isModified = true;
        }
      });
    },

    deleteAnnotation: (pageId, annotationId) => {
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (page) {
          page.annotations = page.annotations.filter((ann) => ann.id !== annotationId);
          docState.currentDocument.isModified = true;
        }
      });
      set((state) => {
        if (state.selectedAnnotationId === annotationId) {
          state.selectedAnnotationId = null;
        }
      });
    },

    cloneAnnotation: (pageId, annotationId) => {
      let newId: string | null = null;
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (!page) return;
        const orig = page.annotations.find((a) => a.id === annotationId);
        if (!orig) return;

        newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const cloned: AnyAnnotation = JSON.parse(JSON.stringify(orig));
        cloned.id = newId;
        cloned.x = (orig.x || 0) + 15;
        cloned.y = (orig.y || 0) + 15;

        // If it's a drawing, offset each point
        if (cloned.type === 'draw' || cloned.type === 'highlight') {
          cloned.points = cloned.points.map((pt) => ({ x: pt.x + 15, y: pt.y + 15 }));
        }

        page.annotations = [...page.annotations, cloned];
        docState.currentDocument.isModified = true;
      });

      if (newId) {
        set((state) => {
          state.selectedAnnotationId = newId;
        });
      }
      return newId;
    },

    bringToFront: (pageId, annotationId) => {
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (!page) return;
        const idx = page.annotations.findIndex((a) => a.id === annotationId);
        if (idx === -1 || idx === page.annotations.length - 1) return;
        const [target] = page.annotations.splice(idx, 1);
        page.annotations.push(target);
        docState.currentDocument.isModified = true;
      });
    },

    sendToBack: (pageId, annotationId) => {
      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (!page) return;
        const idx = page.annotations.findIndex((a) => a.id === annotationId);
        if (idx <= 0) return;
        const [target] = page.annotations.splice(idx, 1);
        page.annotations.unshift(target);
        docState.currentDocument.isModified = true;
      });
    },

    copyAnnotation: (pageId, annotationId) => {
      const docState = useDocumentStore.getState();
      if (!docState.currentDocument) return;
      const page = docState.currentDocument.pages.find((p) => p.id === pageId);
      if (!page) return;
      const target = page.annotations.find((a) => a.id === annotationId);
      if (target) {
        set((state) => {
          state.copiedAnnotation = JSON.parse(JSON.stringify(target));
        });
      }
    },

    pasteAnnotation: (targetPageId) => {
      const copied = get().copiedAnnotation;
      if (!copied) return null;
      const newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const pasted: AnyAnnotation = JSON.parse(JSON.stringify(copied));
      pasted.id = newId;
      pasted.pageId = targetPageId;
      pasted.x = (copied.x || 0) + 20;
      pasted.y = (copied.y || 0) + 20;

      if (pasted.type === 'draw' || pasted.type === 'highlight') {
        pasted.points = pasted.points.map((pt) => ({ x: pt.x + 20, y: pt.y + 20 }));
      }

      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const page = docState.currentDocument.pages.find((p) => p.id === targetPageId);
        if (page) {
          page.annotations = [...page.annotations, pasted];
          docState.currentDocument.isModified = true;
        }
      });

      set((state) => {
        state.selectedAnnotationId = newId;
      });
      return newId;
    },

    setPageNumberConfig: (config) =>
      set((state) => {
        state.pageNumberConfig = { ...state.pageNumberConfig, ...config };
      }),

    setHeaderFooterConfig: (config) =>
      set((state) => {
        state.headerFooterConfig = { ...state.headerFooterConfig, ...config };
      }),
  }))
);
