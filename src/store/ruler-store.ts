import { create } from 'zustand';
import { useDocumentStore } from './document-store';

export type RulerUnit = 'mm' | 'cm' | 'pt' | 'in';

// Conversion factors to/from PDF points (72 pt = 1 inch = 25.4 mm)
export const PT_PER_INCH = 72;
export const PT_PER_MM = 72 / 25.4; // ~2.83464567 pt
export const PT_PER_CM = 72 / 2.54; // ~28.3464567 pt

export function ptToUnit(pt: number, unit: RulerUnit): number {
  switch (unit) {
    case 'mm':
      return pt / PT_PER_MM;
    case 'cm':
      return pt / PT_PER_CM;
    case 'in':
      return pt / PT_PER_INCH;
    case 'pt':
      return pt;
  }
}

export function unitToPt(val: number, unit: RulerUnit): number {
  switch (unit) {
    case 'mm':
      return val * PT_PER_MM;
    case 'cm':
      return val * PT_PER_CM;
    case 'in':
      return val * PT_PER_INCH;
    case 'pt':
      return val;
  }
}

function getActiveDocId(): string {
  return useDocumentStore.getState().currentDocument?.id || 'global';
}

interface RulerState {
  showRulers: boolean;
  showGrid: boolean;
  unit: RulerUnit;
  gridSizePt: number; // default 28.35 pt (~10mm)
  snapToGuides: boolean;
  snapToGrid: boolean;

  /** Active document guides projected per pageIndex in PDF points */
  horizontalGuidesByPage: Record<number, number[]>;
  verticalGuidesByPage: Record<number, number[]>;

  /** Per-document guide maps (docId -> pageIndex -> positions in pt) */
  horizontalGuidesByDoc: Record<string, Record<number, number[]>>;
  verticalGuidesByDoc: Record<string, Record<number, number[]>>;

  /** Mouse cursor indicator position relative to active page */
  mousePosition: { xPt: number; yPt: number } | null;

