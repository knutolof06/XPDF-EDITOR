import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ActiveTool, ToolStyleOptions } from '@/types/viewer';
import { AnyAnnotation, PageNumberConfig, HeaderFooterConfig } from '@/types/annotations';
import { useDocumentStore } from './document-store';

interface AnnotationState {
  activeTool: ActiveTool;
  toolStyles: ToolStyleOptions;
  selectedAnnotationId: string | null;
  pageNumberConfig: PageNumberConfig;
  headerFooterConfig: HeaderFooterConfig;

  setActiveTool: (tool: ActiveTool) => void;
  setToolStyles: (styles: Partial<ToolStyleOptions>) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  addAnnotation: (pageId: string, annotation: AnyAnnotation) => void;
  updateAnnotation: (pageId: string, annotationId: string, patch: Partial<AnyAnnotation>) => void;
  deleteAnnotation: (pageId: string, annotationId: string) => void;
  setPageNumberConfig: (config: Partial<PageNumberConfig>) => void;
  setHeaderFooterConfig: (config: Partial<HeaderFooterConfig>) => void;
}

export const useAnnotationStore = create<AnnotationState>()(
  immer((set) => ({
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
