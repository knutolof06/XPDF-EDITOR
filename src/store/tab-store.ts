import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import * as pdfjsLib from 'pdfjs-dist';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';
import { useDocumentStore, cleanupClosedDocumentResources } from './document-store';

export interface TabItem {
  id: string;
  name: string;
  model: PdfDocumentModel;
  pdfDocProxy: pdfjsLib.PDFDocumentProxy;
  activePageIndex: number;
  scrollTop: number;
  zoom: number;
}

interface TabState {
  tabs: TabItem[];
  activeTabId: string | null;
  clipboardPages: PdfPageModel[]; // For Ctrl+C / Ctrl+V across documents

  addTab: (model: PdfDocumentModel, pdfDocProxy: pdfjsLib.PDFDocumentProxy) => void;
  replaceActiveTab: (model: PdfDocumentModel, pdfDocProxy: pdfjsLib.PDFDocumentProxy) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateActiveTabState: (activePageIndex: number, scrollTop?: number, zoom?: number) => void;
  updateTabModel: (model: PdfDocumentModel) => void;
  setClipboardPages: (pages: PdfPageModel[]) => void;
}

export const useTabStore = create<TabState>()(
  immer((set, get) => ({
    tabs: [],
    activeTabId: null,
    clipboardPages: [],

    addTab: (model, pdfDocProxy) =>
      set((state) => {
        const existingIdx = state.tabs.findIndex((t) => t.id === model.id);
        const item: TabItem = {
          id: model.id,
          name: model.name,
          model,
          pdfDocProxy: pdfDocProxy as unknown as TabItem['pdfDocProxy'],
          activePageIndex: model.activePageIndex || 0,
          scrollTop: 0,
          zoom: 1.0,
        };

        if (existingIdx !== -1) {
          state.tabs[existingIdx] = item as unknown as (typeof state.tabs)[number];
        } else {
          state.tabs.push(item as unknown as (typeof state.tabs)[number]);
        }
        state.activeTabId = model.id;
      }),

    replaceActiveTab: (model, pdfDocProxy) => {
      const prevTabs = get().tabs;
      const activeId = get().activeTabId;
      const oldIdx = prevTabs.findIndex((t) => t.id === activeId);
      const oldTab = oldIdx !== -1 ? prevTabs[oldIdx] : null;

      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
        const currentTab = idx !== -1 ? state.tabs[idx] : null;
        const item: TabItem = {
          id: model.id,
          name: model.name,
          model,
          pdfDocProxy: pdfDocProxy as unknown as TabItem['pdfDocProxy'],
          activePageIndex: model.activePageIndex ?? currentTab?.activePageIndex ?? 0,
          scrollTop: currentTab?.scrollTop || 0,
          zoom: currentTab?.zoom || 1.0,
        };

        if (idx !== -1) {
          state.tabs[idx] = item as unknown as (typeof state.tabs)[number];
        } else {
          state.tabs.push(item as unknown as (typeof state.tabs)[number]);
        }
        state.activeTabId = model.id;
      });

      if (oldTab && oldTab.id !== model.id) {
        cleanupClosedDocumentResources(
          oldTab.id,
          oldTab.model?.pages?.map((p) => p.id),
          oldTab.pdfDocProxy
        );
      } else if (oldTab && oldTab.id === model.id) {
        clearDocumentCaches(model.id);
      }
    },

    closeTab: (tabId) => {
      const currentTabs = get().tabs;
      const idx = currentTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      const closedTab = currentTabs[idx];
      const wasActive = get().activeTabId === tabId;
      const activeDocId = useDocumentStore.getState().currentDocument?.id;

      let nextActiveTabId: string | null = get().activeTabId;

      set((state) => {
        const removeIdx = state.tabs.findIndex((t) => t.id === tabId);
        if (removeIdx === -1) return;

        state.tabs.splice(removeIdx, 1);
        if (state.activeTabId === tabId) {
          if (state.tabs.length > 0) {
            // Pick the nearest remaining tab (same index if right neighbor exists, otherwise previous)
            const nextIdx = Math.min(removeIdx, state.tabs.length - 1);
            state.activeTabId = state.tabs[nextIdx].id;
            nextActiveTabId = state.activeTabId;
          } else {
            state.activeTabId = null;
            nextActiveTabId = null;
          }
        }
      });

      if (wasActive || activeDocId === tabId) {
        cancelActivePreload();
        const remaining = get().tabs;
        const nextTab = nextActiveTabId
          ? remaining.find((t) => t.id === nextActiveTabId)
          : undefined;

        if (nextTab) {
          const modelToSet: PdfDocumentModel = {
            ...nextTab.model,
            activePageIndex: Math.max(
              0,
              Math.min(
                nextTab.activePageIndex ?? nextTab.model.activePageIndex ?? 0,
                Math.max(0, nextTab.model.pages.length - 1)
              )
            ),
          };
          useDocumentStore.getState().setDocument(modelToSet, nextTab.pdfDocProxy);
        } else {
          useDocumentStore.getState().closeDocument();
        }
      }

      // Clean up resources ONLY if the closed document is no longer in any open tab
      cleanupClosedDocumentResources(
        closedTab.id,
        closedTab.model?.pages?.map((p) => p.id),
        closedTab.pdfDocProxy
      );
    },

    setActiveTab: (tabId) => {
      const state = get();
      const targetTab = state.tabs.find((t) => t.id === tabId);
      if (!targetTab) {
        set((s) => {
          s.activeTabId = tabId;
        });
        return;
      }

      // Persist current document's latest model & activePageIndex onto the outgoing tab
      const currentDoc = useDocumentStore.getState().currentDocument;
      if (currentDoc && state.activeTabId === currentDoc.id && currentDoc.id !== tabId) {
        set((s) => {
          const outTab = s.tabs.find((t) => t.id === currentDoc.id);
          if (outTab) {
            outTab.model = currentDoc as unknown as typeof outTab.model;
            outTab.activePageIndex = currentDoc.activePageIndex;
          }
        });
      }

      set((s) => {
        s.activeTabId = tabId;
      });

      const docStore = useDocumentStore.getState();
      if (
        docStore.currentDocument?.id !== targetTab.id ||
        docStore.pdfDocProxy !== targetTab.pdfDocProxy
      ) {
        const clampedPageIdx = Math.max(
          0,
          Math.min(
            targetTab.activePageIndex ?? targetTab.model.activePageIndex ?? 0,
            Math.max(0, targetTab.model.pages.length - 1)
          )
        );
        const modelToSet: PdfDocumentModel = {
          ...targetTab.model,
          activePageIndex: clampedPageIdx,
          activePageId: targetTab.model.pages[clampedPageIdx]?.id || targetTab.model.activePageId,
        };
        docStore.setDocument(modelToSet, targetTab.pdfDocProxy);
      }
    },

    updateActiveTabState: (activePageIndex, scrollTop, zoom) =>
      set((state) => {
        if (!state.activeTabId) return;
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (tab) {
          tab.activePageIndex = activePageIndex;
          if (scrollTop !== undefined) tab.scrollTop = scrollTop;
          if (zoom !== undefined) tab.zoom = zoom;
          if (tab.model) {
            tab.model.activePageIndex = activePageIndex;
          }
        }
      }),

    updateTabModel: (model) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.id === model.id);
        if (tab) {
          tab.model = model as unknown as typeof tab.model;
          tab.name = model.name;
          tab.activePageIndex = model.activePageIndex;
        }
      }),

    setClipboardPages: (pages) =>
      set((state) => {
        state.clipboardPages = pages;
      }),
  }))
);
