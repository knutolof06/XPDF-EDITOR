import {
  PDFDocument,
  PDFFont,
  StandardFonts,
  TextRenderingMode,
  pushGraphicsState,
  popGraphicsState,
  beginText,
  endText,
  setTextRenderingMode,
  setFontAndSize,
  setCharacterSqueeze,
  rotateAndSkewTextDegreesAndTranslate,
  showText,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { OcrPageResult } from './ocr-service';

export interface SearchablePdfOptions {
  /** Optional raw TTF/OTF bytes (useful in headless environments or custom fonts) */
  fontBytes?: ArrayBuffer | Uint8Array;
}

let cachedFontBytes: ArrayBuffer | null = null;
let fontLoadPromise: Promise<ArrayBuffer | null> | null = null;

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (
    input instanceof ArrayBuffer ||
    Object.prototype.toString.call(input) === '[object ArrayBuffer]'
  ) {
    const src = new Uint8Array(input as ArrayBuffer);
    const copy = new Uint8Array(src.byteLength);
    copy.set(src);
    return copy.buffer;
  }
  if (
    ArrayBuffer.isView(input) ||
    (input &&
      typeof input === 'object' &&
      'buffer' in input &&
      typeof (input as Uint8Array).byteLength === 'number')
  ) {
    const view = input as ArrayBufferView & Uint8Array;
    const src = new Uint8Array(view.buffer, view.byteOffset ?? 0, view.byteLength);
    const copy = new Uint8Array(src.byteLength);
    copy.set(src);
    return copy.buffer;
  }
  throw new Error('Geçersiz PDF ikili verisi.');
}

async function loadCachedUnicodeFontBytes(): Promise<ArrayBuffer | null> {
  if (cachedFontBytes) return cachedFontBytes;
  if (fontLoadPromise) return fontLoadPromise;

  fontLoadPromise = (async () => {
    const candidates: string[] = [];

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      candidates.push(chrome.runtime.getURL('fonts/font-regular.ttf'));
    }

    candidates.push(
      './fonts/font-regular.ttf',
      'fonts/font-regular.ttf',
      '/fonts/font-regular.ttf'
    );

    if (
      typeof window !== 'undefined' &&
      window.location?.origin &&
      window.location.origin !== 'null' &&
      !window.location.origin.startsWith('file://')
    ) {
      candidates.push(`${window.location.origin}/fonts/font-regular.ttf`);
    }

    if (typeof fetch === 'function') {
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 0) {
              cachedFontBytes = buf;
              return cachedFontBytes;
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    // Node / Vitest fallback
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const fsMod = await import(/* @vite-ignore */ 'node:fs/promises');
        const pathMod = await import(/* @vite-ignore */ 'node:path');
        const fsPath = pathMod.resolve(process.cwd(), 'public/fonts/font-regular.ttf');
        const nodeBuf = await fsMod.readFile(fsPath);
        const copy = new Uint8Array(nodeBuf.byteLength);
        copy.set(nodeBuf);
        cachedFontBytes = copy.buffer;
        return cachedFontBytes;
      } catch {
        // Fallback to standard font below
      }
    }

    return null;
  })();

  try {
    return await fontLoadPromise;
  } finally {
    fontLoadPromise = null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mapNormalizedBoxToPdf(
  normBbox: { x: number; y: number; width: number; height: number },
  cropBox: { x: number; y: number; width: number; height: number },
  rotationDeg: number
): {
  x: number;
  y: number;
  boxWidthPt: number;
  boxHeightPt: number;
  angleDeg: number;
} {
  const nx = clamp01(normBbox.x);
  const ny = clamp01(normBbox.y);
  const nw = Math.max(0.001, Math.min(1 - nx, normBbox.width));
  const nh = Math.max(0.001, Math.min(1 - ny, normBbox.height));

  // Typical glyph baseline sits ~15% above the bottom of the word bounding box
  const nyBaseline = Math.min(1, ny + nh * 0.85);
  const { x: cx, y: cy, width: cw, height: ch } = cropBox;
  const rot = ((rotationDeg % 360) + 360) % 360;

  if (rot === 90) {
    return {
      x: cx + nyBaseline * cw,
      y: cy + nx * ch,
      boxWidthPt: nw * ch,
      boxHeightPt: nh * cw,
      angleDeg: 90,
    };
  }
  if (rot === 180) {
    return {
      x: cx + (1 - nx) * cw,
      y: cy + nyBaseline * ch,
      boxWidthPt: nw * cw,
      boxHeightPt: nh * ch,
      angleDeg: 180,
    };
  }
  if (rot === 270) {
    return {
      x: cx + (1 - nyBaseline) * cw,
      y: cy + (1 - nx) * ch,
      boxWidthPt: nw * ch,
      boxHeightPt: nh * cw,
      angleDeg: 270,
    };
  }

  return {
    x: cx + nx * cw,
    y: cy + (1 - nyBaseline) * ch,
    boxWidthPt: nw * cw,
    boxHeightPt: nh * ch,
    angleDeg: 0,
  };
}

function transliterateTurkishFallback(text: string): string {
  return text
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'O')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U');
}

