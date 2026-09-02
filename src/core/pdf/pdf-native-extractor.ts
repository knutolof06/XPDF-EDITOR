import * as pdfjsLib from 'pdfjs-dist';
import { PdfNativeObject } from '@/types/annotations';

/**
 * Extracts existing text blocks from a PDF page using PDF.js getTextContent().
 * Returns each text item as a PdfNativeObject with unscaled PDF-point coordinates.
 *
 * Coordinate note:
 *   PDF.js getTextContent() gives transform [a,b,c,d,e,f] where:
 *     e = x (from left), f = y (from bottom, PDF convention)
 *   We convert f → y-from-top: y_top = pageHeight - f - fontHeight
 */
export async function extractNativeTextObjects(
  pdfPage: pdfjsLib.PDFPageProxy,
  pageId: string
): Promise<PdfNativeObject[]> {
  try {
    const viewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const pageHeight = viewport.height;

    const textContent = await pdfPage.getTextContent();
    const objects: PdfNativeObject[] = [];

    let idx = 0;
    for (const item of textContent.items as any[]) {
      // Skip empty / whitespace-only strings
      if (!item.str || item.str.trim() === '') continue;

      const transform: number[] = item.transform;
      // Font height from transform matrix (scale component)
      const fontHeight = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);
      const itemWidth = item.width || fontHeight * item.str.length * 0.6;

      // PDF origin is bottom-left; convert to top-left
      const x = transform[4];
      const y = pageHeight - transform[5] - fontHeight;
      const w = Math.max(itemWidth, 10);
      const h = Math.max(fontHeight, 10);

      const obj: PdfNativeObject = {
        id: `native_${pageId}_${idx++}`,
        pageId,
        type: 'native-text',
        x,
        y,
        width: w,
        height: h,
        originalX: x,
        originalY: y,
        originalWidth: w,
        originalHeight: h,
        text: item.str,
        fontSize: fontHeight,
        fontName: item.fontName || 'Helvetica',
        color: '#000000',
        transform,
        moved: false,
      };
      objects.push(obj);
    }

    return objects;
  } catch (err) {
    console.warn('extractNativeTextObjects failed:', err);
    return [];
  }
}
