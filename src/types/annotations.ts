export type AnnotationType =
  | 'text'
  | 'draw'
  | 'highlight'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'whiteout'
  | 'signature'
  | 'stamp'
  | 'image'
  | 'page-number'
  | 'underline'
  | 'strikethrough';

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
  type: 'rect' | 'circle' | 'line' | 'arrow' | 'whiteout';
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
}

export interface WhiteoutAnnotation extends BaseAnnotation {
  type: 'whiteout';
  color: string; // usually #ffffff or custom match
  borderColor?: string;
  borderWidth?: number;
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
  | WhiteoutAnnotation
  | ImageAnnotation;

/**
 * Represents an object that already exists in the original PDF
 * (text block or image). When moved, the original position gets
 * whiteout-masked and the content is redrawn at the new position.
 */
export interface PdfNativeObject {
  id: string;
  pageId: string;
  type: 'native-text' | 'native-image';
  // Current (possibly moved) position — in PDF points, unscaled
  x: number;
  y: number;
  width: number;
  height: number;
  // Original position — never changes after extraction
  originalX: number;
  originalY: number;
  originalWidth: number;
  originalHeight: number;
  // Text fields
  text?: string;
  fontSize?: number;
  fontName?: string;
  color?: string;
  // Raw 6-element PDF transform matrix from getTextContent()
  transform?: number[];
  // Image fields
  dataUrl?: string;
  // State flag: true = user moved this object away from its original position
  moved: boolean;
  // State flag: true = user permanently deleted this object (whiteout masked, no redraw)
  deleted?: boolean;
  // State flag: true = user modified text content
  isEdited?: boolean;
}
