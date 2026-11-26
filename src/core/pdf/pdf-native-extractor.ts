import * as pdfjsLib from 'pdfjs-dist';
import { PdfNativeObject } from '@/types/annotations';

interface PdfJsRawImage {
  data?: Uint8ClampedArray | Uint8Array;
  width?: number;
  height?: number;
  kind?: number;
  bitmap?: ImageBitmap;
}

function multiplyMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function resolvePdfJsImage(
  pdfPage: pdfjsLib.PDFPageProxy,
  objId: string
): Promise<unknown> {
  const pool = objId.startsWith('g_') ? pdfPage.commonObjs : pdfPage.objs;
  if (!pool) return null;

  try {
    if (pool.has(objId)) {
      return pool.get(objId);
    }
  } catch {
    // fallback to callback wait
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 300);

    try {
      pool.get(objId, (data: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(data);
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

function imageObjectToDataUrl(imgObj: unknown): string | undefined {
  if (!imgObj || typeof document === 'undefined') return undefined;

  const canvas = document.createElement('canvas');
  try {
    const raw = imgObj as PdfJsRawImage;
    const drawable =
      (typeof ImageBitmap !== 'undefined' && imgObj instanceof ImageBitmap) ||
      (typeof HTMLCanvasElement !== 'undefined' && imgObj instanceof HTMLCanvasElement) ||
      (typeof HTMLImageElement !== 'undefined' && imgObj instanceof HTMLImageElement)
        ? (imgObj as CanvasImageSource)
        : raw.bitmap || null;

    if (drawable) {
      const w =
        (drawable as { width?: number; naturalWidth?: number }).naturalWidth ||
        (drawable as { width?: number }).width ||
        raw.width ||
        0;
      const h =
        (drawable as { height?: number; naturalHeight?: number }).naturalHeight ||
        (drawable as { height?: number }).height ||
        raw.height ||
        0;
      if (w <= 0 || h <= 0) return undefined;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(drawable, 0, 0);
      return canvas.toDataURL('image/png');
    }

    if (raw.data && raw.width && raw.height && raw.width > 0 && raw.height > 0) {
      const w = raw.width;
      const h = raw.height;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      const pixelCount = w * h;
      let rgba: Uint8ClampedArray;

      if (raw.data.length === pixelCount * 4) {
        rgba = new Uint8ClampedArray(raw.data);
      } else if (raw.data.length === pixelCount * 3) {
        rgba = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0, j = 0; i < pixelCount; i++, j += 3) {
          rgba[i * 4] = raw.data[j];
          rgba[i * 4 + 1] = raw.data[j + 1];
          rgba[i * 4 + 2] = raw.data[j + 2];
          rgba[i * 4 + 3] = 255;
        }
      } else if (raw.data.length === pixelCount) {
        // Grayscale 8bpp
        rgba = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
          const g = raw.data[i];
          rgba[i * 4] = g;
          rgba[i * 4 + 1] = g;
          rgba[i * 4 + 2] = g;
          rgba[i * 4 + 3] = 255;
        }
      } else if (raw.kind === 1) {
        // 1bpp mask/monochrome
        rgba = new Uint8ClampedArray(pixelCount * 4);
        const rowBytes = Math.ceil(w / 8);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const byte = raw.data[y * rowBytes + (x >> 3)] || 0;
            const bit = (byte >> (7 - (x & 7))) & 1;
            const val = bit ? 255 : 0;
            const outIdx = (y * w + x) * 4;
            rgba[outIdx] = val;
            rgba[outIdx + 1] = val;
            rgba[outIdx + 2] = val;
            rgba[outIdx + 3] = 255;
          }
        }
      } else {
        return undefined;
      }

      const imgData = ctx.createImageData(w, h);
      imgData.data.set(rgba);
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Extracts existing text blocks from a PDF page using PDF.js getTextContent().
 * Returns each text item as a PdfNativeObject with unscaled viewport coordinates
 * honoring CropBox and page rotation.
 */
export async function extractNativeTextObjects(
  pdfPage: pdfjsLib.PDFPageProxy,
  pageId: string,
  rotation?: number
): Promise<PdfNativeObject[]> {
  try {
    const viewport = pdfPage.getViewport({
      scale: 1,
      ...(rotation !== undefined ? { rotation } : {}),
    });

    const textContent = await pdfPage.getTextContent();
    const objects: PdfNativeObject[] = [];

    let idx = 0;
    for (const item of textContent.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      fontName?: string;
    }>) {
      if (!item.str || item.str.trim() === '' || !item.transform) continue;

      const rawTransform = item.transform;
      const vTx = pdfjsLib.Util.transform(viewport.transform, rawTransform);
      const fontHeight =
        Math.hypot(vTx[2], vTx[3]) ||
        Math.hypot(rawTransform[2], rawTransform[3]) ||
        12;
      const itemWidth = item.width || fontHeight * item.str.length * 0.6;

      const x = vTx[4];
      const y = vTx[5] - fontHeight;
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
        originalText: item.str,
        fontSize: fontHeight,
        fontName: item.fontName || 'Helvetica',
        color: '#000000',
        transform: rawTransform,
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
 * Extracts image references from a PDF page using getOperatorList().
 * Tracks the CTM through save/restore/transform/paintFormXObjectBegin/End,
 * handles rotated/flipped CTMs via 4-corner viewport projection,
 * and extracts PNG dataUrls so moved native images redraw accurately on export.
 */
export async function extractNativeImageObjects(
  pdfPage: pdfjsLib.PDFPageProxy,
  pageId: string,
  rotation?: number
): Promise<PdfNativeObject[]> {
  try {
    const viewport = pdfPage.getViewport({
      scale: 1,
      ...(rotation !== undefined ? { rotation } : {}),
    });

    const OPS = pdfjsLib.OPS as Record<string, number>;
    const opList = await pdfPage.getOperatorList();

    const objects: PdfNativeObject[] = [];
    const ctmStack: number[][] = [[1, 0, 0, 1, 0, 0]];
    let idx = 0;

    const currentCTM = () => ctmStack[ctmStack.length - 1];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] as unknown[];

      if (fn === OPS.save) {
        ctmStack.push([...currentCTM()]);
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 1) ctmStack.pop();
      } else if (fn === OPS.transform) {
        const [a, b, c, d, e, f] = args as number[];
        ctmStack[ctmStack.length - 1] = multiplyMatrix(currentCTM(), [a, b, c, d, e, f]);
      } else if (fn === OPS.paintFormXObjectBegin) {
        ctmStack.push([...currentCTM()]);
        const formMatrix = args?.[0];
        if (Array.isArray(formMatrix) && formMatrix.length === 6) {
          ctmStack[ctmStack.length - 1] = multiplyMatrix(currentCTM(), formMatrix as number[]);
        }
      } else if (fn === OPS.paintFormXObjectEnd) {
        if (ctmStack.length > 1) ctmStack.pop();
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintJpegXObject ||
        fn === OPS.paintImageXObjectRepeat ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintXObject
      ) {
        const ctm = currentCTM();
        const vCtm = pdfjsLib.Util.transform(viewport.transform, ctm);

        // Project unit square [0,0]->[1,1] corners through viewport-combined CTM
        const x00 = vCtm[4];
        const y00 = vCtm[5];
        const x10 = vCtm[0] + vCtm[4];
        const y10 = vCtm[1] + vCtm[5];
        const x01 = vCtm[2] + vCtm[4];
        const y01 = vCtm[3] + vCtm[5];
        const x11 = vCtm[0] + vCtm[2] + vCtm[4];
        const y11 = vCtm[1] + vCtm[3] + vCtm[5];

        const minX = Math.min(x00, x10, x01, x11);
        const maxX = Math.max(x00, x10, x01, x11);
        const minY = Math.min(y00, y10, y01, y11);
        const maxY = Math.max(y00, y10, y01, y11);

        const imgW = maxX - minX;
        const imgH = maxY - minY;

        if (imgW > 5 && imgH > 5) {
          let dataUrl: string | undefined;
          if (fn === OPS.paintInlineImageXObject) {
            dataUrl = imageObjectToDataUrl(args?.[0]);
          } else if (typeof args?.[0] === 'string') {
            const imgObj = await resolvePdfJsImage(pdfPage, args[0]);
            dataUrl = imageObjectToDataUrl(imgObj);
          }

          const obj: PdfNativeObject = {
            id: `native_img_${pageId}_${idx++}`,
            pageId,
            type: 'native-image',
            x: minX,
            y: minY,
            width: imgW,
            height: imgH,
            originalX: minX,
            originalY: minY,
            originalWidth: imgW,
            originalHeight: imgH,
            transform: [...ctm],
            dataUrl,
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
  pageId: string,
  rotation?: number
): Promise<PdfNativeObject[]> {
  const [textObjs, imageObjs] = await Promise.all([
    extractNativeTextObjects(pdfPage, pageId, rotation),
    extractNativeImageObjects(pdfPage, pageId, rotation),
  ]);
  return [...textObjs, ...imageObjs];
}
