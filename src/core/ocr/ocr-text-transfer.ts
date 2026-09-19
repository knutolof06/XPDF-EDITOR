import { TextAnnotation, WhiteoutAnnotation, AnyAnnotation } from '@/types/annotations';
import { OcrPageResult } from './ocr-service';
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

export class OcrTextTransfer {
  /**
   * Converts OCR page results into editable TextAnnotations (and optional whiteout mask)
   * and transfers them directly onto the document page using an undoable command.
   * If overrideText is provided (e.g. edited by user in OCR Studio), it prioritizes the edited text.
   */
  public static transferSinglePage(
    pageResult: OcrPageResult,
    options: TextTransferOptions = {
      mode: 'paragraph',
      hideOriginalScan: false,
      fontSizeMultiplier: 1.0,
      fontColor: '#0f172a',
      fontFamily: 'Helvetica, Arial, sans-serif',
    },
    overrideText?: string
  ): { success: boolean; count: number; firstTextId?: string } {
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return { success: false, count: 0 };

    // Target page matching pageResult.pageNumber (1-indexed)
    const pageIndex = pageResult.pageNumber - 1;
    const page = doc.pages[pageIndex];
    if (!page) return { success: false, count: 0 };

    const pageWidth = page.width;
    const pageHeight = page.height;
    const newAnnotations: AnyAnnotation[] = [];

    // 1. If user selected to hide/whiteout the messy scan underneath
    if (options.hideOriginalScan) {
      const whiteout: WhiteoutAnnotation = {
        id: `whiteout_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

    // 2. Check if user edited the text in the modal editor
    const isUserEdited = overrideText !== undefined && overrideText.trim() !== (pageResult.text || '').trim();

    if (isUserEdited && effectiveText.length > 0) {
      const userParagraphs = effectiveText
        .split(/\n\s*\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // If paragraph counts match original OCR paragraphs, preserve exact bounding boxes!
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
          const width = Math.min(pageWidth - x, p.normBbox.width * pageWidth);
          const height = Math.min(pageHeight - y, p.normBbox.height * pageHeight);
          const fontSize = Math.max(
            8,
            Math.min(54, Math.round(p.estimatedFontSize * options.fontSizeMultiplier))
          );

          const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (!firstTextId) firstTextId = annId;

          newAnnotations.push({
            id: annId,
            pageId: page.id,
            type: 'text',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(60, Math.round(width)),
            height: Math.max(24, Math.round(height)),
            text,
            fontSize,
            fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
            color: options.fontColor || '#0f172a',
            isBold: p.isBold,
            isItalic: false,
            isUnderline: false,
            textAlign: 'left',
          });
        }
      } else {
        // Synthesize user-edited paragraphs cleanly on the page
        const synthesized = this.generateSynthesizedAnnotations(
          userParagraphs,
          page.id,
          pageWidth,
          pageHeight,
          options
        );
        for (const ann of synthesized) {
          if (!firstTextId) firstTextId = ann.id;
          newAnnotations.push(ann);
        }
      }
    } else {
      // Standard OCR transfer path (multi-tier fallback)
      let handled = false;

      // Tier 1: Paragraph mode with detected paragraphs
      if (options.mode === 'paragraph' && pageResult.paragraphs && pageResult.paragraphs.length > 0) {
        for (const p of pageResult.paragraphs) {
          if (!p.text || p.text.trim().length === 0) continue;

          const x = Math.max(0, p.normBbox.x * pageWidth);
          const y = Math.max(0, p.normBbox.y * pageHeight);
          const width = Math.min(pageWidth - x, p.normBbox.width * pageWidth);
          const height = Math.min(pageHeight - y, p.normBbox.height * pageHeight);
          const fontSize = Math.max(
            8,
            Math.min(54, Math.round(p.estimatedFontSize * options.fontSizeMultiplier))
          );

          const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (!firstTextId) firstTextId = annId;

          newAnnotations.push({
            id: annId,
            pageId: page.id,
            type: 'text',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(60, Math.round(width)),
            height: Math.max(24, Math.round(height)),
            text: p.text,
            fontSize,
            fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
            color: options.fontColor || '#0f172a',
            isBold: p.isBold,
            isItalic: false,
            isUnderline: false,
            textAlign: 'left',
          });
        }
        if (newAnnotations.some((a) => a.type === 'text')) handled = true;
      }

      // Tier 2: Line mode OR fallback if paragraphs were empty
      if (!handled && pageResult.lines && pageResult.lines.length > 0) {
        for (const line of pageResult.lines) {
          if (!line.text || line.text.trim().length === 0) continue;

          const normX = line.bbox.x0 / pageResult.width;
          const normY = line.bbox.y0 / pageResult.height;
          const normW = (line.bbox.x1 - line.bbox.x0) / pageResult.width;
          const normH = (line.bbox.y1 - line.bbox.y0) / pageResult.height;

          const x = Math.max(0, normX * pageWidth);
          const y = Math.max(0, normY * pageHeight);
          const width = Math.min(pageWidth - x, normW * pageWidth);
          const height = Math.min(pageHeight - y, normH * pageHeight);

          const pointHeight = (line.bbox.y1 - line.bbox.y0) / 3.0;
          const fontSize = Math.max(
            8,
            Math.min(54, Math.round(pointHeight * 0.75 * options.fontSizeMultiplier))
          );

          const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (!firstTextId) firstTextId = annId;

          newAnnotations.push({
            id: annId,
            pageId: page.id,
            type: 'text',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(40, Math.round(width)),
            height: Math.max(18, Math.round(height)),
            text: line.text,
            fontSize,
            fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
            color: options.fontColor || '#0f172a',
            isBold: false,
            isItalic: false,
            isUnderline: false,
            textAlign: 'left',
          });
        }
        if (newAnnotations.some((a) => a.type === 'text')) handled = true;
      }

      // Tier 3: Resilient fallback - synthesize annotations from full text
      if (!handled && effectiveText.length > 0) {
        const fallbackParagraphs = effectiveText
          .split(/\n\s*\n+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        const synthesized = this.generateSynthesizedAnnotations(
          fallbackParagraphs,
          page.id,
          pageWidth,
          pageHeight,
          options
        );
        for (const ann of synthesized) {
          if (!firstTextId) firstTextId = ann.id;
          newAnnotations.push(ann);
        }
      }
    }

    const textAnnotationsCount = newAnnotations.filter((a) => a.type === 'text').length;
    if (textAnnotationsCount === 0) {
      return { success: false, count: 0 };
    }

    // Execute via atomic undoable Command
    const previousAnnotations = [...page.annotations];
    const command = new TransferOcrTextCommand(
      [
        {
          pageId: page.id,
          newAnnotations,
          previousAnnotations,
        },
      ],
      `Sayfa ${pageResult.pageNumber}: ${textAnnotationsCount} OCR metin bloğu sayfaya aktarıldı`
    );

    historyManager.execute(command);

    // Switch tool to 'select' and select the first transferred text
    useAnnotationStore.getState().setActiveTool('select');
    if (firstTextId) {
      useAnnotationStore.getState().setSelectedAnnotationId(firstTextId);
    }
    useDocumentStore.getState().setActivePageIndex(pageIndex);

    return {
      success: true,
      count: textAnnotationsCount,
      firstTextId,
    };
  }

  /**
   * Helper to synthesize nicely spaced text annotations across a page.
   */
  private static generateSynthesizedAnnotations(
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

      const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      result.push({
        id: annId,
        pageId,
        type: 'text',
        x: marginX,
        y: Math.round(currentY),
        width: Math.round(availableWidth),
        height: blockHeight,
        text,
        fontSize: baseFontSize,
        fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
        color: options.fontColor || '#0f172a',
        isBold: false,
        isItalic: false,
        isUnderline: false,
        textAlign: 'left',
      });

      currentY += blockHeight + 14;
      if (currentY + blockHeight > pageHeight - marginY) {
        currentY = marginY; // wrap or overflow
      }
    }

    return result;
  }

  /**
   * Batch transfers multiple OCR page results to their respective pages in a single undoable command.
   */
  public static transferMultiplePages(
    pageResults: OcrPageResult[],
    options: TextTransferOptions
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

      const pageWidth = page.width;
      const pageHeight = page.height;
      const newAnnotations: AnyAnnotation[] = [];

      if (options.hideOriginalScan) {
        const whiteout: WhiteoutAnnotation = {
          id: `whiteout_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

      let handled = false;

      // Tier 1: Paragraphs
      if (options.mode === 'paragraph' && pageResult.paragraphs && pageResult.paragraphs.length > 0) {
        for (const p of pageResult.paragraphs) {
          if (!p.text || p.text.trim().length === 0) continue;

          const x = Math.max(0, p.normBbox.x * pageWidth);
          const y = Math.max(0, p.normBbox.y * pageHeight);
          const width = Math.min(pageWidth - x, p.normBbox.width * pageWidth);
          const height = Math.min(pageHeight - y, p.normBbox.height * pageHeight);
          const fontSize = Math.max(
            8,
            Math.min(54, Math.round(p.estimatedFontSize * options.fontSizeMultiplier))
          );

          const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (!firstPageTextId) {
            firstPageTextId = annId;
            firstPageIndex = pageIndex;
          }

          newAnnotations.push({
            id: annId,
            pageId: page.id,
            type: 'text',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(60, Math.round(width)),
            height: Math.max(24, Math.round(height)),
            text: p.text,
            fontSize,
            fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
            color: options.fontColor || '#0f172a',
            isBold: p.isBold,
            isItalic: false,
            isUnderline: false,
            textAlign: 'left',
          });
        }
        if (newAnnotations.some((a) => a.type === 'text')) handled = true;
      }

      // Tier 2: Lines
      if (!handled && pageResult.lines && pageResult.lines.length > 0) {
        for (const line of pageResult.lines) {
          if (!line.text || line.text.trim().length === 0) continue;

          const normX = line.bbox.x0 / pageResult.width;
          const normY = line.bbox.y0 / pageResult.height;
          const normW = (line.bbox.x1 - line.bbox.x0) / pageResult.width;
          const normH = (line.bbox.y1 - line.bbox.y0) / pageResult.height;

          const x = Math.max(0, normX * pageWidth);
          const y = Math.max(0, normY * pageHeight);
          const width = Math.min(pageWidth - x, normW * pageWidth);
          const height = Math.min(pageHeight - y, normH * pageHeight);
          const pointHeight = (line.bbox.y1 - line.bbox.y0) / 3.0;
          const fontSize = Math.max(
            8,
            Math.min(54, Math.round(pointHeight * 0.75 * options.fontSizeMultiplier))
          );

          const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (!firstPageTextId) {
            firstPageTextId = annId;
            firstPageIndex = pageIndex;
          }

          newAnnotations.push({
            id: annId,
            pageId: page.id,
            type: 'text',
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(40, Math.round(width)),
            height: Math.max(18, Math.round(height)),
            text: line.text,
            fontSize,
            fontFamily: options.fontFamily || 'Helvetica, Arial, sans-serif',
            color: options.fontColor || '#0f172a',
            isBold: false,
            isItalic: false,
            isUnderline: false,
            textAlign: 'left',
          });
        }
        if (newAnnotations.some((a) => a.type === 'text')) handled = true;
      }

      // Tier 3: Fallback synthesize
      if (!handled && pageResult.text && pageResult.text.trim().length > 0) {
        const fallbackParagraphs = pageResult.text
          .trim()
          .split(/\n\s*\n+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        const synthesized = this.generateSynthesizedAnnotations(
          fallbackParagraphs,
          page.id,
          pageWidth,
          pageHeight,
          options
        );
        for (const ann of synthesized) {
          if (!firstPageTextId) {
            firstPageTextId = ann.id;
            firstPageIndex = pageIndex;
          }
          newAnnotations.push(ann);
        }
      }

      const textCount = newAnnotations.filter((a) => a.type === 'text').length;
      if (textCount > 0) {
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
