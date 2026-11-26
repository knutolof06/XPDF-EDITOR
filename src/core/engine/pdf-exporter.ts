import {
  PDFDocument,
  PDFPage,
  PDFImage,
  PDFFont,
  StandardFonts,
  degrees,
  rgb,
  LineCapStyle,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfDocumentModel } from '@/types/document';
import {
  AnyAnnotation,
  DrawingAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  ImageAnnotation,
  WhiteoutAnnotation,
} from '@/types/annotations';
import { binaryStore } from '../storage/binary-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useFormStore } from '@/store/form-store';
import { PdfOutlineWriter } from '../pdf/pdf-outline';
import {
  loadPdfLibSafe,
  loadUnicodeFontPair,
  sanitizeTextForFont,
  hexToPdfRgb,
  uint8ToArrayBuffer,
} from '../pdf/pdf-helpers';
import {
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFButton,
  PDFSignature,
} from 'pdf-lib';

interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeAngle(angle: number | undefined): number {
  return (((angle || 0) % 360) + 360) % 360;
}

/**
 * Converts a point in viewer coordinates (top-left origin, unscaled points, after page rotation & CropBox)
 * into unrotated PDF user-space coordinates.
 */
function viewerToPdfPoint(
  vx: number,
  vy: number,
  box: PdfBox,
  pageRot: number
): { x: number; y: number } {
  const rot = normalizeAngle(pageRot);
  if (rot === 90) {
    return { x: box.x + vy, y: box.y + vx };
  }
  if (rot === 180) {
    return { x: box.x + box.width - vx, y: box.y + vy };
  }
  if (rot === 270) {
    return { x: box.x + box.width - vy, y: box.y + box.height - vx };
  }
  return { x: box.x + vx, y: box.y + box.height - vy };
}

function getVisualDimensions(box: PdfBox, pageRot: number): { visW: number; visH: number } {
  const rot = normalizeAngle(pageRot);
  if (rot === 90 || rot === 270) {
    return { visW: box.height, visH: box.width };
  }
  return { visW: box.width, visH: box.height };
}

/**
 * Computes the PDF origin (x, y) and rotation angle for placing a box whose visual
 * top-left is (vx, vy), size is (w, h), and optional CSS clockwise rotation is annRot.
 */
function getBoxOriginForPdf(
  vx: number,
  vy: number,
  w: number,
  h: number,
  box: PdfBox,
  pageRot: number,
  annRot: number = 0
): { x: number; y: number; pdfRotate: number } {
  const pdfRotate = pageRot - annRot;
  if (!annRot) {
    const pt = viewerToPdfPoint(vx, vy + h, box, pageRot);
    return { x: pt.x, y: pt.y, pdfRotate };
  }
  // Rotate local bottom-left offset (-w/2, +h/2) CW by annRot around center (vx + w/2, vy + h/2)
  const rad = (annRot * Math.PI) / 180;
  const cx = vx + w / 2;
  const cy = vy + h / 2;
  const dx = -w / 2;
  const dy = h / 2;
  const rx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  const pt = viewerToPdfPoint(rx, ry, box, pageRot);
  return { x: pt.x, y: pt.y, pdfRotate };
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function convertDataUrlToPngBytes(dataUrl: string): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('WebP/GIF görsel dönüştürme tarayıcı ortamı gerektirir.');
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
        canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const pngUrl = canvas.toDataURL('image/png');
        resolve(dataUrlToUint8Array(pngUrl));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
    img.onerror = () => reject(new Error('Görsel çözümlenemedi.'));
    img.src = dataUrl;
  });
}

async function embedImageFromDataUrl(outDoc: PDFDocument, dataUrl: string): Promise<PDFImage> {
  const lower = dataUrl.toLowerCase();
  if (lower.startsWith('data:image/png')) {
    return await outDoc.embedPng(dataUrlToUint8Array(dataUrl));
  }
  if (lower.startsWith('data:image/jpeg') || lower.startsWith('data:image/jpg')) {
    return await outDoc.embedJpg(dataUrlToUint8Array(dataUrl));
  }
  // Convert WebP / GIF / BMP / SVG to PNG via canvas
  const pngBytes = await convertDataUrlToPngBytes(dataUrl);
  return await outDoc.embedPng(pngBytes);
}