  toggleRulers: () => void;
  setShowRulers: (show: boolean) => void;
  toggleGrid: () => void;
  setShowGrid: (show: boolean) => void;
  setUnit: (unit: RulerUnit) => void;
  setGridSizePt: (sizePt: number) => void;
  setSnapToGuides: (snap: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;

  addHorizontalGuide: (pageIndex: number, yPt: number) => void;
  addVerticalGuide: (pageIndex: number, xPt: number) => void;
  removeHorizontalGuide: (pageIndex: number, guideIdx: number) => void;
  removeVerticalGuide: (pageIndex: number, guideIdx: number) => void;
  clearGuides: (pageIndex?: number) => void;

  syncActiveDocument: (docId: string | null) => void;
  clearDocGuides: (docId: string) => void;

  setMousePosition: (pos: { xPt: number; yPt: number } | null) => void;
}

export const useRulerStore = create<RulerState>((set) => ({
  showRulers: false,
  showGrid: false,
  unit: 'mm',
  gridSizePt: PT_PER_MM * 10, // 10 mm default
  snapToGuides: true,
  snapToGrid: false,
  horizontalGuidesByPage: {},
  verticalGuidesByPage: {},
  horizontalGuidesByDoc: {},
  verticalGuidesByDoc: {},
  mousePosition: null,

  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  setShowRulers: (show) => set({ showRulers: show }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setShowGrid: (show) => set({ showGrid: show }),
  setUnit: (unit) => set({ unit }),
  setGridSizePt: (gridSizePt) => set({ gridSizePt }),
  setSnapToGuides: (snapToGuides) => set({ snapToGuides }),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),

  addHorizontalGuide: (pageIndex, yPt) =>
    set((state) => {
      const docId = getActiveDocId();
      const docGuides = state.horizontalGuidesByDoc[docId] || {};
      const pageGuides = docGuides[pageIndex] || [];
      const nextDocGuides = {
        ...docGuides,
        [pageIndex]: [...pageGuides, Math.round(yPt * 10) / 10],
      };
      return {
        horizontalGuidesByDoc: {
          ...state.horizontalGuidesByDoc,
          [docId]: nextDocGuides,
        },
        horizontalGuidesByPage: nextDocGuides,
      };
    }),

  addVerticalGuide: (pageIndex, xPt) =>
    set((state) => {
      const docId = getActiveDocId();
      const docGuides = state.verticalGuidesByDoc[docId] || {};
      const pageGuides = docGuides[pageIndex] || [];
      const nextDocGuides = {
        ...docGuides,
        [pageIndex]: [...pageGuides, Math.round(xPt * 10) / 10],
      };
      return {
        verticalGuidesByDoc: {
          ...state.verticalGuidesByDoc,
          [docId]: nextDocGuides,
        },
        verticalGuidesByPage: nextDocGuides,
      };
    }),

  removeHorizontalGuide: (pageIndex, guideIdx) =>
    set((state) => {
      const docId = getActiveDocId();
      const docGuides = state.horizontalGuidesByDoc[docId] || {};
      const pageGuides = docGuides[pageIndex] || [];
      const nextDocGuides = {
        ...docGuides,
        [pageIndex]: pageGuides.filter((_, i) => i !== guideIdx),
      };
      return {
        horizontalGuidesByDoc: {
          ...state.horizontalGuidesByDoc,
          [docId]: nextDocGuides,
        },
        horizontalGuidesByPage: nextDocGuides,
      };
    }),

  removeVerticalGuide: (pageIndex, guideIdx) =>
    set((state) => {
      const docId = getActiveDocId();
      const docGuides = state.verticalGuidesByDoc[docId] || {};
      const pageGuides = docGuides[pageIndex] || [];
      const nextDocGuides = {
        ...docGuides,
        [pageIndex]: pageGuides.filter((_, i) => i !== guideIdx),
      };
      return {
        verticalGuidesByDoc: {
          ...state.verticalGuidesByDoc,
          [docId]: nextDocGuides,
        },
        verticalGuidesByPage: nextDocGuides,
      };
    }),

  clearGuides: (pageIndex) =>
    set((state) => {
      const docId = getActiveDocId();
      if (pageIndex !== undefined) {
        const nextH = { ...(state.horizontalGuidesByDoc[docId] || {}) };
        const nextV = { ...(state.verticalGuidesByDoc[docId] || {}) };
        delete nextH[pageIndex];
        delete nextV[pageIndex];
        return {
          horizontalGuidesByDoc: { ...state.horizontalGuidesByDoc, [docId]: nextH },
          verticalGuidesByDoc: { ...state.verticalGuidesByDoc, [docId]: nextV },
          horizontalGuidesByPage: nextH,
          verticalGuidesByPage: nextV,
        };
      }
      const nextHByDoc = { ...state.horizontalGuidesByDoc };
      const nextVByDoc = { ...state.verticalGuidesByDoc };
      delete nextHByDoc[docId];
      delete nextVByDoc[docId];
      return {
        horizontalGuidesByDoc: nextHByDoc,
        verticalGuidesByDoc: nextVByDoc,
        horizontalGuidesByPage: {},
        verticalGuidesByPage: {},
      };
    }),

  syncActiveDocument: (docId) =>
    set((state) => {
      const key = docId || 'global';
      return {
        horizontalGuidesByPage: state.horizontalGuidesByDoc[key] || {},
        verticalGuidesByPage: state.verticalGuidesByDoc[key] || {},
        mousePosition: null,
      };
    }),

  clearDocGuides: (docId) =>
    set((state) => {
      const nextH = { ...state.horizontalGuidesByDoc };
      const nextV = { ...state.verticalGuidesByDoc };
      delete nextH[docId];
      delete nextV[docId];
      const isCurrent = getActiveDocId() === docId || !useDocumentStore.getState().currentDocument;
      return {
        horizontalGuidesByDoc: nextH,
        verticalGuidesByDoc: nextV,
        ...(isCurrent ? { horizontalGuidesByPage: {}, verticalGuidesByPage: {} } : {}),
      };
    }),

  setMousePosition: (pos) => set({ mousePosition: pos }),
}));
