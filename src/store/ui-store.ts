import { create } from 'zustand';

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
}

interface UIState {
  toasts: ToastItem[];
  isPropertiesModalOpen: boolean;
  isShortcutsModalOpen: boolean;
  isMergeModalOpen: boolean;
  isSplitModalOpen: boolean;
  isInsertModalOpen: boolean;
  isPageLayoutModalOpen: boolean;
  isSignatureModalOpen: boolean;
  isStampModalOpen: boolean;
  isPageNumberModalOpen: boolean;
  isHeaderFooterModalOpen: boolean;
  isPageEqualizeModalOpen: boolean;
  isObjectEditorOpen: boolean;
  pendingInsertFile: File | null;

  addToast: (message: string, type?: ToastItem['type'], duration?: number) => void;
  removeToast: (id: string) => void;
  setPropertiesModalOpen: (open: boolean) => void;
  setShortcutsModalOpen: (open: boolean) => void;
  setMergeModalOpen: (open: boolean) => void;
  setSplitModalOpen: (open: boolean) => void;
  setInsertModalOpen: (open: boolean, file?: File | null) => void;
  setPageLayoutModalOpen: (open: boolean) => void;
  setSignatureModalOpen: (open: boolean) => void;
  setStampModalOpen: (open: boolean) => void;
  setPageNumberModalOpen: (open: boolean) => void;
  setHeaderFooterModalOpen: (open: boolean) => void;
  setPageEqualizeModalOpen: (open: boolean) => void;
  setObjectEditorOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  isPropertiesModalOpen: false,
  isShortcutsModalOpen: false,
  isMergeModalOpen: false,
  isSplitModalOpen: false,
  isInsertModalOpen: false,
  isPageLayoutModalOpen: false,
  isSignatureModalOpen: false,
  isStampModalOpen: false,
  isPageNumberModalOpen: false,
  isHeaderFooterModalOpen: false,
  isPageEqualizeModalOpen: false,
  isObjectEditorOpen: false,
  pendingInsertFile: null,

  addToast: (message, type = 'info', duration = 3000) => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration }],
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  setPropertiesModalOpen: (open) => set({ isPropertiesModalOpen: open }),
  setShortcutsModalOpen: (open) => set({ isShortcutsModalOpen: open }),
  setMergeModalOpen: (open) => set({ isMergeModalOpen: open }),
  setSplitModalOpen: (open) => set({ isSplitModalOpen: open }),
  setInsertModalOpen: (open, file = null) =>
    set({ isInsertModalOpen: open, pendingInsertFile: file }),
  setPageLayoutModalOpen: (open) => set({ isPageLayoutModalOpen: open }),
  setSignatureModalOpen: (open) => set({ isSignatureModalOpen: open }),
  setStampModalOpen: (open) => set({ isStampModalOpen: open }),
  setPageNumberModalOpen: (open) => set({ isPageNumberModalOpen: open }),
  setHeaderFooterModalOpen: (open) => set({ isHeaderFooterModalOpen: open }),
  setPageEqualizeModalOpen: (open) => set({ isPageEqualizeModalOpen: open }),
  setObjectEditorOpen: (open) => set({ isObjectEditorOpen: open }),
}));