function wrapTextLines(
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number
): string[] {
  const paragraphs = (text || '').split(/\r?\n/);
  if (!maxWidth || maxWidth <= fontSize) {
    return paragraphs;
  }

  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/(\s+)/);
    let currentLine = '';

    for (const token of words) {
      const testLine = currentLine + token;
      let width = 0;
      try {
        width = font.widthOfTextAtSize(testLine, fontSize);
      } catch {
        width = testLine.length * fontSize * 0.55;
      }
      if (width > maxWidth && currentLine.trim().length > 0) {
        lines.push(currentLine.trimEnd());
        currentLine = token.trimStart();
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
    }
  }
  return lines.length > 0 ? lines : [''];
}

function containsNonWinAnsi(text: string): boolean {
  // Check characters outside Windows-1252 / Latin-1 basic range used by pdf-lib standard fonts
  return /[ğĞşŞıİ₺€→←•–—“”‘’…\u0100-\uFFFF]/.test(text);
}

function resolvePlaceholders(
  template: string,
  pageNumber: number,
  totalPages: number,
  docModel: PdfDocumentModel
): string {
  const dateStr = new Date().toLocaleDateString('tr-TR');
  const titleStr = docModel.metadata?.title || docModel.name || '';
  return template
    .replace(/\{page\}|\{n\}/gi, String(pageNumber))
    .replace(/\{pages\}|\{total\}/gi, String(totalPages))
    .replace(/\{date\}/gi, dateStr)
    .replace(/\{title\}/gi, titleStr);
}

export class PdfExporter {
  /**
   * Exports the entire PdfDocumentModel with structural changes, crops, rotations,
   * annotations, native object edits, AcroForm values, metadata, outlines, page numbers, and headers/footers.
   */
  public static async exportDocumentWithAnnotations(
    docModel: PdfDocumentModel
  ): Promise<ArrayBuffer> {
    let rawBuffer = binaryStore.get(docModel.id);
    if (!rawBuffer && docModel.filePath && typeof window !== 'undefined' && window.electronAPI?.readFile) {
      try {
        const res = await window.electronAPI.readFile(docModel.filePath);
        if (res && res.buffer) {
          const offset = typeof res.byteOffset === 'number' ? res.byteOffset : 0;
          const length =
            typeof res.byteLength === 'number' ? res.byteLength : res.buffer.byteLength;
          rawBuffer = res.buffer.slice(offset, offset + length);
        }
      } catch {
        // ignore read error
      }
    }
    if (!rawBuffer) throw new Error('Döküman binary verisi bulunamadı.');

    const srcDoc = await loadPdfLibSafe(rawBuffer, 'Dışa aktarma');
    srcDoc.registerFontkit(fontkit);

    const { regular, bold } = await loadUnicodeFontPair();
    const isCustomFont = Boolean(regular && bold);

    const fontRegular: PDFFont = regular
      ? await srcDoc.embedFont(regular, { subset: true })
      : await srcDoc.embedFont(StandardFonts.Helvetica);
    const fontBold: PDFFont = bold
      ? await srcDoc.embedFont(bold, { subset: true })
      : await srcDoc.embedFont(StandardFonts.HelveticaBold);

    const stdFontCache = new Map<string, PDFFont>();
    const getStandardOrUnicodeFont = async (
      fontFamily: string,
      isBold: boolean,
      isItalic: boolean,
      text: string
    ): Promise<{ font: PDFFont; isCustom: boolean }> => {
      const fam = (fontFamily || '').toLowerCase();
      const needsUnicode = isCustomFont && containsNonWinAnsi(text);

      if (!needsUnicode && (fam.includes('times') || fam.includes('serif'))) {
        const key = isBold && isItalic
          ? StandardFonts.TimesRomanBoldItalic
          : isBold
            ? StandardFonts.TimesRomanBold
            : isItalic
              ? StandardFonts.TimesRomanItalic
              : StandardFonts.TimesRoman;
        if (!stdFontCache.has(key)) stdFontCache.set(key, await srcDoc.embedFont(key));
        return { font: stdFontCache.get(key)!, isCustom: false };
      }

      if (!needsUnicode && (fam.includes('courier') || fam.includes('mono'))) {
        const key = isBold && isItalic
          ? StandardFonts.CourierBoldOblique
          : isBold
            ? StandardFonts.CourierBold
            : isItalic
              ? StandardFonts.CourierOblique
              : StandardFonts.Courier;
        if (!stdFontCache.has(key)) stdFontCache.set(key, await srcDoc.embedFont(key));
        return { font: stdFontCache.get(key)!, isCustom: false };
      }

      if (!isCustomFont && isItalic) {
        const key = isBold ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaOblique;
        if (!stdFontCache.has(key)) stdFontCache.set(key, await srcDoc.embedFont(key));
        return { font: stdFontCache.get(key)!, isCustom: false };
      }

      return { font: isBold ? fontBold : fontRegular, isCustom: isCustomFont };
    };

    // 1. Apply in-memory AcroForm values BEFORE structural rearrangement so AcroForm stays attached
    const formValues = useFormStore.getState().valuesByDoc[docModel.id];
    if (formValues && Object.keys(formValues).length > 0) {
      try {
        const form = srcDoc.getForm();
        Object.entries(formValues).forEach(([fieldName, val]) => {
          try {
            const field = form.getField(fieldName);
            if (field instanceof PDFButton || field instanceof PDFSignature) return;
            if (field instanceof PDFTextField && typeof val === 'string') {
              field.setText(val);
            } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
              if (val) field.check();
              else field.uncheck();
            } else if (field instanceof PDFDropdown && typeof val === 'string') {
              if (field.isMultiselect() && val.includes(',')) {
                field.select(val.split(',').map((s) => s.trim()).filter(Boolean));
              } else if (val !== '') {
                field.select(val);
              }
            } else if (field instanceof PDFOptionList && typeof val === 'string' && val !== '') {
              const parts = field.isMultiselect()
                ? val.split(',').map((s) => s.trim()).filter(Boolean)
                : [val];
              if (parts.length > 0) field.select(parts);
            } else if (field instanceof PDFRadioGroup && typeof val === 'string' && val !== '') {
              field.select(val);
            }
          } catch {
            // ignore missing or mismatched individual fields
          }
        });
        try {
          form.updateFieldAppearances(fontRegular);
        } catch {
          // ignore per-field appearance failures
        }
      } catch {
        // document has no AcroForm
      }
    }

