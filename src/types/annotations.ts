export type AnnotationType =
  | 'text'
  | 'draw'
  | 'highlight'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'signature'
  | 'stamp'
  | 'image'
  | 'page-number';

export interface BaseAnnotation {
  id: string;
  pageId: string;
  type: AnnotationType;
  x: number; // in points (PDF coordinates relative to page width/height)
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
}

export interface DrawingAnnotation extends BaseAnnotation {
  type: 'draw' | 'highlight';
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
}

export interface ShapeAnnotation extends BaseAnnotation {
  type: 'rect' | 'circle' | 'line' | 'arrow';
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
}

export interface ImageAnnotation extends BaseAnnotation {
  type: 'image' | 'signature' | 'stamp';
  dataUrl: string; // Base64 image
  label?: string;
}

export interface PageNumberConfig {
  enabled: boolean;
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  format: 'number-only' | 'page-x-of-y' | 'custom';
  prefix?: string;
  fontSize: number;
  color: string;
  startFrom: number;
}

export interface HeaderFooterConfig {
  headerText?: string;
  footerText?: string;
  fontSize: number;
  color: string;
}

export type AnyAnnotation =
  | TextAnnotation
  | DrawingAnnotation
  | ShapeAnnotation
  | ImageAnnotation;
