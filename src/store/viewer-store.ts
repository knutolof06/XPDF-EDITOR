import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { ViewMode, PageTransitionType } from '@/types/document';
import { ActiveTool, SearchState, SidebarTab, AppDesignTheme, AccentColor, UIDensity } from '@/types/viewer';
import type { OcrPageResult } from '@/core/ocr/ocr-service';
import { useAnnotationStore } from './annotation-store';

export type FitMode = 'none' | 'width' | 'page' | 'content';
export type ReadingTheme = 'default' | 'dark' | 'sepia' | 'high-contrast';

export interface OcrWordHighlight {
  normBbox: { x: number; y: number; width: number; height: number };
  text: string;
}

export interface OcrHighlightPulseState {
  pageIndex: number;
  words: OcrWordHighlight[];
  wordCount: number;
  timestamp: number;
  lastOcrPageResult?: OcrPageResult;
}

interface ViewerState {
  zoom: number;
  fitMode: FitMode;
  readingTheme: ReadingTheme;
  viewMode: ViewMode;
  pageTransition: PageTransitionType;
  theme: 'dark' | 'light' | 'system';
  appDesignTheme: AppDesignTheme;
  accentColor: AccentColor;
  uiDensity: UIDensity;
  activeTool: ActiveTool;
  isPageManagerOpen: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  activeSidebarTab: SidebarTab;
  thumbnailColumns: number; // 1, 2, 3, or 4

  // OCR visual highlight pulse
  ocrHighlightPulse: OcrHighlightPulseState | null;

  // Search
  searchState: SearchState;

  // Actions
  setOcrHighlightPulse: (pulse: OcrHighlightPulseState | null) => void;
  setZoom: (zoom: number | ((prev: number) => number), keepFitMode?: boolean) => void;
  setFitMode: (mode: FitMode) => void;
  setReadingTheme: (theme: ReadingTheme) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setViewMode: (mode: ViewMode) => void;
  setPageTransition: (transition: PageTransitionType) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setAppDesignTheme: (theme: AppDesignTheme) => void;
  setAccentColor: (accent: AccentColor) => void;
  setUIDensity: (density: UIDensity) => void;
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
  setSearchResults: (results: SearchState['results']) => void;
  nextSearchResult: () => void;
  prevSearchResult: () => void;
  setSearching: (searching: boolean) => void;
}

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];

// Load persisted settings from localStorage
interface SavedSettings {
  theme?: 'dark' | 'light' | 'system';
  appDesignTheme?: AppDesignTheme;
  accentColor?: AccentColor;
  uiDensity?: UIDensity;
  viewMode?: ViewMode;
  pageTransition?: PageTransitionType;
  zoom?: number;
  fitMode?: FitMode;
  readingTheme?: ReadingTheme;
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

function saveSettings(partial: Partial<SavedSettings>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = loadSavedSettings();
    const updated = { ...existing, ...partial };
    localStorage.setItem('xpdf_settings', JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export function resolveDarkTheme(theme: 'dark' | 'light' | 'system'): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyThemeToDom(theme: 'dark' | 'light' | 'system'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolveDarkTheme(theme)) {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }
}

const saved = loadSavedSettings();

export const useViewerStore = create<ViewerState>()(
  immer((set) => ({
    zoom: saved.zoom || 1.0,
    fitMode: saved.fitMode || 'width', // Default 'width' for responsive auto-fit
    readingTheme: saved.readingTheme || 'default',
    viewMode: saved.viewMode || 'continuous',
    pageTransition: saved.pageTransition || 'instant',
    theme: saved.theme || 'dark',
    appDesignTheme: saved.appDesignTheme || 'fluent',
    accentColor: saved.accentColor || 'sky',
    uiDensity: saved.uiDensity || 'comfortable',
    activeTool: 'select',
    isPageManagerOpen: false,
    sidebarOpen: saved.sidebarOpen !== undefined ? saved.sidebarOpen : true,
    sidebarWidth: saved.sidebarWidth || 320,
    activeSidebarTab: saved.activeSidebarTab || 'pages',
    thumbnailColumns: Math.min(4, Math.max(1, saved.thumbnailColumns || 2)), // Default 2 (S)
    ocrHighlightPulse: null,

    searchState: {
      isOpen: false,
      query: '',
      matchCase: false,
      results: [],
      currentIndex: 0,
      isSearching: false,
    },

    setOcrHighlightPulse: (pulse) =>
      set((state) => {
        state.ocrHighlightPulse = pulse as OcrHighlightPulseState | null;
      }),

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

    setReadingTheme: (theme) =>
      set((state) => {
        state.readingTheme = theme;
        saveSettings({ readingTheme: theme });
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
        saveSettings({ pageTransition: transition });
      }),

    setTheme: (theme) =>
      set((state) => {
        state.theme = theme;
        saveSettings({ theme });
        applyThemeToDom(theme);
      }),

    setAppDesignTheme: (appDesignTheme) =>
      set((state) => {
        state.appDesignTheme = appDesignTheme;
        saveSettings({ appDesignTheme });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-design-theme', appDesignTheme);
        }
      }),

    setAccentColor: (accentColor) =>
      set((state) => {
        state.accentColor = accentColor;
        saveSettings({ accentColor });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-accent', accentColor);
        }
      }),

    setUIDensity: (uiDensity) =>
      set((state) => {
        state.uiDensity = uiDensity;
        saveSettings({ uiDensity });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-density', uiDensity);
        }
      }),

    setActiveTool: (tool) => {
      set((state) => {
        state.activeTool = tool;
      });
      const annState = useAnnotationStore.getState();
      if (annState.activeTool !== tool || (tool !== 'select' && annState.selectedAnnotationId !== null)) {
        useAnnotationStore.setState((s) => {
          s.activeTool = tool;
          if (tool !== 'select') {
            s.selectedAnnotationId = null;
          }
        });
      }
    },

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

// Keep DOM theme synchronized when OS color scheme changes and theme === 'system'
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (useViewerStore.getState().theme === 'system') {
        applyThemeToDom('system');
      }
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof (mediaQuery as { addListener?: (cb: () => void) => void }).addListener === 'function') {
      (mediaQuery as { addListener: (cb: () => void) => void }).addListener(handleSystemThemeChange);
    }
    applyThemeToDom(useViewerStore.getState().theme);
  } catch {
    // ignore in non-browser environments
  }
}