export class SearchablePdfEngine {
  /**
   * Clears cached font bytes (primarily useful in tests).
   */
  public static clearFontCache(): void {
    cachedFontBytes = null;
    fontLoadPromise = null;
  }

  /**
   * Embeds a standards-compliant invisible searchable text layer (PDF `3 Tr` mode)
   * matching exact word coordinates, CropBox offsets, page /Rotate, and horizontal width (Tz).
   */
  public static async createSearchablePdf(
    originalBuffer: ArrayBuffer | Uint8Array,
    ocrPages: OcrPageResult[],
    options: SearchablePdfOptions = {}
  ): Promise<Uint8Array> {
    const rawBuffer = toArrayBuffer(originalBuffer);
    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    pdfDoc.registerFontkit(fontkit);

    let font: PDFFont | null = null;
    let isUnicodeFont = false;

    const fontBuffer = options.fontBytes
      ? toArrayBuffer(options.fontBytes)
      : await loadCachedUnicodeFontBytes();

    if (fontBuffer) {
      try {
        font = await pdfDoc.embedFont(new Uint8Array(fontBuffer), { subset: true });
        isUnicodeFont = true;
      } catch (err) {
        console.warn('Unicode font embedding failed, falling back to Helvetica:', err);
      }
    }

    if (!font) {
      try {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      } catch {
        font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
      }
    }

    for (const ocrPage of ocrPages) {
      const pageIndex = ocrPage.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

      const page = pdfDoc.getPage(pageIndex);
      const cropBox = page.getCropBox();
      const rotationAngle = page.getRotation().angle;

      const itemsToDraw: {
        text: string;
        normBbox: { x: number; y: number; width: number; height: number };
      }[] = [];

      if (ocrPage.words && ocrPage.words.length > 0) {
        for (const w of ocrPage.words) {
          const clean = w.text?.trim();
          if (clean && w.normBbox) {
            itemsToDraw.push({ text: clean, normBbox: w.normBbox });
          }
        }
      } else if (ocrPage.lines && ocrPage.lines.length > 0) {
        const cWidth = ocrPage.width || cropBox.width;
        const cHeight = ocrPage.height || cropBox.height;
        for (const l of ocrPage.lines) {
          const clean = l.text?.trim();
          if (clean && l.bbox && cWidth > 0 && cHeight > 0) {
            itemsToDraw.push({
              text: clean,
              normBbox: {
                x: l.bbox.x0 / cWidth,
                y: l.bbox.y0 / cHeight,
                width: Math.max(0.005, (l.bbox.x1 - l.bbox.x0) / cWidth),
                height: Math.max(0.005, (l.bbox.y1 - l.bbox.y0) / cHeight),
              },
            });
          }
        }
      }

      if (itemsToDraw.length === 0) continue;

      // Register font resource once per page instead of once per word
      const fontKey = page.node.newFontDictionary(font.name, font.ref);

      for (const item of itemsToDraw) {
        const mapped = mapNormalizedBoxToPdf(item.normBbox, cropBox, rotationAngle);
        const fontSize = Math.max(4, Math.min(72, mapped.boxHeightPt * 0.82));

        let textToDraw = isUnicodeFont ? item.text : transliterateTurkishFallback(item.text);

        let encoded;
        let measuredWidth = 0;
        try {
          encoded = font.encodeText(textToDraw);
          measuredWidth = font.widthOfTextAtSize(textToDraw, fontSize);
        } catch {
          try {
            textToDraw = transliterateTurkishFallback(item.text).replace(/[^\x20-\x7E]/g, '?');
            encoded = font.encodeText(textToDraw);
            measuredWidth = font.widthOfTextAtSize(textToDraw, fontSize);
          } catch {
            continue;
          }
        }

        const tzScale =
          measuredWidth > 0 && mapped.boxWidthPt > 0
            ? Math.max(10, Math.min(400, (mapped.boxWidthPt / measuredWidth) * 100))
            : 100;

        page.pushOperators(
          pushGraphicsState(),
          beginText(),
          setTextRenderingMode(TextRenderingMode.Invisible),
          setFontAndSize(fontKey, fontSize),
          setCharacterSqueeze(tzScale),
          rotateAndSkewTextDegreesAndTranslate(mapped.angleDeg, 0, 0, mapped.x, mapped.y),
          showText(encoded),
          endText(),
          popGraphicsState()
        );
      }
    }

    return await pdfDoc.save();
  }
}
