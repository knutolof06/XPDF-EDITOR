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
   */
  public static transferSinglePage(
    pageResult: OcrPageResult,
    options: TextTransferOptions = {
      mode: 'paragraph',
      hideOriginalScan: false,
      fontSizeMultiplier: 1.0,
      fontColor: '#0f172a',
      fontFamily: 'Helvetica, Arial, sans-serif',
    }
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

    // 2. Mode: Paragraph (Grouped multi-line editable text blocks)
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

        const textAnn: TextAnnotation = {
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
        };

        newAnnotations.push(textAnn);
      }
    } else {
      // 3. Mode: Line-by-line Precision
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

        // Approximate line font size from height
        const pointHeight = (line.bbox.y1 - line.bbox.y0) / 2.5;
        const fontSize = Math.max(
          8,
          Math.min(54, Math.round(pointHeight * 0.75 * options.fontSizeMultiplier))
        );

        const annId = `text_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        if (!firstTextId) firstTextId = annId;

        const textAnn: TextAnnotation = {
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
        };

        newAnnotations.push(textAnn);
      }
    }

    if (newAnnotations.length === 0) {
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
      `Sayfa ${pageResult.pageNumber}: ${newAnnotations.length} OCR metin bloğu sayfaya aktarıldı`
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
      count: newAnnotations.length,
      firstTextId,
    };
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

      const paragraphsToUse =
        options.mode === 'paragraph' && pageResult.paragraphs && pageResult.paragraphs.length > 0
          ? pageResult.paragraphs
          : null;

      if (paragraphsToUse) {
        for (const p of paragraphsToUse) {
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
      } else {
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
          const pointHeight = (line.bbox.y1 - line.bbox.y0) / 2.5;
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
      }

      if (newAnnotations.length > 0) {
        pageTransfers.push({
          pageId: page.id,
          newAnnotations,
          previousAnnotations: [...page.annotations],
        });
        totalCount += newAnnotations.length;
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
