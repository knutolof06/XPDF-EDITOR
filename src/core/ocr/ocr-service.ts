import { createWorker, Worker } from 'tesseract.js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type OcrLanguage = 'tur' | 'eng' | 'tur+eng' | 'deu' | 'fra';

export interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  normBbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  words: OcrWord[];
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  words: OcrWord[];
  lines: OcrLine[];
  width: number;
  height: number;
  previewUrl: string;
}

export interface OcrDocumentResult {
  pages: OcrPageResult[];
  fullText: string;
  averageConfidence: number;
  totalWords: number;
  totalPages: number;
}

export interface OcrProgress {
  stage: 'rasterizing' | 'recognizing' | 'assembling' | 'done';
  currentPage: number;
  totalPages: number;
  pageProgress: number; // 0 to 100
  overallProgress: number; // 0 to 100
  statusText: string;
}

export class OcrService {
  private static activeWorker: Worker | null = null;
  private static currentLang: string | null = null;

  /**
   * Initializes or reuses a Tesseract.js worker with the requested language(s).
   */
  public static async getWorker(
    lang: OcrLanguage = 'tur',
    onProgress?: (progress: number, status: string) => void
  ): Promise<Worker> {
    if (this.activeWorker && this.currentLang === lang) {
      return this.activeWorker;
    }

    if (this.activeWorker) {
      try {
        await this.activeWorker.terminate();
      } catch (err) {
        console.warn('Error terminating previous worker:', err);
      }
      this.activeWorker = null;
    }

    // Languages can be combined like 'tur+eng'
    const worker = await createWorker(lang, 1, {
      logger: (m) => {
        if (onProgress && typeof m.progress === 'number') {
          onProgress(Math.round(m.progress * 100), m.status || 'İşleniyor');
        }
      },
    });

    this.activeWorker = worker;
    this.currentLang = lang;
    return worker;
  }

  /**
   * Terminate active worker to free memory when studio is closed.
   */
  public static async terminateWorker(): Promise<void> {
    if (this.activeWorker) {
      try {
        await this.activeWorker.terminate();
      } catch (err) {
        console.warn('Worker terminate error:', err);
      }
      this.activeWorker = null;
      this.currentLang = null;
    }
  }