    // 2. Reorder/delete/duplicate pages directly inside srcDoc so AcroForm & Outlines survive!
    const isStructureUnchanged =
      docModel.pages.length === srcDoc.getPageCount() &&
      docModel.pages.every((p, idx) => p.sourcePageIndex === idx);

    if (!isStructureUnchanged && docModel.pages.length > 0) {
      const origPages = srcDoc.getPages();
      const usedIndices = new Set<number>();
      const orderedPages: PDFPage[] = [];

      for (const pageModel of docModel.pages) {
        const sIdx = pageModel.sourcePageIndex;
        if (sIdx < 0 || sIdx >= origPages.length) continue;
        if (!usedIndices.has(sIdx)) {
          usedIndices.add(sIdx);
          orderedPages.push(origPages[sIdx]);
        } else {
          const [cloned] = await srcDoc.copyPages(srcDoc, [sIdx]);
          orderedPages.push(cloned);
        }
      }

      if (orderedPages.length > 0) {
        while (srcDoc.getPageCount() > 0) {
          srcDoc.removePage(0);
        }
        for (const p of orderedPages) {
          srcDoc.addPage(p);
        }
      }
    }

    // 3. Apply document metadata
    const meta = docModel.metadata;
    if (meta) {
      if (meta.title !== undefined) srcDoc.setTitle(meta.title);
      if (meta.author !== undefined) srcDoc.setAuthor(meta.author);
      if (meta.subject !== undefined) srcDoc.setSubject(meta.subject);
      if (meta.keywords !== undefined) {
        const kwList = meta.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);
        srcDoc.setKeywords(kwList);
      }
      if (meta.creator !== undefined) srcDoc.setCreator(meta.creator);
      srcDoc.setModificationDate(new Date());
    }

    // 4. Write modified outline if present
    const modifiedOutline = PdfOutlineWriter.getModifiedOutline(docModel.id);
    if (modifiedOutline) {
      PdfOutlineWriter.writeOutline(srcDoc, modifiedOutline);
    }

    const annState = useAnnotationStore.getState();
    const pageNumberConfig =
      annState.pageNumberConfigByDoc[docModel.id] || annState.pageNumberConfig;
    const headerFooterConfig =
      annState.headerFooterConfigByDoc[docModel.id] || annState.headerFooterConfig;

    for (let i = 0; i < docModel.pages.length; i++) {
      const pageModel = docModel.pages[i];
      if (i >= srcDoc.getPageCount()) break;

      const targetPage = srcDoc.getPage(i);
      const finalRot = normalizeAngle(pageModel.rotation);
      // Set absolute rotation directly (fixing double-rotation bug)
      targetPage.setRotation(degrees(finalRot));

      // Capture active CropBox/MediaBox BEFORE applying any newly set pageModel.crop
      const activeBox: PdfBox = targetPage.getCropBox() || targetPage.getMediaBox();

      // Render all annotations onto targetPage in rotation + CropBox aware coordinates
      for (const ann of pageModel.annotations) {
        await drawAnnotationOnPage(
          srcDoc,
          targetPage,
          ann,
          activeBox,
          finalRot,
          i,
          getStandardOrUnicodeFont,
          fontRegular,
          isCustomFont
        );
      }

      // Native PDF Objects (Moved, Edited, or Deleted)
      const nativeObjects = useNativeObjectStore.getState().getObjectsForPage(pageModel.id);
      for (const nObj of nativeObjects) {
        if (!nObj.moved && !nObj.deleted && !nObj.isEdited) continue;

        if (nObj.type === 'native-text') {
          const fontSize = nObj.fontSize || 12;
          const maskPos = getBoxOriginForPdf(
            nObj.originalX - 1,
            nObj.originalY - 1,
            nObj.originalWidth + 4,
            nObj.originalHeight + 4,
            activeBox,
            finalRot
          );

          targetPage.drawRectangle({
            x: maskPos.x,
            y: maskPos.y,
            width: nObj.originalWidth + 4,
            height: nObj.originalHeight + 4,
            color: rgb(1, 1, 1),
            opacity: 1,
            rotate: degrees(maskPos.pdfRotate),
          });

          if (!nObj.deleted && nObj.text) {
            try {
              const baseline = viewerToPdfPoint(
                nObj.x,
                nObj.y + fontSize,
                activeBox,
                finalRot
              );
              targetPage.drawText(sanitizeTextForFont(nObj.text, fontRegular, isCustomFont), {
                x: baseline.x,
                y: baseline.y,
                size: fontSize,
                font: fontRegular,
                color: nObj.color ? hexToPdfRgb(nObj.color) : rgb(0, 0, 0),
                opacity: 1,
                rotate: degrees(finalRot),
              });
            } catch (textErr) {
              console.warn('Native text redraw error:', textErr);
            }
          }
        } else if (nObj.type === 'native-image') {
          const maskPos = getBoxOriginForPdf(
            nObj.originalX - 1,
            nObj.originalY - 1,
            nObj.originalWidth + 2,
            nObj.originalHeight + 2,
            activeBox,
            finalRot
          );

          targetPage.drawRectangle({
            x: maskPos.x,
            y: maskPos.y,
            width: nObj.originalWidth + 2,
            height: nObj.originalHeight + 2,
            color: rgb(1, 1, 1),
            opacity: 1,
            rotate: degrees(maskPos.pdfRotate),
          });

          if (nObj.dataUrl && !nObj.deleted) {
            try {
              const embedded = await embedImageFromDataUrl(srcDoc, nObj.dataUrl);
              const imgOrigin = getBoxOriginForPdf(
                nObj.x,
                nObj.y,
                nObj.width,
                nObj.height,
                activeBox,
                finalRot
              );
              targetPage.drawImage(embedded, {
                x: imgOrigin.x,
                y: imgOrigin.y,
                width: nObj.width,
                height: nObj.height,
                opacity: 1,
                rotate: degrees(imgOrigin.pdfRotate),
              });
            } catch (imgErr) {
              console.warn('Native image redraw error:', imgErr);
            }
          }
        }
      }

      // Apply user CropBox if defined on pageModel, and place Page Numbers / Headers / Footers inside visible bounds
      let outputBox: PdfBox = activeBox;
      if (pageModel.crop && pageModel.crop.width > 0 && pageModel.crop.height > 0) {
        const c1 = viewerToPdfPoint(pageModel.crop.x, pageModel.crop.y, activeBox, finalRot);
        const c2 = viewerToPdfPoint(
          pageModel.crop.x + pageModel.crop.width,
          pageModel.crop.y + pageModel.crop.height,
          activeBox,
          finalRot
        );
        const cropMinX = Math.min(c1.x, c2.x);
        const cropMinY = Math.min(c1.y, c2.y);
        const cropW = Math.abs(c2.x - c1.x);
        const cropH = Math.abs(c2.y - c1.y);
        if (cropW > 1 && cropH > 1) {
          targetPage.setCropBox(cropMinX, cropMinY, cropW, cropH);
          outputBox = { x: cropMinX, y: cropMinY, width: cropW, height: cropH };
        }
      }

      const { visW, visH } = getVisualDimensions(outputBox, finalRot);

      // Page numbers
      if (pageNumberConfig.enabled) {
        const startFrom = Number.isFinite(pageNumberConfig.startFrom)
          ? pageNumberConfig.startFrom
          : 1;
        const logicalNum = startFrom + i;
        const prefix = pageNumberConfig.prefix || '';
        let rawNumText: string;

        if (pageNumberConfig.format === 'page-x-of-y') {
          rawNumText = `${prefix}Sayfa ${logicalNum} / ${docModel.pages.length}`;
        } else if (pageNumberConfig.format === 'custom') {
          const template = prefix || '{page} / {total}';
          rawNumText = template
            .replace(/\{page\}|\{n\}/gi, String(logicalNum))
            .replace(/\{total\}|\{pages\}/gi, String(docModel.pages.length));
        } else {
          rawNumText = `${prefix}${logicalNum}`;
        }

        const safeNumText = sanitizeTextForFont(rawNumText, fontRegular, isCustomFont);
        const fSize = pageNumberConfig.fontSize || 10;
        let textW = safeNumText.length * fSize * 0.5;
        try {
          textW = fontRegular.widthOfTextAtSize(safeNumText, fSize);
        } catch {
          // fallback width
        }

        let vx = (visW - textW) / 2;
        let vy = visH - 22;

        if (pageNumberConfig.position === 'bottom-left') {
          vx = 30;
          vy = visH - 22;
        } else if (pageNumberConfig.position === 'bottom-right') {
          vx = Math.max(30, visW - textW - 30);
          vy = visH - 22;
        } else if (pageNumberConfig.position === 'top-left') {
          vx = 30;
          vy = 24;
        } else if (pageNumberConfig.position === 'top-center') {
          vx = (visW - textW) / 2;
          vy = 24;
        } else if (pageNumberConfig.position === 'top-right') {
          vx = Math.max(30, visW - textW - 30);
          vy = 24;
        }

        const pt = viewerToPdfPoint(vx, vy, outputBox, finalRot);
        targetPage.drawText(safeNumText, {
          x: pt.x,
          y: pt.y,
          size: fSize,
          font: fontRegular,
          color: hexToPdfRgb(pageNumberConfig.color, rgb(0.3, 0.35, 0.45)),
          rotate: degrees(finalRot),
        });
      }

      // Header / Footer
      const hasAnyHeaderFooterText = Boolean(
        headerFooterConfig.headerText ||
          headerFooterConfig.footerText ||
          headerFooterConfig.headerLeft ||
          headerFooterConfig.headerCenter ||
          headerFooterConfig.headerRight ||
          headerFooterConfig.footerLeft ||
          headerFooterConfig.footerCenter ||
          headerFooterConfig.footerRight
      );
      const isHeaderFooterActive =
        headerFooterConfig.enabled === true ||
        (headerFooterConfig.enabled === undefined && hasAnyHeaderFooterText);

      const pageNum1Based = i + 1;
      const inStartRange =
        headerFooterConfig.startPage === undefined || pageNum1Based >= headerFooterConfig.startPage;
      const inEndRange =
        headerFooterConfig.endPage === undefined || pageNum1Based <= headerFooterConfig.endPage;

      if (isHeaderFooterActive && inStartRange && inEndRange) {
        const hfSize = headerFooterConfig.fontSize || 9;
        const hfColor = hexToPdfRgb(headerFooterConfig.color, rgb(0.4, 0.45, 0.55));
        const marginX = headerFooterConfig.marginX ?? 30;
        const marginY = headerFooterConfig.marginY ?? 22;

        const drawSlot = (rawTemplate: string | undefined, align: 'left' | 'center' | 'right', isTop: boolean) => {
          if (!rawTemplate) return;
          const resolved = resolvePlaceholders(
            rawTemplate,
            pageNum1Based,
            docModel.pages.length,
            docModel
          );
          const safe = sanitizeTextForFont(resolved, fontRegular, isCustomFont);
          if (!safe) return;

          let tw = safe.length * hfSize * 0.5;
          try {
            tw = fontRegular.widthOfTextAtSize(safe, hfSize);
          } catch {
            // fallback
          }

          let vx = marginX;
          if (align === 'center') vx = Math.max(marginX, (visW - tw) / 2);
          else if (align === 'right') vx = Math.max(marginX, visW - marginX - tw);

          const vy = isTop ? marginY + hfSize : visH - marginY;
          const pt = viewerToPdfPoint(vx, vy, outputBox, finalRot);
          targetPage.drawText(safe, {
            x: pt.x,
            y: pt.y,
            size: hfSize,
            font: fontRegular,
            color: hfColor,
            rotate: degrees(finalRot),
          });
        };

        drawSlot(headerFooterConfig.headerLeft || headerFooterConfig.headerText, 'left', true);
        drawSlot(headerFooterConfig.headerCenter, 'center', true);
        drawSlot(headerFooterConfig.headerRight, 'right', true);
        drawSlot(headerFooterConfig.footerLeft || headerFooterConfig.footerText, 'left', false);
        drawSlot(headerFooterConfig.footerCenter, 'center', false);
        drawSlot(headerFooterConfig.footerRight, 'right', false);
      }
    }

    const pdfBytes = await srcDoc.save({ updateFieldAppearances: false });
    return uint8ToArrayBuffer(pdfBytes);
  }
}

