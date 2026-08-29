import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import * as pdfjsLib from 'pdfjs-dist';

export interface TabItem {
  id: string;
  name: string;
  model: PdfDocumentModel;
  pdfDocProxy: pdfjsLib.PDFDocumentProxy;
}

interface TabState {
  tabs: TabItem[];
  activeTabId: string | null;
  clipboardPages: PdfPageModel[]; // For Ctrl+C / Ctrl+V across documents

  addTab: (model: PdfDocumentModel, pdfDocProxy: pdfjsLib.PDFDocumentProxy) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
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
        if (existingIdx !== -1) {
          state.tabs[existingIdx] = { id: model.id, name: model.name, model, pdfDocProxy: pdfDocProxy as any };
        } else {
          state.tabs.push({ id: model.id, name: model.name, model, pdfDocProxy: pdfDocProxy as any });
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

    setClipboardPages: (pages) =>
      set((state) => {
        state.clipboardPages = pages;
      }),
  }))
);
