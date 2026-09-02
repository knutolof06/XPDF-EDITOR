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
      if (!item.str || item.str.trim() === '') continue;

      const transform: number[] = item.transform;
      const fontHeight = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);
      const itemWidth = item.width || fontHeight * item.str.length * 0.6;

      const x = transform[4];
      const y = pageHeight - transform[5] - fontHeight;
      const w = Math.max(itemWidth, 10);
      const h = Math.max(fontHeight, 10);

      const obj: PdfNativeObject = {
        id: `native_txt_${pageId}_${idx++}`,
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

/**
 * Extracts image/QObject references from a PDF page using getOperatorList().
 * Tracks the CTM (current transformation matrix) through save/restore/transform
 * operators to compute each image's position and size in PDF points.
 *
 * Note: This captures raster images embedded in the PDF (photos, QR codes, logos, stamps).
 */
export async function extractNativeImageObjects(
  pdfPage: pdfjsLib.PDFPageProxy,
  pageId: string
): Promise<PdfNativeObject[]> {
  try {
    const viewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const pageHeight = viewport.height;

    const OPS = pdfjsLib.OPS;
    const opList = await pdfPage.getOperatorList();

    const objects: PdfNativeObject[] = [];
    const ctmStack: number[][] = [[1, 0, 0, 1, 0, 0]]; // identity matrix
    let idx = 0;

    const multiplyMatrix = (a: number[], b: number[]): number[] => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];

    const currentCTM = () => ctmStack[ctmStack.length - 1];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === OPS.save) {
        ctmStack.push([...currentCTM()]);
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 1) ctmStack.pop();
      } else if (fn === OPS.transform) {
        const [a, b, c, d, e, f] = args as number[];
        const newCTM = multiplyMatrix(currentCTM(), [a, b, c, d, e, f]);
        ctmStack[ctmStack.length - 1] = newCTM;
      } else if (
        fn === OPS.paintImageXObject ||
        fn === (OPS as any).paintJpegXObject ||
        fn === (OPS as any).paintImageXObjectRepeat ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintXObject
      ) {
        // Current CTM gives us position and scale
        const ctm = currentCTM();
        // In PDF, the image unit square [0,0]→[1,1] is transformed by CTM
        // ctm[4], ctm[5] = translation (bottom-left x,y in PDF points)
        // ctm[0], ctm[3] = scale x, scale y
        const imgX = ctm[4];
        const imgY = ctm[5];
        const imgW = Math.abs(ctm[0]);
        const imgH = Math.abs(ctm[3]);

        // Convert from bottom-left PDF origin to top-left
        const xTopLeft = imgX;
        const yTopLeft = pageHeight - imgY - imgH;

        if (imgW > 5 && imgH > 5) {
          const obj: PdfNativeObject = {
            id: `native_img_${pageId}_${idx++}`,
            pageId,
            type: 'native-image',
            x: xTopLeft,
            y: yTopLeft,
            width: imgW,
            height: imgH,
            originalX: xTopLeft,
            originalY: yTopLeft,
            originalWidth: imgW,
            originalHeight: imgH,
            moved: false,
          };
          objects.push(obj);
        }
      }
    }

    return objects;
  } catch (err) {
    console.warn('extractNativeImageObjects failed:', err);
    return [];
  }
}

/**
 * Extracts ALL native objects (text + images) from a PDF page.
 * Text objects are returned first, then image objects.
 */
export async function extractAllNativeObjects(
  pdfPage: pdfjsLib.PDFPageProxy,
  pageId: string
): Promise<PdfNativeObject[]> {
  const [textObjs, imageObjs] = await Promise.all([
    extractNativeTextObjects(pdfPage, pageId),
    extractNativeImageObjects(pdfPage, pageId),
  ]);
  return [...textObjs, ...imageObjs];
}
