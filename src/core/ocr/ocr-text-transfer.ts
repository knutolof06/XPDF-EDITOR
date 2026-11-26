import { TextAnnotation, WhiteoutAnnotation, AnyAnnotation } from '@/types/annotations';
import type { PdfPageModel } from '@/types/document';
import type { OcrPageResult } from './ocr-service';
import { useDocumentStore } from '@/store/document-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { historyManager, TransferOcrTextCommand } from '@/core/history/command-manager';

export interface TextTransferOptions {
  mode: 'paragraph' | 'line';
  hideOriginalScan: boolean;
  fontSizeMultiplier: number;
  fontColor: string;
  fontFamily: string;
}

const DEFAULT_TRANSFER_OPTIONS: TextTransferOptions = {
  mode: 'paragraph',
  hideOriginalScan: false,
  fontSizeMultiplier: 1.0,
  fontColor: '#0f172a',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

function generateUniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function buildTextAnnotation(
  pageId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fontSize: number,
  isBold: boolean,
  options: TextTransferOptions
): TextAnnotation {
  return {
    id: generateUniqueId('text_ocr'),
    pageId,
    type: 'text',
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(40, Math.round(width)),
    height: Math.max(18, Math.round(height)),
    text,
    fontSize,
    fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
    color: options.fontColor || '#0f172a',
    isBold,
    isItalic: false,
    isUnderline: false,
    textAlign: 'left',
  };
}

function generateSynthesizedAnnotations(
  paragraphs: string[],
  pageId: string,
  pageWidth: number,
  pageHeight: number,
  options: TextTransferOptions
): TextAnnotation[] {
  const marginX = 54;
  const marginY = 54;
  const availableWidth = Math.max(200, pageWidth - marginX * 2);
  let currentY = marginY;
  const baseFontSize = Math.max(9, Math.min(24, Math.round(12 * options.fontSizeMultiplier)));
  const lineHeight = baseFontSize * 1.35;

  const result: TextAnnotation[] = [];

  for (const text of paragraphs) {
    const charWidth = baseFontSize * 0.55;
    const charsPerLine = Math.max(20, Math.floor(availableWidth / charWidth));
    const estLines = Math.max(1, Math.ceil(text.length / charsPerLine));
    const blockHeight = Math.max(24, Math.round(estLines * lineHeight + 12));

    result.push(
      buildTextAnnotation(
        pageId,
        marginX,
        currentY,
        availableWidth,
        blockHeight,
        text,
        baseFontSize,
        false,
        options
      )
    );

    currentY += blockHeight + 14;
    if (currentY + blockHeight > pageHeight - marginY) {
      currentY = marginY;
    }
  }

  return result;
}

function buildPageAnnotations(
  page: PdfPageModel,
  pageResult: OcrPageResult,
  options: TextTransferOptions,
  overrideText?: string
): { newAnnotations: AnyAnnotation[]; firstTextId?: string; textCount: number } {
  const pageWidth = page.width;
  const pageHeight = page.height;
  const newAnnotations: AnyAnnotation[] = [];

  if (options.hideOriginalScan) {
    const whiteout: WhiteoutAnnotation = {
      id: generateUniqueId('whiteout'),
      pageId: page.id,
      type: 'whiteout',
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: '#ffffff',
      opacity: 1,
    };
    newAnnotations.push(whiteout);
  }

  let firstTextId: string | undefined;
  const effectiveText = (overrideText !== undefined ? overrideText : pageResult.text || '').trim();
  const isUserEdited =
    overrideText !== undefined && overrideText.trim() !== (pageResult.text || '').trim();

  const recordTextAnn = (ann: TextAnnotation) => {
    if (!firstTextId) firstTextId = ann.id;
    newAnnotations.push(ann);
  };

  if (isUserEdited && effectiveText.length > 0) {
    const userParagraphs = effectiveText
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (
      pageResult.paragraphs &&
      pageResult.paragraphs.length > 0 &&
      pageResult.paragraphs.length === userParagraphs.length
    ) {
      for (let i = 0; i < pageResult.paragraphs.length; i++) {
        const p = pageResult.paragraphs[i];
        const text = userParagraphs[i];
        if (!text) continue;

        const x = Math.max(0, p.normBbox.x * pageWidth);
        const y = Math.max(0, p.normBbox.y * pageHeight);
        const width = Math.max(60, Math.min(pageWidth - x, p.normBbox.width * pageWidth));
        const height = Math.max(24, Math.min(pageHeight - y, p.normBbox.height * pageHeight));
        const fontSize = Math.max(
          8,
          Math.min(54, Math.round(p.estimatedFontSize * options.fontSizeMultiplier))
        );

        recordTextAnn(
          buildTextAnnotation(page.id, x, y, width, height, text, fontSize, p.isBold, options)
        );
      }
    } else {
      const synthesized = generateSynthesizedAnnotations(
        userParagraphs,
        page.id,
        pageWidth,
        pageHeight,
        options
      );
      synthesized.forEach(recordTextAnn);
    }
  } else {
    let handled = false;

    // Tier 1: Paragraph mode
    if (options.mode === 'paragraph' && pageResult.paragraphs && pageResult.paragraphs.length > 0) {
      for (const p of pageResult.paragraphs) {
        if (!p.text || p.text.trim().length === 0) continue;

        const x = Math.max(0, p.normBbox.x * pageWidth);
        const y = Math.max(0, p.normBbox.y * pageHeight);
        const width = Math.max(60, Math.min(pageWidth - x, p.normBbox.width * pageWidth));
        const height = Math.max(24, Math.min(pageHeight - y, p.normBbox.height * pageHeight));
        const fontSize = Math.max(
          8,
          Math.min(54, Math.round(p.estimatedFontSize * options.fontSizeMultiplier))
        );

        recordTextAnn(
          buildTextAnnotation(page.id, x, y, width, height, p.text, fontSize, p.isBold, options)
        );
      }
      if (newAnnotations.some((a) => a.type === 'text')) handled = true;
    }

    // Tier 2: Line mode (or fallback when paragraphs unavailable)
    if (!handled && pageResult.lines && pageResult.lines.length > 0 && pageResult.width > 0 && pageResult.height > 0) {
      const effectiveScale =
        pageResult.renderScale && pageResult.renderScale > 0
          ? pageResult.renderScale
          : pageWidth > 0
          ? pageResult.width / pageWidth
          : 3.0;

      for (const line of pageResult.lines) {
        if (!line.text || line.text.trim().length === 0) continue;

        const normX = line.bbox.x0 / pageResult.width;
        const normY = line.bbox.y0 / pageResult.height;
        const normW = (line.bbox.x1 - line.bbox.x0) / pageResult.width;
        const normH = (line.bbox.y1 - line.bbox.y0) / pageResult.height;

        const x = Math.max(0, normX * pageWidth);
        const y = Math.max(0, normY * pageHeight);
        const width = Math.max(40, Math.min(pageWidth - x, normW * pageWidth));
        const height = Math.max(18, Math.min(pageHeight - y, normH * pageHeight));

        const pointHeight = (line.bbox.y1 - line.bbox.y0) / effectiveScale;
        const fontSize = Math.max(
          8,
          Math.min(54, Math.round(pointHeight * 0.75 * options.fontSizeMultiplier))
        );

        recordTextAnn(
          buildTextAnnotation(page.id, x, y, width, height, line.text, fontSize, false, options)
        );
      }
      if (newAnnotations.some((a) => a.type === 'text')) handled = true;
    }

    // Tier 3: Synthesize from full text
    if (!handled && effectiveText.length > 0) {
      const fallbackParagraphs = effectiveText
        .split(/\n\s*\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const synthesized = generateSynthesizedAnnotations(
        fallbackParagraphs,
        page.id,
        pageWidth,
        pageHeight,
        options
      );
      synthesized.forEach(recordTextAnn);
    }
  }

  const textCount = newAnnotations.filter((a) => a.type === 'text').length;
  return { newAnnotations, firstTextId, textCount };
}

export class OcrTextTransfer {
  /**
   * Converts OCR page results into editable TextAnnotations (and optional whiteout mask)
   * and transfers them directly onto the document page using an undoable command.
   */
  public static transferSinglePage(
    pageResult: OcrPageResult,
    options: TextTransferOptions = DEFAULT_TRANSFER_OPTIONS,
    overrideText?: string
  ): { success: boolean; count: number; firstTextId?: string } {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return { success: false, count: 0 };

    const pageIndex = pageResult.pageNumber - 1;
    const page = doc.pages[pageIndex];
    if (!page) return { success: false, count: 0 };

    const { newAnnotations, firstTextId, textCount } = buildPageAnnotations(
      page,
      pageResult,
      options,
      overrideText
    );

    if (textCount === 0) {
      return { success: false, count: 0 };
    }

    const command = new TransferOcrTextCommand(
      [
        {
          pageId: page.id,
          newAnnotations,
          previousAnnotations: [...page.annotations],
        },
      ],
      `Sayfa ${pageResult.pageNumber}: ${textCount} OCR metin bloğu sayfaya aktarıldı`
    );

    historyManager.execute(command);

    useAnnotationStore.getState().setActiveTool('select');
    if (firstTextId) {
      useAnnotationStore.getState().setSelectedAnnotationId(firstTextId);
    }
    useDocumentStore.getState().setActivePageIndex(pageIndex);

    return {
      success: true,
      count: textCount,
      firstTextId,
    };
  }

  /**
   * Batch transfers multiple OCR page results to their respective pages in a single undoable command.
   */
  public static transferMultiplePages(
    pageResults: OcrPageResult[],
    options: TextTransferOptions = DEFAULT_TRANSFER_OPTIONS
  ): { success: boolean; totalCount: number; pagesAffected: number } {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc || pageResults.length === 0) return { success: false, totalCount: 0, pagesAffected: 0 };

    const pageTransfers: {
      pageId: string;
      newAnnotations: AnyAnnotation[];
      previousAnnotations: AnyAnnotation[];
    }[] = [];

    let totalCount = 0;
    let firstPageTextId: string | undefined;
    let firstPageIndex = 0;

    for (const pageResult of pageResults) {
      const pageIndex = pageResult.pageNumber - 1;
      const page = doc.pages[pageIndex];
      if (!page) continue;

      const { newAnnotations, firstTextId, textCount } = buildPageAnnotations(
        page,
        pageResult,
        options
      );

      if (textCount > 0) {
        if (!firstPageTextId && firstTextId) {
          firstPageTextId = firstTextId;
          firstPageIndex = pageIndex;
        }
        pageTransfers.push({
          pageId: page.id,
          newAnnotations,
          previousAnnotations: [...page.annotations],
        });
        totalCount += textCount;
      }
    }

    if (pageTransfers.length === 0) {
      return { success: false, totalCount: 0, pagesAffected: 0 };
    }

    const command = new TransferOcrTextCommand(
      pageTransfers,
      `${pageTransfers.length} sayfaya ${totalCount} OCR metin bloğu aktarıldı`
    );
    historyManager.execute(command);

    useAnnotationStore.getState().setActiveTool('select');
    if (firstPageTextId) {
      useAnnotationStore.getState().setSelectedAnnotationId(firstPageTextId);
    }
    useDocumentStore.getState().setActivePageIndex(firstPageIndex);

    return {
      success: true,
      totalCount,
      pagesAffected: pageTransfers.length,
    };
  }
}
