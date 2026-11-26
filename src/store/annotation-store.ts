import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ActiveTool, ToolStyleOptions } from '@/types/viewer';
import { AnyAnnotation, PageNumberConfig, HeaderFooterConfig } from '@/types/annotations';
import { useDocumentStore } from './document-store';
import { useViewerStore } from './viewer-store';
import {
  historyManager,
  GenericCommand,
  AnnotationReorderCommand,
  PageNumberConfigCommand,
  HeaderFooterConfigCommand,
  cloneAnnotation,
} from '@/core/history/command-manager';

const DEFAULT_PAGE_NUMBER_CONFIG: PageNumberConfig = {
  enabled: false,
  position: 'bottom-center',
  format: 'page-x-of-y',
  fontSize: 10,
  color: '#475569',
  startFrom: 1,
};

const DEFAULT_HEADER_FOOTER_CONFIG: HeaderFooterConfig = {
  enabled: false,
  fontSize: 9,
  color: '#64748b',
};

function getActiveDocKey(): string {
  return useDocumentStore.getState().currentDocument?.id || 'global';
}

interface AnnotationState {
  activeTool: ActiveTool;
  toolStyles: ToolStyleOptions;
  selectedAnnotationId: string | null;
  copiedAnnotation: AnyAnnotation | null;
  pageNumberConfig: PageNumberConfig;
  headerFooterConfig: HeaderFooterConfig;
  pageNumberConfigByDoc: Record<string, PageNumberConfig>;
  headerFooterConfigByDoc: Record<string, HeaderFooterConfig>;

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
  syncActiveDocument: (docId: string | null) => void;
  clearDocState: (docId: string) => void;
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

    pageNumberConfig: { ...DEFAULT_PAGE_NUMBER_CONFIG },
    headerFooterConfig: { ...DEFAULT_HEADER_FOOTER_CONFIG },
    pageNumberConfigByDoc: {},
    headerFooterConfigByDoc: {},

    setActiveTool: (tool) => {
      set((state) => {
        state.activeTool = tool;
        if (tool !== 'select') {
          state.selectedAnnotationId = null;
        }
      });
      if (useViewerStore.getState().activeTool !== tool) {
        useViewerStore.setState((s) => {
          s.activeTool = tool;
        });
      }
    },

    setToolStyles: (styles) =>
      set((state) => {
        state.toolStyles = { ...state.toolStyles, ...styles };
      }),

    setSelectedAnnotationId: (id) =>
      set((state) => {
        state.selectedAnnotationId = id;
      }),

