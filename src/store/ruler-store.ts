import { create } from 'zustand';

export type RulerUnit = 'mm' | 'cm' | 'pt' | 'in';

// Conversion factors to/from PDF points (72 pt = 1 inch = 25.4 mm)
export const PT_PER_INCH = 72;
export const PT_PER_MM = 72 / 25.4; // ~2.83464567 pt
export const PT_PER_CM = 72 / 2.54; // ~28.3464567 pt

export function ptToUnit(pt: number, unit: RulerUnit): number {
  switch (unit) {
    case 'mm': return pt / PT_PER_MM;
    case 'cm': return pt / PT_PER_CM;
    case 'in': return pt / PT_PER_INCH;
    case 'pt': return pt;
  }
}

export function unitToPt(val: number, unit: RulerUnit): number {
  switch (unit) {
    case 'mm': return val * PT_PER_MM;
    case 'cm': return val * PT_PER_CM;
    case 'in': return val * PT_PER_INCH;
    case 'pt': return val;
  }
}

interface RulerState {
  showRulers: boolean;
  showGrid: boolean;
  unit: RulerUnit;
  gridSizePt: number; // default 28.35 pt (~10mm)
  snapToGuides: boolean;
  snapToGrid: boolean;

  /** Guides stored per pageIndex in PDF points */
  horizontalGuidesByPage: Record<number, number[]>;
  verticalGuidesByPage: Record<number, number[]>;

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
      const pageGuides = state.horizontalGuidesByPage[pageIndex] || [];
      return {
        horizontalGuidesByPage: {
          ...state.horizontalGuidesByPage,
          [pageIndex]: [...pageGuides, Math.round(yPt * 10) / 10],
        },
      };
    }),

  addVerticalGuide: (pageIndex, xPt) =>
    set((state) => {
      const pageGuides = state.verticalGuidesByPage[pageIndex] || [];
      return {
        verticalGuidesByPage: {
          ...state.verticalGuidesByPage,
          [pageIndex]: [...pageGuides, Math.round(xPt * 10) / 10],
        },
      };
    }),

  removeHorizontalGuide: (pageIndex, guideIdx) =>
    set((state) => {
      const pageGuides = state.horizontalGuidesByPage[pageIndex] || [];
      return {
        horizontalGuidesByPage: {
          ...state.horizontalGuidesByPage,
          [pageIndex]: pageGuides.filter((_, i) => i !== guideIdx),
        },
      };
    }),

  removeVerticalGuide: (pageIndex, guideIdx) =>
    set((state) => {
      const pageGuides = state.verticalGuidesByPage[pageIndex] || [];
      return {
        verticalGuidesByPage: {
          ...state.verticalGuidesByPage,
          [pageIndex]: pageGuides.filter((_, i) => i !== guideIdx),
        },
      };
    }),

  clearGuides: (pageIndex) =>
    set((state) => {
      if (pageIndex !== undefined) {
        const nextH = { ...state.horizontalGuidesByPage };
        const nextV = { ...state.verticalGuidesByPage };
        delete nextH[pageIndex];
        delete nextV[pageIndex];
        return { horizontalGuidesByPage: nextH, verticalGuidesByPage: nextV };
      }
      return { horizontalGuidesByPage: {}, verticalGuidesByPage: {} };
    }),

  setMousePosition: (pos) => set({ mousePosition: pos }),
}));
