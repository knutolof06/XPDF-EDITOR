import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import * as pdfjsLib from 'pdfjs-dist';

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
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateActiveTabState: (activePageIndex: number, scrollTop?: number, zoom?: number) => void;
  updateTabModel: (model: PdfDocumentModel) => void;
  setClipboardPages: (pages: PdfPageModel[]) => void;
}

export const useTabStore = create<TabState>()(
  immer((set) => ({
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
          pdfDocProxy: pdfDocProxy as any,
          activePageIndex: model.activePageIndex || 0,
          scrollTop: 0,
          zoom: 1.0,
        };

        if (existingIdx !== -1) {
          state.tabs[existingIdx] = item;
        } else {
          state.tabs.push(item);
        }
        state.activeTabId = model.id;
      }),

    closeTab: (tabId) =>
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;

        state.tabs.splice(idx, 1);
        if (state.activeTabId === tabId) {
          if (state.tabs.length > 0) {
            const nextIdx = Math.max(0, idx - 1);
            state.activeTabId = state.tabs[nextIdx].id;
          } else {
            state.activeTabId = null;
          }
        }
      }),

    setActiveTab: (tabId) =>
      set((state) => {
        state.activeTabId = tabId;
      }),

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
          tab.model = model;
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