  /**
   * High-resolution offscreen canvas rendering with contrast enhancement.
   */
  public static async renderPageToCanvas(
    pdfDocProxy: PDFDocumentProxy,
    pageNumber: number,
    scale: number = 2.0,
    enhanceContrast: boolean = true
  ): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; previewUrl: string }> {
    const page = await pdfDocProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D context oluşturulamadı.');
    }

    // Render page to canvas
    // @ts-ignore
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Apply contrast / threshold enhancement if desired for scanned documents
    if (enhanceContrast) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const contrast = 1.15; // 15% contrast boost

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Luminance
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = ((gray / 255 - 0.5) * contrast + 0.5) * 255;
        gray = Math.max(0, Math.min(255, gray));

        // Preserve colors subtly or boost contrast
        data[i] = Math.min(255, Math.max(0, ((r / 255 - 0.5) * contrast + 0.5) * 255));
        data[i + 1] = Math.min(255, Math.max(0, ((g / 255 - 0.5) * contrast + 0.5) * 255));
        data[i + 2] = Math.min(255, Math.max(0, ((b / 255 - 0.5) * contrast + 0.5) * 255));
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const previewUrl = canvas.toDataURL('image/jpeg', 0.85);

    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      previewUrl,
    };
  }

  /**
   * Runs OCR on a single rendered canvas using Tesseract.js.
   */
  public static async recognizeCanvas(
    canvas: HTMLCanvasElement,
    previewUrl: string,
    pageNumber: number,
    lang: OcrLanguage = 'tur',
    onProgress?: (progress: number, statusText: string) => void
  ): Promise<OcrPageResult> {
    const worker = await this.getWorker(lang, onProgress);
    const result = await worker.recognize(canvas);

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const pageData = result.data;

    const words: OcrWord[] = [];
    const lines: OcrLine[] = [];

    if (pageData.blocks) {
      for (const block of pageData.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const lineWords: OcrWord[] = [];

            for (const word of line.words) {
              const clean = (word.text || '').trim();
              if (clean.length > 0) {
                const w: OcrWord = {
                  text: clean,
                  confidence: Math.round(word.confidence || 0),
                  bbox: word.bbox,
                  normBbox: {
                    x: word.bbox.x0 / canvasWidth,
                    y: word.bbox.y0 / canvasHeight,
                    width: (word.bbox.x1 - word.bbox.x0) / canvasWidth,
                    height: (word.bbox.y1 - word.bbox.y0) / canvasHeight,
                  },
                };
                words.push(w);
                lineWords.push(w);
              }
            }

            if (line.text && line.text.trim().length > 0) {
              lines.push({
                text: line.text.trim(),
                confidence: Math.round(line.confidence || 0),
                bbox: line.bbox,
                words: lineWords,
              });
            }
          }
        }
      }
    }

    return {
      pageNumber,
      text: pageData.text || '',
      confidence: Math.round(pageData.confidence || 0),
      words,
      lines,
      width: canvasWidth,
      height: canvasHeight,
      previewUrl,
    };
  }

  /**
   * Batch processes a list of page numbers with real-time progress callbacks.
   */
  public static async processDocumentPages(
    pdfDocProxy: PDFDocumentProxy,
    pageNumbers: number[],
    lang: OcrLanguage = 'tur',
    enhanceContrast: boolean = true,
    onProgress?: (progress: OcrProgress) => void
  ): Promise<OcrDocumentResult> {
    const total = pageNumbers.length;
    const results: OcrPageResult[] = [];
    let totalConfidence = 0;
    let totalWords = 0;

    for (let i = 0; i < total; i++) {
      const pageNum = pageNumbers[i];

      // 1. Rasterize
      if (onProgress) {
        onProgress({
          stage: 'rasterizing',
          currentPage: pageNum,
          totalPages: total,
          pageProgress: 10,
          overallProgress: Math.round((i / total) * 100),
          statusText: `Sayfa ${pageNum} taranıyor ve optimize ediliyor...`,
        });
      }

      const { canvas, previewUrl } = await this.renderPageToCanvas(
        pdfDocProxy,
        pageNum,
        2.0,
        enhanceContrast
      );

      // 2. Recognize
      const pageResult = await this.recognizeCanvas(
        canvas,
        previewUrl,
        pageNum,
        lang,
        (p, status) => {
          if (onProgress) {
            const pagePct = 10 + Math.round(p * 0.85);
            const overall = Math.round(((i + p / 100) / total) * 100);
            onProgress({
              stage: 'recognizing',
              currentPage: pageNum,
              totalPages: total,
              pageProgress: pagePct,
              overallProgress: Math.min(99, overall),
              statusText: `Sayfa ${pageNum}: Metin tanınıyor (${status} %${p})`,
            });
          }
        }
      );

      results.push(pageResult);
      totalConfidence += pageResult.confidence;
      totalWords += pageResult.words.length;
    }

    if (onProgress) {
      onProgress({
        stage: 'done',
        currentPage: pageNumbers[total - 1] || 1,
        totalPages: total,
        pageProgress: 100,
        overallProgress: 100,
        statusText: 'OCR tamamlandı!',
      });
    }

    const fullText = results
      .map((r) => `--- Sayfa ${r.pageNumber} ---\n${r.text.trim()}`)
      .join('\n\n');

    return {
      pages: results,
      fullText,
      averageConfidence: total > 0 ? Math.round(totalConfidence / total) : 0,
      totalWords,
      totalPages: total,
    };
  }

  /**
   * Generates a Searchable PDF by embedding an invisible text layer (opacity: 0)
   * at exact word coordinates on top of the original document.
   */
  public static async exportSearchablePdf(
    originalBuffer: ArrayBuffer,
    ocrPages: OcrPageResult[]
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(originalBuffer);
    const standardFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const ocrPage of ocrPages) {
      const pageIndex = ocrPage.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

      const page = pdfDoc.getPage(pageIndex);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      for (const word of ocrPage.words) {
        if (!word.text || word.text.trim().length === 0) continue;

        // Convert normalized coordinates (top-left origin) to PDF coordinates (bottom-left origin)
        const x = word.normBbox.x * pageWidth;
        const height = word.normBbox.height * pageHeight;
        const y = pageHeight - (word.normBbox.y * pageHeight + height);

        // Calculate approximate font size fitting the height
        const fontSize = Math.max(4, Math.min(48, height * 0.85));

        try {
          // Render invisible text overlay at the exact word location
          page.drawText(word.text, {
            x,
            y: Math.max(0, y),
            size: fontSize,
            font: standardFont,
            color: rgb(0, 0, 0),
            opacity: 0.001, // Virtually transparent / invisible text layer
          });
        } catch {
          // Fallback if some non-standard characters cannot be encoded in Helvetica
          try {
            const asciiText = word.text.replace(/[^\x00-\x7F]/g, '?');
            page.drawText(asciiText, {
              x,
              y: Math.max(0, y),
              size: fontSize,
              font: standardFont,
              color: rgb(0, 0, 0),
              opacity: 0.001,
            });
          } catch {}
        }
      }
    }

    return await pdfDoc.save();
  }
}
