import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { PdfDocumentModel, PdfPageModel } from '@/types/document';
import {
  AnyAnnotation,
  DrawingAnnotation,
  ImageAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  WhiteoutAnnotation,
} from '@/types/annotations';
import { useDocumentStore } from '@/store/document-store';

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

export interface ImageExportOptions {
  format: ImageExportFormat;
  scale: number; // 1 = 72 DPI, 2 = 150 DPI, 3 = 300 DPI
  quality?: number; // 0.1 to 1.0 (for jpeg/webp)
}

async function loadDrawableImage(dataUrl: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return null;
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function drawAnnotationsOntoCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnyAnnotation[],
  scale: number
): Promise<void> {
  for (const ann of annotations) {
    ctx.save();
    ctx.globalAlpha = ann.opacity ?? 1;

    if (ann.rotation) {
      const cx = (ann.x + (ann.width || 0) / 2) * scale;
      const cy = (ann.y + (ann.height || 0) / 2) * scale;
      ctx.translate(cx, cy);
      ctx.rotate((ann.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (ann.type === 'whiteout') {
      const wh = ann as WhiteoutAnnotation;
      ctx.fillStyle = wh.color || '#ffffff';
      ctx.fillRect(wh.x * scale, wh.y * scale, wh.width * scale, wh.height * scale);
      if (wh.borderColor && wh.borderWidth) {
        ctx.strokeStyle = wh.borderColor;
        ctx.lineWidth = wh.borderWidth * scale;
        ctx.strokeRect(wh.x * scale, wh.y * scale, wh.width * scale, wh.height * scale);
      }
    } else if (ann.type === 'rect') {
      const sh = ann as ShapeAnnotation;
      if (sh.fillColor && sh.fillColor !== 'transparent') {
        ctx.fillStyle = sh.fillColor;
        ctx.fillRect(sh.x * scale, sh.y * scale, sh.width * scale, sh.height * scale);
      }
      if (sh.strokeColor && sh.strokeColor !== 'transparent' && (sh.strokeWidth || 0) > 0) {
        ctx.strokeStyle = sh.strokeColor;
        ctx.lineWidth = (sh.strokeWidth || 1) * scale;
        ctx.strokeRect(sh.x * scale, sh.y * scale, sh.width * scale, sh.height * scale);
      }
    } else if (ann.type === 'circle') {
      const sh = ann as ShapeAnnotation;
      const rx = Math.max(0.5, (Math.abs(sh.width) * scale) / 2);
      const ry = Math.max(0.5, (Math.abs(sh.height) * scale) / 2);
      const cx = (sh.x + sh.width / 2) * scale;
      const cy = (sh.y + sh.height / 2) * scale;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (sh.fillColor && sh.fillColor !== 'transparent') {
        ctx.fillStyle = sh.fillColor;
        ctx.fill();
      }
      if (sh.strokeColor && sh.strokeColor !== 'transparent') {
        ctx.strokeStyle = sh.strokeColor;
        ctx.lineWidth = (sh.strokeWidth || 1) * scale;
        ctx.stroke();
      }
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      const sh = ann as ShapeAnnotation;
      const x1 = sh.x * scale;
      const y1 = sh.y * scale;
      const x2 = (sh.x + sh.width) * scale;
      const y2 = (sh.y + sh.height) * scale;
      const lw = (sh.strokeWidth || 2) * scale;
      ctx.strokeStyle = sh.strokeColor || '#000000';
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (ann.type === 'arrow' && Math.hypot(x2 - x1, y2 - y1) > 1) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.max(8 * scale, lw * 3.5);
        const spread = Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(x2 - headLen * Math.cos(angle - spread), y2 - headLen * Math.sin(angle - spread));
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle + spread), y2 - headLen * Math.sin(angle + spread));
        ctx.stroke();
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
      const y = (ann.type as string) === 'strikethrough' ? raw.y + raw.height / 2 : raw.y + raw.height;
      ctx.strokeStyle = raw.strokeColor || raw.color || '#ef4444';
      ctx.lineWidth = (raw.strokeWidth || 1.5) * scale;
      ctx.beginPath();
      ctx.moveTo(raw.x * scale, y * scale);
      ctx.lineTo((raw.x + raw.width) * scale, y * scale);
      ctx.stroke();
    } else if (ann.type === 'draw' || ann.type === 'highlight') {
      const dr = ann as DrawingAnnotation;
      ctx.globalAlpha = dr.type === 'highlight' ? dr.opacity ?? 0.4 : ann.opacity ?? 1;
      ctx.strokeStyle = dr.color || '#0284c7';
      ctx.fillStyle = dr.color || '#0284c7';
      ctx.lineWidth = (dr.strokeWidth || 2) * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (dr.points.length === 1) {
        ctx.beginPath();
        ctx.arc(dr.points[0].x * scale, dr.points[0].y * scale, ((dr.strokeWidth || 2) * scale) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (dr.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(dr.points[0].x * scale, dr.points[0].y * scale);
        for (let k = 1; k < dr.points.length; k++) {
          ctx.lineTo(dr.points[k].x * scale, dr.points[k].y * scale);
        }
        ctx.stroke();
      }
    } else if (ann.type === 'text') {
      const t = ann as TextAnnotation;
      const fontSize = (t.fontSize || 14) * scale;
      if (t.backgroundColor && t.backgroundColor !== 'transparent') {
        ctx.fillStyle = t.backgroundColor;
        ctx.fillRect(
          t.x * scale,
          t.y * scale,
          Math.max(10, t.width || 100) * scale,
          Math.max(t.fontSize + 4, t.height || t.fontSize + 4) * scale
        );
      }
      ctx.fillStyle = t.color || '#000000';
      ctx.font = `${t.isItalic ? 'italic ' : ''}${t.isBold ? 'bold ' : ''}${fontSize}px ${t.fontFamily || 'Helvetica, Arial, sans-serif'}`;
      ctx.textBaseline = 'top';
      const lines = (t.text || '').split(/\r?\n/);
      lines.forEach((line, lIdx) => {
        ctx.fillText(line, t.x * scale, t.y * scale + lIdx * fontSize * 1.25);
      });
    } else if (ann.type === 'image' || ann.type === 'signature' || ann.type === 'stamp') {
      const imgAnn = ann as ImageAnnotation;
      if (imgAnn.dataUrl) {
        const img = await loadDrawableImage(imgAnn.dataUrl);
        if (img) {
          ctx.drawImage(
            img,
            imgAnn.x * scale,
            imgAnn.y * scale,
            imgAnn.width * scale,
            imgAnn.height * scale
          );
        }
      }
    }

    ctx.restore();
  }
}

function resolvePageModel(
  pdfDocProxy: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  explicitPageModel?: PdfPageModel,
  explicitDocModel?: PdfDocumentModel | null
): PdfPageModel | undefined {
  if (explicitPageModel) return explicitPageModel;
  if (explicitDocModel) return explicitDocModel.pages[pageNumber - 1];

  const docState = useDocumentStore.getState();
  if (docState.pdfDocProxy === pdfDocProxy && docState.currentDocument) {
    return docState.currentDocument.pages[pageNumber - 1];
  }
  return undefined;
}

export class PdfImageExporter {
  /**
   * Renders a specific page to a Canvas element at given scale, honoring
   * PdfPageModel rotation, sourcePageIndex order, annotations, and crop.
   */
  public static async renderPageToCanvas(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    scale: number = 2.0,
    pageModel?: PdfPageModel
  ): Promise<HTMLCanvasElement> {
    const resolvedModel = resolvePageModel(pdfDocProxy, pageNumber, pageModel);
    const sourceNum = resolvedModel ? resolvedModel.sourcePageIndex + 1 : pageNumber;
    const page = await pdfDocProxy.getPage(sourceNum);
    const viewport = page.getViewport({
      scale,
      ...(resolvedModel ? { rotation: resolvedModel.rotation } : {}),
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get canvas 2d context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    if (resolvedModel && resolvedModel.annotations.length > 0) {
      await drawAnnotationsOntoCanvas(ctx, resolvedModel.annotations, scale);
    }

    if (resolvedModel?.crop && resolvedModel.crop.width > 0 && resolvedModel.crop.height > 0) {
      const cropX = Math.max(0, Math.floor(resolvedModel.crop.x * scale));
      const cropY = Math.max(0, Math.floor(resolvedModel.crop.y * scale));
      const cropW = Math.max(
        1,
        Math.min(canvas.width - cropX, Math.floor(resolvedModel.crop.width * scale))
      );
      const cropH = Math.max(
        1,
        Math.min(canvas.height - cropY, Math.floor(resolvedModel.crop.height * scale))
      );

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropW;
      croppedCanvas.height = cropH;
      const croppedCtx = croppedCanvas.getContext('2d', { alpha: false });
      if (croppedCtx) {
        croppedCtx.fillStyle = '#ffffff';
        croppedCtx.fillRect(0, 0, cropW, cropH);
        croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        canvas.width = 0;
        canvas.height = 0;
        return croppedCanvas;
      }
    }

    return canvas;
  }

  /**
   * Exports a single page as a Blob and cleans up canvas memory afterward.
   */
  public static async exportSinglePage(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    options: ImageExportOptions,
    pageModel?: PdfPageModel
  ): Promise<{ blob: Blob; filename: string }> {
    const canvas = await this.renderPageToCanvas(
      pdfDocProxy,
      pageNumber,
      options.scale,
      pageModel
    );
    const mimeType =
      options.format === 'png'
        ? 'image/png'
        : options.format === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    const quality = options.quality ?? 0.92;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Canvas toBlob failed'));
          },
          mimeType,
          quality
        );
      });

      const ext = options.format === 'jpeg' ? 'jpg' : options.format;
      const filename = `sayfa-${pageNumber}.${ext}`;

      return { blob, filename };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  /**
   * Exports multiple pages packaged into a single ZIP file, honoring page order/rotations/annotations/crop.
   */
  public static async exportPagesAsZip(
    pdfDocProxy: pdfjsLib.PDFDocumentProxy,
    docName: string,
    options: ImageExportOptions,
    pageIndices?: number[],
    onProgress?: (current: number, total: number) => void,
    docModel?: PdfDocumentModel
  ): Promise<Blob> {
    const zip = new JSZip();
    const docState = useDocumentStore.getState();
    const activeModel =
      docModel || (docState.pdfDocProxy === pdfDocProxy ? docState.currentDocument : null);

    const totalPages = activeModel ? activeModel.pages.length : pdfDocProxy.numPages;
    const targetPages =
      pageIndices && pageIndices.length > 0
        ? pageIndices.filter((p) => p >= 1 && p <= totalPages)
        : Array.from({ length: totalPages }, (_, i) => i + 1);

    const mimeType =
      options.format === 'png'
        ? 'image/png'
        : options.format === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    const quality = options.quality ?? 0.92;
    const ext = options.format === 'jpeg' ? 'jpg' : options.format;

    for (let idx = 0; idx < targetPages.length; idx++) {
      const pageNum = targetPages[idx];
      if (onProgress) {
        onProgress(idx + 1, targetPages.length);
      }

      const pageModel = activeModel ? activeModel.pages[pageNum - 1] : undefined;
      const canvas = await this.renderPageToCanvas(
        pdfDocProxy,
        pageNum,
        options.scale,
        pageModel
      );
      try {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const base64Data = dataUrl.split(',')[1];
        const paddedIndex = String(pageNum).padStart(3, '0');
        zip.file(`${docName.replace(/\.pdf$/i, '')}_sayfa_${paddedIndex}.${ext}`, base64Data, {
          base64: true,
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    return await zip.generateAsync({ type: 'blob' });
  }
}
