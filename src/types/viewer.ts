import { PageTransitionType } from './document';

export type SidebarTab = 'pages' | 'search' | 'bookmarks' | 'ai' | 'properties' | 'none';

export type ActiveTool =
  | 'select'
  | 'hand'
  | 'text-select'
  | 'text-add'
  | 'draw'
  | 'highlight'
  | 'eraser'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'signature'
  | 'stamp'
  | 'image'
  | 'whiteout'
  | 'crop';

export interface SearchMatch {
  pageIndex: number;
  matchIndex: number;
  text: string;
}

export interface SearchState {
  isOpen: boolean;
  query: string;
  matchCase: boolean;
  results: SearchMatch[];
  currentIndex: number;
  isSearching: boolean;
}

export interface ToolStyleOptions {
  color: string;
  fillColor?: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  opacity: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
}

export interface ViewerPreferences {
  theme: 'dark' | 'light' | 'system';
  pageTransition: PageTransitionType;
  reduceMotion: boolean;
  thumbnailColumns: number; // 1 to 4
  sidebarWidth: number;
  sidebarOpen: boolean;
  activeSidebarTab: SidebarTab;
}

