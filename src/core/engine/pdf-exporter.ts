import { PDFDocument, rgb, degrees, StandardFonts, PDFFont, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfDocumentModel } from '@/types/document';
import { DrawingAnnotation, ShapeAnnotation, TextAnnotation, ImageAnnotation, WhiteoutAnnotation } from '@/types/annotations';
import { binaryStore } from '../storage/binary-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { useFormStore } from '@/store/form-store';

let cachedRegularFont: ArrayBuffer | null = null;
let cachedBoldFont: ArrayBuffer | null = null;

async function loadUnicodeFonts(): Promise<{ regular: ArrayBuffer | null; bold: ArrayBuffer | null }> {
  if (cachedRegularFont && cachedBoldFont) {
    return { regular: cachedRegularFont, bold: cachedBoldFont };
  }
  const candidatePairs = [
    ['./fonts/font-regular.ttf', './fonts/font-bold.ttf'],
    ['/fonts/font-regular.ttf', '/fonts/font-bold.ttf'],
    ['fonts/font-regular.ttf', 'fonts/font-bold.ttf'],
  ];

  for (const [regUrl, boldUrl] of candidatePairs) {
    try {
      const [resReg, resBold] = await Promise.all([
        fetch(regUrl),
        fetch(boldUrl),
      ]);
      if (resReg.ok && resBold.ok) {
        cachedRegularFont = await resReg.arrayBuffer();
        cachedBoldFont = await resBold.arrayBuffer();
        return { regular: cachedRegularFont, bold: cachedBoldFont };
      }
    } catch {
      // Try next path candidate
    }
  }

  console.warn('Unicode fonts could not be fetched from any candidate path, falling back.');
  return { regular: null, bold: null };
}

function safeText(text: string, isCustomFont: boolean): string {
  if (isCustomFont || !text) return text || '';
  return text
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I');
}