async function drawAnnotationOnPage(
  outDoc: PDFDocument,
  page: PDFPage,
  ann: AnyAnnotation,
  box: PdfBox,
  pageRot: number,
  pageIdx: number,
  getFont: (
    fontFamily: string,
    isBold: boolean,
    isItalic: boolean,
    text: string
  ) => Promise<{ font: PDFFont; isCustom: boolean }>,
  fallbackFont: PDFFont,
  isCustomFont: boolean
): Promise<void> {
  const annRot = ann.rotation || 0;
  const opacity = ann.opacity ?? 1;

  if (ann.type === 'text') {
    const textAnn = ann as TextAnnotation;
    const { font, isCustom } = await getFont(
      textAnn.fontFamily,
      Boolean(textAnn.isBold),
      Boolean(textAnn.isItalic),
      textAnn.text || ''
    );
    const fontSize = textAnn.fontSize || 12;
    const lineHeight = fontSize * 1.25;

    // Background color fill if configured
    if (textAnn.backgroundColor && textAnn.backgroundColor !== 'transparent') {
      const bgOrigin = getBoxOriginForPdf(
        textAnn.x,
        textAnn.y,
        Math.max(10, textAnn.width || 100),
        Math.max(fontSize + 4, textAnn.height || fontSize + 4),
        box,
        pageRot,
        annRot
      );
      page.drawRectangle({
        x: bgOrigin.x,
        y: bgOrigin.y,
        width: Math.max(10, textAnn.width || 100),
        height: Math.max(fontSize + 4, textAnn.height || fontSize + 4),
        color: hexToPdfRgb(textAnn.backgroundColor, rgb(1, 1, 1)),
        opacity,
        rotate: degrees(bgOrigin.pdfRotate),
      });
    }

    const lines = wrapTextLines(
      sanitizeTextForFont(textAnn.text || '', font, isCustom),
      textAnn.width || 0,
      font,
      fontSize
    );
    const textColor = hexToPdfRgb(textAnn.color, rgb(0, 0, 0));
    const boxWidth = textAnn.width || 0;

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const lineStr = sanitizeTextForFont(lines[lIdx], font, isCustom);
      let lineW = 0;
      try {
        lineW = font.widthOfTextAtSize(lineStr, fontSize);
      } catch {
        lineW = lineStr.length * fontSize * 0.5;
      }

      let offsetX = 0;
      if (textAnn.textAlign === 'center' && boxWidth > lineW) {
        offsetX = (boxWidth - lineW) / 2;
      } else if (textAnn.textAlign === 'right' && boxWidth > lineW) {
        offsetX = boxWidth - lineW;
      }

      const lineBaselineY = textAnn.y + fontSize + lIdx * lineHeight;
      const pt = getBoxOriginForPdf(
        textAnn.x + offsetX,
        lineBaselineY,
        lineW,
        0,
        box,
        pageRot,
        annRot
      );

      page.drawText(lineStr, {
        x: pt.x,
        y: pt.y,
        size: fontSize,
        font,
        color: textColor,
        opacity,
        rotate: degrees(pt.pdfRotate),
      });

      if (textAnn.isUnderline && lineW > 0) {
        const ulStart = viewerToPdfPoint(
          textAnn.x + offsetX,
          lineBaselineY + 2,
          box,
          pageRot
        );
        const ulEnd = viewerToPdfPoint(
          textAnn.x + offsetX + lineW,
          lineBaselineY + 2,
          box,
          pageRot
        );
        page.drawLine({
          start: ulStart,
          end: ulEnd,
          thickness: Math.max(0.75, fontSize * 0.08),
          color: textColor,
          opacity,
        });
      }
    }
  } else if (ann.type === 'whiteout') {
    const wh = ann as WhiteoutAnnotation;
    const origin = getBoxOriginForPdf(wh.x, wh.y, wh.width, wh.height, box, pageRot, annRot);
    page.drawRectangle({
      x: origin.x,
      y: origin.y,
      width: wh.width,
      height: wh.height,
      color: hexToPdfRgb(wh.color || '#ffffff', rgb(1, 1, 1)),
      borderColor: wh.borderColor && wh.borderColor !== 'transparent' ? hexToPdfRgb(wh.borderColor) : undefined,
      borderWidth: wh.borderWidth || 0,
      opacity,
      rotate: degrees(origin.pdfRotate),
    });
  } else if (ann.type === 'rect') {
    const sh = ann as ShapeAnnotation;
    const origin = getBoxOriginForPdf(sh.x, sh.y, sh.width, sh.height, box, pageRot, annRot);
    page.drawRectangle({
      x: origin.x,
      y: origin.y,
      width: sh.width,
      height: sh.height,
      borderColor:
        sh.strokeColor && sh.strokeColor !== 'transparent'
          ? hexToPdfRgb(sh.strokeColor)
          : undefined,
      borderWidth: sh.strokeWidth || 0,
      color:
        sh.fillColor && sh.fillColor !== 'transparent'
          ? hexToPdfRgb(sh.fillColor)
          : undefined,
      opacity,
      rotate: degrees(origin.pdfRotate),
    });
  } else if (ann.type === 'circle') {
    const sh = ann as ShapeAnnotation;
    const xScale = Math.max(0.5, Math.abs(sh.width) / 2);
    const yScale = Math.max(0.5, Math.abs(sh.height) / 2);
    const center = viewerToPdfPoint(
      sh.x + sh.width / 2,
      sh.y + sh.height / 2,
      box,
      pageRot
    );
    const swappedAxes = pageRot === 90 || pageRot === 270;
    page.drawEllipse({
      x: center.x,
      y: center.y,
      xScale: swappedAxes ? yScale : xScale,
      yScale: swappedAxes ? xScale : yScale,
      borderColor:
        sh.strokeColor && sh.strokeColor !== 'transparent'
          ? hexToPdfRgb(sh.strokeColor)
          : undefined,
      borderWidth: sh.strokeWidth || 1,
      color:
        sh.fillColor && sh.fillColor !== 'transparent'
          ? hexToPdfRgb(sh.fillColor)
          : undefined,
      opacity,
    });
  } else if (ann.type === 'line' || ann.type === 'arrow') {
    const sh = ann as ShapeAnnotation;
    const strokeColor = hexToPdfRgb(sh.strokeColor, rgb(0, 0, 0));
    const thickness = sh.strokeWidth || 2;
    const endVx = sh.x + sh.width;
    const endVy = sh.y + sh.height;

    const startPt = viewerToPdfPoint(sh.x, sh.y, box, pageRot);
    const endPt = viewerToPdfPoint(endVx, endVy, box, pageRot);

    page.drawLine({
      start: startPt,
      end: endPt,
      thickness,
      color: strokeColor,
      opacity,
      lineCap: LineCapStyle.Round,
    });

    if (ann.type === 'arrow') {
      const dx = endVx - sh.x;
      const dy = endVy - sh.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        const angle = Math.atan2(dy, dx);
        const headLen = Math.max(8, thickness * 3.5);
        const spread = Math.PI / 6; // 30 degrees

        const wing1Vx = endVx - headLen * Math.cos(angle - spread);
        const wing1Vy = endVy - headLen * Math.sin(angle - spread);
        const wing2Vx = endVx - headLen * Math.cos(angle + spread);
        const wing2Vy = endVy - headLen * Math.sin(angle + spread);

        page.drawLine({
          start: endPt,
          end: viewerToPdfPoint(wing1Vx, wing1Vy, box, pageRot),
          thickness,
          color: strokeColor,
          opacity,
          lineCap: LineCapStyle.Round,
        });
        page.drawLine({
          start: endPt,
          end: viewerToPdfPoint(wing2Vx, wing2Vy, box, pageRot),
          thickness,
          color: strokeColor,
          opacity,
          lineCap: LineCapStyle.Round,
        });
      }
    }
  } else if ((ann.type as string) === 'underline' || (ann.type as string) === 'strikethrough') {
    const raw = ann as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
      strokeColor?: string;
      color?: string;
      strokeWidth?: number;
    };
    const isStrike = (ann.type as string) === 'strikethrough';
    const lineY = isStrike ? raw.y + raw.height / 2 : raw.y + raw.height;
    const color = hexToPdfRgb(raw.strokeColor || raw.color || '#ef4444');
    page.drawLine({
      start: viewerToPdfPoint(raw.x, lineY, box, pageRot),
      end: viewerToPdfPoint(raw.x + raw.width, lineY, box, pageRot),
      thickness: raw.strokeWidth || 1.5,
      color,
      opacity,
    });
  } else if ((ann.type as string) === 'page-number') {
    const raw = ann as unknown as {
      x: number;
      y: number;
      text?: string;
      fontSize?: number;
      color?: string;
    };
    const size = raw.fontSize || 10;
    const txt = sanitizeTextForFont(raw.text || String(pageIdx + 1), fallbackFont, isCustomFont);
    const pt = viewerToPdfPoint(raw.x, raw.y + size, box, pageRot);
    page.drawText(txt, {
      x: pt.x,
      y: pt.y,
      size,
      font: fallbackFont,
      color: hexToPdfRgb(raw.color, rgb(0.3, 0.35, 0.45)),
      opacity,
      rotate: degrees(pageRot),
    });
  } else if (ann.type === 'draw' || ann.type === 'highlight') {
    const dr = ann as DrawingAnnotation;
    const strokeColor = hexToPdfRgb(dr.color);
    const thickness = dr.strokeWidth || 2;
    const effectiveOpacity = dr.type === 'highlight' ? dr.opacity ?? 0.4 : opacity;

    if (dr.points.length === 1) {
      const center = viewerToPdfPoint(dr.points[0].x, dr.points[0].y, box, pageRot);
      page.drawCircle({
        x: center.x,
        y: center.y,
        size: Math.max(1, thickness / 2),
        color: strokeColor,
        opacity: effectiveOpacity,
      });
    } else {
      for (let pIdx = 0; pIdx < dr.points.length - 1; pIdx++) {
        const p1 = dr.points[pIdx];
        const p2 = dr.points[pIdx + 1];
        page.drawLine({
          start: viewerToPdfPoint(p1.x, p1.y, box, pageRot),
          end: viewerToPdfPoint(p2.x, p2.y, box, pageRot),
          thickness,
          color: strokeColor,
          opacity: effectiveOpacity,
          lineCap: LineCapStyle.Round,
        });
      }
    }
  } else if (ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'image') {
    const imgAnn = ann as ImageAnnotation;
    if (imgAnn.dataUrl) {
      try {
        const embedded = await embedImageFromDataUrl(outDoc, imgAnn.dataUrl);
        const origin = getBoxOriginForPdf(
          imgAnn.x,
          imgAnn.y,
          imgAnn.width,
          imgAnn.height,
          box,
          pageRot,
          annRot
        );
        page.drawImage(embedded, {
          x: origin.x,
          y: origin.y,
          width: imgAnn.width,
          height: imgAnn.height,
          opacity,
          rotate: degrees(origin.pdfRotate),
        });
      } catch (err) {
        console.error('Image embed error:', err);
      }
    }
  }
}
