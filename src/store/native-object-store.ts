import { create } from 'zustand';
import { PdfNativeObject } from '@/types/annotations';
import { useDocumentStore } from './document-store';
import { historyManager, NativeObjectCommand } from '@/core/history/command-manager';

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

  /** Reset a moved/edited/deleted object back to its original position and text */
  resetObject: (pageId: string, id: string) => void;

  /** Reset multiple objects back to their original position and text */
  resetMultipleObjects: (pageId: string, ids: string[]) => void;

  /** Update text content of a native text object */
  updateObjectText: (pageId: string, id: string, newText: string) => void;

  /** Mark a single object as deleted */
  deleteObject: (pageId: string, id: string) => void;

  /** Mark multiple objects as deleted */
  deleteMultipleObjects: (pageId: string, ids: string[]) => void;

  /** Restore a deleted object */
  restoreObject: (pageId: string, id: string) => void;

  /** Reset all objects on a page (undo all moves/edits/deletes) */
  resetAllOnPage: (pageId: string) => void;

  /** Get objects for a specific page */
  getObjectsForPage: (pageId: string) => PdfNativeObject[];

  /** Migrate stored objects when page IDs change during structural assembly */
  migratePageObjects: (oldPageId: string, newPageId: string) => void;

  /** Clear all stored objects belonging to a closed document */
  clearDocObjects: (docId: string, pageIds?: string[]) => void;
}

function applyPageMutation(
  get: () => NativeObjectState,
  set: (fn: (state: NativeObjectState) => NativeObjectState | Partial<NativeObjectState>) => void,
  pageId: string,
  description: string,
  transform: (list: PdfNativeObject[]) => PdfNativeObject[],
  mergeKey?: string
): void {
  const prevList = get().objectsByPage[pageId];
  if (!prevList) return;

  const prevSnapshot = prevList.map((o) => ({ ...o }));
  const nextSnapshot = transform(prevList).map((o) => ({ ...o }));

  const doc = useDocumentStore.getState().currentDocument;
  const prevModified = doc?.isModified ?? false;

  set((state) => ({
    objectsByPage: {
      ...state.objectsByPage,
      [pageId]: nextSnapshot,
    },
  }));

  if (doc) {
    useDocumentStore.setState((s) => {
      if (s.currentDocument) {
        s.currentDocument.isModified = true;
      }
    });
  }

  if (!historyManager.isApplying()) {
    historyManager.push(
      new NativeObjectCommand(description, pageId, prevSnapshot, nextSnapshot, prevModified, {
        docId: doc?.id,
        mergeKey,
      }),
      doc?.id
    );
  }
}

function resetObjectFields(obj: PdfNativeObject): PdfNativeObject {
  return {
    ...obj,
    x: obj.originalX,
    y: obj.originalY,
    width: obj.originalWidth,
    height: obj.originalHeight,
    text: obj.originalText ?? obj.text,
    moved: false,
    deleted: false,
    isEdited: false,
  };
}

export const useNativeObjectStore = create<NativeObjectState>((set, get) => ({
  objectsByPage: {},

  setObjects: (pageId, objects) =>
    set((state) => ({
      objectsByPage: {
        ...state.objectsByPage,
        // Preserve moves/edits if objects were already extracted (e.g., re-render)
        [pageId]: objects.map((newObj) => {
          const normalizedNew: PdfNativeObject = {
            ...newObj,
            originalText: newObj.originalText ?? newObj.text,
          };
          const existing = state.objectsByPage[pageId]?.find((o) => o.id === normalizedNew.id);
          return existing
            ? {
                ...existing,
                originalText: existing.originalText ?? normalizedNew.originalText,
                dataUrl: existing.dataUrl ?? normalizedNew.dataUrl,
              }
            : normalizedNew;
        }),
      },
    })),

  moveObject: (pageId, id, newX, newY) =>
    applyPageMutation(
      get,
      set,
      pageId,
      'Nesne taşındı',
      (list) =>
        list.map((obj) => (obj.id === id ? { ...obj, x: newX, y: newY, moved: true } : obj)),
      `native-move:${pageId}:${id}`
    ),

  moveMultipleObjects: (pageId, updates) => {
    const updateMap = new Map(updates.map((u) => [u.id, u]));
    applyPageMutation(
      get,
      set,
      pageId,
      `${updates.length} nesne taşındı`,
      (list) =>
        list.map((obj) => {
          const u = updateMap.get(obj.id);
          return u ? { ...obj, x: u.x, y: u.y, moved: true } : obj;
        }),
      `native-move-multi:${pageId}`
    );
  },

  resetObject: (pageId, id) =>
    applyPageMutation(get, set, pageId, 'Nesne sıfırlandı', (list) =>
      list.map((obj) => (obj.id === id ? resetObjectFields(obj) : obj))
    ),

  resetMultipleObjects: (pageId, ids) => {
    const idSet = new Set(ids);
    applyPageMutation(get, set, pageId, `${ids.length} nesne sıfırlandı`, (list) =>
      list.map((obj) => (idSet.has(obj.id) ? resetObjectFields(obj) : obj))
    );
  },

  updateObjectText: (pageId, id, newText) =>
    applyPageMutation(get, set, pageId, 'Nesne metni düzenlendi', (list) =>
      list.map((obj) => {
        if (obj.id !== id) return obj;
        const originalText = obj.originalText ?? obj.text;
        return {
          ...obj,
          originalText,
          text: newText,
          isEdited: newText !== originalText,
        };
      })
    ),

  deleteObject: (pageId, id) =>
    applyPageMutation(get, set, pageId, 'Nesne silindi', (list) =>
      list.map((obj) => (obj.id === id ? { ...obj, deleted: true } : obj))
    ),

  deleteMultipleObjects: (pageId, ids) => {
    const idSet = new Set(ids);
    applyPageMutation(get, set, pageId, `${ids.length} nesne silindi`, (list) =>
      list.map((obj) => (idSet.has(obj.id) ? { ...obj, deleted: true } : obj))
    );
  },

  restoreObject: (pageId, id) =>
    applyPageMutation(get, set, pageId, 'Nesne geri yüklendi', (list) =>
      list.map((obj) => (obj.id === id ? { ...obj, deleted: false } : obj))
    ),

  resetAllOnPage: (pageId) =>
    applyPageMutation(get, set, pageId, 'Sayfadaki tüm nesneler sıfırlandı', (list) =>
      list.map(resetObjectFields)
    ),

  getObjectsForPage: (pageId) => get().objectsByPage[pageId] ?? [],

  migratePageObjects: (oldPageId, newPageId) =>
    set((state) => {
      const sourceList = state.objectsByPage[oldPageId];
      if (!sourceList || oldPageId === newPageId) return state;
      const migrated = sourceList.map((o) => ({
        ...o,
        pageId: newPageId,
      }));
      return {
        objectsByPage: {
          ...state.objectsByPage,
          [newPageId]: migrated,
        },
      };
    }),

  clearDocObjects: (docId, pageIds) =>
    set((state) => {
      const next = { ...state.objectsByPage };
      const pageIdSet = new Set(pageIds || []);
      let changed = false;
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${docId}_`) || pageIdSet.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? { objectsByPage: next } : state;
    }),
}));
