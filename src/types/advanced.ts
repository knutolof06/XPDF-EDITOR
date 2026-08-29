export interface BookmarkItem {
  id: string;
  title: string;
  pageIndex: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  children?: BookmarkItem[];
}

export interface FormFieldModel {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown';
  value: string | boolean;
  options?: string[];
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface CompareState {
  isOpen: boolean;
  docA: { id: string; name: string; pageIndex: number };
  docB: { id: string; name: string; pageIndex: number };
  syncScroll: boolean;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}
