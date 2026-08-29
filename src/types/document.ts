import { AnyAnnotation } from './annotations';

export type ViewMode =
  | 'single'
  | 'fit-width'
  | 'fit-page'
  | 'two-page'
  | 'four-page'
  | 'continuous'
  | 'continuous-horizontal';

export type PageTransitionType =
  | 'classic'
  | 'slide'
  | 'smooth'
  | 'stack'
  | 'book'
  | 'zoom'
  | 'instant';

export interface PdfPageModel {
  id: string;
  sourceDocId: string;
  sourcePageIndex: number; // 0-based original index
  displayPageNumber: number; // 1-based current logical number
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
  aspectRatio: number;
  crop?: { x: number; y: number; width: number; height: number };
  annotations: AnyAnnotation[];
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  pdfVersion?: string;
  fileSizeFormatted?: string;
}

export interface PdfDocumentModel {
  id: string;
  name: string;
  fileSize: number;
  totalPages: number;
  pages: PdfPageModel[];
  selectedPageIds: string[];
  activePageId: string;
  activePageIndex: number; // 0-based in logical pages array
  metadata: PdfMetadata;
  isModified: boolean;
  version: number;
}

export interface RecentDocumentItem {
  id: string;
  name: string;
  fileSize: number;
  pageCount: number;
  lastOpened: number;
}
