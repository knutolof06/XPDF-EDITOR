import { create } from 'zustand';
import { PdfNativeObject } from '@/types/annotations';

interface NativeObjectState {
  /** pageId → list of extracted native objects from that page */
  objectsByPage: Record<string, PdfNativeObject[]>;

  /** Replace (or first-set) all native objects for a page */
  setObjects: (pageId: string, objects: PdfNativeObject[]) => void;

  /** Update x,y of a single object and mark it as moved */
  moveObject: (pageId: string, id: string, newX: number, newY: number) => void;

  /** Update positions of multiple objects at once */
  moveMultipleObjects: (
    pageId: string,
    updates: { id: string; x: number; y: number }[]
  ) => void;

  /** Reset a moved object back to its original position */
  resetObject: (pageId: string, id: string) => void;

  /** Reset multiple objects back to their original position */
  resetMultipleObjects: (pageId: string, ids: string[]) => void;

  /** Reset all objects on a page (undo all moves) */
  resetAllOnPage: (pageId: string) => void;

  /** Get objects for a specific page */
  getObjectsForPage: (pageId: string) => PdfNativeObject[];
}

export const useNativeObjectStore = create<NativeObjectState>((set, get) => ({
  objectsByPage: {},

  setObjects: (pageId, objects) =>
    set((state) => ({
      objectsByPage: {
        ...state.objectsByPage,
        // Preserve moves if objects were already extracted (e.g., re-render)
        [pageId]: objects.map((newObj) => {
          const existing = state.objectsByPage[pageId]?.find((o) => o.id === newObj.id);
          return existing ?? newObj;
        }),
      },
    })),

  moveObject: (pageId, id, newX, newY) =>
    set((state) => {
      const list = state.objectsByPage[pageId];
      if (!list) return state;
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [pageId]: list.map((obj) =>
            obj.id === id ? { ...obj, x: newX, y: newY, moved: true } : obj
          ),
        },
      };
    }),

  moveMultipleObjects: (pageId, updates) =>
    set((state) => {
      const list = state.objectsByPage[pageId];
      if (!list) return state;
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [pageId]: list.map((obj) => {
            const u = updateMap.get(obj.id);
            if (u) {
              return { ...obj, x: u.x, y: u.y, moved: true };
            }
            return obj;
          }),
        },
      };
    }),

  resetObject: (pageId, id) =>
    set((state) => {
      const list = state.objectsByPage[pageId];
      if (!list) return state;
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [pageId]: list.map((obj) =>
            obj.id === id
              ? { ...obj, x: obj.originalX, y: obj.originalY, moved: false }
              : obj
          ),
        },
      };
    }),

  resetMultipleObjects: (pageId, ids) =>
    set((state) => {
      const list = state.objectsByPage[pageId];
      if (!list) return state;
      const idSet = new Set(ids);
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [pageId]: list.map((obj) =>
            idSet.has(obj.id)
              ? { ...obj, x: obj.originalX, y: obj.originalY, moved: false }
              : obj
          ),
        },
      };
    }),

  resetAllOnPage: (pageId) =>
    set((state) => {
      const list = state.objectsByPage[pageId];
      if (!list) return state;
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [pageId]: list.map((obj) => ({
            ...obj,
            x: obj.originalX,
            y: obj.originalY,
            moved: false,
          })),
        },
      };
    }),

  getObjectsForPage: (pageId) => get().objectsByPage[pageId] ?? [],
}));
