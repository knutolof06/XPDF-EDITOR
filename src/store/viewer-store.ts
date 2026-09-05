import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ViewMode, PageTransitionType } from '@/types/document';
import { ActiveTool, SearchState, SidebarTab } from '@/types/viewer';

export type FitMode = 'none' | 'width' | 'page';

interface ViewerState {
  zoom: number;
  fitMode: FitMode;
  viewMode: ViewMode;
  pageTransition: PageTransitionType;
  theme: 'dark' | 'light' | 'system';
  activeTool: ActiveTool;
  isPageManagerOpen: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  activeSidebarTab: SidebarTab;
  thumbnailColumns: number; // 1, 2, 3, or 4

  // Search
  searchState: SearchState;

  // Actions
  setZoom: (zoom: number | ((prev: number) => number), keepFitMode?: boolean) => void;
  setFitMode: (mode: FitMode) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setViewMode: (mode: ViewMode) => void;
  setPageTransition: (transition: PageTransitionType) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setActiveTool: (tool: ActiveTool) => void;
  setPageManagerOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setThumbnailColumns: (columns: number) => void;

  // Search actions
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  setMatchCase: (matchCase: boolean) => void;
  setSearchResults: (results: any[]) => void;
  nextSearchResult: () => void;
  prevSearchResult: () => void;
  setSearching: (searching: boolean) => void;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];

// Load persisted settings from localStorage
interface SavedSettings {
  theme?: 'dark' | 'light' | 'system';
  viewMode?: ViewMode;
  zoom?: number;
  fitMode?: FitMode;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  thumbnailColumns?: number;
  activeSidebarTab?: SidebarTab;
}

function loadSavedSettings(): SavedSettings {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem('xpdf_settings');
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return {};
}

function saveSettings(partial: Partial<SavedSettings>) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = loadSavedSettings();
    const updated = { ...existing, ...partial };
    localStorage.setItem('xpdf_settings', JSON.stringify(updated));
  } catch {
    // ignore
  }
}

const saved = loadSavedSettings();

export const useViewerStore = create<ViewerState>()(
  immer((set) => ({
    zoom: saved.zoom || 1.0,
    fitMode: saved.fitMode || 'width', // Default 'width' for responsive auto-fit
    viewMode: saved.viewMode || 'continuous',
    pageTransition: 'instant', // Kapali default
    theme: saved.theme || 'dark',
    activeTool: 'select',
    isPageManagerOpen: false,
    sidebarOpen: saved.sidebarOpen !== undefined ? saved.sidebarOpen : true,
    sidebarWidth: saved.sidebarWidth || 320,
    activeSidebarTab: saved.activeSidebarTab || 'pages',
    thumbnailColumns: Math.min(4, Math.max(1, saved.thumbnailColumns || 2)), // Default 2 (S)

    searchState: {
      isOpen: false,
      query: '',
      matchCase: false,
      results: [],
      currentIndex: 0,
      isSearching: false,
    },

    setZoom: (zoomOrFn, keepFitMode = false) =>
      set((state) => {
        const nextZoom =
          typeof zoomOrFn === 'function' ? zoomOrFn(state.zoom) : zoomOrFn;
        state.zoom = Math.max(0.2, Math.min(5.0, parseFloat(nextZoom.toFixed(2))));
        if (!keepFitMode) {
          state.fitMode = 'none';
          saveSettings({ zoom: state.zoom, fitMode: 'none' });
        } else {
          saveSettings({ zoom: state.zoom });
        }
      }),

    setFitMode: (mode) =>
      set((state) => {
        state.fitMode = mode;
        saveSettings({ fitMode: mode });
      }),

    zoomIn: () =>
      set((state) => {
        const next = ZOOM_STEPS.find((s) => s > state.zoom + 0.05);
        state.zoom = next || Math.min(5.0, state.zoom + 0.25);
        state.fitMode = 'none';
        saveSettings({ zoom: state.zoom, fitMode: 'none' });
      }),

    zoomOut: () =>
      set((state) => {
        const prev = [...ZOOM_STEPS].reverse().find((s) => s < state.zoom - 0.05);
        state.zoom = prev || Math.max(0.2, state.zoom - 0.25);
        state.fitMode = 'none';
        saveSettings({ zoom: state.zoom, fitMode: 'none' });
      }),

    resetZoom: () =>
      set((state) => {
        state.zoom = 1.0;
        state.fitMode = 'none';
        saveSettings({ zoom: 1.0, fitMode: 'none' });
      }),

    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode;
        saveSettings({ viewMode: mode });
      }),

    setPageTransition: (transition) =>
      set((state) => {
        state.pageTransition = transition;
      }),

    setTheme: (theme) =>
      set((state) => {
        state.theme = theme;
        saveSettings({ theme });
        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (
            theme === 'dark' ||
            (theme === 'system' &&
              window.matchMedia('(prefers-color-scheme: dark)').matches)
          ) {
            root.classList.add('dark');
            root.classList.remove('light');
          } else {
            root.classList.remove('dark');
            root.classList.add('light');
          }
        }
      }),

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
      }),

    setPageManagerOpen: (open) =>
      set((state) => {
        state.isPageManagerOpen = open;
      }),

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
        saveSettings({ sidebarOpen: state.sidebarOpen });
      }),

    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open;
        saveSettings({ sidebarOpen: open });
      }),

    setSidebarWidth: (width) =>
      set((state) => {
        state.sidebarWidth = Math.max(200, Math.min(800, width));
        saveSettings({ sidebarWidth: state.sidebarWidth });
      }),

    setActiveSidebarTab: (tab) =>
      set((state) => {
        state.activeSidebarTab = tab;
        if (tab !== 'none') {
          state.sidebarOpen = true;
        }
        saveSettings({ activeSidebarTab: tab, sidebarOpen: state.sidebarOpen });
      }),

    setThumbnailColumns: (columns) =>
      set((state) => {
        const cols = Math.min(4, Math.max(1, columns));
        state.thumbnailColumns = cols;
        // Auto-adapt sidebar width if currently too narrow for cols
        const minWidthForCols = cols === 1 ? 240 : cols === 2 ? 320 : cols === 3 ? 460 : 600;
        if (state.sidebarWidth < minWidthForCols) {
          state.sidebarWidth = minWidthForCols;
        }
        saveSettings({ thumbnailColumns: cols, sidebarWidth: state.sidebarWidth });
      }),

    // Search actions
    openSearch: () =>
      set((state) => {
        state.searchState.isOpen = true;
      }),

    closeSearch: () =>
      set((state) => {
        state.searchState.isOpen = false;
        state.searchState.query = '';
        state.searchState.results = [];
        state.searchState.currentIndex = 0;
      }),

    setSearchQuery: (query) =>
      set((state) => {
        state.searchState.query = query;
      }),

    setMatchCase: (matchCase) =>
      set((state) => {
        state.searchState.matchCase = matchCase;
      }),

    setSearchResults: (results) =>
      set((state) => {
        state.searchState.results = results;
        state.searchState.currentIndex = results.length > 0 ? 0 : -1;
      }),

    nextSearchResult: () =>
      set((state) => {
        const len = state.searchState.results.length;
        if (len === 0) return;
        state.searchState.currentIndex =
          (state.searchState.currentIndex + 1) % len;
      }),

    prevSearchResult: () =>
      set((state) => {
        const len = state.searchState.results.length;
        if (len === 0) return;
        state.searchState.currentIndex =
          (state.searchState.currentIndex - 1 + len) % len;
      }),

    setSearching: (searching) =>
      set((state) => {
        state.searchState.isSearching = searching;
      }),
  }))
);