    addAnnotation: (pageId, annotation) => {
      const docId = useDocumentStore.getState().currentDocument?.id;
      const savedAnn = cloneAnnotation(annotation);

      const applyAdd = (ann: AnyAnnotation) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const page = docState.currentDocument.pages.find((p) => p.id === pageId);
          if (page) {
            page.annotations = [...page.annotations, cloneAnnotation(ann)];
            docState.currentDocument.isModified = true;
          }
        });
      };

      const applyDelete = (annId: string) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const page = docState.currentDocument.pages.find((p) => p.id === pageId);
          if (page) {
            page.annotations = page.annotations.filter((a) => a.id !== annId);
            docState.currentDocument.isModified = true;
          }
        });
      };

      applyAdd(savedAnn);
      if (!historyManager.isApplying()) {
        historyManager.push(
          new GenericCommand(
            `${savedAnn.type} açıklaması eklendi`,
            () => applyAdd(savedAnn),
            () => applyDelete(savedAnn.id),
            { docId }
          ),
          docId
        );
      }
    },

    updateAnnotation: (pageId, annotationId, patch) => {
      const doc = useDocumentStore.getState().currentDocument;
      const page = doc?.pages.find((p) => p.id === pageId);
      const beforeAnn = page?.annotations.find((a) => a.id === annotationId);
      const savedBefore = beforeAnn ? cloneAnnotation(beforeAnn) : undefined;
      const savedPatch = {
        ...patch,
        ...('points' in patch && Array.isArray(patch.points)
          ? { points: patch.points.map((pt) => ({ ...pt })) }
          : {}),
      } as Partial<AnyAnnotation>;

      const applyPatch = (p: Partial<AnyAnnotation>) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            pg.annotations = pg.annotations.map((ann) =>
              ann.id === annotationId ? ({ ...ann, ...p } as AnyAnnotation) : ann
            );
            docState.currentDocument.isModified = true;
          }
        });
      };

      const replaceFull = (fullAnn: AnyAnnotation) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            pg.annotations = pg.annotations.map((ann) =>
              ann.id === annotationId ? cloneAnnotation(fullAnn) : ann
            );
            docState.currentDocument.isModified = true;
          }
        });
      };

      applyPatch(savedPatch);

      if (savedBefore && !historyManager.isApplying()) {
        const afterDoc = useDocumentStore.getState().currentDocument;
        const afterPage = afterDoc?.pages.find((p) => p.id === pageId);
        const afterAnn = afterPage?.annotations.find((a) => a.id === annotationId);
        const savedAfter = afterAnn ? cloneAnnotation(afterAnn) : undefined;

        historyManager.push(
          new GenericCommand(
            'Açıklama güncellendi',
            () => (savedAfter ? replaceFull(savedAfter) : applyPatch(savedPatch)),
            () => replaceFull(savedBefore),
            { docId: doc?.id }
          ),
          doc?.id
        );
      }
    },

    deleteAnnotation: (pageId, annotationId) => {
      const doc = useDocumentStore.getState().currentDocument;
      const page = doc?.pages.find((p) => p.id === pageId);
      const deletedAnn = page?.annotations.find((a) => a.id === annotationId);
      const deletedIdx = page ? page.annotations.findIndex((a) => a.id === annotationId) : -1;

      const applyDelete = (annId: string) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            pg.annotations = pg.annotations.filter((ann) => ann.id !== annId);
            docState.currentDocument.isModified = true;
          }
        });
      };

      const applyRestore = (ann: AnyAnnotation, idx: number) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            const next = [...pg.annotations];
            const safeIdx = idx >= 0 && idx <= next.length ? idx : next.length;
            next.splice(safeIdx, 0, cloneAnnotation(ann));
            pg.annotations = next;
            docState.currentDocument.isModified = true;
          }
        });
      };

      applyDelete(annotationId);
      set((state) => {
        if (state.selectedAnnotationId === annotationId) {
          state.selectedAnnotationId = null;
        }
      });

      if (deletedAnn && !historyManager.isApplying()) {
        const savedAnn = cloneAnnotation(deletedAnn);
        historyManager.push(
          new GenericCommand(
            `${savedAnn.type} açıklaması silindi`,
            () => applyDelete(annotationId),
            () => applyRestore(savedAnn, deletedIdx),
            { docId: doc?.id }
          ),
          doc?.id
        );
      }
    },

    cloneAnnotation: (pageId, annotationId) => {
      const docId = useDocumentStore.getState().currentDocument?.id;
      let newId: string | null = null;
      let clonedAnn: AnyAnnotation | null = null;

      const applyAdd = (ann: AnyAnnotation) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            pg.annotations = [...pg.annotations, cloneAnnotation(ann)];
            docState.currentDocument.isModified = true;
          }
        });
      };

      const applyDelete = (annId: string) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const pg = docState.currentDocument.pages.find((x) => x.id === pageId);
          if (pg) {
            pg.annotations = pg.annotations.filter((a) => a.id !== annId);
            docState.currentDocument.isModified = true;
          }
        });
      };

      useDocumentStore.setState((docState) => {
        if (!docState.currentDocument) return;
        const pg = docState.currentDocument.pages.find((p) => p.id === pageId);
        if (!pg) return;
        const orig = pg.annotations.find((a) => a.id === annotationId);
        if (!orig) return;

        newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const cloned = cloneAnnotation(orig);
        cloned.id = newId;
        cloned.x = (orig.x || 0) + 15;
        cloned.y = (orig.y || 0) + 15;

        if (cloned.type === 'draw' || cloned.type === 'highlight') {
          cloned.points = cloned.points.map((pt) => ({ x: pt.x + 15, y: pt.y + 15 }));
        }

        pg.annotations = [...pg.annotations, cloned];
        clonedAnn = cloneAnnotation(cloned);
        docState.currentDocument.isModified = true;
      });

      const createdCloned = clonedAnn as AnyAnnotation | null;
      if (newId && createdCloned) {
        const targetId = newId;
        set((state) => {
          state.selectedAnnotationId = targetId;
        });
        if (!historyManager.isApplying()) {
          historyManager.push(
            new GenericCommand(
              'Açıklama çoğaltıldı',
              () => applyAdd(createdCloned),
              () => applyDelete(targetId),
              { docId }
            ),
            docId
          );
        }
      }
      return newId;
    },

    bringToFront: (pageId, annotationId) => {
      const doc = useDocumentStore.getState().currentDocument;
      if (!doc) return;
      const page = doc.pages.find((p) => p.id === pageId);
      if (!page) return;
      const idx = page.annotations.findIndex((a) => a.id === annotationId);
      if (idx === -1 || idx === page.annotations.length - 1) return;

      const beforeOrder = page.annotations.map(cloneAnnotation);
      const afterOrder = [...beforeOrder];
      const [target] = afterOrder.splice(idx, 1);
      afterOrder.push(target);

      const cmd = new AnnotationReorderCommand(
        'Açıklama öne getirildi',
        pageId,
        beforeOrder,
        afterOrder,
        doc.id
      );

      if (!historyManager.isApplying()) {
        historyManager.execute(cmd, doc.id);
      } else {
        cmd.execute();
      }
    },

    sendToBack: (pageId, annotationId) => {
      const doc = useDocumentStore.getState().currentDocument;
      if (!doc) return;
      const page = doc.pages.find((p) => p.id === pageId);
      if (!page) return;
      const idx = page.annotations.findIndex((a) => a.id === annotationId);
      if (idx <= 0) return;

      const beforeOrder = page.annotations.map(cloneAnnotation);
      const afterOrder = [...beforeOrder];
      const [target] = afterOrder.splice(idx, 1);
      afterOrder.unshift(target);

      const cmd = new AnnotationReorderCommand(
        'Açıklama arkaya gönderildi',
        pageId,
        beforeOrder,
        afterOrder,
        doc.id
      );

      if (!historyManager.isApplying()) {
        historyManager.execute(cmd, doc.id);
      } else {
        cmd.execute();
      }
    },

    copyAnnotation: (pageId, annotationId) => {
      const docState = useDocumentStore.getState();
      if (!docState.currentDocument) return;
      const page = docState.currentDocument.pages.find((p) => p.id === pageId);
      if (!page) return;
      const target = page.annotations.find((a) => a.id === annotationId);
      if (target) {
        set((state) => {
          state.copiedAnnotation = cloneAnnotation(target);
        });
      }
    },

    pasteAnnotation: (targetPageId) => {
      const copied = get().copiedAnnotation;
      if (!copied) return null;

      const docId = useDocumentStore.getState().currentDocument?.id;
      const newId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const pasted = cloneAnnotation(copied);
      pasted.id = newId;
      pasted.pageId = targetPageId;
      pasted.x = (copied.x || 0) + 20;
      pasted.y = (copied.y || 0) + 20;

      if (pasted.type === 'draw' || pasted.type === 'highlight') {
        pasted.points = pasted.points.map((pt) => ({ x: pt.x + 20, y: pt.y + 20 }));
      }

      const applyAdd = (ann: AnyAnnotation) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const page = docState.currentDocument.pages.find((p) => p.id === targetPageId);
          if (page) {
            page.annotations = [...page.annotations, cloneAnnotation(ann)];
            docState.currentDocument.isModified = true;
          }
        });
      };

      const applyDelete = (annId: string) => {
        useDocumentStore.setState((docState) => {
          if (!docState.currentDocument) return;
          const page = docState.currentDocument.pages.find((p) => p.id === targetPageId);
          if (page) {
            page.annotations = page.annotations.filter((a) => a.id !== annId);
            docState.currentDocument.isModified = true;
          }
        });
      };

      applyAdd(pasted);
      set((state) => {
        state.selectedAnnotationId = newId;
      });

      if (!historyManager.isApplying()) {
        historyManager.push(
          new GenericCommand(
            'Açıklama yapıştırıldı',
            () => applyAdd(pasted),
            () => applyDelete(newId),
            { docId }
          ),
          docId
        );
      }

      return newId;
    },

    setPageNumberConfig: (config) => {
      const doc = useDocumentStore.getState().currentDocument;
      const docKey = doc?.id || 'global';
      const prevConfig = { ...(get().pageNumberConfigByDoc[docKey] || get().pageNumberConfig) };
      const nextConfig: PageNumberConfig = { ...prevConfig, ...config };
      const prevModified = doc?.isModified ?? false;

      if (!historyManager.isApplying()) {
        historyManager.execute(
          new PageNumberConfigCommand(prevConfig, nextConfig, prevModified, doc?.id),
          doc?.id
        );
        return;
      }

      set((state) => {
        state.pageNumberConfigByDoc[docKey] = nextConfig;
        state.pageNumberConfig = nextConfig;
      });
    },

    setHeaderFooterConfig: (config) => {
      const doc = useDocumentStore.getState().currentDocument;
      const docKey = doc?.id || 'global';
      const prevConfig = { ...(get().headerFooterConfigByDoc[docKey] || get().headerFooterConfig) };
      const nextConfig: HeaderFooterConfig = { ...prevConfig, ...config };
      const prevModified = doc?.isModified ?? false;

      if (!historyManager.isApplying()) {
        historyManager.execute(
          new HeaderFooterConfigCommand(prevConfig, nextConfig, prevModified, doc?.id),
          doc?.id
        );
        return;
      }

      set((state) => {
        state.headerFooterConfigByDoc[docKey] = nextConfig;
        state.headerFooterConfig = nextConfig;
      });
    },

    syncActiveDocument: (docId) =>
      set((state) => {
        const key = docId || 'global';
        state.selectedAnnotationId = null;
        state.pageNumberConfig = state.pageNumberConfigByDoc[key]
          ? { ...state.pageNumberConfigByDoc[key] }
          : { ...DEFAULT_PAGE_NUMBER_CONFIG };
        state.headerFooterConfig = state.headerFooterConfigByDoc[key]
          ? { ...state.headerFooterConfigByDoc[key] }
          : { ...DEFAULT_HEADER_FOOTER_CONFIG };
      }),

    clearDocState: (docId) =>
      set((state) => {
        delete state.pageNumberConfigByDoc[docId];
        delete state.headerFooterConfigByDoc[docId];
        if (getActiveDocKey() === docId || !useDocumentStore.getState().currentDocument) {
          state.selectedAnnotationId = null;
          state.pageNumberConfig = { ...DEFAULT_PAGE_NUMBER_CONFIG };
          state.headerFooterConfig = { ...DEFAULT_HEADER_FOOTER_CONFIG };
        }
      }),
  }))
);