export class PdfExporter {
  /**
   * Exports the entire PdfDocumentModel with all structural changes and
   * all annotation overlays (text, drawings, shapes, signatures, stamps, whiteouts, page numbers) flattened.
   */
  public static async exportDocumentWithAnnotations(
    docModel: PdfDocumentModel
  ): Promise<ArrayBuffer> {
    const rawBuffer = binaryStore.get(docModel.id);
    if (!rawBuffer) throw new Error('Döküman binary verisi bulunamadı.');

    const srcDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });

    // 1. If user filled in interactive form fields, write them into AcroForm
    const formValues = useFormStore.getState().valuesByDoc[docModel.id];
    if (formValues && Object.keys(formValues).length > 0) {
      try {
        const form = srcDoc.getForm();
        Object.entries(formValues).forEach(([fieldName, val]) => {
          try {
            const field = form.getField(fieldName);
            if (field instanceof PDFTextField && typeof val === 'string') {
              field.setText(val);
            } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
              if (val) field.check();
              else field.uncheck();
            } else if (field instanceof PDFDropdown && typeof val === 'string') {
              field.select(val);
            } else if (field instanceof PDFRadioGroup && typeof val === 'string') {
              field.select(val);
            }
          } catch {}
        });
      } catch {}
    }

    // 2. Check if document page structure is identical to source
    const isStructureUnchanged =
      docModel.pages.length === srcDoc.getPageCount() &&
      docModel.pages.every((p, idx) => p.sourcePageIndex === idx);

    const outDoc = isStructureUnchanged ? srcDoc : await PDFDocument.create();
    outDoc.registerFontkit(fontkit);

    const { regular, bold } = await loadUnicodeFonts();
    let fontHelvetica: PDFFont;
    let fontHelveticaBold: PDFFont;
    const isCustomFont = Boolean(regular && bold);

    if (isCustomFont && regular && bold) {
      fontHelvetica = await outDoc.embedFont(regular, { subset: true });
      fontHelveticaBold = await outDoc.embedFont(bold, { subset: true });
    } else {
      fontHelvetica = await outDoc.embedFont(StandardFonts.Helvetica);
      fontHelveticaBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const { pageNumberConfig, headerFooterConfig } = useAnnotationStore.getState();

    for (let i = 0; i < docModel.pages.length; i++) {
      const pageModel = docModel.pages[i];
      let copiedPage: PDFPage;

      if (isStructureUnchanged) {
        copiedPage = srcDoc.getPage(i);
        if (pageModel.rotation !== 0) {
          const curRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees((curRot + pageModel.rotation) % 360));
        }
      } else {
        const [p] = await outDoc.copyPages(srcDoc, [pageModel.sourcePageIndex]);
        if (pageModel.rotation !== 0) {
          const curRot = p.getRotation().angle;
          p.setRotation(degrees((curRot + pageModel.rotation) % 360));
        }
        copiedPage = p;
      }

      const pageWidth = copiedPage.getWidth();
      const pageHeight = copiedPage.getHeight();

      // Render all annotations onto copiedPage
      for (const ann of pageModel.annotations) {
        if (ann.type === 'text') {
          const textAnn = ann as TextAnnotation;
          const font = textAnn.isBold ? fontHelveticaBold : fontHelvetica;
          copiedPage.drawText(safeText(textAnn.text, isCustomFont), {
            x: textAnn.x,
            y: pageHeight - textAnn.y - textAnn.fontSize,
            size: textAnn.fontSize,
            font,
            color: hexToRgb(textAnn.color),
            opacity: textAnn.opacity ?? 1,
          });
        } else if (ann.type === 'whiteout') {
          const wh = ann as WhiteoutAnnotation;
          copiedPage.drawRectangle({
            x: wh.x,
            y: pageHeight - wh.y - wh.height,
            width: wh.width,
            height: wh.height,
            color: hexToRgb(wh.color || '#ffffff'),
            borderColor: wh.borderColor ? hexToRgb(wh.borderColor) : undefined,
            borderWidth: wh.borderWidth || 0,
            opacity: wh.opacity ?? 1,
          });
        } else if (ann.type === 'rect') {
          const sh = ann as ShapeAnnotation;
          copiedPage.drawRectangle({
            x: sh.x,
            y: pageHeight - sh.y - sh.height,
            width: sh.width,
            height: sh.height,
            borderColor: hexToRgb(sh.strokeColor),
            borderWidth: sh.strokeWidth,
            color: sh.fillColor && sh.fillColor !== 'transparent' ? hexToRgb(sh.fillColor) : undefined,
            opacity: sh.opacity ?? 1,
          });
        } else if (ann.type === 'circle') {
          const sh = ann as ShapeAnnotation;
          copiedPage.drawEllipse({
            x: sh.x + sh.width / 2,
            y: pageHeight - sh.y - sh.height / 2,
            xScale: sh.width / 2,
            yScale: sh.height / 2,
            borderColor: hexToRgb(sh.strokeColor),
            borderWidth: sh.strokeWidth,
            color: sh.fillColor && sh.fillColor !== 'transparent' ? hexToRgb(sh.fillColor) : undefined,
            opacity: sh.opacity ?? 1,
          });
        } else if (ann.type === 'line' || ann.type === 'arrow') {
          const sh = ann as ShapeAnnotation;
          copiedPage.drawLine({
            start: { x: sh.x, y: pageHeight - sh.y },
            end: { x: sh.x + sh.width, y: pageHeight - (sh.y + sh.height) },
            thickness: sh.strokeWidth,
            color: hexToRgb(sh.strokeColor),
            opacity: sh.opacity ?? 1,
          });
        } else if (ann.type === 'draw' || ann.type === 'highlight') {
          const dr = ann as DrawingAnnotation;
          for (let pIdx = 0; pIdx < dr.points.length - 1; pIdx++) {
            const p1 = dr.points[pIdx];
            const p2 = dr.points[pIdx + 1];
            copiedPage.drawLine({
              start: { x: p1.x, y: pageHeight - p1.y },
              end: { x: p2.x, y: pageHeight - p2.y },
              thickness: dr.strokeWidth,
              color: hexToRgb(dr.color),
              opacity: dr.opacity ?? 1,
            });
          }
        } else if (ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'image') {
          const imgAnn = ann as ImageAnnotation;
          if (imgAnn.dataUrl) {
            try {
              const imgBytes = dataUrlToUint8Array(imgAnn.dataUrl);
              const isPng = imgAnn.dataUrl.includes('image/png');
              const embedded = isPng ? await outDoc.embedPng(imgBytes) : await outDoc.embedJpg(imgBytes);

              copiedPage.drawImage(embedded, {
                x: imgAnn.x,
                y: pageHeight - imgAnn.y - imgAnn.height,
                width: imgAnn.width,
                height: imgAnn.height,
                opacity: imgAnn.opacity ?? 1,
              });
            } catch (err) {
              console.error('Image embed error:', err);
            }
          }
        }
      }

      // ── Native PDF Objects (Moved, Edited, or Deleted) ───────────────────
      // For any existing PDF text or image that the user dragged, edited, or deleted:
      //  1. Draw a white rectangle to mask the original position
      //  2. If not deleted, redraw at the new position (with updated text if edited)
      const nativeObjects = useNativeObjectStore.getState().getObjectsForPage(pageModel.id);
      for (const nObj of nativeObjects) {
        if (!nObj.moved && !nObj.deleted && !nObj.isEdited) continue;

        if (nObj.type === 'native-text' && nObj.text) {
          const fontSize = nObj.fontSize || 12;

          // 1. Whiteout the original position (slightly enlarged to ensure full coverage)
          copiedPage.drawRectangle({
            x: nObj.originalX - 1,
            y: pageHeight - nObj.originalY - nObj.originalHeight - 2,
            width: nObj.originalWidth + 4,
            height: nObj.originalHeight + 4,
            color: rgb(1, 1, 1),
            opacity: 1,
          });

          // 2. Redraw at new position (only if not deleted)
          if (!nObj.deleted) {
            try {
              copiedPage.drawText(safeText(nObj.text, isCustomFont), {
                x: nObj.x,
                y: pageHeight - nObj.y - fontSize,
                size: fontSize,
                font: fontHelvetica,
                color: rgb(0, 0, 0),
                opacity: 1,
              });
            } catch (textErr) {
              console.warn('Native text redraw error:', textErr);
            }
          }
        } else if (nObj.type === 'native-image') {
          // 1. Mask original position
          copiedPage.drawRectangle({
            x: nObj.originalX - 1,
            y: pageHeight - nObj.originalY - nObj.originalHeight - 1,
            width: nObj.originalWidth + 2,
            height: nObj.originalHeight + 2,
            color: rgb(1, 1, 1),
            opacity: 1,
          });

          // 2. If image dataUrl is available and not deleted, redraw at new position
          if (nObj.dataUrl && !nObj.deleted) {
            try {
              const imgBytes = dataUrlToUint8Array(nObj.dataUrl);
              const isPng = nObj.dataUrl.includes('image/png');
              const embedded = isPng ? await outDoc.embedPng(imgBytes) : await outDoc.embedJpg(imgBytes);
              copiedPage.drawImage(embedded, {
                x: nObj.x,
                y: pageHeight - nObj.y - nObj.height,
                width: nObj.width,
                height: nObj.height,
                opacity: 1,
              });
            } catch (imgErr) {
              console.warn('Native image redraw error:', imgErr);
            }
          }
        }
      }

      // Page numbers
      if (pageNumberConfig.enabled) {
        const numText =
          pageNumberConfig.format === 'page-x-of-y'
            ? `Sayfa ${i + 1} / ${docModel.pages.length}`
            : `${i + 1}`;

        let numX = pageWidth / 2 - 25;
        let numY = 20;

        if (pageNumberConfig.position === 'bottom-left') numX = 30;
        else if (pageNumberConfig.position === 'bottom-right') numX = pageWidth - 80;
        else if (pageNumberConfig.position === 'top-left') { numX = 30; numY = pageHeight - 30; }
        else if (pageNumberConfig.position === 'top-center') { numX = pageWidth / 2 - 25; numY = pageHeight - 30; }
        else if (pageNumberConfig.position === 'top-right') { numX = pageWidth - 80; numY = pageHeight - 30; }

        copiedPage.drawText(safeText(numText, isCustomFont), {
          x: numX,
          y: numY,
          size: pageNumberConfig.fontSize,
          font: fontHelvetica,
          color: rgb(0.3, 0.35, 0.45),
        });
      }

      // Header / Footer
      if (headerFooterConfig.headerText) {
        copiedPage.drawText(safeText(headerFooterConfig.headerText, isCustomFont), {
          x: 30,
          y: pageHeight - 25,
          size: headerFooterConfig.fontSize,
          font: fontHelvetica,
          color: rgb(0.4, 0.45, 0.55),
        });
      }

      if (headerFooterConfig.footerText) {
        copiedPage.drawText(safeText(headerFooterConfig.footerText, isCustomFont), {
          x: 30,
          y: 20,
          size: headerFooterConfig.fontSize,
          font: fontHelvetica,
          color: rgb(0.4, 0.45, 0.55),
        });
      }

      if (!isStructureUnchanged) {
        outDoc.addPage(copiedPage);
      }
    }

    const pdfBytes = await outDoc.save();
    return pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
  }
}

function hexToRgb(hex: string) {
  let cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return rgb(0, 0, 0);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return rgb(r, g, b);
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
