import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ViewMode, PageTransitionType } from '@/types/document';
import { ActiveTool, SearchState, SidebarTab } from '@/types/viewer';

interface ViewerState {
  zoom: number;
  viewMode: ViewMode;
  pageTransition: PageTransitionType;
  theme: 'dark' | 'light' | 'system';
  activeTool: ActiveTool;
  isPageManagerOpen: boolean;
  sidebarOpen: boolean;
  activeSidebarTab: SidebarTab;
  thumbnailSize: 'small' | 'medium' | 'large';

  // Search
  searchState: SearchState;

  // Actions
  setZoom: (zoom: number | ((prev: number) => number)) => void;
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
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setThumbnailSize: (size: 'small' | 'medium' | 'large') => void;

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

const getInitialTheme = (): 'dark' | 'light' | 'system' => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = localStorage.getItem('xpdf_theme') as 'dark' | 'light' | 'system';
    if (saved && (saved === 'dark' || saved === 'light' || saved === 'system')) {
      return saved;
    }
  }
  return 'dark';
};

export const useViewerStore = create<ViewerState>()(
  immer((set) => ({
    zoom: 1.0,
    viewMode: 'continuous',
    pageTransition: 'smooth',
    theme: getInitialTheme(),
    activeTool: 'select',
    isPageManagerOpen: false,
    sidebarOpen: true,
    activeSidebarTab: 'pages',
    thumbnailSize: 'medium',

    searchState: {
      isOpen: false,
      query: '',
      matchCase: false,
      results: [],
      currentIndex: 0,
      isSearching: false,
    },

    setZoom: (zoomOrFn) =>
      set((state) => {
        const nextZoom =
          typeof zoomOrFn === 'function' ? zoomOrFn(state.zoom) : zoomOrFn;
        state.zoom = Math.max(0.2, Math.min(5.0, parseFloat(nextZoom.toFixed(2))));
      }),

    zoomIn: () =>
      set((state) => {
        const next = ZOOM_STEPS.find((s) => s > state.zoom + 0.05);
        state.zoom = next || Math.min(5.0, state.zoom + 0.25);
      }),

    zoomOut: () =>
      set((state) => {
        const prev = [...ZOOM_STEPS].reverse().find((s) => s < state.zoom - 0.05);
        state.zoom = prev || Math.max(0.2, state.zoom - 0.25);
      }),

    resetZoom: () =>
      set((state) => {
        state.zoom = 1.0;
      }),

    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode;
      }),

    setPageTransition: (transition) =>
      set((state) => {
        state.pageTransition = transition;
      }),

    setTheme: (theme) =>
      set((state) => {
        state.theme = theme;
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('xpdf_theme', theme);
        }
        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (
            theme === 'dark' ||
            (theme === 'system' &&
              window.matchMedia('(prefers-color-scheme: dark)').matches)
          ) {
            root.classList.add('dark');
          } else {
            root.classList.remove('dark');
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
      }),

    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open;
      }),

    setActiveSidebarTab: (tab) =>
      set((state) => {
        state.activeSidebarTab = tab;
        if (tab !== 'none') {
          state.sidebarOpen = true;
        }
      }),

    setThumbnailSize: (size) =>
      set((state) => {
        state.thumbnailSize = size;
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
