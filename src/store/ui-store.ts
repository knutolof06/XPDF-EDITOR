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
  isPasswordModalOpen: boolean;
  pendingPasswordDoc: { name: string; buffer: ArrayBuffer; filePath?: string } | null;
  isCloseConfirmModalOpen: boolean;
  pendingCloseTabId: string | null;
  pendingInsertFile: File | null;
  isCompressModalOpen: boolean;
  isExportImageModalOpen: boolean;
  isImagesToPdfModalOpen: boolean;
  isWatermarkModalOpen: boolean;
  isRightToolsSidebarOpen: boolean;
  isExtractTextModalOpen: boolean;
  isSecurityModalOpen: boolean;
  isSignatureVerifyModalOpen: boolean;
  isInsertBlankPageModalOpen: boolean;
  pendingBlankPageInsertIndex: number | null;

  addToast: (message: string, type?: ToastItem['type'], duration?: number) => void;
  removeToast: (id: string) => void;
  setPropertiesModalOpen: (open: boolean) => void;
  setShortcutsModalOpen: (open: boolean) => void;
  setMergeModalOpen: (open: boolean) => void;
  setSplitModalOpen: (open: boolean) => void;
  setInsertModalOpen: (open: boolean, file?: File | null) => void;
  setInsertBlankPageModalOpen: (open: boolean, insertIndex?: number | null) => void;
  setPageLayoutModalOpen: (open: boolean) => void;
  setSignatureModalOpen: (open: boolean) => void;
  setStampModalOpen: (open: boolean) => void;
  setPageNumberModalOpen: (open: boolean) => void;
  setHeaderFooterModalOpen: (open: boolean) => void;
  setPageEqualizeModalOpen: (open: boolean) => void;
  setObjectEditorOpen: (open: boolean) => void;
  setPasswordModalOpen: (open: boolean, doc?: { name: string; buffer: ArrayBuffer; filePath?: string } | null) => void;
  setCloseConfirmModalOpen: (open: boolean, tabId?: string | null) => void;
  setCompressModalOpen: (open: boolean) => void;
  setExportImageModalOpen: (open: boolean) => void;
  setImagesToPdfModalOpen: (open: boolean) => void;
  setWatermarkModalOpen: (open: boolean) => void;
  setRightToolsSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setExtractTextModalOpen: (open: boolean) => void;
  setSecurityModalOpen: (open: boolean) => void;
  setSignatureVerifyModalOpen: (open: boolean) => void;
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
  isPasswordModalOpen: false,
  pendingPasswordDoc: null,
  isCloseConfirmModalOpen: false,
  pendingCloseTabId: null,
  pendingInsertFile: null,
  isCompressModalOpen: false,
  isExportImageModalOpen: false,
  isImagesToPdfModalOpen: false,
  isWatermarkModalOpen: false,
  isRightToolsSidebarOpen: true,
  isExtractTextModalOpen: false,
  isSecurityModalOpen: false,
  isSignatureVerifyModalOpen: false,
  isInsertBlankPageModalOpen: false,
  pendingBlankPageInsertIndex: null,

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
  setInsertBlankPageModalOpen: (open, insertIndex = null) =>
    set({ isInsertBlankPageModalOpen: open, pendingBlankPageInsertIndex: insertIndex }),
  setPageLayoutModalOpen: (open) => set({ isPageLayoutModalOpen: open }),
  setSignatureModalOpen: (open) => set({ isSignatureModalOpen: open }),
  setStampModalOpen: (open) => set({ isStampModalOpen: open }),
  setPageNumberModalOpen: (open) => set({ isPageNumberModalOpen: open }),
  setHeaderFooterModalOpen: (open) => set({ isHeaderFooterModalOpen: open }),
  setPageEqualizeModalOpen: (open) => set({ isPageEqualizeModalOpen: open }),
  setObjectEditorOpen: (open) => set({ isObjectEditorOpen: open }),
  setPasswordModalOpen: (open, doc = null) => set({ isPasswordModalOpen: open, pendingPasswordDoc: doc }),
  setCloseConfirmModalOpen: (open, tabId = null) => set({ isCloseConfirmModalOpen: open, pendingCloseTabId: tabId }),
  setCompressModalOpen: (open) => set({ isCompressModalOpen: open }),
  setExportImageModalOpen: (open) => set({ isExportImageModalOpen: open }),
  setImagesToPdfModalOpen: (open) => set({ isImagesToPdfModalOpen: open }),
  setWatermarkModalOpen: (open) => set({ isWatermarkModalOpen: open }),
  setRightToolsSidebarOpen: (open) =>
    set((state) => ({
      isRightToolsSidebarOpen: typeof open === 'function' ? open(state.isRightToolsSidebarOpen) : open,
    })),
  setExtractTextModalOpen: (open) => set({ isExtractTextModalOpen: open }),
  setSecurityModalOpen: (open) => set({ isSecurityModalOpen: open }),
  setSignatureVerifyModalOpen: (open) => set({ isSignatureVerifyModalOpen: open }),
}));
