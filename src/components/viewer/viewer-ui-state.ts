import { create } from 'zustand';

interface ViewerUIExtraState {
  inlineNativeEdit: boolean;
  twoPageCoverOffset: boolean;
  updaterProgress: number | null;
  downloadedUpdateVersion: string | null;

  setInlineNativeEdit: (enabled: boolean) => void;
  toggleInlineNativeEdit: () => void;
  setTwoPageCoverOffset: (offset: boolean) => void;
  toggleTwoPageCoverOffset: () => void;
  setUpdaterProgress: (percent: number | null) => void;
  setDownloadedUpdateVersion: (version: string | null) => void;
}

export const useViewerUIState = create<ViewerUIExtraState>((set) => ({
  inlineNativeEdit: false,
  twoPageCoverOffset: false,
  updaterProgress: null,
  downloadedUpdateVersion: null,

  setInlineNativeEdit: (inlineNativeEdit) => set({ inlineNativeEdit }),
  toggleInlineNativeEdit: () => set((s) => ({ inlineNativeEdit: !s.inlineNativeEdit })),
  setTwoPageCoverOffset: (twoPageCoverOffset) => set({ twoPageCoverOffset }),
  toggleTwoPageCoverOffset: () => set((s) => ({ twoPageCoverOffset: !s.twoPageCoverOffset })),
  setUpdaterProgress: (updaterProgress) => set({ updaterProgress }),
  setDownloadedUpdateVersion: (downloadedUpdateVersion) => set({ downloadedUpdateVersion }),
}));
